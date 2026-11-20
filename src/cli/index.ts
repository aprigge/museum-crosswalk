import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import oxigraph from 'oxigraph';
import { dataDir, siteGraphDir } from '../core/cache.js';
import { buildDocs, buildIndex } from '../search/build.js';
import { cliArgs, main } from './common.js';

// One search document per work, built by SPARQL over the core graph, serialised for the site.
main(async () => {
  const args = cliArgs();
  const store = new oxigraph.Store();
  store.load(await readFile(join(siteGraphDir(), 'core.nq'), 'utf8'), { format: 'application/n-quads' });

  const docs = buildDocs(store);
  const index = buildIndex(docs);
  await mkdir('site/data', { recursive: true });
  const json = JSON.stringify(index);
  await writeFile('site/data/search-index.json', json);
  await writeFile(join(siteGraphDir(), 'search-docs.json'), JSON.stringify(docs, null, 2));

  const by = (k: keyof (typeof docs)[number]) => docs.filter((d) => (d[k] as unknown[] | undefined)?.length).length;
  console.log(`${docs.length} documents: ${by('artists')} with an artist, ${by('styles')} with a museum style, ` +
    `${by('inferredStyles')} with an inferred style, ${by('subjects')} with subjects, ${docs.filter((d) => d.thumb).length} with an open image`);
  console.log(`site/data/search-index.json: ${(json.length / 1e6).toFixed(2)} MB`);
});
