import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SourceClient } from '../src/core/http.js';
import { SLICES, type CachedRaw } from '../src/core/types.js';
import { productionSpan, sliceDatePatterns } from '../src/sources/rijksmuseum.js';
import { aatEntity, metInSlice, sliceSearches, tagType } from '../src/sources/met.js';
import { aicToLinkedArt, sliceSearchUrl, termType, type AicTerm } from '../src/sources/aic.js';
import { AAT } from '../src/linkedart/vocab.js';
import { fixture } from './helpers.js';

const slice = SLICES['paintings-1850-1900']!;

describe('slice queries', () => {
  it('covers 1850–1900 with Rijksmuseum decade wildcards and the final year', () => {
    expect(sliceDatePatterns(slice)).toEqual(['185?', '186?', '187?', '188?', '189?', '1900']);
    expect(sliceDatePatterns({ ...slice, from: 1848, to: 1851 })).toEqual(['1848', '1849', '1850', '1851']);
  });

  it('builds the AIC bool query on artwork type and start date', () => {
    const url = new URL(sliceSearchUrl(slice, 2));
    expect(url.searchParams.get('query[bool][must][0][term][artwork_type_id]')).toBe('1');
    expect(url.searchParams.get('query[bool][must][1][range][date_start][gte]')).toBe('1850');
    expect(url.searchParams.get('query[bool][must][2][range][date_start][lte]')).toBe('1900');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('searches two Met departments with the date range', () => {
    expect(sliceSearches(slice).map((s) => s.params)).toEqual([
      { departmentId: '11', dateBegin: '1850', dateEnd: '1900' },
      { departmentId: '1', medium: 'Paintings', dateBegin: '1850', dateEnd: '1900' },
    ]);
  });
});

describe('slice membership', () => {
  const met = (body: object) => ({ source: 'met', id: '1', url: '', fetchedAt: '', body }) as CachedRaw;

  it('keeps Met paintings whose dates overlap the slice and drops other classifications', () => {
    expect(metInSlice(met({ classification: 'Paintings', objectBeginDate: 1887, objectEndDate: 1887 }), slice)).toBe(true);
    expect(metInSlice(met({ classification: 'Paintings', objectBeginDate: 1845, objectEndDate: 1852 }), slice)).toBe(true);
    expect(metInSlice(met({ classification: 'Furniture', objectBeginDate: 1880, objectEndDate: 1880 }), slice)).toBe(false);
    expect(metInSlice(met({ classification: 'Paintings', objectBeginDate: 1901, objectEndDate: 1905 }), slice)).toBe(false);
  });

  it('reads the Rijksmuseum production span in years', async () => {
    const raw = await fixture('rijksmuseum', 'objects', '200108926');
    expect(productionSpan(raw.body as never)).toEqual({ begin: 1884, end: 1884 });
  });
});

describe('subject concepts', () => {
  it('turns Met tag URLs into AAT entity URIs with the Wikidata item as equivalent', () => {
    expect(aatEntity('http://vocab.getty.edu/page/aat/300015636')).toBe('http://vocab.getty.edu/aat/300015636');
    expect(
      tagType({ term: 'Landscapes', AAT_URL: 'http://vocab.getty.edu/page/aat/300015636', Wikidata_URL: 'https://www.wikidata.org/wiki/Q191163' }),
    ).toEqual({
      id: 'http://vocab.getty.edu/aat/300015636',
      type: 'Type',
      _label: 'Landscapes',
      equivalent: [{ id: 'http://www.wikidata.org/entity/Q191163', type: 'Type' }],
    });
    expect(tagType({ term: 'Untyped' })).toBeNull();
  });

  it('uses AIC term AAT IDs when present and AIC URIs otherwise', () => {
    expect(termType({ id: 'TM-7543', title: 'Impressionism', subtype: 'style', aat_id: 300021503 }).id).toBe(
      'http://vocab.getty.edu/aat/300021503',
    );
    expect(termType({ id: 'TM-15357', title: 'Nymphaea', subtype: 'subject', aat_id: null }).id).toBe(
      'https://api.artic.edu/api/v1/category-terms/TM-15357',
    );
  });

  it('maps AIC styles to classified_as and subjects to a minted VisualItem', async () => {
    const raw = await fixture('aic', 'objects', '28560');
    const a = (raw.body as { data: Record<string, unknown> }).data;
    const withIds = { ...raw, body: { ...(raw.body as object), data: { ...a, style_ids: ['TM-7543'], subject_ids: ['TM-8657', 'TM-404'] } } };
    const terms = new Map<string, AicTerm>([
      ['TM-7543', { id: 'TM-7543', title: 'Impressionism', subtype: 'style', aat_id: 300021503 }],
      ['TM-8657', { id: 'TM-8657', title: 'landscapes', subtype: 'subject', aat_id: 300015636 }],
    ]);
    const { record, related, unmapped } = aicToLinkedArt(withIds, terms);
    expect(record.classified_as).toEqual([
      { id: 'http://vocab.getty.edu/aat/300021503', type: 'Type', _label: 'Impressionism', classified_as: [{ id: AAT.style, type: 'Type', _label: 'Style' }] },
    ]);
    expect(record.shows).toEqual([{ id: 'https://aprigge.github.io/museum-crosswalk/id/visual/aic-28560', type: 'VisualItem' }]);
    expect(related?.[0]).toMatchObject({ type: 'VisualItem', about: [{ id: 'http://vocab.getty.edu/aat/300015636', _label: 'landscapes' }] });
    expect(unmapped['category terms (not cached)']).toEqual(['TM-404']);
  });
});

describe('cache staleness', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'crosswalk-'));
    process.env.DATA_DIR = dir;
  });
  afterEach(async () => {
    process.env.DATA_DIR = 'test/fixtures';
    await rm(dir, { recursive: true, force: true });
  });

  it('refetches when the cached copy came from a different URL', async () => {
    let calls = 0;
    const client = new SourceClient({
      source: 'stub',
      minIntervalMs: 0,
      fetchImpl: (async () => {
        calls++;
        return new Response(JSON.stringify({ n: calls }));
      }) as typeof fetch,
      sleep: async () => {},
    });
    await client.getJson('k', 'a', 'https://example.org/a?fields=x');
    await client.getJson('k', 'a', 'https://example.org/a?fields=x');
    const fresh = await client.getJson('k', 'a', 'https://example.org/a?fields=x,y');
    expect(calls).toBe(2);
    expect(fresh.body).toEqual({ n: 2 });
  });
});
