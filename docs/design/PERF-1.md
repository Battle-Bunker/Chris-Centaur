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

## 2. What changed, and what each change bought

Four optimisations were kept. Every one of them leaves `sum all 60 5 --nodes`
BYTE-IDENTICAL — the `--json` transcript compared with `diff`, and
`scripts/ab-compare.js` all-zero on every metric of every paired seed, which
covers the required `mixed`/`potions` seeds 1–3 at 60 turns as a subset of the
same run. Node counts are unmoved: 74 711 on `mixed 60 1` and 76 763 on
`potions 60 4`, before and after.

None of them changes what is computed. Three of them delete a hashed lookup —
an ephemeron get, or a string V8 had to flatten and hash again — and the
fourth deletes a string that was being concatenated to be looked up. That is
the whole shape of the win, and it is worth stating plainly because the
attempts that FAILED all tried to delete an allocation instead (§4).

### 2.1 Plans carry their own key (`bounds/plan.ts`)

`planKey` was **9.1% / 7.2%** of decision time, almost all of it ephemeron
traffic: 1 257 491 calls over 612 421 distinct plan objects on `mixed 20 1`,
a `WeakMap` get on every one and a set on every miss. `withMove`/`withMoves`
— which is where essentially all of those plans come from — now return a
one-field `Map` subclass, and the lookup is a property load. The key is built
by the same extracted `buildKey`, so the string, the parts, the sort and every
cache keyed on it are untouched.

Measured −5.1% / −5.2% (median of three, sequential).

### 2.2 The resolution memo's composite key rides in the plan's slot (`bounds/memo.ts`)

`keyFor` was **4.6% / 4.0%** and `resolveBoundedFor` **3.2% / 2.3%** — most of
`memo.ts`'s 9.3%. Both paid for the same thing: an ephemeron lookup for the
view's composite key, then a `Map` lookup on a string freshly concatenated and
therefore freshly hashed. `KeyedPlan` grows one slot (a caller-encoded
(view, frame) tag and the key built under it); a plan is priced under one view
at a time on every hot path, so it hits, and the hit returns the SAME STRING
OBJECT — which is what makes `store.entries.get` hash it once for the life of
the plan instead of once per call. Prefix, frame, `planKey`, insertion order
and oldest-first eviction are all unchanged, so the resolution count and the
hit/miss sequence are too.

Measured −6.9% / −2.8% (median of three, sequential). `memo.ts` fell from
9.3% to 4.9% of decision time in the profile.

### 2.3 The ledger translation mints its entries with their key on them (`bounds/ledger.ts`, `bounds/score.ts`)

`ledgerKey` was **2.2% / 3.1%**: `mergeNormalForms` asks for a key per entry
per side of every union, and a union runs at every backup node. `LedgerEntry`
gains an optional `canonicalKey` and the one translation that mints the
entries the merge walks fills it at construction with exactly the string
`ledgerKey` would have built. Everything else — a test fixture, a hand-built
residue — keeps the `WeakMap`. Same key, same dedup, same ascending order.

Measured −3.8% / −1.6% (median of three, sequential).

### 2.4 The evaluation memo splits its key at the seam its halves move on (`bounds/evalmemo.ts`, `bounds/bank.ts`)

The per-branch key was one string, `namespaceToken | view | planKey`,
concatenated in `priceBranch` (**3.0% / 2.3%**) and hashed in `score`
(**3.0% / 2.3%**). Its halves move at completely different rates: the
(namespace, view) half is fixed for a whole reply sweep, and the plan half is
a string the plan already carries. The store now splits on that seam — a
bucket per scope, an entry per plan — and V8 caches a string's hash on the
string object, so each half is hashed once rather than once per branch.

The split is a bijection on the old flat key (a namespace token is `n<digits>`
and a view key is digits and commas, so the seam is unambiguous) and an
explicit FIFO replays the flat map's insertion order, so the key set, the
hit/miss sequence and the eviction order are identical. That is required
rather than merely tidy: an eval-memo miss calls the metered evaluator, so
that sequence IS the node clock.

