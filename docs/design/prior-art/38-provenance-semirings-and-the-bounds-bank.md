# PRIOR ART 38 — provenance semirings: the bounds bank's annotation is in a named, lossy semiring

The programme's central hygiene commitment is that **a number travels with the
premise it was computed under**. The bounds bank implements it: `backupMax` /
`backupMin` propagate values, `basisKeyOf` keys them, and `unionAssumptions`
carries the assumption set alongside.

There is a field whose entire subject is that construction. It has a formal
framework, a universality theorem, a named hierarchy of what different
annotations can and cannot answer, a *worked counterexample* showing exactly what
ours loses, and — in the last few years — a branch that applies the machinery to
**game value computations with alternating fixed points**, which is our object
rather than an analogy.

Three of its results land hard. One of them is the sixth independent arrival of
R-4, and this time it arrives *inside* the value backup rather than beside it.

---

## 38.1 The framework, and the one proposition that is a design law

**S67. Green, Karvounarakis & Tannen, "Provenance semirings", PODS 2007.**
**S68. Cheney, Chiticariu & Tan, "Provenance in databases: why, how, and where",
*Foundations and Trends in Databases* 1(4) (2009).**

Annotate each input with a token; propagate the annotations through the
computation with **two operations** — one for *alternatives* and one for *joint
use* — and the algebra of the annotations is a **commutative semiring** `(K, +,
×, 0, 1)`. Different choices of `K` give different, previously-unrelated
notions, all as instances of one algorithm:

| semiring | what the annotation means |
|---|---|
| `(B, ∨, ∧)` | is this result derivable at all |
| `(N, +, ×)` | bag semantics — how many derivations |
| `(P(X), ∪, ∪)` | **why-provenance / lineage** — *which* inputs contributed |
| Boolean formulas | `c`-tables, incomplete databases |
| `[0,1]` events | probabilistic databases |
| **`N[X]`** | **how-provenance** — the provenance *polynomial* |

**The universality theorem.** `N[X]` (polynomials with natural-number
coefficients over the input tokens) is **universal for commutative semirings**:
every other semiring's computation factors through it by a unique homomorphism.
The paper's own summary is the sentence to keep:

> *"the polynomial and formal power series annotations are, by virtue of their
> 'universality' … **the most general form of annotation possible within the
> boundaries of semiring structures**."*

**Proposition 3.5, which is a design law and not a technicality.** For a map `h`
between annotation domains, `q(h(R)) = h(q(R))` for every query `q`
**if and only if `h` is a semiring homomorphism.**

  In words: **you may reduce an annotation before combining, or after, and get the
  same answer, exactly when the reduction is a semiring homomorphism.** If it is
  not, the two orders disagree and one of them is wrong.

---

## 38.2 The worked counterexample, and it is ours

Section 4 of the PODS paper introduces why-provenance as the semiring
`(P(X), ∪, ∪, ∅, ∅)` — **set union for both operations** — and then immediately
shows what it cannot see:

> *"in the query result … `(f,e)` and `(d,e)` have the same why-provenance, the
> input tuples with id `r` and `s`. However, the query can also calculate `(f,e)`
> from `s` alone and `(d,e)` from `r` alone. In a provenance application in which
> one of `r` or `s` is perhaps less trusted or less usable than the other the
> effect can be different on `(f,e)` than on `(d,e)`, **and this cannot be
> detected by why-provenance**. It seems that we need to know not just **which**
> input tuples contribute but also **how** they contribute."*

`unionAssumptions` is set union, applied on both the `max` backup (alternatives)
and the `min` backup (joint use). **That is this semiring, exactly.**

### SOURCE CHECK, and it turns up something sharper than the abstract argument

Read at source (`src/lobster/bounds/score.ts`, `claude/cluster-lookahead`), both
backups are literally:

    ledger:      unionLedgers(justifier(children, b => b.worst, worst).ledger,
                              justifier(children, b => b.best,  best ).ledger),
    assumptions: unionAssumptions(...children.map(c => c.assumptions)),

