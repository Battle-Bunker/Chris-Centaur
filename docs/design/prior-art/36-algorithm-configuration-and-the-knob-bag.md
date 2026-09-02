# PRIOR ART 36 — algorithm configuration: the field whose entire subject is the knob bag

Domain 14 surveyed algorithm **selection** — *which* algorithm for this instance.
This is its sibling and it is the one that bears directly on **ruling 49**:
algorithm **configuration** — *what values* for this algorithm's parameters, and
what a fitted value's provenance has to contain before it means anything.

It is the largest gap the survey has had. The programme has twelve slots, three
flow coefficients, four caps and an ε, all hand-set; ruling 49 says they enter as
"members with provenance"; and there is a thirty-year literature, with a formal
problem statement, four families of solver, theoretical guarantees, and a named
answer to *"which of these knobs actually matters"* — none of which the design has
touched.

Written against the value lens's `MEAS-4-reporting-retrofit.md` §4 (the seed
population is undeclared), whose finding this domain does not merely corroborate
but **relocates**: it is not a reporting-hygiene item, it is the missing half of
the objective.

---

## 36.1 The construct, and the one equation that matters

**S64. Schede, Brandt, Tornede, Wever, Bengs, Hüllermeier & Tierney, "A survey of
methods for automated algorithm configuration", *JAIR* 75 (2022), arXiv:2202.01651.**
With **Hutter, Hoos & Leyton-Brown, "Sequential model-based optimization for
general algorithm configuration" (SMAC), LION 2011**; **López-Ibáñez,
Dubois-Lacoste, Pérez Cáceres, Birattari & Stützle, "The irace package: iterated
racing for automatic algorithm configuration", *Operations Research Perspectives*
3 (2016)**; and **Birattari, Stützle, Paquete & Varrentrapp, "A racing algorithm
for configuring metaheuristics" (F-Race), GECCO 2002**.

The problem is stated as follows. Let `I` be a space of problem instances **over
which a probability distribution `P` is defined**. Let `A` be a parametrized
algorithm with configuration space `Θ`, and `c : I × Θ → R` a cost function. Then
the optimal configuration is

    θ*  ∈  argmin_{θ ∈ Θ}  ∫_I c(i, θ) dP(i)                            (1)

and the survey's next sentence is the load-bearing one:

> *"However, in practice, the distribution `P` over `I` is unknown, and thus we
> must resort to solving a **proxy problem**."*

The proxy is a training instance set `I_train ⊆ I` and an aggregation `m`, giving

    θ̂  ∈  argmin_{θ ∈ Θ}  m(c, I_train, θ)                             (2)

— which the survey explicitly likens to **empirical risk minimisation**.

That framing is the whole finding of this section. **The population is not
metadata attached to the number; it is the measure the objective integrates
against.** Equation (1) is the thing a tuned value is supposed to solve;
equation (2) is a proxy whose gap to (1) is a generalisation claim.

---

## 36.2 What the experts decided, and the four decisions that map

**(a) Compare configurations on the SAME instances and seeds — never on
separately-drawn samples.** SMAC's intensification "ensures that configurations
are compared only based on a performance estimate computed on the *same* randomly
sampled set of problem instances and seeds". ParamILS's acceptance criterion is a
**dominance** relation: a configuration is accepted over a competitor if it has
been evaluated on *more* instances **and** has lower cost on those. Rationale:
instance-to-instance variance dwarfs configuration-to-configuration variance, so
an unpaired comparison measures the instance draw.

**(b) Do not run losers to completion — race them, and cap.** F-Race runs
configurations against each other and discards inferior ones as soon as a
non-parametric test says so. **Adaptive capping** (Hutter et al. 2009) terminates
a run "as soon as it becomes clear that it will not be better than the current
incumbent". irace adds elitist racing and soft restarts. LeapsAndBounds (Weisz et
al. 2018) sets per-phase budgets using **empirical Bernstein stopping** (Mnih et
al. 2008), which takes the *range and empirical variance* of the capped
observations into account rather than a fixed sample size.

  And the price is stated, not hidden: capping produces **right-censored** data —
  only a lower bound on the cost is observed — which "needs to be handled
  properly". **Structured Procrastination** (Kleinberg, Leyton-Brown & Lucier
  2017) is the sharpest instance: it keeps a per-configuration double-ended queue
  of `(instance, timeout)` pairs; a run that overruns its timeout goes to the
  *back* of that queue **with double the timeout**; a completed run is recorded
  and never revisited. It returns an `(ε,δ)`-optimal configuration with high
  probability and is runtime-optimal up to a logarithmic factor — and it
  deliberately **returns the configuration with the longest total execution time
  rather than the best empirical mean, "due to theoretical reasons"**. Under
  capping the mean over survivors is not the estimator you may use.

