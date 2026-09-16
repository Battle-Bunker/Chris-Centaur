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

---

# P2: the peril reads a SHARE of the collector's ground, so a wide collector dilutes itself

`docs/design/BEHAVIOUR-AUDIT-2.md` §P2. `perilOf` divides beaten cells by the
collector's OWN ground at each horizon, so three beaten cells read 0.375 against
a knight's eight-cell ground and 0.12 against a queen's twenty-five — the wider
the collector, the cheaper identical danger looks, yet it will stand on exactly
one cell and which one is not its choice alone.

## The baseline this section is measured against

`potions`, 60 turns, seeds 1–8, `--nodes`, reproduced on this branch at
`33c2b23` before the change — identical on every counter to the audit's own
reading:

| pickups | profitable | reckless | profitable AND safe | deathsWhileDebuffed | deaths | unit-turns | meals/100 |
|---|---|---|---|---|---|---|---|
| 35 | 15 (42.9%) | 25 (**71.4%**) | 7 (**20.0%**) | 0 | 21 | 3124 | 19.43 |

The reproduction the audit names is on this arm to the digit: `potions` seed 4,
turn 36, red-C plays the potion cell `(0,7)` at `-342.34` over `(4,5)` at
`-342.30` — a margin of **0.04** — and the trace prints
`[red-C hp97 enemyTier+0 caught@1 EXPOSED]`.

`mixed`, `snakes` and `sparse`, seeds 1–3 at 30 turns, are the potion-free
control: `collectorsOf` gates the whole member, so every arm below must leave
them byte-identical.

## The rule that was built

One knob, exactly as §P2 specifies it: `PERIL_CONCAVITY = γ` shaping the
per-horizon share before it is weighed —

    num += w * (beaten / cells.length) ** γ

— with `γ = 1` the term it replaces and nothing else in the member touched: the
same claim passes, the same ground, the same `beatenAt`, the same horizon
weights `W − k + 1`. Unlike D4 it redistributes nothing between horizons, so
`share^γ ≥ share` makes it a price RISE on every pickup and never a cut.

The reproduction is `potions` seed 4, turn 36, red-C, and it is now a fixture
(`src/lobster/__tests__/tier-window.test.ts`), taken off the runner at the turn
the decision opened on. red-C's own three horizons there are

    k=1   3 of 9 cells beaten   (0.333)
    k=2  34 of 34               (1.000)
    k=3  73 of 73               (1.000)

— the same saturation D4 found on seed 6, on a different board. Under `3, 2, 1`
that reads `peril = 2/3`. At `γ = 1/2` it reads 0.789 and at `γ = 1/3` 0.847, so
the collector's charge in fold units (`potion` 2 × `PERIL_WEIGHT` 2 ÷ three
living red units) rises by **0.163** and **0.240** — four and six times the 0.04
margin the audit measured the rule against.

## What was measured, and why it was reverted

`potions`, 60 turns, seeds 1–8, `--nodes`, paired by seed
(`scripts/ab-compare.js`, per board class, never pooled). Both γ the audit named:

| arm | pickups | profitable | reckless | profitable AND safe | deathsWhileDebuffed | deaths | unit-turns |
|---|---|---|---|---|---|---|---|
| BEFORE (`γ = 1`) | 35 | 15 | 25 (**71.4%**) | 7 (**20.0%**) | 0 | 21 | 3124 |
| `γ = 1/2` | 31 | 11 | 22 (**71.0%**) | 6 (**19.4%**) | 0 | 22 | 3137 |
| `γ = 1/3` | 24 | 12 | 16 (**66.7%**) | 5 (**20.8%**) | **2** | **30** | 2955 |

The pre-registered prediction was reckless **71.4% → ≤50%**, profitable-and-safe
**20.0% → ≥25%**, pickups **≥20**, `deathsWhileDebuffed` **0**, `potions` deaths
**not above 21**, and the potion-free classes byte-identical. Scored honestly:

* **reckless share down — NO.** 71.4% → 71.0% at `γ = 1/2`, and 66.7% at
  `γ = 1/3`; the target was 50%. The share barely moves at either γ.
* **profitable-and-safe up — NO.** 20.0% → 19.4% → 20.8%; the target was 25%.
* **pickups ≥ 20 — yes**, 35 → 31 → 24. Not a collapse, but the count is the
  ONLY thing that moved: the composition is flat while the total falls a third.
