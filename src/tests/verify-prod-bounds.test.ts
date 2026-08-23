/**
 * PRODUCTION-REGIME VERIFICATION — the bound bugs found by playing real games.
 *
 * Every case here was found by the paired-seed head-to-head harness in
 * bench/prod/ on ordinary generated boards, then reduced to the smallest board
 * that still shows it. They are recorded with `test.failing` so the suite
 * stays green while the defect stands: when the bound is fixed these turn into
 * "passed unexpectedly" failures, which is exactly the signal wanted.
 *
 * NOTHING IS FIXED HERE. This file only adds tests.
 *
 * ── WHAT THE ORACLE IS ─────────────────────────────────────────────────────
 *
 * The truth used below is not a model. `worldsOf` (src/lobster/evaluate/laws)
 * enumerates every completion of the units the decision does not command,
 * through the ENGINE's own enumerator, and each completion is scored as a
 * determinate turn by the same evaluator the search uses. The headline case is
 * also cross-checked against the VENDORED server resolver (`resolveTurn`),
 * which agrees to the point: over all 36 completions the true value of the
 * plan spans [-30, +40], while the bank's floor for it is +10.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { apiCoordToIndex } from '../firebase/translate';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { checkSoundness, materialEvaluator, worldsOf } from '../lobster/evaluate';
import { BoundBank, DEFAULT_BANK_CONFIG, B0_ONLY } from '../lobster/bounds/bank';
import { makeSearchCore } from '../lobster/search';

const TURN = 3;
const SIZE = 7;
const FULL = SIZE + 2;
const at = (x: number, y: number): number => apiCoordToIndex({ x, y }, FULL, FULL);
const cell = (x: number, y: number): Coord => ({ x, y });

function unit(id: string, team: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  const head = body[0] as Coord;
  const mid = body[1] ?? head;
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: { ...head },
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    teamID: team,
    orientation: { dx: head.x - mid.x, dy: -(head.y - mid.y) },
    ...extra,
  } as Snake;
}

/**
 * The reduced board. Blue's snake stands at (2,2) with red's snake body
 * running (2,0)-(2,1)-(3,1) in front of it; each side also has a king.
 *
 * The plan under test is: blue's king HOLDS, blue's snake steps (2,2) -> (2,1)
 * — onto a cell red's snake occupies at turn start. The vendored resolver says
 * that in the completion `red snake -> (1,0), red king -> (3,3)` blue's snake
 * DIES (occupancy does not clear mid-turn), leaving blue three material down.
 */
function board(): Board {
  return {
    width: SIZE,
    height: SIZE,
    food: [cell(5, 4)],
    hazards: [],
    snakes: [
      unit('r0', 'red', [cell(4, 2)], { unitType: 'king', length: 1, orientation: { dx: 0, dy: -1 } }),
      unit('r1', 'red', [cell(2, 0), cell(2, 1), cell(3, 1)]),
      unit('b0', 'blue', [cell(0, 6)], { unitType: 'king', length: 1, orientation: { dx: 0, dy: 1 } }),
      unit('b1', 'blue', [cell(2, 2), cell(2, 3), cell(1, 3), cell(1, 3)]),
    ],
  } as Board;
}

const ORDERS = new Map<string, number>([
  ['b0', at(0, 6)], // the king holds
  ['b1', at(2, 1)], // the snake steps onto red's body
]);

const budget = {
  shouldStop: (): boolean => false,
  remainingMs: (): number => 1e9,
  elapsedMs: (): number => 0,
  now: (): number => Date.now(),
};

function withSub<T>(b: Board, fn: (sub: ReturnType<typeof makeSubstrate>) => T): T {
  const sub = makeSubstrate({ board: b, turn: TURN, asTeam: 'blue', modeled: ['b0', 'b1'] });
  try {
    return fn(sub);
  } finally {
    sub.release();
  }
}

