/**
 * Weight-contest passability for stationary chess pieces, end to end:
 *
 * The engine adjudicates a stationary piece's square tier-FIRST, weight
 * second: everyone below the top invulnerability tier at the square dies with
 * weight never consulted; among the top tier the unique heaviest survives and
 * ties kill all. For our snake (tier T, weight/length W) vs a piece (tier t,
 * weight w = its `length`):
 *   t < T  -> we WIN regardless of weights;
 *   t == T -> we win iff W > w strictly (W <= w is death — ties kill both);
 *   t > T  -> we DIE regardless of weights.
 *
 * Pinned here:
 *  - BoardGraph subjective passability: a piece square is passable iff the
 *    subject WINS; the physical layer keeps it a wall (the severability
 *    pattern — subjective win-grant, physical block);
 *  - flood fills flow through winnable piece squares (phantom-wall fix),
 *    including the trapped signal through the evaluator;
 *  - the Simulator resolves mover-vs-piece contests (a won contest kills the
 *    piece with no growth and no health restore — a piece is not food);
 *  - the staging fatal gate and MoveAnalyzer fatality classification: a
 *    winnable piece square is a legal move, a losing/tying one certain death.
 */

import { BoardGraph, fillNeighbors4 } from '../logic/board-graph';
import { BoardEvaluator } from '../logic/board-evaluator';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { Simulator, MoveSet } from '../logic/simulator';
import { ActiveGameManager } from '../server/active-game-manager';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

// The fatal-gate tests drive the ActiveGameManager, whose command paths log
// through the CommandLogger; mock it so no DB writes leak out of unit tests.
jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return {
    CommandLogger: {
      getInstance: () => ({ logEvent, logTurnState }),
    },
  };
});

const TURN = 10;
const FAR_EXPIRY = 1000;

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    health: 100,
    body,
    head: body[0],
    length: body.length,
    latency: '0',
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  };
}

