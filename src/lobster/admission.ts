/**
 * LOBSTER admission governor — which OBJECTIVE this turn is allowed to spend on.
 *
 * Sibling of `postures.ts`, and deliberately its mirror image one layer up.
 * The posture governor decides which CHANNEL orders the candidates; this one
 * decides which QUESTION the candidates are scored on. Both are keyed on
 * measured board conditions, both classify with a pure total function, both
 * dwell before they act, and both emit a named `Assumption` on every flip so
 * the decision rides the basis-identity rule instead of a flag.
 *
 * Three rules this module exists to make structural rather than aspirational:
 *
 *   1. NEVER BUDGET-KEYED. `AdmissionConditions` carries no clock, no budget,
 *      no deadline, no elapsed time, no slice count and no work counter, and
 *      `classifyAdmission` is a pure function of it. There is no code path by
 *      which a millisecond can change a ladder. This is `postures.ts`'s own
 *      rule 1 restated, and it is not a matter of taste: measured, a ten-fold
 *      budget and forty times the plans left the deficit this policy addresses
 *      unmoved, so a clock-keyed policy would be keyed on noise. (An
 *      `AdmissionFlip` records an `at` stamp, but only as a label on the log
 *      line — it is never read back.)
 *
 *   2. FROZEN AT DECISION ENTRY. The conditions are a pure function of
 *      turn-start board state, they are measured once, and the ladder is an
 *      INPUT to the turn rather than state within it. A refinement that flipped
 *      the admitted objective would put a non-monotone switch inside the
 *      refinement lattice — "a refinement changing the objective" is outside
 *      what the monotonicity law even speaks about — so the shape is excluded
 *      structurally rather than dwell-guarded around. The owner's turn-by-turn
 *      mandate is fully honoured: the policy is a fresh pure function of every
 *      turn-start board. It is only INTRA-turn flips that are forbidden.
 *
 *   3. PESSIMISTIC UNDER FOG (owner ruling Q2). A held unit that MIGHT have
 *      become a slider counts as one until an observation clears it. The
 *      direction of error is therefore always "we were too cautious for one
 *      more turn", never "we ran the wrong objective on a board with a hidden
 *      queen on it". `ownPromotionImminent` pre-arms the same gate one turn
 *      early so the single transition this corpus actually contains — a pawn
 *      promoting — happens BETWEEN turns and never inside one.
 *
 *      THE PESSIMISM IS OVER KIND, NOT OVER TEAM (arch/s3). Fog widens which
 *      KIND a held slot might hold; it never widens which team it belongs to,
 *      because a unit does not change team and the team is on the frozen
 *      record. So scoping the detector to our own units subtracts nothing from
 *      the bias this rule installs.
 *
 *   4. THE SLIDER DETECTOR IS OWN-TEAM (E1, arch/s3). arch/s2 keyed the
 *      predicate on board-level presence and documented the choice as pending
 *      E1. E1 ran, on the asymmetric rosters the corpus could not produce, and
 *      the any-team bit separates nothing: territory beats material by +0.58
 *      with no slider anywhere and by +0.57 with an ENEMY slider on the board,
 *      and by −0.03/−0.05 when it owns one. See `ADMISSION_LADDERS`' first row
 *      for the full numbers, the contact-forced replication, and the caveat
 *      that only the MATCHED contrast may be quoted.
 *
 * WHAT THIS MODULE DOES NOT DECIDE. It emits an ORDERED LADDER and the
 * detector facts behind it. How the rungs interact — whether a richer rung may
 * only break the cheaper one's ties, or may overturn it inside a certified
 * envelope — is not admission's business and nothing here encodes an answer.
 * For as long as there is one frame per turn, the ladder's LAST rung is the
 * objective the decision is conducted under, which is the only semantics this
 * stage relies on.
 *
 * DEPENDENCY DIRECTION: admission -> postures is allowed and postures ->
 * admission is not. Today admission needs nothing from postures at all; the
 * ordering is recorded so it stays that way.
 */

