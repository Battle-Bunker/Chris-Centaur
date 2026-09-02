# Contracts sketch — the epistemics factorization as TypeScript signatures

A builder-facing consolidation of docs 00–07. These are SKETCHES: names and
shapes for the build increments, not shipping code. Where a shape already
exists in the tree the sketch says so and changes only what the design
changes.

---

## 1. Projection tags (00-doc L3/L4)

```ts
/** Every value-bearing number carries these three. Comparison across a
 *  mismatch is a typed refusal (generalizes compareFloors' basis refusal). */
interface ProjectionTag {
  /** Turns of play the quantity is denominated over. 1 = one-ply frame. */
  readonly horizon: number
  /** 'sound' = quantified over ALL of S (weight-invariant); otherwise the
   *  registry id of the weight the expectation was taken under. */
  readonly under: 'sound' | WeightId
  /** The assumption set (existing Assumption[] machinery, unchanged). */
  readonly basis: ReadonlyArray<AssumptionId>
}
```

## 2. The value table on BankResult (02-doc §2; increments 1–2)

```ts
interface BankResult extends PlanScore {
  // bounds.worst / bounds.best: the sound envelope of V₁ over S — unchanged.

  /** E[V₁] under the evaluator's own computed reading (pre-overlay).
   *  Belief assembly reads THIS. tag: {1, 'sound-est', basis}. */
  readonly estSound: number
  /** estSound + advisory delta, clamped. The est-rung ordering channel.
   *  tag: {1, slateId, basis}. */
  readonly estAdvised: number
  /** Precision the advisory lineup EARNED (quadrature over fitted terms'
   *  residual variances; 0 while unfitted). Fed to belief as its own
   *  ObservationKind — unfitted lineups order floor ties, never move mu. */
  readonly advisoryPrecision: number
}

// belief.ts: ObservationKind gains 'advisory'. Fold order:
//   bank-price → evaluation(estSound, interval precision)
//   → advisory(estAdvised, advisoryPrecision) → deep-findings (unchanged).
//
// SAME TREATMENT FOR DeepObservation (search lens doc 04 finding B-2 — the
// mirror defect one layer down): deepen() currently publishes the deep
// line's PROVED FLOOR (scored.best.lo) into the belief's mean slot while
// its est is computed and dropped — a floor consumed as an unbiased mean.
// DeepObservation carries {envelope, estSound} of the advanced board and
// the fold reads estSound as the mean, the envelope as provenance; a floor
// is never a center, at any depth.
```

## 3. The weight-supplier slot (02-doc §4, corrected domain per 03-doc §2/T13)

```ts
type WeightId = string  // registry entry id, e.g. 'opp/cover@1'

/** A coordinate of S a supplier may weigh. */
type SCoordinate =
  | { kind: 'action';   unit: UnitId; support: ReadonlyArray<Action> }
  | { kind: 'position'; unit: UnitId; support: Board /* cloud cells */ }
  | { kind: 'box';      unit: UnitId; boxes: ReadonlyArray<BoxRef> }

interface WeightSupplier {
  readonly id: WeightId
  /** 'adversarial' = keep the quantifier (ruling 13's population — the
   *  zero point, not a fallback). Weights must be supported inside the
   *  coordinate's support (L2) and are advisory-channel-only. */
  weigh(c: SCoordinate, ctx: SupplierContext): CoordinateWeights | 'adversarial'
}

// Consumers rewired to one call: dodge cover fan (implements 'opp/cover@1'),
// potion exposure, scout reply ordering, sigmaOfPly.theirMiss (unpriced MASS
// under the weight; reduces to today's fraction under 'opp/uniform@1').
```

## 4. ε reading (02-doc §5; one-shot per 06-doc §2)

```ts
/** The est rung's reading. ε=1 ⇒ lo (today, bit-for-bit); ε=0 ⇒ estAdvised.
 *  Applied ONCE at the root reading of a projection — never recursively
 *  through thread interiors (Epstein-Schneider compounding, 06-doc §2).
 *  Defined only over finite floors: a DEAD floor is vetoed before this
 *  is read (the lattice is not blendable). */
const epsilonReading = (r: BankResult, eps: number): number =>
  (1 - eps) * r.estAdvised + eps * r.bounds.worst
```

## 5. Observation and conditioning (01-doc; increments 5–7)

