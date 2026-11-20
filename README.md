# museum-crosswalk

**Live site: [aprigge.github.io/museum-crosswalk](https://aprigge.github.io/museum-crosswalk/)**

A prototype that tests how well open museum data lines up, and what it takes to
search several museums as one collection.

It harvests records from open museum APIs (the Rijksmuseum, The Met and the Art Institute
of Chicago, and for Rembrandt also SMK in Copenhagen and the Cleveland Museum of Art),
converts each to [Linked Art](https://linked.art/) JSON-LD, matches every artist to
Wikidata, loads it all into a knowledge graph, and builds a search and an AI question box
on top. The site shows each layer: search results grouped by artist, each work's original
API request and Linked Art record, how every artist was matched, a Rembrandt overview built
from SPARQL queries, and a SPARQL console running the graph in your browser.

Two datasets share one graph: **paintings made 1850–1900** in three museums (phase 2), and
**everything five museums hold by Rembrandt** (phase 4): paintings, drawings and prints,
with each print's impressions grouped across museums.

Each converted record says which source it came from, its URL, when it was fetched and
its licence, and a field under a different licence carries its own (AIC's
`description` is CC BY 4.0 inside an otherwise CC0 record). Matches are never silent:
anything not strong enough to merge goes to a review list for a person to check.

## An experiment with Claude Code

This project is also an experiment in building with [Claude Code](https://claude.com/claude-code),
Anthropic's agentic coding tool. Claude Code wrote the code, tests, site, reports and
this README, working from a brief (`CLAUDE.md`) and in checkpoints: a plan approved
before any code, then a stop after each source and each stage to show results and
commit. The author set the goals, made the calls along the way (the artist match
policy, the concept alignments, licensing and what to publish) and reviewed each
step. Commits carry no co-author line; this note is the attribution.

## How it works

```
 Rijksmuseum (Linked Art) ─┐
 The Met (JSON)           ─┤
 AIC (JSON)               ─┼─▶ harvest ─▶ transform ─▶ reconcile ─▶ concepts ─▶ graph ─▶ index ─▶ site
 SMK (JSON)               ─┤   cached     Linked Art   artists →    styles and   Oxigraph  MiniSearch  static
 Cleveland (JSON)         ─┘
                               raw        + provenance Wikidata     subjects →   named     built from  pages on
                               responses               (review list) Wikidata    graphs    the graph   GitHub Pages
```

1. **Harvest** each dataset from the museum APIs, politely and with every response cached:
   a slice by object type and date, or an artist by name and the museums' own artist IDs.
2. **Transform** each record to Linked Art with provenance; source fields with no clean
   mapping are listed, not dropped silently.
3. **Reconcile** every artist with Wikidata. A record merges with a Wikidata person on
   a direct link, two agreeing IDs (for example AIC's artist ID and ULAN), or one ID
   plus the same birth and death years. Anything weaker, or qualified ("after",
   "imitator of"), stays in review and is shown unmerged. SMK and Cleveland records carry
   no ID Wikidata knows, so their artists match on name and life years and wait for a
   person's decision, made once per museum agent.
4. **Concepts:** styles and subjects (AAT terms from the Met and AIC, Iconclass codes
   from the Rijksmuseum) resolve to Wikidata items.
5. **Graph:** everything as RDF in [Oxigraph](https://github.com/oxigraph/oxigraph),
   with each party's claims kept apart: one named graph per museum, `graph/derived`
   for inferences (a style taken from the artist's movement on Wikidata, never the
   museum's claim), and `graph/alignments` for links the project asserts itself
   (`alignments/concepts.ttl`, each with a comment saying why). Prints are grouped here
   too: impressions that cite the same Bartsch number become one `mc:Print`; New Hollstein
   places only records that give no Bartsch number. Never grouped by title.
6. **Index:** SPARQL over the graph builds one search document per work, indexed
   with [MiniSearch](https://lucaong.github.io/minisearch/).
7. **Site:** plain HTML, CSS and ES modules, no bundler. Search runs in the browser,
   the graph runs in the browser as WebAssembly, and each work's Linked Art is a
   static file. The one exception is "Ask the graph", which needs a small proxy to call
   Claude (see below).

## Status and findings

**Phase 1, one artist: done.** Vincent van Gogh across all three museums, in
[reports/van-gogh.md](reports/van-gogh.md):

- 59 works resolve to Van Gogh with a plain creator role (12 Rijksmuseum, 29 Met,
  18 AIC), all with an open image; only AIC has description text.
- Identity is the strongest part: all three museums carry the same ULAN ID, and no
  match relied on names alone. Searching by name is the weakest: it pulled in Theo van
  Gogh, the van der Vinne family and a clockmaker. Wikidata had an error of its own,
  listing AIC's "Imitator of Vincent van Gogh" under Van Gogh's AIC ID.
- "Linked Art" does not mean schema-valid: no Rijksmuseum record passes the official
  schema, though all expand cleanly as JSON-LD.

**Phase 2, a slice of 1,101 paintings made 1850–1900: built and live.** The test
question was whether "Impressionist landscapes" returns works from all three
museums, grouped correctly by artist. Answer so far, in
[reports/impressionist-landscapes.md](reports/impressionist-landscapes.md):

- **AIC: 90 results.** It states style and subject itself.
- **The Met: 2 so far.** It has no style field, so its works match only through the
  artist's movement on Wikidata. Its harvest is partial (95 of about 1,300 paintings):
  its firewall blocked requests at 2 a second, and the harvest resumes at one every
  3 seconds.
- **The Rijksmuseum: none.** Its painters of the period are mostly the Hague School,
  which Wikidata keeps apart from Impressionism; the project links the two as related,
  not the same, and the site offers it as a related movement.
- Grouping is correct where an artist appears in more than one museum: 379 artists
  merged across the three, 24 of them in two or more museums.

**Phase 3, AI in the demo: in progress.** Claude Opus 5.5 looked at 953 openly licensed
images and suggested what each depicts, choosing only from 375 concepts with verified
Wikidata IDs, never style or movement. Suggestions sit in their own named graph with
confidence and evidence, and the site marks them "AI" and can switch them off. Measured
on 20 test searches ([reports/eval.md](reports/eval.md)), with relevance judged by Claude
Sonnet 5.5:

| | Precision in top 10 | Museums with a hit (of 3) | Queries all 3 museums answer |
|---|---|---|---|
| Museum data only | 95% | 2.55 | 13 of 20 |
| With AI subjects | 96% | 2.75 | 15 of 20 |

"Impressionist landscapes" now returns all three museums, starting with Monet's *La
Corniche near Monaco* at the Rijksmuseum, which the museum had catalogued without a
landscape subject. Cost: about $7 for the images, under $0.50 for judging.

**Phase 3 also added (done):**

- **Review assist.** Claude proposed a decision for each artist match left for review, citing
  the evidence; a person accepted or rejected each one (27 accepted). The AIC review queue
  went from 82 to 7, and each artist page shows "AI proposed, a person approved".
- **Ask the graph.** Plain-English questions become SPARQL, answered by the graph: 19 of 20
  test questions exactly right. See [Search or Ask?](#search-or-ask) and
  [Ask the graph](#ask-the-graph).
- **Artist facts from Wikidata** (place of birth, citizenship, gender), so Ask can answer
  questions such as "Which women painters have works in more than one museum?".

**Phase 4, Rembrandt, the full picture: built and live.** Everything five open museums hold by
Rembrandt: the Rijksmuseum, The Met, AIC, SMK (Copenhagen) and the Cleveland Museum of Art,
as a second dataset in the same graph. Findings in [reports/rembrandt.md](reports/rembrandt.md)
(`npm run rembrandt-report`).

- **Harvest: 3,048 records**, no fetch errors (The Met was not blocked this time).
- **2,434 works plainly by Rembrandt**: 2,288 prints, 96 drawings, 47 paintings. Copies,
  "after", school and workshop records are counted separately, never as his.

  | | Records harvested | Plainly by Rembrandt |
  |---|---|---|
  | Rijksmuseum | 1,469 | 1,397 (1,307 prints, 64 drawings, 24 paintings) |
  | SMK | 830 | 421 |
  | The Met | 372 | 284 |
  | AIC | 255 | 229 |
  | Cleveland | 122 | 103 |

- **Artist matches.** SMK and Cleveland records carry no artist ID Wikidata knows. Their
  Rembrandt agents (SMK `1871_person`, Cleveland `2520` and a duplicate `291869`) matched on
  name and life years and were merged on the author's decision, recorded in
  `alignments/review-decisions.json`. AIC's second Rembrandt ID on Wikidata (46371) is in
  fact "School of Rembrandt van Rijn", a Wikidata error like Van Gogh's imitator ID in
  phase 1; it stays in review.
- **Prints.** 1,993 impressions grouped into 307 prints by Bartsch number (New Hollstein
  places only records that give no Bartsch number); never by title. 71 prints are held by
  4 museums, 108 by 3, 78 by 2 and 50 by 1. Most widely held: *The Hundred Guilder Print*
  (Bartsch 74, 27 impressions in 4 museums), *The Entombment* (B86) and *Clement de Jonghe*
  (B272). The Met's API gives no catalogue numbers, so its 243 prints stay ungrouped. A
  record citing two different Bartsch numbers (a sheet with several prints) is left
  ungrouped; a record whose New Hollstein number usually belongs to another print is noted
  on its group, not merged.
- **On the site.** A [Rembrandt page](https://aprigge.github.io/museum-crosswalk/rembrandt.html):
  holdings by museum, how widely each print is held, prints with their impressions, a
  timeline by decade, and what could not be grouped. Every section is a SPARQL query run in
  the browser, with a link to open it in Explore. An impression's artwork page links to its
  print and shows the other impressions. Search has "Collection" and "Object type" filters,
  folds a print's impressions into one card ("+ N more impressions") and shows at most 24
  cards per artist.
- **Search eval.** The paintings eval now scores only the paintings collection (the index is
  shared). After judging 12 newly surfaced paintings it reads 94% precision without AI
  subjects and 96% with (phase 3: 95% and 96%; within the ±6 interval).
- **Still to come:** AI subjects for Rembrandt's works (SMK and Cleveland records carry no
  subjects), and Rembrandt questions in the Ask eval.

**Out of scope:** all Getty data (the Getty Museum collection and the Getty
Vocabularies). Nothing is fetched from Getty; AAT and ULAN IDs appear only where the
museums supply them.

## Search or Ask?

The site has two ways in, and they show off different things.

| | Search | Ask the graph |
|---|---|---|
| You type | Words: "snow", "Impressionist landscapes", "Monet" | A question: "Which artists have paintings in all three museums?" |
| You get | Works to look at, ranked and grouped by artist, with images | An answer: a table (and one checked sentence) from the graph |
| How | A MiniSearch index built from the graph, running in your browser | Claude writes one SPARQL query; the graph runs it in your browser |
| AI involved | Only if you leave AI-suggested subjects switched on | Yes, to write the query (and the answer sentence), never the numbers |
| Speed and cost | Instant, free, works offline | A few seconds; about a cent a question, within daily limits |
| Good at | Finding and browsing, fuzzy words, synonyms and related concepts | Counting, comparing and joining facts: "how many", "which… in all", "more than one", "never tagged" |

**Use Search** when you want to *find things*: works on a theme, by an artist, or in a style,
across museums, with pictures. It is forgiving (typos, plurals, synonyms from Wikidata) and
tells you why each result matched. It shows off the classic knowledge-graph-to-search
workflow: museum records reconciled to shared Wikidata concepts and artists, flattened into
one search document per work, so one query reaches all the museums and groups each artist's
works together whatever the museum calls them.

**Use Ask** when you want *an answer* that no single record holds: counts, comparisons,
"in all three museums", "born in", "the AI tagged but the museum didn't". These need joins
across the graph, which keyword search can't do. It shows off a grounded LLM workflow:
plain English to SPARQL from a schema description, a read-only guard, the query shown and
editable in Explore, an answer sentence whose every number is checked against the rows, and
an eval (19 of 20 questions exactly right) that is re-run whenever the prompt changes.

**Use Explore** to write SPARQL yourself, or to adjust a query Ask wrote.

**Or start from the Rembrandt page**, a third way in: a curated overview of Rembrandt's works
across five museums, where every section is a SPARQL query you can open in Explore.

## Ask the graph

The **Ask** page turns a plain-English question into SPARQL with Claude Opus 5.5 and runs it
on the graph in the visitor's browser. The model only translates; every number comes from the
graph, and the query is shown. On 20 reviewed questions with hand-written reference queries,
19 come back exactly right ([reports/ask-eval.md](reports/ask-eval.md), `npm run ask-eval`).

A static site can't hold an API key, so questions go through a small Cloudflare Worker
(`worker/`). It accepts only `POST /ask` (question to SPARQL) and `POST /summarize` (result
rows to one sentence) from the site's origins, rejects anything but a read-only query,
limits each visitor to 10 model calls a minute (about 5 questions), caps model calls per day
at 600 (a spending ceiling), and stores no questions. An answer sentence is shown only if
every number in it appears in the result rows.

Run it locally (needs `ANTHROPIC_API_KEY` in `.env`):

```sh
grep ^ANTHROPIC_API_KEY= .env > worker/.dev.vars   # local secret for the Worker (gitignored)
npm run worker:dev                                 # Worker on http://127.0.0.1:8787
python3 -m http.server 8765 --directory site       # site on http://127.0.0.1:8765/ask.html
```

Deploy (once). The Worker is live at `https://museum-crosswalk-ask.museum-crosswalk.workers.dev`;
to set it up again on another account (use Node 26: `nvm use`, as Wrangler needs 22.12+):

1. Make a free Cloudflare account, then `npx wrangler login` and click **Allow**.
2. `npm run worker:deploy` publishes the Worker and prints its address. The first deploy
   registers a workers.dev subdomain and creates the daily-counter storage; put that
   storage's id in `worker/wrangler.jsonc` so later deploys reuse it.
3. Add the key, read from `.env` without showing it:
   `grep '^ANTHROPIC_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put ANTHROPIC_API_KEY --config worker/wrangler.jsonc`
4. Set `DEPLOYED_ASK_URL` in `site/js/config.js` to the address plus `/ask`, and push.

## Setup

You need [nvm](https://github.com/nvm-sh/nvm). The Node version is pinned in `.nvmrc`
(26.5.0), and `package.json` requires Node 22.12 or later.

```sh
nvm use
npm install
cp .env.example .env   # then set MUSEUM_CROSSWALK_CONTACT to your email or URL
```

Every request to a museum or Wikidata sends that contact in its `User-Agent`, as the
APIs ask. It lives only in your gitignored `.env`; harvesting refuses to run without
it. Tests and `--offline` runs don't need it.

## Usage

Each step is a separate command and reads what the previous step wrote under `data/`.
Only `harvest` contacts the museums; `reconcile` and `concepts` query Wikidata when the
answer is not cached yet. Everything after that works offline.

```sh
# Phase 2: the paintings 1850-1900 slice, end to end
npm run harvest -- --slice paintings-1850-1900
npm run transform
npm run reconcile -- --slice paintings-1850-1900
npm run concepts         # styles and subjects -> Wikidata
npm run graph            # data/graph/…/full.nq and core.nq, site/data/graph-core.nq.gz
npm run index            # site/data/search-index.json, built by SPARQL over the graph
npm run evaluate         # writes reports/impressionist-landscapes.md
npm run site             # vendored libraries, Linked Art files and presets into site/

npm run query -- queries/artists-in-several-museums.rq   # run any SPARQL file on the graph

# Phase 4: one artist's works across five museums (any object type)
npm run harvest -- --dataset rembrandt
npm run transform
npm run reconcile -- --dataset rembrandt
npm run concepts -- --dataset rembrandt
npm run graph && npm run index && npm run site   # one graph and index for every reconciled dataset
npm run rembrandt-report # writes reports/rembrandt.md from the graph

# Phase 3: AI (needs ANTHROPIC_API_KEY in .env; each step prints a cost estimate first)
npm run vocabulary       # resolve the extra concepts on Wikidata, for review
npm run enrich -- --dry-run          # then --sample 20, then the full batch
npm run graph && npm run index       # rebuild with the AI suggestions
npm run eval -- pool --variant with-ai && npm run eval -- judge && npm run eval -- score --variant with-ai
npm run review-assist    # Claude proposes decisions for artist matches in review
npm run review           # accept, reject or skip each proposal (alignments/review-decisions.json)
npm run ask-eval         # the Ask eval: 20 questions, graded against reference SPARQL
npm run worker:dev       # the Ask Worker locally (see "Ask the graph"); worker:deploy publishes it

# Phase 1: one artist (defaults to Vincent van Gogh)
npm run harvest && npm run transform && npm run reconcile && npm run report
```

To preview the site locally: `python3 -m http.server --directory site`. Pushing
changes under `site/` to `main` redeploys GitHub Pages.

Flags (pass them after `--`):

| Flag | Used by | Meaning |
|---|---|---|
| `--source <names>` | most | `rijksmuseum`, `met`, `aic`, `smk`, `cleveland`, a comma-separated list, or `all` (the default). |
| `--dataset <id>` | harvest, reconcile, concepts, graph | `paintings-1850-1900` (a slice) or `rembrandt` (an artist). `--slice` still works as before. `graph` combines every reconciled dataset unless given one. |
| `--artist <name>` | harvest, reconcile | Artist to look up on Wikidata. Defaults to `Vincent van Gogh`. |
| `--qid <Q…>` | harvest, reconcile | Use this Wikidata QID instead of looking the artist up by name. |
| `--limit <n>` | harvest | Stop after n search hits per source, for a quick trial run. |
| `--offline` | harvest | Serve only from the cache and send nothing. An uncached object is skipped; an uncached search page ends that source's run. |
| `--refresh` | harvest, reconcile, concepts | Fetch again even when a cached copy exists. |

`transform` writes validation results to `_validation.json` and unmapped source fields
to `_unmapped.json` in each `data/linked-art/{source}/` folder. `report`, `evaluate`, `eval`,
`ask-eval` and `rembrandt-report` regenerate their report above the `END GENERATED` marker and keep the hand-written
findings below it.

## Tests

```sh
npm test            # Vitest, offline: saved fixtures in test/fixtures/, no live calls
npm run typecheck   # tsc --noEmit
```

## Project layout

```
src/
  sources/     one adapter per museum (rijksmuseum, met, aic, smk, cleveland) + index.ts registry
  core/        polite cached HTTP client, cache paths, minted IDs, provenance, shared types
  linkedart/   Linked Art builders, vocabulary, JSON Schema and JSON-LD validation
  authority/   Wikidata artist lookup and concept lookup by AAT/Iconclass
  reconcile/   artist matching and the slice-wide match policy
  graph/       the crosswalk layer, graph build (Oxigraph) and print grouping (prints.ts)
  search/      search documents built from the graph, and the index
  ai/          Claude client, enrichment, review assist, Ask and answer-sentence requests, the judge
  eval/        search eval (queries, pooling, metrics) and Ask eval (execution match)
  report/      phase 1 report statistics and rendering
  cli/         one entry point per command
site/          the static site; site/js/terms.js is shared with the index build
               so search behaves the same in Node and the browser
worker/        the Cloudflare Worker behind Ask (holds the API key; never runs queries)
queries/       SPARQL presets, also served on the site's Explore page
alignments/    concept links the project asserts itself, and the AI vocabulary extension
prompts/       versioned prompts for each AI task
eval/          eval queries, pooled results, labels with the judge's reasons, runs
schemas/       Linked Art JSON Schemas and JSON-LD context, used offline
reports/       generated reports with hand-written findings
test/          Vitest tests and fixtures/raw/ (small saved API responses)
data/          harvested and generated data (gitignored)
```

Every source adapter has the same interface (`search`, `searchSlice`, `fetch`,
`toLinkedArt`, `artistRefs`). To add a source, write one adapter and register it in
`src/sources/index.ts`.

## Politeness

- Every request sends a `User-Agent` naming the project and a contact; AIC also gets
  it in the `AIC-User-Agent` header it asks for.
- Requests to one source are sequential with a minimum gap: 0.5 s for the
  Rijksmuseum, 1 s for AIC, SMK, Cleveland and Wikidata, 3 s for the Met. SMK and
  Cleveland search pages carry full records, so they need no request per object. Lists are fetched in batches
  where the API allows (AIC `?ids=`, Wikidata `VALUES`).
- Failures are retried with exponential backoff, honouring `Retry-After`. A 403 from a
  firewall stops that source at once; what was cached is kept and the run is marked
  incomplete.
- Raw responses are cached under `data/raw/{source}/`; reruns fetch nothing unless you
  pass `--refresh`.
- The project is read-only against every source. Publishing its own site is the only
  thing it writes anywhere.

## Data licences

| Source | Licence |
|---|---|
| Rijksmuseum | Metadata CC0 1.0. Images are marked Public Domain Mark 1.0. |
| The Met | CC0 1.0 for Open Access objects (`isPublicDomain: true`). Other objects are shown without images. |
| Art Institute of Chicago | CC0 1.0, except the `description` field: © Art Institute of Chicago, CC BY 4.0. |
| SMK, National Gallery of Denmark | Each record states its rights; public-domain works carry the Public Domain Mark 1.0 and their images are shown. |
| Cleveland Museum of Art | Data CC0 1.0. Images CC0 only where `share_license_status` is CC0; others are shown without images. |
| Wikidata | CC0 1.0. |

**AIC attribution:** description text is credited to the Art Institute of Chicago
wherever the site shows it, and the converted records mark the field with its own
licence. The test fixtures include some of this text.

Each record carries its own licence (and that of any field that differs) in its
provenance; check the record rather than relying on this table. This is an independent
prototype, not affiliated with or endorsed by any of these institutions.

## Data directory

`data/` is gitignored: it holds the raw cache, converted records, reconcile output and
the full graph, and the commands rebuild it (set `DATA_DIR` to use another location).
`site/data/` is generated too but committed, because GitHub Pages serves it as is and
CI cannot re-harvest the museums.
