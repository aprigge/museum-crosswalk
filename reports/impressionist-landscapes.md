# "Impressionist landscapes" across three museums

Generated 2026-11-19 by `npm run evaluate` from the search index the site uses
(`site/data/search-index.json`) and the core graph. Slice: paintings made 1850–1900.

**Answer: 3 of 3 museums return results** Rijksmuseum 2, The Met 3, Art Institute of Chicago 90.
Results group by 34 artists; 3 of them have hits in more than one museum.

## Hits per museum

| Museum | Works in slice | Text search hits | Concept query (SPARQL) hits |
|---|---|---|---|
| Rijksmuseum | 395 | 2 | 0 |
| The Met | 95 | 3 | 2 |
| Art Institute of Chicago | 611 | 90 | 80 |

The Met's slice is **partial**: 95 of its paintings were harvested before its firewall blocked requests.

- **Text search** is what the site runs: MiniSearch with all terms required ("Impressionist landscapes" → `impression` AND `landscape`), prefix and light fuzzy matching.
- **Concept query** is `queries/impressionist-landscapes.rq`: Impressionism (Wikidata Q40415) as the museum's style or the artist's movement, and landscape (Q191163, aligned with Q107425).
- 15 of 95 hits match "Impressionist" only through the artist's movement on Wikidata, not through the museum's own data.

## Grouped by artist

| Artist | Museums | Hits | Example |
|---|---|---|---|
| Claude Monet | Art Institute of Chicago, Rijksmuseum | 25 | Stack of Wheat |
| Eugène Louis Boudin | Art Institute of Chicago, The Met | 5 | Washerwomen at the Edge of the Pond |
| Frédéric Bazille | Art Institute of Chicago, The Met | 2 | Landscape at Chailly |
| Alfred Sisley | Art Institute of Chicago | 6 | Landscape along the Seine with the Institut de France and the Pont des Arts |
| Camille Pissarro | Art Institute of Chicago | 6 | The Banks of the Marne in Winter |
| James McNeill Whistler | Art Institute of Chicago | 5 | Coast Scene, Bathers |
| Paul Gauguin | Art Institute of Chicago | 5 | Te raau rahi (The Big Tree) |
| Winslow Homer | Art Institute of Chicago | 4 | Mount Washington |
| Pierre-Auguste Renoir | Art Institute of Chicago | 3 | Studies of Pierre Renoir; His Mother, Aline Charigot; Nudes; and Landscape |
| William Merritt Chase | Art Institute of Chicago | 2 | Wind-Swept Sands |
| Childe Hassam | Art Institute of Chicago | 2 | The Little Pond, Appledore |
| John Henry Twachtman | Art Institute of Chicago | 2 | The White Bridge |
| Armand Guillaumin | Art Institute of Chicago | 2 | The Arcueil Aqueduct at Sceaux Railroad Crossing |
| George Inness | Art Institute of Chicago | 2 | The Mill Pond |
| Édouard Manet | Art Institute of Chicago | 2 | Sea View, Calm Weather (Vue de mer, temps calme) |
| Paul Cézanne | Art Institute of Chicago | 2 | Auvers, Panoramic View |
| George Hitchcock | Art Institute of Chicago | 2 | The Annunciation |
| Johan Jongkind | Art Institute of Chicago | 2 | The Church of Overschie |
| Theodore Robinson | Art Institute of Chicago | 1 | The Valley of Arconville |
| Albert André | Art Institute of Chicago | 1 | Place des Batignolles, Paris |
| Berthe Morisot | Art Institute of Chicago | 1 | Forêt de Compiègne |
| Albert Pinkham Ryder | Art Institute of Chicago | 1 | The Essex Canal |
| Homer Dodge Martin | Art Institute of Chicago | 1 | On the Seine |
| Robert Vonnoh | Art Institute of Chicago | 1 | Spring in France |
| Samuel Colman | Art Institute of Chicago | 1 | Old Tower at Avignon |

## Why the top hits matched

