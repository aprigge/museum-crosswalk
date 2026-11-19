import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createMet } from '../../src/sources/met.js';
import { reconcileRecord } from '../../src/reconcile/match.js';
import { validateJsonLd, validateSchema } from '../../src/linkedart/validate.js';
import { AAT } from '../../src/linkedart/vocab.js';
import type { ArtistQuery } from '../../src/core/types.js';
import { fixture, noNetwork, vanGogh } from '../helpers.js';

vi.stubGlobal('fetch', noNetwork);

const met = createMet();
let artist: ArtistQuery;
beforeAll(async () => {
  artist = await vanGogh();
});

const convert = async (id: string) => met.toLinkedArt(await fixture('met', 'objects', id));
const reconcile = async (id: string) =>
  reconcileRecord('met', id, await met.artistRefs(await fixture('met', 'objects', id)), artist);

describe('met adapter', () => {
  it('reads every object ID from the cached v1.1 search page', async () => {
    const ids: string[] = [];
    for await (const id of met.search(artist)) ids.push(id);
    expect(ids).toHaveLength(38);
    expect(ids).toContain('436524');
  });

  it('converts Sunflowers to valid Linked Art', async () => {
    const { record } = await convert('436524');
    expect(validateSchema(record)).toEqual([]);
    expect(await validateJsonLd(record)).toEqual([]);
    expect(record).toMatchObject({
      type: 'HumanMadeObject',
      _label: 'Sunflowers',
      identified_by: [{ content: 'Sunflowers' }, { content: '49.41', classified_as: [{ id: AAT.accessionNumber }] }],
      produced_by: {
        timespan: { begin_of_the_begin: '1887-01-01T00:00:00Z', end_of_the_end: '1887-12-31T23:59:59Z' },
        carried_out_by: [{ id: 'http://www.wikidata.org/entity/Q5582', _label: 'Vincent van Gogh' }],
      },
      equivalent: [{ id: 'http://www.wikidata.org/entity/Q9213165' }],
    });
  });

  it('keeps only Overall measurements and reports the framed ones as unmapped', async () => {
    const { record, unmapped } = await convert('436524');
    expect((record.dimension as { value: number }[]).map((d) => d.value)).toEqual([43.2, 61]);
    expect(unmapped['measurements (not Overall)']).toHaveLength(1);
  });

  it('marks Open Access records CC0 and others not open', async () => {
    expect(((await convert('436524')).record._provenance as { license: string }).license).toBe(
      'https://creativecommons.org/publicdomain/zero/1.0/',
    );
    expect(((await convert('276299')).record._provenance as { license: string }).license).toBe('not-open-access');
  });

  it('does not invent fields the record lacks', async () => {
    const { record } = await convert('276299'); // book: no medium, dimensions or image
    expect(record.representation).toBeUndefined();
    expect(record.dimension).toBeUndefined();
    expect(JSON.stringify(record.referred_to_by)).not.toMatch(AAT.materialsStatement);
  });

  it('only maps Artist constituents to carried_out_by', async () => {
    const { record, unmapped } = await convert('849056');
    expect((record.produced_by as { carried_out_by: unknown[] }).carried_out_by).toHaveLength(1);
    expect(unmapped['constituents (non-Artist roles)']).toEqual(['Printer: Paul-Ferdinand Gachet']);
  });
});

describe('met reconciliation', () => {
  it('confirms constituents that link Q5582 with the Artist role', async () => {
    const r = await reconcile('436524');
    expect(r.confirmed).toBe(true);
    expect(r.matches[0]).toMatchObject({ method: 'exact-id', qid: 'Q5582' });
  });

  it('sends non-Artist roles to review', async () => {
    const r = await reconcile('276299');
    expect(r.confirmed).toBe(false);
    expect(r.review?.reason).toMatch(/Qualified role: Author/);
  });

  it('flags partial-name search hits by other artists', async () => {
    const r = await reconcile('385466');
    expect(r.confirmed).toBe(false);
    expect(r.matches.map((m) => m.qid)).not.toContain('Q5582');
  });
});
