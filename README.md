# museum-crosswalk

A prototype that tests how well open museum data lines up before anyone builds a
full knowledge graph on it.

It harvests records from three open museum APIs (the Rijksmuseum, The Met and the
Art Institute of Chicago), converts each record to [Linked Art](https://linked.art/)
JSON-LD, and matches every artist to a Wikidata entity. Each converted record says
which source it came from, its source URL, when it was fetched and its licence. Where
one field is under a different licence from the rest of the record, that field carries
its own provenance. For example, AIC's `description` is CC BY 4.0 inside an otherwise
CC0 record. Artist matches are never silent: anything that is not an exact ID match
goes into a review list for a person to check.

The aim is to find the overlaps, gaps and matching problems early, while the data
set is still small enough to read.

## Pipeline

```
 Rijksmuseum (Linked Art) ─┐
 The Met (JSON)           ─┼─▶ harvest ─▶ transform ─▶ reconcile ─▶ report
 AIC (JSON)               ─┘      │            │             │            │
                            data/raw/     data/linked-art/  data/reconcile/  reports/*.md
                            cached raw    Linked Art +      matches.json,
                            responses     provenance        review.json
                                                             ▲
                                              Wikidata (artist authority)

 Phase 2, planned:  reconcile ─▶ concepts ─▶ graph (Oxigraph) ─▶ search index ─▶ static site
```

## Status

**Phase 1: done.** One artist, Vincent van Gogh, across all three museums. The
`harvest`, `transform`, `reconcile` and `report` commands produce
[reports/van-gogh.md](reports/van-gogh.md). Headline findings:

- 59 works resolve to Van Gogh with a plain creator role (12 Rijksmuseum, 29 Met,
  18 AIC), and all 59 have an open image. Only AIC has description prose, on 9 of
  its 18 works.
- Identity is the strongest part of the data. The Rijksmuseum and the Met link
  Wikidata directly, AIC matches through Wikidata's crosswalk, and all three carry
  the same ULAN ID. No match relied on names alone.
- Search is the weakest part. The Rijksmuseum and the Met can only search by name,
  which pulled in other artists (Theo van Gogh, the van der Vinne family, a
  clockmaker). Wikidata itself had an error: its AIC artist ID property for Van Gogh
  also lists AIC's "Imitator of Vincent van Gogh" agent.
- "Linked Art" does not mean schema-valid. None of the Rijksmuseum's records pass the
  official Linked Art object schema, though all expand cleanly as JSON-LD.
- Licences differ by field, not just by source, so a merged graph has to keep
  provenance at field level.

**Phase 2: in progress.** A bounded slice: paintings made 1850 to 1900 from all three
museums. The plan is to load the slice into a knowledge graph (Oxigraph), build one
search document per artwork from that graph, and publish a static, accessible search
site on GitHub Pages. The graph will run in the browser (Oxigraph WASM), with a live
SPARQL console. The test question: does "Impressionist landscapes" return works from
all three museums, grouped correctly by artist?

What exists so far: slice harvesting (`--slice paintings-1850-1900`) for all three
sources, subjects and styles in the transform, and slice-wide artist reconciliation.
The graph, search index and site are not built yet. The Met harvest is partial: the
Met's firewall blocked requests partway through, and the harvest will resume at a
slower pace.

**Out of scope:** all Getty data, meaning the Getty Museum collection and the Getty
Vocabularies (ULAN, AAT and the rest). Nothing is fetched from Getty. AAT and ULAN
IDs appear only as identifiers that the museum sources supply themselves.

## Setup

You need [nvm](https://github.com/nvm-sh/nvm). The Node version is pinned in `.nvmrc`
(26.5.0), and `package.json` requires Node 22.12 or later.

```sh
nvm use
npm install
```

## Usage

Each step is a separate command and reads what the previous step wrote under `data/`.
Harvesting is the only step that contacts the museums. The other steps work from the
cache, but `reconcile` and the artist lookup query Wikidata when the answer is not
cached yet.

```sh
# Phase 1: one artist (defaults to Vincent van Gogh)
npm run harvest
npm run transform
npm run reconcile
npm run report          # writes reports/van-gogh.md

# Phase 2: the paintings 1850-1900 slice
npm run harvest -- --slice paintings-1850-1900
npm run transform
npm run reconcile -- --slice paintings-1850-1900
```

Flags (pass them after `--`):

| Flag | Used by | Meaning |
|---|---|---|
| `--source <names>` | all | `rijksmuseum`, `met`, `aic`, a comma-separated list, or `all` (the default). |
| `--slice <id>` | harvest, reconcile | Work on a slice instead of one artist. The only slice is `paintings-1850-1900`. |
| `--artist <name>` | harvest, reconcile | Artist to look up on Wikidata. Defaults to `Vincent van Gogh`. |
| `--qid <Q…>` | harvest, reconcile | Use this Wikidata QID instead of looking the artist up by name. |
| `--limit <n>` | harvest | Stop after n search hits per source. Useful for a quick trial run. |
| `--offline` | harvest | Serve museum requests only from the cache and send nothing. An uncached object is logged as an error and skipped; an uncached search page ends that source's run. |
| `--refresh` | harvest, reconcile | Fetch again even when a cached copy exists. |

Examples:

```sh
npm run harvest -- --source aic --slice paintings-1850-1900 --limit 20
npm run harvest -- --source met --offline
```

`transform` converts every cached object for the chosen sources. It writes validation
results to `_validation.json` and source fields with no Linked Art mapping to
`_unmapped.json` in each `data/linked-art/{source}/` folder.

`report` regenerates the part of `reports/van-gogh.md` above the
`END GENERATED` marker and keeps the hand-written text below it.

## Tests

```sh
npm test            # Vitest, offline: saved fixtures in test/fixtures/, no live calls
npm run typecheck   # tsc --noEmit
```

## Project layout

```
src/
  sources/     one adapter per museum (rijksmuseum.ts, met.ts, aic.ts) + index.ts registry
  core/        polite cached HTTP client, cache paths, IDs, provenance, shared types
  linkedart/   Linked Art builders, vocabulary, JSON Schema and JSON-LD validation
  authority/   Wikidata artist lookup (wikidata.ts) and concept lookup by AAT/Iconclass (concepts.ts)
  reconcile/   artist matching (match.ts) and slice-wide agent resolution (agents.ts)
  report/      report statistics and Markdown rendering
  cli/         harvest, transform, reconcile, report entry points
schemas/       Linked Art JSON Schemas and JSON-LD context, used offline
test/          Vitest tests and fixtures/raw/ (small saved API responses)
reports/       generated reports with hand-written findings
data/          harvested and generated data (gitignored)
```

Every source adapter has the same interface (`search`, `fetch`, `toLinkedArt`, plus
`searchSlice` for slices). To add a source, write one adapter and register it in
`src/sources/index.ts`.

## Politeness

- Every request sends a `User-Agent` that names the project and gives a contact.
  AIC also gets it in the `AIC-User-Agent` header, which AIC asks for.
- Requests to one source are sequential with a minimum gap between them: 0.5 s for
  the Rijksmuseum, 1 s for AIC and Wikidata, and 3 s for the Met.
- Failed requests are retried with exponential backoff, and `Retry-After` is honoured.
  A 403 from a firewall stops that source at once instead of retrying. Whatever was
  already cached is kept, and the harvest file is marked incomplete.
- Raw responses are cached under `data/raw/{source}/`, so rerunning a step does not
  fetch again unless you pass `--refresh`.
- The project is read-only against every source. It never writes to a museum API or
  to Wikidata.

## Data licences

| Source | Licence |
|---|---|
| Rijksmuseum | Metadata CC0 1.0. Images are marked Public Domain Mark 1.0. |
| The Met | CC0 1.0 for Open Access objects (`isPublicDomain: true`). Other objects are recorded as not open access. |
| Art Institute of Chicago | CC0 1.0, except the `description` field, which is CC BY 4.0. |
| Wikidata | CC0 1.0. |

**AIC attribution:** AIC description text is licensed CC BY 4.0. If you reuse it,
credit the Art Institute of Chicago. The converted records mark this field with its
own licence so the requirement is not lost. The test fixtures include some of this
text.

The licence of each record (and of any field that differs) is in that record's
provenance, so check the record rather than relying on this table.

## Data directory

`data/` is gitignored. It holds the raw cache, the converted Linked Art records and
the reconcile output, and the CLIs rebuild it. Set `DATA_DIR` to use a different
location. The small fixtures that the tests need are committed under `test/fixtures/`.
