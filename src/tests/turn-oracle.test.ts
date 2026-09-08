/**
 * The turn oracle: marshalling in, reading out.
 *
 * There is no longer a bot-side encoding of the rules to test. What CAN go
 * wrong now is the boundary — did we hand the vendored engine the right board,
 * and did we read its answer correctly — so that is what this file covers:
 * coordinate mapping, the weight-stack expansion pieces need, regicide teams
 * inferred from the board, and the outcome fields traced back to the raw
 * TurnResolution they are lifted from.
 */

import {
  evaluatePathOnBoard,
  marshalBoard,
  resolveTurn,
} from '../logic/turn-oracle';
import { Board, Coord, Snake } from '../types/battlesnake';
import { makeSnake } from './board-fixtures';

const makePiece = (id: string, at: Coord, unitType: string, weight: number, extra: Partial<Snake> = {}) =>
  makeSnake(id, [at], { unitType, length: weight, ...extra });

const board = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 11, height: 11, food: [], hazards: [], snakes, ...extra } as Board);

const TURN = 10;

describe('marshalling the bot board into engine terms', () => {
  test('the api board gains its perimeter, and the perimeter is the wall set', () => {
    const m = marshalBoard(board([makeSnake('us', [{ x: 0, y: 0 }])]), TURN);
    expect(m.fullWidth).toBe(13);
    expect(m.fullHeight).toBe(13);
    // Four sides of a 13x13 ring, corners counted once.
    expect(m.config.walls.length).toBe(13 * 4 - 4);
    // An api cell never maps onto a wall, and the mapping round-trips.
    for (const cell of [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }]) {
      expect(m.config.walls).not.toContain(m.toIndex(cell));
      expect(m.toCell(m.toIndex(cell))).toEqual(cell);
    }
  });

  test('a PIECE is expanded back into its weight-stack; a snake maps straight across', () => {
    const rook = makePiece('R', { x: 4, y: 4 }, 'rook', 5);
    const snake = makeSnake('S', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]);
    const m = marshalBoard(board([rook, snake]), TURN);

    const marshalledRook = m.units.find((u) => u.id === 'R')!;
    // translate.ts collapses a piece to one body cell with `length` = WEIGHT;
    // the engine wants the stack back, because occupancy length IS the weight
    // every contest is decided on.
    expect(marshalledRook.occupancy).toHaveLength(5);
    expect(new Set(marshalledRook.occupancy).size).toBe(1);
    expect(marshalledRook.occupancy[0]).toBe(m.toIndex({ x: 4, y: 4 }));

    const marshalledSnake = m.units.find((u) => u.id === 'S')!;
    expect(marshalledSnake.occupancy).toEqual(
      [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }].map(m.toIndex)
    );
  });

  test('regicide teams are inferred from living kings, and only from them', () => {
    const withKing = marshalBoard(
      board([
        makePiece('K', { x: 4, y: 4 }, 'king', 1, { teamID: 'red' }),
        makePiece('R', { x: 6, y: 6 }, 'rook', 1, { teamID: 'blue' }),
      ]),
      TURN
    );
    expect(withKing.config.regicideTeamIDs).toEqual(['red']);

    const noKings = marshalBoard(
      board([makePiece('R', { x: 6, y: 6 }, 'rook', 1, { teamID: 'blue' })]),
      TURN
    );
    expect(noKings.config.regicideTeamIDs).toEqual([]);
  });

  test('food, hazards and hazard damage cross the boundary intact', () => {
    const m = marshalBoard(
      board([makeSnake('us', [{ x: 5, y: 5 }])], {
        food: [{ x: 2, y: 3 }],
        hazards: [{ x: 7, y: 8 }],
        hazardDamage: 30,
      }),
      TURN
    );
    expect(m.config.food).toEqual([m.toIndex({ x: 2, y: 3 })]);
    expect(m.config.hazards).toEqual([m.toIndex({ x: 7, y: 8 })]);
    expect(m.config.hazardDamage).toBe(30);
  });

  test('the marshalled input is never mutated by resolving a turn with it', () => {
    const snake = makeSnake('us', [{ x: 5, y: 5 }, { x: 5, y: 4 }]);
    const b = board([snake], { food: [{ x: 6, y: 5 }] });
    const before = JSON.stringify(b);
    evaluatePathOnBoard(b, TURN, 'us', [{ x: 6, y: 5 }]);
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe('reading the outcome off a resolved turn', () => {
  test('REGICIDE BY TRADE comes from eliminatedTeamIDs, not from counting kings', () => {
    // Our bishop ties with their LAST king: both die in the same contest, and
    // the engine — not the bot — decides that ends their team.
    const bishop = makePiece('B', { x: 2, y: 2 }, 'bishop', 3, { teamID: 'ours' });
    const king = makePiece('EK', { x: 4, y: 4 }, 'king', 3, { teamID: 'theirs' });
    const spare = makePiece('ER', { x: 9, y: 9 }, 'rook', 4, { teamID: 'theirs' });
    const b = board([bishop, king, spare]);
    const ray = [{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 5 }, { x: 6, y: 6 }];

    // First, straight from the engine: their team is eliminated, and their
    // SPARE rook — nowhere near the fight — dies with it.
    const m = marshalBoard(b, TURN);
    const resolution = resolveTurn({
      ...m.config,
      units: m.units.map((u) =>
        u.id === 'B' ? { ...u, path: ray.map(m.toIndex) } : { ...u, path: [] }
      ),
    });
    expect(resolution.eliminatedTeamIDs).toEqual(['theirs']);
    expect(Object.keys(resolution.deaths).sort()).toEqual(['B', 'EK', 'ER']);
    expect(resolution.deaths.ER.cause).toBe('regicide');

    // And the oracle's reading of exactly that: we die, we are credited with
    // the king we took, and the enemy regicide flag is set because the king we
    // took is the one that ended them.
    const outcome = evaluatePathOnBoard(b, TURN, 'B', ray);
    expect(outcome.fatal).toBe(true);
    expect(outcome.casualties.kills).toBe(1);
    expect(outcome.casualties.enemyRegicide).toBe(1);
    expect(outcome.casualties.regicide).toBe(0);
  });

  test('a team that ends WITHOUT our involvement is not credited to us', () => {
    // Their king walks itself into the wall (its own default is irrelevant —
    // here it simply starts with no health left to spend). Nothing we do
    // caused it, so enemyRegicide stays silent even though a team ended.
    const us = makeSnake('us', [{ x: 1, y: 1 }, { x: 1, y: 2 }], { teamID: 'ours' });
    const king = makePiece('EK', { x: 8, y: 8 }, 'king', 1, {
      teamID: 'theirs',
      health: 1,
    });
    const b = board([us, king], { hazards: [{ x: 8, y: 8 }], hazardDamage: 100 });

    const outcome = evaluatePathOnBoard(b, TURN, 'us', [{ x: 2, y: 1 }]);
    expect(outcome.fatal).toBe(false);
    expect(outcome.casualties.enemyRegicide).toBe(0);
    expect(outcome.casualties.kills).toBe(0);
  });

  test('a death far away is not our kill — attribution is clash participation', () => {
    // An enemy exhausts on a hazard on the other side of the board while we
    // take an ordinary step. It is in `deaths`; it is not in any clash of
    // ours; we are credited with nothing.
    const us = makeSnake('us', [{ x: 1, y: 1 }, { x: 1, y: 2 }], { teamID: 'ours' });
    const doomed = makeSnake('them', [{ x: 9, y: 9 }, { x: 9, y: 8 }], {
      teamID: 'theirs',
      health: 1,
    });
    const b = board([us, doomed], { hazards: [{ x: 9, y: 9 }], hazardDamage: 100 });

    const outcome = evaluatePathOnBoard(b, TURN, 'us', [{ x: 2, y: 1 }]);
    expect(outcome.casualties.kills).toBe(0);
    expect(outcome.cost).toBe(1);
  });

  test('an empty path is a hold: it enters nothing and can hurt nobody', () => {
    const us = makeSnake('us', [{ x: 5, y: 5 }, { x: 5, y: 4 }]);
    const outcome = evaluatePathOnBoard(board([us]), TURN, 'us', []);
    expect(outcome.fatal).toBe(false);
    expect(outcome.cost).toBe(0);
    expect(outcome.traversed).toEqual([]);
    expect(outcome.casualties).toEqual({
      allyCasualty: 0, regicide: 0, kills: 0, enemyRegicide: 0,
    });
  });
});

describe('the oracle is cheap enough to run per candidate', () => {
  test('a crowded board resolves a full queen fan well inside a turn budget', () => {
    // 8 units, and a queen with rays in every direction — the worst realistic
    // shape for candidate enumeration. Each candidate costs a baseline resolve
    // plus at most a handful of head-on hypotheses.
    const snakes: Snake[] = [
      makePiece('Q', { x: 5, y: 5 }, 'queen', 4, { teamID: 'ours' }),
    ];
    for (let i = 0; i < 7; i++) {
      snakes.push(
        makeSnake(`s${i}`, [{ x: i, y: 9 }, { x: i, y: 10 }], { teamID: 'theirs' })
      );
    }
    const b = board(snakes);
    const m = marshalBoard(b, TURN);

    const started = Date.now();
    let candidates = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (let n = 1; n <= 5; n++) {
        const path: number[] = [];
        for (let k = 1; k <= n; k++) path.push(m.toIndex({ x: 5 + dx * k, y: 5 + dy * k }));
        if (path.some((idx) => idx === undefined)) continue;
        evaluatePathOnBoard(b, TURN, 'Q', path.map(m.toCell));
        candidates++;
      }
    }
    const elapsed = Date.now() - started;
    expect(candidates).toBe(40);
    // Generous, because CI machines vary — the point is the order of
    // magnitude. Locally this is single-digit milliseconds for all 40.
    expect(elapsed).toBeLessThan(2000);
  });
});
