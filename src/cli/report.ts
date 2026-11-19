import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, readJson } from '../core/cache.js';
import type { ArtistMatch, ArtistQuery } from '../core/types.js';
import { END_MARKER, renderReport } from '../report/render.js';
import type { SourceData } from '../report/stats.js';
import { selectSources } from '../sources/index.js';
import { cliArgs, main } from './common.js';

async function readOr<T>(path: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function loadSource(name: string, matches: { source: string; recordId: string; matches: ArtistMatch[] }[]): Promise<SourceData> {
  const dir = join(dataDir(), 'linked-art', name);
  const records: SourceData['records'] = {};
  const files = await readdir(dir).catch(() => [] as string[]);
  for (const f of files.filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
    const r = await readJson<Record<string, unknown>>(join(dir, f));
    records[f.replace(/\.json$/, '')] = r;
  }
  return {
    name,
    harvest: await readOr(join(dataDir(), 'raw', name, '_harvest.json'), null),
    records,
    validation: await readOr(join(dir, '_validation.json'), {}),
    unmapped: await readOr(join(dir, '_unmapped.json'), {}),
    matches: matches.filter((m) => m.source === name),
  };
}

main(async () => {
  const args = cliArgs();
  const reconciled = await readJson<{ artist: ArtistQuery; records: { source: string; recordId: string; matches: ArtistMatch[] }[] }>(
    join(dataDir(), 'reconcile', 'matches.json'),
  );
  const sources = await Promise.all(selectSources(args.source).map((a) => loadSource(a.name, reconciled.records)));
  // Named by surname, given name dropped: "Vincent van Gogh" -> reports/van-gogh.md.
  const surname = reconciled.artist.name.split(/\s+/).slice(1).join(' ') || reconciled.artist.name;
  const slug = surname.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-');
  const path = join('reports', `${slug}.md`);

  // Keep anything hand-written below the marker.
  const existing = await readFile(path, 'utf8').catch(() => '');
  const kept = existing.includes(END_MARKER) ? existing.slice(existing.indexOf(END_MARKER) + END_MARKER.length) : '\n';
  await mkdir('reports', { recursive: true });
  await writeFile(path, `${renderReport(sources, reconciled.artist, new Date().toISOString())}\n${END_MARKER}${kept}`);
  console.log(`Wrote ${path}`);
});
