# The wide corpus — 200 games

Recorded by `scripts/wide-corpus.sh`, deterministic mode (`--nodes`), so every number is a function of (build, scenario, seed, arm). Nothing is pooled across board classes; every row is one class on one arm.

## Play

| class | arm | runs | unit-turns | meals/100 | grown/meals | deaths | deaths/100 | by cause | survivors | crashed |
|---|---|---|---|---|---|---|---|---|---|---|
| `asym` | material-only | 10 | 3666 | 16.91 | 1.00 | 37 | 1.009 | contest 31, edge 3, bodyBlock 2, self 1 | 53 | 0 |
| `asym` | mirror | 10 | 4159 | 19.93 | 1.00 | 34 | 0.818 | contest 25, bodyBlock 4, edge 2, self 2, wall 1 | 56 | 0 |
| `dense` | material-only | 10 | 4056 | 19.45 | 1.00 | 83 | 2.046 | contest 61, bodyBlock 14, edge 4, self 2, wall 2 | 37 | 0 |
| `dense` | mirror | 10 | 4471 | 20.47 | 1.00 | 78 | 1.745 | contest 54, bodyBlock 17, edge 4, self 2, wall 1 | 42 | 0 |
| `long` | material-only | 10 | 5025 | 19.96 | 1.00 | 62 | 1.234 | contest 53, bodyBlock 5, self 2, wall 1, edge 1 | 18 | 3 |
| `long` | mirror | 10 | 6064 | 20.00 | 1.00 | 46 | 0.759 | contest 33, self 6, bodyBlock 5, wall 2 | 34 | 6 |
| `mixed` | material-only | 10 | 3586 | 17.04 | 1.00 | 44 | 1.227 | contest 37, bodyBlock 3, self 2, wall 1, edge 1 | 36 | 0 |
| `mixed` | mirror | 10 | 3967 | 18.45 | 1.00 | 26 | 0.655 | contest 23, bodyBlock 2, self 1 | 54 | 0 |
| `potion-rich` | material-only | 10 | 3664 | 13.65 | 1.00 | 36 | 0.983 | contest 32, edge 2, bodyBlock 2 | 44 | 0 |
| `potion-rich` | mirror | 10 | 3945 | 16.60 | 1.00 | 29 | 0.735 | contest 29 | 51 | 0 |
| `potions` | material-only | 10 | 3786 | 16.56 | 1.00 | 36 | 0.951 | contest 23, edge 7, wall 2, self 2, bodyBlock 2 | 44 | 0 |
| `potions` | mirror | 10 | 3941 | 19.16 | 1.00 | 26 | 0.660 | contest 22, bodyBlock 3, self 1 | 54 | 0 |
| `snakes` | material-only | 10 | 2696 | 12.28 | 1.00 | 32 | 1.187 | bodyBlock 25, self 5, wall 1, contest 1 | 28 | 0 |
| `snakes` | mirror | 10 | 3139 | 17.36 | 1.00 | 25 | 0.796 | bodyBlock 16, self 8, contest 1 | 35 | 0 |
| `sparse` | material-only | 10 | 2349 | 5.75 | 1.00 | 2 | 0.085 | contest 1, self 1 | 38 | 0 |
| `sparse` | mirror | 10 | 2400 | 6.88 | 1.00 | 0 | 0.000 | — | 40 | 0 |
| `sparse-lean` | material-only | 10 | 2334 | 5.66 | 0.91 | 3 | 0.129 | contest 2, self 1 | 37 | 0 |
| `sparse-lean` | mirror | 10 | 2354 | 6.46 | 0.82 | 3 | 0.127 | contest 2, self 1 | 37 | 0 |
| `wide` | material-only | 10 | 4967 | 13.37 | 1.00 | 70 | 1.409 | contest 45, bodyBlock 20, edge 3, self 2 | 50 | 0 |
| `wide` | mirror | 10 | 5406 | 15.82 | 1.00 | 58 | 1.073 | contest 40, bodyBlock 15, edge 1, self 1, wall 1 | 62 | 0 |

## Parking, immobility and reversals, per 100 unit-turns

| class | arm | parked | longestPark (max) | immobile | diedImmobile | reversals | unjustified | seedKept |
|---|---|---|---|---|---|---|---|---|
| `asym` | material-only | 9.66% | 30 | 2.97% | 4 | 1.88% | 0.41% | 53.96% |
| `asym` | mirror | 4.35% | 32 | 2.79% | 0 | 0.82% | 0.41% | 44.99% |
| `dense` | material-only | 10.21% | 10 | 1.38% | 12 | 2.59% | 0.81% | 60.55% |
| `dense` | mirror | 7.96% | 10 | 2.46% | 10 | 1.05% | 0.31% | 49.61% |
| `long` | material-only | 15.60% | 20 | 3.52% | 10 | 2.61% | 1.00% | 60.84% |
| `long` | mirror | 8.94% | 43 | 3.91% | 9 | 1.48% | 0.73% | 45.10% |
| `mixed` | material-only | 16.15% | 18 | 4.43% | 8 | 2.12% | 0.78% | 61.57% |
| `mixed` | mirror | 7.76% | 29 | 3.23% | 6 | 1.18% | 0.40% | 44.14% |
| `potion-rich` | material-only | 16.59% | 37 | 7.15% | 5 | 3.33% | 0.87% | 64.03% |
| `potion-rich` | mirror | 8.75% | 20 | 5.65% | 7 | 0.94% | 0.23% | 42.03% |
| `potions` | material-only | 20.26% | 38 | 5.94% | 6 | 3.17% | 1.14% | 60.27% |
| `potions` | mirror | 10.12% | 44 | 5.73% | 5 | 1.17% | 0.41% | 44.33% |
| `snakes` | material-only | 0.00% | 0 | 0.00% | 0 | 0.07% | 0.00% | 77.71% |
| `snakes` | mirror | 0.00% | 0 | 0.00% | 0 | 0.13% | 0.06% | 58.01% |
| `sparse` | material-only | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 70.24% |
| `sparse` | mirror | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 45.75% |
| `sparse-lean` | material-only | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 70.74% |
| `sparse-lean` | mirror | 0.00% | 0 | 0.00% | 0 | 0.00% | 0.00% | 44.39% |
| `wide` | material-only | 10.81% | 38 | 2.15% | 9 | 1.75% | 0.77% | 69.18% |
| `wide` | mirror | 6.71% | 13 | 1.63% | 4 | 0.89% | 0.59% | 52.79% |

