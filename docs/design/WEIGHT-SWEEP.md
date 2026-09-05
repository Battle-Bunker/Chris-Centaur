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

## 2. The arms

Seven arms, each ONE knob moved from the head's table and nothing else:

| arm | change | `checkWeights` | recorded inequalities |
|---|---|---|---|
| `reach×0.75` | reach 1 → 0.75 | accepts | none broken (lowering a term can only widen the cliff margin) |
| `reach×0.5` | reach 1 → 0.5 | accepts | none broken |
| `command×0.75` | command 2 → 1.5 | accepts | none broken |
| `command×0.5` | command 2 → 1 | accepts | none broken; command now TIES `momentum` (1) |
| `contest×1.5` | contest 3 → 4.5 | accepts | **BREAKS the recorded `contest < food` inequality** — see below |
| `room×1.5` | room 3 → 4.5 | accepts | none broken; `room × 2 = 9 < 10` still clears the cliff ceiling |
| `material×1.25` | material 10 → 12.5 | accepts | none broken; `CLIFF_MATERIAL_WEIGHT` is a separate constant and stays 10 |

**`contest×1.5` is INELIGIBLE and cannot be kept**, whatever it measures.
`calibration.ts` records, on the `contest` weight itself: *"it sits UNDER `food`
(4), whose pull reaches 1 for a starving unit — so a hungry unit still takes a
contested meal and a healthy one declines it."* At 4.5 the contest term's own
range (`[−1, 0]`, so a full −4.5) exceeds `food`'s whole reach (4 × 1 for a
starving unit), and a STARVING unit then declines a contested meal too. That is
the recorded reason for the number, inverted. It is run below as an
INFORMATIONAL arm only — it is the direct test of the class-A hypothesis and its
result is the most useful thing in this document — and it is excluded from the
keep rule by construction.

`checkWeights` accepts every arm, which is expected and worth saying plainly:
`checkWeights` checks that the weight table names exactly the folded features and
that the command knobs are finite and non-negative. It does **not** check the
recorded inequalities — those live in comments and in
`src/tests/territory-acceptance.test.ts`'s cliff assertions
(`w_feature × 2 < CLIFF_MATERIAL_WEIGHT × 1`). So an arm passing `checkWeights` is
not an arm the calibration admits.

### Deaths, per class, at full length

Raw counts (board-wide on the mirror classes; ours-only in brackets on the two
`material-only` classes, where team 0 `red` keeps the arm).

| arm | `mixed` | `potions` | `snakes` | `sparse` | `sparse-lean` | `mixed`/mat-only | `snakes`/mat-only | Σ (ours) |
|---|---|---|---|---|---|---|---|---|
| **base** | **14** | **21** | **7** | **0** | **0** | 12 (**4**) | 11 (**1**) | **47** |
| `reach×0.75` | 21 ▲ | 28 ▲ | 9 ▲ | 0 = | 0 = | 13 (5 ▲) | 11 (1 =) | 64 |
| `reach×0.5` | 22 ▲ | 30 ▲ | 7 = | **2 ▲** | **2 ▲** | 11 (5 ▲) | 9 (1 =) | 69 |
| `command×0.75` | 21 ▲ | 23 ▲ | 7 = | 0 = | 0 = | 15 (9 ▲) | 11 (1 =) | 61 |
| `command×0.5` | 23 ▲ | 24 ▲ | 7 = | 0 = | 0 = | 12 (7 ▲) | 11 (1 =) | 62 |
| `contest×1.5` † | 16 ▲ | 22 ▲ | 7 = | 0 = | 0 = | 10 (6 ▲) | 11 (1 =) | 52 |
| `room×1.5` | **14 =** | 24 ▲ | 7 = | 0 = | 0 = | 12 (5 ▲) | 11 (1 =) | 51 |
| `material×1.25` | 19 ▲ | 26 ▲ | 7 = | 0 = | 0 = | 10 (**4 =**) | 11 (1 =) | 57 |

† ineligible — breaks `contest < food`.

**Not one arm lowers deaths on any class.** The best any arm manages is FLAT:
`room×1.5` holds `mixed` at 14 and `material×1.25` holds our own deaths on
`mixed`/mat-only at 4. Every arm raises deaths on `mixed` and on `potions` except
`room×1.5`, which raises `potions` alone.

