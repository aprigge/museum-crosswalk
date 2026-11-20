import { esc, ID_BASE, MUSEUM_NAMES, PREFIXES, safeHref, select } from './common.js';

// Rembrandt's "full picture": every section is one SPARQL query over the in-browser graph,
// shown with a link to run it in Explore.

const statusEl = document.getElementById('status');
const page = document.getElementById('page');
const ARTIST = `<${ID_BASE}person/Q5598>`;
const WD = '<http://www.wikidata.org/entity/Q5598>';
const TYPES = ['print', 'drawing', 'painting'];
const PRINTS_SHOWN = 24;
const THUMBS_PER_PRINT = 6;

const Q = {
  holdings: `SELECT ?museum ?type ?how (COUNT(DISTINCT ?work) AS ?works) WHERE {
  { ?work mc:artist ${ARTIST} . BIND("by" AS ?how) }
  UNION {
    # "After", school, workshop: merged to Rembrandt, or kept unmerged by policy but matched to him.
    { ?work mc:qualifiedArtist ${ARTIST} } UNION { ?work mc:qualifiedArtist/mc:sourceAgent/mc:matchCandidate ${WD} }
    FILTER NOT EXISTS { ?work mc:artist ${ARTIST} }
    BIND("related" AS ?how)
  }
  ?work mc:museum ?museum .
  OPTIONAL { ?work mc:objectType ?t }
  BIND(COALESCE(?t, "other") AS ?type)
} GROUP BY ?museum ?type ?how`,

  spread: `SELECT ?museums (COUNT(?print) AS ?prints) WHERE {
  { SELECT ?print (COUNT(DISTINCT ?museum) AS ?museums) WHERE {
      ?print a mc:Print ; mc:artist ${ARTIST} .
      ?work mc:impressionOf ?print ; mc:museum ?museum .
  } GROUP BY ?print }
} GROUP BY ?museums ORDER BY DESC(?museums)`,

  prints: `SELECT ?print ?title ?bartsch ?newHollstein ?conflict
       (COUNT(DISTINCT ?museum) AS ?museums) (COUNT(DISTINCT ?work) AS ?impressions)
       (GROUP_CONCAT(DISTINCT ?museum; separator=",") AS ?where) WHERE {
  ?print a mc:Print ; mc:artist ${ARTIST} .
  OPTIONAL { ?print dcterms:title ?title }
  OPTIONAL { ?print mc:bartsch ?bartsch }
  OPTIONAL { ?print mc:newHollstein ?newHollstein }
  OPTIONAL { ?print mc:groupingConflict ?conflict }
  ?work mc:impressionOf ?print ; mc:museum ?museum .
} GROUP BY ?print ?title ?bartsch ?newHollstein ?conflict
ORDER BY DESC(?museums) DESC(?impressions) ?bartsch`,

  impressions: `SELECT ?print ?work ?museum ?thumb ?state WHERE {
  ?print a mc:Print ; mc:artist ${ARTIST} .
  ?work mc:impressionOf ?print ; mc:museum ?museum .
  OPTIONAL { ?work schema:thumbnailUrl ?thumb }
  OPTIONAL { ?work mc:state ?state }
}`,

  timeline: `SELECT ?decade ?type (COUNT(DISTINCT ?work) AS ?works) WHERE {
  ?work mc:artist ${ARTIST} .
  OPTIONAL { ?work mc:objectType ?t }
  OPTIONAL { ?work mc:beginYear ?begin }
  BIND(COALESCE(?t, "other") AS ?type)
  BIND(IF(BOUND(?begin), STR(FLOOR(?begin / 10) * 10), "undated") AS ?decade)
} GROUP BY ?decade ?type ORDER BY ?decade`,

  ungrouped: `SELECT ?museum (COUNT(DISTINCT ?work) AS ?prints) (COUNT(DISTINCT ?cited) AS ?withNumbers) WHERE {
  ?work mc:artist ${ARTIST} ; mc:objectType "print" ; mc:museum ?museum .
  FILTER NOT EXISTS { ?work mc:impressionOf ?any }
  OPTIONAL { ?work mc:catalogueRef ?ref . BIND(?work AS ?cited) }
} GROUP BY ?museum ORDER BY DESC(?prints)`,
};

