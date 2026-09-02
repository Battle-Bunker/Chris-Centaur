# The index inversion — one definition site, per-coordinate operations, and the hull rule

Cycle 14. The build spec for M60's primary inversion candidate. `30` established
that the index is one object appearing under seven names; this says what is
built, in what order, with what gates, and — the part that turned out to carry
the most content — **what operations each coordinate actually supports**, which
is not uniform and was being assumed uniform.

---

## 1. What is being inverted

Five implementations of one object, each currently defining its own conditioning
tuple inside a hidden module:

| instance | where | what it does today |
|---|---|---|
| the **basis** | `bounds/` — `Assumption[]`, `basisKeyOf`, union, refuse | the reference implementation: canonicalise → union → refuse on mismatch |
| the **projection tag** | belief — `(horizon, quantifier-or-weight, basis)` | decides which numbers may be compared |
| the **memo namespace** | `bounds/evalmemo.ts` — `evaluatorIdentity + basisKey + asTeam` | decides which cached evaluation may be served |
| the **CPP conditioning variable** | fitted profiles | decides which boards a fitted number applies to |
| the **trace key** | proposed (`18 §1`) | decides whether a stored result is still fresh |

Inversion hoists them into **one definition site**, and each becomes a
**projection** of it. Nothing about the bank's behaviour changes; what changes is
that four other modules stop defining their own version of it.

---

## 2. The index is a PRODUCT of coordinate structures — not one lattice

This is the structural correction the spec work produced, and it answers the
librarian's own over-unification counter better than the durability tiers do.

The three-operation algebra (`join` / `meet` / `advance`), plus `tighten`
(`30 §5`) and the experiment-scale `pool` / `stratify`, are **not uniformly
available**. Each coordinate carries its own structure, and the index's
operations are those structures **lifted componentwise**:

| coordinate | join (widen) | meet (narrow) | tighten at equality | advance | **termination** (§10) | notes |
|---|---|---|---|---|---|---|
| `support.model` | drop assumptions → more worlds | simulate / enumerate — **compute-priced** | **yes** — two floors compose by max | clouds dilate, then condition on the new observation | bounded: finitely many units × `MAX_FROZEN` slots | the lattice everything else is modelled on |
| `support.replies` | union of reply sets | restrict to a modelled set — compute-priced | **yes** | **discarded**: this turn's replies do not survive the turn | bounded: finitely many legal replies | |
| `observable.horizon` | **hull only** (§4) | deepen — compute-priced | **NO** | re-root (h decrements) | bounded: `plyCap` | no tightening — but see §2.3: `measure.weight` also lacks it, for a different reason |
| `observable.provenance` (frame · admission trace · conditioning depth · resolved selections) | widen by the pending spans | compute the missing terms — compute-priced | **yes**, at equal frame | discarded — a new decision recomputes | **bounded**: the term set and the C-rung set are finite | |
| `measure.weight` | credal union | **a choice, not a purchase** — no compute buys it; ruling 13 pins it | **no** — two weights give two expectations; their meet is a credal set, not a tighter number | persists (it is config) | bounded: finitely many supplier members | |
| `measure.range` | mixture over histories | **conditioning on observed history — free at resolution** | via counterfactual-value bounds at the boundary | **updates** — the only coordinate whose `advance` is a real computation | **needs an operator**: compaction to *k* components with conservative union beyond (§10) | `24 §1` |
| `config.bot / codeRef / seat` | **none** | **none** | **no** | persists | trivial: no chain | equality-only: you cannot average two bots |
| `config.opponents / corpus / regime` | — | — | — | persists | trivial | **experiment scale**: `pool` at equality, `stratify` otherwise |

Three consequences worth stating plainly:

1. **"One index" does not mean "one lattice."** It means one *tuple* whose
   components have their own structures; the operations lift componentwise and
   are undefined where a component does not support them. A design that assumed
   uniform operations would, for instance, try to widen `botId`.
2. **Two coordinates are not purchasable at all.** `measure.weight` is a
   *choice* (and a ruling-pinned one); `config.*` is fixed. The ECONOMY lever
   menu must therefore be generated **from this table**, not written by hand —
   which is exactly the defect `voc.ts` has today, where a stale unit is offered
   only `catchup` because the preconditions were written per-lever rather than
   derived (`10 §F2`).
