import { allDocs, catalogueLabel, esc, ID_BASE, licenseLabel, loadIndex, MUSEUM_NAMES, param, PREFIXES, safeHref, select, years } from './common.js';
import { setupTabs } from './tabs.js';

const workEl = document.getElementById('work');
const layers = document.getElementById('layers');
const id = param('id');

// Back to the results the reader came from, if they came from search.
const back = document.getElementById('back');
if (document.referrer && new URL(document.referrer).origin === location.origin && /\?q=/.test(document.referrer)) {
  back.href = document.referrer;
  back.textContent = '← Back to results';
}

const AAT_DESCRIPTION = /300435416$/;

/** A larger image than the search thumbnail where the source serves sizes. */
const largeImage = (thumb) => thumb?.replace('/full/400,/', '/full/843,/');

function descriptionOf(record) {
  const s = (record.referred_to_by ?? []).find((st) => (st.classified_as ?? []).some((c) => AAT_DESCRIPTION.test(c.id ?? '')));
  return s?.content;
}

/**
 * The museum's description is third-party HTML: never insert it as is. Keep only its
 * paragraphs' text, escaped.
 */
function safeParagraphs(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [...doc.body.querySelectorAll('p')].map((p) => p.textContent.trim()).filter(Boolean);
  const paras = blocks.length ? blocks : [doc.body.textContent.trim()].filter(Boolean);
  return paras.map((t) => `<p>${esc(t)}</p>`).join('');
}

