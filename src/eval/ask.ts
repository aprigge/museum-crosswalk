import oxigraph from 'oxigraph';

type Store = InstanceType<typeof oxigraph.Store>;

export interface AskCase {
  id: string;
  question: string;
  tags: string[];
  /** How results are compared: a single number, the set of works, or the set of rows. */
  compare: 'value' | 'works' | 'rows';
  reference: string;
}

export { ASK_PREFIXES, isReadQuery, withPrefixes } from '../ai/ask.js';
import { withPrefixes } from '../ai/ask.js';

export type Result =
  | { kind: 'value'; value: number | null }
  | { kind: 'set'; items: string[] }
  /** rows keeps each row's cells, so extra columns in an answer can be allowed. */
  | { kind: 'rows'; items: string[]; cells: string[][] };

/**
 * Run a query and reduce its answer to what the case compares: a number (the first numeric
 * cell), the works it names (any cell holding a work URI), or its rows (cells joined, sorted).
 * Column names are ignored, so a correct query is not marked wrong for naming a variable differently.
 */
export function runForCompare(store: Store, query: string, compare: AskCase['compare']): Result {
  const rows = store.query(withPrefixes(query), { use_default_graph_as_union: true }) as Map<string, { value: string }>[];
  if (!Array.isArray(rows)) throw new Error('Expected a SELECT query');
  const cells = (r: Map<string, { value: string }>) => [...r.values()].map((t) => t.value);
  if (compare === 'value') {
    const first = rows.flatMap(cells).find((v) => /^-?\d+(\.\d+)?$/.test(v));
    return { kind: 'value', value: first === undefined ? null : Number(first) };
  }
  if (compare === 'works') {
    return { kind: 'set', items: [...new Set(rows.flatMap(cells).filter((v) => v.includes('/id/work/')))].sort() };
  }
  // rows: compare on the readable cells (labels, numbers), not on blank-node or URI noise.
  const readable = rows.map((r) => cells(r).filter((v) => !/^https?:/.test(v)).sort()).filter((c) => c.length);
  const unique = [...new Map(readable.map((c) => [c.join(' | '), c])).values()];
  return { kind: 'rows', items: unique.map((c) => c.join(' | ')).sort(), cells: unique };
}

/**
 * Exact match for numbers; for sets, both match and overlap (Jaccard), so near-misses are
 * visible. For rows, an answer may carry extra columns (a count beside each artist): an
 * expected row is found when all its values appear in one answer row.
 */
export function compareResults(expected: Result, actual: Result): { exact: boolean; overlap: number } {
  if (expected.kind === 'value' || actual.kind === 'value') {
    const ok = expected.kind === 'value' && actual.kind === 'value' && expected.value === actual.value;
    return { exact: ok, overlap: ok ? 1 : 0 };
  }
  if (expected.kind === 'rows' && actual.kind === 'rows') {
    const used = new Set<number>();
    let found = 0;
    for (const want of expected.cells) {
      const i = actual.cells.findIndex((got, j) => !used.has(j) && want.every((v) => got.includes(v)));
      if (i >= 0) {
        used.add(i);
        found++;
      }
    }
    const union = expected.cells.length + actual.cells.length - found;
    return { exact: found === expected.cells.length && found === actual.cells.length, overlap: union ? found / union : 1 };
  }
  const a = new Set(expected.items);
  const b = new Set(actual.items);
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return { exact: inter === a.size && inter === b.size, overlap: union ? inter / union : 1 };
}
