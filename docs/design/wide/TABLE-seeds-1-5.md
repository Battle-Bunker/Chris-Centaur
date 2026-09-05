# The wide corpus — 100 games

Recorded by `scripts/wide-corpus.sh`, deterministic mode (`--nodes`), so every number is a function of (build, scenario, seed, arm). Nothing is pooled across board classes; every row is one class on one arm.

## Play

| class | arm | runs | unit-turns | meals/100 | grown/meals | deaths | deaths/100 | by cause | survivors | crashed |
|---|---|---|---|---|---|---|---|---|---|---|
| `asym` | material-only | 5 | 1943 | 17.55 | 1.00 | 19 | 0.978 | contest 17, edge 1, self 1 | 26 | 0 |
| `asym` | mirror | 5 | 1994 | 20.71 | 1.00 | 17 | 0.853 | contest 15, edge 1, bodyBlock 1 | 28 | 0 |
| `dense` | material-only | 5 | 2057 | 18.96 | 1.00 | 39 | 1.896 | contest 31, bodyBlock 7, edge 1 | 21 | 0 |
| `dense` | mirror | 5 | 2285 | 19.96 | 1.00 | 39 | 1.707 | contest 25, bodyBlock 7, edge 4, self 2, wall 1 | 21 | 0 |
| `long` | material-only | 5 | 2503 | 20.10 | 1.00 | 31 | 1.239 | contest 28, bodyBlock 2, wall 1 | 9 | 2 |
| `long` | mirror | 5 | 3073 | 20.01 | 1.00 | 23 | 0.748 | contest 13, self 5, bodyBlock 4, wall 1 | 17 | 3 |
| `mixed` | material-only | 5 | 1836 | 16.67 | 1.00 | 21 | 1.144 | contest 19, bodyBlock 1, wall 1 | 19 | 0 |
| `mixed` | mirror | 5 | 2063 | 18.32 | 1.00 | 12 | 0.582 | contest 9, bodyBlock 2, self 1 | 28 | 0 |
| `potion-rich` | material-only | 5 | 1756 | 13.90 | 1.00 | 19 | 1.082 | contest 16, edge 2, bodyBlock 1 | 21 | 0 |
| `potion-rich` | mirror | 5 | 2043 | 15.96 | 0.99 | 14 | 0.685 | contest 14 | 26 | 0 |
| `potions` | material-only | 5 | 1956 | 15.03 | 1.00 | 16 | 0.818 | contest 13, edge 2, wall 1 | 24 | 0 |
| `potions` | mirror | 5 | 2046 | 18.96 | 1.00 | 11 | 0.538 | contest 10, bodyBlock 1 | 29 | 0 |
| `snakes` | material-only | 5 | 1353 | 12.64 | 1.00 | 16 | 1.183 | bodyBlock 13, self 2, wall 1 | 14 | 0 |
| `snakes` | mirror | 5 | 1557 | 16.89 | 1.00 | 14 | 0.899 | self 7, bodyBlock 6, contest 1 | 16 | 0 |
| `sparse` | material-only | 5 | 1149 | 6.01 | 1.00 | 2 | 0.174 | contest 1, self 1 | 18 | 0 |
| `sparse` | mirror | 5 | 1200 | 7.67 | 1.00 | 0 | 0.000 | — | 20 | 0 |
| `sparse-lean` | material-only | 5 | 1134 | 6.00 | 0.94 | 3 | 0.265 | contest 2, self 1 | 17 | 0 |
| `sparse-lean` | mirror | 5 | 1154 | 6.85 | 0.85 | 2 | 0.173 | contest 2 | 18 | 0 |
| `wide` | material-only | 5 | 2557 | 13.38 | 1.00 | 35 | 1.369 | contest 21, bodyBlock 12, edge 2 | 25 | 0 |
| `wide` | mirror | 5 | 2751 | 15.67 | 1.00 | 27 | 0.981 | contest 18, bodyBlock 7, edge 1, self 1 | 33 | 0 |

## Parking, immobility and reversals, per 100 unit-turns

| class | arm | parked | longestPark (max) | immobile | diedImmobile | reversals | unjustified | seedKept |
|---|---|---|---|---|---|---|---|---|
| `asym` | material-only | 9.42% | 30 | 2.42% | 2 | 1.70% | 0.46% | 54.55% |
| `asym` | mirror | 5.67% | 32 | 4.51% | 0 | 0.75% | 0.35% | 44.03% |
| `dense` | material-only | 10.50% | 10 | 1.26% | 7 | 2.92% | 0.92% | 60.87% |
| `dense` | mirror | 7.35% | 10 | 1.88% | 3 | 1.18% | 0.26% | 47.96% |
| `long` | material-only | 15.50% | 16 | 3.24% | 6 | 2.32% | 0.84% | 61.41% |
| `long` | mirror | 8.04% | 19 | 1.99% | 4 | 1.89% | 0.98% | 45.10% |
| `mixed` | material-only | 16.23% | 16 | 4.30% | 5 | 1.80% | 0.71% | 62.47% |
| `mixed` | mirror | 7.61% | 6 | 2.13% | 3 | 1.41% | 0.53% | 44.50% |
| `potion-rich` | material-only | 14.52% | 33 | 6.78% | 3 | 4.27% | 1.03% | 65.09% |
| `potion-rich` | mirror | 8.22% | 19 | 5.19% | 3 | 0.54% | 0.15% | 41.21% |
| `potions` | material-only | 21.73% | 38 | 5.47% | 4 | 2.86% | 1.07% | 61.91% |
| `potions` | mirror | 10.65% | 36 | 6.40% | 1 | 1.03% | 0.44% | 43.60% |
| `snakes` | material-only | 0.00% | 0 | 0.00% | 0 | 0.07% | 0.00% | 79.08% |
| `snakes` | mirror | 0.00% | 0 | 0.00% | 0 | 0.19% | 0.13% | 57.68% |
| `sparse` | material-only | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 68.93% |
| `sparse` | mirror | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 44.50% |
| `sparse-lean` | material-only | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 69.93% |
| `sparse-lean` | mirror | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 42.20% |
| `wide` | material-only | 9.70% | 16 | 1.49% | 4 | 1.88% | 0.86% | 69.57% |
| `wide` | mirror | 7.09% | 13 | 1.82% | 2 | 0.91% | 0.69% | 53.25% |

