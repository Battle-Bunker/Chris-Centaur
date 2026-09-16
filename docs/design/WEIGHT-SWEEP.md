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

Everything below is reproducible from the head build: no source file on this branch
differs from `claude/succession-doc-subagent-orchestration-n41iua` except this
document. Each arm was built by moving ONE line of `DEFAULT_WEIGHTS`, compiling to
its own output directory, and reverting the file — `git status` is clean at every
checkpoint, and `calibration.ts` is byte-identical to the head at the end.


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

## 3. The keep rule — NOTHING IS KEPT

The rule, stated before the arms were run: keep ONE arm, the best by deaths, and
only if **deaths fall on at least two classes and rise on none** (per class, at
full length), meals down at most 5% per class, territory may fall, inversion gate
zero, the exact-reply suite exact, the law-sweep ratchet not up, and the
determinism fixture re-pinned only after reading the transcript and confirming
the new move is the more cautious one.

**No arm reaches the first clause.** Deaths fall on ZERO classes for every arm.
The best arm by deaths is `room×1.5` (51 against the baseline's 47 when the seven
classes are counted up, and the only arm that holds `mixed` at its baseline 14),
and even it raises `potions` 21 → 24 and our own deaths on `mixed`/mat-only 4 → 5.

Two arms would have failed the meals clause as well had they got past the first
(`reach×0.75` at −5.9% on `potions`, `contest×1.5` at −7.2% on `mixed`/mat-only),
and `contest×1.5` was ineligible from the start.

So: **nothing is kept. `calibration.ts` is unchanged on this branch** — the
weight table this document measures is the weight table it leaves behind. The
gate suites were run anyway, on the unmodified tree, and the determinism fixture
was NOT touched: `npx tsc --noEmit -p .` clean, `npx eslint "src/**/*.ts"` clean,
and `soundness` + `exact-reply` + `law-sweep` + `src/lobster/__tests__` +
`local-game-determinism` + `basic-intelligence` + `territory-acceptance` at
**20 suites / 341 tests, all passing**, no pin moved.

## 4. The mechanism, at the best arm and at the informative one

### `room×1.5` — the best arm by deaths, and it does not remove a death

`room×1.5` leaves **23 of the 29 games byte-identical** to the baseline. Its
whole effect lives in six games, and on `mixed` its death ledger reads

| | contest | bodyBlock | self | total |
|---|---|---|---|---|
| base | 11 | 2 | 1 | **14** |
| `room×1.5` | **9** | **4** | 1 | **14** |

Two contest deaths gone, two body-block deaths arrived, one for one. That is D2's
mobility currency-swap exactly (`calibration.ts`, "THERE IS NO `mobility` KNOB"):
a term that pays a unit for the ground it keeps moves it off the wall, and the
death it stops paying in `contest` it starts paying in `bodyBlock`. On `potions`
the swap does not even break even — 21 → 24, and among the three it adds is a
`potions` 4 T30 blue-C **`edge`** death, a cause `BEHAVIOUR-AUDIT-2.md` recorded
as extinct ("edge deaths are gone: 3 → 0, and 0 in all 57 deaths of this corpus").

**Reproduction A — `mixed` seed 4, turn 18, green-A (snake), the arm's first
differing move in that game.**

    base        top3: (5,0)=-213.84|-81.03  (3,0)=-214.01|-96.55  (4,1)!=-253.78|-116.28   -> takes (5,0)
    room×1.5    top3: (3,0)=-213.97|-96.61  (5,0)=-214.48|-81.43  (4,1)!=-253.75|-116.33   -> takes (3,0)

The floor gap at the head is **0.17** and the order flips: `(5,0)` falls 0.64 and
`(3,0)` rises 0.04, so the two move 0.68 apart — four times the gap. Note the arm
takes the option the CEILING rates 15 points worse; `better` reads the floor
first, so the floor flip decides. **This is the load-bearing number in the whole
sweep: a 0.17 floor margin is turnable by a single weight, and 0.17 is the size
of the class-A margin.** After the flip the game is a different game, and the
death list that follows is a different game's death list, not this one's with a
death removed.

