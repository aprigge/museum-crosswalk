import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { END_MARKER } from '../report/render.js';
import {
  AI_FIELDS,
  loadIndex,
  meanWithCi,
  poolFor,
  runQuery,
  scoreQuery,
  type EvalQuery,
  type Labels,
  type QueryScore,
  type Variant,
} from '../eval/search.js';
import { SEARCH_FIELDS } from '../../site/js/terms.js';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, costUsd, loadPrompt, MODELS, readRecord, runBatch, toRecord, writeRecord, type AiRecord } from '../ai/client.js';
import { getImage, type CachedImage } from '../ai/images.js';
import { judgeKey, judgeRequest, JudgmentSchema, type Judgment, type JudgeItem } from '../ai/judge.js';
import { main } from './common.js';

// npm run eval -- pool  --variant baseline   add a variant's results to eval/pool.json for labelling
// npm run eval -- judge [--dry-run | --sample N]   label the unlabelled pool with the Claude judge
// npm run eval -- score --variant baseline   score a variant against eval/labels.json

const VARIANTS: Record<string, Variant> = {
  baseline: { name: 'baseline', fields: SEARCH_FIELDS.filter((f) => !AI_FIELDS.includes(f)) },
  'with-ai': { name: 'with-ai' },
};

interface PoolItem {
  id: string;
  title: string;
  artists: string[];
  museum: string;
  museumName: string;
  begin?: number;
  thumb?: string;
  url?: string;
  /** Variants whose pool included this painting, and how it matched there. */
  seenIn: Record<string, string>;
}
type Pool = Record<string, { query: string; relevant: string; items: PoolItem[] }>;

const readOr = async <T>(path: string, fallback: T): Promise<T> =>
  readFile(path, 'utf8').then((t) => JSON.parse(t) as T, () => fallback);

/**
 * Label every unlabelled pool item with the Claude judge. Images are fetched once and cached;
 * each judgment is stored with its model, prompt version and usage, and turned into a yes/no
 * label only when it validated.
 */
async function judgePool(index: ReturnType<typeof loadIndex>, labels: Labels, opts: { dryRun: boolean; sample?: number }) {
  const pool = await readOr<Pool>('eval/pool.json', {});
  const prompt = await loadPrompt('judge');
  const todo: JudgeItem[] = [];
  for (const [qid, entry] of Object.entries(pool)) {
    for (const i of entry.items) {
      if (i.id in (labels[qid] ?? {})) continue;
      const stored = index.getStoredFields(i.id) as { styles?: string[]; inferredStyles?: string[] } | undefined;
      todo.push({
        queryId: qid, query: entry.query, rule: entry.relevant, workId: i.id, title: i.title, artists: i.artists,
        begin: i.begin, museumName: i.museumName, styles: [...new Set([...(stored?.styles ?? []), ...(stored?.inferredStyles ?? [])])],
      });
    }
  }
  const pending: JudgeItem[] = [];
  for (const item of todo) if (!(await readRecord<Judgment>('judge', judgeKey(item), prompt.version))?.output) pending.push(item);
  // Rough estimate: ~700 input tokens (prompt, data, a 400px image) and ~500 output incl. thinking.
  const estimate = (n: number, batch: boolean) => costUsd(MODELS.judge, { input_tokens: 700 * n, output_tokens: 500 * n } as never, batch);
  console.log(`${todo.length} unlabelled pool items; ${pending.length} not yet judged with prompt ${prompt.version}.`);
  console.log(`Estimated cost: about $${estimate(pending.length, true).toFixed(2)} as a batch, $${estimate(pending.length, false).toFixed(2)} one by one.`);
  if (opts.dryRun || !pending.length) return writeLabelsFromJudgments(pool, labels, prompt.version);

  const items = opts.sample ? pending.slice(0, opts.sample) : pending;
  const images = new Map<string, CachedImage | null>();
  for (const item of items) {
    const thumb = pool[item.queryId]!.items.find((i) => i.id === item.workId)?.thumb;
    images.set(judgeKey(item), thumb ? await getImage(thumb).catch(() => null) : null);
  }
  let spent = 0;
  if (opts.sample) {
    // A small sample runs one call at a time, so its results can be read before any batch.
    for (const item of items) {
      const msg = await anthropic().messages.create(judgeRequest(prompt, item, images.get(judgeKey(item))!) as never) as Anthropic.Message;
      const rec = toRecord('judge', judgeKey(item), prompt, msg, JudgmentSchema);
      await writeRecord(rec, prompt.version);
      spent += costUsd(rec.model, rec.usage, false);
      console.log(`${item.queryId} "${item.query}" · ${item.title} (${item.museumName}): ${rec.output ? `${rec.output.relevant ? 'RELEVANT' : 'not'} (${rec.output.confidence}) ${rec.output.reason}` : rec.error}`);
    }
  } else {
    const results = await runBatch(items.map((item) => ({ custom_id: judgeKey(item), params: judgeRequest(prompt, item, images.get(judgeKey(item))!) })));
    for (const item of items) {
      const r = results.get(judgeKey(item));
      const rec: AiRecord<Judgment> = !r || 'error' in r
        ? { task: 'judge', key: judgeKey(item), model: MODELS.judge, promptVersion: prompt.version, createdAt: new Date().toISOString(), stopReason: null, usage: null, output: null, error: r && 'error' in r ? r.error : 'missing from batch' }
        : toRecord('judge', judgeKey(item), prompt, r, JudgmentSchema);
      await writeRecord(rec, prompt.version);
      spent += costUsd(rec.model, rec.usage, true);
    }
  }
  console.log(`Spent about $${spent.toFixed(3)}.`);
  await writeLabelsFromJudgments(pool, labels, prompt.version);
}

