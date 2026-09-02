# PRIOR ART 14 — algorithm selection and portfolios: the theory of `Choice`

Domain: the field that formalised, forty-nine years ago, exactly what the
COMPOSITION lens's `Choice = fixed | composed | conditional | priced` is trying
to be — and that has a large body of empirical results on **when a portfolio of
members beats the best single member, and by how much.**

This domain supplies two things nothing else in the survey does: a **type theory
for the conditional constructor**, and a **falsifier for the whole joints
architecture that runs on the archive we already hold.**

---

## 14.1 Load-bearing sources

**S34. Rice, "The algorithm selection problem", *Advances in Computers* 15
(1976).** The founding formalisation. Also Kotthoff, *Algorithm selection for
combinatorial search problems: a survey* (AI Magazine 35(3), 2014;
arXiv:1210.7959) and Kerschke, Hoos, Neumann & Trautmann, *Automated algorithm
selection: survey and perspectives* (ECJ 2019).

**S35. Xu, Hutter, Hoos & Leyton-Brown, "SATzilla: portfolio-based algorithm
selection for SAT", *JAIR* 32 (2008), arXiv:1111.2249**, plus the SAT-competition
practice of reporting **VBS** (virtual best solver) and **SBS** (single best
solver).

---

## 14.2 What the experts decided, and their stated rationale

### (a) Rice's model, which is our carve with different names

Given a **problem space P**, a **feature space F**, an **algorithm space A**, and
a **performance mapping** `p: P × A → ℝ`, the selection problem is to find a
mapping `S: F → A` maximising expected performance. The essential refinement Rice
added to his own first version was **features** — the observable summary of an
instance on which the selection is allowed to depend.

The correspondence with our design is one-to-one and not strained:

| Rice | LOBSTER |
|---|---|
| problem space P | game states / `⟨board, premise⟩` |
| feature space F | **the premise coordinates** ⟨support, observable, measure, config⟩ plus cheap board features (roster, K, W, p, cluster sizes) |
| algorithm space A | the **members** of each joint's collection |
| performance mapping p | the **mechanism report** |
| the selector S: F → A | `Choice = conditional` |

So `Choice = conditional` is Rice's selector, and the premise index is already
the feature space. That is a strong endorsement of the fibration: **premises are
not only what makes values comparable, they are the domain of the selection
function**, which is a second, independent reason to keep them.

### (b) The empirical claim the whole field rests on

SATzilla's founding observation, in the survey's own framing: *"there is no single
dominant SAT solver; instead, different solvers perform best on different
instances."* Kotthoff's version: *"often no single configuration performs well for
all instances in a heterogeneous set, but a portfolio of configurations is
required to obtain good performance."*

### (c) VBS and SBS: the field measures its own headroom before building

The SAT community reports two baselines on every benchmark:

- **SBS** (single best solver): the one solver with the best aggregate
  performance — what you get if you pick a champion.
- **VBS** (virtual best solver): the oracle that picks the best solver *per
  instance* — what you would get with a perfect selector.

**The VBS–SBS gap is the entire headroom of a portfolio architecture**, and a
real selector is scored by what fraction of it it closes. Reported numbers:
SATzilla closes ~55% of the gap; a simple k-NN selector closed ~80% on one
benchmark, solving 390 instances where the VBS solved 413.

Two disciplines follow from this that we do not practise:

1. **Measure the gap before building the selector.** If VBS ≈ SBS, per-instance
   selection buys nothing on this population, no matter how good the selector.
2. **A simple selector is often most of the win.** k-NN over features beating a
   sophisticated model-based system is the field's standing reminder that the
   selection *mechanism* is rarely the bottleneck; the *complementarity of the
   members* is.

### (d) Feature computation is inside the budget

SATzilla budgets its own feature computation and has a backup solver for when
features take too long. Selection is not free, and the cost of computing the
features the selector reads is charged against the same clock as the solving.

---

## 14.3 Mapping onto our joint

### AGREES — this is the missing quantitative case for the architecture

- **Ruling 49's mandate is the algorithm-selection thesis.** "The mandate is NOT
  to narrow the architecture to the so-far-best-validated strategies. It is an
  elegant core machine that carves the design space at its joints, so a large
  space of explored ideas AND BEYOND configures naturally." Rice/Kotthoff/SATzilla
  is that mandate with fifty years of evidence: no single configuration is best
  across a heterogeneous instance set, so the right artifact is a portfolio plus
  a selector. The owner's instinct has a literature.
- **`Choice = conditional` is a selector and the premise index is its feature
  space** — so the two moves the composition lens made independently (fiber
  values over premises; make selection a first-class recursive type) are the two
  halves of Rice's model. Worth stating; it makes the carve much easier to defend.

### CONTRADICTS — flag loudest