Measured −3.4% / −5.3% INTERLEAVED (alternating runs against the previous
build). `priceBranch` + `score` fell from 6.0% to 4.6% of decision time.

---

## 3. ms per node, after

Every earlier number in this document was a median of three SEQUENTIAL runs,
and the machine is shared: two arms measured half an hour apart drift by 2–3%,
which is the same size as a single optimisation. The total below is therefore
measured INTERLEAVED — the head build and the final build alternating, three
runs each, median — which is the only form that survives the drift.

| scenario | µs/node before | µs/node after | change |
|---|---|---|---|
| `mixed 60 1 --nodes` | **199.5** (14903 ms / 74 711 nodes) | **165.7** (12381 ms) | **−16.9%** |
| `potions 60 4 --nodes` | **207.7** (15942 ms / 76 763 nodes) | **171.2** (13143 ms) | **−17.6%** |

Raw medians, alternating A/B/A/B/A/B:

- `mixed 60 1`: head [14705, 15062, 14903] → final [12336, 12442, 12381]
- `potions 60 4`: head [15942, 15451, 16093] → final [13372, 13143, 13105]

**The total is above the 15% bar, so everything above is kept.** In production
terms: the same wall-clock deadline now buys about a fifth more nodes, and the
decision that was spending 200 µs a node spends 166–171.

### 3.1 The profile after

Self time inside `decide`, `mixed 60 1` (compare §1.3):

| frame | before | after |
|---|---|---|
| `planKey` / `buildKey` — `bounds/plan.ts` | 9.1% | **4.8%** |
| `keyFor` — `bounds/memo.ts` | 4.6% | *below the top twenty* |
| `resolveBoundedFor` — `bounds/memo.ts` | 3.2% | 3.3% |
| `priceBranch` + eval-memo lookup | 6.0% | 4.6% |
| `ledgerKey` | 2.2% | *gone* |
| `partitionOf` + `displace` — `evaluate/territory.ts` | 4.4% | 5.4% |
| `settlePartial` — engine-vendor | 2.3% | 2.5% |

By file the shift is the point: `bounds/memo` 9.3% → 5.1%, `bounds/plan`
12.9% → 9.4%, `bounds/score` 6.0% → 4.5%, `bounds/evalmemo` 3.9% → 2.8% —
while `engine-vendor/settlePartial` rises from 14.8% to 17.4% and
`evaluate/territory` from 5.5% to 6.7% purely because the denominator shrank.
The remaining decision time is now engine resolution and evaluator fold, which
is where it should be.

### 3.2 The lens sink when nobody is watching

Required to be near zero, and it is exactly zero: **no frame under
`src/lens/**` or `emitLens` appears anywhere in the 43-second profile of
`mixed 60 1 --nodes`** — 0.000% of samples. `emitLens` returns on one null
check before it builds anything, including before it reads the clock (a read
is work and work is the clock under `--nodes`), and `searchContext` omits the
retention seam entirely when `run.lens === null`. Nothing was changed here and
nothing needed to be. `lens-inspection-cost` passes inside its caps,
evaluator calls within `searchDeadline` staying within 2% of the sink-absent
run.

---

## 4. What was left, and why

### 4.1 Left because it is not ours: the engine

`src/engine-vendor/**` is byte-for-byte from TacticToes and was not touched.
It is now **the largest share of what remains** — `settlePartial` at 17.4% of
decision time, `turnEngine` at 4.5%, `queries` at 3.5%. The resolution cost is
the currency the whole design is budgeted in and is honest work.

