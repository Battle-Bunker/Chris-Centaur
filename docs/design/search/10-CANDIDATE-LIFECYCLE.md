# 10 — The candidate lifecycle: giving the pipeline an owner

SEARCH-THEORY lens, document 10. The composition lens's weighted DSM
(`29-DSM-WEIGHTED.md` @ `0fd5778`) ran the distinguishing test on ACTION and got
**distribute, not split** — and then named what a distribute-case cluster
usually means:

> **The candidate set has no owner.** Its lifecycle — generate → order → close →
> factor → sample → admit → *emit* — is spread across `candidates.ts`,
> `search/order.ts`, `fatality.ts`, `staging-safety.ts`, `search/cluster-*.ts`
> and `selection/*`, and **nothing sees the whole pipeline**. That is why
> admission turns out to operate at three granularities nobody had enumerated,
> and why **15–43% of every plan priced is refused at emission** — a lifecycle
> whose last stage is invisible to its first.

That object is this lens's territory, and several findings already on my books
are its symptoms rather than independent defects. This document designs it.

**It is a protocol, not a module of members.** ACTION stays a kind with no module
of its own; every member keeps living with its consumer. What is missing is a
*hiding unit for the pipeline's shape*, and that is a different structure —
Parnas, Clements & Weiss's point that the module structure and the uses
structure are distinct structures over the same code, and that conflating them
is the standard error.

---

## 1. What the object is

```ts
// search/lifecycle.ts — TYPES, A REGISTRY, AND A LEDGER. NO LOGIC, NO MEMBERS.
// Imports nothing from bounds/. Nothing in bounds/ imports it. (Law D1.)

/** The seven stages, enumerated ONCE, in order. */
type Stage =
  | 'generate'    // candidates.ts        — the legal set + prunedLedger
  | 'order'       // candidates.ts, search/order.ts — a RANKING, not a decision
  | 'close'       // fatality.ts, staging-safety.ts — marks, never prunes
  | 'factor'      // search/cluster-partition.ts    — components, never values
  | 'sample'      // selection/*                    — permutation + width
  | 'admit'       // THREE POINTS, §3
  | 'emit'        // kernel.ts — and it is a READ of admit, §4

/** What every stage returns. The uniformity is the point: today there are
 *  three shapes for "what I removed and why" and nobody can sum them. */
interface StageResult<T> {
  readonly kept: ReadonlyArray<T>
  /** REMOVED, WITH A REASON AND A RESTORABILITY CLASS. */
  readonly set_aside: ReadonlyArray<{
    readonly item: T
    readonly stage: Stage
    readonly reason: string
    /** 'recoverable'  — a later stage or a later slice may still take it
     *  'closed'       — a rules-certain fact removed it (the safety floor)
     *  'unpriced'     — never evaluated; we do not know what it was worth */
    readonly disposition: 'recoverable' | 'closed' | 'unpriced'
  }>
}

/** The per-decision ledger. One object, written by every stage, read by every
 *  instrument. This is the thing that does not exist today. */
interface LifecycleLedger {
  readonly byStage: ReadonlyMap<Stage, { kept: number; setAside: number }>
  /** Which stage produced the plan that was finally staged. `proposedBy` is a
   *  READ of this, not a new field (§6). */
  provenanceOf(planKey: string): ReadonlyArray<Stage>
}
```

### 1a. The conservation law — the ledger's single invariant

Adopted from the red team's round-4 addition, and it is the piece that makes the
ledger an *object* rather than a log.

> **LAW C (conservation).** The dispositions **partition** the generated set. For
> every decision and every unit,
>
> ```
> |generated| = |admitted| + |closed(cause)| + |capped(granularity)| + |priced| + |refused-at-emission|
> ```
>
> and every term on the right carries the stage and reason that produced it.
> **No candidate may vanish without a recorded cause.**

One invariant, checkable in one assertion, and it subsumes the three separate
counters the code keeps today (`prunedLedger`, `skippedNear`/`skippedFlat`,
`refusals`) by making them terms of one sum rather than three idioms.

