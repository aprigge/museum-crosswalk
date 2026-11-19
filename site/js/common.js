// Shared by every page: loading the index and the graph, and small display helpers.
import MiniSearch from '../vendor/minisearch/index.js';
import initOxigraph, * as oxigraph from '../vendor/oxigraph/web.js';
import { processTerm, tokenize, SEARCH_FIELDS, STORE_FIELDS, MUSEUM_NAMES } from './terms.js';

export { MUSEUM_NAMES };

const asset = (path) => new URL(`../${path}`, import.meta.url);

/** HTML-escape text for insertion with innerHTML. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** A URL from source data, only if it is http(s): never a javascript: or data: link. */
export function safeHref(url) {
  try {
    const u = new URL(url, location.href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

let indexPromise;
/** The MiniSearch index, built ahead of time from the graph by `npm run index`. */
export function loadIndex() {
  indexPromise ??= fetch(asset('data/search-index.json'))
    .then((r) => {
      if (!r.ok) throw new Error(`Search index: HTTP ${r.status}`);
      return r.text();
    })
    .then((json) => MiniSearch.loadJSON(json, { fields: SEARCH_FIELDS, storeFields: STORE_FIELDS, processTerm, tokenize }));
  return indexPromise;
}

let graphPromise;
/** The core knowledge graph, loaded into Oxigraph running in the browser (WebAssembly). */
export function loadGraph() {
  graphPromise ??= (async () => {
    await initOxigraph({ module_or_path: asset('vendor/oxigraph/web_bg.wasm') });
    const res = await fetch(asset('data/graph-core.nq.gz'));
    if (!res.ok) throw new Error(`Graph: HTTP ${res.status}`);
    const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
    const store = new oxigraph.Store();
    store.load(text, { format: 'application/n-quads' });
    return store;
  })();
  return graphPromise;
}

export const PREFIXES = `PREFIX mc: <https://aprigge.github.io/museum-crosswalk/ns#>
PREFIX dcterms: <http://purl.org/dc/terms/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX schema: <https://schema.org/>
PREFIX prov: <http://www.w3.org/ns/prov#>
PREFIX id: <https://aprigge.github.io/museum-crosswalk/id/>
`;

/** Run a SELECT and return plain objects of strings. */
export async function select(sparql) {
  const store = await loadGraph();
  const rows = store.query(sparql, { use_default_graph_as_union: true });
  return rows.map((row) => Object.fromEntries([...row.entries()].map(([k, v]) => [k, v.value])));
}

export const ID_BASE = 'https://aprigge.github.io/museum-crosswalk/id/';

const LICENSES = {
  'https://creativecommons.org/publicdomain/zero/1.0/': 'CC0 1.0',
  'https://creativecommons.org/publicdomain/mark/1.0/': 'Public Domain Mark',
  'https://creativecommons.org/licenses/by/4.0/': 'CC BY 4.0',
};
export const licenseLabel = (l) => LICENSES[l] ?? (l === 'not-open-access' ? 'Not open access' : l || 'Licence not stated');

export function years(begin, end) {
  if (begin == null) return '';
  return end != null && end !== begin ? `${begin}–${end}` : String(begin);
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Show a loading or error message in a live region. */
export function status(el, text) {
  el.textContent = text;
}
