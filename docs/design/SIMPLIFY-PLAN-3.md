# SIMPLIFY-PLAN-3 — the third pass, ranked

An audit of `audit-3` @ `d4c0886`, after `SIMPLIFY-PLAN.md` was executed in full
and `SIMPLIFY-PLAN-2.md` items 1–5, §5.1 and §5.2 landed
(`cd29cdc`, `e41708e`, `d165582`), and after the two things that landed since:
the entrapment instrument (`6d4def4`) and the repair of `room` (`da8529d`,
merged at `d4c0886`), which deleted `crowdCertain`, the per-unit ownership
planes and the per-team seen/multi sweep.

The standing directive is unchanged:

> *"Any time you can delete complexity by factoring the code better so that
> there are fewer special cases and more straightforward parameterization of
> powerful abstractions, pursue it."*

**Ranked by SPECIAL CASES REMOVED × LINES DELETED ÷ RISK**, as asked. That
formula, applied honestly, puts a zero-risk 40-copy fixture fold above a
280-line class merge that touches the write path; the Δ columns are arithmetic,
not the ordering key, and the risk column is why item 2 is not item 1.

**What this pass is NOT allowed to re-open.** `SIMPLIFY-PLAN-2.md` items 6 and
8–15 are planned and unexecuted; nothing below restates them. Item 7's B1/B3
fold, and its `crossProduct` bonus, are owned on `b1-sound`. Where an item here
sits next door to one of those, it says so and stops at the boundary.

Every item is **behaviour-preserving**. Nothing proposes a different move on any
board. Two genuine defects are in §4 and are NOT counted as simplifications.

Method: a normalised 5-to-8-line cross-file duplicate scan over `src/**` minus
`engine-vendor`; a per-export consumer count over `src/`, `scripts/` and
`tools/`; and reading every claim before writing it down. Line numbers are
`file:line` on this worktree at `d4c0886`.

---

## 0. The gates

Unchanged from round 2, plus one the loggers bring.

| gate | how to run it | what it catches |
|---|---|---|
| **BYTE-IDENTICAL RUNNER** | `npx tsc && node dist/tests/local-game.js sum all 60 5 --nodes --json=X.jsonl --label=after` in the changed tree and a clean one, then `node scripts/ab-compare.js before.jsonl after.jsonl` — an all-zero diff is the pass. Smoke version: `npx jest src/tests/local-game-determinism.test.ts` (it compares the whole summary **as a string**). | any change to which move the bot plays, on three board classes × five seeds, under the node clock |
| **SOUNDNESS SWEEP** | `npx jest src/lobster/bounds/soundness.test.ts` | `floor ≤ true worst ≤ ceiling` broken by a bank/bound/evaluate edit, on all sixteen arms |
| **LENS DETERMINISM** | `npx jest src/tests/lens-determinism.test.ts src/tests/lens-replay-parity.test.ts src/tests/lens-schema.test.ts` | a reordering inside `better()` / the reservoir / the frame fold |
| **PROJECTION REBUILD** | `npm run lens:check` | the materialised `movesets` table disagreeing with the event stream |
| **THE WRITE PATH** | `npx jest src/tests/logger-queue.test.ts src/tests/logger-shutdown-deadline.test.ts src/tests/logger-db-gate.test.ts` | the drop preference, the shutdown deadline and the no-database gate — all three already assert the SAME properties of both loggers side by side |
| **A NAMED TEST** | as cited per item | the local contract that item touches |

---

## 1. The ranking