/** A chess piece: 1-cell body, `length` = WEIGHT (the collapsed stack size). */
function makePiece(
  id: string,
  square: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake {
  return makeSnake(id, [square], { length: weight, unitType, ...extra });
}

function makeGameState(snakes: Snake[], youId: string, turn = TURN, gameId = 'piece-contest-test'): GameState {
  return {
    game: {
      id: gameId,
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard',
    },
    turn,
    board: { width: 11, height: 11, snakes, food: [], hazards: [] },
    you: snakes.find((s) => s.id === youId)!,
  };
}

const moves = (entries: [string, Direction][]): MoveSet => new Map(entries);

// Us: length 5, head (5,5), body straight down.
function usSnake(extra: Partial<Snake> = {}): Snake {
  return makeSnake('us', [
    { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }, { x: 5, y: 1 },
  ], extra);
}

/** Is the piece's square at (6,5) passable for 'us' arriving next turn? */
function pieceSquarePassable(us: Snake, piece: Snake): boolean {
  const gs = makeGameState([us, piece], 'us');
  const graph = new BoardGraph(gs);
  const pass = graph.passabilityIdxFor('us', { clearance: 'optimistic' });
  return pass.passableIdx(graph.cellIndexOf(piece.head), 1);
}

describe('BoardGraph: stationary piece square passability (tier first, weight second)', () => {
  test('a strictly lower-tier piece is passable regardless of weight', () => {
    const us = usSnake({ invulnerabilityLevel: 1, invulnerabilityExpiryTurn: FAR_EXPIRY });
    const queen = makePiece('q', { x: 6, y: 5 }, 'queen', 50);
    expect(pieceSquarePassable(us, queen)).toBe(true);
  });

  test('equal tier: passable only when we are STRICTLY heavier', () => {
    expect(pieceSquarePassable(usSnake(), makePiece('p', { x: 6, y: 5 }, 'pawn', 3))).toBe(true);
    // Equal weight: the tie kills both — impassable.
    expect(pieceSquarePassable(usSnake(), makePiece('p', { x: 6, y: 5 }, 'pawn', 5))).toBe(false);
    expect(pieceSquarePassable(usSnake(), makePiece('p', { x: 6, y: 5 }, 'pawn', 7))).toBe(false);
  });

  test('a higher-tier piece is impassable even for a much heavier snake', () => {
    const us = usSnake({ length: 20 }); // weight 20 vs the pawn's 1
    const pawn = makePiece('p', { x: 6, y: 5 }, 'pawn', 1, {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: FAR_EXPIRY,
    });
    expect(pieceSquarePassable(us, pawn)).toBe(false);
  });

  test('tiers are projected to the arrival turn (expiry convention)', () => {
    // The piece's level expires THIS turn (expiry = current turn), so at the
    // arrival turn it is tier 0 and plain weight comparison applies.
    const lapsed = makePiece('p', { x: 6, y: 5 }, 'pawn', 3, {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: TURN,
    });
    expect(pieceSquarePassable(usSnake(), lapsed)).toBe(true);

    // A still-live level at the arrival turn blocks regardless of weight.
    const live = makePiece('p', { x: 6, y: 5 }, 'pawn', 3, {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: TURN + 1,
    });
    expect(pieceSquarePassable(usSnake(), live)).toBe(false);
  });

  test('the PHYSICAL layer keeps every piece square a wall (win-grant is subjective only)', () => {
    const us = usSnake({ invulnerabilityLevel: 3, invulnerabilityExpiryTurn: FAR_EXPIRY });
    const pawn = makePiece('p', { x: 6, y: 5 }, 'pawn', 1);
    const gs = makeGameState([us, pawn], 'us');
    const graph = new BoardGraph(gs);
    const idx = graph.cellIndexOf(pawn.head);
    expect(graph.isPassableStaticIdx(idx)).toBe(false);
    expect(graph.isPassableAtTurnIdx(idx, 1)).toBe(false);
    expect(graph.isPassableAtTurnIdx(idx, 5)).toBe(false); // frozen — never recedes
    // ...while the same square IS subjectively passable for the winning snake.
    expect(graph.passabilityIdxFor('us', { clearance: 'optimistic' })
      .passableIdx(idx, 1)).toBe(true);
  });
});

describe('flood fills through a winnable pawn screen (phantom-wall fix)', () => {
  // Full-height pawn screen on column x=5; us (length 5) on column x=2.
  function screenState(pawnWeight: number): GameState {
    const us = makeSnake('us', [
      { x: 2, y: 5 }, { x: 2, y: 4 }, { x: 2, y: 3 }, { x: 2, y: 2 }, { x: 2, y: 1 },
    ]);
    const pawns = Array.from({ length: 11 }, (_, y) =>
      makePiece(`p${y}`, { x: 5, y }, 'pawn', pawnWeight));
    return makeGameState([us, ...pawns], 'us');
  }

  /** Subjective optimistic flood fill from the snake's head (the same layer every evaluation flood walks). */
  function reachableIdx(graph: BoardGraph, id: string): Set<number> {
    const pass = graph.passabilityIdxFor(id, { clearance: 'optimistic' });
    const W = graph.boardWidth;
    const N = graph.cellCount;
    const visited = new Set<number>([pass.headIdx]);
    let frontier = [pass.headIdx];
    const nbuf = new Int32Array(4);
    for (let turn = 1; frontier.length > 0; turn++) {
      const next: number[] = [];
      for (const cur of frontier) {
        const n = fillNeighbors4(cur, W, N, nbuf);
        for (let t = 0; t < n; t++) {
          const cell = nbuf[t];
          if (visited.has(cell)) continue;
          if (!pass.passableIdx(cell, turn)) continue;
          visited.add(cell);
          next.push(cell);
        }
      }
      frontier = next;
    }
    return visited;
  }

  test('a winnable screen (lighter pawns) is no wall: the far side is reachable', () => {
    const gs = screenState(3); // 3 < our 5 -> we win every contest
    const graph = new BoardGraph(gs);
    const reached = reachableIdx(graph, 'us');
    expect(reached.has(graph.cellIndex(5, 5))).toBe(true); // the pawn square itself
    expect(reached.has(graph.cellIndex(8, 5))).toBe(true); // behind the screen
  });

  test('an equal-weight screen is a real wall: the far side is unreachable', () => {
    const gs = screenState(5); // 5 == our 5 -> every contest is a lethal tie
    const graph = new BoardGraph(gs);
    const reached = reachableIdx(graph, 'us');
    expect(reached.has(graph.cellIndex(4, 5))).toBe(true);  // up to the screen
    expect(reached.has(graph.cellIndex(5, 5))).toBe(false); // not onto it
    expect(reached.has(graph.cellIndex(8, 5))).toBe(false); // not behind it
  });

  test('the trapped signal flows through: a pawn-sealed corner pocket is fatal only when the pawns are unwinnable', () => {
    // Us (length 3) in the corner; pawns seal the pocket completely.
    function cornerState(pawnWeight: number): GameState {
      const us = makeSnake('us', [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }]);
      const pawns = [
        makePiece('p1', { x: 1, y: 0 }, 'pawn', pawnWeight),
        makePiece('p2', { x: 1, y: 1 }, 'pawn', pawnWeight),
        makePiece('p3', { x: 1, y: 2 }, 'pawn', pawnWeight),
        makePiece('p4', { x: 0, y: 3 }, 'pawn', pawnWeight),
      ];
      return makeGameState([us, ...pawns], 'us');
    }
    const evaluator = new BoardEvaluator();
    const team = new Set(['us']);
    // Winnable pawns (weight 2 < 3): the seal opens, plenty of room.
    expect(evaluator.evaluateBoard(cornerState(2), 'us', team).stats.trapped).toBe(0);
    // Equal-weight pawns: every exit is a lethal tie — a fatal pocket.
    expect(evaluator.evaluateBoard(cornerState(3), 'us', team).stats.trapped).toBe(1);
  });
});

