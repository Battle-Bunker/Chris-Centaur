/**
 * `attackWindow` — WHAT A UNIT COULD CUT INSIDE A THREE-TURN TIER WINDOW.
 *
 * ── THE RULE THIS EXISTS TO PRICE ──────────────────────────────────────────
 *
 * The owner's correction, and it is the whole shape of this file: **a body cut
 * is only possible with an active tier advantage.** `turnEngine.ts:445-489`
 * kills a mover that arrives on a trail unit's body cell unless its tier is
 * STRICTLY HIGHER than the highest owner's; equal tier dies, lower tier dies.
 * Tier comes from one place — a potion — and lasts exactly three turns
 * (`TeamSnekProcessor.ts:596-623`, `expiryTurn = currentTurn + 3`). So:
 *
 *   - WITH a tier advantage, a piece may cut an enemy BODY, and a body cut is
 *     the only channel that removes large weight in one action, because a
 *     trail unit's weight IS its occupancy length.
 *   - WITHOUT one, a piece's attack is only against the HEAD of a unit it
 *     outranks on weight (`turnEngine.ts:396-443`, `strictMaximum` — tier
 *     first, weight second, non-unique maximum kills everyone).
 *
 * Those are two different questions with two different prices, and this module
 * answers them SEPARATELY. Mixing them is the specific error that would make a
 * potion look valuable for a kill we could already make without one.
 *
 * ── WHY "WITHIN THREE TURNS" IS NOT AN APPROXIMATION ───────────────────────
 *
 * Three is the effect's own length. A potion collected on turn C buffs every
 * living ally for turns C+1, C+2, C+3 inclusive. A cut that cannot be landed
 * inside those three turns is not a reason to collect the potion, and one that
 * can be is the entire reason. `potion-seek.ts` reads this module over exactly
 * that turn span and nothing else.
 *
 * ── THE INTERVAL, AND WHY THERE IS NO POINT ESTIMATE ───────────────────────
 *
 * Same three endpoints `slider-attack-vector.ts` publishes, for the same
 * reason and by the same arithmetic:
 *
 *   hi  OPTIMISTIC   the target stands still; the reach map is exact.
 *   lo  PESSIMISTIC  every target steps off every line — zero.
 *   est THE MOVEMENT RULE'S OWN ANSWER. A trail unit's head unshifts a new
 *       cell and its tail pops every turn (`turnEngine.ts:290-305`), so a body
 *       cell at occupancy index `i` today is at index `i + k` in `k` turns and
 *       is GONE if it ran off the tail. Cutting it `k` turns from now removes
 *       `weight − i − k` cells. That is arithmetic off the movement rule, not
 *       a coefficient anybody fitted, and it is why DISTANCE COSTS VALUE
 *       without a distance penalty being invented: the further ahead the cut,
 *       the smaller the body left to cut.
 *
 * ── WHERE REACH COMES FROM: BORROWED, NOT REBUILT ──────────────────────────
 *
 * "Can this unit be on that cell by turn T?" is the arrival map, and the
 * arrival map already exists — `./shells.ts` stamps `earliest[c]` off the
 * engine's own dilation shells, and `./territory.ts` partitions the board with
 * it. This module does not compute reach. It takes an `ArrivalReach` and reads
 * it, so the production consumer passes territory's shells and a test or a
 * replay miner passes a stamped grid built the same way.
 *
 * That map is an OVER-APPROXIMATION by construction — a sound superset of
 * where a unit could be, computed against a frozen board — which is exactly
 * why it feeds `hi` and never `lo`. For a slider on an open board it is close
 * to the whole board at horizon three, and a term that read it as a point
 * estimate would claim every enemy body on the board. It is not read as one.
 *
 * ── AND WHAT IS EXACT: THE CUT AVAILABLE THIS TURN ─────────────────────────
 *
 * `executableNow` is the one number here that is not a reach question. It is
 * the ordered ray walk (`./ray-crossing.ts`) from the unit's own square, at the
 * hypothetical tier, adjudicated by the engine's own rules — what this unit
 * would cut if it moved now and nothing else moved. It is the boolean the
 * owner's timing signal actually turns on, and it costs one walk.
 *
 * ── DARK BY CONSTRUCTION ───────────────────────────────────────────────────
 *
 * Nothing on the production path imports this module. `ATTACK_WINDOW_ENTRY` is
 * the candidate as a registry value (`../registry.ts`'s `StrategyEntry`), and
 * it is not in `LEGACY_ENTRIES` and not in any slate — a candidate is
 * configured in, never flagged on.
 */

