# Potions: a member that was built, measured three ways, and deleted

> "Intentionality about collecting potions — more likely when it is profitable
> for our team and the collector is not in great danger."

This is the negative-result record for that member. It is written down rather
than merely reverted because the argument for the term is a good one, the term
was cheap to build, and the next person to have the idea should get to start
from the measurement instead of from the idea.

## What the rules make a pickup worth

The pickup rule is INVERTED (`settleTurn.ts` phase 2): the collector takes
**−1**, every LIVING ally takes **+1**, and both lapse at
`turn + potionWindowTurns`. A tier does exactly one thing —
`strictMaximum` (`turnEngine.ts`) takes the highest frozen tier before it looks
at weight — so a tier is worth precisely the contests it flips.

Before the member there were two potion levers and neither could decline a
pickup on the team's behalf:

* `candidates.ts::tierRisk` (`selfDebuffOrdering`) moves a self-debuffing
  destination down the list the anytime path walks. It is an ORDERING key; it
  refuses nothing.
* `evaluate/tier.ts` prices the window a unit HOLDS, at the one cell that unit
  stands on this turn. Right for a buff in hand, nearly blind for a pickup: the
  ally's +1 is priced only if that ally happens to be standing on a contested
  square this turn, and the collector's −1 only if its own landing square is
  contested — so a unit walking onto a potion in the open paid nothing.

## The member, and what was measured

`src/lobster/evaluate/potion.ts`, seated at the end of `FEATURES` at weight 2,
identically zero on any board with potions off or none standing (asserted over
the whole law corpus, so the three potion-free scenarios were byte-identical on
every counter in both arms — verified, not assumed).

