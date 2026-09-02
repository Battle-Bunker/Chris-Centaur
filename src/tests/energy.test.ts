/**
 * THE ENERGY MEMBER'S OWN GATES.
 *
 * Five behavioural claims and the two construction claims the design rests on
 * (`docs/design/energy.md`). Every one of them is scored through the SHIPPED
 * evaluator — one joint plan in, one bound out — because the claim is about
 * what the bot chooses and not about what an isolated feature returns.
 *
 * The board is 9x9 throughout: the perimeter is wall, so the interior a piece
 * may enter is (1,1)–(7,7), and the diameter the term normalises by is
 * `width + height` = 18, exactly as `food.ts` reads it.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { marshalBoard } from '../logic/turn-oracle';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import type { EngineSubstrate } from '../lobster/substrate';
import {
  BoundEvaluator,
  CLIFF_MATERIAL_WEIGHT,
  DEFAULT_PROFILE,
  DEFAULT_WEIGHTS,
  FEATURES,
  IDLE_COST,
  energyFeature,
  makeContext,
  momentumFeature,
} from '../lobster/evaluate';
import type { EvalContext } from '../lobster/evaluate';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';

const TURN = 12;

function snake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const piece = (
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake =>
  snake(id, Array.from({ length: weight }, () => at), {
    unitType,
    length: weight,
    ...extra,
  });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

const cell = (board: Board, c: Coord): number => marshalBoard(board, TURN).toIndex(c);

function planOf(
  sub: EngineSubstrate,
  orders: ReadonlyArray<readonly [string, number]>
): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const [wireId, to] of orders) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error(`no unit ${wireId}`);
    plan.set(unit.unitId, {
      unitId: unit.unitId,
      from: unit.cells[0] as number,
      to,
      path: sub.pathFor(unit.unitId, to) ?? [],
    } as Candidate);
  }
  return plan;
}

/** The whole shipped fold, as the search reads it among floor ties. */
const scoreOf = (sub: EngineSubstrate, plan: JointPlan, asTeam: number): number =>
  new BoundEvaluator().evaluatePlan(sub, plan, asTeam).bound.est;

/** The same fold with this member taken out — the bot as it was. */
const withoutEnergy = (): BoundEvaluator => {
  const weights = { ...DEFAULT_WEIGHTS } as Record<string, number>;
  delete weights.energy;
  return new BoundEvaluator(
    { ...DEFAULT_PROFILE, name: 'no-energy', weights },
    FEATURES.filter((f) => f.key !== 'energy')
  );
};

/** The energy term alone, unweighted. */
function energyOf(sub: EngineSubstrate, plan: JointPlan, asTeam: number): number {
  return sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
    const ctx: EvalContext = makeContext(
      sub,
      resolution,
      bounds,
      asTeam,
      DEFAULT_PROFILE.reachHorizonTurns,
      DEFAULT_PROFILE
    );
    const b = energyFeature.evaluate(ctx);
    expect(b.lo).toBeLessThanOrEqual(b.hi);
    expect(b.hi).toBeLessThanOrEqual(0);
    expect(b.lo).toBeGreaterThanOrEqual(-1);
    return b.est;
  });
}

afterEach(() => clearGeometryCache());

// ---------------------------------------------------------------------------
// The four behavioural claims
// ---------------------------------------------------------------------------

