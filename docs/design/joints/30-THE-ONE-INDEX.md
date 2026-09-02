# The one index — adopted, with two resolutions, two scales, and a fifth operation

Cycle 13, capstone adjudication. The librarian's `29-the-one-index.md` claims
eight appearances, seven names and one object, addressed to this lens's spine.
**Adopted** — with three precisions that change what gets built, one refusal,
and one addition that the claim's own reference implementation makes obvious
and that my framing had missed entirely.

---

## 1. The claim, tested rather than accepted

Their eight, each checked against the question *"under what conditions was this
computed, and to what is it commensurable"*:

| appearance | verdict |
|---|---|
| this lens's **premise** | the object, by construction |
| belief's **projection tag** (horizon, quantifier-or-weight, basis) | **same object**, restricted to the epistemic coordinates; same refusal law |
| the bank's **basis** (assumptions + canonicalise + union + refuse) | **same object, and the reference implementation** — see §5 |
| the **CPP's conditioning variable** | **same object**, applied to a fitted number: it says which boards the profile is commensurable with, which is `FitProvenance.shapes` |
| **Rice's F** (algorithm selection) | **same object**, restricted to the selection-relevant coordinates |
| **ISA's instance features** | same object **at a different scale** — §4 |
| the **trace key** (read hashes + result hash) | same object **at a different resolution** — §3 |
| **induced width's home** | **not a coordinate.** Refused; §6 |

So the honest count is **six appearances of one object, one at a second
resolution, one at a second scale, and one that is not an instance at all.**
That is a stronger claim than eight-of-eight, because it survives the check.

---

## 2. The meta-disease is real, and its remedy is an operator I already named

Four lenses each independently found *"the index is missing a coordinate"* —
botId/resolved-closure (mine), range (mine, via C37), evalVersion, memo
namespace — **and none noticed the others had.** Two premises for one value,
maintained separately, one level up from the disease this lens is named for.

The remedy is not care. It is the **inversion operator** (`27 §II`), applied to
the index itself:

> **The index is this programme's primary inversion candidate.** It is
> implemented at least five times inside hidden modules — the bank's basis, the
> projection tag, the memo namespace, the CPP's conditioning variable, the trace
> key — and inverting it means hoisting **one definition site** into the visible
> layer, with CI asserting that **no module defines its own conditioning
> tuple**. That check is the same shape as the bijection law: a conditioning
> tuple that the index does not name fails the build.

And the four independent discoveries stop being embarrassing and start being
evidence: an object rediscovered four times in four weeks by four readers is
exactly what a missing inversion looks like from the inside.

---

## 3. First precision — two RESOLUTIONS, and the trace key is the fine one

The index and the trace key answer the same question at different resolutions,
and conflating them would be a category error in the other direction:

| resolution | what it carries | used for |
|---|---|---|
| **descriptive** | *which coordinates*, and their canonical values | **refusal** and **tightening** — is this comparable to that |
| **extensional** | *the hashes of the values actually read*, plus the result hash | **reuse** — is a stored result still valid |

The descriptive resolution answers "may these two meet"; the extensional answers
"has anything I depended on moved". Law I's sentence already had this shape and
I did not see it was about the index: **names find, hashes validate** — and now,
one level up, *coordinates decide comparability, hashes decide freshness.*

## 4. Second precision — two SCALES, and they need not share coordinates

Their instance-features result forces this and it is right. The index appears at
two scales whose *things being compared* are different, so their coordinate sets
differ:

| | **decision scale** | **experiment scale** |
|---|---|---|
| indexes | a value inside one decision (a bound, a projection, a memo entry) | a measurement row (an outcome, a fitted number) |
| coordinates | support · observable (horizon + provenance-of-computation) · measure (weight + range) · the *fixed* config | cell / boardHash · arm ⟨codeRef, botId, seat⟩ · regime · opponents · corpus |
| the law's instantiation | **comparison** — two values meet only at equal index | **pooling** — two rows pool only at equal index |
| operations | join · meet · advance · tighten | pool · stratify |

**Pooling is the experiment-scale comparison**, and pooling rows that differ in a
coordinate is exactly "letting two incomparable things compare" — which is how
the potion verdicts pooled across boards with no potion on them, and how a
knight board and a queen board would pool if instance features were dropped.

**Why instance features pass at experiment scale and fail at decision scale**,
stated so it does not look arbitrary: within one decision the board is fixed, so
conditioning on its features changes nothing that is not already determined —
and if a bot *does* condition on them (a `conditional` choice on a board-shape
predicate), the effect is already recorded downstream as **resolved selections**
inside provenance-of-computation. They are derived at decision scale precisely
because their consequence is captured there.

> **The manifest draws the distinction** (it had not): every coordinate declares
> its **scale** — `decision`, `experiment`, or `both` — and a coordinate may be
> **promoted** between scales only by an argument that it becomes load-bearing
> there. `botId` is `both`; `frame` and `range` are `decision`; `opponents`,
> `corpus` and `regime` are `experiment`; `boardHash` is `both` but does
> different work at each.

## 5. Third precision — M74 is the most important practical claim here, and it changes the cost

*"The bounds bank already implements the index correctly — assumptions,
canonicalise, union, refuse."* Agreed, and this is the item that moves the
build estimate:

