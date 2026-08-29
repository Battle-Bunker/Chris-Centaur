/**
 * `sliderAttackVector` — THE RAY AS A WEIGHT-REMOVAL INSTRUMENT.
 *
 * A candidate valuation over a slider's own action set, built on the ordered
 * ray walk in `./ray-crossing.ts`. It is the one term in the positional
 * portfolio that needs NO fitted conversion: a trail unit's weight IS its
 * occupancy length, and a sever removes exactly the cells the engine cuts, so
 * the output is already denominated in the currency the game is scored in.
 *
 * ── DARK BY CONSTRUCTION ───────────────────────────────────────────────────
 *
 * Nothing on the production path imports this module. It is not in the feature
 * list, it has no weight in the shipped calibration, and it reads no
 * environment. It exists so that its retrodiction can be run against replays
 * we already hold, which is the first bar in the portfolio's evidence ladder
 * and the only one that costs no games.
 *
 * ── THE SHAPE: A SLOT CANDIDATE, NOT A FLAG ────────────────────────────────
 *
 * `SLIDER_ATTACK_VECTOR_ENTRY` at the foot of this file is the whole candidate
 * as DATA — identity, declared priors, cost class, empirical record, operator
 * knob. When the entry registry lands, that value moves into it verbatim and
 * this module keeps only the arithmetic. Until then it is a standalone value
 * with no consumer, which is exactly what "implemented, weight 0" means.
 *
 * ── THE TWO CHANNELS, AND WHY THEY ARE SEPARATE ────────────────────────────
 *
 * REALIZED. What staging this destination CUTS THIS TURN. The mover advances
 * one cell per sub-step and capture-stops at the first thing it meets
 * (`turnEngine.ts:316-489`), so a destination beyond an enemy body is not a
 * different move from the body cell itself — it is the same sever with a longer
 * staged square.
 *
 * WHERE THIS CHANNEL IS SOUND, AND WHERE IT IS NOT, because the distinction is
 * the whole of its honesty. Read off a RESOLVED board it is sound-writing: the
 * cut is material the resolution already shows. Read at the DECISION, off the
 * start-of-turn board — which is where a move-ordering term actually lives — it
 * is an optimistic endpoint, because the victim moves inside the same sub-step
 * loop the mover walks. `severedIfTargetMoves` is the other endpoint, and the
 * measured gap between them is not small: on the batch-1 replays the
 * start-of-turn read fires on cuts that do not land about a fifth of the time,
 * always because the target left the aimed-at cell.
 *
 * THREAT (advisory). What the rays OUT OF the landing cell could cut NEXT turn.
 * The target moves, so a static ray walk overstates, and the term admits it as
 * an interval rather than hiding it in a coefficient:
 *
 *   hi  OPTIMISTIC   nothing steps off any ray, nothing interposes.
 *   lo  PESSIMISTIC  every target steps off every ray — zero.
 *   est THE RULES' OWN ANSWER, and it is not a fitted midpoint. A trail unit's
 *       body does not manoeuvre: the head unshifts a new cell and the tail pops
 *       (`turnEngine.ts:290-305, 2392`), so a body cell at occupancy index `i`
 *       today sits at index `i + 1` tomorrow and is GONE if it was the tail.
 *       Cutting it tomorrow therefore removes `weight − i − 1` cells, and the
 *       tail contributes nothing. That is arithmetic off the movement rule, not
 *       a parameter anybody fitted.
 *
 * The interval narrows exactly when the target has nowhere to go, which is also
 * when the crossing is most valuable — the squeeze and the sever read from two
 * ends.
 *
 * ── THE VALUATION IS A PAIR, NEVER A SCALAR ────────────────────────────────
 *
 * The entry publishes `{theirsRemoved, oursLost}` and lets the caller fold them
 * through the share-metric exchange rate (`severExchangeRate`), because that
 * rate is STATE-DEPENDENT: at par in a three-team game one unit of our own
 * growth is worth two of enemy removal, and once we hold more than half the
 * board's weight removal is the better channel. A term that collapsed the two
 * inside itself would bake in a rate that is wrong everywhere except where it
 * was fitted.
 *
 * ── WHAT THE HEADLINE COUNTS, AND WHAT IT DELIBERATELY DOES NOT ────────────
 *
 * The headline is the SEVER channel only. Kills are reported (`realizedKill`)
 * and excluded from the ordering scalar, because material already folds a kill
 * and double-counting it would make this term look like a material term with
 * extra steps. The sever channel is the one that moves weight and is credited
 * by nothing.
 */

