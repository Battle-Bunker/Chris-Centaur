# Projections and Weights — the value table, the weight-supplier socket, and the one risk dial

Companion to `00-THE-OBJECT.md` §3/§4/§6. Prototype-level sketches against the
real shapes at the cluster-lookahead tip: `BankResult` (bounds/bank.ts:171),
`advisoryEst` (evaluate/bound.ts), `posteriorOfBranch`/`foldObservation`
(belief.ts), `depthRung`/`accept` (search/core.ts), `sigmaOfPly`
(scout/scout.ts), `StrategyEntry.priors` (registry.ts).

---

## 1. The defect the projection table dissolves (derivation, not patch)

The potion-play finding (pinned 2026-09-01): `core.ts:1545` feeds the ADVISED
est into `posteriorOfBranch(worst, best, r.est)`, so an advisory lineup does
not order floor ties — it converts floor-decided comparisons into
belief-decided ones (floor/dec 1057→781, depth/dec 359→554 across
plain→bold).

In the (S, w) frame the defect has a NAME: **precision laundering.** The
belief assembly gives `est` the precision the INTERVAL earned
(`precisionOfInterval = 4/(hi−lo)²`) — justified for the computed evaluator's
own est, whose only residual uncertainty IS the world-uncertainty the interval
measures (belief.ts's own §2 argument). An advisory delta rides in on that
est and thereby inherits proof-grade precision it never earned. L2 (weights
move on evidence at EARNED precision) is violated by construction, and the
symptom is exactly what was measured.

So the fix is not "carry a second scalar" (though that is its first
increment); it is: **every contribution to a branch's value is an Observation
with its own earned precision, and `est` stops being a mutable scalar that
successive layers overwrite.**

## 2. The value table on BankResult

Flat fields, no maps, no allocation beyond what exists (answers 00-doc open
question 2):

```ts
interface BankResult extends PlanScore {
  // ── the sound envelope of V₁ over S — exists today as bounds.worst/best ──
  // (floorFrom/ceilingFrom/floorComplete/narrowings stay as its provenance)

  /** E[V₁] under the evaluator's own computed reading. Residual uncertainty =
   *  world-uncertainty = interval width. THIS is what belief assembly reads.
   *  (The queued "sound est" — bank.ts:194's est before any overlay.) */
  readonly estSound: number

  /** estSound + the advisory lineup's delta, clamped. The ORDERING channel —
   *  what the est rung of the comparator reads. Carries the slate id as its
   *  weight-id tag (the slate IS the named weight perturbation). */
  readonly estAdvised: number

  /** The advisory delta as an Observation: value = the delta's target,
   *  precision = what the lineup EARNED (§3). Zero-precision advisories
   *  position nothing in belief — they only order. */
  readonly advisoryPrecision: number
}
```

Belief assembly becomes three folds in canonical order, all through the one
existing `foldObservation`:

```
post = emptyPosterior(lo, hi)
post = fold(post, { kind: 'bank-price',  value: mid,        precision: precisionOfInterval(lo,hi) })
post = fold(post, { kind: 'evaluation',  value: estSound,   precision: precisionOfInterval(lo,hi) })
post = fold(post, { kind: 'advisory',    value: estAdvised, precision: advisoryPrecision })   // NEW KIND
// deep-finding folds on top exactly as today (value, 1/sigma², plies)
```

Consequences, each checkable:

- With every advisory term unfitted (`advisoryPrecision = 0`), belief is
  BIT-FOR-BIT today's sound-est belief, while est-rung ordering still sees the
  lineup — the potion ordering win is kept, the depth-rung distortion is gone.
  The dose-response curve (floor/dec falling as weights rise) should flatten;
  that is the acceptance measurement.
- `ObservationKind` gains `'advisory'`; the provenance log tells a sweep how
  much of a decision's belief came from opinion vs proof — a column the
  mechanism report gets for free.
- The comparator's ladder becomes a declared READ-SET per rung (depth reads
  belief; floor reads envelope; est reads estAdvised; ceiling reads hi). No
  behavior change — the declaration is what makes the next mis-wiring a type
  error instead of a 3-cycle hunt.

## 3. Where advisory precision comes from (and why "zero" is the honest launch value)

