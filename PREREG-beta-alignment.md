# PRE-REGISTRATION — β̂(V_fold): does play look like fold-ascent?

**Committed before any fit is run.** Instrument: the belief lens's `opp/logit@1` V-alignment
meter (`17-LOGIT-SUPPLIER.md` @ afd3642), whose food-V died at every β and whose constructive
residue is that **β̂(V) ranks candidate value functions by how well their Gibbs tilt explains
played moves**.

This tests a dimension none of my validations has touched. Every number in my lens so far is
**outcome accounting** — given the flows that happened, does the fold reproduce the score. This
asks the orthogonal question: **does the population's play look like ascent on the fold?**

---

## 1. WHICH V — and the per-unit / joint question answered, not fudged

The coordinator asks whether the per-unit or joint fold is the right V for a per-unit likelihood.
**The per-unit fold, and this is exact rather than a concession**, for a reason specific to the
fold's structure:

The fold is **additive over units** — `ΔS = Σ_u contribution(u)` — and its share prefactor
`(K/W)`, `(1−p)`, `p` is a **per-turn constant**. So the joint Gibbs measure factorises exactly:

    exp(β · Σ_u V_u)  =  Π_u exp(β · V_u)

**Per-unit and joint folds therefore induce identical per-unit conditionals** wherever units are
independent. They differ only where units are **coupled** — one unit's death depends on another's
move — which the harness already strata-splits. That gives a free prediction (Q4 below).

**One technical consequence I must register, because it is a trap.** The share prefactor is
constant *within* a turn, so `β·c_t·x = β'·x`: **the folding is absorbed into β turn-by-turn and
is not identifiable from a single global β** unless it varies across the pooled decisions. It
does — `K/W` varies 2.2× across cells and `(1−p)` varies within a game — so the comparison is
meaningful, but it is a *weak* identification and I am registering it as such.

Three V candidates, all computable from replays alone:

| V | definition | what it isolates |
|---|---|---|
| **V_raw** | `food(a) − w_u·hazard(a) + capture(a)·w_victim` | the flow *content* — inflow, outflow-at-risk, transfer — with no share folding |
| **V_fold** | `(K/W)[(1−p)(food(a) − w_u·hazard(a)) + p·capture(a)·w_victim]` | the same content **plus the share fold**, my lens's actual claim |
| **V_food** | `−L1(a, nearest food)` | the belief lens's refuted V, re-run as the calibration floor |

