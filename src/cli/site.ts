import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import oxigraph from 'oxigraph';
import { mint } from '../core/ids.js';
import { join } from 'node:path';
import { dataDir, readJson } from '../core/cache.js';
import { SLICES } from '../core/types.js';
import { cliArgs, main } from './common.js';

type Node = Record<string, any>;

/**
 * Assemble what the static site serves, next to the graph and index that `graph` and `index`
 * already wrote to site/data/: vendored libraries, each work's Linked Art (a read-only static
 * API), the preset SPARQL queries, and a small metadata file.
 */
main(async () => {
  const args = cliArgs();
  const slice = SLICES[args.slice ?? 'paintings-1850-1900'];
  if (!slice) throw new Error(`Unknown slice "${args.slice}"`);

  // Libraries, copied as published: no bundler.
  await rm('site/vendor', { recursive: true, force: true });
  await mkdir('site/vendor/oxigraph', { recursive: true });
  for (const f of ['web.js', 'web_bg.wasm']) await copyFile(join('node_modules/oxigraph', f), join('site/vendor/oxigraph', f));
  await cp('node_modules/minisearch/dist/es', 'site/vendor/minisearch', { recursive: true, filter: (p) => !p.endsWith('.map') && !p.endsWith('.d.ts') });

  // Linked Art for every work in the slice, and the VisualItems each one shows.
  const works = await readJson<Record<string, string[]>>(join(dataDir(), 'reconcile', slice.id, 'works.json'));
  await rm('site/data/linked-art', { recursive: true, force: true });
  let files = 0;
  for (const [source, ids] of Object.entries(works)) {
    const from = join(dataDir(), 'linked-art', source);
    const to = join('site/data/linked-art', source);
    await mkdir(join(to, 'related'), { recursive: true });
    const related = new Set(await readdir(join(from, 'related')).catch(() => [] as string[]));
    for (const id of ids) {
      await copyFile(join(from, `${id}.json`), join(to, `${id}.json`));
      files++;
      const record = await readJson<Node>(join(from, `${id}.json`));
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
  store.load(await readFile(join(dataDir(), 'graph', slice.id, 'core.nq'), 'utf8'), { format: 'application/n-quads' });
  const relatedRows = store.query(
    `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
     SELECT ?aLabel ?bLabel WHERE { GRAPH <${mint.graph('alignments')}> { ?a skos:related ?b } ?a skos:prefLabel ?aLabel . ?b skos:prefLabel ?bLabel }`,
    { use_default_graph_as_union: true },
  ) as Map<string, { value: string }>[];
  const relatedConcepts = relatedRows.map((r) => ({ label: r.get('aLabel')!.value, related: r.get('bLabel')!.value }));
  await writeFile('site/data/related.json', JSON.stringify(relatedConcepts, null, 2));

  const harvests: Record<string, { finishedAt: string; complete: boolean; works: number }> = {};
  for (const source of Object.keys(works)) {
    const h = await readJson<Node>(join(dataDir(), 'raw', source, `_harvest-${slice.id}.json`));
    harvests[source] = { finishedAt: h.finishedAt, complete: h.complete !== false, works: works[source]!.length };
  }
  await writeFile(
    'site/data/meta.json',
    JSON.stringify({ slice, builtAt: new Date().toISOString(), harvests, queries }, null, 2),
  );
  console.log(`site/: ${files} Linked Art files, ${queries.length} queries, vendor libraries copied`);
});
