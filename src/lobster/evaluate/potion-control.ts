/**
 * `potionControl` — WHOSE GROUND THE UNCOLLECTED POTIONS ARE STANDING ON.
 *
 * ── WHY AN UNCOLLECTED POTION IS WORTH SOMETHING ───────────────────────────
 *
 * Uncollected potions are CARRIED FORWARD every turn and are removed only by
 * collection (`TeamSnekProcessor.ts:514, 630`). Food is eaten; potions
 * accumulate. At the live spawn rate of 0.15 per turn against a food rate of
 * 0.5, the standing stock of potions on a late-game board exceeds the standing
 * stock of food, and every one of them is a three-turn tier window waiting for
 * whoever arrives first.
 *
 * That makes a potion nobody has taken a POSITION, not an item. The owner's
 * framing, and it is the right one:
 *
 *   - a potion inside our reach is an OPTION — we may collect it on the turn
 *     the window is worth something (`./potion-seek.ts` says which turn that
 *     is), and until then it costs us nothing to leave standing;
 *   - a potion inside theirs is a THREAT — three turns in which their weight
 *     stops protecting us, on a schedule they choose.
 *
 * The asymmetry matters: leaving a potion we control uncollected is FREE and
 * leaving one they control uncollected is not, because collection is an
 * arrival and arrivals are contested by who gets there first.
 *
 * ── HOW CONTROL IS DECIDED: THE ARRIVAL MAP, BORROWED ──────────────────────
 *
 * A potion is ours when one of our units arrives STRICTLY BEFORE any enemy
 * unit — the same rule `./territory.ts` uses to divide the board, for the same
 * reason: a tie owns nothing, because nobody got there first. The arrival map
 * is the territory machinery's own (`./shells.ts` stamps `earliest[c]` off the
 * engine's dilation shells), read here through the one-method `ArrivalReach`
 * view. Nothing in this file computes reach.
 *
 * The map is a sound OVER-APPROXIMATION of where a unit could be, so both
 * sides' arrivals are optimistic in the same direction and the COMPARISON
 * between them is the robust quantity. That is why the headline this module
 * publishes is a margin and a balance rather than an absolute count of turns.
 *
 * ── THE PRICE, IN WEIGHT ───────────────────────────────────────────────────
 *
 * A controlled potion is worth what the window it opens would be worth — the
 * ally attack window `./potion-seek.ts` prices, evaluated for the unit that
 * would actually reach it first. A potion they control is worth the same
 * computation run in their frame, entered NEGATIVE. There is no separate
 * currency and no fitted conversion: both sides are enemy-body weight.
 *
 * One honest caveat, stated rather than buried. Their window counts weight
 * they could remove from ANY team that is not theirs, third parties included.
 * Under the share metric that still costs us — their share rises when anyone
 * else's weight leaves the board — but it is not damage to us, and a caller
 * that wants only the damage-to-us half should read `theirsAgainstUs`.
 *
 * ── WHAT THIS TERM IS NOT ──────────────────────────────────────────────────
 *
 * It is not a collection decision. It says whose ground the potions are on and
 * what that is worth; `potionSeek` says when to spend the option. Summing the
 * two would count one potion twice, so a caller folds one or the other per
 * potion — control for the ones we are not collecting this turn, seek for the
 * one we are.
 *
 * ── DARK BY CONSTRUCTION ───────────────────────────────────────────────────
 *
 * Nothing on the production path imports this module. `POTION_CONTROL_ENTRY`
 * is the candidate as a registry value and is in no slate.
 */

import { indexOccupancy } from './ray-crossing';
import type { OccupancyIndex, RayBoard } from './ray-crossing';
import {
  NO_REACH,
  POTION_WINDOW_TURNS,
  UNREACHABLE,
  teamAttackWindow,
} from './attack-window';
import type { ArrivalReach, WindowInterval } from './attack-window';
import type { StrategyEntry } from '../registry';

export type PotionOwner = 'ours' | 'theirs' | 'contested' | 'nobody';

