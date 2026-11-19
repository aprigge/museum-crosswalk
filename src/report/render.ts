import type { ArtistMatch, ArtistQuery } from '../core/types.js';
import {
  artistWorks,
  hasDescription,
  hasOpenImage,
  licenseCounts,
  linkedArtProperties,
  schemaErrorKinds,
  statusCounts,
  unmappedFields,
  wikidataIdsForSource,
  type SourceData,
} from './stats.js';

export const END_MARKER = '<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->';

const LABELS: Record<string, string> = { rijksmuseum: 'Rijksmuseum', met: 'The Met', aic: 'Art Institute of Chicago' };
const label = (s: string) => LABELS[s] ?? s;

const cell = (v: unknown) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
function table(head: string[], rows: unknown[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}
const truncate = (v: unknown, n = 90) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
const pct = (n: number, d: number) => (d ? `${n} (${Math.round((n / d) * 100)}%)` : '0');

function refsToArtist(src: SourceData, qid: string): ArtistMatch[] {
  return src.matches.flatMap((r) => r.matches.filter((m) => m.qid === qid));
}

function worksSection(sources: SourceData[], qid: string): string {
  const rows = sources.map((s) => {
    const st = statusCounts(s, qid);
    const works = artistWorks(s, qid).map((id) => s.records[id]).filter(Boolean);
    return [
      label(s.name),
      s.harvest?.searchHits ?? Object.keys(s.records).length,
      st.confirmed.length,
      st['crosswalk-only'].length,
      st.qualified.length,
      st['other-artist'].length + st['no-artist'].length,
      pct(works.filter((r) => hasOpenImage(r!)).length, works.length),
      pct(works.filter((r) => hasDescription(r!)).length, works.length),
    ];
  });
  return `## 1. Works, open images and description text

"Works by the artist" is the confirmed set plus crosswalk-only matches: records whose
artist resolves to ${qid} with a plain creator role. Image and description counts are
over that set. Everything that is not an exact-ID match is in \`data/reconcile/review.json\`.

${table(
  ['Source', 'Search hits', 'Confirmed (exact ID)', 'Crosswalk only', 'Qualified (after, possibly, imitator…)', 'Other artist', 'Open image', 'Description text'],
  rows,
)}

- **Open image** means the record carries an image URL under CC0, Public Domain Mark or CC BY.
- **Description text** means a Linked Art Description statement (aat:300435416) with prose, not
  just tombstone fields.`;
}

function identitySection(sources: SourceData[], artist: ArtistQuery): string {
  const rows = sources.map((s) => {
    const refs = refsToArtist(s, artist.qid);
    const sample = refs[0]?.ref;
    const links = [
      refs.some((m) => m.ref.wikidata) && 'Wikidata',
      refs.some((m) => m.ref.ulan) && 'ULAN',
      refs.some((m) => m.ref.otherIds?.rkd) && 'RKD',
      refs.some((m) => m.ref.otherIds?.viaf) && 'VIAF',
    ].filter(Boolean);
    const wd = wikidataIdsForSource(artist, s.name);
    const methods = [...new Set(refs.map((m) => m.method))];
    const agentIds = [...new Set(refs.map((m) => m.ref.sourceAgentId).filter(Boolean))];
    return [
      label(s.name),
      agentIds.join(', ') || '—',
      links.join(', ') || 'none',
      wd.length ? wd.map((p) => `${p.pid} ${p.label} = ${p.values.join(', ')}`).join('; ') : 'none',
      methods.join(', ') || '—',
      sample?.name ?? '—',
    ];
  });
  const evidence = sources.flatMap((s) =>
    [...new Set(refsToArtist(s, artist.qid).map((m) => `${m.method} (${m.confidence}): ${m.evidence}`))].map(
      (e) => `- ${label(s.name)}: ${e}`,
    ),
  );
  return `## 2. How each source identifies the artist

Authority: [${artist.qid}](https://www.wikidata.org/wiki/${artist.qid}), ${artist.name}
(${artist.birth?.slice(0, 10) ?? '?'} – ${artist.death?.slice(0, 10) ?? '?'}), looked up by English label
plus occupation "painter". Wikidata lists
${Object.keys(artist.externalIds).length} external-ID properties for him.

${table(['Source', "Source's own artist ID(s)", 'Authority links in the record', 'Wikidata lists this museum\'s ID', 'Match method', 'Name as given'], rows)}

Match evidence, one line per distinct case:

${evidence.join('\n')}`;
}

function mappingSection(sources: SourceData[]): string {
  return `## 3. Mapping to Linked Art

${sources
  .map((s) => {
    const n = Object.keys(s.validation).length;
    const schemaOk = Object.values(s.validation).filter((v) => !v.schema.length).length;
    const ldOk = Object.values(s.validation).filter((v) => !v.jsonld.length).length;
    const kinds = schemaErrorKinds(s).slice(0, 8);
    const unmapped = unmappedFields(s);
    return `### ${label(s.name)}

- Records passing the Linked Art object schema: **${schemaOk} of ${n}**. Expanding as JSON-LD: **${ldOk} of ${n}**.
- Linked Art properties produced: ${linkedArtProperties(s)
      .map(([k, c]) => `\`${k}\` (${c})`)
      .join(', ')}.
${kinds.length ? `\nSchema problems, by records affected:\n\n${table(['Problem', 'Records'], kinds)}\n` : ''}
${
  unmapped.length
    ? `Source fields with no clean Linked Art mapping:\n\n${table(
        ['Field', 'Records', 'Example'],
        unmapped.map((u) => [`\`${u.field}\``, u.records, truncate(u.example)]),
      )}`
    : 'No unmapped fields: the source is already Linked Art and is passed through.'
}`;
  })
  .join('\n\n')}`;
}

function licensingSection(sources: SourceData[]): string {
  return `## 4. Licensing