3. **Two coordinates lack `tighten`, for two different reasons** — a
   correction the running sketch produced against my own prose, which said
   horizon was the only one. `observable.horizon` lacks it because the two
   intervals bound **different random variables** (§4). `measure.weight` lacks
   it because tightening is a **sound-channel** operation and the weight governs
   the **advisory** channel: two readings under one weight compose by
   precision-weighted merge, not by max/min. Same absence, different cause, and
   conflating them would put an interval operation on a density.
4. **`measure.range` is the odd one and needs its own transport code.** Every
   other coordinate either persists or is discarded across `advance`; the range
   is *updated* by what the turn revealed. It is the one place `advance` is more
   than bookkeeping.

---

## 3. Law T, implemented

> **Law T.** Index equality licenses **tightening**: values at an equal index
> compose to a tighter bound rather than merely becoming comparable.

Implementation is the bank's, generalised:

```
tighten(a, b) requires index(a) == index(b)      // exact, canonicalised
  floors:   lo = max(a.lo, b.lo)
  ceilings: hi = min(a.hi, b.hi)
  refuse if lo > hi + BOUND_RELATIVE_EPSILON     // a genuine inversion still throws
  weaken to the midpoint within tolerance        // the existing rounding seam
```

Two guards the generalisation owes, neither of which the bank needs today
because it only ever tightens within one layer:

- **`tighten` is defined on the sound channel only.** Two `est` values at one
  index do not compose to a tighter `est`; they are two readings under one
  weight and their combination is a *precision* question, which is the
  belief-fold's job, not the index's.
- **Tightening is not transitive across a widening.** If `a` and `b` were joined
  to a weaker index to be compared, the result may not then be tightened against
  a third value at the *original* index. The widening record (`Assumption`) is
  what makes that detectable, and the check is index equality, not index
  compatibility.

---

## 4. The horizon hull-only rule — Law H's index-side twin

Law H (`12 §D5`) is the value-side statement: *horizons never compare as
projections; they meet only inside a fold that declares its discount.* Four
review rounds have asked for the bound-side statement, and the operations table
makes it fall out:

> **Law H′ (hull only).** Across different horizons the sound channel yields the
> **hull** and never an intersection: `[min(lo₁, lo_d), max(hi₁, hi_d)]`.
> Equality of horizon is a precondition of `tighten`; without it the only sound
> combination is a widening, and the *informative* combination is the
> precision-weighted fold, which lives in the advisory channel.

Why it must be the hull rather than the intersection, stated once so it is not
re-litigated: `[lo₁, hi₁]` bounds the **one-ply frame value** and `[lo_d, hi_d]`
bounds a **different random variable** — the value of a position d plies on.
Intersecting them asserts that the two quantities are the same, which is exactly
the claim the depth work spent a cycle disproving (the kill-one-lose-two case is
the counterexample: a plan can have the higher one-ply floor and the lower deep
value, and both bounds are correct). So:

| combination | sound channel | advisory channel |
|---|---|---|
| same horizon | **tighten** (max/min) | precision-weighted merge |
| different horizon | **hull** (min/max) — and it is usually vacuous, which is the honest answer | the fold, at earned precision, with the discount declared (Law H) |

The vacuity is the point: **the sound channel has almost nothing to say across
horizons, and pretending otherwise is where the arbitrary discounts came from.**

---

## 5. CI: refusing module-local conditioning tuples

The inversion is only real if a sixth instance cannot appear. Three checks,
each owing a falsification test (Law A §4, and the scout's shadowed lint is the
cautionary exhibit):

1. **Key-constructor allow-list.** Any function producing a cache key, memo
   namespace or comparison basis must be exported from the index module.
   Detection: identifiers matching `/(Identity|Key|Namespace|Basis|Tag)$/`
   defined outside it, plus any `Map`/`WeakMap` whose key type is a
   string built by concatenation from more than one field.
2. **No structural clones.** A type whose field set is a subset of the index's
   coordinates and which is used as a key is a clone. Detected structurally at
   build; an intentional one carries an allow-list entry **with a reason and a
   blocking condition**, the same self-retiring shape as the engagement waiver.
3. **Projection round-trip.** Every recognised instance is implemented as a
   *projection* of the index, and CI asserts on a replay corpus that the
   projection reproduces today's key **character for character** — `basisKeyOf`,
   `evaluationIdentity`, the worker protocol key. That is the byte-identity gate
   for this increment, and it is why the inversion is safe to do before anything
   else changes.

---

## 6. The increment plan