import {
  anyBodyOnBoard,
  indexOccupancy,
  rayCrossings,
  tierAt,
} from './ray-crossing';
import type { OccupancyIndex, RayBoard, RayUnit, Verdict } from './ray-crossing';
import { profileOf } from '../../partial-engine/index';

export interface RealizedOutcome {
  readonly verdict: Verdict | 'none';
  /** Enemy body cells this move cuts THIS turn, in weight units. */
  readonly severed: number;
  /**
   * The same cut, priced for a target that MOVES INSIDE THIS RESOLUTION.
   *
   * Read pre-resolution — which is where a move-ordering term lives — `severed`
   * is an optimistic endpoint, not a fact: the victim advances its head and
   * pops its tail in the same sub-step loop the mover walks
   * (`turnEngine.ts:316-320`), so the cell aimed at is one index further along
   * by the time we arrive and a tail cell is not there at all. This is the same
   * body-shift arithmetic the threat channel uses, applied one turn earlier, and
   * `[severedIfTargetMoves, severed]` is the honest interval the read supports
   * until the resolution collapses it.
   */
  readonly severedIfTargetMoves: number;
  /** Enemy weight this move kills outright. Reported, not in the headline. */
  readonly killed: number;
  /** Weight removed from units on our OWN team — friendly severs and kills. */
  readonly alliesLost: number;
  /** Our own weight, when the move walks us into a death. */
  readonly oursLost: number;
}

export interface ThreatInterval {
  /** Pessimistic: every target steps off every ray. */
  readonly lo: number;
  /** The movement rule's own answer — see the module doc. */
  readonly est: number;
  /** Optimistic: nothing moves, nothing interposes. */
  readonly hi: number;
}

export interface SliderAttackValue {
  readonly unitId: string;
  /** The staged destination, full-board index. */
  readonly dest: number;
  /** Where the mover actually stops — the capture-stop cell, or `dest`. */
  readonly landing: number;
  /** Cells entered. Health is spent one dose per cell. */
  readonly steps: number;
  /** False when health cannot pay for `steps` and leave the unit alive. */
  readonly reachable: boolean;
  readonly realized: RealizedOutcome;
  /** Enemy weight severable from `landing` on the turn after this one. */
  readonly threat: ThreatInterval;
}

export interface SliderAttackOptions {
  /**
   * The turn this board is the start of. Read for tier timing only: an effect
   * whose expiry is E still decides contests during E, so a threat resolved at
   * E + 1 is priced at tier zero.
   */
  readonly turn?: number;
  /** Judge this unit's contests at this tier instead of its own (the potion
   * window's counterfactual: "what would this unit's rays be worth at +1"). */
  readonly tier?: number;
}

/** Chebyshev distance — the number of cells a slider enters to reach `dest`. */
const rayStepsTo = (origin: number, dest: number, width: number): number => {
  const ox = origin % width;
  const oy = (origin / width) | 0;
  const dxCells = (dest % width) - ox;
  const dyCells = ((dest / width) | 0) - oy;
  return Math.max(Math.abs(dxCells), Math.abs(dyCells));
};

const NO_REALIZED: RealizedOutcome = {
  verdict: 'none',
  severed: 0,
  severedIfTargetMoves: 0,
  killed: 0,
  alliesLost: 0,
  oursLost: 0,
};

