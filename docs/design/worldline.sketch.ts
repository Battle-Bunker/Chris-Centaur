/**
 * PROTOTYPE SKETCH — types only, not shipping code, not imported by anything.
 *
 * The worldline factorization's seams as TypeScript, so the shape can be
 * argued over concretely. Where a type already exists in the tree it is
 * named in a comment rather than re-declared.
 */

// ---------------------------------------------------------------- variables

/** A world variable, indexed by turn. The coordinate vocabulary of every
 * citation. Kept deliberately small: a coord is an identity, never a value. */
export type Coord =
  | { kind: 'action'; unitId: number; turn: number }
  | { kind: 'position'; unitId: number; turn: number }
  | { kind: 'spawn'; cell: number; turn: number }
  | { kind: 'effect'; unitId: number; turn: number }; // tier/effect state

/**
 * ONE DECLARATION RECORD, TWO AXES (belief-fog convergence §8½.3).
 * `coords` drives invalidation on observe(); the tag half drives comparison
 * refusal (projection law) and dial demotion. Every derived, cached, or
 * carried number carries one of these. State with no ReadSet dies on every
 * observe — survival is opt-in.
 */
export interface ReadSet {
  readonly coords: ReadonlyArray<Coord>;
  readonly horizon: number; // plies the value spans (1 = this turn)
  readonly weightId: string | null; // null = sound (quantified over S)
  readonly evalVersion: number; // objective/dial version (§7)
  readonly hypothesisId: string | null; // null = the actual frontier
}

// ------------------------------------------------------------ determinations

/** An event that converts uncertainty into fact (or changes the objective).
 * SCOPE IS NOT DECLARED — it is derived from `determines`. */
export type Determination =
  | { kind: 'operator-pin'; unitId: number; to: number; tentative: boolean } // constraint, not fact
  | { kind: 'operator-commit'; unitId: number; to: number | null; determines: Coord[] }
  | { kind: 'rival-commit-timing'; teamId: string; atWallMs: number } // determines nothing searchable
  | {
      kind: 'resolution';
      turn: number;
      /** Under full observability: every action(·,turn) + consequences.
       *  Under fog: the visible subset; hidden units stay held. */
      determines: Coord[];
      /** The wire doc (checksum + game-state half) — marshal-typed upstream. */
      doc: unknown;
    }
  | { kind: 'objective-change'; newEvalVersion: number } // dial/goto: determines nothing
  | { kind: 'game-start'; turn: 0 };

// ----------------------------------------------------------------- allowance

export interface AllowanceGrant {
  readonly seq: number;
  readonly targetTurn: number;
  readonly phase: 'conform' | 'refine' | 'ponder' | 'speculative';
  readonly hypothesisId: string | null;
  /** Quanta granted (resolution-equivalents). THE one product of a wall-clock
   * read; everything below spends by count. */
  readonly granted: number;
  spent: number;
  /** Telemetry only. Never an input to anything. */
  readonly msObserved: number;
}

/** Owns every wall-clock read. Fits quanta-per-ms per game continuously the
 * way stepCostMs is carried today (turn-stamp guarded). */
export interface ExchangeRate {
  grant(args: {
    deadline: number | null; // null in a window with no deadline
    phase: AllowanceGrant['phase'];
    targetTurn: number;
    hypothesisId: string | null;
  }): AllowanceGrant;
  observeSpend(grant: AllowanceGrant, msActual: number): void; // re-fit
  /** The operator-latency bound as a quanta cap on any single tranche. */
  latencyCapQuanta(): number;
}

// ---------------------------------------------------------------- hypotheses

/**
 * A conditional frontier: the actual frontier plus assumed determinations.
 * Unifies: speculative pin contexts (kernel tier-3), scout thread premises
 * (threadKey), ponder reply targets. Value stores are keyed by
 * (hypothesisId, evalVersion); sound content under a hypothesis is stageable
 * only after promotion.
 */
export interface Hypothesis {
  readonly id: string; // canonical serialization of `assumed` (basisOf's heir)
  readonly assumed: ReadonlyArray<Coord & { value: unknown }>;
  /** Market weight: W0 witnesses / W2 cover-counting / later W4 learned —
   * the D2 socket's plug-in point. */
  weight: number;
  /** Warm state handles (bank/session/threads/continuation root). Opaque here. */
  state: unknown;
}

export type HypothesisOutcome =
  | { kind: 'promoted' } // assumed ⊆ new facts: state enters the frontier warm
  | { kind: 'contradicted' } // dies by citation
  | { kind: 'still-open' }; // assumed variables still undetermined

// ------------------------------------------------------------------ worldline

/** Per-game, lives for the game. Holds knowledge and appetite, NEVER
 * calibration (anti-latch law): the only cross-turn mutable scalars are the
 * exchange-rate fit, attention rows (rootTurn-tripwired, plies-bounded), and
 * the seed stream position. */
export interface Worldline {
  /** Advance the frontier. Conditions the belief object (dilate∘condition),
   * then walks every store: kill if readSet.coords ∩ determined ≠ ∅ or
   * hypothesis contradicted; promote hypotheses whose assumed set became
   * fact. Returns what an attached agent must do (reaction table input). */
  observe(d: Determination): {
    readonly killed: number;
    readonly promoted: ReadonlyArray<string>;
    readonly rebased: boolean; // a resolution advanced the root
  };

  /** Spend one tranche of quanta against one hypothesis (or the frontier).
   * Atomic: no clock, no event queue visible inside. Returns findings for
   * agents to stage from. */
  spend(grant: AllowanceGrant, hypothesisId: string | null): SpendReport;

  /** The scheduler's market: which hypothesis earns the next tranche.
   * Policy = config (lane a): tithe/reserve, speculative share, ponder
   * targeting order, focus-narrowing modulation. */
  nextHypothesis(phase: AllowanceGrant['phase']): string | null;

  /** Rows for an agent's staging ladder, filtered to its frontier + pins.
   * Sound content only from the actual frontier + promoted hypotheses. */
  rows(agentPins: unknown): ReadonlyArray<unknown /* StagingCandidate */>;
}

export interface SpendReport {
  readonly quantaSpent: number;
  readonly findings: number; // ordering advice produced
  readonly observations: number; // deep values published
  readonly attentionMoved: boolean;
}

// ------------------------------------------------------------------- agent

/** Per-turn. Owns deadline, wire, ratchet basis, emit gates, conform, final
 * flush, staged-nothing guarantee. The only module that knows what a
 * deadline is. Reaction table: determination source → conform-now |
 * next-tranche | next-commitment ("humans always win" is one row). */
export interface CommitmentAgent {
  readonly turn: number;
  attach(w: Worldline): void;
  /** Called at every tranche boundary and on every observe() result. */
  step(now: number): 'emitted' | 'held' | 'detached';
  /** Detaches when its turn's frontier completes (absorbs abandoned() and
   * the latestTurn guard). */
}

// --------------------------------------------------------------- the ledger

/** Replay = same seeds + same determination positions + same grants ⇒ same
 * everything. Both fixed and opportunistic ponder replay from this. */
export interface WorldlineLedger {
  readonly grants: ReadonlyArray<AllowanceGrant>;
  readonly determinations: ReadonlyArray<{
    readonly d: Determination;
    /** Logical position: after grant seq k. Timestamps are telemetry. */
    readonly afterGrant: number;
  }>;
}
