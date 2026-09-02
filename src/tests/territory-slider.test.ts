/**
 * THE SLIDER REPAIR, checked rather than argued.
 *
 * The budget ladder established that the territory profile's deficit on boards
 * with a slider is the heuristic and not the search. Sweeping one piece across
 * its own legal options on the ladder's own replays, with the joint context
 * held fixed, says what the heuristic is getting wrong:
 *
 *   the partition's `ours` and `theirs` do not move by ONE CELL across all 71
 *   legal actions of a queen, so `reach` has no gradient in a slider's own
 *   position; `room` is plane 1 only, so it is identically zero for a piece;
 *   and the only term left with dynamic range is `healthEconomy`, which is a
 *   linear travel tax.
 *
 * The repair adds the missing gradient (`command`) and takes the tax off a unit
 * whose budget does not bind (`healthReserveRatio`). It is SEATED — the shipped
 * `TERRITORY_PROFILE` carries both, because with `command` at zero every option
 * a piece has scores identically and the bot dithers (see
 * `docs/BASIC-INTELLIGENCE.md`). What this file pins:
 *
 *   1. the admission laws R1/R2/R3 for the shipped profile, by the same
 *      brute-force harness it has always been held to;
 *   2. the cliff inequality for `command`, by sample AND by construction;
 *   3. INERTNESS on a board with no piece on it, against a profile with the two
 *      knobs taken back out — the property that protects the measured snake-only
 *      win, now that the knobs are the default rather than an arm;
 *   4. that the repair does what it says: `command` separates a slider's own
 *      options where `reach` and `room` are flat;
 *   5. the budget share's shape, per class.
 */

import { Board, Coord, Snake } from '../types/battlesnake';
import { marshalBoard } from '../logic/turn-oracle';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';
import {
  BoundEvaluator,
  CLIFF_MATERIAL_WEIGHT,
  COMMAND_KNOBS,
  HEALTH_RESERVE_RATIO,
  TERRITORY_PROFILE,
  budgetShare,
  checkCollapse,
  checkMonotone,
  checkSoundness,
  defaultEvaluator,
  pieceScaleOf,
} from '../lobster/evaluate';
import type { CriterionProfile, LawCase } from '../lobster/evaluate';
import { profileOf } from '../partial-engine/index';

/**
 * The profile the repair replaced: territory with `command` back at zero and no
 * health reserve. Nothing ships it — it exists here so "inert on a snake-only
 * board" stays an ASSERTION about the two knobs rather than a claim, now that
 * the shipped profile is the one that carries them.
 */
const NO_REPAIR_PROFILE: CriterionProfile = {
  name: 'lobster-territory-norepair',
  weights: { ...TERRITORY_PROFILE.weights, command: 0 },
  reachHorizonTurns: TERRITORY_PROFILE.reachHorizonTurns,
};
const noRepairEvaluator = new BoundEvaluator(NO_REPAIR_PROFILE);

// --------------------------------------------------------------------- fixtures

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

const TURN = 40;
const at = (board: Board, cell: Coord): number => marshalBoard(board, TURN).toIndex(cell);

/** A board with one slider a side and two snakes a side — the `b16` shape,
 * shrunk to something a world enumeration can finish. */
