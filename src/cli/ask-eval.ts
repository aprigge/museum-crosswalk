import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import oxigraph from 'oxigraph';
import { dataDir, siteGraphDir } from '../core/cache.js';
import { anthropic, costUsd, MODELS, readRecord, toRecord, writeRecord, type AiRecord, type Prompt } from '../ai/client.js';
import { askRequest, AskSchema, askSystem, type AskAnswer } from '../ai/ask.js';
import { compareResults, isReadQuery, runForCompare, scopeToDataset, type AskCase } from '../eval/ask.js';
import { END_MARKER } from '../report/render.js';
import { main } from './common.js';

// npm run ask-eval -- --dry-run   estimate the cost
// npm run ask-eval                ask Claude each question, run its SPARQL, compare with the reference
// npm run ask-eval -- --dataset rembrandt   the Rembrandt questions instead of the 1850–1900 paintings ones
//
// Each collection has its own questions and report, and runs on the graph scoped to that collection,
// so the paintings questions keep meaning what they meant when they were reviewed.
const EVALS = {
  'paintings-1850-1900': { cases: 'eval/ask.json', runs: 'eval/runs/ask', report: 'reports/ask-eval.md', label: 'the 1850–1900 paintings' },
  rembrandt: { cases: 'eval/ask-rembrandt.json', runs: 'eval/runs/ask-rembrandt', report: 'reports/ask-eval-rembrandt.md', label: 'Rembrandt' },
} as const;

interface CaseResult {
  id: string;
  question: string;
  tags: string[];
  compare: AskCase['compare'];
  sparql: string;
  explanation: string;
  status: 'exact' | 'partial' | 'wrong' | 'invalid' | 'declined' | 'refused' | 'rejected';
  overlap: number;
  attempts: number;
  error?: string;
  model: string;
  costUsd: number;
}

/** One live call, the way the Worker makes it: refusals fall back server-side. */
async function ask(system: string, question: string, retry?: { sparql: string; error: string }): Promise<Anthropic.Message> {
  const params = askRequest(system, question, retry);
  return (await anthropic().beta.messages.create({
    ...params,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  } as never)) as unknown as Anthropic.Message;
}

