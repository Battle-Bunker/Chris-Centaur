# 11 — O0, specified against the code: what to keep, where, at what cost

The whole surface stands on retention (docs 00 §7, 04 §8): the foil, the
matrix, the dispositions, the flows. This document turns O0 from a build-
order row into a buildable increment with exact sites (all on `primary` @
66904d2 — the worktree this branch is cut from), record shapes, cost
bounds, and falsifiers. Behaviour-inert by construction: **every addition
is an append to a decision-scoped ledger object that nothing reads back
during the decision.** Law D1's shape: the ledger carries values *out*;
no stage, comparator, or gate consults it.

## 0. The host object

One per decision, threaded through the search context the way `budget`
already is; serialized beside the EmitRecord journal (`kernel.ts` `Run.
journal`) at decision end; on `claude/cluster-lookahead` the natural
serialization seat is a new `MechanismReport` group (miner rule applies:
new columns, never re-typed ones).

```ts
// search/retention.ts — append-only, read by nothing in the decision path
interface DecisionLedger {
  contest: ContestEntry[]        // §1  — the foil column
  matrix: MatrixCell[]           // §2  — restricted matrix, both endpoints
  refutations: RefutationEntry[] // §3
  dispositions: DispositionEntry[] // §4 — prunedLedger, widened
  terms: TermVector[]            // §5  — coarse flow records, v0 grain
}
```

Cap discipline: each array carries a hard cap with an overflow counter
(`dropped: number`) — a ledger that can grow unboundedly inside one
decision is W-1's drift arriving by the back door. Caps are members with
provenance; proposed starts: contest 64, matrix 8192 cells, refutations
256, dispositions uncapped (already exists), terms 512.

## 1. The foil column — `better()` (`search/core.ts:410`)

`better()` is a closure over `(trial, incumbent)` with four rungs in
order: the witness veto (`refutedAt(trial.bounds.best,
incumbent.bounds.worst)`), `compareFloors` order, `est`, `bounds.best`,
salted `planTieKey`. Today its verdict is one boolean; which rung decided
and by how much is computed and dropped — the "one column, three
consumers" item (prior-art 10), now placed:

```ts
interface ContestEntry {
  readonly trialKey: string          // plan keys, not plans (names find)
  readonly incumbentKey: string
  readonly decidedBy: 'veto' | 'basis-refusal' | 'floor' | 'est' | 'ceiling' | 'tie'
  readonly margin: number            // signed, in the deciding rung's units; 0 for veto/refusal
  readonly accepted: boolean
}
```

Site mechanics: `better()` becomes `betterWith(trial, incumbent, out?)` —
same boolean, optional out-param appended by the caller; the three call
sites (`sweep`, pair repair, cluster offers) pass the ledger. **The
per-decision aggregate the frame reads** (deciding-rung grade, doc 09 §3)
is the *last accepted* entry's `decidedBy` plus the distribution — both
computed at serialization, not during.

Cost: one enum + one subtraction per comparison already performed; the
comparison count is the existing telemetry's priced-plan count. No new
resolutions.

## 2. The matrix — B2 loop (`bounds/bank.ts:614–641`)

The loop already computes `branch = priceBranch(view, withMoves(base,
witness.replies), "B2", ...)` per (plan, witness) and keeps only the
ceiling member. Retention is two numbers per cell at the point where
`branch` is in scope:

```ts
interface MatrixCell {
  readonly planKey: string
  readonly witnessKey: string        // the bank's witnessKeys entry
  readonly worst: number             // branch.bounds.worst
  readonly best: number              // branch.bounds.best
  readonly basisKey: string          // branch.bounds' canonical basis — cells across bases never compare (AGG-3)
}
```

Search 05 §2.4½'s "free" claim, checked against this code: correct — the
resolutions are already spent; the append is O(1) per cell. Size: plans ×
witnesses; the measured 23×5 probe board is 115 cells; the 8192 cap
covers ~150 plans × ~50 witnesses and the overflow counter tells us if
real decisions exceed it (that number is itself a wanted measurement).

`pureDuality`, `#argCol`, per-column refutation counts (doc 09) are
**serialization-time folds** of this array — never computed mid-decision.