**The two annotations travelling with the same bound use different propagation
rules.** The ledger is taken from the **justifying child** — the one that actually
set the endpoint. The assumptions are unioned over **every** child, justifying or
not.

  So a child whose `worst` was 5 when the max-worst came out 9 **contributed
  nothing to the number**, and its assumptions are attached anyway. That is sound
  (the bound is reported as *more* conditional than it is) and it is exactly the
  over-invalidation of C70, in a stronger form than the OR/AND collapse: we are not
  merely unable to distinguish alternatives from conjunctions, **we are attaching
  premises from branches that provably did not affect the value** — while the
  machinery to avoid it (`justifier`) is right there, already used for the ledger.

  **And the defect is dormant with a scheduled activation date.** `unionAssumptions`
  fast-paths through `soleGroup`, whose own comment explains why: *"The basis is
  identical on every branch of every price … so the union of N copies of one
  canonical array is that array"*, and *"a bound with no assumptions is the
  default"*. Both conditions hold **because premises are currently uniform across
  branches**. The fog programme's whole direction is branch-dependent premises —
  different hypotheses down different children — at which point `soleGroup` returns
  `null`, the union starts doing real work, and every bound begins accreting the
  assumptions of branches it did not depend on. This is R-6's shape once more: a
  correctness-adjacent fast path resting on an unstated hypothesis that the
  roadmap is about to falsify.

---

## 38.3 Mapping onto our joints

### C70. `unionAssumptions` is why-provenance, and the question the design asks it is a how-provenance question

The bounds bank exists so that when a premise is refuted, the values that rested
on it can be found and retired. That is the design's stated purpose and it is a
**how**-question:

  - *"assumption A is refuted — which bounds die?"* — under set union, every bound
    whose set contains `A` is suspect. But some of them had a second, independent
    derivation that never used `A`, and **those bounds are still sound**. Set union
    cannot tell the two apart, because it collapses `A + B` (either suffices) and
    `A × B` (both needed) into the same `{A, B}`.
  - The consequence is not a wrong answer, it is a **needlessly destructive** one:
    a refutation invalidates a strict superset of what it should. In an
    incremental architecture whose whole value proposition is *not* recomputing,
    over-invalidation is the specific failure that matters — and it will look like
    "the cache does not help as much as we thought" rather than like a defect.
  - It also silently blocks a feature the design already wants: **the risk budget**
    (d15) and **`advisoryPrecision`** (d31) both want to weight a bound by how much
    it rests on soft evidence. That is a valuation of the tokens, and a valuation
    can only be pushed through the computation if the annotation retained the
    structure to push it through. Under set union it cannot.

  **And the fix has a theorem attached.** Because `N[X]` is universal, annotating
  once in the polynomial semiring makes every other reading — trust, confidence,
  bag count, plain derivability, our current assumption set — a **homomorphic
  image computable later**. Annotating in a lossy semiring is a one-way door: you
  cannot un-lose it without recomputation. Ruling 49's provenance ambition and the
  bank's incrementality ambition both point the same way here.

### C71. R-13 — an annotation reader is correct iff it is a semiring homomorphism

