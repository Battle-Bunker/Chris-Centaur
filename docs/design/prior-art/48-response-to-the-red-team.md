# PRIOR ART 48 — response to the red team: R-5 has an airtight exemption, C59 is dead, and the algebra has a fourth operation

Written against `design/red-team` @ `f1ff2a2` (round 4) and `9c8e79d` (round 3),
which attacked three of this survey's load-bearing claims and landed on all three.

**Four concessions and one answer.** The concessions are the point of the
document; the answer is that one of the three resistances is a defect this survey
had already found from the algebra side without recognising it as the same thing.

---

## 48.1 R-5 has an airtight narrow exemption, and I record it as such

**R-5** (*our architecture is a decomposition architecture, and decomposition is
unsound under imperfect information*) is one of this survey's strongest claims and
it now has a **correct, narrow exemption**, found by the search lens and adjudicated
by the red team:

> *"Burch et al.'s theorem is about re-solving a subgame **for its value**; under
> Law D1 cluster results are **proposals**, every priced plan is priced by the
> unconditional whole-board bank, and a proof about a priced plan cannot be
> falsified by the existence of unpriced ones. **The floors are safe.**"*

**Concede fully, and state the boundary precisely, because a narrow exemption that
is quoted without its edge becomes a wide one.** The exemption holds exactly while:

- **cluster results are proposals, not values** — the decomposition is used to
  *generate* candidates, never to *price* them;
- **every priced plan is priced by the unconditional whole-board bank**;
- and **nothing inside the proposing layer may write a bound** — the red team's
  first demand, and the right one: the wall is currently *"an import ban plus a
  structural test, described by the search lens as load-bearing 'for a reason its
  authors did not name'"*.

  **That third condition is R-6 in its purest recorded form**, and it is now the
  clearest instance the survey has: a soundness argument (R-5's exemption) rests on
  a property (`nothing in the proposing layer writes a bound`) which is enforced by
  a convention nobody has named as load-bearing. **Promote it to a law in the
  manifest's table**, as the red team asks — and note *why* the promotion matters
  more here than elsewhere: this is the one place where relaxing an import ban would
  silently convert a proposal into a value and reactivate an unsoundness theorem.

  **The correction to my own framing:** domain 12 stated R-5 as though the whole
  architecture were exposed. It is not. **The exposure is exactly at the sites that
  decompose *for a value*, and the design has a discipline that keeps most of them
  out of that category.** R-5 stands as written for the fog programme's memoisation
  and re-base questions (C37, C38), and does **not** apply to the cluster
  decomposition under D1. I should have drawn that line myself.

---

## 48.2 The one-index falsifier: three resistances, two conceded and one answered

The red team ran domain 29's own falsifier and returned: **the one-INDEX claim
survives; the one-ALGEBRA claim does not.** Taking the three in turn.

### Resistance 1 (horizon refuses `widen`) — concede, and note the survey already contained the correction

> *"`est[(1,f,w)]` and `est[(3,f,w)]` are **different quantities** … the only sound
> 'join' is the vacuous hull … erasing the horizon tag is not a widening, it is the
> laundering the refusal law exists to prevent."*

**Correct, and my table was wrong** to write "tag-erasure" under widen for the belief
tag. What is worth adding is that **the correcting argument is already in this
survey, in domain 43, written by me, without my noticing it corrected domain 29**:

- d43 §43.4 endorsed the joints lens's **Law H′** on exactly this ground — *"an
  intersection is sound only when both abstractions describe the **same concrete
  quantity**"*, and across horizons they do not, so *"the only sound combination is
  a widening [the hull], and the informative combination is a fold that declares its
  discount"*.
- That is the abstract-interpretation `join` rule, and it is the red team's
  resistance 1 in a different vocabulary.

  **So there are now three independent derivations of one missing law**: the red
  team's four rounds of demanding a cross-horizon comparison law, the joints lens's
  Law H′, and the framework's join/transfer-function split. The red team's own
  summary line — *"two independent derivations of one missing law is as loud as this
  gets"* — undercounts by one.

  **And the general lesson for my own work, which is the more useful output:** I
  produced the correction to my earlier claim in a later domain and did not connect
  them. The survey is now large enough that **this failure mode is structural, not
  careless** — which is an argument for domain 47's law map and against adding
  further un-indexed domains without cross-checking the earlier claims they bear on.

### Resistance 2 (the basis column's direction) — this is domain 38's C70, from the semantics side

> *"Either the table's basis column commits a direction error, or two lenses hold
> incompatible semantics for the same word."*

**It is the second, the two semantics have names, and there is a decision
procedure.** Domain 38 found the same defect from the algebra side without
recognising it as this one:

- read as **validity conditions**, assumptions compose by **conjunction**: a value
  annotated `{A, B}` holds only where both hold, so unioning makes the premise
  *stronger* and the world-set *narrower*. Cross-basis refusal is then motivated —
  a bound valid only under `A` cannot be compared out of `A`.
- read as **provenance records** (what the derivation used), they compose by a
  semiring's `+` for alternatives and `×` for joint use, and the union is a record
  of the derivation, not a claim about validity. Cross-basis refusal is then
  unmotivated.

  **d38's C70 is exactly the collapse between them**: `unionAssumptions` is
  `(P(X), ∪, ∪)` — **set union standing in for BOTH operations** — so the artifact
  cannot distinguish "either premise suffices" from "both are needed", which is the
  same distinction as "widen" versus "narrow" here. The red team found the ambiguity
  in the *documents*; domain 38 found it in the *code*. One defect.

  **The decision procedure follows from the semiring, and it is one question:** what
  is `∪` standing in for at each backup? At a `max` node it is joining
  *alternatives* (`+`); at a `min` node, *joint requirements* (`×`). The moment
  those are different operations, the direction question answers itself per
  operation instead of per column — and the table's single "basis: widen/narrow"
  cell is revealed as under-specified rather than backwards.

  So: **"one algebra" fails as stated and the red team's replacement is right** —
  *one partial order with per-coordinate operation sets and per-coordinate cost
  orientations*. I would add only that the basis coordinate needs **per-operation**
  orientation as well as per-coordinate, and that d38 says which operations.

### Resistance 3 (a fourth operation) — concede, and it has a law already

> *"moving a fitted number **sideways** — consuming it at a sibling premise the fit
> never covered — is neither join (unsound), meet (nothing narrows), nor advance (no
> turn boundary): it is the **penalized crossing**, and `08-FIT-PROVENANCE`'s
> `σ²_transfer` is its implementation."*

**Correct, and the fourth operation already has a law in this survey: it is R-12.**
A fitted number is the argmin of an expectation over a population; consuming it at
a different population is a **transfer**, and its cost is the generalisation gap
between the two populations. `σ²_transfer` is that gap priced. So the fourth
operation is not an anomaly — **it is what R-12 says must happen whenever a fitted
number moves**, and the reason it is not a join is exactly R-12's reason: the two
values solve *different problems*, not the same problem under different premises.

  Two additions the red team's framing earns:

  - **their Simpson's observation is R-11.** *"Re-pooling and re-fitting … can land
    outside the hull of the finer strata"* is precisely R-11's *"an aggregate can be
    zero, or the wrong sign, because two opposite things happen"*. So the danger of
    calling stratum-coarsening a join is a law we already have, and the survey has
    now recorded **four** instances of R-11.
  - **M119: the fourth operation is missing from BOTH tables.** Domain 29's eight
    appearances and the joints lens's operations table (d43, `join`/`meet`/`tighten`
    /`advance`) each lack it. Since that table is about to be **encoded as data**
    (their X1), the cheap moment to add a `transfer` column — *is this coordinate
    crossable, and at what priced penalty?* — is now. It is not a widening, it does
    not need a widening's termination argument (d43's C86), and it is the only
    operation whose cost is **precision** rather than compute, which is a distinction
    the compute-priced column cannot express.

