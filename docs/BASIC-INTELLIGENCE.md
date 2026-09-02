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

All four are ordinary members of the existing structures — a feature in the
feature list, weights in the calibration table, a comparator in the search
ordering. There are no flags: the corrected values ARE the configuration.

| # | Fix | Where |
|---|-----|-------|
| 1 | `food` feature: a real first-arrival distance gradient to the nearest reachable meal, hunger-scaled | `src/lobster/evaluate/food.ts`, seated in `FEATURES` |
| 2 | `momentum` feature: a small penalty for landing on the cell the unit came from, and for a piece declining to act while it has somewhere to be | `src/lobster/evaluate/momentum.ts` |
| 3 | The slider repair seated: `DEFAULT_PROFILE` now carries `command: 2` and `healthReserveRatio` | `src/lobster/evaluate/calibration.ts` |
| 4 | `planTieKey` is a SUM of per-candidate keys, so a teammate's move can no longer re-roll this unit's tie-break | `src/lobster/search/order.ts` |

## Gate results

See `GATES.md` section below — filled in after the fixes.
