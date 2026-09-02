# PRIOR ART 3 — imprecise probability vs the (S, w) object

Domain: the mathematics our belief lens has independently re-derived — credal
sets, lower previsions, ε-contamination — and the two results in that literature
that our carve does not survive contact with: **dilation** and the **decision
criteria hierarchy**.

Read against `04-SYNTHESIS.md` (the (S, w) pair, the conditioning ladder, the
weight-supplier socket, `(1−ε)·estAdvised + ε·lo`), `01-PREMISE-LATTICE.md`
(join = widen, meet = narrow), and the joints lens's REDUCTION kind.

This domain contains the single most dangerous finding in the survey: **the
belief lens has chosen, by name, the credal class whose defining pathology is
that conditioning makes you less certain — and has built an economy that assumes
conditioning narrows.**

---

## 3.1 Load-bearing sources

**S7. Seidenfeld & Wasserman, "Dilation for sets of probabilities", *The Annals
of Statistics* 21(3):1139–1154 (1993).** The pathology and its structural
characterisation. Follow-ups: Herron, Seidenfeld & Wasserman, *Divisive
conditioning: further results on dilation* (Phil. Sci. 1997); Seidenfeld &
Wasserman, *The extent of dilation of sets of probabilities and the asymptotics
of robust Bayesian inference*; Gong & Meng, *Judicious judgment meets unsettling
updating: dilation, sure loss and Simpson's paradox*, **Statistical Science**
36(2) (2021) — the modern statement that dilation is common, not exotic.

**S8. Troffaes, "Decision making under uncertainty using imprecise
probabilities", *Int. J. Approximate Reasoning* 45:17–29 (2007),
arXiv:1807.03705.** The decision-criteria comparison: admissibility, Γ-maximin,
Γ-maximax, maximality, E-admissibility, interval dominance — with the inclusion
diagram, the computational costs, and the argument about which properties you
want.

**S9. Walley, *Statistical Reasoning with Imprecise Probabilities* (1991)** —
coherent lower previsions, natural extension, the **linear-vacuous mixture**
(= ε-contamination), near-ignorance models. The source of our own formula.

---

## 3.2 What the experts decided, and their stated rationale

### (a) Our ε-formula IS the literature's linear-vacuous mixture — exactly

Walley's linear-vacuous mixture with contamination ε has lower prevision

    E_lower[f]  =  (1−ε)·E_P[f]  +  ε·inf f

which is our `(1−ε)·estAdvised + ε·lo` term for term, with `lo` the infimum over
the support. This is not an analogy; the belief lens has re-derived a named,
axiomatised model. That is strong corroboration that the (S, w) carve is at a
real joint — and it also means every theorem about that class applies to us,
including the bad ones.

### (b) Dilation: conditioning can widen, for EVERY possible observation

S7's definition: dilation occurs when the interval for an event A is *properly
contained in* the interval for A conditional on B, **for every B in a
partition**. So you can know, before observing, that whatever you see will leave
you strictly less certain about A than you are now.

The canonical instance: a fair coin X (so P(X=heads) = 1/2 exactly, with no
imprecision at all) and a second variable Y about whose dependence on X nothing
is assumed. Then for every value y, the bounds on P(X=heads | Y=y) are the
vacuous [0,1]. A perfectly sharp belief becomes maximally imprecise on the
strength of a genuinely informative observation.