## Entrapment instrument

| class | arm | episodes | escaped | fatal | entrapped unit-turns | mean lead before a fatal |
|---|---|---|---|---|---|---|
| `asym` | material-only | 40 | 0 | 19 | 1669 (45.53%) | 33.00 |
| `asym` | mirror | 40 | 0 | 17 | 1892 (45.49%) | 30.12 |
| `dense` | material-only | 50 | 0 | 38 | 1893 (46.67%) | 30.87 |
| `dense` | mirror | 50 | 0 | 36 | 2027 (45.34%) | 32.97 |
| `long` | material-only | 30 | 0 | 29 | 1558 (31.00%) | 50.03 |
| `long` | mirror | 30 | 0 | 22 | 2105 (34.71%) | 57.50 |
| `mixed` | material-only | 30 | 0 | 20 | 1322 (36.87%) | 36.10 |
| `mixed` | mirror | 30 | 0 | 11 | 1533 (38.64%) | 35.73 |
| `potion-rich` | material-only | 63 | 34 | 17 | 1242 (33.90%) | 23.53 |
| `potion-rich` | mirror | 76 | 46 | 16 | 1309 (33.18%) | 22.50 |
| `potions` | material-only | 47 | 18 | 19 | 1270 (33.54%) | 32.16 |
| `potions` | mirror | 80 | 52 | 11 | 1274 (32.33%) | 15.82 |
| `snakes` | material-only | 158 | 124 | 32 | 391 (14.50%) | 2.66 |
| `snakes` | mirror | 190 | 150 | 25 | 664 (21.15%) | 5.72 |
| `sparse` | material-only | 81 | 75 | 2 | 159 (6.77%) | 2.50 |
| `sparse` | mirror | 24 | 21 | 0 | 35 (1.46%) | — |
| `sparse-lean` | material-only | 95 | 86 | 3 | 156 (6.68%) | 3.00 |
| `sparse-lean` | mirror | 26 | 21 | 1 | 47 (2.00%) | 1.00 |
| `wide` | material-only | 60 | 0 | 34 | 2763 (55.63%) | 35.38 |
| `wide` | mirror | 60 | 0 | 29 | 2801 (51.81%) | 32.45 |

## Potions (classes that have any)

| class | arm | pickups | profitable | reckless | profitable AND safe | tier ups | tier downs | died debuffed | died buffed |
|---|---|---|---|---|---|---|---|---|---|
| `potion-rich` | material-only | 54 | 9 | 46 (85.19%) | 1 (1.85%) | 128 | 129 | 1 | 0 |
| `potion-rich` | mirror | 67 | 22 | 38 (56.72%) | 15 (22.39%) | 167 | 168 | 3 | 0 |
| `potions` | material-only | 49 | 7 | 39 (79.59%) | 2 (4.08%) | 113 | 118 | 3 | 0 |
| `potions` | mirror | 40 | 17 | 29 (72.50%) | 8 (20.00%) | 111 | 111 | 0 | 0 |

## Enemy-occupied entries (D1 instrument, board-wide — read per team or not at all)

| class | arm | entries | lost |
|---|---|---|---|
| `asym` | material-only | 45 | 9 |
| `asym` | mirror | 53 | 12 |
| `dense` | material-only | 122 | 30 |
| `dense` | mirror | 87 | 17 |
| `long` | material-only | 176 | 20 |
| `long` | mirror | 102 | 15 |
| `mixed` | material-only | 124 | 19 |
| `mixed` | mirror | 66 | 11 |
| `potion-rich` | material-only | 150 | 14 |
| `potion-rich` | mirror | 61 | 8 |
| `potions` | material-only | 137 | 25 |
| `potions` | mirror | 69 | 6 |
| `snakes` | material-only | 15 | 11 |
| `snakes` | mirror | 4 | 0 |
| `sparse` | material-only | 0 | 0 |
| `sparse` | mirror | 0 | 0 |
| `sparse-lean` | material-only | 0 | 0 |
| `sparse-lean` | mirror | 0 | 0 |
| `wide` | material-only | 117 | 15 |
| `wide` | mirror | 65 | 8 |
