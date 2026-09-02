# SYNTHESIS — the search factorization

Final document of the SEARCH-THEORY lens: what the bot's brain is in the
literature's terms, the four joints it factors into, what today's code is as a
member of each, where it contradicts the other lenses, and what to build in what
order. Standalone; documents 00–04 hold the derivations.

---

## 1. The argument, whole

**What we are.** Pure-strategy maximin over a factored row space, computed as
better-response dynamics on a sound floor, with the column-generation half of a
double oracle and no mixed solve. Every phrase in that sentence is a joint with
members, and the code is at a *named member* of each — three of them defensible,
one vacuous, and two containing undeclared choices that turn out to be defects.

**The disease.** The other lenses found one shape each: a value travelling
without its premise (composition), nine projections of one epistemic object built
as nine idioms (belief), three flows built as twelve slots (value), three things
fused in one loop (time). This lens's shape is:

> **The search reduces a function to a scalar in six places, decomposes the board
> in one, proposes trials in eight, and backs up depth in four — and not one of
> those thirty-one sites declares which member it is at, so no two of them can be
> shown to agree and none of them can be varied.**

The concrete cost of that is not abstract. It is: a comparator that admits
3-cycles (§2.1, demonstrated); a deep `max` that scans one coordinate on exactly
the boards we lose on (§2.2, derivable); an opponent-model socket that cannot be
validated because the reduction discards it (§2.3); a decision criterion under
which *every quantum of compute the economy buys is invisible in the output*
(§2.4, the strongest architectural argument for the Centaur direction found
anywhere in this program).

**The factorization.** Four joints, in dependency order. Each has a typed
contract, one law, a member list with today's member marked, and at least one
falsifier that changes no behaviour.

| joint | question it answers | law | today |
|---|---|---|---|
| **REDUCTION** | a plan's value is a function over enemy actions — what scalar (or set) stands for it? | **R1** every member is a lower prevision `inf_{P∈𝒫} E_P[v]`; members differ only in the shape and size of `𝒫` | vacuous `𝒫` (pure maximin), point-valued, with three undeclared non-vacuous suppliers leaking in at three layers |
| **DECOMPOSITION** | which units get solved jointly, and who decides? | **D1** a decomposition may GENERATE proposals and may never compute, bound, order or compare a value | coordination graph + slider cutset, computed once per decision, four sub-joints of which three are at their null member |
| **PROPOSAL** | where does a trial come from? | **P1** every option-set restriction is adaptive on value OR carries a bound on what it removed. **P2** proposals are proposals | eight operators, nine constants, no socket, no record of which one won |
| **BACKUP** | what is a deep line worth and how does it come home? | **B1** one reduction at every ply. **B2** a bound may not be consumed as a mean without a declared conversion | a floor folded into a mean slot, over an odometer prefix, with an excellent combiner |

**Why this is a carving and not a taxonomy.** The four are one-to-one with the
four irreducible facts about *searching* this game, and they are exactly the four
the composition lens's ACTION and REDUCTION kinds gesture at without opening:
moves are simultaneous, so a value is a function that must be reduced (REDUCTION);
our move is a product space with contested-cell structure, so it must be factored
to be searched (DECOMPOSITION); the factored space is still too big to enumerate,
so trials must be proposed (PROPOSAL); and the one-turn frame is not the game, so
something must come back from deeper (BACKUP). Nothing else in a search is a
choice; everything else is bookkeeping.

---

## 2. The five findings that matter most

### 2.1 The acceptance relation admits a 3-cycle, and here it is

Once `s.deep.size > 0` — every decision the scout reaches — `accept()` uses
**two different comparators depending on the pair**: `µ` when either side carries
a deep observation and neither soundly dominates, the lexicographic floor ladder
otherwise. That is not the strict part of any single preorder.

`probes/accept-cycle.probe.ts` replicates `accept()`'s control flow exactly while
importing the **real** `posteriorOfBranch`, `foldObservation`, `precisionOfSigma`
and `refutedAt`. Under the repo's own jest on `claude/cluster-lookahead`:

```
A = { lo: 0, hi: 12, est: 6, deep: { value: 9, sigma: 0.5 } }
B = { lo: 5, hi: 5.2, est: 5.1 }
C = { lo: 4, hi: 20,  est: 19 }

mu: { A: 8.958904109589042, B: 5.1, C: 15.5 }
A>B true   B>C true   C>A true
```

Three ordinary plans — a narrow high-floor one, a wide speculative one, one depth
likes. And the split is systematic: deep notes exist only for the enumeration's
own proposals, so `µ` decides whenever a proposal meets anything and the floor
decides whenever two sweep neighbours meet.

