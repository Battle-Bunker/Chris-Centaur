# The `glutton` class — what actually kills us, and one rule that was tried on it

`docs/design/OPPONENTS.md` §4.4 named the largest two-seat-consistent loss in the
round robin: on `potions`, against the `glutton` profile (`food` 9, `contest`
0.5), the default's own deaths rise while the opponent's do not. It also named a
MECHANISM — the recorded `contest < food` relation being exercised by somebody
else, so that "the default's own licence to take a contested meal is therefore
exercised far more often, against a player that is not going to give way".

**That mechanism is wrong, and this document is the transcript reading that
refutes it.** §1 reads every one of our deaths in the twelve `glutton` games and
the nine in the mirror control, at the death turn and back to the last turn the
`contest` member said anything at all. §2 states the one rule the reading
supports. §3 is keep-or-revert.

---

## 1. The games, read

### 1.1 Corpus and instrument

`potions`, seeds 1–6, 60 turns, `--nodes` (550), both seats, at the working head
(`aa16e66`): twelve games `--opponent=glutton --side=0|1` and twelve mirror
controls with no `--opponent`. The side split reproduces OPPONENTS.md §4.4 on
this build:

| `potions` 1–6 | our deaths | their deaths | our meals | their meals | our weight | their weight | share |
|---|---|---|---|---|---|---|---|
| seat 0 vs mirror | 7 | 7 | 92 | 370 | 85 | 350 | 0.195 |
| seat 0 vs `glutton` | **10** | 7 | 78 | 386 | 66 | 398 | 0.142 |
| seat 1 vs mirror | 2 | 12 | 270 | 192 | 265 | 170 | 0.609 |
| seat 1 vs `glutton` | **9** | 13 | 252 | 187 | 254 | 167 | 0.603 |

Their deaths are unchanged at seat 0 and +1 at seat 1; ours are +3 and +7. All of
the extra dying is ours, exactly as §4.4 recorded.