| # | step | gate |
|---|---|---|
| **X1** | the index module: coordinate declarations, canonicalisation, the operations table as data | unit tests over the table; no consumer changes |
| **X2** | `basisKeyOf` and `evaluationIdentity` re-expressed as projections | character-identical keys on a replay corpus; suites green |
| **X3** | the memo namespace and the worker protocol key follow | worker-parity soak unchanged; `EvaluationDivergenceError` never fires |
| **X4** | `tighten` lifted out of the bank as an index operation, **as a dispatch over bound families** (§9) with the termination operator named (§10); the bank calls it | bank suites bit-identical; a cross-horizon `tighten` is a **type error** (Law H′); the reduction table's one entry has a soundness argument with an asserted hypothesis |
| **X5** | CI checks 1–3 with their falsification tests | each check demonstrably fails when its rule is violated |
| **X6** | the CPP conditioning variable and the trace key adopt the index | fitted-number reads carry a transfer penalty computed from two index values (`08`, `15 §B1`) |

X1–X3 change no behaviour by construction. X4 is the first step that can change
one, and only by refusing something that previously slipped through.

---

## 7. Three items folded from the operator lenses

*Relayed second-hand; each is written in this lens's terms with its reasoning
exposed, so the originating lens can correct the reading rather than the shape.*

### 7.1 `Carried` lifetime kinds

`05 §4` gave four: `decision`, `turn`, `{turns: n}`, `{until: predicate}`.
Against the operations table, that set has a gap and an overlap:

- **Gap — `until-index-changes`.** The most common real lifetime is *"valid
  while the premise it was formed under still holds"*, which is now expressible
  exactly: the carried object stores its formation index and expires when a
  named coordinate subset changes. `C4`'s reduction-binding rule
  (`11 §4`) is this kind with the subset `{measure.weight}`; a potion commitment
  is this kind with `{support.model ∩ cited units}`.
- **Overlap — `turn` is `{turns: 1}`.** Keep both spellings only if the manifest
  can say why; otherwise one is a duplicate spelling, which the visible-layer
  budget refuses (`27 §6`).

So the kinds become: `decision` · `{turns: n}` · `{until: predicate}` ·
`{untilIndexChanges: coordinate[]}`, with `turn` folded into `{turns: 1}`.

### 7.2 The ADVICE ratification-laundering rider

The hazard, stated in this design's vocabulary: **the bot surfaces an option, a
human ratifies it, and the outcome is then counted as evidence for the term that
surfaced it.** That is circular — the ratification was *caused* by the
surfacing — and under ruling 49 it is the worst case of the distortion the fit
provenance exists to price, because the reference population is the bot's own
advice.

> **Rider.** A ratified surfaced option is recorded with
> `provenance.cause = 'surfaced-by:<memberId>'`, and a fit whose corpus contains
> such rows **must stratify on it**. Rows caused by our own surfacing may not be
> pooled with unprompted rows; a fit that uses only caused rows is refused, and
> one that uses both reports the two strata separately.

The honest reading of what survives: ratification is evidence about **the
operator's preferences**, which is a legitimate thing to fit (it is how a
Centaur surface learns what to show), and it is **not** evidence about the
option's quality. Two different fits, two different corpora, and the rider is
what stops one being read as the other.

### 7.3 Surface-tithe row routing

The attention currency (`22 §2`) is a hard cap with no exchange rate. Routing
gives it structure:

- the **surface tithe** is a partition share of attention, declared per ADVICE
  member, and the partition sums to ≤ 1 exactly as the compute allocation does;
