/**
 * THE TIER-WINDOW LAYER — who outranks this unit right now, and what our own
 * next pickup would cost.
 *
 * ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
 *
 * `strictMaximum` orders a contest on TIER FIRST and frozen weight second
 * (`turnEngine.ts:173-179`), so a ±1 tier gap overrides any material
 * difference whatsoever. A twelve-weight snake loses to a three-weight one if
 * the small one is buffed and it is not. That is the sharpest edge in the rule
 * set and it is entirely legible: every unit on every board carries its
 * `invulnerabilityLevel` and `invulnerabilityExpiryTurn`, and the tier a unit
 * carries into the arrival turn is exactly `tierAtArrival`.
 *
 * ── WHY IT IS A SEPARATE READING FROM THE CLOUD BOUNDS ─────────────────────
 *
 * A `Claim` carries a tier INTERVAL — what the tier could become over the turns
 * a unit has been unobserved, including what a reachable potion could do to it.
 * That interval is the right input to a score bound and the wrong input to a
 * safety verdict: on a potion-dense board almost every unit's ceiling sits one
 * above its held tier, so a filter keyed on `tierMax` flags everything and
 * discriminates nothing.
 *
 * This layer reads `Claim.tierAtArrival` instead — the scalar tier the engine
 * says the unit carries into the settled turn if nothing it could reach moved
 * it — which is a fact about the arrival turn, exact for enemies as well as for
 * ourselves, and identically zero on a board with no potions. That last property is the reason the whole layer is free where
 * it should be free: with `invulnerabilityPotionEnabled` off, no unit ever
 * outranks another, every threat set is empty, and nothing below changes a
 * single decision.
 *
 * ── THE TWO CHANNELS, WHICH ARE NOT THE SAME PROBLEM ───────────────────────
 *
 * 1. THE ATTACKER'S TIER ROSE. An ally of theirs picked a potion up and every
 *    one of their units took +1. Nothing about us changed. Detecting it needs
 *    the enemy's tier, which is on the wire.
 *
 * 2. OUR OWN TIER MOVED, because WE are the collector. A unit that walks onto
 *    a potion changes its own tier and its whole team's, and detecting THAT
 *    needs no enemy modelling whatsoever — a unit knows where it is going and
 *    it knows what is on that cell.
 *
 * Channel 2 is priced by `selfDebuffOf`; channel 1 by `threatsFor`.
 *
 * ── WHAT THE PICKUP DOES IS ASKED, NOT ASSERTED ────────────────────────────
 *
 * This layer used to carry the pickup rule as a pair of literals — the
 * collector takes −1, and the +1 to every ally was written down as
 * deliberately not modelled. That made a pickup look like pure loss with no
 * credit anywhere, and it made this file a second copy of a rule that has
 * already moved once (the citation it carried, `TeamSnekProcessor.ts:596-623`,
 * does not exist any more).
 *
 * Settlement writes both halves, so both are read: `Substrate.tiersAfterPickupBy`
 * hands back the tier vector the turn after a pickup opens at, for the whole
 * board, and every judgement below is a comparison against that vector. The
 * collector's own level, the allies' gain, and the case where there are no
 * living allies to gain anything, all fall out of one reading.
 */

import { NEVER } from '../engine-vendor/engine/claims';
import type { Claim } from '../engine-vendor/engine/claims';
import type { EngineSubstrate, SubstrateUnit } from './substrate';
import type { CellIndex } from './contracts';

/** One claim that outranks the subject at the arrival turn. */
export interface TierThreat {
  readonly claim: Claim;
  /** The tier it actually holds at the arrival turn — strictly above ours. */
  readonly tier: number;
  /**
   * TRUE when tier is the ONLY reason we lose: at equal tier our frozen weight
   * would have won the contest or tied it (a tie kills both, which is still
   * better than a clean loss). This is the class where the buff CHANGED the
   * outcome rather than merely confirming it.
   */
  readonly decisive: boolean;
}

/** Everything the candidate layer needs to know about one unit's exposure. */
export interface TierExposure {
  /** The arrival turn these readings are about (`sub.turn + 1`). */
  readonly arrivalTurn: number;
  /** The tier the subject itself carries into that turn. */
  readonly ownTier: number;
  /** Claims that strictly outrank the subject. Empty on a potion-free board. */
  readonly threats: ReadonlyArray<TierThreat>;
  /**
   * The tier the subject would carry the turn after collecting a potion — the
   * settled figure, not `ownTier − 1`: an ally collecting on the same turn, or
   * a window of the subject's own lapsing, both move it. Null when a pickup is
   * impossible on this board (potions off, or none on it), which is the case
   * that keeps the whole layer free where it should be free.
   */
  readonly tierAfterPickup: number | null;
  /** Claims that would outrank the subject at `tierAfterPickup`. */
  readonly threatsAfterPickup: ReadonlyArray<TierThreat>;
}

const NO_THREATS: ReadonlyArray<TierThreat> = [];

