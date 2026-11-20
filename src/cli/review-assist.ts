import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { dataDir } from '../core/cache.js';
import { newWikidataClient, qidFromUri, sparqlUrl } from '../authority/wikidata.js';
import { anthropic, costUsd, loadPrompt, MODELS, readRecord, toRecord, writeRecord } from '../ai/client.js';
import { reviewKey, reviewRequest, ReviewSchema, type ReviewCase, type ReviewProposal } from '../ai/review.js';
import type { AgentResolution, PersonFacts } from '../reconcile/agents.js';
import type { SearchDoc } from '../search/build.js';
import { main } from './common.js';

// npm run review-assist -- --dry-run   build the cases and estimate the cost
// npm run review-assist                ask Claude for a proposal on each case (one call each)

const SLICE = 'paintings-1850-1900';
const year = (s?: string) => s?.match(/-?\d{4}/)?.[0];

interface Sparql {
  results: { bindings: Record<string, { value: string } | undefined>[] };
}

/** Description and occupations of the candidates, in one Wikidata query (cached). */
async function describe(qids: string[]): Promise<Map<string, { description?: string; occupations: string[] }>> {
  const q = `SELECT ?item ?description ?occupationLabel WHERE {
  VALUES ?item { ${qids.map((x) => `wd:${x}`).join(' ')} }
  OPTIONAL { ?item schema:description ?description FILTER(lang(?description) = "en") }
  OPTIONAL { ?item wdt:P106 ?occupation }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
  const key = createHash('sha1').update(q).digest('hex').slice(0, 16);
  const res = (await newWikidataClient().getJson('review-describe', key, sparqlUrl(q))).body as Sparql;
  const out = new Map<string, { description?: string; occupations: string[] }>();
  for (const b of res.results.bindings) {
    if (!b.item) continue;
    const e = out.get(qidFromUri(b.item.value)) ?? out.set(qidFromUri(b.item.value), { occupations: [] }).get(qidFromUri(b.item.value))!;
    e.description ??= b.description?.value;
    const occ = b.occupationLabel?.value;
    if (occ && !e.occupations.includes(occ)) e.occupations.push(occ);
  }
  return out;
}

/** One case per museum artist whose only link to Wikidata is its own ID, without agreeing life years. */
export async function buildCases(): Promise<ReviewCase[]> {
  const dir = join(dataDir(), 'reconcile', SLICE);
  const review = JSON.parse(await readFile(join(dir, 'review.json'), 'utf8')) as AgentResolution[];
  const people = JSON.parse(await readFile(join(dir, 'people.json'), 'utf8')) as Record<string, PersonFacts>;
  const docs = new Map((JSON.parse(await readFile(join(dataDir(), 'graph', SLICE, 'search-docs.json'), 'utf8')) as SearchDoc[]).map((d) => [d.id, d]));

  const byAgent = new Map<string, AgentResolution[]>();
  for (const r of review) {
    if (r.decision !== 'review' || !r.best?.qid || !/one ID/.test(r.reason ?? '')) continue;
    const k = reviewKey(r.ref.source, r.ref.sourceAgentId ?? r.ref.name ?? 'unknown');
    (byAgent.get(k) ?? byAgent.set(k, []).get(k)!).push(r);
  }
  const qids = [...new Set([...byAgent.values()].map((rs) => rs[0]!.best!.qid!))];
  const described = await describe(qids);

  return [...byAgent.entries()].map(([key, rs]) => {
    const r = rs[0]!;
    const facts = people[r.best!.qid!];
    const ids: Record<string, string> = { ...(r.ref.otherIds ?? {}) };
    if (r.ref.ulan) ids.ulan = r.ref.ulan;
    if (r.ref.wikidata) ids.wikidata = r.ref.wikidata;
    return {
      key,
      museum: { source: r.ref.source, agentId: String(r.ref.sourceAgentId ?? ''), name: r.ref.name, birthYear: year(r.ref.birth), deathYear: year(r.ref.death), ids },
      works: rs.slice(0, 6).map((x) => {
        const d = docs.get(`${x.ref.source}-${x.ref.recordId}`);
        return { title: d?.title ?? x.ref.recordId, date: d?.begin };
      }),
      candidate: {
        qid: r.best!.qid!,
        label: facts?.name ?? r.best!.qid!,
        description: described.get(r.best!.qid!)?.description,
        occupations: described.get(r.best!.qid!)?.occupations ?? [],
        birthYear: year(facts?.birth),
        deathYear: year(facts?.death),
        movements: (facts?.movements ?? []).map((m) => m.label),
        externalIds: Object.fromEntries(Object.entries(facts?.externalIds ?? {}).map(([pid, v]) => [`${pid} ${v.label}`, v.values])),
      },
      matcherEvidence: r.best!.evidence,
      reviewReason: r.reason ?? '',
    };
  });
}

main(async () => {
  const dryRun = process.argv.includes('--dry-run');
  const prompt = await loadPrompt('review');
  const cases = await buildCases();
  const pending = [];
  for (const c of cases) if (!(await readRecord<ReviewProposal>('review', c.key, prompt.version))?.output) pending.push(c);
  const per = costUsd(MODELS.main, { input_tokens: 1500, output_tokens: 2500, cache_read_input_tokens: 600 } as never, false);
  console.log(`${cases.length} cases; ${pending.length} without a proposal for prompt ${prompt.version}. Estimated cost: about $${(per * pending.length).toFixed(2)}.`);
  if (dryRun) return;

  let spent = 0;
  for (const c of pending) {
    const msg = (await anthropic().messages.create(reviewRequest(prompt, c) as never)) as Anthropic.Message;
    const rec = toRecord('review', c.key, prompt, msg, ReviewSchema);
    await writeRecord(rec, prompt.version);
    spent += costUsd(rec.model, rec.usage, false);
    console.log(`${c.key} ${c.museum.name} → ${c.candidate.label} (${c.candidate.qid}): ${rec.output ? `${rec.output.decision} ${rec.output.confidence}` : rec.error}`);
  }
  // One file with every case and its proposal, for the person reviewing them.
  const out = [];
  for (const c of cases) out.push({ ...c, proposal: (await readRecord<ReviewProposal>('review', c.key, prompt.version))?.output ?? null });
  await writeFile(join(dataDir(), 'reconcile', SLICE, 'ai-review.json'), JSON.stringify({ prompt: prompt.version, model: MODELS.main, cases: out }, null, 2));
  console.log(`Spent about $${spent.toFixed(3)}. Proposals in data/reconcile/${SLICE}/ai-review.json`);
});
