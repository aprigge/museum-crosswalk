# Vincent van Gogh across open museum data

Generated 2026-11-19 by `npm run report` from `data/`. Sources: Rijksmuseum, The Met, Art Institute of Chicago.
Getty data is out of scope for this phase and was not fetched; ULAN IDs appear only where a source supplies them.

## 1. Works, open images and description text

"Works by the artist" is the confirmed set plus crosswalk-only matches: records whose
artist resolves to Q5582 with a plain creator role. Image and description counts are
over that set. Everything that is not an exact-ID match is in `data/reconcile/review.json`.

| Source | Search hits | Confirmed (exact ID) | Crosswalk only | Qualified (after, possibly, imitator…) | Other artist | Open image | Description text |
|---|---|---|---|---|---|---|---|
| Rijksmuseum | 28 | 12 | 0 | 3 | 13 | 12 (100%) | 0 (0%) |
| The Met | 38 | 29 | 0 | 1 | 8 | 29 (100%) | 0 (0%) |
| Art Institute of Chicago | 19 | 0 | 18 | 1 | 0 | 18 (100%) | 9 (50%) |

- **Open image** means the record carries an image URL under CC0, Public Domain Mark or CC BY.
- **Description text** means a Linked Art Description statement (aat:300435416) with prose, not
  just tombstone fields.

## 2. How each source identifies the artist

