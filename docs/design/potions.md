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

### Bound inversions: pre-existing on this board

The `potions` scenario inverts the bank's floor against its ceiling with the
member OFF: 875 `ScoreBounds` inversions on seed 7 over seeds 1–10, 60 turns.
With the member ON the same sweep gives 103 (26 on seed 5, 77 on seed 8, none
elsewhere). So inversions are a property of this board rather than of this term
— it moves which trajectories reach them, and over ten seeds it reaches them
less. That latent unsoundness is somewhere else and is not this member's to fix,
but it is written down here because "zero inversions" is not a gate the
`potions` scenario can currently pass in either arm.

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
