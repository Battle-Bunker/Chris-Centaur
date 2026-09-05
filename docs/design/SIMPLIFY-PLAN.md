# SIMPLIFY-PLAN — the leftovers, ranked

An audit of `audit` @ `06e2f4f`, after the one-engine cut
(`docs/design/ONE-ENGINE-PLAN.md`) and the lens build
(`docs/design/decision-lens/05-BUILD-ORDER.md`), against the standing
directive:

> *"Any time you can delete complexity by factoring the code better so that
> there are fewer special cases and more straightforward parameterization of
> powerful abstractions, pursue it."*

Every item below is **behaviour-preserving**. Nothing here proposes a
different move on any board, and nothing here deletes a test that pins a live
property. Where the audit found a genuine *defect*, it is recorded in §5 and
NOT counted as a simplification, because repairing it is a behaviour change
and belongs to its own decision.

Method: `git grep` import and symbol sweeps (no `madge`), consumer counts per
export, and reading. Line numbers are `file:line` on this worktree at
`06e2f4f`.

---

## 0. The three gates

Every item names which of these catches a mistake in it. A Sonnet executor
should run the named gate and nothing less.

| gate | how to run it | what it catches |
|---|---|---|
| **BYTE-IDENTICAL RUNNER** | `npx tsc && node dist/tests/local-game.js sum all 60 5 --nodes --json=X.jsonl --label=after` in the changed tree and in a clean one, then `node scripts/ab-compare.js before.jsonl after.jsonl` — an all-zero diff is the pass. Cheap smoke version: `npx jest src/tests/local-game-determinism.test.ts` (`local-game-determinism.test.ts:59` compares the whole summary **as a string**, so a counter nobody remembered is still covered). | any change to which move the bot plays, on three board classes × five seeds, under the node clock |
| **SOUNDNESS SWEEP** | `npx jest src/lobster/bounds/soundness.test.ts` | `floor ≤ true worst ≤ ceiling` broken by a bank/bound edit, checked against exhaustive enumeration through the same resolver (`soundness.test.ts:1-30`) |
| **A NAMED TEST** | as cited per item | the local contract that item touches |

Two further gates exist and are named where relevant: `npx jest
src/tests/lens-replay-parity.test.ts src/tests/lens-schema.test.ts` and
`npm run lens:check` (the projection rebuild).

---

## 1. The ranking