const ZERO_THREAT: ThreatInterval = { lo: 0, est: 0, hi: 0 };

/**
 * Every grammar-legal destination this slider has, as the game's own move
 * grammar offers them: each ray's squares out to the board edge, occupancy
 * NOT considered (`piece-moves.ts:legalPieceDestinations` enumerates the whole
 * line and the engine truncates by capture-stop), plus stay.
 *
 * Enumerating the full line rather than the free prefix is not a detail: the
 * replays show bots staging squares BEYOND an enemy body, and scoring only the
 * free prefix would score a different move set from the one that was played.
 */
export function sliderDestinations(
  board: RayBoard,
  unit: RayUnit
): ReadonlyArray<number> {
  const profile = profileOf(unit.kind);
  if (profile.rays.length === 0) return [];
  const origin = unit.occupancy[0] as number;
  const width = board.width;
  const height = board.height;
  const ox = origin % width;
  const oy = (origin / width) | 0;
  const out: number[] = [origin];
  for (const [dx, dy] of profile.rays) {
    for (let step = 1; ; step++) {
      const x = ox + dx * step;
      const y = oy + dy * step;
      // A piece may never stage the perimeter wall.
      if (x < 1 || y < 1 || x > width - 2 || y > height - 2) break;
      out.push(y * width + x);
    }
  }
  return out;
}

/**
 * Value one (slider, destination) pair.
 *
 * COST CLASS: per-unit-action, by construction — the whole point of the term is
 * a gradient over a slider's own destination, which the shipped space features
 * provably do not have. One ordered walk along the staged line for the realized
 * channel, plus one fan of rays from the landing cell for the threat channel:
 * low single-digit microseconds, the same class `command` occupies.
 */
export function sliderAttackVector(
  board: RayBoard,
  unit: RayUnit,
  dest: number,
  options: SliderAttackOptions = {},
  index?: OccupancyIndex
): SliderAttackValue {
  const origin = unit.occupancy[0] as number;
  const profile = profileOf(unit.kind);
  const turn = options.turn ?? board.turn ?? 0;
  const tier = options.tier ?? tierAt(unit, turn);
  const occ = index ?? indexOccupancy(board, turn);

  if (dest === origin || profile.rays.length === 0) {
    return {
      unitId: unit.unitId,
      dest,
      landing: origin,
      steps: 0,
      reachable: true,
      realized: NO_REALIZED,
      threat: threatFrom(board, unit, origin, turn, occ, options.tier),
    };
  }

  const steps = rayStepsTo(origin, dest, board.width);
  // The realized channel is the walk along the staged line only, capped at the
  // staged square: a slider that stops short of its destination stopped on
  // something, and that something is the move's outcome.
  const walks = rayCrossings(
    board,
    unit,
    { origin, maxSteps: steps, health: unit.health, tier },
    occ
  );
  const dx = Math.sign((dest % board.width) - (origin % board.width));
  const dy = Math.sign(((dest / board.width) | 0) - ((origin / board.width) | 0));
  const walk = walks.find((w) => w.dx === dx && w.dy === dy);

  let landing = dest;
  let realized = NO_REALIZED;
  let entered = steps;
  if (walk !== undefined && walk.terminal.verdict !== 'wall') {
    const t = walk.terminal;
    landing = t.cell;
    entered = t.step;
    let shifted = 0;
    if (t.verdict === 'sever') {
      for (const o of t.occupants) {
        if (o.team === unit.team) continue;
        shifted += Math.max(0, o.weight - o.occIndex - 1);
      }
    }
    realized = {
      verdict: t.verdict,
      severed: t.verdict === 'sever' ? t.enemyWeightRemoved : 0,
      severedIfTargetMoves: shifted,
      killed: t.verdict === 'kill' ? t.enemyWeightRemoved : 0,
      alliesLost: t.allyWeightRemoved,
      oursLost: t.ownWeightRisked,
    };
  }

  const affordable = Math.floor((unit.health - 1) / Math.max(1, profile.costPerCell));
  const reachable = entered <= affordable;
  // A move that kills us leaves no unit to threaten anything next turn.
  let threat = ZERO_THREAT;
  if (realized.oursLost === 0 && reachable) {
    if (realized.verdict === 'none') {
      // Nothing was cut or killed, so the board the threat reads is the board
      // we already indexed — our own mover is filtered out of its own rays.
      threat = threatFrom(board, unit, landing, turn, occ, options.tier);
    } else {
      // The threat must read the board this move LEAVES: a body we just cut is
      // shorter, and a unit we just took is gone. Reading the pre-move board
      // would re-sell the cells the move already collected.
      const after = boardAfter(board, unit, landing, walk?.terminal.occupants ?? [], realized.verdict);
      threat = threatFrom(
        after,
        unit,
        landing,
        turn,
        indexOccupancy(after, turn + 1),
        options.tier
      );
    }
  }

  return {
    unitId: unit.unitId,
    dest,
    landing,
    steps: entered,
    reachable,
    realized,
    threat,
  };
}

