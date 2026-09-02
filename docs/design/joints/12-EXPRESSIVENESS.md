# Answering the expressiveness red team — four failures, one concession of a claim, one new strategy family

Cycle 7 of the COMPOSITION lens. Response to `docs/design/red-team/RED-TEAM.md`
on `design/red-team`: thirteen strategy families tested against the carve, four
judged FAILURES, five hidden couplings, a complexity audit, and ten demands.

Their closing sentence is the one worth answering first:

> the carve as converged is a machine for *never again mis-comparing two
> numbers*, and ruling 49 asked for a machine for *expressing strategies nobody
> has tried*. Those are different machines.

That lands. The comparison machinery is the part I could derive from the
program's own failures, and it is the part I built. Below: three of the four
failures get a fix in this document, the fourth gets a decision I have been
deferring, and the linearity finding gets a partial concession plus the only
honest structural answer I can give it.

---

## D1 (F1) — The sacrifice seat. Accepted, and here is the law re-draw.

They are right that my carve **hardens** the wall: `06 §5` says *"set-closures
stay kernel even though they are numbers"*, which takes `pruneFatalNoGain` from
a knob a bot could turn off and makes the seat unreachable. A positional
sacrifice — fatal, no capture, no food — is removed before any member prices it.
That refusal is withdrawn.

The re-draw follows from the fibration rather than from taste. `doomed` is
**premise-indexed**: it is a statement under the premise *"this unit's survival
is the objective"*. Under a team-level reduction it is not a veto, it is an
outflow with a price — the VALUE lens's currency already says a death costs
exactly the balance it wipes.

> **Closure law, amended.** A closure may remove an option only if its
> justification is **invariant under the reduction binding**. Rules-certain
> fatality is not invariant, so it splits:
>
> - **unwarranted fatality** — no member has priced the death at team level:
>   removed by the kernel, exactly as today;
> - **warranted fatality** — a member emits a **sacrifice warrant**: the death,
>   priced in the currency, with the compensating flow named (which account it
>   opens, which corridor it seals, which line it decoys). Admissible; the
>   warrant is recorded as an `Assumption` and rides the emission.
>
> The safety floor is unchanged in force: it still refuses death that nothing
> justifies. What changes is that "nothing justifies it" becomes a *checkable
> statement about the members that ran*, instead of a property of the move.

Two consequences that keep this from being a hole:

- **The floor still floors.** A warranted sacrifice's plan value includes the
  death; no bound moves. The warrant changes *admission*, never arithmetic — the
  seam rule, respected.
- **The `tier` band's precedence survives, re-scoped.** `doomed` stops being a
  band and becomes `doomed-unwarranted`. A warranted death leaves the band and
  is ordered by the currency like anything else, which is the VALUE lens's own
  position ("a doomed move is outside the value function's domain") applied to
  the case where a member has brought it back inside the domain.

This is an owner-facing law change because it touches the safety floor's
definition, and it should be put to him in those terms: *today the bot may not
consider giving up a unit even when the team gains by it; the proposal is that
it may, but only when a heuristic has written down what the death buys.*

## D2 (F10) — The adaptation contradiction. No fourth crossing category is needed; Law K already decides it.

They are right that `05 §1` lists within-game opponent adaptation among the five
asks while the adopted anti-latch law forbids carrying calibration. Their fix is
a fourth crossing category (learned measure state, w-only, stamped, tripwired).
I accept the *content* and refuse the *extra category*, because
`09 §BREAK 3`'s Law K already draws the line — from the other side, as the
coordinator noticed:

> **Law K (calibration).** A measured value may affect behaviour only if it is
> **replayable** — a deterministic function of the declared coordinates plus the
> recorded observation ledger — or **spend-only**.

A within-game posterior over an opponent's habits is fitted on `Turn.moves`,
which is **public wire history**. So it is a pure function of a record both
sides can see: same ledger, same posterior. It is therefore admissible under
Law K(a) with no new category, provided it is implemented as **derived from the
ledger** rather than accumulated as a mutable scalar:

