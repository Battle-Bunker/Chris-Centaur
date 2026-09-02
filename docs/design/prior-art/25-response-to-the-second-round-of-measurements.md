# PRIOR ART 25 — response to the second round of measurements

Two lenses ran instruments this survey asked for and both produced results that
change what I said. This document responds to each, and the first response is the
important one because **the two lenses' findings interact in a way neither of
them can see from inside its own section.**

Written against `design/value-evaluation` @ `159adb9` (POP-3) and
`design/joints-composition` @ `849ac57` (the co-change test).

---

## 25.1 The value lens: the game is NOT transitive, and that reactivates the
architecture's empirical case

Their result: my correction was accepted, POP-2 §2 withdrawn, and the
curl-capable ordinal statistic run — first wrongly on raw win probabilities
(*"bounded in [0,1], it saturates when one arm dominates, so a perfectly
transitive triple is forced to show a large cycle — the bounded-statistic trap
for the third time this session"*), then correctly on the **logit**, where
Bradley–Terry is exactly additive. Two triangles carry significant
intransitivity against a within-game permutation null:
`parentDefault/potionIntel/reflex` (logit −0.634, p = 0.000) and
`material/territory/reflex` (logit −0.297, p = 0.000, n = 4841, null mean 0.018).
**The game is not transitive, measured rather than assumed.**

Their honest counterweight: magnitude is modest (a logit cycle of 0.30 is an odds
inconsistency of ~1.35), so it does not yet license "rosters must be mixtures".
Agreed. And their methodological consequence: **per-cell logit cycles FLIP SIGN
between snake boards (+0.60) and piece boards (−0.43 to −0.55) and largely cancel
on pooling**, so a single pooled rating is not a sufficient statistic.

### M64. The sign flip is the finding, and it predicts that the VBS−SBS null is
an artifact of pooling

This is the interaction the two sections cannot see separately.

- Instrument 1 measured **VBS − SBS pooled across cells** and found no headroom.
- Instrument 3 finds a cyclic component that **exists per cell with opposite
  signs and cancels on pooling.**

A cyclic component that reverses between board families is, by definition, a
region where **the best arm depends on the board** — which is exactly the
quantity VBS−SBS is supposed to detect, and exactly the quantity a pooled
average destroys. The two results are not independent evidence; the second
explains how the first could be an artifact.

**So the test to run is: VBS − SBS restricted to the cells and arms that carry
the cycle.** Concretely, on `{material, territory, reflex}` and
`{parentDefault, potionIntel, reflex}`, per cell rather than pooled. The
prediction is sharp and falsifiable: **if the cyclic component is real, per-cell
VBS−SBS on those triples is positive where the pooled figure was zero.** If it is
not, the cycle is real but too small to be worth selecting on, and the "hygiene,
not strength" verdict survives a much stronger test than it has had. Either
outcome is worth more than the pooled null.

This also connects to domain 14's framing directly: the cyclic axis flipping with
board type means **board type is a feature on which `Choice = conditional` has
measurable headroom** — Rice's `S: F → A` with `F` = board family. That is the
first empirically-identified feature for a conditional selector this programme has
had.

### M65. mElo is the right fit for what they measured, and it produces a usable
per-arm quantity

Balduzzi et al.'s **mElo₂ₖ** fits a scalar rating *plus* k pairs of cyclic
dimensions, precisely so that a game with a transitive part and a cyclic part can
be represented without either being projected away. Their measurement — two
significant triangles, cycles reversing by board family — is a k = 1 gamescape
almost by inspection. Fitting it yields a per-arm **cyclic loading**: an
interpretable number saying *which side of the rock-paper-scissors this arm sits
on*. Three uses, all cheap once fitted:
  - **roster construction**: a roster spanning the cyclic axis covers more of the
    space than one that maximises the transitive rating;
  - **redundancy, refined**: two arms with the same rating *and* the same cyclic
    loading are duplicates in a stronger sense than profile correlation catches;
  - **selection**: the cyclic loading is the natural regressor for a conditional
    selector, and it is one number per arm.

### C54. Name the bounded-statistic trap as a standing measurement law

Their own note — *"the bounded-statistic trap for the third time this session"* —
is a general failure that has now cost three investigations, and it is worth a
law beside R-6:

> **Never test for a residual in a bounded statistic. Transform to the scale on
> which the null model is additive first.**

Raw win probability is bounded in [0, 1], so it saturates against a dominant arm
and manufactures apparent structure; the logit is unbounded and is the scale on
which Bradley–Terry is exactly additive, which is why Balduzzi's whole
decomposition is defined on **logit** matrices. The same trap explains the first
version of their own telescoping result and my C29's original framing. The law
generalises past ratings: any share, rate, or probability we difference and then
test for structure has this hazard, and `sharePar` is a bounded share.

---

## 25.2 The joints lens: the co-change test, and the `kind` / `module` split

Their result: 391 commits, 78 usable, cosine co-change over the lobster and
partial-engine files. **Kinds capture churn weakly — 1.94× within over cross** —
so the carve is neither orthogonal to the design's structure nor a clean
partition of it. My REDUCTION↔VALUE prediction confirmed (the accept ladder and
the scheduler are the largest non-spine coupling); my ACTION↔ECONOMY prediction
**refuted** (admission and the clock are the smallest cell, in this window). And
the finding neither of us predicted: **ACTION has 7% self-share** — its files
co-change with almost everything *except each other* — because one law was given
to ordering, closure, factorisation and sampling, *"four things that share a law
and nothing else"*.

Their resolution: **kinds answer how things compose and follow the domain;
modules answer what hides what and follow churn.** The manifest gains a `module`
field beside `kind`; ACTION splits into four modules while staying one kind; the
falsifier is that `module == kind` everywhere would make the field dead weight.

**[+] This is Parnas's own position, and it has a citation.** Parnas argued
explicitly — in *Designing software for ease of extension and contraction* (1979)
and *The modular structure of complex systems* (Parnas, Clements & Weiss, 1985) —
that a system needs **several distinct structures**, in particular a **module
structure** (what hides what) and a **uses structure** (what depends on what), and
that **conflating them is a standard error**. Their `kind` / `module` split is
that position, arrived at from a measurement rather than from the paper, which is
the better way to arrive at it. Worth citing, because it converts "we added a
field" into "we adopted the field's standing position, and here is our own data
for it."

**[M] ACTION's 7% self-share is a DSM "bus", and the literature offers a second
remedy they should test with the matrix they already have.** In design-structure-
matrix practice, an element that couples to nearly everything and has almost no
internal cohesion is a **bus** (or "integrative element"). The standard handling
is one of two things:
  1. **split it** — which is what they did, and it is right when the parts have
     real internal cohesion of their own;
  2. **distribute it** — when the parts have no cohesion *at all*, the honest
     reading is not "four modules" but "**a missing abstraction**": each part
     belongs with its consumers, and the cluster is an artifact of having named
     the law rather than the code.

  The distinguishing test runs on the same matrix, at no extra cost: **after
  splitting, does each of the four sub-modules have high internal cohesion?** If
  ordering-with-ordering, closure-with-closure etc. are each dense, remedy 1 is
  right and four modules is the answer. If any sub-module is *still* near-zero
  self-share, that part is a bus in its own right and belongs distributed to its
  consumers rather than named as a module. Given that the four are *ordering,
  closure, factorisation and sampling* — which sound like operations applied by
  different callers rather than a cohesive subsystem — I would expect at least one
  of them to fail the cohesion test, and finding out costs one more pass.

**[?] The ten-day window is the main threat to this measurement, and they said
so.** Their own note that the window is ten days for this layer rather than four
months is the right caveat. The DSM literature's standard mitigation is to weight
co-change by **commit size** (a 40-file refactor is weak evidence of coupling; a
2-file commit is strong) and to exclude mechanical commits. Both are cheap, both
sharpen the 1.94× figure, and the second is what would separate "these change
together because they are coupled" from "these change together because someone
did a sweep".

---

## 25.3 Verdicts

- **VALUE (the test that could reverse the architecture's empirical verdict):**
  run **VBS − SBS restricted to the cells and arms carrying the cycle** —
  `{material, territory, reflex}` and `{parentDefault, potionIntel, reflex}`, per
  cell, not pooled. Your two instruments interact: a cyclic component that
  reverses by board family and cancels on pooling is *precisely* the structure a
  pooled VBS−SBS destroys. Sharp prediction: if the cycle is real, per-cell
  VBS−SBS on those triples is positive where the pooled figure was zero. Either
  outcome beats the pooled null, and the null is currently doing a lot of work in
  the architecture's assessment.
- **VALUE:** fit **mElo₂ₖ at k = 1**. Your two triangles with board-family sign
  reversal are a k = 1 gamescape by inspection, and the fit yields a per-arm
  **cyclic loading** — one interpretable number that serves roster construction,
  a stronger redundancy test than profile correlation, and the first
  empirically-identified feature for a conditional selector this programme has.
- **ALL — new standing law, beside R-6:** *never test for a residual in a bounded
  statistic; transform to the scale on which the null model is additive first.*
  Three investigations have now been cost by this, and `sharePar` is a bounded
  share.
- **COMPOSITION [+]:** the `kind` / `module` split is **Parnas's own position** —
  a system needs several structures, module (what hides what) and uses (what
  depends on what), and conflating them is a standard error. Cite it; it converts
  a new field into an adopted standing position backed by your own data.
- **COMPOSITION [M]:** ACTION's 7% self-share is a DSM **bus**, and there are two
  standard remedies — split (yours) or **distribute, because the cluster is a
  missing abstraction rather than four modules**. The test is on the matrix you
  have: after splitting, does each sub-module have high internal cohesion? Given
  the four are ordering, closure, factorisation and sampling, I would expect at
  least one still to read as a bus.
- **COMPOSITION [?]:** weight co-change by **commit size** and exclude mechanical
  sweeps. Cheap, and it separates real coupling from "someone did a pass".
