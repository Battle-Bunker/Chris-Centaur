# Basic intelligence: what the bot was doing wrong, and how it was found

Every validation this bot had before this pass was RELATIVE — arm A against
arm B, scored on a paired margin over many games. That answers "which of these
two is better" and says nothing whatsoever about whether either of them is
sane. It was possible, and it turned out to be true, for both arms of every
experiment to share a defect that makes the bot look idiotic to a human
watching one game.

So this pass is built on watching games. `src/tests/local-game.ts` runs the
SHIPPED decision path — the same substrate, candidate generator, evaluator,
search core and kernel that `team-decision-engine.ts` assembles, minus the
Firebase wire — against the vendored rules (`engine-vendor/engine/resolveTurn`),
and prints one line per unit per turn: where it stood, where it staged, and the
three best-scoring options with the number the evaluator gave each.

    npx tsc && node dist/tests/local-game.js <scenario> <turns> <seed> <budgetMs>

Scenarios: `snakes` (6 snakes, 6 meals, 11x11 — food-rich), `mixed` (snakes +
pawn + knight + queen, 3 teams), `sparse` (4 snakes, 2 meals, 13x13 — the
starvation board, where a bot with no food gradient dies of old age).

The assertions live in `src/tests/basic-intelligence.test.ts`, which reads the
same counters.

---

## Diagnosis (traces of 2026-09-02, before any fix)

### Confirmed

**1. No food gradient anywhere in the objective.** `DEFAULT_WEIGHTS`
(`src/lobster/evaluate/calibration.ts:47`) has no food term, and the profile
docstring says so outright: "No food weight on territory: measured worthless at
the sound floor". The only food signal in the whole decision is
`AssessedCandidate.foodGain` (`src/lobster/candidates.ts:790-795`), a 0/1 flag
on whether a move's LANDING cell holds food, read by the candidate ORDERING key
(`gainOrderKey`, `src/lobster/candidates.ts:1176`) and by nothing that scores.
So food exerts a pull over exactly one cell of distance and none beyond it.

On the `sparse` board this is fatal, literally:

    turn 8  food: (6,6) (8,0)
      T  8 red-A  snake hp 93 (5,4)->(5,5)  top3: (5,3)=41.41 (6,4)=41.40 (5,5)=41.40

The unit stands two cells from a meal at (6,6). Its three best options span
0.01 of evaluator score; the best-ranked of them, (5,3), walks AWAY from the
food. The choice among them is noise. Over 100 turns the four snakes on that
board ate 3 meals in 361 unit-turns (0.83 per 100), one starved to death, and
the survivors ended on 26 health.

**2. Pieces have no positional gradient at all.** `command` is weighted 0 in
`DEFAULT_WEIGHTS` (`calibration.ts:76`); `room` is plane-1 only, so it is
identically zero for a unit that leaves no trail; and `reach`'s plane-2
displacement set saturates for anything faster than a snake (the analysis is
already written down in `calibration.ts`, under THE SLIDER REPAIR). The
consequence is not subtle — every option a piece has scores THE SAME:

    T  5 blue-C  pawn   hp100 (10,10)->(10,10)  top3: (9,10)=40.64 (10,10)=40.64 (11,10)=40.64
    T  6 blue-C  pawn   hp100 (10,10)->(10,10)  top3: (9,10)=60.67 (10,10)=60.67 (11,10)=60.67

Identical to two decimals, every turn. The pawn's three options are "rotate
left", "hold" and "rotate right" — under the rules a pawn's side square is a
rotation, not a step (`engine-vendor/engine/moveGrammar.ts:198-215`) — so the
pawn spends the whole game turning on the spot. This is the owner's "a pawn
reversed direction every turn for ~8 turns", exactly:

    T  1 red-B  pawn hp100 (2,1)->(1,1)   <- rotate left
    T  2 red-B  pawn hp100 (2,1)->(1,1)
    T  3 red-B  pawn hp100 (2,1)->(1,2)   <- rotate the other way
    T  4 red-B  pawn hp100 (2,1)->(1,1)   <- and back
    T  5 red-B  pawn hp100 (2,1)->(1,1)
    T  6 red-B  pawn hp100 (2,1)->(2,2)   <- and away again; never advanced a square

