# PRIOR ART 34 — index policies: the hypothesis market's missing algorithm

The TIME lens's **hypothesis market** — "which conditional frontier earns the next
tranche" — is specified as a policy but has no algorithm. It is currently a
ranking problem with an open scoring rule, and domain 2's C8 established what the
score *should* contain (`P(hypothesis becomes fact) × P(refinement flips the
choice)`) without saying how to combine those into a decision.

There is a literature whose entire subject is that decision, and its central
result is unusually strong: **for the clean version of the problem the optimal
policy is an INDEX policy — one number per alternative, computable from that
alternative alone, act greedily on it.** This document maps it, and is careful
about where our problem leaves the regime in which the result holds, because it
leaves it in three places.

---

## 34.1 Weitzman's Pandora's box, and why the result is surprising

**S62. Weitzman, "Optimal search for the best alternative", *Econometrica* 47
(1979).** Also Beyhaghi & Cai, *Recent developments in Pandora's box problem*
(SIGecom Exchanges 21, 2023) for the modern variants.

The problem: `n` locked boxes; box `i` contains a value drawn from a known
distribution; opening it costs `c_i` and reveals the value. At each step, either
open another box or stop and take the best value already revealed. Maximise
E[selected value − costs paid].

**The theorem.** The optimal policy is an **index policy**. Each box has a
**reservation value** `σ_i` defined by

    E[ max(x_i − σ_i, 0) ]  =  c_i

— *the value at which the expected gain from opening exactly equals the cost of
opening.* Then: **open boxes in decreasing order of `σ_i`; stop as soon as the
best value in hand weakly exceeds the largest `σ` among unopened boxes.**

The surprising part, and the part that would matter to us: **`σ_i` depends only on
box `i`'s own distribution and cost.** It is independent of the values already
observed and of which other boxes remain. A globally optimal sequential policy
decomposes into per-alternative numbers computed in isolation. (Later recognised
as a special case of the **Gittins index** for Bayesian bandits.)

---

## 34.2 The mapping, and the three places our problem leaves the regime

**What transfers cleanly: the index's FORM, and what it needs.** A hypothesis's
index is *"the decision quality at which the expected improvement from spending a
tranche on this hypothesis equals the tranche's cost."* Every term in that
sentence is now available:

