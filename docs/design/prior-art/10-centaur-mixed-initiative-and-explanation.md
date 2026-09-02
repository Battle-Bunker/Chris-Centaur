# PRIOR ART 10 — the Centaur surface: mixed-initiative control and explanation

Domain: the product direction. If the bot's case rests on *surfacing options a
human can act on* (the VALUE lens's own honest limit), then the shape of that
surface is a design constraint on the architecture, not a UI detail — and there
are two mature literatures about what that shape must be.

Read against the VALUE lens's §6.1 ("the Centaur argument must rest on
option-surfacing, and must not borrow the fold's evidence"), the operator
mechanisms in the TIME lens (commit, dial, excursion), and the production
bot-binding gap in `07-SYNTHESIS.md` §2.14.

This domain closes a loop: three unrelated literatures — imprecise probability
(domain 3), POSG value theory (domain 8), and explanation (here) — all conclude
that the reduction should return **a set of options with the conditions under
which each is right**. That is now a convergent result, not a preference.

---

## 10.1 Load-bearing sources

**S26. Miller, "Explanation in artificial intelligence: insights from the social
sciences", *Artificial Intelligence* 267:1–38 (2019), arXiv:1706.07269.** The
survey of philosophy, cognitive and social psychology on how humans actually
explain, with four findings the author states most AI practitioners are unaware
of.

**S27. Horvitz, "Principles of mixed-initiative user interfaces", CHI 1999.**
Twelve principles for coupling automated services with direct manipulation,
grounded in expected value of action.

---

## 10.2 What the experts decided, and their stated rationale

### (a) Miller's four findings, stated as he states them

1. **Explanations are CONTRASTIVE.** *"People do not ask why event P happened,
   but rather why event P happened INSTEAD OF some event Q."* The counterfactual
   case Q is called the **foil**. Explanation is a relation between a fact and a
   foil, not a property of the fact alone.
2. **Explanations are SELECTED, in a biased manner.** *"People rarely, if ever,
   expect an explanation that consists of an actual and complete cause of an
   event. Humans are adept at selecting one or two causes from a sometimes
   infinite number of causes to be THE explanation."*
3. **Probabilities probably don't matter.** *"Referring to probabilities or
   statistical relationships in explanation is not as effective as referring to
   causes… using statistical generalisations to explain why events occur is
   unsatisfying, unless accompanied by an underlying causal explanation for the
   generalisation itself."*
4. **Explanations are SOCIAL** — a transfer of knowledge presented as part of a
   conversation, "relative to the explainer's beliefs about the explainee's
   beliefs."

### (b) Horvitz: automation decisions are expected-value decisions, and dialogue
is one of the actions

The principles that bear directly on our operator surface:

- **Consider uncertainty about the user's goals.** Uncertainty about what the
  user wants carries context-dependent costs and benefits; automated services
  should be invoked by *expected value of taking the action*, not by a threshold
  on confidence alone.
- **Employ dialogue to resolve key uncertainties.** If the system is uncertain
  about intent, asking is an available action, priced against "the costs of
  potentially bothering a user needlessly."
- **Minimise the cost of poor guesses** — a system acting under uncertainty will
  sometimes act wrongly, so the design must supply *efficient means for the user
  to directly invoke or terminate* the automated service.

---

## 10.3 Mapping onto our joint

### AGREES

- **The VALUE lens's refusal to let the Centaur case borrow the fold's R² is
  exactly right and Miller explains why.** Finding 3 says a statistical claim is
  not an explanation. The fold's evidence is statistical; the Centaur claim is
  about what a human can act on. They are different claims and the lens was
  right to separate them — but the survey now supplies the *positive* half of
  that argument, which the lens marked as owed.
- **Operator commit / dial / excursion is a mixed-initiative surface**, and
  Horvitz's "minimise the cost of poor guesses → supply efficient direct
  invocation and termination" is the principle behind "humans always win" as a
  row in the reaction table. The instinct is right; the pricing is missing (below).

### CONTRADICTS — flag loudest

**C31. Our architecture produces exactly the kind of output Miller says is the
least effective explanation, and the fix is already in the VALUE lens's hands.**
The whole apparatus is built to emit *numbers with provenance*: intervals, ε,
weights, an evaluator version, R², a fitted k. The natural Centaur surface from
that apparatus is "this move scores 1.23 ± 0.4 under weight w at horizon 1",
which is a statistical generalisation with no causal content — Miller's finding
3, precisely.

  **But the fold's per-unit flows ARE a causal vocabulary.** "This move costs the
  queen's account because unit X contests cell Y at sub-step 2, and the queen's
  weight is 31 of the team's 38" is a causal statement about a specific event,
  and it is exactly what `Contribution { unit, flow, side, rate, horizon }`
  carries. So the architectural requirement is narrow and cheap: **the Centaur
  surface must be built on the flow decomposition, never on the aggregate score,
  and the flow records must survive to the surface rather than being summed
  away.** That is a constraint on where the fold is applied — late, at the
  comparison, not early — and it has consequences for the memoisation design
  (C14/R-2: if flows are summed before caching, the causal content is gone).

**C32. Nothing in the design produces a FOIL, and without a foil there is no
explanation.** Miller's finding 1 is not a stylistic preference; it is what a
"why" question *is*. Our comparator produces one winner and discards the rest;
the mechanism report records the chosen plan. There is no record of *what it was
chosen over* and *on what rung the comparison turned*.

  The fix is again already present in the machinery and is *cheap*: `better()` is
  a lexicographic comparator, so for the winning plan and each near-miss there is
  a **deciding rung** and a **margin at that rung**. Recording `(runner-up plan,
  deciding rung, margin)` for the top-k plans turns every decision into a
  contrastive explanation with no new computation. Today that information is
  computed and thrown away on every single decision.

  And note the convergence: **the foil is what maximality's optimal set contains
  (domain 3, C12) and what an α-vector's dominance region conditions on (domain
  8, M21).** Contrastive explanation is not a fourth requirement — it is the
  human-facing reading of the same set-valued object the other two domains
  independently demanded. Three literatures, one type:

  > **REDUCTION should return a set of options, each with the condition under
  > which it dominates.** Imprecise probability calls the set *maximal*; POSG
  > theory calls the conditions *dominance regions of α-vectors*; explanation
  > calls the pair *(fact, foil)*.

  A scalar reduction throws away all three at once, and this is the strongest
  single architectural conclusion in the survey.