import type {
  AdmissionConditions,
  AdmissionStamp,
  Assumption,
  CohortId,
  CohortLadder,
} from './contracts';
import type { EngineSubstrate } from './substrate';
import type { Standing } from './evaluate/features';
import { profileOf } from '../partial-engine/grammar';
import type { CohortRow, LadderRow } from './evaluate/calibration';
import {
  ADMISSION_LADDERS,
  BASE_COHORT_ID,
  COHORTS,
  cohortAssumptionOf,
  requireCohortRowIn,
} from './evaluate/calibration';

/** Re-exported from the contract, where `EmitRecord` reads them. */
export type { AdmissionConditions, AdmissionStamp, CohortLadder };
export type { LadderRow };

// ------------------------------------------------------------- the detectors

/**
 * IS THIS KIND A SLIDER? The engine's own class-level predicate, and not a set
 * of kind names — the calibration doctrine's fourth fact is that the
 * vocabulary is class-level, and a name set is exactly the thing that has to be
 * edited every time the rules gain a piece.
 *
 * Mirrors `partial-engine/cloud.ts`'s `isSlider` verbatim
 * (`profile.rays.length > 0 && !profile.oriented`), read through `profileOf`
 * on this side of the boundary rather than reaching into the vendored module
 * for a private local. The two agree today on every registered kind and a test
 * pins them equal so they cannot drift.
 */
export function isSliderKind(kind: number): boolean {
  const profile = profileOf(kind);
  return profile.rays.length > 0 && !profile.oriented;
}

/**
 * Could a unit with this `kindSet` be a slider RIGHT NOW?
 *
 * PESSIMISTIC BY CONSTRUCTION: true if ANY kind the set still admits is a
 * slider. For a live unit the set is the singleton `1 << kind` and the answer
 * is exact; for a held one the set is the claim's fork set, and a pawn held
 * past the promotion horizon carries Queen in it. This is the whole of the
 * owner's confirmed fog bias, in one loop.
 */
export function sliderPossibleIn(kindSet: number): boolean {
  let bits = kindSet;
  while (bits !== 0) {
    const bit = bits & -bits;
    if (isSliderKind(31 - Math.clz32(bit))) return true;
    bits ^= bit;
  }
  return false;
}

/**
 * The pre-arm, per unit.
 *
 * Live: `weight + 1 >= pawnPromotionWeight`, the same shape `candidates.ts`
 * uses to spot a promoting meal, WITHOUT its landing-has-food clause — the
 * gate asks whether promotion is one meal away at all, not whether this
 * particular move takes it.
 *
 * Held: the pessimistic form `record.weight + holdDepth + 1 >=
 * pawnPromotionWeight`. A unit we have not observed for `holdDepth` turns
 * could have eaten on every one of them, so the largest weight consistent with
 * what we know is `weight + holdDepth`. It is a deterministic function of the
 * frozen record and the turn counter, hence WORLD-INDEPENDENT and stable
 * within the turn — which is what makes freezing the ladder at decision entry
 * sound rather than merely convenient.
 */
export function promotionImminentFor(
  kind: number,
  weight: number,
  holdDepth: number,
  pawnPromotionWeight: number
): boolean {
  if (profileOf(kind).promotesTo === null) return false;
  return weight + Math.max(0, holdDepth) + 1 >= pawnPromotionWeight;
}

/**
 * MEASURE THE BOARD. Once per decision, before any evaluation, off turn-start
 * state only.
 *
 * ── SCOPE: OWN-TEAM, AND BOARD-LEVEL BESIDE IT (E1) ────────────────────────
 *
 * arch/s2 measured board-level presence ONLY, and said so: "the value evidence
 * cannot separate own-slider from any-slider ... E1 decides it; until then this
 * is the conservative reading". E1 ran, and it decided AGAINST the any-team
 * reading — including against calling it conservative. Both bits are measured
 * now: `ownSliderPossible` is what `ADMISSION_LADDERS` keys on, `sliderPossible`
 * is retained as an emitted fact because the compute census and M4 are stated
 * in board-level terms and a corpus that dropped it could not be read against
 * either, nor re-derive what the arch/s2 predicate would have said.
 *
 * The own-team test is EXACT on the team and pessimistic on the kind. A live
 * unit carries its team on the roster; a held one carries it on the frozen
 * claim record, and a unit never changes team, so fog widens the set of KINDS
 * a slot might be and never the set of teams it might belong to. That is what
 * makes the own-team form a strictly cheaper measurement than the any-team one
 * (the same single pass with one extra integer compare) rather than a
 * more-expensive one, and it is why the fog bias stays exactly where owner
 * ruling Q2 put it.
 *
 * Trail counts read the ROSTER rather than a resolution's survivors, exactly as
 * `trailScaleOf` does: a count read off who a reading admits is not a board
 * constant, and this predicate has to give the same answer in every world the
 * soundness law enumerates or it is not a fact about the turn at all.
 *
 * COST: one pass over the roster reading one profile field, plus one pass over
 * at most 32 claim slots. Sub-microsecond against a 150 ms budget, and both
 * collections are already materialised for the decision.
 */
