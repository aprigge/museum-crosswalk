import { esc, ID_BASE, MUSEUM_NAMES, param, PREFIXES, safeHref, select } from './common.js';

const el = document.getElementById('artist');
const key = param('id');

/** SPARQL string literal or IRI built from a key we control the shape of. */
// Keys arrive in the graph's encoded form ("smk-Jan%20van%20Vliet"); normalise so they're encoded once.
const personIri = (k) => `<${ID_BASE}person/${encodeURIComponent(decodeURIComponent(k)).replace(/%2F/g, '/')}>`;

/** Artists with a "full picture" page of their own. */
const FULL_PICTURE = { 'http://www.wikidata.org/entity/Q5598': 'rembrandt.html' };
/** Cards shown before "Show all": an artist with thousands of works stays quick to open. */
const CARDS = 60;

const METHOD = {
  'exact-id': 'The museum links this Wikidata person directly',
  'wikidata-crosswalk': 'Wikidata lists the museum’s own ID for this person',
  'name-dates': 'Name and life years',
  'human-approved': 'A person approved the match (the evidence says whether an AI proposed it)',
  none: 'No match',
};
const DECISION = { merged: 'Merged', review: 'In review', unmatched: 'Not matched', 'kept-separate': 'Kept separate (a person decided)' };

(async () => {
  if (!key) {
    el.innerHTML = '<p>No artist given. <a href="./">Search</a> for one.</p>';
    return;
  }
  try {
    const p = personIri(key);
    const [person] = await select(`${PREFIXES}
SELECT ?name ?wd ?birth ?death WHERE {
  ${p} rdfs:label ?name .
  OPTIONAL { ${p} owl:sameAs ?wd } OPTIONAL { ${p} mc:birthYear ?birth } OPTIONAL { ${p} mc:deathYear ?death }
} LIMIT 1`);
    if (!person) {
      el.innerHTML = `<p>No artist with the id “${esc(key)}” in the graph. <a href="./">Search</a> instead.</p>`;
      return;
    }
    document.title = `${person.name} · Museum Crosswalk`;
    const [movements, agents, works] = await Promise.all([
      select(`${PREFIXES} SELECT ?label WHERE { ${p} mc:movement/skos:prefLabel ?label } ORDER BY ?label`),
      select(`${PREFIXES}
SELECT ?museum ?label ?source ?decision ?method ?confidence ?evidence ?reason WHERE {
  ${p} mc:sourceAgent ?agent . ?agent mc:museum ?museum ; mc:matchDecision ?decision .
  OPTIONAL { ?agent rdfs:label ?label } OPTIONAL { ?agent skos:exactMatch ?source }
  OPTIONAL { ?agent mc:matchMethod ?method } OPTIONAL { ?agent mc:matchConfidence ?confidence }
  OPTIONAL { ?agent mc:matchEvidence ?evidence } OPTIONAL { ?agent mc:reviewReason ?reason }
} ORDER BY ?museum`),
      select(`${PREFIXES}
SELECT ?work ?title ?museum ?begin ?thumb ?how WHERE {
  { ?work mc:artist ${p} . BIND("by" AS ?how) } UNION { ?work mc:qualifiedArtist ${p} . BIND("related" AS ?how) }
  ?work mc:museum ?museum .
  OPTIONAL { ?work dcterms:title ?title } OPTIONAL { ?work mc:beginYear ?begin } OPTIONAL { ?work schema:thumbnailUrl ?thumb }
} ORDER BY ?begin ?title`),
    ]);

    const life = person.birth ? `${person.birth}–${person.death ?? ''}` : '';
    const museums = [...new Set(works.map((w) => w.museum))];
    const wdHref = safeHref(person.wd?.replace('http://www.wikidata.org/entity/', 'https://www.wikidata.org/wiki/'));
    const workCard = (w) => {
      const id = w.work.replace(`${ID_BASE}work/`, '');
      const thumb = safeHref(w.thumb);
      return `<li class="card">
        <div class="thumb">${thumb ? `<img referrerpolicy="no-referrer" src="${esc(thumb)}" alt="${esc(`${w.title ?? 'Untitled'}, ${person.name}`)}" loading="lazy">` : '<span class="no-image">No openly licensed image</span>'}</div>
        <div class="body"><h3><a href="artwork.html?id=${encodeURIComponent(id)}">${esc(w.title ?? 'Untitled')}</a></h3>
        <p class="meta">${esc(w.begin ?? '')}${w.begin ? ' · ' : ''}${esc(MUSEUM_NAMES[w.museum] ?? w.museum)}</p></div>
      </li>`;
    };
    const cardList = (list, name) =>
      `<ul class="cards">${list.slice(0, CARDS).map(workCard).join('')}</ul>` +
      (list.length > CARDS ? `<button type="button" class="secondary" data-show-all="${name}">Show all ${list.length}</button>` : '');
    const by = works.filter((w) => w.how === 'by');
    const related = works.filter((w) => w.how === 'related');

    el.innerHTML = `
      <h1>${esc(person.name)}</h1>
      <p class="lede">${life ? `${esc(life)}. ` : ''}${by.length} work${by.length === 1 ? '' : 's'} in
        ${museums.length} museum${museums.length === 1 ? '' : 's'}${museums.length ? `: ${museums.map((m) => esc(MUSEUM_NAMES[m] ?? m)).join(', ')}` : ''}.
        ${wdHref ? `<a href="${esc(wdHref)}">Wikidata ${esc(person.wd.split('/').at(-1))}</a>` : '<strong>Not matched to Wikidata</strong>: shown as the museum’s own record.'}</p>
      ${FULL_PICTURE[person.wd] ? `<p class="notice"><a href="${FULL_PICTURE[person.wd]}">See the full picture</a>: holdings by museum, prints and their impressions across museums, and a timeline.</p>` : ''}
      ${movements.length ? `<p>Movement on Wikidata: ${movements.map((m) => `<span class="chip">${esc(m.label)}</span>`).join(' ')}</p>` : ''}

      <h2>How each museum’s record was matched</h2>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Museum</th><th scope="col">Name in the museum’s data</th><th scope="col">Result</th><th scope="col">How</th><th scope="col">Evidence</th></tr></thead>
        <tbody>${agents
          .map((a) => {
            const src = safeHref(a.source);
            return `<tr>
              <td>${esc(MUSEUM_NAMES[a.museum] ?? a.museum)}</td>
              <td>${src ? `<a href="${esc(src)}">${esc(a.label ?? '')}</a>` : esc(a.label ?? '')}</td>
              <td>${esc(DECISION[a.decision] ?? a.decision)}${a.confidence ? ` <span class="muted">(${Number(a.confidence).toFixed(2)})</span>` : ''}</td>
              <td>${esc(METHOD[a.method] ?? a.method ?? '')}</td>
              <td>${esc(a.evidence ?? '')}${a.reason ? `<br><span class="muted">${esc(a.reason)}</span>` : ''}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table></div>

      <h2>Works</h2>
      ${cardList(by, 'by')}
      ${related.length ? `<h2>Related attributions</h2><p class="muted">After, attributed to, or imitating this artist: not counted as theirs.</p>${cardList(related, 'related')}` : ''}`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-show-all]');
      if (!b) return;
      const list = b.dataset.showAll === 'by' ? by : related;
      b.previousElementSibling.innerHTML = list.map(workCard).join('');
      b.remove();
    });
  } catch (err) {
    el.innerHTML = `<p>The graph could not be loaded (${esc(err.message)}).</p>`;
  }
})();
