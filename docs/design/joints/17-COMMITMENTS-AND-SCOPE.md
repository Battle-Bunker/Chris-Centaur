# Commitments and scope, against the literature that formalised them

Cycle 8 addendum, under ruling 50. Two objects in this design were argued from
first principles and both have a standard formalisation with known results:
the **carried premise** is an *option* in the temporal-abstraction sense, and
**scoped contributions** are a *k-additive capacity* in the Möbius/interaction
sense. In both cases the literature supplies a theorem or a condition that
changes something here.

---

## A. A carried premise is an option, and the interruption theorem justifies Law C2

**The formalisation.** Sutton, Precup and Singh (AIJ 1999) define an option as a
triple `⟨I, π, β⟩` — an **initiation set** `I ⊆ S`, a **policy** `π`, and a
**termination condition** `β : S⁺ → [0,1]`. Options are temporally extended
courses of action usable interchangeably with primitive actions.

The mapping to `05-ADVANCE-AND-COMMITMENTS.md`'s `Carried` is one-to-one and was
arrived at independently:

| option | carried premise |
|---|---|
| initiation set `I` | the condition under which a member may mint the commitment (author + `born`) |
| policy `π` | the plan the commitment carries (arm → collect → spend; the role's preferred action; the stance) |
| termination `β` | `lifetime` + `invalidate` (+ Law C4's binding change) |

**The theorem that matters.** Their Theorem 2 (Interruption): given options `O`
and a policy `μ`, define `O′` identical except that `β′(h) = 1` for any history
where `Q^μ(h, o) < V^μ(s)` — that is, **terminate the option whenever continuing
it is worse than re-deciding**. The resulting policy is no worse, and generally
better, than the one that runs options to completion. The distinction in the
literature is *call-and-return* execution versus *interrupting* execution, and
interrupting dominates.

Three consequences for this design, and the first is the important one:

1. **Law C2 stops being prudence and becomes a theorem.** I argued that a
   commitment may change order and spend but never override a floor or a
   refusal, on safety grounds. The interruption theorem says the *stronger*
   thing: a commitment that can be abandoned the moment continuing is worse than
   re-deciding is **not a cost at all** — it dominates the un-interruptible
   version. So the design does not trade strength for safety here; the
   interruptible form is the better form on both counts.
2. **Latching is precisely the forgone improvement.** A latched conditional
   (`09 §BREAK 2`) or an un-interruptible commitment is call-and-return
   execution, and the theorem prices what it gives up. That is a cleaner
   argument against the arena-latch class than "it feels like state".
3. **Law C4 is the interruption condition, specialised.** Re-justification when
   the reduction binding changes is exactly `Q^μ(h,o) < V^μ(s)` evaluated under
   the *new* `μ`: the option's continuation value is computed under a policy the
   bot no longer runs, so it must be re-checked rather than trusted. The
   literature's time-regularised variants (interrupting options with a
   deliberation cost) are the right reference if re-checking every turn proves
   expensive — the cost of deliberation is exactly what a `lifetime` coarsens.

**What changes:** nothing structural — which is the useful result. The object was
right, and it now carries a theorem instead of an argument. `05 §4` gains the
citation and `05 §7`'s falsifier 2 (does an interruptible commitment produce the
potion behaviour) is sharpened: if it does not, the fault is in the *initiation*
condition or the plan, never in the interruptibility.

---

## B. Scoped contributions are a k-additive capacity, and identifiability is the missing fourth condition

**The formalisation.** For a set function `ν` on participants `N`, the **Möbius
transform** is `m(A) = Σ_{B⊆A} (−1)^{|A|−|B|} ν(B)` with inverse
`ν(A) = Σ_{B⊆A} m(B)`. `ν` is **k-additive** iff `m(A) = 0` for every `|A| > k`;
equivalently the interaction index vanishes above order `k`. k-additive
capacities *"range from probability measures (k = 1) to general capacities
(k = n)"*.

That is the scoped-contributions proposal exactly:

