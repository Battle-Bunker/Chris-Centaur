# 03 — THE KERNEL SURFACE: what the lobster must expose, and what it costs

DECISION-LENS design, document 3. This is the KERNEL lens: the seam between the
anytime search and everything that wants to look at it. It owns five questions
and refuses a sixth.

**Owns.** What a *cluster* is in the kernel's own terms; what the kernel must
retain instead of discarding at the first comparison; how a hypothetical lock is
priced and why that price is the same object an actual lock stages; what happens
to a running decision when a unit is unlocked underneath it; and what must be
stored so a replay moment and a live moment are the same fold over two sources.

**Refuses.** How any of it is drawn. The lens surface is a stream of typed
frames on the kernel's own clock; where those frames land on a board, in a
table, or in a timeline is the UI lens's, and how they are stored, indexed and
served is the data lens's.

Everything below is grounded in code on `lens-kernel`. File and line citations
are to that branch; design citations are to the four design branches named in
the brief. Where I recommend a behaviour change to the kernel I say so and mark
it **[CHANGE]** — there are exactly three, and one of them is one line.

---

## 0. The one-paragraph version

A cluster is a connected component of the occupancy-reach interaction graph over
the units the bot may still move — pinned, committed and reference-fixed units
deleted as *vertices*, because a decision the bot cannot change cannot couple
two decisions it can. The kernel already computes the graph's edge relation
(`Substrate.influenceOf`, memoised, and the crossfade gate already reads it) and
already recomputes the vertex set on every constraint epoch. Movesets are the
cluster restrictions of joint plans the bank already priced and `better()`
already threw away: retained in a bounded top-k reservoir per cluster, at the
cost of `k` comparisons per trial and zero evaluations. The condition under
which each retained alternative would dominate is the *branch of `better()` that
refused it* — a witness, a basis mismatch, a residue of held claims, an
advisory-channel margin, or genuine indifference — so the threat/opportunity map
is free, because it is a record of a computation rather than a new one. A
conditional ranking is a speculative pin context, which the kernel already
searches one slice in four; making it *the same context the commit promotes* is
what stops inspection and action disagreeing. And a replay moment is the same
reducer over the same frames, read from an archive instead of from a live sink.

**The headline cost claim: the lens adds no evaluation to the hot loop.**
Everything it retains was already computed; everything it computes fresh runs
after the deadline or on the operator's own click.

---

## 1. Clusters

### 1.1 There is no partition on this branch, and that is the first thing to know

`makeSearchCore` (`src/lobster/search/core.ts`) runs one joint coordinate ascent
over the *whole* roster: `rosterOf` (`core.ts:199`) returns every commandable
unit less the reference-fixed ones, `sweep` (`core.ts:425`) walks all of them in
`dangerOrder`, and `improve` (`core.ts:526`) returns one whole-board
`PlanScore`. `src/lobster/search/cluster-partition.ts` and `cluster-enum.ts`
exist only on `claude/cluster-lookahead`; nothing on this branch computes a
component.

So the lens does not *read* a cluster from the search. It **defines** one, from
material the kernel already has, and hands it back to the search later as an
ordering and proposal device if anyone wants it. Under Law D1 that is the only
legal direction of travel anyway:

> **Law D1** (`origin/design/search-theory:docs/design/search/02-DECOMPOSITION.md` §2)
> — *a decomposition of the board may be used to GENERATE candidate joint
> actions. It may never be used to compute, bound, order or compare a value.*

Every number this document attaches to a cluster is a **whole-board** number.
There is no cluster-local score anywhere in the design, and §2.3 states the
exact reading that keeps it honest.

### 1.2 The definition

```ts
/** Units this decision may still move: the cluster graph's vertex set. */
function freeSet(run: Run): ReadonlySet<UnitId>
```

`freeSet` = `sub.commandable(asTeam)` minus, in this order:

| removed | why | where the kernel already knows |
|---|---|---|
| units carrying a `reference-action` assumption | not ours to command (held-capacity modelling fixes them); the search never sweeps them and they ride *every* plan | `core.ts:199` `rosterOf`, `Session.references` |
| units with an **honourable** committed pin | a pin is a constraint; `Session.pinned` is excluded from sweep, repair, polish and perturbation | `kernel.ts:1292` `honorablePins`, `core.ts:262` `open` |
| units in `run.committedUnits` | a human Submit is permanent for the turn even when the kernel has no destination to pin it at (V4 R7a) | `kernel.ts:1185` `applyPinEvents` |

And **not** removed:

- **units whose pin the grammar cannot reach.** `auditPins` refuses those, the
  unit keeps its own choice, and `searchContext` (`kernel.ts:1336`) filters them
  out of `ctx.pins` and substitutes a named `narrowing`. Such a unit is still
  searched, so it is still a vertex. Its cluster row carries the narrowing, and
  the lens must render "the operator asked for a cell this unit cannot reach"
  rather than "pinned". This is a small case and it is exactly the case a naive
  `pins.map(p => p.unitId)` gets wrong.
- **tentatively pinned units.** A tentative pin is a hover, not a constraint
  (`applyPinEvents` case `pin`: `if (ev.pin.tentative) … break` — no epoch). The
  committed cluster keeps the unit; the *speculative* context's cluster does not.
  Two partitions coexist, one per context, and §3 is where that pays.

The interaction relation on `freeSet`:

```
u ~ v   iff   influenceOf(u) ∩ influenceOf(v) ≠ ∅
```

`Substrate.influenceOf` (`src/lobster/substrate.ts:1142`) is the union of a
unit's **entire occupancy** (a trail unit's whole body, not its head) and **every
cell every legal path enters** (the whole ray, not the destination), memoised per
unit for the life of the substrate. That is precisely Law D2′:

> **Law D2′** (`02-DECOMPOSITION.md` §2b′) — *the interaction relation is the
> intersection of occupancy-reach sets, where a unit's occupancy is its cloud
> when its position is uncertain and its cells when it is not. Full
> observability is the point-mass case. There is no separate fog clause.*

A **cluster** is a connected component of `(freeSet, ~)`.

### 1.3 Three consequences worth stating as theorems

**T1 — deleting a pinned vertex can only split, never merge.** Components are
monotone in the vertex set: removing a vertex from a graph cannot connect two
previously disconnected vertices. So an operator pin narrows clusters and an
unpin widens them, always, in that direction only. The UI can animate the
transition without ever having to reconcile a contradiction, and the reactivity
story in §4 is a one-way street.

