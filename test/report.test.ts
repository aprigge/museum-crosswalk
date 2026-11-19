import { describe, expect, it, vi } from 'vitest';
import { createAic } from '../src/sources/aic.js';
import { createMet } from '../src/sources/met.js';
import { createRijksmuseum } from '../src/sources/rijksmuseum.js';
import { recordStatus, matchRef } from '../src/reconcile/match.js';
import { schemaErrorKind } from '../src/linkedart/validate.js';
import { hasDescription, hasOpenImage, imageLicense, imageUrls } from '../src/report/stats.js';
import { END_MARKER, renderReport } from '../src/report/render.js';
import type { ArtistQuery } from '../src/core/types.js';
import { fixture, noNetwork } from './helpers.js';

vi.stubGlobal('fetch', noNetwork);

const convert = async (adapter: { toLinkedArt: Function }, source: string, id: string) =>
  adapter.toLinkedArt(await fixture(source, 'objects', id)).record as Record<string, unknown>;

describe('report stats over converted records', () => {
  it('finds Rijksmuseum images under subject_of and uses their own license', async () => {
    const r = await convert(createRijksmuseum(), 'rijksmuseum', '200108926');
    expect(imageUrls(r)).toEqual(['https://iiif.micr.io/AmWMg/full/max/0/default.jpg']);
    expect(imageLicense(r)).toBe('https://creativecommons.org/publicdomain/mark/1.0/');
    expect(hasOpenImage(r)).toBe(true);
  });

  it('does not count an image on a record that is not Open Access', async () => {
    const r = await convert(createMet(), 'met', '276299');
    expect(hasOpenImage(r)).toBe(false);
  });

  it('counts AIC description prose and nothing for records without it', async () => {
    expect(hasDescription(await convert(createAic(), 'aic', '28560'))).toBe(true);
    expect(hasDescription(await convert(createAic(), 'aic', '14586'))).toBe(false);
    expect(hasDescription(await convert(createMet(), 'met', '436524'))).toBe(false);
  });
});

describe('record status', () => {
  const artist: ArtistQuery = { name: 'Vincent van Gogh', qid: 'Q5582', externalIds: { P245: { label: 'ULAN', values: ['1'] } } };
  const ref = { source: 'x', recordId: '1' };

  it('ranks qualified above crosswalk-only and exact', () => {
    expect(recordStatus([matchRef({ ...ref, wikidata: 'Q5582', plainCreator: true }, artist)], 'Q5582')).toBe('confirmed');
    expect(recordStatus([matchRef({ ...ref, ulan: '1' }, artist)], 'Q5582')).toBe('crosswalk-only');
    expect(recordStatus([matchRef({ ...ref, ulan: '1', name: 'Imitator of Vincent van Gogh' }, artist)], 'Q5582')).toBe('qualified');
    expect(recordStatus([matchRef({ ...ref, wikidata: 'Q2185351' }, artist)], 'Q5582')).toBe('other-artist');
    expect(recordStatus([], 'Q5582')).toBe('no-artist');
  });
});

describe('schema error kinds', () => {
  it('groups by property and drops anyOf side errors', () => {
    expect(schemaErrorKind('/made_of/0 must NOT have additional properties "notation"')).toBe('extra property `notation`');
    expect(schemaErrorKind("/ must have required property '_label' \"_label\"")).toBe('missing `_label`');
    expect(schemaErrorKind('/identified_by/0/type must be equal to constant')).toBeNull();
    expect(schemaErrorKind('/dimension/1/value must be number')).toBe('/dimension/*/value must be number');
  });
});

describe('renderReport', () => {
  it('renders every section for an empty source without throwing', () => {
    const md = renderReport(
      [{ name: 'met', harvest: null, records: {}, validation: {}, unmapped: {}, matches: [] }],
      { name: 'Vincent van Gogh', qid: 'Q5582', externalIds: {} },
      '2026-11-19T00:00:00Z',
    );
    for (const h of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.']) expect(md).toContain(h);
    expect(md).not.toContain(END_MARKER); // the CLI adds the marker and the hand-written part
  });
});
