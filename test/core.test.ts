import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlockedError, HttpError, retryAfterMs, SourceClient, userAgent } from '../src/core/http.js';
import { matchRef, normaliseName } from '../src/reconcile/match.js';
import { upgradeTupleItems } from '../src/linkedart/validate.js';
import type { ArtistQuery } from '../src/core/types.js';

describe('SourceClient', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'crosswalk-'));
    process.env.DATA_DIR = dir;
  });
  afterEach(async () => {
    process.env.DATA_DIR = 'test/fixtures';
    await rm(dir, { recursive: true, force: true });
  });

  function harness(responses: Response[]) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const sleeps: number[] = [];
    let clock = 0;
    const client = new SourceClient({
      source: 'stub',
      minIntervalMs: 500,
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return responses.shift()!;
      }) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
    });
    return { client, calls, sleeps };
  }

  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('sends the User-Agent, caches, and serves the cache on the second call', async () => {
    const { client, calls } = harness([ok({ a: 1 })]);
    const first = await client.getJson('k', 'x', 'https://example.org/x');
    const second = await client.getJson('k', 'x', 'https://example.org/x');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['User-Agent']).toBe(userAgent('test@example.org'));
    expect(second).toEqual(first);
    expect(first).toMatchObject({ source: 'stub', id: 'x', url: 'https://example.org/x', body: { a: 1 } });
  });

  it('spaces requests by the minimum interval', async () => {
    const { client, sleeps } = harness([ok(1), ok(2)]);
    await client.getJson('k', 'a', 'https://example.org/a');
    await client.getJson('k', 'b', 'https://example.org/b');
    expect(sleeps).toEqual([500]);
  });

  it('retries 429 honouring Retry-After, then succeeds', async () => {
    const { client, calls, sleeps } = harness([
      new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
      ok({ done: true }),
    ]);
    const raw = await client.getJson('k', 'r', 'https://example.org/r');
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(3000);
    expect(raw.body).toEqual({ done: true });
  });

  it('stops all requests to a source after a 403 block', async () => {
    const { client, calls } = harness([new Response('blocked', { status: 403 }), ok(1)]);
    await expect(client.getJson('k', 'a', 'https://example.org/a')).rejects.toBeInstanceOf(BlockedError);
    await expect(client.getJson('k', 'b', 'https://example.org/b')).rejects.toBeInstanceOf(BlockedError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a 404', async () => {
    const { client, calls } = harness([new Response('', { status: 404 })]);
    await expect(client.getJson('k', 'n', 'https://example.org/n')).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
  });

  it('parses Retry-After seconds', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs(null)).toBeNull();
  });
});

describe('matching', () => {
  const artist: ArtistQuery = {
    name: 'Vincent van Gogh',
    qid: 'Q5582',
    birth: '1853-03-30T00:00:00Z',
    death: '1890-07-29T00:00:00Z',
    externalIds: { P245: { label: 'Union List of Artist Names ID', values: ['500115588'] } },
  };
  const ref = { source: 'x', recordId: '1' };

  it('normalises inverted names and diacritics', () => {
    expect(normaliseName('Gogh, Vincent van')).toBe('vincent van gogh');
    expect(normaliseName('Jozef Israëls')).toBe('jozef israels');
  });

  it('prefers an exact ID, then a crosswalk, then name and dates', () => {
    expect(matchRef({ ...ref, wikidata: 'Q5582' }, artist).method).toBe('exact-id');
    expect(matchRef({ ...ref, ulan: '500115588' }, artist)).toMatchObject({ method: 'wikidata-crosswalk', qid: 'Q5582' });
    expect(matchRef({ ...ref, name: 'Gogh, Vincent van', birth: '1853', death: '1890' }, artist)).toMatchObject({
      method: 'name-dates',
      confidence: 0.8,
    });
  });

  it('marks a name match with wrong dates as low confidence', () => {
    expect(matchRef({ ...ref, name: 'Vincent van Gogh', birth: '1789', death: '1874' }, artist).confidence).toBe(0.2);
  });

  it('reports a different Wikidata entity rather than matching it', () => {
    expect(matchRef({ ...ref, wikidata: 'Q2185351' }, artist)).toMatchObject({ qid: 'Q2185351' });
  });
});

describe('schema loading', () => {
  it('rewrites draft-07 tuple items to prefixItems', () => {
    expect(upgradeTupleItems({ a: { items: [{ type: 'string' }] }, b: { items: { type: 'x' } } })).toEqual({
      a: { prefixItems: [{ type: 'string' }] },
      b: { items: { type: 'x' } },
    });
  });
});
