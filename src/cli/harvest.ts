import { join } from 'node:path';
import { dataDir, writeJson } from '../core/cache.js';
import { BlockedError, CacheMissError } from '../core/http.js';
import { SLICES, type SourceAdapter } from '../core/types.js';
import { selectSources } from '../sources/index.js';
import { artistFor, cliArgs, main } from './common.js';

/**
 * Fetch every searched id and what it points to, logging progress on long runs.
 * A block (in the search or a fetch) stops this source at once; what was cached stays.
 */
async function harvestIds(adapter: SourceAdapter, search: AsyncIterable<string>, limit?: number) {
  const ids: string[] = [];
  const errors: { id: string; error: string }[] = [];
  let blocked: string | null = null;
  try {
    for await (const id of search) {
      if (limit && ids.length >= limit) break;
      ids.push(id);
      try {
        const raw = await adapter.fetch(id);
        await adapter.fetchRelated?.(raw);
      } catch (err) {
        if (err instanceof BlockedError) throw err;
        errors.push({ id, error: (err as Error).message });
        if (err instanceof CacheMissError) continue; // offline: not cached, nothing requested
      }
      if (ids.length % 50 === 0) console.log(`  ${adapter.name}: ${ids.length} fetched…`);
    }
  } catch (err) {
    // A block, or (offline) a search page that was never cached, ends this source's run.
    if (!(err instanceof BlockedError || err instanceof CacheMissError)) throw err;
    blocked = err.message;
    console.error(`  ${adapter.name}: ${err.message} after ${ids.length} ids`);
  }
  return { ids, errors, blocked };
}

main(async () => {
  const args = cliArgs();
  const adapters = selectSources(args.source, { refresh: args.refresh, offline: args.offline });

  if (args.slice) {
    const slice = SLICES[args.slice];
    if (!slice) throw new Error(`Unknown slice "${args.slice}". Known: ${Object.keys(SLICES).join(', ')}`);
    for (const adapter of adapters) {
      if (!adapter.searchSlice) throw new Error(`${adapter.name} has no slice search`);
      const { ids, errors, blocked } = await harvestIds(adapter, adapter.searchSlice(slice), args.limit);
      await writeJson(join(dataDir(), 'raw', adapter.name, `_harvest-${slice.id}.json`), {
        slice,
        finishedAt: new Date().toISOString(),
        complete: !blocked,
        ...(blocked ? { blocked } : {}),
        searchHits: ids.length,
        ids,
        errors,
      });
      console.log(`${adapter.name}: ${ids.length} search hits, ${errors.length} fetch errors${blocked ? ' (INCOMPLETE: blocked)' : ''}`);
    }
    return;
  }

  const artist = await artistFor(args);
  console.log(`Artist: ${artist.name} = ${artist.qid} (${artist.birth ?? '?'} – ${artist.death ?? '?'})`);
  for (const adapter of adapters) {
    const { ids, errors } = await harvestIds(adapter, adapter.search(artist), args.limit);
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