Authority: [Q5582](https://www.wikidata.org/wiki/Q5582), Vincent van Gogh
(1853-03-30 – 1890-07-29), looked up by English label
plus occupation "painter". Wikidata lists
308 external-ID properties for him.

| Source | Source's own artist ID(s) | Authority links in the record | Wikidata lists this museum's ID | Match method | Name as given |
|---|---|---|---|---|---|
| Rijksmuseum | https://id.rijksmuseum.nl/2102256 | Wikidata, ULAN, RKD, VIAF | P7444 Rijksmuseum Research Library authority ID = 42904 | exact-id | Vincent van Gogh |
| The Met | 161947 | Wikidata, ULAN | P10882 Met Constituent ID = 161947 | exact-id | Vincent van Gogh |
| Art Institute of Chicago | 40610, 47301 | ULAN | P6295 ARTIC artist ID = 47301, 40610 | wikidata-crosswalk | Vincent van Gogh |

Match evidence, one line per distinct case:

- Rijksmuseum: exact-id (1): Source links Wikidata Q5582 directly
- The Met: exact-id (1): Source links Wikidata Q5582 directly
- Art Institute of Chicago: wikidata-crosswalk (0.9): Q5582 lists P245 (Union List of Artist Names ID) = 500115588; P6295 (ARTIC artist ID) = 40610
- Art Institute of Chicago: wikidata-crosswalk (0.7): Q5582 lists P6295 (ARTIC artist ID) = 47301

## 3. Mapping to Linked Art

### Rijksmuseum

- Records passing the Linked Art object schema: **0 of 28**. Expanding as JSON-LD: **28 of 28**.
- Linked Art properties produced: `classified_as` (28), `dimension` (28), `equivalent` (28), `id` (28), `identified_by` (28), `made_of` (28), `member_of` (28), `produced_by` (28), `referred_to_by` (28), `shows` (28), `subject_of` (28), `type` (28), `assigned_by` (22), `attributed_by` (5), `current_location` (4).

Schema problems, by records affected:

| Problem | Records |
|---|---|
| /dimension/*/value must be number | 28 |
| extra property `id` | 28 |
| extra property `identified_by` | 28 |
| extra property `notation` | 28 |
| extra property `subject_to` | 28 |
| missing `_label` | 28 |
| extra property `assigned_by` | 22 |
| extra property `referred_to_by` | 14 |

No unmapped fields: the source is already Linked Art and is passed through.

### The Met

- Records passing the Linked Art object schema: **38 of 38**. Expanding as JSON-LD: **38 of 38**.
- Linked Art properties produced: `id` (38), `identified_by` (38), `produced_by` (38), `referred_to_by` (38), `subject_of` (38), `type` (38), `representation` (37), `dimension` (24), `equivalent` (22).

Source fields with no clean Linked Art mapping:

| Field | Records | Example |
|---|---|---|
| `accessionYear` | 38 | 1964 |
| `classification` | 38 | Horology |
| `department` | 38 | European Sculpture and Decorative Arts |
| `isHighlight` | 38 | false |
| `isTimelineWork` | 38 | false |
| `metadataDate` | 38 | 2026-08-06T04:51:07.753Z |
| `objectName` | 38 | Longcase clock |
| `repository` | 38 | Metropolitan Museum of Art, New York, NY |
| `tags (subjects need a separate VisualItem record)` | 31 | ["Soldiers http://vocab.getty.edu/page/aat/300185678 https://www.wikidata.org/wiki/Q499137… |
| `measurements (not Overall)` | 26 | [{"elementName":"Sheet","elementDescription":null,"elementMeasurements":{"Height":24.3,"Wi… |
| `GalleryNumber` | 18 | 825 |
| `constituents (non-Artist roles)` | 8 | ["Maker: Clockmaker: Vincent van Amelonsen"] |
| `artistPrefix` | 1 | Clockmaker: |
| `measurements (other)` | 1 | {"Weight":21.772657} |

### Art Institute of Chicago

- Records passing the Linked Art object schema: **19 of 19**. Expanding as JSON-LD: **19 of 19**.
- Linked Art properties produced: `id` (19), `identified_by` (19), `produced_by` (19), `referred_to_by` (19), `representation` (19), `subject_of` (19), `type` (19).

Source fields with no clean Linked Art mapping:

| Field | Records | Example |
|---|---|---|
| `artist_display` | 19 | Vincent van Gogh (Dutch, 1853–1890) |
| `artwork_type_title` | 19 | Painting |
| `classification_title` | 19 | oil on canvas |
| `department_title` | 19 | Painting and Sculpture of Europe |
| `dimensions_detail` | 19 | {"note":"Structured values are whole centimetres and disagree with the display text; mappe… |
| `material_titles` | 19 | ["oil paint (paint)","canvas","paint","painting"] |
| `place_of_origin` | 19 | Netherlands |
| `source_updated_at` | 19 | 2026-10-20T09:18:45-05:00 |
| `exhibition_history` | 15 | Copenhagen, Den Frie Udstilling, 1893, cat. 183.  Christiania (Oslo), exhibition of modern… |
| `publication_history` | 15 | Vincent van Gogh, Brieven Aan Zijn Broeder, ed. Jo van Gogh-Bonger (Amsterdam: Maatschappi… |
| `technique_titles` | 12 | ["oil painting","painting","painting (image making)","painting techniques"] |
| `subject_titles` | 11 | ["landscapes","garden","poets","bushes","flora","foliage","flowers","trees","green (color)… |
| `style_titles` | 10 | ["Post-Impressionism","19th century","nineteenth century"] |
| `catalogue_display` | 5 | <p>Faille, de la 272</p><p>Hulsker 1183</p><p>Hulsker 370</p> |
| `date_qualifier_title` | 2 | Made |

## 4. Licensing

| Source | Record license | Field-level differences |
|---|---|---|
| Rijksmuseum | CC0 1.0 (28) | subject_of.digitally_carried_by[image]: Public Domain Mark 1.0 (19) |
| The Met | CC0 1.0 (37); not-open-access (1) | none |
| Art Institute of Chicago | CC0 1.0 (19) | referred_to_by[Description]: CC BY 4.0 (9) |

## 5. Problems hit

### Rijksmuseum

- Fetch errors during harvest: none.
- Search hits by other artists: 13 — Cornelis Marinus van Gogh (1), Vincent Willem van Gogh (6), Vincent Willem van Gogh / Art Color Card Distributions (1), Gogh, C.M. van, Kunsthandel / anoniem (2), Cornelis Marinus van Gogh / Gogh, C.M. van, Kunsthandel (1), Van Meurs & Van Gogh / Willem Jan Gerrit van Meurs (1), Gogh Museum, Van (1).
- Qualified attributions: 
  - 200318124: carried_out_by | draftsman (artist): Vincent van Gogh (possibly) | Vin…
  - 200384820: carried_out_by | after print by Vincent van Gogh (mentioned on object)…
  - 200664864: influenced_by | after drawing by Vincent van Gogh

### The Met

- Fetch errors during harvest: none.
- Search hits by other artists: 8 — Clockmaker: Vincent van Amelonsen (1), Vincent Jansz. van der Vinne (2), Vincent Laurensz van der Vinne / Jan Vincentsz van der Vinne (5).
- Qualified attributions: 
  - 276299: Author

### Art Institute of Chicago

- Fetch errors during harvest: none.
- Search hits by other artists: none.
- Qualified attributions: 
  - 27952: artist_display: Imitator of Vincent van Gogh (Dutch, 1853–1890)

<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->


## Summary

**Short answer: the data is workable for a knowledge graph, but only with a reconcile step that
a person can audit.** Across the three sources, 59 works resolve to Van Gogh with a plain
creator role: 12 at the Rijksmuseum, 29 at the Met and 18 at AIC. Another 5 are qualified
attributions (possibly, after, imitator, author) and 21 are search noise by other artists.
All 59 have an open image. Only AIC has real description text, on 9 of its 18 works.

How the artist identity lines up across the sources:

```
                       Wikidata Q5582  (authority)
              ┌───────────────┼─────────────────────────┐
     links Q5582 directly  links Q5582 directly   no Wikidata link
              │               │                         │
      Rijksmuseum         The Met                      AIC
   id.rijksmuseum.nl/   constituent 161947     agent 40610 ── Wikidata P6295 ✓
       2102256          (= Wikidata P10882)      + ULAN 500115588 ── Wikidata P245 ✓
   + ULAN, RKD, VIAF    + ULAN 500115588       agent 47301 "Imitator of…"
                                                   └─ also in Wikidata P6295 ✗ (data error)

   ULAN 500115588 is the one identifier all three sources agree on.
```

## Findings worth carrying forward

1. **Identity is the strongest part of the data.** Two of the three sources link Wikidata
   directly, and all three carry ULAN 500115588. No match depended on names alone.
2. **Search is the weakest part.** Neither the Rijksmuseum nor the Met can search by artist
   ID, so harvesting starts from name matching:
   - Rijksmuseum: the full-name search already found all 15 Van Gogh works, but also 8 by
     other people. Theo's full name, "Vincent Willem van Gogh", contains the search terms.
     The extra surname search added 6 more hits, all by other artists (Theo and the C.M.
     van Gogh art dealership), and no Van Gogh works.
   - The Met: `artistOrCulture` matches parts of names, which brought in the van der Vinne
     family and a clockmaker.
   - AIC: artwork search can filter by agent ID, so its results contained no other artists.
3. **Wikidata has errors of its own.** Its ARTIC artist ID property (P6295) for Q5582 lists
   AIC's "Imitator of Vincent van Gogh" agent (47301) as well as the real one (40610). The
   label "Vincent van Gogh" also belongs to four different humans, so the authority lookup
   needs more than a name. This prototype adds occupation "painter".
4. **"Linked Art" does not mean schema-valid.** The Rijksmuseum serves Linked Art that
   expands cleanly as JSON-LD, but no record passes the official object schema. The
   failures:
   - `notation` on embedded Types
   - `language` and `translation_of` on Names
   - `id` on embedded Identifiers
   - a top-level `assigned_by`
   - `subject_to` on the rights statement
   - dimension values given as strings
   - no `_label`

   The Met and AIC records pass because this project builds them to the schema.
5. **The Linked Art schema itself needed a patch.** It declares JSON Schema draft 2020-12
   but uses the older `items: [...]` tuple syntax, so strict validators reject it. The
   prototype rewrites it to `prefixItems` at load time and leaves the saved copy untouched.
6. **Structured fields are not always better than text.** AIC's `dimensions_detail` is in
   whole centimetres (73 × 92 for The Bedroom), while its display text says 73.6 × 92.3 cm.
   The Met's structured measurements are precise, but they include framed and sheet sizes,
   which Linked Art has no place for on the object.
7. **Descriptions are rare.** The Met API has no description field. The Rijksmuseum records
   carry statements (inscriptions, credit lines, provenance) but no description prose.
   AIC has prose on half its works, and that prose is under a different licence (point 8).
8. **Licences differ by field, not just by source.**
   - Rijksmuseum: metadata is CC0, images are Public Domain Mark.
   - The Met: one `isPublicDomain` flag governs the record and its image together.
   - AIC: `description` is CC BY 4.0 inside an otherwise CC0 record.

   A graph that merges records has to keep provenance at field level, or it will lose
   these differences.

## Problems hit

- **No rate limiting at this pace.** Requests were sequential, 0.5–1 s apart, and every
  harvest finished with no errors.
- **The Met's v1 search endpoint was retired on 2026-10-01.** The harvester uses v1.1,
  which pages with `offset`/`limit` (at most 10,000 results).
- **AIC's documentation site returns 403 to automated fetches.** The API itself works, and
  its responses describe their own licence and IIIF base, which this harvester relied on.
- **The Met and AIC have no object or person URIs.** This prototype uses the Met's object
  page URL and the AIC API URL as record IDs, and Wikidata URIs for Met artists. A real
  graph needs a deliberate URI policy (decision 2).

## Recommendations for the full pipeline

1. **Harvest from bulk exports, not per-object APIs.** Use the Rijksmuseum data dumps, the
   Met Open Access CSV and the AIC data dump, and keep the APIs for incremental updates.
   Searching by name does not scale past one artist.
2. **After harvesting, filter by agent ID.** Use name search only to find candidates, then
   keep records whose agent resolves to the authority, as this prototype does. For the
   Rijksmuseum, drop the extra surname search: here it only added noise.
3. **Add a normalisation layer for Linked Art sources.** Keep the raw record and produce a
   schema-valid copy:
   - add `_label`
   - convert dimension values to numbers
   - drop or move `notation`
   - move a top-level `assigned_by` into the production part
4. **Model subjects and roles properly.**
   - **Subjects:** the Met's tags (which already carry AAT and Wikidata IDs) and AIC's
     subject titles need VisualItem records in the graph.
   - **Roles:** the Met's non-Artist roles and AIC's "Imitator of" agents need
     `AttributeAssignment`, not `carried_out_by`.
5. **Track Wikidata issues separately.** Keep a list of suspected authority errors (such as
   P6295 → 47301) for a person to report upstream. This project never writes to Wikidata.
6. **Re-check the endpoints before each phase.** In this phase alone one endpoint was
   retired and one documentation site blocked automated access.

## Decisions for the next phase

1. **Should a crosswalk on two independent IDs be auto-accepted?** Today all 18 AIC works go
   to review because the project rules require an exact ID. *Recommendation:* auto-accept
   when two or more independent IDs agree and the role is plain (confidence 0.9). Keep
   single-ID crosswalks in review, since that's exactly where the P6295 error sits.
2. **URI policy for sources without LOD URIs.** Either mint project URIs for Met and AIC
   objects and people, or use the museums' own page and API URLs. *Recommendation:* mint
   project URIs, and keep the museum URLs as `equivalent` links.
3. **When to bring in Getty sources (out of scope now).** Every source already cites ULAN
   500115588, so the Getty Vocabularies would add a second authority at little matching
   cost. *Recommendation:* add them as the next source, using the same adapter interface.