| forbidden (anti-latch) | permitted (Law K(a)) |
|---|---|
| a scalar mutated each turn and carried | a function `posterior(ledger≤t)` recomputed, or checkpointed with a verified rebuild |

The distinction is *recomputable* versus *accumulated*, and it buys three things
at once: the anti-latch property is preserved (there is nothing to latch — the
value is a function of public history); the tripwire is free (recompute and
compare); and ruling 49's provenance is automatic (`fitId = ⟨this game's ledger,
turns ≤ t⟩`, a premise coordinate that only grows, so intra-game use is legal
and cross-game use is a crossing that must be declared).

The advance law is untouched: what crosses is not a value but a *ledger*, and
the posterior is re-derived on the far side. It is w-only by construction — a
weight-supplier member, never a support update — which is the epistemics lens's
own support law.

## D3 (F11) — The operator-advice joint. Decided: a sixth kind, and my "five kinds" claim is conceded.

I have deferred this and should not. Their argument is the strongest in the
document: the five kinds were justified as one-to-one with *the game's*
irreducible facts, and **this product's irreducible fact list includes a human
in the loop**. Option-surfacing is not VALUE (its currency is operator decision
value, not weight share), not ACTION (it does not reorder our argmax), not
ECONOMY (it does not spend the search budget, though it competes for it), and
emission is kernel. The program's stated reason to exist has no seat. That is a
carve failure, not a gap in a list.

> **Sixth kind: ADVICE.** Members read fibered values and write **only** to the
> operator surface. Law: **partition of a scarce attention budget** (how many
> plans, annotations and disagreement signals reach the human) over
> **set-valued selection** (members rank *sets* of plans under a declared
> diversity or decision-relevance measure, not individual plans).
> Constraint row, load-time enforced: `excludes: ADVICE → read by any joint
> producing the staged plan`. One-way dataflow, checkable at the module
> boundary, and it inherits the operator-pin channel's existing
> policy-blindness.

Honesty about what this costs my own framing: the composition law here is
*shaped like* ECONOMY's allocation (a partition of a scarce resource), so by my
own rule — kinds are individuated by their law — it is not obviously a sixth
kind. It earns its row on two other grounds, and I would rather say so than
stretch the law argument: a **different sink** (the human, not the wire) and a
**one-way safety constraint** that no other kind has. A kind is a law *plus* a
sink discipline; the five-kinds claim needed that second dimension and did not
have it.

Two immediate members exist, so the kind does not launch empty (`00 §5`'s own
rule): a **disagreement surfacer** (where two seated VALUE profiles rank
differently — `08 §4.6`) and a **sacrifice surfacer** (warranted sacrifices from
D1 that the bot may propose and only a human may authorise). The second is the
exact case the red team names — *"surface the sacrifice the human can authorise
that the bot may not"* — and D1 plus D3 together make it expressible for the
first time.

## D4 — The linearity finding.

> *Measurement note (`23-ADMISSION-REVISED.md`): the admission half of this
> section's argument has since been measured. The cap binds on sliders only
> (100% vs 0%), the discarded set is the most differentiated one, and a fifth
> cause of an inert weight was found — 15–43% of priced plans are refused by the
> emission rate limiter, which no evaluator weight can move. My
> "one fact measured twice" identification is withdrawn there.*
 Partly conceded, partly wrong, and the honest limit stated.

> "the five composition laws are all *linear* (join, weighted sum, partition),
> and strategy is mostly *non-linear*… the manifest will show a beautiful
> lattice of laws composing a handful of opaque monoliths."

**Where it is wrong (2 of 5):** MODEL composes credal sets by lattice join,
which is not linear in the measure — the join of two credal sets is not a
mixture of them, and that non-linearity is the whole reason `'adversarial'` can
be a zero point rather than a weight. REDUCTION is explicitly non-composable —
"exactly one per site class" is a refusal to compose, and `11 §5` shows why
averaging two reductions is not the lower prevision of any credal set.

**Where it is right (3 of 5, and it matters):** ACTION-order, VALUE and
ECONOMY-allocation are additive/partitional, and conjunctive strategy ("this
move only if that other unit also goes there, else neither") has no law to ride.
Those families will be written as one member, and the manifest will describe
their *boundary* and not their *content*.

**The honest limit.** No factorization removes the inside of a member; you
cannot make strategy linear by choosing a nicer algebra. What a manifest can do
is make the fat member's boundary explicit, force its internals to be
addressable, and give cross-member interactions a home. So, adopting their
demand 9 and going one step further:

> **Law M (sub-provenance).** A member with internal term structure declares its
> parts (`parts: MemberId[]`) and how they combine internally. The engagement
> counter applies **per part**, and the reachability law reads through: a
> declared part that never fires in any validated run is dead code inside a
> live member, and is deleted like any other unreachable member.

That is the direct answer to *"Frankenstein risk relocates inside sockets, off
the manifest's map"*: the map extends inside members by one declared level, and
the same two remedies apply there (seat it, or delete it). It does not make
non-linear strategy linear. It makes non-linear strategy **visible and
measurable at the resolution its author chose**, which is the most an
architecture can promise.

Second half of their complexity audit — *"when the manifest is wrong, five
artifact classes are wrong in agreement, and the property that made drift
detectable (independent copies disagreeing) is gone"* — is accepted without
qualification, and it earns a permanent check rather than a migration one:

> **The generator owes an independent oracle.** The byte-identity gate covers
> the migration; the steady state needs one artifact class produced by an
> *independent* path (the stamp, rebuilt from the live decision's own
> observations rather than from the manifest) and compared. A generator with no
> disagreeing witness is a single point of silent failure.

## D5 (§2.2) — The unwritten law: cross-horizon comparison

Their catch is exact and it is a hole in my refusal law: the depth rung compares
a deep-informed belief against a near-only one, which is a cross-observable
comparison, licensed nowhere. Written now:

> **Law H (cross-horizon).** Values at different horizons may never be compared
> as projections. They may only **meet inside a fold** that declares the
> discount converting one to the other — today, the earned precision from
> `sigmaOfPly`. The fold's output is a single projection at a declared horizon
> tag, and *that* is what a comparator may read.

This is what the shipped code already does (`beliefOf` folds the deep
observation into the branch posterior and the ladder reads the posterior), so
the law is a *description* of the good behaviour that was never stated — which
is exactly why the next mis-wiring would have been invisible. It also fixes the
overreach in `01 §5`: depth does not "stop needing an exception"; it needs a
**licensed fold**, and the licence has a name and a discount.

## D6 (§2.1, §2.5, F9) — The missing coordinates are one group, not three

They ask for three: admission trace, resolved conditional selections, fit
provenance. Two observations:

1. **Fit provenance already exists** — `08-FIT-PROVENANCE.md`, written the same
   hour, is exactly their §2.5 demand (corpus, population, shapes, regime,
   metric, n, held-out; transfer penalty; re-fit mints a new member id). It is
   in the **config** group, and their instinct to attach it to the measure
   coordinate is nearly right: it attaches to the *member* whose params it
   qualifies, and the member is a config coordinate.
2. **The other two are the same thing as `frame`.** `frame` (which terms were
   computed), the admission trace (which closures fired and where caps
   truncated, per unit class), the conditioning depth (which of C0/C1/C2 ran —
   owed to the epistemics lens), and the resolved conditional selections (which
   branch of a `conditional` Choice fired) are four components of one group:
   **what the computation did**.

> **Premise index, amended.** The OBSERVABLE group becomes
> `⟨horizon, provenance-of-computation⟩`, where provenance-of-computation =
> `⟨computed terms, admitted-set signature, conditioning depth, resolved
> selections⟩`. All four determine which values exist and how wide they are;
> all four must be equal for a bare comparison and are otherwise a widening or
> a refusal.

Their sharper point stands and is the reason this matters: **two measurement
rows can agree on every declared coordinate and still be incomparable because
different admission members fed them different evidence populations.** That is
ruling 49's distortion one level down, and it is why the admission trace has to
be a coordinate rather than a diagnostic column — miners pool on coordinates.

## D7 (§2.4) — Read-sets enforced by construction. Adopted as a law.

> **Law D (delivered reads).** A comparator, a fold and a scheduler rung
> receive **the projection for their declared coordinates and nothing else** —
> no fiber, no `BankResult`, no context object. Undeclared reads are
> unrepresentable, not forbidden.

Their argument is unanswerable: the four expensive defects were all "the
metadata said X, the code did Y", and answering that class with more metadata
repeats it. This is a real constraint on the implementation (constructing narrow
projection records on a hot path), and it is worth the cost precisely where the
defects were: the comparator, the memo key, the worker boundary and the miner.

## D8 (§2.3) — Incumbency laundering. Adopted.

Accepted as stated: the incumbent is the argmax of dead values, and the sticky
stager's switch margin lets it decide ties after its justification is gone.
`carryEffectRate` splits into **helped** versus **anchored**, measured against an
incumbent-free shadow argmax per turn — the same counterfactual technique the
depth channel already runs for free (`trackShadow` maintains a second incumbent
under the legacy ladder at one comparison per trial). One more shadow is
affordable and makes the laundering visible.

## D9 (demand 8) — The reduction API is a functional over the credal set

Accepted; `11 §2`'s site-class table is unaffected. The API is
`reduce(credalSet, valueFn) → key`, and ε-contamination is **one member** of the
reduction collection rather than the API's shape. That keeps maximin (ε = 1),
best-response (ε = 0), CVaR and future functionals as peer members, and it is
what the site-class constraints already assume (a pinned row names a
*functional*, not a scalar).

## D10 (F3b) — Answered from source: commitment timing leaks, fully, and it is a strategy family nobody has seated

Verified in `TacticToes` @ `416d9c8`:

- `firestore.rules`: `match /moveStatuses/{moveStatusId} { allow read: if true; }`
  — **world-readable**.
- `shared/types/Game.ts`: `MoveStatus = { moveNumber, alivePlayerIDs,
  movedPlayerIDs }` — the set of players who have **committed** this turn.
- `privateMoves` create is gated on `!hasCommittedForTurn(...)`, so a commit is
  **irrevocable** for that turn; and the turn resolves the instant every alive
  player has committed.

So: **who has committed is public and live; what they committed is private.**
Three consequences, and the third is a strategy family:

1. Emission timing is not merely a latency policy. An early commit is a
   *credible, publicly verifiable commitment device* in a simultaneous-move
   game — you cannot show what you chose, but you can prove you can no longer
   change it. That is a Schelling move, and the rules implement it exactly.
2. An early commit also **denies opponents clock**: the turn ends when the last
   player commits, so committing early accelerates everyone's deadline,
   including the humans thinking on the other side.
3. Therefore the obligation law (`09 §BREAK 1`) is not only about latency
   classes. Its reaction table has a row — *when do we commit* — whose members
   are strategic: `commit-late` (maximum flexibility, zero signal),
   `commit-on-confidence` (freeze when the margin is safe), `commit-early-to-
   deny-clock` (spend our own option value to compress theirs). None of these
   is expressible today, and the wire supports all three.

That answers their demand 10 and hands the time lens a member family for its
reaction table. It also settles their F3 split in the direction of *fits, once
obligation is a joint*: the half they judged missing is the half that needs the
ECONOMY-obligation law they and I have both now adopted.

---

## What I do not concede

**The comparison machine is not a consolation prize.** Their framing — one
machine for never mis-comparing, another for expressing the untried — reads the
two as alternatives. Four of this document's own fixes are *consequences* of the
comparison machinery rather than additions to it: the sacrifice seat is a
premise-indexed closure, in-game adaptation is decided by the replayability
criterion, the missing coordinates are one group under the existing index, and
the cross-horizon licence is the refusal law's missing clause. The expressive
gaps were real; the tool that located and repaired them was the fibration.

Where they are right is the **priority**: the expressive failures are the ones
that decide whether the machine is worth building, and none of them was on my
build order. So the build order gains D1, D3 and D10's reaction-table members as
first-class items rather than as consequences — see `07-SYNTHESIS.md`'s revised
table.