**Why it is worth stating as a law rather than a nicety: it would have made both
of the DSM's exhibits impossible to miss.**

- **The three granularities.** Admission appearing at per-unit, per-cluster-joint
  and per-emission is invisible today because each granularity has its own
  counter in its own file. Under Law C they are three terms of one partition, so
  a fourth granularity cannot be added without either appearing in the sum or
  breaking it. The finding that took a measurement to make would have been a
  column in a table.
- **The 15–43% emission refusals.** A plan that is priced and then refused is
  today a `refusals` tick in the kernel and a completed `price()` in the bank,
  with nothing relating them. Under Law C `refused-at-emission` is a term
  *beside* `priced`, so the ratio is a subtraction rather than a study.

**And it seats the admission-trace coordinate in its natural home.** The
composition lens has been looking for where an admission trace belongs; Law C
answers it — the trace *is* the partition's witness. Each `set_aside` entry is
one term's evidence, and the coordinate is "which term, at which stage, for which
reason", which is the record the ledger already has to keep to satisfy the
invariant. No new coordinate; the invariant creates the home.

**Two honest constraints on the law.**

- `capped(granularity)` and `closed(cause)` must be **disjoint by construction**,
  or the sum double-counts. An option that is both rules-certain-fatal *and*
  outside the cap is `closed` — closure wins, because it is the stronger and
  earlier statement. The registry fixes stage order, so the tie-break is a
  property of the pipeline rather than a convention.
- The partition is **per (decision, unit)** for the option-level terms and **per
  decision** for the plan-level ones. Conflating them is the one way to write an
  invariant that looks conserved and is not, because `admit@A2` consumes *plans*
  while `admit@A1` consumes *options*. Two sums, one law, and the type says
  which.

Three properties make this the right shape rather than a bigger one.

**It hides exactly one decision: what the stages are and in what order they
run.** That decision is currently replicated implicitly across six files and
inside `improve()`'s control flow, which is why a seventh stage could be added
without anyone noticing and why nobody enumerated the three admission points. A
module that hides one design decision and exports types is a module in Parnas's
sense; a module that *executes* the stages would be the god module the
constraint forbids.

**It hosts no member.** Every ordering, closure, factorisation and sampling
member stays in the file it is in today. The registry holds *references*, not
implementations.

**It charges nothing to the visible layer.** No coordinate, no kind, no law, no
`Choice` form. The stages are ACTION-kind members already in the manifest; the
only *declared* addition is the emission obligation as a read, and composition
has already located that in ECONOMY's provenance-of-computation, which exists.

## 2. Law D1, enforced structurally rather than by discipline

> **The lifecycle shapes what gets PRICED. It never shapes what a bound SAYS.**

Enforcement, using the pattern that already works — `scout/index.ts`'s import law
and its structural test:

- `search/lifecycle.ts` may not import from `bounds/`;
- nothing under `bounds/` may import `search/lifecycle.ts`;
- a `StageResult` may not carry a `Bound`, `ScoreBounds` or a score. It carries
  items and reasons.

That last clause is the one that matters, because it is the clause that would
have prevented the near-miss the code already contains: `offerClusterJoints`'s
`requireSurrogateGain` compares `cluster.score(plan)` against the incumbent's,
which is the decomposition *ordering* the priced set. It does not touch a bound,
so it is legal — but it is one small step from a stage returning a value, and
under the typed `StageResult` that step becomes unrepresentable rather than
merely discouraged.

## 3. Admission has three points, and enumerating them is half the fix

The composition lens's measurement found three granularities *after* arguing
from code that there was one. Under the lifecycle they are three registrations
of one signature, so a fourth cannot appear unnoticed:

