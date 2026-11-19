import { esc, licenseLabel, loadIndex, MUSEUM_NAMES, years } from './common.js';
import { FIELD_EXPLANATION, processTerm, SEARCH_OPTIONS, tokenize } from './terms.js';

const form = document.getElementById('search-form');
const input = document.getElementById('q');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const facetsEl = document.getElementById('facets');
const relatedEl = document.getElementById('related');

const GROUPS_PER_PAGE = 20;
const FACETS = [
  { key: 'museum', legend: 'Museum', values: (d) => [d.museumName] },
  { key: 'style', legend: 'Style, movement or period', values: (d) => [...new Set([...d.styles, ...d.inferredStyles])] },
  { key: 'subject', legend: 'Subject', values: (d) => d.subjects, top: 12 },
  { key: 'decade', legend: 'Decade begun', values: (d) => (d.begin != null ? [`${Math.floor(d.begin / 10) * 10}s`] : []) },
];

const state = { q: '', filters: Object.fromEntries(FACETS.map((f) => [f.key, new Set()])), shownGroups: GROUPS_PER_PAGE };
let index;
let related = [];

const terms = (text) => tokenize(text).map(processTerm).filter(Boolean);

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get('q') ?? '';
  for (const f of FACETS) state.filters[f.key] = new Set(p.getAll(f.key));
  input.value = state.q;
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  for (const f of FACETS) for (const v of state.filters[f.key]) p.append(f.key, v);
  history.replaceState(null, '', p.toString() ? `?${p}` : location.pathname);
}

function passes(doc, except) {
  return FACETS.every((f) => f.key === except || !state.filters[f.key].size || f.values(doc).some((v) => state.filters[f.key].has(v)));
}

/** "impression → artist's movement (Wikidata)" for each matched term. */
function whyText(hit) {
  return Object.entries(hit.match)
    .map(([term, fields]) => `<b>${esc(term)}</b> in ${fields.map((f) => esc(FIELD_EXPLANATION[f] ?? f)).join(', ')}`)
    .join('; ');
}

function card(hit) {
  const by = hit.artists.length ? hit.artists.join(', ') : 'Unknown artist';
  const img = hit.thumb
    ? `<img referrerpolicy="no-referrer" src="${esc(hit.thumb)}" alt="${esc(`${hit.title}, ${by}`)}" loading="lazy" decoding="async">`
    : `<span class="no-image">No openly licensed image</span>`;
  const styleChips = [
    ...hit.styles.map((s) => `<li class="chip" title="Stated by the museum">${esc(s)}</li>`),
    ...hit.inferredStyles
      .filter((s) => !hit.styles.includes(s))
      .map((s) => `<li class="chip derived" title="From the artist's movement on Wikidata, not the museum">${esc(s)} <span class="visually-hidden">(from Wikidata)</span></li>`),
  ].join('');
  return `<li class="card">
    <div class="thumb">${img}</div>
    <div class="body">
      <h3><a href="artwork.html?id=${encodeURIComponent(hit.id)}">${esc(hit.title)}</a></h3>
      <p class="meta">${esc(years(hit.begin, hit.end))}${hit.begin != null ? ' · ' : ''}${esc(hit.museumName)}</p>
      ${hit.qualified.length ? `<p class="meta">Related attribution: ${esc(hit.qualified.join(', '))}</p>` : ''}
      ${styleChips ? `<ul class="chips" aria-label="Style or movement">${styleChips}</ul>` : ''}
      <p class="why">Matched ${whyText(hit)}</p>
      <p class="meta"><span class="badge" title="Licence of the record's data">Data: ${esc(licenseLabel(hit.license))}</span></p>
    </div>
  </li>`;
}

function renderFacets(hits) {
  facetsEl.innerHTML = FACETS.map((f) => {
    const counts = new Map();
    for (const h of hits.filter((d) => passes(d, f.key))) for (const v of f.values(h)) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const v of state.filters[f.key]) if (!counts.has(v)) counts.set(v, 0);
    let entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    if (f.key === 'decade') entries.sort((a, b) => a[0].localeCompare(b[0]));
    if (f.top) entries = entries.filter(([v], i) => i < f.top || state.filters[f.key].has(v));
    if (!entries.length) return '';
    return `<fieldset><legend>${esc(f.legend)}</legend>${entries
      .map(([v, n]) => `<label><input type="checkbox" name="${f.key}" value="${esc(v)}" ${state.filters[f.key].has(v) ? 'checked' : ''}> <span>${esc(v)}</span> <span class="count">${n}</span></label>`)
      .join('')}</fieldset>`;
  }).join('');
}