/**
 * The board this move leaves behind: our mover standing on its landing cell, a
 * severed owner truncated at the cut, a killed head-class unit removed. Only
 * the units the crossing actually touched change, so this is a shallow rebuild
 * and not a simulation — nothing here re-runs the rules.
 */
function boardAfter(
  board: RayBoard,
  unit: RayUnit,
  landing: number,
  occupants: ReadonlyArray<{ unitId: string; occIndex: number }>,
  verdict: Verdict | 'none'
): RayBoard {
  const cuts = new Map<string, number>();
  const gone = new Set<string>();
  for (const o of occupants) {
    if (verdict === 'sever') cuts.set(o.unitId, o.occIndex);
    else if (verdict === 'kill') gone.add(o.unitId);
  }
  const units: RayUnit[] = [];
  for (const u of board.units) {
    if (u.unitId === unit.unitId) {
      units.push({ ...u, occupancy: [landing] });
      continue;
    }
    if (gone.has(u.unitId)) continue;
    const cut = cuts.get(u.unitId);
    if (cut === undefined) {
      units.push(u);
      continue;
    }
    if (cut <= 0) continue;
    units.push({ ...u, occupancy: u.occupancy.slice(0, cut), weight: cut });
  }
  return { width: board.width, height: board.height, units, turn: board.turn };
}

/**
 * The advisory half: what the rays out of `from` could cut on turn `turn + 1`.
 *
 * The board is read as it stands, with our own mover treated as absent from its
 * origin — a static read, which is the honest thing a one-turn-ahead term can
 * say and precisely what the `lo`/`hi` interval is admitting.
 */
function threatFrom(
  board: RayBoard,
  unit: RayUnit,
  from: number,
  turn: number,
  index: OccupancyIndex,
  tierOverride?: number
): ThreatInterval {
  if (!anyBodyOnBoard(board)) return ZERO_THREAT;
  const arrival = turn + 1;
  const tier = tierOverride ?? tierAt(unit, arrival);
  const walks = rayCrossings(board, unit, { origin: from, tier }, index);
  let hi = 0;
  let est = 0;
  for (const w of walks) {
    const t = w.terminal;
    if (t.verdict !== 'sever') continue;
    for (const o of t.occupants) {
      if (o.team === unit.team) continue;
      // Today's cut: everything from this index outward.
      hi += Math.max(0, o.weight - o.occIndex);
      // Tomorrow's: the body has shifted one place along, and the tail is gone.
      est += Math.max(0, o.weight - o.occIndex - 1);
    }
  }
  return { lo: 0, est, hi };
}

