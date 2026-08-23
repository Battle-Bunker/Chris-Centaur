/**
 * EXHAUSTIVE TRUTH on small boards.
 *
 * The oracle is the repo's own R1 machinery: `worldsOf` enumerates every
 * completion of the units we do not command through the ENGINE's enumerator,
 * and each completion is scored by the same evaluator the search uses, on a
 * plan that names every unit — so nothing is held, the interval collapses, and
 * the number is a point value in exactly the units the bank speaks. Two
 * quantities come out of it:
 *
 *   truthOf(plan)      [min, max] of the determinate value over all worlds —
 *                      the interval any sound bracket MUST contain.
 *   exhaustiveMaximin  min over worlds for every joint plan we could stage,
 *                      i.e. the true maximin value of each of our options.
 *
 * `exhaustiveMaximin` is the decision-quality yardstick: a decision's REGRET
 * is the best achievable maximin minus the maximin of what it actually staged.
 * It is only computable where the two products are small; every call reports
 * whether it had to truncate, and a truncated result is not used as truth.
 */

import type { Board } from '../../src/types/battlesnake';
import type { Candidate, JointPlan, UnitId } from '../../src/lobster/contracts';
import { EngineSubstrate, makeSubstrate } from '../../src/lobster/substrate';
import { BoundEvaluator, worldsOf, type LawCase } from '../../src/lobster/evaluate';

export interface TruthInterval {
  readonly worlds: number;
  readonly truncated: boolean;
  readonly lo: number;
  readonly hi: number;
}

function caseFor(
  board: Board,
  turn: number,
  asTeam: string,
  orders: ReadonlyMap<string, number>
): LawCase {
  return {
    name: 'truth',
    board,
    turn,
    asTeam,
    stages: [...orders.keys()],
    orders,
  };
}

/** [min, max] of the determinate value over every world, in evaluator units. */
export function truthOf(
  board: Board,
  turn: number,
  asTeam: string,
  orders: ReadonlyMap<string, number>,
  evaluator: BoundEvaluator,
  cap = 4000
): TruthInterval {
  const c = caseFor(board, turn, asTeam, orders);
  const sub = makeSubstrate({
    board,
    turn,
    asTeam,
    modeled: c.stages,
  });
  try {
    const team = sub.teamNumber(asTeam);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let worlds = 0;
    let truncated = false;
    for (const world of worldsOf(sub, c, cap)) {
      truncated = truncated || world.truncated;
      const v = evaluator.evaluatePlan(sub, world.plan, team);
      worlds++;
      lo = Math.min(lo, v.bound.lo);
      hi = Math.max(hi, v.bound.hi);
    }
    return { worlds, truncated, lo, hi };
  } finally {
    sub.release();
  }
}

export interface MaximinRow {
  /** wireId -> staged full-board cell. */
  readonly orders: ReadonlyMap<string, number>;
  readonly key: string;
  /** min over worlds — the true worst case of staging this. */
  readonly maximin: number;
  readonly worlds: number;
}

export interface MaximinResult {
  readonly rows: MaximinRow[];
  readonly best: number;
  readonly truncated: boolean;
  /** Resolutions the oracle itself spent. */
  readonly cost: number;
}

const keyOf = (orders: ReadonlyMap<string, number>): string =>
  [...orders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join('|');

/**
 * The true maximin value of every joint plan we could stage. `ourIds` are the
 * wire ids this decision speaks for. Products above `planCap` / `worldCap`
 * mark the result truncated; truncated results are reported, never used as
 * truth.
 */
export function exhaustiveMaximin(
  board: Board,
  turn: number,
  asTeam: string,
  ourIds: ReadonlyArray<string>,
  evaluator: BoundEvaluator,
  planCap = 512,
  worldCap = 2048
): MaximinResult {
  const sub = makeSubstrate({ board, turn, asTeam, modeled: [...ourIds] });
  let cost = 0;
  let truncated = false;
  try {
    const team = sub.teamNumber(asTeam);
    // Our joint plans, from the engine's own enumerator.
    let ours: Array<Map<string, number>> = [new Map()];
    for (const wireId of ourIds) {
      const unit = sub.unitOfWireId(wireId);
      if (unit === undefined) continue;
      const actions = sub.actionsOf(unit.unitId);
      const next: Array<Map<string, number>> = [];
      for (const partial of ours) {
        for (const a of actions) {
          if (next.length >= planCap) {
            truncated = true;
            break;
          }
          const m = new Map(partial);
          m.set(wireId, a.to);
          next.push(m);
        }
        if (truncated) break;
      }
      ours = next;
    }

    const rows: MaximinRow[] = [];
    for (const orders of ours) {
      const c = caseFor(board, turn, asTeam, orders);
      let lo = Number.POSITIVE_INFINITY;
      let worlds = 0;
      for (const world of worldsOf(sub, c, worldCap)) {
        truncated = truncated || world.truncated;
        const v = evaluator.evaluatePlan(sub, world.plan, team);
        cost++;
        worlds++;
        lo = Math.min(lo, v.bound.lo);
      }
      rows.push({ orders, key: keyOf(orders), maximin: lo, worlds });
    }
    const best = rows.reduce((m, r) => Math.max(m, r.maximin), Number.NEGATIVE_INFINITY);
    return { rows, best, truncated, cost };
  } finally {
    sub.release();
  }
}

/** Build the plan a set of orders describes, for the evaluator or the bank. */
export function planOf(sub: EngineSubstrate, orders: ReadonlyMap<string, number>): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const [wireId, to] of orders) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) continue;
    const cand: Candidate = {
      unitId: unit.unitId,
      from: unit.cells[0] as number,
      to,
      path: sub.pathFor(unit.unitId, to) ?? [],
    };
    plan.set(unit.unitId, cand);
  }
  return plan;
}
