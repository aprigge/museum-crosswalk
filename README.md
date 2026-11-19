# museum-crosswalk

**Live site: [aprigge.github.io/museum-crosswalk](https://aprigge.github.io/museum-crosswalk/)**

A prototype that tests how well open museum data lines up, and what it takes to
search three museums as one collection.

It harvests records from three open museum APIs (the Rijksmuseum, The Met and the
Art Institute of Chicago), converts each to [Linked Art](https://linked.art/) JSON-LD,
matches every artist to Wikidata, loads it all into a knowledge graph, and builds a
search on top. The site shows each layer: search results grouped by artist, each
painting's original API request and Linked Art record, how every artist was matched,
and a SPARQL console running the graph in your browser.

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
 The Met (JSON)           ─┼─▶ harvest ─▶ transform ─▶ reconcile ─▶ concepts ─▶ graph ─▶ index ─▶ site
 AIC (JSON)               ─┘   cached     Linked Art   artists →    styles and   Oxigraph  MiniSearch  static
                               raw        + provenance Wikidata     subjects →   named     built from  pages on
                               responses               (review list) Wikidata    graphs    the graph   GitHub Pages
```

1. **Harvest** from the three APIs, politely and with every response cached.
2. **Transform** each record to Linked Art with provenance; source fields with no clean
   mapping are listed, not dropped silently.
3. **Reconcile** every artist with Wikidata. A record merges with a Wikidata person on
   a direct link, two agreeing IDs (for example AIC's artist ID and ULAN), or one ID
   plus the same birth and death years. Anything weaker, or qualified ("after",
   "imitator of"), stays in review and is shown unmerged.
4. **Concepts:** styles and subjects (AAT terms from the Met and AIC, Iconclass codes
   from the Rijksmuseum) resolve to Wikidata items.
5. **Graph:** everything as RDF in [Oxigraph](https://github.com/oxigraph/oxigraph),
   with each party's claims kept apart: one named graph per museum, `graph/derived`
   for inferences (a style taken from the artist's movement on Wikidata, never the
   museum's claim), and `graph/alignments` for links the project asserts itself
   (`alignments/concepts.ttl`, each with a comment saying why).
6. **Index:** SPARQL over the graph builds one search document per painting, indexed
   with [MiniSearch](https://lucaong.github.io/minisearch/).
7. **Site:** plain HTML, CSS and ES modules, no bundler. Search runs in the browser,
   the graph runs in the browser as WebAssembly, and each painting's Linked Art is a
   static file, so the site needs no server.

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

**Out of scope:** all Getty data (the Getty Museum collection and the Getty
Vocabularies). Nothing is fetched from Getty; AAT and ULAN IDs appear only where the
museums supply them.

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

# Phase 1: one artist (defaults to Vincent van Gogh)
npm run harvest && npm run transform && npm run reconcile && npm run report
```

To preview the site locally: `python3 -m http.server --directory site`. Pushing
changes under `site/` to `main` redeploys GitHub Pages.

Flags (pass them after `--`):

| Flag | Used by | Meaning |
|---|---|---|
| `--source <names>` | most | `rijksmuseum`, `met`, `aic`, a comma-separated list, or `all` (the default). |
| `--slice <id>` | harvest, reconcile, concepts, graph, index, site | Work on a slice instead of one artist. The only slice is `paintings-1850-1900` (the default for the graph steps). |
| `--artist <name>` | harvest, reconcile | Artist to look up on Wikidata. Defaults to `Vincent van Gogh`. |
| `--qid <Q…>` | harvest, reconcile | Use this Wikidata QID instead of looking the artist up by name. |
| `--limit <n>` | harvest | Stop after n search hits per source, for a quick trial run. |
| `--offline` | harvest | Serve only from the cache and send nothing. An uncached object is skipped; an uncached search page ends that source's run. |
| `--refresh` | harvest, reconcile, concepts | Fetch again even when a cached copy exists. |

`transform` writes validation results to `_validation.json` and unmapped source fields
to `_unmapped.json` in each `data/linked-art/{source}/` folder. `report` and `evaluate`
regenerate their report above the `END GENERATED` marker and keep the hand-written
findings below it.

## Tests

```sh
npm test            # Vitest, offline: saved fixtures in test/fixtures/, no live calls
npm run typecheck   # tsc --noEmit
```

## Project layout

```
src/
  sources/     one adapter per museum (rijksmuseum.ts, met.ts, aic.ts) + index.ts registry
  core/        polite cached HTTP client, cache paths, minted IDs, provenance, shared types
  linkedart/   Linked Art builders, vocabulary, JSON Schema and JSON-LD validation
  authority/   Wikidata artist lookup and concept lookup by AAT/Iconclass
  reconcile/   artist matching and the slice-wide match policy
  graph/       the crosswalk layer and graph build (Oxigraph)
  search/      search documents built from the graph, and the index
  report/      phase 1 report statistics and rendering
  cli/         one entry point per command
site/          the static site; site/js/terms.js is shared with the index build
               so search behaves the same in Node and the browser
queries/       SPARQL presets, also served on the site's Explore page
alignments/    concept links the project asserts itself (Turtle)
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
  Rijksmuseum, 1 s for AIC and Wikidata, 3 s for the Met. Lists are fetched in batches
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
