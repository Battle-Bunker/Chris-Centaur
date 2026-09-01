# Red team — the minimal path, the slab law, and the default numbers

Self-critique pass on the time factorization, written so the merge decision
can be argued against a cheaper alternative rather than against nothing.

---

## 1. The minimal viable path (the steel-manned alternative)

Everything in increments 1–3 is valuable WITHOUT the worldline object:

- **commit-scope invalidation** (inc. 1) lives entirely inside today's
  kernel + core: split `open()` per the toll fix's per-cluster seam, key
  values so a commit kills one cluster's worth. No cross-turn state.
- **allowance ledger** (inc. 2) is a budget-handle swap plus telemetry; the
  kernel keeps its loop.
- **replay-rebase** (inc. 3) is an ingestion function plus a counter.
- **carry + ponder** can then ship as rebase-transfer wrote them: a scalar
  carry store on `GameState_`, a ponder session harvested at decision open.

Call this MIN. The full factorization (FULL) adds the worldline object, the
unified hypothesis table, warm promotion, and the market. What FULL buys
over MIN, stated so it can be priced:

1. warm-context resume when a pondered premise matches exactly (MIN
   re-walks from a scalar prior; FULL keeps the session) — measurable as
   time-to-refutation delta, and falsifier (c) already gates it;
2. one attention market instead of three rationed pools (tithe,
   speculativePeriod, window policy) — a real joint the owner can sweep,
   but only worth its refactor if the pools measurably starve each other;
3. fog-across-turns without a second re-base path — the one FULL benefit
   MIN cannot approximate, because MIN's carry matching is all-or-nothing
   per row while fog needs per-variable survival.

Recommendation, honestly: **build MIN first (increments 1–3 are shared),
decide FULL at the fog milestone.** If invisibility potions land on
schedule, FULL's third dividend dominates and the worldline pays; if fog
slips, MIN + carry-store may be the right resting point for a season. The
increments were ordered so this decision point arrives with all three
falsifiers already answered — the design's own escape hatch, stated before
anyone is invested.

## 2. The slab law (memory across turns)

The hypothesis table must not become the V3 leak class. Law: **the
worldline owns no slabs across a re-base.** A live ponder hypothesis may
hold a continuation root (a slab) only between its creation and the next
`observe(resolution)`; at re-base ALL roots release — including the matched
hypothesis's, because the realized board differs from any premise board by
spawns and by the game-state half, so the new root is constructed fresh and
only the SEARCH PRODUCTS (rows, ledger entries, deep observations — plain
numbers and ids, rebase-transfer §7's row discipline) carry. Matched
promotion is warm in the sense of products and attention, never in the
sense of retained arenas. `Scout.releaseRoots` is the existing precedent
and the code path.

## 3. Two residual wall-cuts the counting migration must include

1. **Post-toll-fix enumeration carries a turn-scale deadline** (the pass is
   "interruptible per cluster" against wall time). Under the counting cut
   this becomes a quanta ration beside `maxClusterCells` — otherwise
   enumeration content stays box-dependent and the purity claim is false on
   exactly the piece boards that matter.
2. **`transientDelay` / yield scheduling** remains wall-driven by design;
   confirm no search state ever reads `run.lastYieldWall` (today it does
   not — verified; keep it that way with the same lint that bans belief.ts
   imports).

## 4. Default numbers for the new policies (starting points, to be swept)

- Tranche size: unchanged translation of today's adaptive slice (floor
  0.5 ms-equivalent, 5× measured cost, cap = min(10% of turn, operator
  latency bound)).
- Phase split while attached: conform ≤10% (rung-0 contract), depth tithe
  0.2 with reserve 0.5 (unchanged), hypothesis (speculative) share 1-in-4
  tranches ONLY while tentative pins exist (unchanged behavior, new
  clothes).
- Window (ponder) policy: sweeps run fixed grants = the exchange-rate's
  fitted quanta for the observed median inter-turn gap of the previous 5
  turns (per-game adaptive, still deterministic given the ledger); live
  runs opportunistic. Target order: floor-witness replies, then concern
  rows by floor damage, then dodge-cover ordering — rebase-transfer §6.2
  verbatim, as market weights (W0 rows weight 1.0, W2 tail weight 0.25).
- Reaction table: operator commit → conform-now; unpin/tentative →
  next-tranche; dial → next-tranche (soft re-price); goto →
  next-commitment; resolution → advance-now.

## 5. What the critic should attack first

The quanta cost model's variance on piece boards (a queen-cluster price is
not one quantum's worth of work; if per-price cost spread is too wide, the
latency cap needs a per-cluster cost table, which is complexity the design
hoped to avoid — falsifier (d) is the gate); and the assumption that
premise-exact ponder matches happen often enough for warm promotion to
matter (if match rate is low, FULL's dividend 1 is theoretical and the
carry rows do the real work — falsifier (c)).
