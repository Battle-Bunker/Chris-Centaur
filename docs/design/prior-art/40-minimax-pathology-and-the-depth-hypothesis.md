# PRIOR ART 40 — minimax pathology: "deeper is better" is a hypothesis, and it has a stated condition

The flagship feature is depth. The time economy exists to buy it, the CPP measures
its returns, and the tranche ladder allocates it. Every one of those rests on an
assumption nobody in the programme has written down: **that searching deeper
produces a better decision.**

There is a forty-five-year literature whose founding result is that **it does
not** — that under a specific and checkable condition, minimax *amplifies* the
evaluator's error and deeper search produces **worse** decisions. The condition
has a name, the resolution has a name, and both are measurable on our archive.

This is R-6's most expensive instance: a soundness argument with an unstated
hypothesis, guarding the feature the whole architecture is built to deliver.

---

## 40.1 The result

**S75. Nau, "Quality of decision versus depth of search on game trees" (1979) and
"Pathology on game trees revisited, and an alternative to minimaxing", *Artificial
Intelligence* 21 (1983); Beal, "An analysis of minimax" (1980).**
**S76. Luštrek, Gams & Bratko, "Why minimax works: an alternative explanation",
IJCAI 2005** — the clearest modern account of the whole debate, and the source of
the quotations below.

Beal's basic model makes five assumptions:

1. the game tree has a **uniform branching factor**;
2. nodes have **two values**, loss and win;
3. the proportion of losses per level is constant;
4. **node values within each level are independent of each other**;
5. the evaluator's error is **independent of search depth** and of the node's true
   value.

Under these, the error at the root **increases with depth `d`**. Beal's own
verdict: *"This result is disappointing,"* since it was exactly the opposite of
what he set out to show. The phenomenon is **minimax pathology**: *"minimaxing
amplifies the error of the heuristic evaluations and … consequently deeper searches
produce worse evaluations."*

**The resolution, reached independently by many routes:**

> *"the pathology is usually not observed in real games because their position
> values are **not independent of each other**"* — the load-bearing property is
> **the similarity of positions close to each other**, i.e. **dependence between
> sibling values**. (Bratko & Gams 1982; Beal 1982; Nau 1982; Scheucher & Kaindl
> 1998; Luštrek 2004.) *"This conclusion is reinforced by the fact that multiple
> authors have arrived at it in different ways."*

**Three further results that each carry a design consequence:**

- **Pearl (1983)**: *"in order to overcome the pathology, the error of the
  evaluation function must decrease exponentially with the depth of search"* — and
  *"it is generally believed that the quality of the evaluation cannot vary enough
  to account for the absence of pathology"*. So depth-dependent error alone does
  **not** rescue it; node-value dependence is still required.
- **Michon (1983)**: pathology depends on the **branching-factor distribution** —
  *"game trees with uniform branching factor tend to be pathological, while game
  trees with, for example, geometrically distributed branching factor do not. It is
  not known whether real games have any of the non-pathological distributions."*
- **Mutchler (1991), "The multi-player version of minimax displays game-tree
  pathology"** (ISMIS): Nau's pathology theorem **extends to MaxN**, the
  multi-player generalisation of minimax.

And it is not an artifact of minimax as an algorithm: **S77. "Lookahead pathology
in Monte-Carlo Tree Search" (arXiv:2212.05208)** finds *"theoretical and
experimental results suggest that **UCT is indeed susceptible to pathological
behavior** in a range of games"*. Switching search family does not remove the
question.

---

## 40.2 Mapping onto our joints

### C77. Depth helping is a hypothesis with a checkable condition, and our own measurement is evidence the condition fails where it matters most

The condition is **dependence between sibling values** — nearby positions must have
similar values, so that the evaluator's errors at siblings are correlated and the
`min`/`max` does not select for them. Our game splits cleanly on it, and not in a
comfortable direction:

- **Within one unit's options, dependence is strong.** A slider's sibling plans
  differ by which cell it stops on; adjacent cells have similar territory and
  material consequences. This is the benign regime.
