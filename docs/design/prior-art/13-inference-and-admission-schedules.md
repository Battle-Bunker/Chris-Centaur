# PRIOR ART 13 — two engineering literatures our ladders should be members of

Domain: concrete, well-studied algorithms for two things our design currently
does by hand — **inference over a set-valued belief** (the conditioning ladder)
and **growing an admitted option set over time** (the candidate cap). Both are
member mines with published algorithms and known properties, and both answer a
finding I raised earlier in this survey.

Read against `04-SYNTHESIS.md` §2Q3 (the C0/C1/C2 ladder, the ConditioningTrace)
and domain 1's C2/C3 (`sliderCandidateCap`, enumerate-then-cap).

---

## 13.1 Part A — the conditioning ladder is a constraint satisfaction problem,
and Minesweeper is its solved special case

### Sources

**S32. Studholme, *Minesweeper as a constraint satisfaction problem*
(cs.toronto.edu/~cvs/minesweeper); Pei et al., *Fast constraint satisfaction
problem and learning-based algorithm for solving Minesweeper*
(arXiv:2105.04120).** The CSP formulation, the **coupled-subsets**
decomposition, and solution-counting for probabilities.

### What the experts decided

Model each covered cell as a boolean variable (mine / not-mine). Every uncovered
cell with a number contributes a **cardinality constraint**: the sum of its
neighbouring variables equals that number. Then:

- **Deterministic moves** are the variables forced to a value by the constraint
  system — i.e. sound deductions, no guessing.
- **Coupled subsets:** "constraints are partitioned into coupled subsets where
  two constraints are coupled if they share a common variable, allowing
  backtracking search to solve each subset separately as an independent
  subproblem." This is what makes the whole thing tractable.
- **Probabilities by solution counting:** a cell's mine-free probability is "the
  number of solutions with a square assigned 0 divided by the total number of
  solutions found." The reported result is that the coupled-subsets CSP model
  "performs best overall because of its sophisticated probabilistic guessing and
  its ability to find deterministic moves."

### Mapping onto our joint

**This is not an analogy; it is the same problem.** Our conditioning ladder is a
constraint system over "which hidden unit is where":

| our rung | CSP form |
|---|---|
| **C0** occupancy / attribution set-arithmetic | a cardinality constraint per observed cell/region |
| **C1** item-vanish, sever geometry | a **disjunctive** constraint: *at least one* hidden unit was adjacent to the vanished item at that sub-step |
| **C2** sub-step non-event exclusion | a **negative joint** constraint: not both A and B were at this cell |
| the "canonical w that S itself induces" (cover counting) | **solution counting** over the constraint system |

Three things follow, and the first of them is the constructive answer to C26.

**M36 (answers C26). The `ConditioningTrace`'s missing representation is a
constraint store, and the literature says exactly what shape it should be.** C26
(domain 8) found that per-unit marginals cannot hold C1's disjunction or C2's
joint exclusion, so those rungs evaporate at storage. The Minesweeper CSP is the
built, benchmarked answer: keep the **constraints** (cardinality and disjunctive),
partition them into **coupled subsets** by shared variables, and derive marginals
by query rather than storing them as the state. Everything the belief lens wants
falls out:
  - sound deductions = forced variables (the design's "S takes only deductions",
    exactly);
  - the cloud/marginal = the query surface, computed on demand;
  - **the canonical weight = solution counting**, which is the belief lens's
    "cover-counting is the canonical w that S itself induces" generalised from a
    per-cell count to a model count over the whole constraint system.

**M37. Decomposition of the INFERENCE is sound; decomposition of the GAME is
not — and the two must not be conflated.** Coupled subsets are genuinely
independent because they share no variables, so solving them separately is exact.
That is a *different* claim from R-5/domain 12, where decomposing the *game*
under imperfect information is unsound because values depend on the range. This
distinction deserves a sentence in the design, because the same word
("decomposition") will otherwise carry a soundness guarantee from one place to a
place where it does not hold. Concretely: `ConditioningTrace` may be partitioned
into coupled subsets freely; `cluster-enum.ts` may not be partitioned on geometry
once positions are sets.

**M38. Solution counting gives the weight supplier a principled default that is
neither vacuous nor arbitrary.** The belief lens's supplier slate is
{adversarial, uniform, cover}. `adversarial` is vacuous (domain 3's C9 shows it
is the maximally dilation-prone member); `uniform` over what, exactly, is
undefined once the support is a constraint system. **Uniform over the solutions
of the constraint system** is well-defined, is the max-entropy weight induced by
S, and is what the Minesweeper solvers actually use. That is a supplier member
worth naming explicitly — and it is the one that makes the design's own claim
("cover-counting is the canonical w that S itself induces") literally true.

**C40. Solution counting is #P-hard, and the design must say how it approximates
it.** The honest caveat: counting models of a constraint system is hard in
general, which is why Minesweeper solvers only count within a coupled subset and
why large boards need approximation. Our clouds will produce constraint systems
too big to count exactly. Two standard answers — count exactly within small
coupled subsets and fall back to sampling on large ones, or use a
bounded-approximation counter — and the choice is a *member* of the weight
supplier, with a declared precision. That precision is exactly what the belief
lens's `advisoryPrecision` field is for, and it gives that field a first concrete
producer.

