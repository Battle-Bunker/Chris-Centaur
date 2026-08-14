/**
 * Chess-piece staging through the ActiveGameManager:
 *  - a piece's goto intent stages its destination as a NUMERIC full-board
 *    index (the wire format) when the target is a legal single move;
 *  - an illegal target stages the piece's own square (= stay);
 *  - an uncommanded piece stages NOTHING (the server defaults to stay), but
 *    Submit All publishes an explicit stay and commits once confirmed;
 *  - numeric read-back confirmations are accepted by the publish pipeline;
 *  - snakes coexisting with pieces keep their direction staging untouched.
 *
 * Board: api 11x11 (full board 13x13 with the perimeter wall).
 */

import { ActiveGameManager } from '../server/active-game-manager';
import { GameState, Snake, Coord, CentaurMove, Direction } from '../types/battlesnake';
import { apiCoordToIndex } from '../firebase/translate';

// Piece commands flow through the same command-event log as snake commands;
// mock the logger so no DB writes leak out of the unit tests (same pattern as
// command-logging.test.ts).
jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return {
    CommandLogger: {
      getInstance: () => ({ logEvent, logTurnState }),
    },
  };
});

const FULL_W = 13;
const FULL_H = 13;
const fullIdx = (api: Coord) => apiCoordToIndex(api, FULL_W, FULL_H);

function makeUnit(
  id: string,
  head: Coord,
  opts: { unitType?: string; facing?: { dx: number; dy: number }; length?: number } = {}
): Snake {
  const isPiece = !!opts.unitType && opts.unitType !== 'snake';
  const cells = isPiece ? 1 : opts.length ?? 3;
  const body: Coord[] = [];
  for (let i = 0; i < cells; i++) {
    body.push({ x: head.x, y: head.y - i });
  }
  const snake: Snake = {
    facing: { dx: 0, dy: -1 },
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head,
    // Pieces: length carries the WEIGHT, independent of the 1-cell body.
    length: isPiece ? opts.length ?? 1 : cells,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
  if (opts.unitType) snake.unitType = opts.unitType;
  if (opts.facing) snake.facing = opts.facing;
  return snake;
}

function makeGameState(
  gameId: string,
  turn: number,
  snakes: Snake[],
  youId: string,
  food: Coord[] = []
): GameState {
  const you = snakes.find((s) => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food, hazards: [], snakes },
    you,
  };
}

interface Published {
  gameId: string;
  snakeId: string;
  turn: number;
  move: CentaurMove;
  source: string;
}

