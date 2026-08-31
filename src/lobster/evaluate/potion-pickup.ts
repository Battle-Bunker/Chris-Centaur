/**
 * `potionPickup` — THE PICKUP THIS PLAN ACTUALLY MAKES.
 *
 * ── WHY A FIFTH TERM, WHEN `potion-seek` ALREADY PRICES A PICKUP ───────────
 *
 * `potion-seek` prices the BEST pickup available on the board. That is the
 * right question to ask about a position and the wrong quantity to hand a
 * comparator, because the answer barely moves when one of our units moves one
 * square: the same collector reaches the same potion a turn earlier or later,
 * the same allies converge, and two plans that differ in whether we take the
 * potion AT ALL can carry the same reading. Measured on the parent branch's own
 * telemetry: over 271 games the potion lineup engaged on 31.8% of evaluations
 * and `est` decided 1.2% of comparisons, while 20% fell all the way through to
 * a salted tie key — the signature of a term whose value is equal on both sides
 * of the comparison it was meant to settle.
 *
 * This term asks the other question, and it is the one a decision is actually
 * about: DOES THIS PLAN TAKE A POTION. It is exactly zero on every plan that
 * does not and non-zero on every plan that does, so it cannot be equal across
 * the pair it exists to separate.
 *
 * ── HOW IT KNOWS, WITHOUT BEING TOLD THE PLAN ─────────────────────────────
 *
 * An evaluator term is handed a RESOLVED position and not a plan. It does not
 * need one. Collection is a head arrival (`TeamSnekProcessor.ts:577-633`), and
 * the partial engine deliberately does not simulate collection — tier is an
 * input to a resolution and never an output (`partial-engine/engine.ts`
 * `resolve`, where `U_TIER` is read and never written). So on the resolved
 * board the potion is STILL STANDING and our head is STANDING ON IT, and the
 * intersection of "our heads" with "the potion board" is precisely the set of
 * pickups this plan makes. Nothing is inferred and nothing is guessed.
 *
 * That the engine does not model collection is what makes this readable, and it
 * is also the reason the term has to exist: because tier never moves in a
 * simulation, no amount of DEPTH can discover a potion's value either. The deep
 * channel prices `max_a min_b` over material bounds, and a line that walks a
 * head onto a potion cell reaches a board where every tier is what it was. A
 * potion's whole value is invisible to the search unless a term states it.
 *
 * ── WHAT IT IS WORTH, AND IN WHICH DIRECTION ──────────────────────────────
 *
 * The engine's own asymmetry, priced with the modules that already exist:
 *
 *   GAIN — every LIVING TEAMMATE goes to +1 for three turns, and tier ranks
 *   strictly before weight, so their body channel opens. That is
 *   `teamAttackWindow` at `tierDelta: +1` with the collector excluded, over the
 *   window the collection actually bought: it began THIS turn, so the window is
 *   `[turn, turn + 2]` on the resolved board's own clock and not the
 *   `[turn + 1, turn + 3]` a prospective pickup would get. A term that reused
 *   the prospective window here would price a window one turn later than the
 *   one the plan bought and would keep counting it a turn after it closed.
 *
 *   COST — the collector goes to −1 and loses every contest it enters, so its
 *   whole weight is on the table wherever an enemy can stand where it is
 *   standing. Dodge-discounted at the near endpoint, exactly as `potion-seek`
 *   discounts its own, because the collector has a move too (owner ruling 23).
 *
 *   AND THE COUPLING — if the collector dies vulnerable the window is cancelled
 *   with it (`scheduleVulnerableCollisionBuffExpiry`). So the gain is charged
 *   by the same contest that charges the weight, which is why exposure is
 *   returned as a pair and folded by the caller rather than summed here.
 *
 * ── WHAT IT DOES NOT COUNT ────────────────────────────────────────────────
 *
 * HEADS, for `potion-seek`'s reason: a head attack our weight already wins is
 * not a reason to drink, and `material` has it. TRAVEL: there is none — the
 * pickup is made. DENIAL: `potion-control`'s question. THE COLLECTOR'S OWN
 * ATTACK: it is at −1 and is excluded from the gain by construction.
 */