/**
 * The substrate surface admission actually reads — the roster, the claim field
 * and the promotion threshold, and nothing else.
 *
 * It is named so the KERNEL can require it without importing `substrate.ts` as
 * a value. The loop's module graph deliberately does not contain the engine
 * substrate; a structural check (`admissionSubstrateOf`) is what keeps it that
 * way, and a substrate that does not answer these three questions is a
 * configuration error the caller has to hear about, not something to be
 * silently inert around.
 */
export type AdmissionSubstrate = Pick<EngineSubstrate, 'roster' | 'claimField' | 'engine'>;

/** Structural narrowing, so the kernel needs no `instanceof`. */
export function admissionSubstrateOf(sub: unknown): AdmissionSubstrate | null {
  const s = sub as Partial<AdmissionSubstrate> | null;
  if (s === null || typeof s !== 'object') return null;
  if (typeof s.roster !== 'function' || typeof s.claimField !== 'function') return null;
  if (s.engine === undefined || s.engine === null) return null;
  return s as AdmissionSubstrate;
}

export function measureAdmission(sub: AdmissionSubstrate, asTeam: number): AdmissionConditions {
  const promotionWeight = sub.engine.config.pawnPromotionWeight;
  let sliderPossible = false;
  let ownSliderPossible = false;
  let promotionImminent = false;
  let ownPromotionImminent = false;
  let ownTrailCount = 0;
  let theirTrailCount = 0;

  for (const u of sub.roster()) {
    const profile = profileOf(u.kind);
    const mine = u.team === asTeam;
    if (profile.leavesTrail) {
      if (mine) ownTrailCount++;
      else theirTrailCount++;
    }
    if (!sliderPossible || (mine && !ownSliderPossible)) {
      if (isSliderKind(u.kind)) {
        sliderPossible = true;
        if (mine) ownSliderPossible = true;
      }
    }
    if (!promotionImminent || (mine && !ownPromotionImminent)) {
      if (promotionImminentFor(u.kind, u.weight, 0, promotionWeight)) {
        promotionImminent = true;
        if (mine) ownPromotionImminent = true;
      }
    }
  }

  // The held half. A unit carried as a CLAIM is not on the roster as the thing
  // it might have become, and reading only what we can see is the detector's
  // documented failure mode #2: on a live centaur board with holds it makes the
  // gate flicker on fog, which a full-visibility sweep can never observe.
  //
  // `slot.record.team` is the FROZEN team, and it is exact rather than
  // pessimistic: fog widens which KIND a slot might hold, never which team it
  // belongs to. So a held own pawn that might have promoted arms the own-team
  // gate, and a held ENEMY pawn does not — which is the whole content of E1
  // applied to the half of the board nobody can see.
  const field = sub.claimField();
  for (const slot of field.slots) {
    if (slot.cloud.certainlyGone) continue;
    const mine = slot.record.team === asTeam;
    if (!sliderPossible || (mine && !ownSliderPossible)) {
      if (sliderPossibleIn(slot.cloud.kindSet)) {
        sliderPossible = true;
        if (mine) ownSliderPossible = true;
      }
    }
    if (!promotionImminent || (mine && !ownPromotionImminent)) {
      const holdDepth = Math.max(0, field.turn - slot.record.heldAtTurn);
      const promotes = promotionImminentFor(
        slot.record.kind,
        slot.record.weight,
        holdDepth,
        promotionWeight
      );
      if (promotes) {
        promotionImminent = true;
        if (mine) ownPromotionImminent = true;
      }
    }
  }

  return {
    ownSliderPossible,
    sliderPossible,
    ownTrailCount,
    theirTrailCount,
    ownPromotionImminent,
    promotionImminent,
  };
}