describe('Chess-piece staging (numeric destinations through the goto intent)', () => {
  let mgr: ActiveGameManager;
  let published: Published[];
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    published = [];
    mgr.setMoveSubmitter(async (gameId, snakeId, turn, move, source) => {
      published.push({ gameId, snakeId, turn, move, source });
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    mgr.setMoveCommitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  function publishedFor(snakeId: string): Published[] {
    return published.filter((p) => p.snakeId === snakeId);
  }

  // The transport intake for a controlled PIECE under the canonical-turn
  // pipeline: register, feed the canonical board ONCE (updateBoard runs the
  // goto-arrival shift and advances the board), then the per-piece turn
  // intake (updatePieceTurn refreshes the unit type and re-stages the goto
  // command) — the order the Firebase interface uses.
  function processPieceTurn(
    gameId: string,
    unitId: string,
    snakes: Snake[],
    turn: number,
    food: Coord[] = []
  ) {
    const gs = makeGameState(gameId, turn, snakes, unitId, food);
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has(unitId)) {
      mgr.registerGame(gs, unitId);
    }
    mgr.updateBoard(gameId, gs);
    mgr.updatePieceTurn(gameId, unitId, gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
  }

  test('goto stages a legal rook destination as a numeric full-board index and publishes it', () => {
    const gameId = 'g-piece-rook';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    expect(cs.unitType).toBe('rook');
    // Uncommanded: nothing staged, nothing published (server defaults to stay).
    expect(cs.staged).toBeNull();
    expect(publishedFor('R')).toHaveLength(0);

    cs.selectedBy = 'u1';
    // (5,9) is straight up the rook's file — a legal ray move.
    expect(mgr.setWaypoint(gameId, 'R', { type: 'green', x: 5, y: 9 }, 'u1')).toBe(true);
    const dest = fullIdx({ x: 5, y: 9 });
    expect(cs.staged).toMatchObject({ snakeId: 'R', turn: 0, move: dest, source: 'waypoint' });
    expect(typeof cs.staged!.move).toBe('number');
    expect(publishedFor('R')).toEqual([
      { gameId, snakeId: 'R', turn: 0, move: dest, source: 'waypoint' },
    ]);
    // No direction arrow data: the destination renders via the waypoint overlay.
    expect(mgr.isStagedMoveFatal(gameId, 'R')).toBe(false);
  });

  test('an illegal target stages the piece own square (= stay on the wire)', () => {
    const gameId = 'g-piece-illegal';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    cs.selectedBy = 'u1';

    // (6,9) is neither on the rook's rank nor file.
    expect(mgr.setWaypoint(gameId, 'R', { type: 'green', x: 6, y: 9 }, 'u1')).toBe(true);
    const stay = fullIdx({ x: 5, y: 5 });
    expect(cs.staged).toMatchObject({ turn: 0, move: stay, source: 'waypoint' });
    expect(publishedFor('R').slice(-1)[0].move).toBe(stay);
  });

  test('pawn: forward and diagonal-onto-food are legal; empty diagonal stages stay', () => {
    const gameId = 'g-piece-pawn';
    // Facing +x on the wire (y down). Diagonal-forward squares in api coords
    // are (6,4) and (6,6).
    const pawn = makeUnit('P', { x: 5, y: 5 }, { unitType: 'pawn', facing: { dx: 1, dy: 0 } });
    const food = [{ x: 6, y: 6 }];
    processPieceTurn(gameId, 'P', [pawn], 0, food);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('P')!;
    cs.selectedBy = 'u1';

    // Straight forward.
    expect(mgr.setWaypoint(gameId, 'P', { type: 'green', x: 6, y: 5 }, 'u1')).toBe(true);
    expect(cs.staged!.move).toBe(fullIdx({ x: 6, y: 5 }));

    // Diagonal-forward onto the food square: legal (attack/eat).
    expect(mgr.setWaypoint(gameId, 'P', { type: 'green', x: 6, y: 6 }, 'u1')).toBe(true);
    expect(cs.staged!.move).toBe(fullIdx({ x: 6, y: 6 }));

    // The empty diagonal-forward: illegal → stay.
    expect(mgr.setWaypoint(gameId, 'P', { type: 'green', x: 6, y: 4 }, 'u1')).toBe(true);
    expect(cs.staged!.move).toBe(fullIdx({ x: 5, y: 5 }));
  });

  test('numeric read-back confirmation settles the publish pipeline (no republish)', () => {
    const gameId = 'g-piece-confirm';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    cs.selectedBy = 'u1';
    mgr.setWaypoint(gameId, 'R', { type: 'green', x: 5, y: 9 }, 'u1');
    const dest = fullIdx({ x: 5, y: 9 });
    expect(publishedFor('R')).toHaveLength(1);
    expect(mgr.hasUnconfirmedRequest(gameId, 'R', 0)).toBe(true);

    mgr.setConfirmedStagedMove(gameId, 'R', 0, dest);
    expect(cs.confirmedStaged).toEqual({ turn: 0, move: dest });
    expect(mgr.hasUnconfirmedRequest(gameId, 'R', 0)).toBe(false);

    jest.advanceTimersByTime(3000);
    expect(publishedFor('R')).toHaveLength(1); // no retry needed
  });

  test('Submit All publishes an explicit stay for an uncommanded piece and defers the commit until confirmed', () => {
    const gameId = 'g-piece-commit';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    const commits: Array<{ snakeId: string; turn: number }> = [];
    mgr.setMoveCommitter(async (_gameId, snakeId, turn) => {
      commits.push({ snakeId, turn });
    });
    processPieceTurn(gameId, 'R', [rook], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    expect(cs.staged).toBeNull();

    const stay = fullIdx({ x: 5, y: 5 });
    expect(mgr.commitAllStaged(gameId).affected).toEqual(['R']);
    // The stay was staged + published; the commit waits for confirmation
    // (commitment is binding — freezing an unconfirmed move could freeze the
    // wrong one).
    expect(cs.staged).toMatchObject({ turn: 0, move: stay });
    expect(publishedFor('R').slice(-1)[0].move).toBe(stay);
    expect(cs.pendingCommitTurn).toBe(0);
    expect(commits).toEqual([]);

    // The numeric confirmation lands → the deferred commit fires.
    mgr.setConfirmedStagedMove(gameId, 'R', 0, stay);
    expect(commits).toEqual([{ snakeId: 'R', turn: 0 }]);
  });

  test('goto queue shifts on piece arrival (head comparison only) and the piece then stages nothing new', () => {
    const gameId = 'g-piece-arrive';
    const rook0 = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook0], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    cs.selectedBy = 'u1';
    mgr.setWaypoint(gameId, 'R', { type: 'green', x: 5, y: 9 }, 'u1');
    expect(cs.intent.kind).toBe('goto');

    // Next turn: the rook arrived at the target — the queue empties and the
    // intent reverts to heuristic.
    const rook1 = makeUnit('R', { x: 5, y: 9 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook1], 1);
    expect(cs.intent.kind).toBe('heuristic');
  });

  test('pawn promotion refreshes the controlled unit type from the latest board', () => {
    const gameId = 'g-piece-promote';
    const pawn = makeUnit('P', { x: 5, y: 5 }, { unitType: 'pawn', facing: { dx: 1, dy: 0 } });
    processPieceTurn(gameId, 'P', [pawn], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('P')!;
    expect(cs.unitType).toBe('pawn');

    const queen = makeUnit('P', { x: 5, y: 5 }, { unitType: 'queen', length: 10 });
    processPieceTurn(gameId, 'P', [queen], 1);
    expect(cs.unitType).toBe('queen');

    // And the new type governs legality: a diagonal is now a legal queen ray.
    cs.selectedBy = 'u1';
    expect(mgr.setWaypoint(gameId, 'P', { type: 'green', x: 8, y: 8 }, 'u1')).toBe(true);
    expect(cs.staged!.move).toBe(fullIdx({ x: 8, y: 8 }));
  });

  test('snakes coexisting with pieces keep their direction staging (paths never cross)', () => {
    const gameId = 'g-mixed';
    const snake = makeUnit('S', { x: 2, y: 5 });
    const rook = makeUnit('R', { x: 8, y: 5 }, { unitType: 'rook' });

    // Snake intake (the normal bot path).
    const gsSnake = makeGameState(gameId, 0, [snake, rook], 'S');
    mgr.registerGame(gsSnake, 'S');
    mgr.updateBoard(gameId, gsSnake);
    mgr.setBotRecommendation(gameId, 'S', 'right', {
      gameState: gsSnake,
      moveEvaluations: [],
      territoryCells: {},
      safeMoves: ['up', 'down', 'left', 'right'],
      botRecommendation: 'right',
      timestamp: Date.now(),
    });

    // Piece intake.
    processPieceTurn(gameId, 'R', [snake, rook], 0);

    const csS = mgr.getGame(gameId)!.controlledSnakes.get('S')!;
    const csR = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    expect(csS.unitType).toBe('snake');
    expect(csS.staged).toMatchObject({ move: 'right', source: 'bot' });
    expect(csR.staged).toBeNull(); // pieces get no bot recommendation

    // Manual direction staging is refused for pieces (defense in depth).
    csR.selectedBy = 'u1';
    mgr.setUserSelection(gameId, 'R', 'up' as Direction);
    expect(csR.staged).toBeNull();
    expect(csR.intent.kind).toBe('heuristic');
  });
});

describe('Generalized candidate UI: stub evaluations, numeric manual staging, rotations', () => {
  let mgr: ActiveGameManager;
  let published: Published[];
  let warnSpy: jest.SpyInstance;
  const turnUpdates: Array<{ gameId: string; snakeId: string; turnData: any }> = [];

  beforeAll(() => {
    // The manager is a singleton with an append-only callback list; register
    // one collector and filter per test by gameId.
    ActiveGameManager.getInstance().onTurnUpdate((gameId, snakeId, turnData) => {
      turnUpdates.push({ gameId, snakeId, turnData });
    });
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    published = [];
    turnUpdates.length = 0;
    mgr.setMoveSubmitter(async (gameId, snakeId, turn, move, source) => {
      published.push({ gameId, snakeId, turn, move, source });
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    mgr.setMoveCommitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  function processPieceTurn(
    gameId: string,
    unitId: string,
    snakes: Snake[],
    turn: number,
    food: Coord[] = []
  ) {
    const gs = makeGameState(gameId, turn, snakes, unitId, food);
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has(unitId)) {
      mgr.registerGame(gs, unitId);
    }
    mgr.updateBoard(gameId, gs);
    mgr.updatePieceTurn(gameId, unitId, gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
  }

  test('updatePieceTurn fills turn data with a zero-scored stub evaluation per legal candidate and broadcasts it', () => {
    const gameId = 'g-stub-eval';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    const evals = cs.latestTurnData!.moveEvaluations;
    // 11x11 interior rook at (5,5): 10 file + 10 rank + stay.
    expect(evals).toHaveLength(21);
    const stay = fullIdx({ x: 5, y: 5 });
    for (const e of evals) {
      expect(typeof e.move).toBe('number');
      expect(e.score).toBe(0);
      expect(e.numStates).toBe(0);
      expect(e.breakdown).toEqual({ weights: {}, weighted: {} });
      expect(e.dest).toBeDefined();
      expect(e.kind).toBe(e.move === stay ? 'stay' : 'move');
    }
    // The stay candidate maps back to the piece's own api square.
    const stayEval = evals.find((e) => e.move === stay)!;
    expect(stayEval.dest).toEqual({ x: 5, y: 5 });
    // Other turn-data fields keep the snake contract shape.
    expect(cs.latestTurnData!.safeMoves).toEqual([]);
    expect(cs.latestTurnData!.botRecommendation).toBeNull();

    // The previously-missing broadcast: the piece's turn intake notifies.
    const updates = turnUpdates.filter((u) => u.gameId === gameId && u.snakeId === 'R');
    expect(updates).toHaveLength(1);
    expect(updates[0].turnData.moveEvaluations).toHaveLength(21);
  });

  test('pawn stub evaluations enumerate forward, rotations, stay, and diagonal-onto-food', () => {
    const gameId = 'g-stub-pawn';
    // Wire facing +x (y down): forward api (6,5); rotations api (5,4)/(5,6);
    // diagonal-forward api squares are (6,4) and (6,6).
    const pawn = makeUnit('P', { x: 5, y: 5 }, { unitType: 'pawn', facing: { dx: 1, dy: 0 } });
    processPieceTurn(gameId, 'P', [pawn], 0, [{ x: 6, y: 6 }]);

    const evals = mgr.getGame(gameId)!.controlledSnakes.get('P')!.latestTurnData!.moveEvaluations;
    const byMove = new Map(evals.map((e) => [e.move, e]));
    // forward + 2 rotations + stay + 1 diagonal (only the food one).
    expect(evals).toHaveLength(5);
    expect(byMove.get(fullIdx({ x: 6, y: 5 }))!.kind).toBe('move');
    expect(byMove.get(fullIdx({ x: 5, y: 5 }))!.kind).toBe('stay');
    expect(byMove.get(fullIdx({ x: 6, y: 6 }))!.kind).toBe('move'); // eat
    expect(byMove.get(fullIdx({ x: 5, y: 4 }))!.kind).toBe('rotate');
    expect(byMove.get(fullIdx({ x: 5, y: 6 }))!.kind).toBe('rotate');
    expect(byMove.has(fullIdx({ x: 6, y: 4 }))).toBe(false); // empty diagonal
  });

  test('setUserSelection accepts a numeric destination for a piece and stages it as manual', () => {
    const gameId = 'g-manual-num';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    cs.selectedBy = 'u1';

    const dest = fullIdx({ x: 5, y: 9 });
    mgr.setUserSelection(gameId, 'R', dest);
    expect(cs.intent).toEqual({ kind: 'manual', move: dest });
    expect(cs.staged).toMatchObject({ snakeId: 'R', turn: 0, move: dest, source: 'manual' });
    // The recorded action carries the full traversed ray, ending on the dest.
    expect(cs.staged!.action!.kind).toBe('move');
    const path = (cs.staged!.action as { kind: 'move'; path: number[] }).path;
    expect(path[path.length - 1]).toBe(dest);
    expect(path).toHaveLength(4);
    expect(publishedFor(gameId, 'R').slice(-1)[0]).toMatchObject({ move: dest, source: 'manual' });

    // An out-of-bounds destination is refused outright (no staging change).
    mgr.setUserSelection(gameId, 'R', 13 * 13);
    expect(cs.staged!.move).toBe(dest);
    // A numeric move for a SNAKE is refused symmetrically.
    const snakeGame = 'g-manual-num-snake';
    const snake = makeUnit('S', { x: 2, y: 5 });
    const gs = makeGameState(snakeGame, 0, [snake], 'S');
    mgr.registerGame(gs, 'S');
    mgr.updateBoard(snakeGame, gs);
    const csS = mgr.getGame(snakeGame)!.controlledSnakes.get('S')!;
    csS.selectedBy = 'u1';
    mgr.setUserSelection(snakeGame, 'S', 42);
    expect(csS.intent.kind).toBe('heuristic');
  });

  test('a manual illegal destination stages the own square (stay), never a direction', () => {
    const gameId = 'g-manual-illegal';
    const rook = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    cs.selectedBy = 'u1';

    // In-bounds but off the rook's rank/file → legality resolver stages stay.
    mgr.setUserSelection(gameId, 'R', fullIdx({ x: 6, y: 9 }));
    expect(cs.staged).toMatchObject({ turn: 0, move: fullIdx({ x: 5, y: 5 }), source: 'manual' });
    expect(cs.staged!.action).toEqual({ kind: 'stay' });
  });

  test('staging a pawn side square records the rotation and projects it on the staged-move view', () => {
    const gameId = 'g-rotate';
    const pawn = makeUnit('P', { x: 5, y: 5 }, { unitType: 'pawn', facing: { dx: 1, dy: 0 } });
    processPieceTurn(gameId, 'P', [pawn], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('P')!;
    cs.selectedBy = 'u1';

    // api (5,4) is the full-board side square (6,7): quarter turn to face +y (wire).
    const side = fullIdx({ x: 5, y: 4 });
    mgr.setUserSelection(gameId, 'P', side);
    expect(cs.staged).toMatchObject({ turn: 0, move: side, source: 'manual' });
    expect(cs.staged!.action).toEqual({ kind: 'rotate', facing: { dx: 0, dy: 1 } });

    const view = mgr.getStagedMovesForGame(gameId)['P'];
    expect(view.requestedMove).toBe(side);
    expect(view.rotation).toEqual({ dx: 0, dy: 1 });
    // The wire sees only the numeric destination — rotation is presentation.
    expect(publishedFor(gameId, 'P').slice(-1)[0].move).toBe(side);

    // A non-rotation staging projects no rotation.
    mgr.setUserSelection(gameId, 'P', fullIdx({ x: 6, y: 5 }));
    expect(mgr.getStagedMovesForGame(gameId)['P'].rotation).toBeNull();
  });

  test('a manual destination is single-turn: the next piece turn intake resets it to heuristic', () => {
    const gameId = 'g-manual-stale';
    const rook0 = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook0], 0);
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('R')!;
    cs.selectedBy = 'u1';

    mgr.setUserSelection(gameId, 'R', fullIdx({ x: 5, y: 9 }));
    expect(cs.intent.kind).toBe('manual');
    expect(cs.staged).toMatchObject({ turn: 0 });

    // Turn advances (the rook did not move): the stale manual reverts to the
    // heuristic and nothing is staged — the server defaults the piece to stay.
    const rook1 = makeUnit('R', { x: 5, y: 5 }, { unitType: 'rook' });
    processPieceTurn(gameId, 'R', [rook1], 1);
    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.staged).toBeNull();
  });

  function publishedFor(gameId: string, snakeId: string): Published[] {
    return published.filter((p) => p.gameId === gameId && p.snakeId === snakeId);
  }
});
