# Rembrandt across five museums

Generated 2026-11-20 by `npm run rembrandt-report` from the site's graph (`data/graph/site/core.nq`).
Phase 4 of museum-crosswalk: everything five open museum APIs hold by Rembrandt van Rijn (Wikidata Q5598).

## Records and works

"By Rembrandt" counts works whose record names him plainly. "After, school, workshop…" counts records that name him with a
qualifier (after, copy after, school of, imitator of, earlier ascribed to) and are not also plainly his; they are never counted as his.
Object types are as each museum states them.

| Museum | Records harvested | Prints | Drawings | Paintings | By Rembrandt | After, school, workshop… | With an open image |
|---|---|---|---|---|---|---|---|
| Rijksmuseum | 1469 | 1307 | 64 | 24 | **1397** | 46 | 1383 |
| The Met | 372 | 243 | 21 | 20 | **284** | 66 | 284 |
| Art Institute of Chicago | 255 | 224 | 4 | 1 | **229** | 11 | 229 |
| SMK, National Gallery of Denmark | 830 | 414 | 4 | 2 | **421** | 407 | 307 |
| Cleveland Museum of Art | 122 | 100 | 3 | – | **103** | 17 | 103 |
| **All five** | 3048 | 2288 | 96 | 47 | **2434** | 547 | 2306 |

## How each museum's record of Rembrandt was matched

Each row is one museum's own ID for a person whose evidence points to Rembrandt. "Plainly his" records are merged and credit
him as the artist; the rest name him with a qualifier, or stay in review (an agent named "School of…" is never merged).

| Museum | Museum ID | Names used | How matched | Records plainly his | Other records |
|---|---|---|---|---|---|
| Art Institute of Chicago | 40769 | Rembrandt van Rijn | wikidata-crosswalk | 229 | 8 |
| Art Institute of Chicago | 46371 | School of Rembrandt van Rijn | wikidata-crosswalk | 0 | 3 |
| Cleveland Museum of Art | 2520 | Rembrandt van Rijn | human-approved | 102 | 13 |
| Cleveland Museum of Art | 291869 | Rembrandt van Rijn | human-approved | 1 | 4 |
| The Met | 162297 | Rembrandt (Rembrandt van Rijn); After Rembrandt (Rembrandt van Rijn); School of Rembrandt (Rembrandt van Rijn); Circle of Rembrandt (Rembrandt van Rijn); … | exact-id | 284 | 68 |
| Rijksmuseum | 2103429 | Rembrandt van Rijn | exact-id | 1398 | 1292 |
| SMK, National Gallery of Denmark | 1871_person | Rembrandt van Rijn | human-approved | 421 | 418 |

## Prints and their impressions

1993 impressions plainly by Rembrandt are grouped into 307 prints by the catalogue numbers the museums cite
(Bartsch / Hollstein, then New Hollstein where no Bartsch number is given), never by title.

| Held by | Prints |
|---|---|
| 4 museums | 71 |
| 3 museums | 108 |
| 2 museums | 78 |
| 1 museum | 50 |

Held most widely:

| Print | Bartsch | Museums | Impressions |
|---|---|---|---|
| The Hundred Guilder Print | 74 | 4 | 27 |
| The Entombment | 86 | 4 | 21 |
| Clement de Jonghe, Printseller | 272 | 4 | 20 |
| Jan Lutma, Goldsmith | 276 | 4 | 19 |
| Abraham Francen, Apothecary | 273 | 4 | 18 |
| Rembrandt drawing at a window | 22 | 4 | 16 |
| The Death of the Virgin | 99 | 4 | 16 |
| Jan Uytenbogaert | 281 | 4 | 14 |
| Selfportrait in velvet cap and plume, with an embroidered dress: bust | 20 | 4 | 13 |
| Christ and the woman of Samaria: an arched print | 70 | 4 | 13 |

Prints by Rembrandt left ungrouped, by museum:

