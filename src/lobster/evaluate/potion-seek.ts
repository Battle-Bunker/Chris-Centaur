/**
 * `potionSeek` — WHEN COLLECTING A POTION IS WORTH THE COLLECTOR'S NECK.
 *
 * ── THE MECHANISM, READ OFF THE ENGINE ─────────────────────────────────────
 *
 * `TeamSnekProcessor.ts:577-633`. A unit whose HEAD lands on a potion collects
 * it, and the effect is asymmetric and immediate:
 *
 *   - the COLLECTOR takes −1 tier, expiring at `currentTurn + 3`;
 *   - EVERY OTHER LIVING TEAMMATE takes +1, expiring at the same turn;
 *   - effects STACK, so a second pickup by a second collector puts the
 *     untouched allies at +2 while the two collectors sit at −1 and 0;
 *   - contests rank tier STRICTLY before weight (`turnEngine.ts:182-188`), so
 *     inside the window a buffed ally beats any enemy at any weight, and the
 *     collector loses to any enemy at any weight.
 *
 * So a pickup is a TRADE, not a pickup: one unit is put underneath the whole
 * board for three turns to put the rest of the team on top of it. The trade is
 * worth making exactly when the rest of the team has something to do with
 * three turns on top, and that is a computable quantity rather than a taste.
 *
 * ── THE THIRD COST, WHICH IS NOT THE COLLECTOR'S WEIGHT ────────────────────
 *
 * `scheduleVulnerableCollisionBuffExpiry` (`TeamSnekProcessor.ts:530-556`): if
 * a VULNERABLE unit collides, every ally buff on that team is set to expire
 * next turn. Losing the collector therefore does not only cost the collector —
 * it CANCELS THE WINDOW the collector was bought to open. That coupling is the
 * reason exposure is published as a pair rather than folded into one number:
 * a caller pricing the worst case has to be able to zero the gain, not merely
 * subtract a weight from it.
 *
 * ── HOW TRAVEL EATS THE WINDOW, WITHOUT A TRAVEL PENALTY ───────────────────
 *
 * There is no distance coefficient in this file. A collector `t` turns away
 * collects on turn `T + t`, so the window is turns `T + t + 1 … T + t + 3`,
 * and `attackWindow` prices a cut landed `k` turns from now at `weight − i − k`
 * because a trail unit's body slides one index along every turn and its tail
 * pops (`turnEngine.ts:290-305`). Distance costs value because the body a
 * distant cut aims at is shorter by the time the cut lands. That is the
 * movement rule doing the discounting, and it is why the term prefers a
 * potion under our feet over an identical one four turns away without anybody
 * choosing how much to prefer it.
 *
 * ── WHAT THIS TERM DELIBERATELY DOES NOT COUNT ─────────────────────────────
 *
 * HEAD ATTACKS. A piece may take the head of a unit it outweighs with no
 * potion at all, so a head kill available inside the window is not a reason to
 * collect — it was available anyway. `attackWindow` reports heads and this
 * term never reads them. Counting them is the specific error that would make
 * every potion on the board look profitable.
 *
 * DENIAL. What the enemy loses by not getting this potion is real and is
 * `./potion-control.ts`'s question, not this one. Timing and control are
 * different decisions — one says *when*, the other says *whose ground* — and
 * summing them here would double-count a potion we both want.
 *
 * THE COLLECTOR'S OWN ATTACK. The collector goes to −1: it cannot cut anything
 * and it cannot win any contest. It is excluded from the gain by construction.
 *
 * ── SELECTABLE, AND SELECTED BY NO DEFAULT ─────────────────────────────────
 *
 * `POTION_SEEK_ENTRY` (`@2`) is the candidate as a registry value, carrying
 * `weight: 0` and named by no slate. `eval/potion-seek@3` is the seated
 * successor — same primitive and evidence, a non-zero advisory weight — and it
 * is named by `SLATE_POTION_AWARE` alone. A bot reads this module by being
 * configured onto that slate and in no other way; `evaluate/potion-lineup.ts`
 * is the adapter that hands it a live position, and it is where the `dodge`
 * option below is supplied when `eval/dodge-discount@2` is in the lineup.
 */