/** Value every grammar-legal destination this slider has, in enumeration order. */
export function sliderAttackOptions(
  board: RayBoard,
  unit: RayUnit,
  options: SliderAttackOptions = {},
  index?: OccupancyIndex
): ReadonlyArray<SliderAttackValue> {
  const occ = index ?? indexOccupancy(board, options.turn ?? board.turn ?? 0);
  return sliderDestinations(board, unit).map((d) =>
    sliderAttackVector(board, unit, d, options, occ)
  );
}

/**
 * THE SHARE-METRIC EXCHANGE RATE, read off the live board.
 *
 * Score is `(our share of total alive weight) × (number of teams)`, so
 *
 *     ∂S/∂w_ours  = (K/W)(1 − p)      ∂S/∂w_enemy = −(K/W)·p
 *
 * and one unit of enemy weight removed is worth `p / (1 − p)` units of our own
 * weight grown. It is a computed quantity, not a knob: at par in a three-team
 * game it is 0.5, at parity between two teams it is 1, and once we hold 70% of
 * the board it is 2.33. Returns `Infinity` when we already hold everything,
 * which no caller should reach because the game is over.
 */
export function severExchangeRate(board: RayBoard, ourTeam: number): number {
  let ours = 0;
  let total = 0;
  for (const u of board.units) {
    total += u.weight;
    if (u.team === ourTeam) ours += u.weight;
  }
  if (total === 0) return 0;
  const p = ours / total;
  return p >= 1 ? Number.POSITIVE_INFINITY : p / (1 - p);
}

/**
 * THE SOUND HALF, in units of OUR OWN WEIGHT: what this move cuts THIS turn.
 *
 * Enemy weight removed enters at the exchange rate; our own losses enter at
 * one. The kill channel is deliberately absent: material already folds it.
 */
export function orderingScore(v: SliderAttackValue, exchangeRate: number): number {
  const removed = v.realized.severed;
  const lost = v.realized.oursLost + v.realized.alliesLost;
  if (removed === 0) return lost === 0 ? 0 : -lost;
  if (!Number.isFinite(exchangeRate)) return Number.POSITIVE_INFINITY;
  return exchangeRate * removed - lost;
}

/** The advisory half, same units: what the move's landing threatens next turn. */
export function threatScore(v: SliderAttackValue, exchangeRate: number): number {
  if (v.threat.est === 0) return 0;
  if (!Number.isFinite(exchangeRate)) return Number.POSITIVE_INFINITY;
  return exchangeRate * v.threat.est;
}

/**
 * THE LADDER, and it is the architecture's own rather than a preference: the
 * sound channel adjudicates, and the advisory channel decides only what the
 * sound channel leaves tied. Summing the two would let a guess about next turn
 * outbid a cut the resolution already shows — which is exactly the failure the
 * floor-first staging rule exists to prevent, and it is a live risk here
 * because at a low exchange rate three standing threats can out-total one
 * executed cut.
 *
 * Returns > 0 when `a` outranks `b`.
 */
export function compareSliderAttack(
  a: SliderAttackValue,
  b: SliderAttackValue,
  exchangeRate: number
): number {
  const realized = orderingScore(a, exchangeRate) - orderingScore(b, exchangeRate);
  if (realized !== 0) return realized;
  return threatScore(a, exchangeRate) - threatScore(b, exchangeRate);
}

// ---------------------------------------------------------------------------
// The candidate, as data
// ---------------------------------------------------------------------------

/**
 * A slot-3 registry entry, written out in full while the registry itself is
 * still in design. The shape is `core-redesign.md` §1.1's `StrategyEntry` and
 * the field meanings are `positional-portfolio-design.md` §2's; when the
 * registry types land this value moves across unchanged and gains a row.
 *
 * It is typed structurally rather than against a registry interface ON PURPOSE:
 * a candidate that cannot be stated until its housing exists is a candidate
 * that will be stated as a flag instead, which is the paradigm the mandate
 * retires.
 */
