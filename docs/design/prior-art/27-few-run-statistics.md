# PRIOR ART 27 — few-run statistics: what to report when you cannot afford many games

Domain: the reinforcement-learning community's reckoning with exactly our
situation — **expensive runs, few of them, noisy outcomes, and a literature of
reported improvements that did not replicate.** It ends in a specific,
adoptable reporting standard with a reference implementation.

Read against ruling 49 ("numeric results already caught being driven by scoring-
rule choices"), the programme's record of invalidated measurements, and the value
lens's noise-floor practice.

---

## 27.1 Load-bearing sources

**S52. Agarwal, Schwarzer, Castro, Courville & Bellemare, "Deep reinforcement
learning at the edge of the statistical precipice", NeurIPS 2021 (outstanding
paper), arXiv:2108.13264, with the `rliable` library.** The diagnosis, the
recommended statistics, and the tooling.

**S53. Henderson, Islam, Bachman, Pineau, Precup & Meger, "Deep reinforcement
learning that matters", AAAI 2018.** The earlier demonstration that results are
extremely sensitive to seeds, implementation details and evaluation protocol.

---

## 27.2 What the experts decided

S52's finding is the uncomfortable one: **"a number of improvements reported in
the existing literature are only 50–70% likely"** — i.e. the community's standard
practice (point estimates over a handful of runs) was routinely reporting
improvements that a proper interval estimate shows to be coin-flips. Their
prescription:

1. **Report interval estimates, not point estimates**, using **stratified
   bootstrap** confidence intervals — explicitly justified as applicable at small
   sample sizes and *"better justified than reporting sample standard
   deviations."*
2. **Use the interquartile mean (IQM)** as the aggregate. The mean *"can be
   easily dominated by performance on a few outlier tasks"*; the median *"has high
   variability"*; IQM (the mean of the middle 50%) is robust to both, and
   **"CI widths for IQM are much smaller than that of median."**
3. **Report performance profiles** — the full distribution of scores across
   tasks/runs, so a claim is visible as a curve rather than compressed to a
   number.
4. **Report probability of improvement** with bootstrap CIs — *"the probability
   that one algorithm outperforms another"* — which is the quantity a decision
   actually needs, rather than a difference of means.

---

## 27.3 Mapping onto our joint

**[+] The programme's instincts here are already good, and better than the field's
default.** Pre-registration before the rook cell; frozen `k`; noise floors on
every VBS−SBS block; explicit within-game permutation nulls on the cyclicity test;
CIs reported beside effects; a retraction when the depth-idle finding turned out
to be a miner bug. Several of these are things S52 had to argue for. This section
is not a correction of practice; it is an upgrade of the *statistics* on top of
practice that is already careful.