---

## 48.3 C59 is dead as stated, and the replacement is R-6 at the coordinate layer

> *"'Dropping it lets two incomparables compare' presupposes the judgment in
> dispute: every proposed coordinate arrives with an argument that some comparison
> is unsound without it — that argument is why it was proposed — so the test as
> stated filters nothing; **every coordinate argues itself in** … Without this
> amendment, C59 is taste wearing a test's clothes."*

**Concede without qualification. The test was circular and I did not see it.** The
document's own three adjudications were decided by judgment, and the red team is
right that the test contributed nothing to them.

**Their replacement is better and I adopt it:** a coordinate earns its seat with a
**recorded exhibit** — *a concrete pair of values at one address with different
truths*, or *a theorem naming the pair*, or *a measured recomputation cost* — kept
on the coordinate the way `FitProvenance` is kept on a constant.

  **And it is not ad hoc: it is R-6 at the coordinate layer**, which is worth saying
  because it means the amendment inherits R-6's machinery and its discipline. R-6
  says a soundness argument's hypothesis must be an **executable assertion** rather
  than prose; the amendment says a coordinate's justification must be a **recorded
  witness** rather than an argument. Same move, one layer down. The four-defect
  table is four such witnesses; C37's range has a theorem; induced width has neither,
  which is why it was correctly demoted.

  **A note on domain 47's map, recorded honestly because it cuts my way and should
  be discounted accordingly:** this amendment is a *new instance of family A*
  produced by an adversarial reader who was not looking for one. A confirmation of a
  taxonomy from someone attacking a different claim is worth more than one the
  taxonomist generates, but it is one data point and the map's standing test (*if a
  fifteenth law does not fit, that is evidence against the map*) still applies.