Knights do the same thing in the "hold" direction: `red-C` held (0,0) for three
turns and then (1,2) for three more. Across the `mixed` board 22.7% of all
unit-turns ended where they began.

The profile that fixes this — `TERRITORY_SLIDER_PROFILE`, alias
`lobster-territory-x`, `command: 2` plus `healthReserveRatio` — was already
written, already measured, and was NOT the seated default.

**3. Nothing prefers continuity, and the tie-break is joint.** When scores tie,
`SearchCore.better` falls through to `planTieKey(plan, cfg.seed)`
(`src/lobster/search/core.ts:420`), which hashes the WHOLE joint plan
(`src/lobster/search/order.ts:35`). So a teammate moving one square re-rolls the
tie-break for every other unit whose options are tied — which, per (2), is every
piece on the board, every turn. That is the dither engine. Nothing anywhere
penalises undoing last turn's move.

**4. The search horizon is always 1.** `kernel.ts:1393` reads
`run.lastView?.horizon ?? 1`; `run.lastView` is only ever assigned inside
`if (run.refiner !== null)` (`kernel.ts:1091-1093`), and `run.refiner` is
`asRefiner(input.search)` (`kernel.ts:878`) over whatever `makeSearchCore`
returns — which is a plain `SearchCore` and not a `Refiner`. So in production
the VOC lever machinery never runs and every recorded decision is horizon 1.

This is NOT fixed here, and that is a deliberate scope call: a horizon-1
decision with an evaluator that can see food and can see a piece's activity is
a sane bot, and it is a stable one. Engaging depth is a much larger change with
its own risk surface. What horizon 1 makes non-negotiable is that the EVALUATOR
carry the gradient, which is what (1) and (2) are about.

### Refuted on this branch

**Production binding.** There is no `DEFAULT_BOT_CONFIG` and no `bot` field on
`primary`; the engine is selected by `CENTAUR_ENGINE` (default `lobster`,
`src/config/centaur-engine.ts:103`) and the objective by `defaultEvaluator`
(`src/lobster/evaluate/index.ts`), which is the profile named by
`DEFAULT_PROFILE`. The live process therefore plays `DEFAULT_PROFILE`, and the
fix for (2) is to make `DEFAULT_PROFILE` the sane profile — which is what was
done.

**`botConfigFromJson` key-checking.** No such function exists on `primary`;
there is no JSON bot-config surface to validate. Nothing to fix.

### Noted, not fixed

**`captureRank` is weight-blind** (`src/lobster/candidates.ts:1129`): a queen
capture and a snake capture both rank 2. It is an ORDERING key only — the
evaluator prices the material either way — so it changes which move the anytime
path reaches first, not which move is chosen when both are reached. Left alone:
correcting it needs the victim's weight threaded out of the risk verdict, which
is real surgery for a term that does not move any of the gates below.

**Certain-self-fatal moves are not pruned on snake-only boards.**
`resolveStagingSafety('auto', hasPiece=false)` resolves to `off`
(`src/lobster/staging-safety.ts:189`) on the recorded verdict that the prune
measured HARMFUL on snake-only rosters. Walking into the perimeter is therefore
still an option the generator offers and assesses `safe`. It is only ever taken
when every option ties — see the gates below for what that costs after the
fixes, and `src/tests/basic-intelligence.test.ts` for the assertion that keeps
it near zero.

---

## The fixes

All of them are ordinary members of the existing structures — a feature in the
feature list, weights in the calibration table, a comparator in the search
ordering, a constant in the staging rule. There are no flags: the corrected
values ARE the configuration, and what they replaced is deleted.

| # | Fix | Where |
|---|-----|-------|
| 1 | `food` — a real first-arrival distance gradient to the nearest reachable meal, hunger-scaled | `src/lobster/evaluate/food.ts`, seated in `FEATURES` (`features.ts:924`) |
| 2 | `momentum` — a penalty for landing on the cell the unit came from, and half of one for a stay-legal unit that ends the turn where it began | `src/lobster/evaluate/momentum.ts` |
| 3 | The slider repair seated: `DEFAULT_PROFILE` carries `command: 2` and `healthReserveRatio`; `TERRITORY_SLIDER_PROFILE` is deleted | `src/lobster/evaluate/calibration.ts:76,247-262` |
| 4 | `planTieKey` sums per-candidate keys instead of hashing the joined plan | `src/lobster/search/order.ts:34-56` |
| 5 | `DEFAULT_SWITCH_MARGIN` 5 → 0.01 | `src/lobster/voc.ts:249-283` |
| 6 | The certain-self-fatal TIER CORRECTION is unconditional; only the PRUNE stays flag-gated | `src/lobster/candidates.ts:517-537` |
| 7 | `BoundEvaluator` refuses a profile whose weights do not name exactly the features it folds | `src/lobster/evaluate/index.ts` (`checkWeights`) |

