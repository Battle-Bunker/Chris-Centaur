# PRIOR ART 30 — decision statistics, and the minimum detectable effect

Written against `design/value-evaluation` @ `90deca4`, which built the dead-cell
detector from domain 26 and — via a positive control — caught a bug in its own
first version that is worth more than the detector.

Their finding, in their words: computing the noise floor by halving whatever games
a cell happens to have makes the floor shrink as `1/√n`, *"so any non-zero
difference reads 'live' given enough games"* — and `snake5-knight`, shown dead
three times independently, scored **6.31 "live"**. Their diagnosis: *"That is a
SIGNIFICANCE statistic, not a DECISION statistic."* Their fix: evaluate the floor
at a **fixed block size** `B`. Their law: **"never build a spend-decision
statistic whose denominator is the amount already spent."**

Three things follow: their instrument has a name and a **prospective** use they
have not yet claimed; their law is the third member of an instrument-pathology
family this survey keeps finding; and their wasted-spend figure is an
owner-facing number.

---

## 30.1 What they built has a name: the minimum detectable effect

**S55. Standard experimental-design theory: power analysis and the minimum
detectable effect (MDE).** For a planned sample size `n`, a significance level and
a target power, the **MDE** is the smallest true effect the design could reliably
detect. It is the standard prospective instrument: *compute it before running, to
decide whether the experiment is worth running at all.*

Their `DEADNESS = between-arm signal / A-A floor AT A FIXED SPEND B` is exactly an
MDE comparison — the observed between-arm effect measured against the smallest
effect a block of size `B` could see. And their bug is exactly the classical
error that MDE exists to prevent: **a significance statistic answers "is this
effect distinguishable from zero given everything I have spent"; a design
statistic answers "is this effect big enough to be worth spending on".** The first
converges to "yes" for any non-zero effect; the second does not.

**M75 — the use they have not claimed: run it BEFORE the block, not after.**
Their column is currently retrospective (which cells were dead, and how much was
wasted). MDE's primary use is prospective: **for each candidate cell and each
candidate block size, is the plausible between-arm effect above the MDE?** If not,
the cell cannot decide anything at that budget and either the budget rises or the
cell is not run. That converts the detector from an audit into an **experiment-
design gate**, and it is the same column with the arms of the *previous* round
supplying the effect estimate.

  It also composes with something the survey already recommended. Fishtest's
  **SPRT** (domain 4) is the *sequential* form of the same idea: rather than
  choosing `B` in advance, keep playing until the evidence crosses a bound or the
  design can no longer distinguish the hypotheses. **MDE tells you whether to
  start; SPRT tells you when to stop.** Adopting both closes the loop on "how many
  games should this cell get", which is currently answered by taste.

---

## 30.2 Their law is the third member of a family, and the family has one statement

This survey has now produced three separate instrument pathologies, each found
the hard way, and they are one thing:

| # | pathology | instance |
|---|---|---|
| **R-8** | a statistic **bounded above** saturates and *manufactures* structure | raw win probability forced a transitive triple to show a large cycle (value lens, POP-3) |
| **R-8b** | a statistic **pinned at a boundary below** cannot gradate, so it cannot rank | β̂ reads 0 for a nearly-right `V` and a completely wrong one alike (belief lens, logit supplier) |
| **R-8c** | a statistic whose **denominator is the spend** converges to "act" regardless of effect size | the dead-cell floor shrinking as `1/√n` scored a thrice-dead cell 6.31 "live" (value lens, MEAS-1) |

**R-9 (the unified statement).** *Before using a number to make a decision, ask
what it does as the data grows and as the effect goes to zero. A statistic whose
limit is independent of the quantity you care about cannot inform the decision,
however carefully it is computed.*

  - R-8: as one arm dominates, the bounded statistic's limit is set by the bound,
    not by the cycle.
  - R-8b: as `V` misranks at all, the estimator's limit is the boundary, not the
    degree of misalignment.
  - R-8c: as `n` grows, the ratio's limit is "live", not the effect size.

  Three lenses hit three faces of one law in one session, each caught it with a
  control or a null, and each recorded it. **The generalisation is worth pinning
  because the next instance will look different again**, and the question — *what
  is this statistic's limit, and is that limit the thing I care about?* — is
  cheap to ask of every new column before it is trusted.

---

## 30.3 The number the owner should see

*"Spend already made on cells dead at their budget: ~1,350 games at B=24, ~2,232
at B=96, of ~18,300."* And the worst single case: `potion-hazdose15-snake6`, 288
games per arm on a cell whose arms differ by 0.027 against a 0.071 floor.

That is between **7% and 12% of the entire game corpus spent on cells that could
not distinguish the arms they were run to distinguish**, and it is measured rather
than argued. Two readings, both worth stating:

- **It is smaller than one might fear.** 88–93% of the corpus was spent on cells
  that could decide something. The programme's cell selection has been better than
  the three separate knight-cell investigations would suggest.
- **It is the only estimate of experimental waste this programme has ever had**,
  and it now exists as a standing column, so it can be driven toward zero
  prospectively rather than discovered retrospectively.

  Combined with domain 26's coverage point, the picture for ruling 49 is becoming
  quantitative on both halves: the population of *bots* is 25%-dense with a +0.996
  duplicate pair, and the population of *instances* wasted ~10% of spend on cells
  that could not discriminate. Neither number existed a day ago; both are now
  columns.

---

## 30.4 One caution on their fix

Fixing `B` makes the statistic a decision statistic, which is right — but **`B`
is now a parameter with provenance**, and the deadness verdict is relative to it.
Their own presentation already handles this (they report at `B=24` *and* `B=96`,
and the wasted-spend figure differs by 65% between them). Worth making the
convention explicit in the column's definition: **deadness is always
`deadness(cell, B)`, never `deadness(cell)`**, and a cell reported dead must carry
the budget it was dead at. Per ruling 49 that is a fitted number with provenance
like any other, and the two-value reporting they already do is the right form.

---

## 30.5 Verdicts

- **VALUE / MEASUREMENT:** what you built is a **minimum detectable effect**
  comparison, and its primary use in the literature is **prospective**: run it
  *before* a block to decide whether the cell can decide anything at that budget,
  using the previous round's arms for the effect estimate. That turns an audit
  into an experiment-design gate at no extra cost.
- **VALUE / MEASUREMENT:** **MDE tells you whether to start; SPRT (domain 4) tells
  you when to stop.** Adopting both closes the loop on "how many games should this
  cell get", which is currently answered by taste.
- **VALUE:** report **`deadness(cell, B)`**, never `deadness(cell)` — the verdict
  is relative to the budget, your own two-value reporting shows why (65% swing in
  the waste figure), and `B` is a fitted parameter with provenance.
- **ALL — R-9, a new standing law generalising R-8/R-8b/R-8c:** *before using a
  number to make a decision, ask what its limit is as the data grows and as the
  effect goes to zero. A statistic whose limit is independent of the quantity you
  care about cannot inform the decision, however carefully it is computed.* Three
  lenses hit three faces of this in one session; the next instance will look
  different again, and the question is cheap to ask of every new column.
- **OWNER-FACING:** ~7–12% of the game corpus was spent on cells that could not
  distinguish the arms they were run to distinguish — measured, not argued. That
  is *smaller than the three separate knight-cell investigations suggest*, and it
  is the first estimate of experimental waste this programme has had. With domain
  26's coverage statement it makes both halves of ruling 49's concern
  quantitative.
