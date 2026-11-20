import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import oxigraph from 'oxigraph';
import { dataDir, readJson, siteGraphDir } from '../core/cache.js';
import { MUSEUM_NAMES } from '../../site/js/terms.js';
import { END_MARKER } from '../report/render.js';
import { main } from './common.js';
import type { AgentResolution } from '../reconcile/agents.js';

// reports/rembrandt.md: what the graph knows about one artist across five museums. Generated from
// SPARQL over the site's graph and the reconcile output; hand-written findings below the marker.

const ARTIST = '<https://aprigge.github.io/museum-crosswalk/id/person/Q5598>';
const WD = '<http://www.wikidata.org/entity/Q5598>';
const PREFIX = 'PREFIX mc: <https://aprigge.github.io/museum-crosswalk/ns#> PREFIX dcterms: <http://purl.org/dc/terms/> PREFIX schema: <https://schema.org/>';
const TYPES = ['print', 'drawing', 'painting', 'other'];
const name = (m: string | undefined) => (MUSEUM_NAMES as Record<string, string>)[m ?? ""] ?? m ?? "";
const table = (head: string[], rows: unknown[][]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

main(async () => {
  const store = new oxigraph.Store();
  store.load(await readFile(join(siteGraphDir(), 'core.nq'), 'utf8'), { format: 'application/n-quads' });
  const q = (sparql: string) =>
    (store.query(`${PREFIX}\n${sparql}`, { use_default_graph_as_union: true }) as Map<string, { value: string }>[]).map((r) =>
      Object.fromEntries([...r].map(([k, v]) => [k, v.value])) as Record<string, string>,
    );
  const harvest: Record<string, number> = {};
  for (const s of ['rijksmuseum', 'met', 'aic', 'smk', 'cleveland']) {
    harvest[s] = (await readJson<{ searchHits: number }>(join(dataDir(), 'raw', s, '_harvest-rembrandt.json'))).searchHits;
  }

  const holdings = q(`SELECT ?museum ?type (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w mc:artist ${ARTIST} ; mc:museum ?museum . OPTIONAL { ?w mc:objectType ?t } BIND(COALESCE(?t, "other") AS ?type) } GROUP BY ?museum ?type`);
  const related = q(`SELECT ?museum (COUNT(DISTINCT ?w) AS ?n) WHERE {
    { ?w mc:qualifiedArtist ${ARTIST} } UNION { ?w mc:qualifiedArtist/mc:sourceAgent/mc:matchCandidate ${WD} }
    FILTER NOT EXISTS { ?w mc:artist ${ARTIST} } ?w mc:museum ?museum } GROUP BY ?museum`);
  // Per museum agent whose evidence points to Rembrandt: one museum ID can carry several names
  // ("Rembrandt", "After Rembrandt"), so count its records by decision from the reconcile output.
  const agents = await readJson<AgentResolution[]>(join(dataDir(), 'reconcile', 'rembrandt', 'agents.json'));
  const byAgent = new Map<string, { museum: string; id: string; names: Set<string>; methods: Set<string>; merged: number; other: number }>();
  for (const r of agents) {
    if (r.best?.qid !== 'Q5598' && r.personKey !== 'Q5598') continue;
    const k = `${r.ref.source}:${r.ref.sourceAgentId}`;
    const a = byAgent.get(k) ?? byAgent.set(k, { museum: r.ref.source, id: String(r.ref.sourceAgentId ?? ''), names: new Set(), methods: new Set(), merged: 0, other: 0 }).get(k)!;
    if (r.ref.name) a.names.add(r.ref.name);
    if (r.best?.method) a.methods.add(r.best.method);
    if (r.decision === 'merged' && r.ref.plainCreator !== false) a.merged++;
    else a.other++;
  }
  const spread = q(`SELECT ?museums (COUNT(?p) AS ?prints) WHERE { { SELECT ?p (COUNT(DISTINCT ?m) AS ?museums) WHERE { ?p a mc:Print ; mc:artist ${ARTIST} . ?w mc:impressionOf ?p ; mc:museum ?m } GROUP BY ?p } } GROUP BY ?museums ORDER BY DESC(?museums)`);
  const top = q(`SELECT ?title ?b (COUNT(DISTINCT ?m) AS ?museums) (COUNT(DISTINCT ?w) AS ?impressions) WHERE { ?p a mc:Print ; mc:artist ${ARTIST} ; mc:bartsch ?b . OPTIONAL { ?p dcterms:title ?title } ?w mc:impressionOf ?p ; mc:museum ?m } GROUP BY ?title ?b ORDER BY DESC(?museums) DESC(?impressions) LIMIT 10`);
  const grouped = q(`SELECT (COUNT(DISTINCT ?w) AS ?n) (COUNT(DISTINCT ?p) AS ?prints) WHERE { ?p a mc:Print ; mc:artist ${ARTIST} . ?w mc:impressionOf ?p }`)[0]!;
  const conflicts = q(`SELECT ?title ?b ?c WHERE { ?p a mc:Print ; mc:artist ${ARTIST} ; mc:groupingConflict ?c . OPTIONAL { ?p mc:bartsch ?b } OPTIONAL { ?p dcterms:title ?title } } ORDER BY ?b`);
  const ungrouped = q(`SELECT ?museum (COUNT(DISTINCT ?w) AS ?n) (COUNT(DISTINCT ?c) AS ?cited) WHERE { ?w mc:artist ${ARTIST} ; mc:objectType "print" ; mc:museum ?museum .
    FILTER NOT EXISTS { ?w mc:impressionOf ?x } OPTIONAL { ?w mc:catalogueRef ?r . BIND(?w AS ?c) } } GROUP BY ?museum ORDER BY DESC(?n)`);
  const images = q(`SELECT ?museum (COUNT(DISTINCT ?w) AS ?n) (COUNT(DISTINCT ?i) AS ?open) WHERE { ?w mc:artist ${ARTIST} ; mc:museum ?museum . OPTIONAL { ?w schema:thumbnailUrl ?t . BIND(?w AS ?i) } } GROUP BY ?museum`);

  const museums = Object.keys(harvest);
  const count = (m: string, t?: string) => holdings.filter((h) => h.museum === m && (!t || h.type === t)).reduce((s, h) => s + Number(h.n), 0);
  const total = museums.reduce((s, m) => s + count(m), 0);

  const md = `# Rembrandt across five museums

Generated ${new Date().toISOString().slice(0, 10)} by \`npm run rembrandt-report\` from the site's graph (\`data/graph/site/core.nq\`).
Phase 4 of museum-crosswalk: everything five open museum APIs hold by Rembrandt van Rijn (Wikidata Q5598).

## Records and works

"By Rembrandt" counts works whose record names him plainly. "After, school, workshop…" counts records that name him with a
qualifier (after, copy after, school of, imitator of, earlier ascribed to) and are not also plainly his; they are never counted as his.
Object types are as each museum states them.

${table(
  ['Museum', 'Records harvested', ...TYPES.slice(0, 3).map((t) => `${t[0]!.toUpperCase()}${t.slice(1)}s`), 'By Rembrandt', 'After, school, workshop…', 'With an open image'],
  [
    ...museums.map((m) => [
      name(m), harvest[m], ...TYPES.slice(0, 3).map((t) => count(m, t) || '–'), `**${count(m)}**`,
      related.find((r) => r.museum === m)?.n ?? 0, images.find((r) => r.museum === m)?.open ?? 0,
    ]),
    ['**All five**', Object.values(harvest).reduce((s, n) => s + n, 0), ...TYPES.slice(0, 3).map((t) => museums.reduce((s, m) => s + count(m, t), 0)), `**${total}**`,
      related.reduce((s, r) => s + Number(r.n), 0), images.reduce((s, r) => s + Number(r.open), 0)],
  ],
)}

## How each museum's record of Rembrandt was matched

Each row is one museum's own ID for a person whose evidence points to Rembrandt. "Plainly his" records are merged and credit
him as the artist; the rest name him with a qualifier, or stay in review (an agent named "School of…" is never merged).

${table(
  ['Museum', 'Museum ID', 'Names used', 'How matched', 'Records plainly his', 'Other records'],
  [...byAgent.values()]
    .sort((a, b) => a.museum.localeCompare(b.museum) || b.merged - a.merged)
    .map((a) => [name(a.museum), a.id.split('/').at(-1), [...a.names].slice(0, 4).join('; ') + (a.names.size > 4 ? '; …' : ''), [...a.methods].join(', '), a.merged, a.other]),
)}

## Prints and their impressions

${grouped.n} impressions plainly by Rembrandt are grouped into ${grouped.prints} prints by the catalogue numbers the museums cite
(Bartsch / Hollstein, then New Hollstein where no Bartsch number is given), never by title.

${table(['Held by', 'Prints'], spread.map((s) => [`${s.museums} museum${s.museums === '1' ? '' : 's'}`, s.prints]))}

Held most widely:

${table(['Print', 'Bartsch', 'Museums', 'Impressions'], top.map((t) => [t.title ?? '', t.b, t.museums, t.impressions]))}

Prints by Rembrandt left ungrouped, by museum:

${table(['Museum', 'Ungrouped prints', 'Of which cite a catalogue number'], ungrouped.map((u) => [name(u.museum), u.n, u.cited]))}

Groups noting a record whose New Hollstein number usually belongs to another print (kept in its Bartsch group, not merged):

${conflicts.length ? conflicts.map((c) => `- ${c.title ?? 'Untitled'} (Bartsch ${c.b ?? '?'}): ${c.c}`).join('\n') : '- None.'}
`;

  const path = 'reports/rembrandt.md';
  const existing = await readFile(path, 'utf8').catch(() => '');
  const kept = existing.includes(END_MARKER) ? existing.slice(existing.indexOf(END_MARKER) + END_MARKER.length) : '\n';
  await writeFile(path, `${md}\n${END_MARKER}${kept}`);
  console.log(`Wrote ${path}: ${total} works by Rembrandt, ${grouped.n} impressions in ${grouped.prints} prints`);
});