* **`deathsWhileDebuffed` 0 — yes at `γ = 1/2`, NO at `γ = 1/3`** (two, seeds 5
  and 6).
* **deaths not up — marginal at `γ = 1/2`** (21 → 22), **NO at `γ = 1/3`**:
  30 deaths, up on 7 of the 8 seeds (sign test p = 0.070), and two of them are
  `edge` deaths — the class D1's floor repair had cleared to zero across the
  whole corpus. That arm is a regression, not a null result.
* **potion-free classes byte-identical — YES**, at both γ. `mixed`, `snakes`
  and `sparse`, seeds 1–3 at 30 turns, are identical run summaries (modulo the
  `--label` string) and identical transcripts (modulo decision timings) in both
  arms; `collectorsOf` gates the whole member exactly as the audit says.
* **Bound soundness — CLEAN.** Sixteen arms under `CENTAUR_DEBUG_INVERSION=1`
  print no INVERSION line at all. The rule is sound; it is simply not the repair.

**Reverted.** The knob is backed out and the file ships the plain share it always
had; `git` shows a zero diff against `33c2b23` for `window.ts`, `calibration.ts`
and `index.ts`, and all eight `potions` summaries come back byte-identical to the
baseline above.

## Why it fails, which is the part worth keeping

**1. The charge is common to both sides of the comparison, so it cannot re-sort
it.** This is the finding, and it is not a level argument. `perilOf` reads the
ground from where the collector STANDS as the turn opens, not from the cell the
plan sends it to — deliberately, and the comment above it says why: that is what
keeps the peril half memoisable per collector rather than per plan. The
consequence nobody had drawn is that the peril charge is then IDENTICAL on every
joint plan in which that collector picks the potion up. Raising it adds the same
constant to both of red-C's top candidates, and a constant common to both sides
of a comparison cancels. The transcript is unambiguous — every red candidate at
turn 36 moves by the same −0.16 and the decision does not change:

    γ=1    (4,5)=-342.30  (0,7)=-342.34  (1,4)=-342.99   played (0,7)
    γ=1/2  (4,5)=-342.47  (0,7)=-342.50  (1,4)=-342.99   played (0,7)

`(1,4)` is the one candidate whose best joint plan collects nothing, and it alone
does not move. **So the 0.04 the audit sized the rule against is the wrong
margin.** It is the gap between two lines that BOTH collect; the gap the knob
actually has to close is the 0.65 out to `(1,4)`, sixteen times larger, and
`γ = 1/2` is worth 0.163 of it. On three of the eight seeds (5, 6, 7) not one
move changed anywhere in sixty turns at `γ = 1/2`, though every printed score
shifted — which is that cancellation, measured.

**2. `γ < 1` does not widen the reading; it moves the level, which is D4 with
the sign flipped.** `s^γ` maps [0, 1] onto [0, 1], so the peril's range over a
saturated tail is `[0.5, 1]` at EVERY γ — the concave map buys no range at all.
Over seed 4's own 42 distinct horizon-1 grounds the shares run [0, 0.571] with a
median of 0.226, so at `γ = 1/2` the level shift at the median (0.125) is larger
than the extra spread opened at the observed ceiling (0.092). D4 cut the level
and admitted 24 marginal pickups; this raises it and refuses 4 or 11 of them.
Neither re-sorts, and the counters say so in the same shape: the reckless share
moves 71.4% → 71.0% → 66.7% while the count falls 35 → 31 → 24. **The pickups a
level change moves are the marginal ones by TOTAL score, and total score is not
sorted by recklessness** — so refusing them subtracts reckless and
profitable-and-safe pickups in roughly the proportion they already stood in.
`potions.md` D4's own first prescription — "separate the level from the shape,
hold the mean cost of the corpus fixed" — is the thing this rule did not do, in
the one direction that had not been tried.

**3. `reckless` and `peril` still disagree about what danger is,** and §P2 says
so itself: no γ can make a term that charges SHARES refuse what a BOOLEAN on one
beatable cell counts. That remains the standing bound on this whole line of
repair.

## What the next attempt should do differently

