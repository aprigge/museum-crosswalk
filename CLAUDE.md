# Museum Knowledge Graph: Harvester Prototype

## Goal

Find out how well open museum data lines up before building a full knowledge graph.
This first step harvests every work by **one artist (Vincent van Gogh)** from three
open museum sources, converts each record to a common Linked Art shape, matches the
artist to a single Wikidata entity, and writes a report on overlaps, gaps and
matching problems.

This is a prototype. Phase 1 (above) had no triplestore and no UI. Phase 2 adds them:
see "Phase 2" below.

## Phase 2: knowledge graph and search site

A bounded slice, **paintings made 1850–1900** from the same three museums, loaded into a
knowledge graph (Oxigraph) and searched from a static site on GitHub Pages
(`aprigge.github.io/museum-crosswalk`). The test question: does "Impressionist
landscapes" return works from all three museums, grouped correctly by artist?
Findings go in `reports/impressionist-landscapes.md`.

- Pipeline: `harvest --slice` → `transform` → `reconcile --slice` → `concepts` → `graph`
  → `index` → `evaluate` → `site`. `site/` is plain HTML/CSS/ES modules, no bundler;
  `site/js/terms.js` is shared by the index build and the browser, so search behaves
  the same in both.
- Artist match policy: an exact Wikidata link, two agreeing IDs, or one ID plus agreeing
  life years merges; anything weaker or qualified stays in review and is shown unmerged.
- Keep what each party claims apart: museums' Linked Art in per-source named graphs,
  Wikidata-derived inferences (e.g. style from the artist's movement) in `graph/derived`,
  and the project's own concept links in `alignments/concepts.ttl` (`graph/alignments`),
  each with a comment saying why.
- `site/data/` is generated but committed, because CI cannot re-harvest. Rebuild it with
  the pipeline, then commit.
- Read-only still applies to every museum API and Wikidata. Publishing our own site is
  the only external write, and only on the user's go-ahead.
- The Met's firewall blocked 2 requests/s; it is paced at one request every 3 s. A 403
  stops a source at once; resume later from cache.
- Third-party text and URLs on the site are escaped or allow-listed (http/https only);
  museum images load with `referrerpolicy="no-referrer"` (AIC refuses unknown referrers).

**Out of scope for now: all Getty data** (the Getty Museum collection and the Getty
Vocabularies, including ULAN). Don't fetch from data.getty.edu or vocab.getty.edu.
Getty sources may be added in a later phase, so keep the adapter design open to
new sources.

## Sources

Check each source's current docs before writing code. Endpoints change, and the
URLs below are starting points, not guarantees.

| Source | Format | Starting point | License |
|---|---|---|---|
| Rijksmuseum | Linked Art (new LOD APIs; the old key-based API is deprecated, don't use it) | Search `https://data.rijksmuseum.nl/search/collection` (Linked Art Search spec, returns IDs), then resolve the IDs; docs `https://data.rijksmuseum.nl/docs/` | No reuse restrictions (per their open data policy) |
| The Met | Plain JSON, convert it | Collection API, docs at `https://metmuseum.github.io/`. Search returns object IDs only, so you need one request per object | CC0 for Open Access objects; check `isPublicDomain` per object |
| Art Institute of Chicago | Plain JSON, convert it | `https://api.artic.edu/api/v1/artworks/search`, docs `https://api.artic.edu/docs/`. Use the `fields` param. Images are IIIF | CC0, except the `description` field, which is CC-BY |
| Wikidata (artist authority) | JSON / SPARQL | `https://query.wikidata.org/sparql` | CC0 |

**Artist authority:** use Van Gogh's Wikidata entity (look up the QID; don't
hardcode it from memory) as the single identity every source's artist record is
matched to. Use the external IDs Wikidata lists for him to see which museums'
own artist IDs it already knows about.

## Rules

- **Be polite to every API.** Send a real `User-Agent` with a contact, throttle
  requests (the Met asks for polite pacing), retry with backoff, and never run
  requests in parallel against one source without a limit.
- **Cache raw responses** under `data/raw/{source}/`, so later steps can rerun
  without fetching again. Harvest and transform are separate steps.
- **Read-only.** Nothing in this project writes to any external system.
- **Provenance on every statement.** Each converted record and each field says which
  source it came from, its source URL, when it was fetched, and its license. AIC
  `description` must be marked CC-BY separately from the rest of the record.
- **Matching is never silent.** Every artist match records how it was made (exact ID,
  Wikidata crosswalk, name + dates) and a confidence. Anything not an exact ID
  match goes in a review list for a person, rather than being merged automatically.
- **Don't invent data.** If a source lacks a field, leave it out; don't guess it.

## Stack

- TypeScript on Node, ES modules. Keep dependencies small.
- One adapter per source with the same interface: `search(artist)`, `fetch(id)`,
  `toLinkedArt(raw)`. Adding a source later should mean adding one adapter.
- `jsonld` for expanding and validating JSON-LD. Validate converted records against
  the Linked Art JSON Schemas where practical.
- Vitest for tests, using saved fixtures from `data/raw`, not live calls.
- CLI scripts: `harvest`, `transform`, `reconcile`, `report`.

## Output

1. `data/linked-art/{source}/*.json`: converted records.
2. `data/reconcile/matches.json` and `data/reconcile/review.json`.
3. `reports/van-gogh.md`, answering:
   - How many works each source returned, and how many have open images and real
     description text.
   - How each source identifies the artist, and how each was matched to Wikidata.
   - Fields that map cleanly to Linked Art, and fields that don't (with examples).
   - Licensing differences that affect reuse.
   - Problems hit (rate limits, odd records, missing data) and recommendations
     for the full pipeline.

## How to work

- Start in plan mode. Propose the plan and folder layout, then stop and wait for
  approval before writing code.
- Build one source end to end first (the Rijksmuseum, since it's already Linked
  Art), then add the Met and AIC.
- After each source, run its tests and show a sample converted record.
