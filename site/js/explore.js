import { esc, ID_BASE, loadGraph } from './common.js';

const statusEl = document.getElementById('status');
const preset = document.getElementById('preset');
const runBtn = document.getElementById('run');
const textarea = document.getElementById('sparql');
const results = document.getElementById('results');

const MAX_ROWS = 500;
const short = (v) => v.replace(ID_BASE, 'id:');

/** The first comment line of a preset file names it. */
const titleOf = (text, file) => text.match(/^#\s*(.+)$/m)?.[1] ?? file;

function render(rows, ms) {
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

async function run() {
  statusEl.textContent = 'Running…';
  try {
    const store = await loadGraph();
    const t0 = performance.now();
    const rows = store.query(textarea.value, { use_default_graph_as_union: true });
    render(rows, Math.round(performance.now() - t0));
  } catch (err) {
    results.innerHTML = '';
    statusEl.textContent = `Query error: ${err.message ?? err}`;
  }
}

runBtn.addEventListener('click', run);
textarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    run();
  }
});

(async () => {
  try {
    const meta = await fetch('data/meta.json').then((r) => r.json());
    const presets = await Promise.all(
      meta.queries.map(async (file) => ({ file, text: await fetch(`data/queries/${file}`).then((r) => r.text()) })),
    );
    // Put the headline question first.
    presets.sort((a, b) => (a.file.startsWith('impressionist') ? -1 : b.file.startsWith('impressionist') ? 1 : a.file.localeCompare(b.file)));
    preset.innerHTML = presets.map((p, i) => `<option value="${i}">${esc(titleOf(p.text, p.file))}</option>`).join('');
    preset.disabled = false;
    preset.addEventListener('change', () => {
      textarea.value = presets[Number(preset.value)].text;
    });
    textarea.value = presets[0]?.text ?? '';

    const t0 = performance.now();
    const store = await loadGraph();
    statusEl.textContent = `Graph loaded: ${store.size.toLocaleString()} triples in ${Math.round(performance.now() - t0)} ms. Running the first preset…`;
    runBtn.disabled = false;
    await run();
  } catch (err) {
    statusEl.textContent = `The graph could not be loaded (${err.message}).`;
  }
})();