| point | mechanism today | binds where (measured) | hosted in |
|---|---|---|---|
| **A1 per unit** | `candidateCap: 8` / `sliderCandidateCap: 4` prefix, widened by `widenTo` | sliders **100%**, snake/leaper **0%**; a queen's mean 64.4 options against a cap of 4 | `search/core.ts::optionsOf`, reading `selection/widen.ts` |
| **A2 per cluster joint** | `maxJointsPerCluster: 512`, `composedK: 8`, `minHamming: 2`, and *which incumbent is carried* | everywhere, snakes included — and the potion ordering win rides on this one | `search/cluster-enum.ts`, `search/core.ts::offerClusterJoints` |
| **A3 per emission** | `worth` (the `gapImprovementFraction` threshold) and `rate` (the minimum wall gap between writes) | everywhere, **after pricing** — 15–43% of priced work | `kernel.ts::stageAndGate` |

Two things follow immediately from having them in one table.

**A1's severity is now measured and my reading of it was wrong.** Doc 03's
Finding P-5′ records the correction: the value lens measured what the cap
removes and, with food on a ray, the slider takes it 75% of the time at the 48th
percentile. The cap discards value the comparator **cannot name**, not value it
can. So A1's remedy is the ordering member, not the cap — which the table makes
visible because ordering and admission are adjacent stages of one object rather
than two files.

**A3 is the one nobody was reading, and it is upstream-invisible by
construction.** §4.

## 4. The emission obligation becomes a read — and the right consumer is the metalevel, not the comparator

Composition's rule is: *a plan that cannot be emitted this slice is not admitted
and not priced.* I want to adopt the obligation and be precise about where it
lands, because the literal reading is too strong and would cost more than it
saves.

**Why the literal reading is too strong.** Pricing a sub-threshold improvement is
not wasted if it *accumulates*: three improvements of 0.4ε each are refused
individually and stage happily as 1.2ε. A rule that refuses to price them
destroys the accumulation. And `better()` must not carry the threshold, because
an ε-quasi-order in the comparator re-opens the question Law A1 exists to close.

**Where it belongs.** The emission obligation is a term in the **value of
computation** (doc 08). A computation whose only product is an improvement the
wire will refuse has low value *because the wire will refuse it* — and
`estimates()` has no such term. So:

> **The emission window is a declared read of the METALEVEL, not of the
> comparator.** The kernel computes, once per slice, an `EmissionWindow`
> `{ canEmit: boolean, threshold: number, msToNextWrite: number }` from the
> rate limiter and `basis.maxGap × gapImprovementFraction`, and hands it down
> the search context. `voc.ts` reads it. `better()` does not.

Three consequences, and the third is the one that pays.

1. **A lever whose expected `Δ maxGap` is below `threshold` is worth
   approximately nothing this slice**, and the metalevel can say so. That is a
   real term in a value function that currently has fourteen constants and no
   term for "will the wire take it".
2. **`canEmit === false` is actionable rather than invisible.** Today the search
   cannot distinguish "no improvement available" from "an improvement is
   available and the wire is closed for another 40 ms". Those want opposite
   behaviour: the first should stop, the second should spend the window on
   *depth* or on a *different cluster* — work whose product outlives the window.
3. **It closes the loop the DSM named.** The lifecycle's last stage becomes a
   declared input to its own scheduling, which is exactly "a lifecycle whose
   last stage is invisible to its first", fixed at the one seam where visibility
   is cheap.

### 4a. The disjointness guard on accumulation

My §4 argument against the literal rule rests on accumulation: *three
improvements of 0.4ε each are refused individually and stage happily as 1.2ε.*
The composition lens accepted the re-siting and supplied the condition that
argument needs, which I had left implicit and which is not always satisfied:

> **Improvements sum only if their PARTICIPANT SCOPES ARE DISJOINT.** Three
> 0.4ε improvements on three different units compose to 1.2ε. Three 0.4ε
> improvements that all move *the same* unit — or that move units whose paths
> contend for the same cell — are **substitutes, not addends**: the second is
> measured against a board the first already changed, and taking their sum
> double-counts. What composes there is the **residual** — what the second is
> worth *given* the first — which is the quantity the enumeration's order-2
> surrogate already computes for pairs and which the bank computes exactly.

