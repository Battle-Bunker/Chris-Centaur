# Fit provenance is a premise coordinate — and what the machine expresses that we never tried

Cycle 6 of the COMPOSITION lens. Written against owner ruling 49: bot-vs-bot
numbers are potentially distortionary; fitted constants and validated strategies
enter only as **members**, with their fit provenance carried as premise
coordinates; the mandate is a joint machine that carves the design space, not a
transcription of the degrees of freedom already tried.

---

## 1. The distortion, stated as a fiber violation

A constant fitted on games our bots played against our bots is a number computed
under a premise whose CONFIG coordinate reads *"the reference population was
these bot addresses, on these board shapes, at this budget, scored by this
metric"*. Consuming it in a game against **humans**, or against a bot the fit
never saw, or at a budget an order of magnitude larger, is a **cross-fiber use** —
precisely the operation Law P forbids in the bounds layer and precisely the
operation nothing forbids anywhere else.

That is the whole content of "bot-vs-bot numbers are potentially
distortionary", and naming it this way makes it actionable rather than a
warning to remember:

- a fitted number is not a scalar, it is `At<number>` — a value with the
  premise it was fitted under;
- consumption compares the consumption premise against the fit premise;
- a mismatch is not an error and not a silent pass: it is a **widening**. The
  number still speaks, at reduced precision, and the widening is recorded.

The mechanism to carry it already exists on both sides. The EPISTEMICS lens's
value table gives every advisory contribution its own `advisoryPrecision`, with
`0` meaning "orders, but moves no belief". Fit provenance is what *supplies*
that precision honestly:

```
advisoryPrecision(member, live) = 1 / ( σ²_fit  +  σ²_transfer(fit.premise, live.premise) )
```

`σ²_fit` is the fit's own residual variance (the epistemics lens's proposal,
unchanged). `σ²_transfer` is new and is the ruling's content: **the penalty for
consuming a number outside the fiber it was fitted in.** Three consequences:

1. A self-play-fitted constant used against the population it was fitted on
   pays nothing. Used against a held-out opponent it pays; used against humans
   it pays more; used at a budget regime the fit never covered it pays more
   again. Nobody has to remember the caveat — the arithmetic carries it.
2. A number with *no* provenance record cannot claim any precision at all.
   `priors.fitted: false` on every legacy entry already says this honestly;
   under this rule the honesty becomes load-bearing instead of decorative.
3. "Validated" stops being a status and becomes a **coordinate**. A member is
   not validated *simpliciter*; it is validated *at* a premise. The two-lane
   rule's merge bar reads the same way it always did, but the ledger row now
   says what the validation ranges over.

---

## 2. What a fit provenance record is

```ts
interface FitProvenance {
  readonly fitId: FitId                  // addressable; the number's identity
  readonly corpus: CorpusId              // replay/batch ids, content-addressed
  readonly population: ReadonlyArray<{ codeRef: string; botId: string }>
  readonly shapes: ReadonlyArray<BoardHash>       // the cells it ranges over
  readonly regime: { budgetMs: number; workers: number; turnLimit: number | null }
  readonly metric: 'sharePar' | 'log-loss' | 'retrodiction' | …
  readonly n: number                     // blocks / games / decisions, per metric
  readonly procedure: MemberId           // the fitter is itself a member
  readonly residual: { sigma: number; byStratum?: Record<string, number> }
  readonly heldOut: ReadonlyArray<{ codeRef: string; botId: string }>  // may be empty — and that is a finding
}
```

Two rules make it structural rather than documentary:

> **Law F1.** A member whose params contain a fitted number must name its
> `fitId`. `entryFingerprint` includes it, so **re-fitting mints a new member
> id** — the identity law, extended from "changing params is a new entry" to
> "changing the evidence a param came from is a new entry". Two bots differing
> only in which fit they carry are different addresses, which is exactly what
> makes the comparison runnable.

> **Law F2.** The consumption site computes `σ²_transfer` from the live premise
> and the fit premise, and records it. It never silently reads a raw constant.
> A member that cannot compute a transfer penalty for a coordinate it does not
> understand must widen to the maximum for that coordinate, not to zero.

`σ²_transfer` needs a shape, and the honest launch value is coarse and
conservative:

| coordinate | mismatch | launch penalty |
|---|---|---|
| population | opponent not in `population ∪ heldOut` | large — the ruling's own concern |
| population | opponent is a human | **maximum**: no human game has ever been in any corpus |
| shapes | live board hash not in `shapes` | moderate, scaled by shape distance (roster mix is the axis that has actually flipped verdicts) |
| regime | budget outside the fitted range | moderate; the anytime record says strength is a function of CPU |
| metric | consumed for a decision the metric does not score | maximum |

