# PRIOR ART 23 — the dependency problem, and where our floor meets it twice

Domain: interval arithmetic's oldest known failure mode — **the dependency
problem** — checked against the bounds bank. Short, and it contains one
corroboration and one prediction.

Read against `src/lobster/bounds/score.ts` and `cluster-enum.ts` §5.5.

---

## 23.1 The problem, and the standard remedy

**S49. Moore's interval arithmetic and the *dependency problem*; de Figueiredo &
Stolfi, *Affine arithmetic: concepts and applications*, Numerical Algorithms 37
(2004).**

Naive interval arithmetic treats every occurrence of a quantity as an
*independent* unknown. So `x − x` evaluates to `[lo−hi, hi−lo]` rather than `[0,
0]`, and any expression in which a variable appears more than once is
**over-widened**, systematically and cumulatively. This is the dependency
problem, and it is the reason interval bounds degrade as expressions grow.

**Affine arithmetic** is the standard remedy: represent a quantity as a
first-degree polynomial `x̂ = x₀ + Σᵢ xᵢεᵢ` over shared **noise symbols** εᵢ ∈
[−1, 1]. Because the same εᵢ appears in every quantity that depends on that
source of uncertainty, correlated terms **cancel** when combined, and converting
back to an interval at the end gives a strictly tighter answer. The literature's
own headline example is exactly `x − x`, which affine arithmetic returns as zero.

The general law: **a bound built by combining sub-bounds is only as tight as the
correlations it tracks.** Drop the correlations and every shared source of
uncertainty is counted as though it could go the worst way independently in each
place it appears.

---

## 23.2 Corroboration: we already found this once, and handled it correctly

`cluster-enum.ts` §5.5, in the module's own words: *"The coupling that is real —
the enemy min, which does not distribute over a sum — is not a surrogate quantity
at all: the bank computes it exactly, per proposal, at price time."*

That is the dependency problem, correctly identified and correctly refused. The
tempting cheap move — compute each unit's floor by minimising over the enemy
*independently*, then sum — gives

    Σ_u min_e f_u(e)   ≤   min_e Σ_u f_u(e)

which is a **valid** lower bound and a **strictly looser** one, with the gap
growing in the number of units. The module declines it and pays for the exact
joint min instead. **This is the single best piece of bound engineering I found
in the codebase**, and it deserves to be named in the design docs as an instance
of a known phenomenon rather than as a local observation, because naming it makes
the *second* instance findable.

---

## 23.3 The prediction: the same problem returns under fog, at the bounds layer

The enemy's action is not the only shared source of uncertainty. Under
invisibility potions, **the hidden-unit configuration is a second one**, and it
enters *every* per-unit bound that could be affected by a hidden unit. The same
inequality then applies with `h` (a hidden configuration) in place of `e`:

    Σ_u min_h f_u(h)   ≤   min_h Σ_u f_u(h)

and the left-hand side is what any design that computes per-unit clouds and then
combines them will produce, unless it is built not to. Three specific
consequences:

- **The floor degrades with the number of units at risk, not with the amount of
  uncertainty.** Six units each conservatively assuming the hidden enemy is in
  *their* worst place produces a floor corresponding to six enemies. That is
  sound and useless, and it is precisely the "saturated floor carries no ordering
  information" symptom domain 1's C1 and domain 3 have been circling from the
  decision-theory side. **Two different literatures now predict the same
  failure**, which raises my confidence that it is the mechanism behind the
  inert-floor observations rather than a coincidence.
- **It is the bounds-layer twin of C36** (domain 12). C36 says the
  cross-component independence identity `φ_uv ≡ 0` fails under fog because a
  hidden unit's cloud spans components. C23-here says the same shared variable
  loosens the *bound* even within a component. One cause, two layers, and the
  design has noticed neither because both hypotheses are currently true.
- **It has a named remedy that fits our machinery.** Affine arithmetic's move —
  give each shared source of uncertainty a **named noise symbol** carried through
  every bound that depends on it, so correlated terms cancel at combination time —
  is structurally what our **assumption sets** already do. `ScoreBounds` carries
  `assumptions`, `basisKeyOf` canonicalises them, and `unionAssumptions` combines
  them; what the bank does *not* do is use a shared assumption to **tighten** the
  combination. Today assumptions are used for *refusal* (different basis ⟹ not
  comparable). The affine insight is that a shared assumption is also
  **information**: two bounds conditioned on the same hidden configuration can be
  combined more tightly than two bounds conditioned on independent ones.

  So the fix is not a new subsystem. It is: **let the basis do arithmetic, not
  only refusal.** That is one new operation on an existing type, and it is
  exactly the kind of "the mechanism is already there, it is missing one
  capability" finding that the composition lens's carve is supposed to surface.

---

## 23.4 A caution about the remedy, stated honestly

Affine arithmetic is not free and the literature is clear about its costs: affine
forms grow (each operation can introduce a new noise symbol), non-linear
operations require conservative approximation which *reintroduces* widening, and
the bookkeeping is real. For us the mitigating facts are that the number of
genuinely shared uncertainty sources is small and *named* (the enemy joint move;
the hidden configuration; the spawn draw), and that our combination is mostly
**linear** — sums of per-unit contributions — which is the case affine arithmetic
handles exactly. That is a favourable regime, but it should be measured rather
than assumed: **the cheap first experiment is to compute both the decoupled and
the exact joint minimum on the existing archive and report the gap**, per unit
count. If the gap is small the whole line is moot; if it grows with unit count as
predicted, it is a direct measurement of how much ordering information the floor
is throwing away.

---

## 23.5 Verdicts

- **BOUNDS / SEARCH:** name the enemy-min decision as an instance of the
  **dependency problem** in the design docs. It is handled correctly today and
  naming it is what makes the second instance findable.
- **BELIEF (prediction, testable before fog ships):** the hidden-unit
  configuration is a **second shared uncertainty source**, and any design that
  minimises per unit and then combines will produce a floor that degrades with the
  number of units at risk rather than with the amount of uncertainty — sound and
  ordering-free. This is the bounds-layer twin of C36 and a second independent
  prediction of the saturated-floor symptom.
- **BOUNDS:** the remedy is one new capability on an existing type — **let a
  shared basis tighten a combination, not only refuse one.** `ScoreBounds` already
  carries, canonicalises and unions assumptions; affine arithmetic's noise symbols
  are the same idea used for arithmetic instead of for refusal.
- **MEASUREMENT (cheap, existing archive):** compute the **decoupled minimum vs
  the exact joint minimum** and report the gap by unit count. Small ⟹ this whole
  line is moot. Growing ⟹ a direct measurement of the ordering information the
  floor discards, and the first quantitative handle on the inert-floor symptom
  that two other domains predicted from theory.