import {
  indexOccupancy,
  rayCrossings,
  tierAt,
} from './ray-crossing';
import type { OccupancyIndex, RayBoard, RayUnit } from './ray-crossing';
import { NEVER, profileOf } from '../../partial-engine/index';
import type { StrategyEntry } from '../registry';

/** The potion effect's own length, in turns. `TeamSnekProcessor.ts:602`. */
export const POTION_WINDOW_TURNS = 3;

/**
 * "Cannot get there" — and it is the ARRIVAL MACHINERY'S OWN sentinel
 * (`cloud.ts:NEVER`, `0x7fffffff`), re-exported rather than invented.
 *
 * That is not tidiness. `earliest[c]` is an `Int32Array`, so a sentinel this
 * module chose for itself — `Number.MAX_SAFE_INTEGER`, say — would be TRUNCATED
 * on the way into the grid and read back as −1, which is a smaller turn than
 * any real arrival and would make every unreachable cell look immediately
 * reachable. Borrowing the producer's sentinel makes that class of bug
 * unrepresentable.
 */
export const UNREACHABLE = NEVER;

/**
 * REACH, BORROWED. The absolute turn at which a unit could FIRST stand on a
 * cell — the arrival map's `earliest[c]`, and nothing else.
 *
 * Deliberately one method wide. Every producer of arrival information in this
 * repository can satisfy it, and no consumer of it can accidentally acquire a
 * dependency on the substrate the producer happens to live on.
 */
export interface ArrivalReach {
  earliestAt(unitId: string, cell: number): number;
}

/** A reach view over stamped grids, keyed by unit. `NEVER` reads as unreachable. */
export function reachFromEarliest(
  grids: ReadonlyMap<string, Int32Array>,
  never = UNREACHABLE
): ArrivalReach {
  return {
    earliestAt(unitId: string, cell: number): number {
      const g = grids.get(unitId);
      if (g === undefined) return UNREACHABLE;
      const t = g[cell];
      if (t === undefined) return UNREACHABLE;
      return t >= never ? UNREACHABLE : t;
    },
  };
}

/**
 * The same, over anything that stamps its grid on demand — `UnitShells` from
 * `./shells.ts` is exactly this shape, so the production path passes the
 * shells the territory reading has already built and pays nothing extra.
 */
export function reachFromShells(
  shells: ReadonlyMap<string, { earliest(): Int32Array }>,
  never = UNREACHABLE
): ArrivalReach {
  return {
    earliestAt(unitId: string, cell: number): number {
      const s = shells.get(unitId);
      if (s === undefined) return UNREACHABLE;
      const t = s.earliest()[cell];
      if (t === undefined) return UNREACHABLE;
      return t >= never ? UNREACHABLE : t;
    },
  };
}

/** Nothing is reachable. The honest reach for a caller that has no map. */
export const NO_REACH: ArrivalReach = { earliestAt: () => UNREACHABLE };

export interface WindowInterval {
  /** Pessimistic: every target steps off every line. */
  readonly lo: number;
  /** The movement rule's own answer — see the module doc. */
  readonly est: number;
  /** Optimistic: nothing moves, and the reach map is exact. */
  readonly hi: number;
}

const ZERO: WindowInterval = { lo: 0, est: 0, hi: 0 };

