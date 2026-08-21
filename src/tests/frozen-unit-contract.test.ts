/**
 * THE PARTIAL-TIME-ADVANCE CONTRACT, pinned at both call sites.
 *
 * The bot advances only the units it is modelling. Everything else is FROZEN —
 * one turn behind in time, not standing still by choice — and a frozen unit is
 * a COLLISION INCUMBENT AND NOTHING ELSE:
 *
 *   it blocks, it contests at its frozen tier and weight, and a simulated
 *   mover can kill it, sever it, or lose to it (all real, all kept);
 *   but it pays no hazard dose and no movement cost, eats nothing, never
 *   exhausts, never dies of the passage of time, and never triggers regicide
 *   except through a genuine interaction with something we did simulate.
 *
 * This has always been the bot's behaviour — before the engine was vendored,
 * frozen units were simply left out of the hand-written collision pass. The
 * vendored engine has no notion of it: to the engine an empty-path unit HELD,
 * and holding is a real action with real consequences (a stationary hazard
 * dose, a meal at its cell, exhaustion, and the regicide that cascades from
 * it). `resolvePartialTurn` reconciles the two on the bot's side.
 *
 * Every test here fails if that reconciliation is removed — verified, not
 * assumed. They cover BOTH call sites: candidate scoring (turn-oracle) and
 * multi-turn lookahead (Simulator).
 */

import { Simulator, MoveSet } from '../logic/simulator';
import { marshalBoard, resolvePartialTurn } from '../logic/turn-oracle';
import { Board, Coord, Direction, GameState, Snake } from '../types/battlesnake';

const TURN = 10;

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

const makePiece = (id: string, at: Coord, unitType: string, weight: number, extra: Partial<Snake> = {}) =>
  makeSnake(id, [at], { unitType, length: weight, ...extra });

const board = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 11, height: 11, food: [], hazards: [], snakes, ...extra } as Board);

const gameState = (b: Board, youId: string): GameState =>
  ({
    game: { id: 'frozen', ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn: TURN,
    board: b,
    you: b.snakes.find((s) => s.id === youId)!,
  } as GameState);

const moves = (entries: [string, Direction][]): MoveSet => new Map(entries);

/** Resolve with only `stagedId` taking a turn — the shape both call sites use. */
function resolveOnly(b: Board, stagedId: string, path: Coord[]) {
  const m = marshalBoard(b, TURN);
  return {
    m,
    result: resolvePartialTurn(m, new Map([[stagedId, { path: path.map(m.toIndex) }]])),
  };
}

// A mover parked far away, so the only thing under test is what happens to the
// frozen unit while somebody else takes an ordinary step.
const bystander = () => makeSnake('mover', [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]);

describe('a frozen unit does not experience time — candidate scoring', () => {
  test('a frozen snake on a HAZARD keeps its health, and is not in deaths', () => {
    const frozen = makeSnake('frozen', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { health: 40 });
    const b = board([bystander(), frozen], { hazards: [{ x: 5, y: 5 }], hazardDamage: 30 });

    const { result } = resolveOnly(b, 'mover', [{ x: 2, y: 1 }]);

    expect(result.board.frozen.health).toBe(40); // not 10
    expect(result.deaths.frozen).toBeUndefined();
    expect(result.exhaustions.map((e) => e.unitID)).not.toContain('frozen');
  });

  test('a frozen snake on a LETHAL hazard does not die of it', () => {
    const frozen = makeSnake('frozen', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { health: 50 });
    const b = board([bystander(), frozen], { hazards: [{ x: 5, y: 5 }], hazardDamage: 100 });

    const { result } = resolveOnly(b, 'mover', [{ x: 2, y: 1 }]);

    expect(result.deaths).toEqual({});
    expect(result.board.frozen.health).toBe(50);
  });

  test('a frozen PIECE is covered too — the engine dose is kind-blind, so the repair must be', () => {
    const frozen = makePiece('R', { x: 5, y: 5 }, 'rook', 4, { health: 40 });
    const b = board([bystander(), frozen], { hazards: [{ x: 5, y: 5 }], hazardDamage: 30 });

    const { result } = resolveOnly(b, 'mover', [{ x: 2, y: 1 }]);

    expect(result.board.R.health).toBe(40);
    expect(result.deaths.R).toBeUndefined();
  });

  test('a frozen snake on FOOD does not eat: no growth, no heal, and the food survives', () => {
    const frozen = makeSnake('frozen', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { health: 40 });
    const b = board([bystander(), frozen], { food: [{ x: 5, y: 5 }] });
    const { m, result } = resolveOnly(b, 'mover', [{ x: 2, y: 1 }]);

    expect(result.board.frozen.health).toBe(40); // not restored to the type max
    expect(result.board.frozen.occupancy).toHaveLength(2); // not grown to 3
    // The meal is still on the board for whoever actually arrives on it.
    expect(result.food).toContain(m.toIndex({ x: 5, y: 5 }));
  });

  test('a frozen KING on a lethal hazard produces NO eliminatedTeamIDs', () => {
    // The catastrophe this guards against: a king that has merely not moved
    // yet "dying of time" and wiping its whole team out of the projection.
    const king = makePiece('K', { x: 5, y: 5 }, 'king', 1, { teamID: 'red', health: 50 });
    const ally = makePiece('R', { x: 8, y: 8 }, 'rook', 3, { teamID: 'red' });
    const b = board([bystander(), king, ally], { hazards: [{ x: 5, y: 5 }], hazardDamage: 100 });

    const { result } = resolveOnly(b, 'mover', [{ x: 2, y: 1 }]);

    expect(result.eliminatedTeamIDs).toEqual([]);
    expect(result.deaths).toEqual({});
    expect(Object.keys(result.board).sort()).toEqual(['K', 'R', 'mover']);
  });
});

describe('a frozen unit is still a full collision incumbent', () => {
  test('it BLOCKS a simulated mover, and the mover dies on it', () => {
    const frozen = makeSnake('frozen', [{ x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }]);
    const mover = makeSnake('mover', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);
    const b = board([mover, frozen], { hazards: [{ x: 6, y: 5 }], hazardDamage: 30 });

    // Stepping onto the frozen snake's head cell: an equal-weight contest,
    // which leaves nobody standing. The frozen unit's death here is REAL — a
    // simulated mover's interaction — and it is kept.
    const { result } = resolveOnly(b, 'mover', [{ x: 6, y: 5 }]);
    expect(result.deaths.mover).toBeDefined();
    expect(result.deaths.frozen).toBeDefined();
    expect(result.deaths.frozen.cause).toBe('contest');
  });

  test('it contests at its FROZEN WEIGHT — heavier wins, lighter loses', () => {
    const heavy = makeSnake('frozen', [
      { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }, { x: 6, y: 8 },
    ]);
    const light = makeSnake('mover', [{ x: 5, y: 5 }, { x: 4, y: 5 }]);
    const lost = resolveOnly(board([light, heavy]), 'mover', [{ x: 6, y: 5 }]).result;
    expect(lost.deaths.mover).toBeDefined();
    expect(lost.deaths.frozen).toBeUndefined();

    const bigMover = makeSnake('mover', [
      { x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 },
    ]);
    const smallFrozen = makeSnake('frozen', [{ x: 6, y: 5 }, { x: 6, y: 6 }]);
    const won = resolveOnly(board([bigMover, smallFrozen]), 'mover', [{ x: 6, y: 5 }]).result;
    expect(won.deaths.frozen).toBeDefined();
    expect(won.deaths.mover).toBeUndefined();
  });

  test('a frozen unit killed by a mover DOES cascade regicide — that interaction is real', () => {
    // The other side of the king test above: when the king dies because we
    // actually took it, the team really does end.
    const king = makePiece('K', { x: 6, y: 5 }, 'king', 1, { teamID: 'red' });
    const ally = makePiece('R', { x: 8, y: 8 }, 'rook', 3, { teamID: 'red' });
    const mover = makeSnake('mover', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], {
      teamID: 'blue',
    });
    const { result } = resolveOnly(board([mover, king, ally]), 'mover', [{ x: 6, y: 5 }]);

    expect(result.eliminatedTeamIDs).toEqual(['red']);
    expect(result.deaths.K).toBeDefined();
    expect(result.deaths.R.cause).toBe('regicide');
  });

  test('a frozen snake severed by a mover keeps the cut — occupancy repair is not a rollback', () => {
    const frozen = makeSnake('frozen', [
      { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 },
    ]);
    const cutter = makeSnake('mover', [{ x: 5, y: 5 }, { x: 4, y: 5 }], {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: 99,
    });
    const { m, result } = resolveOnly(board([cutter, frozen]), 'mover', [{ x: 6, y: 5 }]);

    expect(result.severedCells.frozen?.length).toBeGreaterThan(0);
    expect(result.board.frozen.occupancy.length).toBeLessThan(4);
    expect(result.board.frozen.occupancy[0]).toBe(m.toIndex({ x: 6, y: 4 }));
  });
});

