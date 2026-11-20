import { esc, loadGraph } from './common.js';
import { renderResults } from './results.js';
import { withPrefixes } from './sparql.js';

const statusEl = document.getElementById('status');
const preset = document.getElementById('preset');
const runBtn = document.getElementById('run');
const textarea = document.getElementById('sparql');
const results = document.getElementById('results');

/** The first comment line of a preset file names it. */
const titleOf = (text, file) => text.match(/^#\s*(.+)$/m)?.[1] ?? file;


async function run() {
  statusEl.textContent = 'Running…';
  try {
    const store = await loadGraph();
    const t0 = performance.now();
    // Standard prefixes are added when a query declares none, as on the Ask page.
    const rows = store.query(withPrefixes(textarea.value), { use_default_graph_as_union: true });
    renderResults(rows, Math.round(performance.now() - t0), results, statusEl);
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
    // A query handed over from the Ask page (?sparql=...) wins over the first preset.
    const handed = new URLSearchParams(location.search).get('sparql');
    textarea.value = handed ?? presets[0]?.text ?? '';

    const t0 = performance.now();
    const store = await loadGraph();
    statusEl.textContent = `Graph loaded: ${store.size.toLocaleString()} triples in ${Math.round(performance.now() - t0)} ms. Running the first preset…`;
    runBtn.disabled = false;
    await run();
  } catch (err) {
    statusEl.textContent = `The graph could not be loaded (${err.message}).`;
  }
})();
