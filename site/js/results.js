// Renders a SPARQL result as a table, shared by the Explore and Ask pages.
import { esc, ID_BASE } from './common.js';

const MAX_ROWS = 500;
const short = (v) => v.replace(ID_BASE, 'id:');


export function renderResults(rows, ms, results, statusEl) {
  if (typeof rows === 'boolean') {
    results.innerHTML = `<p>${rows ? 'true' : 'false'}</p>`;
    statusEl.textContent = `ASK answered in ${ms} ms.`;
    return;
  }
  if (typeof rows === 'string') {
    results.innerHTML = `<pre><code>${esc(rows)}</code></pre>`;
    statusEl.textContent = `Answered in ${ms} ms.`;
    return;
  }
  if (!rows.length) {
    results.innerHTML = '<p>No rows.</p>';
    statusEl.textContent = `No rows (${ms} ms).`;
    return;
  }
  // SELECT gives Maps of variables; CONSTRUCT/DESCRIBE give quads.
  const isQuads = rows[0].subject !== undefined;
  const head = isQuads ? ['subject', 'predicate', 'object'] : [...new Set(rows.flatMap((r) => [...r.keys()]))];
  const cell = (term) => {
    if (!term) return '';
    const v = term.value;
    const person = v.match(/id\/person\/(.+)$/);
    const work = v.match(/id\/work\/(.+)$/);
    if (person) return `<a href="artist.html?id=${encodeURIComponent(person[1])}">${esc(short(v))}</a>`;
    if (work) return `<a href="artwork.html?id=${encodeURIComponent(work[1])}">${esc(short(v))}</a>`;
    return esc(short(v));
  };
  const body = rows
    .slice(0, MAX_ROWS)
    .map((r) => `<tr>${head.map((h) => `<td>${cell(isQuads ? r[h] : r.get(h))}</td>`).join('')}</tr>`)
    .join('');
  results.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
  statusEl.textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} in ${ms} ms${rows.length > MAX_ROWS ? `, showing the first ${MAX_ROWS}` : ''}.`;
}