export interface AttackWindowValue {
  readonly unitId: string;
  readonly team: number;
  /** The tier the BODY channel was judged at — the unit's own plus `tierDelta`. */
  readonly judgedTier: number;
  /** Absolute turns the window covers, inclusive. */
  readonly fromTurn: number;
  readonly toTurn: number;
  /**
   * Enemy body weight this unit could sever inside the window at `judgedTier`.
   * Identically zero when `judgedTier` beats no owner — which is the whole
   * point: this is the channel a potion opens and nothing else does.
   */
  readonly body: WindowInterval;
  /** Absolute turn of the best body cut, or null when there is none. */
  readonly bodyAt: number | null;
  readonly bodyVictim: string | null;
  /**
   * Enemy weight this unit could take in a HEAD-CLASS contest inside the
   * window at its OWN tier — the lower-weight-head attack, which needs no
   * potion. Reported so a caller can see it, and kept out of every potion
   * valuation, because a kill available without collecting is not a reason to
   * collect. It is also already folded by material.
   */
  readonly head: WindowInterval;
  readonly headAt: number | null;
  readonly headVictim: string | null;
  /**
   * What this unit would cut IF IT MOVED NOW and nothing else moved: the
   * ordered ray walk at `judgedTier`, adjudicated by the engine's rules. Exact
   * rather than reach-derived, and zero for a unit with no rays.
   */
  readonly executableNow: number;
  /**
   * True when some enemy unit could also stand on the best body cut's cell
   * inside the window carrying a tier that is not below ours. The cut is then
   * a contest rather than a free cut, and a caller pricing risk needs to know.
   */
  readonly contested: boolean;
}

export interface AttackWindowOptions {
  /** The turn this board is the start of. */
  readonly turn?: number;
  /** Tier to add to the unit's own — `+1` is the ally's side of a pickup. */
  readonly tierDelta?: number;
  /** First absolute turn of the window. Defaults to `turn + 1`. */
  readonly fromTurn?: number;
  /** Last absolute turn, inclusive. Defaults to `fromTurn + POTION_WINDOW_TURNS - 1`. */
  readonly toTurn?: number;
  /** Where reach comes from. Absent means "no reach information at all". */
  readonly reach?: ArrivalReach | null;
}

const empty = (
  unit: RayUnit,
  judgedTier: number,
  fromTurn: number,
  toTurn: number
): AttackWindowValue => ({
  unitId: unit.unitId,
  team: unit.team,
  judgedTier,
  fromTurn,
  toTurn,
  body: ZERO,
  bodyAt: null,
  bodyVictim: null,
  head: ZERO,
  headAt: null,
  headVictim: null,
  executableNow: 0,
  contested: false,
});

/**
 * What the ordered walk says this unit cuts if it moves NOW at `tier`.
 *
 * A stepper has no rays and gets zero from here — not because a stepper cannot
 * cut (it can: it arrives on a body cell like anything else) but because its
 * one-step arrivals are already in the reach map at `turn + 1`, and counting
 * them twice would price one cut as two.
 */
function executableNowValue(
  board: RayBoard,
  unit: RayUnit,
  tier: number,
  occ: OccupancyIndex
): number {
  if (profileOf(unit.kind).rays.length === 0) return 0;
  let best = 0;
  for (const walk of rayCrossings(board, unit, { tier }, occ)) {
    const t = walk.terminal;
    if (t.verdict !== 'sever' || !t.withinHealth) continue;
    if (t.enemyWeightRemoved - t.allyWeightRemoved > best) {
      best = t.enemyWeightRemoved - t.allyWeightRemoved;
    }
  }
  return best;
}

/**
 * Value one unit's attack window.
 *
 * COST CLASS: per-unit-action for the exact half (one ray fan), per-turn for
 * the reach half (one map lookup per enemy occupancy cell, and the enemy's
 * occupancy is the board's own trail length). The gate is free and total: with
 * `tierDelta` leaving us at or below every owner's tier the body channel is
 * provably empty and only the head channel is walked.
 */