describe('a piece prices what its move costs it', () => {
  /**
   * THE OWNER'S CASE, and the honest shape of the answer.
   *
   * A queen at 44 health with no meal anywhere and nothing to take. Under the
   * rules a slide costs one health per cell of its ray, and nothing else in
   * the fold notices: without this member the argmax is the THREE-cell slide,
   * because `command` pays for the ground the centre commands and the health
   * is free. With it, the argmax is the ONE-cell move — the same direction, a
   * third of the price — and every slide of three cells or more now scores
   * below simply holding.
   *
   * What this member does is make travel cost what the rules charge for it. It
   * does not make a piece a statue: a one-cell move still beats the hold,
   * because `momentum` charges the hold half a reversal and no weight this
   * term can carry inside the cliff inequality outbids that for a single cell.
   * That deductible is quantified in `docs/design/energy.md`; it is also the
   * floor the "pieces act" gate measures.
   */
  test('with no food and no target in reach, the long slide loses to the hold', () => {
    const board = boardOf([
      piece('Q', { x: 1, y: 4 }, 'queen', 3, { teamID: 'red', health: 44 }),
      snake('E', [{ x: 7, y: 1 }, { x: 7, y: 0 }], { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['Q'] });
    try {
      const asTeam = sub.teamNumber('red');
      const at = (x: number, y: number): JointPlan =>
        planOf(sub, [['Q', cell(board, { x, y })]]);
      const hold = scoreOf(sub, at(1, 4), asTeam);
      const one = scoreOf(sub, at(2, 4), asTeam);
      const three = scoreOf(sub, at(4, 4), asTeam);
      const six = scoreOf(sub, at(7, 4), asTeam);
      // Holding beats crossing the board — the option that spends six.
      expect(hold).toBeGreaterThan(six);
      // The three-cell slide is the one the fold without this member preferred
      // to everything, and it is now beaten by the one-cell move.
      expect(one).toBeGreaterThan(three);
      // And the piece still acts: one cell is cheap, and cheap is not free.
      expect(one).toBeGreaterThan(hold);
      // The energy price is the whole of the difference: the hold spends
      // nothing, and each cell of ray is charged.
      expect(energyOf(sub, at(1, 4), asTeam)).toBe(0);
      expect(energyOf(sub, at(4, 4), asTeam)).toBeCloseTo(
        3 * (energyOf(sub, at(2, 4), asTeam) as number),
        6
      );
    } finally {
      sub.release();
    }
  });

  /** The same position, priced by the fold this member was added to: it used
   * to prefer the three-cell slide, and the member is the whole difference. */
  test('and the option it replaces is the one that spent three times as much', () => {
    const board = boardOf([
      piece('Q', { x: 1, y: 4 }, 'queen', 3, { teamID: 'red', health: 44 }),
      snake('E', [{ x: 7, y: 1 }, { x: 7, y: 0 }], { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['Q'] });
    try {
      const asTeam = sub.teamNumber('red');
      const options: ReadonlyArray<readonly [Coord, number]> = [
        [{ x: 1, y: 4 }, 0],
        [{ x: 2, y: 4 }, 1],
        [{ x: 4, y: 4 }, 3],
        [{ x: 7, y: 4 }, 6],
      ];
      const argmax = (ev: BoundEvaluator): number => {
        let best = -Infinity;
        let spent = -1;
        for (const [to, cells] of options) {
          const est = ev.evaluatePlan(sub, planOf(sub, [['Q', cell(board, to)]]), asTeam).bound
            .est;
          if (est > best) {
            best = est;
            spent = cells;
          }
        }
        return spent;
      };
      expect(argmax(new BoundEvaluator())).toBe(1);
      expect(argmax(withoutEnergy())).toBe(3);
    } finally {
      sub.release();
    }
  });

  /**
   * The refund is in the rules: `resolveTurn` step 4 sets an eater's health to
   * its kind's maximum AFTER the movement charge, so a move that eats spends
   * nothing at all. Nothing here special-cases it — the spend is read as the
   * difference the resolution produced.
   */
  test('a piece that can reach food still eats, and the meal costs it no energy', () => {
    const board = boardOf(
      [
        piece('Q', { x: 1, y: 4 }, 'queen', 3, { teamID: 'red', health: 40 }),
        snake('E', [{ x: 7, y: 7 }, { x: 7, y: 6 }], { teamID: 'blue' }),
      ],
      { food: [{ x: 6, y: 4 }] }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['Q'] });
    try {
      const asTeam = sub.teamNumber('red');
      const eat = planOf(sub, [['Q', cell(board, { x: 6, y: 4 })]]);
      const hold = planOf(sub, [['Q', cell(board, { x: 1, y: 4 })]]);
      expect(energyOf(sub, eat, asTeam)).toBe(0);
      expect(scoreOf(sub, eat, asTeam)).toBeGreaterThan(scoreOf(sub, hold, asTeam));
    } finally {
      sub.release();
    }
  });

  /**
   * A CAPTURE IS NOT IN QUESTION. Material is ten per unit of weight and this
   * term's whole range is one, so the price of the ray that takes a five-weight
   * rook is two per cent of what taking it is worth. The gate is here because
   * "conserve energy" failing this way — a piece that will not pay five health
   * for a rook — is exactly how a conservation term turns a bot into a statue.
   *
   * The victim is NARROWED to its own square, which is what makes the capture
   * certain rather than contingent: a held enemy that might move away is not
   * credited by `material` at all (its death is already possible in our best
   * world from every option), and the fixture would then be measuring the
   * claim machinery instead of this member.
   */
  test('a valuable capture in reach still beats the hold', () => {
    const board = boardOf([
      piece('Q', { x: 1, y: 4 }, 'queen', 6, { teamID: 'red', health: 40 }),
      piece('V', { x: 6, y: 4 }, 'rook', 5, { teamID: 'blue', health: 100 }),
    ]);
    const sub = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled: ['Q'],
      narrowings: new Map([['V', [cell(board, { x: 6, y: 4 })]]]),
    });
    try {
      const asTeam = sub.teamNumber('red');
      const take = planOf(sub, [['Q', cell(board, { x: 6, y: 4 })]]);
      const hold = planOf(sub, [['Q', cell(board, { x: 1, y: 4 })]]);
      const gap = scoreOf(sub, take, asTeam) - scoreOf(sub, hold, asTeam);
      expect(gap).toBeGreaterThan(20);
      // The five cells of ray ARE charged — they are simply not the question.
      const price = -energyOf(sub, take, asTeam) * (DEFAULT_WEIGHTS.energy as number);
      expect(price).toBeGreaterThan(0);
      expect(price).toBeLessThan(gap / 10);
    } finally {
      sub.release();
    }
  });

  /**
   * THE EFFECT → 0 CONDITION. A piece with abundant health beside a meal must
   * behave EXACTLY as it did before this member existed — not approximately.
   * `scarcity` is `d / D` and `d` is one step, so the price is a thousandth of
   * a unit, an order of magnitude under `momentum`'s idleness charge, and the
   * fold's ordering over the whole option set is unchanged.
   */
  test('a healthy piece next to food is charged nothing worth having', () => {
    const board = boardOf(
      [
        piece('Q', { x: 4, y: 4 }, 'queen', 3, { teamID: 'red', health: 100 }),
        snake('E', [{ x: 7, y: 1 }, { x: 7, y: 0 }], { teamID: 'blue' }),
      ],
      { food: [{ x: 5, y: 4 }] }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['Q'] });
    try {
      const asTeam = sub.teamNumber('red');
      const targets: ReadonlyArray<Coord> = [
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 3, y: 4 },
        { x: 4, y: 6 },
        { x: 1, y: 1 },
      ];
      const price =
        -energyOf(sub, planOf(sub, [['Q', cell(board, { x: 1, y: 1 })]]), asTeam) *
        (DEFAULT_WEIGHTS.energy as number);
      expect(price).toBeLessThan(0.05);
      // Below `momentum`'s deductible by an order of magnitude, which is the
      // arithmetic behind "behaves as today".
      expect(price).toBeLessThan((DEFAULT_WEIGHTS.momentum as number) * IDLE_COST);
      // And the ordering the search reads is the ordering it read before.
      const order = (ev: BoundEvaluator): Coord[] =>
        [...targets].sort(
          (a, b) =>
            ev.evaluatePlan(sub, planOf(sub, [['Q', cell(board, b)]]), asTeam).bound.est -
            ev.evaluatePlan(sub, planOf(sub, [['Q', cell(board, a)]]), asTeam).bound.est
        );
      expect(order(new BoundEvaluator())).toEqual(order(withoutEnergy()));
    } finally {
      sub.release();
    }
  });

  /**
   * THE STARVATION RELEASE. A unit whose runway no longer covers the trip to
   * the nearest meal is charged NOTHING — conserving what it cannot afford to
   * hoard is worthless, and `food` must keep sole authority over the hungry.
   */
  test('a unit that cannot afford the trip it must make is charged nothing', () => {
    const board = boardOf(
      [
        piece('Q', { x: 1, y: 1 }, 'queen', 3, { teamID: 'red', health: 4 }),
        snake('E', [{ x: 7, y: 7 }, { x: 7, y: 6 }], { teamID: 'blue' }),
      ],
      { food: [{ x: 6, y: 6 }] }
    );
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['Q'] });
    try {
      const asTeam = sub.teamNumber('red');
      // Ten steps of flood to the meal against four health left: slack is zero.
      expect(energyOf(sub, planOf(sub, [['Q', cell(board, { x: 3, y: 3 })]]), asTeam)).toBe(0);
    } finally {
      sub.release();
    }
  });
});

