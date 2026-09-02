# PRIOR ART 18 — guarding a theorem's hypothesis

Domain: the verification practice that would have caught, in advance, the single
recurring failure this programme keeps paying for — **an argument outliving its
hypothesis.**

This domain is different from the others: it is not a source of members, it is a
source of **one design law**, and that law unifies at least five separate defects
already on record plus two contradictions raised earlier in this survey.

---

## 18.1 The pattern, in our own history

Every one of these is the same shape: a soundness argument was made under a
condition, the condition later stopped holding, and **nothing failed**.

| the argument | its unstated hypothesis | what happened when it lapsed |
|---|---|---|
| `cluster-enum.ts`: "cross-cluster terms are **provably zero** — not approximately, identically" | *every unit is at a known cell* | (predicted, domain 12's C36) fog makes a unit a set spanning components; the identity becomes false and no test notices |
| `CloudPremise`: "item spawning is gated off while anything is frozen" | *a simulation covenant* | false in production (potions 0.15/turn, always on) — the belief lens found this by reading, not by a failure |
| premise-keyed memoisation is sound | *perfect information (the range is a point mass)* | (predicted, domain 12's C37) under fog the cache returns a plausible wrong number |
| "a switch set and silently overridden per engine" | *one engine* | the override was invisible until a measurement was invalidated |
| the miner reading a field name nothing published | *the field is emitted* | "the layer refused" became indistinguishable from "the layer was never asked" — a working layer reported dead |
| `MechanismReport.loop` before the retrofit | *an upstream counter exists* | same class, caught late and by hand |

Five recorded, two predicted. The programme's own diagnosis of the disease is
right — *"a value and the premise it was computed under travel separately"* — but
the remedy it proposes (fibered values, comparison refusal) protects **values**.
None of these six is a value. They are **arguments**, and arguments have premises
too.

---

## 18.2 What the experts do

**S43. Meyer, *Design by Contract* (Eiffel, 1986–92).** Every routine carries a
**precondition** it may assume and a **postcondition** it must establish, plus
class **invariants**. The load-bearing move is that these are *executable* and
*checked*, so an assumption that stops holding produces a failure at the moment
it stops, not at the moment its consequences become visible.

**S44. Chen et al., *Metamorphic testing* (1998; survey: Segura et al., *A survey
on metamorphic testing*, TSE 2016).** The answer to the **oracle problem** —
"either an oracle does not exist… or an oracle exists but cannot be used due to
feasibility issues". Instead of checking one output, check a **metamorphic
relation**: a necessary property relating the outputs of *multiple* executions
(the canonical toy example: `x₁ = −x₂ ⟹ x₁² = x₂²`).

**S45. Havelund & Roşu, runtime verification (Java PathExplorer; the RV
literature).** Monitoring a running system against a temporal specification, so
that a violation is reported from the execution trace itself. The relevant
sub-practice is **assumption-based runtime verification**: monitor not only the
property you want, but the *assumptions* the property's proof rests on.

---

## 18.3 The law, and why it is cheap here

> **Every soundness argument in the codebase names a hypothesis. That hypothesis
> must be an executable assertion, or the argument will outlive its truth.**

This is Design by Contract applied to *proofs in comments* rather than to
routines, and it is unusually cheap in this codebase because the hypotheses are
already written down — in the module headers, in the law suites' prose, in the
bounds' assumption tags. What is missing is that they are **prose**, and prose
does not fail.

Three concrete forms:

1. **A hypothesis assertion beside every proved identity.** `cluster-enum.ts`
   already asserts the *conclusion* in its law suite ("the order-2 truncation
   reproduces CL1's potential identically"). Add an assertion of the
   *hypothesis*: every subject's position is a point, not a set. When fog lands,
   that assertion fires on the first fogged decision — which is the correct
   behaviour, because the exactness claim really has lapsed — instead of the
   identity quietly becoming an approximation of unknown size.

2. **Metamorphic relations where there is no oracle** — which is our situation
   for almost everything. We cannot check "is this the right move", but we can
   check relations across executions, and several are free:
   - *seat symmetry*: swap the arms' seats on the same seed; the pair's outcome
     should be the reflection (this is Fishtest's paired design, domain 4's M11,
     used as a **test** rather than only as a statistic);
   - *order invariance*: shuffle the iteration order of any map/set the search
     reads; the chosen plan must be identical (`order-shuffle.test.ts` exists —
     generalise it, since GGPO names unordered-collection iteration as a top
     desync cause, domain 6's C23);
   - *allowance monotonicity*: more quanta must never make the proved floor
     worse (a genuine metamorphic relation over the CPP, and a direct check on
     the anti-latch law);
   - *premise widening*: a value computed under a wider premise must bound the
     value under a narrower one — the fibration's own join law, executable.

3. **Runtime verification of the premises, not only the values.** The belief
   lens's **reappearance oracle** ("every reveal must land inside the predicted
   cloud; a violation throws") is exactly this pattern, and it is the best
   mechanism in the programme. The finding here is that it is being built for
   *one* argument when the pattern generalises: **each of the six rows in §18.1
   deserves its own thrown oracle**, and they cost about as little as that one
   does.

---

## 18.4 Mapping onto our joint

**M53. The refusal law and the hypothesis law are the same law at two levels,
and only one of them is built.** The composition lens's refusal law says two
numbers computed under different premises may not be compared. The hypothesis law
says an argument may not be *relied on* outside its premise. The first protects
values; the second protects proofs. The manifest is the natural home for both:
alongside each joint's composition law, record the **hypotheses that law depends
on** and the assertion that checks each. That turns "the manifest generates the
codec, the stamp, the columns, the diff and the docs" into "…and the hypothesis
assertions", which is the version that would have caught five of the six rows.

**M54. Metamorphic testing is the answer to a problem the programme has stated
and not named.** Ruling 49's concern — that results are driven by scoring-rule
choices rather than intrinsic efficacy — is a form of the **oracle problem**: we
cannot check a decision against ground truth, so we check it against an aggregate
we chose. Metamorphic relations sidestep this entirely, because they compare
*executions to each other* under transformations whose effect is known a priori,
and their verdicts do not depend on the scoring rule at all. That is a class of
evidence about bot quality that is **immune to the distortion the owner is
worried about**, and we currently generate none of it.

**M55. The pattern predicts where the next one will be.** Applying §18.1's shape
prospectively to the current designs, three arguments in the *new* work already
have unstated hypotheses:
  - the CPP's saturation reading assumes the evaluator version is fixed
    (domain 16's M48 — key it on `evalVersion`);
  - `φ_uv ≡ 0` cross-component independence assumes point positions
    (domain 12's C36);
  - "local compilation is optimal" assumes the allocation graph is a **tree**
    (domain 2's C7).
  Each is a candidate assertion today, before the code that will violate it
  exists. That is the cheapest moment.

---

## 18.5 Verdicts the lens agents can act on

- **ALL (one design law, and it is the cheapest structural change in the
  survey):** *every soundness argument names a hypothesis, and that hypothesis
  must be an executable assertion.* The hypotheses are already written as prose in
  module headers and law suites; prose does not fail. Five recorded defects and
  two predicted ones are the same disease, and the programme's stated diagnosis
  ("a value and its premise travel separately") protects values while every one of
  these was an **argument**.
- **COMPOSITION:** put **hypotheses and their assertions in the manifest**,
  beside each joint's composition law, and generate the assertions with everything
  else. That is the version of the manifest that would have caught the switch
  override, the unpublished field, and the sim covenant.
- **SEARCH:** assert the hypothesis of `φ_uv ≡ 0` — every subject's position is a
  point — *now*, so that fog trips it on the first fogged decision rather than
  degrading the exactness claim silently.
- **MEASUREMENT:** build **metamorphic relations**, which are the one class of
  evidence about bot quality that is immune to ruling 49's distortion because
  their verdicts do not depend on the scoring rule: seat symmetry, iteration-order
  invariance, allowance monotonicity, premise widening. Three of the four are
  nearly free and one (`order-shuffle`) already exists in embryo.
- **BELIEF:** the reappearance oracle is the best mechanism in the programme and
  it is being built for exactly one argument. Generalise the pattern; each row in
  §18.1 deserves its own thrown oracle at similar cost.
