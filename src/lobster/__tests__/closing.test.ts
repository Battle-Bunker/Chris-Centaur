/**
 * CLOSING AND ACTIVITY — the two additive features and the gain ordering,
 * checked rather than argued.
 *
 *   LAWS        R1/R2/R3 under the same brute-force world enumeration the
 *               shipped fold is held to, for BOTH new profiles.
 *   CASCADE     a maybe-regicide is priced at the material the rules would
 *               actually remove, and a PROVEN one enters `lo`.
 *   CANCELS     material + cascade is exactly zero for a team the cascade
 *               claims — which is why the total stays monotone.
 *   ORDERING    the two measured mis-orderings, before and after the knob.
 *   ADDITIVE    the shipped profiles, weights, features and knobs are byte-for
 *               -byte what they were: an arm that does not opt in pays nothing.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Board, Coord, Snake } from '../../types/battlesnake';
import { marshalBoard } from '../../logic/turn-oracle';
import { NO_ORDER_MOVE, clearGeometryCache, makeSubstrate } from '../substrate';
import type { Candidate, UnitId } from '../contracts';
import {
  DEFAULT_PROFILE,
  DEFAULT_WEIGHTS,
  FEATURES,
  MATERIAL_ONLY_PROFILE,
  checkCollapse,
  checkMonotone,
  checkSoundness,
  defaultEvaluator,
  makeContext,
  materialBounds,
  materialEvaluator,
  standingOf,
} from '../evaluate';
import type { LawCase } from '../evaluate';
import {
  I3_FEATURES,
  I3_MATERIAL_PROFILE,
  I3_TERRITORY_PROFILE,
  I3_WEIGHTS,
  approachFeature,
  i3MaterialEvaluator,
  i3TerritoryEvaluator,
  regicideCascadeFeature,
} from '../evaluate/closing';
import { DEFAULT_KNOBS, GrammarCandidateGenerator } from '../candidates';

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

const TURN = 30;
const at = (board: Board, cell: Coord): number => marshalBoard(board, TURN).toIndex(cell);

afterEach(() => clearGeometryCache());

// ------------------------------------------------------------------- law cases

/**
 * Cases chosen for what they exercise, not for variety: every one of them has a
 * king somewhere and something held, because a cascade that never fires proves
 * nothing about a cascade.
 */
