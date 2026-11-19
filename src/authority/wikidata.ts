import { SourceClient } from '../core/http.js';
import type { ArtistQuery } from '../core/types.js';

const SPARQL = 'https://query.wikidata.org/sparql';
export const WIKIDATA_LICENSE = 'https://creativecommons.org/publicdomain/zero/1.0/';

interface SparqlResults {
  results: { bindings: Record<string, { value: string } | undefined>[] };
}

export function sparqlUrl(query: string): string {
  return `${SPARQL}?format=json&query=${encodeURIComponent(query)}`;
}

export function qidFromUri(uri: string): string {
  return uri.replace(/^https?:\/\/www\.wikidata\.org\/(entity|wiki)\//, '');
}

/** Humans with this English label and an occupation labelled `occupation` (e.g. "painter"). */
export function lookupQuery(name: string, occupation = 'painter'): string {
  const literal = JSON.stringify(name);
  return `SELECT ?item ?birth ?death WHERE {
  ?item rdfs:label ${literal}@en ; wdt:P31 wd:Q5 ; wdt:P106 ?occ .
  ?occ rdfs:label ${JSON.stringify(occupation)}@en .
  OPTIONAL { ?item wdt:P569 ?birth }
  OPTIONAL { ?item wdt:P570 ?death }
}`;
}

export function externalIdsQuery(qid: string): string {
  return `SELECT ?prop ?propLabel ?value WHERE {
  wd:${qid} ?claim ?value .
  ?prop wikibase:directClaim ?claim ; wikibase:propertyType wikibase:ExternalId .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

export function parseLookup(res: SparqlResults): { qid: string; birth?: string; death?: string }[] {
  const byQid = new Map<string, { qid: string; birth?: string; death?: string }>();
  for (const b of res.results.bindings) {
    if (!b.item) continue;
    const qid = qidFromUri(b.item.value);
    const entry = byQid.get(qid) ?? { qid };
    entry.birth ??= b.birth?.value;
    entry.death ??= b.death?.value;
    byQid.set(qid, entry);
  }
  return [...byQid.values()];
}

export function parseExternalIds(res: SparqlResults): ArtistQuery['externalIds'] {
  const out: ArtistQuery['externalIds'] = {};
  for (const b of res.results.bindings) {
    if (!b.prop || !b.value) continue;
    const pid = qidFromUri(b.prop.value);
    const entry = (out[pid] ??= { label: b.propLabel?.value ?? pid, values: [] });
    if (!entry.values.includes(b.value.value)) entry.values.push(b.value.value);
  }
  return out;
}

export function newWikidataClient(refresh = false): SourceClient {
  return new SourceClient({
    source: 'wikidata',
    minIntervalMs: 1000,
    headers: { Accept: 'application/sparql-results+json' },
    refresh,
  });
}

/**
 * Resolve an artist name to exactly one Wikidata human, plus the external IDs
 * Wikidata lists for them. Refuses to guess when the name is ambiguous.
 */
export async function resolveArtist(client: SourceClient, name: string, qid?: string): Promise<ArtistQuery> {
  const found = parseLookup(
    (await client.getJson('authority', `lookup-painter-${name}`, sparqlUrl(lookupQuery(name)))).body as SparqlResults,
  );
  const candidates = qid ? found.filter((c) => c.qid === qid) : found;
  if (candidates.length !== 1) {
    const list = found.map((c) => `${c.qid} (${c.birth ?? '?'}–${c.death ?? '?'})`).join(', ') || 'none';
    throw new Error(`Expected one Wikidata human labelled "${name}", found: ${list}. Pass --qid to choose.`);
  }
  const hit = candidates[0]!;
  const ids = (await client.getJson('authority', `external-ids-${hit.qid}`, sparqlUrl(externalIdsQuery(hit.qid))))
    .body as SparqlResults;
  return { name, qid: hit.qid, birth: hit.birth, death: hit.death, externalIds: parseExternalIds(ids) };
}
