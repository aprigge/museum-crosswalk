import { join } from 'node:path';
import { dataDir, writeJson } from '../core/cache.js';
import { selectSources } from '../sources/index.js';
import { artistFor, cliArgs, main } from './common.js';

main(async () => {
  const args = cliArgs();
  const artist = await artistFor(args);
  console.log(`Artist: ${artist.name} = ${artist.qid} (${artist.birth ?? '?'} – ${artist.death ?? '?'})`);

  for (const adapter of selectSources(args.source, { refresh: args.refresh })) {
    const ids: string[] = [];
    const errors: { id: string; error: string }[] = [];
    for await (const id of adapter.search(artist)) {
      if (args.limit && ids.length >= args.limit) break;
      ids.push(id);
      try {
        const raw = await adapter.fetch(id);
        await adapter.fetchRelated?.(raw);
      } catch (err) {
        errors.push({ id, error: (err as Error).message });
      }
    }
    await writeJson(join(dataDir(), 'raw', adapter.name, '_harvest.json'), {
      artist: { name: artist.name, qid: artist.qid },
      finishedAt: new Date().toISOString(),
      searchHits: ids.length,
      ids,
      errors,
    });
    console.log(`${adapter.name}: ${ids.length} search hits, ${errors.length} fetch errors`);
  }
});