## Entrapment instrument

| class | arm | episodes | escaped | fatal | entrapped unit-turns | mean lead before a fatal |
|---|---|---|---|---|---|---|
| `asym` | material-only | 20 | 0 | 11 | 877 (45.14%) | 36.64 |
| `asym` | mirror | 20 | 0 | 8 | 910 (45.64%) | 23.75 |
| `dense` | material-only | 25 | 0 | 17 | 962 (46.77%) | 28.35 |
| `dense` | mirror | 25 | 0 | 19 | 1072 (46.91%) | 37.47 |
| `long` | material-only | 15 | 0 | 15 | 781 (31.20%) | 52.07 |
| `long` | mirror | 15 | 0 | 11 | 1129 (36.74%) | 64.09 |
| `mixed` | material-only | 15 | 0 | 9 | 700 (38.13%) | 37.78 |
| `mixed` | mirror | 15 | 0 | 4 | 849 (41.15%) | 47.25 |
| `potion-rich` | material-only | 30 | 16 | 8 | 614 (34.97%) | 20.38 |
| `potion-rich` | mirror | 34 | 19 | 8 | 697 (34.12%) | 21.88 |
| `potions` | material-only | 22 | 7 | 9 | 643 (32.87%) | 29.56 |
| `potions` | mirror | 41 | 27 | 5 | 669 (32.70%) | 15.60 |
| `snakes` | material-only | 81 | 63 | 16 | 200 (14.78%) | 2.31 |
| `snakes` | mirror | 95 | 75 | 14 | 307 (19.72%) | 4.07 |
| `sparse` | material-only | 34 | 29 | 2 | 74 (6.44%) | 2.50 |
| `sparse` | mirror | 10 | 9 | 0 | 15 (1.25%) | — |
| `sparse-lean` | material-only | 44 | 37 | 3 | 75 (6.61%) | 3.00 |
| `sparse-lean` | mirror | 12 | 10 | 0 | 26 (2.25%) | — |
| `wide` | material-only | 30 | 0 | 16 | 1491 (58.31%) | 40.69 |
| `wide` | mirror | 30 | 0 | 12 | 1477 (53.69%) | 33.08 |

## Potions (classes that have any)

| class | arm | pickups | profitable | reckless | profitable AND safe | tier ups | tier downs | died debuffed | died buffed |
|---|---|---|---|---|---|---|---|---|---|
| `potion-rich` | material-only | 29 | 8 | 27 (93.10%) | 1 (3.45%) | 66 | 66 | 0 | 0 |
| `potion-rich` | mirror | 32 | 14 | 19 (59.38%) | 8 (25.00%) | 75 | 74 | 0 | 0 |
| `potions` | material-only | 28 | 2 | 22 (78.57%) | 1 (3.57%) | 61 | 66 | 3 | 0 |
| `potions` | mirror | 25 | 13 | 17 (68.00%) | 5 (20.00%) | 73 | 73 | 0 | 0 |

## Enemy-occupied entries (D1 instrument, board-wide — read per team or not at all)

| class | arm | entries | lost |
|---|---|---|---|
| `asym` | material-only | 17 | 2 |
| `asym` | mirror | 27 | 5 |
| `dense` | material-only | 50 | 14 |
| `dense` | mirror | 52 | 11 |
| `long` | material-only | 75 | 9 |
| `long` | mirror | 50 | 7 |
| `mixed` | material-only | 53 | 8 |
| `mixed` | mirror | 35 | 5 |
| `potion-rich` | material-only | 65 | 8 |
| `potion-rich` | mirror | 29 | 4 |
| `potions` | material-only | 81 | 17 |
| `potions` | mirror | 36 | 3 |
| `snakes` | material-only | 8 | 6 |
| `snakes` | mirror | 1 | 0 |
| `sparse` | material-only | 0 | 0 |
| `sparse` | mirror | 0 | 0 |
| `sparse-lean` | material-only | 0 | 0 |
| `sparse-lean` | mirror | 0 | 0 |
| `wide` | material-only | 57 | 10 |
| `wide` | mirror | 36 | 4 |