**Reproduction B — `mixed` seed 3, turn 5, red-B (pawn), where the arm's effect is
below the print resolution.**

    base        top3: (-1,1)=-81.75|-24.76  (0,1)=-81.75|-24.76  (1,1)=-81.75|-24.76   -> holds at (0,1)
    room×1.5    top3: (-1,1)=-81.75|-24.76  (0,1)=-81.75|-24.76  (1,1)=-81.75|-24.76   -> rotates to (-1,1)

Three options priced identically to the printed hundredth at BOTH ends of the
bracket, and the arm flips which of them is maximal in digits the trace does not
show. The base pawn stays against the wall and dies `contest` at T22; the arm's
pawn leaves and dies `bodyBlock` at T21 — one turn EARLIER. Nothing about that
comparison is a repair; it is the same coin landing on its other face.

### `contest×1.5` — the ineligible arm, and the one that settles the question

`contest×1.5` also leaves 23 of 29 games byte-identical, and it is the arm worth
reading, because it is the direct test of "if the deaths are contest deaths, buy
more contest".

**It removes no class-A death and it causes one.**

**Reproduction C — `mixed` seed 2, turn 42, red-A (snake). The baseline plays this
game to 60 turns with ZERO deaths.**

    base         top3: (1,6)=-483.12|-166.06  (2,5)!=-483.13|-161.83  (2,7)=-483.13|-166.03  -> takes (1,6), lives
    contest×1.5  top3: (2,5)!=-483.13|-162.08 (2,7)=-483.13|-166.28   (1,6)=-483.62|-166.31  -> takes (2,7)
                 ENEMY-CELL red-A -> blue-C's square  LOST
                 DEATH red-A (contest)

The safe option `(1,6)` carried the contest charge and the fatal option `(2,7)`
did not, so raising the weight pushed `(1,6)` down 0.50 while the other two moved
by less than a hundredth, inverting a 0.01 floor gap. **Up-weighting `contest`
made the unit walk into an enemy-occupied square and die of `contest`**, and six
turns later red-B dies `edge` in the same game. On `potions` 8 the arm does remove
two contest deaths (3 → 1), and it adds four across seeds 2, 3 and 5, for a net
21 → 22.

## 5. What the sweep says about the territory/safety balance

**The head's weights are a local minimum in deaths along every direction swept.**
Seven single-knob moves — two doses down on `reach`, two down on `command`, one up
on `contest`, one up on `room`, one up on `material` — and every one of them ends
with more deaths than the table it started from, on `mixed` and on `potions`
together in six of the seven cases. That is not proof of an optimum; it is
evidence that the table is not sitting on an obvious slope, and that the numbers
`calibration.ts` records reasons for are load-bearing rather than decorative.

**Territory and safety are not the trade this fold makes.** The naive reading of
`contest-classA.md` — "the fatal option wins on territory, so charge less for
territory" — is what `reach×0.75`, `reach×0.5` and `command×0.5` test, and all
three go the WRONG way: deaths up on `mixed` and `potions`, and meals UP too
(`command×0.5` gains 15.7% of `mixed` meals while adding nine deaths). Cheapening
territory does not make the bot cautious; it makes it hungry. `reach×0.5` is the
sharpest form of that: it is the only arm in the sweep to put deaths on `sparse`
and `sparse-lean` (0 → 2 each), boards that have not recorded a death in any
measurement in this repo, and it buys +15% and +29% of their meals doing it. The
term the doc names as the one that prices the fatal option is also the term that
keeps units out of trouble on an empty board, and it cannot be sold in one
direction only.

**And the direction the owner's rule points is not purchasable here either.**
`contest×1.5` is the conservative move, it breaks a recorded inequality to be
made at all, and at that dose it removes no death from the dominant class and
adds two to a clean game. There is no admissible dose of `contest` below it that
would do more: the term is identically zero on every offered option at the
decisions in question (next section), so its weight multiplies zero.

## 6. The class-A margin — does any arm turn those decisions?

The nineteen class-A entry turns of `contest-classA.md` §3, replayed on every arm.
A row is COMPARABLE only where the unit stands on the same cell at the same turn
— elsewhere the arm has changed the game upstream and there is no decision to
compare. The baseline's own floor gap at each row is read from the runner's
top-3 print and it **reproduces the doc's `bank-floor gap` column exactly**
(0.16/0.16/0.14/0.16/0.16/0.15 on the six 0.16-class rows, 40.55, 10.00, 10.19 on
the three capture/meal rows, and 0.00 on the four floor ties).