main(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const di = process.argv.indexOf('--dataset');
  const dataset = (di > 0 ? process.argv[di + 1] : 'paintings-1850-1900') as keyof typeof EVALS;
  const ev = EVALS[dataset];
  if (!ev) throw new Error(`No Ask eval for "${dataset}". Known: ${Object.keys(EVALS).join(', ')}`);
  const cases = JSON.parse(await readFile(ev.cases, 'utf8')) as AskCase[];
  const system = askSystem(await readFile('prompts/ask.md', 'utf8'), await readFile('prompts/graph-schema.md', 'utf8'));
  const prompt: Prompt = { name: 'ask', text: system, version: createHash('sha1').update(system).digest('hex').slice(0, 10) };
  const per = costUsd(MODELS.main, { input_tokens: 300, output_tokens: 1500, cache_read_input_tokens: 3000 } as never, false);
  console.log(`${cases.length} questions, prompt ${prompt.version}. Estimated cost: about $${(per * cases.length * 1.2).toFixed(2)} (incl. some retries).`);
  if (dryRun) return;

  const store = new oxigraph.Store();
  store.load(await readFile(join(siteGraphDir(), 'core.nq'), 'utf8'), { format: 'application/n-quads' });
  scopeToDataset(store, dataset);

  const results: CaseResult[] = [];
  for (const c of cases) {
    const expected = runForCompare(store, c.reference, c.compare);
    let attempts = 0;
    let cost = 0;
    let answer: AskAnswer | null = null;
    let rec: AiRecord<AskAnswer> | null = await readRecord<AskAnswer>('ask', c.id, prompt.version);
    let retry: { sparql: string; error: string } | undefined;
    let outcome: Pick<CaseResult, 'status' | 'overlap' | 'error'> = { status: 'invalid', overlap: 0 };

    // At most two attempts: the second sees the first one's error, as the site's retry does.
    for (let i = 0; i < 2; i++) {
      if (!rec || i > 0) {
        const msg = await ask(system, c.question, retry);
        rec = toRecord('ask', i ? `${c.id}-retry` : c.id, prompt, msg, AskSchema);
        await writeRecord(rec, prompt.version);
      }
      attempts++;
      cost += costUsd(rec.model, rec.usage, false);
      if (!rec.output) {
        outcome = { status: rec.error === 'refusal' ? 'refused' : 'invalid', overlap: 0, error: rec.error };
        break;
      }
      answer = rec.output;
      if (!answer.sparql.trim()) {
        outcome = { status: 'declined', overlap: 0, error: answer.explanation };
        break;
      }
      if (!isReadQuery(answer.sparql)) {
        outcome = { status: 'rejected', overlap: 0, error: 'not a read-only query' };
        break;
      }
      try {
        const actual = runForCompare(store, answer.sparql, c.compare);
        const cmp = compareResults(expected, actual);
        outcome = { status: cmp.exact ? 'exact' : cmp.overlap > 0 ? 'partial' : 'wrong', overlap: cmp.overlap };
        break;
      } catch (err) {
        outcome = { status: 'invalid', overlap: 0, error: (err as Error).message.slice(0, 300) };
        retry = { sparql: answer.sparql, error: (err as Error).message };
        rec = (i === 0 ? await readRecord<AskAnswer>('ask', `${c.id}-retry`, prompt.version) : null) ?? null;
        if (rec) {
          // A cached retry from an earlier run: use it instead of calling again.
          i++;
          attempts++;
          cost += costUsd(rec.model, rec.usage, false);
          if (rec.output && rec.output.sparql.trim() && isReadQuery(rec.output.sparql)) {
            answer = rec.output;
            try {
              const cmp = compareResults(expected, runForCompare(store, answer.sparql, c.compare));
              outcome = { status: cmp.exact ? 'exact' : cmp.overlap > 0 ? 'partial' : 'wrong', overlap: cmp.overlap };
            } catch (e2) {
              outcome = { status: 'invalid', overlap: 0, error: (e2 as Error).message.slice(0, 300) };
            }
          }
          break;
        }
      }
    }
    const r: CaseResult = {
      id: c.id, question: c.question, tags: c.tags, compare: c.compare,
      sparql: answer?.sparql ?? '', explanation: answer?.explanation ?? '',
      ...outcome, attempts, model: rec?.model ?? MODELS.main, costUsd: cost,
    };
    results.push(r);
    console.log(`${c.id} ${r.status.padEnd(8)} ${r.status === 'partial' ? `${Math.round(r.overlap * 100)}% ` : ''}${c.question}${r.error ? `  (${r.error.slice(0, 80)})` : ''}`);
  }

  await mkdir(ev.runs, { recursive: true });
  await writeFile(join(ev.runs, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const n = results.length;
  const count = (s: CaseResult['status']) => results.filter((r) => r.status === s).length;
  const lists = results.filter((r) => r.compare !== 'value');
  const ran = results.filter((r) => ['exact', 'partial', 'wrong'].includes(r.status)).length;
  const spent = results.reduce((a, r) => a + r.costUsd, 0);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const md = `# Ask the graph eval: ${ev.label}

Generated ${new Date().toISOString().slice(0, 10)} by \`npm run ask-eval${dataset === 'paintings-1850-1900' ? '' : ` -- --dataset ${dataset}`}\`. ${n} questions (\`${ev.cases}\`, reviewed),
run on the graph scoped to that collection; each answered by
${MODELS.main} with prompt ${prompt.version} (\`prompts/ask.md\` + \`prompts/graph-schema.md\`), run on the graph, and compared
with a hand-written reference query. One retry after a failed query, as on the site.

| Metric | Result |
|---|---|
| **Exactly right** | **${count('exact')} of ${n} (${pct(count('exact') / n)})** |
| Partly right (list questions, overlap with the reference) | ${count('partial')} |
| Wrong answer | ${count('wrong')} |
| Query failed to run / invalid / refused / declined | ${count('invalid')} / ${count('rejected')} / ${count('refused')} / ${count('declined')} |
| Queries that ran | ${ran} of ${n} |
| Mean overlap on list and row questions | ${pct(lists.reduce((a, r) => a + r.overlap, 0) / Math.max(1, lists.length))} |
| Needed a retry | ${results.filter((r) => r.attempts > 1).length} |
| Cost | $${spent.toFixed(3)} in all, $${(spent / n).toFixed(4)} per question |

| id | question | result | generated query |
|---|---|---|---|
${results.map((r) => `| ${r.id} | ${r.question} | ${r.status}${r.status === 'partial' ? ` (${pct(r.overlap)})` : ''} | \`${r.sparql.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 220)}\` |`).join('\n')}
`;
  const path = ev.report;
  const existing = await readFile(path, 'utf8').catch(() => '');
  const kept = existing.includes(END_MARKER) ? existing.slice(existing.indexOf(END_MARKER) + END_MARKER.length) : '\n';
  await writeFile(path, `${md}\n${END_MARKER}${kept}`);
  console.log(`\nExactly right: ${count('exact')}/${n}; partial ${count('partial')}; spent $${spent.toFixed(3)}. Report: ${path}`);
});
