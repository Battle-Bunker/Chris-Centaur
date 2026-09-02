# SYNTHESIS — the time factorization (iteration snapshot, cycle E)

The standing summary of the design/time-interruption line under the
extended mandate (rulings 49/50: continuous iteration; this is a
snapshot, not an endpoint). Companions: `time-worldline.md` (the
factorization), `time-worked-timeline.md` + `time-fog-timeline.md` (the
process traces), `time-agent-and-measurement.md` (agent split, quantum,
harness), `time-premise-reconciliation.md` + `time-cross-lens-round2.md`
(cross-lens algebra), `time-prior-art.md` (expert implementations),
`time-economy-goods.md` (CPPs, flip pricing, the denominator proposal),
`time-cpp-spec.md` (executable profile compilation),
`time-scheduler-sketch.md` + `worldline.sketch.ts` +
`realized-resolution.sketch.md` (builder-facing), `time-red-team.md`
(minimal path), `redteam-joints-composition.md` (delivered),
`time-response-value-redteam.md` (received and answered),
`time-manifest-join.md` (the worked join with the composition lens).
Grounded on `claude/cluster-lookahead` @ `47c983e`, `primary` @
`66904d2`, TacticToes @ `416d9c8`.

---

## 1. The carve

Two kinds of time: DETERMINATIONS advance information; QUANTA advance
search. They touch at one point — the allowance grant, one logged integer.
Two primitives plus a transport:

- `spend(tranche, hypothesis)` — anytime slice, speculative pin context,
  scout thread, and ponder are four parameterizations of it (ponder =
  spending under a simultaneity narrowing nothing can buy yet: the
  anticipatory meet).