**Structural characterisation (S7's theorem):** if dilation occurs under the
generalized Bayes rule, the credal set has non-empty intersection with the
**independence plane** between the two events. That is a *checkable* condition,
not just a warning — dilation is possible exactly when the credal set is
compatible with the observation being independent of the target.

**And the class that does it is ours.** The literature is explicit that the
ε-contamination / linear-vacuous class dilates; and under divisive conditioning
of the linear-vacuous model the conditional lower expectation is **0 whenever B
does not imply A** — i.e. conditioning collapses the lower prevision to vacuous
unless the evidence logically entails the target.

**Asymptotic consequence** (S7 follow-up): where dilation occurs, the usual
concentration of posterior intervals with more data *does not happen*. More
evidence does not buy sharpness.

### (c) The decision criteria form a hierarchy, and Γ-maximin sits badly in it

S8's implications (proved in his Theorem 1):

    Γ-maximax  ─┐
                ├→  E-admissible  →  maximal  →  interval dominance
    Γ-maximin  ─┘

with these properties, stated in his own terms:

- **E-admissibility, maximality and interval dominance have the property that
  "the more determinate our beliefs (i.e. the smaller M), the smaller the set of
  optimal decisions". Γ-maximin and Γ-maximax LACK this property, and "usually
  only select a single decision, even in case of complete ignorance."**
- Interval dominance is the cheapest (2n natural extensions, 2n comparisons vs
  n²−n for maximality) and is *sound as a pre-filter*: "because every maximal
  decision is also interval dominant, we can invoke interval dominance as a first
  computationally efficient step in eliminating non-optimal decisions."
- **Once dynamics enter, interval dominance breaks**: "dynamic programming
  techniques cannot be used when using interval dominance… maximality and
  E-admissibility are certainly preferred over interval dominance once dynamics
  enter the picture."
- E-admissibility is immune to domination by *randomised* decisions; maximality
  is not (his example: a 20/80 mixture of decisions 2 and 3 dominates decision 5,
  yet 5 is maximal).
- **Seidenfeld argued specifically against Γ-maximin in sequential decision
  problems.**

---

## 3.3 Mapping onto our joint

### AGREES

- **(S, w) is a credal object and the belief lens knows it.** Naming the
  supplier's type as "a credal set spanning quantifiers and measures" is exactly
  right and matches Walley. The sound/advised split as *quantifier vs measure* is
  the lower-prevision/linear-prevision distinction, correctly identified.
- **"No probabilistic support updates — S takes only deductions"** is a strong
  and, as it turns out, *protective* law. See below: it is what keeps half the
  object out of the pathology.
- **The refusal law (tag mismatch never compares silently)** is the practical
  form of coherence: the literature's failure mode is combining previsions from
  incompatible assessments, and our tags forbid it.

### CONTRADICTS — flag loudest

**C9. Our laws protect the support from dilation and leave the weight — where the
pathology actually lives — unprotected.** S moves only by deduction, and
set-theoretic deduction genuinely only narrows: `condition(S, obs) ⊆ S`. So the
support half is dilation-free *by construction*, and the belief lens deserves
credit for that. But w is a credal object updated on evidence, and updating a
credal set is generalized Bayes, which is precisely where dilation lives. The
04-doc's weight law ("moves on any evidence at the precision the evidence
earned") assumes precision is monotone in evidence. **It is not.** Concretely:

  - `advisoryPrecision` can *fall* on new evidence, and the design has no
    representation for that — "at earned precision" reads as a ratchet.
  - The reappearance oracle audits the *support* ("every reveal lands inside the
    predicted cloud"). It cannot catch a weight dilation, because the support was
    fine. So the one live tripwire is blind to this failure mode.
  - **The dilation test is cheap and we should run it:** S7 says dilation
    requires the credal set to intersect the independence plane between the
    observation and the target. In LOBSTER that reads: *if any member of the
    weight supplier's credal set makes the enemy's action independent of what we
    just observed, conditioning may dilate.* The `'adversarial'` zero point — a
    fully vacuous supplier — trivially contains such members. So the design's
    default supplier is the maximally dilation-prone one.

**C10. "Meet = narrow, priced" is false in general, and it is a load-bearing
assumption of two lenses.** The joints lens's premise lattice defines meet as
narrowing, and the time lens's economy sells meets. Dilation says an
observation-driven meet can *widen* the credal set — and can be known in advance
to widen it whatever is observed. Consequences:

  1. **You can pay for an observation that provably makes you less certain.**
     The economy has no way to represent a negative-value meet, so it cannot
     refuse one. (The compute-bought meet is safe — a deduction narrows S — but
     the *observation*-bought meet is not, and the reducibility tag explicitly
     distinguishes those two, so the type is already there to carry the warning.)
  2. **"Buy the meet vs anticipatory meet" needs a third case:** the meet that is
     known to dilate, where the correct purchase is the *anticipatory* one only —
     you pre-compute per branch precisely because the arrival of the observation
     will not sharpen anything.
  3. The premise lattice should state the law with its hypothesis: *meet narrows
     the SUPPORT; it does not necessarily narrow the WEIGHT.* Two operations
     wearing one name is the exact disease §1 of the composition synthesis names.

**C11. Terminology collision: we use "dilation" for the opposite of what the
field uses it for.** `04-SYNTHESIS.md` §1: "a proved SUPPORT … that moves only by
dilation (dynamics) and conditioning (evidence)". In the imprecise-probability
literature **dilation is the conditioning pathology**, not the dynamics. Anyone
reading both will mis-read our laws in the most dangerous possible direction
(they will believe we have addressed dilation because the word appears). Rename
ours to **spread** or **propagation** and reserve *dilation* for the pathology —
then state explicitly whether the pathology can occur in our pipeline.

**C12. ε=1 is Γ-maximin, and Γ-maximin has the one property a Centaur system
must not have: its optimal set does not shrink as beliefs sharpen.** S8's
finding, in his words, is that Γ-maximin and Γ-maximax "lack this property, and
usually only select a single decision, even in case of complete ignorance." Two
consequences, both severe:

  1. **The search buys information whose value is invisible in the output.**
     Every quantum spent narrowing the credal set is supposed to be worth
     something; under Γ-maximin the recommended decision set stays size 1
     regardless. The reduction discards exactly the quantity the economy is
     buying. (This is C8 from domain 2 arriving from a second direction: our
     reduction has no channel through which extra determinacy shows up.)
  2. **The Centaur direction is built on the wrong criterion.** The VALUE lens's
     honest limit — "the Centaur case must rest on option-surfacing, not the
     fold's R²" — asks for a *set* of live options with an account of why each is
     live. That set has a name: it is the **maximal** (or E-admissible) set, and
     it shrinks exactly as the bot learns more, which is the property that makes
     it legible to a human. Under Γ-maximin the surfacing has to be bolted on
     top of a criterion that threw the set away. Under maximality it *is* the
     output.

  Combined with domain 1's C1, the picture is: our reduction is Γ-maximin over a
  credal set built from pure enemy actions, and the field says (a) the right
  credal object at a simultaneous-move node is the stage-game equilibrium, and
  (b) the right output type is a maximal set, not a scalar.

### COVERS A CASE WE MISSED

**M8. `better()` is already interval dominance, and that is a theorem-backed
licence — with a sharp expiry date.** Our comparator refuses to compare across
bases and orders by proved intervals at the floor rung. S8: interval dominance is
the cheapest criterion, and it is *sound as a first filter* — it never discards a
maximal or E-admissible option. So today's comparator is exactly right as a
pre-filter. **But**: "dynamic programming techniques cannot be used when using
interval dominance… once dynamics enter the picture" maximality and
E-admissibility are required. Our search *is* dynamic (multi-ply threads,
horizon > 1 planned). So interval dominance is sound at the leaf and unsound as
the criterion carried up the tree — and the deep channel is precisely where we
propagate it. This is a specific, checkable prediction: **deep threads that
propagate interval dominance will exhibit non-monotone value with depth.** The
composition lens's B7 falsifier ("if the depth-effect rate falls as plies rise,
the blended value and sigmaOfPly's width terms are discounting the same
uncertainty twice") is testing for a symptom that has a second candidate cause,
and the two are distinguishable.

**M9. Randomisation is not decoration.** E-admissibility's advantage over
maximality is immunity to domination by randomised decisions. Our design has no
mixed strategies anywhere (the `candidate.to` determinism tie-break actively
forbids them). Combined with domain 1's C1 (the stage game's value requires
mixing), this is the same gap seen from the belief side: a deterministic bot in a
simultaneous-move game is exploitable *and* keeps options in its maximal set that
a mixture would dominate. Whether to allow randomisation is an owner-level game
design question (it interacts with replay determinism and with the Centaur
handoff), and it should be raised as one rather than settled by a tie-break rule.

**M10. Near-ignorance models and the vacuous limit.** Walley's near-ignorance /
IDM literature is the right prior art for the `'adversarial'` supplier: a
deliberately vacuous model whose whole point is to make no commitment. Two
imports: (i) vacuous priors are known to produce vacuous posteriors on many
queries — the "learning nothing from data" critique — which is C9 restated as a
design consequence; (ii) the IDM's answer is a *small* imprecision parameter
(s ≈ 1–2), not full vacuity. If ε is to be the operator's paranoia dial, the
literature says its useful range is near 0, and ε = 1 is a degenerate endpoint
rather than the natural default the design currently makes it.

---

## 3.4 Verdicts the lens agents can act on

- **BELIEF (act on all four):**
  1. Rename our *dilation* to **spread**; reserve dilation for the pathology and
     state explicitly where it can occur in our pipeline (answer: in w, never in
     S).
  2. Drop the assumption that `advisoryPrecision` is monotone in evidence.
     Represent precision loss, and add a weight-side tripwire beside the
     reappearance oracle (the support oracle cannot see this failure).
  3. Run S7's structural test on the supplier: our default `'adversarial'`
     supplier trivially intersects the independence plane, so it is the
     maximally dilation-prone member. That is an argument for a *named*
     supplier default, not a vacuous one.
  4. ε is the linear-vacuous mixture parameter, which is right — but ε = 1 is
     Γ-maximin, which the literature criticises specifically in sequential
     problems (Seidenfeld) and which cannot express increasing determinacy. Make
     the *criterion* selectable (Γ-maximin | maximality | E-admissibility) and ε a
     parameter of one member, rather than making the criterion implicit.
- **COMPOSITION:** the REDUCTION joint's law is currently "reduce to a comparable
  key — exactly one". S8 says the field's preferred reductions return a **set**.
  The joint's type should be `Gambles → Set of options`, with "collapse to a
  scalar" as one member (Γ-maximin) among several. The chief refusal ("no joint
  with one member") applies to REDUCTION itself: it currently has one member and
  the literature hands us four.
- **VALUE / Centaur:** the option set the Centaur argument needs is the maximal
  set. Adopting maximality makes option surfacing the reduction's native output
  instead of an add-on, and makes "the bot learned something" visible as the set
  shrinking. This is the strongest architectural argument for the Centaur
  direction found anywhere in this survey.
- **TIME:** the economy must be able to represent a meet with negative value.
  Dilation makes "buy the meet" occasionally a bad purchase, and the reducibility
  tag already distinguishes the two purchase kinds, so the type exists.
- **ALL:** interval dominance is a sound cheap pre-filter and an unsound
  propagator. `better()` is fine at the leaf; carrying it up the deep channel is
  a distinct, testable defect.