| # | item | Δ lines | risk gate | kind |
|---|---|---|---|---|
| 1 | [One test board harness, round 2](#1) — 40 more copies of `makeSnake`/`piece`/`boardOf`, all in the files round 2's item 1 did not reach | **−240 / +40** | the touched suites + `npx tsc` | **MECHANICAL** (Sonnet) |
| 2 | [One durable write queue](#2) — `CommandLogger` and `DecisionLogger` are one queue-worker written twice | **−280 / +150** | the write path + `npx tsc` | **MECHANICAL** with one named trap (Sonnet, contract given below) |
| 3 | [The lens store's read half is dead](#3) — six `read*` functions and `loadTurnStore`, zero callers | **−135 / +0** | `npx tsc` + `npm run lens:check` + lens determinism | **MECHANICAL** (Sonnet) |
| 4 | [One claims input from the marshalled board](#4) — the ten-field spread and the `observedTurn = arrivalTurn − k` trick, four times in three modules | **−48 / +24** | byte-identical runner + soundness sweep + `entrapment.test.ts` | **MECHANICAL** (Sonnet) |
| 5 | [The generation rig stops being six parameters](#5) — `candidates.ts` threads four per-board tables through eight signatures | **−45 / +18** | byte-identical runner + `candidates.test.ts` | **MECHANICAL** (Sonnet) |
| 6 | [The evaluator's per-reading spine](#6) — `envelope` re-spelled four times, the admission predicate three, `popcount32` twice | **−45 / +20** | byte-identical runner + soundness sweep + `evaluate.test.ts` | **MECHANICAL** (Sonnet) |
| 7 | [The exports nothing calls, and the one nothing adopted](#7) — seven dead functions, plus `fullDims` re-written by three callers | **−52 / +6** | `npx tsc` + the named suites | **MECHANICAL** (Sonnet) |
| 8 | [Four call sites that never adopted `perBoard`](#8) — round 1 item 10's memo, with four hold-outs | **−28 / +10** | byte-identical runner + `evaluate.test.ts`, `tier-window.test.ts` | **MECHANICAL** (Sonnet) |
| 9 | [`climb` covers the pair and the polish too](#9) — three copies of "acceptance is `better()` and nothing else" survive round 2's item 5 | **−22 / +12** | byte-identical runner + lens determinism + `core.test.ts` | **MECHANICAL** (Sonnet) |
| 10 | [One snake-registration step](#10) — `active-game-manager.ts` writes it four times | **−32 / +10** | `piece-staging`, `waypoint`, `staged-move-turn` | **MECHANICAL** (Sonnet) |
| 11 | [`partitionOf`'s arguments ride the reading](#11) — ten positionals, four of them `f(reading)`, one caller | **−26 / +12** | byte-identical runner + soundness sweep + `territory-acceptance`, `entrapment` | **MECHANICAL** (Sonnet), but read §4.2 first |
| 12 | [One inspection port type](#12) — the wire declares its own copy of the lens's | **−12 / +2** | `npx tsc` + `lens-inspection-cost.test.ts` | **MECHANICAL** (Sonnet) |
| | **total** | **≈ −965 / +304, net ≈ −660** | | 12 MECHANICAL, 0 requiring Opus |

**Nothing here needs Opus to execute.** That is a finding, not a coincidence:
rounds 1 and 2 took the judgement calls (the bank's rungs, the acceptance
ladder, the alive-set polarity rule), and what is left in this tree is
duplication a careful Sonnet can fold with the gate named beside it. Items 2,
4 and 11 each carry one trap; each trap is written out in full at its item, and
an executor who cannot satisfy the trap should stop and hand the item back
rather than improvise.

§2 is the items. §3 is **not worth it** — eighteen candidates the evidence
rejected, with the reason each was rejected, so the next pass does not spend
the search again. §4 records two defects found and NOT proposed as
simplifications. §5 is the suggested order.

---

## 2. The items

<a name="1"></a>
### 1. One test board harness, round 2 — `src/lobster/__tests__/**` and the rest of `src/tests/**`

**−240 / +40 · MECHANICAL · gate: the touched suites + `npx tsc`**

Round 2's item 1 landed: `src/tests/board-fixtures.ts` exists and exports
`makeSnake`, `makeSnakeAt`, `makeGameState`, `makeTurnData`,
`recordingContext`, `comparableFrame`, and six manager suites import it. **It
covered one directory and one shape.** The scan finds forty more copies of the
same four factories, and the largest block of them is in
`src/lobster/__tests__/`, which round 2 never looked at.

| factory | copies | lines | where |
|---|---|---|---|
| `makeSnake` / `snake` (body form) | **9** | 153 | `lobster/__tests__/candidates.test.ts:33`, `closing.test.ts:48`, `evaluate.test.ts:54`, `pathrisk.test.ts:35`, `staging-safety.test.ts:55`, `substrate.test.ts:34`, `tier-window.test.ts:30`, `tests/basic-intelligence.test.ts:45`, `tests/energy.test.ts:34` |
| `piece` | **16** | 96 | the seven above, plus `tests/basic-intelligence.test.ts:62`, `claim-collision-ceiling.test.ts:39`, `energy.test.ts:51`, `lobster-trio.test.ts:51`, `settle-partial-sever-pile.test.ts:102`, `team-decision-engine.test.ts:37`, `verify-operator-advice.test.ts:47`, `verify-operator-conformance.test.ts:58`, `verify-operator-turn-boundary.test.ts:36` |
| `boardOf` | **15** | 32 | the seven above, plus `basic-intelligence.test.ts:69`, `claim-collision-ceiling.test.ts:47`, `energy.test.ts:64`, `entrapment.test.ts:39`, `lobster-trio.test.ts:59`, `team-decision-engine.test.ts:45`, `verify-operator-advice.test.ts:50`, `verify-operator-conformance.test.ts:61` |
| `at` / `cell` (marshalled index) | **6** | 6 | `closing.test.ts:77`, `evaluate.test.ts:84`, `basic-intelligence.test.ts:72`, `claim-collision-ceiling.test.ts:51`, `energy.test.ts:67`, `entrapment.test.ts:41` |
| | **46** | **287** | |

Seven of the nine `makeSnake`s are byte-identical to the character to the copy
already sitting in `board-fixtures.ts:14-29` — the seven in
`src/lobster/__tests__/`. The remaining two are the same function under the
name `snake` (`basic-intelligence.test.ts:45`, `energy.test.ts:34`). Eleven of
the sixteen `piece`s are the same one-liner:

```ts
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });
```

`jest.config.js:4` sets `roots: ['<rootDir>/src']`, so
`src/lobster/__tests__/*.test.ts` can import `../../tests/board-fixtures`
today; nothing structural was stopping round 2's executor, they simply were
not asked to.

**The parameterisation.** Three more exports in the file that already exists,
each one of the existing copies verbatim:

```ts
/** A piece: one cell of occupancy, `length` carrying the WEIGHT. */
export const piece = (id: string, at: Coord, unitType: string, weight: number, extra: Partial<Snake> = {}): Snake =>
  makeSnake(id, [at], { unitType, length: weight, ...extra });
/** The 9×9 default the evaluate suites drive; `extra` carries food, hazards, size. */
export const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;
/** A coord as the marshalled full-board index, at a suite's own TURN. */
export const cellAt = (board: Board, turn: number, c: Coord): number =>
  marshalBoard(board, turn).toIndex(c);
```

`TURN` stays local to each suite: it is 12, 20, 30 and 40 across these files and
every value is load-bearing for the board it drives.

**Four sites do NOT convert, and the executor must leave them alone.**

1. `tests/energy.test.ts:51` — its `piece` builds a body of `weight` copies of
   the same cell (`Array.from({ length: weight }, () => at)`), so `body.length`
   equals `length`. Every other copy passes `[at]`. Keep energy's local, with a
   one-line comment saying which field it is exercising.
2. `verify-operator-{advice,conformance,turn-boundary}.test.ts` take `teamID`
   as a fifth POSITIONAL rather than in `extra`. Convert the call sites
   (`piece('x', c, 'rook', 3, { teamID: 'red' })`) or keep three local
   one-line adapters; do not change the shared signature to match them.
3. `verify-operator-{advice,conformance}.test.ts:50,61`'s `boardOf` returns an
   `ApiBoard` and takes a `size`. Different type, different arity — leave.
4. `tests/waypoint.test.ts:26` and `contest-tie-and-sever-outcomes.test.ts:56`
   already carry deliberate local variants (head-and-length, and a positional
   `teamID`); round 2 ruled on both.

**Special case removed.** Forty-six separate definitions of what a `Snake`, a
piece, a `Board` and a cell index *are*, in a repo whose whole architecture is
"one engine, one seam". A new required field on `Snake` is today a nine-file
edit the type checker catches plus a thirty-seven-file edit of default values
it does not.

**Abstraction parameterised.** None invented. The `extra: Partial<Snake> = {}`
seam is already in all sixteen `piece`s and all nine `makeSnake`s; this makes
it the only one.

**Gate.** Fixtures, not assertions, so the suites are the whole gate:
`npx jest src/tests src/lobster/__tests__` plus `npx tsc`. No production code
is touched. Commit per five-or-so suites, not one commit of twenty files.

---

<a name="2"></a>
### 2. One durable write queue — `src/logic/command-logger.ts` + `src/logic/decision-logger.ts`

**−280 / +150 · MECHANICAL, one named trap · gate: the write path + `npx tsc`**

The two loggers are **one queue-worker written twice**. Not similar: the same
fields in the same order, the same methods with the same bodies, the same
comments.

| member | `command-logger.ts` | `decision-logger.ts` | difference |
|---|---|---|---|
| the six queue fields + three worker fields | `:50-64` | `:146-160` | `MAX_QUEUE_SIZE` 20000 vs 50000 |
| `constructor` + `getInstance` | `:66-75` | `:162-172` | class name |
| `enqueue` | `:107-136` | `:299-328` | the droppable test: `item.droppable` vs `item.kind === 'movesets'`; the dropped-row log line |
| `signalWakeup` | `:138-144` | `:330-336` | **none** |
| `waitForWork` | `:146-150` | `:338-342` | **none** |
| `runWorkerLoop` | `:152-178` | `:344-366` | the batch step (see the trap) |
| `withRetry` | `:180-200` | `:382-404` | the log line, and `writeEventRows([row])` vs `this.apply(item)` |
| `shutdown` | `:312-329` | `:574-597` | default timeout 2000 vs 4000; one extra success line |
| `getQueueStats` | — | `:599-605` | only one has it |

`signalWakeup` and `waitForWork` are byte-identical. So is the retry ladder's
backoff line — `this.RETRY_DELAY_MS * Math.pow(2, item.retries - 1) * (0.5 + Math.random() * 0.5)`
— and so is the amortised-O(1) drop scan, comment included:

```ts
// Amortized O(1): everything before dropScanFrom is undroppable, so
// resume the scan there; droppableCount > 0 guarantees a hit.
```

That comment states an INVARIANT — `!queue[i].droppable for all i < dropScanFrom`
(`command-logger.ts:56-59`, `decision-logger.ts:151-154`) — and it is asserted
twice, maintained in two places, and tested twice. `logger-queue.test.ts`,
`logger-shutdown-deadline.test.ts` and `logger-db-gate.test.ts` each contain
two tests that assert the SAME property of the two classes
(`logger-queue.test.ts:95` and `:153`; `logger-shutdown-deadline.test.ts:48`
and `:66`; `logger-db-gate.test.ts:37` and `:51`), and both reach through
`(logger as any).MAX_QUEUE_SIZE` and `logger.queue` to do it
(`logger-queue.test.ts:54-63`). Two implementations of one policy, pinned by
two copies of one test, through a private the tests have to lie about.

**The parameterisation.** One class in a new `src/logic/write-queue.ts`:

```ts
/**
 * A DURABLE WRITE QUEUE: a bounded queue with a drop preference, a batching
 * worker, per-item exponential retry and a deadline-capped shutdown flush.
 * Enqueue is synchronous and never throws into the game path.
 */
export interface WriteQueueOptions<I> {
  /** The log prefix, e.g. 'CommandLogger'. */
  readonly name: string;
  readonly maxQueue: number;
  /** True for an item losing which costs nothing recomputable. */
  readonly droppable: (item: I) => boolean;
  /** The identifying tail of the "queue full" warning. */
  readonly describe: (item: I) => string;
  /** One batch, in whatever order this queue's writes must land. Called with
   *  `retry`, which applies ONE item under the retry ladder. */
  readonly flush: (batch: ReadonlyArray<I>, retry: (item: I) => Promise<void>) => Promise<void>;
  /** One item, once. Throwing schedules a retry. */
  readonly write: (item: I) => Promise<void>;
  readonly shutdownMs: number;
}

export class WriteQueue<I extends { retries: number }> {
  constructor(opts: WriteQueueOptions<I>);
  enqueue(item: I): void;          // the whole of both `enqueue`s
  shutdown(): Promise<void>;       // the whole of both `shutdown`s
  stats(): { queueSize: number; droppedCount: number; maxQueueSize: number };
}
```

`CommandLogger` keeps `logEvent`, `isAttention`, `getGameCommands`,
`getTurnEvents` and a `WriteQueue<{ row: TurnEventRow; droppable: boolean; retries: number }>`.
`DecisionLogger` keeps its four record methods, `apply`, `getTurnTimeline`, the
listings and a `WriteQueue<QueueItem>`.

**THE TRAP, and it is the only one.** The two `runWorkerLoop`s differ in the
batch step and the difference is load-bearing:

* `command-logger.ts:165-176` tries ONE bulk `writeEventRows(batch)` and falls
  back to `withRetry` per row only when the bulk insert throws.
* `decision-logger.ts:358-364` does NOT batch. It runs `withRetry` per item, in
  a fixed KIND ORDER — boards, then decisions, then movesets, then outcomes —
  and says why: *"Ordering within a batch is what lets a projection enqueued
  alongside its decision find one already written."* A `movesets` row inserted
  before its `decisions` row is a foreign-key failure that the retry ladder
  then burns three attempts on.

That is why `flush` takes the batch AND the `retry` function rather than being
a plain bulk write. The command logger's `flush` is
`try { await writeEventRows(batch.map(i => i.row)) } catch { for (const i of batch) await retry(i) }`;
the decision logger's is the four filtered loops, unchanged, calling `retry`.
**An executor who folds the two batch steps into one has broken the ordering
rule and `logger-queue.test.ts` will not catch it** — it drains a queue with
`setImmediate` against stubs. Preserve both bodies verbatim inside their own
`flush`.

**Special case removed.** A backpressure policy, a retry ladder, a wake
protocol and a shutdown deadline, each stated twice and each a correctness rule
rather than a convenience. `decision-logger.ts:107-114` explains at length why
`movesets` is the one droppable kind and `command-logger.ts:97-105` explains at
the same length why an attention tick is; after this, "which item may be
dropped" is one function passed in, and the machinery that honours it has one
home.

**Gate.** The three write-path suites, which already test both classes, plus
`npx tsc`. No decision, no move and no bound is touched, so the byte-identical
runner is not needed — but `src/index.ts:145` and the graceful-shutdown path
both hold these singletons, so run `npx jest src/tests/logger-*.test.ts src/tests/server-event-logger.test.ts` together.

---

<a name="3"></a>
### 3. The lens store's read half is dead — `src/lens/store/persistence.ts`

**−135 / +0 · MECHANICAL · gate: `npx tsc` + `npm run lens:check` + lens determinism**

Consumer counts over `src/**`, `scripts/**` and `tools/**` for every export of
this 413-line file:

| export | lines | consumers |
|---|---|---|
| `readTurnBoard` | `:85-105` | 1, and it is `loadTurnStore` below |
| `readGameEvents` | `:155-166` | **0** |
| `readDecision` | `:198-227` | **0** |
| `readDecisionIds` | `:327-345` | **0** |
| `readUnitOutcomes` | `:370-404` | **0** |
| `loadTurnStore` | `:396-413` | **0** |
| `readTurnEvents`, `readMovesetRows` | | `scripts/lens-rebuild.js:36-41` — **alive** |
| every `write*`, `deleteMovesetsFor`, `RosterEntry` | | `logic/decision-logger.ts`, `logic/command-logger.ts`, `scripts/lens-measure.js`, `logic/turn-timeline.ts` — **alive** |

`loadTurnStore` is the interesting one, because it is the reason the other five
look alive. Its docstring (`:396-405`) describes the replay seed — and
`lens-replay-parity.test.ts:19` says, in its own header, that the replay path
is *"two reads away from"* it, then builds the store with `storeFromRows`
directly (`:352`, `:373`, `:409`). So the convenience wrapper was superseded by
the thing it wraps and nobody deleted it, and it is holding `readTurnBoard`
alive by itself.

`readDecisionIds`'s docstring says it is *"what the rebuild walks"*
(`:327-328`). The rebuild — `scripts/lens-rebuild.js:36-41` — imports
`readTurnEvents`, `readMovesetRows`, `deleteMovesetsFor` and `writeMovesetRows`
and does not import it.

**The cut.** Delete the six functions. Then delete the now-unused imports:
`storeFromRows` and `decodeDecisionInput` from `./index` (`:24`, `:28`), and
`FrameStore` from `../types` (`:32`). Keep `and` (`readTurnEvents` uses it),
keep `UnitOutcomeRow` (`writeUnitOutcome` uses it), keep `TurnBoardRow`
(`writeTurnBoard` uses it), keep `reviveLens` and `storeFromRows`' own
definition in `store/index.ts:729` — `lens-replay-parity.test.ts` is its
consumer and that is a legitimate one.

**Special case removed.** A read API for a table nobody reads back, sitting in
the one file whose docstring (`:1-11`) promises *"the SQL, and nothing else"*.
Round 2's item 10 proposes a column table for `writeMovesetRows` /
`readMovesetRows`; **that item gets smaller and safer after this one**, because
four of the six functions it would have had to keep in step no longer exist.
Do this first and hand item 10 a two-direction file instead of an eight.

**Not proposed:** `getTurnTimeline`, `getGameCommands` and the listings on the
two logger classes. They read the same tables and they have live HTTP callers
(`src/routes/`), so they are the read API — this item deletes the second one.

---

<a name="4"></a>
### 4. One claims input from the marshalled board — `turn-oracle.ts`, `substrate.ts`, `window.ts`, `local-game.ts`

**−48 / +24 · MECHANICAL · gate: byte-identical runner + soundness sweep + `npx jest src/tests/entrapment.test.ts src/lobster/__tests__/tier-window.test.ts`**

A `PartialSettleInput` built from a `MarshalledBoard` is ten fields, and the
ten fields are written out **four** times:

| site | what it builds | the `held` trick |
|---|---|---|
| `substrate.ts:836-847` (`inputTemplate`) | the settlement template, cached | no |
| `window.ts:455-482` (`claimsPerHorizon`) | claims at each horizon `k` | yes, `:477` |
| `local-game.ts:990-1006` (`readPickup`) | claims at each window turn `k` | yes, `:1005` |
| `local-game.ts:1112-1128` (`entrappedAt`) | claims at each horizon turn `t` | yes, `:1127` |

The ten fields are identical everywhere: `...m.config`, `units`, `turn:
m.arrivalTurn`, `teamOf: Object.fromEntries(m.teamOf)`, `effects`, `potions`,
`potionsEnabled`, `potionWindowTurns`, `pawnPromotionWeight`, `maxTurns`.

Three of the four then carry the SAME line and, near enough, the same comment:

```ts
// `input.turn - observedTurn` IS the span a claim dilates over, so this is
// the board k turns on with nothing else assumed.
held: m.units.map((u) => ({ id: u.id, observedTurn: m.arrivalTurn - k })),
```

`window.ts:478-480`, `local-game.ts:1002-1004`, `local-game.ts:1124-1126`. The
third one even cites the second — *"asked of the rules rather than
reconstructed, exactly as `readPickup` asks them"* — which is a correctness
argument that depends on a line in a file it does not import.

**The parameterisation.** Two exports beside `marshalBoard` in
`src/logic/turn-oracle.ts`, which already owns `MarshalledBoard` and is already
imported by `substrate.ts:44-45`, `bounds/testkit.ts:36` and six suites:

```ts
/** Every field of a settle/claims input that the marshalled board fixes. */
export function settleInputBase(m: MarshalledBoard): Omit<PartialSettleInput, 'units' | 'held'>;

/**
 * The rules' own dilation, `k` turns on: every unit held at
 * `observedTurn = arrivalTurn − k`, because `input.turn − observedTurn` IS the
 * span a claim dilates over. One statement of it, for the window member, the
 * pickup reading and the entrapment instrument.
 */
export function claimsAfter(m: MarshalledBoard, k: number): ReadonlyArray<Claim>;
```

`inputTemplate` becomes `settleInputBase(this.marshalled)` **with its
`templateCache` kept exactly as it is** — the cache is the point of that method
(`substrate.ts:818-825` measures it) and the fold must not remove it.
`claimsPerHorizon`'s loop body becomes `out.push(claimsAfter(m, k))`;
`readPickup` and `entrappedAt` call `claimsAfter` directly.

**Special case removed.** One wire shape and one dilation rule, each stated
four and three times respectively, across the seam, an evaluator member and the
runner's two instruments. A field added to `SettleInput` upstream is today four
edits, three of which the type checker catches and one of which
(`substrate.ts`'s cached template) it catches only if the `Omit` is spelled
right.

**Byte-identity argument.** The produced objects are field-for-field identical
and `computeClaims` is a pure function of its input, so every claim list is the
same list. `entrappedAt` and `readPickup` are runner instruments and cannot
move a counter (`local-game.ts:1057-1059` states the rule), so the string-compare
determinism test is the tight gate; run the full A/B anyway because
`window.ts` is on the evaluation path.

**HELD, and do not fold it in:** `local-game.ts:1098`'s `entrapmentNeed` is
byte-identical to `territory.ts:813`'s `needOf`. See §3.2.

---

<a name="5"></a>
### 5. The generation rig stops being six parameters — `src/lobster/candidates.ts`

**−45 / +18 · MECHANICAL · gate: byte-identical runner + `npx jest src/lobster/__tests__/candidates.test.ts src/lobster/__tests__/staging-safety.test.ts`**

`GrammarCandidateGenerator` memoises three per-board tables on three
`WeakMap`s (`:420-424`) behind three one-line accessors (`shadowsFor:472`,
`regicideFor:478`, `victimsFor:483`) — round 1 item 10's `perBoard`, correctly
adopted. It then passes them, plus `knobs`, as four separate positionals
through every layer beneath:

| signature | the four |
|---|---|
| `generate` (`:506-513`) | `knobs`, `shadows`, `regicideCells`, `victims` |
| `generateAssessed` (`:528-537`) | the same four, forwarded verbatim (`:517-522`) |
| `assessOne` (`:796-806`) | the same four, plus `exposure` (`:594`) |
| `thinQuiet` (`:911`), `policyPrunes` (`:956`), `keepTierSafe` (`:1078`), `keepBestTier` (`:1097`) | `knobs` alone (`:609-612`) |

and the two public methods each spell the same six-argument call
(`:450-457` in `generateFor`, `:461-469` in `assess`), differing only in which
function they call and that one of them ends `.kept`.

**The parameterisation.** One rig, built once per (generator, board):

```ts
/** Everything generation reads that is a function of the BOARD, not the unit. */
interface GenerationRig {
  readonly knobs: Required<CandidateKnobs>;
  readonly shadows: ReadonlySet<CellIndex>;
  readonly regicideCells: ReadonlyMap<CellIndex, number> | null;
  readonly victims: VictimTable;
}
private rigFor(sub: EngineSubstrate): GenerationRig   // one perBoard, three closures folded in
```

`generate(sub, unitId, rig)`, `generateAssessed(sub, unitId, rig)`,
`assessOne(sub, unit, candidate, rig, exposure)`, and the four prune passes take
`rig.knobs` — or `rig`, which reads better and costs nothing. The name
`DecisionRig` is already taken by `candidates.ts`'s round 1 item 6 export; use
`GenerationRig`.

**Special case removed.** Adding a per-board table is today a four-signature
edit plus two call sites; after this it is one field. The generator's own
comment at `:296-317` is about which knobs the staging-safety flag implies, and
it has to be read next to four signatures that each carry `knobs` for a
different depth of reason.

**Allocation note, because this is the hot path.** The rig is built once per
substrate through `perBoard` — the same three `WeakMap`s, one extra object per
board rather than per unit — and passed by reference below. `generate` and
`generateAssessed` run once per (board, unit); `assessOne` runs per candidate
and gains a property read where it had four parameter reads. Prove it with the
node-clock A/B, which counts reads.

---

<a name="6"></a>
### 6. The evaluator's per-reading spine — `evaluate/bound.ts`, `features.ts`, `closing.ts`, `food.ts`, `territory.ts`

**−45 / +20 · MECHANICAL · gate: byte-identical runner + soundness sweep + `npx jest src/lobster/__tests__/evaluate.test.ts src/lobster/__tests__/closing.test.ts`**

Three small rules, each stated once in `bound.ts` and then re-spelled beside it.

**(a) `envelope`, four inline copies.** Round 1 item 9 introduced
`bound.ts:99`'s `envelope(a, b)` and folded seven copies into it. Four have
grown back:

| site | what it writes | what it is |
|---|---|---|
| `features.ts:623` | `bound(worst, (worst + best) / 2, best)` | `envelope(worst, best)` — `materialBounds` guarantees `worst ≤ best` |
| `features.ts:1143-1145` | `const a = Math.min(lo, hi); const b = Math.max(lo, hi); return bound(a, (a + b) / 2, b)` | `envelope(lo, hi)`, character for character |
| `closing.ts:162-164` | the same three lines | `envelope(lo, hi)` |
| `food.ts:202-204` | `bound(lo, (lo + hi) / 2, hi)` | `envelope(lo, hi)` — the docstring at `:180-183` states `lo ≤ hi` by construction |

`closing.ts` does not import `envelope` at all; `food.ts` does not either.
Two of the four are the whole of round 1 item 9's finding, written again by
members added after it landed.

**(b) The admission predicate, three copies.** `Admission<S>`
(`territory.ts:145-148`) is two methods, `ours` and `theirs`, and every reader
dispatches on the same boolean:

```ts
if (mine ? !admit.ours(s) : !admit.theirs(s)) continue;   // features.ts:1034, territory.ts:498
if (!(mine ? admit.ours(s) : admit.theirs(s))) continue;  // closing.ts:117
```

Note the third is the same test spelled with the negation on the outside. One
method on the interface — `admits(s: S, mine: boolean): boolean` — makes the
dispatch the type's, not the caller's, and the two spellings one.

**(c) `popcount32`, twice.** `features.ts:1055-1060` and
`territory.ts:1010-1015` are byte-identical, and `bits.ts` — the file whose
header says *"BOARD GEOMETRY AND BITBOARDS — arithmetic, and nothing else"* and
which already exports the whole-board `bbPopcount` (`bits.ts:66-76`) — does not
export the single-word one. Move it there, have `bbPopcount` use it, and import
it in both.

**(d) One optional extra, and it is the reason to do (a).** Three members are
the same three lines around a per-reading scalar:

```ts
evaluate(ctx) { if (ctx.horizonTurns <= 0) return point(0);
  return envelope(f(ctx, 'lo'), f(ctx, 'hi')); }
```

— `reachFeature` (`features.ts:682-688`), `commandFeature`
(`features.ts:962-968`), `approachFeature` (`closing.ts:157-165`). A
`perReading(ctx, of)` helper in `bound.ts` beside `ourUnitTerm` makes the
horizon guard and the endpoint choice one statement. This half is optional; (a)
through (c) are not.

**Special case removed.** *"Which endpoint is which is a property of the term's
sign, not of the reading, so the constructor decides it"* — `bound.ts:96-98`
says so, and four members decide it themselves anyway. After this the sentence
is enforced by there being nowhere else to write it.

**Byte-identity argument.** `envelope(a, b)` is `bound(min, (a+b)/2, max)`;
where the caller already knows `a ≤ b` the min/max are identities, and where it
does not (`features.ts:1143`) it computes them the same way. `admits` is the
same boolean. `popcount32` is the same function. Prove it on the runner and the
sixteen soundness arms, because `materialBounds` and `commandSum` are both on
the floor path.

---

<a name="7"></a>
### 7. The exports nothing calls, and the one nothing adopted

**−52 / +6 · MECHANICAL · gate: `npx tsc` + the named suites**

A per-export consumer count over `src/**`, `scripts/**` and `tools/**`, minus
the vendored tree, minus everything round 2 items 6 and 12 already claim
(`lens/kernel/index.ts`'s `attachLens` and `explainMoveset`, and
`substrate.ts`'s `assessments` / `coverOf` / `pathFor` — do not touch those,
they belong to those items). What is left:

| symbol | lines | note |
|---|---|---|
| `turn-oracle.ts` `healthAfterEntering` | `:790-808` | 19 lines, and its own docstring names its callers: *"MoveAnalyzer's hazard-step classification, the staged-move fatality probe"*. Both are gone. |
| `turn-oracle.ts` `projectedHealthCost` | `:810-818` | 9 lines, *"the name every scoring caller reads"* — there are none |
| `staging-legality.ts` `destCoordOf` | `:231-235` | 5 |
| `substrate.ts` `noOrderCandidate` | `:84-87` | 4 |
| `bits.ts` `bbClear` | `:44-47` | 4 — `bbSet` and `bbTest` are live; nothing ever clears a bit |
| `evaluate/index.ts` `territoryEvaluator` | `:359-361` | 3 — an alias of `defaultEvaluator` *"under the name that says what it carries"*, with zero importers |
| `evaluate/bound.ts` `negate` | `:88-89` | 2 — the only algebra member with no consumer |

**And one that is not dead, it is unadopted.** `staging-legality.ts:100-103`
exports `fullDims(board)` — *"the full-board dimensions are always
`board.width + 2` by `board.height + 2`"*, the file's own header rule
(`:19-25`). It has three internal callers (`:122`, `:138`, `:233`) and **zero
external ones**, because the three external sites write the arithmetic out:
`active-game-manager.ts:2795-2796`, `active-game-manager.ts:2958-2959`, and
`route.ts:324-325`. Two of the three then call `apiCoordToIndex(head, fullW, fullH)`
on the next line, i.e. they are doing exactly what `fullDims` was extracted for.
Adopt it at the two `active-game-manager.ts` sites (+2 imports, −4 lines);
`route.ts:324` takes `W`/`N` rather than a `Board` and stays as it is.

**Special case removed.** Seven public symbols that a reader has to check
before changing anything near them, and one perimeter rule with three
hand-written statements next to the function that states it.

**Gate.** `npx tsc` catches every deletion. Run
`npx jest src/tests/turn-oracle.test.ts src/tests/staging-legality.test.ts src/tests/route.test.ts src/lobster/__tests__/substrate.test.ts src/tests/piece-staging.test.ts`
for the `fullDims` adoption, which is the only half that changes a call site.

**Checked and NOT proposed:** twelve exported TYPES whose only uses are inside
their own file (`kernel.ts`'s `PinCacheStats`, `postures.ts`'s `PostureFlip`,
`tier-window.ts`'s `TierThreat`, `telemetry.ts`'s `TelemetryInput`, and eight
more). Un-exporting them deletes no lines and this repo uses `export` on a type
to say "this is the shape a reader should reach for". See §3.14.

---

<a name="8"></a>
### 8. Four call sites that never adopted `perBoard` — `evaluate/terminal.ts`, `evaluate/window.ts`

**−28 / +10 · MECHANICAL · gate: byte-identical runner + `npx jest src/lobster/__tests__/evaluate.test.ts src/lobster/__tests__/tier-window.test.ts`**

Round 1 item 10 landed `evaluate/memo.ts` — `perBoard` (`:18-24`) and
`perBoardPerTeam` (`:26-42`) — and its docstring says it replaced *"ten call
sites"*. Three hold-outs are in files written since, and one was missed:

| site | shape | fold |
|---|---|---|
| `terminal.ts:88-95` (`teamOfAll`) | `WeakMap<EngineSubstrate, …>` get-or-compute, five lines | `perBoard(teamMaps, sub, () => {…})` |
| `window.ts:455-457` + `:480-482` (`claimsPerHorizon`) | the same, keyed on `sub.marshalled`, with the store six lines below the load | `perBoard(CLAIMS, sub.marshalled, () => {…})` |
| `window.ts:485-493` (`windowRead`) | **`perBoardPerTeam` verbatim** — the `WeakMap<object, Map<number, T>>` lazy inner map, the team lookup, the miss | `perBoardPerTeam(READS, sub.marshalled, asTeam, () => {…})` |

`window.ts:440-445` even explains its key choice in the words
`memo.ts:9-13` uses — *"Keyed on the MARSHALLED BOARD, exactly as `contestField`
is and for the same reason"* — while not calling the function that exists to
carry that choice.

**Special case removed.** A cache whose store is six lines away from its load
(`claimsPerHorizon`) is a cache that can be returned from early; the combinator
makes that unrepresentable. `windowRead` is the third independent statement of
the two-level lazy map.

**Checked and NOT proposed:** `terminal.ts:75-82`'s `ofWeight` is an
ARRAY-indexed cache on a number, not an object key — `perBoard` cannot take it.
`evaluate/index.ts:172-192`'s `evaluations` is keyed on the resolution AND
guarded on the peril object, which is a two-key invalidation `perBoardPerTeam`
does not express; see §3.11.

---

<a name="9"></a>
### 9. `climb` covers the pair and the polish too — `src/lobster/search/core.ts`

**−22 / +12 · MECHANICAL · gate: byte-identical runner + lens determinism + `npx jest src/lobster/search/core.test.ts`**

Round 2's item 5 landed: `climb` exists at `:690-713` and `sweep` (`:724`),
`conform`'s repair (`:974`) and `repairSelfHarm` (`:1016`) call it. It folded
the three UNIT ascents. **Two more ascents were not in that table and still
hand-write the four-line accept step:**

```ts
const trial = s.bank.price(withMoves(best.plan, <moves>));
const verdict = better(trial, best);
observe(trial, best, verdict);
if (verdict.accept) best = trial;
```

| site | lines | proposal source |
|---|---|---|
| `climb` | `:707-711` | one candidate for one unit (`withMove`) |
| `pairRepair` | `:766-770` | a 2-opt pair (`withMoves`) |
| `jointPolish` | `:795-800` | a cross-product leaf (`withMoves`) |

`withMove` (`bounds/plan.ts:112-117`) is `withMoves` (`:119-124`) at one
element, so the three are one statement.

**The parameterisation.** One closure in the factory scope, beside `seat`:

```ts
/** Price one proposal against the incumbent and take it iff `better()` says so.
 *  ACCEPTANCE IS `better()` AND NOTHING ELSE — every rung inherits it here. */
const consider = (s: Session, best: BankResult, moves: ReadonlyArray<Candidate>): BankResult => {
  const trial = s.bank.price(withMoves(best.plan, moves));
  const verdict = better(trial, best);
  observe(trial, best, verdict);
  return verdict.accept ? trial : best;
};
```

`climb` calls `consider(s, best, [candidate])`; `pairRepair` calls
`consider(s, best, [ca, cb])`; `jointPolish`'s leaf calls
`consider(s, best, acc)`. Every budget check, every unit list and every
enumerator stays exactly where it is.

**Do NOT also generalise the enumerators.** `jointPolish`'s `walk` (`:790-803`)
allocates `[...acc, candidate]` per node on the hottest path in the system, and
folding it with `bank.ts`'s B3 walk is round 2 item 7's `crossProduct` bonus,
owned on `b1-sound`. This item touches the four accept lines and nothing else.

**Special case removed.** Round 2's item 5 argued that
`repairSelfHarm`'s docstring makes the acceptance claim *"in prose about a body
that has to be read to be believed"*. Two more bodies still have to be read.
After this, five rungs share one four-line function and a sixth inherits it.

**Byte-identity argument.** The one array allocation per proposal replaces the
one `Map` copy that `withMove` already made; `observe` is called on the same
trials in the same order, which is what lens determinism pins.

---

<a name="10"></a>
### 10. One snake-registration step — `src/server/active-game-manager.ts`

**−32 / +10 · MECHANICAL · gate: `npx jest src/tests/piece-staging.test.ts src/tests/waypoint.test.ts src/tests/staged-move-turn.test.ts src/tests/canonical-pipeline.test.ts`**

Eight lines, byte-identical, four times:

```ts
for (const snake of <snapshot>.board.snakes) {
  if (!game.snakes.has(snake.id)) {
    game.snakes.set(snake.id, { id: snake.id, name: snake.name, letter: snake.letter || '' });
  }
}
```

`:993-999` (registration), `:3194-3201` (`updatePieceTurn`'s defensive
advance), `:3734-3742` (`setBotRecommendation`'s defensive advance),
`:3897-3904` (`updateBoard`, the intended path).

Two of the four are inside a longer copy: `:3186-3203` and `:3726-3744` are the
SAME defensive block — the same `console.warn` naming a different method, the
same two field assignments, the same registration loop, the same
`boardUpdated = true`. Their own comments say they should not run:
*"Defensive only: updateBoard should have advanced the board already"*.

**The parameterisation.** Two private methods:

```ts
/** Learn every unit on a snapshot. First write wins: a name is never regressed. */
private rememberSnakes(game: ActiveGame, snakes: ReadonlyArray<Snake>): void
/** The defensive board advance, which should never fire — see updateBoard. */
private advanceDefensively(gameId: string, game: ActiveGame, from: string, gs: GameState): boolean
```

`advanceDefensively` takes the calling method's name for the warning, which is
the only thing the two copies differ in.

**Special case removed.** Four statements of "what the manager knows about a
unit" and two of a defensive path that is documented as unreachable. A field
added to the `SnakeInfo` record is today a four-site edit.

**Gate.** No decision path is touched — `game.snakes` feeds the broadcast and
the operator listing. The four piece/staging suites drive all four call sites.

---

<a name="11"></a>
### 11. `partitionOf`'s arguments ride the reading — `src/lobster/evaluate/territory.ts`

**−26 / +12 · MECHANICAL · gate: byte-identical runner + soundness sweep + `npx jest src/tests/territory-acceptance.test.ts src/tests/entrapment.test.ts src/lobster/__tests__/evaluate.test.ts`**

`partitionOf` (`:452-485`) takes **ten** positional parameters. It has **one
caller**, `features.ts:424-435`, and its generic `<S extends TerritorySubject>`
has exactly one instantiation, `Standing`. Four of the ten arguments are
functions of one of the others:

```ts
partitionOf(ws, standing, ctx.shells(), asTeam,
  ADMISSION[reading],              // = f(reading)          features.ts:429
  reading,
  sub.arrivalTurn,
  sub.arrivalTurn + horizonTurns,
  ws.domainFor(reading),           // = f(ws, reading)      :296-299
  ws.certainDomainFor(reading))    // = f(ws, reading)      :300-303
```

and the parameter list carries 24 lines of comment justifying the three that
are NOT derivable (`reading` itself at `:463-467`, `arrivalTurn` at `:469-470`,
`claimHorizonTurn` at `:472-479`) — which is the right amount of comment for
three parameters and reads as noise across ten.

**The parameterisation.** Move the three derived arguments inside:

```ts
export function partitionOf<S extends TerritorySubject>(
  ws: TerritoryWorkspace,
  subjects: ReadonlyArray<S>,
  shells: ReadonlyMap<UnitId, UnitShells>,
  asTeam: number,
  admit: Admission<S>,
  reading: 'lo' | 'hi',
  arrivalTurn: number,
  claimHorizonTurn: number,
): Partition<S>
```

with `domain = ws.domainFor(reading)` and `certainDomain = ws.certainDomainFor(reading)`
taken from the workspace at the top of the body. **Keep `admit` a parameter** —
`ADMISSION` lives in `features.ts` (`:574-577`) and is typed `Admission<Standing>`,
so pulling it in here would invert the dependency and pin the generic to
`Standing`. Keeping it is what preserves the file's own rule:
*"`asTeam` decides `mine`; `admit` decides who is on the board at all"*
(`:449-451`).

**THE TRAP.** The two default values being deleted
(`domain: Uint32Array = new Uint32Array(ws.grid.words)` at `:482`, and the same
for `certainDomain` at `:484`) exist *"for callers that ignore it"*. There are
no such callers — `features.ts:424` passes both, always. But `Partition.domain`
(`:171-186`) requires the two readings to hold SEPARATE boards, and
`features.ts:415-420`'s shared-twin path relies on it. An executor who reuses
one board for both readings has silently made the second reading overwrite the
first, and the runner A/B is the only thing that will say so. Take the boards
from `ws.domainFor(reading)` / `ws.certainDomainFor(reading)` and from nowhere
else.

**Also in this edit, two loops that price the same room.** `:594-603` and
`:614-628` both compute

```ts
const need = needOf(reading === 'lo' ? s.weightMax : s.weightMin);
const horizon = needOf(reading === 'lo' ? s.weightMin : s.weightMax);
… keptOf(ws, head, s.kind, s.unitId, clouds, bodyGen, arrivalTurn, claimHorizonTurn, need, horizon)
```

with the same ten arguments in the same order. The second loop is the
deliberate "our own units this reading does not admit" pass (`:605-613`
explains why at length, and the explanation is the item's whole point — it must
survive). One local closure `roomFor(s: S, mine: boolean): TrailRoom<S>` is
both bodies, called from both loops with `mine` fixed. −11 lines and the
endpoint-flip comment at `:585-591` stops being attached to only one of the two
places that flips.

**Special case removed.** Ten positionals whose order is invisible at the one
call site, four of which are the reading spelled a fourth, fifth, sixth and
seventh time; and one per-unit pricing rule written twice thirteen lines apart.

---

<a name="12"></a>
### 12. One inspection port type — `websocket-server.ts` and `lens/store/sources.ts`

**−12 / +2 · MECHANICAL · gate: `npx tsc` + `npx jest src/tests/lens-inspection-cost.test.ts`**

`websocket-server.ts:94-102` declares `LensInspectionPort`. It is byte-identical
to `sources.ts:219-226`'s `InspectionPort`, which sits directly above
`makeInspectionPort` (`:234`) — the factory that is the only thing in the repo
that ever builds one.

The wiring makes the duplication visible:

```ts
// firebase-interface.ts:82-83
import { makeInspectionPort } from '../lens/store/sources';
import type { LensInspectionPort } from '../server/websocket-server';
// firebase-interface.ts:1130-1131
lensInspectionPort(): LensInspectionPort { return makeInspectionPort({ … }); }
```

The Firebase layer imports a TYPE from the server layer to describe an object
the lens layer makes. `InspectionPort` itself has zero importers outside
`sources.ts` — it exists, it is correct, and the two consumers use the copy.

`sources.ts:200-212` states why the type belongs there: *"It lives here, beside
`askConditional`, because the two rules it enforces are the source's rules and
must not be re-stated on the wire… A handler that reached for the kernel port
directly would be a second implementation of both."* A second declaration of the
type is the smallest possible version of that.

**The cut.** Delete `websocket-server.ts:94-102`; `import type { InspectionPort } from '../lens/store/sources'`
and use it at `:139` and `:142`. `firebase-interface.ts:83` imports from
`../lens/store/sources` instead, and `:1130`'s return type becomes
`InspectionPort` — which also lets `:82` and `:83` become one import line.

**Special case removed.** A structural type with two names across three layers,
where one of the names is in the layer that must not own it. After this the
dependency runs server → lens and firebase → lens, and nothing runs firebase →
server.

---

## 3. Not worth it — eighteen candidates, and why

Recorded so the next pass does not spend the search again. Numbers 1–5 are
things the brief pointed at directly.

**3.1 The entrapment merge's dead code — there is none.**
`da8529d` deleted `crowdCertain`, `roomSum` and the per-unit ownership planes,
and it deleted them cleanly. A symbol sweep for all three over `src/**` returns
only prose: `features.ts:737` and `territory.ts:60,84` name them in the
docstrings that explain what replaced them, and
`territory-acceptance.test.ts:264,301` and `evaluate.test.ts:1685` name them in
the comments that explain why the numbers those tests assert changed. Those
five citations are the record of a design decision and should stay. Every
member of `Partition` (`territory.ts:170-207`) has a live reader, `TrailRoom`
is read by `features.ts:802-803` and `candidates.ts:469`, and `needOf`,
`tierAtTurn` and `workspaceFor` are all live. **Nothing to delete.**

**3.2 `entrapmentNeed` and `needOf` are two copies on purpose.**
`local-game.ts:1098` is byte-identical to `territory.ts:813` and both restate
the same `max(4, L + 2)` docstring. Sharing the constant is tempting and is a
mistake: `local-game.ts:1046-1059` states that the instrument *"settles nothing,
evaluates nothing, reads no clock and makes no evaluator call"* and that this is
*"what lets it be merged on a gate that says byte-identical and means it"*. It
is the falsifier for the member it duplicates; a falsifier that imports its
subject's constant is a falsifier that cannot see a change to it. **Keep both.**
Item 4 touches `entrappedAt`'s claims input and must not touch this line.

**3.3 `entrappedAt` and `keptOf` are two implementations on purpose.**
`local-game.ts:1100-1200` is a second, independent barred flood — `computeClaims`
and a `Set`-based region, against `territory.ts:948-1008`'s interned shells and
stamped grids. Same reason as 3.2, and `entrapment.test.ts` exists to make them
agree. **Do not merge.**

**3.4 `foodFeature` does not fold into `ourUnitTerm`.**
`food.ts:193-206` is a mean over our units of a signed per-unit reading and
looks exactly like `bound.ts:157-189`. It is not: its divisor `ours` counts
every unit on our team (`:191-193`), including HELD ones, where `ourUnitTerm`'s
counts only `!s.held` (`bound.ts:164`). Folding it changes the divisor on any
board with a held teammate, which is a behaviour change and probably a
soundness one — `features.ts:786-790` records that exactly this divisor
mistake put `lo` 1.5 above ninety worlds. Item 6 takes the `envelope` line and
stops.

**3.5 `energyEconomyFeature` does not fold either.**
`features.ts:836-852` states the alive-set polarity rule inline for a fourth
time, which looks like `ourUnitTerm`'s job. It is a SUM over both teams, not a
mean over ours, and it has no divisor at all. Different fold.

**3.6 `ServerEventLogger` does not join item 2's `WriteQueue`.**
`server-event-logger.ts:80` keeps *"a chain of pending writes so shutdown() can
flush what's in flight"* — no bounded queue, no drop preference, no retry
ladder, no batching. Its own header (`:56`) says events are *"dropped"* rather
than retried, deliberately. It is a different discipline and folding it in
would give it three behaviours it was written not to have.

**3.7 Splitting `active-game-manager.ts` (4,179 lines) or `kernel.ts` (3,253).**
Same finding round 2 recorded for `local-game.ts`: the sections are real and
separable and nothing imports any of them independently, so a split is motion
without a consumer. The duplicate scan over both returns four hits total and
item 10 takes all four.

**3.8 `src/web/lens-view.js` still duplicates `src/lens/view/`, and is still
generated.** `scripts/build-lens-view.js` produces it, `npm run lens:check`
gates it (`package.json:19-20`). Re-confirmed at `d4c0886`; the store/view pairs
the scan reports (`store/index.ts:397` vs `lens-view.js:282`) are the
projection. Do not edit by hand, do not count the lines.

**3.9 The two `partitionOf`s.** `lens/kernel/partition.ts:173` and
`evaluate/territory.ts:452` share a name and nothing else — one partitions
units into clusters, one partitions the board into ground. They never appear in
one file. Renaming either is churn against a hundred call sites for a collision
that does not compile-collide.

**3.10 `bodyBarriersOf` and `cloudsOf` sharing one walk.**
`territory.ts:845-877` and `:910-928` both walk `subjects`, both gate on
`leavesTrail(s.kind)` and `barsIn(s, reading)`, and both look up `shells`. They
then do entirely different things — one stamps a grid per occupancy cell, one
pushes a pooled cloud — and both run per reading per evaluation. A shared walk
taking two callbacks puts a closure call per subject per reading on the path
`territory.ts:238-241` measures at *"15–27% of plan throughput"*. Not worth it.

**3.11 `evaluate/index.ts:172-192`'s `evaluations` adopting `perBoardPerTeam`.**
Its key is the resolution AND a guard on the peril object
(`slot.peril !== peril` at `:187`), i.e. a two-key invalidation. `perBoardPerTeam`
takes one object key and cannot express it without growing a parameter that
only this caller would use.

**3.12 `substrate.ts:853-868`, `settleInputFor` / `settleScratchFor`.**
Round 2 §3 held these; re-checked and the ruling stands. The second is a
deliberate allocation-free re-point of a shared scratch, with the measurement
in the docstring above it. Item 4 touches `inputTemplate` and must leave both.

**3.13 `voc.ts`'s test-only exports, `evaluate/closing.ts`, and the
`DepthColumn` family.** All three held by round 2 §3 for reasons that have not
changed; `closing.test.ts:783-831` still asserts that nothing imports
`closing.ts`, and the depth fields still have `06-LOOKAHEAD.md` behind them.

**3.14 Un-exporting the twelve file-local types.** `kernel.ts`'s
`PinCacheStats`, `PinContextEntry` and `BasisSnapshot`; `postures.ts`'s
`PostureFlip`; `tier-window.ts`'s `TierThreat`; `telemetry.ts`'s
`TelemetryInput`; `substrate.ts`'s `BoundedResolve`; `evaluate/terminal.ts`'s
`TerminalCap`; `evaluate/bound.ts`'s `UncertainInput`; `evaluate/calibration.ts`'s
`SpecialistFact`; `voc.ts`'s `Confidence` and `VacuityDemand`. Each is used
inside its own file and nowhere else, so the `export` is surface without a
consumer — but removing it deletes no lines and this repo uses `export` on a
type as documentation of the shape a reader should reach for. Item 7 takes only
the symbols that are dead outright.

**3.15 Round 2 item 7's `crossProduct` bonus.** `bank.ts`'s B3 walk and
`search/core.ts:790-803`'s `jointPolish` walk are the same recursive enumerator
with the same `[...acc, option]` allocation. Confirmed still true; it belongs to
item 7 and is owned on `b1-sound`. Item 9 stops at the accept step.

**3.16 `src/logic` restating the seam — it does not.**
`turn-oracle.ts:1-14` and `staging-legality.ts:1-16` both open by disclaiming
rule ownership and both delegate to `engine-vendor`; `staging-legality.ts:9-16`
records the mirror that used to exist and how it drifted. `substrate.ts:44-45`
imports `marshalBoard` from `turn-oracle.ts` rather than re-marshalling. The one
genuine restatement in the directory is the loggers (item 2) and the one
genuine unadopted abstraction is `fullDims` (item 7).

**3.17 `src/firebase` restating the seam — it does not either.**
`translate.ts:23-38` holds the only `apiCoordToIndex` / `toApiCoord` pair, and
every crossing in `src/logic`, `src/server` and `src/lobster` goes through it.
`firebase-interface.ts` is 1,917 lines of connection lifecycle with no
duplicate blocks above five lines. Its one seam problem is the imported type,
which is item 12.

**3.18 A shared harness for the three logger test suites.**
`logger-queue.test.ts:54-63` and its two siblings each build both loggers
through `new (X as any)()` and poke `MAX_QUEUE_SIZE`. It is tempting to hoist
that into `board-fixtures.ts`'s neighbour. Do it as a TAIL of item 2 and not
before: after the fold the cap is a constructor option and the poke disappears
on its own, so hoisting first would preserve a workaround the item deletes.

---

## 4. Defects found, deliberately NOT proposed as simplifications

### 4.1 `defaultEvaluator` and `territoryEvaluator` are the same object under two names, and one of them is documented as a choice

`evaluate/index.ts:355-361`:

```ts
/** The evaluator with the calibrated profile — the TERRITORY profile, which is
 * what production runs. */
export const defaultEvaluator = new BoundEvaluator();
/** The same thing under the name that says what it carries. */
export const territoryEvaluator = defaultEvaluator;
```

Item 7 deletes the alias because nothing imports it. What the alias was for is
the sentence beside `materialEvaluator` at `:363-365`: *"the explicit fallback
profile if territory ever has to be backed out"*. There is no such switch and
no caller that could flip one — the profile is baked into `BoundEvaluator`'s
default constructor. So the pair documents a capability the code does not have.
Deleting the unused half is safe and is item 7; **restoring the capability is a
design decision and is out of scope.** Recorded because the next person to want
a profile switch should know it was never wired, rather than reading `:363` and
believing it was.

### 4.2 The two `Uint32Array` defaults on `partitionOf` are a live footgun with no live caller

`territory.ts:480-484` gives `domain` and `certainDomain` defaults —
*"Defaults to a fresh board for callers that ignore it"* — while
`Partition.domain`'s own docstring (`:180-186`) says the boards are
*"Owned by the caller's slab, not the workspace's: the two readings are cached
side by side on one context, so a shared scratch board would have the second
reading silently overwrite the first's."* A caller who took the default for
both readings would allocate two boards and be correct; a caller who took it
for one and passed `ws.domainFor(reading)` for the other would be wrong in a
way nothing asserts. There is exactly one caller and it passes both, so this is
latent. Item 11 removes it by removing the parameters. Recorded separately
because if item 11 is not executed, the defaults should still go.

---

## 5. Suggested order

1. **Item 1 first and alone.** It touches no production code, it is the
   largest, and every later gate runs in a tree where the fixtures compile from
   one place. One commit per five suites.
2. **Item 3, then item 7.** Two deletions; `npx tsc` is most of the gate, and
   item 3 shrinks round 2's item 10 before anyone starts it.
3. **Item 2.** Alone, with the three write-path suites, and read the trap twice.
   Nothing else in this document touches `src/logic`.
4. **Item 12, then item 10.** Two small edits, two different layers, `npx tsc`
   plus the named suites.
5. **Item 4, then item 6, then item 11, then item 8.** All four are in the
   evaluator and the seam. Run the byte-identical runner AND the soundness
   sweep **between** each of them, not after the four: an all-zero
   `ab-compare` after four stacked edits tells you they cancelled, not that each
   was sound. Item 11 last of the four, because it is the one with a trap.
6. **Item 5, then item 9.** Candidate generation, then the search's accept step;
   the node-clock A/B is the gate for both because both change how many reads
   the hot path makes.

Round 2's items 6 and 8–15 are unaffected by everything above except item 3,
which makes item 10 smaller, and item 9, which must land after `b1-sound`
merges if item 7's `crossProduct` bonus is taken.