`StrategyEntry.priors` already carries `{ fitted: boolean, strata: [...] }`.
The extension: a fitted term's registry entry records a residual-variance
model from its retrodiction (per stratum, since dodge's own doc mandates
stratification by travelTurns); `advisoryPrecision = 1/σ²_fit`, combined
across the lineup by the same quadrature sigmaOfPly uses. Unfitted → σ = ∞ →
precision 0 → position-only. No constant is chosen anywhere; the precision is
the measurement's own error bar, which is ruling 12's "the only legitimate
discount is model error → precision weighting" applied to advisory terms
instead of only to depth.

This also retires the clamp gradually rather than by fiat: a term re-typed as
a same-horizon expectation under an in-support weight cannot leave [lo, hi]
(00-doc §3.1), so the AdvisoryMeter's `clamped` counter converts from loss
meter to violation alarm on exactly the terms that have been re-typed, while
legacy scalar terms keep the clamp until they are re-typed or retired.

## 4. The weight-supplier socket (D2), concretely

One new registry slot. The contract, in full:

```ts
/** Supplies the weight over ONE enemy unit's action coordinate of S.
 *  Input is the SUPPORT — the admissible action set the engine derives
 *  (legal minus rules-certain-fatal: dodge-discount's `plausibleMoves`
 *  generalized and extracted — it is the action-coordinate constructor of S,
 *  not a potion detail). */
interface WeightSupplier {
  readonly id: string   // registry identity; sweeps attach here
  weigh(e: {
    unit: RayUnit; support: ReadonlyArray<Action>;
    board: RayBoard; ourExposure: ExposureContext | null
  }): ActionWeights | 'adversarial'
}
```

`'adversarial'` is the ZERO POINT, not a fallback: it instructs the consumer
to keep the quantifier (min over the support) instead of integrating. Ruling
13's population is the supplier that always returns it. The ladder of members
(each one registry entry, comparable by log-loss on `Turn.moves` at zero match
cost):

| id | returns | learned content |
|---|---|---|
| `opp/adversarial@1` | 'adversarial' | none — the sound channel's own semantics |
| `opp/uniform@1` | 1/n over support | none |
| `opp/cover@1` | w(r) ∝ \|C(r)\| — dodge's rule, extracted | none — derived from S + rules |
| `opp/default-action@1` | mass on the engine's defaultAction, floor on the rest | rules only |
| (later, ruling 13 lifted) | mixtures, per-opponent fits | data |

The four consumers that today improvise, rewired to ONE call:

1. **dodge-discount** keeps its cover fan as the IMPLEMENTATION of
   `opp/cover@1` and stops being its only consumer.
2. **potion-seek's exposure bracket** — the 99.6% false-alarm — prices contest
   risk under the supplied weight instead of sound reach (the pins already
   name this "needs D2"; here is its call signature).
3. **scout thread replies** — reply selection order and the parked-thread
   dilation read the weight where they currently assume worst-first.
4. **sigmaOfPly's `theirMiss`** — today the UNWEIGHTED FRACTION of unpriced
   replies, which is W1 (uniform) hardcoded implicitly. It becomes the
   unpriced MASS under the supplied weight: missing ten absurd replies costs
   less precision than missing the one reply the weight thinks likely.
   Reduces to the current fraction exactly when the supplier is uniform —
   the current behavior is the special case, recovered.

### 4b. The supplier harness — comparison at zero match cost (second pass)

Ruling 13 bars enemy-prediction STRATEGY work; it ordered the socket built.
The socket's comparison instrument is measurement, not strategy, and it runs
on replays already on disk:

- For each logged decision, reconstruct each enemy unit's support (the same
  action-coordinate constructor the members use), ask each supplier for its
  weight, score `−log w(action actually played)` against `Turn.moves` —
  the wire records every applied move.
