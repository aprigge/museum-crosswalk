import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import oxigraph from 'oxigraph';
import { dataDir } from '../core/cache.js';
import { main } from './common.js';

// Run a SPARQL file against the built graph: npm run query -- queries/x.rq [--full]
main(async () => {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage: npm run query -- <file.rq> [--full]');
  const graphFile = process.argv.includes('--full') ? 'full.nq' : 'core.nq';
  const store = new oxigraph.Store();
  store.load(await readFile(join(dataDir(), 'graph', 'paintings-1850-1900', graphFile), 'utf8'), { format: 'application/n-quads' });
  const rows = store.query(await readFile(file, 'utf8'), { use_default_graph_as_union: true }) as Map<string, { value: string }>[];
  const short = (v: string) => v.replace(/^https:\/\/aprigge\.github\.io\/museum-crosswalk\/id\//, '');
  for (const r of rows) console.log([...r.entries()].map(([k, v]) => `${k}=${short(v.value)}`).join('  '));
  console.log(`(${rows.length} rows)`);
});
