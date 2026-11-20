import { parseArgs } from 'node:util';
import { newWikidataClient, resolveArtist } from '../authority/wikidata.js';
import { DATASETS, type ArtistQuery, type Dataset } from '../core/types.js';

export const DEFAULT_ARTIST = 'Vincent van Gogh';

export function cliArgs() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      artist: { type: 'string', default: DEFAULT_ARTIST },
      qid: { type: 'string' },
      refresh: { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      limit: { type: 'string' },
      slice: { type: 'string' },
      dataset: { type: 'string' },
    },
  });
  return { ...values, limit: values.limit ? Number(values.limit) : undefined };
}

/** The dataset a step works on: `--dataset`, or `--slice` as before; `fallback` when neither is given. */
export function datasetFor(args: ReturnType<typeof cliArgs>, fallback?: string): Dataset | undefined {
  const id = args.dataset ?? args.slice ?? fallback;
  if (!id) return undefined;
  const d = DATASETS[id];
  if (!d) throw new Error(`Unknown dataset "${id}". Known: ${Object.keys(DATASETS).join(', ')}`);
  return d;
}

/** Resolve the artist from Wikidata (served from cache after the first harvest). */
export async function artistFor(args: ReturnType<typeof cliArgs>): Promise<ArtistQuery> {
  return resolveArtist(newWikidataClient(args.refresh), args.artist!, args.qid);
}

export async function main(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}
