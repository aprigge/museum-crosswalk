import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, readJson, writeJson, cacheKey } from '../core/cache.js';
import { resolveConcepts } from '../authority/concepts.js';
import { newWikidataClient } from '../authority/wikidata.js';
import { selectSources } from '../sources/index.js';
import { conceptUris } from '../graph/extract.js';
import { cliArgs, datasetFor, main } from './common.js';

type Node = Record<string, any>;

main(async () => {
  const args = cliArgs();
  const slice = datasetFor(args, 'paintings-1850-1900')!;
  const works = await readJson<Record<string, string[]>>(join(dataDir(), 'reconcile', slice.id, 'works.json'));

  const bySource: Record<string, number> = {};
  const uris = new Set<string>();
  for (const adapter of selectSources(args.source)) {
    const dir = join(dataDir(), 'linked-art', adapter.name);
    const relatedFiles = new Set(await readdir(join(dir, 'related')).catch(() => [] as string[]));
    let n = 0;
    for (const id of works[adapter.name] ?? []) {
      const record = await readJson<Node>(join(dir, `${cacheKey(id)}.json`));
      const related: Node[] = [];
      for (const v of record.shows ?? []) {
        const f = `${String(v.id).split('/').at(-1)}.json`;
        if (relatedFiles.has(f)) related.push(await readJson<Node>(join(dir, 'related', f)));
      }
      const found = conceptUris(record, related);
      if (found.length) n++;
      found.forEach((u) => uris.add(u));
    }
    bySource[adapter.name] = n;
  }

  const concepts = await resolveConcepts(newWikidataClient(args.refresh), [...uris]);
  await writeJson(join(dataDir(), 'concepts', `${slice.id}.json`), Object.fromEntries(concepts));
  const matched = [...concepts.values()];
  console.log(`concept URIs: ${uris.size}; resolved to Wikidata: ${matched.length} (${matched.filter((c) => c.match === 'broad').length} broad)`);
  for (const [s, n] of Object.entries(bySource)) console.log(`${s}: ${n} of ${works[s]?.length ?? 0} works carry concepts`);
});