**C56. We report differences of means; the field's conclusion is that the mean is
the wrong aggregate for exactly our shape of data.** Our headline quantities —
`sharePar(T − M)`, `depthEffectRate`, per-cell effect sizes — are means over
games, and the recorded CIs are wide enough that several have been described as
"uninformative at n = 12" or "wide on the other two cells". S52's specific claim
is that in this regime the **mean is dominated by outliers and the median is too
noisy**, and that **IQM with a stratified bootstrap is materially tighter**. Two
concrete consequences:

  - **Re-report the ladder with IQM and stratified-bootstrap CIs.** No new games;
    it is a different aggregation of the same per-game outcomes, and the reported
    interval should tighten. Where a verdict survives the change, it is stronger
    than it was; where it does not, we learn that at the cost of one script.
  - **The stratification is already designed**: cell × seat × seed is the natural
    stratum structure, and it is exactly the structure the paired-seat design
    (domain 4's M11) creates. The two recommendations compose — paired seats
    reduce variance *within* a stratum, stratified bootstrap accounts for it
    *across* strata.

**C57. "Probability of improvement" is the quantity our verdicts should state,
and it is not what they state.** A verdict of the form *"territory beats material
by +0.536"* answers "how much" and leaves "how sure" to a separately-reported CI
that readers must combine themselves. S52's argument is that the decision-relevant
quantity is **P(arm A > arm B)** with its own interval, because that is what a
reader is actually trying to extract — and that reporting it directly is what
exposed the 50–70% cases in the literature.

  For LOBSTER this matters more than usual because of ruling 49: the owner's
  stated doubt is about whether reported effects are real. A probability of
  improvement with a bootstrap CI answers that doubt in its own terms, in one
  number, per verdict. **Every standing verdict in the pins should carry one.**

**M70. Performance profiles are the honest form of a cell-level result, and we
have just learned why.** Domain 25's finding — that the cyclic component *reverses
sign* between board families and cancels on pooling — is the general hazard S52's
performance profiles exist to expose: **an aggregate can be zero because nothing
happens, or zero because two opposite things happen.** A profile (the full
distribution across cells) distinguishes them by inspection; a mean cannot. Given
that we have now caught one instance of this in our own data, the profile should
be the default presentation for anything reported across cells.

**M71. The seed-sensitivity result is a standing risk our determinism work
partly answers, and partly does not.** S53's demonstration was that RL results
swing wildly across random seeds and across implementation details that authors
did not consider material. Our programme has two of the three protections: the
determinism work (counting cuts, replay from the allowance ledger, `order-shuffle`
tests) removes *implementation* nondeterminism, and the seed-pinning work removes
*uncontrolled* seed variation. What is missing is the third: **reporting across a
declared seed population rather than a chosen one.** A pinned seed is
reproducible; a pinned seed is not representative. The distinction should be
explicit in every experiment spec — *these are the seeds, this is why they are
the population, and here is the result across all of them* — because a
reproducible measurement of an unrepresentative sample is exactly the failure
ruling 49 describes, made harder to detect by the reproducibility.

---

## 27.4 The caveat that cuts against adopting all of this

S52's recommendations were designed for a setting with **many tasks and few runs
per task** (57 Atari games × 5 seeds). Ours is closer to **few cells and many
games per cell** (25 cells × ~190 games). IQM's advantage over the mean comes
from robustness to outlier *tasks*, which is weaker when there are few tasks; and
with hundreds of games per cell, the within-cell mean is not the noisy quantity —
the *between-cell* aggregate is.

So the honest adoption is partial and specific:
- **stratified bootstrap CIs**: adopt outright, they are strictly better justified
  than sample SDs at any sample size, and cell × seat × seed is the natural
  stratification;
- **probability of improvement**: adopt outright, it is the decision-relevant
  quantity and costs nothing;
- **performance profiles**: adopt for anything reported across cells, because we
  have a measured instance of sign cancellation;
- **IQM**: adopt *for the across-cell aggregate*, where the outlier-task concern
  is real (a dead cell is exactly an outlier task), and **not** for within-cell
  means, where it would discard data for no gain.

That last split is the one worth stating, because adopting IQM everywhere would
be cargo-culting a fix for a problem we only partly have.

---

## 27.5 Verdicts

- **MEASUREMENT (adopt, cheap, no new games):** **stratified bootstrap CIs**
  (stratify by cell × seat × seed — the structure paired seats already create)
  and **probability of improvement** with its own interval, on every standing
  verdict. The second is the quantity ruling 49's doubt is actually about, and
  reporting it directly is what exposed the 50–70% coin-flips in the RL
  literature.
- **MEASUREMENT:** **performance profiles** as the default presentation for
  anything aggregated across cells. We have now measured one case where an
  aggregate is zero because two opposite things happen (domain 25's sign
  reversal), which is precisely the failure profiles exist to expose.
- **MEASUREMENT:** adopt **IQM for the across-cell aggregate only** — a dead cell
  is an outlier task and that is where IQM earns its keep — and keep ordinary
  means within cells, where hundreds of games make the mean the right statistic.
  Adopting IQM everywhere would be importing a fix for a problem we only half
  have.
- **ALL:** a **pinned seed is reproducible, not representative.** Our determinism
  and seed-pinning work removes two of S53's three failure sources; the third —
  reporting across a *declared and justified* seed population — is not addressed,
  and reproducibility makes an unrepresentative sample *harder* to detect rather
  than easier. Every experiment spec should state its seed population and why.
- **[+] Recorded for the owner:** the programme's existing practice — pre-
  registration, frozen constants, noise floors, permutation nulls, published
  retractions — is already ahead of the field's default, and S52 exists because
  most published RL work did none of it. The gap is in the *statistics*, not the
  discipline.
