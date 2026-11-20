# The graph

Two collections in one graph, joined through Wikidata: **paintings made 1850–1900** from the Rijksmuseum, The Met and the Art
Institute of Chicago (`mc:dataset "paintings-1850-1900"`), and **everything five museums hold by Rembrandt** (paintings,
drawings and prints; those three plus SMK and the Cleveland Museum of Art; `mc:dataset "rembrandt"`). Prefixes (all predeclared):

```
mc:      <https://aprigge.github.io/museum-crosswalk/ns#>   this project's terms
dcterms: <http://purl.org/dc/terms/>
skos:    <http://www.w3.org/2004/02/skos/core#>
rdfs:    <http://www.w3.org/2000/01/rdf-schema#>
owl:     <http://www.w3.org/2002/07/owl#>
schema:  <https://schema.org/>
prov:    <http://www.w3.org/ns/prov#>
wd:      <http://www.wikidata.org/entity/>
id:      <https://aprigge.github.io/museum-crosswalk/id/>
```

## Works (`?w a mc:Work`, URIs like `id:work/aic-28560`)

| Property | Value |
|---|---|
| `mc:museum` | `"rijksmuseum"`, `"met"`, `"aic"`, `"smk"` or `"cleveland"` (plain strings) |
| `mc:dataset` | `"paintings-1850-1900"` or `"rembrandt"`: the collection the work was harvested for |
| `mc:objectType` | `"print"`, `"drawing"`, `"painting"` or `"other"`, as the museum states it |
| `dcterms:title` | title (plain string) |
| `mc:beginYear`, `mc:endYear` | integers |
| `mc:artist` | a person: the work is plainly by them |
| `mc:qualifiedArtist` | a person the work is only "after", "attributed to", "imitator of", "workshop of" |
| `mc:style` | a concept: the style the museum states (only AIC states styles) |
| `mc:inferredStyle` | a concept: the artist's movement on Wikidata, not the museum's claim (graph `derived`) |
| `mc:subject` | a concept: a subject the museum recorded |
| `mc:aiSubject` | a concept: a subject an AI model suggested from the image (graph `ai`) |
| `dcterms:license` | licence URI; absent when the record is not open access |
| `schema:thumbnailUrl`, `schema:url` | image, museum web page |
| `mc:impressionOf` | a print (`mc:Print`) this object is an impression of |
| `mc:catalogueRef`, `mc:state` | catalogue citations as the museum wrote them (`"Bartsch 74"`), and the print's state (`"i/iii"`) |

## People (URIs like `id:person/Q296`)

`rdfs:label` (plain string, e.g. `"Claude Monet"`), `owl:sameAs` Wikidata, `mc:birthYear`, `mc:deathYear` (integers), `mc:movement` (a concept, e.g. Impressionism, Hague School). From Wikidata, as plain strings: `mc:birthPlace` (e.g. `"Paris"`), `mc:citizenship` (country, often a historical name such as `"Kingdom of the Netherlands"` or `"United Kingdom of Great Britain and Ireland"`, so match it with `CONTAINS`), and `mc:gender` (`"male"`, `"female"`). Some people have more than one citizenship. Each person has `mc:sourceAgent` nodes, one per museum record of them, with `mc:museum`, `mc:matchMethod` (`"exact-id"`, `"wikidata-crosswalk"`, `"name-dates"`, `"human-approved"`), `mc:matchConfidence`, `mc:matchDecision`.

Each `mc:sourceAgent` also has `mc:matchCandidate`, the Wikidata item its evidence points to, even when policy keeps the record
unmerged (an "After Rembrandt" record stays unmerged but points to `wd:Q5598`).

## Prints (`?p a mc:Print`, URIs like `id:print/Q5598-B74`)

One copper plate printed many times: each museum object is an impression (`?w mc:impressionOf ?p`). `mc:artist` (a person),
`dcterms:title`, `mc:bartsch` and `mc:newHollstein` (catalogue numbers, integers). Impressions are grouped by catalogue
number, so The Met's prints (it gives no numbers) have no `mc:impressionOf`. Find Rembrandt with `?r owl:sameAs wd:Q5598`.

## Concepts (URIs like `id:concept/Q191163`)

`skos:prefLabel` and `skos:altLabel`, **language-tagged English literals** (`"snow"@en`), `owl:sameAs` Wikidata. Project alignments: `skos:closeMatch` (same meaning, e.g. landscape painting ≈ landscape), `skos:related` (related, not the same, e.g. Hague School ~ Impressionism).

## AI suggestions

Each `mc:AiSuggestion` node has `mc:onWork`, `mc:concept`, `mc:confidence` (0–1), `mc:evidence` (what the model saw). Only suggestions with confidence ≥ 0.6 are linked by `mc:aiSubject`.

## Rules that matter