import { indexOccupancy, tierAt } from './ray-crossing';
import type { OccupancyIndex, RayBoard, RayUnit } from './ray-crossing';
import {
  NO_REACH,
  POTION_WINDOW_TURNS,
  UNREACHABLE,
  teamAttackWindow,
} from './attack-window';
import type {
  ArrivalReach,
  TeamAttackWindow,
  WindowInterval,
} from './attack-window';
import { NO_DISCOUNT, dodgeDiscount } from './dodge-discount';
import type { DodgeDiscountOptions, DodgeInterval } from './dodge-discount';
import type { StrategyEntry } from '../registry';

/**
 * What the collector is exposed to for three turns.
 *
 * `weightAtRisk` is the WORST CASE by the owner's instruction, not an expected
 * value: at −1 the collector is the strict minimum of every contest it enters,
 * so if an enemy can reach it inside the window the whole of its weight is on
 * the table. There is no survival coefficient here because there is no
 * measurement behind one — the corpus figure that exists (collectors died
 * inside their own debuff on 7.9% of 1,565 pickups) is an average over pickups
 * nobody aimed, and applying it as a probability to a deliberate pickup would
 * be borrowing a number from a different question.
 */
export interface CollectorExposure {
  /** The collector's own weight, when an enemy can reach it inside the window. */
  readonly weightAtRisk: number;
  /** True when some enemy unit's reach covers the collector's own square. */
  readonly contested: boolean;
  /**
   * THE TIGHTER READING, and it exists because the loose one is nearly always
   * true. The reach map is a sound OVER-approximation, so on any board with a
   * slider on it "some enemy could stand on that cell some time in the next
   * three turns" is close to a tautology — and charging the collector's whole
   * weight against a tautology makes every pickup unprofitable by
   * construction, which is a property of the instrument rather than of the
   * game.
   *
   * So this is the half we actually know something about: an enemy that can be
   * on the potion cell AT the collection or the turn after, which is the only
   * span over which we know where the collector is standing. Past that the
   * collector has moved and the term is not entitled to say where.
   *
   * `weightAtRisk` is the worst case and this is the near case, and
   * `potionSeekNet` lets a caller ask for either. They bracket.
   */
  readonly weightAtRiskNear: number;
  readonly contestedNear: boolean;
  /**
   * THE DODGE DISCOUNT ON THE NEAR ENDPOINT — owner ruling 23, and the repair
   * for the 99.6% false-alarm rate `sweeps/potion-terms-retrodiction.md` §3
   * measured on the boolean above.
   *
   * `NO_DISCOUNT` (all endpoints 1) unless a `dodge` option was supplied, so
   * this field is inert by default and every number already published is
   * reproduced bit for bit without it. `weightAtRiskNear` is multiplied by
   * `mean` and by no other endpoint: see `DodgeInterval.mean` for why reading
   * `best` would be a second free lunch rather than a discount.
   *
   * `weightAtRisk` — the WINDOW endpoint — is deliberately NOT discounted.
   * Past the first step the collector has moved and the model cannot generate
   * its move set, so the chain's later factors are 1 by default
   * (`chainedDiscount`) and the window reading keeps exactly the meaning and
   * the value it has today. The bracket does not narrow; it stops being two
   * booleans and becomes a boolean and a probability.
   */
  readonly nearDiscount: DodgeInterval;
  /**
   * The ally gain the engine CANCELS if the collector collides while
   * vulnerable — the buff-expiry coupling above. Equal to the gain when
   * contested, zero when not.
   */
  readonly windowAtRisk: number;
  /** Absolute turn the collector's own debuff expires, inclusive. */
  readonly debuffUntilTurn: number;
}

export interface PotionSeekValue {
  readonly collectorId: string;
  readonly team: number;
  /** Full-board index of the potion. */
  readonly potionCell: number;
  /** Turns until the collector's head can be on the potion. */
  readonly travelTurns: number;
  /** Absolute turn of the collection. */
  readonly collectAtTurn: number;
  /** The buffed window, absolute and inclusive. */
  readonly windowFrom: number;
  readonly windowTo: number;
  /**
   * Enemy body weight the LIVING TEAMMATES could sever inside the window at
   * +1, as the three-endpoint interval `attackWindow` publishes. Heads are not
   * in it; the collector is not in it.
   */
  readonly gain: WindowInterval;
  /** How many teammates have a non-empty body channel — the convergence count. */
  readonly armedAllies: number;
  /** The teammate carrying the best cut, for a caller that wants to say why. */
  readonly bestAllyId: string | null;
  readonly exposure: CollectorExposure;
  /** False when the collector cannot reach the potion inside `maxTravelTurns`. */
  readonly reachable: boolean;
}

