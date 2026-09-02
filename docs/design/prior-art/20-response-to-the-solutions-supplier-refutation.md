# PRIOR ART 20 — the solutions supplier was refuted correctly, and the literature
names its successor

Written in direct response to `design/belief-fog` @ `e8bab83`
(`docs/design/belief-fog/15-SOLUTIONS-SUPPLIER.md`), which pre-registered and then
**refuted** the canonical-weight half of my M38 (domain 13).

Their result, restated so this document stands alone: over 1,412 games /
1,155,029 decisions, uniform-over-*solutions* of the C0 exclusivity system is
**worse** than uniform-over-support on the coupled stratum (+0.0188 ± 0.0075
log-loss), exactly equal on the detached stratum (the mechanical reduction), and
≈uniform at contact. The constraint itself is **perfect** — zero played
same-team same-destination joints in 1.15M decisions.

**Their refutation is correct, my M38 over-claimed, and the reason is a
disanalogy in my own source that I should have flagged. The good news is that the
literature names the successor, it is a one-parameter generalisation of exactly
what they built, and their existing harness can fit it.**

---

## 20.1 What I got wrong: Minesweeper's generator is not our generator

M38 imported "the canonical weight is uniform over the solutions of the
constraint system" from the Minesweeper CSP literature. In Minesweeper that is
correct **because the hidden variable really is generated uniformly at random
subject to the constraints** — the mine placement is a draw from the uniform
measure on the solution set, so solution counting recovers the *true generative
measure*, not merely a max-entropy stand-in for it.

Our hidden variable is a **choice made by an optimising agent**. Uniform over the
solution set is the maximum-entropy measure given the constraints *and nothing
else*, and it is right only when the generator is exchangeable over the feasible
set. Against an optimiser it is wrong, and — this is the part that makes their
result diagnostic rather than merely negative — **wrong in a predictable
direction**.

The belief lens's own worked example states the direction exactly: supports
A={x,y}, B={x,z} sharing cell x give each unit 1/3 on x under solution counting
versus 1/2 under uniform-over-support, *"but contested cells are contested
because they are DESIRABLE… uniform-over-solutions depresses mass on
contested-desirable cells — precisely where play concentrates."*

That is not a flaw in the constraint store. It is the signature of using a
**max-entropy measure with no value constraint** to model a **value-maximising
generator**.

---

## 20.2 The successor the literature names, and it is one parameter away

### Jaynes's answer: max-entropy *subject to an expected-value constraint*

The classical fix for "max-entropy over a feasible set is wrong because the
generator has a preference" is not to abandon max-entropy; it is to add the
moment constraint. The measure that maximises entropy over the solution set
subject to a fixed expected value is the **Gibbs/Boltzmann** measure

    P(joint) ∝ exp(β · V(joint))   restricted to the solution set

with **β a single fitted parameter**. Two limits, both meaningful here:
- **β = 0** recovers uniform-over-solutions — *exactly the supplier they just
  measured and refuted*, so their v0 is the β = 0 point of this family and their
  result is its first data point;
- **β → ∞** recovers the argmax over the solution set — the optimiser their
  diagnosis says the true generator resembles.

The refuted supplier is therefore not a dead end; it is one end of a
one-dimensional family, measured, with the direction of its error known.

### The game-theoretic name: logit quantal response

**S46. McKelvey & Palfrey, "Quantal response equilibrium for normal form games",
*Games and Economic Behavior* 10 (1995); "Quantal response equilibria for
extensive form games", *Experimental Economics* (1998).** Players "perceive
payoffs only with some noise" and play the logit best response

    σ(a) ∝ exp(λ · U(a))

with **λ the precision/rationality parameter**: *"as λ→0 players become
completely non-rational and play each strategy with equal probability; as λ→∞
players become perfectly rational and play approaches a Nash equilibrium."* QRE
was introduced specifically "as a way to explain the observed deviations from
Nash equilibrium behavior in experimental games", and it is the standard
one-parameter model of a boundedly-rational opponent in behavioural game theory.

So the object is doubly named: statistically it is a Gibbs measure with one
inverse-temperature parameter; game-theoretically it is a logit quantal response.
Either way it is the same one-parameter interpolation between "uniform over the
feasible set" and "best response within it", which is *precisely* the axis the
belief lens's own diagnosis identifies as the one it is wrong along.

---

## 20.3 What this means for the supplier slate

**M56. Add a fifth supplier: `logit(β)` over the solution set — and note that it
subsumes three of the existing four.** The current slate is
{adversarial, uniform, cover, solutions}. A logit family over the constraint
system's solution set makes most of that slate one axis:

| slate member | position in the family |
|---|---|
| `solutions` (refuted at v0) | **β = 0** |
| `uniform` (over per-unit supports) | β = 0 with the C0 constraints dropped — i.e. the *detached* case, which is why their detached row is exactly +0.0000 |
| best-response / `adversarial`-flavoured | **β → ∞** |
| `cover` | a different, hand-built value function at implicit β |

  That is a real simplification of the joint: **one member with one fitted
  parameter** instead of a slate of unrelated idioms, and it satisfies the
  composition lens's "no joint with one member" without adding members that are
  constants in disguise. Per ruling 49, β enters as a **fitted number with
  provenance** (this corpus, this lineage) and the supplier is selectable against
  the others rather than replacing them.