**`reach×0.5` puts deaths on `sparse` and `sparse-lean`, which have never had
one.** Two contest deaths on each — 0 → 2 on the two boards every previous
measurement in this repo has used as the byte-identity control. That is the
loudest single result in the sweep and it is a straight refutation of that arm.

### Meals, territory and the tempo counters

Δmeals is against the baseline's own meals/100 for that class.

| arm | `mixed` Δmeals | `potions` Δmeals | `snakes` Δ | `sparse` Δ | `s-lean` Δ | `mixed`/mo Δ | `snakes`/mo Δ |
|---|---|---|---|---|---|---|---|
| `reach×0.75` | +6.1% | **−5.9%** | +5.4% | 0 | +11.1% | −4.7% | +8.4% |
| `reach×0.5` | +8.5% | −1.9% | +13.2% | +15.0% | +29.0% | +4.1% | +19.0% |
| `command×0.75` | +4.9% | −0.9% | 0 | 0 | 0 | −1.7% | 0 |
| `command×0.5` | +15.7% | −1.9% | 0 | 0 | 0 | +12.7% | 0 |
| `contest×1.5` † | +2.8% | +3.3% | 0 | 0 | 0 | **−7.2%** | 0 |
| `room×1.5` | +3.6% | +3.4% | 0 | 0 | 0 | +10.8% | 0 |
| `material×1.25` | +5.6% | −0.4% | 0 | 0 | 0 | +2.8% | 0 |

Territory (`seedKept/100`) and the tempo counters:

| arm | `mixed` seedKept | `potions` seedKept | `mixed` dither/100 | `mixed` stationary/100 | `mixed` longestPark | `potions` immobile/100 |
|---|---|---|---|---|---|---|
| **base** | **44.42** | **44.11** | **5.725** | **8.567** | **29** | **6.31** |
| `reach×0.75` | 42.64 | 43.64 | 5.691 | 9.338 | 16 | 6.14 |
| `reach×0.5` | 43.74 | 43.91 | 5.746 | 9.844 | 46 | 5.00 |
| `command×0.75` | 44.03 | 43.67 | 4.783 | 7.957 | 21 | 6.98 |
| `command×0.5` | 44.00 | 43.22 | 3.834 | 6.390 | 15 | 4.92 |
| `contest×1.5` † | 44.06 | 44.47 | 5.425 | 8.056 | 29 | 5.07 |
| `room×1.5` | **45.43** | **45.27** | 5.278 | 8.201 | 29 | 6.33 |
| `material×1.25` | 43.31 | 44.23 | 6.715 | 9.384 | 43 | 5.24 |

Potion counters, `potions` 1–8:

| arm | picks | reckless | profitable+safe | tierUps | deathsWhileDebuffed |
|---|---|---|---|---|---|
| **base** | **35** | **25** | **7** | **98** | **0** |
| `reach×0.75` | 40 | 28 | 5 | 104 | 1 |
| `reach×0.5` | 40 | 28 | 4 | 110 | 0 |
| `command×0.75` | 42 | 28 | 7 | 109 | 1 |
| `command×0.5` | 37 | 29 | 4 | 92 | 3 |
| `contest×1.5` † | 31 | 20 | 6 | 86 | 1 |
| `room×1.5` | 30 | 20 | 6 | 81 | 0 |
| `material×1.25` | 47 | 30 | 6 | 113 | 1 |

### The inversion gate

`CENTAUR_DEBUG_INVERSION=1`, nineteen arms each (five scenarios × seeds 1–3 at 30
turns, plus `potions` 4, 5, 6, 8 at 60), on **all eight builds**: 152 runs,
**no `INVERSION` line on any of them**, `crashed: null` throughout.

This is the expected result and it is worth saying why it is not evidence for
anything: a weight is a non-negative scalar on a per-feature interval, so `scale`
maps `[lo, hi]` to `[w·lo, w·hi]` and cannot invert an endpoint. The gate would
catch a weight that went NEGATIVE, and nothing else about a re-weighting. It is
run because it is cheap and because a silent soundness break would invalidate
every counter above; it does not license any arm.
