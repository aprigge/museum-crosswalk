# Search eval: proposed queries (for review)

20 queries a visitor might type, each with what counts as a relevant painting. Baseline
counts are today's search hits (Rijksmuseum / Met / AIC). Tags: `headline`, `genre`,
`subject`, `place`, `movement`, `artist`, `combined`.

Grading (next sign-off): for each query, the top 5 results per museum from every variant
are pooled and you mark each pooled painting relevant or not. Metrics: precision at 10,
recall against the pool, museums with a relevant hit, artist grouping, AI share.

| id | query | tags | relevant means | baseline (R / M / A) |
|---|---|---|---|---|
| q01 | Impressionist landscapes | headline, combined | an outdoor landscape painted by an Impressionist (by Wikidata movement or museum style) | 0 / 2 / 90 |
| q02 | landscape | genre | the main subject is land, countryside or nature seen as a view | 35 / 15 / 210 |
| q03 | seascape | genre | the sea or coast is the main subject | 1 / 0 / 5 |
| q04 | portrait | genre | a painting of a specific person (or people) as its main subject | 27 / 16 / 106 |
| q05 | self-portrait | genre | the artist painting themself | 4 / 3 / 8 |
| q06 | still life | genre | arranged objects, flowers or food as the subject | 8 / 11 / 35 |
| q07 | interior | genre | the scene is inside a room or building | 5 / 1 / 38 |
| q08 | flowers | subject | flowers are clearly depicted (main or prominent) | 9 / 5 / 42 |
| q09 | snow | subject | snow is visible in the scene | 1 / 0 / 11 |
| q10 | boats | subject | one or more boats or ships are visible | 3 / 5 / 42 |
| q11 | cows | subject | cattle are visible | 6 / 1 / 11 |
| q12 | children | subject | one or more children are depicted | 4 / 4 / 47 |
| q13 | night | subject | a night scene (dark sky, moonlight, artificial light outdoors) | 0 / 0 / 13 |
| q14 | sunset | subject | sunset or sunrise light in the sky | 4 / 0 / 7 |
| q15 | church | subject | a church or chapel is visible, inside or out | 7 / 1 / 9 |
| q16 | Paris | place | the scene is in Paris (by title, subject or recognisable view) | 2 / 4 / 14 |
| q17 | Barbizon | movement | by a Barbizon School painter, or a Barbizon/Fontainebleau scene | 8 / 21 / 36 |
| q18 | Claude Monet | artist | painted by Claude Monet | 1 / 0 / 25 |
| q19 | portrait of a woman | combined | a portrait whose main sitter is a woman | (title words only today) |
| q20 | winter landscape | combined | a landscape in winter (snow, bare trees, ice) | (see q02, q09) |

Left out, and why:
- **Very broad single words** ("painting", "art"): every result is relevant; they measure nothing.
- **Style words alone** ("Realism", "Post-impressionism"): they test the museums' labels and Wikidata, which image enrichment doesn't change; q01 and q17 already cover movements.
- **"women"**: overlaps q19, and the useful question is the more specific one.
- **More artists**: artist search depends on reconciliation, not images; q18 is enough to watch grouping.