/** labels.json gets a yes/no per validated judgment; judgments.json keeps reasons and confidence. */
async function writeLabelsFromJudgments(pool: Pool, labels: Labels, version: string) {
  const details: Record<string, Record<string, Judgment & { model: string }>> = await readOr('eval/judgments.json', {});
  let failed = 0;
  for (const [qid, entry] of Object.entries(pool)) {
    for (const i of entry.items) {
      if (i.id in (labels[qid] ?? {})) continue;
      const rec = await readRecord<Judgment>('judge', judgeKey({ queryId: qid, workId: i.id }), version);
      if (!rec) continue;
      if (!rec.output) {
        failed++;
        continue;
      }
      (labels[qid] ??= {})[i.id] = rec.output.relevant;
      (details[qid] ??= {})[i.id] = { ...rec.output, model: rec.model };
    }
  }
  await writeFile('eval/labels.json', JSON.stringify(labels, null, 2) + '\n');
  await writeFile('eval/judgments.json', JSON.stringify(details, null, 2) + '\n');
  const total = Object.values(pool).reduce((n, e) => n + e.items.length, 0);
  const done = Object.entries(pool).reduce((n, [qid, e]) => n + e.items.filter((i) => i.id in (labels[qid] ?? {})).length, 0);
  console.log(`eval/labels.json: ${done} of ${total} pool items labelled${failed ? `; ${failed} judgments failed (refusal, cut off or invalid) and stay unlabelled` : ''}.`);
}

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);