- **Across a cluster's joint plans, dependence is weak — and we have measured how
  weak.** Two joints that differ in a single unit's assignment can differ by a
  collision, a capture, or a **team wipe**. The value lens measured exactly this:
  **king-present cells have mean |residual| 1.946 against 0.201 for no-king — a
  9.7× step — with `corr(king, residual) = +0.954`** (d31 §31.5). A 9.7×
  discontinuity in value between structurally adjacent plans **is** low sibling
  dependence, in the precise sense this literature means.

  **So the wipe-closure defect is not only a pricing error — it is a pathology
  risk.** In the cells where the value function steps discontinuously between
  siblings, Beal's assumption 4 is approximately satisfied, and the theory predicts
  that deeper search *degrades* the decision there. Two independent findings, one
  mechanism: d31's mechanism step and this domain's independence condition are the
  same property seen from two sides.

  **And note which cells those are.** They are the king-present cells — the
  decisive ones. The prediction is not "depth might not help on quiet boards"; it
  is **"depth is most likely to hurt exactly where the game is decided"**.

### C78. MaxN is a REDUCTION member with a pathology theorem named after it

Domain 1's R-1 gave REDUCTION its second and third members — `{paranoid, MaxN,
share-weighted asymmetric fold}` — and turned the three-team balance bug into a
member selection. Mutchler (1991) extends Nau's theorem specifically to **MaxN**.

  This does not disqualify the member; it **attaches the failure direction that
  ruling 49 requires a member to carry**. MaxN in a three-team game is the variant
  the literature singles out as pathology-prone, and the mechanism is intelligible:
  in a multi-player backup, a node's value depends on *which* opponent is assumed to
  be maximising, so sibling values decouple faster than in the two-player case.

  Practical form: **if a depth sweep shows depth helping under `paranoid` and not
  under `MaxN`, that is not noise and it is not a bug — it is the documented
  behaviour of that member**, and the member table should say so.

### C79. Pearl's condition gives C48's second horn a theorem instead of an anecdote

Domain 16's **C48** established that a saturating CPP has two opposite diagnoses —
*search exhausted* versus *evaluator too coarse for depth to bite on* — and that
the chess literature says the second historically dominates. Pearl supplies the
theory:

> *to overcome the pathology, the error of the evaluation function must decrease
> exponentially with the depth of search.*

  So "evaluator too coarse for depth to bite on" is not a vague complaint about
  quality. It is a **quantitative condition on how the evaluator's error behaves as
  a function of depth**, and a profile that flattens is the observable signature of
  that condition failing. C48's second horn now has:
  - a **mechanism** (minimax selects for the evaluator's errors when siblings are
    independent),
  - a **rate** (the error must fall exponentially in depth, not merely fall), and
  - the field's own expectation that **evaluators do not vary that fast**, which is
    why node-value dependence is doing the real work in games where depth helps.

  Composed with domain 37's C66 (incumbent-stability counters), the discriminator
  set is now: *stopped changing its mind* ⟹ exhausted; *keeps flipping at a stable
  score* ⟹ coarse; *residual not falling with depth* ⟹ coarse, with the rate
  measured.

### M103. The test is cheap, it runs on the archive, and it is the right first test

The question "does depth help?" has been treated in this programme as obviously
yes. It is measurable directly, two ways, and both use data already held:

1. **Measure sibling dependence.** For decisions in the archive, compute the
   correlation between structurally adjacent plans' evaluations, stratified by the
   mechanism indicators d31 §31.5 already derived (king-present, wipe-reachable,
   contested). Low within-stratum correlation is the pathology precondition, and it
   predicts *which cells* depth should hurt on.
2. **Measure the decision, not the evaluation.** Run the same positions at
   increasing rungs and record whether the chosen plan's *realised* outcome improves
   with depth, **per cell**. Pathology is a statement about decision quality, and a
   root-value comparison cannot see it.

  Both are strictly cheaper than the depth work they would inform, and either
  answer is worth having: if depth helps everywhere, this domain is a note and the
  flagship is justified; if it helps on some strata and hurts on others, the
  economy's spend rule should be **conditioned on the stratum**, which is the CPP's
  premise coordinate doing exactly the job it exists for.

### M104. Our branching factor is in the non-pathological family, and this is measurable today

Michon's result is that **uniform branching factor tends to be pathological** while
non-uniform distributions (his example is geometric) tend not to be, with the
caveat that *"it is not known whether real games have any of the non-pathological
distributions."*

  **Ours is extremely non-uniform and we already compute it**: a queen has ~71
  options, a trail unit has 3, and the per-unit option-count distribution is a
  by-product of admission. So the single cheapest thing in this domain is to plot
  that distribution and see which family it resembles — and it is a point in the
  architecture's favour that nobody has yet claimed.

  Note the interaction with our own caps, which sharpens it into a design question:
  **`sliderCandidateCap` and `enumCandidateCap` make the branching factor MORE
  uniform** by truncating the wide units to a fixed 4 and 8. If non-uniform
  branching is what protects against pathology, then the caps are removing that
  protection — a third argument against enumerate-then-cap, alongside C2's
  adaptivity requirement and M39's progressive widening.

### M105. Pathology supplies C24's mechanism, and says WHERE the evaluator work pays

Domain 7's **C24** recorded that the winner of the closest public tournament states
*a better evaluation always beats a deeper search in this family*, with the
mechanism "deep search over a wrong leaf is self-deluding". Pathology is that
sentence as a theorem: minimax over an inaccurate evaluator does not merely inherit
the error, it **selects for it**, and the selection strengthens with depth wherever
sibling dependence is weak.

  The actionable half is the *localisation*. Evaluator improvement has its
  super-linear payoff **precisely in the low-dependence strata** — the same cells
  where the wipe-closure defect lives, and the same cells the value lens's
  mechanism indicator already flags. So the evaluator roadmap and the pathology
  risk point at the same work, which is a rare and welcome coincidence: **fixing the
  wipe closure is simultaneously a pricing fix, a coverage fix (M77), and a depth
  fix.**

### M106. Switching search family does not dissolve the question

*"UCT is indeed susceptible to pathological behavior in a range of games."* Worth
recording because the natural reaction to a minimax result is "we are not doing
plain minimax". Our backup is a bounded `max`/`min` over a factor graph, which is
closer to minimax than to UCT, but either way the question is about the *interaction
between an inexact evaluator and a selection operator*, and every search family we
might adopt has one.

---

## 40.3 The counter-argument, and it is substantial

Three, and they should be read together with the finding rather than as a
dismissal.

1. **The pathology models are two-valued and ours is not.** Luštrek, Gams & Bratko's
   own contribution is that *"real numbers should be used for position values, in
   which case another, more basic explanation is sufficient"* to eliminate the
   pathology. Our evaluator is real-valued and continuous in most of its channels,
   which places us in their non-pathological setting by construction. **This is the
   strongest argument that we are fine** — and it is exactly why C77 scopes the
   worry to the *discontinuous* cells, where the real-valued smoothness that
   protects us is precisely what fails.

2. **Depth is not the only thing rungs buy.** In our search, a deeper rung also
   tightens *bounds*, and a bound is sound regardless of the evaluator's noise.
   Pathology is a statement about a heuristic value propagated through
   `min`/`max`; it says nothing about a sound interval narrowing. **So the
   architecture has a partial structural immunity that plain minimax lacks**, and
   the honest statement is that pathology threatens the *advised* reading and not
   the *sound* one. That is a real and specific mitigation, and it is an argument
   for keeping the two readings separate that the design already makes for other
   reasons.

3. **Nobody claims depth usually hurts in practice.** The consensus is that real
   games are non-pathological because their values are dependent. The finding is
   therefore not "depth is bad" — it is **"depth helping is a property of the game
   and the evaluator, not of search, and it has a condition you can check"**.

---

## 40.4 Verdicts

- **ALL / TIME — "deeper is better" is a hypothesis with a stated, checkable
  condition, and it guards the flagship.** Under independence between sibling
  values, minimax **amplifies** the evaluator's error and deeper search produces
  **worse** decisions — Beal's own result, called *"disappointing"* by him, and the
  resolution reached independently by five groups is **dependence between sibling
  values, the similarity of nearby positions**. R-6's most expensive instance: the
  assumption is unstated, and the whole economy is built to buy the thing it
  licenses.
- **VALUE / SEARCH (C77) — and our own measurement is evidence the condition fails
  where it matters most.** Within one unit's options, dependence is strong (the
  benign regime). Across joint plans it is weak, and the value lens **measured** how
  weak: a **9.7× step** in |residual| at the king-present boundary,
  `corr(king, residual) = +0.954`. A 9.7× discontinuity between structurally
  adjacent plans **is** low sibling dependence in this literature's sense. So the
  wipe-closure defect is not only a pricing error, it is a **pathology risk — and it
  lives in the cells where the game is decided.** d31's mechanism step and this
  domain's independence condition are one property seen from two sides.
- **VALUE / SEARCH (M103) — the test is cheaper than the work it informs, and runs
  on the archive.** (a) Correlate structurally adjacent plans' evaluations,
  **stratified by the mechanism indicators d31 already derived**; low within-stratum
  correlation is the pathology precondition and predicts which cells depth should
  hurt on. (b) Re-run archived positions at increasing rungs and record whether the
  chosen plan's **realised outcome** improves per cell — pathology is about decision
  quality, and a root-value comparison cannot see it. If depth helps on some strata
  and hurts on others, **the spend rule should be conditioned on the stratum**,
  which is exactly what the CPP's premise coordinate exists for.
- **TIME (C79) — C48's second horn gets a theorem.** Pearl: *the evaluator's error
  must decrease **exponentially** with depth* to overcome pathology, and the field's
  own expectation is that evaluators do not vary that fast. So "evaluator too coarse
  for depth to bite on" is a **quantitative condition with a rate**, and a flattening
  profile is its observable signature. Discriminator set, with d37's C66: *stopped
  changing its mind* ⟹ exhausted · *keeps flipping at a stable score* ⟹ coarse ·
  *residual not falling with depth* ⟹ coarse, rate measured.
- **SEARCH / REDUCTION (C78) — MaxN has a pathology theorem named after it**
  (Mutchler 1991 extends Nau's theorem to the multi-player backup). Not a
  disqualification — **the failure direction ruling 49 requires a member to carry**.
  If a depth sweep shows depth helping under `paranoid` and not under `MaxN`, that
  is documented behaviour, not noise, and the member table should say so.
- **SEARCH (M104) — a point in our favour, measurable today, and a third argument
  against the caps.** Uniform branching factor is the **pathological** family;
  non-uniform (e.g. geometric) is not. Ours is extremely non-uniform (~71 options
  for a queen, 3 for a trail unit) and the distribution is a by-product of admission
  — so plot it. But note: **`sliderCandidateCap: 4` and `enumCandidateCap: 8` make
  the branching factor MORE uniform.** If non-uniformity is what protects us, the
  caps are removing the protection — a third argument against enumerate-then-cap,
  beside C2 and M39.
- **VALUE (M105) — C24's mechanism, and where the evaluator work pays.** "A better
  evaluation always beats a deeper search in this family" is pathology stated as
  tournament experience: minimax does not merely inherit evaluator error, it
  **selects for it**, more strongly with depth wherever siblings are independent. The
  payoff is **localised to the low-dependence strata** — the same cells as the wipe
  closure and the same mechanism indicator. **Fixing the wipe closure is a pricing
  fix, a coverage fix and a depth fix at once.**
- **THE MITIGATION WE ACTUALLY HAVE, and it is worth knowing:** pathology is a
  statement about a *heuristic value propagated through `min`/`max`*. A **sound
  bound narrowing** is immune to it. So the threat is to the **advised** reading and
  not the **sound** one — a structural immunity plain minimax lacks, and one more
  reason the two readings must stay separate.