Coarse is fine. The point is not calibration; the point is that the penalty
**exists and is visible**, so a number fitted on 2,400 potions-off games cannot
quietly price a potion board — which is a thing that has already happened.

---

## 3. Why this belongs in the joint machine and not in a discipline document

Because the same three deployments the addressing pass already needs pick it up
for free:

- **The stamp.** `botId` already covers which members played; adding `fitId`s
  makes the stamp answer "on what evidence" as well as "which strategy".
- **The diff.** `botDiff` prints a fit change as a first-class difference. A
  re-fit that changes nothing structural is currently invisible; under Law F1
  it is a visible arm.
- **The refusal.** The row reader that refuses unknown columns
  (`04-ADDRESSING.md` §3) refuses an unknown `fitId` the same way. A number
  whose provenance record is missing cannot be used, rather than being used at
  face value.

And one governance property the ruling implies: **the reference population is
itself a premise coordinate that the program controls.** A fit whose
`heldOut` list is empty is not "unvalidated"; it is *validated at a premise
that includes no held-out opponent*, which the record now says out loud. That
is the difference between a caveat and a coordinate.

---

## 4. What the machine expresses that we never tried

The mandate's test is whether the carving opens design space rather than
recording it. Six degrees of freedom that are **not expressible today**, that
need **no new joint**, and that the machine yields as ordinary bot values:

1. **A per-unit-class value profile.** `value/terms` seated as a
   `conditional` choice on a unit-class predicate. This is not speculative: the
   overnight programme found the default evaluator is wrong on *any* piece
   board (territory beats material by +1.39 all-snake and collapses to −0.06
   with a knight present), and the only remedies available today are one global
   profile or a hand-written slider profile. A bot that runs territory on trail
   units and material-plus-command on pieces is one `conditional` and cannot be
   written at all right now.

2. **A per-unit-class ORDERING LAW.** From the cap finding: on trail units
   nothing is closed (≤ 4 options against a cap of 8) while a queen's ~71
   options are cut to 4. So admission pressure differs by an order of magnitude
   *within one board*, and the right composition may differ with it — additive
   where nothing is closed, precedence-with-a-cliff where the cap bites. One
   `conditional` at `order/candidates`; today the comparator is one function
   for every unit that exists.

3. **A state-conditioned risk posture.** `reduce/accept` seated as
   `conditional` on a phase predicate: ε near 1 while behind and contested, ε
   lower in a decided endgame or during our own potion window. The DoF
   synthesis wants an appetite *schedule* off standing and clock; today ε is
   not even a number, it is the shape of a ladder.

4. **Per-enemy-team model members.** `model/replies` seated as a *composition*
   over enemies — adversarial against the team that has been hunting us,
   cover-counting against the one farming. This is D7's stance vector with no
   new machinery: the joint composes per coordinate of the support, which is
   what a MODEL-kind lattice join means.

5. **Anticipatory work aimed at a named reveal.** With the meet's second
   purchase column, `economy/schedule` can seat a member that spends a slice
   per plausible reveal of a specific hidden unit, sized by reaction latency —
   ponder with a target, rather than ponder as a mode. Not expressible today at
   any budget because there is no premise object to hang the hypothesis on.

6. **A bot whose members disagree by design.** Two VALUE choices composed under
   an explicit disagreement report — not an ensemble average (which the
   REDUCTION law forbids) but a *diagnostic*: where the profiles disagree is
   where the board is genuinely ambiguous, and that is a schedulable signal.
   The machinery is `compose` plus the engagement counter; the idea has never
   been representable.

Each is a bot value, addressable, diffable and raceable on the day the manifest
lands. None of them is a new joint, which is the test that the carving is doing
the work rather than the list.

---

## 5. Falsifiers

1. **If `σ²_transfer` is always dominated by `σ²_fit`**, the coordinate is
   decorative. Test: the potion terms' own retrodiction was fitted on a corpus
   with **zero hazards** and all pickups one step away; a hazard board at
   production budget should produce a transfer penalty that visibly outweighs
   the fit residual. If it does not, the penalty table is too flat to be worth
   carrying.
2. **If fit provenance makes every advisory precision zero**, the design has
   proved only that we have never fitted anything transferable — which is a
   finding, not a bug, and the remedy is corpus diversity (held-out opponents,
   mixed shapes), not a softer penalty.
3. **If Law F1 makes ids churn** (every re-fit mints a member), the registry
   grows without bound. Mitigation: a fit is a *param*, so the churn is
   bounded by how often we fit; and a member whose fit changed and whose
   record is empty is deletable by the reachability law like anything else.
