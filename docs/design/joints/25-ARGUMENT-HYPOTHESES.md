# Arguments have premises too — and the evidence class that dodges the oracle problem

Cycle 11. Two items from the librarian's R-6 register (`design/prior-art`,
domain 18), adjudicated. The first is adopted with a **narrowing that its own
evidence forces**; the second is adopted outright with one boundary stated so it
is not oversold.

---

## PART I — R-6: every soundness argument names its hypothesis

### 1. The diagnosis is right, and it is the fibration one type-level up

Their shape: *"a soundness argument was made under a condition, the condition
stopped holding, and nothing failed."* Six recorded defects fit it.

My fibration protects **values**: a number carries the premise it was computed
under, and comparison across fibres refuses. It says nothing about
**arguments** — the proofs-in-comments that justify an optimisation, a skip, a
cache key or a refusal. And an argument is exactly a value whose content is a
guarantee:

> **Law A (argument premises).** A soundness argument is a fibered value. It
> carries its hypotheses, and the hypotheses are **checkable at the site where
> the guarantee is consumed** — not where the prose is written, because at the
> prose the hypothesis is still true. The manifest records argument →
> hypotheses → consuming sites, which is what makes the link mechanical rather
> than editorial.

That placement is the part worth insisting on. Design-by-Contract puts a
precondition on the *function*; these hypotheses are preconditions of a *proof*
that licenses behaviour somewhere else — "cross-cluster-zero assumes known
cells" licenses **skipping** the cross terms, so the assertion belongs at the
skip. A convention that puts the assertion next to the argument documents a
truth; the manifest is what carries it to where it can be violated.

### 2. The narrowing their own evidence forces: dissolve before you assert

Walking their six against this design as it now stands produces a result I did
not expect and that changes the law's application:

| recorded defect | hypothesis | disposition **now** |
|---|---|---|
| the switch override assumed one engine | a single binding site exists | **dissolved** — totality: a bot is a total map, and a second channel is unrepresentable (`06 §2`) |
| the miner assumed the field was emitted | the column exists and is populated | **dissolved** — refuse-unknown, never-default, flag-saturated (`23 §5`) |
| `MechanismReport.loop` assumed an upstream counter | the counter is produced | **dissolved** — engagement counters are generated per member and per part (`07 §2`, Law M) |
| static `CloudPremise` assumed a sim covenant (no spawning while frozen) | items do not spawn mid-line | **dissolved** — the premise becomes *derived* from the exposed `SpawnLaw` (`24 §2`) |
| the premise-keyed memo assumed perfect information | history implies nothing extra | **dissolved** — the **range** coordinate (`24 §1`) |
| cross-cluster-zero assumed known cells | the cell set is fully determined | **ASSERT** — nothing in this design removes the assumption |

**Five of six are dissolved by structural changes already made, and one needs an
assertion.** That is strong evidence the diagnosis points at the right class —
every one of those changes was made for an independent reason and each closed a
member of this family — and it is also the ordering rule the law needs, or it
becomes "assert everything everywhere":

> **Dispositions, in order of preference.** **Dissolve** (change the structure so
> the hypothesis is no longer assumed) → **derive** (compute the hypothesis from
> something already exposed) → **assert** (executable check at the consuming
> site) → **drop and record** (the guarantee is knowingly forgone; write it
> down where the claim used to be).

The fourth is not hypothetical: local-compilation optimality assumes a tree, we
share by design, and `18 §2` already records it as **deliberately dropped**
rather than asserted. An assertion there would fire on every decision and be
muted within a week.

### 3. The three tiers, because a hot-path assertion is a real cost

The manifest declares *how* each hypothesis is checked, and the default for a
hot-path hypothesis is **not** a runtime assert:

| tier | when | example |
|---|---|---|
| **static** | the hypothesis is structural | "assumes a tree" → assert the sharing graph at registration; "assumes one engine" → the totality check |
| **runtime, at the consuming site** | cheap boolean, off the inner loop | "assumes known cells" → assert determinacy before the skip |
| **tripwire test** | the hypothesis is expensive to check live | a test that **fails when the hypothesis is violated by construction** |

### 4. The requirement that keeps this from becoming prose with an `if` in front

An assertion that never fires is indistinguishable from a hypothesis that cannot
be violated — the same problem Law R's engagement clause has, and the repo has
already solved it once: `depth-engagement.test.ts` is *"verified by
falsification (deleting the `clusterOf` call fails it)"*.

> **Every declared hypothesis owes a falsification test** that violates it and
> shows the check fires. An assertion with no falsification is not evidence that
> the hypothesis holds; it is evidence that nobody has tried.

### 5. M55's three new-work arguments — two dissolve, one is already dropped

Their point stands that these should be handled *before* violating code exists.
Applying §2's ordering:

