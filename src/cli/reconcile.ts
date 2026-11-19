import { join } from 'node:path';
import { dataDir, listCached, writeJson } from '../core/cache.js';
import { reconcileRecord, type RecordReconciliation } from '../reconcile/match.js';
import { selectSources } from '../sources/index.js';
import { artistFor, cliArgs, main } from './common.js';

main(async () => {
  const args = cliArgs();
  const artist = await artistFor(args);
  const all: RecordReconciliation[] = [];
  for (const adapter of selectSources(args.source)) {
    for (const raw of await listCached(adapter.name, 'objects')) {
      all.push(reconcileRecord(adapter.name, raw.id, await adapter.artistRefs(raw), artist));
    }
  }
  const outDir = join(dataDir(), 'reconcile');
  await writeJson(join(outDir, 'matches.json'), {
    artist: { name: artist.name, qid: artist.qid, externalIds: artist.externalIds },
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