const LAW_CASES: LawCase[] = [
  (() => {
    // Our queen one step from their LAST king, whose two teammates are claims.
    const board = boardOf([
      piece('q', { x: 3, y: 3 }, 'queen', 3, { teamID: 'red', health: 60 }),
      piece('rk', { x: 0, y: 0 }, 'king', 1, { teamID: 'red', health: 60 }),
      piece('bk', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue', health: 60 }),
      piece('br', { x: 8, y: 8 }, 'rook', 3, { teamID: 'blue', health: 60 }),
      piece('bn', { x: 8, y: 6 }, 'knight', 2, { teamID: 'blue', health: 60 }),
    ]);
    return {
      name: 'a queen swinging at a held king with two held teammates',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['q', 'rk'],
      orders: new Map([
        ['q', at(board, { x: 5, y: 3 })],
        ['rk', at(board, { x: 0, y: 1 })],
      ]),
    };
  })(),
  (() => {
    // The same board with the shot declined — the control the cascade must not
    // reward.
    const board = boardOf([
      piece('q', { x: 3, y: 3 }, 'queen', 3, { teamID: 'red', health: 60 }),
      piece('rk', { x: 0, y: 0 }, 'king', 1, { teamID: 'red', health: 60 }),
      piece('bk', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue', health: 60 }),
      piece('br', { x: 8, y: 8 }, 'rook', 3, { teamID: 'blue', health: 60 }),
    ]);
    return {
      name: 'the same queen playing a quiet move instead',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['q', 'rk'],
      orders: new Map([
        ['q', at(board, { x: 3, y: 2 })],
        ['rk', at(board, { x: 0, y: 1 })],
      ]),
    };
  })(),
  (() => {
    // Three teams, so `othersGone` cannot fire and the cascade is the only
    // thing that can price eliminating ONE of them.
    //
    // The two enemy teams field SHORT-RANGE pieces, deliberately out of each
    // other's reach: two enemy CLAIMS that can annihilate each other break R1's
    // ceiling in the SHIPPED fold, before any of this file's code runs. That is
    // a real defect and it has its own repro below; it is not what these cases
    // are for.
    const board = boardOf(
      [
        piece('q', { x: 4, y: 4 }, 'queen', 3, { teamID: 'red', health: 70 }),
        piece('rk', { x: 1, y: 1 }, 'king', 1, { teamID: 'red', health: 70 }),
        piece('bk', { x: 4, y: 6 }, 'king', 1, { teamID: 'blue', health: 70 }),
        piece('bn', { x: 8, y: 8 }, 'knight', 2, { teamID: 'blue', health: 70 }),
        piece('gk', { x: 0, y: 8 }, 'king', 1, { teamID: 'green', health: 70 }),
        piece('gn', { x: 0, y: 2 }, 'knight', 2, { teamID: 'green', health: 70 }),
      ],
      { food: [{ x: 4, y: 2 }] }
    );
    return {
      name: 'three teams, one reachable king, food on the board',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['q', 'rk'],
      orders: new Map([
        ['q', at(board, { x: 4, y: 6 })],
        ['rk', at(board, { x: 1, y: 2 })],
      ]),
    };
  })(),
  (() => {
    // A trail roster with food, which is the board `approach` is for.
    const board = boardOf(
      [
        makeSnake('s1', [
          { x: 2, y: 2 },
          { x: 2, y: 1 },
          { x: 2, y: 0 },
        ], { teamID: 'red', health: 80 }),
        makeSnake('s2', [
          { x: 6, y: 2 },
          { x: 6, y: 1 },
          { x: 6, y: 0 },
        ], { teamID: 'red', health: 80 }),
        makeSnake('e1', [
          { x: 4, y: 7 },
          { x: 4, y: 8 },
        ], { teamID: 'blue', health: 80 }),
      ],
      { food: [{ x: 3, y: 2 }, { x: 5, y: 6 }] }
    );
    return {
      name: 'snakes with food between them and a held enemy',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['s1'],
      orders: new Map([['s1', at(board, { x: 3, y: 2 })]]),
    };
  })(),
];

describe('the admission laws hold for the closing profiles too', () => {
  it('R1 — every world lies inside the interval (territory)', () => {
    for (const c of LAW_CASES) {
      const result = checkSoundness(i3TerritoryEvaluator, c);
      expect([c.name, result.violations]).toEqual([c.name, []]);
      expect(result.checked).toBeGreaterThan(0);
    }
  });

  it('R1 — the same, on the material profile carrying only the cascade', () => {
    for (const c of LAW_CASES) {
      expect([c.name, checkSoundness(i3MaterialEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });

  it('R2 — refinement only ever shrinks the interval', () => {
    for (const c of LAW_CASES) {
      expect([c.name, checkMonotone(i3TerritoryEvaluator, c).violations]).toEqual([c.name, []]);
      expect([c.name, checkMonotone(i3MaterialEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });

  it('R3 — nothing held is a point, and the new features are what collapse it', () => {
    for (const c of LAW_CASES) {
      expect([c.name, checkCollapse(i3TerritoryEvaluator, c).violations]).toEqual([c.name, []]);
      expect([c.name, checkCollapse(i3MaterialEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });

  it('the shipped fold still passes its own laws unchanged', () => {
    for (const c of LAW_CASES) {
      expect([c.name, checkSoundness(defaultEvaluator, c).violations]).toEqual([c.name, []]);
      expect([c.name, checkSoundness(materialEvaluator, c).violations]).toEqual([c.name, []]);
    }
  });
});

/**
 * A DEFECT THIS BRANCH FOUND AND DID NOT OWN — NOW FIXED UPSTREAM.
 *
 * INTEGRATION NOTE (integ/round-a): this describe block was written against the
 * pre-fix engine and its mechanism test carried its own retirement instruction —
 * "if this ever comes back [false, false] the gap was fixed upstream". It has.
 * `engine/fix5` DEFECT B ORs `CloudField.contestedClaims` into `mayHaveDied`,
 * so BOTH sides of a mutually fatal claim pair now come back possibly-dead and
 * the ceiling on this board resolves to WIN instead of a finite −20. Rather
 * than delete the block (it is the only regression cover for that ceiling in
 * this suite) it is INVERTED: it now asserts the FIXED reading, and the first
 * test — "the closing fold adds no violation the shipped fold does not have" —
 * is unchanged and still passes.
 *
 * The historical text is kept below because it is the derivation of the fix.
 *
 * Two HELD claims that can annihilate each other USED TO break R1's CEILING in
 * the shipped fold, before any of this file's code runs. Minimal repro, 9x9,
 * our king the only mover:
 *
 *     red   king   (0,0) w1   — modelled, stages (0,1)
 *     blue  queen  (7,7) w3   — claim
 *     green rook   (5,7) w3   — claim
 *
 * Both enemies can occupy the same cell next turn, at equal weight, and a tie
 * kills everyone — so a world exists in which BOTH enemy teams are eliminated
 * and the value is WIN. The partial's ceiling is a finite −20. `standingOf`
 * shows why: the blue queen comes back `bestAlive: false` and the green rook
 * `bestAlive: true`, so the claim-collision analysis marked ONE side of a
 * mutually fatal pair. A tie kills both, so both are possibly-dead.
 *
 * It is not confined to enemies-of-enemies, and it is not exotic: the same
 * thing fires for two claims of one team (a king and a knight of the same team
 * sharing a square is self-regicide), which is any board with two held units
 * whose grammars overlap — i.e. nearly every board.
 *
 * WHY IT MATTERS BEYOND A LAW: a ceiling that is too LOW is what the search's
 * decisive test reads. `hi[m] <= lo[best]` retires a branch permanently, so an
 * understated ceiling retires lines that are in fact wins.
 *
 * What this suite can own is the narrower claim: the closing fold introduces no
 * violation the shipped fold does not already have.
 */
describe('the claim-collision ceiling gap, closed by engine/fix5', () => {
  const hostile: LawCase = (() => {
    const board = boardOf([
      piece('rk', { x: 0, y: 0 }, 'king', 1, { teamID: 'red', health: 70 }),
      piece('bq', { x: 7, y: 7 }, 'queen', 3, { teamID: 'blue', health: 70 }),
      piece('gr', { x: 5, y: 7 }, 'rook', 3, { teamID: 'green', health: 70 }),
    ]);
    return {
      name: 'two enemy claims that can annihilate each other',
      board,
      turn: TURN,
      asTeam: 'red',
      stages: ['rk'],
      orders: new Map([['rk', at(board, { x: 0, y: 1 })]]),
    };
  })();

  it('is present in the shipped fold, and the closing fold adds nothing to it', () => {
    const shipped = checkSoundness(defaultEvaluator, hostile).violations.length;
    const shippedMaterial = checkSoundness(materialEvaluator, hostile).violations.length;
    const closing = checkSoundness(i3TerritoryEvaluator, hostile).violations.length;
    const closingMaterial = checkSoundness(i3MaterialEvaluator, hostile).violations.length;
    expect(closing).toBeLessThanOrEqual(shipped);
    expect(closingMaterial).toBeLessThanOrEqual(shippedMaterial);
  });

  it('the mechanism: BOTH sides of a mutually fatal claim pair are now flagged', () => {
    const { sub, asTeam, plan } = contextFor(hostile);
    try {
      sub.withResolution(plan, asTeam, ({ resolution }) => {
        const held = standingOf(sub, resolution, asTeam).filter((s) => s.held);
        expect(held).toHaveLength(2);
        // WAS [false, true] — the analysis marked only ONE side of the pair, so
        // a world in which both enemy teams are eliminated was invisible and the
        // ceiling read a finite −20. engine/fix5 DEFECT B (contestedClaims ->
        // mayHaveDied, head-to-head at the two lex-contest corners) makes both
        // possibly-dead, which is what a tie actually does under the rules.
        expect(held.map((s) => s.bestAlive).sort()).toEqual([false, false]);
        return null;
      });
    } finally {
      sub.release();
    }
  });
});

// ------------------------------------------------------------------- cascade

/** Every unit named with its own default — the zero-assumption joint plan. */
function defaultPlan(sub: ReturnType<typeof makeSubstrate>): Map<UnitId, Candidate> {
  const plan = new Map<UnitId, Candidate>();
  for (const u of sub.roster()) {
    plan.set(u.unitId, { unitId: u.unitId, from: -1, to: NO_ORDER_MOVE, path: [] });
  }
  return plan;
}

function contextFor(c: LawCase) {
  const sub = makeSubstrate({ board: c.board, turn: c.turn, asTeam: c.asTeam, modeled: c.stages });
  const asTeam = sub.teamNumber(c.asTeam);
  const plan = new Map<UnitId, Candidate>();
  for (const wireId of c.stages) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error(`no unit ${wireId}`);
    const to = c.orders.get(wireId) as number;
    plan.set(unit.unitId, { unitId: unit.unitId, from: -1, to, path: sub.pathFor(unit.unitId, to) ?? [] });
  }
  return { sub, asTeam, plan };
}

describe('the regicide cascade prices what the rules would actually remove', () => {
  it('a maybe-regicide credits the victim team’s whole surviving roster in `hi`', () => {
    const shot = LAW_CASES[0] as LawCase;
    const { sub, asTeam, plan } = contextFor(shot);
    try {
      const withCascade = i3TerritoryEvaluator.evaluatePlan(sub, plan, asTeam);
      const cascade = withCascade.parts.regicideCascade;
      expect(cascade).toBeDefined();
      // blue's held rook (3) is what regicide would sweep.
      //
      // INTEGRATION NOTE (integ/round-a): this was 5 = rook (3) + knight (2)
      // before `engine/fix5`. The cascade credits a victim team's units that
      // are still ALIVE in the reading — crediting a unit the engine already
      // expects to die would double-count it. Post-fix5 the blue knight (8,6)
      // and blue rook (8,8) are seen as a contested claim pair, so the knight
      // comes back `bestAlive: false` and drops out of the credit. The
      // MECHANISM is unchanged and the cancellation law below still holds
      // exactly; only the fixture's arithmetic moved, because the engine got
      // more accurate about who survives. (fix5 report: "3 downstream fixtures
      // moved — two-unit enemy self-annihilation now seen".)
      expect((cascade as { hi: number }).hi).toBeCloseTo(3, 6);
      // Nothing is PROVEN, so the floor claims nothing.
      expect((cascade as { lo: number }).lo).toBe(0);
    } finally {
      sub.release();
    }
  });

  it('declining the shot claims nothing at either end', () => {
    const quiet = LAW_CASES[1] as LawCase;
    const { sub, asTeam, plan } = contextFor(quiet);
    try {
      const evaluated = i3TerritoryEvaluator.evaluatePlan(sub, plan, asTeam);
      const cascade = evaluated.parts.regicideCascade as { lo: number; hi: number };
      expect([cascade.lo, cascade.hi]).toEqual([0, 0]);
    } finally {
      sub.release();
    }
  });

  it('a maybe-regicide is ordered ABOVE a quiet move, which it was not before', () => {
    const shot = contextFor(LAW_CASES[0] as LawCase);
    const quiet = contextFor(LAW_CASES[1] as LawCase);
    try {
      const shotBefore = defaultEvaluator.evaluatePlan(shot.sub, shot.plan, shot.asTeam).bound.est;
      const quietBefore = defaultEvaluator.evaluatePlan(quiet.sub, quiet.plan, quiet.asTeam).bound
        .est;
      const shotAfter = i3TerritoryEvaluator.evaluatePlan(shot.sub, shot.plan, shot.asTeam).bound
        .est;
      const quietAfter = i3TerritoryEvaluator.evaluatePlan(quiet.sub, quiet.plan, quiet.asTeam)
        .bound.est;
      // The boards differ by one held unit, so the two `est`s are not directly
      // comparable; the DELTA the cascade adds to each is.
      expect(shotAfter - shotBefore).toBeGreaterThan(quietAfter - quietBefore);
      expect(quietAfter - quietBefore).toBeCloseTo(0, 6);
    } finally {
      shot.sub.release();
      quiet.sub.release();
    }
  });

  it('material + cascade is exactly zero for a team the cascade claims', () => {
    const { sub, asTeam, plan } = contextFor(LAW_CASES[0] as LawCase);
    try {
      sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
        const ctx = makeContext(sub, resolution, bounds, asTeam, I3_TERRITORY_PROFILE.reachHorizonTurns);
        const cascade = regicideCascadeFeature.evaluate(ctx);
        const material = materialBounds(ctx);
        // Blue contributes −(king 1 + rook 3 + knight 2) to material's `best`
        // when it is all standing; with the king contested, material drops the
        // king and the cascade adds back the rest, so blue nets zero.
        const blue = ctx.standing.filter((s) => s.team !== asTeam);
        const blueBest = blue.filter((s) => s.bestAlive);
        const subtracted = blueBest.reduce(
          (a, s) => a + Math.max(0, s.weightMin - s.partialLossMax),
          0
        );
        expect(cascade.hi - subtracted).toBeCloseTo(0, 6);
        // The `best` reading still carries green and whatever blue kept, so
        // this is a cancellation inside a live fold rather than an empty one.
        expect(Number.isFinite(material.best)).toBe(true);
        return null;
      });
    } finally {
      sub.release();
    }
  });

  it('a PROVEN regicide enters `lo` — a boxed king with nowhere legal to be', () => {
    // blue's king is walled into a corner by its own body-less roster and our
    // two rooks cover the only two squares it could occupy. Nothing here is
    // held, so this is the collapse case: lo === hi and both carry the sweep.
    const board = boardOf([
      piece('r1', { x: 0, y: 1 }, 'rook', 3, { teamID: 'red', health: 90 }),
      piece('r2', { x: 1, y: 0 }, 'rook', 3, { teamID: 'red', health: 90 }),
      piece('rk', { x: 8, y: 8 }, 'king', 1, { teamID: 'red', health: 90 }),
      piece('bk', { x: 0, y: 0 }, 'king', 1, { teamID: 'blue', health: 90 }),
      piece('bq', { x: 8, y: 0 }, 'queen', 3, { teamID: 'blue', health: 90 }),
    ]);
    const sub = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled: ['r1', 'r2', 'rk', 'bk', 'bq'],
    });
    try {
      const asTeam = sub.teamNumber('red');
      const plan = defaultPlan(sub);
      const kill = sub.unitOfWireId('r1');
      if (kill === undefined) throw new Error('no r1');
      const to = at(board, { x: 0, y: 0 });
      plan.set(kill.unitId, {
        unitId: kill.unitId,
        from: -1,
        to,
        path: sub.pathFor(kill.unitId, to) ?? [],
      });
      const evaluated = i3TerritoryEvaluator.evaluatePlan(sub, plan, asTeam);
      // Everything is named, so the resolver cascades for itself and there is
      // nothing left for the feature to add — which is the point: the feature
      // exists for the case the resolver structurally cannot see.
      const cascade = evaluated.parts.regicideCascade as { lo: number; hi: number };
      expect(cascade.lo).toBe(cascade.hi);
      expect(evaluated.bound.lo).toBe(evaluated.bound.hi);
    } finally {
      sub.release();
    }
  });
});

// ------------------------------------------------------------------ approach

describe('approach reads the food map the fold otherwise ignores', () => {
  it('closing on food raises `est` and opening on it lowers it', () => {
    const board = boardOf(
      [
        makeSnake('s1', [
          { x: 2, y: 4 },
          { x: 1, y: 4 },
          { x: 0, y: 4 },
        ], { teamID: 'red', health: 80 }),
        makeSnake('e1', [
          { x: 8, y: 0 },
          { x: 8, y: 1 },
        ], { teamID: 'blue', health: 80 }),
      ],
      { food: [{ x: 6, y: 4 }] }
    );
    const evaluateTo = (dest: Coord, evaluator = i3TerritoryEvaluator): number => {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['s1'] });
      try {
        const asTeam = sub.teamNumber('red');
        const unit = sub.unitOfWireId('s1');
        if (unit === undefined) throw new Error('no s1');
        const to = at(board, dest);
        const plan = new Map<UnitId, Candidate>([
          [unit.unitId, { unitId: unit.unitId, from: -1, to, path: sub.pathFor(unit.unitId, to) ?? [] }],
        ]);
        return evaluator.evaluatePlan(sub, plan, asTeam).bound.est;
      } finally {
        sub.release();
      }
    };
    const towards = evaluateTo({ x: 3, y: 4 });
    const away = evaluateTo({ x: 2, y: 5 });
    expect(towards).toBeGreaterThan(away);

    // And the shipped fold is the thing that cannot tell them apart on food:
    // whatever it prefers here, it is not preferring it BECAUSE of the food.
    const baseTowards = evaluateTo({ x: 3, y: 4 }, defaultEvaluator);
    const baseAway = evaluateTo({ x: 2, y: 5 }, defaultEvaluator);
    expect(towards - away).toBeGreaterThan(baseTowards - baseAway);
  });

  it('is a point when nothing is held, and zero with no food on the board', () => {
    const board = boardOf([
      makeSnake('s1', [
        { x: 2, y: 4 },
        { x: 1, y: 4 },
      ], { teamID: 'red', health: 80 }),
      makeSnake('e1', [
        { x: 8, y: 0 },
        { x: 8, y: 1 },
      ], { teamID: 'blue', health: 80 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red', modeled: ['s1', 'e1'] });
    try {
      const asTeam = sub.teamNumber('red');
      sub.withResolution(defaultPlan(sub), asTeam, ({ resolution, bounds }) => {
        const ctx = makeContext(sub, resolution, bounds, asTeam, 4);
        const b = approachFeature.evaluate(ctx);
        expect([b.lo, b.est, b.hi]).toEqual([0, 0, 0]);
        return null;
      });
    } finally {
      sub.release();
    }
  });

  it('stays inside the cliff inequality — weight x observed range < a king', () => {
    let widest = 0;
    for (const c of LAW_CASES) {
      const { sub, asTeam } = contextFor(c);
      try {
        for (const unit of sub.roster()) {
          const plan = defaultPlan(sub);
          for (const action of sub.enumerate(unit.unitId).slice(0, 6)) {
            plan.set(unit.unitId, {
              unitId: unit.unitId,
              from: -1,
              to: action.dest,
              path: action.action.kind === 'move' ? [...action.action.path] : [],
            });
            const parts = i3TerritoryEvaluator.evaluatePlan(sub, plan, asTeam).parts;
            const a = parts.approach as { lo: number; hi: number } | undefined;
            if (a === undefined) continue;
            widest = Math.max(widest, Math.abs(a.hi - a.lo), Math.abs(a.hi), Math.abs(a.lo));
          }
        }
      } finally {
        sub.release();
      }
    }
    expect((I3_WEIGHTS.approach as number) * widest * 2).toBeLessThan(10);
  });
});

// ------------------------------------------------------------------ ordering

describe('the gain ordering fixes two mis-orderings, and only when asked', () => {
  const foodBoard = boardOf(
    [
      piece('q', { x: 4, y: 8 }, 'queen', 3, { teamID: 'red', health: 95 }),
      piece('rk', { x: 0, y: 0 }, 'king', 1, { teamID: 'red', health: 95 }),
      piece('bk', { x: 8, y: 4 }, 'king', 1, { teamID: 'blue', health: 95 }),
    ],
    { food: [{ x: 4, y: 0 }] }
  );

  const orderFor = (gainOrdering: boolean, wireId: string, board: Board): number[] => {
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const gen = new GrammarCandidateGenerator({ gainOrdering });
      const unit = sub.unitOfWireId(wireId);
      if (unit === undefined) throw new Error(`no ${wireId}`);
      return gen.candidatesFor(sub, unit.unitId).candidates.map((c) => c.to);
    } finally {
      sub.release();
    }
  };

  it('a nine-cell slide onto food outranks `stay`, which it did not', () => {
    const foodCell = at(foodBoard, { x: 4, y: 0 });
    const stayCell = at(foodBoard, { x: 4, y: 8 });

    const before = orderFor(false, 'q', foodBoard);
    const after = orderFor(true, 'q', foodBoard);

    expect(before.indexOf(stayCell)).toBeLessThan(before.indexOf(foodCell));
    expect(after.indexOf(foodCell)).toBeLessThan(after.indexOf(stayCell));
    // And it is inside the search's own candidate cap, which is what makes the
    // difference operational rather than cosmetic.
    expect(after.indexOf(foodCell)).toBeLessThan(8);
    // Same option set: this is an ordering, not a prune.
    expect([...before].sort((a, b) => a - b)).toEqual([...after].sort((a, b) => a - b));
  });

  it('the shot at an enemy team’s last king sorts to the front of its tier', () => {
    const board = boardOf([
      piece('q', { x: 4, y: 4 }, 'queen', 3, { teamID: 'red', health: 95 }),
      piece('rk', { x: 0, y: 0 }, 'king', 1, { teamID: 'red', health: 95 }),
      piece('bk', { x: 4, y: 7 }, 'king', 1, { teamID: 'blue', health: 95 }),
      piece('bp', { x: 1, y: 4 }, 'pawn', 1, { teamID: 'blue', health: 95 }),
    ]);
    const kingCell = at(board, { x: 4, y: 7 });
    const after = orderFor(true, 'q', board);
    const before = orderFor(false, 'q', board);
    expect(after.indexOf(kingCell)).toBe(0);
    expect(before.indexOf(kingCell)).toBeGreaterThan(0);
  });

  it('never reads our OWN king’s square as a target', () => {
    const board = boardOf([
      piece('q', { x: 4, y: 4 }, 'queen', 3, { teamID: 'red', health: 95 }),
      piece('rk', { x: 4, y: 7 }, 'king', 1, { teamID: 'red', health: 95 }),
      piece('bk', { x: 0, y: 0 }, 'king', 1, { teamID: 'blue', health: 95 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const gen = new GrammarCandidateGenerator({ gainOrdering: true });
      const q = sub.unitOfWireId('q');
      if (q === undefined) throw new Error('no q');
      const shots = gen
        .assess(sub, q.unitId)
        .filter((a) => a.regicideShot === 1)
        .flatMap((a) => a.landing);
      expect(shots).not.toContain(at(board, { x: 4, y: 7 }));
    } finally {
      sub.release();
    }
  });

  it('does not fire for a team fielding two kings — regicide needs the LAST one', () => {
    const board = boardOf([
      piece('q', { x: 4, y: 4 }, 'queen', 3, { teamID: 'red', health: 95 }),
      piece('rk', { x: 0, y: 0 }, 'king', 1, { teamID: 'red', health: 95 }),
      piece('bk1', { x: 4, y: 7 }, 'king', 1, { teamID: 'blue', health: 95 }),
      piece('bk2', { x: 7, y: 7 }, 'king', 1, { teamID: 'blue', health: 95 }),
    ]);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const gen = new GrammarCandidateGenerator({ gainOrdering: true });
      const q = sub.unitOfWireId('q');
      if (q === undefined) throw new Error('no q');
      expect(gen.assess(sub, q.unitId).some((a) => a.regicideShot === 1)).toBe(false);
    } finally {
      sub.release();
    }
  });

  /**
   * THE PROMOTION ITSELF (integ/round-a). Every test above names `gainOrdering`
   * explicitly, so all of them would still pass with the default set either
   * way — they gate the MECHANISM, not the SHIPPING of it. This one gates the
   * shipping: it builds the generator the way production does, with no knobs
   * at all, and asserts the gain order is what comes back.
   */
  it('the DEFAULT generator — no knobs named — carries the gain order', () => {
    const sub = makeSubstrate({ board: foodBoard, turn: TURN, asTeam: 'red' });
    try {
      const q = sub.unitOfWireId('q');
      if (q === undefined) throw new Error('no q');
      const shipped = new GrammarCandidateGenerator().assess(sub, q.unitId);
      const prePromotion = new GrammarCandidateGenerator({ gainOrdering: false }).assess(
        sub,
        q.unitId
      );

      // `foodGain` is computed ONLY when the gain keys are live, so a non-zero
      // one under a knob-free generator is proof the default carries them.
      expect(shipped.filter((c) => c.foodGain === 1).length).toBeGreaterThan(0);
      expect(prePromotion.filter((c) => c.foodGain === 1).length).toBe(0);

      // And the promotion actually moves the order.
      const seq = (s: typeof shipped): string => s.map((c) => c.candidate.to).join(',');
      expect(seq(shipped)).not.toEqual(seq(prePromotion));

      // I3's measured mis-ordering #1, corrected by default: the eat is reached
      // before the `stay` that used to outrank it.
      const stay = shipped.findIndex((c) => c.candidate.path.length === 0);
      const firstEat = shipped.findIndex((c) => c.foodGain === 1);
      expect(firstEat).toBeGreaterThanOrEqual(0);
      expect(firstEat).toBeLessThan(stay);
    } finally {
      sub.release();
    }
  });
});

// ------------------------------------------------------------------ additive

describe('nothing shipped moved', () => {
  /**
   * RETIRED AND REPLACED (integ/round-a). This pinned
   * `DEFAULT_KNOBS.gainOrdering === false`, which was the right assertion while
   * I3 was an unpromoted arm: the branch's whole claim was "an arm that does
   * not opt in pays nothing".
   *
   * The coordinator has promoted gainOrdering, so that assertion now pins the
   * OPPOSITE of the shipped intent and had to go. It is replaced rather than
   * deleted, because what it was really protecting — that the promotion is a
   * deliberate, visible act and not an accident — is still worth a gate. The
   * ORDERING tests above ('the gain ordering fixes two mis-orderings, and only
   * when asked') are untouched and still drive both polarities explicitly, so
   * the mechanism keeps its full cover either way.
   *
   * Note the sibling assertions in this block are NOT retired: the shipped
   * WEIGHTS and the shipped FEATURE LIST still carry neither new key. Ordering
   * was promoted; the two evaluator features were not.
   */
  it('the gain ordering is promoted, deliberately and visibly', () => {
    expect(DEFAULT_KNOBS.gainOrdering).toBe(true);
  });

  it('the shipped weights carry neither new key, so no profile pays by default', () => {
    expect(Object.keys(DEFAULT_WEIGHTS).sort()).toEqual([
      'healthEconomy',
      'kingMargin',
      'material',
      'reach',
      'room',
    ]);
    expect(DEFAULT_PROFILE.weights).toBe(DEFAULT_WEIGHTS);
    expect(MATERIAL_ONLY_PROFILE.weights.regicideCascade).toBeUndefined();
  });

  it('the shipped evaluators fold the shipped feature list and nothing else', () => {
    expect(defaultEvaluator.features).toBe(FEATURES);
    expect(materialEvaluator.features).toBe(FEATURES);
    expect(FEATURES.map((f) => f.key)).not.toContain('regicideCascade');
    expect(FEATURES.map((f) => f.key)).not.toContain('approach');
  });

  it('the additive list is the shipped one plus two, in that order', () => {
    expect(I3_FEATURES.map((f) => f.key)).toEqual([
      ...FEATURES.map((f) => f.key),
      'regicideCascade',
      'approach',
    ]);
  });

  it('the cascade carries MATERIAL’s weight, because it is a correction to it', () => {
    expect(I3_WEIGHTS.regicideCascade).toBe(I3_WEIGHTS.material);
    expect(I3_WEIGHTS.material).toBe(DEFAULT_WEIGHTS.material);
    expect(I3_MATERIAL_PROFILE.weights.regicideCascade).toBe(
      I3_MATERIAL_PROFILE.weights.material
    );
  });

  it('a feature nobody weights still costs nothing, because it is not in the list', () => {
    expect(regicideCascadeFeature.defaultWeight).toBe(0);
    expect(approachFeature.defaultWeight).toBe(0);
  });
});

/**
 * STAGE 3 CARVE-OUT — `approach` is HELD, and this is what holds it.
 *
 * The ledger's Stage 2.5 verdict on I3 ships `gainOrdering` + `regicideCascade`
 * and holds `approach` for its own arm: the eliminated +0.12 has aggression's
 * sign and is not yet separable from its null. So `approach` must not be able
 * to reach a decision this build makes.
 *
 * On the branch as built that is true INCIDENTALLY rather than by construction:
 * `evaluate/closing.ts` has no importer outside this test file, so both of its
 * features — `approach` AND `regicideCascade` — are dark, reachable only via
 * `i3TerritoryEvaluator` / `i3MaterialEvaluator`, which exist to be the arm's
 * harness. No surgery was needed at merge time, and none was done: cutting the
 * feature out would have destroyed the material its own arm still needs.
 *
 * What was missing is a TRIPWIRE. The moment anything on a production path
 * imports this module — a later idea branch, an i2 follow-on, a profile
 * promotion — `approach` ships silently, because `I3_TERRITORY_PROFILE` carries
 * it at weight 1. This block is that tripwire. If it fails, the question to ask
 * is "has approach's arm reported yet?", not "how do I make this pass?".
 */
describe('the approach carve-out holds', () => {
  const CLOSING = join(__dirname, '..', 'evaluate', 'closing.ts');

  const sourceFiles = (dir: string, found: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        sourceFiles(full, found);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        found.push(full);
      }
    }
    return found;
  };

  it('no non-test module imports the closing fold, so neither feature can ship', () => {
    // Both forms: a named/default import (`from '.../evaluate/closing'`) and a
    // bare side-effect import (`import '.../evaluate/closing'`), plus
    // `require()`. A side-effect import is enough to construct the evaluators,
    // so a pattern that only understood `from` would miss a live promotion.
    const reaches = /(?:from\s*|import\s*|require\s*\(\s*)['"][^'"]*evaluate\/closing['"]/;
    const importers = sourceFiles(join(__dirname, '..', '..')).filter((file) =>
      reaches.test(readFileSync(file, 'utf8'))
    );
    expect(importers).toEqual([]);
    expect(existsSync(CLOSING)).toBe(true);
  });

  it('the held feature is still intact for the arm that has to measure it', () => {
    // Held, not deleted. The arm needs the feature and its profile to exist.
    expect(I3_FEATURES.map((f) => f.key)).toContain('approach');
    expect(I3_WEIGHTS.approach).toBe(1);
  });

  it('the two SHIPPERS are present and reachable on their own seams', () => {
    // gainOrdering is a candidate-layer knob, and it is the one thing in this
    // branch that is PROMOTED — on by default, per the ledger's "promote
    // gainOrdering FIRST".
    expect(DEFAULT_KNOBS.gainOrdering).toBe(true);
    // regicideCascade rides the same dark list as approach today; promoting it
    // is a separate, deliberate act and not this merge's business.
    expect(I3_FEATURES.map((f) => f.key)).toContain('regicideCascade');
  });
});