- **Labels are language-tagged.** `?l = "snow"` never matches `"snow"@en`. Compare with `LCASE(STR(?l)) = "snow"`, or `CONTAINS(LCASE(STR(?l)), "landscape")` for a looser match. Search both `skos:prefLabel` and `skos:altLabel` (`skos:prefLabel|skos:altLabel`).
- **Subjects:** include both `mc:subject` and `mc:aiSubject` (`{ ?w mc:subject ?c } UNION { ?w mc:aiSubject ?c }`) unless the question asks for what the museums recorded; AI suggestions are part of the site's default view.
- **Styles and movements:** "Impressionist" means `mc:style` or `mc:inferredStyle` with the concept labelled `"Impressionism"@en`, or for people, `mc:movement`.
- **Artists by name:** match `rdfs:label` exactly when the question gives a full name.
- **Qualified attributions** (`mc:qualifiedArtist`) often point to a separate person record whose label carries the
  qualifier, such as "Imitator of Vincent van Gogh", "After Rembrandt" or "Workshop of …". Match those labels with
  `CONTAINS`, not an exact name.
- **Counting works:** use `COUNT(DISTINCT ?w)`; UNIONs and several labels per concept multiply rows.
- **Lists of works:** return `?w` and `?title`; don't add `LIMIT` unless the question asks for a number of results.
- **Which collection:** a question about "paintings" that names no artist or collection means the 1850–1900 collection: add
  `?w mc:dataset "paintings-1850-1900"` and say so in the explanation. A question about Rembrandt means his works
  (`?w mc:artist ?r . ?r owl:sameAs wd:Q5598`); "prints", "drawings" and "paintings" of his mean `mc:objectType`.
- **Prints vs impressions:** "how many prints" of an artist counts objects (`mc:objectType "print"`); "which prints are held by…"
  or "how many impressions of…" uses `mc:Print` and `mc:impressionOf`.
- **URIs in queries:** a prefixed name can't contain `/`, so never write `id:person/Q5598`; find people by `owl:sameAs wd:…` or
  `rdfs:label`, and write a full URI in `<…>` if you need one.
- Read-only: SELECT (or ASK/CONSTRUCT) only.

## Examples

Question: Which paintings by Jean-Baptiste Camille Corot are at the Art Institute of Chicago?
```sparql
SELECT ?w ?title WHERE { ?w mc:artist ?p ; mc:museum "aic" ; dcterms:title ?title . ?p rdfs:label "Jean-Baptiste Camille Corot" }
```

Question: How many paintings show horses?
```sparql
SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE {
  { ?w mc:subject ?c } UNION { ?w mc:aiSubject ?c }
  ?c skos:prefLabel|skos:altLabel ?l . FILTER(LCASE(STR(?l)) IN ("horse", "horses"))
}
```

Question: Which Post-Impressionist paintings are at the Met?
```sparql
SELECT DISTINCT ?w ?title WHERE {
  ?w mc:museum "met" ; dcterms:title ?title .
  { ?w mc:style ?s } UNION { ?w mc:inferredStyle ?s }
  ?s skos:prefLabel ?sl . FILTER(LCASE(STR(?sl)) = "post-impressionism")
}
```

Question: Which artists were matched through Wikidata listing the museum's own ID?
```sparql
SELECT DISTINCT ?artist ?museum WHERE { ?p rdfs:label ?artist ; mc:sourceAgent ?a . ?a mc:matchMethod "wikidata-crosswalk" ; mc:museum ?museum }
```

Question: Paintings the AI thinks show a river, with what it saw
```sparql
SELECT ?w ?title ?confidence ?evidence WHERE {
  ?s a mc:AiSuggestion ; mc:onWork ?w ; mc:concept ?c ; mc:confidence ?confidence ; mc:evidence ?evidence .
  ?c skos:prefLabel ?l . FILTER(LCASE(STR(?l)) = "river")
  ?w dcterms:title ?title .
} ORDER BY DESC(?confidence)
```

Question: Rembrandt prints with impressions at both SMK and the Cleveland Museum of Art
```sparql
SELECT ?p ?title WHERE {
  ?r owl:sameAs wd:Q5598 . ?p a mc:Print ; mc:artist ?r . OPTIONAL { ?p dcterms:title ?title }
  ?a mc:impressionOf ?p ; mc:museum "smk" . ?b mc:impressionOf ?p ; mc:museum "cleveland" .
} GROUP BY ?p ?title
```

Question: What catalogue numbers and state does the Art Institute give for its Rembrandt impressions of The Three Crosses?
```sparql
SELECT ?w ?ref ?state WHERE {
  ?r owl:sameAs wd:Q5598 . ?w mc:artist ?r ; mc:museum "aic" ; dcterms:title ?t ; mc:catalogueRef ?ref .
  OPTIONAL { ?w mc:state ?state } FILTER(CONTAINS(LCASE(?t), "three crosses"))
}
```

Question: How many paintings were made in each decade?
```sparql
SELECT ?decade (COUNT(?w) AS ?n) WHERE { ?w a mc:Work ; mc:beginYear ?y . BIND(FLOOR(?y / 10) * 10 AS ?decade) } GROUP BY ?decade ORDER BY ?decade
```