1. **Make the peril per-PLAN, or stop trying to steer with it.** Finding 1 is
   structural, not a calibration: while the ground is read from the turn-start
   cell, every scaling of the peril is a constant across the collector's own
   options and can only ever move the pickup lines as a bloc against a
   non-pickup line. Reading the ground from the plan's destination is the
   change that would give the term a gradient over the collector's own moves —
   §1 item 3 above already names it as unmeasured, and it costs a claim pass per
   candidate destination. That price is now the question, and it is the only one
   worth asking next.
2. **Do not sweep γ again.** It is measured, at 1/2 and 1/3, on eight seeds and
   35 → 31 → 24 pickups. Both arms move the level and neither moves the
   composition, and `γ = 1/3` costs nine deaths and brings `edge` deaths back.
3. **A floor term on `beaten_1 > 0` is still untried,** and it is the one shape
   that is not a scaling of the existing share — so it is the one shape finding 1
   does not already refute. It is a cliff and wants the bounds bank's opinion.

---

# P3: the ground read from the PLAN's own cell — the one repair §P2 left, and the constant it does not remove

`docs/design/BEHAVIOUR-AUDIT-2.md` §P2's closing prescription, and §1 item 3 of
the second attempt above: *read the collector's ground from the cell the plan
leaves it on, at a claim pass per candidate destination, because that is the
only change that gives the term a gradient over the collector's own options.*
This section is that change, measured, and reverted.

## The instrument, taken BEFORE the rule — and it answers the hypothesis

Three attempts have now sized a rule against a margin without first measuring
whether the signal the rule needs is on the board. So the counter came first.
`readPickup` (`src/tests/local-game.ts`) already answered "can a beating enemy
share the collector's GROUND on the window's first turn" — that is `exposed`,
which `recklessPickups` counts. Two counters join it, in the same frame and with
the same conservatism:

* `arrivalBeaten` — can a beating enemy hold the ONE CELL the plan left the
  collector on;
* `ground1` — the horizon-1 beaten share, summed over the corpus.

`potions`, 60 turns, seeds 1–8, `--nodes`, on the baseline arm, which the
instrument leaves identical on every existing counter (35 pickups, 15
profitable, 7 profitable-and-safe, 25 reckless, 0 `deathsWhileDebuffed`, 21
deaths, 3124 unit-turns — the P2 baseline to the digit):

| pickups | reckless | **arrivalBeaten** | arrivalBeaten ∧ reckless | mean horizon-1 share |
|---|---|---|---|---|
| 35 | 25 (71.4%) | **5 (14.3%)** | 5 | 71/316 = **0.225** |

**The hypothesis is 5/35 before it is written.** Every arrival-beaten pickup is
also reckless, so the per-plan reading is a strict subset of what the counter
counts — and the other twenty reckless pickups are reckless because of their
GROUND, not their arrival cell. And at the very reproduction §P2 names, the
trace prints

    T 36 red-C knight hp98 (2,6)->(0,7)  top3: (4,5)=-342.30 (0,7)=-342.34 (1,4)=-342.99
    POTION x1  [red-C hp97 enemyTier+0 caught@1 EXPOSED arrival=safe ground1=1/5]

— `arrival=safe`. The boundary case the rule was commissioned to fix is not a
case the rule can see. That was known before a line of the member changed, which
is the whole point of instrumenting first.

## The rule that was built

One knob, `PLAN_PERIL_SHARE = α` (`window.ts`), replacing a single point: `α = 0`
is the turn-start ground the term always read — verified, `potions` seed 4 at 60
turns comes back transcript-identical — and `α = 1` reads the collector's ground
entirely from the plan. One parameterisation, no board special case:

    ground_k(plan) = where the collector can be k − 1 turns after its arrival

so `k = 1` is that rule at zero further turns, which is the one cell the plan
chose, and `k ≥ 2` is the engine's own `claimsAfter` asked of a board whose only
change is the collector's settled occupancy. Nothing between the horizons is
reweighted (D4) and nothing about the share is reshaped (P2). Memoised per
(collector, occupancy) on the marshalled board — a collector's arrival cell is
always a potion cell, so the key set is our roster times the potions standing,
not one key per node: `W − 1` claim passes per key, and the corpus costs 3m20
against the baseline's 3m15.

## What was measured

