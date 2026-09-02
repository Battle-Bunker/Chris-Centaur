# PRIOR ART 22 — the theory of carving at joints

Domain: the literature that asks our *actual* question — **what makes one
decomposition of a design space better than another?** — rather than supplying a
member for one of our joints.

The mandate (ruling 49) is: *"an elegant core machine that carves the design space
at its joints, so a large space of explored ideas AND BEYOND configures naturally
by plugging functions into a small number of powerful joints with flexible
APIs."* Two mature bodies of work say precisely what that sentence should mean,
and one of them gives it a **valuation formula** that explains the value lens's
population measurement.

---

## 22.1 Load-bearing sources

**S47. Parnas, "On the criteria to be used in decomposing systems into modules",
*CACM* 15(12) (1972).** The founding criterion: decompose by **what each module
hides**, and hide **the design decisions most likely to change**.

**S48. Baldwin & Clark, *Design Rules, Vol. 1: The Power of Modularity* (2000),
and *The option value of modularity in design*.** Modularity as a portfolio of
**real options**; the six **modular operators** (splitting, substituting,
augmenting, excluding, inverting, porting); design rules as the **visible** layer
that hidden modules must obey; and a **net option value** formula.

---

## 22.2 What the experts decided

### (a) Parnas: the criterion is changeability, not structure

The 1972 result, still the field's default: *"every module is characterized by its
knowledge of a design decision which it hides from all others. Its interface or
definition was chosen to reveal as little as possible about its inner workings."*
And the selection rule: **hide the decisions most likely to change** — data
formats, I/O, hardware, OS. The paper's whole force is that this yields a
*different and better* decomposition than the obvious one (which in 1972 was by
flowchart step).

### (b) Baldwin & Clark: modularity is a portfolio of options, and it is priced

A modular architecture splits a design into **visible** parts ("design rules"
every hidden module must obey) and **hidden** parts (decisions that do not affect
other modules). The value of that split is the **option to substitute a better
module later**, and it is valued like a financial option. Their stated drivers of
a module's **net option value**:

1. its **technical potential** `σ` — *"labeled σ because it operates like
   volatility in financial option theory"*: how much better a replacement module
   might plausibly be;
2. the **cost of mounting independent design experiments** on it;
3. the module's **visibility** — how much other work a change to it forces.

And: *"the option value of a system of modules can be approximated by adding up
the net option values inherent in each module and subtracting the cost of
creating the modular architecture."*

The **six modular operators** are the moves a modular architecture makes
available: splitting, substituting, augmenting, excluding, inverting, porting.

---

## 22.3 Mapping onto our joint

### The valuation formula explains the value lens's null, and rescues the pitch

**M59. Baldwin & Clark's σ is exactly what the VBS−SBS measurement estimated, and
their formula says why the null does not indict the architecture.** The value
lens measured excess VBS−SBS ≈ −0.008 over the main lineage and concluded
"hygiene, not strength". Read through the option model:

  - net option value scales with **σ, the technical potential** — the spread of
    what might plausibly be plugged in;
  - the pool measured has `slider/territory` correlating at **+0.996**;
  - **a pool of near-duplicates has σ ≈ 0 by construction**, so the option value
    of the architecture *measured over that pool* is near zero **whatever the
    architecture is worth**.

  So the theory says the measurement was, necessarily, a measurement of the
  pool's volatility and not of the architecture's value. That is a stronger and
  more precise statement than my domain 21 §21.2, and it converts the honest
  branch into a *quantified* claim rather than a hedge: **the architecture's value
  is the option value of members that do not yet exist, and its size is governed
  by σ, which is a property of the design space rather than of the current
  roster.**

  It also names the two other levers explicitly, and both are things we control:
  **the cost of an independent experiment on a joint** (which every one of the
  composition lens's increments reduces — the generated diff, the addressed bot,
  `verify-null`), and **visibility** (how much a change to one joint forces
  elsewhere — which is the DAG/tree question from R-2). The architecture is
  worth more exactly to the extent that it lowers experiment cost and lowers
  visibility, and both of those are *measurable on our own history*.

### The criterion we used is not Parnas's, and the difference is testable