import { indexOccupancy, tierAt } from './ray-crossing';
import type { OccupancyIndex, RayBoard, RayUnit } from './ray-crossing';
import { NO_REACH, POTION_WINDOW_TURNS, UNREACHABLE, teamAttackWindow } from './attack-window';
import type { ArrivalReach, TeamAttackWindow, WindowInterval } from './attack-window';
import { NO_DISCOUNT, dodgeDiscount } from './dodge-discount';
import type { DodgeDiscountOptions, DodgeInterval } from './dodge-discount';
import type { StrategyEntry } from '../registry';

export interface PickupValue {
  readonly collectorId: string;
  readonly team: number;
  readonly potionCell: number;
  /** The window this pickup bought, absolute and inclusive. */
  readonly windowFrom: number;
  readonly windowTo: number;
  /** Enemy body weight the buffed teammates can sever inside it. */
  readonly gain: WindowInterval;
  readonly armedAllies: number;
  readonly bestAllyId: string | null;
  /** The collector's whole weight when an enemy can stand where it stands. */
  readonly weightAtRisk: number;
  /** The same, discounted by the collector's own escape fan. */
  readonly weightAtRiskNear: number;
  readonly nearDiscount: DodgeInterval;
  /** The gain the vulnerable-collision expiry cancels if the collector dies. */
  readonly windowAtRisk: number;
  readonly contested: boolean;
}

export interface PotionPickupValue {
  readonly turn: number;
  /** Every pickup this plan makes. Usually none; occasionally two. */
  readonly pickups: ReadonlyArray<PickupValue>;
  /** The best of them by net, or null. */
  readonly best: PickupValue | null;
}

export interface PotionPickupOptions {
  readonly turn?: number;
  readonly reach?: ArrivalReach | null;
  readonly windowTurns?: number;
  /** Supplied, the near exposure is dodge-discounted; absent, it is the whole
   *  weight, which is the worst case the module ships. */
  readonly dodge?: DodgeDiscountOptions | null;
}

const EMPTY: PotionPickupValue = { turn: 0, pickups: [], best: null };

/**
 * WHICH OF OUR HEADS ARE STANDING ON A POTION — the whole gate, and it is one
 * set membership per unit of ours.
 */
export function pickupsInPlan(
  board: RayBoard,
  asTeam: number,
  potionCells: ReadonlyArray<number>
): ReadonlyArray<{ readonly unit: RayUnit; readonly cell: number }> {
  if (potionCells.length === 0) return [];
  const cells = new Set(potionCells);
  const out: Array<{ unit: RayUnit; cell: number }> = [];
  for (const u of board.units) {
    if (u.team !== asTeam) continue;
    const head = u.occupancy[0];
    if (head === undefined) continue;
    if (cells.has(head)) out.push({ unit: u, cell: head });
  }
  return out;
}

/**
 * Price the pickups a resolved position contains.
 *
 * COST CLASS: zero on every plan that takes no potion — one set membership per
 * unit and no board is built. One `teamAttackWindow` per pickup made, which is
 * at most one on almost every plan the search ever prices.
 */
