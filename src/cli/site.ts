import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import oxigraph from 'oxigraph';
import { mint } from '../core/ids.js';
import { join } from 'node:path';
import { dataDir, readJson, siteGraphDir, cacheKey } from '../core/cache.js';
import { DATASETS } from '../core/types.js';
import { cliArgs, main } from './common.js';

type Node = Record<string, any>;

/**
 * Assemble what the static site serves, next to the graph and index that `graph` and `index`
 * already wrote to site/data/: vendored libraries, each work's Linked Art (a read-only static
 * API), the preset SPARQL queries, and a small metadata file.
 */
main(async () => {
  const args = cliArgs();

  // Libraries, copied as published: no bundler.
  await rm('site/vendor', { recursive: true, force: true });
  await mkdir('site/vendor/oxigraph', { recursive: true });
  for (const f of ['web.js', 'web_bg.wasm']) await copyFile(join('node_modules/oxigraph', f), join('site/vendor/oxigraph', f));
  await cp('node_modules/minisearch/dist/es', 'site/vendor/minisearch', { recursive: true, filter: (p) => !p.endsWith('.map') && !p.endsWith('.d.ts') });

  // Linked Art for every work in every reconciled dataset, and the VisualItems each one shows.
  const datasets: Record<string, Record<string, string[]>> = {};
  for (const id of Object.keys(DATASETS)) {
    const w = await readJson<Record<string, string[]>>(join(dataDir(), 'reconcile', id, 'works.json')).catch(() => null);
    if (w) datasets[id] = w;
  }
  const works: Record<string, string[]> = {};
  for (const w of Object.values(datasets)) for (const [s, ids] of Object.entries(w)) works[s] = [...new Set([...(works[s] ?? []), ...ids])];
  await rm('site/data/linked-art', { recursive: true, force: true });
  let files = 0;
  for (const [source, ids] of Object.entries(works)) {
    const from = join(dataDir(), 'linked-art', source);
    const to = join('site/data/linked-art', source);
    await mkdir(join(to, 'related'), { recursive: true });
    const related = new Set(await readdir(join(from, 'related')).catch(() => [] as string[]));
    for (const id of ids) {
      await copyFile(join(from, `${cacheKey(id)}.json`), join(to, `${cacheKey(id)}.json`));
      files++;
      const record = await readJson<Node>(join(from, `${cacheKey(id)}.json`));
      for (const v of record.shows ?? []) {
        const f = `${String(v.id).split('/').at(-1)}.json`;
        if (related.has(f)) {
          await copyFile(join(from, 'related', f), join(to, 'related', f));
          files++;
        }
      }
    }
  }

  await rm('site/data/queries', { recursive: true, force: true });
  await mkdir('site/data/queries', { recursive: true });
  const queries = (await readdir('queries')).filter((f) => f.endsWith('.rq') && !f.startsWith('_'));
  for (const q of queries) await copyFile(join('queries', q), join('site/data/queries', q));

  // Related concepts from the project's alignments (e.g. Hague School ~ Impressionism), so the
  // search page can offer them without loading the whole graph.
  const store = new oxigraph.Store();
  store.load(await readFile(join(siteGraphDir(), 'core.nq'), 'utf8'), { format: 'application/n-quads' });
  const relatedRows = store.query(
    `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
     SELECT ?aLabel ?bLabel WHERE { GRAPH <${mint.graph('alignments')}> { ?a skos:related ?b } ?a skos:prefLabel ?aLabel . ?b skos:prefLabel ?bLabel }`,
    { use_default_graph_as_union: true },
  ) as Map<string, { value: string }>[];
  const relatedConcepts = relatedRows.map((r) => ({ label: r.get('aLabel')!.value, related: r.get('bLabel')!.value }));
  await writeFile('site/data/related.json', JSON.stringify(relatedConcepts, null, 2));

  // Per dataset and museum: when it was harvested, whether the harvest finished, and how many works.
  const harvests: Record<string, Record<string, { finishedAt: string; complete: boolean; works: number }>> = {};
  for (const [id, w] of Object.entries(datasets)) {
    for (const source of Object.keys(w)) {
      const h = await readJson<Node>(join(dataDir(), 'raw', source, `_harvest-${id}.json`));
      (harvests[id] ??= {})[source] = { finishedAt: h.finishedAt, complete: h.complete !== false, works: w[source]!.length };
    }
  }
  await writeFile(
    'site/data/meta.json',
    JSON.stringify({ datasets: Object.keys(datasets).map((id) => DATASETS[id]), builtAt: new Date().toISOString(), harvests, queries }, null, 2),
  );
  console.log(`site/: ${files} Linked Art files, ${queries.length} queries, vendor libraries copied`);
});