**(c) Measure which parameters matter, do not assume it.** **Hutter, Hoos &
Leyton-Brown, "An efficient approach for assessing hyperparameter importance",
ICML 2014** applies **functional ANOVA** to a random-forest surrogate fitted on
configuration runs, decomposing the performance variance `V = Σ_U V_U` over
subsets of parameters; importance is the fraction `F_U = V_U / V`. Across ten
solver/benchmark pairs (SAT, MIP, ASP):

  - **main effects account for 20–88% of the total performance variation**, and
    were computed **in seconds** (interactive, on already-logged runs);
  - **pairwise interactions reach 45%** in several scenarios;
  - and the number **depends on the reference region**. Same scenario, three
    decompositions: SPEAR-BMC main effects are **88% of raw performance**, **50%
    of improvement over the 25% quantile**, and **26% of improvement over the
    default**. Restrict attention to already-good configurations and the main
    effects shrink while the interactions grow.

**(d) Explain a configuration as a PATH, not a point.** **Fawcett & Hoos,
"Analysing differences between algorithm configurations through ablation",
*Journal of Heuristics* 22 (2016)** walks from a source configuration (the
expert default) to a target (the configured one) by changing one parameter at a
time, greedily, measuring each step. Across five SAT/MIP/planning scenarios,
**more than 95% of the performance gain between default and configured is
accounted for by the ablation path.**