`potions`, 60 turns, seeds 1–8, `--nodes`, paired by seed
(`scripts/ab-compare.js`, per board class, never pooled). Two arms, the second
because the first's failure is a LEVEL failure — `PERIL_WEIGHT = 3` is the
largest the calibration inequality tolerates, exactly as D4 ran it:

| arm | pickups | profitable | reckless | profitable AND safe | deathsWhileDebuffed | deaths | unit-turns |
|---|---|---|---|---|---|---|---|
| BEFORE (`α = 0`) | 35 | 15 | 25 (**71.4%**) | 7 (**20.0%**) | 0 | 21 | 3124 |
| `α = 1`, PERIL_WEIGHT 2 | 49 | 17 | 34 (**69.4%**) | 7 (**14.3%**) | 0 | **25** | 3134 |
| `α = 1`, PERIL_WEIGHT 3 | 25 | 7 | 20 (**80.0%**) | 3 (**12.0%**) | 0 | **25** | 3145 |

Per seed, pickups 5/7/4/8/1/3/2/5 → 7/8/8/7/1/7/5/6: up on 7 of the 7 seeds that
move, sign test **p = 0.016**, the one statistically clean result in the arm and
it is the wrong direction. The pre-registered gate was reckless share **down
from 71.4%**, profitable-and-safe **up from 20.0%**, pickups **≥ 20**,
`deathsWhileDebuffed` **0**, deaths **not above 21**, potion-free classes
**byte-identical**. Scored honestly:

* **reckless share down — NO**, not usefully: 71.4% → 69.4%, and 80.0% in the
  second arm.
* **profitable-and-safe up — NO**: 20.0% → 14.3% → 12.0%. Seven events became
  seven out of a bigger denominator, then three.
* **pickups ≥ 20 — yes**, 49 and 25. Too many, then too few.
* **`deathsWhileDebuffed` 0 — yes**, in both arms.
* **deaths not above 21 — NO**, 25 in both, and the first arm brings back two
  `edge` deaths, the class D1's floor repair had cleared across the corpus.
* **potion-free classes byte-identical — YES.** `mixed`, `snakes`, `sparse`,
  seeds 1–3 at 30 turns, identical run summaries; `collectorsOf` gates the whole
  member.
* **Bound soundness — CLEAN.** Sixteen arms under `CENTAUR_DEBUG_INVERSION=1`
  (`mixed`/`snakes`/`sparse`/`potions` seeds 1–3 at 30 turns, plus `potions`
  seeds 4, 5, 6, 8 at 60) print no INVERSION line at all, and the six-suite gate
  passes 120 tests with no ratchet moved and no determinism fixture re-pinned.
  The rule is sound; it is simply not the repair.

**Reverted.** `window.ts` is a zero diff against the instrument state, and all
eight `potions` summaries come back byte-identical to the baseline.

## Why it fails, which is the part worth keeping

**The plan-conditioned ground collapses horizon 1 to a BOOLEAN and leaves the
saturated tail exactly where it was.** That is the finding, and it is the fourth
face of the same fact. The fixture is `potions` seed 4 turn 36
(`src/lobster/__tests__/tier-window.test.ts`), and note first what nobody had
said out loud about that board: **`(0,7)` and `(4,5)` are BOTH potion cells**, so
the top two candidates are two collecting plans that leave the collector in
different places — precisely the pair a per-plan reading exists to order. red-C
is a knight of weight 5 and settlement leaves it at tier −1:

    turn-start ground   3/9   34/34   73/73   →  peril = 0.667
    from (0,7)  played  0/1    5/5    21/21   →  peril = 0.500
    from (4,5)  other   0/1    9/9    41/41   →  peril = 0.500
    from (1,4)  clean   0/1    7/7    29/29   →  peril = 0.500

Three different grounds, of three different sizes, and **one number**. The two
saturated horizons D4 measured are still saturated from every arrival cell — by
the second turn every unit on an 11×11 board can meet every other — so they
contribute `(2 + 1)/6 = 0.5` whatever cell the plan picks. And horizon 1, which
was a share over nine cells and did discriminate, is now a boolean over one, and
the instrument says that boolean is false on 30 of 35 pickups. So the per-plan
peril takes exactly two values, 0.5 and 1.0, and on six pickups in seven it is
the constant 0.5.

Three consequences, and they are the whole A/B:

