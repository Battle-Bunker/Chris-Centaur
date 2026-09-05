# REVIEW-1 — a correctness review of the working branch before merge

Scope: `git diff origin/develop...HEAD`, correctness only (three simplification
plans already ran, so nothing here is about style or shape). Reading order was
the seam and the bound ladder first, then the kernel and search, then evaluate,
then the lens, the loggers, the server and the translate layer.

`src/engine-vendor/**` is byte-for-byte from TacticToes and out of scope. It is
flagged where a finding touches it, never edited. Nothing in it needed flagging.

`src/lobster/evaluate/contest.ts`, `calibration.ts`, `law-sweep.test.ts` and
`contest-occupied-cell.test.ts` belong to another reviewer and were not read.

---

## Confirmed and fixed

### 1. A modelled sibling read its parent's memoised peril — `1c27c64`

`substrate.ts::withModelled` builds a sibling with `Object.create(parent)`, so
every mutable scalar resolves up the prototype chain until the sibling writes
it. `perilCache` is such a field and `perilOf()` reads it before it writes it,
so a sibling created AFTER the parent had memoised returned the PARENT's peril
set, computed over the parent's held set.

Peril is the ONE view-dependent reading, and three caches witness on the set's
identity: `substrate.ts::resolveBoundedFor` (the per-frame material fold),
`bounds/material.ts::claimSurvivals`, and `evaluate/index.ts::evaluatePlan`'s
per-resolution memo. An inherited set therefore handed the sibling the parent's
fold and the parent's evaluation as well.

Two ways it was wrong at once: the answer depended on CALL ORDER (asked before
its parent the same sibling returned the right set, asked after it the wrong
one), and on the decision path the parent always memoises first, because B0
resolves before the bank models anything. Direction: a held unit the sibling has
proved safe is priced as possibly-gone, which understates that team's
certainly-kept material and lifts our floor — the unsound direction.

Fix: the sibling gets its own `perilCache` slot. Regression beside the other
sibling tests in `src/lobster/__tests__/substrate.test.ts`, asserted both
parent-first and sibling-first, which is what used to disagree.

It moves play — `mixed` and `potions` counters both change on
`local-game sum all 20 3 --nodes`; `snakes` and `sparse` do not. The `mixed`
arm of `src/lobster/__tests__/lens-cost.test.ts` was re-pinned in `a284186`
after reading the transcript (the `snake` arm, which carries that file's actual
claim, is byte-identical at both budgets).

### 2. The horizon guard was keyed on the plan OBJECT — `1380107`

`search/core.ts::better()`'s rungs 4 and 5 decline to compare `est` and `hi`
across a horizon boundary (06 F-4, 08 F-10). They ask `horizonOfPlan`, which was
a `WeakMap` keyed on the plan object — and the search rebuilds a plan object on
every trial (`withMove`/`withMoves` return a fresh `Map`). An ascent that
wandered off the seeded assignment and came back to it arrived holding a
DIFFERENT OBJECT for the SAME assignment; the probe missed, the depth read 1,
and both rungs then decided against a reading proved two plies out, at an equal
floor, where no rung above them is watching.

Reproduced on `seededBoard(1, 6, 2)`: trial 0 is the seed at horizon 2 and
declines correctly; three trials later the ascent takes a rival; by trial 12 the
incumbent is the seed's assignment again, in a new object, reading 1, and `hi`
decides.

Latent on this build — `depthMax` is 1 and nothing produces a horizon above one
— so it changes no play today. The `lens-cost`, `lens-determinism` and
`local-game-determinism` pins are all unmoved by the fix, which is the evidence
for that. It was found because fix 1 moved which comparisons happen: F-10's own
arm had been passing on luck.

Fix: a fallback table keyed on `viewPlanKey` — the assignment's identity, which
is what a depth is a property of. Over-attributing a depth is the safe
direction, because a horizon that reads deeper makes the ladder DECLINE a rung
and fall through to the salted tie. Regression beside F-10; it reports `[2, 1]`
on the unfixed core.

---

## Findings not fixed

Each names how to confirm it. None is a wrong PLAY on this build; the first two
are reproduced, the rest are read from the source.

### F1 — a sibling's settlements are invisible to the parent's counter

`src/lobster/substrate.ts:1173` (`withModelled`), `:523` (`settlements`).

The same prototype-shadowing that caused bug 1 still applies to the other
mutable scalars: `settleCount`, `assessCount`, `shapeCache`, `templateCache`,
`settleScratch`. Only the counters are observable. `entryFor` does
`this.settleCount++`, which on a sibling creates an OWN property and leaves the
parent's untouched, so `settlements()` reads 0 on a substrate whose siblings
have settled — and its own docstring calls it "the currency the search's budget
is denominated in".