| # | item | Δ lines | risk gate | kind |
|---|---|---|---|---|
| 1 | [Telemetry's dead half](#1) — `telemetry.ts` builds a whole decision record nothing reads | **−580 / +25** | named test (`piece-staging`, `contest-tie-and-sever-outcomes`) + typecheck | **MECHANICAL** |
| 2 | [One fold for the per-our-unit members](#2) — `contest`/`momentum`/`energy` (and `tier`) are one function three (four) times | **−60 / +25** | byte-identical runner + `evaluate.test.ts` | **MECHANICAL** (JUDGEMENT to fold `tier` in) |
| 3 | [One keep-best-class filter](#3) — three near-copies in `candidates.ts` | **−54 / +28** | byte-identical runner + `candidates.test.ts` | **MECHANICAL** |
| 4 | [One comparator, two term tables](#4) — `orderKey` / `gainOrderKey` | **−35 / +22** | byte-identical runner + `order.test.ts`, `candidates.test.ts` | **MECHANICAL** |
| 5 | [Dead wire fields](#5) — `safeMoves`, `numStates`, `projectedTerritoryCells` | **−45 / +0** | named test (`piece-staging.test.ts:595,627`) | **MECHANICAL** |
| 6 | [One decision rig](#6) — the safety→generator→core preamble, five copies | **−25 / +14** | byte-identical runner + `lens-*` suites | **MECHANICAL** |
| 7 | [The tier-freeze triplicate](#7) — `frozenTier` / `heldAt` / `heldTierAt`, plus a dead export | **−16 / +2** | byte-identical runner + `tier-window.test.ts` | **MECHANICAL** |
| 8 | [One ray-grouping pass](#8) — `collapseSuffixes` / `thinQuiet` preambles | **−26 / +16** | byte-identical runner + `candidates.test.ts` | **MECHANICAL** |
| 9 | [`envelope(lo, hi)`](#9) — the min/mid/max tail, seven copies | **−21 / +9** | byte-identical runner | **MECHANICAL** |
| 10 | [One board memo](#10) — ten hand-rolled `WeakMap` get-or-compute caches | **−50 / +26** | byte-identical runner | **MECHANICAL** |
| 11 | [One sweep for B1 and B3](#11) — the bank's rungs are one cross-product walk | **−35 / +20** | **soundness sweep** + `bank.test.ts` | **JUDGEMENT** |
| 12 | [Single-consumer types leave the hub](#12) — `contracts.ts` | **−42 / +40** (hub −42) | typecheck | **MECHANICAL** |
| 13 | [`mulberry32` twice](#13) | **−10 / +1** | `bank.test.ts`, `local-game-determinism` | **MECHANICAL** |
| | **total** | **≈ −1000 / +230, net ≈ −770** | | 10 MECHANICAL, 1 JUDGEMENT, 2 mixed |

§3 records four things that *look* like leftovers and are **held on purpose** —
cutting them is the trap this audit exists to disarm. §4 records four of the
brief's own hypotheses that the evidence did **not** support.

---

## 2. The items

<a name="1"></a>
### 1. Telemetry's dead half — `src/lobster/telemetry.ts`

**−580 / +25 · MECHANICAL · gate: `npx jest src/tests/piece-staging.test.ts src/tests/contest-tie-and-sever-outcomes.test.ts` + `npx tsc`**

`telemetry.ts` is 905 lines. It has **exactly one importer**:

```
src/lobster/team-decision-engine.ts:91  import { buildDecisionRows } from './telemetry';
src/lobster/team-decision-engine.ts:92  import type { UnitDecisionRow } from './telemetry';
```

and that importer (`emitTelemetry`, `team-decision-engine.ts:1170-1230`) reads
exactly **three fields** of the row it is handed: `row.snakeId`,
`row.moveEvaluations`, `row.safeMoves`.

The file was written to feed `DecisionLogger.logDecision`
(`telemetry.ts:272`, the docstring says so). **That method no longer exists.**
`decision-logger.ts:128-140` states the removal in as many words: *"There is no
`logDecision` row path… The account survives as the `movesets` projection and
`unit_outcomes`."* So everything the row carries for the database is computed
once per decision, per unit, after the deadline, and dropped on the floor.

Consumer counts confirm it. These exports have **zero** references anywhere in
`src/`, tests included:

| symbol | `telemetry.ts` lines | refs outside the file |
|---|---|---|
| `contrastOf` | 717-763 | 0 |
| `supersessionReasons` | 805-825 | 0 |
| `TelemetryEvaluation` | 89-133 | 0 |
| `MAX_CANDIDATES_PER_UNIT`, `MAX_EXPLAINED_CANDIDATES` | 331, 339 | 0 |
| `breakdownOf` (internal) | 667-695 | 0 |

There is no test file for `telemetry.ts` at all
(`git grep -ln telemetry -- src/tests src/lobster/__tests__` returns only a
comment in `bot-binding.test.ts:400`).

**What survives, and why.** Two consumers of the emitted row exist downstream:

* `board-renderer.js:2332-2434` (`processMoveEvaluations`) keys candidates by
  `String(e.move)` and reads `e.dest` / `e.kind` for **destination-keyed
  (piece)** rows only. Snake rows are direction-keyed and it rebuilds the four
  directions itself; the row is used only to set `isEvaluated`. The file says
  so at `:2325`.
* `active-game-manager.ts:1930-1948` (`getWaypointBiasedMove`) reads
  `evaluation.score` — and `evaluation.breakdown`, whose every key it asks for
  is absent (see §5).

So the row's surviving contract is `{ move, score, dest }` per candidate, plus
`safeMoves` (which §5 shows is itself dead).

**The cut.** Delete, whole:

| region | lines | what it is |
|---|---|---|
| `telemetry.ts:143-220` | 78 | `TelemetryEmission`, `TelemetryContrast`, `TelemetryAssumption`, `TelemetryKernel` |
| `telemetry.ts:221-272` | 52 | `TelemetryDecision` |
| `telemetry.ts:343` | 1 | `MAX_ASSUMPTIONS` |
| `telemetry.ts:423-433` | 11 | `SharedDecision` |
| `telemetry.ts:702-905` | 204 | `EMPTY_CONTRAST`, `contrastOf`, `journalFor`, `supersessionReasons`, `summarizeKernel`, `describeAssumptions`, `heldWireIds`, `profileNameOf` |
| `telemetry.ts:74-88`, `134-142`, `667-701` | 59 | `TelemetryFeature`, `TelemetryBreakdown`, `breakdownOf`, `finite` |

and shrink:

| region | from → to | what goes |
|---|---|---|
| `telemetry.ts:89-133` (`TelemetryEvaluation`) | 45 → 10 | every field but `move`, `score`, `dest` — `numStates`, `breakdown`, `scoreChannel`, `bounds`, `features`, `rank`, `tier`, `capture`, `captureValue`, `energySpent`, `exhaustionFatal`, `contingencies`, `chosen`, `unexplained` |
| `telemetry.ts:273-296` (`UnitDecisionRow`) | 24 → 6 | every field but `snakeId`, `moveEvaluations`, `safeMoves` |
| `telemetry.ts:365-393` | 30 → 2 | the shared-decision block: `summarizeKernel`, `describeAssumptions`, `heldWireIds`, pins, committed, journal, reasons, profile |
| `telemetry.ts:500-517` | 21 → 6 | the `features` mapping inside the explain call; keep `explanation.bound` |
| `telemetry.ts:541-586` | 48 → 12 | the `TelemetryEvaluation` construction and the `TelemetryDecision` literal |
| `telemetry.ts:613-666` (`degradedRow`) | 52 → 15 | the same, for the failure path |
| `telemetry.ts:1-50` (header) | 50 → 20 | the "WHAT A ROW SAYS" and journal paragraphs describe the deleted half |

Then in `team-decision-engine.ts:1180-1195`, drop the arguments
`buildDecisionRows` no longer needs: `report`, `assumptions`, `modelled`,
`pins`, `engineName`, `bot`, `turn`.

**Special case removed.** The `breakdown: Record<string, unknown>` bag with a
free-form index signature (`telemetry.ts:134-141`) — a between-layer contract
made of optional keys read through `??`. It is the exact construct the drives
audit names as the cause of F1 (§5), and this deletes its last producer for
snakes. The piece path builds its own breakdown at
`active-game-manager.ts:3071` and keeps it; that one **is** tested
(`contest-tie-and-sever-outcomes.test.ts:469-474`).

**Abstraction parameterised.** None added — this is subtraction. What is left
is one function whose job is stated by its signature: `assess the unit's
candidates, price each on the settled plan, return (move, score, dest)`.

**Type edits this forces** (all in `active-game-manager.ts:60-77`,
`MoveEvaluation`): make `breakdown?: any` (the only reader,
`:1933`, already writes `evaluation.breakdown || {}`); delete `numStates`
outright (item 5).

**Two JUDGEMENT follow-ons, deliberately NOT in the −580.**

1. `telemetry.ts:500-511` calls `evaluate.explainPlan`; only
   `explanation.bound` survives, and `explainPlan` is a thin wrapper over
   `evaluatePlan` returning the same `bound`
   (`evaluate/index.ts:220-241`). Swapping to `scorePlan` is the same number
   and drops the features loop — but it changes the `canExplain` guard
   (`telemetry.ts:466-467`), which today also asks whether the evaluator *has* an
   explain surface. Byte-identical for `BoundEvaluator`; not provably so for a
   stub. Do it separately, gated on the byte-identical runner.
2. Whether the snake re-publish should exist at all. It spends up to 96
   counterfactual evaluations per decision *after* the deadline
   (`telemetry.ts:339`) to deliver `{move, score}` to a client whose only score
   reader is the re-biaser of §5. Deleting it is a behaviour change (the
   client's `isEvaluated` flags), so it is out of scope here — but it is the
   next question, and §5 is why.

---

<a name="2"></a>
### 2. One fold for the per-our-unit members — `src/lobster/evaluate/`

**−60 / +25 · MECHANICAL (three members) / JUDGEMENT (four) · gate: byte-identical runner + `npx jest src/lobster/__tests__/evaluate.test.ts`**

Three shipped features are the **same function** with a different per-unit
cost:

| feature | file:lines | the fold |
|---|---|---|
| `contestFeature` | `evaluate/contest.ts:233-252` | count our live non-held standing → `point(0)` if none → sum `−cost` into `worst` under `bestAlive` and into `best` under `worstAlive` → divide by the count → envelope |
| `momentumFeature` | `evaluate/momentum.ts:144-163` | identical |
| `energyFeature` | `evaluate/energy.ts:167-196` | identical, plus one extra gate (`priceable === 0 → point(0)`) |

Read them side by side; they differ only in the `costOf` call
(`contest.ts:193-209`, `momentum.ts:110-124`, `energy.ts` via `energyCostOf`)
and, for `energy`, the extra early return. Even the comment is copied — the
"WORST reading counts the SUPERSET… the opposite way round from a positive
term" paragraph appears verbatim at `contest.ts:218-224` and
`momentum.ts:126-135`.

**The parameterisation.** One combinator in `evaluate/bound.ts` (or a new
`evaluate/ourterm.ts`):

```ts
/** A term that is a mean over OUR live, non-held units of a per-unit signed
 *  reading, folded so a dead unit can never invert the bracket. */
export function ourUnitTerm(
  ctx: EvalContext,
  valueOf: (s: Standing) => readonly [lo: number, hi: number],
  gate?: (ctx: EvalContext, ours: ReadonlyArray<Standing>) => boolean
): Bound
```

with the three members becoming:

```ts
evaluate: (ctx) => ourUnitTerm(ctx, (s) => { const c = costOf(ctx, s, field); return [-c, -c]; })
```

The never-positive rule (`if (s.bestAlive) worst -= cost; if (s.worstAlive)
best -= cost`) is the special case `lo = hi = −cost` of the signed rule the
combinator states once. `tierFeature` (`evaluate/tier.ts:229-291`) is the
**signed** instance — `if (vLo < 0 && s.bestAlive) worst += vLo; if (vLo > 0 &&
s.worstAlive) worst += vLo;` at `tier.ts:283-286` — so folding it in too is the
whole point of a signed combinator, but it is **JUDGEMENT**: `tier` counts
`ours` before its own `tierIsLive` gate and reads intervals per unit, so an
executor must check the equivalence rather than assume it.

**Special case removed.** Four hand-written statements of one soundness rule
(*"costs over the superset, credits over the subset, in the worst reading"*).
Today a fifth member has to re-derive that rule from a comment; after this it
inherits it from a type signature. Note that `momentum.ts:146-152` counts
`ours` *before* the `!bestAlive && !worstAlive` skip and the other two count it
*after* — the two are equivalent (a fully-dead unit contributes nothing to
either accumulator), which is exactly the sort of thing a shared fold makes
impossible to get wrong twice.

---

<a name="3"></a>
### 3. One keep-best-class filter — `src/lobster/candidates.ts:1021-1099`

**−54 / +28 · MECHANICAL · gate: byte-identical runner + `npx jest src/lobster/__tests__/candidates.test.ts src/tests/basic-intelligence.test.ts`**

Three functions, 54 lines, one idea: *partition the assessed set by a rank,
keep the best non-empty class, record a prune for the rest, and never return
empty.*

| function | lines | the rank | prune id | guard |
|---|---|---|---|---|
| `keepTierSafe` | 1021-1038 | `a.tierGrade === 'decisive' ? 1 : 0` | `PRUNE.tierDecisive` | `knobs.tierSafeStaging` |
| `keepBestTier` | 1049-1065 | `TIERS.indexOf(a.tier)` | `PRUNE.kingUnsafe` | `unit.isKing && knobs.kingHardSafety` |
| `keepBestKingTier` | 1081-1099 | `kingTierRisk(a)` (`:1098`) | `PRUNE.kingTierUnsafe` | (called from `keepBestTier`) |

`keepBestTier`'s "first non-empty class in `TIERS` order" is "minimum
`TIERS.indexOf`" — `TIERS` is ordered best-first (`candidates.ts:323`, and
`orderKey:1176` reads it as a rank). All three then take the same
never-empty escape (`return [...assessed]`).

**The parameterisation.**

```ts
function keepBestClass(
  assessed: ReadonlyArray<AssessedCandidate>,
  pruned: PrunedEntry[],
  rank: (a: AssessedCandidate) => number,
  prune: PruneId
): AssessedCandidate[]
```

Call sites at `candidates.ts:589-590` become guard + one call each, and
`keepBestTier` becomes `keepBestClass(...)` chained into
`knobs.tierSafeStaging ? keepBestClass(kept, pruned, kingTierRisk,
PRUNE.kingTierUnsafe) : kept`.

**Special case removed.** Three copies of the emptiness guarantee. The
guarantee is load-bearing — `candidates.ts:1101-1110` calls it *"the emptiness
guarantee… every lossy prune is reversible"* — and it is currently asserted by
three separate `if (kept.length === 0 || kept.length === assessed.length)`
expressions written three different ways.

**Bonus, same edit:** `kingTierRisk` (`:1098`) and `tierRisk` (`:1291`) are two
different sums of the same two ranks — `tierGradeRank(a) + (a.selfDebuff ===
'none' ? 0 : 3)` versus `tierGradeRank(a) + selfDebuffRank(a.selfDebuff)`. They
are **not** equal (`SELF_DEBUFF_RANK`, `tier-window.ts:283-290`, maps `spend→0`,
`solo/waste→1`, `exposed→2`, `king→3`, so the first over-charges every non-king
debuff). Do **not** unify them — that is a behaviour change. Leave a comment
naming the difference, because reading them today they look like a typo of each
other.

---

<a name="4"></a>
### 4. One comparator, two term tables — `src/lobster/candidates.ts:1175-1284`

**−35 / +22 · MECHANICAL · gate: byte-identical runner + `npx jest src/lobster/search/order.test.ts src/lobster/__tests__/candidates.test.ts`**

`orderKey` (`:1175-1192`) and `gainOrderKey` (`:1266-1284`) are two hand-written
lexicographic comparators over the same rows, selected at one site:

```ts
kept.sort(knobs.gainOrdering ? gainOrderKey : orderKey);   // :598
```

| | `orderKey` | `gainOrderKey` |
|---|---|---|
| 1 | `TIERS.indexOf(tier)` asc | same |
| 2 | `tierRisk` asc | same |
| 3 | — | `regicideShot` desc |
| 4 | `captureOrder` | same |
| 5 | — | `foodGain` desc |
| 6 | `shadowBonus` desc | same |
| 7 | `spendRank` asc | `foodGain === 1 ? 0 : spendRank` asc |
| 8 | `contingencies` asc | same |
| 9 | `candidate.to` asc | same |

Five of nine terms are byte-identical text in both. The file *knows* this is a
hazard: `:1255-1265` is a 12-line INTEGRATION NOTE explaining that `tierRisk`
had to be hand-carried into the second comparator or *"selecting it at the sort
site would otherwise discard I4's tier defense wholesale the moment
`gainOrdering` is promoted."* That is a duplication defect described at length
instead of removed.

**The parameterisation.** Terms as data:

```ts
type Term = (a: AssessedCandidate, b: AssessedCandidate) => number;
const compareBy = (terms: ReadonlyArray<Term>): Term =>
  (a, b) => { for (const t of terms) { const d = t(a, b); if (d !== 0) return d; } return 0; };

const BASE_ORDER: Term[]  = [byTier, byTierRisk, byCapture, byShadow, bySpend, byContingencies, byTo];
const GAIN_ORDER: Term[]  = [byTier, byTierRisk, byRegicideShot, byCapture, byFoodGain, byShadow, bySpendRefundingFood, byContingencies, byTo];
```

Nine one-line named terms, one 4-line `compareBy`, two arrays. A term added to
the shared prefix is now added to both by construction, which is precisely what
the INTEGRATION NOTE is asking a human to remember.

**Byte-identity argument.** `compareBy` returns the first non-zero in the same
order; every term is lifted verbatim including its sign. Prove it with the
runner: `gainOrdering` is on by default
(`closing.test.ts:843` asserts `DEFAULT_KNOBS.gainOrdering === true`), so the
default runner path exercises `GAIN_ORDER`; run `CENTAUR_*` off-path too if the
knob is reachable.

---

<a name="5"></a>
### 5. Dead wire fields — `safeMoves`, `numStates`, `projectedTerritoryCells`

**−45 / +0 · MECHANICAL · gate: `npx jest src/tests/piece-staging.test.ts` + `npx tsc`**

**`TurnData.safeMoves` (`active-game-manager.ts:117`) has no live reader.**
Traced end to end:

* written at `active-game-manager.ts:3178`, `:3721`,
  `firebase-interface.ts:1455`, `team-decision-engine.ts:1132` (all `[]`) and
  `team-decision-engine.ts:1219` (the only real value, from telemetry);
* read by **no** server, wire, firebase, logic or lens module
  (`git grep -n safeMoves -- src/server src/wire src/firebase src/logic src/lens`
  returns only the four writes and the type);
* **never broadcast**: the `snake-turn-update` payload
  (`websocket-server.ts:328-352`) does not carry it;
* so `play-game.html:1956` (`safeMoves: msg.safeMoves`) stores `undefined`
  forever, and `:2308` passes `[]` for the renderer's offerable argument
  anyway;
* `board-renderer.js:2325-2331` says it outright: *"`safeMoves` is gone too
  (#18), and with it the idea that the BOARD knows which candidates are
  admissible."*

Delete the field, its five constructions, `UnitDecisionRow.safeMoves` and its
computation (`telemetry.ts:604`), and `msg.safeMoves` in `play-game.html`.
`piece-staging.test.ts:627` asserts `latestTurnData!.safeMoves` equals `[]` — it
pins a dead field, not a live property, and goes with it.

**`MoveEvaluation.numStates` (`active-game-manager.ts:66`) is structurally
constant.** Written `0` at `telemetry.ts:547` and `active-game-manager.ts:3070`
and nowhere else; read by nothing in `src/web/`. `telemetry.ts:214-216` states
the rule for exactly this case, about a different field: *"A column that is
structurally constant is not telemetry, it is furniture."* Delete the field, its
two writes, the four test fixtures that set it
(`fatal-consent-and-reversal.test.ts:200`, `staged-move-turn.test.ts:51`, …) and
the assertion `piece-staging.test.ts:595` (`expect(e.numStates).toBe(0)` — it
pins the constant, not a property).

**`MoveEvaluation.projectedTerritoryCells` (`active-game-manager.ts:68`) is
never written.** Declared, optional, zero assignments anywhere. Delete.

---

<a name="6"></a>
### 6. One decision rig — five copies of the safety preamble

**−25 / +14 · MECHANICAL · gate: byte-identical runner + `npx jest src/tests/lens-inspection-cost.test.ts src/lobster/__tests__/lens-explain.test.ts src/lobster/__tests__/lens-reserve.test.ts`**

The same four lines stand at the top of five decision assemblies:

```ts
const safety = resolveStagingSafety(stagingSafety(), boardBearsPiece(sub));
const gen = new GrammarCandidateGenerator(knobsForSafety(safety));
const search = makeSearchCore({ rungZeroRepair: safety === 'full', seedDeconflict: safety !== 'off' });
```

| site | lines |
|---|---|
| `src/lens/kernel/record.ts` | 173-179 |
| `src/tests/local-game.ts` | 407-412 |
| `src/tests/lens-inspection-cost.test.ts` | 115-120 |
| `src/lobster/__tests__/lens-explain.test.ts` | 53-55 |
| `src/lobster/__tests__/lens-reserve.test.ts` | 134-136 |

and the production engine states the same three derivations a sixth time, with
the binding folded in, at `team-decision-engine.ts:466-475`.

The couplings `rungZeroRepair ← safety === 'full'` and `seedDeconflict ←
safety !== 'off'` are *rules*, not call-site choices — `search/core.ts:347-350`
and `:712-713` carry fallbacks and a comment saying *"the shipped path does not
reach this fallback"*, i.e. the rule is asserted in two places and defended in a
third.

**The parameterisation.** In `src/lobster/staging-safety.ts` (it already owns
`resolveStagingSafety` and `boardBearsPiece`), or beside `knobsForSafety` in
`candidates.ts`:

```ts
export interface DecisionRig { safety: ResolvedStagingSafety; gen: GrammarCandidateGenerator; search: SearchCore; }
export function rigFor(sub: EngineSubstrate, over?: { level?: StagingSafety; seed?: number; candidates?: CandidateKnobs }): DecisionRig
```

Five sites collapse to `const { safety, gen, search } = rigFor(sub, { seed })`.
`team-decision-engine.ts` passes `over.level` and keeps its knob-precedence
comment (`:470-475`), which is the one genuine variation.

---

<a name="7"></a>
### 7. The tier-freeze triplicate, plus a dead export

**−16 / +2 · MECHANICAL · gate: byte-identical runner + `npx jest src/lobster/__tests__/tier-window.test.ts src/lobster/__tests__/evaluate.test.ts`**

One rule — *a tier whose exclusive expiry has arrived is 0* — is written three
times under three names:

```ts
// evaluate/contest.ts:128
function frozenTier(tier, expiresAtTurn, turn) { return expiresAtTurn !== null && turn >= expiresAtTurn ? 0 : tier; }
// evaluate/tier.ts:136
function heldAt(tier, expiresAtTurn, turn)    { return expiresAtTurn !== null && turn >= expiresAtTurn ? 0 : tier; }
```

Byte-identical bodies. Export one from `evaluate/contest.ts` (which also owns
`winsContest` and `ContestField`, the two things that read it) and delete the
other.

The third is `tier-window.ts:76-78`:

```ts
export function heldTierAt(subject: { readonly tier: number }): number { return subject.tier; }
```

— the same rule reduced, by the marshalling change its own docstring describes
(`:65-75`: *"a `SubstrateUnit.tier` is exact at the arrival turn — so there is
nothing left to lapse"*), to the **identity function**. Its only callers are
`tier-window.ts:358` and its own test (`tier-window.test.ts:129`). Inline it
(`settled > other.tier`) and delete the export and the assertion; the test line
asserts `heldTierAt(u) === u.tier`, which is a tautology, not a live property.

Same file, same edit: **`claimsHaveTier` (`tier-window.ts:363-365`) has zero
references anywhere in `src/`** — not one call, not one test. Delete.

---

<a name="8"></a>
### 8. One ray-grouping pass — `src/lobster/candidates.ts`

**−26 / +16 · MECHANICAL · gate: byte-identical runner + `npx jest src/lobster/__tests__/candidates.test.ts`**

`collapseSuffixes` (`:624-636`) and `thinQuiet` (`:877-889`) open with the same
thirteen lines: bucket by first path cell, pass zero-length paths straight
through, then sort each bucket by path length ascending.

```ts
function byRay<T>(items: ReadonlyArray<T>, pathOf: (t: T) => ReadonlyArray<CellIndex>):
  { rays: Map<CellIndex, T[]>; loose: T[] }
```

with each caller doing `const { rays, loose } = byRay(raw, c => c.path)` and
`for (const group of rays.values()) { group.sort(byPathLength); … }`. Insertion
order and `Array.prototype.sort` stability are preserved, so the enumeration
order the byte-identical runner depends on is unchanged.

**Also in this edit:** `thinQuiet` takes a `unit` parameter it does not use and
discards with `void unit;` at `:922`. Remove the parameter.

---

<a name="9"></a>
### 9. `envelope(lo, hi)` — `src/lobster/evaluate/bound.ts`

**−21 / +9 · MECHANICAL · gate: byte-identical runner**

`return bound(Math.min(lo, hi), (lo + hi) / 2, Math.max(lo, hi));` appears
verbatim at:

`contest.ts:251`, `energy.ts:195`, `features.ts:657`, `features.ts:715`,
`features.ts:887`, `momentum.ts:162`, `tier.ts:291` — and once more in
expanded form at `features.ts:774-776`.

`bound.ts:58-127` is already a proper `Bound` algebra (`bound`, `point`, `add`,
`scale`, `negate`, `join`, `clampEst`, `clampTo`); this member is missing from
it:

```ts
/** The two-reading envelope: which endpoint is which is a property of the
 *  term's sign, not of the reading, so the constructor decides it. */
export const envelope = (a: number, b: number): Bound =>
  bound(Math.min(a, b), (a + b) / 2, Math.max(a, b));
```

Note `food.ts:203` deliberately writes `bound(lo, (lo + hi) / 2, hi)` — no
`min`/`max`. Leave it alone; if `food`'s endpoints can never cross, that is a
claim its own code should keep making explicitly.

---

<a name="10"></a>
### 10. One board memo — ten hand-rolled `WeakMap` caches

**−50 / +26 · MECHANICAL · gate: byte-identical runner**

Ten module-level caches repeat the same five-line get-or-compute, and two of
them repeat the *same subtle keying rule* in prose:

| cache | file:line | keyed on |
|---|---|---|
| `FIELDS` | `evaluate/contest.ts:125` | `sub.marshalled`, then team |
| `LIVE` | `evaluate/tier.ts:112` | `sub.marshalled` |
| `foodCache`, `scaleCache` | `evaluate/closing.ts:69,89` | `EngineSubstrate` |
| `rosterConstants` | `evaluate/features.ts:507` | `EngineSubstrate` |
| `DISTANCE` | `evaluate/food.ts:96` | `EngineSubstrate` |
| `CAME_FROM` | `evaluate/momentum.ts:87` | `EngineSubstrate` |
| `workspaces` | `evaluate/territory.ts:317` | `EngineSubstrate` |
| `shadows`, `regicideCells`, `victims` | `candidates.ts:388,390,392` | `EngineSubstrate` |

`contest.ts:118-124` and `tier.ts:105-111` both explain, in near-identical
paragraphs, why the key must be `sub.marshalled` and not `sub`: *"a modelled
sibling is a `Proxy` over its parent… the marshalled board is the one object it
hands straight through."* That rule is currently enforced by two people having
read the same comment.

```ts
/** Per-board memo. Keyed on `sub.marshalled` because a modelled sibling is a
 *  Proxy over its parent and the marshalled board is what it hands through. */
export function perBoard<T>(cache: WeakMap<object, T>, sub: EngineSubstrate, compute: () => T): T;
export function perBoardPerTeam<T>(cache: WeakMap<object, Map<number, T>>, sub: EngineSubstrate, team: number, compute: () => T): T;
```

Each site becomes one line. **JUDGEMENT sub-point:** the eight caches keyed on
`EngineSubstrate` rather than `sub.marshalled` may be correct as they are
(a sibling proxy legitimately wants its own entry for some of them) — do not
re-key anything in this edit; only replace the get-or-compute boilerplate,
keeping each cache's existing key expression.

---

<a name="11"></a>
### 11. One sweep for B1 and B3 — `src/lobster/bounds/bank.ts:552-622`

**−35 / +20 · JUDGEMENT · gate: SOUNDNESS SWEEP (`npx jest src/lobster/bounds/soundness.test.ts`) + `npx jest src/lobster/bounds/bank.test.ts`**

B3 (`:552-591`) is a cross-product walk over the option lists of the whole
gate. B1 (`:594-621`) is the *same walk, per unit, with a list of length one* —
its inner loop is a hand-inlined degenerate `walk`, and both end in the same
`closeGroup(rung, unitId, leaves, swept, complete, floorMembers)`.

```ts
private sweep(view, base, rung: Rung, lists: ReadonlyArray<{ id: UnitId; options: ReadonlyArray<Candidate> }>, evalNs)
  : { leaves: Branch[]; swept: boolean }
```

B3 is `sweep(view, base, "B3", lists, evalNs)`; B1 is
`for (const enemy of gated.slice(0, cfg.enemyCap)) sweep(view, base, "B1",
[{ id: enemy, ...this.optionsFor(view, enemy) }], evalNs)`.

**Why JUDGEMENT.** Three genuine differences must be preserved rather than
merged away, and each is a soundness statement:

1. B1 sets `finished = false` and **breaks the outer loop** on `!swept`
   (`:617-620`); B3 sets `b3Covered = false` and falls through to B1.
2. B3's `complete` argument to `closeGroup` is a literal `true`, justified by
   `coversEverything && lists.every(l => l.complete)` at `:560-563`; B1 passes
   the per-unit `complete`. Getting this wrong lets an incomplete sweep raise a
   floor, which is *the* fatal bug class (`bank.ts:30-39`).
3. B3 checks `product <= cfg.productCap` before walking.

Keep all three at the call sites; the shared part is only the recursion and the
budget check. Run the soundness sweep across **every** bank configuration
(`soundness.test.ts:17-24` says the property under test is that the *mixture*
is sound), not just the default.

**Smaller, unconditional win in the same file:** `:659-683` picks the maximum
floor and the minimum ceiling with two nine-line loops that differ only in the
comparator, both tie-breaking on `ledger.length`. One
`pickBy(items, better)` — −14 / +6, MECHANICAL, same gate.

---

<a name="12"></a>
### 12. Single-consumer types leave the hub — `src/lobster/contracts.ts`

**−42 from the hub / +40 in the leaves · MECHANICAL · gate: `npx tsc`**

`contracts.ts:1-10` states the file's job: the lobster modules *"depend on each
other ONLY through this file."* A type with one consumer is not a dependency
between modules; it is that module's own type, parked in the hub.

| symbol | `contracts.ts` | sole consumer |
|---|---|---|
| `RiskCause` | 144-155 | `pathrisk.ts:54,64,127,261` |
| `PinAdvice` | 315-326 | `pins.ts:26,240` (extended there) |
| `TrialObservation` | 659-676 | `kernel.ts:61,1704,2517,2604` |
| `objectIdentity` | 60-84 | `bounds/evalmemo.ts:55,87` |

Move each next to its consumer; re-export from `contracts.ts` only if an
external import breaks. `EncounterVerdict` (156-168) and `TraversalVerdict`
(169-198) have two and three consumers respectively and **stay** — they are
real seams. `TrialSink` (677) stays: `SearchContext` (679-705) references it in
the same file.

Low value on its own; worth doing as a tail on any edit that touches
`contracts.ts`, because it makes the hub's remaining contents mean what the
header says they mean.

---

<a name="13"></a>
### 13. `mulberry32` twice

**−10 / +1 · MECHANICAL · gate: `npx jest src/lobster/bounds/bank.test.ts src/tests/local-game-determinism.test.ts`**

`src/tests/local-game.ts:82-90` and `src/lobster/bounds/testkit.ts:488-496`
carry the same ten-line PRNG. Export the `testkit.ts` one (it is already
`export`ed; `local-game.ts`'s is private) and import it. Both seeds and both
call orders are unchanged, so both determinism gates hold.

---

## 3. What LOOKS like a leftover and is HELD on purpose

Four things this audit was expected to flag and must not. Each is recorded with
its guard so the next pass does not spend the search again.

| thing | why it looks dead | why it is held |
|---|---|---|
| `src/lobster/evaluate/closing.ts` (229 lines) | no importer outside its own test | **Deliberate, with a tripwire.** `closing.test.ts:783-831` is a test that *asserts nothing imports it* — the Stage-2.5 ledger ships `gainOrdering` and **holds** `approach` for its own measurement arm, and the feature must not be able to reach a decision. `closing.test.ts:800`: *"If it fails, the question to ask is 'has approach's arm reported yet?', not 'how do I make this pass?'."* Do not delete, do not import. |
| `DepthColumn.confidence` (`lens/types.ts:272`) | written as the literal `'equal'` at `kernel.ts:2583` and `lens/kernel/conditional.ts:363` and nowhere else; the view's `'incomparable'` branch (`lens/view/index.ts:270`, `web/lens-view.js:924`) is unreachable | **Depth scaffolding, by design.** `kernel.ts:2573-2578`: *"HORIZON 1 IS THE ONLY READING THIS BUILD HAS (06 F-2). The column is carried as DATA now… so that depth, when it lands, fills fields rather than adding them."* `06-LOOKAHEAD.md:527,560,803` specifies the field and the `↕` glyph. Do not cut. |
| `voc.ts` `compareConfidence` / `Confidence` (`:86-113`) | zero production callers, zero callers inside `voc.ts`; only its own test | Named as the partial order the depth work will use, `06-LOOKAHEAD.md:527`. Held. |
| `voc.ts` `worstJoin` / `bestJoin` / `NodeVerdict` (`:115-160`), `stagingRowOf` (`:164-194`), `demandOf` / `VacuityDemand` (`:648-661`), `StagingDecision` (`:278-290`), `LeverFamily` (`:377`) | test-only; `StagingDecision` and `LeverFamily` have zero references of any kind | **Probably** held for the same depth work — they carry the tie-vacuity direction and citation sets that `backupMin`/`backupMax` (`bounds/score.ts:229,250`, the primitives `06-LOOKAHEAD.md:43,162` actually names) do not. They are the strongest remaining deletion candidate in `voc.ts` (≈130 lines), but **only after** someone checks them against `06-LOOKAHEAD.md` §1. Not proposed here. |

`voc.ts` itself is **not** an unconsumed module: `VocOrchestrator` is
constructed at `kernel.ts:1084` and driven at `:1373`, `planKey` has 40
non-test references, and `StickyStager` / `rootSlack` / `pickLeader` are live.

---

## 4. Hypotheses the evidence did not support

Recorded so the next audit does not re-open them.

| hypothesis | finding |
|---|---|
| *"duplicated coordinate/board conversions (`toApiCoord` / `apiCoordToIndex` / `marshalBoard`) vs engine helpers"* | **Already factored.** `marshalBoard` (`turn-oracle.ts:291-294`) delegates to `apiCoordToIndex` for its `toIndex`, and `apiCoordToIndex` (`translate.ts:30-34`) is the stated inverse of `toApiCoord`. The perimeter/flip mapping is written once, at `translate.ts:1-17`, with the upstream citation. Residual inline index arithmetic is eleven lines across six files (`moveGrammar.ts:41,178,180`, `translate.ts:24,53,81,83`, `candidates.ts:1321-1322`, `food.ts:125`, `turn-oracle.ts:462`, `testkit.ts:159`) and every one of them is a local `x = i % w` inside a hot loop, not a second encoding of the mapping. Nothing to do. |
| *"per-kind special cases in `candidates.ts` ordering keys that the engine's grammar queries could parameterise"* | **There are none.** `git grep -n "unit.type ===\|isPieceType\|leavesTrail\|kind ===" src/lobster/candidates.ts` returns **nothing**. The file is already fully kind-agnostic — it asks `sub.actionsOf` and `sub.assess` and never inspects a type. The real duplication in the ordering layer is items 3 and 4, which are not per-kind. |
| *"`tier-window.ts` / `staging-safety.ts` reduced forms that may now be one function"* | Both files are live and load-bearing (`staging-safety.ts` has eleven importers including `bot-identity.ts` and `lens/kernel/record.ts`). The reduced forms are two functions, not two files: `heldTierAt` and `claimsHaveTier`, both item 7. The real win in `staging-safety.ts` is item 6 — its callers, not its contents. |
| *"test helpers duplicated across `lens-fixtures.ts`, `bounds/testkit.ts`, `local-game.ts` board builders"* | **Mostly already shared.** `lens-fixtures.ts:23` imports `buildBoard` and `GameSpec` from `local-game.ts` and says so at `:5-9`. `testkit.ts`'s `makeTestBoard` (`:116-162`) builds a `MarshalledBoard` in **engine** coordinates with no perimeter; `local-game.ts`'s `buildBoard` (`:287`) builds an **api** `Board`. They are two different levels of the same pipeline and unifying them would force a perimeter onto the bounds harness for nothing. The only real duplicate is `mulberry32` (item 13). |

---

## 5. A defect found, deliberately NOT proposed as a simplification

Repairing it changes behaviour, so it is out of scope here — but it is the
reason item 1 matters and it should be read before anyone touches
`getWaypointBiasedMove`.

**Under the one engine, the snake goto re-bias reads a vocabulary the rows do
not use.** `getWaypointBiasedMove` (`active-game-manager.ts:1898-1953`)
re-scores `turnData.moveEvaluations` as

```ts
weight   = weights.gotoProgress ?? DEFAULT_CONFIG.gotoProgress   // :1936-1938
recorded = (weighted.gotoProgressScore ?? 0) + (weighted.nearProgressScore ?? 0)  // :1939
score    = evaluation.score - recorded + weight * progress[i].stat
trapped  = breakdown.trapped  ?? 0    // :1943
regicide = breakdown.regicide ?? 0    // :1946
```

Those rows are built by `breakdownOf` (`telemetry.ts:667-695`), which keys
`weights[k]` and `weighted[k + 'Score']` by **lobster feature names** —
`material`, `reach`, `room`, `food`, … So in production, on every turn:

| read | intended | actual |
|---|---|---|
| `weights.gotoProgress` | the operator's configured weight | `undefined` → `DEFAULT_CONFIG.gotoProgress` = **300** (`heuristics.ts:109-110`) |
| `weighted.gotoProgressScore` | the contribution already in the score | `undefined` → **0** |
| `breakdown.trapped` | the fatal-pocket veto | `undefined` → **0** — veto never fires |
| `breakdown.regicide` | "this move ends our own team" | `undefined` → **0** — veto never fires |

A 300-weight bonus lands on a lobster bound whose largest ordinary term is 10
(`calibration.ts`), so `argmaxSurvivingMove` (`:1986-2000`) is, in production,
`argmax(progress.stat)` with `score` as a tiebreak and both vetoes disabled.
The staged move then carries `source: 'waypoint'`, which
`pin-events.ts:70-74` treats as a **pinning** source — so the result is handed
back to the next decision as fact.

`waypoint.test.ts:481-494` is green and is named *"the goto weight cannot buy a
fatally-trapped move"*. Its fixture (`waypoint.test.ts:378-389`) hand-builds
the **legacy** breakdown shape, so it asserts a property of a vocabulary
production no longer produces. That test should be re-fixtured onto real
lobster rows — at which point it will fail, which is the point.

Item 1 deletes the last snake-side producer of that breakdown bag without
changing a single one of the four values above (they already all miss), so it
is safe to do first, and it makes the defect impossible to hide behind an
optional key.

The full analysis, the two design options, and the ~430–480-line delete that
follows from re-expressing intents as drives are in
`docs/design/drives/01-UNDER-THE-CURRENT-CONTROLS.md` on
`feature/drives-preferences` (§2.1–2.4, §4.2). Of that delete, **nothing folds
in today without the drives fold**: `computePieceCandidates`
(`active-game-manager.ts:2892-2983`) and `bestPieceCandidate` (`:2806-2850`)
are a second, legacy-scaled evaluator whose vetoes *do* work
(`:2834-2837`), so removing them requires the joint fold to price a piece goto
first. The three ladders — `computeIntendedMove` (`:2093-2128`),
`computePieceStagedMove` (`:2727-2799`), and the pin path — remain three
ladders until then.

---

## 6. Suggested order

1. **Item 1** first and alone. It is the largest, it has no test coverage to
   break, and every later item in `evaluate/` is easier once the counterfactual
   explain loop is a `scorePlan` call.
2. **Item 5** immediately after — it is the same edit's type fallout.
3. **Items 7, 9, 13**: three-minute deletions, one commit, one runner check.
4. **Items 3, 4, 8**: all in `candidates.ts`, one commit each, byte-identical
   runner between them so a regression names its own cause.
5. **Item 2**, then **item 6**, then **item 10**.
6. **Item 11** last, with the soundness sweep across every bank configuration.
7. **Item 12** as a tail on whichever commit last touches `contracts.ts`.

Run the byte-identical runner **between** items, not once at the end: an
all-zero `ab-compare` diff after ten stacked edits tells you they cancelled,
not that each was sound.