export interface SlotCandidateEntry {
  readonly id: string;
  readonly slot: 3;
  readonly primitive: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly soundness: Readonly<Record<string, 'advisory' | 'sound-writing'>>;
  /** Why each channel is classed as it is, where the classing is not obvious. */
  readonly soundnessNote: string;
  readonly priors: {
    readonly strata: ReadonlyArray<string>;
    readonly shape: string;
    readonly fittedFrom: string | null;
  };
  readonly cost: {
    readonly class: 'per-turn' | 'per-resolution' | 'per-unit-action';
    readonly gate: string;
    readonly note: string;
  };
  readonly record: {
    readonly supports: ReadonlyArray<string>;
    readonly cautions: ReadonlyArray<string>;
    readonly unmeasured: ReadonlyArray<string>;
  };
  readonly knob: {
    readonly scopes: ReadonlyArray<'global' | 'per-unit'>;
    readonly defaultMultiplier: number;
  };
}

export const SLIDER_ATTACK_VECTOR_ENTRY: SlotCandidateEntry = {
  id: 'eval/slider-attack-vector@1',
  slot: 3,
  primitive: 'ray-crossing',
  params: {
    /** Headline counts severs only; kills stay with material. */
    countKills: false,
    /** The advisory half's point estimate follows the body-shift rule. */
    threatEstimate: 'body-shift',
    /** Weight, if this entry were ever folded. Zero is what "dark" means. */
    weight: 0,
  },
  soundness: {
    realized: 'advisory',
    threat: 'advisory',
  },
  soundnessNote:
    'The portfolio memo declared the realized half sound-writing. That holds on a ' +
    'RESOLVED board, where the cut is material the resolution shows, and not at the ' +
    'decision, where the victim moves inside the same sub-step loop the mover walks. ' +
    'Measured on the batch-1 replays the decision-time optimistic endpoint fires on ' +
    'cuts that do not land 20.5% of the time (27 of 132) while the pessimistic ' +
    'endpoint fired 73 times with none false, so the channel is registered advisory ' +
    'and its interval, not its upper endpoint, is what any consumer may read.',
  priors: {
    strata: ['enemy trail-unit count', 'board occupancy density', 'our slider count'],
    shape: 'bimodal: a point mass at zero when no ray meets a body, a heavy conditional given it does',
    fittedFrom: null,
  },
  cost: {
    class: 'per-unit-action',
    gate: 'any trail unit on the board at all (anyBodyOnBoard) — one pass, no walk',
    note: 'one ordered walk per ray, bounded by the board dimension; ~200 cell reads for a queen on 25x25',
  },
  record: {
    supports: [
      'natively denominated in weight: a severed cell IS a weight unit, no fitted conversion',
      'retrodiction on 2,592 committed batch-1 replays: given the term sees a cut at the decision it ranked that move above every non-cutting option 105 of 105 times, and outright first of a mean 50.2 options 93 of 105',
      'the pessimistic endpoint fired 73 times with 0 false positives; the delivered damage fell inside the term interval on 101 of 105 hits',
      'cost measured at 4.34 microseconds per staged-move valuation over 393,733 calls — the per-unit-action class, inside the band the shipped territory features occupy',
    ],
    cautions: [
      'the optimistic endpoint is false 20.5% of the time at the decision (27 of 132) and must not be the ordering channel',
      'the term saw only 58% of slider severs at the decision; in 76 of 76 misses the geometry was already there and a blocker moved during the resolution',
      'the threat half needs a search that sees past the resolution; horizon was 1 in every budget-ladder game measured',
    ],
    unmeasured: [
      'whether adding the term wins games — nothing has ever varied it',
      'anything at all outside the potion regime: every sever in the corpus is in a potion-enabled game, because a cut needs a strictly higher tier',
      'the threat half — no corpus decision ever acted on one',
    ],
  },
  knob: {
    scopes: ['global', 'per-unit'],
    defaultMultiplier: 0,
  },
};