const SLIDER_BOARD = boardOf(
  [
    piece('myQueen', { x: 4, y: 4 }, 'queen', 4, { teamID: 'red', health: 90 }),
    makeSnake(
      'mySnake',
      [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      { teamID: 'red', orientation: { dx: 1, dy: 0 }, health: 70 }
    ),
    piece('theirQueen', { x: 7, y: 7 }, 'queen', 4, { teamID: 'blue', health: 90 }),
    makeSnake(
      'theirSnake',
      [
        { x: 7, y: 1 },
        { x: 8, y: 1 },
      ],
      { teamID: 'blue', orientation: { dx: -1, dy: 0 }, health: 70 }
    ),
  ],
  { food: [{ x: 4, y: 1 }, { x: 2, y: 6 }] }
);

/** The same board with every piece taken off it. */
const SNAKE_ONLY_BOARD = boardOf(
  [
    makeSnake(
      'mySnake',
      [
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      { teamID: 'red', orientation: { dx: 1, dy: 0 }, health: 70 }
    ),
    makeSnake(
      'mySnake2',
      [
        { x: 3, y: 3 },
        { x: 3, y: 2 },
      ],
      { teamID: 'red', orientation: { dx: 0, dy: 1 }, health: 80 }
    ),
    makeSnake(
      'theirSnake',
      [
        { x: 7, y: 1 },
        { x: 8, y: 1 },
      ],
      { teamID: 'blue', orientation: { dx: -1, dy: 0 }, health: 70 }
    ),
    makeSnake(
      'theirSnake2',
      [
        { x: 5, y: 6 },
        { x: 5, y: 7 },
      ],
      { teamID: 'blue', orientation: { dx: 0, dy: -1 }, health: 80 }
    ),
  ],
  { food: [{ x: 4, y: 1 }, { x: 2, y: 6 }] }
);

function withSubstrate<T>(
  board: Board,
  asTeam: string,
  modeled: string[],
  fn: (sub: ReturnType<typeof makeSubstrate>) => T
): T {
  const sub = makeSubstrate({ gameId: 'slider-test', board, turn: TURN, asTeam, modeled });
  try {
    return fn(sub);
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

/** Our units at their first legal action, so one unit can be varied alone. */
function basePlan(sub: ReturnType<typeof makeSubstrate>, asTeam: number): Map<UnitId, Candidate> {
  const plan = new Map<UnitId, Candidate>();
  for (const u of sub.roster()) {
    if (u.team !== asTeam) continue;
    const acts = sub.actionsOf(u.unitId);
    if (acts.length > 0) plan.set(u.unitId, acts[0] as Candidate);
  }
  return plan;
}

const LAW_CASES: ReadonlyArray<LawCase> = [
  {
    name: 'a slider board with a held enemy queen and a held enemy snake',
    board: SLIDER_BOARD,
    turn: TURN,
    asTeam: 'red',
    stages: ['myQueen', 'mySnake'],
    orders: new Map([
      ['myQueen', at(SLIDER_BOARD, { x: 4, y: 2 })],
      ['mySnake', at(SLIDER_BOARD, { x: 2, y: 1 })],
    ]),
  },
  {
    name: 'a slider board where only the piece is ours to move',
    board: SLIDER_BOARD,
    turn: TURN,
    asTeam: 'red',
    stages: ['myQueen'],
    orders: new Map([['myQueen', at(SLIDER_BOARD, { x: 6, y: 4 })]]),
  },
  {
    name: 'a board with no piece on it at all',
    board: SNAKE_ONLY_BOARD,
    turn: TURN,
    asTeam: 'red',
    stages: ['mySnake', 'mySnake2'],
    orders: new Map([
      ['mySnake', at(SNAKE_ONLY_BOARD, { x: 2, y: 1 })],
      ['mySnake2', at(SNAKE_ONLY_BOARD, { x: 3, y: 4 })],
    ]),
  },
];

// ---------------------------------------------------------------------------

describe('the admission laws hold for the slider profile', () => {
  test('R1 soundness: every world lies inside the interval', () => {
    let worlds = 0;
    for (const c of LAW_CASES) {
      const result = checkSoundness(defaultEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
      expect(result.checked).toBeGreaterThan(0);
      worlds += result.checked;
    }
    expect(worlds).toBeGreaterThan(20);
  });

  test('R2 refinement-monotonicity: narrowing only ever shrinks the interval', () => {
    let refinements = 0;
    for (const c of LAW_CASES) {
      const result = checkMonotone(defaultEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
      refinements += result.checked;
    }
    expect(refinements).toBeGreaterThan(2);
  });

  test('R3 collapse: nothing held is a point', () => {
    for (const c of LAW_CASES) {
      const result = checkCollapse(defaultEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the profile is inert on a board with no piece on it', () => {
  /**
   * THE PROPERTY THE SNAKE-ONLY WIN RESTS ON. Both changes are gated on a class
   * property the rules already carry — `command` sums over units whose kind
   * does not leave a trail, `healthReserveRatio` applies to kinds that may
   * decline to move — so a board of snakes reaches neither of them. That has to
   * be an assertion and not a claim, because the +0.50 on `r01-snakes6` is the
   * thing this repair must not spend.
   */
  test('every bound is bit-identical to the profile without the repair', () => {
    withSubstrate(SNAKE_ONLY_BOARD, 'red', ['mySnake', 'mySnake2'], (sub) => {
      const asTeam = sub.teamNumber('red');
      const base = basePlan(sub, asTeam);
      const varying = sub.roster().find((u) => u.wireId === 'mySnake');
      expect(varying).toBeDefined();
      let compared = 0;
      for (const cand of sub.actionsOf((varying as { unitId: UnitId }).unitId)) {
        const plan: JointPlan = new Map(base).set(
          (varying as { unitId: UnitId }).unitId,
          cand
        );
        const a = noRepairEvaluator.evaluatePlan(sub, plan, asTeam);
        const b = defaultEvaluator.evaluatePlan(sub, plan, asTeam);
        expect([cand.to, b.bound]).toEqual([cand.to, a.bound]);
        compared++;
      }
      expect(compared).toBeGreaterThan(1);
    });
  });

  test('and the command term is identically zero there', () => {
    withSubstrate(SNAKE_ONLY_BOARD, 'red', ['mySnake', 'mySnake2'], (sub) => {
      const asTeam = sub.teamNumber('red');
      const ev = defaultEvaluator.evaluatePlan(sub, basePlan(sub, asTeam), asTeam);
      expect(ev.parts.command).toEqual({ lo: 0, est: 0, hi: 0 });
    });
  });
});

// ---------------------------------------------------------------------------

describe('the repair supplies the gradient the partition cannot', () => {
  /**
   * Every one of the queen's legal options, with each term read off the SAME
   * evaluation. The fixture is a 9x9 with two trail units a side — small
   * enough for the world enumeration above, which also means its trail domain
   * is a large fraction of the board and `reach` is far LESS degenerate here
   * than on the 23x23 boards the deficit was measured on. So the claims below
   * are about what the terms can and cannot SEPARATE, not about magnitudes:
   * the magnitudes live in the sweep over the ladder's replays.
   */
  interface Option {
    to: number;
    travel: number;
    material: number;
    reach: number;
    room: number;
    health: number;
    command: number;
    survives: boolean;
  }

  const options = (evaluator: BoundEvaluator): Option[] =>
    withSubstrate(SLIDER_BOARD, 'red', ['myQueen', 'mySnake'], (sub) => {
      const asTeam = sub.teamNumber('red');
      const base = basePlan(sub, asTeam);
      const queen = sub.roster().find((u) => u.wireId === 'myQueen') as { unitId: UnitId };
      const out: Option[] = [];
      for (const cand of sub.actionsOf(queen.unitId)) {
        const plan: JointPlan = new Map(base).set(queen.unitId, cand);
        const ev = evaluator.evaluatePlan(sub, plan, asTeam);
        const parts = ev.parts as Record<string, { lo: number; est: number; hi: number }>;
        // "Survives" in the sense the material term uses: the piece is priced
        // alive at both endpoints, so nothing here is a death in disguise.
        const survives = (parts.material as { lo: number }).lo >= 0;
        out.push({
          to: cand.to,
          travel: cand.path.length,
          material: parts.material?.est ?? 0,
          reach: parts.reach?.est ?? 0,
          room: parts.room?.est ?? 0,
          health: parts.healthEconomy?.est ?? 0,
          command: parts.command?.est ?? 0,
          survives,
        });
      }
      return out;
    });

  test('room is EXACTLY flat across a slider\'s own options — it reads plane 1', () => {
    const o = options(defaultEvaluator);
    expect(o.length).toBeGreaterThan(8);
    expect(new Set(o.map((x) => x.room)).size).toBe(1);
  });

  test('command separates options the partition scores identically', () => {
    const o = options(defaultEvaluator);
    // Pairs the WHOLE partition — both planes, both features — cannot tell
    // apart. If `command` is doing its job there is at least one such pair it
    // does tell apart, and that is precisely the gradient plane 2 throws away.
    let tied = 0;
    let separated = 0;
    for (let i = 0; i < o.length; i++) {
      for (let j = i + 1; j < o.length; j++) {
        const a = o[i] as Option;
        const b = o[j] as Option;
        if (a.reach !== b.reach || a.room !== b.room) continue;
        tied++;
        if (a.command !== b.command) separated++;
      }
    }
    expect(tied).toBeGreaterThan(0);
    expect(separated).toBeGreaterThan(0);
  });

  test('the travel tax on a healthy piece is gone', () => {
    // Restricted to options that do not change the material reading at all —
    // no capture, no death, no meal. Under the shipped profile the health term
    // still separates them, and it separates them BY TRAVEL. Under the repair
    // it says nothing, because a queen at 90 of 100 has a budget that does not
    // bind.
    const before = options(noRepairEvaluator).filter((x) => x.survives);
    const after = options(defaultEvaluator).filter((x) => x.survives);
    const quiet = (o: Option[]): Option[] => {
      const modal = o
        .map((x) => x.material)
        .sort()
        .reduce<{ v: number; n: number }>(
          (best, v, _i, all) => {
            const n = all.filter((w) => w === v).length;
            return n > best.n ? { v, n } : best;
          },
          { v: 0, n: 0 }
        );
      return o.filter((x) => x.material === modal.v);
    };
    const q0 = quiet(before);
    const q1 = quiet(after);
    expect(q0.length).toBeGreaterThan(2);
    expect(new Set(q0.map((x) => x.travel)).size).toBeGreaterThan(1);
    expect(new Set(q0.map((x) => x.health)).size).toBeGreaterThan(1);
    expect(new Set(q1.map((x) => x.health)).size).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('the cliff inequality, for the command term', () => {
  const ceiling = CLIFF_MATERIAL_WEIGHT * 1;

  test('by sample, over a slider\'s own options', () => {
    withSubstrate(SLIDER_BOARD, 'red', ['myQueen', 'mySnake'], (sub) => {
      const asTeam = sub.teamNumber('red');
      const base = basePlan(sub, asTeam);
      const queen = sub.roster().find((u) => u.wireId === 'myQueen') as { unitId: UnitId };
      const los: number[] = [];
      for (const cand of sub.actionsOf(queen.unitId)) {
        const plan: JointPlan = new Map(base).set(queen.unitId, cand);
        const parts = defaultEvaluator.evaluatePlan(sub, plan, asTeam).parts as Record<
          string,
          { lo: number }
        >;
        los.push(parts.command?.lo ?? 0);
      }
      const span = Math.max(...los) - Math.min(...los);
      const cost = (TERRITORY_PROFILE.weights.command as number) * span;
      expect(cost).toBeLessThan(ceiling);
    });
  });

  test('and by construction, on any board shape', () => {
    // Each unit's term is clipped into [0, 1] and the sum is divided by one
    // team's worth of pieces, so the whole feature lives in [-T, T] for T teams
    // — the same normalisation argument `room` makes, and the reason the sum
    // does not grow with the roster.
    // `ours` is at most `pieceScale` clipped terms and `theirs` at most
    // `(teams - 1) * pieceScale` of them, so after the divide the whole feature
    // lives in [-(teams - 1), +1] and its span is at most `teams`. Checked at
    // four, one more than the rules field.
    const teams = 4;
    expect((TERRITORY_PROFILE.weights.command as number) * teams).toBeLessThan(ceiling);
  });

  test('and the repair moved nothing else', () => {
    for (const key of ['material', 'reach', 'room', 'healthEconomy', 'kingMargin']) {
      expect([key, NO_REPAIR_PROFILE.weights[key]]).toEqual([
        key,
        TERRITORY_PROFILE.weights[key],
      ]);
    }
    expect(NO_REPAIR_PROFILE.reachHorizonTurns).toBe(TERRITORY_PROFILE.reachHorizonTurns);
  });
});

// ---------------------------------------------------------------------------

describe('the movement budget reads per class, not per kind', () => {
  const cap = 100;
  const kindOf = (name: string): number => {
    for (let k = 0; k < 16; k++) {
      let p;
      try {
        p = profileOf(k);
      } catch {
        continue;
      }
      if (p.name === name) return k;
    }
    throw new Error(`no kind named ${name}`);
  };

  test('a trail unit keeps the linear reading: it has no choice but to spend', () => {
    const snake = { kind: kindOf('snake'), health: 90 };
    expect(budgetShare(snake, cap, HEALTH_RESERVE_RATIO)).toBeCloseTo(0.9);
    expect(budgetShare(snake, cap, null)).toBeCloseTo(0.9);
  });

  test('a stay-legal kind above the reserve reads flat', () => {
    const queen = { kind: kindOf('queen'), health: 90 };
    const spent = { kind: kindOf('queen'), health: 55 };
    expect(budgetShare(queen, cap, HEALTH_RESERVE_RATIO)).toBe(1);
    expect(budgetShare(spent, cap, HEALTH_RESERVE_RATIO)).toBe(1);
  });

  test('and below it the term is SHARPER than the linear one, not softer', () => {
    const dying = { kind: kindOf('queen'), health: 10 };
    const linear = budgetShare(dying, cap, null);
    const budget = budgetShare(dying, cap, HEALTH_RESERVE_RATIO);
    expect(budget).toBeLessThan(1);
    expect(budget).toBeCloseTo(linear / HEALTH_RESERVE_RATIO);
    // Monotone in health, which is what both bound endpoints rest on.
    const worse = budgetShare({ kind: kindOf('queen'), health: 5 }, cap, HEALTH_RESERVE_RATIO);
    expect(worse).toBeLessThan(budget);
  });
});

// ---------------------------------------------------------------------------

describe('the piece scale is a board constant', () => {
  test('it counts pieces per team off the roster and floors at one', () => {
    withSubstrate(SLIDER_BOARD, 'red', ['myQueen', 'mySnake'], (sub) => {
      expect(pieceScaleOf(sub)).toBe(1);
    });
    withSubstrate(SNAKE_ONLY_BOARD, 'red', ['mySnake', 'mySnake2'], (sub) => {
      expect(pieceScaleOf(sub)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------

describe('the knobs are data', () => {
  test('the shipped profile names both knobs and weights the term', () => {
    expect(TERRITORY_PROFILE.command).toEqual(COMMAND_KNOBS);
    expect(TERRITORY_PROFILE.healthReserveRatio).toBe(HEALTH_RESERVE_RATIO);
    expect(TERRITORY_PROFILE.weights.command).toBeGreaterThan(0);
  });
});
