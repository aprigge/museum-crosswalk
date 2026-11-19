import MiniSearch from 'minisearch';
import type oxigraph from 'oxigraph';
import { MUSEUM_NAMES, processTerm, SEARCH_FIELDS, STORE_FIELDS, tokenize } from '../../site/js/terms.js';

type Store = InstanceType<typeof oxigraph.Store>;
type Row = Map<string, { value: string }>;

export interface SearchDoc {
  id: string; // work key, e.g. aic-28560
  title: string;
  museum: string;
  museumName: string;
  artists: string[];
  artistKeys: string[];
  qualified: string[]; // "after", "imitator of" … names, shown but not grouped as the artist
  begin?: number;
  end?: number;
  styles: string[];
  inferredStyles: string[];
  subjects: string[];
  thumb?: string;
  url?: string;
  license?: string;
  record: string; // the work's Linked Art JSON, relative to the site root
}

const PREFIXES = `
PREFIX mc: <https://aprigge.github.io/museum-crosswalk/ns#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <https://schema.org/>
`;

/** The SPARQL that builds search documents: the index is derived from the graph, not from source files. */
export const QUERIES = {
  works: `${PREFIXES}
SELECT ?work ?museum ?title ?begin ?end ?thumb ?url ?license ?licenseNote WHERE {
  ?work a mc:Work ; mc:museum ?museum .
  OPTIONAL { ?work dcterms:title ?title }
  OPTIONAL { ?work mc:beginYear ?begin }
  OPTIONAL { ?work mc:endYear ?end }
  OPTIONAL { ?work schema:thumbnailUrl ?thumb }
  OPTIONAL { ?work schema:url ?url }
  OPTIONAL { ?work dcterms:license ?license }
  OPTIONAL { ?work mc:licenseNote ?licenseNote }
}`,
  artists: `${PREFIXES}
SELECT ?work ?person ?name ?qualified WHERE {
  { ?work mc:artist ?person . BIND(false AS ?qualified) }
  UNION { ?work mc:qualifiedArtist ?person . BIND(true AS ?qualified) }
  ?person rdfs:label ?name .
}`,
  styles: `${PREFIXES}
SELECT ?work ?label WHERE { ?work mc:style ?c . { ?c skos:prefLabel ?label } UNION { ?c skos:altLabel ?label } }`,
  inferredStyles: `${PREFIXES}
SELECT ?work ?label WHERE { ?work mc:inferredStyle ?c . ?c skos:prefLabel ?label }`,
  // Subject labels, their aliases, and the labels of concepts aligned to them (skos:closeMatch).
  subjects: `${PREFIXES}
SELECT ?work ?label WHERE {
  ?work mc:subject ?c .
  { ?c skos:prefLabel ?label } UNION { ?c skos:altLabel ?label } UNION { ?c skos:closeMatch/skos:prefLabel ?label }
}`,
};

const key = (uri: string) => uri.split('/').at(-1)!;

export function buildDocs(store: Store): SearchDoc[] {
  const q = (sparql: string) => store.query(sparql, { use_default_graph_as_union: true }) as Row[];
  const docs = new Map<string, SearchDoc>();
  for (const r of q(QUERIES.works)) {
    const id = key(r.get('work')!.value);
    const museum = r.get('museum')!.value;
    const [source, local] = [museum, id.slice(museum.length + 1)];
    docs.set(id, {
      id,
      title: r.get('title')?.value ?? '(untitled)',
      museum,
      museumName: MUSEUM_NAMES[museum as keyof typeof MUSEUM_NAMES] ?? museum,
      artists: [],
      artistKeys: [],
      qualified: [],
      begin: r.get('begin') ? Number(r.get('begin')!.value) : undefined,
      end: r.get('end') ? Number(r.get('end')!.value) : undefined,
      styles: [],
      inferredStyles: [],
      subjects: [],
      thumb: r.get('thumb')?.value,
      url: r.get('url')?.value,
      license: r.get('license')?.value ?? r.get('licenseNote')?.value,
      record: `data/linked-art/${source}/${local}.json`,
    });
  }
  const push = (list: string[], v: string) => !list.includes(v) && list.push(v);
  for (const r of q(QUERIES.artists)) {
    const d = docs.get(key(r.get('work')!.value));
    if (!d) continue;
    if (r.get('qualified')!.value === 'true') push(d.qualified, r.get('name')!.value);
    else {
      push(d.artists, r.get('name')!.value);
      push(d.artistKeys, key(r.get('person')!.value));
    }
  }
  for (const field of ['styles', 'inferredStyles', 'subjects'] as const) {
    for (const r of q(QUERIES[field])) {
      const d = docs.get(key(r.get('work')!.value));
      if (d) push(d[field], r.get('label')!.value);
    }
  }
  return [...docs.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export const MINISEARCH_OPTIONS = {
  fields: SEARCH_FIELDS,
  storeFields: STORE_FIELDS,
  processTerm,
  tokenize,
  // Arrays (artists, subjects…) are indexed as one space-joined text but stored as arrays.
  stringifyField: (v: unknown) => (Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v)),
};

export { SEARCH_OPTIONS } from '../../site/js/terms.js';

export function buildIndex(docs: SearchDoc[]) {
  const index = new MiniSearch<SearchDoc>(MINISEARCH_OPTIONS as never);
  index.addAll(docs);
  return index;
}