**C42. We have never measured our own VBS–SBS gap, and it is the falsifier for
the whole joints architecture.** Everything the composition lens proposes — the
manifest, addressed bots, member collections, conditional choice — is
infrastructure for *selecting among members*. The field's first discipline is to
measure whether per-instance selection has any headroom at all **before**
building the selector, and the measurement is cheap:

  - **SBS** = the arm with the best aggregate `sharePar` across the archive.
  - **VBS** = per scenario seed (or per cell), take the best arm's `sharePar`,
    and average.
  - The gap is the maximum a perfect per-situation selector could add.

  This runs on replays already on disk. And it is genuinely two-sided:
  - If the gap is **large**, that is the quantitative case for the whole
    architecture — and it identifies *which* joints carry the complementarity,
    because you can compute the gap per joint by holding the rest fixed.
  - If the gap is **small**, then per-instance member selection buys little on
    this population, and the joints machinery must be justified on *hygiene*
    grounds (drift prevention, addressability, reachability — all real) rather
    than on strength. That is a materially different, and much more honest,
    pitch. It also interacts with ruling 49: a small gap on a lineage-redundant
    population is weak evidence either way, which is exactly why this should be
    computed **alongside** domain 9's Nash averaging.

  **The two measurements are complementary and neither substitutes for the
  other:** Nash averaging measures *redundancy* (how much of the population is
  the same thing twice); VBS–SBS measures *complementarity* (how much the members
  differ in where they win). A population can be redundant and complementary, or
  diverse and uniformly ordered. We currently measure neither.

**C43. Our selection is at config time; Rice's is per instance, and the
difference is where the gap lives.** Today a bot is chosen once (and, per the
composition lens's finding 14, once per *process*). `Choice = conditional` exists
in the type but nothing in the roster uses it, and the production binding site
does not exist at all. So even if the VBS–SBS gap is large, **the current
architecture cannot capture any of it**: capturing it requires selection to
happen at decision time, on features computed from the live state. That reframes
the production bot-binding gap (07-SYNTHESIS §2.14) from "an operator-convenience
prerequisite" to "the mechanism without which the portfolio thesis is
unexpressible in production".

**C44. The selector's feature cost is not in our economy.** SATzilla budgets
feature computation and keeps a backup for when it overruns. Our `Choice =
conditional` would compute features on the live board inside the decision budget,
and nothing in the ECONOMY joint charges for it. Given domain 2's M7
(metareasoning partition — resources spent on control are not available for
base-level work), and given that the features a good selector wants are exactly
the expensive ones (cluster structure, roster shape, contested-cell counts), this
is a real cost that needs a row and a fallback.

### COVERS A CASE WE MISSED

**M41. A simple selector is usually most of the win — build k-NN first.** The
k-NN-beats-SATzilla result is the field's own reminder that sophistication in the
selector is rarely where the value is. For us: the first `conditional` member
should be a lookup on two or three coarse features (roster kind, cluster-size
regime, team count), not a learned model. It is also the version that survives
ruling 49's provenance requirement most easily, because a three-cell lookup table
*is* its own provenance.

**M42. Per-joint gap decomposition tells us which joints to invest in.** Holding
all joints fixed but one and computing the VBS–SBS gap over that joint's members
gives a per-joint headroom number. That is a direct, quantitative answer to "which
of the eight build increments is worth doing first" — a question every lens has
answered by argument so far. Cheap on the existing archive wherever we have arms
that differ in exactly one joint (which the composition lens's "the difference
between two arms exists only in prose" defect currently makes hard, and which B2's
generated diff would make easy — so this is a *second* payoff for B2).

**M43. Portfolios also protect against the distortion ruling 49 names.** The SAT
community's reason for portfolios is heterogeneity, but the effect is that no
single member's weakness is fatal, because another member covers it. Under a
lineage-redundant evaluation population (ruling 49), a *portfolio* bot is less
likely to be overfitted to that population than a champion bot, because the
selector's errors are bounded by the second-best member rather than by the
champion's blind spot. That is an argument for the architecture that does not
depend on the measurements being trustworthy — which, given the owner's stated
doubt about the measurements, is the argument most worth having.

---

## 14.4 Verdicts the lens agents can act on

- **COMPOSITION / MEASUREMENT (the falsifier for your own architecture, and it
  is cheap):** compute the **VBS–SBS gap** over the existing replay archive.
  SBS = best aggregate arm; VBS = per-seed best arm. That number is the entire
  headroom of per-instance member selection. Large ⟹ the quantitative case for the
  manifest and `conditional`; small ⟹ the architecture must be justified on
  hygiene grounds, which is a different and more honest pitch. Compute it
  **alongside** domain 9's Nash averaging: redundancy and complementarity are
  different quantities and we measure neither.
- **COMPOSITION:** `Choice = conditional` is **Rice's selector** and the premise
  index is **Rice's feature space** — say so; it is a second, independent
  justification for the fibration and it makes the carve much easier to defend.
  And note C43: capturing any of the gap requires selection at *decision* time on
  live features, which makes the missing production bot-binding site a blocker for
  the portfolio thesis rather than an operator convenience.
- **TIME / ECONOMY:** charge for the selector's **feature computation**. SATzilla
  budgets it and keeps a fallback; ours would compute exactly the expensive
  features (cluster structure, contested counts) inside the decision budget, and
  domain 2's metareasoning partition says that cost comes out of base-level work.
- **ALL:** build the *simplest* selector first — a coarse lookup on two or three
  features. The field's own headline is that k-NN closed 80% of the gap where a
  sophisticated system closed 55%. Sophistication in the selector is not where
  the value is; **complementarity among the members is**, which is the thing
  ruling 49 is asking us to preserve.
