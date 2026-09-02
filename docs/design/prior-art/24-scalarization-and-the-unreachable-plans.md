# PRIOR ART 24 — scalarization: the plans no weighting can reach

Domain: multi-objective optimization, and a fifty-year-old theorem that says the
VALUE joint's declared composition law **cannot express some good plans at any
setting of its weights.**

Read against `07-SYNTHESIS.md`'s VALUE kind ("weighted monoid over a common
currency"), the VALUE lens's weight sweeps, and the inert-weight taxonomy.

This is a fourth independent argument for R-4, and it is the sharpest one,
because it is not a preference about output types — it is an **impossibility
result about the combination law we chose.**

---

## 24.1 The theorem

**S50. The weighted-sum scalarization result** (standard in multi-objective
optimization; see e.g. Miettinen, *Nonlinear Multiobjective Optimization*, and
the Chebyshev/Tchebycheff literature).

Given several objectives, the obvious combination is a **weighted sum**
`Σᵢ wᵢ fᵢ(x)`, and sweeping `w` traces out solutions. The theorem:

> **Weighted-sum scalarization can only recover Pareto-optimal points on the
> CONVEX HULL of the Pareto front. Points in non-convex regions are unattainable
> for every positive weight vector.**

The remedy is equally standard. **Chebyshev (Tchebycheff) scalarization** uses the
weighted infinity norm — minimise `maxᵢ wᵢ·(zᵢ* − fᵢ(x))` against a reference
point `z*` — and, unlike the weighted sum, **can recover the complete Pareto set
in both convex and non-convex problems**. Other members of the same family:
the **ε-constraint** method (optimise one objective, bound the rest), and
reference-point methods.

The practical statement, which is the one that matters here: *sweeping the weights
of a linear combination is not a search over the space of good plans. It is a
search over the convex hull of that space, and the rest is invisible no matter
how finely you sweep.*

---

## 24.2 Mapping onto our joint

**C53. The VALUE joint's declared law is linear scalarization, so some good plans
are unreachable at every weight — and we have been sweeping weights to look for
them.** The composition synthesis types the VALUE kind as a *"weighted monoid over
a common currency"*, and the VALUE lens's whole programme is to establish that
currency and then price flows into it. That is exactly a weighted sum, and the
theorem applies without modification.

  Three consequences, in increasing order of how much they should change work:

  1. **"We swept the weight and found nothing" is not evidence that a term is
     worthless.** It is evidence that the term does not move the answer *within
     the convex hull*. That is a strictly weaker conclusion, and it is a **fourth
     candidate cause** for the inert-weight taxonomy, alongside admission (a),
     no-gradient (b) and scale separation (c). Call it **(d) non-convexity**: the
     plans the term would favour are Pareto-optimal but sit in a non-convex
     region, so no weight reaches them. Its signature is distinguishable from the
     others — under (d) the term has real spread at the point of comparison
     (unlike (b)), the response curve is not monotone-then-worse (unlike (c)),
     and the option is in the priced set (unlike (a)); what happens is that the
     argmax **jumps** between two plans as `w` crosses a threshold, never resting
     on the intermediate ones. **That jump is observable in the existing sweep
     data**, and it is the cheapest possible test of whether (d) is present.

  2. **The lexicographic comparator is not a rescue, and it is not the disease
     either.** Our shipped `better()` is a twelve-slot lexicographic order, which
     the composition lens is proposing to replace with the additive currency. It
     is worth being precise: lexicographic ordering is *a different scalarization*
     with *different* reachability, not a worse or better one — it reaches the
     lexicographic optimum and nothing else, which is even more restrictive in one
     sense and reaches non-convex points the weighted sum cannot in another. So
     the migration from lexicographic to additive is not obviously a strict
     improvement in *expressiveness*, only in *derivability and legibility*. That
     should be said, because the current framing implies the additive form is
     strictly better and the theorem says it is strictly different.

  3. **The combination law should be a member collection, not a fixed law.** The
     composition lens's chief refusal is "no joint with one member"; the VALUE
     kind currently has one combination law. The multi-objective literature hands
     us a slate: **{weighted sum, Chebyshev/weighted-max, ε-constraint,
     lexicographic}**, each with known reachability. Chebyshev in particular is
     nearly a drop-in — `max` instead of `Σ`, against a reference point that our
     bounds bank already produces (the ceiling is a natural `z*`) — and it is the
     member that reaches everything.

