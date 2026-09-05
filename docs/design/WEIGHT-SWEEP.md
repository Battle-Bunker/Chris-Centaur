# The weight sweep — one knob at a time, on the evaluator's own table

A calibration experiment on `src/lobster/evaluate/calibration.ts`'s
`DEFAULT_WEIGHTS`, run because `contest-classA.md` closed the member road: the
dominant contest-death class cannot be moved by any member gradient, because the
fatal option is preferred by a **0.16 bank-floor margin that is a TERRITORY
difference** and not a contest one. If the deciding margin is territory, the
place to look is the price of territory.

The owner's rule stands over the whole sweep: **err conservative — deaths are the
currency, meals and territory are what may be spent.**

## Method

Head build, `--nodes` (550 work units), 60 turns, deterministic clock, so every
counter is a function of (build, scenario, seed) and nothing else. One knob moved
from the head's table per arm; nothing else in the tree changes.

Corpus, **never pooled** — every number is per board class:

| class | runs |
|---|---|
| `mixed` | seeds 1–6, mirror |
| `potions` | seeds 1–8, mirror |
| `snakes` | seeds 1–3, mirror |
| `sparse` | seeds 1–3, mirror |
| `sparse-lean` | seeds 1–3, mirror |
| `mixed` vs `material-only` | seeds 1–3 |
| `snakes` vs `material-only` | seeds 1–3 |

Deaths are BOARD-WIDE on a mirror run (both teams play the arm, so the count is
the arm's own play read twice) and are additionally split OURS/theirs on the two
`material-only` classes, where team 0 (`red`) keeps the arm and the other two
teams play `material-only`. Both readings are given there, because a board-wide
count on an asymmetric board also moves when the arm stops killing enemies.

## 1. Baseline — the head's weights

`DEFAULT_WEIGHTS` at the head: material 10, reach 1, room 3, energyEconomy 0.5,
kingMargin 0.25, command 2, food 4, momentum 1, contest 3, tier 2, energy 8,
potion 2.

| class | unit-turns | deaths (by cause) | meals/100 | seedKept/100 | dither/100 | stationary/100 | longestPark | immobile/100 |
|---|---|---|---|---|---|---|---|---|
| `mixed` 1–6 | 2463 | **14** — contest 11, bodyBlock 2, self 1 | 18.108 | 44.42 | 5.725 | 8.567 | 29 | 3.53 |
| `potions` 1–8 | 3124 | **21** — contest 18, bodyBlock 2, self 1 | 19.430 | 44.11 | 6.722 | 10.755 | 44 | 6.31 |
| `snakes` 1–3 | 967 | **7** — bodyBlock 4, self 3 | 16.236 | 57.39 | 0 | 0 | 0 | 0 |
| `sparse` 1–3 | 720 | **0** | 7.222 | 43.19 | 0 | 0 | 0 | 0 |
| `sparse-lean` 1–3 | 720 | **0** (45 meals, 38 grown) | 6.250 | 41.39 | 0 | 0 | 0 | 0 |
| `mixed` vs mat-only 1–3 | 1120 | **12** board-wide, **4 ours** (all contest) | 16.161 | 64.02 | 11.786 | 15.268 | 16 | 4.11 |
| `snakes` vs mat-only 1–3 | 800 | **11** board-wide, **1 ours** (self) | 12.250 | 78.88 | 0 | 0 | 0 | 0 |

`potions` pickups: 35 picked, 25 reckless, 7 profitable-and-safe, tierUps 98.
`crashed: null` on all 29 runs.

**The baseline reproduces `BEHAVIOUR-AUDIT-2.md` exactly** where the two corpora
overlap — `potions` 1–8 at 3124 ut / 21 deaths (contest 18, bodyBlock 2, self 1),
`snakes` 967 / 16.24 / 7, `sparse` 720 / 7.22 / 0, `sparse-lean` 720 / 45 / 38 / 0,
and the two `material-only` classes at 23 board-wide / **5 ours** — and it
reproduces `contest-classA.md`'s `mixed` 1–6 decider count of **2463** unit-turns.
So the sweep is measured against the same play those two documents read.