| Work | Museum | Matched on |
|---|---|---|
| Landscape at Chailly (Frédéric Bazille) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: title, subject, AI-suggested subject |
| Landscape along the Seine with the Institut de France and the Pont des Arts (Alfred Sisley) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: title, subject, AI-suggested subject |
| Studies of Pierre Renoir; His Mother, Aline Charigot; Nudes; and Landscape (Pierre-Auguste Renoir) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: title, subject, AI-suggested subject |
| Wind-Swept Sands (William Merritt Chase) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |
| The Little Pond, Appledore (Childe Hassam) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |
| The White Bridge (John Henry Twachtman) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |
| The Valley of Arconville (Theodore Robinson) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |
| A City Park (William Merritt Chase) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |
| Icebound (John Henry Twachtman) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |
| Place des Batignolles, Paris (Albert André) | Art Institute of Chicago | impression: museum's style, subject; landscape: subject |
| Forêt de Compiègne (Berthe Morisot) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |
| Stack of Wheat (Claude Monet) | Art Institute of Chicago | impression: museum's style, artist's movement (Wikidata); landscape: subject, AI-suggested subject |

<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->


## Reading the answer

**Yes, since AI subjects were added (phase 3).** Before, the query returned AIC (90) and the
Met (2) but nothing from the Rijksmuseum. With subjects that Claude Opus 5.5 suggested from the
images, the Rijksmuseum answers too, first with Monet's *La Corniche near Monaco*, which the
museum catalogues as "Monaco, temperate climate, road" and the AI tagged "landscape". Its second
hit, a Fantin-Latour figure painting, is a false positive. Grouping is correct where an artist
has hits in more than one museum: Eugène Boudin's works at the Met and AIC group as one person,
because both museums' records resolve to the same Wikidata entry. The measured before/after is
in [eval.md](eval.md).

The notes below describe the museum data itself, before AI subjects, and still hold.

Why each museum looks the way it does:

- **AIC** states the style itself (`style_titles` → AAT Impressionism) and tags subjects with
  AAT "landscapes", so its works match on the museum's own data.
- **The Met** has no style field. Its works can only match "Impressionist" through the artist's
  movement on Wikidata, a derived claim kept in its own named graph. The bigger gap is the
  harvest: only 95 of about 1,300 Met paintings are in, because its firewall blocked us. Its
  Monets, Pissarros and Sisleys are not harvested yet.
- **The Rijksmuseum** has no style field either, and its painters of 1850–1900 are mostly the
  Hague School (Jacob and Matthijs Maris, Jozef Israëls, George Hendrik Breitner), whom Wikidata
  does not class as Impressionists. Its one Monet, *La Corniche near Monaco*, is catalogued with
  the subjects Monaco, temperate climate and road, but no landscape code, so it cannot match.

## Choices made in this pass

- **Post-Impressionism is not Impressionism.** Hyphenated words are kept whole, so
  "Impressionist" no longer matches Cézanne, Gauguin or Van Gogh through
  "Post-Impressionism" (22 hits removed). "post-impressionist" still finds them.
- **Fuzzy matching allows one edit, on words of six letters or more.** A looser setting let
  "impression" match "expression" and brought in Jan Toorop's *The Sea*.
- **Landscape is aligned by the project.** AAT "landscapes" (via Wikidata Q191163, landscape
  painting) and Iconclass 25H (Q107425, landscape) are linked with `skos:closeMatch` in
  `alignments/concepts.ttl`, a graph of the project's own claims.
- **A source's own Wikidata link wins over our lookup.** The Met tags "Landscapes" with
  AAT 300132294, which Wikidata maps to "natural landscape", and also links Q191163 directly.

## Decided, and still open

1. **The Hague School is related to Impressionism, not the same.** It is often called Dutch Impressionism,
   but Wikidata keeps them separate, and so does the project: `alignments/concepts.ttl` marks them
   `skos:related`, so "Impressionist" still follows Wikidata and the site offers the Hague School
   as a related movement.
2. **The Met harvest** resumes once its firewall block lifts, at one request every 3 seconds.