**(e) A configurator's OUTPUT TYPE is a taxonomy axis.** The survey's classifier
has `candidate output ∈ {single configuration, set configuration, policy}`.
Multi-objective configurators (MO-ParamILS, S-Race, SPRINT-Race) return a **set**
— a Pareto front over configurations. And **dynamic algorithm configuration**
(Biedenkapp et al., ECAI 2020) returns a **policy** that adjusts the
configuration *during* the run, with two stated prerequisites: (1) the algorithm
must support dynamic change, and (2) **runtime information must be provided
describing the current internal state `Q`** — current iteration, restart number,
current solution quality — alongside the static instance features `I`.

  (See also **Bhatia, Svegliato & Zilberstein, "Tuning the hyperparameters of
  anytime planning", ICAPS HSDIP 2021** — configuration applied to an anytime
  planner, which is our TIME joint's exact problem.)

---

## 36.3 Mapping onto our joints

### C62. A configured number's provenance must name the population, because the objective is an expectation over it

Ruling 49 admits fitted numbers "as members with provenance", and the programme
reads provenance as *who set it, from what evidence*. The field's provenance is a
tuple, and it has an element ours does not: **`(Θ, c, m, I_train, P, budget)`**.
Drop `P` and equation (1) has no meaning — you are not approximating an
optimum, you are reporting the argmin of a sum over an arbitrary list.

  This is the value lens's §4 finding, and their statement of it is exactly
  right — *"seeds are pinned contiguous ranges chosen per cell… perfectly
  reproducible and not drawn from any declared population"*, so a verdict
  *"quantifies over those eight boards and generalises to others only by
  assumption"*. What this domain adds is **where the defect sits**: not in the
  report, in the **objective**. A pinned contiguous seed range is a fine
  `I_train`; what is missing is the `P` it is a draw from, and without it the
  quantity being minimised is undefined rather than imprecisely estimated.

  And the programme has already measured the size of the term: **a 0.427→0.530
  swing from spawn geometry alone.** That is the instance distribution moving the
  answer by more than most of the effects being argued about.

  **R-12.** *Every fitted or tuned number is the argmin of an expectation over a
  population of instances. Name the population in the number's provenance, or the
  number solves no stated problem — and it generalises exactly as far as the draw
  does.* This is the common root of five things the survey has recorded
  separately: the undeclared seed population (here), extrapolation error's
  in-distribution/out-of-distribution split (domain 31), instance-space coverage
  (domain 26), Nash averaging's population redundancy (domain 9), and ruling 49's
  own worry that "the space is explored at low density".

### C63. We compare by running to completion; the field races, caps, and pays a named price for it

Two halves, and they pull in opposite directions, which is why this is a
contradiction and not a recommendation.

  - **We can afford far more comparisons than we think.** Domain 27 asked *what
    to report when you cannot afford many games*; the configuration literature
    asks the prior question — *why are you running the losers to completion?*
    F-Race discards on a statistical test; ParamILS's dominance criterion accepts
    only on more-instances-and-lower-cost; LeapsAndBounds stops on an **empirical
    Bernstein** bound that adapts to the observed variance. On a corpus where a
    verdict is currently 4,841 games, an arm that is clearly worse can be
    eliminated in a small fraction of them, and the budget re-spent on the pairs
    that are close. **This is a procedure, where domain 27 only offered
    statistics.**
  - **But capping biases the estimator, and the field says which estimator to
    stop using.** Terminated runs are right-censored — a lower bound on cost, not
    a cost. Structured Procrastination's design decision is the loudest available
    statement of the consequence: it returns *the configuration with the longest
    total execution time* rather than the best empirical mean, on purpose. Any
    scheme that stops a game or a search early to save budget and then averages
    the completed ones has an optimistic estimate concentrated exactly on the
    easy instances.

  **The live instance for us is the CPP.** A conditional performance profile is
  compiled by running search to successive rungs under a premise. If a rung is not
  reached within the budget for some premises, and the profile averages only the
  premises that reached it, then **the profile is optimistic and increasingly so
  at deeper rungs** — which is precisely the shape that would make a saturating
  profile look like exhaustion. That is a second mechanism for domain 16's C48
  ambiguity, and it is a censoring artifact rather than a fact about the search.
  Structured Procrastination's answer is the right one to copy: **postpone hard
  instances, never discard them** — the doubling queue guarantees every instance
  is eventually run at a timeout large enough.

### C64. "Which knobs matter" is region-dependent, and the region we live in is the one where main effects are smallest

fANOVA's three columns are a warning aimed straight at the value lens's plan to
sort the twelve slots by the accounting/policy test (domain 32's M79). Same
solver, same benchmark: main effects are **88%** of raw performance variation and
**26%** of improvement-over-default variation. The interactions the whole-range
decomposition calls negligible are the ones that operate in the neighbourhood of a
good configuration.

  Our slots are already hand-tuned; we operate in the improvement-over-default
  region, not the raw-range region. **So an importance analysis that sweeps each
  knob over its full range will over-state main effects and under-state exactly
  the interactions that bind.** Concretely: decompose over `improvement over the
  current default`, not over raw score, and expect a much less separable picture
  than a full-range sweep would suggest.

### C65. Our economy is DYNAMIC configuration, and DAC's second prerequisite is a state description we do not emit

The time economy does not pick one setting per game — it re-decides tranche
allocation *during* the search from the search's own progress. In this taxonomy
that is not configuration at all; it is **dynamic algorithm configuration**, whose
output is a **policy** over `(instance features I, internal state features Q)`.

  DAC's stated prerequisite (2) — *runtime information must be provided describing
  the current state of the target algorithm* — names our gap precisely. The TIME
  lens has already scoped one instance of it (the margin column *"needs an
  engine-side emitted field"*). This generalises that from a single field into a
  **declared state vector**, and says why it is a prerequisite rather than an
  enhancement: **without `Q` there is no policy to learn, only a configuration to
  pick.** DAC's own examples of `Q` — current iteration, current restart number,
  current solution quality — map onto ours one for one: quanta spent, re-base
  count, current incumbent margin.

  It also lands on domain 29's one-index claim from a sixth direction: DAC's two
  feature families are *exactly* the static premise coordinate and the
  quanta-spent coordinate the CPP already conditions on.

### M87. Ablation gives ruling 49's provenance the shape it is missing: a path, with a measured contribution per step

Ruling 49 asks a fitted number to arrive "as a member with provenance". Ablation
analysis is what provenance looks like when it is an artifact rather than a
sentence: **an ordered list of single-parameter changes from the previous default
to the new configuration, each with its measured contribution**, accounting for
>95% of the gain in the published scenarios.

  Three reasons this is the right artifact for us specifically:
  - it is **exactly the ruling-49 shape** — a member is admitted with the evidence
    for *its own* contribution, not for the bundle it arrived in;
  - it **falsifies bundles**: if six coefficients change together and the ablation
    path shows five contribute nothing, five members should not be admitted;
  - it **reuses the arm-vs-arm harness that already exists**. Greedy ablation over
    `k` differing parameters is `O(k²)` comparisons — for twelve slots, at most 78
    — and each comparison is racially cappable per C63, so the cost is far below
    the naïve figure.

### M88. Coordinate-wise tuning is empirically near-optimal — and the hypothesis is checkable, so assert it

**Pushak & Hoos, "Algorithm configuration landscapes: more benign than expected?",
PPSN 2018 (best paper)**, and the **GPS** configurator built on it (Pushak & Hoos
2020). Their finding: across real solvers, individual parameter responses **and
the full configuration landscapes were statistically indistinguishable from
uni-modal at the 95% level**, and *"optimising each hyper-parameter independently a
single time, in a random order, often yields final incumbents statistically tied
with optimal"*. GPS is built on the two assumptions this licenses: parameters are
uni-modal, and most parameters do not interact strongly.

  `[+]` **This corroborates a lot of our practice at once** — the coordinate-ascent
  ICM fallback in the cluster search, the plan to sort slots one at a time, and the
  general habit of moving one knob and re-measuring. The field's answer to "isn't
  coordinate-wise search naïve?" is *empirically, usually not*.

  But it is an **empirical regularity about solver parameters, not a theorem**, and
  fANOVA's own 45% interaction figure is the counterweight. So it is an R-6
  hypothesis: **the decomposition is licensed under a condition, the condition is
  checkable, and the check is cheap.** Sweep one slot at a fixed setting of the
  rest and test uni-modality; that is one existing sweep per slot, and it converts
  "we tune one at a time because it is easy" into "we tune one at a time because
  the response is uni-modal, and here is the test".

### M89. The doubling queue — the ratio-2 constant's third literature

Domain 2's M5 recorded geometric tranches with ratio 2 as a fitted value whose
provenance is a theorem (Zilberstein's reduction, penalty ≤4). Structured
Procrastination reaches the same constant independently for the *configuration*
problem: an overrun instance returns to the queue with **double** the timeout, and
the resulting procedure is runtime-optimal up to a logarithmic factor.

  Three literatures now put the same constant on the same operation (anytime
  contract-to-interruptible reduction; our own tranche design; configuration under
  unknown per-instance hardness). That is the strongest provenance class the
  survey has found for any of our numbers, and it is worth stating in exactly the
  form ruling 49 wants: **`ratio = 2` is not a swept value, it is a member whose
  provenance is three convergent optimality results.**

### M90. Empirical Bernstein stopping is the few-run procedure domain 27 could not name

Domain 27 recommended what to *report* under few runs. LeapsAndBounds supplies
what to *do*: allocate per-phase budgets by an empirical-Bernstein bound that uses
the observed **range and variance** rather than a pre-committed `n`. That is the
variance-adaptive form of the value lens's minimum-detectable-effect work (domain
30's R-9): instead of asking "how many games do I need for an MDE of `x`", it asks
"have I seen enough variance-adjusted evidence to separate these two yet", and
stops when the answer is yes. It composes with the stratified bootstrap they have
already built, because both are statements about the same variance.

### M91. "Set configuration" is a taxonomy axis — R-4's fifth independent arrival

R-4 (reduction returns a set with dominance conditions, not a scalar) was argued
from maximality, α-vectors, contrastive explanation, and the Pareto front. Here it
appears a fifth time, in a *different layer*: the AC taxonomy's `candidate output`
axis has **`set configuration`** as a first-class value, and the multi-objective
configurators (MO-ParamILS, S-Race, SPRINT-Race) return a Pareto front over
configurations rather than a winner.

  The survey's own open problem is worth quoting because it is our problem: it
  notes that multi-objective AC still lacks methods "generating configurations that
  target specific areas of the Pareto front", and that one should consider **"the
  Pareto front of the target algorithm in addition to (or instead of) a Pareto
  front over configurations"**. Those are our two levels exactly — the plan set
  (domain 33) and the member set (ruling 49) — and the field says they are
  different objects that get conflated.

---

## 36.4 The counter-argument

The obvious objection: **this literature configures algorithms whose cost is a
scalar (runtime, or solution quality) measured on instances that can be re-run
identically.** Ours is a two-player game against an adversary drawn from a
population we also control, with a cost that is a win rate — so equation (1)'s `P`
is not just an instance distribution, it is a *joint* distribution over boards,
seats, seeds **and opponents**, and the opponent half is endogenous (domain 9's
population distortion; domain 25's non-transitivity).

That is a real disanalogy and it makes the mapping harder, not weaker, in a
specific way: **it means our `P` is even more load-bearing than the field's**,
because a configuration tuned against a fixed roster is tuned against a
distribution the roster's own composition determines. Nash averaging (domain 9)
and PSRO (C30) exist precisely to make that distribution well-defined. So the two
findings compose: **C62 says name `P`; domain 9 says that for us naming `P`
requires an equilibrium over the roster, not a list of arms.** Anything less and
the configured numbers are fitted to the roster's redundancy.

The second objection — "we do not have the compute to run a configurator" — is
answered by C63 and by fANOVA's own cost line: the importance decomposition runs
**on already-logged runs, in seconds**. Nothing in M87, M88 or C64 requires a
configurator. They require reading the logs we already have with the right
decomposition.

---

## 36.5 Verdicts

- **OWNER / VALUE / MEASUREMENT — R-12, and it upgrades the seed-population
  finding from hygiene to objective:** a configured number is the argmin of an
  expectation **over a population of instances**, so the population belongs in the
  provenance tuple `(Θ, c, m, I_train, P, budget)`. Your §4 statement is exactly
  right and the field's formalism says where the defect sits: not in the report,
  in equation (1). With a **0.427→0.530 swing from spawn geometry alone** already
  measured, the undeclared `P` is one of the largest uncontrolled terms in the
  programme.
- **MEASUREMENT / TIME — race and cap, but stop averaging survivors.** You can
  afford far more comparisons than the current all-games-to-completion protocol
  implies (F-Race; ParamILS's more-instances-**and**-lower-cost dominance
  acceptance; empirical-Bernstein phase budgets). The price is **right-censoring**,
  and the field's loudest statement of it is that Structured Procrastination
  deliberately returns the configuration with the **longest total execution time
  rather than the best empirical mean**. **Live hazard: the CPP.** If deep rungs
  are only reached on easy premises, the profile is optimistic at depth — a second,
  purely statistical explanation for C48's ambiguous saturation. Copy SP's rule:
  **postpone hard instances with a doubled timeout; never discard them.**
- **VALUE — decompose importance over the right region.** fANOVA gives main
  effects **20–88%** of variance and pairwise interactions **up to 45%**, computed
  **in seconds on already-logged runs**. But the same scenario reads **88%** on raw
  performance and **26%** on improvement-over-default. We live in the second
  region. Sorting the twelve slots by a full-range sweep will over-state main
  effects and hide the interactions that actually bind.
- **VALUE / OWNER (the ruling-49 artifact) — provenance is a PATH.** Ablation
  analysis explains **>95%** of the gain between a default and a configured
  setting as an ordered list of single-parameter changes with a measured
  contribution each. That is the member-with-provenance artifact in runnable form,
  it falsifies bundles (five of six coefficients contributing nothing means five
  members should not be admitted), and it is `O(k²)` comparisons — ≤78 for twelve
  slots — on the arm-vs-arm harness that already exists.
- **VALUE / SEARCH `[+]` with an assertion attached:** coordinate-wise tuning is
  empirically near-optimal — parameter responses are **statistically
  indistinguishable from uni-modal at 95%**, and optimising each parameter once in
  random order is often **statistically tied with optimal**. That corroborates the
  ICM fallback and the one-slot-at-a-time habit. It is a regularity, not a theorem,
  so R-6 applies: sweep one slot at fixed others and **test uni-modality**, which
  converts a convenience into a licensed decomposition.
- **TIME — name what the economy is: dynamic algorithm configuration.** Its output
  is a **policy** over `(instance features, internal state features)`, and DAC's
  stated prerequisite is that the target algorithm **emit a runtime state
  description**. Your scoped margin-column item is one field of that vector; the
  general requirement is that without the state there is no policy to learn, only
  a configuration to pick. DAC's own `Q` examples — iteration, restart count,
  current solution quality — are our quanta spent, re-base count and incumbent
  margin, which is domain 29's one index arriving from a sixth direction.
- **ALL — R-4's fifth arrival, one layer up.** `set configuration` is a first-class
  output type in the AC taxonomy, and the field's own open problem is that the
  **Pareto front of the target algorithm** and the **Pareto front over
  configurations** are different objects that get conflated. Those are our plan set
  (domain 33) and our member collection (ruling 49). Keep them separate by name.
