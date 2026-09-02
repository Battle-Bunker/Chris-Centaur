# PRIOR ART 44 — automation bias: the surface's failure mode scales with its quality

Domain 10 argued for the Centaur surface and domain 39 gave the two operator
lenses their decision theory. Both treat a better advisor as straightforwardly
better. There is a large empirical literature saying it is not: **the failure
modes of a decision aid grow with the operator's trust in it**, they are measured,
they appear in experts as well as novices, and **they cannot be trained away**.

This is the counterweight the operator lenses need before they design, and it
turns one of domain 39's conclusions from a per-decision optimisation into a
**portfolio constraint**.

---

## 44.1 The findings, with numbers

**S84. Parasuraman & Riley, "Humans and automation: use, misuse, disuse, abuse",
*Human Factors* 39 (1997)** — the taxonomy: **misuse** (over-reliance), **disuse**
(rejecting or switching off automation after false alarms), **abuse** (automating
because it can be automated, without regard for the human's resulting role).

**S85. Parasuraman & Manzey, "Complacency and bias in human use of automation: an
attentional integration", *Human Factors* 52(3) (2010).** Three results that
constrain design:

- **Automation bias produces both OMISSION and COMMISSION errors** when the aid is
  imperfect — missing events the aid did not flag, *and* following the aid when it
  is wrong **against other information the operator has**.
- **Complacency occurs under multiple-task load**, when manual tasks compete with
  the automated task for attention.
- It is **found in both naive and expert participants and cannot be overcome with
  simple practice.**

**S86. Goddard, Roudsari & Wyatt, "Automation bias: a systematic review of
frequency, effect mediators, and mitigators", *JAMIA* (2012).** The number to
carry: **in 5.2% of prescribing cases, correct answers were switched to incorrect
answers after advice from the automated system.** Mediators: trust in the system,
decision confidence, task difficulty; **lower experience ⟹ more decision
switching**.

**S87. The cry-wolf literature (Bliss; Meyer; and the aided-detection studies).**
The quantitative shape:

- **A false-alarm rate of 20% with a positive predictive value of 0.3 caused
  operators to ignore about HALF of the TRUE alarms on difficult targets.**
- And the load-bearing distinction: **false alarms damage COMPLIANCE** (acting when
  the system signals); **misses damage RELIANCE** (trusting the system's silence).
  They are two behaviours with two causes, and *"operator compliance depended on the
  positive predictive value of automation: lower compliance was found for lower
  PPV"*.

**S88. Endsley & Kiris, "The out-of-the-loop performance problem and level of
control in automation", *Human Factors* 37 (1995).** *"The out-of-the-loop
performance problem was significantly greater under **full** automation than under
**intermediate** levels"*, with a correspondingly greater loss of situation
awareness; *"by implementing functions at a lower level of automation, leaving the
operator involved in active decision making, situation awareness remained at a
higher level and subjects were more able to assume manual control when needed."*

---

## 44.2 Mapping onto the two operator lenses

### C89. The surface's damage scales with its quality, and nothing in the design has a term for it

Domain 39's construction prices a single interaction: four utilities, one belief,
three regions. Every term is about *this* decision. Automation bias is about what
the *existence of a good advisor* does to the operator's own processing:

- a **commission error** is the operator following the advice *against information
  they themselves hold* — measured at **5.2% of cases switched from correct to
  incorrect**;
- an **omission error** is the operator missing what the advisor did not flag,
  because the advisor's silence has become a substitute for looking.

  **Both get worse as the advisor gets better**, because both are mediated by
  trust, and trust is earned by accuracy. So the surface's net value is **not
  monotone in the advisor's quality**: there is a regime in which a good advisor
  makes the pair worse than the human alone on the cases where it is wrong, and the
  design has no term that can express it.

  Two design consequences, both concrete:
  - **the omission channel is invisible by construction.** Nothing logs a
    non-surfacing, so an operator who stops looking where we are silent produces no
    trace at all. (The randomised holdout of d43's C88 is the instrument — it is
    the only source of rows where the surface was silent *by design* rather than by
    judgement, so it doubles as the omission-error detector. **One instrument, three
    purposes**: propensity correction, threshold identification, omission
    detection.)
  - **the commission channel has a cheap proxy**: a ratified surfaced option whose
    realised outcome is worse than the operator's *own previous pattern* in that
    cell. That is the same replay machinery the override analysis needs.

### C90. Cry-wolf gives the ask threshold a hard floor that Horvitz's utilities cannot see — the threshold is a PORTFOLIO constraint, not a per-decision one

Horvitz's `p*_{A,D}` is derived from four utilities and optimises **this**
interaction. The cry-wolf result says the channel's effectiveness is a function of
the **set** of things surfaced:

> at PPV 0.3, operators ignored **about half of the true alarms** on the difficult
> targets — i.e. the cases the surface exists for.

  So lowering the ask threshold does not merely trade "a few needless
  interruptions" for "a few more catches". It **lowers the surface's PPV, which
  degrades the operator's response to the alarms that matter**, and the loss lands
  on *future* interactions rather than on the one being optimised. A per-decision
  expected-utility calculation is structurally unable to see it, because the cost
  is not in `u(A, ¬G)` — it is in the *next* decision's `p(operator acts | we
  signal)`.

  **The correction is a constraint, not a different threshold:**

  > **Set the threshold so that the surfaced set's positive predictive value stays
  > above a floor.** PPV is a property of the portfolio of things surfaced over a
  > window, and it is directly measurable from ratification and override rates. The
  > utility calculation then optimises *within* that constraint.

  This sharpens d39's C75 in the direction that matters: the middle band's width is
  not free to be set from taste or from four assessed utilities alone. **And it
  gives the outbound lens its first hard, measurable acceptance criterion** — a
  surfaced-set PPV, monitored over a window, with the threshold moved to hold it.

  **Parasuraman & Riley's `disuse` is the endgame if this is got wrong**: a surface
  that over-alerts is not merely ignored, it is switched off — and then the whole
  Centaur direction is unavailable regardless of how good the advisor becomes.

### C91. Compliance and reliance are two channels with two causes, and the design has one word

*"Signaling system false alarms tend to affect operator **compliance**, whereas
misses tend to affect operator **reliance**."*

  - **Compliance** = does the operator act when we signal. Damaged by **false
    alarms**.
  - **Reliance** = does the operator trust our **silence**. Damaged by **misses**.

  In domain 39's three-region structure, **the silent region is a signal too** —
  "nothing here worth your attention" — and this literature says its failures have
  a *different* cause and a *different* victim than the surfaced region's.

  **The design consequence is that the outbound lens needs two acceptance criteria,
  not one**, and only one of them is currently even conceivable:
  - the surfaced region is judged by **PPV** (C90) — measurable from ratifications;
  - the silent region is judged by **the miss rate in the silence**, which nothing
    observes and which only the holdout can estimate.

  **A single "trust" or "confidence" number cannot carry both**, and a design that
  tunes one will silently move the other in the wrong direction: raising the
  threshold improves PPV (better compliance) and increases misses (worse reliance).
  That trade is the actual content of the middle band's width, and it is invisible
  under a single scalar.

### M112. Intermediate automation preserves the take-back that C73 makes mandatory

Domain 39's **C73** established that every viable transfer-of-control strategy must
end with the **agent** taking control back. Endsley & Kiris supply the mirror
constraint on the **human's** side: the out-of-the-loop problem is *"significantly
greater under full automation than under intermediate levels"*, and at lower levels
*"subjects were more able to assume manual control when needed."*

  The two compose into a statement neither makes alone:

  > **The strategy must end in take-back by the agent, and the operator's ability to
  > take back is a decreasing function of how much was automated in between.** A
  > design that automates fully in order to be helpful degrades the very capability
  > its fallback depends on.

  And it supplies a **second, independent argument for M100** ("do less, but do it
  correctly under uncertainty" — surface a direction rather than a cell, a role
  rather than a path). M100 was argued from R-4 and from Horvitz's principle 8;
  this says the coarser commitment is *also* an intermediate level of automation,
  which is what keeps the operator in the loop and able to take over. **The same
  design move satisfies three independent constraints**, which is the strongest form
  of evidence the survey has for any recommendation.

  Similarly, d39's **C74** buy-time action (`D` — change the plan so waiting is
  cheaper) is an intermediate-automation move by construction: it *defers* the
  commitment rather than making it, which is exactly the condition Endsley & Kiris
  find preserves situation awareness.

### M113. Complacency's precondition is our standing condition, and C76's coordinate covers both

Three properties of complacency make it a design constraint rather than a caution:

1. it *"occurs under conditions of **multiple-task load**, when manual tasks compete
   with the automated task for the operator's attention"*;
2. it appears in **experts** as well as novices;
3. it **cannot be overcome with simple practice.**

  So *"the operator will learn to check"* is not an available mitigation, and (2)
  removes the "our operator is skilled" escape. More usefully, (1) is a **stated
  precondition that we can check** — and in this game it holds constantly: the
  operator is steering multiple units against a clock, which is multiple-task load
  by definition.

  **And it is the same coordinate C76 already asked for.** Domain 39's C76 said both
  of Horvitz's thresholds move with the operator's **focus** (unwanted action costs
  less when focus is elsewhere) and **time pressure** (inaction costs more when
  rushed), and proposed two proxies the harness already sees: *which unit last
  received a manual command*, and *elapsed fraction of the deadline*. Those two
  proxies are **exactly the complacency preconditions** — competing task load and
  attentional demand. So one operator-state coordinate serves both the threshold
  displacement and the complacency risk, which makes it cheaper than either
  finding implied alone.

---

## 44.3 The counter-argument

1. **Most of this literature studies monitoring tasks with a passive operator, and
   ours is an active collaborator.** Our operator is *playing*, not supervising —
   issuing commands, not watching a display for anomalies. That genuinely weakens
   the direct read-across of the vigilance and complacency results, which depend on
   the operator having nothing else to do but watch. **But it strengthens the
   multiple-task-load finding**, which is the one whose precondition is *competition
   for attention* — and an active player has more competition, not less. So the
   scoping is: the vigilance results transfer weakly, the load-driven complacency
   results transfer strongly, and the cry-wolf results transfer directly because
   they are about the alarm channel's statistics rather than the operator's role.

2. **The 5.2% figure is from clinical prescribing, and our stakes and time
   constants are entirely different.** True; it should be cited as *evidence that
   the effect is real and measurable*, not as a rate to expect. The transferable
   claim is the **sign and the mediators** (trust, confidence, task difficulty,
   experience), not the magnitude.

3. **A Centaur design is exactly the intermediate level this literature
   recommends.** Endsley & Kiris's own conclusion is an argument *for* the
   programme's direction, not against it — the failures are of **full** automation.
   That is worth saying plainly, because the rest of this domain reads as a warning:
   **the design is on the right side of the literature's main finding, and the
   findings above are about how to stay there.**

---

## 44.4 Verdicts

- **BOTH OPERATOR LENSES (C89) — the surface's damage scales with its QUALITY, and
  nothing in the design has a term for it.** Automation bias produces **commission**
  errors (following the aid *against* information the operator holds — measured at
  **5.2% of cases switched from correct to incorrect**) and **omission** errors
  (missing what the aid did not flag). Both are mediated by trust, and trust is
  earned by accuracy, so **the surface's net value is not monotone in the advisor's
  quality**. The omission channel is **invisible by construction** — nothing logs a
  non-surfacing — and the randomised holdout of C88 is the only instrument that can
  see it. **One instrument, three purposes: propensity correction, threshold
  identification, omission detection.**
- **OPERATOR-OUTBOUND (C90) — the ask threshold is a PORTFOLIO constraint, not a
  per-decision optimum.** At **PPV 0.3 operators ignored about half of the TRUE
  alarms** on the difficult targets — the cases the surface exists for. Lowering the
  threshold lowers the surfaced set's PPV, which degrades the response to the
  alarms that matter, and the cost lands on **future** interactions, where a
  per-decision expected-utility calculation structurally cannot see it. **Set the
  threshold so the surfaced set's PPV stays above a floor, and optimise utilities
  within that constraint.** This gives the outbound lens its first hard, measurable
  acceptance criterion — and **`disuse` is the endgame if it is got wrong**: an
  over-alerting surface is not ignored, it is switched off, and then the Centaur
  direction is unavailable however good the advisor becomes.
- **OPERATOR-OUTBOUND (C91) — two channels, two causes, two acceptance criteria.**
  *False alarms damage **compliance*** (acting when we signal); *misses damage
  **reliance*** (trusting our silence). In the three-region structure **the silent
  region is a signal too**, and its failures have a different cause and a different
  victim. So: the surfaced region is judged by **PPV** (measurable from
  ratifications); the silent region by **the miss rate in the silence** (only the
  holdout can estimate it). **A single "trust" or "confidence" scalar cannot carry
  both** — raising the threshold improves compliance and worsens reliance, and that
  trade *is* the content of the middle band's width.
- **OPERATOR-INBOUND (M112) — intermediate automation preserves the take-back C73
  makes mandatory, and it is M100's third independent argument.** *"The
  out-of-the-loop performance problem was significantly greater under full
  automation than under intermediate levels"*, and at lower levels operators *"were
  more able to assume manual control when needed"*. Composed with C73: **the
  strategy must end in take-back by the agent, and the operator's ability to take
  back decreases with how much was automated in between.** So M100's coarser
  commitment (a direction not a cell, a role not a path) and C74's buy-time action
  are both **intermediate-automation moves** — the same design move now satisfies
  three independent constraints, which is the strongest evidence the survey has for
  any recommendation.
- **BOTH (M113) — complacency's stated precondition is our standing condition, and
  C76's coordinate already covers it.** It *"occurs under multiple-task load"*,
  appears in **experts**, and **cannot be overcome with practice** — so "the
  operator will learn to check" is not an available mitigation and "our operator is
  skilled" is not an escape. Our operator steers multiple units against a clock,
  which is the precondition by definition. **And C76's two proposed proxies — which
  unit last received a manual command (focus), elapsed fraction of the deadline
  (rush) — are exactly the complacency preconditions**, so one operator-state
  coordinate serves both the threshold displacement and the complacency risk.
- **THE HONEST BALANCE:** Endsley & Kiris's failures are failures of **full**
  automation, and a Centaur surface is the intermediate level their result
  recommends. **The programme is on the right side of this literature's main
  finding**; everything above is about how to stay there.
