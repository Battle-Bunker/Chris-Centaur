# MEASUREMENT ITEM 3 — THE REPORTING RETROFIT, APPLIED

Adopted with the librarian's declared split rather than cargo-culted: stratified bootstrap for
CIs, **P(A beats B) with its own interval** on every standing verdict, performance profiles for
cross-cell comparison, **IQM for the across-cell aggregate only**, and a stated seed population on
every spec. `tools/reporting.py`.

---

## 1. STANDING VERDICTS, RETROFITTED

`P(A beats B)` over co-seated games, with a **stratified bootstrap** resampling cell × seed (the
design's actual dependence structure) rather than games:

| verdict | n games | **P(A beats B)** | 95% stratified CI | |
|---|---|---|---|---|
| territory > material | 4,841 | 0.671 | [0.538, 0.854] | |
| territory > reflex | 4,851 | 0.855 | [0.726, 0.957] | |
| **potionOrder > plain** | 1,150 | **0.516** | **[0.482, 0.555]** | **contains 0.5** |
| **potionBoth > plain** | 934 | **0.482** | **[0.438, 0.521]** | **contains 0.5** |
| **parentDefault > potionIntel** | 302 | **0.568** | **[0.475, 0.703]** | **contains 0.5** |

**Three of five standing verdicts are coin flips in win-probability terms** — the exact form the
RL-literature critique exposes, found in our own record.

Two readings worth separating:

- **This does not overturn k5; it makes it legible.** k5 already found the potion score null
  (G = +0.054 [−0.053, +0.165]). `P = 0.516 [0.482, 0.555]` says the same thing in the one number a
  reader can hold: **the potionOrder arm wins 51.6% of its head-to-heads, ±3.7 points.** That is the
  argument for the retrofit — same evidence, far less room to over-read.
- **`territory > material` is directionally sure but very imprecise**: 0.671 with an interval from
  0.538 to 0.854. The direction clears 0.5 comfortably; the *magnitude* is barely constrained.
  Anything downstream that treats territory's superiority as a fixed quantity is over-reading it.

---

## 2. PERFORMANCE PROFILE (cross-cell) — the shape the mean hides

Fraction of 26 cells on which an arm is within τ of the best arm on that cell:

| arm | τ=0 | 0.05 | 0.1 | 0.2 | 0.5 |
|---|---|---|---|---|---|
| lobster-territory | **0.65** | 0.73 | 0.73 | 0.81 | **1.00** |
| lobster-material | 0.23 | 0.31 | 0.35 | 0.46 | 0.65 |
| reflex | 0.12 | 0.12 | 0.12 | 0.12 | **0.12** |

**Territory is best on 65% of cells and never more than 0.5 behind on any cell** — a robustness
statement no mean conveys. **Reflex's profile is flat at 0.12 all the way to τ=0.5**: where it is
not best, it is *very* far from best. A mean over cells would have shown reflex as uniformly poor
and territory as uniformly good; the profile shows that territory's edge is broad-but-bounded and
reflex's deficit is a cliff.

---

## 3. THE ACROSS-CELL AGGREGATE — and it is skew-inflated

territory − material across 26 cells: **mean +0.4809 · median +0.1724 · IQM +0.3008.**

**The mean is 2.8× the median.** It is dominated by a handful of mix-king cells where territory
dominates. **IQM (+0.30) is the figure to quote** for the across-cell aggregate, and per-cell
numbers should keep their own intervals rather than being rolled up at all. Any standing statement
of the form "territory beats material by ~0.5" is a mean over a skewed cell population.

---

## 4. SEED POPULATION — the requirement, and our current status

> **Every experiment spec must state its seed population and why. A pinned seed is REPRODUCIBLE,
> not REPRESENTATIVE, and the two are routinely conflated.**

Our current status, stated plainly so specs can be fixed rather than defended: **seeds are pinned
contiguous ranges chosen per cell** (32101–32108, 60301–60308, and so on). They are perfectly
reproducible and they are **not drawn from any declared population**. Nothing in the archive says
what a seed range is meant to represent, so "we ran 8 blocks" quantifies over *those eight boards*
and generalises to others only by assumption.

The minimum fix costs nothing: a spec states **(a)** the population seeds are drawn from
(e.g. "uniform over 1–10⁶, the harness's spawn-geometry generator"), **(b)** the draw rule
(contiguous / random / stratified by spawn geometry), and **(c)** why that population is the one the
verdict should generalise over. Given the measured **0.427→0.530 swing from spawn geometry alone**
already on record, seed population is not a formality here — it is one of the larger uncontrolled
terms in the program.

---

## 5. WHAT I WOULD MAKE STANDING

1. **`P(A beats B)` with a stratified interval on every verdict, alongside the effect size.** One
   number, hard to over-read, and it is what exposed three coin flips above.
2. **Bootstrap strata = cell × seed, never games.** Games within a cell share a board and are not
   independent; a game-level bootstrap will report intervals that are too narrow.
3. **IQM for across-cell aggregates only.** Per-cell numbers keep their own CIs. Never IQM a
   within-cell quantity — it discards the tails that the elimination mechanic lives in.
4. **Performance profiles whenever more than ~5 cells are being compared**, because the mean and
   the profile disagree in shape here and the profile is the honest one.
5. **A seed-population line in every spec**, per §4.

**Benchmark note, kept because it is true and easy to lose:** our practice is already ahead of the
field's default — this program floors its own experiments, replicates, pre-registers, and reports
nulls. **The gap this retrofit closes is statistics, not discipline.**