export function attackWindow(
  board: RayBoard,
  unit: RayUnit,
  options: AttackWindowOptions = {},
  index?: OccupancyIndex
): AttackWindowValue {
  const turn = options.turn ?? board.turn ?? 0;
  const fromTurn = options.fromTurn ?? turn + 1;
  const toTurn = options.toTurn ?? fromTurn + POTION_WINDOW_TURNS - 1;
  const ownTier = tierAt(unit, fromTurn);
  const judgedTier = ownTier + (options.tierDelta ?? 0);
  const reach = options.reach ?? NO_REACH;
  if (toTurn < fromTurn) return empty(unit, judgedTier, fromTurn, toTurn);

  const occ = index ?? indexOccupancy(board, fromTurn);
  const executableNow =
    fromTurn === turn + 1
      ? executableNowValue(board, unit, judgedTier, occ)
      : 0;

  let bodyHi = 0;
  let bodyEst = 0;
  let bodyAt: number | null = null;
  let bodyVictim: string | null = null;
  let bodyCell = -1;
  let headHi = 0;
  let headEst = 0;
  let headAt: number | null = null;
  let headVictim: string | null = null;

  for (const other of board.units) {
    if (other.unitId === unit.unitId) continue;
    if (other.team === unit.team) continue;
    const theirTier = tierAt(other, fromTurn);

    // ── the HEAD channel: no potion needed, and it needs the head cell only ──
    // `strictMaximum` is tier first, weight second, and a non-unique maximum
    // kills everyone — so we take a head only when we outrank it on tier or
    // tie on tier and strictly outweigh it.
    if (ownTier > theirTier || (ownTier === theirTier && unit.weight > other.weight)) {
      const headArrival = reach.earliestAt(unit.unitId, other.occupancy[0] as number);
      if (headArrival >= fromTurn && headArrival <= toTurn && other.weight > headHi) {
        // A head does not shift along: it IS the unit, and the whole weight
        // goes. The only decay is that it may not be there — which is `lo`.
        headHi = other.weight;
        headEst = other.weight;
        headAt = headArrival;
        headVictim = other.unitId;
      }
    }

    // ── the BODY channel: strictly higher tier, or nothing at all ───────────
    if (judgedTier <= theirTier) continue;
    for (let i = 1; i < other.occupancy.length; i++) {
      const cell = other.occupancy[i] as number;
      const arrival = reach.earliestAt(unit.unitId, cell);
      if (arrival < fromTurn || arrival > toTurn) continue;
      const k = arrival - turn;
      const hi = Math.max(0, other.weight - i);
      // The body slides one index per turn and the tail pops: `k` turns from
      // now this cell carries `weight − i − k` cells behind it.
      const est = Math.max(0, other.weight - i - k);
      if (est > bodyEst || (est === bodyEst && hi > bodyHi)) {
        bodyEst = est;
        bodyHi = hi;
        bodyAt = arrival;
        bodyVictim = other.unitId;
        bodyCell = cell;
      }
    }
  }

  // Is the best cut a free cut, or a contest? Cheap and symmetric: could an
  // enemy stand on that cell inside the window carrying a tier we do not beat?
  let contested = false;
  if (bodyCell >= 0) {
    for (const other of board.units) {
      if (other.team === unit.team) continue;
      if (tierAt(other, fromTurn) < judgedTier) continue;
      const a = reach.earliestAt(other.unitId, bodyCell);
      if (a >= fromTurn && a <= toTurn) {
        contested = true;
        break;
      }
    }
  }

  return {
    unitId: unit.unitId,
    team: unit.team,
    judgedTier,
    fromTurn,
    toTurn,
    body: { lo: 0, est: bodyEst, hi: bodyHi },
    bodyAt,
    bodyVictim,
    head: { lo: 0, est: headEst, hi: headHi },
    headAt,
    headVictim,
    executableNow,
    contested,
  };
}

