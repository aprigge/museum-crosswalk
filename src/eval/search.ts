import MiniSearch from 'minisearch';
import { SEARCH_OPTIONS } from '../../site/js/terms.js';
import { MINISEARCH_OPTIONS, type SearchDoc } from '../search/build.js';

export interface EvalQuery {
  id: string;
  query: string;
  tags: string[];
  relevant: string; // what counts as relevant, shown to the labeller
}

export type Hit = SearchDoc & { score: number; match: Record<string, string[]> };

/** labels[queryId][workId] = relevant? Unlabelled pairs are absent. */
export type Labels = Record<string, Record<string, boolean>>;

export const POOL_TOP = 10;
export const POOL_PER_MUSEUM = 5;
const MUSEUMS = ['rijksmuseum', 'met', 'aic'] as const;

/** Fields that come from AI suggestions; a variant that excludes AI searches without them. */
export const AI_FIELDS = ['aiSubjects'];

export interface Variant {
  name: string;
  /** Search only these fields (default: all indexed fields). */
  fields?: string[];
}

export function loadIndex(json: string) {
  return MiniSearch.loadJSON<SearchDoc>(json, MINISEARCH_OPTIONS as never);
}

/** The search eval covers the paintings slice; other datasets' works are filtered out. */
export const EVAL_DATASET = 'paintings-1850-1900';

export function runQuery(index: ReturnType<typeof loadIndex>, q: EvalQuery, variant: Variant): Hit[] {
  const options = { ...SEARCH_OPTIONS, ...(variant.fields ? { fields: variant.fields } : {}), filter: (r: { datasets?: string[] }) => !r.datasets || r.datasets.includes(EVAL_DATASET) };
  return index.search(q.query, options as never) as unknown as Hit[];
}

/**
 * The paintings a person labels for one query and variant: the top results overall (what a
 * visitor sees first) plus the top few per museum (so every museum's best answers are judged).
 */
export function poolFor(hits: Hit[]): Hit[] {
  const pool = new Map<string, Hit>();
  for (const h of hits.slice(0, POOL_TOP)) pool.set(h.id, h);
  for (const m of MUSEUMS) for (const h of hits.filter((x) => x.museum === m).slice(0, POOL_PER_MUSEUM)) pool.set(h.id, h);
  return [...pool.values()];
}

/** Matched only through AI-suggested fields, nothing the museums or Wikidata said. */
export const onlyViaAi = (h: Hit) =>
  Object.values(h.match).every((fields) => fields.every((f) => AI_FIELDS.includes(f)));

export interface QueryScore {
  id: string;
  query: string;
  tags: string[];
  results: number;
  /** Relevant among the top 10, over the labelled ones among them (null if none labelled). */
  precisionAt10: number | null;
  /** Relevant results found, over all relevant paintings known in the pool across variants. */
  recall: number | null;
  /** Museums with at least one result labelled relevant. */
  museumsWithHit: number;
  /** Artists whose works come up under more than one person key: a grouping split. */
  splitArtists: string[];
  aiOnlyResults: number;
  unlabelledInTop10: number;
}

export function scoreQuery(q: EvalQuery, hits: Hit[], labels: Labels): QueryScore {
  const l = labels[q.id] ?? {};
  const top = hits.slice(0, 10);
  const judged = top.filter((h) => h.id in l);
  const relevantKnown = Object.entries(l).filter(([, r]) => r).map(([id]) => id);
  const found = new Set(hits.map((h) => h.id));
  const relevantHits = hits.filter((h) => l[h.id] === true);

  // A split: the same artist name reached under two different person keys (e.g. one merged
  // with Wikidata, one left unmerged in review), so their works would not group together.
  const keysByName = new Map<string, Set<string>>();
  for (const h of hits) {
    h.artists.forEach((name, i) => {
      const key = h.artistKeys[i] ?? `none:${h.id}`;
      (keysByName.get(name) ?? keysByName.set(name, new Set()).get(name)!).add(key);
    });
  }

  return {
    id: q.id,
    query: q.query,
    tags: q.tags,
    results: hits.length,
    precisionAt10: judged.length ? judged.filter((h) => l[h.id]).length / judged.length : null,
    recall: relevantKnown.length ? relevantKnown.filter((id) => found.has(id)).length / relevantKnown.length : null,
    museumsWithHit: new Set(relevantHits.map((h) => h.museum)).size,
    splitArtists: [...keysByName.entries()].filter(([, keys]) => keys.size > 1).map(([name]) => name),
    aiOnlyResults: hits.filter(onlyViaAi).length,
    unlabelledInTop10: top.length - judged.length,
  };
}

/** Mean of the non-null values, with a 95% interval half-width (normal approximation). */
export function meanWithCi(values: (number | null)[]): { mean: number; ci: number; n: number } | null {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
  return { mean, ci: (1.96 * sd) / Math.sqrt(v.length), n: v.length };
}