main(async () => {
  const [command] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/^\d+$/.test(a) && !(a in VARIANTS));
  const variantName = process.argv[process.argv.indexOf('--variant') + 1];
  const variant = VARIANTS[variantName ?? ''];
  const queries = JSON.parse(await readFile('eval/queries.json', 'utf8')) as EvalQuery[];
  const index = loadIndex(await readFile('site/data/search-index.json', 'utf8'));
  const labels = await readOr<Labels>('eval/labels.json', {});

  if (command === 'judge') {
    const sampleArg = process.argv.indexOf('--sample');
    await judgePool(index, labels, {
      dryRun: process.argv.includes('--dry-run'),
      sample: sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : undefined,
    });
    return;
  }
  if (!['pool', 'score'].includes(command ?? '') || !variant) {
    throw new Error(`Usage: npm run eval -- pool|score --variant ${Object.keys(VARIANTS).join('|')}, or judge [--dry-run | --sample N]`);
  }

  if (command === 'pool') {
    const pool = await readOr<Pool>('eval/pool.json', {});
    let added = 0;
    for (const q of queries) {
      const entry = (pool[q.id] ??= { query: q.query, relevant: q.relevant, items: [] });
      for (const h of poolFor(runQuery(index, q, variant))) {
        let item = entry.items.find((i) => i.id === h.id);
        if (!item) {
          item = { id: h.id, title: h.title, artists: h.artists, museum: h.museum, museumName: h.museumName, begin: h.begin, thumb: h.thumb, url: h.url, seenIn: {} };
          entry.items.push(item);
          added++;
        }
        item.seenIn[variant.name] = Object.entries(h.match).map(([t, f]) => `${t}: ${f.join(', ')}`).join('; ');
      }
    }
    await writeFile('eval/pool.json', JSON.stringify(pool, null, 2) + '\n');
    const unlabelled = Object.entries(pool).reduce((n, [qid, e]) => n + e.items.filter((i) => !(i.id in (labels[qid] ?? {}))).length, 0);
    console.log(`eval/pool.json: ${added} paintings added for ${variant.name}; ${unlabelled} still to label`);
    return;
  }

  // score
  const scores: QueryScore[] = queries.map((q) => scoreQuery(q, runQuery(index, q, variant), labels));
  const dir = join('eval', 'runs', variant.name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'results.jsonl'), scores.map((s) => JSON.stringify(s)).join('\n') + '\n');

  // The report compares every variant that has been scored.
  const runs: Record<string, QueryScore[]> = {};
  for (const name of Object.keys(VARIANTS)) {
    const text = await readFile(join('eval', 'runs', name, 'results.jsonl'), 'utf8').catch(() => '');
    if (text) runs[name] = text.trim().split('\n').map((l) => JSON.parse(l) as QueryScore);
  }
  const names = Object.keys(runs);
  const summary = (name: string) => {
    const s = runs[name]!;
    const p = meanWithCi(s.map((x) => x.precisionAt10));
    const r = meanWithCi(s.map((x) => x.recall));
    const fmt = (m: ReturnType<typeof meanWithCi>) => (m ? `${pct(m.mean)} ± ${Math.round(m.ci * 100)} (n=${m.n})` : '–');
    const unlabelled = s.reduce((n, x) => n + x.unlabelledInTop10, 0);
    return [name, fmt(p), fmt(r), (s.reduce((a, x) => a + x.museumsWithHit, 0) / s.length).toFixed(2),
      s.filter((x) => x.museumsWithHit === 3).length, s.reduce((a, x) => a + x.splitArtists.length, 0),
      s.reduce((a, x) => a + x.aiOnlyResults, 0), unlabelled];
  };
  // Who labelled the pool, and how many paintings were judged without an image to look at.
  const pool = await readOr<Pool>('eval/pool.json', {});
  const judgments = await readOr<Record<string, Record<string, { model: string }>>>('eval/judgments.json', {});
  const judged = Object.values(judgments).reduce((n, q) => n + Object.keys(q).length, 0);
  const models = [...new Set(Object.values(judgments).flatMap((q) => Object.values(q).map((j) => j.model)))];
  const imageless = Object.entries(pool).reduce((n, [qid, e]) => n + e.items.filter((i) => !i.thumb && judgments[qid]?.[i.id]).length, 0);
  const judgeNote = judged
    ? `${judged} pooled paintings were labelled by ${models.join(', ')} (reasons in \`eval/judgments.json\`), not by a person. ` +
      `${imageless} of them have no openly licensed image and were judged from catalogue data alone, so visual rules tend to come out "not relevant" for them.`
    : 'labelled by a person in `eval/label.html`.';
  const table = (head: string[], rows: unknown[][]) =>
    [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

  const md = `# Search eval

Generated ${new Date().toISOString().slice(0, 10)} by \`npm run eval\`. ${queries.length} queries (\`eval/queries.json\`), relevance labelled
over a pool of each variant's top 10 plus top 5 per museum (\`eval/labels.json\`; who labelled it is below the table).

${table(
  ['Variant', 'Precision@10', 'Recall (pooled)', 'Museums with a hit (of 3)', 'Queries with all 3', 'Split artists', 'AI-only results', 'Unlabelled in top 10'],
  names.map(summary),
)}

Precision and recall are means over queries with labels, ± a 95% interval. With 20 queries the interval is wide:
a difference smaller than it is not evidence of a change.

Labels: ${judgeNote}

## Per query

${table(
  ['Query', 'Tags', ...names.flatMap((n) => [`${n} P@10`, `${n} recall`, `${n} museums`])],
  queries.map((q) => [q.query, q.tags.join(', '), ...names.flatMap((n) => {
    const s = runs[n]!.find((x) => x.id === q.id)!;
    return [pct(s.precisionAt10), pct(s.recall), s.museumsWithHit];
  })]),
)}
`;
  const path = 'reports/eval.md';
  const existing = await readFile(path, 'utf8').catch(() => '');
  const kept = existing.includes(END_MARKER) ? existing.slice(existing.indexOf(END_MARKER) + END_MARKER.length) : '\n';
  await writeFile(path, `${md}\n${END_MARKER}${kept}`);
  console.log(`${variant.name}: ${summary(variant.name).slice(1).join(' | ')}`);
});