**M62. R-4 gets its fourth and sharpest argument.** Domains 3, 8 and 10 argued
the reduction should return a *set with conditions*, from decision theory, POSG
value theory and the psychology of explanation. Those are arguments about what
the output should be. **This is an argument that the scalar output is not merely
impoverished but incomplete**: the set of plans a linear scalarization can ever
select is a strict subset of the non-dominated set, and the missing ones are
missing *by construction*. The Pareto front is the same object as the maximal set
(domain 3) and the α-vector upper envelope (domain 8) — three names, one object —
and the multi-objective literature adds the theorem about what a scalarization of
it loses.

**M63. This reframes the value lens's own withdrawn claim, favourably.** The lens
wrote: *"I withdraw my stronger claim that one dial interpolates
lexicographic↔additive: γ is a risk-concentration exponent on outflows, and the
lexicographic limit exists only at an unbounded balance ratio."* That withdrawal
is correct and the theorem explains **why** it had to be: the two combination laws
are not endpoints of one dial because they have **different reachable sets**, and
no continuous parameter connects sets that differ in which Pareto points they can
select. The honest replacement is not a dial but a **choice among members**, which
is precisely what the composition carve is for. A withdrawn claim becoming a
joint is the carve working.

---

## 24.3 What this does not say

- **It does not say the currency work is wrong.** Establishing a common currency
  is what makes *any* scalarization well-defined, and the fold's evidence
  (R² 0.970, k marching to unity) is about the currency, not about the
  combination law. The two are separable and only the second is at issue.
- **It does not predict that non-convexity is present.** Whether our Pareto front
  has non-convex regions is an empirical question, and the argmax-jump signature
  in the existing sweeps is the cheap way to ask it. If the front is convex, the
  weighted sum loses nothing and this is a note rather than a finding.
- **It does not favour Chebyshev by default.** Chebyshev reaches everything but
  is non-smooth and can behave awkwardly under optimisation; the literature
  treats the choice as problem-dependent. The point is that it *is* a choice.

---

## 24.4 Verdicts

- **VALUE:** add **(d) non-convexity** to the inert-weight taxonomy. Its
  signature is distinct — real spread at the point of comparison, no
  monotone-then-worse curve, the option admitted, and the argmax **jumping**
  between plans as `w` crosses a threshold rather than resting on intermediates —
  and **that jump is visible in sweep data you already have.** "We swept and found
  nothing" is not evidence a term is worthless; it is evidence the term does not
  move the answer within the convex hull.
- **COMPOSITION:** the VALUE kind's combination law should be a **member
  collection** — {weighted sum, Chebyshev/weighted-max, ε-constraint,
  lexicographic} — with known reachability per member, rather than a single
  declared law. "No joint with one member" applies to the composition law itself,
  and the multi-objective literature hands us the slate. Chebyshev is nearly a
  drop-in: `max` for `Σ`, with the bank's ceiling as the reference point.
- **COMPOSITION:** state plainly that migrating from the lexicographic comparator
  to the additive currency is an improvement in **derivability and legibility**,
  not in **expressiveness** — the two scalarizations have different reachable
  sets, and the current framing implies a strict improvement the theorem does not
  support.
- **ALL (R-4, fourth argument):** the Pareto front, the maximal set and the
  α-vector upper envelope are three names for one object, and this domain adds
  the theorem about what collapsing it to a scalar *provably* loses. That makes
  R-4 an impossibility result rather than a preference.