Each unit's GROUND is every cell its own grammar lets it end a turn on, from
the engine's own enumerator (`EngineSubstrate.actionsOf`) — the same set
`contestField` stamps the enemy roster onto. Against the best enemy arrival at
each of those cells the contest rule is asked twice, at the tier now and at the
tier `substrate.tiersAfterPickupBy` says settlement will leave the unit on.

    profit = min(1, Σ over allies (share of that ally's ground the +1 wins))
    peril  = the collector's own exposure once the −1 lands
    potion = (profit − 2 × peril) / |ours|

The instrument is a new runner counter, `profitablePickups`
(`src/tests/local-game.ts`): a pickup is profitable when, inside the window it
opens, an ALLY of the collector — never the collector, whose tier went DOWN —
is named in a tier-decided clash (`contest`, `edge` or `sever`) by the engine's
own `Clash.playerIDs`. That is the whole of "the pickup bought the team
something" under these rules.

Three arms, `potions`, five seeds x 30 turns, `--nodes` (deterministic):

| arm | pickups | profitable | share | tierUps | deathsWhileDebuffed | deaths | meals/100 |
|---|---|---|---|---|---|---|---|
| **A** no member (HEAD) | 29 | 8 | **27.6%** | 66 | 1 | 11 | 16.31 |
| **B1** peril as marginal flips | 36 | 10 | **27.8%** | 83 | 1 | 12 | 17.20 |
| **B2** peril as exposure | 22 | 6 | **27.3%** | 48 | 2 | 12 | 18.35 |

## The reading

**The term changes how many potions the bot takes and does not change which
ones.** The profitable share is 27–28% in all three arms; profitability tracks
the pickup count and nothing else. B2 declined seven of A's pickups, of which
five were unprofitable — 71%, against a base rate of 72%. That is the
definition of no discrimination.

The pre-registered gate was "pickups per 100 should move toward profitable ones,
`deathsWhileDebuffed` 0, `tierUps` not lower, meals not lower beyond noise". The
share did not move in either direction; `deathsWhileDebuffed` went 1 → 1 → 2.
So the member is deleted, and this file is what is kept.

### Why B1 was not the end of it

B1 priced the collector's peril as the mirror of the profit — the cells the −1
NEWLY loses. The trace said what that does: on seed 1, `red-A` took a potion on
turns 8, 16 and 22, and `red-C` on two consecutive turns, 24 and 25. The
mechanism is the rule read correctly and the wrong question asked of it. A unit
already at −1 loses every contested cell to a tier-0 enemy ALREADY, so the
marginal step to −2 flips nothing and a second pickup is charged **zero** — the
deepest hole on the board is the one a marginal reading prices free.

B2 asked the question the brief actually poses: how much of its own ground can
an enemy BEAT the collector at while it carries the debuff. Absolute, not
marginal, so a unit already in a fight is exactly the unit refused. It cut
pickups 36 → 22 and moved the share by −0.5 points.

### What a future attempt would have to fix

1. **The geometry is one turn and the liability is a window.** Both halves read
   `contestField`, which is where an enemy could end THIS turn. The debuff runs
   three. Widening only the peril half to the window's own dilation is the
   change with an argument behind it: an ally can decline a square it still
   loses, and a debuffed collector carries its −1 wherever it is pushed.
2. **The ally's ground is read from its turn-start position, not from where the
   plan puts it.** That is what makes the whole trade memoisable per collector
   per decision (one `tiersAfterPickupBy` probe, one enumerator pass), and it is
   also why the term cannot tell two plans with the same collector apart.
3. **The instrument has almost no power.** Twenty-two to thirty-six pickups over
   five seeds, six to ten of them profitable, is not a sample that could resolve
   a ten-point shift in the share. Sixty-turn runs, or a counter that records
   the enemy tier at each pickup rather than waiting for a clash to happen,
   would be the first thing to fix — before the member, not after it.

### What is kept

`profitablePickups` stays in the runner. It measures a real property of the
game, it costs nothing on a potion-free board, and it is the number any future
attempt has to move. `src/lobster/__tests__/evaluate.test.ts` keeps the `tier`
suite it always had; the potion suite went with the member.

---

# The second attempt: `evaluate/potion.ts`, seated

Everything above is the record of the FIRST attempt and stands unedited. This
section is the second one, built from the three repairs the section above asks
for, and it is a keep rather than a delete.

## 1. The instrument, and the measurement that changed its definition

`profitablePickups` stayed exactly as it was, because it is the number the
history is written in. Three counters joined it in `src/tests/local-game.ts`
(`readPickup`), taken AT the pickup off the board it left behind rather than
three turns later:

* the collector's energy;
* the best enemy tier that shares its ground inside the window;
* `catchTurn`, the earliest turn of the window at which an enemy that OUTRANKS
  the debuffed collector can stand where the collector can stand.

Both sides come from `computeClaims` with every unit held and
`input.turn − observedTurn` set to k, which is the engine's own answer to "where
could this be, and how strong could it be, after k turns". Nothing walks the
movement grammar twice.

`exposed` (and so `reckless`) is `catchTurn === 1`, and the first repair the
section above asks for — read the peril over the WINDOW's dilation — is the
reason it is not the whole span. Done literally, the reading is VACUOUS. The
per-horizon beaten share of the collector's own ground, on seed 1:

    k=1  1/6   2/6   2/5   4/5   1/9   0/5   0/9   1/5   0/1
    k=2  13/13 10/13 12/13 13/13 9/16  13/13 10/16 13/13 0/3
    k=3  24/25 24/25 20/24 24/25 25/27 25/25 25/26 23/25 1/7

By the second turn every unit on an 11x11 board can meet every other, and a
debuffed unit loses to all of them on tier alone, so "could an enemy that
outranks me share my ground inside the window" was true of 41 pickups out of 41.
What the span carries is WHEN, not WHETHER. So the term reads the whole window
and weights horizon k by `W − k + 1`: the near turns are where the geometry
still discriminates, and they are also the turns the collector has had no chance
to walk away from — a claim at horizon k grants the enemy k free turns and the
collector none.

**This is the correction to point 1 of "What a future attempt would have to
fix", and it is a correction and not an implementation of it.**

The instrument draws nothing from the rng and runs only where a potion was
collected, so the three potion-free scenarios were verified byte-identical
against a pre-instrument build (nine runs, 60 turns, seeds 1–3, zero
differences outside the new fields, which are zero).

## 2. The member

`profit` is each ally's own tier against the tier the pickup gives it,
`winsContest` asked twice, AT THE CELL THE PLAN PUTS THE ALLY (point 2, fixed)
and against the enemy field at each turn of the window rather than at one.
`peril` is the share of the collector's OWN GROUND — not its landing square —
that a beating enemy can occupy, at the debuffed tier settlement leaves it on,
absolute rather than marginal (the B1/B2 lesson above), horizon-weighted as
described. `potion = (Σ profit − 2 × peril) / |ours|`, so peril dominates.

The collector's ground is read from where it stands as the turn opens, not from
the potion cell: a superset of the truth, conservative in the direction the
brief asks for, and it is what keeps the peril half memoisable per collector
instead of per plan.

### The soundness fix the bank found

The first cut of the member named ONE collector — the first of ours resting on a
potion — and priced only that one. Two of our units can rest on two potions in
the same turn, and a unit that might die might not collect at all, so *which
unit is the collector* is itself world-dependent and a floor that named one of
them is a floor a world with a different one falls through. The term now walks
the candidates in roster order and takes the union: a candidate alive in every
world closes the walk, a contingent one is admitted and the walk goes on, and
running off the end admits the no-pickup world at zero. Three potion boards
joined `LAW_CASES`, including a slider taking a potion a held rook can contest,
and R1/R2/R3 hold over all of them.

## 3. What was measured

`potions`, 60 turns, seeds 1–5, `--nodes` (deterministic). BEFORE is HEAD plus
the instrument; AFTER adds the member at weight 2.

| | pickups | profitable(ally clash) | profitable AND safe | reckless | deathsWhileDebuffed | deaths | meals/100 |
|---|---|---|---|---|---|---|---|
| BEFORE | 41 | 12 (29.3%) | 3 (**7.3%**) | 30 (**73.2%**) | 2 | 16 | 17.85 |
| AFTER  | 24 | 11 (45.8%) | 4 (**16.7%**) | 18 (**75.0%**) | 3 | 12 | 18.26 |

Per seed, pickups went 9→1, 4→8, 12→4, 9→2, 7→9: the member is not a uniform
brake, it re-sorts. The pre-registration was "profitable share up, reckless
share down, pickups may fall, deathsWhileDebuffed 0, meals not down beyond
noise, potion-free boards byte-identical". Scored honestly:

* **profitable share up — YES.** 7.3% → 16.7% on the conjunction, 29.3% → 45.8%
  on the older ally-clash counter alone. Four events against three, so this is
  a direction and not a measurement of size.
* **reckless share down — NO.** 73.2% → 75.0%, flat. The term charges a SHARE of
  the collector's ground and `reckless` fires on a single beatable cell, so the
  two are not the same threshold; a pickup with one bad square out of six costs
  almost nothing and still counts reckless. That mismatch is the honest reading
  and it is the next thing to fix, in the counter or in the term.
* **pickups may fall — yes**, 41 → 24, and not to zero.
* **deathsWhileDebuffed 0 — NO**, 2 → 3. Against 16 → 12 total deaths, which is
  the counter that matters more and moved the right way.
* **meals not down — held**, 17.85 → 18.26 per 100 unit-turns.
* **potion-free byte-identical — YES**, nine runs, zero differences.

The keep rule was "profitable share rises OR reckless falls, pickups not
collapsing". The first disjunct holds and pickups are 24. **Kept.**

### The transcript, seed 1

Turn 2. `green-A`, a snake at (5,1) with the potion at (5,2) one step north.
BEFORE, (5,2) is its best option at floor −74.09 and it takes it; the instrument
reads `enemyTier+0 caught@1 EXPOSED`. AFTER, the same three options are ordered
(6,1) = −74.14, (4,1) = −74.19, (5,2) = −74.33 — the pickup has fallen from
first to third by about two tenths, and the snake steps sideways instead. It is
the same board, the same seed and the same turn; the whole difference is the
peril half.

The one pickup the AFTER arm did take on that seed is turn 42, `blue-A` onto
(2,5) at floor 161.05 against 161.01 for the next option — a four-hundredth of a
point. Blue had TWO allies to arm (a queen and a pawn) where green-A had one,
and that is the entire margin.

### Bound inversions: REPAIRED SINCE, and the figures below are history

**Corrected.** What this section recorded — with the member OFF, 875
`ScoreBounds` inversions on seed 7 over seeds 1–10 at 60 turns, and 103 with the
member ON (26 on seed 5, 77 on seed 8) — is no longer what the board does.
`docs/design/BEHAVIOUR-AUDIT.md` §"behaviour that is already right" item 4 read
`CENTAUR_DEBUG_INVERSION=1` over ten 60-turn runs spanning all four scenarios,
`potions` seeds 5, 7 and 8 among them, and found **zero** inversions on every
one; the same reading was re-taken over sixteen arms on the `beh-contest` branch
(`mixed`, `snakes`, `sparse`, `potions` seeds 1–3 at 30 turns, plus `potions`
seeds 4, 5, 6 and 8 at 60) and is again zero everywhere. Whatever produced the
875 and the 103 was fixed somewhere else between then and now — the soundness
repairs to `evaluate/features.ts` and `bounds/material.ts` are the obvious
candidates, and neither was this member's.

So the sentence this section used to end on — that "zero inversions" is not a
gate the `potions` scenario can pass in either arm — is withdrawn. It is a gate
that board passes today, and it is used as one. The old numbers stay written
down because they were measured and because a claim about latent unsoundness
should not be quietly deleted once it stops reproducing; they are history, not
a live reading.

## 4. What the next attempt should look at

1. **`reckless` and the peril half disagree about what "danger" is.** One is a
   boolean on a single beatable cell at horizon 1, the other a share over the
   whole ground. Make the counter a share too, or make the term refuse on the
   first turn's boolean, but do not leave them measuring different things.
2. **Four profitable-and-safe pickups is still not a sample.** Sixty turns and
   five seeds gives 24–41 pickups; resolving a ten-point shift wants an order of
   magnitude more. Twenty seeds, or a board with more potions and more units.
3. **The collector's ground is read from its turn-start cell.** Reading it from
   the potion cell would make the peril per-plan rather than per-collector, and
   would cost a claim pass per candidate destination. Whether that buys anything
   is unmeasured.

---

# D4: the far horizons were a constant, and ate half the peril's range

`docs/design/BEHAVIOUR-AUDIT.md` D4. The peril half reads the whole window and
weights horizon k by `W − k + 1` — 3, 2, 1 at `W = 3`. Section 1 above records
why the far horizons are read at all and also why they say nothing: 41 of 41
pickups came back fully exposed at k = 2 and k = 3, because by the second turn
every unit on an 11x11 board can meet every other. So under arithmetic weights
`beaten_2 = beaten_3 = 1` almost always, and

    peril = (3·beaten_1 + 2 + 1) / 6 = 0.5·beaten_1 + 0.5

— half the term's mass is a constant and the usable range is `[0.5, 1]`, not
`[0, 1]`. The one horizon that still discriminates is halved before it meets
`PERIL_WEIGHT`, and the audit's reproduction is what that buys: `potions`
seed 6 turn 39, `red-C` pays a tier to give its ONE surviving ally a tier, while
EXPOSED at horizon 1, on a margin of 0.03 over the next option.

## The baseline this section is measured against

`potions`, 60 turns, seeds 1–8, `--nodes` — the audit's own corpus, reproduced
on this branch before the change:

| pickups | profitable | reckless | profitable AND safe | deathsWhileDebuffed |
|---|---|---|---|---|
| 39 | 16 (41.0%) | 23 (**59.0%**) | 8 (**20.5%**) | 0 |

## The rule that was built

One knob, exactly as the audit specifies it: `w_k = λ^(k−1)` with `λ` defaulting
to a quarter, so the three horizons of a `W = 3` window carry 76%, 19% and 5%
instead of 50%, 33% and 17%. `λ = 1` recovers a flat reading and the arithmetic
weights are the single point the knob replaces. Nothing else moved: the same
claim passes, the same ground, the same `beatenAt`, and the term is still
identically zero on a board with no potion standing.

The reproduction is `potions` seed 6 turn 39, and it is now a fixture
(`src/lobster/__tests__/tier-window.test.ts`), taken off the runner at the turn
the decision opened on. red-C's own three horizons there are

    k=1   3 of 9 cells beaten   (0.333)
    k=2  35 of 35               (1.000)
    k=3  75 of 75               (1.000)

— the saturation, on the very board the audit reproduces. Under `3, 2, 1` that
reads `peril = 2/3`, of which **0.5 is the constant tail and 0.167 the whole of
the exposure the trace calls `caught@1 EXPOSED`**. Under `λ^(k−1)` it reads
0.492: the tail is worth 0.238 and the exposure 0.254, so horizon 1 finally
outweighs the constant. The audit's diagnosis is exactly right, and the fixture
is kept so that it stays a number.

## What was measured, and why it was reverted

`potions`, 60 turns, seeds 1–8, `--nodes`, paired by seed
(`scripts/ab-compare.js`, per board class, never pooled). Two arms of the one
rule: `λ = 1/4` at the shipped `PERIL_WEIGHT = 2`, and — since the first arm's
failure is a LEVEL failure — a second at `PERIL_WEIGHT = 3`, the largest the
calibration inequality tolerates (`2 × 3 = 6` against a cliff ceiling of 10;
raising the profile weight instead is not available, since `potion` must stay
under `contest` at 3).

| arm | pickups | profitable | reckless | profitable AND safe | deathsWhileDebuffed | deaths |
|---|---|---|---|---|---|---|
| BEFORE (`3, 2, 1`) | 39 | 16 | 23 (**59.0%**) | 8 (**20.5%**) | 0 | 26 |
| `λ = 1/4`, PERIL_WEIGHT 2 | 63 | 15 | 50 (**79.4%**) | 5 (**7.9%**) | 1 | 22 |
| `λ = 1/4`, PERIL_WEIGHT 3 | 49 | 9 | 35 (**71.4%**) | 2 (**4.1%**) | 0 | 19 |

The pre-registered prediction was reckless **59% → ≤40%**, profitable-and-safe
**20.5% → ≥30%**, pickups **≥20**, `deathsWhileDebuffed` **0**. Scored honestly:

* **reckless share down — NO**, and by a wide margin: 59% → 79%. Per seed the
  reckless rate rises on 7 of 8 (sign test p = 0.070).
* **profitable-and-safe up — NO**: 20.5% → 7.9%, down on 6 of the 7 seeds that
  move. In the `PERIL_WEIGHT = 3` arm it is down on 7 of 7, p = 0.016 — the one
  statistically clean result in the whole experiment, and it is a refutation.
* **pickups ≥ 20 — yes**, 39 → 63. Too many, not too few.
* **`deathsWhileDebuffed` 0 — NO** in the first arm (one, on seed 5), 0 in the
  second. Total deaths fell in both (26 → 22 → 19), and deaths did not rise on
  any board class.
* **potion-free classes byte-identical — YES.** `mixed`, `snakes` and `sparse`,
  seeds 1–3 at 30 turns, are identical run summaries in both arms;
  `collectorsOf` gates the whole member exactly as the audit says.
* **Bound soundness — CLEAN.** Sixteen arms under `CENTAUR_DEBUG_INVERSION=1`
  (`mixed`/`snakes`/`sparse`/`potions` seeds 1–3 at 30 turns, plus `potions`
  seeds 4, 5, 6, 8 at 60) print no INVERSION line at all. The rule is sound; it
  is simply not the repair.

**Reverted.** The knob, the geometric weights and the `PERIL_WEIGHT` arm are all
backed out; the file ships the arithmetic weights it always had.

## Why it fails, which is the part worth keeping

**Renormalising a saturated tail is a price cut, not a re-sort.** With
`beaten_2 = beaten_3 = 1`, any weighting that gives horizon 1 more mass gives
the tail less, so `peril` drops for EVERY pickup — the tail's contribution goes
from 0.5 to 0.238 — and the two readings meet only at `beaten_1 = 1`. A pickup
priced 2/3 before is priced 0.49 after. Cheaper potions mean more potions: 39
became 63. And the pickups a price cut admits are the MARGINAL ones, which on
this board are the exposed ones, so the extra 24 pickups were 27 more reckless
ones and three fewer profitable-and-safe ones. Widening the discriminating range
by 0.26 bought less than lowering the level by 0.26 cost.

**`reckless` and `peril` still disagree about what danger is** — §4 item 1 of
the section above, now with a measurement behind it. `reckless` is a BOOLEAN on
one beatable cell at horizon 1; `peril` is a SHARE of the ground. red-C at the
reproduction is `EXPOSED` on three of nine cells, and the geometric reading
charges it 0.49 — under a half, less than the arithmetic reading charged the
safest pickup on the board. A term that charges shares cannot be steered into
refusing a boolean by re-weighting the shares, at any λ.

## What the next attempt should do differently

1. **Separate the level from the shape.** The audit's rule changes both at once
   and the level dominated. A repair that widens the range must hold the mean
   cost of the corpus fixed — measure the peril of every pickup in the BEFORE
   arm first, then choose the weights and the scale together so the median
   pickup is priced where it was.
2. **Fix the counter or the term, but make them the same question.** Either
   `reckless` becomes a share with a threshold, or the peril half gains a floor
   term that fires on `beaten_1 > 0` at all. The second is a cliff and wants the
   bounds bank's opinion; the first is an instrument change and costs nothing.
3. **Do not re-derive the horizon weights alone.** They are measured now, at
   `λ ∈ {1/4}` against `3, 2, 1`, on eight seeds and 39 → 63 pickups. Another λ
   moves the level in the same direction as this one did.
