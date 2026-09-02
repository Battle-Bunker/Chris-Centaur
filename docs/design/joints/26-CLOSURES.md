# Five closures — the unnamed collapse, coalitions, the cold-start clause, the grep predicate, and vocabulary walls

Cycle 11. Red-team round 3's five items against this lens, each closed. Two are
defects of mine (one reintroduces the very shape this design exists to remove;
one forbids what I intend), two are enforcement gaps where I wrote a claim
without a check, and one is a promotion of an existing repo law to a manifest
law.

---

## 1. The emission collapse was an unnamed second reduction — closed with a row

**The defect is mine and it is the `??` shape reborn.** `22 §1` moved the
collapse to the emission barrier and then named nobody to perform it. A bot
binding `reduce/e-admissible@1` gets a survivor set, and *something* picks the
played move with **no member id, no site-class row, and no `botDiff`
visibility** — a decision taken by unnamed code, which is exactly the class the
totality law exists to make unrepresentable.

Closed by a row in the REDUCTION site-class table (`11 §2`):

| site class | what it reduces | constraint | launch member |
|---|---|---|---|
| `emission/collapse` | the survivor set → **the one move on the wire** | **total order** — the codomain must be a single option, always | `reduce/gamma-maximin@1` + the salted tie key |

Two things worth stating precisely, because this row is not like the others:

- **Its constraint is on the codomain, not on the functional.** Every other row
  constrains *which* functional may sit there; this one additionally requires
  that whatever sits there yields a total order, since the wire takes exactly
  one move and a barrier that can return two is a crash waiting for a tie.
- **No mixed draws, pending the restatement.** Randomising among survivors is a
  genuinely different member, and it breaks three things at once here: seeded
  determinism and replay (unless the draw is path-addressed like the existing
  lottery), the metamorphic **iteration-order invariance** relation (`25 §7`),
  and `behaviourId` itself, which is a hash of decisions over a probe suite and
  would stop being a function. So the row is barred to deterministic members
  until mixing gets its own design pass — recorded as a constraint, not an
  omission.

---

## 2. Scoped contributions versus the body wall — closed with compound participants

**They are right that my own example contradicts my cap.** A body wall is three
to five units acting as one structure; an arity cap of 2 (3 by exception) cannot
express it, so either the cap is wrong or the example was false.

Neither: **the participant was the wrong grain.**

> **Compound participants.** A **coalition** is itself a participant: a named,
> carried object (`Carried` — id, lifetime, invalidation predicate) whose parts
> are units. A body wall is then a **singleton scope over one coalition**, not a
> 5-ary interaction, and the arity cap stays at 2.

Three properties this has that raising the cap does not:

- **The cost model survives.** Möbius arity counts *participants*, and a
  coalition is one. The interaction inside the wall lives in the coalition
  member, where Law M (sub-provenance) already requires declared parts and
  per-part engagement — so it is bounded and visible rather than 2⁵ subsets.
- **It inherits the right economics for free.** A coalition is a commitment, so
  it obeys C2 (may change order and spend, never a bound or a refusal) and the
  interruption theorem (`17 §A`): a wall that stops being worth holding is
  abandoned the moment continuing is worse than re-deciding, which is exactly
  the behaviour a body wall needs and the opposite of a latched structure.
- **It gets an identity that survives `advance`.** A coalition is a named thing
  whose content changes turn to turn — Law I's case exactly (`18 §3`): the name
  finds the wall next turn, the trace hashes decide whether its justification
  still holds.

---

## 3. Condition 4 was cold-start censorship — closed with the trichotomy

**They are right and the sentence as written forbids what I intend.** An untried
second-order idea has rank-deficient interaction terms in *every* corpus **by
construction** — that is what "untried" means — so identifiability-at-seating
refuses exactly the ideas ruling 49 demands, and does it in the name of ruling
49. That is the worst kind of error: a rule that inverts its own purpose.

Closed with a distinction the codebase already makes and my sentence collapsed:

| class | what it is | owes |
|---|---|---|
| **derived** | live-computed from the board (contested-Voronoi income, the sever exchange rate) | **no identification** — there is no fit to identify |
| **unfitted** | a declared scale, `advisoryPrecision = 0`, **order-only** | **not Condition 4.** A term that moves no belief absorbs no noise — the noise-absorption risk I cited comes entirely from giving an unidentified term *precision*, and an order-only term never enters belief |
| **fitted** | claims precision, moves belief | **Condition 4 in full** — parameter count at its arity, conditioning, residual per stratum |

