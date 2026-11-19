import { describe, expect, it } from 'vitest';
import oxigraph from 'oxigraph';
import { processTerm, SEARCH_OPTIONS, tokenize } from '../site/js/terms.js';
import { buildDocs, buildIndex } from '../src/search/build.js';
import { conceptKey } from '../src/graph/build.js';
import type { Concept } from '../src/authority/concepts.js';

describe('search terms', () => {
  it('meets singular and plural, and -ist with -ism', () => {
    const pairs = [['Impressionist', 'Impressionism'], ['landscape', 'landscapes'], ['glass', 'glasses'], ['iris', 'irises'], ['box', 'boxes'], ['eye', 'eyes'], ['study', 'studies']];
    for (const [a, b] of pairs) expect(processTerm(a!)).toBe(processTerm(b!));
  });

  it('does not collapse artist into art, and drops stop words', () => {
    expect(processTerm('artist')).not.toBe(processTerm('art'));
    expect(processTerm('the')).toBeNull();
    expect(processTerm('Gérôme')).toBe('gerome');
  });

  it('keeps hyphenated movements whole', () => {
    expect(tokenize('Post-impressionism, oil on canvas')).toEqual(['Post-impressionism', 'oil', 'on', 'canvas']);
    expect(tokenize('women - children')).toEqual(['women', 'children']);
  });

  it('allows one fuzzy edit on long words only', () => {
    expect(SEARCH_OPTIONS.fuzzy('impression')).toBe(1);
    expect(SEARCH_OPTIONS.fuzzy('sea')).toBe(false);
  });
});

describe('concept keys', () => {
  const concepts = new Map<string, Concept>([
    ['http://vocab.getty.edu/aat/300132294', { sourceUri: '', qid: 'Q1286517', label: 'natural landscape', aliases: [], match: 'exact', via: '' }],
    ['http://www.wikidata.org/entity/Q191163', { sourceUri: '', qid: 'Q191163', label: 'landscape painting', aliases: [], match: 'exact', via: '' }],
  ]);

  it("prefers the source's own Wikidata link over our AAT lookup", () => {
    const ref = { uri: 'http://vocab.getty.edu/aat/300132294', label: 'Landscapes', equivalents: ['http://www.wikidata.org/entity/Q191163'] };
    expect(conceptKey(ref, concepts).key).toBe('Q191163');
  });

  it('falls back to a readable key for unresolved AIC terms', () => {
    expect(conceptKey({ uri: 'https://api.artic.edu/api/v1/category-terms/TM-12764', equivalents: [] }, concepts).key).toBe('aic-TM-12764');
  });
});

describe('search documents from the graph', () => {
  const mc = 'https://aprigge.github.io/museum-crosswalk/ns#';
  const id = 'https://aprigge.github.io/museum-crosswalk/id/';
  const g = '<https://aprigge.github.io/museum-crosswalk/graph/crosswalk>';
  const nq = [
    `<${id}work/aic-1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${mc}Work> ${g} .`,
    `<${id}work/aic-1> <${mc}museum> "aic" ${g} .`,
    `<${id}work/aic-1> <http://purl.org/dc/terms/title> "Haystacks" ${g} .`,
    `<${id}work/aic-1> <${mc}artist> <${id}person/Q296> ${g} .`,
    `<${id}person/Q296> <http://www.w3.org/2000/01/rdf-schema#label> "Claude Monet" ${g} .`,
    `<${id}work/aic-1> <${mc}subject> <${id}concept/Q191163> ${g} .`,
    `<${id}concept/Q191163> <http://www.w3.org/2004/02/skos/core#prefLabel> "landscape painting"@en ${g} .`,
    `<${id}concept/Q191163> <http://www.w3.org/2004/02/skos/core#closeMatch> <${id}concept/Q107425> ${g} .`,
    `<${id}concept/Q107425> <http://www.w3.org/2004/02/skos/core#prefLabel> "landscape"@en ${g} .`,
    `<${id}work/aic-1> <${mc}inferredStyle> <${id}concept/Q40415> <https://aprigge.github.io/museum-crosswalk/graph/derived> .`,
    `<${id}concept/Q40415> <http://www.w3.org/2004/02/skos/core#prefLabel> "Impressionism"@en ${g} .`,
  ].join('\n');

  it('builds one document per work with labels from aligned concepts', () => {
    const store = new oxigraph.Store();
    store.load(nq, { format: 'application/n-quads' });
    const [doc] = buildDocs(store);
    expect(doc).toMatchObject({
      id: 'aic-1',
      title: 'Haystacks',
      artists: ['Claude Monet'],
      artistKeys: ['Q296'],
      inferredStyles: ['Impressionism'],
      record: 'data/linked-art/aic/1.json',
    });
    expect(doc!.subjects.sort()).toEqual(['landscape', 'landscape painting']);
  });

  it('finds the work for "Impressionist landscapes" through the inferred style', () => {
    const store = new oxigraph.Store();
    store.load(nq, { format: 'application/n-quads' });
    const hits = buildIndex(buildDocs(store)).search('Impressionist landscapes', SEARCH_OPTIONS);
    expect(hits.map((h) => h.id)).toEqual(['aic-1']);
    expect(hits[0]!.match).toMatchObject({ impression: ['inferredStyles'], landscape: ['subjects'] });
  });
});
