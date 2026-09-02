# PRIOR ART 26 — instance space: which cells discriminate, and how to build more

Domain: the methodology for the question the programme keeps answering by
accident — **which test instances actually distinguish between algorithms, and
how do you generate more of them?**

Motivation from our own record: the knight cell has now been diagnosed as a dead
instrument **three separate times by three independent routes** (a rules reading
of `moveGrammar.ts:27`; the outcome statistics — 48/48 games hit the cap, `elim`
exactly 0.000; and the reflex arm winning it). Each cost an investigation. The
value lens has asked for an automatic detector; this is its literature.

It also follows directly from domain 25's M64: if the best arm depends on the
board family, then **which boards** is now a first-class design question rather
than a matter of taste.

---

## 26.1 Load-bearing source

**S51. Smith-Miles et al., *Instance Space Analysis for algorithm testing:
methodology and software tools*, ACM Computing Surveys 55(12) (2023); plus
*Generating new test instances by evolving in instance space* and the MATILDA
toolset (matilda.unimelb.edu.au).**

ISA is stated by its authors as an **extension of Rice's 1976 Algorithm Selection
framework** (domain 14) — which makes it the same formalism our `Choice =
conditional` sits in, applied to the *instances* rather than to the algorithms.

The method, in four steps:

1. **Feature the instances.** Compute cheap structural properties of each test
   instance.
2. **Project to a 2-D instance space** chosen so that algorithm performance
   varies smoothly across it.
3. **Draw footprints.** An algorithm's **footprint** is the region of the space
   where it performs well *with statistical support*. Footprints make "this
   algorithm is good at X" a measured area rather than a claim.
4. **Fit a selector** — machine learning over the space to say which algorithm
   wins where — and, crucially, **evolve new instances** to fill the empty or
   under-tested regions.

---

## 26.2 Mapping onto our joint

