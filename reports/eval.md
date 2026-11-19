# Search eval

Generated 2026-11-19 by `npm run eval`. 20 queries (`eval/queries.json`), relevance labelled
over a pool of each variant's top 10 plus top 5 per museum (`eval/labels.json`; who labelled it is below the table).

| Variant | Precision@10 | Recall (pooled) | Museums with a hit (of 3) | Queries with all 3 | Split artists | AI-only results | Unlabelled in top 10 |
|---|---|---|---|---|---|---|---|
| baseline | 95% ± 6 (n=20) | 100% ± 0 (n=20) | 2.55 | 13 | 0 | 0 | 0 |

Precision and recall are means over queries with labels, ± a 95% interval. With 20 queries the interval is wide:
a difference smaller than it is not evidence of a change.

Labels: 266 pooled paintings were labelled by claude-sonnet-5-5 (reasons in `eval/judgments.json`), not by a person. 30 of them have no openly licensed image and were judged from catalogue data alone, so visual rules tend to come out "not relevant" for them.

## Per query

| Query | Tags | baseline P@10 | baseline recall | baseline museums |
|---|---|---|---|---|
| Impressionist landscapes | headline, combined | 80% | 100% | 2 |
| landscape | genre | 100% | 100% | 3 |
| seascape | genre | 100% | 100% | 2 |
| portrait | genre | 100% | 100% | 3 |
| self-portrait | genre | 100% | 100% | 3 |
| still life | genre | 100% | 100% | 3 |
| interior | genre | 100% | 100% | 3 |
| flowers | subject | 100% | 100% | 3 |
| snow | subject | 100% | 100% | 2 |
| boats | subject | 100% | 100% | 3 |
| cows | subject | 100% | 100% | 3 |
| children | subject | 100% | 100% | 3 |
| night | subject | 50% | 100% | 1 |
| sunset | subject | 100% | 100% | 2 |
| church | subject | 70% | 100% | 3 |
| Paris | place | 90% | 100% | 3 |
| Barbizon | movement | 100% | 100% | 3 |
| Claude Monet | artist | 100% | 100% | 2 |
| portrait of a woman | combined | 100% | 100% | 3 |
| winter landscape | combined | 100% | 100% | 1 |

<!-- END GENERATED: everything below this line is hand-written and kept on regenerate -->