`pawnTargetsOf` is not. It is **17.8% of the whole `mixed 60 1` process** and
13.7% of `potions 60 4`, and the reason is a repeated rebuild rather than a
computation: `legalActions` builds the board's pawn-target set on every call,
and `claims.ts`'s reach BFS calls `legalActions` once per state per unknown
turn — against the PERMISSIVE shape, whose `food` is EVERY CELL, so each
rebuild is a `Set` of `boardWidth × boardHeight` entries plus every occupied
cell. Hoisting that set to one per `computeClaims` is the single largest win
available anywhere in this profile. `legalActions`'s own header records the
identical fix being made one level up ("rebuilding the board's pawn-target set
on every single call as it went"); the BFS is the level that still does it.
**For the TacticToes side, with numbers: 7.9 s of a 44.4 s run.**

### 4.2 Tried, measured, reverted

Three changes were implemented, measured and thrown away. All three deleted an
ALLOCATION rather than a lookup, and none of them paid — which is the useful
negative result of this pass: on this workload V8's young generation is cheap
and its hash tables are not.

- **Incremental key parts.** A derived plan can inherit its parent's sorted
  key parts and overwrite only the positions that changed — provably order
  preserving, because a part is `<unitId>'>'<tail>` and `'>'` sorts after every
  digit, so two parts for different units always differ inside the id and
  never inside a tail. Verified equal to the old key on 15 000 randomised
  derivations. **+1.7% on both scenarios** (interleaved): the array copy and
  the parallel unit list cost more than the four WeakMap gets they replace.
- **The reply sweep's accumulator.** `walk` hands each child `[...acc,
  option]`, one array per node of the reply tree; a push/pop accumulator
  removes all of them. **+1.7% / ±0%.**
- **`priceBranch`'s per-branch closure and provenance note.** The eval memo's
  miss path was described by a fresh closure on every branch (context object
  plus function object) and the bounds' `note` — free text only the inversion
  error ever reads — was concatenated on every branch. Passing the miss path
  as a module constant plus its arguments, and building the note only when
  `hi < lo` (strictly wider than the throw's own test), removes both.
  **+0.5% / −0.4%** — inside the noise, so not worth the four generics.

### 4.3 Left deliberately

- **`buildKey`, 4.8%.** What remains is irreducible without changing the key:
  a `Map.forEach` over the entries, one cached candidate key each, and one
  `join`. §4.2's incremental version was slower.
- **`namespaceToken`, 1.1%.** `evalNamespace` builds a long string per
  `price()` and the `Map` lookup flattens and hashes it. The fix is to return
  the same string object when the evaluator's declared identity has not moved
  — which is exactly the caching `evalmemo.ts` forbids in its own words: *"a
  captured identity is the same defect class as a captured clock"*, and the
  getter on `BoundEvaluator` is a getter for that reason. 1.1% is not worth
  arguing with a soundness rule about.
- **`evaluate/territory.ts`, 5.4–5.7%.** Off-limits for semantics, and its
  allocation is already gone: the fold runs on a per-substrate slab of typed
  arrays, stamps rather than fills, pools its cloud pairs and inlines its
  bit-walk specifically to avoid a closure per horizon turn. There is no
  allocation left in it to take.
- **The memo's `Proxy` get trap, 1.5%.** Every property read on a substrate
  passes through it. It is a `Proxy` deliberately — a hand-written wrapper
  would hide capabilities it was not told about — and the trap already caches
  its bound forwards. Cutting it means cutting property reads, which is an
  evaluator change.
- **The collector, ~10% of the process.** Reduced only indirectly, by the
  strings the four kept changes no longer build. §4.2 is the evidence that
  chasing it directly does not pay here.

---

## 5. Gates

| gate | result |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| `npx eslint "src/**/*.ts"` | clean |
| `npx jest` (full) | **97 suites, 1662 passed, 12 skipped, 0 failed** |
| `npm run gate:exact` — the sixteen exact-reply arms | 16/16, no floor above a concrete reply |
| sixteen-arm inversion gate, `CENTAUR_DEBUG_INVERSION=1` (`mixed`/`snakes`/`sparse`/`potions` seeds 1–3 at 30 turns, plus `potions` seeds 4 5 6 8 at 60) | **zero `INVERSION` lines** — stderr empty across all sixteen |
| `lens-inspection-cost` | 16/16, inside its caps |
| `sum all 60 5 --nodes` transcript | **byte-identical** at every step; `ab-compare` all-zero |