This is Pearl's cutset conditioning (1986) read as an operator gesture: the
measured shape of the interaction graph is *a star whose hub is a slider 89.7%
of the time* (`02-DECOMPOSITION.md` §1), so pinning the hub is exactly the
textbook separation, and the operator does it by clicking on the queen.

**T2 — no slider fiat.** `cluster-partition.ts` on `claude/cluster-lookahead`
augments *every* component with *every* live slider we command. That fiat exists
to make the exact enumeration sound and it is fatal to this lens: it makes every
cluster the whole board, and the operator's "the pieces near my queen" becomes
"all of them". The lens takes the plain component. Nothing is lost, because the
geometry already does the work the fiat was doing — a slider's ray *is* an
occupancy-reach set that crosses components, so a slider that genuinely couples
two groups is already in one component with both of them. What the fiat adds
over the geometry is coupling the geometry says is not there.

**T3 — most clusters are singletons, and that is the continuity story.**
Measured over 563,557 team-turns (`02-DECOMPOSITION.md` §1): components are ≤ 3
on 98.9%, and 88.7% are singletons. So on a snake board the moveset table for
most units *is* the old per-candidate table, one unit wide, and the new surface
degrades continuously into the old one instead of replacing it with something
unrecognisable. The interesting rows are the 1.1%, and they are the rows the old
table could never have shown at all.

### 1.4 Cost

The graph's *edges* are a function of the board alone — `influenceOf` reads
positions and grammar, never a plan — so the board is fixed for the turn and the
edge relation is computed **once per decision**. Only the vertex set moves, and
it moves only on a constraint epoch.

```
build   (once per decision)   inverted index cell → units, then pairs from it:
                              O(Σ_u |influenceOf(u)|) inserts, no evaluation.
                              influenceOf is memoised and the crossfade gate
                              (kernel.ts:1790) already calls it on every gated
                              write, so on any board where crossfade is on the
                              sets are already warm.

partition (once per epoch)    union-find over surviving vertices: O(V + E),
                              V ≤ 26 at the top of the throughput table.
```

Against one `price()` at ~18 ms on a 26-unit board (`core.ts` session note) and
a decision's measured ~470 fresh evaluator calls at a 150 ms budget
(`src/tests/local-game.ts`, `DEFAULT_NODE_BUDGET` derivation), a union-find pass
over ≤ 26 vertices is not a line item. **This matters most on the path where it
is measured**: the epoch re-partition runs inside the conformance re-stage, whose
own contract is `slicesBefore === 0` (`ConformanceSample`, `kernel.ts:501`), and
the lens must not be what breaks it.

### 1.5 Identity across emissions

Law I (`joints/07-SYNTHESIS.md` §3): *names find, hashes validate; a cache keyed
by name is a bug, a carry keyed by hash is a bug.* So a cluster carries both.

```ts
/** Stable NAME. The smallest member unitId — the anchor. Deterministic,
 *  survives a cluster gaining or losing a non-anchor member, and is what the
 *  UI keys its list on so a row does not blink when the search finds a new
 *  moveset. */
type ClusterId = number

interface ClusterView {
  readonly id: ClusterId
  readonly members: ReadonlyArray<UnitId>          // ascending
  /** CONTENT HASH. Sorted members + basis. What a consumer VALIDATES a
   *  retained moveset against before reusing it. */
  readonly key: string                             // `c:[3,7,11]@e2/SIGHTED`
  readonly epoch: number
  readonly posture: Posture
  /** Constraints this cluster sits inside: pinned/committed units whose
   *  influence meets a member's. They are not members; they are why the
   *  cluster has the shape it has, and the operator put them there. */
  readonly boundedBy: ReadonlyArray<{
    readonly unitId: UnitId
    readonly to: CellIndex
    readonly why: 'pin' | 'commit' | 'reference' | 'pin-unreachable'
  }>
  /** Where this cluster came from at the previous partition. Empty on the
   *  first partition of a decision. */
  readonly lineage: ReadonlyArray<ClusterId>
}
```

The anchor is not stable under merge (two clusters merging take the smaller
anchor) or under a split that removes the anchor. `lineage` is what makes those
transitions legible rather than a list that re-shuffles: a merge emits one
`ClusterView` whose `lineage` names both parents; a split emits two whose
`lineage` names the one parent.

**Cluster events** are derived by diffing successive partitions, never asserted:

```ts
type ClusterEvent =
  | { kind: 'split';    from: ClusterId;   to: ReadonlyArray<ClusterId> }
  | { kind: 'merge';    from: ReadonlyArray<ClusterId>; to: ClusterId }
  | { kind: 'narrowed'; id: ClusterId;     lost: ReadonlyArray<UnitId> }  // member pinned, no split
  | { kind: 'widened';  id: ClusterId;     gained: ReadonlyArray<UnitId> }
```

each carrying the `PinEvent` that caused it, so the timeline can say *"you pinned
the rook; the king's cluster split in two"* rather than *"the cluster list
changed"*.

---

## 2. Movesets, aggregate scores, and the set-valued reduction

### 2.1 What is thrown away today, exactly

`better()` (`core.ts:410`) is the collapse point. It takes two priced results
and returns a boolean; the loser is dropped on the floor. Every one of its four
refusal branches knows *why* it refused and none of that reaches anything:

```ts
const better = (trial: BankResult, incumbent: BankResult): boolean => {
  if (refutedAt(trial.bounds.best, incumbent.bounds.worst)) return false   // (1)
  const cmp = compareFloors(trial.bounds, incumbent.bounds)
  if (!cmp.comparable) return false                                        // (2)
  if (cmp.order !== 0) return cmp.order > 0                                // (3)
  if (trial.est !== incumbent.est) return trial.est > incumbent.est        // (4)
  if (trial.bounds.best !== incumbent.bounds.best) return …                // (5)
  return planTieKey(trial.plan, cfg.seed) > planTieKey(incumbent.plan, …)  // (6)
}
```

The joints lens named this precisely: the set-valued reduction is *"already
computed and discarded at the first comparison — the collapse belongs at the
emission barrier"* (`joints/07-SYNTHESIS.md` §2, REDUCTION row: *a rule over
gambles returning a **SET** of (option, dominance condition)*).

So the design is: **keep the set; collapse at the barrier; store the branch that
refused.**

