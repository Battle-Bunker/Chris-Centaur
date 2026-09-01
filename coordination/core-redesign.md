<!-- SNAPSHOT: source scratchpad/core-redesign.md — synced 2026-09-01T01:13:23Z by the branch-topology housekeeping task.
     This is a point-in-time copy, not the live document. The working copy is the coordinator's
     scratchpad; this branch exists so the owner can reach it if that box is unreachable. -->

# CORE REDESIGN — strategies as data, shadows as priors, posteriors as the search

**Mandate.** Owner, 2026-08-29 (third message), binding: no more flag-gated
pseudo-dead code as the testing paradigm; an elegant architecture with exactly
the degrees of freedom our object-level strategy ideas need; candidate
strategies in each joint as **peer data values** receiving empirical judgement;
the five joints named (move selectors, evaluator selectors, evaluators,
aggregation rules, turn partitioning — the last amended to granular
per-board-state invocation under the shadow principle); no arbitrary caps in
the kernel (the scout's one-weight-unit clamp dies); MCTS/alpha-beta
mathematics translated in a principled way to this simultaneous-turn game so
that narrowing a branch's uncertainty translates into both compute allocation
and selection weight; the TRUE metric is
`score = (share of total end-of-game weight) × (number of teams)`.

**Scope.** Design only, no code. Anchors verified against
`claude/cluster-lookahead` @ `f4c2ff0` (worktree `scratchpad/cl-diag`).
Standing rulings honored throughout: weighted-random exploration over
integrated priors (seeded, private), conservative fog bias, always-on safety
floor, expensive evaluation may overturn cheap comparisons while respecting
priors, serious parallel compute on multi-second turns, overlapping clusters
with sliders in every cluster, post-contact continuation as a primary mode.
Code-efficiency work (workers, packing, WASM) is expressly OUT of this regime:
branches judged by pure benchmarking, never slot entries.

**Relation to the in-flight depth diagnosis.** `sweeps/depth-blockage-diagnosis.md`
had not landed at writing time. Nothing here depends on its verdicts; when it
lands, its findings become priors and cost-model rows in the registry (§1.4),
not amendments to this structure. The one prediction this design stakes: the
known blockers (the `?? 1` horizon fallback, the dark refinement seam, the
scout's advisory-only channel with a clamped magnitude) are all instances of
"deep information had no principled channel into selection" — §3 is that
channel.

---

## 0. The one paragraph

There is exactly one currency (expected final score in the game's true metric,
"sharePar"), one belief object (a per-branch **posterior**: a sound interval
plus a precision-carrying distribution inside it), and one economic law (spend
the next unit of compute where it buys the most expected decision improvement
per cost). Every strategy idea is a **registry entry** in one of five slots —
data with identity, priors, a cost model, and an empirical record — selected
per match by a **slate**, compared live by paired arms that select entries.
Heuristics that did not run leave their **shadow**: their prior output
distribution, sound-bounded by a certified span. Deep search findings are
**observations** that update a branch's posterior at their earned precision —
never clamped, never decayed by fiat. The sound machinery (interval bank,
floors/ceilings, safety floor, seeded determinism) is the inviolate kernel the
slots plug into; nothing in any slot can move a sound bound except a proof.

---

# 1. THE SLOT ARCHITECTURE

## 1.1 What a strategy IS now

Today a candidate strategy is a dark code path behind a `CENTAUR_*` flag; the
promotion ledger (`tools/learnloop/promotion-ledger.json`) judges flags. The
owner's objection is exact: the code paths accumulate, the off-arms rot, and
the paradigm makes every strategy a fork in the source rather than a value in
a table.

The replacement: the kernel exposes a small set of **primitives** per slot
(the mechanisms that exist and work: the conflict index, the Möbius edge-EV
surrogate, the cluster partition and exact enumeration, the multi-start
sampler, the bound bank, the feature folds, the thread machinery). A strategy
entry is a **parameterization and composition of primitives**, expressed as
data. Adding a candidate touches the registry and its tests; it does not add a
flag, and it does not add a dead code path — an entry that loses is a deleted
row, and a primitive no surviving row references is deleted code.

```ts
// registry.ts — the one new center of gravity
export interface StrategyEntry<Slot extends SlotId> {
  readonly id: EntryId                       // "agg/precision-merge@2"
  readonly slot: Slot
  readonly params: JsonValue                 // the WHOLE configuration — weights,
                                             // thresholds, composition order
  readonly primitive: PrimitiveId            // which kernel primitive interprets params
  readonly soundness: "advisory" | "sound-writing"
  readonly priors: EntryPriors               // §2.1: per-stratum output distribution
                                             // (evaluators) / effect prior (policies)
  readonly cost: CostModel                   // measured µs by board-shape features;
                                             // re-fitted by the learning loop
  readonly record: EmpiricalRecord           // measurements w/ batch ids, CIs, nulls,
                                             // engagement proof — the promotion-ledger
                                             // row, moved to where the strategy lives
}

export interface Slate {                     // what a match actually runs
  readonly moveSelectors:     ReadonlyArray<EntryId>   // slot 1 (composable, §1.2)
  readonly evaluatorSelector: EntryId                  // slot 2 (one policy)
  readonly evaluators:        ReadonlyArray<EntryId>   // slot 3 (the frame, §2.2)
  readonly aggregator:        EntryId                  // slot 4 (one rule)
  readonly scheduler:         EntryId                  // slot 5 (one policy)
}
```

The slate rides `TeamDecisionOptions` (per-engine, never process-wide — I1's
lesson stands). The harness's paired arms select **slates differing in one
entry**; seat rotation, concurrent nulls, engagement proof, and the ledger's
refusal rules all carry over unchanged — `learnloop` survives intact with its
unit of account changed from flag to entry id, and its schema gains
`slot`/`entryId` columns. The registry file is the single source of truth for
what candidates exist; `PROMOTION-STATUS.md` renders from it as today.

**The identity law.** An entry is immutable once measured: changing params
mints a new versioned id (`@3`), so every number in every record refers to a
bit-reproducible strategy. This is what "peer data values receiving empirical
judgement" requires — judgements must attach to fixed identities.

## 1.2 The five slots, precisely

**Slot 1 — MoveSelector** (cheap weighting of candidate moves for exploration,
before anything is simulated).

```ts
interface MoveSelector {
  // Logits over the COMPLETE candidate set of a unit/cluster. Additive
  // composition: the slate's selectors sum their logits (each entry's params
  // carry its own scale). NEVER a subset: order-not-set law — a probability
  // may choose the ORDER of anything, never the SET a floor closes over.
  logits(ctx: DecisionCtx, scope: UnitId | ClusterId,
         candidates: ReadonlyArray<Candidate>): Float64Array
}
```

Entries at migration: the gain-ordering key (promoted, becomes the default
row); the Möbius edge-EV surrogate `Ṽ = Σφ_u + Σφ_uv` (the pair layer, the
conflict-index potentials, follow-the-tail); the economy terms (meal refund,
race margin); the multi-start seed policy (its stage-0 uniform draw and
stage-1 restart schedule are params). Sound exclusions (rules-certain
fatality, staging safety, royal-path refusal) are **NOT** in this slot — they
are kernel safety floor (§4). The rejected committed-greedy joint seed is not
an entry: it is deleted, and its failure record (formation pinning) is kept in
the multi-start entry's record as the negative result that paid for it.

**Slot 2 — EvaluatorSelector** (which evaluators to run, per board state).

```ts
interface EvaluatorSelector {
  // Called by the scheduler with the current posterior state of a board's
  // candidates and the registry's shadows: returns invocation VALUE estimates,
  // not a fixed set — the scheduler buys the best (value/cost) work items.
  invocationValue(ctx: DecisionCtx, board: BoardHandle,
                  ev: EvaluatorEntry): VoiEstimate   // §2.3 — the VOC rule
}
```

Entries at migration: the **uncertainty-impact rule** (§2.3 — the owner's
principle, the default); the admission-governor predicates (slider/trail
detectors) recast as a degenerate policy that returns +∞/0 (they remain
useful as fast approximations and as the conservative-fog guard); `always-all`
and `material-only` as the bracketing baselines. The S0–S3 cohort ladder as a
*structure* dies here (§2.4): what survives is its arithmetic (spans, pending,
anchors) in the kernel and its predicates as entries in this slot.

**Slot 3 — BoardEvaluator** (the evaluators themselves).

```ts
interface BoardEvaluator {
  // Contribution to the frame value of a (plan, board), in sharePar units:
  // a sound interval + an advisory density. The sound half obeys the law
  // harness (soundness/monotonicity/collapse) as a REGISTRY ADMISSION GATE:
  // an entry that writes lo/hi and fails the laws cannot be registered.
  evaluate(ctx: DecisionCtx, plan: PlanHandle): FeatureContribution
  // {lo, hi, est, density?} — density optional, defaults to the entry prior
  readonly spanCert: (roster: RosterSummary) => number  // certified across-
  // candidate span: the sound width of this evaluator's SHADOW (§2.1)
}
```

Entries at migration: material, health economy, king margin, reach, room,
command (the slider repair), the potion-tier window terms; the
positional-portfolio thread adds voronoi, potion control, slider attack
vectors, and interception-deterrence as **new rows here, nothing else** — that
is the test of the architecture: a new positional heuristic is one registry
row plus its span derivation and tests. Weight tables stop being a single
calibration constant: an evaluator's weight is part of its entry params, and
the live operator knobs (§4.3) multiply it.

**Slot 4 — Aggregator** (how deeper-exploration information updates a branch's
weight — for BOTH further compute and final selection).

```ts
interface Aggregator {
  // Fold a new observation into a branch's posterior. Observations:
  //   bank price (sound interval, highest precision),
  //   evaluator contribution (computed or shadow),
  //   deep-thread finding (est-channel, precision = f(thread spread), §3.3),
  //   child posterior (backup across a ply, §3.4).
  update(post: BranchPosterior, obs: Observation): BranchPosterior
  // Two read-outs, one object — the owner's "both further compute investment
  // AND eventual selection" is satisfied by construction:
  allocationWeight(post: BranchPosterior, pool: PosteriorPool): number  // §3.2
  selectionKey(post: BranchPosterior): SelectionKey                     // §3.5
}
```

Entries at migration: **precision-weighted merge** (the default, §3.3); an
optimistic-backup variant (max-child with uncertainty inflation) as the first
challenger; and — during transition only — a `legacy-clamp` entry reproducing
today's one-step cap, kept exactly long enough to be the paired-arm baseline
that the merge rule must beat, then deleted. The clamp dies as a kernel rule
and survives briefly as a losing candidate: that is the paradigm shift in one
sentence.

**Slot 5 — Scheduler** (turn partitioning, amended per the owner's second
thought to granular per-board-state invocation).

```ts
interface Scheduler {
  // The decision loop's policy: given every branch's posterior, every
  // pending shadow's VOI, every thread's discrimination state, and the clock,
  // choose the next work item. Hard constraints live OUTSIDE the entry:
  // the staged-move emission barrier, the deadline, the safety floor,
  // and the sound-work reserve are kernel parameters, not policy.
  next(state: DecisionState): WorkItem
  // WorkItem = invoke(evaluator, board) | price(branch) | deepen(thread)
  //          | expand(cluster, unit) | emit()
}
```

Entries at migration: **greedy VOI/cost** (the default — buy the highest
value-per-microsecond item; §2.3 makes rounds emergent rather than
structural); a `slice-rounds` entry reproducing today's slice/rung behavior as
the transition baseline; reserve-split variants (the ply-1 reserve fraction as
a param). The thread scheduling of the post-contact ruling (discrimination per
millisecond vs alternatives, expansion on entanglement accumulation) is this
slot's vocabulary already — those rules become the default entry's params.

## 1.3 How a candidate is compared live

1. The registry holds N entries in a slot; at most one **challenge** per slot
   per batch (power arithmetic unchanged).
2. `make-promotion-batch` emits paired arms as **slates**: arm A = current
   defaults; arm B = defaults with one entry substituted. Byte-identical A/A
   nulls run as always. Engagement is proven per entry (the entry logs its
   own invocations on the wire — an entry that never fired cannot be judged,
   the cluster-seed lesson encoded).
3. `ingest` writes the measurement into the ENTRY's record. Statuses carry
   over (`candidate → probe-passed → live-supported → default | retired`),
   with one addition: **retired entries lose their code** in the same change
   that retires them, unless another live entry shares the primitive.
4. Deterministic probes (double-pricing, argmax-flip) remain necessary-never-
   sufficient, exactly per the learnloop doctrine.

## 1.4 Migration story — every existing flag, sentenced

| today | status in ledger | sentence |
|---|---|---|
| `CENTAUR_STAGING_SAFETY` | promoted | **kernel safety floor** — no longer configurable, flag deleted |
| `gainOrdering` | promoted | **slot-1 default entry** |
| `CENTAUR_MULTISTART_SEED` | new | **slot-1/5 entry** (seed policy) — first migration proof |
| `CENTAUR_CLUSTER_SEED` | live-failed | **code deleted**; negative record kept on the multi-start entry |
| `CENTAUR_EDGE_EV` | probe-passed | **slot-1 entry** (surrogate logits); its span law folds into §2.1 certificates |
| `CENTAUR_CLUSTER_ENUM` | probe-passed | **kernel primitive** (machinery, not strategy); when it runs is slot-5 policy |
| `CENTAUR_SAMPLED_CAP` | probe-passed | **params** on the slot-1 sampling entry (the cap is a sampled budget) |
| `CENTAUR_SCOUT` | probe-passed | threads = **kernel primitive**; scout schedule = slot-5 params; scout influence = **slot-4** (the clamp dies here) |
| `CENTAUR_TERRITORY_REFINE` | probe-passed | **observation type** consumed by slot 4 (sound tighten unchanged) |
| `CENTAUR_COHORT_POLICY` | live-null | **flag dies**; predicates → slot-2 entries carrying the live-null record |
| `CENTAUR_UNIT_FATALITY` | live-null | sound exclusions → **kernel** (rules-certain, near-zero cost; the null is recorded); advisory residue → slot-1 params |
| `CENTAUR_TIER_TRUTH` / `TIER_DEFENSE` | live-null / merged | **slot-3 entries** (potion-tier modeling), records attached |
| `TERRITORY_SLIDER_PROFILE` | supported | dissolves — profiles stop existing; its weights become slot-3 entry params |
| `CENTAUR_MUTUAL_WIPE_AWARD` | dark | **not a strategy** — a correctness fix to the terminal rule under the true metric (§2.2); promotes on its gate then the flag dies |
| `CENTAUR_WASM` | frozen (owner-closed) | already removed — and per the mandate, perf work never enters the registry |
| `CENTAUR_WORKERS` / `_AUDIT` | probe-passed | **deployment config**, not strategy — stays env/config, judged by benchmarks |
| `CENTAUR_ROYAL_MARGIN` | merged | **kernel safety-floor param** (king caution is the one justified caution) |
| `CENTAUR_ENGINE*` | n/a | substrate selection, untouched |

**Transition costs, priced honestly.**
- The registry, slate threading, and posterior object land before any entry
  migrates (§4.4 increment 0) — roughly the cost of one M-size stage.
- Every migrated flag owes a **byte-identity bridge**: `slate=legacy` must
  reproduce today's flag-off behavior bit-for-bit, and the entry form must
  reproduce flag-on bit-for-bit, before the flag is deleted (the S1 no-op
  discipline, reused). This is the bulk of the migration labor and is what
  makes it safe to do incrementally.
- `learnloop` schema migration: additive (new columns), one ingest-path
  change; the existing measurement history is re-keyed to entries, nothing
  re-run.
- Span certificates are owed for health economy (and any slot-3 entry lacking
  one) before its shadow is used soundly — already a named Stage-3 entry
  criterion in the round-fusion design; it transfers verbatim.
- The five-slot cut leaves seams: the conflict index feeds slot 1 but its
  sound vetoes are kernel; Door C's contested flood is slot-3-adjacent but
  publishes through the sound tighten. The rule that resolves every seam:
  **if it can change a sound bound, it is kernel behind the law harness; if
  it can only change order or spend, it is a slot entry.**

---

# 2. THE EVALUATION CORE

## 2.1 Shadow-prior semantics, formalized

The owner's principle: *"a heuristic that didn't run just leaves its prior
output distribution as its shadow. When the uncertainty impact of that prior
distribution default output is high relative to the other information
available for evaluating this board and the compute cost of running that
heuristic, then it should be run."*

The S3 bounded-perturbation envelope design arrived at the sound half of this
independently; we unify rather than duplicate. Per evaluator `f` and board
`b`, the shadow has two components:

- **Sound support** (the S3/round-fusion machinery, kept verbatim): the
  feature is `pending` on `b`'s bounds; its contribution lies in
  `[A_f.lo − S_f, A_f.hi + S_f]` where `A_f` is the meet of computed anchor
  contributions this decision (the mandatory seed anchor guarantees one) and
  `S_f` is the entry's certified across-candidate span. Floors and ceilings
  extend by these envelopes (`lo*`, `hi*`); a pending feature defeats
  discharge. **Nothing here changes** — the shadow's sound support IS the
  envelope.
- **Advisory density** (new, and the actual "prior output distribution"):
  the entry's `priors.outputPrior[stratum(b)]` — a fitted distribution of the
  feature's contribution, conditioned on cheap board strata (roster mix,
  phase, contact structure; the strata the sweep corpus already mines),
  truncated to the sound support. Its mean feeds `est*`; its variance is the
  shadow's **uncertainty mass** `σ²_f(b)`. Priors are fitted by the learning
  loop from the same replay corpus that prices everything else, and re-fitted
  as the entry's record grows — the empirical record and the prior are the
  same data at two ages.

When `f` runs on `b`: the pending entry clears, the envelope share is
replaced by the computed interval (round-fusion's sentence), and the density
collapses to the computed `est` with residual variance from world-uncertainty
only (interval width). One mechanism, two precisions.

## 2.2 One frame, denominated in the true metric

**The frame is the full registry.** Every bound published in a decision is a
statement about `V* = Σ_{f ∈ slate.evaluators} w_f·f`, with un-run features
pending. There are no cohorts as bases, no mid-turn re-basing, no per-round
objectives: rounds and boards differ in **provenance** (which features are
computed), never in **basis**. Cross-basis refusal survives where it is truly
needed — postures, narrowings, operator pins, reference actions — but
"evaluated by different heuristics" stops being a basis difference because
the envelope machinery makes it a precision difference.

**Commensurability across differently-evaluated boards** is then one rule
with two cases (round-fusion §1.4, promoted from rounds to boards):
- equal pending sets ⇒ compare cores directly (constants cancel; bit-identical
  to today when slates match);
- different pending sets ⇒ compare frame endpoints `lo*/est*/hi*` (sound by
  the envelope arithmetic; conservative exactly where information is
  missing). A mixed comparison on cores is a typed refusal — it can never run
  silently.

**Denomination.** `V*` is calibrated to the game's actual reward:
`score = (our share of total alive weight at adjudication) × (number of
teams)`, par 1, continuous in margin, previous-turn weights on a mutual final
wipe. Three consequences:
1. The mutual-wipe clamp fix stops being optional: a mutual final trade while
   ahead is a WIN at the terminal rule and must be priced as one (the dark
   flag's gate becomes a correctness gate, not a strategy question).
2. **The denominator is a weapon**: removing enemy weight raises our share
   with our own weight unchanged. Severs and kills are first-class value —
   material's sign convention already captures kills, but sever damage
   (measured at 3× the kill channel, currently unattributed) gets a dedicated
   slot-3 evaluator row with both halves: realized sever damage in the sound
   channel, sever THREAT in the advisory channel.
3. Because share is a ratio, the marginal value of weight is state-dependent
   (steep near parity, flat far ahead). That shape is an evaluator's job, not
   the kernel's: a `share-curvature` slot-3 row (a transform on the material
   contribution near adjudication) is the registered way to express it, and
   the 10× material-over-positional ratio becomes what the audit said it
   always was — a chosen prior, now living in entry params where the weight
   ladder can move it with receipts.

## 2.3 The invocation rule — the VOC rule it is

Value of computation for "run evaluator `f` on board `b`", written in the one
currency:

```
VOI(f, b) = E[ L(argmax before) − L(argmax after collapsing f's shadow at b) ]
```

where `L` is expected sharePar loss and the expectation is over the shadow
density. The exact form is unaffordable; the operational estimator is the
**boundary-straddle rule** (already derived in round-fusion §2 for envelopes,
now with densities): collapsing `f` at `b` can matter only if `b`'s
posterior, with `f`'s shadow variance removed, could cross a decision
boundary — either the staging comparison (`b`'s branch vs the incumbent) or
an allocation cutoff (whether `b`'s branch keeps receiving compute). So:

```
VOI(f, b) ≈ P(flip) × E[|Δ| given flip]        — both from the joint posterior
run f on b  when  VOI(f, b) / cost_f(b)  is the best spend available
                  (greedy, against every other WorkItem's ratio)
```

`cost_f(b)` comes from the entry's fitted cost model. The scheduler (slot 5)
just buys the best ratio each iteration; the safety floor and the sound-work
reserve are kernel constraints on what it may buy.

**How this dissolves rounds-vs-granular.** With per-(board, evaluator)
invocation gated on VOI/cost, "rounds" are what the greedy schedule *looks
like* when the frontier is homogeneous: cheap evaluators have high VOI/cost
everywhere first (a cheap wave), then expensive evaluators fire only where
shadows straddle boundaries (a targeted wave). On heterogeneous frontiers the
waves interleave and no round structure exists. The owner's original slot 5
("distinct heuristic portfolios per round") and his second thought (granular
invocation) are the same design at two schedule densities — the registry
keeps `slice-rounds` as a baseline entry so the emergent schedule has to beat
the structural one on the record before the old machinery is deleted.

**Fog stays conservative by construction**: a shadow's sound support widens
under fog (spans certified per-world include cloud worlds), so un-run
evaluators contribute wide envelopes on foggy boards — the floor reads the
wide end, and the pessimistic detector entries in slot 2 remain available as
overrides where the owner's conservative-fog ruling wants a hard guarantee
(a possibly-promoted pawn counts as a slider, unchanged).

## 2.4 What this retires from S0–S3, and what it keeps

Kept, verbatim force: span certificates; pending sets on `ScoreBounds`; the
seed anchor; anchor meets; the framing/conditioning discharge split; the
per-entry law harness; `est` never adjudicating; clock-blind admission facts
(a VOI estimate may read the *posterior state*, and the scheduler may read
the clock, but no board belief ever does — the firewall stands).

Retired: the cohort as an `Assumption` variant (one frame ⇒ no cohort basis);
the cohort ladder and nested veto (already overruled by round-fusion);
mid-turn cohort-flip control flow; the admission governor as a *component*
(its predicates live on as slot-2 entries); `CriterionProfile` as the unit of
evaluator configuration (profiles were pre-registry slates — the slate is the
profile now).

---

# 3. THE SEARCH CORE

## 3.1 The posterior object

Every branch (a candidate joint plan at ply 1; a continuation node in a
thread) carries:

```ts
interface BranchPosterior {
  readonly lo: number; readonly hi: number   // sound frame endpoints lo*/hi*
                                             // (bank + envelopes; the alpha-beta half)
  readonly mu: number; readonly prec: number // advisory density inside [lo,hi]:
                                             // mean and precision (1/σ²), truncated
  readonly provenance: ObservationLog        // what built it: prices, features,
                                             // shadows, deep notes, child backups
}
```

The sound interval and the density are **channels with different laws**: the
interval moves only by proof (bank price, sound tighten, witness, dominance);
the density moves by any observation at its earned precision. Staging reads
them in that order (§3.5). This is the honest marriage of alpha-beta (sound
bounds) and MCTS-style statistics (posterior sampling) the owner asked for —
not a new invention, but the two machineries assigned to the two channels
they are actually sound for.

## 3.2 Selection = posterior sampling (the weighted-random ruling, made principled)

Compute allocation each scheduler iteration samples work in proportion to
posterior draws: for branch pricing/deepening, draw `ṽ_a` from each live
branch's density (seeded, path-addressed PRNG — determinism law unchanged)
and take the top-k of `ṽ_a / T` via the existing Gumbel-top-k machinery.
This is Thompson-style sampling: **the exploration bonus is the posterior's
own spread** — a branch explored deeply has a narrow density and gets picked
only if its mean earns it; a barely-seen branch has a wide density and gets
occasional draws by uncertainty alone. Consequences:

- No optimism constant, no visit-count bonus, no cap: the "uncertainty
  bonus" is derived, not chosen. The one knob is the temperature (existing,
  scheduler-side, allowed to cool with the clock per the standing default).
- The owner's ruling — weighted random over integrated priors — is satisfied
  exactly: the weights ARE the integrated priors (shadows + computed values +
  deep notes), and the integration rule is slot 4's registered entry.
- Narrowing a branch's uncertainty translates into compute allocation
  automatically: as `prec` grows, `P(draw)` converges to the indicator of
  being best — deep search *earns* its focus rather than being granted it,
  and abandons a refuted branch with no pruning ceremony (allocation mass
  just leaves; the branch stays in the set per order-not-set).

## 3.3 Deep information updates the posterior — the clamp dies

**What `clampToLat` guarded.** A thread's finding is a material fact at a
different turn, conditional on the path explored and the clouds dilated —
a *time-skewed, model-conditional* estimate. Letting it move ply-1 ordering
by its raw magnitude risks one noisy channel dominating solid this-turn
facts; the shipped guard was a constant: at most one lightest-unit weight
step of influence, ever. The owner's objection stands: the constant is
arbitrary, and it caps exactly the discoveries depth exists to make (a
forced regicide three plies out is worth its full magnitude, not one step).

**The principled replacement.** A deep finding is an observation
`(value v_d, precision π_d)` folded into the branch posterior by the slot-4
entry (default: precision-weighted merge — `mu ← (prec·mu + π_d·v_d)/(prec+π_d)`,
`prec ← prec + π_d`). The precision is **derived, not chosen**:

```
π_d = 1 / σ_d²,   σ_d² = (thread's value spread at the finding's node)²
                        + Σ un-modelled interference terms along the path
```

concretely: the discrimination-state quantities the post-contact ruling
already tracks (floor spread across the node's options under the thread's
dilated field, saturation fraction, the width contributed by held clouds at
each ply). A finding from a clean, enumerated, non-interfered line arrives
with high precision and moves the branch by nearly its full magnitude; a
finding from deep fog arrives nearly information-free. **Influence is bounded
by earned precision instead of by a constant** — the cap's job is done by
arithmetic that scales, in both directions, with exactly the thing the cap
was a crude proxy for.

**Why this is sound where the clamp was sound.** Three guards replace the
constant:
1. **Channel law**: deep observations update the density only. The sound
   interval never moves on a deep note — a thread may contribute soundly
   only via a carried witness (a concrete refuting reply is a true ceiling
   at ply 1) or a Door-C tighten, both existing lawful doors.
2. **Floor-first staging** (§3.5): no density, however confident, outranks a
   sound dominance. The finding can decide everything the floors leave
   undecided — which, per the measured tie-set sizes (median 7–9 candidates),
   is most of the actual decision — and nothing the floors settle.
3. **Commensurability**: a deep value is denominated in sharePar via the
   thread's own bank prices at its root, through the same frame endpoints as
   everything else — never a raw feature delta smuggled across plies.

## 3.4 Backup for a simultaneous-move game

Minimax backup does not transfer literally: turns are simultaneous, replies
are hidden, and values are intervals. The translation, channel by channel:

- **Sound channel (the alpha-beta half).** Unchanged in law: floors are
  maximin over the modelled reply set (the bank's min side), ceilings are
  best-case over worlds, and **dominance prunes**: `hi*(p) ≤ lo*(q)` retires
  `p` from *spending* (and from staging, by comparison) — this is alpha-beta
  cutoff generalized to intervals, and the bank already implements it. What
  changes: dominance now runs on frame endpoints (so differently-evaluated
  branches dominate soundly), and the information-set constraint governs any
  multi-ply sound claim (one enemy reply per information set, never
  per-branch clairvoyance — the existing law, restated as the simultaneity
  translation of "the opponent moves after seeing nothing").
- **Advisory channel (the MCTS half).** A node's density backs up through
  the slot-4 entry. Default: the parent's density over our continuation
  choice is the precision-weighted density of the **softmax-best child under
  the current temperature** (soft-max backup — consistent with sampling; a
  hard max would manufacture optimism the sampler then double-counts), with
  enemy replies integrated under the thread's reply model at its own
  precision. Alternative backup rules are slot-4 entries; the arithmetic is
  data.

## 3.5 Final selection — one adjudication ladder, both machineries

Staging (per emission, progressive confidence unchanged):

```
0. safety floor: vetoed rows are out (certain death, terminal clamps) — inviolate
1. sound dominance on frame endpoints: dominated rows are out
2. lo* descending — the proven floor adjudicates where it separates
3. mu descending  — the posterior decides among floor-ties (deep info, shadows,
                    and computed features all speak here at earned precision)
4. prec descending — the better-KNOWN branch wins density ties
5. salted key — determinism
```

`hi*` never promotes (eliminates and schedules only). The owner's "expensive
rounds may overturn cheap comparisons while respecting priors" reads off the
ladder directly: a cheap comparison is a `mu` comparison at low precision;
an expensive evaluation or a deep line re-weights `mu` and can flip it —
within whatever the sound envelopes permit, which is exactly "respecting the
priors." What no observation can flip is a sound dominance, because that is
a fact about every world, not a prior. Allocation (§3.2) and selection (this
ladder) read **the same posterior** — the owner's requirement that branch
narrowing feed both, satisfied by there being only one object to read.

## 3.6 What this does to the depth blockage

Whatever the in-flight diagnosis names, this core removes the three standing
structural suspects: the advisory-only scout channel becomes a first-class
posterior input (§3.3); the horizon fallback loses its reason to exist
(deepening is a WorkItem the scheduler buys whenever a thread's expected
narrowing wins the VOI race, not a rung behind a dark seam); and depth's
findings are no longer capped into irrelevance, so depth can pay — which is
the precondition for the learning loop ever measuring that it does. The
diagnosis's findings land as: priors on thread-value spread (π_d
calibration), cost-model rows for deepening, and possibly a dedicated slot-5
challenger. No structural amendment anticipated.

---

# 4. INVIOLATES, KNOBS, AND THE FIRST INCREMENT

## 4.1 Inviolate (no slot entry can reach these; law harness gates registry admission)

- **Safety floor**: certain-death staging refusal, ordered terminal clamps
  (now aligned to the true metric, §2.2), king-caution margin, best-tier
  retention, the never-empty candidate guard.
- **Soundness laws**: floors never above truth, ceilings never below;
  refusal of incomparable bases (postures, narrowings, pins); order-not-set;
  pending defeats discharge; the scheduler/bounds firewall (a misallocated
  millisecond costs strength, never correctness — under a randomized
  scheduler the soundness suite stays green).
- **Seeded determinism**: path-addressed PRNG, private per-match seed on the
  wire, prefix determinism across budgets, deterministic merge across
  workers.
- **Conservative fog bias**: pessimistic possibility clouds everywhere sound
  channels read; a possibly-promoted pawn is a slider.
- **The engagement law**: nothing promotes to default on a probe alone.

## 4.2 Kept, reconciled

The interval bank and its laws (the sound channel's engine, untouched); the
edge-EV Möbius decomposition (slot-1 entry + the surrogate primitive); the
multi-start sampler (slot-1/5 entry, the first migration); VOC (formalized as
§2.3, now the scheduler's economy rather than a lever-ranking sidecar); the
posture governor (kernel fog-state machinery; its thresholds are params, its
channel policy inviolate); S0–S3's spans/pending/anchors (the shadow's sound
half, §2.1); the thread machinery with post-contact continuation (kernel
primitive; policies in slot 5); operator pins (kernel override channel,
policy-blind as ever).

## 4.3 The operator knob surface — named integration point, not designed here

The owner wants live per-heuristic weight dials, global and per-unit, for the
centaur operator. In this architecture that surface is well-defined: a knob
is a **runtime multiplier on a slot-3 entry's weight** (global) or on its
per-unit contribution (per-unit), delivered over the operator-pin channel,
stamped on emissions like any pin, and treated by the frame as a within-basis
recalibration (envelopes rescale with the weight; no re-basing ceremony).
The positional-portfolio thread designs the actual surface (which knobs,
ranges, UI wire format); the core guarantees the semantics above so that
thread touches nothing in the kernel.

## 4.4 First buildable increment

**Increment 0 — the spine (M-size).** Registry types + slate threading
through `TeamDecisionOptions` + `BranchPosterior` on plan candidates +
`slate=legacy` byte-identity harness. No behavior change; the whole suite and
a replay byte-identity test are the gate.

**Increment 1 — the first real judgement (M-size).** (a) Slot 4 with two
entries: `precision-merge` and `legacy-clamp`; the scout's findings flow
through the slate's aggregator — the clamp becomes a losing candidate or a
winning one, on the record, and the kernel constant is deleted either way.
(b) Slot 1 migration of the multi-start sampler and deletion of the rejected
committed-greedy seed. (c) The mutual-wipe terminal fix promoted under the
true metric. One live batch judges (a); its arms are slates.

**Increment 2 — shadows live (L-size).** Pending densities (priors fitted
from the existing corpus per stratum), `est*` from shadow means, the VOI
boundary-straddle estimator, and slot 5 with `greedy-voi` vs `slice-rounds`.
This is the increment after which "which evaluators ran on this board" is an
economic outcome, and the cohort flag apparatus is deleted.

Everything after (evaluator-row migrations, sever-threat and the positional
portfolio, backup-rule challengers, depth-diagnosis integration) is ordinary
registry traffic — which is the point.

---

# 5. OWNER SUMMARY

(Checked: `node tools/principal-glossary/check-briefing.js < bullets.md` on
`claude/cluster-lookahead` — exit 0.)

- Every strategy idea now lives in one of five sockets — weighting candidate moves, choosing which evaluators to run on a board, the evaluators themselves, folding deep-search findings into a branch's weight, and scheduling the turn's compute — and each candidate is a data entry with its own priors, cost model, and measured record, not a switch guarding dormant code.
- Comparing strategies live means two teams run identical setups differing in exactly one entry; the promotion ledger keeps all its rules but judges entries instead of switches, and an entry that loses takes its code out of the tree with it.
- An evaluator that didn't run on a board leaves its shadow — its prior output distribution, carried inside a certified worst-case width — so boards evaluated by different subsets of evaluators still compare on one common scale.
- An evaluator runs on a board exactly when the uncertainty its shadow leaves there could plausibly change a decision and outweighs its compute cost, so per-turn "rounds" stop being a built structure and become whatever grouping that economics naturally produces.
- Every branch carries two things: a sound floor-and-ceiling interval under the unchanged soundness laws, and a belief about the true score inside it, assembled from computed evaluations, shadows, and deep findings, each weighted by its earned precision.
- Exploring a branch more deeply narrows that belief, and the same narrowed belief drives both how much further compute the branch attracts — weighted random selection in proportion to its chance of being best — and how it ranks when the move is chosen; the arbitrary one-weight-unit cap on deep findings is deleted.
- What that cap was protecting against — a foggy multi-turn hint outshouting a solid this-turn fact — is now handled by arithmetic: a finding's influence scales with the precision it earned along its line, and sound floors still outrank beliefs when the move is staged.
- All scores are denominated in the game's true reward — our share of total end-of-game weight times the number of teams — so cutting enemy weight through severs and kills pays the score directly, and a mutual final wipe while ahead is priced as the win the rules make it.
- The safety floor, the floor-and-ceiling soundness laws, seeded replayable randomness, and the conservative reading of fog are untouchable: no entry in any socket can reach them, and speed work stays on branches judged purely by benchmarks.
- First build: the entry registry and the per-branch belief with everything byte-identical to today, then the deep-findings cap replayed as the first live entry-versus-entry comparison, then shadow-driven evaluator scheduling — after which new strategy ideas are registry rows, not new code paths.

> BUILD NOTE (2026-08-29, increment 1 = 42d03ca): Sec.4.3 dial-
> recalibration precondition resolved NARROWER — between-decision dials
> already re-price fully (per-decision memo, evaluationIdentity
> namespacing); per-feature parts retention in the bank memo buys only
> WITHIN-decision re-valuation and is deferred (memo value-type + worker
> protocol change; tripwire test pinned). Slice-count nondeterminism in
> the anytime loop recorded as an open instrument mystery.