Proposition 3.5 gives a cheap, checkable rule for a boundary the design keeps
crossing without noticing. Every consumer that turns an annotation into something
smaller is a candidate `h`: a soundness flag, a trust level, an
`advisoryPrecision`, a "does this bound survive the re-base", a UI badge.

  **R-13.** *An annotation may be reduced before combining rather than after
  exactly when the reduction is a semiring homomorphism. If it is not, the
  reduction must be applied only at the end — reducing early silently changes the
  answer.*

  Two immediate applications, and the second is a live design item:
  - **Interval dominance at the leaf but not propagated** (C22) is an instance:
    the "is this dominated" reduction is not a homomorphism for the deep channel,
    which is why it is sound at the leaf and unsound propagated up. R-13 names the
    reason, where C22 only recorded the symptom.
  - **`advisoryPrecision` as a coverage/trust weight** (d31's corrected M77) is a
    valuation of assumption tokens. Whether it may be applied per-term and then
    combined, or must be combined and then applied, is exactly the R-13 question —
    and for a `min`/`max` backup with a multiplicative precision it is **not** a
    homomorphism in general. Get this wrong and the precision of a plan is computed
    from the wrong path.

### C72. Our assumptions carry NEGATIVE tokens, and the standard machinery is known to be inadequate for exactly that

**S69. Grädel & Tannen, "Provenance analysis for logic and games"
(arXiv:1907.08470).** Their opening assessment of the field they helped found:

> *"provenance analysis by interpretations in commutative semirings has been
> rather successful for **positive** query languages … However, **it did not really
> offer an adequate treatment of negation or missing information**."*

Their fix: **dual-indeterminate polynomials** — annotations over both positive and
negative tokens, in a quotient of the ordinary provenance semiring by congruences
*"generated by products of positive and negative provenance tokens"* (i.e.
`x · x̄ = 0`).

  **This is our fog, precisely.** A great many of our premises are negative: *the
  enemy queen is not at c4*; *no unit occupies this cell*; the belief lens's
  conditioning ladder rungs C1 (a disjunction across units — item-vanish) and C2 (a
  joint exclusion) are **negative provenance tokens** in the technical sense. And
  the congruence `x · x̄ = 0` is not an abstraction; it is the operational statement
  that **a bound resting on both a fact and its negation is dead**, expressed
  *structurally in the annotation* rather than as a separate consistency pass that
  someone has to remember to run.

  Two consequences worth stating:
  - the "missing information" half is the same defect the survey recorded at the
    belief layer as **C26** (marginal clouds cannot store what the conditioning
    ladder computes). It is one disease in two layers: the representation is
    positive-only, and both the ladder's rungs and the bank's premises are not.
  - this is a **prediction**, not just a caution. If assumptions are ever valued
    (trust, precision, ε-budget), a positive-only annotation will price a
    negatively-derived bound as though it rested on nothing, because the negative
    token has no representation to be valued.

### M96. Absorption-dominant strategies: R-4's SIXTH arrival, and the first one inside the value backup

**S70. Semiring provenance for Büchi games — strategy analysis with absorptive
polynomials (arXiv:2106.12892).** Evaluating the fixed-point formula that defines
the winning region *in a semiring of polynomials* gives

> *"not only the Boolean information on who wins, but also **tells us how they win
> and which strategies they might use** … semiring semantics provide information
> about all **absorption-dominant strategies — strategies that win with minimal
> effort**."*

  R-4 (REDUCTION must return a **set of options with the conditions under which
  each dominates**) has now been argued from maximality, α-vectors with dominance
  regions, contrastive explanation, the Pareto front, and the AC taxonomy's
  `set configuration` axis. This is the sixth, and it is qualitatively different
  from the other five: **it is not a parallel construction in another field, it is
  the same computation as ours** — a value backup over an alternating fixed point
  on a game — and it says the non-dominated set is what you get *for free* when the
  backup is done in the right semiring, rather than as a second pass over the
  answer.

  Note what "absorptive" buys and why it is the right choice rather than plain
  `N[X]`: absorption discards derivations dominated by shorter ones, which is
  precisely "do not keep a plan that another plan beats on every count". It is
  R-4's dominance filter, built into the algebra, so the set never has to be pruned
  after the fact. That is a better answer than domain 33's LP pipeline for the
  cases where it applies, and the two are complementary: absorption prunes
  *derivations*, the LP prunes *objectives*.

### M97. The foil is a by-product too

The Büchi paper's stated applications include *"determining **minimal
modifications to the game** needed to change its outcome."*

  Domain 10's **C32** recorded that nothing in our apparatus produces a **foil** —
  `better()` computes the deciding rung and margin on every decision and throws
  them away, and Miller's survey says a contrastive explanation is the effective
  kind. "What would have to be different for the other plan to win" is the foil,
  and the semiring formulation computes it from the annotation rather than by
  re-running the search under a counterfactual.

  Combined with domain 33's finding that the dominance *region* is the pruning LP's
  own witness, the Centaur surface now has **two independent by-product sources for
  its two hardest fields**, and neither requires an explanation subsystem.

### M98. The polynomial blows up, and the answer is a circuit — which we already have

The obvious objection to `N[X]` is size: a provenance polynomial expanded into
monomials can be exponential. The field's answer is **provenance circuits**
(**S71. Deutch, Milo, Roy & Tannen, "Circuits for Datalog provenance", ICDT
2014**): keep the annotation as a **DAG with sharing** — a circuit whose gates are
the semiring's `+` and `×` — rather than as an expanded polynomial. Evaluation
under any valuation is then linear in the circuit, and the expansion is never
materialised.

  **Our bound DAG already is that circuit.** `backupMax` and `backupMin` are `+`
  and `×` gates; the shared sub-results C14/R-2 warn about are the circuit's
  sharing. So the implementation cost of C70's fix is much lower than "store a
  polynomial per bound": it is *retain the structure you are already building
  instead of collapsing it into a set at each node*. The set is a valuation of the
  circuit; keep the circuit and compute the set on demand.

---

## 38.4 The counter-argument

Three, and the third is the field's own.

1. **Our operations are `max` and `min`, not `+` and `×`.** `(max, min)` on an
   ordered domain is a semiring (a bounded distributive lattice is), so the
   framework applies — but the *value* semiring and the *annotation* semiring are
   different objects, and the results above are about the annotation. The genuine
   subtlety is that `max` is not idempotent-free: when two derivations tie, the
   annotation must record **both**, and a naive implementation that keeps the
   argmax's annotation silently drops half the provenance. That is a concrete
   bug-shape to look for in `backupMax`, and it is the mechanism behind M96's
   "absorption-dominant" plural.

2. **This is a heavyweight framework for a small annotation.** True, and the
   recommendation should be scoped accordingly: nothing here says implement
   `N[X]`. It says (a) know which semiring you are in, (b) know what it cannot
   answer — the paper hands you the counterexample — and (c) if you want a
   *valuation* of assumptions later, do not collapse to a set now, because
   universality runs one way.

3. **The papers state their own limits.** The Büchi paper closes by *"discussing
   limitations of our approach and presenting questions that cannot be immediately
   answered by semiring semantics."* Provenance tells you how a result was derived
   from the inputs it had; it does not tell you what the inputs *should* have been,
   and it does not price a computation you did not do. So it is an answer to the
   bank's bookkeeping question and to the Centaur surface's foil question — **not**
   to the economy's allocation question, which stays with domains 34 and 37.

---

## 38.5 Verdicts

- **COMPOSITION / SEARCH (C70), the source-checked half first:** in both backups
  the **ledger** is taken from the **justifying child** and the **assumptions** are
  unioned over **every** child. A child that contributed nothing to the number has
  its premises attached to the result anyway — sound, but it means **a refuted
  premise invalidates a strict superset of what it should**, with `justifier`
  already sitting there as the fix. **The defect is dormant and scheduled**:
  `unionAssumptions` fast-paths through `soleGroup` precisely because premises are
  uniform across branches today, and the fog programme's direction is
  branch-dependent premises — at which point the fast path stops firing and every
  bound starts accreting premises it does not depend on. R-6 shape, with a date.
- **COMPOSITION / SEARCH (C70), the framework half:** set union on both operations
  is the literature's named **why-provenance** semiring `(P(X), ∪, ∪)`, and the
  founding paper's own worked counterexample is our use case — two results with the
  same assumption set where one is derivable from `r` alone and the other from `s`
  alone, *"and this cannot be detected by why-provenance"*. In an incremental
  architecture over-invalidation shows up as "the cache helps less than we thought"
  rather than as a defect. Because `N[X]` is **universal**, annotating once with
  structure makes every coarser reading a homomorphic image computable later;
  collapsing to a set is a one-way door.
- **ALL (C71 / R-13):** *an annotation may be reduced before combining rather than
  after **exactly when** the reduction is a semiring homomorphism.* Cheap and
  checkable, and it names the reason behind a defect already recorded (C22:
  interval dominance sound at the leaf, unsound propagated) and settles a live
  question (whether `advisoryPrecision` may be applied per-term then combined — for
  a `min`/`max` backup with a multiplicative precision, **no**).
- **BELIEF / SEARCH (C72):** the standard machinery *"did not really offer an
  adequate treatment of **negation or missing information**"* — and our premises are
  substantially negative (*the queen is not at c4*; the ladder's item-vanish
  disjunction and joint exclusion are negative tokens). The named fix is
  **dual-indeterminate polynomials**, whose congruence `x · x̄ = 0` states
  structurally that a bound resting on a fact and its negation is dead, instead of
  deferring it to a consistency pass. This is the same disease as **C26** at the
  belief layer: the representation is positive-only and the content is not.
- **VALUE / SEARCH (M96) — R-4's SIXTH arrival, and the first one *inside* our own
  computation.** Evaluating a game's fixed point in a polynomial semiring yields
  *"not only who wins, but how they win and which strategies they might use"* —
  specifically all **absorption-dominant strategies, those that win with minimal
  effort**. Absorption is R-4's dominance filter *built into the algebra*, so the
  non-dominated set is a by-product of the backup rather than a second pass.
  Complementary to domain 33's LP pipeline: absorption prunes **derivations**, the
  LP prunes **objectives**.
- **VALUE / CENTAUR (M97):** *"minimal modifications to the game needed to change
  its outcome"* is **C32's missing foil**, computed from the annotation rather than
  by re-running under a counterfactual. With domain 33's dominance regions, the
  Centaur surface's two hardest fields both have by-product sources and neither
  needs an explanation subsystem.
- **COMPOSITION (M98, and it lowers the cost of all of the above):** the answer to
  polynomial blow-up is a **provenance circuit** — a DAG of `+`/`×` gates with
  sharing, evaluated under a valuation in linear time, never expanded. **Our bound
  DAG already is that circuit.** So the fix is not "store a polynomial per bound";
  it is *stop collapsing the structure you are already building into a set at every
  node*. The set is one valuation of the circuit; keep the circuit, compute the set
  on demand.
- **SEARCH (the bug-shape to look for):** when two derivations **tie** under
  `backupMax`, the annotation must record **both**. An implementation that keeps
  the argmax's annotation drops half the provenance silently — and ties are common
  in a game with symmetric geometry.
