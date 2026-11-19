// Labelling page for the search eval. Serve the repo root locally and open /eval/label.html.
// Pool items come from museum data: everything is escaped, links and images are http(s) only.
const KEY = 'museum-crosswalk-labels';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safe = (u) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
};

const pool = await fetch('pool.json').then((r) => r.json());
const fromFile = await fetch('labels.json').then((r) => (r.ok ? r.json() : {}), () => ({}));
let stored = {};
try {
  stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
} catch {}
// Labels already committed win only where this browser has none.
const labels = structuredClone(fromFile);
for (const [q, items] of Object.entries(stored)) labels[q] = { ...(labels[q] ?? {}), ...items };

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(labels));
  } catch {}
};

const progressEl = document.getElementById('progress');
const queriesEl = document.getElementById('queries');
const onlyOpen = document.getElementById('only-open');

function progress() {
  const total = Object.values(pool).reduce((n, q) => n + q.items.length, 0);
  const done = Object.entries(pool).reduce((n, [qid, q]) => n + q.items.filter((i) => i.id in (labels[qid] ?? {})).length, 0);
  progressEl.textContent = `${done} of ${total} labelled`;
}

function render() {
  queriesEl.innerHTML = Object.entries(pool)
    .map(([qid, q]) => {
      const items = q.items.filter((i) => !onlyOpen.checked || !(i.id in (labels[qid] ?? {})));
      if (!items.length) return '';
      return `<section class="q" aria-labelledby="h-${qid}">
        <h2 id="h-${qid}">${esc(qid)}: “${esc(q.query)}”</h2>
        <p class="rule"><strong>Relevant means:</strong> ${esc(q.relevant)}</p>
        <ul class="items">${items
          .map((i) => {
            const label = labels[qid]?.[i.id];
            const thumb = safe(i.thumb);
            const page = safe(i.url);
            const name = `${qid}-${i.id}`;
            return `<li class="item" data-label="${label === undefined ? '' : label}">
              ${thumb ? `<img src="${esc(thumb)}" alt="${esc(`${i.title}, ${i.artists.join(', ')}`)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
              <div class="body">
                <strong>${page ? `<a href="${esc(page)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>` : esc(i.title)}</strong><br>
                ${esc(i.artists.join(', ') || 'Unknown artist')}${i.begin ? `, ${esc(i.begin)}` : ''}<br>
                <span class="muted">${esc(i.museumName)}</span>
                <fieldset><legend class="visually-hidden">Is “${esc(i.title)}” relevant to “${esc(q.query)}”?</legend>
                  <label><input type="radio" name="${esc(name)}" data-q="${esc(qid)}" data-id="${esc(i.id)}" value="true" ${label === true ? 'checked' : ''}> Relevant</label>
                  <label><input type="radio" name="${esc(name)}" data-q="${esc(qid)}" data-id="${esc(i.id)}" value="false" ${label === false ? 'checked' : ''}> Not</label>
                </fieldset>
              </div>
            </li>`;
          })
          .join('')}</ul>
      </section>`;
    })
    .join('');
  progress();
}

queriesEl.addEventListener('change', (e) => {
  const r = e.target;
  if (r.type !== 'radio') return;
  (labels[r.dataset.q] ??= {})[r.dataset.id] = r.value === 'true';
  r.closest('.item').dataset.label = r.value;
  save();
  progress();
});
onlyOpen.addEventListener('change', render);
document.getElementById('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(labels, null, 2) + '\n'], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'labels.json' });
  a.click();
  URL.revokeObjectURL(a.href);
});
render();