**C33. Dialogue is an action with a price, and our economy has no row for it.**
Horvitz: asking the user is an available action, priced against the cost of
interrupting them. Our design has the operator initiating (commit, dial,
excursion) and the bot never initiating. Under fog this becomes acute: the bot
holds a wide cloud, cannot buy the narrowing with compute (the reducibility tag
says so), and *the operator may simply know the answer*. "Ask the human" is then
a purchasable observation — the one lever that removes observation-held width —
and it belongs in the ECONOMY joint's member list beside compute-bought meets.

  This also completes C25 from domain 8 (nothing makes information valuable): the
  three ways to remove width are **deduce it** (C2), **observe it** (act to
  reveal), and **ask** (dialogue). Our design has the first, is missing the
  second, and has not conceived the third.

### COVERS A CASE WE MISSED

**M27. "Selected, one or two causes" is a hard constraint on the surface, and it
argues against completeness.** Miller's finding 2 says a complete causal account
is not what people want. Our instinct — every number carries its provenance,
every tag is declared, nothing compares silently — is *correct for the machine*
and wrong for the surface. The provenance apparatus should be complete and the
*presentation* should be ruthlessly selected: one or two flows, the deciding
rung, the foil. That distinction (complete internally, selected externally)
should be stated as a design law so the operator surface does not inherit the
refusal law's exhaustiveness.

**M28. The explainee's beliefs are part of the explanation (finding 4), and we
have the type for it.** The belief lens's step 8 builds `Belief(observer)` — an
observer-indexed belief constructor — for pricing *the enemy's* support over our
hidden units. The same constructor indexed on the **operator** is the object
Miller's finding 4 requires: an explanation is relative to what the explainee
already believes. That is a second, product-facing use for a mechanism already
being built for an adversarial reason, and it is worth naming so the constructor
is not built enemy-specific.

**M29. Horvitz's expected-value framing is the same economy, and it closes the
loop with Russell & Wefald.** "Invoke the automated service when its expected
value exceeds the cost, including the cost of bothering the user" is
metareasoning (domain 2, S6) applied to the human channel: a dialogue turn is a
computation whose value is its ability to change what gets played. So the
operator surface is not a separate subsystem — it is one more row in the same
allowance ledger, with a cost denominated in operator attention rather than
quanta. **Two currencies, one economy**, which is exactly the two-currencies
discipline the voc lever menu already asserts.

---

## 10.4 Verdicts the lens agents can act on

- **THE CONVERGENT CONCLUSION (all lenses):** REDUCTION must return **a set of
  options with the conditions under which each dominates**, not a scalar.
  Domain 3 (maximality) reached it from decision theory, domain 8 (α-vectors and
  their dominance regions) from POSG value theory, domain 10 (fact/foil) from the
  psychology of explanation. Three unrelated fields, one type. A scalar reduction
  discards the Centaur surface, the value of information, and the record of what
  the search learned — all at once.
- **VALUE:** the Centaur surface must be built on the **per-unit flow records**,
  not the aggregate score — Miller's finding 3 says a statistical claim is not an
  explanation, and the flows are the causal vocabulary the fold already produces.
  Practical consequence: do not sum the flows before caching, or the causal
  content is destroyed at the memo boundary.
- **COMPOSITION / TIME (cheapest item in this domain):** record
  `(runner-up plan, deciding rung, margin)` for the top-k plans on every
  decision. `better()` already computes it and throws it away. That single
  telemetry column turns every decision into a contrastive explanation, gives the
  VOI calculation its inputs (C8's "P(refinement flips `better()`)" is a function
  of exactly that margin), and gives the inert-weight instrument its
  point-of-comparison spread (VALUE M2) — **one column, three consumers.**
- **BELIEF / TIME:** add **"ask the operator"** to the ECONOMY joint as a
  purchasable observation, priced in operator attention. It is the third way to
  remove width (deduce / observe / ask), it is the only lever available against
  game-held width when compute cannot buy it, and Horvitz's principles say it
  must be priced rather than either suppressed or free.
- **BELIEF:** index the `Belief(observer)` constructor on the *operator* as well
  as the enemy — finding 4 makes the explainee's beliefs part of the explanation,
  and the mechanism is already being built.
- **DESIGN LAW:** complete internally, selected externally. The provenance
  apparatus should be exhaustive; the surface should show one or two causes, the
  deciding rung, and the foil.