---

## 48.4 What survives, stated plainly

The red team's own verdict is the right summary and I do not want to soften it:
**index YES, algebra NO-AS-STATED.**

What I would keep from domain 29 after this round:

- **M73's core survives all three resistances** — *do not build a seventh parallel
  key; extend the one index* — because every resistance is about the **operations**,
  not about whether the coordinates belong on one index. The red team concedes this
  explicitly and calls the convergence evidence *"the strongest paragraph in the
  document"*.
- **The algebra claim is replaced** by the joints lens's product-of-lattices
  formulation (d43 §43.1) plus per-coordinate cost orientations plus the fourth
  operation. That is three corrections to one paragraph of domain 29, arriving from
  three directions within a day of each other, which is itself worth noting: **the
  claim was under-specified in a way that invited exactly this, and the
  under-specification was mine.**
- **C59 is retired** and replaced by the witness test above.

---

## 48.5 Verdicts

- **SEARCH / BELIEF — R-5 has an AIRTIGHT NARROW EXEMPTION and I record it.** Under
  Law D1, cluster results are **proposals**, every priced plan is priced by the
  unconditional whole-board bank, and Burch et al.'s theorem is about re-solving a
  subgame **for its value** — so it cannot be falsified by the existence of unpriced
  proposals. **The floors are safe.** R-5 stands as written for the fog programme's
  memoisation and re-base questions (C37, C38) and does **not** apply to the cluster
  decomposition under D1. **The exemption's whole weight rests on one property —
  nothing in the proposing layer may write a bound — currently enforced by an import
  ban nobody has named as load-bearing.** That is R-6's purest recorded instance:
  promote it to a law, because relaxing that ban would silently convert a proposal
  into a value and reactivate an unsoundness theorem.
- **COMPOSITION — domain 29's ALGEBRA claim falls; the INDEX claim survives.**
  Conceded: the **horizon** coordinate refuses `widen` (a one-ply and a three-ply
  value are different quantities; the only sound join is the vacuous hull, and
  tag-erasure is laundering) — and **the survey already contained this correction**,
  in d43's endorsement of Law H′ on abstract interpretation's grounds, which I wrote
  without connecting it to d29. **Three independent derivations of one missing
  cross-horizon law**, not two.
- **COMPOSITION / SEARCH — the basis-column ambiguity is d38's C70 seen from the
  semantics side.** Assumptions as **validity conditions** compose by conjunction
  (union ⟹ *narrower*, and cross-basis refusal is motivated); as **provenance
  records** they compose by a semiring's `+`/`×` (union is a derivation record, and
  refusal is unmotivated). `unionAssumptions` uses **set union for BOTH operations**,
  which is precisely the collapse between the two readings. **The decision procedure
  is one question asked per operation, not per column**: what is `∪` standing in for
  — alternatives at a `max` node, joint requirements at a `min` node? The table's
  single basis cell is under-specified rather than backwards.
- **COMPOSITION (M119) — the fourth operation is R-12, and it is missing from BOTH
  tables.** Moving a fitted number sideways is a **transfer across populations**,
  whose cost is the generalisation gap — which is exactly what R-12 says must happen
  whenever a fitted number moves, and why it is not a join (the two values solve
  *different problems*, not one problem under different premises). Their Simpson's
  hazard is **R-11**, now at its fourth instance. **Add a `transfer` column to the
  operations table before X1 encodes it as data** — *is this coordinate crossable, at
  what priced penalty?* It needs no widening (d43's C86 does not apply to it), and it
  is the only operation priced in **precision** rather than compute, which the
  compute-priced column cannot express.
- **COMPOSITION — C59 is DEAD as stated and the replacement is adopted.** *"Every
  coordinate argues itself in"* — the test was circular and contributed nothing to
  the document's own three adjudications. Replaced by the red team's **witness
  test**: a coordinate earns its seat with a recorded exhibit — a concrete pair of
  values at one address with different truths, a theorem naming the pair, or a
  measured recomputation cost — kept on the coordinate as `FitProvenance` is kept on
  a constant. **This is R-6 at the coordinate layer**, so it inherits R-6's
  discipline rather than being a one-off.
- **A NOTE ON THIS SURVEY'S OWN FAILURE MODE, since it produced two of the above:**
  I wrote the correction to domain 29's horizon claim in domain 43 and did not
  connect them, and I found the basis ambiguity in domain 38's code reading without
  recognising it as the documents' ambiguity. At forty-eight domains that is
  **structural rather than careless** — and it is an argument for domain 47's law map
  and against adding further domains without cross-checking the earlier claims they
  bear on.
