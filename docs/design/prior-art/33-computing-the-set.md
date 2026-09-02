# PRIOR ART 33 — computing the set: R-4's missing engineering half

R-4 is this survey's strongest architectural conclusion: **REDUCTION must return a
set of options with the conditions under which each dominates, not a scalar** —
four unrelated fields converge on it (maximality, α-vectors with dominance
regions, fact/foil, and the Pareto front, the last with an impossibility theorem
attached).

It has had **no implementation story**, which is the obvious objection to it: a
set is more expensive than a number, sets can be large, and an anytime search
cannot afford to maintain one. This document is that missing half.

The short answer, and it is better than I expected: **the set is provably small in
our regime, the dominance-region test is one LP per candidate, two literatures
have independently built the pruning algorithm, and when the set does blow up
there is a theorem guaranteeing a polynomially-sized approximation with a stated
error bound.**

---

## 33.1 How big is the set? Provably small, in the regime we are in

**S58. Bentley, Kung, Schkolnick & Thompson, "On the average number of maxima in a
set of vectors and applications", *JACM* 25(4) (1978).**

A *maximal vector* is one not dominated in all components. Under **component
independence** (each vector's components independently distributed, all `(n!)^d`
relative orderings equally likely), the expected number of maxima among `n`
vectors in `d` dimensions is

    E[|maxima|]  =  H_{d−1, n}  ≈  (ln n)^{d−1} / (d−1)!

— **O((ln n)^{d−1})** for fixed `d`, i.e. **polylogarithmic in the number of
options and factorially damped in the number of objectives.**

Put our numbers in. A queen with **~71 options** (`ln 71 ≈ 4.26`):

| objectives `d` | expected non-dominated set |
|---|---|
| 2 | ≈ 4.3 |
| 3 | ≈ 9.1 |
| 4 | ≈ 12.9 |
| 5 | ≈ 13.7 |

And for a trail unit with 3 options the question does not arise. **At the VALUE
lens's three flows, the expected maximal set out of a queen's 71 options is about
nine.** The "a set is too expensive" objection is quantitatively wrong in our
regime, and it is wrong for a *structural* reason: the set is small exactly when
the objectives are few, which is the state the currency work is driving toward.

**The honest counterweight, and it is the important half.** The Bentley–Kung
bound assumes **component independence**. Skyline cardinality is known to blow up
under **anti-correlated** objectives — and anti-correlation is precisely what a
real trade-off *is*. Our objectives are plausibly anti-correlated (territory vs
material; safety vs gain; the trade-safety cliff exists because two things pull
opposite ways). So `O((ln n)^{d−1})` is the **best case**, not the typical one,
and the design needs the bounded-size machinery below rather than relying on the
average.

---

## 33.2 When the set does blow up, a polynomially-sized approximation always
exists — with a bound

**S59. Papadimitriou & Yannakakis, "On the approximability of trade-offs and
optimal access of web sources", FOCS 2000.**

Their theorem: **for every ε > 0 there is an ε-approximate Pareto set of size
polynomial in the instance size and in 1/ε** — a set of feasible solutions such
that for *every* feasible solution there is a member of the set within a factor
(1+ε) on every objective. *"There is always a set of solutions of polynomial size
that are approximately undominated, within arbitrary precision."*

This is the piece that makes R-4 shippable, and note what kind of statement it is:
it is **R-3 satisfied for the reduction's output**. R-3 says every restriction of
the option set must be adaptive on value or **carry a bound on what it removed**.
An ε-approximate Pareto set is a restriction that carries exactly that bound, by
construction, with ε as the dial. So the reduction's output is not "a set of
unbounded size" — it is **a set whose size is chosen and whose loss is stated**,
which is the same discipline the bounds bank already applies to values.

Practical form: **ε-dominance grid pruning.** Discretise each objective on a
logarithmic grid of ratio (1+ε) and keep at most one representative per cell.
That is O(1) per candidate, needs no LP, bounds the set size by the grid, and
guarantees the (1+ε) approximation. It is the cheapest member of the family and
it should be the default.

---

## 33.3 The dominance-condition test is one LP, and two fields have built the
same pruner

R-4 does not ask only for the *set* — it asks for **the conditions under which
each member dominates**, which is the part that makes it a Centaur surface and a
contrastive explanation. That is exactly the POMDP α-vector problem, and its
standard machinery transfers directly.

**S60. Lark's algorithm and incremental pruning** (Cassandra, Littman & Zhang);
**S61. Raphael & Shani, "The Skyline algorithm for POMDP value function pruning",
Annals of Mathematics and AI (2012)** — which is itself the convergence: the
database skyline literature and the POMDP pruning literature building the same
algorithm.

The load-bearing definition: **a vector α is USEFUL if there is a non-empty
region R(α, V) over which it dominates all other vectors, and the existence of
such a region is determined by a linear program.** So:

- **the dominance region is the LP's feasible set** — not an extra computation,
  the *witness* the pruning LP already produces;