describe('the same contract in multi-turn lookahead (Simulator)', () => {
  const simulator = new Simulator();

  test('an unsimulated snake on a hazard neither loses health nor dies', () => {
    const us = makeSnake('us', [{ x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 1 }]);
    const frozen = makeSnake('frozen', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { health: 20 });
    const gs = gameState(
      board([us, frozen], { hazards: [{ x: 5, y: 5 }], hazardDamage: 100 }),
      'us'
    );

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'up']]));

    expect(result.deadSnakeIds.has('frozen')).toBe(false);
    expect(result.board.snakes.find((s) => s.id === 'frozen')!.health).toBe(20);
  });

  test('an unsimulated snake on food does not eat it — it is still there next turn', () => {
    const us = makeSnake('us', [{ x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 1 }]);
    const frozen = makeSnake('frozen', [{ x: 5, y: 5 }, { x: 5, y: 6 }], { health: 30 });
    const gs = gameState(board([us, frozen], { food: [{ x: 5, y: 5 }] }), 'us');

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'up']]));

    const sim = result.board.snakes.find((s) => s.id === 'frozen')!;
    expect(sim.health).toBe(30);
    expect(sim.length).toBe(2);
    expect(result.board.food).toEqual([{ x: 5, y: 5 }]);
  });

  test('an unsimulated KING on a lethal hazard does not eliminate its team', () => {
    const us = makeSnake('us', [{ x: 1, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 1 }], { teamID: 'blue' });
    const king = makePiece('K', { x: 5, y: 5 }, 'king', 1, { teamID: 'red', health: 10 });
    const ally = makePiece('R', { x: 8, y: 8 }, 'rook', 3, { teamID: 'red' });
    const gs = gameState(
      board([us, king, ally], { hazards: [{ x: 5, y: 5 }], hazardDamage: 100 }),
      'us'
    );

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'up']]));

    expect(result.deadSnakeIds.size).toBe(0);
    expect(result.board.snakes.map((s) => s.id).sort()).toEqual(['K', 'R', 'us']);
  });

  test('and it still blocks: stepping into an unsimulated body is still fatal', () => {
    const us = makeSnake('us', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);
    const frozen = makeSnake('frozen', [
      { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 },
    ]);
    const gs = gameState(board([us, frozen]), 'us');

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));
    expect(result.deadSnakeIds.has('us')).toBe(true);
    expect(result.deadSnakeIds.has('frozen')).toBe(false);
  });
});