So the metalevel's emission term is not `Σ Δ` over pending improvements. It is:

```
expectedStageable(window) =
    Σ over DISJOINT participant scopes of Δ
  + residual for overlapping ones
```

and the disjointness test is one the code already has: two improvements are
disjoint when their `footprintOf(plan)` claim sets do not meet — the same
relation `entangled` and the cluster partition are built on. **The guard is
therefore free**: it is the interaction relation, evaluated on staged deltas
instead of on units, and it reuses `ConflictIndex` rather than adding anything.

Without the guard, the metalevel would over-estimate what a slice can stage on
exactly the boards where units contend — which is where the emission window
binds hardest, so the error would be worst where the term matters most.

### 4b. The fifteenth term is an ANTICIPATORY MEET, priced by `msToNextWrite`

`estimates()` has fourteen constants and no term for "will the wire take it"
(doc 08, Finding M-3). Naming the new one as a fifteenth constant would be the
wrong move — it would add to exactly the pile this lens is complaining about.
The composition lens's framing is better and I adopt it: **the term is not a
weight, it is an anticipatory meet, and its price is already on the clock.**

In the premise-lattice vocabulary the three lenses share, an *anticipatory meet*
is computing under a narrowing nothing can purchase yet — work whose product
becomes usable when a determination arrives. A closed emission window is exactly
that shape: the improvement exists, the wire will take it in `msToNextWrite`
milliseconds, and the computation that produces it is bought **now** against a
narrowing that arrives **then**.

That reframing does three things:

1. **It supplies the price without a fitted constant.** `msToNextWrite` is a
   measured quantity the kernel already has; the term is a discount over a known
   horizon, not a coefficient someone chose. Under Ruling 49 that is the
   difference between a member with provenance and a fifteenth number with none.
2. **It puts the term in a category that already has a law.** The time lens's
   economy has two purchase columns — buying the meet, and the anticipatory meet
   held conditional — and this is a row in the second. So it inherits their
   accounting rather than needing its own.
3. **It makes `canEmit === false` legible.** A closed window is not "stop"; it is
   "the meet you are computing toward arrives in 40 ms", which is precisely the
   distinction §4's third consequence needs and which a scalar penalty could not
   express.

**A caution the measurement supplies.** The same run found `switch-floor`,
`switch-dominance` and both ratchet refusals firing **exactly zero times in 192
games**. So of `stageAndGate`'s five gates, three never fire and two do all the
refusing. Any design that treats "the emission stage" as a monolith will
mis-model it: **the live obligation is `worth` + `rate`, and the ratchet is a
guard that has never engaged.** That also settles the shape of doc 05's C-T1
restatement — a zero-firing guard is exactly the thing whose *comment* should be
corrected rather than whose *code* should be changed.

## 5. C41: widening is applied at selection, over an order fixed at generation

The exposure, stated from the code. `optionsOf` computes

```ts
const width = widenTo(sampler.tuning.widen, sampler.visitsOf(node), cap)
… return topCandidates(permuted, width)
```

so the progressive-widening schedule chooses a **width over an already-ordered,
already-closed list**. The literature's progressive widening operates on the
*generation* side — expand the k-th child when a visit schedule says so. Ours
widens a **prefix of a list whose order was fixed two stages earlier**.

> **The widening schedule inherits the ordering member's blindness in full.** A
> wider draw returns more options *in the comparator's order*, and against a
> twelve-slot precedence with no positional term above `healthSpent` those extra
> options are sorted arbitrarily. Widening a blind order buys sampling noise.

Under the lifecycle this stops being an incidental coupling and becomes a
**declared input**: the `admit@A1` registration names the `order` member it
consumes, so "which ordering was this width taken over" is a property of the
decision rather than a fact about two files. Two members become expressible that
are not expressible today:

- **widen-at-generation** — the generator emits options in schedule order and
  the width is a generation parameter, which is the literature's form;
