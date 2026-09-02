# SUCCESSION — orchestrator handoff (written 2026-09-02, end of design session)

## Addendum, 2026-09-02 pickup session (read this block first)

Avenues 1-3 below LANDED on `develop` (head 29f1a0c), each gated by tsc,
eslint, full jest (98 suites) and watched games; the owner is testing it.

- Contest avoidance: `src/lobster/evaluate/contest.ts`, weight `contest: 3`.
  Prices a destination an equal-or-heavier enemy head can also reach this
  turn (rules: strictMaximum on tier then weight, unique winner). Measured
  10 seeds x 100 turns @150ms: contest deaths -39%/unit-turn mixed, -56%
  snake-only; meals inside band; dither down. Not priced: edge-exchange
  (head-swap) contests; own-team coordination. Weight 3 argued from the
  food gate; 2 and 5 watched, neither better.
- Weight-aware captures: `captureValue` (victim weight x certainty) in
  `candidates.ts` drives orderKey and gainOrderKey. Evaluator material term
  verified already weight-aware (features.ts materialBounds). Unpriced
  captures (cloud defeats, mutual kills) keep the old certainty order.
- Engine re-cut E1+E2 landed in TacticToes (PR #23, branch
  claude/succession-doc-subagent-orchestration-n41iua): `settleTurn` in
  engine/ settles effects, tiers, potions; golden replay byte-identical;
  `invulnerabilityPotionWindowTurns` on GameSetup. Vendored here; the bot's
  forward step (`turn-oracle.ts::resolvePartialTurn`, `simulator.ts`) reads
  Settlement.tiers/effects/potions; `tier-window.ts` asks settlement what a
  pickup does (ally +1 now modelled). NOT DONE: `local-game.ts::stepGame`
  still calls resolveTurn and plays potion-free (so the merge bar cannot
  watch a potion game yet — do this first); `marshalBoard` still reads a
  unit's tier from the earliest expiry (buff+debuff with different expiries
  reads 0; the schedule is on the board now); partial-engine cloud/field
  tier bounds kept (dead on default; hash-manifested tree).
- Vendored rules re-synced (maxTurns may be null); sync script lists
  settleTurn.ts.

Measurement caveat found twice this session: the 150ms runner is NOT
reproducible at a fixed seed (same build, unitTurns 1501 vs 1329). At 20ms
it is deterministic but the seed plan plays ~98% of the time, so evaluator
terms barely reach the staged move there. A deterministic replay harness
(fixed node budget, not ms) is the missing instrument for any A/B on
counters; build it before tuning weights.

Next, in order: (1) potions in the local runner + a tier-value term in the
fold + botId on reports (M1/M2); (2) engage horizon 2-3 for pieces with
DEFAULT_SWITCH_MARGIN revisited, gated on watched games; (3) the queued
fat-account potion re-test, which decides whether potions pay at all;
(4) E3-E7.

Process this session: one orchestrator, four opus subagents (three in git
worktrees, merged by the orchestrator; one directly on TacticToes),
~200k tokens each, final report only. Worktrees were created from a stale
base and each agent had to fast-forward to the work branch first — brief
successors to check `git log -1` before starting.


Read this first. It replaces reading any transcript. The durable memory of
the whole session is `continuous/synthesis-pins.md` on `origin/coordination`
(rulings 0-52, every landing and verdict); this file is the shorter map.

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
