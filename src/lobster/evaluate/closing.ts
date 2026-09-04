/**
 * CLOSING AND ACTIVITY — the two things the rules already give us and the fold
 * does not take.
 *
 * Both features here are ADDITIVE: they are not in `FEATURES`, and no shipped
 * profile carries them. `I3_FEATURES` is the list an evaluator opts into, so a
 * baseline arm runs the identical code path at the identical cost.
 *
 * ── F6 regicideCascade — DELETED, BECAUSE THE ENGINE DOES IT ───────────────
 *
 * There used to be a second feature here. `applyRegicide` removes EVERY
 * remaining unit of a team the moment its last king dies, and the argument for
 * F6 was that a claim could not be cascaded: a maybe-regicide was priced at the
 * king's own weight, which is the LIGHTEST on the board, so a coin-flip shot at
 * ending a whole team ordered below a single meal.
 *
 * That premise died with the partial engine. `computeClaims` folds
 * `underRegicide` into `deathPossible` — "a unit that plays under regicide can
 * be taken off the board by a king it never met" — so every unit of a
 * king-bearing team comes back possibly-dead, `standingOf` reports it, and the
 * material fold credits the victim's whole surviving roster in our best reading
 * without anyone adding a correction on top. Adding one now would double-count
 * the cascade, which is what a second encoding of a rule does to you when the
 * first encoding catches up. So F6 is gone; `I3_FEATURES` is the shipped list
 * plus ONE.
 *
 * ── F7 approach — THE MOVEMENT THAT MANUFACTURES THE MEAL ──────────────────
 *
 * Measured, on the one arm where the comparison is clean: 88% of the legacy
 * path's per-unit-turn eating advantage is made BEFORE the eat, by walking at
 * food (net approach +0.141 against the joint evaluator's +0.007), and only 12%
 * by taking it once adjacent. The joint evaluator prices food direction at
 * approximately zero, and it is the one behavioural difference in that arm
 * whose paired interval clears zero.
 *
 * This is not a food term at the floor — that was tried and measured worthless,
 * for the reason `calibration.ts` gives: a floor concedes every cell an
 * optimistic enemy could beat it to, and food is exactly what both sides run
 * at. It is an ORDERING term with a sound bracket around it: how close our side
 * is to the nearest food on its OWN grammar clock, minus theirs, on the shells
 * the reach feature already built. On a slider board it is nearly flat (a queen
 * nine cells down a clear file is one turn away, same as one cell away) and the
 * work there is done by the candidate ordering instead; on a trail board it is
 * the whole of the measured difference.
 */

import type { Bound, Feature } from './bound';
import { bound, point } from './bound';
import type { CriterionProfile } from './calibration';
import { DEFAULT_WEIGHTS, TERRITORY_PROFILE } from './calibration';
import { ADMISSION, FEATURES } from './features';
import type { EvalContext } from './features';
import { BoundEvaluator } from './index';
import { perBoard } from './memo';
import type { EngineSubstrate } from '../substrate';


// ---------------------------------------------------------------------------
// F7 — approach
// ---------------------------------------------------------------------------

/**
 * The turn-start food cells, once per substrate.
 *
 * Turn-start and not post-resolution on purpose: it is a board constant for the
 * whole decision, so every candidate is scored against the same target set, and
 * a unit that ATE this turn reads as standing on food (arrival 0) rather than
 * as having lost its reason to be there. The meal itself is material's business
 * either way.
 */
const foodCache = new WeakMap<EngineSubstrate, Int32Array>();

function foodCellsOf(sub: EngineSubstrate): Int32Array {
  return perBoard(foodCache, sub, () => {
    const cells: number[] = [];
    for (let c = 0; c < sub.grid.cells; c++) if (sub.foodAt(c)) cells.push(c);
    return Int32Array.from(cells);
  });
}

/**
 * One team's worth of units, on THIS board: the largest unit count any team
 * started the turn with. A board constant, for the reason `room` divides by
 * one — a bare sum's range scales with the roster, and a divisor read off the
 * admitted set is not monotone in admission. Cached with the food list, because
 * a roster walk per evaluation at ten thousand evaluations a second is not a
 * board constant in any useful sense.
 */
const scaleCache = new WeakMap<EngineSubstrate, number>();

function unitScaleOf(sub: EngineSubstrate): number {
  return perBoard(scaleCache, sub, () => {
    const byTeam = new Map<number, number>();
    for (const u of sub.roster()) byTeam.set(u.team, (byTeam.get(u.team) ?? 0) + 1);
    return Math.max(1, ...byTeam.values());
  });
}

/** Credit for a unit that can be on food in `d` turns. Linear, saturating at
 * the horizon, so a unit already standing on one scores 1 and one that cannot
 * reach any inside the horizon scores 0. */
