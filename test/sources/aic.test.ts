import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAic, hasText } from '../../src/sources/aic.js';
import { reconcileRecord } from '../../src/reconcile/match.js';
import { validateJsonLd, validateSchema } from '../../src/linkedart/validate.js';
import { AAT } from '../../src/linkedart/vocab.js';
import type { ArtistQuery } from '../../src/core/types.js';
import { fixture, noNetwork, vanGogh } from '../helpers.js';

vi.stubGlobal('fetch', noNetwork);

const aic = createAic();
let artist: ArtistQuery;
beforeAll(async () => {
  artist = await vanGogh();
});

const convert = async (id: string) => aic.toLinkedArt(await fixture('aic', 'objects', id));
const reconcile = async (id: string) =>
  reconcileRecord('aic', id, await aic.artistRefs(await fixture('aic', 'objects', id)), artist);
type Statement = { content: string; classified_as: { id: string }[] };

describe('aic adapter', () => {
  it('searches artworks for every agent whose name contains the artist', async () => {
    const ids: string[] = [];
    for await (const id of aic.search(artist)) ids.push(id);
    expect(ids).toHaveLength(19);
    expect(ids).toContain('27952'); // by "Imitator of Vincent van Gogh"
  });

  it('converts The Bedroom to valid Linked Art with IIIF images', async () => {
    const { record } = await convert('28560');
    expect(validateSchema(record)).toEqual([]);
    expect(await validateJsonLd(record)).toEqual([]);
    expect(record).toMatchObject({
      id: 'https://api.artic.edu/api/v1/artworks/28560',
      _label: 'The Bedroom',
      identified_by: [{ content: 'The Bedroom' }, { content: '1926.417' }],
      produced_by: { carried_out_by: [{ id: 'https://api.artic.edu/api/v1/agents/40610' }] },
    });
    const image = JSON.stringify(record.representation);
    expect(image).toContain('https://www.artic.edu/iiif/2/6644829f-f292-c5c4-a73c-0356a6fdbf0d/full/843,/0/default.jpg');
    expect(image).toContain('http://iiif.io/api/image');
  });

  it('marks description CC-BY separately from the CC0 record', async () => {
    const { record } = await convert('28560');
    expect((record._provenance as { license: string }).license).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    expect((record._fieldProvenance as Record<string, { license: string }>)['referred_to_by[Description]']!.license).toBe(
      'https://creativecommons.org/licenses/by/4.0/',
    );
    const description = (record.referred_to_by as Statement[]).find((s) => s.classified_as[0]!.id === AAT.description);
    expect(description?.content).toMatch(/Yellow House/);
  });

  it('leaves description out, with no CC-BY provenance, when AIC has none', async () => {
    const { record } = await convert('14586');
    expect(JSON.stringify(record.referred_to_by)).not.toContain(AAT.description);
    expect(record._fieldProvenance).toBeUndefined();
  });

  it('does not map the rounded structured dimensions', async () => {
    const { record, unmapped } = await convert('28560');
    expect(record.dimension).toBeUndefined();
    expect(unmapped.dimensions_detail).toMatchObject({ note: expect.stringMatching(/whole centimetres/) });
  });

  it('treats empty or tag-only HTML as no description', () => {
    expect(hasText('<p></p>\n')).toBe(false);
    expect(hasText(null)).toBe(false);
    expect(hasText('<p>Text</p>')).toBe(true);
  });
});

describe('aic reconciliation', () => {
  it('crosswalks Van Gogh on two Wikidata IDs but still sends it to review', async () => {
    const r = await reconcile('28560');
    expect(r.matches[0]).toMatchObject({ method: 'wikidata-crosswalk', qid: 'Q5582', confidence: 0.9 });
    expect(r.matches[0]!.evidence).toMatch(/P245.*500115588.*P6295.*40610/);
    expect(r.confirmed).toBe(false);
    expect(r.review?.reason).toMatch(/not an exact ID/);
  });

  it('flags the imitator agent that Wikidata also lists under P6295', async () => {
    const r = await reconcile('27952');
    expect(r.matches[0]).toMatchObject({ method: 'wikidata-crosswalk', confidence: 0.7 });
    expect(r.matches[0]!.ref.plainCreator).toBe(false);
    expect(r.review?.reason).toMatch(/Imitator of Vincent van Gogh/);
  });
});