export function potionPickup(
  board: RayBoard,
  asTeam: number,
  potionCells: ReadonlyArray<number>,
  options: PotionPickupOptions = {},
  index?: OccupancyIndex
): PotionPickupValue {
  const turn = options.turn ?? board.turn ?? 0;
  const windowTurns = options.windowTurns ?? POTION_WINDOW_TURNS;
  const reach = options.reach ?? NO_REACH;
  const taken = pickupsInPlan(board, asTeam, potionCells);
  if (taken.length === 0) return { ...EMPTY, turn };

  // THE WINDOW BEGINS NOW. The collection happened on the turn that produced
  // this board, and the effect is applied at commit, after the collision phase
  // — so the first contest it governs is the one resolved on this board's own
  // turn. Off by one here is a term that prices a window a turn late and keeps
  // counting it a turn after it has closed.
  const windowFrom = turn;
  const windowTo = turn + windowTurns - 1;
  const occ = index ?? indexOccupancy(board, windowFrom);

  const pickups: PickupValue[] = [];
  let best: PickupValue | null = null;
  for (const { unit, cell } of taken) {
    const allies: TeamAttackWindow = teamAttackWindow(
      board,
      asTeam,
      {
        turn,
        fromTurn: windowFrom,
        toTurn: windowTo,
        // The ALLY side of the pickup. Every teammate is one tier up for the
        // window, which is the only reason a body channel opens at all.
        tierDelta: 1,
        reach,
        exclude: new Set([unit.unitId]),
      },
      occ
    );

    // The collector's square is where it is standing — the potion cell — and at
    // −1 "exposed" is exactly "an enemy can be there".
    let contested = false;
    for (const other of board.units) {
      if (other.team === asTeam) continue;
      if (tierAt(other, windowFrom) < 0) continue; // a collector of theirs is no threat
      const a = reach.earliestAt(other.unitId, cell);
      if (a < UNREACHABLE && a >= windowFrom && a <= windowTo) {
        contested = true;
        break;
      }
    }

    let nearDiscount = NO_DISCOUNT;
    if (contested && options.dodge != null) {
      nearDiscount = dodgeDiscount(
        board,
        unit,
        { ...options.dodge, turn: windowFrom, origin: cell, reach },
        occ
      ).discount;
    }

    const value: PickupValue = {
      collectorId: unit.unitId,
      team: asTeam,
      potionCell: cell,
      windowFrom,
      windowTo,
      gain: allies.total,
      armedAllies: allies.armed,
      bestAllyId: allies.best === null ? null : allies.best.unitId,
      weightAtRisk: contested ? unit.weight : 0,
      weightAtRiskNear: contested ? unit.weight * nearDiscount.mean : 0,
      nearDiscount,
      windowAtRisk: contested ? allies.total.est : 0,
      contested,
    };
    pickups.push(value);
    if (best === null || value.gain.est > best.gain.est) best = value;
  }
  return { turn, pickups, best };
}

/** Which endpoint of the collector's exposure a fold charges. */
export type PickupExposure = 'window' | 'near' | 'none';

/**
 * THE FOLD, in our-weight units, signed so that more is better.
 *
 * `exchangeRate` folds their weight into ours. The collector's exposure is
 * charged once and the cancelled window once — the two are the same event and
 * the module returns them separately so a caller can price the worst case
 * without arithmetic on the gain.
 */
export function potionPickupNet(
  value: PotionPickupValue,
  exchangeRate: number,
  exposure: PickupExposure = 'near'
): number {
  if (!Number.isFinite(exchangeRate)) return 0;
  let net = 0;
  for (const p of value.pickups) {
    const risk =
      exposure === 'none' ? 0 : exposure === 'near' ? p.weightAtRiskNear : p.weightAtRisk;
    // The window at risk is scaled by the same discount the weight is: they are
    // one event, and charging the whole window against a contest we already
    // decided is one-in-n likely would put the pessimism back in through a
    // second door.
    const share = p.weightAtRisk === 0 ? 0 : risk / p.weightAtRisk;
    net += exchangeRate * (p.gain.est - share * p.windowAtRisk) - risk;
  }
  return net;
}

export const POTION_PICKUP_ENTRY: StrategyEntry = {
  id: 'eval/potion-pickup@1',
  slot: 'evaluator',
  primitive: 'attack-window+arrival-shells',
  soundness: 'advisory',
  params: {
    windowTurns: POTION_WINDOW_TURNS,
    /** THE PICKUP THIS PLAN MAKES, read off the resolved board's own heads. */
    subject: 'realised-pickup',
    window: 'begins on the resolved turn, not the turn after',
    countHeads: false,
    countDenial: false,
    exposure: 'near, dodge-discounted when eval/dodge-discount@2 is seated',
    weight: 0,
  },
  priors: {
    fitted: false,
    strata: ['potions standing', 'a plan that takes one'],
    note:
      'Exactly zero on every plan that takes no potion, which is almost all of them. ' +
      'The zero half is provable rather than observed — one set membership per unit — ' +
      'and that is what makes the term free on the boards it says nothing about.',
  },
  cost: {
    fitted: false,
    features: ['our unit count', 'pickups in the plan'],
    note:
      'One set membership per unit of ours; one team attack window per pickup made. ' +
      'Reach is borrowed from the arrival shells, never rebuilt.',
  },
  record: {
    status: 'candidate',
    ledgerRows: [],
    note:
      'The plan-discriminating half of the potion doctrine. Its reason for existing is ' +
      'a measurement: the board-best reading engaged on 31.8% of evaluations and ' +
      'decided 1.2% of comparisons, because it was equal on both sides of the ' +
      'comparison it was meant to settle.',
  },
};