function renderRelated() {
  const q = new Set(terms(state.q));
  const offers = related.filter((r) => terms(r.related).every((t) => q.has(t)) && !terms(r.label).every((t) => q.has(t)));
  relatedEl.innerHTML = offers
    .map(
      (r) => `<p class="notice">Related movement: <strong>${esc(r.label)}</strong>. The project links it to ${esc(r.related)} as related, not the same,
        so it is not included here. <button type="button" class="secondary" data-q="${esc(r.label)}">Search ${esc(r.label)}</button></p>`,
    )
    .join('');
}

function render() {
  if (!state.q.trim()) {
    resultsEl.innerHTML = '';
    facetsEl.innerHTML = '';
    relatedEl.innerHTML = '';
    statusEl.textContent = `${index.documentCount.toLocaleString()} paintings indexed. Try a search.`;
    return;
  }
  const all = index.search(state.q, SEARCH_OPTIONS);
  const hits = all.filter((d) => passes(d));
  renderFacets(all);
  renderRelated();

  // Group by the merged person: the same key across museums is one Wikidata person.
  const groups = new Map();
  for (const h of hits) {
    const key = h.artistKeys[0] ?? `none:${h.id}`;
    const g = groups.get(key) ?? groups.set(key, { key, name: h.artists[0] ?? 'Unknown artist', hits: [], museums: new Set(), score: 0 }).get(key);
    g.hits.push(h);
    g.museums.add(h.museumName);
    g.score += h.score;
  }
  const ordered = [...groups.values()].sort((a, b) => b.museums.size - a.museums.size || b.score - a.score);
  const cross = ordered.filter((g) => g.museums.size > 1).length;
  const museums = new Set(hits.map((h) => h.museumName));
  statusEl.textContent = hits.length
    ? `${hits.length} painting${hits.length === 1 ? '' : 's'} from ${museums.size} museum${museums.size === 1 ? '' : 's'}, grouped by ${ordered.length} artist${ordered.length === 1 ? '' : 's'}` +
      (cross ? `; ${cross} with works in more than one museum.` : '.')
    : `No paintings match “${state.q}”.`;

  resultsEl.innerHTML =
    ordered
      .slice(0, state.shownGroups)
      .map((g) => {
        const isPerson = !g.key.startsWith('none:');
        const name = isPerson ? `<a href="artist.html?id=${encodeURIComponent(g.key)}">${esc(g.name)}</a>` : esc(g.name);
        return `<section class="group" aria-label="${esc(g.name)}">
          <header><h2>${name}</h2><span class="museums">${[...g.museums].map(esc).join(' · ')}</span></header>
          <ul class="cards">${g.hits.map(card).join('')}</ul>
        </section>`;
      })
      .join('') +
    (ordered.length > state.shownGroups ? `<p><button type="button" class="secondary" id="more">Show more artists (${ordered.length - state.shownGroups} more)</button></p>` : '');
}

function run(q) {
  state.q = q;
  input.value = q;
  state.shownGroups = GROUPS_PER_PAGE;
  writeUrl();
  render();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  for (const f of FACETS) state.filters[f.key].clear();
  run(input.value);
});

document.addEventListener('click', (e) => {
  const q = e.target.closest('[data-q]');
  if (q) {
    for (const f of FACETS) state.filters[f.key].clear();
    run(q.dataset.q);
    input.focus();
  }
  if (e.target.id === 'more') {
    state.shownGroups += GROUPS_PER_PAGE;
    render();
  }
});

facetsEl.addEventListener('change', (e) => {
  const box = e.target;
  if (box.type !== 'checkbox') return;
  const set = state.filters[box.name];
  box.checked ? set.add(box.value) : set.delete(box.value);
  state.shownGroups = GROUPS_PER_PAGE;
  writeUrl();
  render();
  facetsEl.querySelector(`input[name="${CSS.escape(box.name)}"][value="${CSS.escape(box.value)}"]`)?.focus();
});

(async () => {
  try {
    const [ix, rel, meta] = await Promise.all([
      loadIndex(),
      fetch('data/related.json').then((r) => (r.ok ? r.json() : [])),
      fetch('data/meta.json').then((r) => (r.ok ? r.json() : null)),
    ]);
    index = ix;
    related = rel;
    const partial = Object.entries(meta?.harvests ?? {}).filter(([, h]) => !h.complete);
    if (partial.length) {
      document.getElementById('partial-notice').innerHTML = `<p class="notice">Partial data: ${partial
        .map(([s, h]) => `${esc(MUSEUM_NAMES[s] ?? s)} (${h.works} paintings so far)`)
        .join(', ')}. Its firewall blocked the harvest; it resumes at a slower pace. <a href="about.html#data">More</a></p>`;
    }
    readUrl();
    render();
  } catch (err) {
    statusEl.textContent = `The search index could not be loaded (${err.message}).`;
  }
})();
