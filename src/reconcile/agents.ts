import { createHash } from 'node:crypto';
import type { SourceClient } from '../core/http.js';
import type { ArtistMatch, ArtistQuery, SourceArtistRef } from '../core/types.js';
import { qidFromUri, sparqlUrl } from '../authority/wikidata.js';
import { isQualifiedMatch, matchRef } from './match.js';

/** Wikidata properties used to find people by a museum's or authority's own ID. */
export const ID_PROPERTIES = {
  P245: 'Union List of Artist Names ID',
  P650: 'RKDartists ID',
  P6295: 'ARTIC artist ID',
  P10882: 'Met Constituent ID',
} as const;
type Pid = keyof typeof ID_PROPERTIES;

const BATCH = 150;

interface SparqlResults {
  results: { bindings: Record<string, { value: string } | undefined>[] };
}

/** The IDs a source ref gives that Wikidata can be searched by. */
export function refIds(ref: SourceArtistRef): [Pid, string][] {
  const ids: [Pid, string][] = [];
  if (ref.ulan) ids.push(['P245', ref.ulan]);
  if (ref.otherIds?.rkd) ids.push(['P650', ref.otherIds.rkd]);
  const local = ref.sourceAgentId?.split('/').at(-1);
  if (local && ref.source === 'aic') ids.push(['P6295', local]);
  if (local && ref.source === 'met') ids.push(['P10882', local]);
  return ids;
}

export function lookupByIdQuery(pid: Pid, values: string[]): string {
  return `SELECT ?item ?value WHERE { VALUES ?value { ${values.map((v) => JSON.stringify(v)).join(' ')} } ?item wdt:${pid} ?value . }`;
}