| proposal | formalisation |
|---|---|
| the current additive law | `k = 1` — the singleton truncation |
| "declare participant scope; disjoint scopes add verbatim" | Möbius decomposition over participant subsets |
| "overlapping scopes declare a connective; emit the residual" | `m(A)` **is** the residual — the pair term is what the pair is worth beyond its singletons, by construction |
| "bounded arity, declared in the manifest" | **`k` is the arity cap.** The manifest is choosing k-additivity |
| the shipped edge-EV surrogate `Ṽ = Σφ_u + Σφ_uv` | a 2-additive model already running in the ACTION joint |

So `15 §C`'s first condition (residual form) is not a design preference — it is
the definition of the Möbius transform, and getting it wrong makes the model
not a capacity at all. Good: the condition was right for a better reason than I
gave.

**The fourth condition the literature forces: identifiability.** The known hard
problem for k-additive models is *identification* — fitting the capacity from
data, typically by a quadratic program, with uniqueness a studied question. A
2-additive model over `n` participants has `n + C(n,2)` free parameters; on a
board with 8 units that is 36, against a corpus whose own fits (ruling 49) are
already thin. An unidentifiable pair term does not sit idle — **it absorbs
noise**, which is worse than being absent, because it arrives wearing a fit
provenance record.

> **Condition 4 (identifiability).** A scope term may be seated only if its
> `FitProvenance` shows the corpus can identify it: the fit reports the
> parameter count at that arity, the design's rank or conditioning, and the
> residual per stratum. A term whose identification is rank-deficient is refused
> at registration, not discovered later in a null.

This also gives the arity cap a principled setting rather than a taste: **k is
whatever the corpus can identify**, and it rises when the corpus grows.

**One precision worth stating, because the vocabulary invites an error.** The
Choquet integral is the natural aggregator *for a capacity* — a monotone set
function. Our currency is **signed flows** (inflows and outflows, and a death is
a negative), so what we are adopting is the **Möbius decomposition**, not the
Choquet integral. Calling the result "a Choquet value" would import a
monotonicity assumption the game does not satisfy. Where a genuine capacity does
appear is §C.

---

## C. Where a genuine set-function objective does belong: the ADVICE kind

`12 §D3` gives ADVICE a law — *partition of a scarce attention budget over
set-valued selection* — and set-valued selection under diversity is the one
place in this design where the objective is naturally **submodular**: the second
plan shown to an operator is worth less if it is similar to the first, and the
marginal value of an extra option decreases. That is the standard shape for
portfolio/coverage selection, where greedy maximisation carries the usual
`1 − 1/e` guarantee.

So the ADVICE law can be stated with the same precision as the others:

> **ADVICE law, sharpened.** Members emit a **value over sets** of plans that is
> monotone and submodular in the set (adding an option never hurts; similar
> options add less), and the surface's attention budget is the cardinality
> constraint. Selection is greedy under the budget, with the standard
> approximation guarantee, and the diversity measure is a declared member
> parameter rather than a hardcoded distance.

That is a real law rather than "one selector per surface", and it explains why
ADVICE cannot compose additively with anything: submodular objectives do not
sum into a partition, which is exactly the non-composability that made it look
like it had no home.

---

## D. Net changes

| change | source | affects |
|---|---|---|
| Law C2's interruptibility is a theorem, not a trade-off; latching's cost is named | options / interruption theorem | `05 §4`, `09 §BREAK 2` |
| Law C4 = the interruption condition under a changed policy; deliberation-cost variants are the fallback if per-turn re-checking is expensive | time-regularised interrupting options | `11 §4` |
| **Condition 4: identifiability**, with the arity cap set by what the corpus can identify | k-additive capacity identification | `15 §C` |
| the residual form is the Möbius transform's definition, not a stylistic choice | Möbius / interaction index | `15 §C` condition 1 |
| ADVICE's law is monotone-submodular set value under a cardinality budget, greedy with a guarantee | submodular maximisation | `12 §D3` |
| **precision:** we adopt the Möbius decomposition, not the Choquet integral — our value is signed, not a capacity | Choquet requires monotonicity | vocabulary |