| arm | comparable | **turned** | of which TRUE entry decisions | unit then survived entry+0…3 |
|---|---|---|---|---|
| `reach×0.75` | 9 | **0** | 0 | — |
| `reach×0.5` | 7 | 2 | **1** (`potions` 3 T11 red-B, gap 0.18) | 2 of 2 |
| `command×0.75` | 8 | 1 | **1** (`potions` 7 T8 blue-C, gap 0.11) | 1 of 1 |
| `command×0.5` | 5 | 3 | **2** (`mixed` 6 T6 red-B, gap **0.16**; `potions` 7 T8, 0.11) | 1 of 3 |
| `contest×1.5` | **18** | **0** | **0** | — |
| `room×1.5` | 14 | 1 | **0** (its one is a one-cell row) | 1 of 1 |
| `material×1.25` | 4 | 3 | **2** (`mixed` 4 T16 red-B, gap **0.16**; `potions` 1 T10, 0.00) | 3 of 3 |

Three of the doc's nineteen are rows where every offered option leaves the unit on
the same cell — the doc's own §5.4 note that they are class C in substance — and
they are separated out above, because turning one of those is not turning an entry
decision.

**Three findings, in order of how much they change the picture.**

**1. `contest×1.5` turns NOTHING, and the reason is arithmetic, not dose.** On all
18 comparable rows the arm keeps the base's choice AND the base's margin,
identical to the printed hundredth. If a term is 0.000 on every offered option, it
contributes the same 0 to each, and its weight cannot appear in the difference
between them at any dose. `contest-classA.md` §1 measured this from the option
side (`b1` varies on 0 of 19); this is the same fact from the weight side, and it
closes the question `contest`'s weight was ever going to answer.

**2. The 0.16 margin IS reachable by a weight — and this is new.** The class-A doc
established that no member gradient could close it: `π` at the largest admissible
`σ` moves 2 of 19, D1's `ε` and `p_e(c)` vary on 0 of 19. A weight is not a member,
and two arms turn a genuine 0.16-margin entry decision outright —
`command×0.5` on `mixed` 6 T6 red-B and `material×1.25` on `mixed` 4 T16 red-B —
while `reach×0.5` turns a 0.18 one and `room×1.5` moves two options 0.68 apart
across a 0.17 gap (Reproduction A). The margin is not out of range of the pricing
scale. **It is out of range of anything that only prices these decisions.**

**3. Reaching it does not pay.** `command×0.5` turns `mixed` 6 T6 and the pawn
**dies at T7 anyway**, of `contest`, one turn later — the doc's §4 reading of what
the entry turn is ("every option inside the same fan at two plies") surviving the
decision being turned. And every arm that reaches the margin is an arm that
re-prices every other decision on the board with it: `command×0.5` costs +9 deaths
on `mixed` and +3 on `potions` and takes our own `mixed`/mat-only deaths 4 → 7;
`material×1.25` costs +5 and +5; `reach×0.5` costs +8, +9 and the two `sparse`
boards. The three arms with the highest turn RATE are also the three with the
fewest comparable rows (5, 4 and 7 of 19), which is the same statement twice: an
arm strong enough to move a 0.16 margin has already moved the game out from under
the comparison.

**So the class-A verdict stands, with its reason sharpened.** `contest-classA.md`
concluded that class A is the price of a crowded board because no member could
close a 0.16 territory margin. The sweep shows the margin is closable at the
weight scale and that closing it costs more lives elsewhere than the class
contains — 19 class-A entry decisions across fourteen games, against +8 to +9
deaths per arm on `mixed` and `potions` alone. The obstacle is not the size of the
margin. It is that the margin is made of a quantity the evaluator needs at its
current price everywhere else on the board, and there is no knob in
`DEFAULT_WEIGHTS` that is local to the entry turn.

**What the next attempt inherits.** A repair for class A must be CONDITIONAL —
a term that is silent except at the entry turn, and that moves 0.16 when it
speaks. `contest-classA.md` §5 already asks for a reading the cell does not carry;
this document adds the dose it has to hit and the proof that a global re-weighting
cannot hit it without paying elsewhere. And it removes one candidate for good: no
setting of `contest` is that term, because `contest` is identically zero on every
option of the decisions in question.