export interface PotionSeekOptions {
  readonly turn?: number;
  /** Where reach comes from. Absent means nothing is reachable. */
  readonly reach?: ArrivalReach | null;
  /** The effect's length. Three, by the rules; a parameter for the tests only. */
  readonly windowTurns?: number;
  /**
   * How far a collector may be and still be priced. Beyond three turns the
   * reach map is an over-approximation of a board that will have changed, and
   * the term declines to guess rather than reporting a number it cannot stand
   * behind.
   */
  readonly maxTravelTurns?: number;
  /**
   * THE DODGE DISCOUNT, OFF BY DEFAULT AND ADDITIVE WHEN ON.
   *
   * Absent — and it is absent on every path in the repository — nothing
   * changes: `nearDiscount` is `NO_DISCOUNT`, `weightAtRiskNear` is the
   * collector's whole weight exactly as before, and no ray is walked. That is
   * what keeps the measured 57%/27% gain result attached to a term that still
   * computes it, and it is asserted as a test rather than claimed here.
   *
   * Present, the near endpoint is multiplied by `dodgeDiscount(...).mean`,
   * computed only where `contestedNear` is already true. Pass the replay's or
   * the board's own `hazardCells`: without them the local move generator
   * counts hazard cells as escapes and the discount is too generous, which on
   * the high-hazard boards ruling 22 calls typical is the term's single
   * largest source of optimism.
   */
  readonly dodge?: DodgeDiscountOptions | null;
}

const unreachable = (
  collector: RayUnit,
  potionCell: number,
  turn: number,
  windowTurns: number
): PotionSeekValue => ({
  collectorId: collector.unitId,
  team: collector.team,
  potionCell,
  travelTurns: Number.POSITIVE_INFINITY,
  collectAtTurn: Number.POSITIVE_INFINITY,
  windowFrom: Number.POSITIVE_INFINITY,
  windowTo: Number.POSITIVE_INFINITY,
  gain: { lo: 0, est: 0, hi: 0 },
  armedAllies: 0,
  bestAllyId: null,
  exposure: {
    weightAtRisk: 0,
    contested: false,
    weightAtRiskNear: 0,
    contestedNear: false,
    nearDiscount: NO_DISCOUNT,
    windowAtRisk: 0,
    debuffUntilTurn: turn + windowTurns,
  },
  reachable: false,
});

/**
 * Value collecting ONE potion with ONE of our units.
 *
 * COST CLASS: per-unit-action. One reach lookup for the travel, then one
 * `teamAttackWindow` over our own units — which is one ray fan per slider plus
 * one arrival lookup per enemy occupancy cell. The gate is one lookup: a
 * potion the collector cannot reach inside `maxTravelTurns` returns without
 * walking anything.
 */