```ts
interface ObservationRecord {
  facts: MaskedTurn                       // Turn schema, masked units absent
  mask: {
    hiddenUnits: ReadonlyArray<{ unitId: string; lastSeenTurn: number }>
    redaction: RedactionPolicy            // declared channels, echoed per turn
    litCells?: Board                      // only for per-cell rules
  }
  events: MaskedEvents                    // deaths/clashes/severs/item deltas,
}                                         // attributions possibly partial

/** applyMask(fullTurn, rule, teamId) → ObservationRecord. ONE pure function,
 *  harness-first, vendored to the processor later (05-doc §1). Empty rule ⇒
 *  identity ⇒ byte-identical bot (the step-6 gate). */

interface TraceEntry {
  readonly turn: number
  readonly headMask?: Board       // C0/C1 admissible-set intersections
  readonly bodyMask?: Board
  readonly tierFloor?: number     // sever-geometry inference
  readonly healthDelta?: number   // food-vanish refuel, now fact
  readonly items?: { food: Board; potions: Board }  // TIME-INDEXED PREMISE
}                                 // (03-doc §7 — the one engine amendment)

interface ConditioningTrace {
  readonly entries: ReadonlyArray<TraceEntry>  // audit form
  readonly key: string                         // extends frozenRecordKey
}
// Hot path holds the compacted current front, O(boxes). Dropping an entry
// only WIDENS (sound); dropping a BOX is forbidden (deprivation).

/** The hold's economics tag — OPERATION-SET FORM (09-doc §4: the enum form
 *  mis-gated the C-rungs, which are compute removing observation-tagged
 *  width). Gates REMOVAL levers only; hedged preparation (conditional
 *  frontiers per possible reveal) is always open and scheduler-priced. */
type RemovalOp =
  | { op: 'enumerate' | 'narrow' | 'advance'; cost: ComputePrice }   // sim-held
  | { op: 'condition'; rung: 'C1' | 'C2'; cost: ComputePrice }       // evidence
  | { op: 'await-reveal'; horizon: number | 'unknown' }              // the game
type Reducibility = ReadonlyArray<RemovalOp>  // empty = none-this-turn
```

## 6. The observer's ledger (05-doc §2)

```ts
interface ObserverLedger {
  /** Cache, not truth: reconstructible by replaying applyMask output. */
  lastSeen(unitId: string): { snapshot: UnitSnapshot; turn: number } | null
  trace(unitId: string): ConditioningTrace | null
  /** ALWAYS 0 for observation-held units — ingestion IS their catchup
   *  (09-doc §2); the voc catchup lever and max-staleness fallback read
   *  this, never observation age. Observation age feeds only width
   *  telemetry and the D2 supplier. */
  simStale(unitId: string): number
  /** Called once per ObservationRecord; runs C0/C1 (C2 on scheduler demand),
   *  emits holds for masked units with heldAtTurn = lastSeenTurn. */
  ingest(obs: ObservationRecord): IngestReport
}
// The REAPPEARANCE ORACLE lives in ingest(): a fact row for a unit whose
// cloud does not contain it THROWS (production soundness audit, 04-doc §4.4).
```

## 7. Premised members — ruling 49 as a type (07-doc §1)

```ts
/** A fitted constant or validated strategy enters ONLY in this shape. */
interface PremisedMember<T> {
  readonly id: string                    // e.g. 'value/fold-k@1'
  readonly value: T
  /** The fit's premise, as coordinates. Every row is checkable against the
   *  live game's regime at resolve time. */
  readonly premise: {
    readonly scoringPath: string         // metric + terminal rules version
    readonly turnLimit: { min: number; max: number } | 'refuses-unlimited'
    readonly teamCounts: ReadonlyArray<number>
    readonly rosterClasses: ReadonlyArray<string>
    readonly regimes: Record<string, string>   // potions, hazards, …
    readonly policyPair: string          // endogeneity coordinate (07-doc §2)
    readonly excludes: ReadonlyArray<string>   // e.g. 'regicide-rosters'
  }
  /** Residual model at the fit — what earns advisory precision (02-doc §3). */
  readonly residual: { sigma: number; strata: ReadonlyArray<string> }
}
/** Resolution against a live game returns the member or a TYPED REFUSAL
 *  naming the crossed coordinate — a silently wrong constant looks exactly
 *  like a right one on any single game, so degradation is not offered. */
```

## 8. sigmaOfPly extension (06-doc §5)

```ts
sigmaOfPly(o: {
  world: number; spread: number
  ourMiss: number; theirMiss: number   // theirMiss: unpriced MASS under the
  fog: number; interfere: number       //   supplied weight (was: fraction)
  /** NEW: the one-ply evaluator's fitted residual vs deeper truth at this
   *  node's stratum — a PremisedMember<number>; 0 only if a fit says so. */
  evalResidual: number
}): number   // quadrature, unchanged shape
```

## 9. What is deliberately NOT here

No probabilistic support updates; no per-cell visibility model; no
second-order weights; no bank rewrite; no C2 engine at launch; no minimum-
uncertainty floor constants (fitted variances with provenance instead). Each
refusal argued in 04-doc §5 and 06-doc §5.3.
