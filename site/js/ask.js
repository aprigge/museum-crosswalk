import { loadGraph } from './common.js';
import { ASK_URL } from './config.js';
import { renderResults } from './results.js';
import { isReadQuery, withPrefixes } from './sparql.js';

const form = document.getElementById('ask-form');
const input = document.getElementById('question');
const button = document.getElementById('ask-button');
const statusEl = document.getElementById('status');
const querySection = document.getElementById('query');
const explanationEl = document.getElementById('explanation');
const sparqlEl = document.getElementById('sparql');
const editLink = document.getElementById('edit-link');
const answerHeading = document.getElementById('answer-heading');
const answerEl = document.getElementById('answer');

if (!ASK_URL) {
  document.getElementById('unavailable').innerHTML =
    '<p class="notice">Asking questions isn’t switched on yet for this site. You can still write SPARQL yourself on the <a href="explore.html">Explore</a> page.</p>';
  input.disabled = true;
  button.disabled = true;
}

/** One round trip to the Worker: the question, and on a retry the failed query and its error. */
async function requestQuery(question, retry) {
  const res = await fetch(ASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(retry ? { question, retry } : { question }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The question service answered ${res.status}.`);
  return body;
}

function showQuery(answer) {
  querySection.hidden = false;
  explanationEl.textContent = answer.explanation;
  sparqlEl.textContent = answer.sparql;
  editLink.href = `explore.html?sparql=${encodeURIComponent(answer.sparql)}`;
}

/** Run a generated query on the in-browser graph; read-only queries only. */
async function runQuery(sparql) {
  if (!isReadQuery(sparql)) throw new Error('This query would change data, so it was not run.');
  const store = await loadGraph();
  const t0 = performance.now();
  const rows = store.query(withPrefixes(sparql), { use_default_graph_as_union: true });
  return { rows, ms: Math.round(performance.now() - t0) };
}

async function ask(question) {
  answerEl.innerHTML = '';
  answerHeading.hidden = true;
  querySection.hidden = true;
  button.disabled = true;
  statusEl.textContent = 'Asking Claude to write a query…';
  try {
    let answer = await requestQuery(question);
    if (!answer.sparql) {
      showQuery({ ...answer, sparql: '(no query)' });
      statusEl.textContent = 'The graph can’t answer that question.';
      return;
    }
    showQuery(answer);
    statusEl.textContent = 'Running the query on the graph in your browser…';
    let result;
    try {
      result = await runQuery(answer.sparql);
    } catch (err) {
      // One retry, as measured in the eval: the model sees the error and corrects its query.
      statusEl.textContent = 'The first query failed; asking Claude to correct it…';
      answer = await requestQuery(question, { sparql: answer.sparql, error: String(err.message ?? err) });
      showQuery(answer);
      result = await runQuery(answer.sparql);
    }
    answerHeading.hidden = false;
    renderResults(result.rows, result.ms, answerEl, statusEl);
  } catch (err) {
    statusEl.textContent = err.message ?? String(err);
  } finally {
    button.disabled = !ASK_URL;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) ask(q);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-q]');
  if (b && ASK_URL) {
    input.value = b.dataset.q;
    ask(b.dataset.q);
  }
});
