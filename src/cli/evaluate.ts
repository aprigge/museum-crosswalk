import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import MiniSearch from 'minisearch';
import oxigraph from 'oxigraph';
import { dataDir } from '../core/cache.js';
import { FIELD_EXPLANATION, MUSEUM_NAMES } from '../../site/js/terms.js';
import { END_MARKER } from '../report/render.js';
import { MINISEARCH_OPTIONS, SEARCH_OPTIONS, type SearchDoc } from '../search/build.js';
import { main } from './common.js';

const QUERY = 'Impressionist landscapes';
const SLICE = 'paintings-1850-1900';
const MUSEUMS = ['rijksmuseum', 'met', 'aic'] as const;

type Hit = SearchDoc & { score: number; match: Record<string, string[]> };

const table = (head: string[], rows: unknown[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n');

/** How a hit matched, in plain words: e.g. "impression: artist's movement (Wikidata)". */
function why(hit: Hit): string {
  return Object.entries(hit.match)
    .map(([term, fields]) => `${term}: ${fields.map((f) => FIELD_EXPLANATION[f] ?? f).join(', ')}`)
    .join('; ');
}

main(async () => {
  const index = MiniSearch.loadJSON<SearchDoc>(await readFile('site/data/search-index.json', 'utf8'), MINISEARCH_OPTIONS as never);
  const docs: SearchDoc[] = JSON.parse(await readFile(join(dataDir(), 'graph', SLICE, 'search-docs.json'), 'utf8'));
  const hits = index.search(QUERY, SEARCH_OPTIONS) as unknown as Hit[];

  // The same question asked of the graph by concept, as a cross-check on the text search.
  const store = new oxigraph.Store();
  store.load(await readFile(join(dataDir(), 'graph', SLICE, 'core.nq'), 'utf8'), { format: 'application/n-quads' });
  const sparql = await readFile('queries/impressionist-landscapes.rq', 'utf8');
  const conceptRows = store.query(sparql, { use_default_graph_as_union: true }) as Map<string, { value: string }>[];
  const conceptByMuseum = Object.fromEntries(MUSEUMS.map((m) => [m, new Set(conceptRows.filter((r) => r.get('museum')!.value === m).map((r) => r.get('title')!.value)).size]));
  const harvest = JSON.parse(await readFile(join(dataDir(), 'raw', 'met', `_harvest-${SLICE}.json`), 'utf8'));

  const byMuseum = Object.fromEntries(MUSEUMS.map((m) => [m, hits.filter((h) => h.museum === m)]));
  const totals = Object.fromEntries(MUSEUMS.map((m) => [m, docs.filter((d) => d.museum === m).length]));

  // Group by the merged person: the same key across museums means one Wikidata person.
  const groups = new Map<string, { name: string; museums: Set<string>; hits: Hit[] }>();
  for (const h of hits) {
    const keys = h.artistKeys.length ? h.artistKeys : ['(no artist)'];
    keys.forEach((k, i) => {
      const g = groups.get(k) ?? groups.set(k, { name: h.artists[i] ?? '(no artist)', museums: new Set(), hits: [] }).get(k)!;
      g.museums.add(h.museum);
      g.hits.push(h);
    });
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].museums.size - a[1].museums.size || b[1].hits.length - a[1].hits.length);
  const crossMuseum = sorted.filter(([, g]) => g.museums.size > 1);
  const viaInferred = hits.filter((h) => Object.values(h.match).some((f) => f.includes('inferredStyles')) && !Object.values(h.match).some((f) => f.includes('styles'))).length;

  const md = `# "${QUERY}" across three museums

Generated ${new Date().toISOString().slice(0, 10)} by \`npm run evaluate\` from the search index the site uses
(\`site/data/search-index.json\`) and the core graph. Slice: paintings made 1850–1900.

**Answer: ${MUSEUMS.filter((m) => byMuseum[m]!.length).length} of 3 museums return results** ${MUSEUMS.map((m) => `${MUSEUM_NAMES[m]} ${byMuseum[m]!.length}`).join(', ')}.
Results group by ${groups.size} artists; ${crossMuseum.length} of them have hits in more than one museum.

## Hits per museum

${table(
  ['Museum', 'Works in slice', 'Text search hits', 'Concept query (SPARQL) hits'],
  MUSEUMS.map((m) => [MUSEUM_NAMES[m], totals[m], byMuseum[m]!.length, conceptByMuseum[m]]),
)}

${harvest.complete === false ? `The Met's slice is **partial**: ${totals.met} of its paintings were harvested before its firewall blocked requests.\n` : ''}
- **Text search** is what the site runs: MiniSearch with all terms required ("${QUERY}" → \`impression\` AND \`landscape\`), prefix and light fuzzy matching.
- **Concept query** is \`queries/impressionist-landscapes.rq\`: Impressionism (Wikidata Q40415) as the museum's style or the artist's movement, and landscape (Q191163, aligned with Q107425).
- ${viaInferred} of ${hits.length} hits match "Impressionist" only through the artist's movement on Wikidata, not through the museum's own data.

## Grouped by artist

${table(
  ['Artist', 'Museums', 'Hits', 'Example'],
  sorted.slice(0, 25).map(([, g]) => [g.name, [...g.museums].map((m) => MUSEUM_NAMES[m as keyof typeof MUSEUM_NAMES]).join(', '), g.hits.length, g.hits[0]!.title]),
)}

## Why the top hits matched

${table(
  ['Work', 'Museum', 'Matched on'],
  hits.slice(0, 12).map((h) => [`${h.title} (${h.artists.join(', ') || 'no artist'})`, h.museumName, why(h)]),
)}
`;

  const path = 'reports/impressionist-landscapes.md';
  const existing = await readFile(path, 'utf8').catch(() => '');
  const kept = existing.includes(END_MARKER) ? existing.slice(existing.indexOf(END_MARKER) + END_MARKER.length) : '\n';
  await writeFile(path, `${md}\n${END_MARKER}${kept}`);
  console.log(`Wrote ${path}: ${hits.length} hits; ${MUSEUMS.map((m) => `${m} ${byMuseum[m]!.length}`).join(', ')}; ${crossMuseum.length} cross-museum artists`);
});
