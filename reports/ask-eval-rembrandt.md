# Ask the graph eval: Rembrandt

Generated 2026-11-20 by `npm run ask-eval -- --dataset rembrandt`. 7 questions (`eval/ask-rembrandt.json`, reviewed),
run on the graph scoped to that collection; each answered by
claude-opus-5-5 with prompt ac58db5197 (`prompts/ask.md` + `prompts/graph-schema.md`), run on the graph, and compared
with a hand-written reference query. One retry after a failed query, as on the site.

| Metric | Result |
|---|---|
| **Exactly right** | **7 of 7 (100%)** |
| Partly right (list questions, overlap with the reference) | 0 |
| Wrong answer | 0 |
| Query failed to run / invalid / refused / declined | 0 / 0 / 0 / 0 |
| Queries that ran | 7 of 7 |
| Mean overlap on list and row questions | 100% |
| Needed a retry | 0 |
| Cost | $0.069 in all, $0.0098 per question |

| id | question | result | generated query |
|---|---|---|---|
| r01 | How many prints by Rembrandt are there? | exact | `SELECT (COUNT(DISTINCT ?w) AS ?n) WHERE { ?r owl:sameAs wd:Q5598 . ?w mc:artist ?r ; mc:objectType "print" . }` |
| r02 | Which Rembrandt prints are held by four museums? | exact | `SELECT ?p ?title (COUNT(DISTINCT ?museum) AS ?museums) WHERE { ?r owl:sameAs wd:Q5598 . ?p a mc:Print ; mc:artist ?r . OPTIONAL { ?p dcterms:title ?title } ?w mc:impressionOf ?p ; mc:museum ?museum . } GROUP BY ?p ?title` |
| r03 | How many impressions of the Hundred Guilder Print does each museum hold? | exact | `SELECT ?museum (COUNT(DISTINCT ?w) AS ?impressions) WHERE { ?r owl:sameAs wd:Q5598 . ?p a mc:Print ; mc:artist ?r . OPTIONAL { ?p dcterms:title ?t } OPTIONAL { ?p mc:bartsch ?b } FILTER(CONTAINS(LCASE(STR(?t)), "hundred ` |
| r04 | Which museums have paintings by Rembrandt, and how many each? | exact | `SELECT ?museum (COUNT(DISTINCT ?w) AS ?n) WHERE { ?r owl:sameAs wd:Q5598 . ?w mc:artist ?r ; mc:objectType "painting" ; mc:museum ?museum . } GROUP BY ?museum ORDER BY DESC(?n)` |
| r05 | Which Rembrandt drawings does the Met have? | exact | `SELECT ?w ?title WHERE { ?r owl:sameAs wd:Q5598 . ?w mc:artist ?r ; mc:museum "met" ; mc:objectType "drawing" ; dcterms:title ?title . }` |
| r06 | In which decade did Rembrandt begin the most prints? | exact | `SELECT ?decade (COUNT(DISTINCT ?w) AS ?n) WHERE { ?r owl:sameAs wd:Q5598 . ?w mc:artist ?r ; mc:objectType "print" ; mc:beginYear ?y . BIND(FLOOR(?y / 10) * 10 AS ?decade) } GROUP BY ?decade ORDER BY DESC(?n)` |
| r07 | How many Rembrandt prints have impressions in only one museum? | exact | `SELECT (COUNT(?p) AS ?n) WHERE { { SELECT ?p WHERE { ?r owl:sameAs wd:Q5598 . ?p a mc:Print ; mc:artist ?r . ?w mc:impressionOf ?p ; mc:museum ?m . } GROUP BY ?p HAVING (COUNT(DISTINCT ?m) = 1) } }` |

<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->