const museumName = (m) => MUSEUM_NAMES[m] ?? m;
const exploreLink = (query) => `<p class="muted"><a href="explore.html?sparql=${encodeURIComponent(`${PREFIXES}\n${query}`)}">See this query in Explore →</a></p>`;
const n = (v) => Number(v ?? 0);
const printKey = (iri) => iri.replace(`${ID_BASE}print/`, '');
const workId = (iri) => iri.replace(`${ID_BASE}work/`, '');

function holdingsTable(rows) {
  const museums = [...new Set(rows.map((r) => r.museum))];
  const count = (m, type, how) => rows.filter((r) => r.museum === m && (type === null || r.type === type) && r.how === how).reduce((s, r) => s + n(r.works), 0);
  museums.sort((a, b) => count(b, null, 'by') - count(a, null, 'by'));
  const total = (type, how) => museums.reduce((s, m) => s + count(m, type, how), 0);
  const cells = (m) => TYPES.map((t) => `<td class="num">${count(m, t, 'by') || '–'}</td>`).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Museum</th>${TYPES.map((t) => `<th scope="col" class="num">${t[0].toUpperCase()}${t.slice(1)}s</th>`).join('')}
      <th scope="col" class="num">All by Rembrandt</th><th scope="col" class="num">After, school, workshop…</th></tr></thead>
    <tbody>${museums.map((m) => `<tr><th scope="row">${esc(museumName(m))}</th>${cells(m)}<td class="num"><strong>${count(m, null, 'by')}</strong></td><td class="num">${count(m, null, 'related')}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th scope="row">All five</th>${TYPES.map((t) => `<td class="num">${total(t, 'by')}</td>`).join('')}<td class="num"><strong>${total(null, 'by')}</strong></td><td class="num">${total(null, 'related')}</td></tr></tfoot>
  </table></div>`;
}

function printCard(p, thumbsFor) {
  const key = printKey(p.print);
  const where = p.where.split(',').sort();
  const imps = (thumbsFor.get(p.print) ?? []).filter((i) => safeHref(i.thumb)).slice(0, THUMBS_PER_PRINT);
  const numbers = [p.bartsch && `Bartsch ${p.bartsch}`, p.newHollstein && `New Hollstein ${p.newHollstein}`].filter(Boolean).join(' · ');
  return `<li class="print" id="${esc(key)}">
    <h3>${esc(p.title ?? 'Untitled print')}</h3>
    <p class="meta">${esc(numbers)} · ${n(p.impressions)} impression${n(p.impressions) === 1 ? '' : 's'} in ${n(p.museums)} museum${n(p.museums) === 1 ? '' : 's'}</p>
    <p>${where.map((m) => `<span class="chip">${esc(museumName(m))}</span>`).join(' ')}</p>
    ${imps.length ? `<ul class="impressions">${imps.map((i) => `<li><a href="artwork.html?id=${encodeURIComponent(workId(i.work))}">
      <img referrerpolicy="no-referrer" src="${esc(i.thumb)}" alt="${esc(`${p.title ?? 'Print'}, impression at ${museumName(i.museum)}${i.state ? `, state ${i.state}` : ''}`)}" loading="lazy">
      <span>${esc(museumName(i.museum))}${i.state ? ` · ${esc(i.state)}` : ''}</span></a></li>`).join('')}</ul>` : ''}
    ${p.conflict ? `<p class="muted">Note: ${esc(p.conflict)}</p>` : ''}
  </li>`;
}

function timeline(rows) {
  const decades = [...new Set(rows.map((r) => r.decade))].sort((a, b) => (a === 'undated') - (b === 'undated') || a.localeCompare(b));
  const by = (d, t) => rows.filter((r) => r.decade === d && r.type === t).reduce((s, r) => s + n(r.works), 0);
  const totals = decades.map((d) => TYPES.reduce((s, t) => s + by(d, t), 0));
  const max = Math.max(...totals, 1);
  return `<div class="timeline" role="img" aria-label="Works by Rembrandt by decade begun and object type">
    ${decades.map((d, i) => `<div class="row"><span class="label">${esc(d === 'undated' ? 'Undated' : `${d}s`)}</span>
      <span class="bar">${TYPES.map((t) => (by(d, t) ? `<span class="seg ${t}" style="width:${((by(d, t) / max) * 100).toFixed(1)}%" title="${by(d, t)} ${t}s"></span>` : '')).join('')}</span>
      <span class="num">${totals[i]}</span></div>`).join('')}
  </div>
  <p class="legend">${TYPES.map((t) => `<span><span class="swatch ${t}"></span>${t}s</span>`).join(' ')}</p>
  <div class="table-wrap visually-hidden"><table><caption>Works by decade</caption>
    <thead><tr><th scope="col">Decade</th>${TYPES.map((t) => `<th scope="col">${t}s</th>`).join('')}</tr></thead>
    <tbody>${decades.map((d) => `<tr><th scope="row">${esc(d)}</th>${TYPES.map((t) => `<td>${by(d, t)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

(async () => {
  try {
    const run = (q) => select(`${PREFIXES}\n${q}`);
    const [holdings, spread, prints, impressions, decades, ungrouped] = await Promise.all([
      run(Q.holdings), run(Q.spread), run(Q.prints), run(Q.impressions), run(Q.timeline), run(Q.ungrouped),
    ]);
    statusEl.textContent = '';

    // Impressions with images first, then by museum, for each print's thumbnail strip.
    const thumbsFor = new Map();
    for (const i of impressions.sort((a, b) => (!a.thumb - !b.thumb) || a.museum.localeCompare(b.museum))) {
      (thumbsFor.get(i.print) ?? thumbsFor.set(i.print, []).get(i.print)).push(i);
    }
    const impressionCount = prints.reduce((s, p) => s + n(p.impressions), 0);
    const spreadText = spread.map((s) => `<li><strong>${n(s.prints)}</strong> held by ${n(s.museums)} museum${n(s.museums) === 1 ? '' : 's'}</li>`).join('');

    page.innerHTML = `
      <p><a href="artist.html?id=Q5598">How each museum’s record of Rembrandt was matched to Wikidata →</a></p>

      <h2 id="holdings">Holdings by museum</h2>
      <p>Works plainly by Rembrandt, by object type as each museum states it. Records “after” him, by his school or workshop,
        or once ascribed to him are counted separately and never as his.</p>
      ${holdingsTable(holdings)}
      ${exploreLink(Q.holdings)}

      <h2 id="prints">Prints and their impressions</h2>
      <p>A print is one copper plate printed many times; each museum holds its own impressions. The graph groups
        <strong>${impressionCount}</strong> impressions into <strong>${prints.length}</strong> prints by the catalogue numbers the museums
        cite (Bartsch / Hollstein and New Hollstein), never by title.</p>
      <ul class="spread">${spreadText}</ul>
      ${exploreLink(Q.spread)}
      <h3>Held most widely</h3>
      <ul class="prints" id="print-list">${prints.slice(0, PRINTS_SHOWN).map((p) => printCard(p, thumbsFor)).join('')}</ul>
      ${prints.length > PRINTS_SHOWN ? `<button type="button" class="secondary" id="all-prints">Show all ${prints.length} prints</button>` : ''}
      ${exploreLink(Q.prints)}

      <h2 id="timeline">Timeline</h2>
      <p>Works plainly by Rembrandt by the decade each was begun, as the museums date them. A few impressions are dated after his death:
        museums date some later impressions by when they were printed, not when the plate was made.</p>
      ${timeline(decades)}
      ${exploreLink(Q.timeline)}

      <h2 id="gaps">What could not be grouped</h2>
      <p>Prints by Rembrandt with no print group, by museum. The Met’s API gives no catalogue numbers, so none of its impressions can be
        grouped; elsewhere a record may cite no number, or numbers of two different prints (a sheet with several).</p>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Museum</th><th scope="col" class="num">Ungrouped prints</th><th scope="col" class="num">Of which cite a catalogue number</th></tr></thead>
        <tbody>${ungrouped.map((u) => `<tr><th scope="row">${esc(museumName(u.museum))}</th><td class="num">${n(u.prints)}</td><td class="num">${n(u.withNumbers)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${exploreLink(Q.ungrouped)}`;

    document.getElementById('all-prints')?.addEventListener('click', (e) => {
      document.getElementById('print-list').innerHTML = prints.map((p) => printCard(p, thumbsFor)).join('');
      e.target.remove();
    });
    // A link to one print (from an artwork page) may point past the first few: show them all.
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && !document.getElementById(hash) && prints.some((p) => printKey(p.print) === hash)) document.getElementById('all-prints')?.click();
    if (hash) document.getElementById(hash)?.scrollIntoView();
  } catch (err) {
    statusEl.textContent = `The graph could not be loaded (${err.message}).`;
  }
})();