Reproduced: build a substrate, `withModelled([enemy])`, `resolveBoundedFor` a
plan on the sibling, read `sub.settlements()` — it is 0 while the sibling's is
1. Harmless today (only `src/tests/lobster-trio.test.ts` and telemetry read it,
and `bounds/testkit.ts` meters separately), fatal the day a budget reads it.
Fix would be a shared counter object, not an own field.

**REVIEW-2 verdict: CONFIRMED and fixed.** Reproduced exactly as written —
`sub.settlements()` read 0 with the sibling's reading 1. The two scalars are now
one `counters: { settle, assess }` object on the family, mutated in place
through the prototype, which is the shape `bounds/testkit.ts` already uses for
the same reason. Regression beside the other sibling tests in
`src/lobster/__tests__/substrate.test.ts`; it asserts both counters, and that
`settleMover` still meters apart from `resolveBoundedFor`. No pin moves —
nothing on the decision path reads either counter.

### F2 — `perilOf` on a B1/B3 view is computed on a board WE ARE ON

`src/lobster/substrate.ts:752` (`perilOf`), `src/lobster/bounds/bank.ts:406`
(`viewFor`).

`perilOf`'s whole point, in its own docstring, is to ask the peril question "of
a board WE ARE NOT ON", so that a plan that TAKES a piece does not score like
one that ignores it. It builds that board as `heldOutside(modeledIds)`. On the
parent, `modeledIds` is our team and the probe board is the enemies alone —
correct. But `BoundBank.viewFor([enemy])` builds a sibling whose modelled set is
ONLY the enemy (plus reference actions), so on a B1 or B3 view the probe board
holds our units too, and the peril of the other enemies then includes what OUR
units could do to them — in every plan alike, which is exactly the flattening
`perilOf` exists to prevent, re-appearing at B1/B3 branch scores.

Reproduced: on a red/blue board with `asTeam: 'red'`, the parent's claim set is
`B,C` and `sub.withModelled([B])`'s is `A,C` — our own `A` is held on the view
the bank prices B1 against.

Direction is safe, which is why this is a finding and not a fix: over-broad
peril turns an enemy claim from 'yes' to 'maybe', and in `scopedTeamValue`
(`bounds/material.ts:78`) a non-subject team's `best` — the endpoint that
subtracts from OUR ceiling — is the only one that reads 'yes', so the ceiling
only widens and the floor is untouched. For a held unit of OURS it drops the
unit from our `worst`, which lowers our floor. Both directions widen.

Confirming the behavioural cost: log `perilOf().size` for the parent and for
each `viewFor` sibling across a `mixed 20 1 --nodes` decision, and compare the
B1 branch spread on a plan that captures against one that walks away. The fix
would be for `viewFor` to model our commandable units alongside the enemy, which
moves play and belongs in its own change.

### F3 — the entanglement gate reads the plan, not the plan plus references

`src/lobster/bounds/bank.ts:561` (`price` calls `this.gate(plan, …)`, not
`this.gate(base, …)`; `base` is `withReferences(plan)`).

`footprintOf(plan)` therefore omits the staged paths of teammates this decision
does not command but has FIXED by reference, so a held unit entangled only with
such a teammate is not enumerated. Sound — the gate's own comment says missing a
unit only loosens a floor — but it loses B1/B3 coverage exactly where a fixed
teammate is the entangled one, which is the multi-seat case.

Confirm: a board with a reference-action teammate whose ray meets a held
enemy's claim, and no commandable unit near it; `gate()` returns an empty pool
and `members` carries B0 alone.

### F4 — `continuationDirection` dereferences an absent orientation

`src/firebase/translate.ts:100`, called from
`src/firebase/firebase-interface.ts:1656`.

`const f = turn.orientation[playerID]` then `f.dx`. Every other reader of that
map tolerates a missing key — `buildSnake` at `:323` spreads it, yielding `{}` —
so this is the one call that throws, and it throws inside a Firestore snapshot
handler. Not reproduced: the wire contract says orientation is present for every
living unit and the call site filters to `aliveOurs`. Hardening, not a bug.

### F5 — the lens reducer dedupes a `seq` against the events but not the anchor

`src/lens/store/index.ts:106` (`applyEvent`), `:118` (`upTo`).

`applyEvent` refuses an event whose `seq` is already among `store.events`, which
is what makes it idempotent per `seq` and safe to drive from either source. It
does not compare against `store.anchor.seq`, so an event arriving at the
anchor's own seq is appended and then folded twice by `upTo`, which concatenates
the anchor with the events. Not reproduced — the `seq` writer never reuses the
anchor's number — but the refusal is one comparison short of the property its
docstring claims.

### F6 — `conditionalBest` is filled from the UNCONDITIONAL reservoir too