export interface PotionControl {
  readonly cell: number;
  /** Absolute turn our earliest unit could arrive, or `Infinity`. */
  readonly ourArrival: number;
  readonly ourFirstId: string | null;
  /** The same for the earliest enemy of any team. */
  readonly theirArrival: number;
  readonly theirFirstId: string | null;
  readonly theirTeam: number | null;
  /**
   * `theirArrival − ourArrival`. Positive is ours by that many turns. The
   * robust quantity: both arrivals are optimistic in the same direction, so
   * their difference survives the over-approximation their levels do not.
   */
  readonly margin: number;
  readonly owner: PotionOwner;
  /**
   * OPTION VALUE, in weight units: what the window would be worth to us if the
   * unit that gets there first collected it. Zero unless we control the potion
   * — an option on ground we do not hold is not an option.
   */
  readonly option: WindowInterval;
  /**
   * THREAT VALUE, in weight units: the same computation in the controlling
   * enemy team's frame. Zero unless they control it.
   */
  readonly threat: WindowInterval;
  /** The half of `threat` aimed at OUR bodies rather than at third parties. */
  readonly threatAgainstUs: number;
}

export interface PotionControlOptions {
  readonly turn?: number;
  readonly reach?: ArrivalReach | null;
  readonly windowTurns?: number;
  /**
   * How far ahead an arrival still counts as control. Past this the reach map
   * is describing a board that will not exist, and the term declines to divide
   * ground nobody will walk — the same narrowing `./territory.ts` makes when
   * it counts an unreached cell for nobody.
   */
  readonly horizonTurns?: number;
}

const ZERO: WindowInterval = { lo: 0, est: 0, hi: 0 };

/**
 * Value one uncollected potion.
 *
 * COST CLASS: per-turn. Two reach scans over the unit list to find the two
 * argmins, then AT MOST ONE team attack-window — for the controlling side
 * only, because the other side's option is worth nothing to price. A potion
 * nobody reaches inside the horizon costs the two scans and stops.
 */
export function potionControl(
  board: RayBoard,
  ourTeam: number,
  cell: number,
  options: PotionControlOptions = {},
  index?: OccupancyIndex
): PotionControl {
  const turn = options.turn ?? board.turn ?? 0;
  const windowTurns = options.windowTurns ?? POTION_WINDOW_TURNS;
  const horizon = turn + (options.horizonTurns ?? POTION_WINDOW_TURNS);
  const reach = options.reach ?? NO_REACH;

  let ourArrival = Number.POSITIVE_INFINITY;
  let ourFirstId: string | null = null;
  let theirArrival = Number.POSITIVE_INFINITY;
  let theirFirstId: string | null = null;
  let theirTeam: number | null = null;

  for (const u of board.units) {
    const a = reach.earliestAt(u.unitId, cell);
    if (a >= UNREACHABLE || a > horizon) continue;
    // Collection is a head ARRIVAL, so a unit already there collects no sooner
    // than next turn.
    const at = Math.max(a, turn + 1);
    if (u.team === ourTeam) {
      if (at < ourArrival) {
        ourArrival = at;
        ourFirstId = u.unitId;
      }
    } else if (at < theirArrival) {
      theirArrival = at;
      theirFirstId = u.unitId;
      theirTeam = u.team;
    }
  }

  const margin = theirArrival - ourArrival;
  let owner: PotionOwner = 'nobody';
  if (Number.isFinite(ourArrival) && ourArrival < theirArrival) owner = 'ours';
  else if (Number.isFinite(theirArrival) && theirArrival < ourArrival) owner = 'theirs';
  else if (Number.isFinite(ourArrival)) owner = 'contested';

  const base: PotionControl = {
    cell,
    ourArrival,
    ourFirstId,
    theirArrival,
    theirFirstId,
    theirTeam,
    margin,
    owner,
    option: ZERO,
    threat: ZERO,
    threatAgainstUs: 0,
  };
  if (owner === 'nobody' || owner === 'contested') return base;

  const holder = owner === 'ours' ? ourTeam : (theirTeam as number);
  const collectorId = (owner === 'ours' ? ourFirstId : theirFirstId) as string;
  const collectAt = owner === 'ours' ? ourArrival : theirArrival;
  const occ = index ?? indexOccupancy(board, collectAt + 1);
  const window = teamAttackWindow(
    board,
    holder,
    {
      turn,
      fromTurn: collectAt + 1,
      toTurn: collectAt + windowTurns,
      tierDelta: 1,
      reach,
      exclude: new Set([collectorId]),
    },
    occ
  );

  if (owner === 'ours') return { ...base, option: window.total };

  let againstUs = 0;
  for (const v of window.per) {
    if (v.bodyVictim === null) continue;
    const victim = board.units.find((u) => u.unitId === v.bodyVictim);
    if (victim !== undefined && victim.team === ourTeam) againstUs += v.body.est;
  }
  return { ...base, threat: window.total, threatAgainstUs: againstUs };
}

