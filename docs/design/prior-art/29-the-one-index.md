# PRIOR ART 29 — the one index: seven names for the same coordinate system

This is the only document in the survey that is a **synthesis rather than a
survey**. It exists because the cross-domain view is the one thing a librarian
has that none of the four lenses has, and because after twenty-eight domains the
same object has now appeared in **eight places under seven names**.

The claim: **there is one index. The four lenses, the bounds bank, and four
separate literatures are each conditioning on it, and each has named it
something different.** If that is right, it is the deepest joint the programme
has found, and it changes what the manifest is for.

---

## 29.1 The eight appearances

| where | what it is called | what it indexes |
|---|---|---|
| **COMPOSITION** (`01-PREMISE-LATTICE.md`) | **premise** — ⟨support, observable, measure, config⟩, plus **range** (d12/C37) | which values are comparable |
| **BELIEF** (`04-SYNTHESIS.md` §2Q2) | the **projection tag** — (horizon, quantifier-or-weight, basis) | which numbers may be compared without refusal |
| **BOUNDS** (`score.ts`) | the **basis** / assumption set, canonicalised by `basisKeyOf` | which bounds may be joined |
| **TIME** (d2/C5, now built) | the **conditioning variable** of the conditional performance profile | what an allowance buys |
| **ALGORITHM SELECTION** (d14, Rice 1976) | the **feature space** `F` in `S: F → A` | which member is right here |
| **INSTANCE SPACE ANALYSIS** (d26, Smith-Miles) | the **instance features** | which cells discriminate, and what coverage we have |
| **SEARCH** (d17/M52) | the **induced width** of the conflict graph | which closure algorithm is affordable |
| **INCREMENTAL COMPUTATION** (d5/d6) | the **key** of a verifying trace, plus **durability** | what may be reused, and what must be revalidated |

Two of these are the same by construction (the bounds basis is a projection of
the premise; the belief tag is another). The other six were arrived at
independently, in four different decades, by people solving different problems.

**The unifying statement:** every one of them answers *"under what conditions was
this computed, and to what other things is it therefore commensurable?"* That is
one question. It has one answer type.

---

## 29.2 Why this is a joint and not a coincidence

Three tests, and it passes all three.

**(a) The operations coincide.** Each named object supports the same three
operations, under different names:

| operation | premise | tag | basis | CPP | feature space | trace key |
|---|---|---|---|---|---|---|
| widen (lossy, free, total) | **join** | tag-erasure | assumption union | coarsen the stratum | drop a feature | coarsen the key (d5: *deliberately*, ECS) |
| narrow (partial, priced) | **meet** | condition | discharge | refine the stratum | add a feature | refine the key |
| transport across a turn | **advance** | re-tag | re-derive | re-stratify | recompute | new revision (Salsa) |

Three operations, six vocabularies, one algebra. That the ECS community
independently discovered *deliberate coarsening* (d5/C17) and the Salsa community
independently discovered *durability* (d6/M19) — both of which are statements
about how to widen this index cheaply — is the sort of convergence that indicates
a real object rather than a shared metaphor.

**(b) The failures coincide.** Every expensive failure the composition lens
catalogued is the same failure of this index: *"a value and the premise it was
computed under travel separately."* And every contradiction this survey found in
the same family is the index being wrong or missing a coordinate —
`botId` addressing the unresolved rather than resolved closure (d5/C16), the
missing **range** coordinate under imperfect information (d12/C37), the CPP not
keyed on `evalVersion` (d16/M48), the memo namespace shared across incommensurable
arrivals (d4/C14). **Four different lenses each found "the index is missing a
coordinate", and none of them noticed the others had.**

**(c) It predicts where the next coordinate goes.** If the index is one object,
then any *new* conditioning need should extend it rather than spawn a parallel
key. Three needs the survey has raised, and where they land:
  - **induced width** (d17) — a coordinate on the *decision*, read by the closure
    selector;
  - **board family / instance features** (d26) — coordinates on the *instance*,
    read by the arm selector and the coverage statement;
  - **the risk-budget balance** (d15) — a coordinate on the *game*, read by the
    reduction to decide how far from the floor it may depart.

  All three are currently on their way to becoming separate mechanisms in
  separate lenses. Under this reading they are three coordinates on one index,
  and the manifest is where they go.

---

## 29.3 The consequences, stated as design decisions

**M73. The premise index is the programme's single extensible coordinate
system, and that should be a named law.** Every conditioning need — comparison,
invalidation, transport, caching, selection, profiling, coverage — extends *this*
index. The alternative, which is what is happening by default, is that each lens
builds its own key with its own operations and its own drift, and then discovers
in six weeks that two of them disagree. **That is precisely the disease the
composition lens named**, occurring one level up: not "a value and its premise
travel separately" but "**two premises for one value, maintained separately**".

