# PRIOR ART 43 — response to the index inversion: the missing column, the stronger Law T, and a rider that detects but does not correct

Written against `design/joints-composition` @ `373916d` (*"The index inversion,
specified — and the index is a product, not a lattice"*), which corrects domain 29
in a way I should have found and adds two laws.

Four responses. The first is a concession, the second and third are cheap
additions to a table that is about to be encoded **as data** (their X1) and is
therefore much cheaper to get right now than later, and the fourth says a rider
they wrote is correct and under-powered.

---

## 43.1 The correction is right, and it has a name

> *"'One index' does not mean 'one lattice.' It means one tuple whose components
> have their own structures; the operations lift componentwise and are undefined
> where a component does not support them."*

**This is right and it is better than my framing.** Domain 29 argued that seven
named things are one coordinate system and offered three tests for it; it did not
say what algebra the object has, and by not saying, it implied a uniform one. Their
operations table is the correction, and their own reading of it — *"a design that
assumed uniform operations would, for instance, try to widen `botId`"* — is exactly
the failure my under-specification invited.

The construction has a standard name and it is worth having, because it says the
correction is not a special case: **a product of lattices, with operations lifted
componentwise, is the standard way to build a composite abstract domain** (d42's
framework), and the fact that some components are *flat* (equality only, no order
worth using) while others are ordered is normal rather than awkward. Their
`config.bot / codeRef / seat` row — *"none / none / no / persists — equality-only:
you cannot average two bots"* — is precisely a **flat lattice**, and flat lattices
are the standard component for exactly this purpose.

  **[+]** And their consequence 2 is the payoff domain 29 predicted without being
  able to name: *"the ECONOMY lever menu must be generated from this table, not
  written by hand — which is exactly the defect `voc.ts` has today, where a stale
  unit is offered only `catchup` because the preconditions were written per-lever
  rather than derived."* That is the one-index claim producing a bug fix, which is
  the strongest form of evidence for it.

---

## 43.2 C86. The table is missing a column, and the framework says which rows need it

The operations table has `join` / `meet` / `tighten` / `advance`. It does not have
**termination**, and domain 42's C85 says that is the column the framework would
insist on:

> A **widening** is present in an abstract interpreter for exactly one reason: to
> guarantee that a fixpoint iteration terminates in a domain with infinite
> ascending chains. Where the lattice has **finite height**, no widening is needed
> and none should be added (it only loses precision).

So the column is *"does this coordinate's lattice admit infinite ascending chains,
and therefore require a widening?"*, and the answer is **not uniform** — which is
their own point, applied to an operation their table does not yet list:

| coordinate | height | needs a widening? |
|---|---|---|
| `config.bot / codeRef / seat` | **flat** — finite | **no**, and adding one would be a category error |
| `config.opponents / corpus / regime` | finite (a set) | **no** |
| `observable.horizon` | finite (bounded by the deepest rung) | **no** |
| `support.model`, `support.replies` | finite per turn (finitely many worlds/replies) | **no within a turn** |
| `observable.provenance` | grows with admission trace / conditioning depth | **yes, if it can grow without bound across turns** |
| `measure.range` (mixture over histories) | **unbounded** — histories accumulate | **yes** |
| the **value interval** the index carries | **infinite** (reals) | **yes** |

  **Two things fall out, and both are cheap now and expensive later.**

  1. **The termination obligation is per-coordinate, and only three rows carry
     it.** That is a much smaller obligation than "prove the whole thing
     terminates", and it is discharged by naming, for each of those three, either
     a bound or a widening operator.
  2. **`BOUND_RELATIVE_EPSILON` is about to be promoted.** Their Law T
     implementation *"weaken[s] to the midpoint within tolerance"* and refuses on
     `lo > hi + BOUND_RELATIVE_EPSILON` — and X4 lifts `tighten` **out of the bank
     into the index module**. So a constant introduced in the bank as a *rounding*
     fix becomes a shared operator of the general index machinery, still
     undocumented as the widening it is. **The moment to write down what it
     guarantees is the moment it is hoisted**, not after five consumers depend on
     it.

  This does not contradict anything in their spec. It adds one column to a table
  they are encoding as data, and the column has three non-trivial entries.

---

## 43.3 C87. Law T specifies the DIRECT product, and the REDUCED product is strictly stronger — and X4 is the moment

> **Law T.** *Index equality licenses tightening: values at an equal index compose
> to a tighter bound rather than merely becoming comparable.*
> Implementation: `lo = max(a.lo, b.lo)`, `hi = min(a.hi, b.hi)`.

Componentwise max/min on two intervals is the **direct product** of two abstract
domains: each keeps its own answer and the meet is taken pointwise. Cousot &
Cousot's **reduced product** lets each domain *refine the other before the meet*
and is **strictly more precise** (d42's C84).

  And the canonical illustrating example is **ours, with both operands already in
  hand**: domain 7's **V-3 checkerboard parity bound** is a *congruence* (the
  reachable count has a known parity); the cell-count bound is an *interval*.

  - **Law T as specified**: `[3,5]` ∧ "even" → `[3,5]`.
  - **Reduced product**: `[4,4]`.

  So Law T is correct and incomplete: *values at an equal index compose to a
  tighter bound* — but the composition it specifies is not the tightest sound one
  when the two values come from **structurally different** bound families.

  **Why this is an X4 item rather than a later one.** X4 hoists `tighten` out of
  the bank and makes a cross-horizon `tighten` a type error. That is exactly the
  right moment to decide whether `tighten` is a **binary operation on two
  intervals** or a **dispatch over the pair of bound families** — because the first
  is a signature every caller will be written against, and adding the second later
  means touching all of them. The minimal version costs almost nothing: keep the
  bound's *family* alongside its interval, and let `tighten` consult a small table
  of reduction rules, empty at first except for `interval × congruence`.

  **Their two guards survive unchanged and are right.** `tighten` on the sound
  channel only, and non-transitivity across a widening (with the `Assumption`
  record as the detector) are both properties of the *index*, not of the bound
  family, so the reduction step composes with them rather than complicating them.

---

## 43.4 [+] Law H′ is the framework's `join`, and the split between H and H′ is the framework's split

> **Law H′ (hull only).** *Across different horizons the sound channel yields the
> hull and never an intersection.* … *"`[lo₁,hi₁]` bounds the one-ply frame value
> and `[lo_d,hi_d]` bounds a **different random variable** … Intersecting them
> asserts that the two quantities are the same."*

This is exactly right and it is the framework's own rule, which is worth recording
because Law H′ has been asked for over four review rounds and can now stop being
re-litigated:

- **the hull is the abstract `join`** — the sound combination of two abstract
  states is their least upper bound, and in a numeric domain that is the hull;
- **an intersection is only sound when the two abstractions describe the same
  concrete quantity**, which is precisely the condition their kill-one-lose-two
  counterexample violates;
- and **the informative combination requires a declared relation between the two
  quantities**, which is their Law H (*"they meet only inside a fold that declares
  its discount"*).

  So Laws H and H′ are the framework's two cases, correctly split: **no declared
  relation ⟹ join (hull, usually vacuous); declared relation ⟹ a transfer function
  through the relation.** Their observation that *"the vacuity is the point … the
  sound channel has almost nothing to say across horizons, and pretending otherwise
  is where the arbitrary discounts came from"* is the framework's own reason for
  insisting the abstraction be stated.

---

## 43.5 C88. The ratification rider is right and under-powered — and my own M101 was under-specified in the same way

Their §7.2:

> *"the bot surfaces an option, a human ratifies it, and the outcome is then
> counted as evidence for the term that surfaced it. That is circular … A ratified
> surfaced option is recorded with `provenance.cause = 'surfaced-by:<memberId>'`,
> and a fit whose corpus contains such rows **must stratify on it**."*

**The hazard is real, the diagnosis is right, and it has a large literature under a
name the design should adopt: this is a *closed-loop feedback* / *presentation
bias* problem**, the central methodological difficulty of every deployed
recommender and ranker. What that literature adds is that **stratification detects
the problem but does not correct it**, and it says what does:

- **Stratification** answers *"is this corpus contaminated?"* — which is what their
  rider is for, and it is the right first move.
- **Correction requires the exposure probability.** The standard estimator is
  **inverse propensity scoring**: weight each observed outcome by `1/P(surfaced)`,
  which recovers an unbiased estimate of what would have happened under uniform
  exposure. It needs the surfacing to be *logged with its probability*, which is a
  requirement on the surfacing code, not on the fit.
- **Identification requires randomisation.** Even IPS is undefined where
  `P(surfaced) = 0` — the options never shown. The only thing that identifies those
  is a **small randomised holdout**: with some probability, surface nothing (or
  surface a random admissible option) and log that it was a holdout. This is the
  standard, cheap instrument, and it is the *only* source of unprompted rows once
  the surface exists at all.

  **The design consequence, which is a timing one:** their rider says a fit using
  only caused rows is refused. Once the surface ships, *almost every row becomes a
  caused row*, so the refusal will bind on nearly everything unless a supply of
  uncaused rows is deliberately maintained. **The holdout is that supply, and it
  has to be designed in with the surface rather than added when the refusal starts
  firing.**

  **And I owe a correction of my own.** Domain 39's **M101** claimed the operator's
  overrides are labelled data for fitting the ask/act threshold. That is true and it
  is subject to exactly this hazard: an override is only observable on an item that
  was *surfaced*, so the override corpus is conditioned on the surfacing policy, and
  fitting `p*_{D,A}` on it without the exposure probability re-fits the threshold to
  itself. **M101 stands only with the propensity log and the holdout attached** —
  the same two instruments their rider needs, which is a point in favour of building
  them once for both.

  Their closing distinction is the right one and should be kept verbatim:
  *"ratification is evidence about the operator's preferences … and it is **not**
  evidence about the option's quality. Two different fits, two different corpora."*
  The instruments above are what make the first fit valid; nothing makes the second
  valid from ratifications alone.

---

## 43.6 Verdicts

- **COMPOSITION [+] — the product-not-lattice correction is right, better than my
  framing, and standard.** A product of lattices with componentwise operations is
  the normal way to build a composite abstract domain, and `config.*`'s
  equality-only row is a **flat lattice**, the standard component for exactly that.
  Domain 29 argued the object was one thing and did not say what algebra it had; by
  not saying, it implied a uniform one. Your consequence 2 — generating the ECONOMY
  lever menu **from the table** rather than by hand, which is `voc.ts`'s actual
  defect — is the one-index claim producing a bug fix, and that is the strongest
  evidence for it.
- **COMPOSITION (C86) — the table is missing a TERMINATION column, and only three
  rows carry it.** A widening exists to guarantee a fixpoint iteration terminates
  in a domain with **infinite ascending chains**; where the lattice has finite
  height, none is needed and adding one only loses precision. Flat `config.*`,
  bounded `observable.horizon` and per-turn `support.*` need **none**;
  `observable.provenance` (if it grows across turns), `measure.range` (histories
  accumulate) and **the value interval itself** need one. Two consequences: the
  termination obligation is **per-coordinate and small**, and
  **`BOUND_RELATIVE_EPSILON` is about to be promoted** — X4 hoists `tighten` into
  the shared index module, so a constant introduced in the bank as a rounding fix
  becomes a general operator, still undocumented as the widening it is. **Write
  down what it guarantees at the moment it is hoisted**, not after five consumers
  depend on it.
- **COMPOSITION / SEARCH (C87) — Law T specifies the DIRECT product; the REDUCED
  product is strictly stronger, and we hold the textbook instance.** `lo = max`,
  `hi = min` keeps each bound's own answer; the reduced product lets each **refine**
  the other first. **d7's V-3 checkerboard parity bound is a congruence and the
  cell-count bound is an interval** — Law T as written gives `[3,5]`, the reduced
  product gives `[4,4]`. **X4 is the moment**, because it fixes `tighten`'s
  signature for every caller: decide now whether it is a binary operation on two
  intervals or a **dispatch over the pair of bound families**. Minimal version:
  keep the bound's family alongside its interval and consult a small table of
  reduction rules, empty except for `interval × congruence`. Your two guards
  (sound channel only; non-transitive across a widening) are properties of the
  *index*, not the family, and survive unchanged.
- **COMPOSITION [+] (Law H′) — it is the framework's `join`, and the H / H′ split
  is the framework's split.** The sound combination of two abstract states is their
  least upper bound, which in a numeric domain is the hull; an *intersection* is
  sound only when both abstractions describe the **same** concrete quantity, which
  is exactly what your kill-one-lose-two counterexample violates. And the
  informative combination needs a **declared relation** between the two quantities
  — which is Law H. So: **no declared relation ⟹ hull; declared relation ⟹ a
  transfer function through the relation.** Two cases, one framework, correctly
  split — and worth recording so H′ stops being re-litigated.
- **OPERATOR / MEASUREMENT (C88) — the ratification rider is right and it detects
  without correcting.** This is **closed-loop feedback / presentation bias**, the
  central methodological problem of every deployed ranker. Stratification answers
  *"is this corpus contaminated?"*; **correction needs the exposure probability**
  (inverse propensity scoring, which requires the surfacing to be logged **with its
  probability** — a requirement on the surfacing code, not the fit), and
  **identification needs a small randomised holdout**, because IPS is undefined
  where `P(surfaced) = 0`. Timing matters: once the surface ships, **almost every
  row becomes a caused row**, so your refusal will bind on nearly everything unless
  a supply of uncaused rows is deliberately maintained. **The holdout is that
  supply and must be designed in with the surface.** Your closing distinction —
  ratification is evidence about *the operator's preferences*, not about *the
  option's quality* — is exactly right and should be kept verbatim.
- **A CORRECTION I OWE:** domain 39's **M101** ("the overrides are labelled data")
  is subject to the same hazard — an override is only observable on a **surfaced**
  item, so fitting `p*_{D,A}` on the override corpus without the exposure
  probability re-fits the threshold to itself. **M101 stands only with the
  propensity log and the holdout attached**, which are the same two instruments the
  rider needs. Build them once, for both.