/**
 * The claims that outrank `unit` at the arrival turn, and the claims that
 * WOULD outrank it if it collected a potion this turn.
 *
 * Both lists are computed in one pass over the field's slots — at most
 * `MAX_FROZEN` of them — so this is a few dozen integer comparisons per unit
 * per decision, and on a board with no live potion effects it is one loop that
 * finds nothing.
 *
 * Friendly claims are INCLUDED. The resolver does not know about teams
 * (`strictMaximum` ranks every participant at the cell regardless of colour)
 * and the corpus is unambiguous that this is not a theoretical concern: a
 * quarter of tier-attributed friendly deaths are a team's own buffed unit
 * killing its own collector.
 */
export function exposureOf(sub: EngineSubstrate, unit: SubstrateUnit): TierExposure {
  const arrivalTurn = sub.arrivalTurn;
  // `SubstrateUnit.tier` is already exact at the arrival turn — the
  // marshalling has lapsed it — so there is nothing left to derive here.
  const ownTier = unit.tier;
  // What a pickup would leave this unit at is settlement's answer, asked once
  // per unit and only where a pickup is possible at all. On a board with
  // potions off, or none on it, there is nothing to ask and nothing to pay for.
  const tierAfterPickup = pickupPossible(sub)
    ? sub.tiersAfterPickupBy(unit.unitId).get(unit.unitId) ?? ownTier
    : null;
  const claims = sub.claimsOf();
  if (claims.length === 0) {
    return {
      arrivalTurn,
      ownTier,
      tierAfterPickup,
      threats: NO_THREATS,
      threatsAfterPickup: NO_THREATS,
    };
  }

  const threats: TierThreat[] = [];
  const afterPickup: TierThreat[] = [];
  for (const claim of claims) {
    if (claim.id === unit.wireId) continue;
    if (claim.certainlyGone) continue;
    const tier = claim.tierAtArrival;
    // Weight is compared at the claim's CEILING: a held unit may have eaten.
    // Under-reading it here would call a loss "decisive" that weight alone
    // would also have produced.
    const decisive = unit.weight >= claim.weightMax;
    if (tier > ownTier) threats.push({ claim, tier, decisive });
    if (tierAfterPickup !== null && tier > tierAfterPickup) {
      afterPickup.push({ claim, tier, decisive });
    }
  }
  return {
    arrivalTurn,
    ownTier,
    tierAfterPickup,
    threats: threats.length === 0 ? NO_THREATS : threats,
    threatsAfterPickup: afterPickup.length === 0 ? NO_THREATS : afterPickup,
  };
}

/**
 * Could ANY unit collect a potion on this board at all? The same gate
 * `potionAt` has always applied, so this adds no precondition of its own —
 * whether a potion cell is live is settled once, in `marshalBoard`.
 */
function pickupPossible(sub: EngineSubstrate): boolean {
  return sub.potionsEnabled() && sub.marshalled.potions.length > 0;
}

/**
 * Can this threat be at `cell` at `subStep`, in the role that would kill us?
 *
 * HEAD and DURABLE MATERIAL only. A living BODY segment is deliberately out:
 * the body rule is `m.tier <= maxOwnerTier ⇒ the mover dies`, so a mover dies
 * on a body at EQUAL tier too and the gap changes nothing there. Counting body
 * cells would flag every enemy trail on the board as a tier problem, which is
 * both wrong and ruinous.
 *
 * The head role carries the engine's own `earliestSubStep`, so a threat that
 * cannot arrive before sub-step 3 is not cited against a mover crossing at
 * sub-step 2 — the claim's own gate, read rather than re-derived.
 */
function threatReaches(threat: TierThreat, cell: CellIndex, subStep: number): boolean {
  const claim = threat.claim;
  const earliest = claim.earliestSubStep[cell];
  if (earliest !== undefined && earliest !== NEVER && earliest <= subStep) return true;
  // A claim that might have DIED anywhere it has been leaves a durable pile
  // there, and a pile keeps contesting at its frozen strength for the rest of
  // the turn — including its tier.
  if (claim.deathPossible && claim.everPossible.includes(cell)) return true;
  return false;
}

/** How a candidate stands with respect to tier. Ordered best-first. */
export type TierGrade = 'clear' | 'exposed' | 'decisive';

const GRADE_RANK: Readonly<Record<TierGrade, number>> = {
  clear: 0,
  exposed: 1,
  decisive: 2,
};

export const tierGradeRank = (g: TierGrade): number => GRADE_RANK[g];

/**
 * The tier grade of one staged path, over the WHOLE path.
 *
 * A slider is adjudicated at every cell of its ray, not at its destination
 * (`turnEngine.ts:314-318`), so a queen can die on a square it never meant to
 * stop on. Grading destinations only inflates how much room a unit looks to
 * have by roughly a factor of two on slider victims, which is exactly the
 * direction a safety reading may not err in.
 *
 * `path` is the cells ENTERED, origin excluded — the same array the risk layer
 * takes. An empty path (a stay or a rotation) is graded at the unit's own
 * resting cell, because standing still is not the same as being unreachable.
 */