**C52. Our joints are carved by the game's irreducible facts; Parnas says carve by
what changes independently — and nobody has checked whether those coincide.**
The composition synthesis argues its five kinds are "one-to-one with the game's
irreducible facts": a shared deterministic transition system (MODEL); simultaneous
moves requiring a reduction (REDUCTION); a product action space (ACTION); an
anytime interruptible decision (ECONOMY); and taste (VALUE). That is a *domain
ontology* argument, and it is a good one — but it is a **different criterion** from
the one the field has used for fifty years, and the two can disagree.

  The disagreement is not hypothetical here. Two of our own findings say the
  kinds do *not* change independently:
  - **REDUCTION and VALUE are coupled**: the belief lens's dilemma 3 is precisely
    that ε (REDUCTION) changes deep VALUES, and the composition lens's B7
    falsifier tests whether the two are discounting the same uncertainty twice.
    Under Parnas that coupling is evidence they are not two modules.
  - **ACTION and ECONOMY are coupled**: progressive widening (domain 13) makes
    the admitted set a function of the allowance spent, and coordination-graph
    selection (domain 17) makes the closure algorithm a function of the budget.
    An admission rule that reads the clock is not hidden from the economy.

  **And the test is cheap and empirical: mine our own change history.** A **design
  structure matrix** built from git co-change — which files/joints are edited in
  the same commit — is the standard instrument for "what actually changes
  together", and we have four months of dense history in a repo where the
  refactors are documented. If the co-change clusters do not line up with the five
  kinds, the carve is at the domain's joints but not at the *design's* joints, and
  those are different things. That would not necessarily be wrong — a carve at the
  domain's joints may be worth keeping precisely because it is stable while the
  code churns — but it should be a **known and argued** difference rather than an
  unnoticed one.

### The operators name moves our design has and moves it lacks

**M60. Five of the six modular operators are in the design; the sixth is the one
the survey keeps asking for.**

| operator | our form |
|---|---|
| **splitting** | the joint manifest itself — splitting the bot into joints |
| **substituting** | `Choice = fixed`; swapping a member |
| **augmenting / excluding** | the member collections + the reachability law (seat it or delete it) |
| **porting** | the vendored engine, the harness/production split |
| **inversion** | **absent** |

  **Inversion** is Baldwin & Clark's operator for taking a capability that several
  hidden modules each re-implemented and *lifting it into the visible design
  rules*. Every "written three times" defect on our record is a missing inversion:
  the adjudication rule (three implementations, three disagreements), the movement
  grammar (bot re-derives, UI does not), the joint list (enumerated five times),
  the opponent treatment (four consumers improvising). Domain 11's "one rules
  artifact" and domain 5's "generate the codec from the manifest" are both
  inversions, and naming the operator makes the pattern searchable: *what else is
  implemented more than once inside hidden modules?* That question has found four
  defects already and is cheap to keep asking.

**M61. "Design rules" is the right name for what the manifest is, and it carries
an obligation we have not stated.** In Baldwin & Clark, the visible layer is
small, stable and *expensive to change*, precisely because everything hidden
depends on it. Our manifest is being designed as generated, versioned and
diffable — good — but nothing in the design says the visible layer should be
**small and stable**, and the survey has been steadily adding to it (a fifth
premise coordinate, a contract/interruptible column, hypothesis assertions, value
hashes, durability levels). Each is justified individually. The option model says
the *total* size of the visible layer is a cost paid by every hidden module, and
should be argued as a budget rather than accumulated one addition at a time.
**A visible-layer budget is a design law worth adopting before the manifest is
built, not after.**

---

## 22.4 Verdicts

- **COMPOSITION / OWNER (the pitch, restated in a form that survives the
  measurement):** the architecture's value is **option value**, and Baldwin &
  Clark's formula says it scales with `σ` — the technical potential of what might
  be plugged in — with the **cost of an independent experiment** and the module's
  **visibility** as the other two drivers. A VBS−SBS null measured over a pool
  containing a +0.996 duplicate pair is a measurement of σ ≈ 0 *for that pool*,
  not of the architecture. So the honest pitch is not "hygiene": it is **the
  option value of members that do not yet exist**, and the two levers we control
  are lowering experiment cost (which every composition increment does) and
  lowering visibility (which is R-2's DAG/tree question).
- **COMPOSITION:** our carve criterion is *the game's irreducible facts*;
  Parnas's is *what changes independently*. Both are defensible and they are not
  the same, and we have two findings suggesting our kinds are coupled
  (REDUCTION↔VALUE via ε; ACTION↔ECONOMY via widening and budget-dependent
  closure). **Mine the git co-change matrix** — a design structure matrix over
  four months of dense, documented history — and compare the empirical clusters
  against the five kinds. If they disagree, say so and argue for the domain carve
  deliberately; do not inherit the coincidence.
- **COMPOSITION:** add **inversion** to the vocabulary. Every "written N times"
  defect on our record is a missing inversion, and the operator turns a recurring
  discovery into a question that can be asked on purpose: *what else is
  implemented more than once inside hidden modules?*
- **COMPOSITION:** adopt a **visible-layer budget**. Everything hidden pays for
  the size of the design rules, and this survey alone has proposed five additions
  to it. Argue the total, not each addition.
