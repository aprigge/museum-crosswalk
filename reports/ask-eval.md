# Ask the graph eval: the 1850–1900 paintings

Generated 2026-11-20 by `npm run ask-eval`. 20 questions (`eval/ask.json`, reviewed),
run on the graph scoped to that collection; each answered by
claude-opus-5-5 with prompt ac58db5197 (`prompts/ask.md` + `prompts/graph-schema.md`), run on the graph, and compared
with a hand-written reference query. One retry after a failed query, as on the site.

| Metric | Result |
|---|---|
| **Exactly right** | **19 of 20 (95%)** |
| Partly right (list questions, overlap with the reference) | 1 |
| Wrong answer | 0 |
| Query failed to run / invalid / refused / declined | 0 / 0 / 0 / 0 |
| Queries that ran | 20 of 20 |
| Mean overlap on list and row questions | 100% |
| Needed a retry | 0 |
| Cost | $0.208 in all, $0.0104 per question |

| id | question | result | generated query |
|---|---|---|---|
| a01 | How many paintings from the Rijksmuseum are in the collection? | exact | `SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w a mc:Work ; mc:museum "rijksmuseum" ; mc:dataset "paintings-1850-1900" . }` |
| a02 | How many paintings by Claude Monet are there? | exact | `SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w a mc:Work ; mc:artist ?p . ?p rdfs:label "Claude Monet" }` |
| a03 | Which Vincent van Gogh paintings does the Met have? | exact | `SELECT ?w ?title WHERE { ?w mc:artist ?p ; mc:museum "met" ; dcterms:title ?title . ?p rdfs:label "Vincent van Gogh" }` |
| a04 | Which artists have paintings in all three museums? | exact | `SELECT DISTINCT ?p ?artist WHERE { ?p rdfs:label ?artist . ?a mc:artist ?p ; mc:dataset "paintings-1850-1900" ; mc:museum "rijksmuseum" . ?b mc:artist ?p ; mc:dataset "paintings-1850-1900" ; mc:museum "met" . ?c mc:artis` |
| a05 | How many artists have works in more than one museum? | exact | `SELECT (COUNT(?p) AS ?artists) WHERE { { SELECT ?p WHERE { ?w a mc:Work ; mc:artist ?p ; mc:museum ?m . } GROUP BY ?p HAVING (COUNT(DISTINCT ?m) > 1) } }` |
| a06 | Show me landscapes at the Rijksmuseum. | exact | `SELECT DISTINCT ?w ?title WHERE { ?w mc:museum "rijksmuseum" ; dcterms:title ?title . { ?w mc:subject ?c } UNION { ?w mc:aiSubject ?c } ?c skos:prefLabel\|skos:altLabel ?l . FILTER(CONTAINS(LCASE(STR(?l)), "landscape")) ` |
| a07 | Which Impressionist paintings show snow? | exact | `SELECT DISTINCT ?w ?title WHERE { ?w mc:dataset "paintings-1850-1900" ; dcterms:title ?title . { ?w mc:style ?s } UNION { ?w mc:inferredStyle ?s } ?s skos:prefLabel ?sl . FILTER(LCASE(STR(?sl)) = "impressionism") { ?w mc` |
| a08 | How many paintings have subjects that were suggested by AI rather than recorded by the museum? | exact | `SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w mc:dataset "paintings-1850-1900" ; mc:aiSubject ?c . FILTER NOT EXISTS { ?w mc:subject ?c } }` |
| a09 | Which paintings did the AI tag with night that the museum didn't? | exact | `SELECT DISTINCT ?w ?title WHERE { ?w mc:dataset "paintings-1850-1900" ; dcterms:title ?title ; mc:aiSubject ?c . ?c skos:prefLabel\|skos:altLabel ?l . FILTER(LCASE(STR(?l)) = "night") FILTER NOT EXISTS { ?w mc:subject ?m` |
| a10 | When was Berthe Morisot born and when did she die? | exact | `SELECT ?p ?birthYear ?deathYear WHERE { ?p rdfs:label "Berthe Morisot" . OPTIONAL { ?p mc:birthYear ?birthYear } OPTIONAL { ?p mc:deathYear ?deathYear } }` |
| a11 | Which artists in the collection belong to the Hague School? | exact | `SELECT DISTINCT ?p ?artist WHERE { ?w a mc:Work ; mc:artist ?p . ?p rdfs:label ?artist ; mc:movement ?m . ?m skos:prefLabel\|skos:altLabel ?l . FILTER(LCASE(STR(?l)) = "hague school") } ORDER BY ?artist` |
| a12 | How many paintings were begun in the 1880s? | exact | `SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w a mc:Work ; mc:dataset "paintings-1850-1900" ; mc:beginYear ?y . FILTER(?y >= 1880 && ?y <= 1889) }` |
| a13 | How many paintings does each museum have? | exact | `SELECT ?museum (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w a mc:Work ; mc:dataset "paintings-1850-1900" ; mc:museum ?museum . } GROUP BY ?museum ORDER BY DESC(?n)` |
| a14 | Which five artists have the most paintings? | exact | `SELECT ?artist ?name (COUNT(DISTINCT ?w) AS ?paintings) WHERE { ?w mc:dataset "paintings-1850-1900" ; mc:artist ?artist . ?artist rdfs:label ?name . } GROUP BY ?artist ?name ORDER BY DESC(?paintings) LIMIT 5` |
| a15 | Find paintings of boats from before 1870. | partial (94%) | `SELECT DISTINCT ?w ?title ?year WHERE { ?w mc:dataset "paintings-1850-1900" ; dcterms:title ?title ; mc:beginYear ?year . FILTER(?year < 1870) { ?w mc:subject ?c } UNION { ?w mc:aiSubject ?c } ?c skos:prefLabel\|skos:alt` |
| a16 | How many artist records were matched by a person approving an AI suggestion? | exact | `SELECT (COUNT(DISTINCT ?a) AS ?records) (COUNT(DISTINCT ?p) AS ?people) WHERE { ?p mc:sourceAgent ?a . ?a mc:matchMethod "human-approved" }` |
| a17 | How many paintings are not open access? | exact | `SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?w a mc:Work ; mc:dataset "paintings-1850-1900" . FILTER NOT EXISTS { ?w dcterms:license ?lic } }` |
| a18 | Which paintings are only attributed to, after, or imitating Vincent van Gogh? | exact | `SELECT DISTINCT ?w ?title ?attribution ?museum WHERE { ?w mc:qualifiedArtist ?p ; dcterms:title ?title ; mc:museum ?museum . ?p rdfs:label ?attribution . FILTER(CONTAINS(LCASE(?attribution), "van gogh")) } ORDER BY ?attr` |
| a19 | Portraits of women at the Met | exact | `SELECT DISTINCT ?w ?title WHERE { ?w mc:museum "met" ; dcterms:title ?title . { ?w mc:subject ?c1 } UNION { ?w mc:aiSubject ?c1 } ?c1 skos:prefLabel\|skos:altLabel ?l1 . FILTER(CONTAINS(LCASE(STR(?l1)), "portrait")) { ?w` |
| a20 | Which Impressionist painters have works in more than one museum? | exact | `SELECT ?artist (COUNT(DISTINCT ?museum) AS ?museums) (GROUP_CONCAT(DISTINCT ?museum; separator=", ") AS ?museumList) WHERE { ?p mc:movement ?m ; rdfs:label ?artist . ?m skos:prefLabel ?ml . FILTER(LCASE(STR(?ml)) = "impr` |

<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->