export function gradePath(
  exposure: TierExposure,
  origin: CellIndex,
  path: ReadonlyArray<CellIndex>,
  threats: ReadonlyArray<TierThreat> = exposure.threats
): TierGrade {
  if (threats.length === 0) return 'clear';
  let grade: TierGrade = 'clear';
  const cells = path.length === 0 ? [origin] : path;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as CellIndex;
    // A stay is a whole-turn question: the unit is there for every sub-step.
    const subStep = path.length === 0 ? Number.MAX_SAFE_INTEGER : i + 1;
    for (const threat of threats) {
      if (!threatReaches(threat, cell, subStep)) continue;
      if (threat.decisive) return 'decisive';
      grade = 'exposed';
    }
  }
  return grade;
}

/** What landing on a potion cell does to the unit that lands there. */
export type SelfDebuff =
  /** No potion on any cell the move can come to rest on. */
  | 'none'
  /** A pickup that costs the team nothing this unit was using. */
  | 'spend'
  /** A pickup with NO living ally to take the other half of the rule. */
  | 'solo'
  /** A pickup that throws away a +1 a teammate paid a −1 for. */
  | 'waste'
  /** A pickup that puts the unit into a window where something outranks it. */
  | 'exposed'
  /** A pickup by a king — a self-inflicted debuff on the unit the team ends with. */
  | 'king';

/**
 * `spend` ranks ZERO on purpose. A plain pickup buys one unit-window of loss
 * and roughly three ally unit-windows of gain; the matched control in the
 * corpus put the team-level material swing at −0.05 with an interval a full
 * unit wide either way, i.e. not measurably a loss. Charging it here would be a
 * preference this evidence does not license, and it would also foreclose the
 * offensive side of the window — a deliberate collection — before it is built.
 *
 * `solo` is the case that reading only half the rule could not see. The whole
 * argument for `spend` being free is the ally half of the pickup; settlement
 * says when there is no ally to receive it, and then the pickup is the debit
 * with the credit removed. It is charged like `waste`, which is the same
 * shape of mistake: a window paid for and not used.
 */
const SELF_DEBUFF_RANK: Readonly<Record<SelfDebuff, number>> = {
  none: 0,
  spend: 0,
  solo: 1,
  waste: 1,
  exposed: 2,
  king: 3,
};

export const selfDebuffRank = (d: SelfDebuff): number => SELF_DEBUFF_RANK[d];

/**
 * Price this unit's own pickup, for a move that could come to rest on a potion.
 *
 * Collection is DESTINATION-ONLY — a slider passing over a potion does not
 * collect it, because settlement reads a surviving head's resting cell — so
 * this reads the landing set, not the path. The landing set is the risk
 * layer's, which is a SET when a possible halt makes the resting cell
 * uncertain; a potion on any member is a possible pickup and is priced as one.
 *
 * WHAT THE PICKUP DOES IS SETTLEMENT'S ANSWER. `exposure.tierAfterPickup` is
 * the tier this unit opens the next turn at, and the ally half of the rule is
 * read off the same vector rather than written off as unmodelled. Neither
 * polarity nor magnitude appears in this file.
 *
 * The effect does not bite until the turn AFTER the pickup, so `exposed` is a
 * statement about the next turn made with this turn's claim field. That field
 * is one turn dilated already, which makes it the cheapest sound-ish proxy
 * available at this altitude; it is used to ORDER, never to refuse.
 */
export function selfDebuffOf(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  exposure: TierExposure,
  landing: ReadonlyArray<CellIndex>
): SelfDebuff {
  if (exposure.tierAfterPickup === null) return 'none';
  let onPotion = false;
  for (const cell of landing) {
    if (sub.potionAt(cell)) {
      onPotion = true;
      break;
    }
  }
  if (!onPotion) return 'none';
  if (unit.isKing) return 'king';
  if (exposure.threatsAfterPickup.length > 0) {
    for (const cell of landing) {
      if (!sub.potionAt(cell)) continue;
      if (gradePath(exposure, cell, [], exposure.threatsAfterPickup) !== 'clear') {
        return 'exposed';
      }
    }
  }
  // A unit already carrying a buff burns the window a teammate bought.
  // Corpus-wide that is a fifth of every pickup made.
  if (exposure.ownTier > 0) return 'waste';
  // THE OTHER HALF OF THE RULE, which used to be written off. Settlement pays
  // every LIVING ally; ask it whether anybody was there to be paid.
  if (!anyAllyGains(sub, unit)) return 'solo';
  return 'spend';
}

/**
 * Does a pickup by `unit` raise any teammate's tier? Read straight off the
 * settled vector, so "who counts as an ally" and "what a living ally receives"
 * are both the engine's answers and neither is restated here.
 */
function anyAllyGains(sub: EngineSubstrate, unit: SubstrateUnit): boolean {
  const after = sub.tiersAfterPickupBy(unit.unitId);
  for (const other of sub.roster()) {
    if (other.unitId === unit.unitId) continue;
    if (other.team !== unit.team) continue;
    const settled = after.get(other.unitId);
    if (settled === undefined) continue;
    if (settled > other.tier) return true;
  }
  return false;
}
