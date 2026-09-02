# PRIOR ART 31 — extrapolation error: fitting on played games, pricing unplayed plans

Domain: offline reinforcement learning's dominant failure mode, checked against
the VALUE lens's fold.

The fold is fitted on **realized flows from games that were actually played**, and
the architecture intends to use it to **price plans that were never played**.
Those are different distributions, and there is a large literature about what goes
wrong at exactly that boundary — including a specific prediction about *which
plans* the error favours.

Read against `SYNTHESIS.md` §3.2 (the three-channel fold, R² 0.970, k → 1.227)
and §6.2 ("what is measured is that weight flowing in, out and across prices
correctly with one coefficient. What is *not* measured is whether any proposed
heuristic estimates its flow accurately in advance").

---

## 31.1 The failure mode, and it is the field's central one

**S56. Fujimoto, Meger & Precup, *Off-policy deep reinforcement learning without
exploration* (BCQ, ICML 2019); Levine, Kumar, Tucker & Fu, *Offline
reinforcement learning: tutorial, review and perspectives* (2020); Kumar et al.,
*Conservative Q-learning* (CQL, NeurIPS 2020).**

The named phenomenon is **extrapolation error**: *"generalization error in the
approximate value function, induced by selecting actions not contained in the
dataset."* The mechanism is specific and it is the reason the sub-field exists:

- A value model is fitted on the state–action pairs the **behaviour policy**
  actually produced.
- Evaluating it at actions the behaviour policy **never took** requires the model
  to extrapolate, and function approximators extrapolate badly and *without
  warning*.
- **The error is not symmetric.** Because downstream use takes a `max` (or an
  `argmax`) over actions, the search **systematically selects the actions whose
  values were most over-estimated**: *"agents learn to prefer out-of-distribution
  actions whose value has been overestimated."* Taking the max over several
  predictions produces overconfident estimates of the true value.

The remedies form a family, all of which constrain evaluation in the
out-of-distribution region: **support constraints** (BCQ — only consider actions
the behaviour policy could plausibly have taken), **value pessimism** (CQL —
penalise the value of unseen actions), and **implicit** methods that avoid
querying OOD actions at all (IQL).

---

## 31.2 Mapping onto our joint

**C60. The fold's R² is an IN-DISTRIBUTION retrodiction, and the architecture's
intended use is OUT-OF-DISTRIBUTION pricing — and the error's direction is
predicted.** The value lens has been careful about what the fold establishes
(a basis-completeness claim, not a surprising-predictor claim) and honest about
what it does not (channels validated, heuristics not). This adds a specific,
directional caveat that neither statement covers:

  - The fold was fitted on **flows that occurred** — deaths that happened, food
    that was eaten, transfers that landed — across 144 games of one bot lineage.
  - Its architectural purpose is to **score candidate plans**, the overwhelming
    majority of which were never played by anything in the fitting corpus.
  - The comparator then takes an **argmax** over those scores. That is exactly the
    operator the offline-RL literature identifies as the amplifier: it does not
    sample the error, it **selects for it**.

  **The prediction, which is falsifiable and specific: the fold will
  systematically favour plans whose flow estimates are extrapolations, over plans
  whose flow estimates are interpolations.** Not "the fold is inaccurate" — its
  in-distribution accuracy is measured and real — but "the fold's errors are
  concentrated exactly where the argmax will look".

**M76. This is a candidate mechanism linking two lenses' open findings.** The
belief lens has queued a test of whether the fold's `V` explains *played policy*
(now re-registered on an order statistic, domain 28). Extrapolation error predicts
a specific pattern for that test's result: **the fold should retrodict OUTCOMES
well (in-distribution, which is what R² 0.970 measures) and order COUNTERFACTUAL
plans less well** — because ordering counterfactuals is the out-of-distribution
query. If their alignment meter comes back mediocre while the outcome fit stays
excellent, that is not a contradiction between the two results; it is the
signature of this mechanism, and it should be read that way rather than as
"the fold is wrong".

**M77. The remedies are already half-built here, and one of them is the belief
lens's `advisoryPrecision`.** The three remedy families map onto machinery this
programme already has or has designed:

| offline-RL remedy | our form |
|---|---|
| **support constraint** (BCQ) — only consider actions the data supports | the admission/closure joint, but currently keyed on legality and caps rather than on data support |
| **value pessimism** (CQL) — penalise the value of unseen actions | the **sound floor**, which is already pessimistic — but pessimistic about the *enemy*, not about *our own model's coverage* |
| **uncertainty-aware evaluation** | **`advisoryPrecision`** — exactly the field a coverage-based penalty would live in |

  The third is the interesting one. `advisoryPrecision` is currently defined as
  "the precision the evidence earned" and has, as domain 15 noted, no
  decision-theoretic consumer. **Coverage is a second, concrete producer for it:**
  a flow estimate for a plan that resembles plans in the fitting corpus has earned
  more precision than one for a plan far outside it, and the distance is
  computable from the same per-unit features the fold already uses. That gives the
  field a producer *and* a consumer (the ε/risk-budget machinery of domain 15
  stakes less on low-precision advice), and it implements CQL's pessimism in our
  own vocabulary rather than as an import.

**M78. The measurement is cheap and it is a held-out test we can run now.** The
standard diagnostic is to compare in-distribution and out-of-distribution error
directly:

  - split the replay archive by **plan similarity** rather than by game — for each
    scored decision, compute the distance from the chosen plan to the nearest plan
    of the same shape in the fitting corpus;
  - bin decisions by that distance and report the fold's residual per bin.

  If the residual grows with distance, extrapolation error is present and its size
  is measured. If it is flat, the fold generalises and this whole domain is a note.
  **Either answer is worth having before the fold is used to replace six hand-set
  coefficients**, and it uses the archive and the mining tools that already exist.

---

## 31.3 The counter-argument, which is strong here

Offline RL's failure mode is worst for **high-capacity function approximators**
(deep networks with millions of parameters), which extrapolate arbitrarily. Our
fold is **one fitted constant over three structurally-derived channels**, and the
value lens's own strongest argument is that the decomposition is *"partly
definitional"* — `sharePar` **is** `K·w/W`, and terminal weight **is** initial +
gains − losses. A near-identity does not extrapolate badly; it is exact wherever
its inputs are right.

So the honest scoping is: **the fold's ACCOUNTING half is near-identity and safe
to extrapolate; the fold's ESTIMATION half is not.** The fold says *what a flow is
worth once you have it*; the estimators that say *what flow a plan will produce*
— attack vectors, defence lines, reach, room, potion control — are ordinary
learned or hand-set predictors evaluated on unplayed plans, and those are where
extrapolation error lives. **This is the value lens's own §6.2 caveat given a
mechanism and a direction**: they wrote that the fold "tells you what an estimate
is worth once you have it; it does not supply one", and offline RL says the
supplying step is exactly where the argmax will select for error.

That scoping makes the domain sharper rather than weaker: **do not worry about the
fold; worry about the flow estimators, and measure their residual as a function of
distance from the fitting distribution.**

---

## 31.4 Verdicts

- **VALUE:** the fold's R² is an **in-distribution** retrodiction and the
  architecture's use of it is **out-of-distribution** pricing under an **argmax**,
  which is the operator offline RL identifies as selecting *for* extrapolation
  error rather than sampling it. Scope the concern correctly: the accounting half
  is near-identity and safe; **the flow ESTIMATORS are where the error lives**,
  which is your own §6.2 caveat with a mechanism and a direction attached.
- **VALUE (cheap, existing archive and tools):** bin scored decisions by distance
  from the nearest same-shape plan in the fitting corpus and report the residual
  per bin. Growing residual ⟹ extrapolation error present and measured; flat ⟹ the
  fold generalises and this is a note. Either answer is worth having **before** the
  fold replaces six hand-set coefficients.
- **BELIEF:** `advisoryPrecision` gets a **second concrete producer** — coverage
  distance from the fitting distribution — alongside domain 13's counting
  approximation. That is CQL's pessimism expressed in our own vocabulary, and
  combined with domain 15 it gets a consumer too: stake less of the risk budget on
  low-precision advice.
- **BELIEF + VALUE (read your two results together):** extrapolation error
  predicts that the fold retrodicts **outcomes** well while ordering
  **counterfactual plans** less well. If the queued alignment meter comes back
  mediocre while R² stays excellent, that is not a contradiction between the
  results — it is this mechanism's signature, and reading it as "the fold is
  wrong" would be a mistake.