1. **It cannot order two collecting plans**, which was the entire hypothesis. On
   the reproduction it prices `(0,7)` and `(4,5)` identically, and it prices the
   NON-collecting `(1,4)` identically too. §P2 said the charge cancels because it
   is read from the turn-start cell; it turns out it also cancels when read from
   the plan, for a different reason — the discriminating horizon has one cell in
   it and the rest is saturated.
2. **It is a price CUT**, 0.667 → 0.500 at the reproduction and 0.225 → 0.143 in
   corpus mean horizon-1 terms. Cheaper potions mean more potions: 35 → 49, up on
   7 of 7 moving seeds. And the pickups a price cut admits are the marginal ones,
   which on this board are the reckless ones — 25 reckless became 34.
3. **Correcting the level does not recover the composition.** `PERIL_WEIGHT = 3`
   takes 49 back down to 25 and the reckless share goes UP to 80.0% while
   profitable-and-safe falls to 12.0%. Exactly as D4 and P2 found: the pickups a
   level change moves are the marginal ones by TOTAL score, and total score is
   not sorted by recklessness.

**The standing bound, now stated in its general form.** `peril` is
`Σ_k w_k · beaten_k / |ground_k|` over a window whose horizons 2..W are
saturated at 1 for every collector on every plan. Three attempts have now moved
each free part of that expression in turn — D4 the weights `w_k`, P2 the shape of
the share, P3 the set `ground_k` — and all three moved the level and left the
composition flat, because **the saturated tail is not a parameter of any of
them**. Half the reading is `1` by geometry, not by calibration, and no
reparameterisation of a term that averages over a saturated tail can widen what
it can say.

## What the next attempt should do differently, and what it must not repeat

1. **Do not re-parameterise `perilOf` again.** The weights, the share's shape and
   the ground are all measured now, over eight seeds and 24–63 pickups, and every
   one of them moved the level. A fourth reparameterisation is the same
   experiment.
2. **The tail has to go, or the term has to stop being a mean.** The one shape
   nobody has built is the floor `potions.md` D4 §2 and §P2 name: a term that
   fires on `beaten_1 > 0` at all rather than averaging it against horizons that
   are 1 by construction. On this corpus that is a boolean that is true on 25 of
   35 pickups from the turn-start ground and 5 of 35 from the plan's — those are
   two different rules and the instrument now measures both. It is a cliff and it
   wants the bounds bank's opinion before it is built.
3. **`reckless` and `peril` still disagree about what danger is,** and P3 makes
   the gap concrete rather than rhetorical: `reckless` is the collector's GROUND
   at horizon 1 (25 of 35), `arrivalBeaten` is its CELL (5 of 35). Whichever the
   term prices, the counter should price the same one, or the A/B is scoring a
   rule against a question it was not asked.
4. **Instrument the hypothesis before building the rule.** It cost one baseline
   run here and it said 5/35 — the answer this section then spent two arms
   confirming. It is the cheapest step in the whole procedure and it is the one
   the first three attempts skipped.

### What is kept

`arrivalBeaten`, `recklessArrivalBeaten` and the horizon-1 share sums stay in the
runner, for the reason `profitablePickups` stayed: they measure real properties
of the game, they cost nothing on a potion-free board, and they are the numbers
the next attempt has to move. The seed 4 turn 36 fixture stays too, and it is
written against the engine's own claims rather than against the member, so it
holds whatever the fold ships — including the fact that the top two candidates on
that board are both collecting plans, which is what makes it the right boundary
to measure a per-plan rule against.

---

# The fifth attempt: the gate and the escape floor — measured first, and still a price cut

`docs/design/potion-shape.md`. The fourth attempt's own closing instruction was
*do not re-parameterise `perilOf` a fifth time*, and this is not that: the study
measured all 35 pickups BEFORE naming a shape, found that the separating
quantity (`peril`, AUC 0.924) has all of its content at horizon 1, and proposed
the one shape that is not a scaling of the existing share — the saturated tail
DROPPED rather than reweighted, the discriminating horizon spent as a GATE, and
the gradient taken from a per-plan COUNT.

It is the first of the five arms whose rule demonstrably **reached the
decision**. It is also the worst of the five by every counter. Both facts are
the finding.

## The rule that was built