> **The work is recognition and inversion, not invention.** The index is not new
> machinery to design; it is the bank's basis discipline, generalised out of the
> bounds layer and hoisted. Every property the design needs has a shipped
> reference: canonicalisation exists, union-as-join exists, refusal-on-mismatch
> exists and is tested, and epoch-clearing is `advance` at the pin boundary.

That materially de-risks B1/B2: the question stops being "will this work" and
becomes "does the generalisation preserve what the bank already proves".

### The fifth operation, which my framing missed

Domain 23's addition: **a shared basis also TIGHTENS, not only refuses.** Two
floors under the same basis take their max; two ceilings take their min. The
bank does this today.

My algebra has been almost entirely negative — join (widen), meet (narrow),
advance (transport), all about movement and refusal. The bank shows the index's
*positive* face:

> **Law T (index equality licenses tightening).** Values at an equal index do
> not merely become comparable; they **compose to a tighter bound**. Refusal is
> what the index costs; tightening is what it pays.

That reframes the whole cost argument. An index justified only by refusals is a
tax; an index that also converts every equal-index pair into a tighter bound is
an asset, and it explains why the bank's discipline survived four months of
churn while every ad-hoc conditioning tuple around it drifted.

**Budget charge, honestly** (`27 §5`): Law T is a fourteenth named law against a
cap of fifteen. The two-scale split adds **no** components — it partitions the
existing nine and, per scale, reduces the count a consumer must carry. C59
(§6) is an admission rule rather than a dimension.

---

## 6. C59 adopted as the admission test — and it is complementary to the budget, not in collision with it

> *A coordinate earns its place only if dropping it would let two incomparable
> things compare, or force a recomputation that need not happen.*

Well-formed: the first clause is soundness (refusal), the second is efficiency
(reuse) — exactly the index's two uses. Adopted, and the supposed collision with
`27 §5` dissolves once the two are named for what they are:

- **C59 is the admission rule** — it argues the *item*;
- **the budget is the capacity constraint** — it argues the *total*.

You need both. A test alone admits an unbounded number of individually-justified
coordinates, **which is precisely how four lenses each added one without
noticing**; a budget alone gives no principle for choosing what to drop.

Applied, with their three results confirmed and one refusal made explicit:

| candidate | C59 | disposition |
|---|---|---|
| **range** | dropping it lets two differently-reached states compare | **coordinate** (measure group) |
| **induced width** | dropping it lets nothing incomparable compare, and it is cheap to recompute | **REFUSED as a coordinate; derived from board + cluster structure.** It may gate a choice; a gate reads the index, it does not join it |
| **instance features** | pooling: yes. decision: no | **experiment scale only** (§4) |
| **evalVersion** | dropping it serves one lineup's numbers to another | **coordinate** — and it is the same rule as `frame`-in-the-key and `data/*@version` pinning: *what the value depends on belongs in the key* |

---

## 7. The over-unification counter, answered with tiers that already exist

Their honest counter — one enormous key that churns constantly, so nothing ever
hits — is answered by durability tiers, which is my own stable/volatile split
with the field mechanism made explicit:

| tier | coordinates | churn |
|---|---|---|
| **match-durable** | codeRef, botId, corpus, opponents | once per match |
| **decision-durable** | boardHash, frame, horizon, resolved selections | once per decision |
| **branch-volatile** | model, pins, range at this node | per branch |
| **extensional** | trace hashes (§3) | per read |

The key is the concatenation of tier digests, and **each consumer names the
coarsest tier that determines it**. A memo keyed at decision-durable does not
churn when a branch-volatile coordinate moves; a measurement row keyed at
match-durable ignores both. That is exactly Nix's stable/volatile lesson
(`14 §A`) applied to the index rather than to `botId` alone, and it is why the
one-index claim does not collapse into one giant hash.

---

## 8. Net changes

| # | change | affects | budget |
|---|---|---|---|
| 1 | **one index, one definition site**, with CI refusing any module-local conditioning tuple; the index is the primary **inversion** candidate | manifest, `27 §II` | none (an inversion *reduces* duplicated structure) |
| 2 | two **resolutions**: descriptive (comparability) and extensional (freshness) — *coordinates decide comparability, hashes decide freshness* | `18 §1`, `01` | none |
| 3 | two **scales** — decision and experiment — with per-coordinate `scale` declarations and promotion by argument; **pooling is the experiment-scale comparison** | `01`, `20` | none (partitions the existing nine) |
| 4 | **Law T**: index equality licenses **tightening**, not only comparison — the index's positive face, and the reason the bank's discipline survived | `07 §3` | +1 law (14 of 15) |
| 5 | **C59** adopted as the admission rule, complementary to the budget's capacity rule | `27 §5` | none |
| 6 | **induced width refused** as a coordinate (derived; a gate reads the index rather than joining it) | — | none |
| 7 | **durability tiers** made explicit, each consumer naming its coarsest determining tier | `14 §A`, `18` | none |

The claim is adopted because it survives its own test at six of eight, because
its two exceptions turn out to be a second resolution and a second scale rather
than counterexamples, and because the one thing it says that I had not — that
the bank already implements it, and that a shared basis *tightens* — is the part
that turns the index from a tax into an asset.