### Fix 5 is the one that mattered most, and it was not in the audit

The first four changes made almost no difference on their own, and the traces
said why: the chosen move was the generator's ordered-first candidate — the
SEED — in 80% of a recorded game's decisions, whatever the evaluator said. The
cause is `StickyStager.stage`: the staged plan only changes when the leader's
proved floor beats the incumbent's by `DEFAULT_SWITCH_MARGIN`, and that was
FIVE. Material is ten per unit of weight; the whole positional vocabulary —
`reach`, `room`, `command`, `food`, `momentum`, `healthEconomy` — spans about
four at its widest. So no positional fact was ever worth restaging, and the bot
played `seedPlan`'s first pick until half a unit of material changed hands.
`seedPlan`'s last tie-break is ascending destination index, which for a trail
unit is `up` — which is exactly what a snake marching in a straight line past
the food looks like.

The margin's stated justification is a defence against "≤4-point h=1
refutations that reversed at h=2". Confirmed defect 4 above says this build
never leaves h=1, so that case cannot arise. The margin's remaining job is to
refuse a switch worth nothing; exact ties are already refused by the strict
`>`, so a thousandth of the lightest unit's material does that job and leaves
every distinction the profile can draw available.

Here is the same position before and after, with the bank's own proved floor
alongside `est` (the trace prints `floor|est`, and `[seed]` marks a decision
that kept the generator's first option):

    BEFORE   T  9 blue-A snake hp92 (8,6)->(8,7) [seed]  top3: (7,6)=1.44|17.59 (8,7)=1.33|17.49 ...
    AFTER    T  9 blue-A snake hp92 (8,6)->(7,6)         top3: (7,6)=1.45|17.60 (8,7)=1.35|17.50 ...
    AFTER    T 10 blue-A snake hp91 (7,6)->(6,6) [seed]  top3: (6,6)=1.57|22.72 (7,7)=-8.57|12.57 ...
             ATE red-A, blue-A

(6,6) is the meal. Before, the floor-best option was available, was not pruned,
was priced correctly, and was refused by the margin; the unit walked north for
another twenty turns.

### Why fix 6 is the ordering half only

`certainlySelfFatal` is the pre-filter the risk layer's own header says it
assumes: the perimeter is terrain and our own bodies carry no claim slot, so
both come back `NO_RISK` and a wall move is assessed `safe`. The assessment was
gated on the same knob as the prune, which contradicted its own comment ("the
danger ORDER is right even with the prune knob off"). A `safe`-assessed wall
move then won the last tie-break and became the seed. Making the correction
unconditional removes nothing from the option set — so none of the team-level
coherence the prune was measured to break is at stake — and it moved wall deaths
across the three scenarios from 6 to 1, with the surviving one in a position
where every option was fatal. Self-kills fell 3 → 0 in the same comparison.

---

## Gate results

Everything below is `src/tests/local-game.ts`, three seeds of sixty turns per
scenario at a 150 ms decision budget, BEFORE against AFTER, where BEFORE is
`origin/primary` built in a worktree with the same runner dropped into it — so
the only difference between the columns is the bot. `sparse` is also run to a
hundred turns, because a snake starts on a hundred health and loses one per
cell, so starvation is not even reachable in sixty.

| board | metric | before | after |
|---|---|---|---|
| snakes | meals per 100 unit-turns | 7.70 | **15.25** |
| snakes | wall deaths | 3 | **0** |
| snakes | self-collision deaths | 3 | **0** |
| sparse (60t) | meals per 100 unit-turns | 1.58 | **4.85** |
| sparse (100t) | meals per 100 unit-turns | 1.55 | **3.63** |
| sparse (100t) | starvation deaths | 1 | **0** |
| sparse (100t) | unit-turns survived, 2 seeds | 515 | **800** |
| mixed | meals per 100 unit-turns | 13.82 | **23.14** |
| mixed | unit-turns ending where they began | 21.2% | **3.1%** |
| mixed | dithers (didn't move, restaged elsewhere) | 1.92% | **0.35%** |
| any | decisions that just kept the seed | 75.3% (mixed) | **41.7%** |
| any | worst single decision, 150 ms budget | 144 ms | 137 ms |

### (a) snakes reach food, and nothing starves beside it

Two of the four snakes on the sparse board, walking to the two meals on it and
eating them. `blue-A` from (8,2), `red-B` from (5,9); the trace prints
`floor|est` per option and `[seed]` when the chosen move is the generator's
first:

    turn 7  food: (6,6) (8,0)
      T  7 blue-A snake hp 94 (8,2)->(8,1)         top3: (8,1)=-9.52|27.04 (7,2)=-9.54|27.02 ...
      T  7 red-B  snake hp 98 (5,9)->(6,9) [seed]  top3: (6,9)=10.59|41.59 (5,8)=10.45|41.98 ...
    turn 8
      T  8 blue-A snake hp 93 (8,1)->(8,0) [seed]  top3: (8,0)=0.54|37.09 (7,1)=-9.52|27.04 ...
      T  8 red-B  snake hp 97 (6,9)->(6,8) [seed]  top3: (6,8)=0.65|36.63 (6,10)=0.48|37.00 ...
      ATE blue-A
    turn 9
      T  9 red-B  snake hp 96 (6,8)->(6,7) [seed]  top3: (6,7)=0.66|36.63 (5,8)=0.00|36.52 ...
    turn 10
      T 10 red-B  snake hp 95 (6,7)->(6,6)         top3: (6,6)=10.74|16.21 (5,7)=-9.92|31.58 ...
      ATE red-B

Four consecutive turns of a straight walk down a file to a meal, each one the
floor-best option. Compare the same board before: 0.01 of score between three
options, the best of them walking away, and the unit still on the far side of
the board twenty turns later.

Starvation on the hundred-turn sparse board is zero, against one before, and
the surviving population is 800 unit-turns against 515.

### (b) reversals are rare, and the rare ones have a reason

Snake boards: 0.00% of unit-turns are reversals. The mixed board runs
2.0–4.2% — pieces reverse, snakes structurally cannot (their own neck kills
them). Of those, the ones that are not even the best move by the bank's own
proved floor — the ones with no scoring reason, which is what the gate is
actually about — are 0.0–0.4% of unit-turns across three seeds. A reversal the
search can justify is a retreat, and a bot that cannot retreat is worse, not
better. Dithers (did not move, and restaged somewhere other than last turn)
fell 1.92% → 0.35%.

### (c) nothing walks into avoidable death

Wall deaths on the snake boards went 3 → 0 and self-collisions 3 → 0. Across
every game recorded for this document, exactly two wall deaths remain, and both
are positions with no survivable option at all:

    T100 blue-B snake hp  1 (0,3)->(-1,3)  top3: (-1,3)=-68.44|-7.40 (1,3)=-68.44|-7.40 (0,4)=-Infinity|-Infinity
    DEATH blue-B (wall)  body was (0,3)(1,3)(1,4)

Health 1: every move costs a point, so the unit is dead on any of them, and the
one non-wall square left is the cell its own teammate is moving into. The floor
agrees — it is identical for the wall and for the alternative.

The safety floor DOES fire everywhere it can: the remaining deaths in these
games are contests and body-blocks, which are other units' doing, not the
mover walking into a certainty.

### (d) pieces act

Five turns of the mixed board's pieces, seed 3. A pawn marching, a knight
ranging, a queen taking the long diagonals:

    T  1 blue-C pawn   (10,10)->(9,10)    T  1 green-B knight (5,10)->(7,9)   T  1 blue-B queen (8,9)->(8,2)
    T  2 blue-C pawn    (9,10)->(8,10)    T  2 green-B knight  (7,9)->(5,8)   T  2 blue-B queen (8,2)->(5,5)
    T  3 blue-C pawn    (8,10)->(7,10)    T  3 green-B knight  (5,8)->(3,9)   T  3 blue-B queen (5,5)->(7,7)
    T  4 blue-C pawn    (7,10)->(6,10)    T  4 green-B knight  (3,9)->(4,7)   T  4 blue-B queen (7,7)->(7,0)
    T  5 blue-C pawn    (6,10)->(5,10)    T  5 green-B knight  (4,7)->(2,6)   T  5 blue-B queen (7,0)->(2,0)

Against the same five turns before the fixes, where `blue-C` staged
(9,10), (10,10), (11,10), (11,10), (10,10) from (10,10) and never left the
square.

One fixture correction belongs in this section rather than in the fix list,
because it was the RUNNER and not the bot: `local-game.ts` originally spawned
every unit facing the board centre as a raw vector, which is a DIAGONAL from a
corner. A pawn with a diagonal orientation has a diagonal forward step and two
diagonal side squares — it is not a pawn, and the corner pawns in the earliest
traces were stuck partly because of it. Spawn orientation is now projected onto
one orthogonal, which is what `spawnOrientationCandidates` does in the rules.

### (e) full games complete

100-turn, three-team games at a 150 ms budget: no crashes, no thrown decisions,
worst single decision 137 ms against a 150 ms budget (the kernel reserves 40 ms
of it for the final flush). `src/tests/basic-intelligence.test.ts` runs one of
these on every test run.

---

## What is still wrong

**The horizon is still 1.** Nothing here engages depth, on purpose — see
confirmed defect 4. If it is ever engaged, `DEFAULT_SWITCH_MARGIN` should be
revisited at the same time: its original justification was specifically about
h=1 readings that reverse at h=2, and that argument becomes live again.

**`captureRank` is still weight-blind.** An ordering key only, and the
evaluator prices the material either way; see the diagnosis.

**The certain-self-fatal PRUNE is still off on snake-only boards.** Only the
ordering half was made unconditional. The recorded verdict against the prune
was measured on a build whose staged move was the seed, which is the very thing
fix 5 changed, so that verdict is now of unknown standing — it should be
re-measured rather than assumed either way.

**Contests are the remaining death cause**, and a large one on the mixed board
(14 of 16 deaths). Two mirror-symmetric bots walking into the same square is a
genuinely hard problem for a floor-adjudicated search.

---

## The first member of contest avoidance

`contest` (`src/lobster/evaluate/contest.ts`, weight 3 in `DEFAULT_WEIGHTS`) is
the cheap half of that problem: a unit is charged for ending the turn on a cell
an enemy could also end its turn on and would not lose there. The rule it
prices is `turnEngine`'s arrival tier — the cell goes to the unique strict
maximum on frozen tier then frozen weight — so equal-or-heavier kills us and
equal weight kills us both, which is where the "equal-or-heavier" test comes
from. The enemy's reach is the engine's own move enumerator over the turn-start
board, run once per decision and cached; the feature itself is one array read
per unit of ours.

Ten seeds x 100 turns at a 150 ms budget, the same build with the weight at
zero against the weight at three, per board class and never pooled:

    mixed    contest deaths  47 -> 37     all deaths 54 -> 45   meals/100 27.5 -> 24.5
             dither 0.40% -> 0.27%        starvation 0 -> 0     unit-turns 4042 -> 5188
    snakes   contest deaths  15 ->  7     all deaths 43 -> 43   meals/100 12.8 -> 13.7
             dither 0.00% -> 0.00%        starvation 0 -> 0     unit-turns 3155 -> 3375

Unit-turns are an OUTCOME here, not a denominator the arms share: units that
stop dying keep playing. Per hundred unit-turns the contest death rate falls
39% on `mixed` and 56% on `snakes`. On `snakes` the total is a wash — body
blocks went 19 -> 23 and self-collisions 6 -> 8 as the snakes that survived
grew longer — so what this member bought there is length and meals, not fewer
funerals. That is the honest reading and it is why this is the FIRST member and
not the last: nothing here helps two units that must cross the same square, and
nothing here coordinates our own team.

The weight is 3 rather than anything measured to a tenth: it clears `momentum`
(1) and the spread of `reach` and `room` over one unit's own options, and it
sits under `food` (4), whose pull reaches 1 for a starving unit — so a hungry
unit still takes a contested meal and a healthy one declines it. Weights of 2
and 5 were both watched over five seeds; 2 is inert on contests and 5 buys
nothing 3 does not.