| Museum | Ungrouped prints | Of which cite a catalogue number |
|---|---|---|
| The Met | 243 | 0 |
| Rijksmuseum | 35 | 33 |
| SMK, National Gallery of Denmark | 12 | 10 |
| Art Institute of Chicago | 3 | 1 |
| Cleveland Museum of Art | 2 | 2 |

Groups noting a record whose New Hollstein number usually belongs to another print (kept in its Bartsch group, not merged):

- Abraham's Sacrifice (Bartsch 35): rijksmuseum:200124741 cites New Hollstein 224, usually Bartsch 34
- The Tribute Money (Bartsch 68): aic:200626 cites New Hollstein 139, usually Bartsch 69
- Polander standing with arms folded (Bartsch 140): smk:KKSgb8974 cites New Hollstein 76, usually Bartsch 141
- Omskærelsen (Bartsch 165): smk:KKSgb26593 cites New Hollstein 1, usually Bartsch 398
- The artist drawing from a model: unfinished plate (Bartsch 192): aic:147617 cites New Hollstein 175, usually Bartsch 259
- Naked woman seated on a mound (Bartsch 198): rijksmuseum:200125418 cites New Hollstein 310, usually Bartsch 199
- Woman Bathing Her Feet in a Brook (Bartsch 200): cleveland:160065 cites New Hollstein 209, usually Bartsch 356
- View of the Diemerdijk with a Milkman and Cottages (Bartsch 213): smk:KKS757 cites New Hollstein 220, usually Bartsch 231
- Thomas Haaringh (Bartsch 274): rijksmuseum:200126210 cites New Hollstein 301, usually Bartsch 273
- The agony in the garden (Bartsch 293): smk:KKS7560 cites New Hollstein 269, usually Bartsch 75; smk:KKSgb10169 cites New Hollstein 269, usually Bartsch 75; smk:KKSgb9075 cites New Hollstein 269, usually Bartsch 75
- Man Crying Out, Three Quarters Left: Bust (Bartsch 300): smk:KKSgb8910 cites New Hollstein 33, usually Bartsch 143
- Old man in fur coat and high cap: bust (Bartsch 333): smk:KKSgb8908 cites New Hollstein 33, usually Bartsch 143

<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->
## Findings

- **Five open APIs, one artist, 3,048 records; 2,434 works plainly by Rembrandt.** Most are prints (2,288). The Rijksmuseum, his
  home museum, holds more than half. Every museum states him differently: the Rijksmuseum and The Met link Wikidata directly, AIC
  through its own ID that Wikidata lists, and SMK and Cleveland only by name and life years, which a person confirmed once per
  museum ID (`alignments/review-decisions.json`).
- **Searching by name finds far more than his work.** The Rijksmuseum's name search returns reproductions by other printmakers
  "after design by Rembrandt"; AIC's returns Rembrandt Peale; The Met uses one constituent ID for "Rembrandt", "After Rembrandt",
  "School of Rembrandt" and more. Qualifiers decide what counts as his, not the ID.
- **Wikidata has an error here too.** It lists AIC agent 46371 as Rembrandt's AIC ID; AIC names that agent "School of Rembrandt van
  Rijn". As with Van Gogh's "Imitator of" ID in phase 1, the record stays in review.
- **Prints group well by catalogue number, not by anything else.** Four museums cite Bartsch / Hollstein and New Hollstein
  numbers, and 1,993 impressions fall into 307 prints, close to the roughly 290 etchings usually counted. A first version that
  joined records on either number let a few odd records chain different prints together (an AIC impression citing Bartsch 68 with
  New Hollstein 139, which belongs to Bartsch 69); grouping now keys on Bartsch and only notes such records.
- **The Met's API gives no catalogue numbers**, so its 243 prints cannot be grouped; matching them by title would be guesswork.
- **Dates are the museums' own**: a few impressions are dated to the 18th or 19th century, when they were printed.
