import { join } from 'node:path';
import { dataDir, harvestedIds, listCached, writeJson } from '../core/cache.js';
import { isArtistDataset, type Dataset, type SourceArtistRef } from '../core/types.js';
import { newWikidataClient } from '../authority/wikidata.js';
import { applyDecision, artistNames, resolveAgents, type PersonDecision } from '../reconcile/agents.js';
import { reviewKey } from '../ai/review.js';
import { readFile } from 'node:fs/promises';
import { reconcileRecord, type RecordReconciliation } from '../reconcile/match.js';
import { selectSources } from '../sources/index.js';
import { artistFor, cliArgs, datasetFor, main } from './common.js';

/**
 * Dataset mode: resolve every artist on every work harvested for the dataset (a slice, or one
 * artist's works, where the records also name engravers, publishers and "after" sources).
 */
async function reconcileDataset(args: ReturnType<typeof cliArgs>, slice: Dataset) {
  const refs: SourceArtistRef[] = [];
  const works: Record<string, string[]> = {};
  for (const adapter of selectSources(args.source)) {
    const ids = await harvestedIds(adapter.name, slice.id);
    if (!ids.size) continue; // not harvested for this dataset
    const raws = (await listCached(adapter.name, 'objects')).filter((r) => ids.has(r.id) && (isArtistDataset(slice) || (adapter.inSlice?.(r, slice) ?? true)));
    works[adapter.name] = raws.map((r) => r.id);
    await adapter.prepareTransform?.();
    for (const raw of raws) refs.push(...(await adapter.artistRefs(raw)));
  }
  const client = newWikidataClient(args.refresh);
  const datasetArtist = isArtistDataset(slice) ? { qid: slice.qid, names: await artistNames(client, slice.qid) } : undefined;
  const found = await resolveAgents(client, refs, datasetArtist);
  // A person's decisions on review proposals (alignments/review-decisions.json) settle those refs.
  const decisions = JSON.parse(await readFile('alignments/review-decisions.json', 'utf8').catch(() => '{}')) as Record<string, PersonDecision>;
  const resolutions = found.resolutions.map((r) => applyDecision(r, decisions[reviewKey(r.ref.source, r.ref.sourceAgentId ?? r.ref.name ?? 'unknown')]));
  const people = found.people;

  const outDir = join(dataDir(), 'reconcile', slice.id);
  await writeJson(join(outDir, 'works.json'), works);
  await writeJson(join(outDir, 'agents.json'), resolutions);
  await writeJson(join(outDir, 'people.json'), Object.fromEntries(people));
  await writeJson(
    join(outDir, 'review.json'),
    resolutions.filter((r) => r.decision === 'review' || r.decision === 'unmatched'),
  );
  for (const source of Object.keys(works)) {
    const rs = resolutions.filter((r) => r.ref.source === source);
    const count = (d: string) => rs.filter((r) => r.decision === d).length;
    const agents = new Set(rs.map((r) => r.ref.sourceAgentId)).size;
    console.log(
      `${source}: ${works[source]!.length} works, ${rs.length} artist refs (${agents} agents): ` +
        `${count('merged')} merged, ${count('review')} review, ${count('kept-separate')} kept separate, ${count('unmatched')} unmatched`,
    );
  }
  console.log(`people merged across sources: ${new Set(resolutions.filter((r) => r.decision === 'merged').map((r) => r.personKey)).size}`);
}

main(async () => {
  const args = cliArgs();
  const dataset = datasetFor(args);
  if (dataset) return reconcileDataset(args, dataset);

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