- `observe(determination)` — operator commit, turn resolution, partial
  fog resolution, dial change; kills exactly the state whose declared
  coordinates were determined (durability-strata indexed), with CUTOFF
  (recompute-and-compare before propagating; the commit-of-the-staged-
  move case costs one equality check, not today's full epoch teardown).
- `ADVANCE` — transport to the next turn's lattice at resolution: values
  cross iff premise-point-exact + same evalVersion + spawn-clean;
  everything else carries attention only and re-walks.

Module split: per-game WORLDLINE (frontier, hypothesis table, attention,
ledger-replayable folds), per-turn COMMITMENT AGENT (deadline, wire,
gates, ratchet — the interruptibility witness law: the standing incumbent
IS the pipeline's interruptible type), one EXCHANGE RATE (every clock
read; Law K(b) spend-only). The engine-API question dissolved: the Turn
doc already carries the resolution record; re-base replays the realized
orders through the bot's own engine with the wire as per-turn checksum
(movement half replayed, game-state half copied; under fog the same path
with holds — full observability is the degenerate case).

## 2. The economy, with goods (cycle D)

The core object is the CONDITIONAL PERFORMANCE PROFILE
`Pr(quality | quanta, premise-coords)` — fibered over the joints lens's
premise lattice, compiled offline from the replay archive
(`time-cpp-spec.md`), every profile a member with fit provenance
(ruling 49; provenance classes include THEOREM for the ratio-2 schedule).
Meets are priced by decision-change, not width: market weight =
P(realize) × P(flip at the deciding rung) × E[improvement | flip], with
the flip factor read off interval overlap at the rung the lexicographic
comparator actually decided on (already telemetry). Narrowing an
uncontested rung is worth zero. Obligations (reaction table) compose by
MIN over kernel-pinned deadline-zero rows; allocations partition.
Metareasoning is metered: the economy may not spend more on choosing than
the spread it can recover, and monitor cadence IS the tranche-size axis —
one dial, not two.

The whole surface is expressed as manifest rows (`time-manifest-join.md`):
six ECONOMY joints (tranche / phase-split / window / market / reaction /
conversion), three member columns with teeth (`transport` — 'invariant'
refused when params cite a world coordinate; `interruptibility:
contract | interruptible`; `calibrationClass` — Law K as a checkable
field), a per-REDUCTION-site constraint table (the ponder-targeting site
pinned ≤ W2 until the D2 ruling), and one drift found and relayed:
fitted-shared-data members (CPPs and their kin) need a PROFILE entry
class in the manifest.

**The denominator proposal (dissolves the question formerly escalated):**
fund refine grants to `CPP-target − carriedQuanta` (Lc0 PR1195's shipped
shape); compare cross-policy arms at equal EXPECTED QUALITY with
equal-wall strength as the headline; stamp the CPP member into the CONFIG
coordinate so verdicts under different profiles never compare silently.

## 3. The outcome thesis and the build order (cycle D, after the VALUE red team)

> Time structure pays iff it converts idle and mispriced time into DEPTH
> THAT CHANGES DECISIONS on compute-starved boards — measured as
> depthChangedStaging rate and sharePar on piece cells against a
> same-lineage control.

The 10×-budget invariance of the evaluator ladder is evidence about
breadth-at-horizon-1 and confirms the base rate against plumbing-only
claims; the queen board's 16× throughput collapse is the motivating case.

**THE CPP HAS NOW ARBITRATED — CONDITIONALLY (first v0 compile +
librarian C48 amendment, `cpp/READING.md`):** the arbitration below
awaits the margin-at-deciding-rung column (M47) before any budget moves:
wide margin + saturation confirms it; near-zero margin + saturation
inverts the snake6 reading to fix-the-evaluator-first (weak-evaluator
masking, Thompson's lesson — and our snake6/queen split matches that
signature). Profiles are keyed on evalVersion (M48). A second
denomination correction (d36-37, cannot-wait): the v0 files are
RE-CLASSED as machine-local calibration artifacts — a ms-keyed curve is
a property of the box, so the shape/ordinal readings on one box stand
but no consumer reads them as profiles, and NO further CPPs are
compiled in milliseconds (the quanta denominator is now a prerequisite,
`cpp/READING.md`). As measured on this box:
snake6 saturates at ≤ 500 ms (0.95 agreement at 125 ms; zero staging
changes from 500 ms to 4 s across 9,000+ extra priced plans — the
invariance, now a curve); the queen cell CLIMBS THROUGH THE TOP RUNG
(0.883 at its own played budget of 2 s vs the 4 s reference; 15% of
decisions differ 1 s → 4 s; noise ceiling 12/12 exact) — **starved, not
overhead-bound: fund ponder-class carried VALUE work.** Enumeration and
threads saturate by 500 ms (joints 92, plies ~24; first-stage 9.6 ms),
so the structural-pre-build rung covers only a turn's first ~500 ms and
the earlier guess in `time-response-value-redteam.md` §2 is amended: the
scarce good on piece boards is PRICED PLANS (449 vs 5,079 at 2 s), and
the window policy front-loads carried/warmed value work everywhere, with
structural pre-build as the short first rung. Live piece-cell games at
≤ 2 s budgets were staged measurably off-curve — a standing caveat on
every strength verdict from those cells.

Build order (each a feature branch; two-lane compliant; no flags):

1. **feature/allowance-ledger** — quanta accounting, exchange rate,
   ledger replay rows, harness virtual clock, sync-test gate (every
   decision run twice from the ledger, byte-compared), the first
   v0 CPPs compiled from the archive, AND (search-theory doc 07 fold):
   the `gapCurve` emitted field — per-emission (atQuanta, maxGap) pairs,
   the RECOGNIZABLE quality axis the ratchet already enforces and
   nothing plots — giving quality-vs-time curves from every future live
   game at zero re-decision cost, beside agreement (the two axes'
   disagreement is itself diagnostic: plans-changing-while-gap-flat =
   wandering; gap-shrinking-while-plans-fixed = confirmation).
   Prefix determinism is registered under their Law I′ as a CROSS-CUTTING
   INVARIANT with its sites listed — the counting cut is the seventh
   site paying for it — and property-tested: the b-vs-2b
   emission-prefix assertion under `countingBudget` (a 2b-quanta run's
   emission sequence extends the b run's byte-for-byte) is increment 2's
   gate for that invariant. Claims: measurement quality (floors tighten;
   sync-test holds; prefix test green) — immune to the outcome
   objection, prerequisite to every later claim.
2. **feature/replay-rebase** — realizedResolution (replay + checksum +
   `replay-divergence` / `mask-divergence` counters); the depth-engagement
   enabler and a standing live differential test.
3. **feature/worldline** — hypothesis table, attention carry +
   exact-premise value transport, ponder as a geometric grant ladder on
   the everythingPinned/settled conditions, structural pre-build first on
   piece boards. CARRIES THE OUTCOME FALSIFIER above; the two-turn
   acceptance games remain diagnostics. Slab law: no slabs cross a
   re-base. Revalidation law: bot-authored carried premises revalidate
   every turn or die.
4. **feature/commit-scope** — citation-scoped commit invalidation +
   cutoff + reaction table; honestly labeled a latency/operator-experience
   claim (conform ≤ 1 tranche under intervention; commit-agree ≈ free),
   with the first operator event ever fired in a harness game. FALSIFIER
   REFRAMED (librarian C13 correction): the recovery lever is
   CLUSTER/READING-granularity invalidation — `partitionOf` (whole-board
   set-cover) is the genuinely un-incrementalisable floor, so the
   falsifier reports the partition-rebuild share separately, and a
   partial recovery reads as that floor, not as refuting
   citation-scoping. Also inherits W-2 (adopt worker-banked witnesses at
   tranche boundaries — near-free under the counting cut) and states W-1
   as a hazard: B2 cost grows with the uncapped witness set within a
   decision, so any fixed-ms latency cap drifts late in the turn until
   support-based pruning lands.
5. **feature/evaluator-version** — version stamps + next-tranche-softly
   re-pricing + the dial acceptance game.

MIN-vs-FULL escape hatch stands (`time-red-team.md` §1): increments 1–2
are shared and standalone; the worldline decision point arrives with the
falsifiers answered, and the fog milestone is what makes FULL's unique
dividend (per-variable survival) load-bearing.

## 4. Laws (consolidated, current wording)

- **Ledger law**: no layer below the exchange rate reads a clock; wall
  time influences only grant count, which is logged. (GGPO: everything
  nondeterministic is an input.)
- **Anti-latch, restated under Law K** (cycle E): cross-turn mutable
  state is exactly (a) ledger-replayable folds of determinations —
  attention rows, learned measure state, each turn-stamped, bounded,
  declared in the measure coordinate; (b) spend-only wall-derived fits;
  (c) the seed position. No wall-derived value may reach an order, bound,
  or refusal.
- **Citation law with three verdicts** — determined → kill;
  merely-NARROWED → sound state survives valid-but-looser (a theorem, the
  belief lens's fill: floors over S floor any S′ ⊆ S; witnesses
  membership-re-checked; advised precision-decayed; observe() conditions
  S first, then the citation pass); untouched → live — **plus cutoff and
  durability strata** (invalidation);
  **transport law** (A1.1-scoped value crossing, plus its payload theorem
  — librarian C38, DeepStack continual re-solving: ADVANCE carries
  opponent counterfactual BOUNDS at the public state which the re-solve
  may not increase; empty under full observability, hence today's re-base
  is sound as-is; load-bearing at fog step 5, exercised by the fog
  timeline; the constraint lands in better()'s floor discipline and the
  bank already produces the type); **quarantine** (fibers
  never reach the wire — misprediction costs compute only, no rollback
  operation exists); **incumbent witness**; **revalidation for
  bot-authored carries**; **obligation-by-MIN** with humans-always-win at
  deadline zero; **metareasoning metered**.

## 5. Ruling-49 self-audit (standing)

The 343 ms and msPerResolution magnitudes are lineage-conditioned
mechanics — re-measure on the building lineage. Every default in these
docs (tithe/reserve/speculative share/market weights/ladder base) enters
as a member with provenance `inherited-unfitted`. Marked as arguments,
not measurements: the product-space case against predicted-move ponder,
and "commit-agree is the most common operator action" (no operator event
has ever fired in a harness game; increment 4 starts the telemetry).

## 6. Owner summary (vocabulary-checked shapes; ≤8 bullets)

- Wall-clock time and search work are separated at exactly one point: the
  clock is read only to grant the search an allowance of work units, and
  every grant is logged — so a game replays from its log, whichever way
  the humans and opponents moved the clock; a self-check mode replays
  each decision twice and compares byte-for-byte.
- The search becomes one continuous per-game process; each turn a small
  per-turn agent attaches to it, owning the deadline, the wire, and every
  emission gate unchanged.
- An operator commit invalidates only the work that depended on that
  unit's choice, and approving the bot's own staged move costs nearly
  nothing instead of a full rebuild — the more the human intervenes, the
  more the bot keeps thinking.
- Thinking between turns needs no new machinery: with our moves committed
  they are facts, enemy replies are explored the way the deep search
  already explores them, and whatever reality confirms is carried warm
  into the next turn's first work — on piece boards the between-turns
  work builds the expensive groundwork first, because that is what
  survives any reply.
- The game server change previously thought necessary is not needed: the
  turn document already publishes enough for the bot to replay the turn
  through its own rules engine, using the wire as a per-turn correctness
  check — a free engines-agree audit in every live game.
- What a unit of thinking actually buys is now a measured curve per board
  type, compiled from games already on disk — it prices every budget
  decision, replaces the open measurement question (compare at equal
  expected quality; fund each turn net of carried work), and tells us for
  the first time what ten seconds buys over one.
- Work is aimed where it can change the decision: effort that narrows a
  question the current choice does not turn on is priced at zero, and
  when the choice is already settled the rest of the turn's time flows to
  next turn's thinking.
- The strength bar for the whole cross-turn programme is explicit: deeper
  search that changes staged moves on the piece-heavy boards where
  compute is starved, against a same-lineage control — plumbing wins
  alone do not clear it.
