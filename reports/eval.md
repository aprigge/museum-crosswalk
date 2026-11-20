# Search eval

Generated 2026-11-19 by `npm run eval`. 20 queries (`eval/queries.json`), relevance labelled
over a pool of each variant's top 10 plus top 5 per museum (`eval/labels.json`; who labelled it is below the table).

| Variant | Precision@10 | Recall (pooled) | Museums with a hit (of 3) | Queries with all 3 | Split artists | AI-only results | Unlabelled in top 10 |
|---|---|---|---|---|---|---|---|
| baseline | 95% ± 6 (n=20) | 87% ± 7 (n=20) | 2.55 | 13 | 0 | 0 | 0 |
| with-ai | 96% ± 4 (n=20) | 100% ± 0 (n=20) | 2.75 | 15 | 0 | 615 | 0 |

Precision and recall are means over queries with labels, ± a 95% interval. With 20 queries the interval is wide:
a difference smaller than it is not evidence of a change.

Labels: 346 pooled paintings were labelled by claude-sonnet-5-5 (reasons in `eval/judgments.json`), not by a person. 30 of them have no openly licensed image and were judged from catalogue data alone, so visual rules tend to come out "not relevant" for them.

## Per query

| Query | Tags | baseline P@10 | baseline recall | baseline museums | with-ai P@10 | with-ai recall | with-ai museums |
|---|---|---|---|---|---|---|---|
| Impressionist landscapes | headline, combined | 80% | 85% | 2 | 80% | 100% | 3 |
| landscape | genre | 100% | 100% | 3 | 100% | 100% | 3 |
| seascape | genre | 100% | 100% | 2 | 100% | 100% | 2 |
| portrait | genre | 100% | 100% | 3 | 100% | 100% | 3 |
| self-portrait | genre | 100% | 88% | 3 | 100% | 100% | 3 |
| still life | genre | 100% | 100% | 3 | 100% | 100% | 3 |
| interior | genre | 100% | 72% | 3 | 100% | 100% | 3 |
| flowers | subject | 100% | 100% | 3 | 100% | 100% | 3 |
| snow | subject | 100% | 63% | 2 | 100% | 100% | 2 |
| boats | subject | 100% | 82% | 3 | 100% | 100% | 3 |
| cows | subject | 100% | 100% | 3 | 100% | 100% | 3 |
| children | subject | 100% | 90% | 3 | 100% | 100% | 3 |
| night | subject | 50% | 60% | 1 | 60% | 100% | 2 |
| sunset | subject | 100% | 71% | 2 | 100% | 100% | 3 |
| church | subject | 70% | 92% | 3 | 90% | 100% | 3 |
| Paris | place | 90% | 100% | 3 | 90% | 100% | 3 |
| Barbizon | movement | 100% | 100% | 3 | 100% | 100% | 3 |
| Claude Monet | artist | 100% | 100% | 2 | 100% | 100% | 2 |
| portrait of a woman | combined | 100% | 81% | 3 | 100% | 100% | 3 |
| winter landscape | combined | 100% | 57% | 1 | 100% | 100% | 2 |

<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->


## Reading the results (step 1: AI subjects from images)

**AI subjects widened coverage without costing precision.** With Claude Opus 5.5's suggested
subjects in search, queries answered by all three museums went from 13 to 15 of 20, museums
with a relevant hit per query from 2.55 to 2.75, and precision in the top 10 held (95% → 96%;
the difference is inside the noise). The headline query, "Impressionist landscapes", now
returns the Rijksmuseum too, through Monet's *La Corniche near Monaco*: the museum catalogues
it as "Monaco, temperate climate, road", and the AI added "landscape".

Where it helped most: "winter landscape" (1 → 2 museums), "sunset" (2 → 3), "night" (1 → 2,
with Jacob Maris's *Canal by Moonlight* at the Rijksmuseum) and recall on "snow", "interior"
and "winter landscape", whose relevant paintings the museums' own subjects missed.

Where it didn't, and why:
- **"night" is still the weakest query** (60% precision): the AI tagged some Rijksmuseum works
  as night scenes that the judge, looking at the same image, did not accept.
- **"seascape" and "Claude Monet" stay at two museums.** The Met slice is partial (95 of about
  1,300 paintings, its firewall blocked the harvest), so its seascapes and Monets aren't in yet.
- **False positives exist.** A Fantin-Latour figure painting tagged "landscape" now appears for
  "Impressionist landscapes". AI-only results are marked "AI" on the site and can be switched off.

How far to trust these numbers:
- **Recall is relative to the pool**, which grows mostly from the AI variant's results, so the
  AI variant's 100% means "found everything either variant found", not "found everything".
- **A model labelled relevance** (Claude Sonnet 5.5, a different model from the one that made the
  suggestions), with a reason per painting in `eval/judgments.json`; no person has checked them.
- **20 queries is a small set**: the intervals overlap for precision, so read it as "no loss",
  not "a gain".

Cost: enrichment $7.07 (953 paintings, Message Batches), judging $0.36 in all.
