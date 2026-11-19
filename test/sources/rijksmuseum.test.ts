import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRijksmuseum, images, productionAgents, recordLicense } from '../../src/sources/rijksmuseum.js';
import { reconcileRecord } from '../../src/reconcile/match.js';
import { validateJsonLd } from '../../src/linkedart/validate.js';
import type { ArtistQuery } from '../../src/core/types.js';
import { fixture, noNetwork, vanGogh } from '../helpers.js';

vi.stubGlobal('fetch', noNetwork);

const rijks = createRijksmuseum();
let artist: ArtistQuery;
beforeAll(async () => {
  artist = await vanGogh();
});

describe('rijksmuseum adapter', () => {
  it('pages search results from the cache and de-duplicates across name and surname searches', async () => {
    const ids: string[] = [];
    for await (const id of rijks.search(artist)) ids.push(id);
    expect(ids).toContain('200108926');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads the artist through production attribution assignments', async () => {
    const raw = await fixture('rijksmuseum', 'objects', '200108926');
    expect(productionAgents(raw.body as never).map((a) => a.id)).toContain('https://id.rijksmuseum.nl/2102256');
  });

  it('takes the Wikidata link from the cached person record', async () => {
    const raw = await fixture('rijksmuseum', 'objects', '200108926');
    const [ref] = await rijks.artistRefs(raw);
    expect(ref).toMatchObject({ name: 'Vincent van Gogh', wikidata: artist.qid, ulan: '500115588' });
    expect(ref!.otherIds?.rkd).toBe('32439');
  });

  it('keeps the record license and the image license apart', async () => {
    const raw = await fixture('rijksmuseum', 'objects', '200108926');
    const body = raw.body as never;
    expect(recordLicense(body)).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    expect(images(body)[0]?.license).toBe('https://creativecommons.org/publicdomain/mark/1.0/');

    const { record } = rijks.toLinkedArt(raw);
    expect(record._provenance).toMatchObject({
      source: 'rijksmuseum',
      sourceUrl: 'https://id.rijksmuseum.nl/200108926?_profile=la-framed',
      fetchedAt: raw.fetchedAt,
      license: 'https://creativecommons.org/publicdomain/zero/1.0/',
    });
    expect(Object.values(record._fieldProvenance as object)[0]).toMatchObject({
      license: 'https://creativecommons.org/publicdomain/mark/1.0/',
    });
  });

  it('passes the record through as JSON-LD that expands with the Linked Art context', async () => {
    const { record } = rijks.toLinkedArt(await fixture('rijksmuseum', 'objects', '200108926'));
    expect(record.id).toBe('https://id.rijksmuseum.nl/200108926');
    expect(await validateJsonLd(record)).toEqual([]);
  });
});

describe('rijksmuseum reconciliation', () => {
  const reconcile = async (id: string) =>
    reconcileRecord('rijksmuseum', id, await rijks.artistRefs(await fixture('rijksmuseum', 'objects', id)), artist);

  it('confirms an exact Wikidata ID with a plain creator role', async () => {
    const r = await reconcile('200108926');
    expect(r.confirmed).toBe(true);
    expect(r.review).toBeNull();
    expect(r.matches[0]).toMatchObject({ method: 'exact-id', qid: artist.qid, confidence: 1 });
  });

  it('sends "possibly" attributions to review even with an exact ID', async () => {
    const r = await reconcile('200318124');
    expect(r.confirmed).toBe(false);
    expect(r.review?.reason).toMatch(/Qualified role/);
  });

  it('sends "after" works (influenced_by) to review', async () => {
    const r = await reconcile('200664864');
    expect(r.confirmed).toBe(false);
    expect(r.review?.reason).toMatch(/influenced_by/);
  });

  it('flags surname-search hits by a different Gogh', async () => {
    const r = await reconcile('200662543');
    expect(r.confirmed).toBe(false);
    expect(r.review?.reason).toMatch(/No artist on the record matches/);
  });
});