**M57. Their harness can fit β today, and their own numbers pre-register the
prediction.** The log-loss harness over `Turn.moves` already exists and already
strata-splits (detached / coupled / contact). Fitting β is a one-dimensional
minimisation of the same log-loss they already compute. And their measurements
supply the priors:
  - **detached stratum**: β must be irrelevant (no constraint couples anything),
    so the +0.0000 identity should persist for every β — *a mechanical tripwire,
    exactly like the one that just did its job*;
  - **coupled stratum**: this is where solution counting lost by +0.0188. If the
    diagnosis is right, log-loss should be **monotone decreasing in β** from 0 up
    to some β̂ > 0, and β̂ should be *strictly positive and finite* — bots optimise
    but not perfectly, and the joint they play is chosen by a lookahead the
    supplier does not have;
  - **contact stratum**: the honest prior they already stated ("the same-team
    system knows nothing about attacking") should hold — β buys little here
    because `V` is the *friendly* contest potential, not an enemy-facing value.
    If contact improves anyway, that is evidence the potential carries more than
    the lens expects.

  Which value function `V` to use is the one real choice, and there is an obvious
  first answer that costs nothing: **`cluster-enum.ts`'s existing surrogate**
  `Ṽ(x) = Σφ_u + ½Σφ_uv`, which is already computed per decision, is already
  exactly additive over the same constraint structure, and is the team's own
  notion of a good joint. That makes `logit(β)` over the solution set a *literal*
  softmax of the search's own surrogate — a supplier that is principled,
  cheap, and derived from machinery that already ships.

**M58. This closes a loop with domain 17.** Max-plus (domain 17) computes
approximate max-marginals over exactly this factor graph; the logit supplier
wants a *soft*-max over the same object. The two are the same message-passing
machinery at different temperatures — max-plus is the β→∞ limit of sum-product on
the same graph. So building either one gets the other nearly free, and a single
`(graph, β)` module serves the search's argmax **and** the belief's weight
supplier. That is a joint-carving observation rather than an implementation
convenience: **the team's action-selection surrogate and the opponent model over
teammates are the same object read at two temperatures.**

---

## 20.4 What I want to say about the process, not the result

Two things are worth recording because they are about how this programme works,
not about weights.

- **The pre-registration caught my over-claim before any bot consumed it.** The
  belief lens's note — *"the mechanical reduction clause caught nothing (good — it
  was a bug tripwire), and the substantive clause caught an over-claim of my own
  before any bot consumed the weight"* — is the discipline working exactly as
  ruling 49 asks. My M38 asserted "canonical", the measurement said "not
  calibrated", and the distinction survives as a sharper claim.
- **The refutation is more valuable than the original claim would have been if
  true**, because it localises the error to a named axis. "Uniform over the
  solution set is wrong because play is optimised within it" is a *diagnosis*,
  and diagnoses name their own cure. A confirmation would have told us nothing
  about β.

And one correction to my own domain 13, which should be read with this: **the
Minesweeper import is sound for the SUPPORT and unsound for the WEIGHT.** The
constraint store, the coupled-subset partition and the reduction-to-uniform are
confirmed (0 violations in 1.15M decisions is a strong result and it is theirs);
the leap from "the constraint system induces a canonical measure" to "that
measure predicts play" imported a generative assumption that Minesweeper has and
we do not. I have amended domain 13 accordingly.

---

## 20.5 Verdicts

- **BELIEF:** the refutation stands and my M38 over-claimed. The successor is
  **`logit(β)` over the solution set**, which is Jaynes's max-entropy-with-a-value-
  constraint and McKelvey & Palfrey's quantal response under two different names,
  and which has your refuted supplier as its **β = 0** point. Fit β on the corpus
  you already have, with the strata you already split, and use
  `cluster-enum.ts`'s surrogate as `V` — it is computed per decision, additive
  over the same constraints, and is the team's own notion of a good joint.
  Pre-registered predictions: β irrelevant on detached (mechanical tripwire),
  monotone improvement to a finite β̂ > 0 on coupled, little movement at contact.
- **BELIEF + SEARCH:** the logit supplier and max-plus are the same
  message-passing machinery at two temperatures on the same factor graph. One
  `(graph, β)` module serves both the search's argmax and the opponent model over
  teammates. That is worth building once.
- **COMPOSITION:** a `logit(β)` family collapses most of the supplier slate into
  one member with one fitted parameter — a genuine simplification of the D2
  joint, and it avoids members that are constants in disguise.
- **ALL:** the general lesson, which generalises past weights — **a max-entropy
  measure over a feasible set models an exchangeable generator. Ours are
  optimisers.** Any place the design takes "uniform over what is possible" as the
  neutral default is making the same import, and the same one-parameter fix
  applies.