Consequences: `if (best === before) break` uses object identity, so under a
realised cycle the polish and restart escapes are never reached and the slice
rotates three plans to the deadline; and the word "converged unit-wise" in that
comment is unproved.

**The repair is the deletion of one line**, and *two independent arguments
converge on the same line.* `depthRung`'s

```ts
if (refutedAt(incumbent.bounds.best, trial.bounds.worst)) return null;
```

is (i) the intransitivity source, and (ii) — per the prior-art lens's C12 —
an application of **interval dominance** to gate a *dynamic, multi-ply*
comparison, which Troffaes (2007) shows dominance criteria of this kind cannot
validly propagate once dynamics enter. One line, two literatures, same verdict.

> **Law A1 (single-key acceptance).** The acceptance relation must be the strict
> part of a total preorder on one declared key, computed for every trial by the
> same rule. Sound dominance may VETO an accept; it may never SELECT a different
> comparator.

### 2.2 The deep `max` scans one coordinate, on exactly the boards we lose

`enumerateJoints(domains, cap)` is an odometer with the **last** domain varying
fastest, truncated at `cap`. Called as `enumerateJoints(ours, 6)` over units
whose options are `slice(0, 3)`.

The scope needs no measurement: the scout's cluster is
`new Set(cluster.variables)` and `variables` is `members ∪ every live slider we
command, by fiat, in every cluster`. So one commanded slider gives `|ours| ≥ 2`
and pins a coordinate. At the measured slider-board median of **3 sliders**, a
typical cluster carries four of our variables and the six joints the `max` ranges
over are `(0,0,0,0) … (0,0,1,2)` — **three of four coordinates constant at the
generator's first heuristic option.**

Conversely on trail-unit boards (88.7% singleton components, no sliders)
`|ours| = 1` and every option is enumerated. So:

> The depth layer's exploration degenerates **exactly on slider boards** and is
> **exactly inert on trail-unit boards** — and slider boards are the class every
> other lens has independently located the problem on.