One knob `D`, `D = 0` the shipped term to the bit — verified: `potions` seeds
1–8 at 60 turns came back with every JSON field identical and seed 4's and seed
6's transcripts identical modulo the wall-clock `worstDecisionMs`.

    b1     = beaten_1 / |ground_1|        horizon 1 ONLY, turn-start ground
    gate   = min(1, b1 / 0.20)            0.20 is the measurement's own threshold
    escape = cells of the collector's one-turn claim FROM its arrival cell that
             the arrival turn's enemy field does not beat at the debuffed tier
    peril  = min(1, 5.08 · gate / (1 + escape))

`K = 5.08` is `median(peril_today) / median(gate/(1+escape))` over those 35
pickups — D4's "hold the mean cost of the corpus fixed" done literally.
`arrivalExits` is P3's construction at one horizon (`claimsAfter` of a board
whose only change is the collector's settled occupancy), memoised per
(collector, occupancy): one claim pass per key, half what P3 paid.

## What was measured

`potions`, 60 turns, seeds 1–8, `--nodes`, paired by seed
(`scripts/ab-compare.js`, per board class, never pooled), `D = 1`:

| arm | pickups | profitable | reckless | profitable AND safe | arrivalBeaten | ground1 share | deathsWhileDebuffed | deaths | unit-turns |
|---|---|---|---|---|---|---|---|---|---|
| BEFORE (`D = 0`) | 35 | 15 | 25 (**71.4%**) | 7 (**20.0%**) | 5 | 71/316 = 0.225 | 0 | 21 | 3124 |
| `D = 1` | **67** | 18 | 51 (**76.1%**) | 9 (**13.4%**) | 12 | 184/905 = 0.203 | **1** | **23** | 3083 |

Per seed the pickups go 5/7/4/8/1/3/2/5 → 5/15/5/8/7/8/7/12: up on 7 of the 8
seeds, flat on one, sign test **p = 0.070** — the identical signature D4 and P3
produced, and again the only clean result in the arm. The pre-registration was
profitable-and-safe **≥ 25%**, reckless **not above 71.4%**, pickups **28–42**,
`deathsWhileDebuffed` **0**, deaths **not above 21**, the potion-free classes
byte-identical, and the two board-level re-sorts. Scored honestly:

* **profitable-and-safe ≥ 25% — NO**, 20.0% → 13.4%. Nine events out of 67.
* **reckless not above 71.4% — NO**, 71.4% → 76.1%.
* **pickups 28–42 — NO**, 67. This was named "the sharpest test": the
  median-preserving calibration existed precisely to keep the count still while
  the composition moved, and the count nearly doubled. **The calibration is
  refuted directly.**
* **`deathsWhileDebuffed` 0 — NO**, one (seed 4), with one `deathsWhileBuffed`
  beside it.
* **deaths not above 21 — NO**, 23. No `edge` deaths: the causes are
  `contest` 18 → 20, `bodyBlock` 2 → 2, `self` 1 → 1.
* **potion-free classes byte-identical — YES.** `mixed`, `snakes`, `sparse` and
  `sparse-lean`, 60 turns seeds 1–3, are identical JSON on every field but
  `label`; `collectorsOf` gates the whole member.
* **Bound soundness — CLEAN.** Sixteen arms under `CENTAUR_DEBUG_INVERSION=1`
  print no INVERSION line, and the six-suite gate passes 121 tests with no
  ratchet moved and the determinism fixture not re-pinned.
* **The board-level predictions — HELD ON THE BOARDS, AND UNREACHABLE IN THE
  RUN.** See below; this is the part worth keeping.

**Reverted.** `window.ts` and `tier-window.test.ts` are a zero diff against the
working head, and all eight `potions` summaries come back byte-identical to the
baseline.

## Why it fails, which is the part worth keeping

### 1. The two board-level predictions both hold, and it changes nothing

Pinned as boundary tests on the runner's own boards and measured through the
member's own peril half, the shape does exactly what §3 of the study says:

    seed 6 t39   charge(5,8) − charge(2,5)  >  0.03, the fold's own margin
                 charge(5,8)                >  0.34, the gap to (1,6)
    seed 4 t36   charge(0,7) − charge(4,5)  >  0.04

All three pass. This is the first arm of the five to order two collecting plans
at all — P2 measured the charge identical on both, P3 measured it identical
again for a different reason, and this one separates them by more than the
margin, on both of the boards three previous attempts were sized against.