// ---------------------------------------------------------------------------
// A snake is not charged, and a snake board is bit-identical
// ---------------------------------------------------------------------------

describe('a trail unit has no hold in its grammar, so it has no energy decision', () => {
  const snakeBoard = (): Board =>
    boardOf(
      [
        snake('S', [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }], {
          teamID: 'red',
          health: 30,
        }),
        snake('E', [{ x: 7, y: 7 }, { x: 7, y: 6 }], { teamID: 'blue', health: 30 }),
      ],
      { food: [{ x: 1, y: 1 }] }
    );

  test('the term is exactly zero on a board of trail units', () => {
    const board = snakeBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['S'] });
    try {
      const asTeam = sub.teamNumber('red');
      expect(energyOf(sub, planOf(sub, [['S', cell(board, { x: 5, y: 4 })]]), asTeam)).toBe(0);
    } finally {
      sub.release();
    }
  });

  /**
   * BIT-IDENTICAL, not merely close: the fold adds an exact zero, so a
   * snake-only board scores the number it scored before this member existed.
   * That is what makes the snake-only scenarios a falsifier rather than a
   * comparison — see the byte diff in `docs/design/energy.md`.
   */
  test('and the whole fold is bit-identical to the fold without the member', () => {
    const board = snakeBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['S'] });
    try {
      const asTeam = sub.teamNumber('red');
      const before = withoutEnergy();
      for (const to of [{ x: 5, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 5 }]) {
        const plan = planOf(sub, [['S', cell(board, to)]]);
        const a = before.evaluatePlan(sub, plan, asTeam).bound;
        const b = new BoundEvaluator().evaluatePlan(sub, plan, asTeam).bound;
        expect([to, b]).toEqual([to, a]);
      }
    } finally {
      sub.release();
    }
  });
});