/**
 * The same measurement off an already-built standing list, for a caller that
 * has one (the law harness, a probe, a future kernel that keeps standings).
 * Held records carry no hold depth on a `Standing`, so the pre-arm is the LIVE
 * form here and `measureAdmission` is the authority; this exists so the slider
 * half can be asserted directly against the `kindSet` field it reads.
 */
export function sliderPossibleAmong(
  standing: ReadonlyArray<Standing>,
  /** Restrict to one team — the OWN-TEAM form the predicate is keyed on.
   * Omit for the board-level form the census and M4 are stated in. */
  asTeam?: number
): boolean {
  for (const s of standing) {
    if (!s.worstAlive && !s.bestAlive) continue;
    if (asTeam !== undefined && s.team !== asTeam) continue;
    if (sliderPossibleIn(s.kindSet)) return true;
  }
  return false;
}

// ------------------------------------------------------------ classification

/**
 * THE CLASSIFICATION — pure, total, and holding no rule of its own.
 *
 * Every rule is a row in `calibration.ts`'s `ADMISSION_LADDERS`, walked in
 * precedence order; the first match wins. The table is a PARAMETER rather than
 * an ambient global for the same reason the cohort registry is: a module-scope
 * policy table is one game's configuration becoming every concurrent game's,
 * and a per-engine flag would then measure nothing.
 *
 * TOTALITY is not left to the table's good behaviour. If no row matches — an
 * empty table, a hand-built one whose last row is conditional — the answer is
 * the base cohort alone. That is the safety floor: base is admitted on every
 * board under every policy, so "no rule applies" degrades to "spend nothing
 * extra", never to a throw and never to an empty ladder.
 */
export function classifyAdmission(
  c: AdmissionConditions,
  rows: ReadonlyArray<LadderRow> = ADMISSION_LADDERS
): CohortLadder {
  for (const row of rows) {
    if (row.when(c)) return row.ladder;
  }
  return [BASE_COHORT_ID];
}

/** The rung a decision is conducted under: the richest admitted one. */
export function activeRungOf(ladder: CohortLadder): CohortId {
  const last = ladder[ladder.length - 1];
  return last ?? BASE_COHORT_ID;
}

/**
 * The `Assumption` a ladder change rides as: the COHORT assumption of the rung
 * the decision will now be conducted under.
 *
 * Deliberately NOT a bespoke "admission" variant, and deliberately not a
 * `narrowing`. Admission does not narrow the game — it changes which question
 * is being asked, which is precisely what the `cohort` framing assumption
 * already means; minting a second idiom for the same fact is the thing
 * anti-spaghetti rule 1 forbids. And a `narrowing` would be a CONDITIONING
 * assumption, which defeats discharge: a decision could never report an exact
 * bound again merely because a policy had run.
 *
 * The full ladder is not on the assumption because comparability is a property
 * of the objective a number was proved under, not of what else was affordable.
 * The ladder rides the `AdmissionStamp` on the emission record instead, so a
 * reader can still tell "territory was never admitted" from "territory was
 * admitted and lost".
 */
export function admissionAssumption(
  ladder: CohortLadder,
  cohorts: ReadonlyArray<CohortRow> = COHORTS
): Assumption {
  return cohortAssumptionOf(requireCohortRowIn(cohorts, activeRungOf(ladder)));
}

/** Are two ladders the same ladder? Order matters — it is the cost order. */
export function sameLadder(a: CohortLadder, b: CohortLadder): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// ---------------------------------------------------------------- the governor

export interface AdmissionFlip {
  readonly from: CohortLadder;
  readonly to: CohortLadder;
  /** Label only — the governor never reads it back. */
  readonly at: number;
  readonly conditions: AdmissionConditions;
  readonly assumption: Assumption;
}