function planOf(sub: ReturnType<typeof makeSubstrate>, orders: ReadonlyMap<string, number>): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const [wireId, to] of orders) {
    const u = sub.unitOfWireId(wireId);
    if (u === undefined) throw new Error(`no unit ${wireId}`);
    plan.set(u.unitId, {
      unitId: u.unitId,
      from: u.cells[0] as number,
      to,
      path: sub.pathFor(u.unitId, to) ?? [],
    });
  }
  return plan;
}

/** [min, max] of the determinate value over every completion. */
function truth(b: Board, orders: ReadonlyMap<string, number>): { lo: number; hi: number; worlds: number } {
  return withSub(b, (sub) => {
    const team = sub.teamNumber('blue');
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let worlds = 0;
    for (const world of worldsOf(
      sub,
      { name: 't', board: b, turn: TURN, asTeam: 'blue', stages: [...orders.keys()], orders },
      4000
    )) {
      const v = materialEvaluator.evaluatePlan(sub, world.plan, team);
      worlds++;
      lo = Math.min(lo, v.bound.lo);
      hi = Math.max(hi, v.bound.hi);
    }
    return { lo, hi, worlds };
  });
}

afterEach(() => clearGeometryCache());

describe('the bound bank on a board a real match reaches', () => {
  test('the oracle itself is well-formed: every completion is enumerated and scored', () => {
    const t = truth(board(), ORDERS);
    expect(t.worlds).toBeGreaterThan(1);
    expect(Number.isFinite(t.lo)).toBe(true);
    // The plan really can cost blue its snake: three material, at weight 10.
    expect(t.lo).toBeLessThanOrEqual(-30);
  });

  test.failing('B0 floor is at or below the exhaustive truth (it is +10 against a truth of -30)', () => {
    const t = truth(board(), ORDERS);
    const worst = withSub(board(), (sub) => {
      const bank = new BoundBank({
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: materialEvaluator,
        asTeam: sub.teamNumber('blue'),
        budget,
        basis: [],
        config: B0_ONLY,
      });
      try {
        return bank.price(planOf(sub, ORDERS)).bounds.worst;
      } finally {
        bank.release();
      }
    });
    // A floor is a PROMISE. This one promises four material units it cannot keep.
    expect(worst).toBeLessThanOrEqual(t.lo);
  });

  test.failing('the shipped bank prices this plan without inverting its bracket', () => {
    withSub(board(), (sub) => {
      const bank = new BoundBank({
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: materialEvaluator,
        asTeam: sub.teamNumber('blue'),
        budget,
        basis: [],
        config: DEFAULT_BANK_CONFIG,
      });
      try {
        // B0's floor (+10) sits above B1's ceiling (-30), so makeScoreBounds
        // throws `bounds_inversion`.
        expect(() => bank.price(planOf(sub, ORDERS))).not.toThrow();
      } finally {
        bank.release();
      }
    });
  });

  test.failing('conform() at rung 0 does not throw on this board', () => {
    withSub(board(), (sub) => {
      const core = makeSearchCore();
      const ctx = {
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: materialEvaluator,
        asTeam: sub.teamNumber('blue'),
        pins: [],
        incumbent: null,
        witnesses: [],
        assumptions: [],
        budget,
      } as unknown as Parameters<typeof core.conform>[0];
      // Rung 0 is deliberately unguarded in the kernel, so a throw here aborts
      // the whole team decision and the team stages nothing for the turn.
      expect(() => core.conform(ctx, new Map())).not.toThrow();
    });
  });

  test.failing("the repo's own R1 harness passes on this board", () => {
    const result = checkSoundness(
      materialEvaluator,
      { name: 'match-board', board: board(), turn: TURN, asTeam: 'blue', stages: ['b0', 'b1'], orders: ORDERS },
      4000
    );
    // Violations are all of the form "R1 hi — world Infinity > hi <finite>":
    // a completion in which the opposing team is wiped scores the WIN
    // sentinel, which the partial plan's ceiling never reaches because a held
    // unit cannot be proved dead.
    expect(result.violations).toEqual([]);
  });
});