Two aggravations: `ourCoverage = 6/27 ≈ 0.22` is consumed by `sigmaOfPly` as if
it were a 22% sample when it is a contiguous axis-aligned slice; and
`expandCluster` moves one more coordinate into the pinned prefix on every
admitted expansion, so it worsens with depth. The codebase already fixed this
identical bug one function away (`deepPlan`'s CL6a repair, whose comment reads
*"a value of the wrong line is not a cheaper value; it is a different question's
answer"*).

Fix: **round-robin single-unit** — the proved line plus each member's
alternatives one at a time — which costs `1 + Σᵢ(|Oᵢ|−1)`, *cheaper* than the
odometer for ≤3 members, and reaches every option.

### 2.3 The opponent-model socket cannot be validated while the reduction is vacuous

`inf_{P∈Δ(B)} E_P[v]` ignores `P`. So any experiment that varies the enemy model
at `ε = 1` is measuring nothing, and the program's four improvised
enemy-treatments (dodge cover-counting, potion exposure, thread replies,
`sigmaOfPly.theirMiss`) are individually unfalsifiable by construction. Turn the
ambiguity down from vacuous and the supplier becomes measurable for the first
time.

And the reduction's vacuity has a second, mechanical cost that is independent of
the game theory: **a saturated pure-maximin floor carries no ordering information
on contested cells.** `min_b v_a(b)` on a contested cell is attained by the reply
that kills the contesting unit; `DEAD` is `−∞`; so every option that enters a
contest has the same floor, `cmp.order` never fires, and adjudication falls
through to `est`, the declared O-P1 ceiling hole, and the salted tie key —
precisely where the decision is hardest. That is a **fourth path to the
inert-weight taxonomy's cause (b)**, upstream of the evaluator, so no evaluator
improvement can restore the gradient. Any non-vacuous reduction un-saturates it,
because a mixture over replies is finite where a min is `−∞`.

### 2.4 Our decision criterion makes compute invisible — and it is the one the Centaur case cannot be built on

This is the prior-art lens's C12 and it is, I think, the single most consequential
architectural argument this whole design push has produced. It belongs in this
lens because it is a property of the REDUCTION joint.

Troffaes (2007) classifies decision criteria under imprecise probability:

| criterion | output | does the optimal set shrink as beliefs sharpen? |
|---|---|---|
| **Γ-maximin** (ours, `ε = 1`) | a **single** decision | **no** — it "usually only selects a single decision, even in case of complete ignorance" |
| **E-admissibility** | the set optimal for *some* `P ∈ 𝒫` | yes |
| **maximality** | the set not strictly dominated under *every* `P ∈ 𝒫` | yes |
| **interval dominance** | the set whose intervals overlap the best | yes (weakest) |

Two consequences, and they are both about things this program is actively
building:

**(a) Every quantum the economy buys is invisible in the output.** The time
lens's entire design is an economy for spending compute to sharpen beliefs, with
`allowance grants` as its atom. Under Γ-maximin the *output* is one plan whether
the belief is razor-sharp or vacuous. The bot cannot show its work because the
criterion throws the work away. The kernel's `maxGap` ratchet is a scalar proxy
for the thing that *should* be shrinking — an option set — and the reason it had
to be invented as a separate mechanism is that the criterion does not produce one.

**(b) The Centaur case is being built on the one criterion that discards the
option set.** Surfacing live options to a human co-player *is* set-valued output.
Under maximality, the option set is the reduction's **native** output and its
shrinkage is a legible, monotone progress indicator: "here are the four moves
still worth considering; ninety milliseconds later, here are two". Under
Γ-maximin it has to be reconstructed by machinery that does not exist.

So the REDUCTION joint has a **third axis** that neither my first pass nor the
composition lens's carve had:

```
ambiguity  (shape × size of 𝒫)      -- calibration
reading    (sound | advised | equilibrium)  -- correctness
arity      (point | SET)             -- what the consumer gets
```

and the ADVICE kind — the Centaur surface — consumes the set-valued member.

### 2.4½ The restricted matrix is not merely derivable — it is computed and thrown away

Sharper than doc 00's first statement, and it changes S0 from "cheap" to "free".

`bank.ts`'s B2 rung resolves **every priced plan against every banked witness**
and computes a full `ScoreBounds` for each pair, then keeps `bounds.best`, mins
it, and discards the rest. That is one complete row of the restricted payoff
matrix, computed in full and reduced to its row-minimum on the spot. Retaining
it costs one number per cell — on the measured 23×23 three-team board, 152
distinct plans by however many witnesses accumulated, i.e. tens of kilobytes —
and **zero additional resolutions**. The standard objection to solving a matrix
game (it costs simulations we cannot afford) does not apply: they are already
spent.

Two findings come out of looking at the column set properly (doc 06):

> **W-1.** `WitnessSet` has no capacity and no eviction policy, and B2 is
> `O(|witnesses|)` resolutions **per priced plan**. So `price()` gets
> monotonically more expensive through a decision, unboundedly and unmeasured.
> The kernel sizes its slices from that *measured* cost, so slices lengthen late
> in a turn for a reason that has nothing to do with the board — and events are
> drained between slices, never inside one. That is an operator-latency drift
> with a compute cause, against a cap the time lens states in milliseconds.
> A real double oracle prunes columns outside the equilibrium support; we never
> do; **and solving the matrix produces that support as a by-product.** The
> diagnostic pays for itself in the same LP.

> **W-2.** `speculate` ships the witness set **down** with every parcel and
> nothing comes back. Workers price rows the coordinator has not reached, their
> banks discover real minimisers, and those columns die with the parcel. In a
> double oracle the column is the artifact that *transfers* — it is an
> upper-bound certificate against every plan, by the witness law's own argument
> — so we parallelise the row side and discard the plan-independent side. The
> one-way rule is a **determinism** decision, not a value one (a witness
> arriving on worker time would make the decision depend on worker timing), and
> the determinism cost is avoidable by the canonical-order, slice-boundary fold
> the evaluation channel already uses.

### 2.5 The layer that decides what the bot plays has no socket and no record

Eight proposal operators (rung-0 conform, multi-start stages 0 and 1, cluster
enumeration, sweep, pair repair, joint polish, perturb restart), nine budget
constants, hard-coded as a control-flow sequence inside `improve()`, two of them
dark by default — and **nothing records which operator proposed the trial that
was accepted.** `adjudication` counts which *rung* decided; nothing counts which
*operator* won. By the composition lens's own standard this is worse than a
one-member joint: an eight-member joint with no socket at all.

---

## 3. The four joints, specified

### 3.1 REDUCTION

```ts
interface Reduction {
  /** WHICH replies are in play. The bank's B0/B1/B2/B3 are members. */
  readonly support: SupportRestriction
  /** The ambiguity set over Δ(support). Two sub-axes:
   *   SHAPE — who may coordinate, whose payoff (paranoid | MaxN |
   *           share-weighted asymmetric fold)
   *   SIZE  — how much mass may deviate (vacuous | CVaR_τ | Huber_ε | singleton) */
  readonly ambiguity: AmbiguitySet
  /** Point or set. Set-valued members: E-admissibility, maximality,
   *  interval dominance. */
  readonly arity: 'point' | 'set'
  /** Which reading the number claims: sound | advised | equilibrium. */
  readonly reading: Reading
  // reduce is FIXED BY LAW R1: inf_{P ∈ ambiguity} E_P[v]  (point)
  //                            {a : ¬∃a' ∀P E_P[v_{a'}] > E_P[v_a]}  (set)
}
```

**Law R1** buys, for free and for every member: monotonicity in `v`,
translation-equivariance and positive homogeneity (so weight units stay weight
units — the value lens's common-currency law survives the reduction),
superadditivity (so a decomposed evaluator's per-term reductions are a sound
floor on the reduction of the sum — which is exactly what the bank's B1
additivity argument needs and currently argues by hand per rung), and an ordering
of members by pessimism (so "less paranoid" is a well-defined direction and the
sound floor is the maximal element of the same family, not a separate mechanism).

**The SHAPE sub-axis finally satisfies the composition lens's no-single-member
refusal**, and it does so by turning a known bug into a member selection. The
value lens's M1 finding — *"symmetric balance form definitionally wrong on
3-team boards (exactly 2.00 all cells)"* — is the paranoid member being applied
where MaxN or a share-weighted asymmetric fold belongs. Three members, one law,
one of them ours.

**Members, and what today is.** Today: `support` = the rung ladder resolved per
plan (so plans are compared across *different* supports — sound, but a weaker
statement than the comparator's structure implies); `ambiguity` = paranoid shape,
vacuous size; `arity` = point; `reading` = sound. Plus three undeclared
non-vacuous suppliers leaking in at three layers (the scout's ≤4 enemy joints,
`dodge-discount`'s cover-counting, `posteriorOfBranch`'s interval fold), each
paid for differently.

### 3.2 DECOMPOSITION

```ts
interface Decomposition {
  readonly graph: (board, roster) => Partition   // interaction+slider (today) | conflict | radius | SINGLETON
  readonly schedule: RecomputeSchedule           // once-per-decision (today) | per-slice | on-refusal | on-observation
  readonly focus: (state) => ClusterId           // fixed-order (today) | most-deficit | most-refused | bandit
  readonly size: SizePolicy                      // exact-ration (today, inert) | fixed-k | bandit
}
```

**Law D1**: generate only, never value. This is the thing the architecture gets
right and does not state, and the enforcement pattern already exists (the scout's
import-law structural test).

Three of four sub-joints are at their null member. The `graph` member is
well-chosen and measured (the `n=6-with-slider` stratum rescued 16.1% → 96.5%).
The four are genuinely four, not one: BALANCE's result is precisely that adapting
the heuristic alone leaves the size bottleneck untouched and vice versa.

**Two endorsements on the record.** (1) Our order-2 Möbius surrogate solved by
*exact* enumeration is strictly stronger than the CMAB / NaiveMCTS family, which
samples under the naive additive (order-1) assumption: our error is
third-order-and-above, theirs is second-order-and-above plus sampling noise.
(2) The slider fiat is cutset conditioning on a star hub, which is the textbook
operation for the measured graph shape.

**One warning.** Our above-budget fallback rungs (threshold-split, ICM) are
Portfolio Greedy Search — the RTS baseline the subsequent literature exists to
beat. So the ration deciding which rung fires matters more than it looks, and
`ClusterStats.{rungThreshold, rungIcm}` is the right thing to watch.

### 3.3 PROPOSAL

```ts
interface ProposalOperator {
  readonly id: OperatorId
  readonly retention: 'none' | 'all-but-k' | 'all-but-subset' | 'trajectory'
  cost(state): Quanta
  propose(state, budget): Iterable<JointPlan>
}
interface ProposalPolicy {
  readonly operators: ReadonlyArray<ProposalOperator>
  readonly schedule: (state) => OperatorId   // fixed sequence (today) | round-robin | bandit
}
```

**Law P1** (adaptive-or-bounded restriction) is where three literatures converge
— double oracle restricts by best response *with a value-gap certificate*, CMAB
restricts by per-variable bandits on *realised reward*, Prismata's shipped HPS
restricts to a *portfolio of named scripts* so the removed set is a stated claim.
`candidateCap: 8` and `sliderCandidateCap: 4` are a value-blind rank prefix and
pass neither clause.

The important observation is that **the passing pattern already exists twice in
our own code**: B1 refuses to move a floor on a truncated sweep, and the scout
charges `ourMiss`/`theirMiss` to precision. The candidate layer is the one place
a truncation is taken and nothing is charged. The cheapest passing member is
therefore not a new algorithm — it is *charge the cap*.

**The missing operator is an ejection chain.** Our three multi-unit escapes are
bounded-size *blocks* whose cost is exponential in the coordination they express
(2, ≤3×2, 1). The corridor lock-in hypothesis needs "two or three units to swap
intentions in the same turn". A chain is *linear* in coordination size: depth-5
chain = 1 price; 5-unit polish block = 32. `ConflictIndex` and `subStepsFor`
already exist and the multi-start's separation regression test generalises
directly into the falsifier.

**And the largest capability-per-millisecond item found:
cluster-conditioned re-enumeration.** `clusterOf` is memoised once per session,
so every proposal a decision ever sees is conditioned on the board as it was at
the first refinement slice; the ascent then moves the incumbent and nothing
re-derives the exact solve around where it ended up. `enumerateExact` already
takes `conditioned` domains precisely so one cluster can be solved given the
rest of the plan. Pick a cluster (seeded from the resolution's own casualties,
per ADDRESS), fix everything outside it, enumerate exactly (≤512 leaves), offer
the k best through the existing path. That is ruin-and-recreate against a
whole-board pass measured at 311–343 ms. `pairRepair` and `jointPolish` are
revealed as the size-2 and size-3 members of that family, hand-written, while
the general exact solver sits idle after slice one.

### 3.4 BACKUP

```ts
interface Backup {
  readonly leafReading: LeafReading    // proved floor (today) | interval midpoint | ceiling | interval
  readonly ourOperator: Operator       // max over odometer prefix (today) | round-robin | sample | exact
  readonly theirReduction: Reduction   // MUST equal the ply-1 reduction — Law B1
  readonly fold: Fold                  // precision fold (today) | linear α-mix | replacement | silence
}
```

One slot is excellent, one is right-in-principle over the wrong set, and two
contain undeclared choices, one of which is the defect in §2.2.

**The excellent one deserves defending in any prior-art comparison.** We are
implicit-minimax-backups shaped (Lanctot, Winands, Pepels & Sturtevant 2014 — two
channels kept separate, combined at selection) with a strictly better combiner:
they mix by a tuned constant `α`, we fold at a precision *derived* from the
line's own discrimination state with nothing clamped in either direction. The
file's own argument for deleting `clampToLat` — *"both were proxies for one real
worry and both expressed it as a constant, which caps exactly the discoveries
depth exists to make"* — is the argument against their `α`, arrived at
independently.

**Law B2 catches a type error that mirrors the epistemics lens's own.**
`deepen` publishes `scored.best.lo` — a proved floor — into belief's Gaussian
*mean* slot, while `est = (lo+hi)/2` is computed in the same expression and
unused. Two biases compose: a floor understates (and `sigmaOfPly` *measures* that
width as its `world` term, charging it to precision while ignoring it when
placing the centre), and a max over six rows overstates (optimizer's curse). The
epistemics lens found **precision laundering** — an advisory opinion inheriting
proof-grade precision by riding the `est` scalar. This is the same type error in
the opposite direction: proof-grade content riding the advisory slot.

**And there is free depth available.** `scoreOptions` holds a sound per-row
ceiling (`worstHi`) and never cuts on it. `if (worstHi <= bestLo) break` is sound
alpha-beta pruning at a simultaneous-move node — which is the whole of Bosanský
et al.'s exact-algorithm contribution, available to us because we have two-sided
sound bounds. It cannot change a published value and strictly reduces `cost`,
which is the scout purse's own currency: **more plies at the same tithe.**

---

## 4. The contradiction table

Every entry is a place where this lens and another lens's synthesis cannot both
be built as written. Each carries a proposed resolution; none of them is mine to
decide alone.

| id | with | the contradiction | proposed resolution |
|---|---|---|---|
| **C-T1** | TIME | `stageAndGate` gate 1 makes the wire monotone in the *realised* proved floor (`ratchet-floor`, `switch-floor`). A mixed or set-valued reduction draws a row below the maximin row's floor **by construction**, so every draw is refused. The equilibrium reading is unreachable through today's wire discipline — not by decision, but because the invariant was written over the realised row | restate the ratchet over the decision's **declared reduced value**. `V_mixed` of the restricted matrix *is* monotone as rows are added within a basis; columns arriving is what an epoch already is. The realised draw then rides the wire as an instance of a certificate about the mixture |
| **C-T2** | TIME | `enumDeadline` rations the enumeration by a fixed turn fraction, blind to whether the partition it found is trivial — and on 88.7% of boards the enumeration's whole output is filtered by `minHamming` as within one unit of the incumbent | make it a bidder in the hypothesis market whose bid is a function of the partition (`worstClusterCells`). One row in their table. **Ask: does the market admit a bidder whose bid depends on a cheap prefix of its own work?** |
| **C-T3** | TIME | nine operator sub-budgets (`clusterOffersPerRound/PerSlice`, `maxSweeps`, `restarts`, `pairRepairPerUnit`, `polishUnits`, `polishPerUnit`, `stage0Attempts`, `climbSteps`) are constants answering the one question their allowance-split table exists to answer | **Ask: does the allowance table have a row per proposal operator, or only per layer?** If only per layer, the nine constants survive the refactor and the search stays the one place with un-priced sub-budgets |
| **C-T4** | TIME | Finding B-4 reduces the cost of a quantum without changing its product, invalidating quanta-denominated arm comparisons across the change | their own answer exists (*"equal refine-quanta AND equal total-quanta"*); this is a concrete worked case for the measurement-denominator question they are putting to the owner |
| **C-T5** | TIME | **§2.4**: their economy buys sharpened beliefs, and under Γ-maximin the output is one plan regardless of how sharp. The economy's product is invisible in the artifact it pays for | the set-valued arity member. Option-set cardinality becomes the economy's natural progress metric, and `maxGap` is revealed as the scalar proxy that had to be invented because the criterion produced no set |
| **C-T6** | TIME | **W-1**: the witness set only grows, B2 is `O(\|witnesses\|)` per priced plan, so `price()` cost drifts upward through a decision. The kernel sizes slices from that measured cost, so slices lengthen late in a turn and operator-pin latency worsens — against a cap their design states in fixed milliseconds. The slice-sizing comment attributes the cost to roster size, which is constant within a decision; witness count is not | their exchange rate must be a function of a *measured, drifting* step cost, which it already is — but the **latency cap** must be enforced as a hard slice ceiling independent of measured cost, or it is not a cap. Column pruning (doc 06 §3b) removes the drift at source |
| **C-T7** | TIME | **W-2**: the parallel one-way witness rule is a determinism decision. Their design turns wall cuts inside work into counting cuts precisely so worker timing cannot influence the decision sequence | a returned-witness channel folded at a **slice or epoch boundary** in canonical `witnessKey` order preserves that property, using the discipline `foldParallel` already applies to evaluations. **Ask: does the counting-cut redesign make a returned-column channel deterministic by construction?** If so, W-2's fix is nearly free once their work lands |
| **C-B1** | BELIEF | two paranoia dials double-charge one ignorance: `sigmaOfPly.theirMiss` charges un-covered replies as **precision**, an ε-contaminated reduction charges the same ignorance as **value** | Law R1's composition rule: one ambiguity set per decision; composing two restrictions is the **intersection of the sets**, never the sequential application of two reductions. Decide before either lens ships a dial — their B7 falsifier already suspects it |
| **C-B2** | BELIEF | `influenceOf` reads clouds, so the partition is a function of the belief state, but `schedule = once-per-decision` means a mid-decision narrowing cannot reach it. Free today, expensive under the fog programme where C1/C2 evidence arrives during play | add `on-observation` to the `schedule` sub-joint, driven by their reducibility tag |
| **C-B3** | BELIEF | stage 0's *provably-safe* draw domain is a projection of the support `S` that their inventory of nine projections omits | add **the safe action set** as a ninth projection; its degradation ladder (unit-safe → safe joint combos → rules-certain death only when nothing else exists) is already built and correct |
| **C-B4** | BELIEF | their value table (`{envelope, estSound, estAdvised, advisoryPrecision}`) fixes laundering at `BankResult` and leaves it open at `DeepObservation`, which is the harder seam because the number crosses a **horizon** boundary as well as a quantifier one | extend the table's type to observations; Law B2 is the general statement |
| **C-B5** | BELIEF | the **equilibrium** reading is a third `w`-constructor, not a rival stack — their "no second epistemic vocabulary" refusal applies to any other framing | land it inside `(S, w)` as `w = P*`, identity = the restricted matrix's content hash. The `restrictedGap` instrument computes `P*` as a by-product: one LP, two uses |
| **C-V1** | VALUE | `k ≈ 1.2` is fitted on **realised** outcomes, i.e. pre-reduction. Superadditivity (R1) means fold-then-reduce ≠ reduce-then-fold, and the gap is the non-alignment of the per-flow worst cases | the fit-provenance coordinate must include **which side of the reduction it was fitted on**. That coordinate does not exist and Ruling 49 requires it |
| **C-V2** | VALUE | the multi-start softmax temperature `t₀ = 0.25` is in absolute weight units, so it is nearly-argmax where options differ and nearly-uniform where they are near-tied | normalise by the pool's own spread — and **ask whether the folded-weight model predicts pool *spread*, not just plan *level***. If it does, `t₀` becomes derived, exactly as they argue `room: 3` should be |
| **C-V3** | VALUE | the folded-weight coefficient is `(K/W)(1−p)·w_u`, computed live — but a continuation root has different `K/W` and `p`. Carried, it is a premise crossing; re-derived, the deep and near values come from two different functions and `better()` compares them | needs the `frame` coordinate their B1 already flags as mandatory. **Ask: re-derived at a continuation root, or carried?** |
| **C-V4** | VALUE | **§2.3**: a saturated maximin floor is a fourth path to inert-weight cause (b), upstream of the evaluator | their instrument (*spread at `better()`'s comparisons, by unit class*) must also split rows by **which rung decided**, or this cause is invisible in it |
| **C-J1** | COMPOSITION | "REDUCTION: exactly one — composing two is a category error" is correct but under-stated | it is a **theorem** under Law R1 (two composed lower previsions is a lower prevision over a set neither declared), with a well-defined escape hatch — intersection — for exactly the cross-layer case C-B1 |
| **C-J2** | COMPOSITION | their finding 4 lists `search.clusterEnum` as a member needing a player; `cluster-partition.ts` says it is kernel machinery and that the switch silently disabled the depth layer, causing an experiment to race three identical contenders | both are true of different objects. Remedy is **delete the field** and expose the capability as the `graph` sub-joint's `singleton` member — reachable, addressed, measurable |
| **C-J3** | COMPOSITION | their chief refusal is "no joint with one member"; the proposal layer is an **eight**-member joint with no socket, which is strictly worse | it belongs in their joint inventory as an ACTION-kind joint whose members are operators and whose law is P2 |
| **C-J4** | COMPOSITION | their inventory has no entry for the depth layer's node operations, and `leafReading` is a joint hiding inside a field access (`lo` chosen, `est` computed and discarded, in one expression) | four slots, three REDUCTION-kind and one MODEL-kind (`fold` is a lattice join between two channels) |

---

## 5. Build order

Sorted by **information per millisecond**, and the top six change no behaviour at
all. That ordering is deliberate under Ruling 49: every one of them answers a
question about *our* boards from data we already hold, without playing a game
whose population is modest variations of one lineage.

| # | increment | changes behaviour? | what it decides |
|---|---|---|---|
| **S0** | **`restrictedGap`** — retain the cells B2 already computes, partition by basis, solve with RM⁺ (~40 lines, no dependency), emit shape / `vPure` / `vMixed` / gap / row-and-column support / imputed fraction. Full spec in doc 06 §5 | no | **three useful answers from one build.** `rowSupport = 1` on most decisions retires the whole mixed/equilibrium direction on evidence with zero games; a multi-unit gap prices it; and `colSupport ≪ cols` unlocks W-1's column pruning regardless of what the gap says. Also yields `P*` for C-B5 |
| **S1** | **`proposedBy`** on every priced trial; accepted-trial counts by operator | no | which of eight operators does any work. Prerequisite for every adaptive schedule; will probably retire two outright |
| **S2** | **`planDistance(staged, nearestProposal)`** per decision | no | whether the enumeration reaches the plan we stage. No decomposition design survives a bad answer |
| **S3** | **split `adjudication.*Decided` by contested-vs-quiet** | no | Prediction P-1: whether the floor really goes flat where the decision is hardest (§2.3) |
| **S4** | **B-3 falsifier**: round-robin vs odometer on a slider-board scenario set, comparing `argmaxMoved` / `estSpread` per ply | no (probe only) | the magnitude of §2.2. The *scope* is already derived |
| **S5** | **accept-cycle counter**: accept-events per plan key within one `improve` call | no | whether §2.1's cycle is realised, not merely admitted |
| **S6** | **Law A1**: delete `depthRung`'s incumbent-dominance early-out; order by `µ` always, dominance vetoes only | yes, tiny | restores a provable fixed point; also fixes C12's invalid dynamic propagation of interval dominance |
| **S7** | **B-4 row cutoff** (`if (worstHi <= bestLo) break`), `theirCoverage` per row | no published value changes | more plies at the same tithe |
| **S8** | **B-1 round-robin** in `scoreOptions`, both sides | yes, ~15 lines, cost ≤ today | fixes §2.2 if S4 says it fires |
| **S9** | **Law D1 + P2 structural test** (nothing under `search/` may be imported by `bounds/`) | no | prevents the one failure mode we are currently safe from by accident |
| **S10** | **R1**: declare the reduction (`{support, ambiguity, arity, reading}`) stamped beside the basis; today's value is the vacuous/paranoid/point/sound member | no | makes "which reduction produced this number" answerable — the precondition for comparing two |
| **S11** | **`focus` sub-joint + cluster-conditioned re-enumeration** (§3.3) | yes | the largest capability-per-ms item. Falsifier: must beat today on the crowded tail and not regress the 88.7% scattered case (`minHamming` already protects it) |
| **S12** | **conflict-chain repair** as an eighth operator | yes | the corridor lock-in hypothesis. Falsifier already written |
| **S13** | **charge the candidate cap**: `1 − admitted/available` per unit, emitted not folded | no | whether `sliderCandidateCap` is a real capability loss or an inert ration like `maxClusterCells` |
| **S14** | **`τ` (CVaR) as the shipped ambiguity dial**, `τ = 0` byte-identical, `P₀` = cover-counting | yes, gated | first measurement in which an opponent model can matter (§2.3), first ordering signal on contested cells. **Blocked on C-B1** |
| **S15** | **set-valued arity** (maximality), consumed by the ADVICE kind | yes, and it is the Centaur increment | §2.4. Blocked on C-T1's ratchet restatement and on S0 |

Two rules over the whole order, borrowed from the composition lens because they
are right: **byte-identity at every step**, and **nothing lands without a roster
bot that plays it** — which applies immediately to `multistartSeed` and
`sampledCap`, both built and dark.

---

## 6. What I refuse to build

- **No learned neighborhood selector.** The MAPF-LNS field ran that experiment at
  scale (SoCS 2025 re-evaluation) and rule-based destroy heuristics held against
  learned selection on both time and improvement capacity. Bandits over
  *rule-based* members, yes; a learned member, not until something forces it.
- **No general junction-tree / message-passing library.** `cluster-enum.ts`'s own
  refusal is correct at `k_c ≤ 3`, `|D| ≤ 8`: materialising 512 entries beats the
  bookkeeping that would avoid it, and the fallback ladder is cheaper to maintain
  and cannot be wrong in a way that matters.
- **No value decomposition over the coordination graph.** Law D1. One mid-turn
  collision couples the whole board; the VDN/QMIX/DCG line is unsound for our
  payoff, and the generator line has no soundness obligation at all.
- **No second acceptance comparator.** Law A1. If a channel deserves to decide,
  it belongs in the key — not in a branch that selects a different comparator for
  some pairs.
- **No mixed play until the ratchet is restated.** C-T1 is a real invariant doing
  a real job; routing around it by exempting draws would delete the property the
  wire discipline exists to provide.
- **No `restrictedGap` reported as a bound.** It is a within-the-searched-set
  measurement of how much structure the pure reduction discards. Adding rows
  raises it, adding columns lowers it. Reporting it as "how much we are losing"
  would be exactly the laundering the basis discipline exists to prevent.

---

## 7. Owner-facing summary

- The bot's brain is, in the field's own terms, a well-built instance of a
  recognised algorithm with **one missing half**. We generate the opponent's best
  replies and remember them — that is half of a standard method — and then we
  pick the single move that is safest against the worst of them. The other half,
  which the field's textbook algorithm has, is to work out the *value of the
  whole situation* rather than of one move. We can compute that value from
  numbers we already have in memory, in microseconds, without playing a single
  game, and the number tells us how much our current way of choosing is costing
  us **on this board**. That is the first thing I would build.
- The four-times-confirmed finding that always-assume-the-worst play is
  structurally passive is not a tuning problem and never was. Always-assuming-the-worst
  computes *the value of moving first while your opponent watches you do it*.
  No amount of "assume slightly less bad things" reaches the right answer,
  because **being watched is the problem, not the pessimism.**
- There is a second, more mechanical cost to it that nobody has named: on exactly
  the squares that are being fought over, assuming the worst gives *every* option
  the same score — because the worst case for all of them is "that piece dies".
  So on the hardest decisions, the bot's main way of ranking moves says nothing at
  all, and the choice falls through to weaker tie-breakers. This is checkable
  today from counters we already keep.
- The strongest argument I have found for the direction you want to go — a bot
  that surfaces live options to a human — is that **our current way of choosing
  structurally destroys the option list.** It always returns exactly one move,
  no matter how much thinking went in. There is a family of well-studied
  alternatives whose natural output *is* the shortlist, and whose shortlist
  shrinks as the bot thinks longer. That gives the human something to watch, and
  it gives us the first honest measure of what a second of thinking actually
  buys — which today is invisible.
- Two defects worth fixing regardless of any of the above. First: when the bot
  looks several moves ahead on a board with long-range pieces, the "try our
  options" step is written in a way that only ever varies **one** piece and
  freezes the rest on their first guess — and it does this on precisely the
  boards we struggle with, while being harmless on the simple ones. The fix is
  about fifteen lines and is *cheaper* than what it replaces. Second: the same
  step already knows enough to stop early on hopeless lines and does not, which
  is free extra depth.
- The part of the machinery that decides *which candidate moves to even
  consider* has eight different sources, nine hard-coded numbers, and no record
  of which source produced the move we finally played. One label on each
  candidate makes the whole thing measurable, and I expect it to show that two of
  the eight can simply be deleted.
- One piece of our design is better than the published state of the art and
  should be defended as such: how we let a deep read of a position influence the
  choice. The standard method blends the two with a hand-tuned constant. We
  weight the deep read by how much it *earned* — how cleanly the line was
  computed — with no cap in either direction. The literature's constant caps
  exactly the discoveries that looking deeper exists to make.
