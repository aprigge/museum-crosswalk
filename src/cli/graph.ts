import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { dataDir, readCached, readJson, siteGraphDir, cacheKey } from '../core/cache.js';
import { DATASETS, isArtistDataset } from '../core/types.js';
import { catalogueRefs, groupImpressions, objectType, type CatalogueRefs } from '../graph/prints.js';
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
  // One graph for the site: every dataset that has been reconciled (or just --dataset).
  const ids = args.dataset ? [args.dataset] : Object.keys(DATASETS);
  const works: Record<string, string[]> = {};
  const datasetsOf = new Map<string, string[]>(); // "source:id" -> datasets it was harvested for
  const byRecord = new Map<string, AgentResolution[]>();
  const people = new Map<string, PersonFacts>();
  const concepts = new Map<string, Concept>();
  const used: string[] = [];
  for (const id of ids) {
    if (!DATASETS[id]) throw new Error(`Unknown dataset "${id}"`);
    const rec = join(dataDir(), 'reconcile', id);
    const dsWorks = await readJson<Record<string, string[]>>(join(rec, 'works.json')).catch(() => null);
    if (!dsWorks) continue; // not reconciled yet
    used.push(id);
    for (const [source, list] of Object.entries(dsWorks)) {
      for (const w of list) {
        const k = `${source}:${w}`;
        if (!datasetsOf.has(k)) (works[source] ??= []).push(w);
        datasetsOf.set(k, [...(datasetsOf.get(k) ?? []), id]);
      }
    }
    // An object in two datasets has the same refs and resolutions in both: keep the first.
    for (const a of await readJson<AgentResolution[]>(join(rec, 'agents.json'))) {
      const k = `${a.ref.source}:${a.ref.recordId}`;
      if (datasetsOf.get(k)?.[0] !== id) continue;
      (byRecord.get(k) ?? byRecord.set(k, []).get(k)!).push(a);
    }
    for (const [k, v] of Object.entries(await readJson<Record<string, PersonFacts>>(join(rec, 'people.json')))) if (!people.has(k)) people.set(k, v);
    for (const [k, v] of Object.entries(await readJson<Record<string, Concept>>(join(dataDir(), 'concepts', `${id}.json`)))) if (!concepts.has(k)) concepts.set(k, v);
  }
  if (!used.length) throw new Error('No reconciled dataset found: run reconcile first.');
  console.log(`datasets: ${used.join(', ')}`);

  const g = new GraphBuilder(concepts, people);
  const ai = await latestEnrichment();
  if (ai) console.log(`AI suggestions: run ${ai.run.promptVersion} (${ai.run.model}), ${ai.byWork.size} works`);
  g.addAlignments(await readFile('alignments/concepts.ttl', 'utf8'));
  // Prints plainly by each dataset's artist, with their catalogue numbers, for grouping below.
  const artistQids = new Set(used.map((id) => DATASETS[id]!).filter(isArtistDataset).map((d) => d.qid));
  const printsBy = new Map<string, { key: string; refs: CatalogueRefs }[]>();
  const titles = new Map<string, string>();
  for (const adapter of selectSources(args.source)) {
    const dir = join(dataDir(), 'linked-art', adapter.name);
    let nq = '';
    for (const id of works[adapter.name] ?? []) {
      const record = await readJson<Node>(join(dir, `${cacheKey(id)}.json`));
      const related: Node[] = [];
      for (const v of record.shows ?? []) {
        related.push(...(await readJson<Node>(join(dir, 'related', `${String(v.id).split('/').at(-1)}.json`)).then((r) => [r], () => [])));
      }
      const raw = await readCached(adapter.name, 'objects', id);
      if (!raw) throw new Error(`No cached raw record for ${adapter.name} ${id}`);
      const key = `${adapter.name}:${id}`;
      const type = objectType(adapter.name, raw);
      const catalogue = type === 'print' ? catalogueRefs(adapter.name, raw) : undefined;
      const resolved = byRecord.get(key) ?? [];
      g.addWork({ source: adapter.name, id, datasets: datasetsOf.get(key), objectType: type, catalogue, record, related, raw }, resolved);
      for (const qid of artistQids) {
        const byArtist = resolved.some((r) => r.decision === 'merged' && r.personKey === qid && r.ref.plainCreator !== false);
        if (type === 'print' && catalogue && byArtist) (printsBy.get(qid) ?? printsBy.set(qid, []).get(qid)!).push({ key, refs: catalogue });
      }
      if (typeof record._label === 'string') titles.set(key, record._label);
      const suggestions = ai?.byWork.get(`${adapter.name}-${id}`);
      if (ai && suggestions?.length) g.addAiSubjects(adapter.name, id, suggestions, ai.run);
      nq += await toNQuads(record);
      for (const r of related) nq += await toNQuads(r);
    }
    g.addLinkedArt(adapter.name, nq);
    console.log(`${adapter.name}: ${works[adapter.name]?.length ?? 0} works`);
  }

  for (const [qid, items] of printsBy) {
    const { groups, severalPrints } = groupImpressions(items);
    // English-language titles only, for naming the print: the Rijksmuseum's are often Dutch.
    const order = ['cleveland', 'aic', 'met', 'smk'];
    for (const k of [...titles.keys()]) if (!order.includes(k.split(':')[0]!)) titles.delete(k);
    const ordered = new Map([...titles].sort((a, b) => order.indexOf(a[0].split(':')[0]!) - order.indexOf(b[0].split(':')[0]!)));
    g.addPrints(qid, groups.map((gr) => ({ ...gr, members: [...gr.members].sort((a, b) => order.indexOf(a.split(':')[0]!) - order.indexOf(b.split(':')[0]!)) })), ordered);
    const multi = groups.filter((gr) => gr.members.length > 1);
    console.log(
      `${qid} prints: ${items.length} plainly by the artist, ${groups.reduce((n, gr) => n + gr.members.length, 0)} grouped into ${groups.length} prints (${multi.length} with 2+ impressions, ` +
        `${groups.filter((gr) => gr.conflict).length} noting an odd New Hollstein number); ${severalPrints.length} records cite several prints and stay ungrouped`,
    );
  }

  const out = siteGraphDir();
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