---

## 13.2 Part B — the candidate cap should be a progressive-widening schedule

### Sources

**S33. Coulom, *progressive widening* (2007, CrazyStone); Chaslot et al.,
*progressive unpruning* (2008); Couëtoux et al., *double progressive widening*
(2011).**

### What the experts decided

The number of children a node is allowed to expand grows with its visit count:

    |A(s)| = ⌊ c · N(s)^α ⌋

with `c` and `α` controlling the rate. The stated rationale: *"only after the
quality of the best available action is estimated sufficiently well are
additional actions taken into consideration."* Two independent groups arrived at
it at the same time (Coulom's widening and Chaslot's unpruning are the same
idea), and it "improved the level of Coulom's program CrazyStone significantly".

**Double** progressive widening applies the same schedule to *stochastic
successors*: `|Succ(a)| = ⌊ d · N(s,a)^β ⌋`, so a stochastic branch is also
sampled at a rate tied to how much it has been examined.

### Mapping onto our joint

**M39. This is the drop-in replacement for `sliderCandidateCap` that keeps the
cap's simplicity.** Domain 1's C2 said every serious restriction is adaptive on
value or carries a bound, and offered three replacements (best response,
per-variable bandit, portfolio scripts) — all of which are real work. Progressive
widening is a *fourth*, and it is the cheapest by a wide margin: it replaces a
constant with a function of how much work has been done. Its properties are
exactly the ones our design needs:
  - **It is natively anytime** — the admitted set grows with the allowance
    spent, which is the shape domain 1's C3 said an enumerate-then-cap stage
    lacks;
  - **it is monotone** — nothing already admitted is ever withdrawn, so it
    composes with the incumbent/interruptibility discipline (domain 2's C6);
  - **it needs no value model** — unlike best-response or bandit restriction, so
    it can ship before the performance profile (domain 2's C5) exists;
  - **the queen's ~71 options stop being cut to 4 forever** and instead become
    "4 at the first tranche, more as tranches are spent", which is exactly the
    behaviour the VALUE lens's measurement (94% discarded on the unit holding
    80–91% of team weight) says we want.

  Per ruling 49 it enters as a member with provenance: `c` and `α` are fitted
  constants, and the ordering `{fixed cap, progressive widening, per-variable
  bandit, best-response/double-oracle}` is a member collection for the ACTION
  joint's admission slot — the collection the composition lens's "no joint with
  one member" refusal wants.

**M40. Double progressive widening is the schedule for the potion window, and it
pairs with domain 11's C34.** Once B4 exposes the spawn *distribution* rather
than injecting a sampler (C34), the question becomes how many spawn outcomes to
branch on. DPW answers it with the same schedule shape applied to successors:
branch more on a stochastic outcome the more that action has been examined. Two
mechanisms, one formula, and it means the potion-window acceptance game does not
need an unbounded stochastic branching factor to pass.

**C41. Our cap is applied at generation; widening is applied at selection, and
the difference matters for the incumbent.** `sliderCandidateCap` truncates the
generated list before anything is priced. Progressive widening keeps the full
ordered list and *admits a prefix of it that grows*. That difference is what makes
widening monotone and interruption-safe: at any moment the admitted set is a
prefix, so stopping early yields a coherent restricted problem rather than a
truncated one. If we adopt widening, the generator must stop discarding — it must
produce the ordered list and let the schedule decide the prefix. That is a small
but real change to `cluster-enum.ts`'s contract, and it is the same change domain
1's C3 asked for from a different direction.

---

## 13.3 Verdicts the lens agents can act on

- **BELIEF (the constructive answer to C26):** the `ConditioningTrace` should be
  a **constraint store partitioned into coupled subsets**, with marginals as a
  derived query surface. That is the built, benchmarked shape for exactly our
  ladder — C0 is a cardinality constraint, C1 a disjunction, C2 a negative joint
  — and it makes the design's own claim about cover-counting literally true, via
  **solution counting**. Add "uniform over the constraint system's solutions" as
  a named weight-supplier member; it is the principled default the slate lacks.
  Declare how counting is approximated (exact within small coupled subsets,
  sampled above), and let that declaration be `advisoryPrecision`'s first
  concrete producer.
- **BELIEF / COMPOSITION:** state explicitly that decomposing the **inference**
  into coupled subsets is sound while decomposing the **game** on geometry is not
  (domain 12). One word, two soundness regimes; that is exactly the kind of
  silent premise crossing the refusal law exists to prevent.
- **SEARCH / COMPOSITION:** replace `sliderCandidateCap` with a **progressive
  widening schedule** `⌊c·N^α⌋`. It is the cheapest of the four principled
  replacements, needs no value model so it can ship before the performance
  profile, is natively anytime and monotone, and turns "4 forever" into "4 at the
  first tranche, more as tranches are spent". It requires the generator to stop
  discarding and instead expose an ordered list whose prefix the schedule picks.
- **SEARCH:** once B4 exposes the spawn distribution, use **double** progressive
  widening for the stochastic branch — same formula, applied to successors, and
  it keeps the potion-window acceptance game finite.
