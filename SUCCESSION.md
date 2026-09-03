# SUCCESSION — orchestrator handoff (written 2026-09-02, end of design session)

## Addendum, 2026-09-03 (read this block first; it supersedes the one below where they differ)

Branch `claude/succession-doc-subagent-orchestration-n41iua` on BOTH repos is
the working branch; draft PRs Chris-Centaur#17 and TacticToes#24 target
`develop` (the default). Nothing goes to `develop` or `main` directly.

WHAT IS TRUE NOW
- ONE engine. `functions/src/gameprocessors/engine/` in TacticToes runs the
  whole turn (settleTurn: grammar, traversal, contests, food, effects, tiers,
  orientation, promotion, adjudication, spawning behind an injected Spawner)
  and partial advance as a MODE (computeClaims + settlePartial with a typed
  Divergence ledger: heldId always a held unit, `via` chain, kinds incl.
  regicide keyed to the king, contest-after-sever, grammar for a vacated
  square; ResolveTurnInput.presence for staging legality). Soundness by
  enumeration (~219k worlds). Vendored byte-for-byte into
  `src/engine-vendor/` by `scripts/sync-engine.js`; VENDOR.md's exclusion
  list is board-building before turn 1, ranking policy, the wire.
- The bot has NO rules mirror: `src/partial-engine/` (orphaned second
  engine), the legacy decision path (decision-engine, voronoi-strategy,
  simulator, board-graph, piece-moves, piece-threats, ...) and the
  CENTAUR_ENGINE switch are deleted. One seam: `src/lobster/substrate.ts`
  (EngineSubstrate) + `pathrisk.ts` + `bounds/{material,ledger}.ts`.
  Plan: docs/design/ONE-ENGINE-PLAN.md.
- Health is ENERGY everywhere (wire: playerEnergy, maxEnergyPerUnit,
  foodEnergy; a meal adds foodEnergy, growth only on a full tank).
- The DECISION LENS is built (docs/design/decision-lens/00-07): kernel lens
  port (clusters = components of the occupancy-reach graph over free units;
  reservoir at the better() call site; rankConditional == what a lock
  stages; inspection reserve with typed refusals), storage (turn_boards,
  turn_events, decisions, movesets projection with `npm run lens:rebuild`
  / `lens:check`, unit_outcomes; owner runs `npm run db:push`; old
  decision_logs/turn_states/command_* tables dropped), UI (one view-model
  live and replay, cursor machine, panels, timeline lane; `npm run
  build:lens`). Gates: lens-replay-parity, lens-inspection-cost, G1/G2.
- Runner: `node dist/tests/local-game.js <mixed|snakes|sparse|potions> 30
  <seed> --nodes --json=F` is DETERMINISTIC (work clock); `scripts/
  ab-compare.js A B` pairs by (scenario, seed), never pools across boards.
  `CENTAUR_DEBUG_INVERSION=1` prints bound inversions (must be 0).
  basic-intelligence.test.ts runs on a node budget now.
- Members seated in the fold: material, reach, room, command (two boards
  per reading), food, momentum, contest, tier, energy. Potion term measured
  and DELETED (docs/design/potions.md); entrapment recorded not seated.
- feature/decision-lens: design docs (merged onto the working branch).
  feature/drives-preferences: design (docs/design/drives/00,01): the call is
  to re-express goto/near/manual/hold/pins as drives under the same keys;
  parked until the seam settles on develop. Known defect it found: under
  lobster a snake's goto applies weight 300 through absent breakdown keys.