**M66. Our "cells" are a hand-picked, unfeatured instance set, and ISA says what
is wrong with that.** We have a handful of named cells (snake6, snake5-queen,
snake5-knight, rook, potion boards) chosen by intuition, with no feature
representation, no coverage statement and no way to say what region of the
possible-board space they occupy. ISA's first two steps cost almost nothing here
because the features are all cheap and mostly already computed:

  - roster composition (unit kinds, count, weight distribution — `(K, W, p)` is
    already formed per turn under the VALUE lens's M1);
  - board geometry (size, wall density, corridor structure — the chamber/
    articulation machinery from domain 7 computes exactly this);
  - **induced width of the conflict graph** (domain 17 — already proposed as a
    measurement);
  - contested-cell density, spawn rate, team count;
  - the measured `sharePar` SD (the VALUE lens's M5 already ranks cells by it).

  With those, "which cells do we have" becomes a scatter plot rather than a list,
  and three questions become answerable that currently are not: **what region do
  our cells cover, what region is empty, and where do our arms' footprints
  differ?**

**M67. The footprint is the automatic dead-cell detector the value lens asked
for, and it subsumes the three ad-hoc detections.** A dead instrument is a cell
where **every** algorithm's footprint covers it equally — i.e. where performance
does not vary across arms. That is one statistic, computable per cell from the
same arm × cell matrix POP-1 already builds:

    deadness(cell) = the spread of arm performance on that cell,
                     relative to the within-arm noise floor on that cell.

  On the knight cell the spread is ~0 against a non-trivial floor, which is
  exactly what "reflex wins it" and "elim is exactly 0.000" and "a jump crosses no
  edge" were each detecting separately. **One column, computed automatically,
  would have caught it before any block was spent.** And it generalises: the rook
  cell, the potion boards, and any future cell get a deadness reading before they
  are used to adjudicate anything.

  Note this is *not* the same as the VALUE lens's M5 (rank cells by measured
  `sharePar` SD). M5 measures whether the *outcome* varies; deadness measures
  whether it varies **between arms**. A cell can have high outcome variance and
  zero arm discrimination (pure noise), which is the worst case for spending a
  block on it and is invisible to M5.

**M68. Evolving instances is how you get discriminating cells on purpose, and
domain 25 just told us which direction to evolve in.** Smith-Miles's *generating
new test instances by evolving in instance space* does exactly what it says:
search the feature space for instances that maximise a target property —
typically **the performance gap between two algorithms**, i.e. discrimination.
For us that is a small search over a generator we already have (board size, wall
density, roster), scored by the arm-spread statistic above.

  And the target is no longer hypothetical: the value lens measured a cyclic
  component that **reverses sign between snake and piece boards**. That is a
  direction in instance space along which arm ordering demonstrably changes, so
  the first evolved instances should be **interpolations along it** — mixed
  rosters between the snake and piece extremes. If the sign reversal is real,
  there is a crossing point, and boards near it are the maximally discriminating
  instances this programme could test on. That is a concrete, cheap experiment
  design, and it is the first one derived from a measurement rather than from
  intuition.

**C55. Coverage is a claim we have never made, and ruling 49's concern has a
second half we have not addressed.** The owner's worry has two parts: the
*population of bots* is a narrow lineage (which domains 9, 14 and the value
lens's instruments now measure), and the *config space is explored at low
density*. ISA points out the third thing neither addresses: **the population of
INSTANCES is also unmeasured.** Four hand-picked cells is a sample of the board
space with no stated coverage, and every verdict of the form "territory beats
material" is implicitly quantified over that sample. The instance-space plot is
the cheapest possible statement of what our verdicts are quantified over, and it
turns "we tested on four boards" into "we tested this region, and here is the
region we did not".

**M69. Footprints give the conditional selector its training set, for free.** If
`Choice = conditional` is Rice's `S: F → A` (domain 14), then ISA's footprints
*are* `S` — fitted, visualised, and with statistical support attached. The
programme does not need to invent a selector-training methodology; the ISA
pipeline is one, it is built on the same formalism, and its outputs (footprints,
coverage, discriminating directions) are the artefacts a selector needs.

---

## 26.3 The honest caveats

- **Two dimensions is a projection, and projections lie.** ISA's 2-D space is
  chosen to make performance vary smoothly, which is a fitting choice; regions
  that look adjacent may not be. The footprints carry statistical support
  precisely because the projection does not.
- **Feature choice determines the answer.** A feature set that omits the property
  that actually drives arm ordering will produce a space in which footprints
  overlap meaninglessly. Our candidate features are cheap but they are *our*
  guesses; the sign-reversal direction from domain 25 is the one feature we know
  is load-bearing, and it should anchor the set.
- **Evolved instances can be unrealistic.** An instance evolved to maximise
  discrimination may be a board no one would play. The standard mitigation is to
  constrain the generator to the realistic manifold, which for us means the
  existing scenario generator's own constraints — not a new problem.

---

## 26.4 Verdicts

- **VALUE / MEASUREMENT (the automatic detector you asked for):** add a
  **deadness column** — per cell, the spread of arm performance relative to the
  within-arm noise floor on that cell. One statistic over the arm × cell matrix
  POP-1 already builds; it is what the three independent knight-cell detections
  were each measuring by hand, and it is **distinct from M5**: M5 asks whether the
  outcome varies, deadness asks whether it varies *between arms*, and a cell can
  be high on the first and zero on the second, which is the worst case for
  spending a block.
- **VALUE / MEASUREMENT:** **feature the cells and plot the instance space.**
  Every feature is cheap and most are already computed — roster composition,
  `(K, W, p)`, board geometry, induced width (domain 17), contested-cell density,
  spawn rate, team count. It converts "we have four cells" into a coverage
  statement, which is the second half of ruling 49's concern and the half nothing
  currently addresses.
- **VALUE (the first measurement-derived experiment design this programme has):**
  the cyclic component reverses sign between snake and piece boards, so **evolve
  instances along that direction** — mixed rosters interpolating between the
  extremes. If the reversal is real there is a crossing point, and boards near it
  are the maximally discriminating cells we could build.
- **COMPOSITION:** ISA is a direct extension of **Rice's framework** — the same
  formalism `Choice = conditional` sits in — so its **footprints are the fitted
  selector**, with statistical support attached. There is no need to invent a
  selector-training methodology; adopt this one.