And in the live A/B **neither board occurs**. Both games diverge at **turn 2**,
long before turn 36 or turn 39, and by turn 36 red-C is at (5,6) on seed 4 and
by turn 39 red-A is dead on seed 6. The first differing line on both seeds is
the same one:

    before  T 2 blue-B queen (7,8)->(7,7)  top3: (7,7)=-30.95 (5,8)=-41.04 ...
    after   T 2 blue-B queen (7,8)->(7,7)  top3: (7,7)=-30.95 (5,8)=-40.76 ...

— a collecting candidate 0.28 fold units CHEAPER. **Reaching the decision was
never the binding constraint.** Three attempts diagnosed "the charge cancels, so
it cannot re-sort"; this one removed the cancellation, re-sorted both named
boards, and made every counter worse. The prescription those attempts closed on
is now measured and it is not the repair either.

### 2. Deleting the saturated tail is the biggest price cut yet, and the gate aims it at the wrong population

The shipped term's floor is the tail: with `beaten_2 = beaten_3 = 1` every
pickup costs at least `(2 + 1)/6 = 0.5`, i.e. `4 × 0.5 / |ours|` fold units,
whatever its horizon 1 says. The gated shape charges **zero** whenever
`b1 = 0` — and `b1 = 0` on 12 of the baseline's 35 pickups. So the one thing
restraining every clean-horizon-1 pickup was removed outright. Three arms have
now moved the tail and the size of the pickup rise tracks how much of it they
removed:

| arm | what it did to the tail | pickups |
|---|---|---|
| D4 `λ = 1/4` | reweighted it from 0.5 to 0.238 | 39 → 63 |
| P3 `α = 1` | replaced the ground; tail still 0.5, horizon 1 collapsed to a boolean | 35 → 49 |
| **this** | **deleted it** | **35 → 67** |

`K` was supposed to prevent exactly this, and it is worth being precise about
why it did not. `K` holds the median charge fixed **over the pickups the
baseline took**. The fold does not choose among pickups; it chooses among
PLANS, and the plans it declined are not in that sample. Holding the median of
the accepted set fixed while sending a third of it to zero necessarily raises
the acceptance rate — the distribution `K` was calibrated on is the output of
the very decision the knob changes.

### 3. A quantity that separates the pickups a bot TOOK does not separate the pickups it was OFFERED

This is the new finding, and it is the general form of §2. The study's AUC of
0.924 is measured on 35 accepted pickups, labelled good or bad after the fact.
It is a statement about a *selected* sample. The rule is applied to every
candidate plan on every node, and the counters say what that reweighting did to
the population: the corpus mean horizon-1 beaten share moves 0.225 → **0.203**,
about a tenth, while the count moves 35 → **67**, about a double. The
composition is flat and the level moved — the same sentence D4, P2 and P3 all
end on, now reached by a rule that provably re-sorts individual boards.

`arrivalBeaten` went 5 → 12 and `recklessArrivalBeaten` 5 → 12, so every one of
the extra arrival-beaten pickups is reckless too: the pickups the price cut
admitted are the exposed ones, for the fourth time in four arms.

## What the next attempt should do differently

**Nothing. Leave the member alone until the game changes.** Five shapes have now
been measured on this corpus — the level (`PERIL_WEIGHT`), the horizon weights
(D4), the share's shape (P2), the ground (P3), and now a rule that is not a
reparameterisation at all — and all five moved the count and left the
composition flat. The member is sound, it is free on the three potion-free board
classes, it costs no lives at `D = 0` (`deathsWhileDebuffed` 0 across 480 turns
and 35 pickups), and the study's own §2 proves the target was never reachable:
six of the seventeen bad pickups stand 9.8 to 88.8 fold units clear of any
non-collecting candidate and cannot be refused by a member whose whole range is
1.33 fold units, and refusing every refusable bad pickup still leaves reckless
at 44.4% against the 40% two arms were scored on.

The cheapest next step is not a member and not a knob. It is **more board**:
twenty seeds, or a scenario with more potions and more units, so that a shift of
four or five events is resolvable at all. That is the third item of the second
attempt's own "what the next attempt should look at", it is still untried after
five arms, and it is the only change that would make any of these numbers
decidable. Until then, a sixth arm is a sixth measurement of the same 35 events.