NEXT, IN ORDER
1. Owner reads the two 30-turn transcripts and PR#17; land TacticToes#24
   first (the bot's vendored engine is at its head), then #17, run db:push.
2. Depth: horizon is 1 in 100% of decisions (06-LOOKAHEAD.md findings F-1..
   F-9): the search core is not a Refiner, DEFAULT_SWITCH_MARGIN expires with
   depth, est compared across horizons unguarded, no turn cap, terminal
   member half-seated. Fix in that order before turning depth on; the lens
   rows already carry the depth fields.
3. Entrapment: needs a horizon (room's shells go permissive after turn 1).
4. Potions: the profitable-pickups instrument exists; the member must change
   WHICH pickups, not how many.
5. Drives: rebase feature/drives-preferences onto develop after #17 lands;
   fold the goto fix in first.

PROCESS THAT HELD
- Opus subagents in git worktrees, one owner per file set, final report
  only; orchestrator merges and gates. Container restarts kill workers:
  every worker commits checkpoints and pushes its sub-branch after each
  commit. Monthly spend limit can kill a wave; checkpoint WIP before
  relaunching. Reports are honest by instruction: regressions are reported,
  never tuned away; a member that does not earn its place is deleted.

## What `develop` is

`develop` (= old `primary` + the basic-intelligence merge, commit 2769477)
is the branch the owner tests. It carries the ONLY code shipped this
session: the fix that made the bot behave sanely in live play.

Root cause of the observed idiocy (all verified, docs/BASIC-INTELLIGENCE.md):
`DEFAULT_SWITCH_MARGIN=5` meant no positional fact could ever restage a
move (75% of decisions played the seed plan, whose last tie-break is
ascending destination index = straight-line marching); there was NO food
term in the objective; pieces had no positional gradient (command:0);
the joint tie-key re-rolled every tied unit when a teammate moved (pawn
oscillation). Fixed: margin 0.01, hunger-scaled food flood, hysteresis
(momentum.ts), command:2 seated, decomposable tie-key, profile validation
(checkWeights), unconditional self-fatal tier correction. Gates were
BEHAVIORAL (watch games): meals/100 up ~2x, wall/self deaths 0, dither
0.35%, no starvation, 100-turn games clean at budget.

Known limits of develop: horizon is still 1 (deliberate; if depth is ever
engaged, revisit DEFAULT_SWITCH_MARGIN first — its old value existed for
h1-vs-h2 reversals); captureRank is weight-blind (queen capture ranks =
snake capture); CONTESTS are now the dominant death cause (mirror bots
picking the same square); one pre-existing test failure:
engine-vendor-sync (upstream TacticToes added maxTurns — do the small
vendored-rules re-sync).

## What develop does NOT contain

~95% of this session's output is DESIGN, not code, on these branches
(each has a consolidated entry doc; some have SUCCESSION.md too):

| branch | entry doc | one line |
|---|---|---|
| design/joints-composition | docs/design/joints/07-SYNTHESIS.md (+34-BUILD-ORDER, 19-ENGINE-SPEC) | the manifest/joints architecture; consolidated build order; engine re-cut E1-E7 |
| design/search-theory | docs/design/search/05-SYNTHESIS.md (+10-CANDIDATE-LIFECYCLE) | five search joints; pure-saddle result; candidate-lifecycle protocol |
| design/belief-fog | docs/design/belief-fog/04-SYNTHESIS.md | (S,w) epistemic object; fog programme; supplier measurements |
| design/time-interruption | docs/design/time-SYNTHESIS.md | determinations/quanta; ponder/re-base; CPP curves (snake saturates 500ms, queen climbs past 4s) |
| design/value-evaluation | SYNTHESIS.md | flow fold (policy-invariant, interior-complete); terminal boundary member; population instruments |
| design/prior-art | docs/design/prior-art/README.md + 19-per-lens-rollup.md | 46-domain survey; laws R-1..R-14; the one-index |
| design/red-team | docs/design/red-team/RED-TEAM*.md | 4 adjudication rounds; expressiveness test; standing demands |
| design/operator-guidance | (partial) | ruling 51 inbound: drives/preferences factoring vs Snek Centaur Platform |
| design/operator-signals | (partial) | ruling 51 outbound: bot→human signal API |
| coordination | continuous/synthesis-pins.md, experiment-queue-main.md, STATE.md | rulings, verdicts, queued instruments |

## Top avenues, ranked by nearness-to-fruition x value

1. CONTEST AVOIDANCE (immediate strength on develop): the dominant
   remaining death cause. Cheap first member: avoid squares an equal-or-
   heavier enemy head can also reach this turn unless the trade wins by
   weight (the fold prices this). Small evaluator/ordering term.
2. WEIGHT-AWARE CAPTURES + basic piece tactics: thread victim weight into
   captureRank; pieces should prefer 31-weight captures over 2-weight.
   One term, big piece-IQ gain.
3. ENGINE RE-CUT E1-E2 (the potion keystone): 19-ENGINE-SPEC.md is
   builder-ready, byte-identical migrations with gates. E2 makes `tier`
   an output of settlement, WITHOUT WHICH A 3-TURN POTION PLAN IS
   UNMODELLABLE AT ANY BUDGET. This is the gate to all potion strategy;
   candidates.potionOrdering already works (+55% pickups, free) and is
   the only potion lever validated in play. k5 verdict stands (potions
   don't pay in bot-vs-bot) but was measured potion-BLIND at plan level;
   re-test after E2 on a fat-account board (queued).
4. OPERATOR INTERFACE (ruling 51 — the Centaur product): the two
   operator branches are partial but the raw material is mostly designed
   elsewhere: the SET-VALUED REDUCTION (options + the condition under
   which each dominates = the threat/opportunity map, already computed
   and discarded at the first comparison — the collapse belongs at the
   emission barrier), per-unit FLOWS as the causal vocabulary (never
   summed before caching), contrastive foils (runner-up, deciding rung,
   margin — one column, three consumers), the ADVICE kind (submodular
   selection under an attention budget; attention is a currency with NO
   exchange rate to ms), drives-as-carried-premises (goal=target+
   completion; near=target, no completion — the owner's factoring seed),
   and the Snek Centaur Platform repo (cyphid-academy/snek-centaur-platform)
   as the wire target. Sacrifice: a pinned sacrifice ALREADY PLAYS
   (matchPin consults the prunedLedger); the wall is disclosure — the
   ADVICE warrant member must buy a DEEP line, not a 1-ply price.
5. FREE INSTRUMENTS before any further tuning (all zero-game, queued in
   experiment-queue-main.md): margin-at-deciding-rung column (gates the
   fund-ponder-vs-fix-evaluator call), coverage oracle, maxGap-vs-time
   curves, per-cell VBS-SBS on the cyclic triples (may reverse "selection
   has no headroom"), pentanomial paired scoring, Nash/cyclicity re-runs.
6. MEASUREMENT ADDRESSING M1/M2 (botId on reports + re-key script):
   "worth doing whatever happens" — answers "which bot produced this
   number", the question that invalidated earlier potion measurements.

## Process lessons (cost + epistemics — bind your successors)

- BEHAVIOR FIRST: bot-vs-bot statistics measured relative differences
  among equally-broken bots for weeks while the bot circled to death in
  live play. The merge bar is now WATCHING GAMES (local-game.ts runner:
  `npx tsc && node dist/tests/local-game.js mixed 30 1 150`), with
  aggregate stats as support only. Owner ruling.
- COST: never resume a completed agent (cold transcript re-read at full
  price — one wave of nine cost $60); successors are NEW agents briefed
  from branch docs. No fable-class subagents. Subagents never message
  the orchestrator mid-work — final report only. Orchestrator reads
  minimally (ruling 52).
- EPISTEMIC RULES that repeatedly paid: pre-register predictions before
  running; assert conservation inside the extraction; check bounded
  statistics against their own bounds (ceiling AND floor); plausibility
  check before statistics; ask a number's limit as effect→0 before
  trusting it; deadness is per (cell, budget); report per board class,
  never pooled (measured sign-flips cancel on pooling).
- VOCABULARY: no feature flags, no "dark"/"promote" — members are
  seated/selectable/validated/merged; rejected code is deleted.
- Owner decision file (pending his word): sacrifice-disclosure Option A;
  measurement denominator (equal expected quality); cover-counting as
  the deterrence response model; invisibility feature-dials sheet
  (design/belief-fog 10-FEATURE-DIALS.md).