- **widen-over-a-declared-order** — today's form, with the order named.

And the coupling the value lens found from the other side (doc 03 §3a) becomes
structural rather than advisory: **the ordering member is a prerequisite of the
admission member**, because admission declares it as a read.

## 6. What the pieces already on my books become

Every one of these was a separate item. Under the lifecycle they are **reads of
one ledger**, which is the test that the object is real rather than a container.

| item | today | under the lifecycle |
|---|---|---|
| **`proposedBy`** (doc 03, S1) | a proposed new field on every priced trial | **not a new field.** `ledger.provenanceOf(planKey)` — the stage list is already being written by every stage |
| **coverage oracle** (doc 03 §4a) | a separate exogenous-probe instrument | still exogenous by construction, but its comparison target is `set_aside[disposition = 'unpriced']` — it asks whether anything in *that* set beat the staged plan |
| **`planDistance(staged, nearestProposal)`** (doc 02, D-1) | a separate loop | a read of `byStage['factor']` against `provenanceOf(staged)` |
| **the eight proposal operators** (doc 03) | a hard-coded control-flow sequence with nine constants | registrations at `admit@A2` with a `cost(state)`, so the metalevel can price them (§4) and the schedule sub-joint becomes buildable |
| **three inert-weight causes (a)/(d)/(e)** (composition §3) | three separate remedies | three stages of one pipeline: (a) is `admit@A1`, (d) is `admit@A2`, (e) is `admit@A3` |
| **P-5′'s re-localization** | a correction in prose | ordering and admission are adjacent stages; the read is declared |
| **prefix determinism's pool cost** (doc 07 §4a) | a comment in `multistart-seed.ts` | a `disposition: 'unpriced'` entry with reason `pool-cap`, countable |

## 7. Operators become members with a cost, hosted where they live

The `cost(state)` the coordinator asks for is what makes §4's metalevel term
computable, and doc 03's Finding P-9 is the exhibit for why it is missing:
`multiStartSeed` sizes its sample count from `budgetMs × evalsPerMs` with **no
term for the size of the space**, so a singleton group draws ~909 samples over a
five-point space. An operator that cannot say what it will cost *given the state*
takes its budget from a clock, and a clock does not know a five-point space has
been exhausted.

```ts
interface ProposalOperator {
  readonly id: OperatorId
  readonly stage: Stage           // where it registers
  readonly retention: 'none' | 'all-but-k' | 'all-but-subset' | 'trajectory'
  /** Quanta, GIVEN THE STATE. For the seed this is
   *  min(maxSamples, poolCap, ∏|choose_v|) × perSample — the fix P-9 asks for,
   *  arriving as a consequence of the type rather than as a patch. */
  cost(state: LifecycleState): Quanta
  propose(state: LifecycleState, budget: Quanta): Iterable<JointPlan>
}
```

The registry lives in `lifecycle.ts`; every `propose` lives where it does today.

## 8. What each of the six files becomes

Naming this precisely is the deliverable, because "give it an owner" is only
actionable if nothing has to move.

