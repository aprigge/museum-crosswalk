import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { dataDir, readCached, readJson } from '../core/cache.js';
import { SLICES } from '../core/types.js';
import type { Concept } from '../authority/concepts.js';
import type { AgentResolution, PersonFacts } from '../reconcile/agents.js';
import { GRAPHS, GraphBuilder, type AiRun } from '../graph/build.js';
import type { AiRecord } from '../ai/client.js';
import { checkAgainstVocabulary, type Enrichment } from '../ai/enrich.js';
import { loadEnrichVocabulary } from '../ai/vocabulary.js';
import { toNQuads } from '../linkedart/validate.js';
import { selectSources } from '../sources/index.js';
import { cliArgs, main } from './common.js';

type Node = Record<string, any>;

/**
 * The newest full enrichment run: each work's suggestions, re-checked against the vocabulary
 * (the model may only use listed IDs) and labelled with the vocabulary's labels.
 */
async function latestEnrichment(): Promise<{ run: AiRun; byWork: Map<string, { qid: string; label: string; confidence: number; evidence: string }[]> } | null> {
  const root = join(dataDir(), 'ai', 'enrich');
  const runs: { dir: string; info: { prompt: string; items: number; at: string } }[] = [];
  for (const dir of await readdir(root).catch(() => [] as string[])) {
    const info = await readJson<{ prompt: string; items: number; at: string }>(join(root, dir, '_run.json')).catch(() => null);
    if (info) runs.push({ dir, info });
  }
  // The full run, not a sample: most paintings, then newest.
  const best = runs.sort((a, b) => b.info.items - a.info.items || b.info.at.localeCompare(a.info.at))[0];
  if (!best) return null;
  const vocab = new Map((await loadEnrichVocabulary()).map((v) => [v.qid, v]));
  const byWork = new Map<string, { qid: string; label: string; confidence: number; evidence: string }[]>();
  let model = '';
  for (const f of await readdir(join(root, best.dir))) {
    if (f.startsWith('_')) continue;
    const rec = await readJson<AiRecord<Enrichment>>(join(root, best.dir, f));
    if (!rec.output) continue;
    model ||= rec.model;
    const checked = checkAgainstVocabulary(rec.output, vocab);
    byWork.set(rec.key, checked.subjects.map((s) => ({ qid: s.conceptId, label: vocab.get(s.conceptId)!.label, confidence: s.confidence, evidence: s.evidence })));
  }
  return { run: { model, promptVersion: best.info.prompt, at: best.info.at }, byWork };
}

main(async () => {
  const args = cliArgs();
  const slice = SLICES[args.slice ?? 'paintings-1850-1900'];
  if (!slice) throw new Error(`Unknown slice "${args.slice}"`);
  const rec = join(dataDir(), 'reconcile', slice.id);
  const works = await readJson<Record<string, string[]>>(join(rec, 'works.json'));
  const agents = await readJson<AgentResolution[]>(join(rec, 'agents.json'));
  const people = new Map(Object.entries(await readJson<Record<string, PersonFacts>>(join(rec, 'people.json'))));
  const concepts = new Map(Object.entries(await readJson<Record<string, Concept>>(join(dataDir(), 'concepts', `${slice.id}.json`))));

  const byRecord = new Map<string, AgentResolution[]>();
  for (const a of agents) {
    const k = `${a.ref.source}:${a.ref.recordId}`;
    (byRecord.get(k) ?? byRecord.set(k, []).get(k)!).push(a);
  }

  const g = new GraphBuilder(concepts, people);
  const ai = await latestEnrichment();
  if (ai) console.log(`AI suggestions: run ${ai.run.promptVersion} (${ai.run.model}), ${ai.byWork.size} works`);
  g.addAlignments(await readFile('alignments/concepts.ttl', 'utf8'));
  for (const adapter of selectSources(args.source)) {
    const dir = join(dataDir(), 'linked-art', adapter.name);
    let nq = '';
    for (const id of works[adapter.name] ?? []) {
      const record = await readJson<Node>(join(dir, `${id}.json`));
      const related: Node[] = [];
      for (const v of record.shows ?? []) {
        related.push(...(await readJson<Node>(join(dir, 'related', `${String(v.id).split('/').at(-1)}.json`)).then((r) => [r], () => [])));
      }
      const raw = await readCached(adapter.name, 'objects', id);
      if (!raw) throw new Error(`No cached raw record for ${adapter.name} ${id}`);
      g.addWork({ source: adapter.name, id, record, related, raw }, byRecord.get(`${adapter.name}:${id}`) ?? []);
      const suggestions = ai?.byWork.get(`${adapter.name}-${id}`);
      if (ai && suggestions?.length) g.addAiSubjects(adapter.name, id, suggestions, ai.run);
      nq += await toNQuads(record);
      for (const r of related) nq += await toNQuads(r);
    }
    g.addLinkedArt(adapter.name, nq);
    console.log(`${adapter.name}: ${works[adapter.name]?.length ?? 0} works`);
  }

  const out = join(dataDir(), 'graph', slice.id);
  await mkdir(out, { recursive: true });
  // Dumping one graph at a time drops the graph name, so dump the whole dataset as N-Quads and
  // keep the lines of the core graphs: the site's graph must keep crosswalk, derived and
  // alignments apart.
  const full = g.store.dump({ format: 'application/n-quads' });
  const coreGraphs = [GRAPHS.crosswalk, GRAPHS.derived, GRAPHS.alignments, GRAPHS.ai].map((gr) => ` <${gr.value}> .`);
  const core = full
    .split('\n')
    .filter((line) => coreGraphs.some((suffix) => line.endsWith(suffix)))
    .join('\n') + '\n';
  await writeFile(join(out, 'core.nq'), core);
  await writeFile(join(out, 'full.nq'), full);
  await mkdir('site/data', { recursive: true });
  const gz = gzipSync(core, { level: 9 });
  await writeFile('site/data/graph-core.nq.gz', gz);

  for (const [graph, count] of Object.entries(g.counts())) console.log(`  ${graph}: ${count} triples`);
  console.log(`core graph for the site: ${(core.length / 1e6).toFixed(1)} MB, ${(gz.length / 1e6).toFixed(2)} MB gzipped`);
});