export function potionSeek(
  board: RayBoard,
  collector: RayUnit,
  potionCell: number,
  options: PotionSeekOptions = {},
  index?: OccupancyIndex
): PotionSeekValue {
  const turn = options.turn ?? board.turn ?? 0;
  const windowTurns = options.windowTurns ?? POTION_WINDOW_TURNS;
  const maxTravel = options.maxTravelTurns ?? POTION_WINDOW_TURNS;
  const reach = options.reach ?? NO_REACH;

  const arrival = reach.earliestAt(collector.unitId, potionCell);
  if (arrival >= UNREACHABLE || arrival - turn > maxTravel) {
    return unreachable(collector, potionCell, turn, windowTurns);
  }
  // A unit already standing on the cell has not collected it: collection is a
  // head ARRIVAL, so the earliest a stationary unit can collect is next turn.
  const collectAtTurn = Math.max(arrival, turn + 1);
  const travelTurns = collectAtTurn - turn;
  const windowFrom = collectAtTurn + 1;
  const windowTo = collectAtTurn + windowTurns;

  const occ = index ?? indexOccupancy(board, windowFrom);
  const allies: TeamAttackWindow = teamAttackWindow(
    board,
    collector.team,
    {
      turn,
      fromTurn: windowFrom,
      toTurn: windowTo,
      tierDelta: 1,
      reach,
      exclude: new Set([collector.unitId]),
    },
    occ
  );

  // ── the collector's side ────────────────────────────────────────────────
  // At −1 relative it loses every contest it enters, so "exposed" is exactly
  // "an enemy can stand where it will be standing". Its own square after the
  // collection is the potion cell.
  let contested = false;
  let contestedNear = false;
  const nearTo = Math.min(collectAtTurn + 1, windowTo);
  for (const other of board.units) {
    if (other.team === collector.team) continue;
    const a = reach.earliestAt(other.unitId, potionCell);
    if (a <= nearTo && a >= collectAtTurn) contestedNear = true;
    if (a >= windowFrom && a <= windowTo) contested = true;
    if (contested && contestedNear) break;
  }
  contested = contested || contestedNear;

  // ── the dodge discount, and the gate that keeps it free ─────────────────
  // Computed only where the existing boolean is already true, so on every
  // board where it would change nothing it costs nothing — and absent the
  // option it is not computed at all. `origin: potionCell` is the point: the
  // collector's square after the collection is the potion cell, which is the
  // one square over the whole window that the model actually knows.
  let nearDiscount = NO_DISCOUNT;
  if (contestedNear && options.dodge != null) {
    nearDiscount = dodgeDiscount(
      board,
      collector,
      { ...options.dodge, turn: collectAtTurn, origin: potionCell, reach },
      occ
    ).discount;
  }

  return {
    collectorId: collector.unitId,
    team: collector.team,
    potionCell,
    travelTurns,
    collectAtTurn,
    windowFrom,
    windowTo,
    gain: allies.total,
    armedAllies: allies.armed,
    bestAllyId: allies.best === null ? null : allies.best.unitId,
    exposure: {
      weightAtRisk: contested ? collector.weight : 0,
      contested,
      weightAtRiskNear: contestedNear ? collector.weight * nearDiscount.mean : 0,
      contestedNear,
      nearDiscount,
      windowAtRisk: contested ? allies.total.est : 0,
      debuffUntilTurn: collectAtTurn + windowTurns,
    },
    reachable: true,
  };
}

/** Which endpoint of the collector's exposure a fold should charge. */
export type ExposureReading =
  /** The worst case: contested anywhere in the window. */
  | 'window'
  /** The near case: contested where we know the collector is standing. */
  | 'near'
  /** No exposure at all — the gain endpoint, and the upper bracket. */
  | 'none';

export interface PotionSeekFoldOptions {
  readonly exposure?: ExposureReading;
  /**
   * Also apply the buff-expiry coupling: assume the contested collector does
   * collide, so the window it bought is cancelled as well as the collector
   * lost. The pessimistic endpoint, and the one a safety-first caller reads.
   */
  readonly worstCase?: boolean;
}

const exposureOf = (v: PotionSeekValue, reading: ExposureReading): number => {
  if (reading === 'none') return 0;
  return reading === 'near' ? v.exposure.weightAtRiskNear : v.exposure.weightAtRisk;
};

/**
 * The trade, folded to one number in units of OUR OWN WEIGHT.
 *
 * Enemy weight removed enters at the share-metric exchange rate
 * (`severExchangeRate` in `./slider-attack-vector.ts` — `p / (1 − p)`, computed
 * off the live board and never a knob); the collector's own weight enters at
 * one, because it is ours.
 *
 * There is no default that hides the choice: `exposure` defaults to the WORST
 * CASE, which is the reading the owner asked for, and a caller that wants the
 * bracket asks for the other two endpoints explicitly.
 */
export function potionSeekNet(
  value: PotionSeekValue,
  exchangeRate: number,
  options: PotionSeekFoldOptions = {}
): number {
  if (!value.reachable) return 0;
  const cost = exposureOf(value, options.exposure ?? 'window');
  const gain = options.worstCase === true
    ? value.gain.est - value.exposure.windowAtRisk
    : value.gain.est;
  if (gain <= 0) return -cost;
  if (!Number.isFinite(exchangeRate)) return Number.POSITIVE_INFINITY;
  return exchangeRate * gain - cost;
}

/**
 * The owner's timing signal, as one boolean: is there a profitable enemy-body
 * attack inside the window that this pickup would open, net of what the pickup
 * costs the collector?
 */
export function potionSeekRecommends(
  value: PotionSeekValue,
  exchangeRate: number,
  options: PotionSeekFoldOptions = {}
): boolean {
  return value.reachable && potionSeekNet(value, exchangeRate, options) > 0;
}

