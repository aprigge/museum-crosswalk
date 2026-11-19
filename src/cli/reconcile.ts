import { join } from 'node:path';
import { dataDir, harvestedIds, listCached, writeJson } from '../core/cache.js';
import { SLICES, type SourceArtistRef } from '../core/types.js';
import { newWikidataClient } from '../authority/wikidata.js';
import { resolveAgents } from '../reconcile/agents.js';
import { reconcileRecord, type RecordReconciliation } from '../reconcile/match.js';
import { selectSources } from '../sources/index.js';
import { artistFor, cliArgs, main } from './common.js';

/** Slice mode: resolve every artist on every work in the slice. */
async function reconcileSlice(args: ReturnType<typeof cliArgs>) {
  const slice = SLICES[args.slice!];
  if (!slice) throw new Error(`Unknown slice "${args.slice}"`);
  const refs: SourceArtistRef[] = [];
  const works: Record<string, string[]> = {};
  for (const adapter of selectSources(args.source)) {
    const ids = await harvestedIds(adapter.name, slice.id);
    const raws = (await listCached(adapter.name, 'objects')).filter((r) => ids.has(r.id) && (adapter.inSlice?.(r, slice) ?? true));
    works[adapter.name] = raws.map((r) => r.id);
    await adapter.prepareTransform?.();
    for (const raw of raws) refs.push(...(await adapter.artistRefs(raw)));
  }
  const { resolutions, people } = await resolveAgents(newWikidataClient(args.refresh), refs);

  const outDir = join(dataDir(), 'reconcile', slice.id);
  await writeJson(join(outDir, 'works.json'), works);
  await writeJson(join(outDir, 'agents.json'), resolutions);
  await writeJson(join(outDir, 'people.json'), Object.fromEntries(people));
  await writeJson(
    join(outDir, 'review.json'),
    resolutions.filter((r) => r.decision !== 'merged'),
  );
  for (const source of Object.keys(works)) {
    const rs = resolutions.filter((r) => r.ref.source === source);
    const count = (d: string) => rs.filter((r) => r.decision === d).length;
    const agents = new Set(rs.map((r) => r.ref.sourceAgentId)).size;
    console.log(
      `${source}: ${works[source]!.length} works, ${rs.length} artist refs (${agents} agents): ` +
        `${count('merged')} merged, ${count('review')} review, ${count('unmatched')} unmatched`,
    );
  }
  console.log(`people merged across sources: ${new Set(resolutions.filter((r) => r.decision === 'merged').map((r) => r.personKey)).size}`);
}

main(async () => {
  const args = cliArgs();
  if (args.slice) return reconcileSlice(args);

  const artist = await artistFor(args);
  const all: RecordReconciliation[] = [];
  for (const adapter of selectSources(args.source)) {
    const ids = await harvestedIds(adapter.name);
    for (const raw of await listCached(adapter.name, 'objects')) {
      if (!ids.has(raw.id)) continue;
      all.push(reconcileRecord(adapter.name, raw.id, await adapter.artistRefs(raw), artist));
    }
  }
  const outDir = join(dataDir(), 'reconcile');
  await writeJson(join(outDir, 'matches.json'), {
    artist,
    records: all.map(({ review, ...rest }) => rest),
  });
  await writeJson(
    join(outDir, 'review.json'),
    all.flatMap((r) => (r.review ? [r.review] : [])),
  );
  for (const source of new Set(all.map((r) => r.source))) {
    const recs = all.filter((r) => r.source === source);
    const confirmed = recs.filter((r) => r.confirmed).length;
    console.log(`${source}: ${recs.length} records, ${confirmed} confirmed, ${recs.length - confirmed} for review`);
  }
});
