import { createHash } from 'node:crypto';
import type { SourceClient } from '../core/http.js';
import { qidFromUri, sparqlUrl } from './wikidata.js';

const BATCH = 150;
const AAT_PREFIX = 'http://vocab.getty.edu/aat/';
const ICONCLASS_PREFIX = 'https://iconclass.org/';

interface SparqlResults {
  results: { bindings: Record<string, { value: string } | undefined>[] };
}

export interface Concept {
  /** The concept URI as the source records use it (AAT, Iconclass or Wikidata). */
  sourceUri: string;
  qid: string;
  label: string;
  aliases: string[];
  /** exact: Wikidata lists this very ID; broad: matched through a shorter Iconclass prefix. */
  match: 'exact' | 'broad';
  via: string; // e.g. "P1014 (AAT) = 300015636"
}

/** Iconclass notation from its URI, with any bracketed key text dropped: 25G3(POLLARD WILLOW) -> 25G3. */
export function iconclassCode(uri: string): string {
  return decodeURIComponent(uri.slice(ICONCLASS_PREFIX.length)).replace(/\(.*$/, '').trim();
}

/**
 * Prefixes of an Iconclass code, longest first, stopping at three characters:
 * 25H213 -> 25H213, 25H21, 25H2, 25H. Shorter codes ("2" Nature) are too broad to help search.
 */
export function iconclassPrefixes(code: string): string[] {
  const out: string[] = [];
  for (let n = code.length; n >= Math.min(3, code.length) && n > 0; n--) out.push(code.slice(0, n));
  return out;
}

export function conceptQuery(pid: 'P1014' | 'P1256', values: string[]): string {
  return `SELECT ?item ?value ?itemLabel ?alias WHERE {
  VALUES ?value { ${values.map((v) => JSON.stringify(v)).join(' ')} }
  ?item wdt:${pid} ?value .
  OPTIONAL { ?item skos:altLabel ?alias FILTER(lang(?alias) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

export function labelsQuery(qids: string[]): string {
  return `SELECT ?item ?itemLabel ?alias WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(' ')} }
  OPTIONAL { ?item skos:altLabel ?alias FILTER(lang(?alias) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

interface Item {
  qid: string;
  label: string;
  aliases: string[];
}

function collect(res: SparqlResults, keyOf: (b: Record<string, { value: string } | undefined>) => string | undefined) {
  const out = new Map<string, Item[]>();
  for (const b of res.results.bindings) {
    const key = keyOf(b);
    if (!b.item || !key) continue;
    const qid = qidFromUri(b.item.value);
    const items = out.get(key) ?? out.set(key, []).get(key)!;
    let item = items.find((i) => i.qid === qid);
    if (!item) items.push((item = { qid, label: b.itemLabel?.value ?? qid, aliases: [] }));
    if (b.alias && !item.aliases.includes(b.alias.value)) item.aliases.push(b.alias.value);
  }
  return out;
}

async function cachedSparql(client: SourceClient, query: string): Promise<SparqlResults> {
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  return (await client.getJson('concepts', key, sparqlUrl(query))).body as SparqlResults;
}

async function batched(client: SourceClient, values: string[], q: (vs: string[]) => string, keyOf: Parameters<typeof collect>[1]) {
  const merged = new Map<string, Item[]>();
  const all = [...new Set(values)].sort();
  for (let i = 0; i < all.length; i += BATCH) {
    for (const [k, v] of collect(await cachedSparql(client, q(all.slice(i, i + BATCH))), keyOf)) merged.set(k, v);
  }
  return merged;
}

/**
 * Resolve source concept URIs to Wikidata items: AAT IDs through P1014, Iconclass codes
 * through P1256 (rolling up to the longest prefix Wikidata knows, as a broad match), and
 * Wikidata URIs directly. Where Wikidata gives several items for one ID, the first by QID
 * order is kept and the others are dropped deterministically.
 */
export async function resolveConcepts(client: SourceClient, uris: string[]): Promise<Map<string, Concept>> {
  const aat = uris.filter((u) => u.startsWith(AAT_PREFIX));
  const iconclass = uris.filter((u) => u.startsWith(ICONCLASS_PREFIX));
  const wikidata = uris.filter((u) => u.includes('wikidata.org/entity/'));

  const byAat = await batched(client, aat.map((u) => u.slice(AAT_PREFIX.length)), (vs) => conceptQuery('P1014', vs), (b) => b.value?.value);
  const codes = iconclass.map(iconclassCode).filter(Boolean);
  const byIconclass = await batched(client, codes.flatMap(iconclassPrefixes), (vs) => conceptQuery('P1256', vs), (b) => b.value?.value);
  const byQid = await batched(client, wikidata.map(qidFromUri), labelsQuery, (b) => (b.item ? qidFromUri(b.item.value) : undefined));

  const pick = (items: Item[] | undefined) => items?.slice().sort((a, b) => Number(a.qid.slice(1)) - Number(b.qid.slice(1)))[0];
  const out = new Map<string, Concept>();
  for (const uri of new Set(aat)) {
    const id = uri.slice(AAT_PREFIX.length);
    const item = pick(byAat.get(id));
    if (item) out.set(uri, { sourceUri: uri, ...item, match: 'exact', via: `P1014 (AAT) = ${id}` });
  }
  for (const uri of new Set(iconclass)) {
    const code = iconclassCode(uri);
    const hit = iconclassPrefixes(code).find((p) => byIconclass.has(p));
    const item = hit ? pick(byIconclass.get(hit)) : undefined;
    if (item && hit) out.set(uri, { sourceUri: uri, ...item, match: hit === code ? 'exact' : 'broad', via: `P1256 (Iconclass) = ${hit}` });
  }
  for (const uri of new Set(wikidata)) {
    const item = pick(byQid.get(qidFromUri(uri)));
    if (item) out.set(uri, { sourceUri: uri, ...item, match: 'exact', via: 'Wikidata item' });
  }
  return out;
}