### 2.2 The retention: a bounded reservoir per cluster

```ts
interface MovesetRecord {
  readonly clusterId: ClusterId
  readonly clusterKey: string          // validates against ClusterView.key
  /** planKey of the CLUSTER RESTRICTION — the moves this row is about. */
  readonly key: string
  readonly moves: ReadonlyMap<UnitId, Candidate>

  // ---- the aggregate score. WHOLE-BOARD. See §2.3.
  readonly lo: number                  // ScoreBounds.worst
  readonly hi: number                  // ScoreBounds.best
  readonly est: number                 // advisory ordering channel; never adjudicates
  readonly exact: boolean
  /** Not the ledger — its SIZE and the units it cites. The ledger is the fat
   *  part of a ScoreBounds and the lens needs the shape, not the entries. */
  readonly ledgerSize: number
  readonly citedUnits: ReadonlyArray<UnitId>
  readonly assumptions: ReadonlyArray<Assumption>

  // ---- provenance. Every row can be traced to the comparison that made it.
  /** planKey of everything OUTSIDE the cluster at the moment this was priced.
   *  Two rows with different complements answer different questions. §2.3. */
  readonly complementKey: string
  readonly context: string             // pinContextKey — the basis
  readonly epoch: number
  readonly posture: Posture
  readonly rung: 'seed' | 'sweep' | 'pair' | 'polish' | 'restart' | 'conform'
  /** Kernel clock, ms from this decision's t0 — the same origin
   *  EmitRecord.elapsedMs uses (kernel.ts:1887), so one timeline. */
  readonly at: number
  readonly tie: number                 // planTieKey, so an indifferent order is reproducible

  // ---- filled at the barrier / on demand. Null until then.
  dominance: DominanceCondition | null
  explain: MovesetExplanation | null
}
```

**The reservoir.** One per `(clusterId, complementKey)`, `k = 5`, insertion-
ordered on the same key `better()` uses — `(lo, est, hi, tie)` — so the
reservoir's order and the search's order are the same order by construction and
cannot drift. Written from the one call site that already sees every priced
trial: the `better()` caller inside `sweep` / `pairRepair` / `jointPolish` /
`repairSelfHarm`.