- **routing** assigns each surfaced item to an **obligation row** (the reaction
  table's latency classes, `09 §BREAK 1`), because *when* an item must reach the
  operator is an obligation question, not an allocation one;
- the two laws compose the way ECONOMY's already do: **allocation partitions the
  tithe; obligation takes the tightest deadline.** A sacrifice warrant three
  turns from a cap is a tight-deadline row; a disagreement signal is a loose one.

That keeps the human boundary inside one economy with two currencies and two
laws, instead of growing a third mechanism for the surface.

---

## 8. Budget and limits

**Budget** (`27 §5`): this increment **spends nothing new**. Law T was charged
in `30` (14 of 15 laws); Law H′ is a clause of the existing Law H, not a new
one; the operations table is a *property* of coordinates already counted; and
the inversion **reduces** the visible surface by deleting four module-local
tuples. `7.1` removes one duplicate lifetime spelling.

**Quantified, from the sketch:** only **four of nine** coordinates are
purchasable by compute. The economy can buy less than half the index's width;
everything else is a choice, an observation, or fixed. That is the number the
lever menu should have been generated from all along.

---

## 9. `tighten` is a DISPATCH over bound families, not a binary on intervals

Law T's `max`/`min` is the **direct product** of abstract domains. Cousot's
**reduced product** is strictly tighter whenever the operands come from
different bound *families*, and this game supplies the canonical pair: a
checkerboard-parity **congruence** (a bishop never changes cell colour; a path
length has a parity) reduced against a cell-count **interval** gives `[4,4]`
where the direct product gives `[3,5]`.

**Decided at X4, because it fixes the signature:**

```ts
type BoundFamily = 'interval' | 'congruence'          // open, but grown one at a time
interface SoundValue { readonly family: BoundFamily; readonly bound: Bound; … }

tighten(a: SoundValue, b: SoundValue): SoundValue      // dispatch on (a.family, b.family)
//  default            → direct product (max/min), i.e. today's behaviour exactly
//  interval×congruence → the one reduction entry
```

Three placements, each of which keeps this from spreading:

1. **`family` belongs to the VALUE, not the index.** Run it through C59
   (`30 §6`): dropping it lets nothing incomparable compare (both are bounds on
   the same quantity), and forces no recomputation — it only *loses precision*,
   which is neither clause. So it is a property of the value like `lo` and `hi`,
   and **the visible-layer budget is untouched.**
2. **Both of Law T's guards survive unchanged**, because they are *index*
   properties rather than family properties: `tighten` is still sound-channel
   only, and it is still not transitive across a widening.
3. **Each reduction-table entry is a soundness argument, so Law A applies**
   (`25`): its hypothesis is named and asserted at the consuming site. For
   interval×congruence the hypothesis is *"the congruence holds in every world
   of `S`"* — a real obligation, since a congruence that holds only in the
   modelled worlds is not sound over the support.

**And the cost bound that keeps `tighten` cheap:** a reduction must be O(1)
arithmetic. Anything that needs search to reduce is **a priced meet in the
economy**, not a tightening — otherwise the operator at the centre of every
comparison acquires an unbounded cost. Interval×congruence is two modular
arithmetic steps; it qualifies.

Launch state: **one entry, and the table is otherwise empty.** The direct
product is today's behaviour, so X4 is still byte-identical until an entry
fires.

---

## 10. The termination column — what the epsilon guarantees, written when it is hoisted

X4 hoists `BOUND_RELATIVE_EPSILON` from a bank-local rounding fix to a shared
operator. In the framework's terms that makes it a **termination operator**, and
the operations table was missing the column that says so.

**Which direction can fail to terminate.** Order by *precision*. `join` loses
precision and is bounded below by the no-information element, so it terminates
trivially. **`tighten` gains precision and is the risky direction** — a chain of
ever-smaller improvements need never converge. (In the standard vocabulary the
operator that bounds the precision-increasing direction is a *narrowing*; the
coordinator's "widening" is right about the role — an operator whose only
purpose is termination — and this note names which chain it bounds.)

> **The epsilon's guarantee, stated at the moment of hoisting.** A tightening
> whose improvement is below `ε · scale` is **not taken**, and an inversion
> within `ε · scale` weakens both endpoints to the midpoint rather than throwing.
> Therefore every chain of tightenings on one value is finite: each step
> improves by at least `ε · scale`, and the interval has finite width. Genuine
> inversions — beyond tolerance — still throw.

**And the caveat that must travel with it, because it is easy to lose:** ε is
**relative**, so the guarantee is *scale-dependent*. Any re-denomination changes
what "below tolerance" means — and one is already ruled: removing the ×10
internal multiplier (ruling 15) rescales every bound by an order of magnitude.
So the epsilon's hoisting owes a test pinning the guarantee **in the units the
values actually carry**, re-run when the denomination changes.

The three rows that needed the column, discharged:

| row | discharge |
|---|---|
| `observable.provenance` | **a bound**: the evaluator term set and the C-rung set are finite, so the frame can only be refined finitely often |
| `measure.range` | **an operator**: compaction to *k* components with conservative union beyond — otherwise the mixture-over-histories representation grows without bound each turn. (Within a decision it is fixed; across turns the turn limit bounds the count but not the representation.) |
| the value interval | **the epsilon**, as stated above |

**Limits.** The operations table is a claim about what is *sound*, not a promise
that each operation is *cheap*: `support.model`'s meet is the expensive one and
is the whole subject of the compute economy. And X6 depends on fit provenance
landing first, so the CPP and trace-key adoptions are the tail of this
increment, not its head.
