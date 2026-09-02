/**
 * design/operator-guidance — builder-facing contracts sketch (NOT compiled
 * into the build; the twin of operator-signals/contracts.sketch.ts).
 * Types follow 00-FACTORING as amended by 03 §2 and 06. Law N throughout:
 * member ids and data, no expressions, no cross-references.
 */

// ---------------------------------------------------------------- identities

export type UtteranceId = string;        // stable; echo join key (06 §1)
export type GuidanceId = string;         // hash of live table; premise CONFIG coord
export type MemberId = string;           // manifest-addressed
export type AdviceArtifactId = string;   // OUT-surface refs (provokedBy)
export type OperatorRef = { userId: string; name: string; color: string };

// ------------------------------------------------------------ the coordinates

export type Scope = { kind: 'unit'; unitIds: string[] } | { kind: 'team' };

export type Referent =
  | { kind: 'cell'; cells: { x: number; y: number }[] }   // 1 = cell, n = region/queue
  | { kind: 'unit'; targetId: string }
  | { kind: 'event'; predicate: MemberId; params: Record<string, number> }
  | { kind: 'none' };

/** A-1 (03 §1): activation + retirement + mode. Predicates evaluate on the
 * AUTHORITATIVE observed board only (06/H6); nothing latches in process
 * state — retirement/activation re-derive on restart (platform rule). */
export interface Lifecycle {
  activate?: MemberId;                   // absent = live from birth
  retire:
    | { kind: 'turn' }
    | { kind: 'turns'; n: number }
    | { kind: 'until' }                  // predicate = constructor's completion member
    | { kind: 'standing' };
  mode: 'latched' | 'maintenance';
}

/** A4 never appears here — determinations live on the staging wire. */
export type Authority = 'A0' | 'A1' | 'A2' | 'A3';

export interface GuidanceUtterance {
  readonly id: UtteranceId;
  readonly author: OperatorRef;
  readonly provenance: 'authored' | 'ratified';   // 06 §3: structural edit ⇒ authored
  readonly provokedBy?: AdviceArtifactId;
  readonly scope: Scope;
  readonly payload: {
    readonly constructor: MemberId;      // declares ports, ranges, eligibility
    readonly referent: Referent;
    readonly magnitude: Record<string, number>;
  };
  readonly lifecycle: Lifecycle;
  readonly authority: Authority;
  readonly born: { turn: number; at: number };
}

// ------------------------------------------- the generated schema (02 §2)

export interface ConstructorRow {
  readonly memberId: MemberId;
  readonly label: string;
  readonly referentType: Referent['kind'];
  readonly targetEligibility: MemberId;  // platform eligibleTargets, server-checked
  readonly ports: ReadonlyArray<
    'value-field' | 'attention-field' | 'support-demand' | 'belief-weight'
    | 'appetite' | 'deadline' | 'admission-edit'
  >;
  readonly defaultMagnitudes: Record<string, number>;
  readonly magnitudeRanges: Record<string, { min: number; max: number; step: number }>;
  readonly authorityCeiling: Authority;  // A1/A2 at launch; A3 behind B5
  readonly lifecycleDefault: Lifecycle;
  readonly costClass: 'per-unit-table' | 'plan-level';   // 03 H3
  readonly uiOrder: number;
  readonly engineVersion: string;        // Q10: retire visibly, never silently
}

// --------------------------------------------------- events (02 §3, two channels)

export type GuidanceEvent =
  | { kind: 'add' | 'remove'; utterance: GuidanceUtterance }
  | { kind: 'retarget'; id: UtteranceId; referent: Referent }        // structural
  | { kind: 'reweight'; id: UtteranceId; magnitude: Record<string, number> } // cheap
  | { kind: 'quote'; ephemeral: true; scope: Scope;                  // 06 §2
      hypothetical: { unitId: string; to: number } };                // no row, no
                                                                     // guidanceId change
export type GuidanceEventSink = (ev: GuidanceEvent, turn: number | undefined) => void;

// -------------------------------------------- compiled, once per decision (01 §2)

/** Potential form is MANDATORY for spatial fields (04 §1): the stat a plan
 * earns is Φ(end) − Φ(root), so deep lines credit endpoints, not path
 * length. Horizon-1 ramps are the degenerate case. */
export interface CompiledField {
  readonly utteranceId: UtteranceId;
  readonly weight: number;               // Σ|weights| < death band (validated)
  readonly scope: Scope;
  /** per-(unit, destination) potential table — worker-shareable — OR a
   * plan-level member ref for coalition constructors (costClass). */
  readonly phi?: Readonly<Record<string /*unitId*/, Float32Array /*by cell*/>>;
  readonly planTerm?: MemberId;
}

export interface Bounty {
  readonly utteranceId: UtteranceId;
  readonly anchor: Referent;             // funded work tagged fundedBy (06 §1)
  readonly strength: number;             // reorders within a lever class only
}

export interface SupportDemand {
  readonly utteranceId: UtteranceId;
  readonly enemyUnitId: string;          // forced into contestant set (widen-only)
}

export interface BeliefWeightTilt {
  readonly utteranceId: UtteranceId;     // operator member of the D2 supplier
  readonly enemyUnitId: string;          // advised channel only; ε at the read
  readonly tilt: Record<string /*reply class*/, number>;
}

export interface GuidanceContext {
  readonly guidanceId: GuidanceId;
  readonly fields: ReadonlyArray<CompiledField>;
  readonly bounties: ReadonlyArray<Bounty>;
  readonly demands: ReadonlyArray<SupportDemand>;
  readonly beliefWeights: ReadonlyArray<BeliefWeightTilt>;
  readonly appetite: { team: number; byUnit: Readonly<Record<string, number>> };
  readonly deadlines: ReadonlyArray<{ utteranceId: UtteranceId;
    row: { kind: 'commit-by'; atMs: number } | { kind: 'hold' } }>;   // MIN-composed
  readonly licenses: ReadonlyArray<{ utteranceId: UtteranceId;
    sign: 'license' | 'restriction'; closureId: MemberId;
    scope: Scope; condition: MemberId; expiresTurn: number }>;        // A3, B5-gated
}

// -------------------------------------- retention: the echo's feed (06 §1)

/** Written per decision beside the emit record; every field cites its
 * utterance. The OUT surface reads these; the IN side never renders them. */
export interface GuidanceDecisionRecord {
  readonly guidanceId: GuidanceId;
  readonly turn: number;
  readonly contributions: ReadonlyArray<{ utteranceId: UtteranceId;
    channel: `guidance:${string}`; value: number; outvotedBy?: string }>;
  readonly funded: ReadonlyArray<{ utteranceId: UtteranceId; quanta: number;
    stratum: 'saturated' | 'starved' }>;
  readonly demandEffects: ReadonlyArray<{ utteranceId: UtteranceId;
    floorDelta: number; stagedPlanChanged: boolean;
    decidingRungShift?: { from: string; to: string } }>;              // 06 §4
  readonly swings: ReadonlyArray<{ utteranceId: UtteranceId; kind:
    'appetite' | 'belief-weight'; decisionRef: string }>;
  readonly restrictionRemainders: ReadonlyArray<{ utteranceId: UtteranceId;
    unitId: string; liveOptions: number }>;                           // early warning
}