/** Short form of a URI for display: our ids, common vocabularies, else the URI itself. */
function short(uri) {
  return uri
    .replace(ID_BASE, '')
    .replace('https://aprigge.github.io/museum-crosswalk/ns#', 'mc:')
    .replace('https://aprigge.github.io/museum-crosswalk/graph/', 'graph/')
    .replace('http://www.w3.org/2004/02/skos/core#', 'skos:')
    .replace('http://purl.org/dc/terms/', 'dcterms:')
    .replace('http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'rdf:')
    .replace('http://www.w3.org/2000/01/rdf-schema#', 'rdfs:')
    .replace('https://schema.org/', 'schema:')
    .replace('http://www.w3.org/ns/prov#', 'prov:');
}

function linkFor(uri) {
  const m = uri.match(/id\/(person|concept)\/(.+)$/);
  if (m?.[1] === 'person') return `artist.html?id=${encodeURIComponent(m[2])}`;
  return /^https?:/.test(uri) ? uri : null;
}

async function graphPanel(panel, workUri) {
  panel.innerHTML = '<p role="status">Loading the graph into Oxigraph in your browser…</p>';
  try {
    const t0 = performance.now();
    const rows = await select(`${PREFIXES}
SELECT ?g ?p ?o WHERE { GRAPH ?g { <${workUri}> ?p ?o } } ORDER BY ?g ?p`);
    const ms = Math.round(performance.now() - t0);
    const sparql = `SELECT ?g ?p ?o WHERE {\n  GRAPH ?g { <${workUri}> ?p ?o }\n}`;
    panel.innerHTML = `<p class="muted">${rows.length} statements about this work, from ${new Set(rows.map((r) => r.g)).size} named graphs.
      Answered in ${ms} ms by Oxigraph running in your browser. Statements in <code>graph/derived</code> are inferred, not stated by the museum.</p>
      <details><summary>The SPARQL query</summary><pre><code>${esc(sparql)}</code></pre></details>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Graph</th><th scope="col">Property</th><th scope="col">Value</th></tr></thead>
        <tbody>${rows
          .map((r) => {
            const href = linkFor(r.o) && (linkFor(r.o).startsWith('artist.html') ? linkFor(r.o) : safeHref(linkFor(r.o)));
            const value = href ? `<a href="${esc(href)}">${esc(short(r.o))}</a>` : esc(short(r.o));
            return `<tr><td>${esc(short(r.g))}</td><td>${esc(short(r.p))}</td><td>${value}</td></tr>`;
          })
          .join('')}</tbody>
      </table></div>
      <p><a href="explore.html">Write your own query →</a></p>`;
  } catch (err) {
    panel.innerHTML = `<p>The graph could not be loaded (${esc(err.message)}).</p>`;
  }
}

(async () => {
  if (!id) {
    workEl.innerHTML = '<p>No artwork given. <a href="./">Search</a> for one.</p>';
    return;
  }
  try {
    const index = await loadIndex();
    const doc = index.getStoredFields(id);
    if (!doc) {
      workEl.innerHTML = `<p>No artwork with the id “${esc(id)}”. <a href="./">Search</a> for one.</p>`;
      return;
    }
    document.title = `${doc.title} · Museum Crosswalk`;
    // Other impressions of the same print, museum by museum.
    const impressions = doc.print
      ? allDocs(index, (r) => r.print?.key === doc.print.key && r.id !== id).sort((a, b) => a.museum.localeCompare(b.museum))
      : [];
    const record = await fetch(doc.record).then((r) => r.json());
    const prov = record._provenance ?? {};
    const museumPage = safeHref(doc.url);
    // Images can carry their own licence (Rijksmuseum: Public Domain Mark on CC0 metadata).
    const imageProv = Object.entries(record._fieldProvenance ?? {}).find(([k]) => /image|representation/.test(k))?.[1];
    const imageLicense = imageProv?.license ?? prov.license;
    const apiUrl = safeHref(prov.sourceUrl);
    const descField = record._fieldProvenance?.['referred_to_by[Description]'];
    const description = descriptionOf(record);
    const artists = doc.artists.length
      ? doc.artists.map((a, i) => `<a href="artist.html?id=${encodeURIComponent(doc.artistKeys[i])}">${esc(a)}</a>`).join(', ')
      : 'Unknown';
    const img = doc.thumb
      ? `<figure><img referrerpolicy="no-referrer" src="${esc(largeImage(doc.thumb))}" alt="${esc(`${doc.title}, ${doc.artists.join(', ') || 'unknown artist'}`)}">
          <figcaption>Image: ${esc(doc.museumName)}, ${esc(licenseLabel(imageLicense))}.</figcaption></figure>`
      : `<p class="muted">No openly licensed image. ${museumPage ? `<a href="${esc(museumPage)}">See it on the museum's site</a>.` : ''}</p>`;

    workEl.innerHTML = `<article class="work">
      <div>${img}</div>
      <div>
        <h1>${esc(doc.title)}</h1>
        <dl class="facts">
          <dt>Artist</dt><dd>${artists}</dd>
          ${doc.qualified.length ? `<dt>Related attribution</dt><dd>${esc(doc.qualified.join(', '))}</dd>` : ''}
          ${doc.begin != null ? `<dt>Date</dt><dd>${esc(years(doc.begin, doc.end))}</dd>` : ''}
          <dt>Museum</dt><dd>${museumPage ? `<a href="${esc(museumPage)}">${esc(doc.museumName)}</a>` : esc(doc.museumName)}</dd>
          ${doc.objectType && doc.objectType !== 'other' ? `<dt>Object type</dt><dd>${esc(doc.objectType)}</dd>` : ''}
          ${doc.print ? `<dt>Print</dt><dd>An impression of <a href="rembrandt.html#${esc(doc.print.key)}">${esc(doc.print.title ?? 'this print')}</a>
            (${esc(catalogueLabel(doc.print.key))}); ${impressions.length ? `${impressions.length} other impression${impressions.length === 1 ? '' : 's'} below` : 'no other impression found'}</dd>` : ''}
          ${doc.styles.length ? `<dt>Style (museum)</dt><dd>${esc(doc.styles.join(', '))}</dd>` : ''}
          ${doc.inferredStyles.length ? `<dt>Movement (Wikidata)</dt><dd>${esc(doc.inferredStyles.join(', '))} <span class="muted">— from the artist, not stated by the museum</span></dd>` : ''}
          ${doc.subjects.length ? `<dt>Subjects</dt><dd>${esc(doc.subjects.slice(0, 20).join(', '))}</dd>` : ''}
          <dt>Record licence</dt><dd>${esc(licenseLabel(doc.license))}</dd>
          ${doc.thumb && imageLicense !== doc.license ? `<dt>Image licence</dt><dd>${esc(licenseLabel(imageLicense))}</dd>` : ''}
        </dl>
        ${
          doc.aiDetail?.length
            ? `<h2>AI-suggested subjects</h2>
               <p class="muted">Suggested by an AI model (Claude) from the image, not by the museum. Kept in their own graph,
                 <code>graph/ai</code>; <a href="about.html#ai">how this works</a>.</p>
               <ul class="ai-list">${doc.aiDetail
                 .map((a) => `<li><span class="chip ai">AI</span> <strong>${esc(a.label)}</strong> <span class="muted">${Math.round(a.confidence * 100)}%</span> — ${esc(a.evidence)}</li>`)
                 .join('')}</ul>`
            : ''
        }
        ${
          impressions.length
            ? `<h2>Other impressions of this print</h2>
               <p class="muted">The same plate, printed and held separately. Grouped by the catalogue number the museums cite, never by title.</p>
               <ul class="impressions">${impressions
                 .map((d) => `<li><a href="artwork.html?id=${encodeURIComponent(d.id)}">${d.thumb ? `<img referrerpolicy="no-referrer" src="${esc(d.thumb)}" alt="" loading="lazy">` : ''}
                   <span>${esc(MUSEUM_NAMES[d.museum] ?? d.museum)}</span></a></li>`)
                 .join('')}</ul>`
            : ''
        }
        ${
          description
            ? `<h2>Description</h2><div class="description">${safeParagraphs(description)}</div>
               <p class="muted">Description © Art Institute of Chicago, ${esc(licenseLabel(descField?.license))}.</p>`
            : ''
        }
      </div>
    </article>`;

    const workUri = `${ID_BASE}work/${id}`;
    document.getElementById('panel-api').innerHTML = `
      <p>The record came from this request to the ${esc(doc.museumName)} API:</p>
      <pre><code>GET ${esc(prov.sourceUrl ?? '')}</code></pre>
      ${apiUrl ? `<p><a href="${esc(apiUrl)}">Open the live API response</a> (fetched for this site on ${esc((prov.fetchedAt ?? '').slice(0, 10))}).</p>` : ''}
      <h3>Provenance carried with the record</h3>
      <pre><code>${esc(JSON.stringify({ _provenance: record._provenance, _fieldProvenance: record._fieldProvenance }, null, 2))}</code></pre>`;
    document.getElementById('panel-la').innerHTML = `
      <p>The record converted to <a href="https://linked.art/">Linked Art</a> JSON-LD${
        doc.museum === 'rijksmuseum' ? ' (the Rijksmuseum publishes Linked Art itself, so it is passed through)' : ''
      }. This file is served as a static, read-only API:
      <a href="${esc(doc.record)}"><code>${esc(doc.record)}</code></a></p>
      <pre><code>${esc(JSON.stringify(record, null, 2))}</code></pre>`;
    layers.hidden = false;
    let graphLoaded = false;
    setupTabs(layers, (tabId) => {
      if (tabId === 'tab-graph' && !graphLoaded) {
        graphLoaded = true;
        graphPanel(document.getElementById('panel-graph'), workUri);
      }
    });
  } catch (err) {
    workEl.innerHTML = `<p>This artwork could not be loaded (${esc(err.message)}).</p>`;
  }
})();