## 3. Refutations — same site + the veto

Two sources, one record:

- B2 cells where `branch.bounds.best` sits below the incumbent floor at
  final staging (fold at serialization from §2 — no live hook needed);
- the `better()` veto rung (§1 entries with `decidedBy: 'veto'`), which
  names refutations *against trials* that never became incumbent.

```ts
interface RefutationEntry {
  readonly planKey: string
  readonly refutedBy: string         // witnessKey — the reply that kills it
  readonly atRung: 'B2-cell' | 'veto'
}
```

The dominant-column aggregate (`refutation.dominantColumn`, doc 09 §2) =
mode of `refutedBy` at serialization.

## 4. Dispositions — `prunedLedger` (`candidates.ts:434`, `PrunedEntry`)

Already exists per unit (`{candidate, prune: reason, exact}`); O0 widens
it with the lifecycle's `disposition` class (search doc 10:
recoverable/closed/unpriced) derived from the existing `reason` by a
static table, and lifts per-unit ledgers into the DecisionLedger with
their `unitId`. No new pruning knowledge — a relabeling plus a hoist, and
it is the read the frustration composite's "never-priced" arm needs
(docs 05 §2, 04 O3).

## 5. Terms — the v0 flow grain (`candidates.ts` gainOrderKey inputs / `evaluate/*`)

The value lens's event-anchored `Contribution` records do not exist in
this code yet — their fold instrumentation is offline (their `tools/`).
O0 does not invent them; it retains what exists: the per-term inputs the
ordering already computes per candidate (`AssessedCandidate`'s scored
fields feeding `gainOrderKey`, `candidates.ts:1168`):

```ts
interface TermVector {
  readonly unitId: string
  readonly candidateKey: string
  readonly terms: ReadonlyArray<readonly [termId: string, value: number]>
}
```

Honest grain note, so nobody over-reads it: these are **ordering terms,
not weight-share flows** — enough for "your near(queen) pull was outvoted
by X" (the per-slot contrast) and the guidance echo's v1; NOT enough for
event-anchored causal headlines. The FLOW upgrade lands when the value
lens's decomposition moves in-engine (their M2 (K,W,p) pass is the
vehicle); the record shape above is deliberately a degenerate
`Contribution` so the upgrade is a column addition, not a migration.

## 6. Serialization and custody

- End of decision: `DecisionLedger` → one compressed row keyed by
  (gameId, turn, seq/decision id), written **after** the final emit (never
  on the emit path; a serialization failure may not cost a move — try/
  catch, counted, never thrown through).
- Custody: live store on the hosting server (team-private), TTL = game
  + handoff to the replay/audit story (doc 04 §2's open product call).
- The kit's miners get five new mineable groups; **refuse-unknown
  applies** — a miner reading a pre-O0 replay sees absent groups, not
  zeros.

## 7. Cost gate and falsifiers

| check | gate |
|---|---|
| behaviour | byte-identical staged plans + emit journals on the paired-harness suite with retention on/off (the O0 falsifier from 04 §8, now runnable as a diff of journals) |
| time | added wall time per decision < 1% on the bench boards (appends and enum writes only; serialization off-path) |
| size | measured ledger bytes per decision on snake6 / contested-3 / hub-queen — replaces doc 04 §2's "tens of KB" guess with numbers; the caps' overflow counters stay zero on the bench or the caps are re-argued |
| content | on the contested-3 probe board, the serialized matrix reproduces the search lens's v2 table (their probe becomes a regression test of our retention — one instrument, two consumers) |
| foil | on every bench decision, the last accepted ContestEntry's `decidedBy` matches the incumbent's actual acceptance path under a hand-traced spot check; the distribution's `tie` share on contested boards is the doc 09 §3 prior (expected high) |

## 8. What O0 explicitly does not do

No selection, no frames, no wire, no presentation, no reads-back, no new
pruning or pricing, no Contribution invention, no MechanismReport
re-typing. It is the retention half of five consumers (foil, matrix,
refutations, frustration, guidance echo) and nothing else — the same
first-increment shape every sibling converged on: prove the abstraction
by being byte-identical.
