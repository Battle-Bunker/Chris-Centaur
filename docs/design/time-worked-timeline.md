# A worked timeline — two turns of one game through the worldline primitives

Companion to `time-worldline.md`. Every step names the primitive invoked and
the existing code whose job it inherits, so the design can be falsified
step-by-step rather than admired in the abstract. Shape: 25×25 mixed-king,
3 teams, production budget ~9,850 ms, one human operator on our team.

Notation: `F` = the actual frontier; `H(x)` = the hypothesis "F plus assumed
determination x"; quanta in resolution-equivalents (q).

---

## Turn N, from snapshot to commit

**t₀ — turn-N doc arrives.** Wire adapter emits
`observe(resolution(N−1 complete))` (on turn 1, `observe(game-start)`).

- Worldline: `realizedResolution` replays turn N−1's movement half over the
  old root, checksums against the doc (mismatch → marshal fallback +
  `replay-divergence`). Belief conditions: every unit observed, clouds
  collapse (fog: hidden units keep clouds; doc facts intersect). Root for
  turn N built (marshal today; door-advance under fog).
- Citation pass: all stores citing `action(*, N−1)` or `position(*, N−1)`
  die; carried-attention rows premise-match against the replayed Resolution
  (rebase-transfer §2): the opponent DID commence the pondered rook line →
  that hypothesis's rows promote (concern set pre-ranked); the other five
  reply hypotheses die by contradiction.
- Agent N constructs and attaches: deadline from the doc's endTime through
  the exchange rate — the ONE wall-clock read of the step; allowance ledger
  opens `targetTurn=N`.

**t₀+ε — rung 0.** Agent N demands a conforming plan
(`conform`, unchanged contract: complete legal plan before any refinement;
bounded by the rung-0 allowance, the toll fix's `rungZeroFraction`
translated to quanta). Wire holds a plan. `phase=conform` tranche logged.

**refinement tranches.** Loop: exchange rate grants a tranche (adaptive
size, capped at the operator-latency bound); worldline `spend(tranche, h)`
where the scheduler picks `h` from the hypothesis market:

- `h = F` most tranches (the ply-1 search + threads seeded by promoted
  attention rows first — the carried concern set gets slice-1 compute);
- `h = H(pin u@c)` for the operator's standing tentative pin (today's
  1-in-`speculativePeriod` slice, now a market weight);
- thread plies inside a tranche are the scout's existing purse spending —
  unchanged, already counted.

After each tranche the agent reads the rows for `F` ∩ its pin set, runs
stager + gates, maybe emits. Determinations arriving mid-tranche wait at
the tranche boundary (atomic by construction — nothing inside a tranche
sees a clock or the queue; today's mid-slice suppression rule becomes
structural).

**t₁ — operator commits the king to c*.** `observe(commit(king@c*))`.

- Variables determined: `action(king, N)`. Citation pass kills: bank rows
  citing the king's action-freedom, the king's cluster's enumeration
  cursor, thread premises whose premise assigns the king elsewhere
  (`invalidateCitingUnit`, existing). SURVIVES: every other cluster's
  enumeration and proposals, every bank row not citing the king, all
  candidate sets (they cite positions, not actions), the scout ledger's
  other threads. — This is the step that costs 343 ms today and ~one
  cluster's re-enumeration after.
- Hypothesis promotion: `H(pin king@c*)` (if the operator had pinned first,
  the usual path) has warm state → promoted into `F` wholesale
  (`resumedFromCache`, generalized).
- Agent N: reaction table row "operator commit → conform now": splice into
  the wire plan (kernel.ts:1203 logic, unchanged), emit, log a
  `ConformanceSample` with kind. Next tranches improve the remaining units.

**t₂ — our last unit committed (operator submits the team).**
`observe(commit(...))` for each. Now every commandable unit's action(N) is
fact. Agent N has nothing movable (`everythingPinned`, kernel.ts:1224) —
it stays attached only to serve unpins… but commits are permanent, so it
DETACHES (final flush already emitted by definition — the wire holds the
committed set).

## The inter-turn window (today: dead time)

**t₂ → t₃.** The frontier now: our actions(N) = facts; rival actions(N) =
simultaneity width, observation-reducible, arrival scheduled (the
resolution); positions(N+1) = derived-pending. No agent attached; wire
closed (writes rejected by rule).

- Worldline keeps spending: the window allowance policy grants
  `phase=ponder` tranches, `targetTurn=N+1` (fixed grant for sweeps;
  opportunistic for live; both logged, both replayable).
- Hypothesis set: `H(reply = w)` for w in the banked witnesses (worst-case
  first, ruling-13-clean), then concern rows, then dodge-cover ordering
  (rebase-transfer §6.2). Each `spend(tranche, H(reply))` runs
  resolve(our committed plan × w) → `continueFrom` → threads deepen —
  literally the existing scout path with the enumerated side inverted
  (our units are the references now, the reply is the premise).
- `observe(rival-commit-timing(team B))` arrives from the unfiltered
  moveStatuses listener: determines nothing searchable; updates the
  window-length estimate (exchange-rate telemetry) and is logged.

## Turn N+1

**t₃ — resolution doc arrives.** `observe(resolution(N complete))` — the
same step as t₀, but now the ponder products are on the table:

- The realized reply matches pondered hypothesis `H(reply = w₂)` exactly →
  that hypothesis PROMOTES: its continuation root (modulo spawn deltas),
  its thread ledger entries, its deep observations enter turn N+1's
  attention at slice 1; its sigma ledgers pop the resolved ply
  (rebase-transfer §3). Mismatched hypotheses die; their sound content was
  never stageable anyway.
- Spawn deltas (doc facts no premise predicted): structural caches citing
  spawn cells' emptiness are the only extra casualties; a promoted
  continuation root is rebuilt-with-patch, its search products surviving
  per their coords.
- Agent N+1 attaches; rung 0 conforms — with the promoted attention, the
  first refinement tranches concentrate exactly where the window's compute
  pointed. `carriedQuanta` column records what N+1 inherited.

**The acceptance shape** (extends rebase-transfer §9): three arms on a
seeded two-turn scenario — (a) bare, (b) carry-only, (c) carry+ponder.
Watched: time-to-refutation-staged at N+1 when the opponent commences the
explored line (c < b < a expected); identical staging when the opponent
deviates (the machinery visibly declining to speak); per-turn quanta
ledgers proving the denominators.

---

## What each legacy concept became

| today | in the timeline above |
|---|---|
| `decide()` call per turn | agent attach/detach around a continuous process |
| slice | tranche (counted, atomic, clock only at grant) |
| session (basis-keyed) | value store of one hypothesis |
| speculative context | hypothesis with a market weight |
| scout thread | spend on `H(cluster joint)` |
| ponder window design | spend on `H(reply)` with no agent attached |
| epoch change | observe(commit) + citation pass + conform-now |
| re-base design | observe(resolution) + premise promotion |
| `abandoned()` / `latestTurn` guard | agent detaches when its turn's frontier completes |
| turn-keyed `live` handle race | determinations routed by turn on one worldline |
| `idleSlices` | ponder tranches |