export interface PotionControlSummary {
  readonly turn: number;
  readonly team: number;
  readonly potions: ReadonlyArray<PotionControl>;
  readonly ours: number;
  readonly theirs: number;
  readonly contested: number;
  /**
   * `(ours − theirs) / (ours + theirs + contested)`, or 0 when no potion is
   * reachable by anybody. Scale-free, so it is comparable across board sizes
   * and across turns — the quantity a mid-game reading is correlated against.
   */
  readonly balance: number;
  /**
   * `Σ option − Σ threat`, in weight units. The term's headline: option value
   * we bank minus threat value they bank.
   */
  readonly net: number;
  readonly optionTotal: number;
  readonly threatTotal: number;
  readonly threatAgainstUsTotal: number;
}

/** Every uncollected potion on the board, from one team's point of view. */
export function potionControlSummary(
  board: RayBoard,
  ourTeam: number,
  potionCells: ReadonlyArray<number>,
  options: PotionControlOptions = {},
  index?: OccupancyIndex
): PotionControlSummary {
  const turn = options.turn ?? board.turn ?? 0;
  const per: PotionControl[] = [];
  let ours = 0;
  let theirs = 0;
  let contested = 0;
  let optionTotal = 0;
  let threatTotal = 0;
  let againstUs = 0;
  for (const cell of potionCells) {
    const c = potionControl(board, ourTeam, cell, options, index);
    per.push(c);
    if (c.owner === 'ours') ours += 1;
    else if (c.owner === 'theirs') theirs += 1;
    else if (c.owner === 'contested') contested += 1;
    optionTotal += c.option.est;
    threatTotal += c.threat.est;
    againstUs += c.threatAgainstUs;
  }
  const reachable = ours + theirs + contested;
  return {
    turn,
    team: ourTeam,
    potions: per,
    ours,
    theirs,
    contested,
    balance: reachable === 0 ? 0 : (ours - theirs) / reachable,
    net: optionTotal - threatTotal,
    optionTotal,
    threatTotal,
    threatAgainstUsTotal: againstUs,
  };
}

/**
 * The gate, and it is one test rather than a scan: is there an uncollected
 * potion at all? On a potions-off board — and on a potions-on board that has
 * none standing — the whole term is provably zero and no reach is read.
 */
export function anyPotionStanding(potionCells: ReadonlyArray<number>): boolean {
  return potionCells.length > 0;
}

// ---------------------------------------------------------------------------
// The candidate, as data
// ---------------------------------------------------------------------------

export const POTION_CONTROL_ENTRY: StrategyEntry = {
  id: 'eval/potion-control@1',
  slot: 'evaluator',
  primitive: 'arrival-shells+attack-window',
  params: {
    windowTurns: POTION_WINDOW_TURNS,
    horizonTurns: POTION_WINDOW_TURNS,
    /** A tie owns nothing — territory.ts's rule, for territory.ts's reason. */
    tieOwner: 'nobody',
    /** Option and threat are both enemy-body weight; no conversion. */
    currency: 'weight',
    weight: 0,
  },
  soundness: 'advisory',
  priors: {
    fitted: false,
    strata: [
      'potions standing on the board',
      'our units versus theirs',
      'enemy trail-unit count',
      'board occupancy density',
    ],
    note:
      'Zero with certainty when no potion stands. Given one, the sign is roughly ' +
      'symmetric — control is a division of the same ground — and the magnitude ' +
      'inherits the attack window’s heavy conditional tail.',
  },
  cost: {
    fitted: false,
    features: ['potion count', 'unit count', 'enemy occupancy cells'],
    note:
      'Two reach scans per potion to find the argmins, then at most one team ' +
      'attack-window for the controlling side. Reach is the territory reading’s ' +
      'own arrival shells; nothing is rebuilt.',
  },
  record: {
    status: 'candidate',
    ledgerRows: [],
    note:
      'Design evidence only, from tools/retrodiction/potion-terms-retrodiction.js on ' +
      'the committed batch-1 replays. No arm has ever been run with this term.',
  },
};