- Report per supplier: mean log-loss; DECISION-WEIGHTED log-loss (restricted
  to turns where some candidate's ε-reading would change ordering under that
  weight — the dof-synthesis's refinement); calibration curve; and the
  entropy column of 09-doc §5 so fog cells read comparably later.
- 'adversarial' enters the table as the reference row it is: its log-loss is
  the price of refusing to predict, and the gap between it and 'cover' on
  logged play is the measured value of ruling 23's rule before any bot
  changes behavior.

Zero games, zero strategy work, and the day ruling 13 lifts, the ladder's
next rung starts from a measured baseline instead of a debate.

## 5. The one risk dial: ε-contamination closes open question 5

D3 needs a computable interpolation between maximin (α at full paranoia) and
EV under the supplied weight. The credal set to use is the ε-CONTAMINATION
class — every mixture (1−ε)·w + ε·(anything supported on S). Its lower
expectation has a CLOSED FORM:

    E_lower[V] = (1−ε)·E_w[V] + ε·min_S V  =  (1−ε)·estAdvised + ε·lo

— a linear blend of exactly the two numbers the value table already carries.
Properties that make it the right surrogate:

- ε=1 is the current bot (sound floor decides); ε=0 is pure best-response to
  the weight; every ε between is a genuine lower prevision over a genuine
  credal set — not an ad-hoc blend, so its guarantees compose (the blend of
  sound lower bounds under a fixed ε is itself a sound lower bound over the
  contaminated set, which keeps the bank's comparison laws intact if the
  blend is ever allowed to schedule).
- It is the owner's dodge-discount move generalized: charging `mean` instead
  of `worst` on one term was a local ε=0 step; the dial makes the step
  uniform, sized, and single-surfaced (Part II rule 2 of the dof synthesis:
  fear is expressed exactly once).
- The D2×D3 grid sweep becomes (supplier id) × ε — two axes of one object,
  and the synthesis's fuse-if-no-interior-optimum falsifier is directly
  interpretable: a ridge in (supplier, ε) means the contamination class was
  the wrong credal family, which is a FINDING about the game, not a tuning
  failure.

Placement per the seam rule: ε lives in the ADVISORY/ordering channel and the
est rung (entry data); the unconditioned floor stays kernel law. A candidate
whose blended value is high but whose floor is DEAD is still vetoed — the
lattice bottom is not blendable (DEAD·ε is still DEAD; the blend is defined
only over finite floors, and the veto fires before the blend is read).

FAMILY STATEMENT (search lens, adopted — 12-doc §5): every reading on the
ambiguity axis is a lower prevision over a closed convex reply-set; the
ε-blend is the Huber/contamination ball's, and maximin is the VACUOUS member
of the same family — so the sound floor and the blended reading are one
mathematical family, endpoints of one parameter, which is why ε→1 degrades
gracefully to today's bot. (The unification is of the mathematics, not the
authority: the floor's kernel roles — veto, staging law, refusal — are not
readings and do not move.) A third derived w-constructor also lands here:
`opp/equilibrium@1`, the restricted stage matrix's fixed point, premise =
the restriction record; admission gated on the search lens's restrictedGap
telemetry (12-doc §4).

THIRD PASS (11-doc Part A): ε is no longer a swept dial at all. Read
generatively, the contamination class makes ε a population parameter of
logged play with a closed-form estimator, ε_min = 1 − min_a p(a)/w(a),
fitted per (supplier, stratum) by the §4b harness and carried as a
PremisedMember on the supplier's calibration record. The (supplier × ε)
grid above collapses to (supplier) plus fit-transport validation; D3
retains appetite as its only free parameter. This section's blend formula
and placement are unchanged — only who supplies the number.

## 6. Deep findings in the table (no change, one clarification)

`max_a min_b` on the advanced board stays exactly as built: in table terms it
is the (horizon=d, quantifier=maximin-over-the-thread's-own-S) projection,
reported with earned precision 1/sigmaOfPly². The clarification the table
adds: when thread replies start reading a non-adversarial weight (§4.3), the
thread's inner `min_b` becomes the ε-blend at the SAME ε as the root's est
rung — one dial, both places, or the search optimizes a different objective
at depth than at the root. That coupling is invisible in today's code and is
the kind of drift the projection tags exist to refuse.

## 7. Build increments (each independently valuable, in order)

1. `estSound` beside `estAdvised` on BankResult; belief reads estSound.
   (Already queued from the potion finding — this doc gives it its type.)
2. `'advisory'` ObservationKind at precision 0; provenance column in the
   mechanism report. Behavior identical; the laundering is now measurable.
3. Extract `plausibleMoves` → the action-support constructor; extract the
   cover fan → `opp/cover@1`; the supplier slot with `adversarial` +
   `uniform` + `cover` members. Rewire dodge as consumer #1 (no behavior
   change), then exposure (#2 — the false-alarm fix), then theirMiss (#4).
4. ε-contamination blend as the est rung's reading, ε=1 default (bit-for-bit
   today). Sweep (supplier × ε) on potion cells — the acceptance grid.
5. Fitted-variance field on StrategyEntry.priors; first fitted advisory term
   graduates from position-only to belief-moving at measured precision.