describe('Simulator: mover vs stationary piece contest', () => {
  const simulator = new Simulator();

  function run(us: Snake, piece: Snake) {
    const gs = makeGameState([us, piece], 'us');
    return simulator.simulateNextBoardState(gs, moves([['us', 'right']]));
  }

  test('equal tier, we are heavier: the piece DIES, we survive with no growth and no heal', () => {
    const us = usSnake(); // length 5
    const result = run(us, makePiece('p', { x: 6, y: 5 }, 'pawn', 2));
    expect(result.deadSnakeIds).toEqual(new Set(['p']));
    const survivor = result.board.snakes.find((s) => s.id === 'us')!;
    expect(survivor.head).toEqual({ x: 6, y: 5 });
    expect(survivor.length).toBe(5);      // a piece is not food — no growth
    expect(survivor.health).toBe(99);     // plain movement cost, no restore
    expect(result.board.snakes.find((s) => s.id === 'p')).toBeUndefined();
  });

  test('equal tier, equal weight: the tie kills BOTH', () => {
    const result = run(usSnake(), makePiece('p', { x: 6, y: 5 }, 'pawn', 5));
    expect(result.deadSnakeIds).toEqual(new Set(['us', 'p']));
    expect(result.board.snakes).toHaveLength(0);
  });

  test('equal tier, the piece is heavier: we die, the piece stands', () => {
    const result = run(usSnake(), makePiece('p', { x: 6, y: 5 }, 'pawn', 9));
    expect(result.deadSnakeIds).toEqual(new Set(['us']));
    expect(result.board.snakes.map((s) => s.id)).toEqual(['p']);
  });

  test('strict tier superiority wins regardless of weight (and kills the piece)', () => {
    const us = usSnake({ invulnerabilityLevel: 1, invulnerabilityExpiryTurn: FAR_EXPIRY });
    const result = run(us, makePiece('q', { x: 6, y: 5 }, 'queen', 50));
    expect(result.deadSnakeIds).toEqual(new Set(['q']));
    expect(result.board.snakes.map((s) => s.id)).toEqual(['us']);
  });

  test('a higher-tier piece kills the mover regardless of weight', () => {
    const piece = makePiece('p', { x: 6, y: 5 }, 'pawn', 1, {
      invulnerabilityLevel: 1,
      invulnerabilityExpiryTurn: FAR_EXPIRY,
    });
    const result = run(usSnake(), piece);
    expect(result.deadSnakeIds).toEqual(new Set(['us']));
    expect(result.board.snakes.map((s) => s.id)).toEqual(['p']);
  });
});

describe('MoveAnalyzer fatality classification around pieces', () => {
  const analyzer = new MoveAnalyzer();

  test('a winnable piece square is a legal candidate (safe when nothing threatens it)', () => {
    const gs = makeGameState([usSnake(), makePiece('r', { x: 6, y: 5 }, 'rook', 3)], 'us');
    const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));
    // Rook weight 3 < our 5: we win both the square contest and any contest
    // the rook could bring to us, so 'right' is a plain safe move.
    expect(analysis.safe).toContain('right');
    expect(analysis.risky).not.toContain('right');
  });

  test('an equal-weight piece square is excluded as certain death', () => {
    const gs = makeGameState([usSnake(), makePiece('r', { x: 6, y: 5 }, 'rook', 5)], 'us');
    const analysis = analyzer.analyzeMoves(gs.you, gs, new BoardGraph(gs));
    expect(analysis.safe).not.toContain('right');
    expect(analysis.risky).not.toContain('right');
    expect(analysis.h2hRiskByMove.has('right')).toBe(false);
  });
});

describe('staging fatal gate (ActiveGameManager.isMoveFatal)', () => {
  let mgr: ActiveGameManager;

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function isFatal(gameId: string, pieceWeight: number, pieceExtra: Partial<Snake> = {}): boolean {
    const us = usSnake();
    const pawn = makePiece('p', { x: 6, y: 5 }, 'pawn', pieceWeight, pieceExtra);
    const gs = makeGameState([us, pawn], 'us', TURN, gameId);
    mgr.registerGame(gs, 'us');
    return (mgr as unknown as {
      isMoveFatal(gameId: string, snakeId: string, move: Direction): boolean;
    }).isMoveFatal(gameId, 'us', 'right');
  }

  test('stepping onto a WINNABLE piece is not fatal', () => {
    expect(isFatal('g-fatal-winnable', 2)).toBe(false);
  });

  test('stepping onto an equal-weight piece is fatal (the tie kills us too)', () => {
    expect(isFatal('g-fatal-tie', 5)).toBe(true);
  });

  test('stepping onto a higher-tier piece is fatal regardless of weight', () => {
    expect(isFatal('g-fatal-tier', 1, {
      invulnerabilityLevel: 2,
      invulnerabilityExpiryTurn: FAR_EXPIRY,
    })).toBe(true);
  });
});