**C59. …and this collides head-on with the visible-layer budget, which is the
right tension to have.** Domain 22's M61 says the visible layer is expensive
because everything hidden pays for it, and the joints lens has adopted a budget
that (in their words) *binds them first*. This document is an argument for
putting **more** in the visible layer. Both are right, and the resolution is
neither "add everything" nor "add nothing":

  - **the index is one thing** (this document) — do not build parallel keys;
  - **the index is small** (d22/M61) — each coordinate must earn its place by
    naming what it makes comparable-or-not that nothing else does;
  - **so the test for a new coordinate is: does dropping it cause two things to
    be compared that should not be, or two things to be re-computed that need
    not?** If neither, it is a *derived* quantity and belongs computed from the
    index, not stored in it.

  Under that test, of the three candidates above: **range** passes (without it,
  incommensurable arrivals compare — d12); **induced width** fails as a
  coordinate and passes as a *derived* feature (it changes which algorithm runs,
  not which values are comparable); **instance features** pass at the *experiment*
  layer and fail at the *decision* layer — which is itself a useful distinction
  the programme has not drawn: **the index has two scales, per-decision and
  per-experiment, and they need not have the same coordinates.**

**M74. The bounds bank already implements the index correctly, and is the model
for the rest.** `ScoreBounds` carries `assumptions`, canonicalises them
(`basisKeyOf`), unions them (`unionAssumptions`), and refuses across them
(`compareFloors`, `onBasis`). That is the index with its algebra, built,
shipping, and load-bearing — and the composition lens's own diagnosis is that
*"every place that discipline stops is where weeks were lost."* The synthesis
here is that the discipline should not be *extended* to other places as a new
mechanism; the other places should be **recognised as instances of the one
already built**. Domain 23's finding is the sharpest version: the bank uses the
basis only for **refusal**, and affine arithmetic says a shared basis is also
**information** that can *tighten*. Same index, one more operation.

---

## 29.4 The honest counter-argument

The strongest objection is that this is **over-unification** — that "under what
conditions was this computed" is a question so general that many different
objects answer it, and collapsing them into one coordinate system will produce a
key that is enormous, churns constantly, and is therefore useless as a memo key
(which is composition risk 1, arriving as a consequence rather than a risk).

That objection has force and the survey supplies the mitigation rather than a
refutation: **Salsa's durability** (d6/M19) exists exactly because a single
dependency key with heterogeneous stability is unusable, and its answer is to
*stratify the index by how often each coordinate changes* rather than to split it
into separate keys. So the shape is: **one index, several durability tiers**,
with the stable tier hashed once per decision and the volatile tier per branch —
which is the composition lens's own proposed split, now with the field's
mechanism behind it and a reason to believe it is the right shape rather than a
workaround.

**And the falsifier is cheap and specific:** if two of the eight appearances turn
out to need *incompatible* operations — for instance if the CPP's stratum
coarsening cannot be expressed as a premise join — then they are not one object
and this document is wrong. Someone should try to express each of the eight as
the same three operations and report the first one that resists. That is an
afternoon's work against documents that already exist.

---

## 29.5 Verdicts

- **ALL LENSES:** you are each conditioning on the same index and have each named
  it differently — premise, projection tag, basis, CPP conditioning variable,
  feature space, instance features, trace key. Four separate literatures found it
  too. **Before building a seventh key, check whether the coordinate belongs on
  the premise.** Four of you have independently found "the index is missing a
  coordinate" and none noticed the others had.
- **COMPOSITION:** adopt the law — *the premise index is the single extensible
  coordinate system* — together with the test that keeps it small: **a coordinate
  earns its place only if dropping it would let two incomparable things compare,
  or force something to be recomputed that need not be.** Anything else is
  derived. And draw the distinction this test exposes: **the index has a
  per-decision scale and a per-experiment scale, and they need not share
  coordinates.**
- **COMPOSITION / TIME:** the resolution of "one index" against the visible-layer
  budget is **Salsa's durability**, not a split into separate keys — one index,
  several stability tiers. That is the lens's own stable/volatile proposal with a
  field mechanism behind it.
- **BOUNDS:** you already have this object with its algebra, shipping. The rest of
  the programme should be recognised as instances of it rather than building
  parallel machinery — and per domain 23, the one operation you are missing is
  letting a shared basis **tighten** rather than only refuse.
- **FALSIFIER (an afternoon, against documents that exist):** express each of the
  eight appearances as the same three operations (widen / narrow / transport) and
  report the first that resists. If one does, they are not one object and this
  document is wrong.