**Cost: `O(k)` comparisons per priced trial and zero evaluations.** k=5 against
a `price()` that costs ~18 ms at 26 units is not measurable. Memory: a row holds
≤ 3 candidates in 98.9% of turns (T3), a handful of numbers, and two small
arrays — call it ~200 B. A decision-wide cap of **24 rows** (mirroring
telemetry's existing count discipline: `MAX_EXPLAINED_CANDIDATES = 96`, a count
and not a clock, *"so what a row contains is reproducible rather than a function
of how loaded the box was"*) bounds the whole surface at ~5 KB per decision.

**[CHANGE 1] `better()` returns a reason.** The reservoir needs the refusal
branch, so `better` becomes:

```ts
type Verdict =
  | { accept: true }
  | { accept: false; because: 'witness' | 'basis' | 'floor' | 'est' | 'hi' | 'tie' }
```

This must change no decision. The reason is derived from comparisons the
function already performs, in the order it already performs them. It is a
refactor of the hottest function in the search, which is exactly where an
accidental reordering hides, so it is gated on the prefix-determinism property
test (§5.4) and not merely on the unit suite.

### 2.3 What the number MEANS — the rule that keeps Law D1 honest

A moveset's `(lo, hi)` is the **whole-board proved bracket of the joint plan the
cluster's moves were priced inside**, with every unit outside the cluster on its
incumbent assignment. It is *not* a cluster-local value; no such value exists in
this system and computing one would be unsound for our payoff (`evaluate/index.ts`
opening note: *"It is not a per-unit score that a search may sum … Summed
per-unit values fail to cover joint value in both directions — measured,
repeatedly, by more than one workspace"*; and `02-DECOMPOSITION.md` §2: *"a
mid-turn collision couples the entire board … so `u(a) ≠ Σ_c u_c(a_c)` in
general, and the error is not small — it is the difference between a unit living
and dying"*).

The honest reading, which the UI must be able to render as a sentence:

> *"If this cluster plays these moves and the rest of the team plays what it is
> currently staged with, the team's proved floor is `lo` and its ceiling is `hi`."*

Which is why `complementKey` is a field and not a nicety. When another cluster
improves, every retained row is still **sound** — it was a real bracket of a real
plan — but it now answers a question about a team plan that is no longer staged.
The rule:

- rows are grouped by `complementKey`;
- a row whose complement is no longer the incumbent's is marked
  `complement: 'stale'` and is never compared against a fresh one;
- at the emission barrier, **if and only if** `remainingMs > 3 × entry.stepCostMs`,
  the top-3 stale rows of the leader's cluster are re-priced against the new
  complement (three `price()` calls, memo-warm because only the complement moved
  and the bank's evaluation memo measured 99.7% repeats). Otherwise they ship
  stale and say so.

This is the same discipline `TeamPinAdvice.degraded` already carries
(`pins.ts`): *"the honest thing an advisory surface can do is say which of its
numbers broke the rule rather than pretend it did not."* Same word, same
meaning, one vocabulary.

### 2.4 The set-valued reduction, concretely

For a cluster's retained alternatives `A = [a₁ (leader), a₂ … a_k]`, the
reduction is the list of pairs `(aᵢ, the condition under which aᵢ dominates a₁)`.
Every condition is a `better()` refusal branch read backwards:

| `better()` branch | condition | what the operator is being told |
|---|---|---|
| (1) `refutedAt(trial.best, incumbent.worst)` — a banked witness holds this plan below the leader's proved floor | **refuted-by-witness** | *"this loses to a concrete enemy line, and here it is"* — the witness is already stored on `PlanScore.witnesses` and survives restarts and pin-context switches by contract |
| (2) `!cmp.comparable` — different assumption sets | **incomparable-basis** | *"this was proved under different assumptions; it is not worse, it is not comparable"* — the two `Assumption[]` are the message |
| (3) floor order, with `aᵢ.hi > a₁.lo` | **contingent** | *"this leads if the held claims it cites resolve our way"* — `citedUnits` is the condition, `aᵢ.hi − a₁.lo` is how much is at stake |
| (3) floor order, with `aᵢ.hi ≤ a₁.lo` | **dominated** | *"this cannot win under any resolution of what we do not know"* |
| (4) floor tie, `est` decides | **advisory-only** | *"the proved floors are equal; the leader wins on the ordering channel that never adjudicates"* — the most important row in the table, because it is where the bot is guessing |
| (6) `est` tie too, tie key decides | **indifferent** | *"the searcher genuinely cannot tell these apart; the salt chose"* (`order.ts` `planTieKey`) |

```ts
type DominanceCondition =
  | { readonly kind: 'leader' }
  | { readonly kind: 'refuted-by-witness';  readonly witness: Witness }
  | { readonly kind: 'incomparable-basis';  readonly theirs: ReadonlyArray<Assumption> }
  | { readonly kind: 'contingent';          readonly onUnits: ReadonlyArray<UnitId>
                                          ; readonly atStake: number }
  | { readonly kind: 'dominated';           readonly by: number }   // margin on lo
  | { readonly kind: 'advisory-only';       readonly estMargin: number }
  | { readonly kind: 'indifferent' }
```

**This is the threat/opportunity map and it is free.** Every input is a value
the comparison already produced. The only cost is [CHANGE 1] plus one small
object per retained row, assigned at the barrier.

### 2.5 Per-unit, per-feature contributions

`Evaluator.explainPlan` (`evaluate/index.ts`) returns per-**feature**,
whole-**plan**: `{ key, value, weight, contribution }` for each term of the fold,
with the profile name and the discharge status. It does *not* decompose per
unit, and it must not: the fold is over one joint resolution and per-unit
quantities *"may order work and may never compose into a value"*.

So the honest per-unit column is a **contrastive delta, not a share**:

```
Δ(u, f) = explain(moveset).features[f].contribution
        − explain(moveset with u on its next-best candidate).features[f].contribution
```

A *difference of two joint explanations* is legitimate exactly where a sum is
not, and it is the question the operator is asking — *"what does this unit's move
buy?"* — rather than a fabricated attribution. It is also precisely the
counterfactual telemetry already computes (`telemetry.ts` note: *"A candidate's
evaluation is a COUNTERFACTUAL ON THE SETTLED PLAN … it keeps the plan's domain,
and therefore the modelled set, exactly what the decision itself used, so the
numbers are comparable with the ones the decision was made on (basis
identity)"*), lifted from a unit's candidates to a cluster's movesets.

```ts
interface MovesetExplanation {
  readonly profile: string                       // PlanExplanation.profile
  readonly bound: Bound
  readonly features: ReadonlyArray<FeatureContribution>       // the joint fold
  readonly exact: boolean
  readonly ledgerSize: number
  /** Per member, the swap-one delta per feature. Populated lazily; an entry
   *  absent means "not asked", never "zero". */
  readonly perUnit: ReadonlyMap<UnitId, {
    readonly foil: Candidate                     // what it was swapped to
    readonly deltas: ReadonlyArray<{ key: string; delta: Bound }>
  }>
}
```

**Where it runs.** Three tiers, and the split is the whole cost story:

| tier | what | when | cost |
|---|---|---|---|
| joint explanation of the retained rows | `explainPlan` per row | the **telemetry pass**, after the final emission, outside the budget (`team-decision-engine.ts` runs `buildDecisionRows` in the `finally`, *before* `sub.release()`) | ≤ 24 evaluations, against the existing `MAX_EXPLAINED_CANDIDATES = 96` ceiling |
| per-unit swap deltas | `1 + c` evaluations per row inspected | **on demand**, driven by the operator's selection | pay-per-view |
| live inspection mid-decision | either of the above | on the operator's click, charged to an `inspectionBudgetMs` that is *not* the search's | degrades by dropping to `explain: null`, flagged, exactly as telemetry's `unexplained` already does |

The owner's brief asks for this *"computed once at the emission barrier, not in
the hot loop."* The telemetry pass is later than the barrier, which satisfies
the intent more strongly: the barrier does no evaluation at all for the lens
beyond the ≤3 optional re-prices of §2.3.

---

## 3. Conditional rankings

> *"When selecting a specific unit's candidate move, the cluster's best movesets
> conditional on that move get surfaced — the same ranking that would immediately
> select the actual next staged moveset if that candidate were locked by the
> operator."*

The second half of that sentence is the whole specification. Inspection and
action must not be two code paths, because two code paths disagree, and this one
would disagree in front of the operator at the moment they commit.

### 3.1 The three options, priced

Measured inputs:

- one `price()` ≈ **18 ms** at 26 units against a 25 ms slice (`core.ts`
  `sessionFor` note: *"at 26 units, where one price is ~18 ms against a 25 ms
  slice, that is the entire slice"*);
- a 150 ms decision spends **~470 fresh evaluator calls** and ~11 000 clock
  reads; the deterministic work budget is **550 units** = `nodes×1 + reads×0.01`
  (`src/tests/local-game.ts`, `DEFAULT_NODE_BUDGET`);
- the bank's evaluation memo serves **99.7%** of repeats on a large board, so a
  re-search whose *complement is unchanged* is overwhelmingly memo-served;
- `maxSliceFraction = 0.1`, `sliceMs` floor 0.5 ms, slice length grows to
  `sliceCostFactor × measured` — so a 150 ms decision has on the order of **10
  operator-visible slice boundaries**, and a slice is *also the longest an
  operator's pin can wait to be drained* (`kernel.ts` `drive` step 4 note);
- a queen's mean option count is **64.4** against a per-unit cap of 4–8
  (`joints/07-SYNTHESIS.md` §4.6).

| | **(a) filter the retained top-k** | **(b) re-run the cluster with the lock as a pin** | **(c) precompute per candidate at the barrier** |
|---|---|---|---|
| exact | no — a subset of what was searched | **yes** | yes |
| may be empty | **yes, often** — the reservoir holds the cluster's top-5, and the operator is asking about a unit's 5th candidate | no | no |
| latency at click | **0** | ≤ 1 slice (≤ 0.1 × budget) | 0 |
| marginal cost per click | 0 | ≈ `c × candidateCap` prices, memo-warm; at c=3, cap=8: ≤ 24 prices, most memo hits | — |
| cost per decision | 0 | **0** — it rides the existing speculative period | `Σ_u |A_u| ×` (b) |
| (c) in numbers | | | one unit, snake: 4 × 1 slice = **40% of the decision**. One unit, queen at the measured mean: 64 × 1 slice = **6.4 × the whole decision**. Times up to 26 units. |
| agrees with what a lock would stage | approximately | **exactly, by construction** | exactly |

**(c) is refused on arithmetic, not on taste.** **(a) alone is refused because
its failure mode is silence** — the operator clicks and gets an empty table,
which is indistinguishable from "there is nothing good here" and is in fact "we
did not look."

### 3.2 Recommendation: (b), with (a) as the first paint

Two phases, one API call.

**Phase 1, same frame as the click.** Filter the retained reservoir by the lock.
Rows out immediately, marked `provisional: true`. If empty, `source: 'empty'` —
which the UI renders as *searching*, never as *nothing*.

**Phase 2, within one slice.** Open (or reuse) the speculative pin context for
the lock. **This machinery already exists and already runs.** `pickContext`
(`kernel.ts:1312`) takes one slice in `speculativePeriod` (default 4) for a
tentative pin, builds `pinContextKey([...committed, which], true)`, and — the
V1-BUG-4 fix — searches the pin as **binding** inside a context whose key merely
*names* it tentative. A hypothetical lock **is** a tentative pin. There is no
new search path to write; there is a reservoir to read out of a context that is
already being searched.

```ts
interface Lock { readonly unitId: UnitId; readonly to: CellIndex }

interface ConditionalRanking {
  readonly clusterId: ClusterId
  readonly locks: ReadonlyArray<Lock>
  /** The cluster AFTER the lock deletes its unit as a vertex. By T1 this can
   *  only be a narrowing or a split — never a widening. */
  readonly cluster: ClusterView
  readonly rows: ReadonlyArray<MovesetRecord>
  readonly source: 'retained-filter' | 'speculative-context' | 'empty'
  /** Refinement slices this context has spent. The answer's identity: two
   *  calls at the same cursor return byte-identical rows. */
  readonly cursor: number
  readonly provisional: boolean
  /** THE HANDLE. `pinContextKey([...committed, lock], true)`. This is the
   *  string that makes §3.4 work. */
  readonly contextKey: string
  /** True when the rows' basis is not the staged record's basis. Same word,
   *  same meaning as TeamPinAdvice.degraded. */
  readonly degraded: boolean
}

/** Pure function of (substrate, basis, locks, cursor). Never searches on the
 *  caller's thread; schedules and returns what is known. */
rankConditional(clusterId: ClusterId, locks: ReadonlyArray<Lock>): ConditionalRanking
```

### 3.3 Determinism

`rankConditional` must be reproducible or replay parity (§5) is a fiction. It
is, and every ingredient is already deterministic:

| input | why it is fixed |
|---|---|
| candidate order per unit | the generator returns best-first and the anytime path *"must never filter them"* (`order.ts` `topCandidates`) |
| sweep order | `dangerOrder(units, worstResolution, frozen)` — a function of the incumbent's own resolution and unit id, *"so a sweep is reproducible"* |
| tie-breaks | `planTieKey(plan, cfg.seed)`, a **sum** of salted per-candidate keys, decomposable so *"the ordering among A's tied options is a property of A alone"* — not a hash of the joined plan, which was the dither bug |
| acceptance | `(floor, est, ceiling, tie)`, strictly, with a basis mismatch a refusal |
| the clock | injected (`KernelInput.now`); under `--nodes` it is `nodes×1 + reads×0.01`, *"both terms are pure functions of the program's own execution"* |

So: **`(substrate, basis, locks, cursor) → rows` is a function.** The `cursor` is
part of the answer's identity and must be carried on the frame; a UI that caches
rows without their cursor is caching a different question's answer.

### 3.4 Why inspection and action cannot disagree — **[CHANGE 2]**

Today the speculative work is **thrown away on commit**. `pickContext` writes
into the `spec:[…]` namespace; `retarget` (`kernel.ts:1297`) obtains
`pinContextKey(run.pins)` in the `pin:[…]` namespace. Those are different keys by
construction (`pinContextKey`'s first character), so the operator's hover is
searched for four slices, the operator commits it, and the kernel starts from an
entry with `incumbent: null`.

The change: **on an epoch change, promote a matching speculative entry into the
committed namespace.**

```ts
// in retarget(), before cache.obtain:
const promoted = run.cache.promote(
  pinContextKey([...run.pins], true),   // the speculative form of the SAME pins
  pinContextKey(run.pins),              // the committed key
  run.epoch,
)
```

`promote` moves the entry under the new key and carries exactly what a basis
change permits:

| carried | why |
|---|---|
| `incumbent` (the plan) | a plan is not a promise; `improve` already resumes from `ctx.incumbent` and re-prices it |
| `witnesses` | *"certificates … survive restarts and pin-context switches"* (`PinContextEntry.witnesses`) |
| `cursor`, `citedUnits`, `stepCostMs` | accounting, not adjudication |
| **not** `bounds` / `boundsBasis` | a floor proved in the old epoch may not gate the new one. The new basis establishes its own floor from its own first emission — which is exactly what `newBasis()` already does and what the whole ratchet exists to make unrepresentable |

With that one change the sentence in the brief becomes literally true. The
sequence, end to end:

1. operator hovers candidate → `rankConditional` opens `spec:[…4@77?…]`;
2. the kernel searches it one slice in four; rows arrive; the operator reads them;
3. operator commits → `applyPinEvents` starts an epoch; `retarget` **promotes**
   `spec:[…4@77?…]` → `pin:[…4@77…]`;
4. `conformNow(run, run.wirePlan)` splices the pin into what the wire holds and
   emits the conformance re-stage (`slicesBefore` still 0 — `promote` is a map
   rename, not a search);
5. the next `improve` resumes from the promoted incumbent — **which is the top
   row the operator was looking at.**

The staged moveset is the inspected moveset because it is the same object in the
same cache entry, not because two rankings happened to agree.

---

## 4. Reactivity: a unit is unlocked mid-decision

> *"If another unit in the cluster gets unlocked by another player while we
> inspect, that reactively widens the cluster and brings in the fresh candidate
> movesets for the wider cluster."*

### 4.1 What the kernel does today

`onPinEvent` (`kernel.ts:828`) queues the event **stamped with its arrival
time**, not its dequeue time (V4 R2 — *"the conformance latency the report
publishes is the operator's, not the loop's"*). `drive` drains the queue at the
top of an iteration, after the event-loop yield and before any refinement, so an
event delivered by the yield opens its epoch in the same iteration.
`applyPinEvents` case `unpin` removes the pin and sets `epochChanged`, unless the
unit is in `committedUnits` (*"the bot never un-commits a human"*).

An epoch change then: pushes a `BasisSnapshot`, increments `epoch`, installs a
**new** `RatchetBasis` — *"the old one is dropped on the floor: no map from epoch
to floor exists"* — clears `run.plans` and `run.lastView`, calls `retarget`, calls
`conformNow(run, run.wirePlan ?? EMPTY_PLAN)`, and emits the conforming record
with a `ConformanceSample`.

### 4.2 The running decision RE-BASES; it does not restart

This is the existing behaviour and it is correct. Stating it because the lens
must not tempt anyone to change it:

- `improve` resumes from `entry.incumbent` and `entry.witnesses` — a contract
  guarantee (`contracts.ts` `SearchCore`: *"RESUMES from ctx.incumbent +
  ctx.witnesses rather than restarting"*);
- the widened committed context's key is `pin:[…]` **without** the unpinned
  token, which is very likely the key the decision was running under *before* the
  pin — a tier-3 LRU with `pinCacheCapacity: 8`, cleared per turn. So the wider
  cluster's incumbent, witnesses and **reservoir** are still there and the
  operator's list refills from cache;
- the only things an unlock invalidates are the **ratchet floor** (a new basis)
  and the **plan table** (`run.plans.clear()`), and both are floors, not
  knowledge.

So: **an unlock costs one conform and no search.** That is the reactivity budget,
and it is already paid.

### 4.3 What the lens emits — **[CHANGE 3]**, a second sink

The frames must not travel on `AsyncIterable<EmitRecord>`. That channel's
consumer is the wire (`team-decision-engine.ts` forwards every record to
staging), and a frame arriving there would be a staged plan. A separate,
optional, synchronous sink:

```ts
interface KernelInput {
  // … existing fields …
  /** The lens sink. Called BETWEEN slices only, never inside one. Wrapped in
   *  try/catch by the kernel: a lens consumer that throws must not be able to
   *  take a decision down (the rule telemetry already has). Absent ⇒ the lens
   *  costs exactly nothing. */
  readonly lens?: (event: LensEvent) => void
}

type LensEvent =
  /** The partition, whole, at a basis. First one at t0, then one per epoch. */
  | { kind: 'partition'; at: number; epoch: number; posture: Posture
    ; clusters: ReadonlyArray<ClusterView>; changes: ReadonlyArray<ClusterEvent>
    ; cause: PinEvent | 'decision-start' | 'posture-flip' }
  /** A cluster's retained top-k, when it changed. */
  | { kind: 'movesets'; at: number; clusterId: ClusterId
    ; rows: ReadonlyArray<MovesetRecord>; complementKey: string }
  /** A staged write. The EmitRecord verbatim — one object, two consumers. */
  | { kind: 'emission'; at: number; record: EmitRecord }
  /** An operator action that reached bot state, stamped at ARRIVAL. */
  | { kind: 'operator'; at: number; arrivedAt: number; event: PinEvent
    ; epoch: number; latencyMs: number; slicesBefore: number }
  /** A posture flip — it changes which channel adjudicates, so the operator
   *  must be able to see it. Replaces KernelReport.postureFlips. */
  | { kind: 'posture'; at: number; from: Posture; to: Posture; channel: 'lo' | 'est' }
  /** A conditional ranking, first paint and each refinement. */
  | { kind: 'conditional'; at: number; ranking: ConditionalRanking }
  /** A refusal. Today these are only counters on the report; a refused write
   *  is a thing that HAPPENED at a TIME and the timeline should say so. */
  | { kind: 'refusal'; at: number; refusal: EmitRefusal; planKey: string }
```

**`at` is the kernel's own clock, measured from this decision's `t0`** — the same
origin `EmitRecord.elapsedMs` uses (`kernel.ts:1887`: *"so a journal and the
report summary are one timeline and a fake-clock test is exact"*). Every frame
on one scale, and under `--nodes` that scale is work, which is what makes §5
exact.

**`arrivedAt` on an operator frame is the `PendingEvent.at` stamp**, not the
dequeue reading. This is V4 R2 extended from the conformance sample to the
timeline: the operator's timeline must show when they acted, not when the loop
noticed.

The emission order within one epoch change is fixed and must be:
`operator` → `partition` → `emission` (the conformance re-stage) → `movesets`.
A UI that folds them in order is never in a state where a moveset names a cluster
that does not exist yet.

---

## 5. Replay parity

> *"A moment in replay should allow the same information as a live moment,
> identical display logic, different data sources."*

### 5.1 The law that makes it true

> **One reducer, two sources.** The live surface is a fold over `LensEvent`s as
> they arrive. The replay surface is the *same* fold over a stored array,
> stopped at a chosen `at`. There is no replay-specific state and no
> replay-specific shape.

Which is achievable only if every frame is (i) totally ordered by `at`, (ii)
self-contained enough that a fold from `t0` to `at` reconstructs the moment, and
(iii) never a *delta against something the consumer had to have seen*. Hence
`partition` carries the whole partition and `movesets` carries the whole
reservoir, not a diff. Diffs are `changes: ClusterEvent[]` *alongside* the whole,
for animation, and a consumer that ignores them still lands in the right state.

### 5.2 Store, or re-run?

**What re-running bit-exactly requires:**

| input | have it? |
|---|---|
| the board state the substrate was built from | yes — the runner settles turns and the archive keeps the canonical board |
| `asTeam`, criterion profile | yes — `BoundEvaluator.evaluationIdentity` is a *structural* hash of the whole profile, *"every field, including one this file has never heard of"* |
| `SearchTuning` (incl. `seed`), `KernelOptions` | must be stamped; they are not today |
| `deadlineMs` **in the clock's unit**, and the clock mode | `KernelInput.now` is injectable; under `--nodes` `now()` is a pure function of execution |
| `initialStepCostMs` carried from the previous turn | **must be stamped** — it sets slice length, which sets the emission sequence |
| every `PinEvent` with its **arrival stamp** and the **slice index it drained at** | the stamp exists in `PendingEvent`; the slice index does not and must be added |
| the modelled/held set and `assumptions` | yes — already on the telemetry row |

**Storage cost.** Frames per decision: journal (emits × ~150 B), one `partition`
per epoch (~26 units × ~40 B), `movesets` per changed cluster per emission
(k=5 × ~200 B ≈ 1 KB), plus operator/posture/refusal lines. Call it **20–40 KB
per team decision**, ~1 MB per 30-turn game per seat, compressible ~5:1 because
successive `movesets` frames repeat most of their content.

**Recompute cost.** One decision (~150 ms wall, or 550 work units) per replayed
moment, plus the whole table above pinned forever as a compatibility surface.

### 5.3 Recommendation: **store the frames; make re-run the audit**

Three reasons, in order of force.

1. **Bit-exact re-run is only achievable under the node clock, and production
   does not run it.** Under a wall clock the slice count for identical work
   varied 18 → 92 across two seeds at the same 150 ms (`local-game.ts`,
   `DEFAULT_NODE_BUDGET` derivation). So a production replay that re-ran would
   produce a *different* decision and show the operator something that never
   happened. That is the disease this whole program has a rule against — *"a
   value and the premise it was computed under travel separately"* — arriving as
   a feature.
2. **The archive predates the build.** A stored frame is the only source that
   exists for a decision nobody will ever re-run, and "identical display logic"
   has to hold for those too or the replay surface has two modes.
3. **Re-run parity is a property to test, not a strategy to serve.** The time
   lens already specifies the instrument: *"every decision run twice from the
   ledger, byte-compared"* (`time-SYNTHESIS.md` §3, increment 1).

So the data lens stores frames, and the kernel lens owns a CI gate that proves
the frames are what the kernel would produce.

### 5.4 The gate

Two property tests, both under `src/tests/local-game.ts --nodes`:

**G1 — frame reproducibility.** Run a fixture game; serialise every `LensEvent`;
re-run the same seed and budget; serialise again; byte-compare. Any divergence is
either an undeclared clock read or a frame built from mutable state the fold
does not own.

**G2 — prefix determinism over frames.** A `2b`-work run's frame sequence
**extends** the `b`-work run's, byte for byte, up to the prefix. This is the time
lens's own increment-2 gate (*"a 2b-quanta run's emission sequence extends the b
run's byte-for-byte"*) lifted from emissions to frames, and it is what proves the
lens surface is anytime in the same sense the search is. It is also the test that
gates **[CHANGE 1]**: a `better()` refactor that reordered anything would break
G2 immediately and loudly.

Note the honest limit: G2 holds for the *committed* context. Speculative slices
are scheduled by `run.slices % speculativePeriod`, so a longer run visits a
different set of speculative contexts — correctly. `conditional` frames are
therefore excluded from G2's prefix claim and covered by G1 only.

---

## 6. What is thrown away

Radical ruthlessness, as instructed. Each row names what dies and why nothing
needs it.

### 6.1 In `telemetry.ts` — the per-unit row

| deleted | why |
|---|---|
| `TelemetryEvaluation.numStates` | **always `0`** (`telemetry.ts:547`). A field inherited from the voronoi engine's shape (`src/logic/voronoi-strategy.ts:214`), carried into the lobster row so a legacy renderer would not break. It has never carried a number. |
| `TelemetryEvaluation.score` + `scoreChannel` as the primary column | a scalar whose meaning requires consulting a *second field* is a value travelling without its premise. `bounds: Bound` is already on the row and says everything the pair says, correctly. Keep `bounds`; delete the scalar. |
| `TelemetryBreakdown.weights`, `.weighted`, and the `[feature: string]: unknown` index signature | **three encodings of numbers already present** in `features[]` as `{key, value, weight, contribution}`. The index signature is why the shape survived — it makes the row untypable, so nothing could ever prove the duplication. |
| `TelemetryDecision.contrast` (chosen vs runner-up over per-unit counterfactuals) | it asks a question the clustered bot does not answer: *which of this unit's moves won*, when the unit's move was never chosen alone. Replaced by §2.4's set-valued reduction, which is the honest form of the same question at the granularity the search actually works in. |
| `moveEvaluations` **as the row's spine** | the per-unit candidate table survives as the **leaf** of the drill-down — it is what a selected moveset's selected unit shows — but it stops being the shape of the row. The spine becomes cluster → movesets → per-unit deltas. |

### 6.2 In `KernelReport` — fields with no consumer

Counted across `src/` excluding tests:

| field | non-test consumers | disposition |
|---|---|---|
| `postureFlips` | **0** | becomes a `posture` `LensEvent`. A flip changes which channel adjudicates; that is a timeline fact, not a summary statistic. |
| `meanSliceCostMs` | **0** | the frames carry `at` and `cursor`; a mean over a decision is derivable and nobody derived it. Delete. |
| `probes` | **0** outside the kernel | an anti-latch instrument. Keep as a counter, drop from the report's public shape; the gate it guards is tested directly. |
| `basisHistory` | **0** | a log wearing an array's clothes. Every snapshot is already a moment on the timeline; emit `posture` / epoch frames and delete the array. |
| `conformance` | **0** | ditto — `ConformanceSample` is exactly the `operator` frame's payload (`latencyMs`, `slicesBefore`, `resumedFromCache`). Fold it in and delete. |
| `levers`, `leverOrderBinding` | 1 (telemetry copies the boolean) | see 6.3. |

### 6.3 The lever surface has no producer

`makeSearchCore` returns `{ improve, conform, drainRefusals, release }` — **no
`refinementView`, no `refine`**. So `asRefiner(input.search)` yields `null`,
`run.refiner` is null, `run.lastView` is **always null**, and therefore in
production:

- `KernelReport.levers` is always `[]`;
- `leverOrderBinding` is always `false`;
- `EmitRecord.horizon` is always `1` (`kernel.ts` `absorb`: `run.lastView?.horizon ?? 1`);
- `EmitRecord.slack` degrades to `max(0, hi − lo)` — the incumbent's own bound
  gap, *not* the root slack `max_R(R.hi − L.lo)` the field is documented as
  carrying;
- `rows()` never takes the `CandidateView` path, so `CandidateView.plan`,
  `loCite`, `hiCite` and `refuted` are dead;
- `voc.ts` already says so out loud: *"on this build the horizon is always 1 …
  and the production search core is not a `Refiner`, so the view is never
  built."*

**Do not ship a lens that renders a field which is structurally always the same
value.** The disposition:

- **delete** `levers` and `leverOrderBinding` from `KernelReport` and from
  `TelemetryKernel`;
- **keep** the `Lever` / `LeverView` / `Refiner` types (a depth rung is a real
  plan, and `refine` is its seam) but let the lens ignore them until a producer
  exists;
- **compute root slack from the cluster's own retained top-k.** `rootSlack(rows,
  leaderIdx)` (`voc.ts:232`) wants a genuine rival set and has never had one; the
  reservoir *is* one. `slack` becomes `max over retained rivals of (rᵢ.hi −
  leader.lo)` — the quantity the field was always documented as carrying, finally
  computable, and the recognizable-quality axis `07-ANYTIME-STRUCTURE.md`
  Finding A-2 asks to be plotted;
- **keep** `EmitRecord.horizon` as a field and render nothing from it until
  depth lands.

### 6.4 Not thrown away, and worth saying

`KernelReport.contexts`, `.speculative`, `.activeContextKey` **stay**: they are
`pins.adviseFromReport`'s only inputs and they carry the `boundsBasis` that makes
a pin price legal (V4 B7). They are also, after **[CHANGE 2]**, the surface the
conditional ranking reads out of. `KernelReport.crossfade`, `refusals`,
`committedUnits` stay — the first two are the only account of writes that did not
happen, and the third is half of the humans-always-win pair.

---

## 7. Open questions for synthesis

1. **Whose complement?** (§2.3) A moveset's number is the whole-board bracket
   with the complement fixed. When another cluster improves, every retained row's
   *question* changes while its *soundness* does not. I recommend stale-marking
   plus a bounded top-3 re-price at the barrier. The UI lens owns whether an
   operator may read a stale row at all, and the data lens owns whether stale
   rows are stored. If either says no, the barrier re-price stops being optional
   and the cost table in §2.5 changes.

2. **Does locking a unit narrow its cluster, in the operator's vocabulary?**
   The kernel says yes (T1: a lock is a pin is a cutset, and it can split). The
   brief says *"the cluster's best movesets conditional on that move"*, which
   reads as the same cluster with one unit fixed. These are the same rows; they
   differ only in what the header claims the cluster IS. Synthesis must pick one
   word and use it everywhere, because the two readings disagree about whether
   the row count can drop to one.

3. **`k = 5`, and 24 rows per decision, are guesses.** They are calibrated
   against telemetry's existing count discipline, not against a measurement. The
   measurement that would settle them is Finding D-1's coverage curve
   (`02-DECOMPOSITION.md` §2a): report `planDistance(staged, nearest retained
   row)` per decision. A staged plan at Hamming distance 4 from every retained
   row means the reservoir contributed nothing; a distribution of those distances
   is the curve, and it costs one loop over ≤ 24 rows.

4. **Does [CHANGE 1] change a decision?** It must not — the reason is derived
   from comparisons `better()` already performs in the order it already performs
   them. But it is a refactor of the hottest function in the search, and G2
   (§5.4) is the only instrument that would catch a reordering. Sequence the
   change *after* the gate exists, never alongside it.

5. **Who pays for a live inspection?** A `rankConditional` mid-decision spends
   the same process the decision is spending. The time lens's position is *"two
   currencies — compute quanta and operator attention — with no exchange rate,
   because a rate would let the scheduler spend the human"* — which forbids the
   trade but does not name the payer. Three candidate answers: charge the
   decision (inspection steals from the search the operator is inspecting);
   charge `reserveMs` (inspection eats the final flush); or charge a dedicated
   reserve carved before `searchDeadline` (inspection is unconditionally
   affordable and the search is unconditionally shorter). I lean to the third
   because it is the only one whose cost is visible before the turn starts, but
   this is an ECONOMY question and not mine.

6. **How often is a committed pin already in the speculative namespace?**
   **[CHANGE 2]**'s value is exactly the frequency with which an operator commits
   a pin they hovered first. If operators mostly commit without hovering, the
   promotion buys latency on a path nobody walks, and the honest surface is (a)
   plus a candid "searching" state. This is a one-counter measurement
   (`promote` hits vs epoch changes) and it should be taken before the change is
   defended.

7. **Fog will make the partition silently wrong.** Law D2′ says occupancy is the
   *cloud* when a position is uncertain; `influenceOf` computes reach from the
   **last-seen point**, and *"point-reach under-approximates, which misses pair
   terms"* — the unsound direction. At ply 1 with `staleness = 0` the two
   coincide exactly, which is why nothing is wrong today. The lens must therefore
   (i) never cache a partition across a determination, and (ii) inherit the
   law-suite case Finding D-5′ specifies — a subject whose cloud spans two
   components while its last-seen cell does not, asserting the partition merges
   them, with the falsifier built in (the case must FAIL against today's
   point-based `influenceOf`).

8. **`explainPlan` is optional on `Evaluator`.** A stub, a memo wrapper or a
   test double has no honest answer and telemetry already degrades to
   `unexplained: true` rather than fabricating weights. The moveset table must
   degrade the same way — rows with bounds and dominance conditions but no
   feature breakdown. Synthesis should confirm the UI has a state for that, since
   it is the state every non-production evaluator produces.

---

## 8. Summary: the three decisions the other lenses must react to

1. **A cluster is a connected component of the occupancy-reach graph over the
   units the bot may still move, with pinned/committed/reference-fixed units
   deleted as vertices — so a lock can only narrow or split a cluster, never
   widen it, and an unlock can only widen or merge.** Identity is
   `ClusterId` (the anchor unit, a *name*) plus `key` (members + basis, a
   *hash*), with `lineage` across merges and splits.

2. **Movesets are retained, not recomputed: a `k = 5` reservoir per
   `(cluster, complement)`, written where `better()` already compares, at zero
   evaluations — and each row carries the branch of `better()` that refused it as
   its dominance condition.** The aggregate score is a whole-board bracket with
   the complement fixed, and `complementKey` travels with it.

3. **A conditional ranking is the speculative pin context, promoted into the
   committed namespace on commit — so the rows an operator inspects are the same
   cache entry the lock stages.** First paint from the retained filter (0 ms,
   marked provisional); exact rows within one slice; option (c), precomputing per
   candidate, is refused on arithmetic (6.4× a whole decision for one queen).

And one law for the surface: **one reducer, two sources.** The live view is a
fold over `LensEvent`s arriving on a second sink; the replay view is the same
fold over a stored array stopped at an `at`. Frames are stored; the node-clock
re-run is the audit that proves the frames are what the kernel would produce.