Two SCRATCH instruments in `src/tests/local-game.ts` (env `GLUTTON_DIAG` /
`GLUTTON_DIAG2`, removed before this commit, exactly as `contest-gap.md`'s were)
printed, per decider unit-turn: the unit's turn-start energy and hunger scale,
its frozen `(tier, weight)`, and per legal destination the food-flood distance,
the per-unit `food` contribution, `contestField`'s `(reached, tier, weight)`
there and `beatenAt`; and, per OFFERED candidate, `explainPlan`'s whole
per-feature contribution vector against the plan the search actually chose.
"Offered" is the generator's own set — a wall or the unit's own neck is not a
choice the member could have made, so it is excluded, following `contest-gap.md`.

### 1.2 The finding that kills the stated mechanism

**Not one of the 19 deaths is a unit going for a meal.**

* `stagedFood` — the staged destination held a meal at the start of the turn —
  is FALSE on all 19.
* The dying unit's hunger scale runs 0.00 to 0.26; every one of them is between
  74% and 100% of its kind's maximum energy. The hungriest unit in the whole set
  is `red-A` at 74 health. `food`'s licence is written for a STARVING unit and no
  starving unit is in this corpus.
* `starvationDeaths` is 0 in all 24 games, both arms, both seats.
* At the death turn `food`'s per-option SPREAD across the unit's offered options
  is 0.00–0.16, against a `contest` spread of 0.00–1.00. Where `food` and
  `contest` disagree on the fatal option at all, `food` is the smaller number.

The `contest < food` inequality was exercised in exactly ZERO of our extra
deaths. OPPONENTS.md §4.4's mechanism is an inference from board-wide cause
counters and it does not survive the transcripts.

### 1.3 What the deaths actually are

Classified at the death turn on `contest-gap.md`'s own classes, over the offered
options only:

| class | what `contest` read at the death turn | vs `glutton` | mirror |
|---|---|---|---|
| **B — field speaks, FLAT** | every offered option beaten; `contest` identical on all of them | **12** | **9** |
| **C — forced** | one offered option (the rest wall or own neck) | 4 | 0 |
| **D — outranked** | `contest` carried a gradient and lost | 1 | 0 |
| **X — other** | the chosen option WAS the best-contest option and it died anyway | 2 | 0 |
| | | **19** | **9** |

The single D is `potions` 1 seat 0, T21, `red-C` knight, and it is not a fold
verdict: the chosen option ranks **5th of 9** on the search's own order and is
worse than the leader on `material` (−10), `energyEconomy`, `food` AND `contest`.
The fold said no on every term and the joint search staged it anyway.

One turn further back, at the last turn `contest` said anything at all — the
last turn on which some offered option read `contest = 0`:

| | vs `glutton` | mirror |
|---|---|---|
| **safe-then-trapped** — took an option the member read as free, and one ply later every option was charged | **17** | **9** |
| stepped into a charged square with a free one offered | 2 | 0 |

Median lag from that turn to the death is **1 turn** (14 of 17). In 14 of the 17,
EVERY offered option at that turn read `contest = 0` — the member had no
preference to express, because the field was silent on all of them.

**The mirror's nine deaths are the same shape: 9/9 class B, 9/9
safe-then-trapped, 0/9 on a meal.** So `glutton` does not open a new death class.
It produces MORE of the class `contest-gap.md` already named and already failed
to close: the enemy's arrival fan sweeps over the unit's whole neighbourhood in
one ply, `contestField` is one ply and reads at the arrival turn, and by the time
the member can speak the unit is pinned (`contest-gap.md` §2.2: the origin is in
`settlesOn`'s set for every candidate, so `lo` is constant, and `ourUnitTerm`'s
alive-polarity zeroes `hi` for exactly the units in a fan).

### 1.4 Why MORE of it against `glutton`, and what a careful operator wanted

The board-readable difference is **the weight of the unit that catches us**. At
seat 0 the enemy arrival that beat our unit at the fatal cell carried occupancy
12, 25, 26, 18, 5, 18, 35, 1, 12 and 23, against our 1–5: `glutton` takes 386
meals to our 78 at that seat, and the same geometry that the mirror gives us a
CAPTURE in gives `glutton` the kill. At seat 1 we out-eat it (252 to 187) and the
killers are lighter (2–10) — and our deaths still quadruple, so the weight gap is
not the whole of it either.

A careful operator, at the entry turn, wanted the square that keeps the unit out
of the fan the enemy will have NEXT turn — which is precisely the reading
`contest-gap.md` §3 proved the fold does not have, and precisely what its own
σ rule was refused for not reaching ("it does not touch class A's entry decision
at all"). Nothing in `food.ts` or `contest.ts` reaches it either.

### 1.5 A negative result on the one-ply dilation

Before proposing anything, the obvious cheap widening was measured rather than
argued: dilate `contestField` by one orthogonal step over open terrain — for a
stepper that is exactly its two-ply reach — and ask, at each entry turn, whether
the unit had a "brink-free" offered option and whether it took one.

**13 of the 19 took a brink-free option and died one ply later anyway.** Five had
an avoidable brink square and one was cornered. A two-ply reading of this shape
does not separate the fatal entry square from the safe ones, and it would charge
a large share of the board. It is not built.

### 1.6 The other classes, so the reading is not `potions`-only

Same corpus shape (seeds 1–6, 60 turns, `--nodes`, both seats), decider side split:

| class | seat | our deaths mirror → `glutton` | their deaths | our meals mirror → `glutton` |
|---|---|---|---|---|
| `potions` | 0 | 7 → **10** | 7 → 7 | 92 → 78 |
| `potions` | 1 | 2 → **9** | 12 → 13 | 270 → 252 |
| `mixed` | 0 | 9 → 10 | 5 → 10 | 82 → 87 |
| `mixed` | 1 | 4 → 4 | 10 → 15 | 274 → 254 |
| `snakes` | 0 | 6 → **5** | 10 → 12 | 108 → 102 |
| `snakes` | 1 | 4 → 5 | 12 → 12 | 107 → 136 |

**The class is `potions`, and it is `potions` alone.** On `mixed` our deaths move
+1 and 0; on `snakes` −1 and +1, both inside the seed noise, and `snakes` deaths
are `bodyBlock`/`self` rather than `contest` in both arms. Any rule aimed at this
finding has to move `potions` and leave the other two where they are; a rule that
moves all three is measuring something else.

---

## 2. The rule that was tried: THE CONTESTED-MEAL DISCOUNT

**One knob, `CONTESTED_MEAL_DISCOUNT` in `calibration.ts`, default 1; the whole
of the change is in `food.ts`.**

`contest < food` is a statement about the LAST STEP: it decides whether a unit
puts its head on the meal. §1.2 shows that step is not where our units die.
`food`'s flood is what decides the eight steps BEFORE it, and it seeds every meal
on the board at distance 0 whatever is standing next to it — so a unit at full
health is walked, one cell of gradient per step, toward a square a heavier enemy
takes this turn, and §1.3 says it arrives inside that enemy's fan one ply before
the fan closes. The rule applies the SAME doctrine to the gradient that
`contest < food` applies to the destination:

    field      = contestField(sub, asTeam)          -- the one the member folds
    keepable   = { meals m : !beatenAt(field, tier_u, weight_u, m) }
    distFree   = the same open-terrain flood, seeded from `keepable`
    discount   = CONTESTED_MEAL_DISCOUNT x (1 - hunger_u)
    near_u     = nearFree_u + (1 - discount) x (nearAll_u - nearFree_u)

and `pullOf` is otherwise the function it was.

* **It reads the BOARD and never the opponent.** `beatenAt` against the enemy
  roster's own legal action sets, at our own unit's frozen `(tier, weight)`. It
  would fire identically against a mirror; §3's mirror classes are how much it
  does.
* **It is not a board special case.** No branch on a scenario, a kind name or a
  team; the knob is one number beside the others in `calibration.ts` and zero is
  the identity, byte for byte, at every hunger.
* **It does not refuse a capture.** A meal a LIGHTER or lower-tier enemy stands
  beside is still seeded at full strength, because the test is `winsContest`'s
  and not "is anybody near it" — BEHAVIOUR-AUDIT D1's third falsifier, built in
  rather than checked afterwards.
* **It respects every recorded inequality in `checkWeights` and in
  `calibration.ts`.** No weight moves. `contest` (3) still sits under `food` (4).
  The hunger conditioning is what keeps the relation the `contest` docstring
  states — *"a hungry unit still takes a contested meal"* — exactly true: at
  `hunger = 1` the discount is 0 at every knob setting and `pullOf` returns the
  number it returned before the knob existed. The feature's declared range is
  unchanged: `nearFree <= nearAll` because the free flood's seed set is a subset
  of the full one, so `near` stays in `[0, 1]`, the feature stays in `[0, 1]`,
  and `4 x 1 < 10 x 1` is the same certificate it was.
* **Cost.** One extra 169-cell flood per `(marshalled board, team, tier,
  weight)`. A team holds a handful of distinct pairs, and `contestField` is
  already cached on the same key.

`src/lobster/__tests__/food-contested-meal.test.ts` pins the four properties:
the free flood drops the beaten meal and keeps the clear one; a heavier or
higher-tier unit of ours keeps it; a hungry unit still prefers it, and at
`hunger = 1` the reading is the undiscounted one; and a full unit's preference
FLIPS away from it.