// ---------------------------------------------------------------------------
// The two construction claims
// ---------------------------------------------------------------------------

describe('the energy weight is bounded by the same inequality every term is', () => {
  test('its whole range cannot buy the lightest unit on the board', () => {
    const w = DEFAULT_WEIGHTS.energy as number;
    // Range is [-1, 0] by construction: cost is in [0,1] per unit and the sum
    // is divided by our unit count.
    expect(w * 1).toBeLessThan(CLIFF_MATERIAL_WEIGHT * 1);
    expect(w).toBeGreaterThan(0);
  });

  /**
   * The deductible. Both terms divide by the same `|ours|`, so the division
   * cancels and the threshold a hold has to clear is a pure weight ratio: at
   * eight against `momentum`'s one, a move must burn more than a sixteenth of
   * the unit's runway at full price before holding wins on energy alone.
   */
  test('and it clears momentum s idleness charge exactly where the design says', () => {
    const deductible = (DEFAULT_WEIGHTS.momentum as number) * IDLE_COST;
    const w = DEFAULT_WEIGHTS.energy as number;
    expect(deductible / w).toBeCloseTo(0.0625, 6);
  });

  /**
   * AND THE DEDUCTIBLE ITSELF IS SCALED BY THE TANK. `momentum` charges the
   * hold for gaining nothing; a nearly-empty unit that holds gains the one
   * thing it has left. Full at full health — which is where
   * `basic-intelligence.test.ts` pins it — and sliding to nothing as the tank
   * empties. See the header of `./momentum.ts`.
   */
  test('the idleness charge is full at a full tank and slides to nothing', () => {
    const board = boardOf([
      piece('N', { x: 4, y: 4 }, 'knight', 1, { teamID: 'red', health: 100 }),
      piece('M', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red', health: 20 }),
      snake('E', [{ x: 7, y: 1 }, { x: 7, y: 0 }], { teamID: 'blue' }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['N', 'M'] });
    try {
      const asTeam = sub.teamNumber('red');
      const momentumOf = (orders: ReadonlyArray<readonly [string, number]>): number =>
        sub.withResolution(planOf(sub, orders), asTeam, ({ resolution, bounds }) =>
          momentumFeature.evaluate(
            makeContext(
              sub,
              resolution,
              bounds,
              asTeam,
              DEFAULT_PROFILE.reachHorizonTurns,
              DEFAULT_PROFILE
            )
          ).est
        );
      const bothMove = momentumOf([
        ['N', cell(board, { x: 5, y: 6 })],
        ['M', cell(board, { x: 3, y: 4 })],
      ]);
      // Two units of ours, so each charge lands halved.
      const holdFull = momentumOf([
        ['N', cell(board, { x: 4, y: 4 })],
        ['M', cell(board, { x: 3, y: 4 })],
      ]);
      const holdEmpty = momentumOf([
        ['N', cell(board, { x: 5, y: 6 })],
        ['M', cell(board, { x: 2, y: 2 })],
      ]);
      expect(bothMove).toBe(0);
      expect(holdFull).toBeCloseTo(-IDLE_COST / 2, 6);
      expect(holdEmpty).toBeCloseTo((-IDLE_COST * 0.2) / 2, 6);
    } finally {
      sub.release();
    }
  });
});
