# PRIOR ART 47 — the fourteen laws are three disciplines, and the taxonomy finds two gaps

The survey's laws have accumulated one at a time, each from the domain that
produced it, and there are now fourteen. That is too many to hold, and the number
is misleading: **most of them are the same discipline applied at a different
layer.**

This is the survey's second synthesis document (after domain 29's one-index
claim). Like that one, it earns its place only if the structure *does work* rather
than tidying. It does two things:

- it says **which laws are instances of which**, so a lens that discharges the
  general form gets the instances for free rather than treating fourteen
  obligations as fourteen pieces of work;
- and the taxonomy **finds two gaps** — a family with no member for the TIME joint
  (which domain 39's C74 fills), and a missing law about quantities that belong to
  a *set* of decisions rather than to any one of them, stated here as **R-15**.

---

## 47.1 The three disciplines

### A. Name the precondition — *"this argument has a hypothesis; say it and check it"*

| law | the layer it applies at | the precondition |
|---|---|---|
| **R-6** | **the general form** | every soundness argument names a hypothesis, and prose does not fail — make it an executable assertion |
| **R-5** | the decomposition argument | decomposition is unsound under imperfect information; the hypothesis is *perfect information* |
| **R-12** | a fitted number | it is the argmin of an expectation **over a population**; name the population |
| **R-13** | an annotation | it may be reduced before combining **iff** the reduction is a semiring homomorphism |
| **R-14** | the search's value | more search helps **iff** sibling values are correlated |
| **R-10** | a statistic | it has invariances; check them **against the hypothesis**, not only against the data |

**The structural claim: R-6 is the general form and the other five are its
instances at five layers.** Each names a *checkable* precondition of an argument
the design relies on, and each is discharged the same way — write the hypothesis as
an assertion that fires when it stops holding.

  **Why this is worth stating.** The programme's own diagnosis (*"a value and the
  premise it was computed under travel separately"*) produced a remedy that
  protects **values**. Every law in this family says the same thing about
  **arguments**: an argument has premises too, and they outlive their truth
  silently. Five separate findings, one habit.

  **And it makes the obligation finite.** R-6's own list was five recorded defects;
  this family says the *complete* obligation is: for each of the five layers, one
  assertion. Not fourteen items of work — **five assertions and one habit**.

### B. Do not collapse before you must — *"premature reduction destroys what you needed"*

| law | what gets collapsed too early | what is lost |
|---|---|---|
| **R-4** | the reduction's output, to a scalar | the option set, its dominance conditions, the Centaur surface, VOI, and (d46) soundness under fog |
| **R-3** | the option set, by an unadaptive cap | the bound on what was removed |
| **R-2** | shared sub-results, without declared edges | compositional accounting |
| **R-1** | the record of a computation, to *where* it read | the ability to cut early |
| **R-13** | the annotation, before combining | the structure needed to refine, unless the map is a homomorphism |

**R-13 sits in both families, and that is informative rather than untidy**: it is
the only law that says *exactly when* early collapse is safe. Family B is otherwise
a set of cases where it is not, and R-13 is the general test.

  **The family's shape is a single sentence:** *keep the richer object until the
  moment you are forced to reduce, and when you reduce, carry the bound on what the
  reduction lost.* R-3 is that sentence about option sets; R-4 about the answer; R-1
  about the trace; R-2 about the accounting; R-13 about the annotation.

### C. Measure honestly — *"the instrument has properties of its own"*

| law | the instrument's property |
|---|---|
| **R-8** | a statistic bounded above **saturates** and manufactures structure |
| **R-8b** | a statistic pinned at a boundary **cannot gradate**, so it cannot rank |
| **R-8c / R-9** | ask what the statistic's **limit** is as the data grows and the effect goes to zero |
| **R-10** | check the statistic's **invariances** against the hypothesis |
| **R-11** | **stratify** before pooling — an aggregate can be zero, or the wrong sign, because two opposite things happen |

**R-9 is this family's general form**, exactly as R-6 is family A's: *before using a
number to make a decision, ask what it does when the thing you care about goes
away.* R-8, R-8b and R-8c are its three recorded faces; R-10 and R-11 are two more.

  Note the family's provenance, which is unusual and worth keeping: **every member
  was produced by a measurement that fired misleadingly** — a bounded win
  probability manufacturing a cycle, a boundary-pinned `β̂` unable to rank, a
  spend-denominated noise floor scoring a thrice-dead cell alive, a rank meter blind
  to the hypothesis it was registered for, a pooled correlation with the wrong sign.
  **Five instruments, five different failures, one question that would have caught
  all of them.**

### And one that is not a discipline: R-7

**R-7 (the architecture's value is OPTION VALUE, and it is priced)** is the only
law that is an *economic claim about the programme* rather than a rule for doing
the work. It belongs on its own, and it is the one that answers *why do any of
this* — Baldwin & Clark's formula says modularity's value rises with the
uncertainty (σ) of what each module might become and falls with the cost of
experimenting on it, which is precisely the case ruling 49 is trying to make.

---

## 47.2 Gap one: family B has no member for the TIME joint, and C74 fills it

Family B has a member for the option set (R-3), the answer (R-4), the trace (R-1),
the accounting (R-2) and the annotation (R-13). **It has none for time.** But the
same sentence is meaningful there and the survey has already found its content
without naming it as a law:

- domain 39's **C74** — the transfer-of-control literature's `D` action, *"reordering
  tasks to buy time to make the decision"*: **prefer a plan whose commitment point
  is later**, so information that arrives before the commitment can still be used;
- domain 37's **M93** — Stockfish begins no new iteration past 50% of the budget,
  because a rung is a *contract* algorithm whose marginal value is its value times
  `P(finish)`;
- domain 45's **C93** — a depth-`d` search run every `d` moves is *the same compute
  rearranged*: **longer commitment is not more search**, and it is pathological more
  often than not.

Together those say: **commitment is a collapse like any other, and the family's
rule applies to it unchanged.** *Do not commit before you must, and when you
commit, carry the bound on what the commitment cost.* That is R-3's shape with
*time* in place of *options*, and it unifies three findings that arrived from three
different literatures.

  This is not proposed as a new law — it is family B's existing rule, applied at a
  layer where the survey had found the instances but not connected them. **The
  useful consequence is that the buy-time action, the 50% rule and the commitment
  window are one design question, not three.**

## 47.3 Gap two: R-15, the quantities that belong to a SET of decisions

Every law above governs either an argument, a reduction, or an instrument. **None
governs a quantity that has no per-decision meaning at all** — and the survey has
now found at least five of those:

| quantity | domain | why it is not per-decision |
|---|---|---|
| the surfaced set's **positive predictive value** | d44's C90 | at PPV 0.3 operators ignored *about half the true alarms*; the cost of one extra surfacing lands on **future** interactions |
| a closure's **interference rate** | d35's M84 | *"how often does it remove the plan the search would have chosen"* is a rate, not a property of any removal |
| the ε of an **ε-approximate Pareto set** | d33 | ε bounds the **set**; no member carries it |
| the **risk budget** (ε-as-a-ledger) | d15's C45/C46 | *"risk at most what has been earned over the equilibrium in previous rounds"* is an accounting over a sequence |
| the **minimum detectable effect** | d30's R-9 | a property of the experiment, not of the comparison |

> **R-15. Several of the architecture's most important quantities are properties of
> a SET of decisions and have no per-decision meaning. A rule that optimises each
> decision in isolation will drift the set-level quantity without any single
> decision ever looking wrong — which is why the drift is not caught by review.
> Such a quantity must be held as a CONSTRAINT over a window, measured over that
> window, with the per-decision rule optimising inside it.**

  **The failure mode is what makes this worth a law**: there is no locally wrong
  step. Every individual surfacing can be justified by its four utilities while the
  surface's PPV slides to the point where the operator stops responding; every
  individual closure removal can be justified while the closure quietly becomes a
  policy; every individual deviation from the floor can be justified while the risk
  budget is exhausted. **Review looks at decisions, and the defect is not in any
  decision.**

  **And the remedy has one shape across all five**: a window, a measured
  set-statistic, and a per-decision rule that optimises *subject to* holding it.
  That is d44's C90 (hold PPV above a floor; optimise utilities within), d15's
  ledger (spend only what was earned), d33's ε (choose the set size, state the
  loss), and d35's M84 (count interference, then decide). **Four findings that
  looked unrelated are one pattern, and the pattern has an implementation.**

---

## 47.4 What the map is for

Three uses, in the order a lens would want them:

1. **Discharge the general form, not the instances.** Family A costs *five
   assertions and one habit*, not six pieces of work. Family C costs *one question
   asked of every new column*. Family B costs *one design review question*: what is
   being collapsed here, and does the collapse carry a bound?

2. **Read a new finding into a family.** Nearly every contradiction in this survey
   is an instance of one of the three, and knowing which tells you what kind of fix
   it needs: family A ⟹ write an assertion; family B ⟹ delay the collapse or bound
   it; family C ⟹ change the instrument. That is a faster route to action than
   reading the domain.

3. **Look for the missing member.** Both gaps above were found by asking *"which
   layer has no member of this family?"*, and both turned out to be real — one
   unified three existing findings, and one produced a law. The families are small
   enough that the question is cheap to keep asking.

---

## 47.5 The counter-argument

**Taxonomies of one's own output are the classic way to feel productive without
being useful**, and the risk is real: a lens could read this instead of the domain
and lose the argument that makes the law credible. Two guards, and they are why
this document is short:

- **every law keeps its domain reference**, and the domain is where the evidence
  lives. The map is an index, not a replacement.
- **the map is only worth its length if it produces something**, and the test of
  that is §47.2 and §47.3 — a unification and a new law. If a future revision of
  this document adds structure but produces nothing, it should be deleted rather
  than extended.

A second, sharper objection: **three families is a suspiciously tidy number for
fourteen laws produced independently.** It may be that the tidiness reflects the
surveyor rather than the field. The honest response is that the families were not
chosen — they fell out of asking, for each law, *"what does discharging it cost?"*,
and the three answers were *write an assertion*, *delay the collapse*, and *check
the instrument*. If a fifteenth law does not fit those three, that is evidence
against the map and should be recorded as such rather than accommodated.

---

## 47.6 Verdicts

- **ALL — the fourteen laws are three disciplines plus one economic claim**, and
  the practical consequence is that the obligation is far smaller than the count
  suggests. **Family A (name the precondition)**: R-6 is the general form and R-5,
  R-12, R-13, R-14, R-10 are its instances at five layers — cost is *five assertions
  and one habit*. **Family B (do not collapse before you must)**: R-4, R-3, R-2,
  R-1, R-13 — cost is *one design-review question*, "what is being collapsed here,
  and does the collapse carry a bound?". **Family C (measure honestly)**: R-9 is the
  general form and R-8, R-8b, R-8c, R-10, R-11 are its faces — cost is *one question
  asked of every new column*. **R-7 stands alone** as the economic claim about why
  any of this is worth doing.
- **TIME (gap one) — the buy-time action, the 50% rule and the commitment window
  are ONE design question.** Family B had no member for time, and three findings
  from three literatures supply it: **prefer a plan whose commitment point is
  later** (d39's C74), **begin no rung you cannot finish** (d37's M93), and **longer
  commitment is not more search, it is the same compute rearranged** (d45's C93).
  Family B's rule applies unchanged — *do not commit before you must, and carry the
  bound on what the commitment cost.*
- **ALL (gap two) — R-15: several of the architecture's most important quantities
  are properties of a SET of decisions and have no per-decision meaning.** The
  surfaced set's PPV, a closure's interference rate, an ε-approximate Pareto set's
  ε, the risk budget, and the minimum detectable effect. **The failure mode is that
  there is no locally wrong step** — every individual decision is justifiable while
  the set-level quantity drifts past the point where it matters, which is why review
  does not catch it. **The remedy has one shape across all five: a window, a measured
  set-statistic, and a per-decision rule that optimises subject to holding it.** Four
  findings that looked unrelated are one pattern with one implementation.
- **A STANDING TEST FOR THIS DOCUMENT:** if a fifteenth law does not fit the three
  families, that is evidence against the map. Record it as such rather than
  extending the taxonomy to accommodate it.
