# PERF-1 — more search nodes inside the production deadline

The behaviour programme reached its floor: the bot's remaining deaths sit
behind margins no member and no weight moves on this corpus. The other lever
on play quality is how much search fits inside the deadline the wire gives a
decision — `kernel.ts` spends `deadlineMs − LENS_INSPECTION_MS` on slices, and
what that buys is however many nodes the machine can price in the time. This
document is the profile of that spend, what was made cheaper, and what was
left alone.

**The oracle.** Production runs on wall-clock; the runner's `--nodes` mode
replaces the clock with a work counter (`nodes × NODE_COST + reads ×
READ_COST`), so a decision is a pure function of the position and every
transcript is byte-identical run to run. Every optimisation below is required
to leave `sum all 60 5 --nodes` and `mixed`/`potions` seeds 1–3 at 60 turns
BYTE-IDENTICAL (`scripts/ab-compare.js` all-zero), while wall-clock per node
falls. Nothing here may buy speed with a different decision.

---

## 1. The measurement

### 1.1 What is being timed

`node dist/tests/local-game.js <scenario> --nodes` spends most of its wall
clock OUTSIDE the bot. The whole-process profile of `mixed 60 1 --nodes`:

| region | share of process |
|---|---|
| `runGame → entrappedAt` — the runner's entrapment instrument, `claimsAfter` per unit-turn | **47.4%** |
| `decideTeam → drive` — THE KERNEL'S SEARCH, the only production path | **30.3%** |
| `decideTeam → traceFor` — the runner's post-hoc per-unit trace pricing | 11.7% |
| garbage collector | 10.0% |

`entrappedAt` and `traceFor` are harness instruments — `traceFor` says so in
its own comment ("trace pricing happens after the plan is chosen and cannot
affect it"). Neither runs in production, and a profile that pools them with
the kernel reports the harness. **Everything below is measured under
`LobsterKernel.decide` only**, timed by wrapping the async generator, so the
number is the decision's own wall clock — the quantity the deadline actually
spends.

### 1.2 ms per node, before

Median of three runs on a shared machine, decision time only:

| scenario | decision ms (median of 3) | nodes | **µs / node** |
|---|---|---|---|
| `mixed 60 1 --nodes` | 14451 (14348 / 14451 / 14674) | 74711 | **193.4** |
| `potions 60 4 --nodes` | 15036 (14980 / 15036 / 15202) | 76763 | **195.9** |

### 1.3 The top ten hotspots inside `decide`

Self time as a share of the kernel's own decision time (`mixed 60 1` /
`potions 60 4`):

| # | frame | mixed | potions |
|---|---|---|---|
| 1 | `planKey` — `bounds/plan.ts` | **9.1%** | **7.2%** |
| 2 | `keyFor` — `bounds/memo.ts` (the composite store key) | 4.6% | 4.0% |
| 3 | `resolveBoundedFor` — `bounds/memo.ts` (the store lookup) | 3.2% | 2.3% |
| 4 | `priceBranch` — `bounds/bank.ts` | 2.9% | 2.3% |
| 5 | `score` — `bounds/evalmemo.ts` | 2.5% | 2.3% |
| 6 | `walk` — `bounds/bank.ts` | 2.3% | 1.9% |
| 7 | `settlePartial` — engine-vendor | 2.3% | 2.7% |
| 8 | `withMoves` — `bounds/plan.ts` | 2.3% | 1.7% |
| 9 | `displace` / `partitionOf` — `evaluate/territory.ts` | 2.2% / 2.2% | 3.0% / 2.3% |
| 10 | `ledgerKey` / `normalizeLedger` — `bounds/score.ts` | 2.2% / 1.8% | 3.1% / 2.0% |

By file, inside `decide`:

| file | mixed | potions |
|---|---|---|
| `engine-vendor/engine/settlePartial` | 14.8% | 16.9% |
| `lobster/bounds/plan` | **12.9%** | **10.3%** |
| `lobster/bounds/bank` | 11.0% | 9.2% |
| `lobster/bounds/memo` | 9.3% | 8.2% |
| `lobster/bounds/score` | 6.0% | 6.9% |
| `lobster/evaluate/territory` | 5.5% | 6.2% |
| `engine-vendor/engine/turnEngine` | 3.9% | 4.2% |
| `lobster/bounds/evalmemo` | 3.9% | 3.6% |

Plus the garbage collector at 10% of the process, which V8 attributes at the
root and which no per-frame column can carry.

**The reading.** The key machinery — `planKey` + the memo's composite key +
`ledgerKey`/`normalizeLedger` + `evalmemo`'s namespace token — is **17–18% of
the kernel's decision time**, and it is the largest single allocator feeding
the 10% GC. `mixed 20 1 --nodes` builds **1 257 491** `planKey` calls over
**612 421** distinct plan objects and **41.3 MB** of key characters. That is
the target.

### 1.4 What the engine costs, for the TacticToes side

`src/engine-vendor/**` is byte-for-byte from TacticToes and is not touched
here. Two numbers belong on that side of the fence:

- **`pawnTargetsOf` (`engine/queries.ts:29`) is 17.8% of the whole process**
  on `mixed 60 1 --nodes`, 13.7% on `potions 60 4`. `legalActions` rebuilds
  the board's pawn-target set on every call, and `claims.ts`'s reach BFS calls
  `legalActions` once per state per unknown turn — against the PERMISSIVE
  shape, whose `food` is every cell on the board, so each rebuild is a Set of
  `boardWidth × boardHeight` entries plus every occupied cell. Hoisting the
  set out of the BFS (one per `computeClaims`, not one per state) is the
  single largest win available anywhere in this profile, and it is entirely
  inside the vendored engine. `legalActions`'s own header already records the
  same fix being made one level up: "each of them used to ask the grammar
  twice … rebuilding the board's pawn-target set on every single call as it
  went." The BFS is the level that still does it.
- `settlePartial` is 14.8–16.9% of the kernel's decision time and is the
  engine's own resolution cost — the currency the whole design is budgeted in,
  and correctly so.

---