/**
 * Consecutive MEASUREMENTS a new ladder must survive before the governor acts
 * on it. Two, matching `DEFAULT_POSTURE_DWELL`, and counted in measurements
 * exactly as that one is.
 */
export const DEFAULT_ADMISSION_DWELL = 2;

/**
 * The governor's carryable state.
 *
 * A decision is one measurement, so a dwell of two only means anything if it
 * counts ACROSS turns. It is carried as an immutable VALUE rather than by
 * sharing a governor instance between decisions: two decisions for one game can
 * overlap (a new turn arrives, the old one is abandoned), and a shared mutable
 * governor would let an abandoned decision's measurement land after its
 * successor's. A stale value is a stale-but-sound ladder; a shared latch is the
 * arena bug this codebase has already paid for once.
 */
export interface AdmissionState {
  readonly ladder: CohortLadder;
  /** The dissenting classification waiting out its dwell, if any. */
  readonly pending: CohortLadder | null;
  /** How many consecutive measurements it has held. */
  readonly held: number;
}

/**
 * Holds the current ladder and logs every transition as a named assumption.
 *
 * DWELL, AND WHY IT IS NOT BUDGET-KEYING. It is counted in MEASUREMENTS, never
 * in milliseconds: `AdmissionConditions` still carries no clock,
 * `classifyAdmission` is still a pure function of it, and there is still no
 * code path by which a millisecond can change a ladder. What the dwell adds is
 * the requirement that the BOARD say the same thing twice before an objective
 * changes — and an objective change is not a log-tidiness question, it is the
 * whole basis being replaced.
 *
 * At this tenant's settings the dwell has nothing to suppress (the composite
 * gate flips 0.101 times per 100 team-turns), and it is here for the predicate
 * that comes after this one: any future threshold on a quantity that moves
 * every turn — health, food density, region size — makes it mandatory.
 *
 * `dwell = 1` restores flip-on-first-sight, which is what a harness driving
 * classifications directly wants.
 */
export class AdmissionGovernor {
  private ladder: CohortLadder;
  private pending: CohortLadder | null;
  private held: number;
  private readonly log: AdmissionFlip[] = [];

  constructor(
    initial: CohortLadder = [BASE_COHORT_ID],
    private readonly dwell: number = DEFAULT_ADMISSION_DWELL,
    private readonly rows: ReadonlyArray<LadderRow> = ADMISSION_LADDERS,
    private readonly cohorts: ReadonlyArray<CohortRow> = COHORTS
  ) {
    this.ladder = initial;
    this.pending = null;
    this.held = 0;
  }

  /** Resume a governor from a previous decision's ending state, so the dwell
   * counts across turns without any two decisions sharing a mutable object. */
  static resume(
    state: AdmissionState,
    dwell: number = DEFAULT_ADMISSION_DWELL,
    rows: ReadonlyArray<LadderRow> = ADMISSION_LADDERS,
    cohorts: ReadonlyArray<CohortRow> = COHORTS
  ): AdmissionGovernor {
    const g = new AdmissionGovernor(state.ladder, dwell, rows, cohorts);
    g.pending = state.pending;
    g.held = state.held;
    return g;
  }

  /**
   * A governor that ADOPTS the board's first word without dwelling. This is the
   * shape a decision uses when nothing came before it: with no previous ladder
   * there is no chatter to suppress, and starting from a fixed guess would make
   * the first turn of every game run an objective the board did not ask for.
   */
  static opening(
    conditions: AdmissionConditions,
    dwell: number = DEFAULT_ADMISSION_DWELL,
    rows: ReadonlyArray<LadderRow> = ADMISSION_LADDERS,
    cohorts: ReadonlyArray<CohortRow> = COHORTS
  ): AdmissionGovernor {
    return new AdmissionGovernor(classifyAdmission(conditions, rows), dwell, rows, cohorts);
  }

  get current(): CohortLadder {
    return this.ladder;
  }

  /** The rung the decision is conducted under. */
  get activeCohort(): CohortId {
    return activeRungOf(this.ladder);
  }

  /** How many consecutive measurements the CURRENT dissenting classification
   * has held. Zero when the board agrees with the standing ladder. */
  get pendingHeld(): number {
    return this.pending === null ? 0 : this.held;
  }