The trichotomy is not new machinery: `priors.fitted: false` on every legacy
entry, `advisoryPrecision = 0` from the epistemics lens, and the weight-zero
modifier pattern are the same three classes wearing different names.

**One clause I add, so "unfitted" does not become the new hiding place.** An
unfitted scope term owes no identification, but it does owe two things:
engagement (Law R — it must actually fire), and a **declared promotion path**:
which corpus and which stratification would move it from unfitted to fitted. A
term that can never become fitted is a permanent opinion, and the manifest
should make anyone write down what would change that.

---

## 4. "No consumer implements a rule" needed a predicate — closed with three checks

**Correct: as written it was review discipline in CI clothing.** The completeness
gate for the rules artifact (`24 §4`) now has a mechanical form, modelled on the
enforcement they name:

1. **Closed import vocabulary.** Consumers may import the artifact's index and
   nothing beneath it. A `no-restricted-imports` rule bans reaching into
   `engine/*` internals from any consumer package.
2. **Reserved lexicon.** A deny-list of rule identifiers — `adjudicate`,
   `winners`, `expireEffects`, `legalMoves`, `spawnFood`, `promote`… — may not
   be *defined* in a consumer package, only imported. Cheap, and it catches the
   re-implementation at the moment it is named.
3. **Coverage, which is the strong one.** In test runs the artifact's exports are
   instrumented: **a consumer that produces a rules-dependent output without
   touching any export fails.** The harness computing placements with zero
   `adjudicate` calls is exactly the triplication, caught by counting rather
   than by reading.

**And the trap this repo has already fallen into, so the law does not inherit
it.** The scout's own `no-restricted-imports` ban **is shadowed by a later
flat-config block and does not fire** — recorded, and still open. So by Law A
§4's clause: **every one of these three checks owes a falsification test** that
violates it and shows it fires. A lint rule nobody has tried to break is a
comment with a config file.

---

## 5. The scout import law, promoted — and a declared coverage-shaping class

**Promoted, because it is the load-bearing wall under an architectural claim,**
not a local hygiene rule:

> **Law V (vocabulary walls).** An architectural claim of the form *"X may only
> speak through channel Y"* is enforced by a **closed import vocabulary plus a
> lint ban plus a falsification test**, and the claim is not made without all
> three. Prose that says a layer is advisory-only is a promise; an import wall
> that fires is a property.

This is the general form of what the scout's ban does for the advisory channel,
of what the `excludes` row does for ADVICE's one-way flow (`12 §D3`), and of
what §4's checks do for the rules artifact. Three instances, one law — which is
the test I apply to everything else here, so it should apply to this.

**And the three functions get a class.** `requireSurrogateGain`, `offerOrder` and
`setRefineScope` shape **which candidates are covered** — offered, refined,
kept — rather than what they are worth. Under this carve that is ACTION-side
admission, and admission dominates valuation wherever it binds (`23`), so:

> **Declared coverage-shaping class.** These functions are manifest members with
> declared reads and writes, so (a) the ambiguity detector sees them against
> everything else touching the candidate set, (b) the **admission trace**
> coordinate records their effect as part of provenance-of-computation
> (`12 §D6`), and (c) a measurement pooled across two different coverage shapes
> is refused rather than averaged.

That last clause is the point: coverage shaping is the mechanism behind three of
the five causes of an inert weight, and a coverage shaper that is not a declared
coordinate is exactly how "the weight did nothing" gets misattributed to the
weight.

---

## 6. Net changes

| # | change | affects |
|---|---|---|
| 1 | `emission/collapse` site-class row; constraint is on the **codomain** (total order); no mixed draws pending a design pass, with the three reasons recorded | `11 §2`, `22 §1` |
| 2 | **compound participants**: a coalition is a carried, named participant, so arity stays 2 and a body wall is a singleton scope | `15 §C`, `17 §B` |
| 3 | **derived / unfitted / fitted** trichotomy; Condition 4 binds the fitted class only; unfitted owes engagement and a declared promotion path | `15 §C`, `17 §B` |
| 4 | the rules-artifact gate becomes three checks — closed imports, reserved lexicon, **export coverage** — each owing a falsification test | `24 §4`, `19` |
| 5 | **Law V** (vocabulary walls); `requireSurrogateGain`/`offerOrder`/`setRefineScope` declared as coverage shapers, visible to the ambiguity detector and recorded in the admission trace | `07 §3`, `23 §3` |

Items 1 and 3 are defects in documents I wrote this week: the first reintroduced
the shape this whole design exists to remove, and the second wrote a rule that
forbade its own purpose. Both were found by someone reading my text against my
own claims, which is the argument for the review structure the owner set up.
