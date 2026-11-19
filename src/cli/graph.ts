import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { dataDir, readCached, readJson } from '../core/cache.js';
import { SLICES } from '../core/types.js';
import type { Concept } from '../authority/concepts.js';
import type { AgentResolution, PersonFacts } from '../reconcile/agents.js';
import { GRAPHS, GraphBuilder } from '../graph/build.js';
import { toNQuads } from '../linkedart/validate.js';
import { selectSources } from '../sources/index.js';
import { cliArgs, main } from './common.js';

type Node = Record<string, any>;

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
  const coreGraphs = [GRAPHS.crosswalk, GRAPHS.derived, GRAPHS.alignments].map((gr) => ` <${gr.value}> .`);
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