const closeness = (d: number, horizon: number): number =>
  d <= 0 ? 1 : d >= horizon ? 0 : (horizon - d) / horizon;

function approachSum(ctx: EvalContext, reading: 'lo' | 'hi'): number {
  const food = foodCellsOf(ctx.sub);
  if (food.length === 0) return 0;
  const admit = ADMISSION[reading];
  // `ctx.shells()` and not `ctx.arrivals()`: the latter builds a fresh Map per
  // evaluation to hold grids the shells already own and memoise.
  const shells = ctx.shells();
  const turn = ctx.sub.arrivalTurn;
  const horizon = ctx.horizonTurns;
  let total = 0;
  for (const s of ctx.standing) {
    const mine = s.team === ctx.asTeam;
    if (!(mine ? admit.ours(s) : admit.theirs(s))) continue;
    const sh = shells.get(s.unitId);
    if (sh === undefined) continue;
    const grid = sh.earliest();
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < food.length; i++) {
      const at = grid[food[i] as number] as number;
      // NEVER is a large sentinel, so the comparison needs no special case:
      // anything beyond the horizon scores zero anyway.
      const d = at - turn;
      if (d < best) best = d;
    }
    const g = Number.isFinite(best) ? closeness(best, horizon) : 0;
    total += mine ? g : -g;
  }
  return total;
}

/**
 * How close our side is to the nearest food, minus theirs, on each unit's own
 * grammar clock.
 *
 * The two readings differ in WHO is admitted, and it is `reach`'s admission
 * exactly: a held unit's arrival is a LOWER bound, so it is optimistic about
 * that unit — right for an enemy in our worst reading and for ourselves in our
 * best, and wrong the other way round, where the unit is simply not admitted.
 * With nothing held the two readings admit the same units at the same arrivals
 * and the feature collapses to a point.
 */
export const approachFeature: Feature<EvalContext> = {
  key: 'approach',
  defaultWeight: 0,
  contract: {
    reads: [
      { input: 'held-arrival', monotone: 'up' },
      { input: 'contingent-survival', monotone: 'down' },
    ],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx): Bound {
    if (ctx.horizonTurns <= 0) return point(0);
    const scale = unitScaleOf(ctx.sub);
    const lo = approachSum(ctx, 'lo') / scale;
    const hi = approachSum(ctx, 'hi') / scale;
    const a = Math.min(lo, hi);
    const b = Math.max(lo, hi);
    return bound(a, (a + b) / 2, b);
  },
};

// ---------------------------------------------------------------------------
// The opt-in list and the profiles that carry it
// ---------------------------------------------------------------------------

/** The shipped features plus this file's one. Order is load-bearing for
 * reproducibility, so the addition goes on the end. */
export const I3_FEATURES: ReadonlyArray<Feature<EvalContext>> = [
  ...FEATURES,
  approachFeature,
];

export const I3_WEIGHTS: Readonly<Record<string, number>> = {
  ...DEFAULT_WEIGHTS,
  /**
   * ONE, like `reach`, and for the same reason: the cliff inequality wants
   * `w × range < 10 × lightest weight`, the range here is bounded by 2 by
   * construction (each side sums saturating terms over one team's worth of
   * units and divides by that count), and 1 × 2 sits an order of magnitude
   * inside a king's 10.
   */
  approach: 1,
};

export const I3_TERRITORY_PROFILE: CriterionProfile = {
  // Every knob the shipped profile carries, so the arm differs from production
  // in the CLOSING terms and in nothing else — otherwise `command` reads zero
  // here and non-zero there, and the delta this arm is measuring is polluted by
  // a term that has nothing to do with it.
  ...TERRITORY_PROFILE,
  name: 'i3-territory',
  weights: I3_WEIGHTS,
};

/**
 * The material profile and nothing else — the guard-free arm. `approach` is
 * dark here because the material profile runs no flood at all (horizon 0),
 * which is the honest reading of "guard-free": it needs no territory
 * machinery.
 */
export const I3_MATERIAL_PROFILE: CriterionProfile = {
  name: 'i3-material',
  weights: {
    material: 10,
    reach: 0,
    room: 0,
    energyEconomy: 0,
    kingMargin: 0,
    command: 0,
    food: 0,
    momentum: 0,
    contest: 0,
    tier: 0,
    energy: 0,
    approach: 0,
  },
  reachHorizonTurns: 0,
};

export const i3TerritoryEvaluator = new BoundEvaluator(I3_TERRITORY_PROFILE, I3_FEATURES);
export const i3MaterialEvaluator = new BoundEvaluator(I3_MATERIAL_PROFILE, I3_FEATURES);