- **CPP saturation assumes a fixed `evalVersion`** → **dissolve**: put
  `evalVersion` in the cache key. This is the same fix as `frame`-in-the-key
  (`06 §1.2`) and the same fix as `data/*@version` pinning (`15 §A`) — three
  instances of one rule, *what the value depends on belongs in the key*.
- **φ_uv ≡ 0 assumes point positions** → **dissolve**: under scoped
  contributions the scope declaration *is* the statement of which units
  interact, so scope by **occupancy overlap** rather than destination equality
  and the hypothesis disappears. (A trail unit occupies many cells; two units
  can interact without sharing a destination, which is exactly what the point
  assumption misses.)
- **Local-compilation optimality assumes a tree** → **already dropped and
  recorded** (`18 §2`).

So M55's real yield is not three assertions; it is **two dissolutions found
before the violating code was written**, which is the law working as intended
one step earlier than usual.

---

## PART II — M54: metamorphic relations are evidence immune to the oracle problem

### 6. Why they dodge ruling 49, stated in this design's own terms

Ruling 49's problem is that bot-versus-bot numbers are distortion-prone: a
verdict inherits the reference population's weaknesses, and `08` prices that as
a **transfer penalty** on any fitted number consumed outside its fibre.

A metamorphic relation compares **the bot to itself under a transformation of
the input**, so:

> the fit premise and the live premise are **identical except for the
> transformation**, which the relation declares to be semantics-preserving.
> `σ²_transfer = 0` by construction. No reference population, no opponent, no
> metric, no scoring rule.

That is the precise reason this evidence class is immune, and it is a
one-sentence consequence of the coordinate machinery rather than a new
argument.

### 7. The four relations, and where each already half-exists

| relation | statement | status here |
|---|---|---|
| **seat symmetry** | relabel seats; decisions are equivariant | **would have caught two recorded defects**: the arm config merged into every seat, and `verify-null` picking a seat by write-order race |
| **iteration-order invariance** | permute the order of equivalent work; the decision is unchanged up to declared tie-breaks | the salted tie key exists precisely to make this checkable; the anytime loop's unexplained slice-count non-reproducibility is an open instrument mystery this relation would characterise |
| **allowance monotonicity** | more budget never lowers the **proved floor** | the ratchet already asserts a version of this within a decision; the relation extends it across budgets. Note the sharpening: monotone in the *floor*, **not** in `sharePar` — more compute may legitimately change a decision and lose a game |
| **premise widening** | widening a premise never tightens a bound | this is the law harness's monotonicity property, generalised from one member to the whole pipeline |

### 8. Why we generate none of it, and what changes

The whole evidence machinery is **batch-shaped**: paired arms, A/A floors,
blocks, seat rotation, box-load controls. Metamorphic evidence is **test-shaped**
— deterministic, single-process, no opponent, no floor, and cheap enough to run
in CI on every commit. We have no channel for it, so none is produced.

> **Adopted into `20-MEASUREMENT-MIGRATION.md`** as a generated check family: the
> manifest declares which input transformations are **semantics-preserving**,
> and the harness generates the paired runs and the comparison. It joins the
> miner's three rules (refuse unknown, never default absent, flag saturated) as
> the fourth thing the manifest gives the measurement side for free.

And it composes with an object already in this design: `behaviourId` hashes
decisions over a canonical probe suite; a metamorphic relation is a **property
over that same suite** rather than a hash of it. **One probe corpus, two uses** —
equivalence hashing for early cutoff, metamorphic assertions for defect
detection.

### 9. The boundary, stated so it is not oversold

Metamorphic relations test **consistency, not strength**. A bot that is
consistently bad passes every one of them. They are immune to the oracle problem
*precisely because they do not measure quality* — they measure the absence of a
defect class. So they are a complement to match play and never a substitute, and
the honest claim is:

> They cannot tell us a bot is good. They can tell us — cheaply, deterministically
> and without a reference population — that it is not broken in four specific
> ways we have already been broken in twice.

---

## 10. Net changes

| change | source | affects |
|---|---|---|
| **Law A**: arguments carry hypotheses; the manifest records argument → hypotheses → consuming sites | R-6 | `07 §3` law table |
| the **disposition ordering** — dissolve → derive → assert → drop-and-record — with five of the six recorded defects already dissolved | this adjudication | `07 §7` risks, `18 §2` |
| **tiers** (static / runtime-at-consumption / tripwire), hot-path default is not a runtime assert | this adjudication | manifest schema |
| **every hypothesis owes a falsification test** | the repo's own tripwire precedent | CI |
| M55: two dissolutions (`evalVersion` in the key; scope by occupancy overlap), one already dropped | R-6 / this adjudication | `15 §C`, cache keys |
| **metamorphic relations** as a generated, ruling-49-immune check family sharing the `behaviourId` probe corpus | M54 | `20`, `14 §A` |