/**
 * The best (collector, potion) pair on the board for one team.
 *
 * Every one of our living units against every uncollected potion. The pairing
 * is deliberate rather than "the nearest unit takes it": the collector pays the
 * whole cost and the ALLIES take the whole benefit, so the right collector is
 * often the unit with nothing to attack, and a nearest-unit rule would send the
 * one piece whose lines are loaded.
 */
export interface PotionSeekChoice {
  readonly value: PotionSeekValue;
  readonly net: number;
}

export function bestPotionSeek(
  board: RayBoard,
  team: number,
  potionCells: ReadonlyArray<number>,
  exchangeRate: number,
  options: PotionSeekOptions & PotionSeekFoldOptions = {},
  index?: OccupancyIndex
): PotionSeekChoice | null {
  if (potionCells.length === 0) return null;
  const turn = options.turn ?? board.turn ?? 0;
  const occ = index ?? indexOccupancy(board, turn);
  let best: PotionSeekChoice | null = null;
  for (const unit of board.units) {
    if (unit.team !== team) continue;
    for (const cell of potionCells) {
      const v = potionSeek(board, unit, cell, options, occ);
      if (!v.reachable) continue;
      const net = potionSeekNet(v, exchangeRate, options);
      if (best === null || net > best.net) best = { value: v, net };
    }
  }
  return best;
}

/**
 * Is any of our units carrying a live tier advantage right now? Cheap, and the
 * one fact that says a window is ALREADY open — collecting a second potion
 * while a window is running stacks, but the 21.9% of corpus pickups made by an
 * already-buffed unit burned an ally's −1 for nothing, so a caller wants to be
 * able to see the difference.
 */
export function teamHasLiveWindow(board: RayBoard, team: number, turn: number): boolean {
  for (const u of board.units) {
    if (u.team !== team) continue;
    if (tierAt(u, turn) > 0) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The candidate, as data
// ---------------------------------------------------------------------------

export const POTION_SEEK_ENTRY: StrategyEntry = {
  // @2 rather than @1 BY THE IDENTITY LAW (`../registry.ts`): the params tree
  // is part of the fingerprint, and `exposure` below now names a second term.
  // The behaviour without a `dodge` option is bit-for-bit what @1 computed —
  // which is asserted as a test — but "same numbers today" is not the law's
  // test; "same structure" is, and the structure grew a discount.
  id: 'eval/potion-seek@2',
  slot: 'evaluator',
  primitive: 'attack-window+arrival-shells',
  params: {
    windowTurns: POTION_WINDOW_TURNS,
    maxTravelTurns: POTION_WINDOW_TURNS,
    /** Heads are never a reason to collect: they need no potion. */
    countHeads: false,
    /** Denial belongs to eval/potion-control@1 and is not summed here. */
    countDenial: false,
    /**
     * The collector's exposure is the worst case, not a survival rate — and
     * the NEAR endpoint alone is multiplied by the dodge discount when a
     * caller supplies one. The window endpoint is undiscounted, because past
     * the first step the collector's move set is not generable.
     */
    exposure:
      'worst-case-contest, near reading dodge-discounted (eval/dodge-discount@1)',
    weight: 0,
  },
  soundness: 'advisory',
  priors: {
    fitted: false,
    strata: [
      'potions standing on the board',
      'enemy trail-unit count',
      'our units with a free line',
      'whether a window is already open',
    ],
    note:
      'A point mass at zero with a long right tail: on most positions no ally has a ' +
      'body cut inside three turns and the term is exactly zero, and occasionally the ' +
      'window is worth an entire enemy trail unit. The zero half is provable rather ' +
      'than observed, which is what makes the gate free.',
  },
  cost: {
    fitted: false,
    features: ['potion count', 'our unit count', 'enemy occupancy cells'],
    note:
      'One reach lookup gates each (collector, potion) pair; a pair that survives the ' +
      'gate costs one team attack-window. Reach is borrowed from the arrival shells, ' +
      'never rebuilt.',
  },
  record: {
    status: 'candidate',
    ledgerRows: [],
    note:
      'Design evidence only, from tools/retrodiction/potion-terms-retrodiction.js on ' +
      'the committed batch-1 replays. No arm has ever been run with this term.',
  },
};