/** Label, life dates, movements and the ID properties above, for a set of people. */
export function factsQuery(qids: string[]): string {
  return `SELECT ?item ?itemLabel ?birth ?death ?movement ?movementLabel ?prop ?value ?factProp ?fact ?factLabel WHERE {
  VALUES ?item { ${qids.map((q) => `wd:${q}`).join(' ')} }
  { OPTIONAL { ?item wdt:P569 ?birth } OPTIONAL { ?item wdt:P570 ?death } }
  UNION { ?item wdt:P135 ?movement }
  UNION { VALUES ?factProp { wdt:P19 wdt:P27 wdt:P21 } ?item ?factProp ?fact }
  UNION { VALUES ?prop { ${Object.keys(ID_PROPERTIES).map((p) => `wdt:${p}`).join(' ')} } ?item ?prop ?value }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

export interface PersonFacts extends ArtistQuery {
  movements: { qid: string; label: string }[];
  /** As Wikidata states them: P19 place of birth, P27 country of citizenship, P21 sex or gender. */
  birthPlaces?: { qid: string; label: string }[];
  citizenships?: { qid: string; label: string }[];
  genders?: { qid: string; label: string }[];
}

/** Wikidata property -> the PersonFacts list it fills. */
const FACT_FIELDS = { P19: 'birthPlaces', P27: 'citizenships', P21: 'genders' } as const;

export function parseFacts(res: SparqlResults): Map<string, PersonFacts> {
  const out = new Map<string, PersonFacts>();
  for (const b of res.results.bindings) {
    if (!b.item) continue;
    const qid = qidFromUri(b.item.value);
    const p = out.get(qid) ?? { qid, name: b.itemLabel?.value ?? qid, externalIds: {}, movements: [] };
    p.birth ??= b.birth?.value;
    p.death ??= b.death?.value;
    if (b.movement && !p.movements.some((m) => m.qid === qidFromUri(b.movement!.value))) {
      p.movements.push({ qid: qidFromUri(b.movement.value), label: b.movementLabel?.value ?? '' });
    }
    if (b.factProp && b.fact) {
      const field = FACT_FIELDS[b.factProp.value.split('/').at(-1) as keyof typeof FACT_FIELDS];
      const list = (p[field] ??= []);
      const fq = qidFromUri(b.fact.value);
      // Skip values Wikidata can't label in English (they come back as the bare QID).
      if (field && b.factLabel && b.factLabel.value !== fq && !list.some((x) => x.qid === fq)) list.push({ qid: fq, label: b.factLabel.value });
    }
    if (b.prop && b.value) {
      const pid = b.prop.value.split('/').at(-1) as Pid;
      const entry = (p.externalIds[pid] ??= { label: ID_PROPERTIES[pid] ?? pid, values: [] });
      if (!entry.values.includes(b.value.value)) entry.values.push(b.value.value);
    }
    out.set(qid, p);
  }
  return out;
}

async function cachedSparql(client: SourceClient, kind: string, query: string): Promise<SparqlResults> {
  const key = createHash('sha1').update(query).digest('hex').slice(0, 16);
  return (await client.getJson(kind, key, sparqlUrl(query))).body as SparqlResults;
}

/** kept-separate: a person decided the record is not the candidate; it leaves the review queue unmerged. */
export type AgentDecision = 'merged' | 'review' | 'unmatched' | 'kept-separate';

export interface AgentResolution {
  ref: SourceArtistRef;
  best: ArtistMatch | null;
  decision: AgentDecision;
  /** Graph key: the QID when merged, else the source's own agent. */
  personKey: string;
  reason?: string;
}

/**
 * The match policy for the graph: an exact Wikidata link, a crosswalk on two or more
 * independent IDs, or one ID whose life years also agree, merges. Anything weaker,
 * qualified or conflicting goes to review.
 */
export function decide(ref: SourceArtistRef, candidates: ArtistMatch[]): AgentResolution {
  const localKey = `${ref.source}-${(ref.sourceAgentId ?? ref.name ?? 'unknown').split('/').at(-1)}`;
  const ranked = candidates.filter((m) => m.qid).sort((a, b) => b.confidence - a.confidence);
  const best = ranked[0] ?? null;
  if (!best) return { ref, best: null, decision: 'unmatched', personKey: localKey, reason: 'No Wikidata person found by ID' };
  const rivals = ranked.filter((m) => m.qid !== best.qid && m.confidence >= best.confidence);
  if (rivals.length) {
    return { ref, best, decision: 'review', personKey: localKey, reason: `IDs point to different people: ${[best, ...rivals].map((m) => m.qid).join(', ')}` };
  }
  // Merge on an exact link, two agreeing IDs (0.9), or one ID plus agreeing life years (0.85).
  const strong = best.method === 'exact-id' || (best.method === 'wikidata-crosswalk' && best.confidence >= 0.85);
  if (!strong) {
    return { ref, best, decision: 'review', personKey: localKey, reason: `${best.method} on one ID, life years missing or different` };
  }
  if (isQualifiedMatch(best)) return { ref, best, decision: 'review', personKey: localKey, reason: `Qualified role: ${ref.role ?? ref.name}` };
  return { ref, best, decision: 'merged', personKey: best.qid! };
}

/**
 * Resolve every artist ref against Wikidata in a few batched queries:
 * find candidate people by any ID the refs carry, fetch those candidates' facts and IDs,
 * then score each ref against each candidate with the phase-1 matcher.
 */
/** A person's decision on one museum artist, keyed like reviewKey (source + agent ID). */
export interface PersonDecision {
  decision: 'merge' | 'keep-separate';
  qid: string;
  ai: { decision: string; confidence: number } | null;
}

/**
 * Apply a person's decision to a ref the matcher left in review. Only refs still in review
 * are touched: a decision never overrides an exact ID or a qualified role.
 */
export function applyDecision(res: AgentResolution, d: PersonDecision | undefined): AgentResolution {
  if (!d || res.decision !== 'review' || /Qualified role/.test(res.reason ?? '')) return res;
  const via = d.ai ? `AI proposed "${d.ai.decision}" (${d.ai.confidence}); a person approved` : 'decided by a person';
  if (d.decision === 'keep-separate') return { ...res, decision: 'kept-separate', reason: `Kept separate: ${via}` };
  return {
    ...res,
    decision: 'merged',
    personKey: d.qid,
    best: { ref: res.ref, qid: d.qid, method: 'human-approved', confidence: 1, evidence: `${res.best?.evidence ?? ''}; ${via}`.replace(/^; /, '') },
    reason: undefined,
  };
}

export async function resolveAgents(
  client: SourceClient,
  refs: SourceArtistRef[],
): Promise<{ resolutions: AgentResolution[]; people: Map<string, PersonFacts> }> {
  const byPid = new Map<Pid, Set<string>>();
  for (const ref of refs) for (const [pid, v] of refIds(ref)) (byPid.get(pid) ?? byPid.set(pid, new Set()).get(pid)!).add(v);

  const found = new Map<string, Set<string>>(); // `${pid}:${value}` -> QIDs
  for (const [pid, values] of byPid) {
    const all = [...values].sort();
    for (let i = 0; i < all.length; i += BATCH) {
      const res = await cachedSparql(client, 'agent-lookups', lookupByIdQuery(pid, all.slice(i, i + BATCH)));
      for (const b of res.results.bindings) {
        if (!b.item || !b.value) continue;
        const k = `${pid}:${b.value.value}`;
        (found.get(k) ?? found.set(k, new Set()).get(k)!).add(qidFromUri(b.item.value));
      }
    }
  }

  const qids = new Set<string>();
  for (const ref of refs) if (ref.wikidata) qids.add(ref.wikidata);
  for (const set of found.values()) for (const q of set) qids.add(q);
  const people = new Map<string, PersonFacts>();
  const allQids = [...qids].sort();
  for (let i = 0; i < allQids.length; i += BATCH) {
    for (const [q, f] of parseFacts(await cachedSparql(client, 'agent-facts', factsQuery(allQids.slice(i, i + BATCH))))) people.set(q, f);
  }

  const resolutions = refs.map((ref) => {
    const candidateQids = new Set<string>(ref.wikidata ? [ref.wikidata] : []);
    for (const [pid, v] of refIds(ref)) for (const q of found.get(`${pid}:${v}`) ?? []) candidateQids.add(q);
    const matches = [...candidateQids].flatMap((q) => {
      const facts = people.get(q);
      return facts ? [matchRef(ref, facts)] : [];
    });
    return decide(ref, matches);
  });
  return { resolutions, people };
}