${table(
  ['Source', 'Record license', 'Field-level differences'],
  sources.map((s) => {
    const l = licenseCounts(s);
    return [
      label(s.name),
      l.record.map(([k, c]) => `${k} (${c})`).join('; '),
      l.fields.map(([k, c]) => `${k} (${c})`).join('; ') || 'none',
    ];
  }),
)}`;
}

function problemsSection(sources: SourceData[], qid: string): string {
  const lines: string[] = [];
  for (const s of sources) {
    const errors = s.harvest?.errors ?? [];
    const st = statusCounts(s, qid);
    const others = st['other-artist'].map((id) => {
      const names = s.matches.find((m) => m.recordId === id)?.matches.map((m) => m.ref.name).filter(Boolean);
      return [...new Set(names)].join(' / ');
    });
    const qualified = st.qualified.map((id) => {
      const m = s.matches.find((r) => r.recordId === id)!.matches.find((x) => x.qid === qid)!;
      return `${id}: ${truncate(m.ref.role ?? m.ref.name, 70)}`;
    });
    lines.push(`### ${label(s.name)}

- Fetch errors during harvest: ${errors.length ? errors.map((e) => `${e.id} (${e.error})`).join('; ') : 'none'}.
- Search hits by other artists: ${others.length ? `${others.length} — ${[...new Set(others)].map((n, _, a) => `${n} (${others.filter((o) => o === n).length})`).join(', ')}` : 'none'}.
- Qualified attributions: ${qualified.length ? `\n${qualified.map((q) => `  - ${q}`).join('\n')}` : 'none'}`);
  }
  return `## 5. Problems hit\n\n${lines.join('\n\n')}`;
}

export function renderReport(sources: SourceData[], artist: ArtistQuery, generatedAt: string): string {
  return `# ${artist.name} across open museum data

Generated ${generatedAt.slice(0, 10)} by \`npm run report\` from \`data/\`. Sources: ${sources.map((s) => label(s.name)).join(', ')}.
Getty data is out of scope for this phase and was not fetched; ULAN IDs appear only where a source supplies them.

${worksSection(sources, artist.qid)}

${identitySection(sources, artist)}

${mappingSection(sources)}

${licensingSection(sources)}

${problemsSection(sources, artist.qid)}
`;
}