| file | today | becomes | moves? |
|---|---|---|---|
| **`candidates.ts`** | generates the legal set, orders it by a twelve-slot precedence, applies set-closures, writes `prunedLedger` | **host of `generate` + the `order` member.** Its output is already a `StageResult` in all but name (`candidates` + `prunedLedger`); the change is that `prunedLedger` entries gain a `disposition` and that the order is *declared* as an output others read, rather than being an incidental property of the array | **no code moves.** One type widened, one registration |
| **`search/order.ts`** | `dangerOrder`, `contestedUnits` — the *unit* sweep order | **host of the `order` member at unit granularity.** Distinct from `candidates.ts`'s *option* order, and the lifecycle is where that distinction is finally written down — two orderings, two registrations, one stage | no |
| **`fatality.ts`** | `certainlySelfFatal`, the rules-certain classifier | **host of a `close` member.** Its output is a **mark**, consumed by admission; the lifecycle's type forbids it from being a prune, which is what its own comment already claims (*"NEITHER IS A PRUNE"*) and which nothing currently enforces | no |
| **`staging-safety.ts`** | `allyBodyCollision`, the always-on floor | **host of the one `close` member that is KERNEL** — not a selectable member, marked so in the registry. The lifecycle is where "this closure may not be varied" becomes a property rather than a convention | no |
| **`search/cluster-*.ts`** | partition, enumeration, proposal offering | **host of `factor` + the `admit@A2` point + the `solver` sub-joint members** (doc 02 §4b½: product enumeration, variable elimination, max-plus, ICM, threshold-split) | no |
| **`selection/*`** | Gumbel permutation, `widenTo`, the seeded streams | **host of `sample` + the width member consumed at `admit@A1`**, with the order it is taken over now a declared input (§5) | no |
| *(new)* **`search/lifecycle.ts`** | — | **types, the stage registry, the ledger.** No logic, no members, no imports from `bounds/` | — |
| *(changed)* **`kernel.ts`** | owns `stageAndGate` privately | **hosts `admit@A3` and publishes the `EmissionWindow`** into the search context (§4). The gates stay exactly where they are; what changes is that their acceptance predicate becomes readable upstream | one field down the context |

Nothing relocates. Six files gain a registration and a slightly wider output
type; one small protocol file appears; one obligation becomes visible. That is
the whole change, and it is deliberately the whole change — the DSM's verdict
was *distribute*, and a design that moved these files would be re-litigating a
measurement rather than acting on it.

## 9. Build order

| # | increment | changes behaviour? | what it buys |
|---|---|---|---|
| **L0** | `search/lifecycle.ts` — types, registry, ledger; every stage registers; `disposition` added to the three existing removal records (`prunedLedger`, `skippedNear`/`skippedFlat`, `refusals`) | no | one place that sees the pipeline. `proposedBy`, D-1 and the coverage oracle all become reads rather than three separate builds |
| **L0½** | **Law C as one assertion** (§1a): the dispositions partition the generated set, per (decision, unit) for option terms and per decision for plan terms | no | the invariant that would have made both DSM exhibits impossible to miss. It is one equality, and it is what turns three counters into one object |
| **L1** | the Law D1 structural test (§2) | no | makes the one property the architecture is currently safe-by-accident on unrepresentable to violate |
| **L2** | `EmissionWindow` published into the search context; `voc.ts` reads it as an **anticipatory meet priced by `msToNextWrite`** (§4b), under the **disjointness guard** (§4a); `better()` does not (§4) | yes, small | attacks the 15–43%, and adds the missing term to a value function with fourteen constants and no term for "will the wire take it" |
| **L3** | `cost(state)` on the eight operators, starting with the seed's space bound (§7, doc 03 P-9) | yes — strictly less work for the same output | the pure win already on the books, arriving as a consequence of the type |
| **L4** | the `order` member declared as an input of `admit@A1` (§5) | no | makes the ordering-before-admission prerequisite structural. Prerequisite for any widening or cap change |

L0 is the whole object and it changes nothing. That is the point: the DSM found
a **missing abstraction**, not a missing behaviour, and the first increment
should be able to prove it by being byte-identical.

## 10. What I refuse to build here

- **No stage that returns a value.** §2. A `StageResult` carries items and
  reasons; the moment one carries a score, Law D1 is a convention again.
- **No execution in `lifecycle.ts`.** It is a hiding unit for the pipeline's
  shape. A file that also *runs* the stages is the god module the DSM's
  distribute verdict argues against, and it would re-couple the six files it
  exists to decouple.
- **No manifest surface.** The stages are ACTION members already addressed; the
  lifecycle adds no coordinate. If this design starts wanting a `Choice` form,
  it has drifted from *protocol* to *joint* and should be re-argued.
- **No threshold in `better()`.** §4. The comparator stays a single total
  preorder on one key (Law A1), and the emission obligation is priced where
  computations are priced.