- **the LP's solution is the contrastive explanation** — "α wins here, and here is
  a point where it beats the runner-up" is exactly Miller's (fact, foil, condition)
  triple (domain 10), produced as a by-product of deciding whether to keep α.

**Cost, honestly.** Lark's algorithm is *"expensive when there is a large number
of vectors"* — one LP per input vector. Two mitigations the literature supplies
and both apply here:
  1. **Cheap pre-filters first.** Pointwise dominance removes most candidates in
     O(nd) with no LP; Troffaes's ordering (domain 3) says the same thing in the
     imprecise-probability vocabulary — **interval dominance costs 2n natural
     extensions against maximality's n²−n, and is sound as a pre-filter because
     every maximal decision is interval-dominant.** So the pipeline is: pointwise
     dominance → interval dominance → LP only on the survivors. With ~9 expected
     survivors of 71 (§33.1), the LP stage is small.
  2. **Incremental pruning** maintains the set across successive refinements
     rather than recomputing it — which is what an anytime search needs, and is
     the reason the POMDP community built it.

---

## 33.4 The anytime story, which is the one our economy needs

Our reduction runs under an allowance, so the set must be *maintainable*, not just
computable. Three properties, all supplied:

- **Monotone shrinking under refinement.** As bounds tighten, options leave the
  non-dominated set and never re-enter (tightening cannot un-dominate). So the set
  is an **incumbent that only improves**, which is exactly the interruptibility
  witness domain 2's C6 requires — and unlike a scalar argmax, an interrupted
  set-reduction returns a *sound* answer (a superset of the true maximal set)
  rather than a possibly-wrong pick.
- **The natural spend target falls out.** Domain 2's C8 asked for
  `P(refinement flips better())` and could not compute it; in the set formulation
  the analogous quantity is direct: **spend on the pair whose dominance is closest
  to being decided** — the LP's slack at the tightest constraint. That is the
  value-of-computation quantity Russell & Wefald asked for, in a form the reduction
  itself produces.
- **The set size is the legibility budget.** Domain 10's M27 (complete internally,
  selected externally) needs a rule for how much to show a human; ε is that rule,
  and it comes with a guarantee about what was left out.

---

## 33.5 What this changes about R-4

R-4 was argued on four independent grounds and was open to one objection: cost.
The objection does not survive:

| objection | answer |
|---|---|
| "a set is unboundedly large" | expected size `O((ln n)^{d−1})` under independence — ~9 of 71 at three objectives (§33.1) |
| "…but real objectives are anti-correlated" | true, and then the ε-approximate Pareto set is **polynomial in 1/ε with a stated bound** (§33.2) — R-3 satisfied by construction |
| "computing dominance conditions is expensive" | it is the pruning LP's own witness, after two cheap pre-filters that remove most candidates (§33.3) |
| "an anytime search cannot maintain it" | the set shrinks monotonically under refinement, so it is a sound incumbent — *better* interruptibility than a scalar argmax (§33.4) |
| "we have no rule for how much to show" | ε, with a guarantee about what was omitted (§33.4) |

And one thing this makes visible that the four earlier arguments did not: **the
set formulation is strictly better-behaved under interruption than the scalar
one.** A scalar reduction interrupted early returns a pick that may be wrong. A
set reduction interrupted early returns a superset of the truth — sound, with the
loss stated. For a design whose central commitment is anytime interruptibility,
that is not a cost of R-4; it is an argument for it.

---

## 33.6 Verdicts

- **COMPOSITION / REDUCTION:** R-4's cost objection is answered. Expected
  non-dominated set size is **`O((ln n)^{d−1})`** — about **nine of a queen's
  seventy-one options at three objectives** — and where anti-correlation blows
  that up, **Papadimitriou–Yannakakis guarantees a polynomially-sized
  ε-approximate Pareto set with a stated bound**, which is R-3 satisfied for the
  reduction's *output* rather than its input. Default implementation:
  **ε-dominance grid pruning**, O(1) per candidate, no LP.
- **COMPOSITION / SEARCH:** the **dominance conditions are free** — they are the
  pruning LP's own witness, and that LP is the standard POMDP α-vector usefulness
  test. Pipeline: pointwise dominance → **interval dominance** (2n vs maximality's
  n²−n, and sound as a pre-filter because every maximal decision is
  interval-dominant) → LP on the survivors only.
- **TIME:** the set formulation is **better** under interruption than a scalar
  argmax — it shrinks monotonically under refinement, so an interrupted reduction
  returns a *sound superset* rather than a possibly-wrong pick. And it supplies the
  spend target C8 asked for and could not compute: **the pair whose dominance is
  closest to decided, measured by the LP's slack.**
- **VALUE + BELIEF (the joint reading):** with domain 32's result — the currency is
  accounting, the combination law is the policy lever — and this one, the shape of
  the VALUE joint is now fully specified: **flows in a common currency (accounting,
  near-definitional) → a non-dominated set with dominance regions (computable, ~9
  members, ε-bounded) → a combination law chosen from a member collection with a
  reachability theorem per member (the policy lever).** Three layers, each with its
  own literature, and the scalar collapse happens only at the last one and only if
  a member that collapses is selected.