`src/lens/store/index.ts:222` (`candidatesOf`'s contract), `:240`
(`noteCandidates`), and its two call sites in `frameAt` — the `movesets` case
and the `conditional` case, both passing `best: true`.

The contract says `conditionalBest` is "filled only where a conditional ranking
answered for that destination — every other candidate renders as `·`, never as a
bare number (04 §3 D-c)". The `movesets` case fills it from the plain reservoir,
so a destination no conditional ever answered for renders a number. Either the
comment or the `true` at the `movesets` call site is wrong; a reader cannot tell
which from the code. Confirm by folding a turn with `movesets` and no
`conditional` and reading `frame.candidates`.

### F7 — a cluster that has VANISHED is not a generation refusal

`src/lens/store/sources.ts:188` (`askConditional`).

The guard fires only when the named cluster is present at a different
generation; when it is absent from the live partition entirely — which is the
plainest reading of "the cluster the operator was LOOKING AT is gone" — the ask
falls through to `port.rankConditional`. Whether that is a typed refusal depends
on the port. Confirm with a port whose `partition()` no longer lists the asked
cluster.

### F8 — the shutdown deadline does not stop the worker

`src/logic/write-queue.ts:152` (`shutdown`).

At the deadline it logs "dropping N unflushed entries" and returns false, but
`runWorkerLoop`'s condition is `workerRunning || queue.length > 0`, so the
worker keeps draining after the deadline. Nothing leaks — `transientDelay` is
unref'd — but the line does not describe what happens, and a caller that treats
`false` as "the queue is abandoned" is wrong. Confirm with
`src/tests/logger-shutdown-deadline.test.ts`'s fixture plus a queue that is
still draining when the deadline fires.

### F9 — the facing probe stands on one fixed cell

`src/lobster/evaluate/shells.ts:407` (`orientationSensitive`).

`probe = floor(boardWidth * boardHeight / 2)` is the middle full-board cell, and
`rotationTargets` is asked there once and memoised PER KIND for the board. On a
board whose middle cell is a wall, or otherwise offers the kind no rotation, the
kind is recorded as facing-insensitive everywhere. Confirm by placing a wall on
the middle cell of an odd-by-odd board and reading `facingMatters('pawn')`.

### F10 — `canPromote`'s probe settles at the arrival turn under the turn cap

`src/lobster/substrate.ts:640`.

The probe calls `settleTurn` with `turn: m.arrivalTurn` and `maxTurns:
m.maxTurns`, then reads `settled.unitTypes[record.id] ?? record.type`. On a
board at or past the cap the settlement may end the game and carry no entry, so
the kind is memoised as non-promotable — for the rest of the decision, and the
answer is memoised per KIND. Confirm on a pawn one turn from `maxTurns`.

---

## Read and found clean

So the next reviewer does not repeat it. "Clean" means read line by line against
the bug classes in the brief — wrong results, unsound bounds, edge off-by-one,
unit/team mix-ups, stale reads across a turn boundary, async ordering, resource
leaks, degenerate boards — and nothing found beyond what is listed above.

**The seam and the bound ladder**

- `src/lobster/substrate.ts` — whole file. The pooled `unitScratch`/`heldScratch`
  and the single `settleScratch` are safe (nothing downstream retains either,
  and the claims door is called before the scratch goes live in `entryFor`);
  `keyOf`'s ascending fast path produces the identical string; the geometry
  cache key and `releaseGeometriesFor`'s prefix cannot collide; `entangled`
  excludes the `NEVER` sentinel and ignores `fromSubStep`, which is the
  over-approximating direction; RULE 4 is applied once (`observedTurn = turn −
  staleness`, nothing added for this turn).
- `src/lobster/pathrisk.ts` — whole file. The certain-halt rule, the
  `energySpent` bracket (`lo` charges through the halting cell, `hi` the whole
  traversal), the exhaustion `liftable` window (`i + 1 < spentAt`, i.e. strictly
  before the sub-step that spent it) and the empty-traversal path all check out.
- `src/lobster/bounds/score.ts` — whole file, including `mergeNormalForms` (two
  ascending deduplicated ledgers merge to the same array `Map`-set-if-absent
  over the concatenation produced, earlier group winning a tie),
  `unionOfAssumptionGroups`' distinct-group detection, `makeScoreBounds`'
  inversion and dishonest-exact refusals, and `justifier`'s per-endpoint
  citation.
- `src/lobster/bounds/material.ts` — whole file. `scopedTeamValue` flips the
  endpoints per participant relative to the subject and the two folds agree;
  `moverSeverLoss`'s `headAt` reconstructs `trackOf`'s head series correctly and
  its `assumedPresent` polarity is the one the ledger documents;
  `claimSurvival`'s two routes cover what `deathPossible` folds; `materialOf`
  cannot invert by construction.
- `src/lobster/bounds/ledger.ts`, `evalmemo.ts`, `memo.ts` — whole files. The
  memo proxy binds forwarded methods to the real target, so `perilOf` and every
  other method still sees the substrate as `this`; the `v{n}#` prefix cannot
  collide across view ids; the eval-memo namespace carries evaluator, basis and
  frame and the entry carries view and plan.
- `src/lobster/bounds/bank.ts` — whole file. B1's additive lemma, B3's
  eligibility (`coversEverything` and every list complete), `closeGroup`'s
  refusal to move a floor on an incomplete cover, `optionsFor`'s corroboration
  against the substrate's own enumerator, and the conditional-floor widening
  arm.
- `src/lobster/bits.ts` — whole file, including the degenerate `makeGrid(0, 0)`.

**Kernel, search, candidates**

- `src/lobster/search/order.ts`, `search/basis.ts` — whole files.
- `src/lobster/search/core.ts` — the comparison ladder, the session cache, the
  budget handle, `remember`'s rival eviction, `improve`'s seeding and restarts.
- `src/lobster/kernel.ts` — `PinContextCache` in full (`obtain`, `promote`,
  `invalidateCitingUnit`, `evict`), `pinContextKey`/`parsePinContextKey`,
  `SliceBudget`.

**Evaluate**

- `src/lobster/evaluate/index.ts` — the per-resolution evaluation memo and its
  witness, `checkWeights`/`checkCommandKnobs`, `explainPlan`'s weight read.
- `src/lobster/evaluate/terminal.ts` — whole file; `capVerdicts`' `arrivalTurn <
  limit` guard matches `adjudicate`'s own `turn >= maxTurns` exactly, no
  off-by-one.
- `src/lobster/evaluate/shells.ts` — the step-relation caches and the interning
  key (see F9 for the one probe).
- `src/lobster/evaluate/territory.ts`, `features.ts` — checked specifically for
  raw index arithmetic near a board edge: there is none. Both layers walk the
  engine's own step relation, which is what the seam's "nothing here is a rule"
  discipline buys.

**Lens**

- `src/lens/store/index.ts` — `applyEvent`, `upTo`, `boardHashOf`, `frameAt`'s
  whole switch, `unitRowsOf` (see F5, F6).
- `src/lens/store/sources.ts` — whole file (see F7). The three fields that may
  differ between live and replay really are the only three, and both sources go
  through one `makeSource`.

**Loggers, server, translate, config**

- `src/logic/write-queue.ts` — whole file. The amortised-O(1) drop scan keeps
  its invariant (`dropScanFrom` is only ever set to an index the scan proved
  undroppable below, and both decrements are correct); `droppable` is a stable
  per-item field in both loggers, so `droppableCount` cannot drift and the scan
  cannot run off the end; there is no missed wakeup, because `waitForWork`
  assigns `this.wakeup` synchronously inside the executor. See F8 for the one
  discrepancy.
- `src/logic/command-logger.ts`, `src/logic/decision-logger.ts` — the queue
  configuration and the batch ordering (board → decision → movesets → outcome
  holds across a batch boundary because enqueue order does).
- `src/server/websocket-server.ts` — `shutdown` in full: the remaining-count
  cannot reach zero mid-loop with sockets unprocessed, `terminate` still fires
  `close`, and the backstop timer is cleared on the winning path.
- `src/logic/turn-oracle.ts::marshalBoard` — the wall ring, `tierExpiry`'s
  inclusive→exclusive conversion, the index alignment between
  `marshalled.units` and `tierExpiry`, the `governing`/`listed` effect tally
  against `arrivalTurn`, and `potionsEnabled`'s precedence.
- `src/firebase/translate.ts` — whole file (see F4). `toApiCoord` and
  `apiCoordToIndex` are mutual inverses, `directionToMoveIndex` clamps at each
  edge, `moveIndexToDirection` refuses a non-adjacent pair,
  `parseLatestTurn` handles a doc with no turns.

**Instruments run**

- `local-game sum all 20 3 --nodes` with `CENTAUR_DEBUG_INVERSION=1`: no
  inversion on any scenario, before or after either fix.
- `sparse-lean` plumbing checked end to end: `sparse --food-energy=20` at 60
  turns / 3 seeds is byte-identical to `sparse-lean`, and both reproduce the
  `meals 45 / grown 38 / 0.84` row this scenario's own docstring records.
- Degenerate boards driven through the whole substrate surface — no units, a
  1×1 board with one unit, a 0×0 board, a 2×2 two-team board: `roster`,
  `claimsOf`, `perilOf`, `actionsOf`, `coverOf`, `slides`, `slidesToward`,
  `assess`, `canPromote`, `tiersAfterPickupBy`, `resolveBoundedFor`,
  `entangled`. No exception anywhere, and the empty board folds to an exact
  `[0, 0]`.
- `npx jest` over the whole suite: 97 suites, 1666 tests, green.
