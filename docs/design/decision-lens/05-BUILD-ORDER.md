# 05 — BUILD ORDER: delete first, fence second, cut third

DECISION-LENS, document 5. `04-SYNTHESIS.md` decided what the lens is; this
decides the order it is built in, and the order is the owner's: **delete the
tests that pin the old structure, write the new boundary tests, then rip out the
old code and build the new.** Larger changes, plotted, rather than a sequence of
small ones that each half-work.

Seven commits. Three of them run as parallel worktree sub-branches. Line counts
against `lens-synthesis` @ `d09ffbc`; anything marked *(est.)* is an estimate.

**Every step below assumes the one-engine rewrite's C5 is on `develop`**
(04 §6.2). L0 is the only step that may run before it.

---

## (a) The bulk delete — 5 files, 1,756 lines, before anything else

One commit, **L0**, that changes no source. That is the whole point of it: a
suite failure at L1 is then unambiguously about L1.

| file | lines | what it pins | why it goes |
|---|---|---|---|
| `src/tests/team-decision-telemetry.test.ts` | 609 | `decision_logs` rows under the default engine — *"no candidate, no number, no account of why the staged move was staged"* | It is the only test that names `decisionLogs`, and it pins `move_evaluations` as the shape of the account. 04 §5.1 #1 deletes the table; the account survives as `movesets` + `unit_outcomes`, which is a different shape and needs a different test. |
| `src/tests/unit-inspection.test.ts` | 466 | the selection/inspection seam, *"the same live and while scrubbing history"*, and the board-wide Voronoi partition on selection | Both halves die: the per-unit inspection shape (04 §5.3 #13) and the live/replay fork it asserts parity across (#16). Its one surviving assertion — `{sources, owner, distance}` at `:97-122` — is re-homed by the **rewrite** into `src/tests/territory-view.test.ts`, so **this delete is legal only after that file exists** (04 §6.2). |
| `src/tests/command-logging.test.ts` | 293 | `command_turn_states` snapshots *"in the live broadcast shape … so the history viewer can re-enact who commanded what through the same render paths live play uses"* | The intent is right and is the lens's own Law C; the mechanism is the denormalised snapshot 04 §2.7 deletes. Its operator-attribution property is re-asserted in `lens-events.test.ts` (§b). |
| `src/tests/board-controls.test.ts` | 255 | the Voronoi overlay switch *actually skipping the overlay's work*, including a candidate's projected grid | The overlay is deleted whole (04 §5.3 #14); a test that the switch skips work it no longer does is a test of nothing. |
| `src/tests/turn-timeline.test.ts` | 133 | the hybrid-format board-timeline merge and the slim decision-row serialization | The `SynthesizedTurnRow` path exists only for games logged before `turn_states` (04 §5.1 #5). No backwards compatibility. |

**The residue rule.** `territory.test.ts` (1,115), `territory-slider.test.ts`
(513), `voronoi-strategy.test.ts` (380), `fatal-path-projection.test.ts` (668)
and `decision-iterative.test.ts` (187) are all on the **rewrite's** C2 delete
list. The lens must not touch them: two branches deleting the same file is a
conflict on a commit whose entire value is that it produces no conflict.

**Kept deliberately, and it is worth saying which**: `territory-acceptance.test.ts`
(527) is a *feature* test on boards from real matches — the territory features
survive, only the paint layer dies. `canonical-pipeline.test.ts` (312) pins the
one-BoardSnapshot-per-turn pipeline that `turn_boards` is built on.
`logger-queue.test.ts` (143) and `logger-db-gate.test.ts` (66) pin queue
discipline and the `dbConfigured` gate, both of which survive the schema change
and are **retyped in L4, not deleted**. `clash-affordance.test.ts`,
`unit-tag-visibility.test.ts`, `keynav-machine.test.ts` and
`canvas-resolution.test.ts` pin board vocabulary the lens keeps (04 §5.3, "not
deleted, explicitly").

---

## (b) The boundary tests, written before the cut

One commit, **L1**, carrying **`src/lens/types.ts` — declarations only, no
runtime — plus nine test files**. Shipping the types with the tests departs from
the rewrite's C3 pattern (tests that do not compile) for one reason: L2, L4 and
L5 run in parallel worktrees and all three name `Moveset`, `ClusterView` and
`TurnEvent`. A shared declaration file landed once, before the fork, is the
difference between three tracks and three merge conflicts. The tests therefore
compile and **fail at runtime for want of an implementation**, which is a
strictly better signal than a compile error anyway.

### Kernel

| test | assertion | falsifier it must catch |
|---|---|---|
| `lobster/__tests__/lens-cluster.test.ts` (~420) | **The cluster law.** Over fixture boards: `members` = a connected component of `influenceOf(u) ∩ influenceOf(v) ≠ ∅` over `freeSet`; pinned / committed / reference-fixed units are absent from `members` and present in `boundedBy` with the right `why`; a `pin-unreachable` unit **is** a member; components are disjoint and cover `freeSet`; a lock never widens and an unlock never narrows (Law F, T1); `lineage` names both parents on a merge and the one parent on a split. Plus the D-5′ fog case (04 §3, O2), written now with `.failing` and un-skipped when cloud reach lands. | A slider fiat creeping back in (it makes one component of the board); a pinned unit surviving as a member; overlapping clusters (04 §3, Q3). |
| `lobster/__tests__/lens-reservoir.test.ts` (~380) | **Retention.** The reservoir holds ≤ `LENS_TOPK` per `(clusterId, complementKey)` and ≤ `LENS_ROW_CAP` per decision; its order is exactly `better()`'s `(lo, est, hi, tie)`; the staged plan's cluster restriction is **always** in the reservoir at rank 1 for the live complement; a row whose complement is no longer the incumbent's is `complement: 'stale'` and is never returned in the same list as a fresh one (Law E); `dominance` is null before the barrier and non-null after. | Reservoir order drifting from search order — the failure that would make a displayed rank a lie. |
| `lobster/__tests__/lens-conditional.test.ts` (~340) | **`rankConditional` equals what a lock stages.** For every unit and every candidate on a fixture board: `rankConditional(C, [u@m]).rows[0].moves` deep-equals the plan `conform(ctx ⊕ pin, wirePlan)` produces (Law B, head = `conform`); after CHANGE 2, the promoted context key is the one the epoch's `retarget` obtains, and `ConformanceSample.slicesBefore === 0` still holds across the promotion; `source: 'empty'` is reachable and is never rendered as a number; a request beyond the reserve returns a **typed refusal**. | The head silently becoming `improve`'s best-so-far — the one divergence that appears exactly when the operator is deciding whether to lock. |
| `src/tests/lens-determinism.test.ts` (~300) | **G1 + G2, under `local-game.ts --nodes`.** G1: run a fixture, serialise every `LensEvent`, re-run at the same seed and budget, byte-compare. G2: a `2b`-work run's frame sequence **extends** the `b` run's, byte for byte, up to the prefix. `conditional` frames are excluded from G2's prefix claim (speculative slices are scheduled on `slices % speculativePeriod`, so a longer run correctly visits a different set) and are covered by G1 only. | **This is the gate on CHANGE 1.** It must be green at L2 — *before* `better()` is refactored — so that L3 has something to break. |

### Data

| test | assertion | falsifier |
|---|---|---|
| `src/tests/lens-reducer.test.ts` (~260) | **Reducer purity.** `applyEvent` never mutates its input store (frozen-input check on every kind); `frameAt(store, seq)` is a pure function of `(anchor, events≤seq)`; folding a shuffled-then-`seq`-sorted array gives the identical frame; folding the same array twice gives identical frames; no `Date.now()`, no `Math.random()`, no `this` in the reducer module (asserted structurally). | A reducer that reads the wall clock — the single thing that would make replay silently disagree with live. |
| `src/tests/lens-frame-fold.test.ts` (~280) | **Frame fold equals live state.** Drive a real decision with the `lens` sink attached, capture the live `LensFrame` at every emission; independently fold the emitted `TurnEvent` array to the same `seq`; deep-equal, every seq, every field. This is Law C at the unit level and it is the same property G-L1 (§d) later asserts end-to-end through Postgres. | A frame carrying a delta rather than the whole thing (03 §5.1) — it folds correctly live, where the consumer saw the predecessor, and wrongly in replay. |
| `src/tests/lens-schema.test.ts` (~300) | **Round-trip and projection.** Every `TurnEvent` kind survives write→read byte-identically through `turn_events.payload`; `DecisionInput` round-trips; `unit_outcomes` reconstructs the per-unit result; **the `movesets` table equals the fold of the `movesets` frames** and the rebuild command regenerates it byte-identically after a `DELETE` (04 §2.7's licence condition); the retention fold of a 30-day-old turn leaves it inspectable — board, basis and decision survive and the re-derivation path still answers. Plus the property `command-logging.test.ts` carried: every operator command is recorded with its issuing operator's identity. | A materialised table drifting from its source — the exact defect that killed `command_turn_states`. |
| `src/tests/lens-events.test.ts` (~180) | **One writer, one order.** Under a concurrent decision, operator commands and a turn resolution, no two `turn_events` share `(gameId, turn, seq)` and `seq` is gapless and monotone (O6). `answers` on an emission names the operator event whose `ConformanceSample` measured it. `atWorkMs` is null, never 0, when unmeasured. | Two writers — the failure `decision-worker-pool.ts` would have caused, which the rewrite deletes. |

### UI

| test | assertion | falsifier |
|---|---|---|
| `src/tests/lens-cursor.test.ts` (~340) | **State machine.** All of T1–T17 minus the deleted T5, as a transition table driven from the frame: Law D's cascade re-defaults everything below the deepest explicit level; a focused unit never yields an empty moveset panel; choosing a moveset does not touch the candidate; hover never commits the cursor; §1.5 re-resolution by identity survives an emission that re-ranks the list, with the selection keeping its row at its new rank; determinations are legal **iff `at.isHead`**; `Space`'s pin set is `{u} ∪ {v : K(v) ≠ staged(v)}` and the rendered count equals `|P*|` exactly, with no `≤`. | The lock staging a different moveset than the one drawn — the display contract, tested rather than asserted. |
| `src/tests/lens-widen.test.ts` (~240) | **The reactive case.** Ada inspects α = {C,Q,s1}; Ben unpins R; α widens to {C,Q,s1,R}. Assert: nothing under the cursor moves; the old list is struck through and headed `stale @ seq n`, **never blanked**; the banner's timer is `min(6s, 0.25 × (turnExpiryTime − now))` and is suspended while the drill panel is open; an in-flight lock queues the widen behind it; on accept, the selection re-resolves against the old assignment restricted to the old members, and falls to rank 1 with a *displaced* badge when no new row contains it; the narrowing direction applies immediately with a footer note and no banner. Plus Law E: rows from two generations are never in one list. | Auto-accept firing under a reader's eyes — the specific failure the whole policy exists to prevent. |
| `src/tests/lens-view-model.test.ts` (~220) | **Live and replay render identically.** Build a `LensFrame` from `LiveDecisionSource` and one from `ReplayDecisionSource` at the same `(turn, seq)` of the same recorded session; assert the two frames are deep-equal **except** `at.mode`, `at.isHead` and `provenance.kind`; then assert the renderer, given both, produces identical draw-call transcripts. No renderer function may branch on mode (asserted structurally: no `mode ===` outside the badge component). | The two paths drifting — which the shipped code has already done (its live and replay empty states differ). |

**~3,060 test lines + ~300 type lines.** L1's expected green: **nothing new.**
The residue of the existing suite must still pass, exactly as the rewrite's C3
does, and that is the check that L0 removed only what it meant to.

---

## (c) The cut — five commits, three parallel tracks

| # | commit | may start when | expected green |
|---|---|---|---|
| **L0** | bulk delete: the 5 test files of (a). No source change. | now, but after the rewrite creates `territory-view.test.ts` | the remaining suite, in full |
| **L1** | `src/lens/types.ts` + the 9 boundary tests of (b) | L0 | *nothing new* — the surviving suite only |
| **L2** | **kernel surface I**: `KernelInput.lens` sink [CHANGE 3]; the partitioner and `ClusterView`/`ClusterEvent`; the reservoir written at the `better()` call site with `dominance: null`; the `partition`/`movesets`/`emission`/`operator`/`posture`/`refusal` frames; `EventId` on `PendingEvent` copied to the emission's `answers`; delete the dead `KernelReport` fields (04 §5.2 #11) and re-derive `slack` from the reservoir (#12). **No CHANGE 1.** | L1 | cluster law; reservoir retention; **G1 and G2**; the whole existing kernel/telemetry suite unchanged |
| **L3** | **kernel surface II**: [CHANGE 1] `better()` returns a `Verdict`; `DominanceCondition` filled at the barrier; `rankConditional` with the two-phase paint; [CHANGE 2] `promote` on epoch change; `explainMoveset` with its three tiers; `LENS_INSPECTION_MS` carved before `searchDeadline` with a typed refusal and a queue | L2 | everything L2 was, **still**, plus `rankConditional` = the staged plan under a lock. G2 is the gate: if CHANGE 1 reordered anything, G2 breaks here, loudly |
| **L4** | **storage**: the five tables + migration; the single-writer event log with `seq`; the `movesets` projection + rebuild command; the retention fold. Deletes `decision_logs`, `command_turn_states`, `turn_states.territory`/`.cell_ownership`, the telemetry shapes (04 §5.2 #7–#10), `turn-timeline`'s synthesized merge, `logic/decision-telemetry.ts`; retypes `logger-queue`/`logger-db-gate` | L1 | reducer purity; frame fold = live state; schema round-trip and rebuild; one-writer; the retyped logger tests |
| **L5** | **UI**: the reducer and two sources; `LensFrame`; the cursor machine; the board ink and glyphs; the four panels and the keymap; the timeline lane and the three modes. Deletes the live/replay fork, the stats tables, the territory overlay, `secondaryMove`, `moveEvaluations`-as-contract (keeping enumeration), `safeMoves`-as-display, the "no data" panels | L1 | cursor machine; the widen case; live/replay identical view-model; the surviving UI suite (clash, tags, keynav, canvas) |
| **L6** | **integration**: the seven wire envelopes end to end; the divergence check; the O1 instrumentation run and its recorded numbers; the two lens gates of (d) | L3 ∧ L4 ∧ L5 | **everything**, plus G-L1 and G-L2 |

### The tracks

```
L0 ─▶ L1 ─┬─▶ K:  L2 ─▶ L3 ─┐
          ├─▶ D:  L4 ───────┼─▶ L6
          └─▶ U:  L5 ───────┘
```

| track | commits | owns (the conflict surface) |
|---|---|---|
| **K** — kernel | L2, L3 | `src/lobster/kernel.ts`, `search/core.ts`, `search/basis.ts`, `voc.ts`, `telemetry.ts`, `src/lens/kernel/**` |
| **D** — data | L4 | `src/database/**`, `src/logic/decision-logger.ts`, `src/logic/turn-timeline.ts`, `src/server/active-game-manager.ts`, `src/lens/store/**` |
| **U** — UI | L5 | `src/web/**`, `src/server/websocket-server.ts`, `src/lens/view/**` |

**The three assignments that make the tracks disjoint.**
`active-game-manager.ts` goes to **D**, not U: it is the `seq` writer, and the
writer is a storage concern even though the UI reads what it broadcasts.
`websocket-server.ts` goes to **U**: the envelopes of 04 §4.5 are display
plumbing, and D writes rows rather than messages. `src/lens/types.ts` belongs to
**L1** and is frozen for the duration of the fork — a track that needs a type
change opens it as a one-line commit on `lens-synthesis` that all three rebase
onto, which happens once or not at all if L1 did its job.

**What must not be parallelised.** L2 and L3 look separable — one adds a sink,
the other refactors a comparison — but G2's whole value is that it is green
*before* CHANGE 1 and stays green after, so they must be sequential in one
worktree with the gate between them (03 §7.4). And L0 must overlap nothing: a
commit whose value is that it changes no source is worth nothing if something
else changed source alongside it.

**Merge order into `lens-synthesis`:** U, then D, then K, then L6. U is largest
and most mechanical; D depends on nothing K produces except types; K merges last
because L3's `better()` refactor is the change most likely to need a
re-measurement, and merging it last means the re-measurement is against a
settled base.

---

## (d) The gates before `develop`

### Inherited, and untouched by this work

The behavioural gates and the local runner belong to the one-engine rewrite and
the lens changes none of them. It must not **regress** them, which is a live risk
in exactly one place: L3's CHANGE 1 refactors the hottest function in the search
and L2's reservoir writes on every priced trial.

1. Full suite green; `npm run lint` clean.
2. `basic-intelligence.test.ts` green with counters **no worse** than the
   recorded pre-cut reading, on every gate.
3. Two 30-turn `local-game` transcripts (`SNAKE_SCENARIO`, `MIXED_SCENARIO`) read
   by a human and judged not-stupid.
4. `local-game-determinism.test.ts` green.

### Added by the lens

5. **G1 + G2** (from L1) green at L2 and still green at L3, L6.
6. **G-L1 — a recorded live session replays to identical frames.** Capture one
   real session: every websocket message, and the Postgres rows it wrote. Then,
   from the database alone, fold to every `(turn, seq)` the live client visited
   and assert the `LensFrame` is deep-equal to the one the live client held,
   field for field, excepting only `at.mode`, `at.isHead` and `provenance.kind`.
   This is Law C promoted from a unit property (L1's frame-fold test) to an
   end-to-end gate across the wire, the writer, Postgres and the reader — the
   four places a shape can drift. A failure names the `seq` and the field.
7. **G-L2 — inspection cost is bounded under the time budget.** Three
   assertions, on a fixture game, all falsifiable:
   - **(i) the reserve is declared, not taken.** `searchDeadline` is reduced by
     exactly `LENS_INSPECTION_MS` and by nothing else; assert against the recorded
     pre-lens deadline arithmetic.
   - **(ii) the sink is free when absent.** With `KernelInput.lens` undefined,
     the decision's evaluator-call count and node count are **byte-identical** to
     the pre-lens recording. This is 03 §0's headline cost claim — *"the lens adds
     no evaluation to the hot loop"* — made falsifiable rather than argued.
   - **(iii) the sink is cheap when present, and inspection cannot starve the
     decision.** With the sink attached and a synthetic inspector hovering
     continuously for the whole turn: evaluator calls inside `searchDeadline` are
     within 2% of run (ii); `ConformanceSample.slicesBefore` is still 0 on every
     conforming re-stage; and every request past the reserve came back as a typed
     refusal rather than as a served row.
8. **The projection rebuild is exact.** `DELETE FROM movesets` followed by the
   rebuild command reproduces the table byte-identically from `turn_events`.
   Without this, 04 §2.7's licence for the table does not hold and it goes the way
   of `command_turn_states`.
9. **The O1 measurement is recorded and the constants are confirmed.** One
   instrumented `local-game --nodes` run over both scenarios, **taken after the
   rewrite's C6** (or it measures a candidate set that no longer exists),
   reporting: emissions per decision; components per turn and their size
   distribution; distinct cluster restrictions priced; `TurnEvent`s per turn;
   `promote` hits vs epoch changes (03 §7.6); and the coverage curve
   `planDistance(staged, nearest retained row)` (03 §7.3). `LENS_TOPK`,
   `LENS_ROW_CAP` and the storage budget are then either confirmed against the
   numbers or changed, **in the commit message**, before merge. Three of the five
   measured questions of 04 §3 close here.

Gate 9 is the one that can send work back: if the coverage curve shows the staged
plan routinely far from every retained row, `k = 5` is wrong and L2 is re-tuned
before L6 merges. That is the intended failure mode of measuring rather than
guessing, and it is cheap because it is one loop over ≤24 rows.

---

## (e) Sizing

| # | commit | added | deleted | net | notes |
|---|---|---|---|---|---|
| **L0** | test bulk delete | 0 | 1,756 | **−1,756** | exact: 5 files, counted |
| **L1** | types + boundary tests | ~3,360 | 0 | **+3,360** | ~3,060 test, ~300 type |
| **L2** | kernel surface I | ~900 | ~250 | **+650** | partitioner ~220, reservoir ~260, frames ~200, sink+wiring ~120, `slack` ~40; deletes the six dead report fields and their telemetry copies *(est.)* |
| **L3** | kernel surface II | ~700 | ~60 | **+640** | `rankConditional` ~230, CHANGE 2 `promote` ~90, `explainMoveset` ~200, reserve+queue ~120, CHANGE 1 ~60 *(est.)* |
| **L4** | storage | ~1,300 | ~1,900 | **−600** | schema+migration ~350, writer ~300, projection+rebuild ~250, retention fold ~200, reducer store ~200; deletes the `decision_logs` writer, the telemetry shapes, the timeline merge, `decision-telemetry.ts` (42, exact) *(est.)* |
| **L5** | UI | ~1,400 | ~2,600 | **−1,200** | reducer+sources ~350, frame+cursor ~350, board glyphs ~300, panels ~400; deletes the live/replay fork ~900, the two stats tables ~550, the territory overlay ~700, `secondaryMove` + `moveEvaluations` scoring ~450 *(est.)* |
| **L6** | integration + gates | ~400 | ~100 | **+300** | envelopes ~150, divergence check ~80, the two gates ~170 *(est.)* |
| | **totals** | **~8,060** | **~6,666** | **+1,394** | |

Roughly net-flat, and it should be said plainly rather than dressed up: this is
not a deletion exercise the way the one-engine rewrite is (−20,830). It removes
6,666 lines of a display and a schema that answer a question the bot stopped
asking, and adds 8,060 for a surface that answers the one it does ask — of which
3,360 is test. **Source-for-source it is −3,306**, and the two largest single
deletions (the ~900-line live/replay fork and the ~700-line territory overlay)
are both duplications that have already drifted in production.

The commit that carries the most risk per line is **L3**, at ~700 added: it is
the only one that touches search behaviour, and it is the only one whose gate
(G2) had to be built two commits earlier to be worth anything.

---

## The order, in one line

**L0 delete → L1 fence → (L2→L3 kernel ∥ L4 storage ∥ L5 UI) → L6 integrate**,
after the rewrite's C5, with the UI and storage merges after its C7, and nothing
in either branch waiting on the other's critical path.