- **the expected improvement from a tranche** is exactly what the **conditional
  performance profile** supplies (domain 2's C5, now compiled) — `Pr(quality |
  quanta, premise)` is the distribution the expectation is taken over;
- **the tranche's cost** is the allowance ledger's own unit;
- **the "stop" condition** — best-in-hand ≥ largest remaining index — is the
  economy's missing stopping rule, and it is the same shape as Hansen &
  Zilberstein's (domain 2) but computed per-hypothesis rather than globally.

**So the CPP plus Weitzman gives the market its first actual algorithm**, and the
two pieces were built independently: the lens built the profile because I said
the economy had no goods; the index is what turns goods into a policy.

**Where it breaks — three places, all real, and I want them stated before anyone
implements the index as though it were optimal.**

1. **Repeated inspection.** Pandora opens each box *once* and learns its value
   fully. We spend *tranches*, and a hypothesis can be refined repeatedly with
   diminishing returns. That is not Pandora; it is a **Gittins bandit**, where the
   index still exists and is still optimal *for independent arms under
   discounting*, but must be recomputed as an arm's state advances. Practically:
   the index is a function of `(hypothesis, quanta already spent on it)`, which
   the CPP already conditions on.

2. **Correlated boxes.** Weitzman assumes independence; our hypotheses are
   strongly correlated (refining under "the enemy pins the queen" informs "the
   enemy pins the rook"). Correlation is the known hard case — there is recent
   work (Gergatsouli & Tzamos, *Weitzman's rule with correlations*, NeurIPS 2023)
   giving approximation guarantees rather than optimality. **Expect the index to
   be a good heuristic with a known bias: it over-values the second of two
   correlated hypotheses**, because their information overlaps and the index
   prices each in isolation. That is a *specific, testable* bias, and the obvious
   mitigation is the obvious one — discount an index by its overlap with what has
   already been spent, which is a read-set intersection the declaration record can
   already compute.

3. **Non-obligatory inspection makes it hard, and our reaction table creates
   exactly that.** The variant where you may *select a box without opening it* has
   no simple index and is provably harder (Beyhaghi & Kleinberg; approximation
   schemes rather than exact policies). **That variant is ours**: "conform now" in
   the reaction table is committing to a plan without refining it. So the honest
   statement is that our problem is the hard variant, and the index is an
   approximation whose quality degrades precisely as the conform-now option
   becomes attractive — i.e. **near the deadline**, which is when the market
   matters most.

**Reading those three together:** an index policy is the right *shape* — one
number per hypothesis, computed locally, acted on greedily — and it should be
adopted, because the alternative is an unprincipled ranking. But it should be
adopted as a **member with a known failure direction** (over-values correlated
hypotheses; degrades near the deadline) rather than as an optimal rule. That is
exactly ruling 49's form for a fitted or derived thing.

---

## 34.3 What this changes about C8, and about the reaction table

**M81. C8's two factors become one index, and the missing piece was the cost
side.** Domain 2's C8 asked for `P(hypothesis becomes fact) × P(refinement flips
`better()`)` and could not say how to act on it. Weitzman's structure says: those
two probabilities describe the *payoff distribution* of a box; the index is
computed by equating that distribution's expected gain to the *cost*, and the cost
is the tranche. So C8's product is not the score — **it is an input to the score**,
and the score also needs the tranche's price. That is a small correction with a
practical consequence: **a hypothesis with a high flip probability but an
expensive frontier can rank below a cheaper one with a lower flip probability**,
which the product formulation cannot express.

**M82. The stopping rule falls out, and it is not the one the design has.** The
reaction table currently decides *when to react* by the *source* of a
determination (operator commit / turn resolution / dial change). Weitzman's
stopping rule decides when to *stop spending* by comparing best-in-hand against
the largest remaining index. These are different questions and both are needed,
but the second is absent: **the design has no principled answer to "stop
refining, the remaining hypotheses are not worth their tranches"** other than the
deadline. Adding it is nearly free once the indices exist, and it is what would
let the economy return unspent allowance to the next turn's ponder rather than
burning it — which is the "fund ponder" conclusion, arrived at as a decision
rather than as an observation about a saturating profile.

**M83. Index policies have a general design property worth naming.** The reason
Gittins and Weitzman are celebrated is *decomposition*: a globally optimal
sequential policy reduces to per-alternative numbers computed in isolation. That
is the same shape as domain 2's local compilation (optimal on trees) and domain
17's variable elimination (exact on low-width graphs) — **three separate
"the global optimum decomposes into local computations, under stated conditions"
results, in three different literatures, all bearing on the ECONOMY and ACTION
joints.** The recurring lesson across all three is the same and it is worth
stating once: *the decomposition is optimal only under a hypothesis, the
hypothesis is checkable, and the failure is graceful but real when it does not
hold.* R-6 (assert the hypothesis) applies to all three.

---

## 34.4 Verdicts

- **TIME (the market's missing algorithm):** adopt an **index policy**. A
  hypothesis's index is *the decision quality at which the expected improvement
  from one tranche equals the tranche's cost* — and every term is now available,
  because the CPP supplies the improvement distribution and the ledger supplies
  the cost. Spend on the highest index; **stop when the best in hand exceeds the
  largest remaining index**, which is the stopping rule the economy lacks.
- **TIME (adopt it as a member with a known failure direction, not as optimal):**
  our problem leaves Weitzman's regime in three places — repeated inspection
  (which makes it Gittins rather than Pandora, and is handled by conditioning the
  index on quanta already spent), **correlation** (the index over-values the second
  of two correlated hypotheses; mitigate by discounting for read-set overlap,
  which the declaration record can compute), and **non-obligatory inspection**
  (the "conform now" row makes ours the provably harder variant, and the index
  degrades exactly near the deadline, which is when the market matters most).
- **TIME (correction to C8):** the two probabilities are the *payoff
  distribution*, not the score. The score also needs the **tranche's price**, and
  the practical consequence is that an expensive high-flip-probability hypothesis
  can correctly rank below a cheap low-flip one — which the product formulation
  cannot express.
- **ALL:** this is the **third** "the global optimum decomposes into local
  computations, under a stated hypothesis" result the survey has found bearing on
  the same two joints (with Zilberstein's local compilation and variable
  elimination). The shared lesson: the decomposition is optimal only under a
  checkable hypothesis, and R-6 says assert it.
