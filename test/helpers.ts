import { readCached } from '../src/core/cache.js';
import { parseExternalIds, parseLookup } from '../src/authority/wikidata.js';
import type { ArtistQuery, CachedRaw } from '../src/core/types.js';

export async function fixture(source: string, kind: string, id: string): Promise<CachedRaw> {
  const raw = await readCached(source, kind, id);
  if (!raw) throw new Error(`Missing fixture ${source}/${kind}/${id}`);
  return raw;
}

/** The artist as resolved during the saved harvest, built from cached Wikidata responses. */
export async function vanGogh(): Promise<ArtistQuery> {
  const lookup = parseLookup((await fixture('wikidata', 'authority', 'lookup-painter-Vincent van Gogh')).body as never);
  const hit = lookup[0]!;
  const ids = parseExternalIds((await fixture('wikidata', 'authority', `external-ids-${hit.qid}`)).body as never);
  return { name: 'Vincent van Gogh', qid: hit.qid, birth: hit.birth, death: hit.death, externalIds: ids };
}

/** Guard: fail loudly if anything in a test tries the network. */
export const noNetwork = (() => {
  throw new Error('network access in tests');
}) as unknown as typeof fetch;