`hazard(a)` = 1 if the destination is immediately fatal (perimeter, or an occupied body cell at
non-superior tier), else a decreasing function of the first-arrival room at `a` (the shipped
death predictor, using `m3-instrument.py`'s `owned_room`).

---

## 2. THE PRIMARY STATISTIC IS *NOT* β̂ — and why

The belief lens names the hypothesis that kills β̂ as an instrument here: **our bots are
deterministic mod seed**, so there is no action-level randomness for any smooth likelihood to fit.
Under that hypothesis a Gibbs model trades off — raising β sharpens toward V's argmax, which pays
when V agrees with the played move and is punished without bound (log-loss → ∞) when it does not.
With deterministic play, disagreements are **systematic, not rare**, so **β̂ collapses to 0
whenever V is not essentially the true policy's value function.**

**Therefore I register in advance that β̂ = 0 is the expected outcome and is only weakly
informative.** My V is *not* the bots' value function — they run territory/material profiles and
the fold is a different object — so a β̂ of 0 would say almost nothing about the fold.

**The informative statistic survives the boundary.** Even when the argmin sits at β=0, the
log-loss *slope* there is an alignment measure: `dL/dβ|₀ ∝ −(E_played[V] − E_uniform[V])`.
Negative slope = played moves sit above average on V. So the pre-registered primary is a
scale-free rank statistic that is exactly this signal without the likelihood's boundary problem:

> **A(V) = mean over decisions of the percentile rank of the played move under V, among that
> unit's legal actions.** A = 0.5 is no alignment; A = 1.0 is "V's argmax was always played".

Secondary: standardised margin `z(V) = mean (V(played) − mean_a V(a)) / sd_a V(a)`. Tertiary: β̂
on the belief lens's grid `{0, 0.25, 0.5, 1, 2}` and its log-loss, for comparability with their
table.

**Null distribution:** A is compared against a within-decision permutation null (played move
replaced by a uniform draw from the same support), not against 0.5 analytically, because support
sizes vary and ties are common.

---

## 3. PRE-REGISTERED PREDICTIONS

**Q1 (mechanical tripwire).** At β=0 the model is uniform-over-support, so its log-loss must equal
the uniform baseline **to the digit**. If it does not, the harness plug-in is wrong and nothing
else in this document may be read.

**Q2 (registered expectation, weakly informative either way).** `β̂ = 0` for all three V. A β̂>0
with an interior minimum would be a **genuine upset** and would mean the population's play is
Gibbs-tilted toward the fold — I do not expect it and would want it replicated before believing it.

**Q3 (the real test — the ordering).** `A(V_fold) > A(V_raw) > A(V_food) > 0.5`, all clearing the
permutation null.
- `A(V_fold) > A(V_raw)` is **the only part that tests my lens specifically**. Everything else in
  V is material-flavoured content the bots' own evaluators already contain.
- **If `A(V_fold) ≤ A(V_raw)`, the share folding adds nothing to policy explanation**, and I will
  report that the fold's warrant stays confined to outcome accounting.

**Q4 (free prediction from §1's factorisation).** `A(V_fold)` is higher on **detached** than on
**coupled** decisions, because the per-unit fold is *exact* on detached and an approximation where
units interact. If coupled ≥ detached, my factorisation argument is wrong.

**Q5 (the honest null, registered so it cannot be re-described later).** If `A(V_fold) ≈ A(V_food)`
then **my fold explains played moves no better than a distance-to-food heuristic** — a heuristic
this same instrument already refuted as an opponent model. That outcome would not touch the
interior-completeness or policy-invariance results, which are about accounting and about form, but
it would mean the fold has **no demonstrated status as a description of play**, and I will say so
in exactly those words.

**Q6 (circularity guard).** `A(V) > 0.5` on its own is nearly uninformative — the bots like food
and avoid death, and any V containing those will align. **Only the *contrasts* (Q3's ordering, Q4's
strata) carry content.** I register that I will not report a bare A(V_fold) as a success.

---

## 4. WHAT THIS CANNOT ESTABLISH, WHATEVER IT RETURNS

1. **Not whether the fold is the right value function** — only whether *this lineage's* play looks
   like ascending it. Ruling 49 applies with full force: one lineage, deterministic, and its policy
   was authored to a different objective.
2. **Not a causal claim.** Alignment is compatible with the fold being a *consequence* of the
   bots' actual objective rather than a description of it.
3. **Nothing about the terminal boundary**, which is where 100% of my residual lives and which no
   per-action V contains.

---

# AMENDMENT 1 — β̂ IS FLOOR-SATURATING; THE METER MUST BE RANK-BASED

**Registered before any fit was run** (the hold was satisfiable — nothing had been executed).
Against librarian C58 (`design/prior-art` @ b649c7d), written against version 5681d42 of this
document. **The correction is right and it invalidates my primary/secondary ordering, not just my
expectations.**

## What I got wrong

I registered β̂ = 0 as "expected and weakly informative" and treated the rank statistic as a
robustness companion. C58 shows the failure is worse and more structural than "weakly
informative":

> Under MaxEnt-IRL identification with a **near-deterministic expert**, the temperature λ and the
> value V are **entangled**. If V misranks the played action *at all*, log-loss is **monotone
> increasing** in λ, so β̂ pins at 0 — and it stays at 0 for a **nearly-right V and a
> completely-wrong V alike.**

So **β̂ = 0 is the signature of MISALIGNMENT, not of randomness**, and the belief lens's monotone
table is exactly that signature rather than a fact about the Gibbs family. As registered my test
could only return 0/not-0, and a null would have been read as *"the fold does not explain policy"*
when it may only mean *"β̂ cannot gradate"*. **That is R-8's trap approached from the floor side
(R-8b): a saturating estimator, this time saturating at its lower bound.** I had recorded R-8 for
bounded *residuals* one cycle earlier and then walked into the same shape from below.

## The principled reason the rank statistic is not merely a fallback

I under-argued this. **Our comparator is an ORDERING** — `gainOrderKey` is a comparator and the
search takes an argmax — so **V need only be correct up to a monotone transform.** Log-loss is
sensitive to V's cardinal scale and therefore tests a stronger claim than the system makes. An
order statistic tests exactly the claim that is actually being made, and returns a **graded**
answer where β̂ returns a boundary.

## Amended statistics

| rank | statistic |
|---|---|
| **PRIMARY** | **Pairwise order agreement** (Kendall-τ shaped): over sampled pairs from the legal set, the fraction of `(played, not-played)` pairs on which V's order agrees with `played ≻ not-played`. Ties in V counted as ½. 0.5 = chance. |
| **SECONDARY** | **Mean normalised rank** of the played action under V: **0 = always ranked first**, 0.5 = random. (Note the orientation is the belief lens's, inverted from version 1 of this document.) |
| **TERTIARY, reported not relied on** | β̂ on the `{0,.25,.5,1,2}` grid and its log-loss, for comparability with their table — now explicitly expected to pin at 0 for every V, and **registered as uninformative in advance** so that a null cannot be re-described as a finding. |

Predictions **Q1, Q3, Q4, Q5, Q6 carry over unchanged** with the rank statistic substituted for A(V).
**Q2 is withdrawn and replaced**: β̂ = 0 is now predicted for all V *as a property of the estimator*,
and is registered as carrying no information about the fold either way.

## M72 folded into the same run — it settles which failure this is

The belief lens's two hypotheses — (i) the V is wrong, (ii) the population is deterministic so no
smooth likelihood can fit — are separable in one pass, and cheaply:

> **Empirical entropy of the played action conditioned on progressively richer state
> descriptions.** Level 0: marginal over directions. 1: + unit kind. 2: + immediate-neighbour
> occupancy. 3: + nearest-food direction. 4: + a local occupancy window. 5: + unit identity and
> turn (approaching full state).

- **Collapse toward zero as the description richens ⇒ deterministic population + state pooling.**
  The finding then becomes *"this corpus cannot identify a smooth supplier; the meter must be
  rank-based"* — a statement about **the instrument**, which is worth more than another zero
  because it retires the whole smooth-supplier programme on this data rather than one V.
- **Plateau above zero ⇒ genuinely stochastic**, and a smooth supplier remains identifiable, so
  β̂'s pinning would then be evidence about V after all.

**Registered prediction (M72):** collapse toward zero. Our bots are deterministic mod seed, and the
seed is fixed within a game, so conditioning on enough state should drive H → 0. A plateau would be
the surprise and would mean something in the pipeline injects action-level randomness that nobody
has documented.
