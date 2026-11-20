# Ask the graph eval: proposed questions (for review)

20 plain-English questions, each with a hand-written reference SPARQL query (in `eval/ask.json`).
The generated query and the reference both run on the graph and their answers are compared.

| id | question | tags | graded on | reference answer |
|---|---|---|---|---|
| a01 | How many paintings from the Rijksmuseum are in the collection? | count, museum | value | 395 |
| a02 | How many paintings by Claude Monet are there? | count, artist | value | 26 |
| a03 | Which Vincent van Gogh paintings does the Met have? | list, artist, museum | works | 17 paintings |
| a04 | Which artists have paintings in all three museums? | cross-museum | rows | 3 rows: Gustave Courbet; Léon Bonnat; Vincent van Gogh |
| a05 | How many artists have works in more than one museum? | count, cross-museum | value | 24 |
| a06 | Show me landscapes at the Rijksmuseum. | list, subject, museum | works | 134 paintings |
| a07 | Which Impressionist paintings show snow? | list, style, subject | works | 9 paintings |
| a08 | How many paintings have subjects that were suggested by AI rather than recorded by the museum? | provenance, ai | value | 932 |
| a09 | Which paintings did the AI tag with night that the museum didn't? | provenance, ai, list | works | 22 paintings |
| a10 | When was Berthe Morisot born and when did she die? | artist-fact | rows | 1 rows: 1841 | 1895 |
| a11 | Which artists in the collection belong to the Hague School? | artist-fact, movement | rows | 25 rows: Albert Neuhuys; Andreas Schelfhout; Anthonie Waldorp; Anton Mauve; … |
| a12 | How many paintings were begun in the 1880s? | count, date | value | 242 |
| a13 | How many paintings does each museum have? | aggregate, museum | rows | 3 rows: 395 | rijksmuseum; 611 | aic; 95 | met |
| a14 | Which five artists have the most paintings? | aggregate, artist | rows | 5 rows: 26 | Claude Monet; 27 | Jean-Baptiste Camille Corot; 27 | Xu Gu; 28 | Paul Cézanne; … |
| a15 | Find paintings of boats from before 1870. | list, subject, date | works | 52 paintings |
| a16 | How many artist records were matched by a person approving an AI suggestion? | provenance, reconcile | value | 24 |
| a17 | How many paintings are not open access? | provenance, license | value | 3 |
| a18 | Which paintings are only attributed to, after, or imitating Vincent van Gogh? | list, artist, attribution | works | 1 paintings |
| a19 | Portraits of women at the Met | list, subject, museum | works | 13 paintings |
| a20 | Which Impressionist painters have works in more than one museum? | cross-museum, style | rows | 4 rows: Claude Monet; Eugène Louis Boudin; Frédéric Bazille; Henri Fantin-Latour |