  get flips(): ReadonlyArray<AdmissionFlip> {
    return this.log;
  }

  /** The carryable state, for the next decision on this game. */
  get state(): AdmissionState {
    return { ladder: this.ladder, pending: this.pending, held: this.held };
  }

  /** Classify, flip if the classification moved AND held, and return the flip. */
  observe(conditions: AdmissionConditions, at: number): AdmissionFlip | null {
    const next = classifyAdmission(conditions, this.rows);
    if (sameLadder(next, this.ladder)) {
      // The board agrees with where we are: whatever was pending is gone.
      this.pending = null;
      this.held = 0;
      return null;
    }
    if (this.pending !== null && sameLadder(this.pending, next)) this.held++;
    else {
      this.pending = next;
      this.held = 1;
    }
    if (this.held < Math.max(1, this.dwell)) return null;
    const from = this.ladder;
    this.pending = null;
    this.held = 0;
    const flip: AdmissionFlip = {
      from,
      to: next,
      at,
      conditions,
      assumption: admissionAssumption(next, this.cohorts),
    };
    this.ladder = next;
    this.log.push(flip);
    return flip;
  }
}

// ------------------------------------------------------------------ the policy

/**
 * WHAT A DECISION IS HANDED. The kernel holds one of these or `null`; `null`
 * IS the off state, so a build with the policy off has no admission code on any
 * path and the ladder is not "the default ladder" but nothing at all.
 *
 * Threaded per-engine rather than read from the process environment inside the
 * loop. A process-wide flag measures nothing: two arms of an A/B running in one
 * process would silently share it, which is the lesson a previous experiment
 * paid for.
 */
export interface AdmissionPolicy {
  /** The predicate table this decision classifies against. */
  readonly ladders: ReadonlyArray<LadderRow>;
  /** Consecutive measurements a new ladder must survive. */
  readonly dwell: number;
  /** The previous decision's ending state, so the dwell counts across turns. */
  readonly resume?: AdmissionState;
}

export const DEFAULT_ADMISSION_POLICY: AdmissionPolicy = {
  ladders: ADMISSION_LADDERS,
  dwell: DEFAULT_ADMISSION_DWELL,
};

/**
 * A ladder every one of whose rungs the registry can name. A ladder that names
 * an objective nobody can look up is worse than a decision that refuses to
 * start: it is indistinguishable from a sound one until someone tries to
 * compare it, which is months later and in a refit corpus. Checked once, at
 * decision entry, where the failure is attributable.
 */
export function requireLadderRegistered(
  ladder: CohortLadder,
  cohorts: ReadonlyArray<CohortRow>
): CohortLadder {
  if (ladder.length === 0) {
    throw new Error('an admitted ladder is never empty: the base cohort is the safety floor');
  }
  for (const id of ladder) requireCohortRowIn(cohorts, id);
  return ladder;
}

/**
 * RUN THE POLICY, ONCE, AT DECISION ENTRY.
 *
 * The one entry point the kernel calls. It measures, classifies, applies the
 * dwell against whatever the previous decision ended on, and returns the stamp
 * plus the state to carry forward. There is no second entry point on purpose:
 * a mid-decision re-measurement is the shape rule 2 exists to forbid, and the
 * cheapest way to forbid it is not to write the function.
 */
export function admitAtEntry(
  sub: AdmissionSubstrate,
  asTeam: number,
  policy: AdmissionPolicy,
  cohorts: ReadonlyArray<CohortRow>,
  at: number
): { stamp: AdmissionStamp; state: AdmissionState; flip: AdmissionFlip | null } {
  const detectors = measureAdmission(sub, asTeam);
  const governor =
    policy.resume === undefined
      ? AdmissionGovernor.opening(detectors, policy.dwell, policy.ladders, cohorts)
      : AdmissionGovernor.resume(policy.resume, policy.dwell, policy.ladders, cohorts);
  const flip = policy.resume === undefined ? null : governor.observe(detectors, at);
  requireLadderRegistered(governor.current, cohorts);
  return {
    stamp: { ladder: governor.current, activeCohort: governor.activeCohort, detectors },
    state: governor.state,
    flip,
  };
}