/**
 * Every unit of one team, valued over the same window at the same tier delta.
 *
 * `total` sums the BODY channel only. Heads are excluded from the total on
 * purpose and by the same rule `sliderAttackVector` excludes kills: material
 * already folds a kill, and a head attack needs no potion, so summing it here
 * would make every potion look like a reason to do something we could do
 * anyway.
 */
export interface TeamAttackWindow {
  readonly team: number;
  readonly fromTurn: number;
  readonly toTurn: number;
  readonly total: WindowInterval;
  readonly best: AttackWindowValue | null;
  readonly per: ReadonlyArray<AttackWindowValue>;
  /** Units whose body channel is non-empty — the "converging allies" count. */
  readonly armed: number;
}

export function teamAttackWindow(
  board: RayBoard,
  team: number,
  options: AttackWindowOptions & { readonly exclude?: ReadonlySet<string> } = {},
  index?: OccupancyIndex
): TeamAttackWindow {
  const turn = options.turn ?? board.turn ?? 0;
  const fromTurn = options.fromTurn ?? turn + 1;
  const toTurn = options.toTurn ?? fromTurn + POTION_WINDOW_TURNS - 1;
  const occ = index ?? indexOccupancy(board, fromTurn);
  const per: AttackWindowValue[] = [];
  let est = 0;
  let hi = 0;
  let armed = 0;
  let best: AttackWindowValue | null = null;
  for (const u of board.units) {
    if (u.team !== team) continue;
    if (options.exclude?.has(u.unitId) === true) continue;
    const v = attackWindow(board, u, { ...options, fromTurn, toTurn, turn }, occ);
    per.push(v);
    est += v.body.est;
    hi += v.body.hi;
    if (v.body.est > 0) armed += 1;
    if (best === null || v.body.est > best.body.est) best = v;
  }
  return {
    team,
    fromTurn,
    toTurn,
    total: { lo: 0, est, hi },
    best: best !== null && best.body.est > 0 ? best : null,
    per,
    armed,
  };
}

// ---------------------------------------------------------------------------
// The candidate, as data
// ---------------------------------------------------------------------------

/**
 * A registry entry, and NOT a registered one. `../registry.ts` resolves a slate
 * by entry id and throws on a name it does not hold, so a candidate becomes
 * live by being named in a configured slate and in no other way. This value is
 * the candidate; adding it to a slate is the experiment.
 *
 * The import is `import type`, so this file gains no runtime dependency on the
 * registry and the registry gains none on the evaluator's candidates.
 */
export const ATTACK_WINDOW_ENTRY: StrategyEntry = {
  id: 'eval/attack-window@1',
  slot: 'evaluator',
  primitive: 'ray-crossing+arrival-shells',
  params: {
    windowTurns: POTION_WINDOW_TURNS,
    /** The ally's side of a pickup. The collector's own side is −1. */
    tierDelta: 1,
    /** The body channel decays by the movement rule, not by a fitted penalty. */
    decay: 'body-shift',
    /** Head attacks are reported and never summed. */
    countHeads: false,
    weight: 0,
  },
  soundness: 'advisory',
  priors: {
    fitted: false,
    strata: [
      'enemy trail-unit count',
      'our piece count',
      'potions standing on the board',
      'turns of tier remaining',
    ],
    note:
      'Bimodal by rule rather than by observation: identically zero whenever the ' +
      'judged tier beats no owner, which on a potions-off board is always. The ' +
      'conditional half is heavy — a body cut removes occupancy length, not one cell.',
  },
  cost: {
    fitted: false,
    features: ['enemy occupancy cells', 'our slider count', 'board dimension'],
    note:
      'One ray fan per slider for the exact half; one arrival lookup per enemy ' +
      'occupancy cell for the reach half. Reach itself is borrowed from the shells ' +
      'the territory reading already builds and is never rebuilt here.',
  },
  record: {
    status: 'candidate',
    ledgerRows: [],
    note:
      'Design evidence only, from tools/retrodiction/potion-terms-retrodiction.js on ' +
      'the committed batch-1 replays. Nothing has been played with this term in a slate.',
  },
};
