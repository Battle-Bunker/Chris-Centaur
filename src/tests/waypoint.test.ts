/**
 * Tests for the goto/near waypoint redesign: waypoints are weighted votes in
 * the decision's per-move scores (bounded shortest-path progress stats), never
 * hard path overrides; goto supports a queue of targets that shift on arrival;
 * the rendered green route is derived from the STAGED move (staged destination
 * first, shortest path onward) and recomputed on every stage.
 *
 * The route half runs over `logic/route.ts` — the per-unit search space taken
 * from the vendored grammar — so a knight's route is L-hops, a rook's is ray
 * landings and a pawn's interleaves its quarter turns, from one BFS loop.
 */

import {
  waypointPath,
  waypointRoute,
  waypointDistance,
  gotoProgressStat,
  nearProgressStat,
  computeWaypointProgressByMove,
} from '../logic/waypoint-pathing';
import { ActiveGameManager, TurnData, MoveEvaluation } from '../server/active-game-manager';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

function makeSnake(id: string, head: Coord, length = 3): Snake {
  const body: Coord[] = [];
  for (let i = 0; i < length; i++) {
    body.push({ x: head.x, y: head.y - i });
  }
  return {
    orientation: { dx: 0, dy: -1 },
    id,
    name: id,
    latency: '0',
    health: 90, // not 100: a full-health snake is treated as "just ate"
    body,
    head,
    length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
}

/** A chess piece: a 1-cell unit whose `length` is its WEIGHT. */
function makePiece(id: string, square: Coord, unitType: string, orientation = { dx: 0, dy: -1 }): Snake {
  const piece = makeSnake(id, square, 1);
  piece.unitType = unitType;
  piece.orientation = orientation;
  return piece;
}

function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string): GameState {
  const you = snakes.find((s) => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'standard', version: '1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you,
  };
}

describe('progress stat functions (pure [0,1] linear ramp, zero at double the best path)', () => {
  test('goto: optimal move scores exactly 1; reward falls linearly to 0 at 2× the best path', () => {
    // baseDist 4 → best candidate distance 3, window closes at 6.
    expect(gotoProgressStat(4, 3)).toBe(1);
    expect(gotoProgressStat(4, 4)).toBeCloseTo(2 / 3);   // 1 extra step
    expect(gotoProgressStat(4, 5)).toBeCloseTo(1 / 3);   // 2 extra steps
    expect(gotoProgressStat(4, 6)).toBe(0);              // double the best path
    expect(gotoProgressStat(4, 9)).toBe(0);              // beyond: flat zero, no negatives
  });

  test('goto: the detour window is self-scaling — the same 2-extra-step detour costs less far out', () => {
    // Far target (baseDist 11, best 10): 2 extra steps keeps 0.8 of the bonus.
    expect(gotoProgressStat(11, 12)).toBeCloseTo(0.8);
    expect(gotoProgressStat(11, 14)).toBeCloseTo(0.6);
    // Close target (baseDist 3, best 2): one extra step already halves the
    // bonus, and the same 2-extra-step detour zeroes it.
    expect(gotoProgressStat(3, 3)).toBeCloseTo(0.5);
    expect(gotoProgressStat(3, 4)).toBe(0);
  });

  test('goto edges: adjacent target rewards only arrival; cut-off is 0 not negative; re-opening scores 1', () => {
    expect(gotoProgressStat(1, 0)).toBe(1);   // adjacent: arrival is the optimal move
    expect(gotoProgressStat(1, 2)).toBe(0);   // adjacent: anything else earns nothing
    expect(gotoProgressStat(3, null)).toBe(0);      // cutting the target off just loses the bonus
    expect(gotoProgressStat(null, 4)).toBe(1);      // re-opening a cut-off target is optimal
    expect(gotoProgressStat(null, null)).toBe(0);   // unreachable everywhere: no signal
  });

  test('near: ramp anchors at distance 1 and arrival is NEVER rewarded', () => {
    // baseDist 3 → best allowed approach 2, window closes at 4.
    expect(nearProgressStat(3, 2)).toBe(1);
    expect(nearProgressStat(3, 3)).toBeCloseTo(0.5);
    expect(nearProgressStat(3, 4)).toBe(0);
    // Adjacent to the target: holding distance 1 is perfect, stepping ON it earns 0.
    expect(nearProgressStat(2, 1)).toBe(1);
    expect(nearProgressStat(1, 0)).toBe(0);
    expect(nearProgressStat(3, 0)).toBe(0);
    // Cutting off the path loses the whole bonus (0, not negative).
    expect(nearProgressStat(2, null)).toBe(0);
    expect(nearProgressStat(null, null)).toBe(0);
  });

  test('the maximum weighted contribution is exactly the weight (bounded vote)', () => {
    // The whole safety argument rests on this: stat ∈ [0,1] means goto can
    // never contribute more than `gotoProgress` points to any candidate, so a
    // weight below the deaths/trapped penalties can never buy a fatal move.
    for (const [base, cand] of [[4, 3], [1, 0], [null, 2], [11, 10]] as Array<[number | null, number | null]>) {
      expect(gotoProgressStat(base, cand)).toBeLessThanOrEqual(1);
      expect(gotoProgressStat(base, cand)).toBeGreaterThanOrEqual(0);
      expect(nearProgressStat(base, cand)).toBeLessThanOrEqual(1);
      expect(nearProgressStat(base, cand)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('waypointPath', () => {
  test('finds a shortest path on an open board and reports its distance', () => {
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');
    const path = waypointPath(gs, 's', snake.head, { x: 8, y: 5 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3);
    expect(path![path!.length - 1]).toEqual({ x: 8, y: 5 });
    expect(waypointDistance(gs, 's', snake.head, { x: 8, y: 5 })).toBe(3);
  });

  test('an out-of-bounds target is unreachable, and from === target is a zero-length path', () => {
    const snake = makeSnake('s', { x: 3, y: 3 });
    const gs = makeGameState('g', 1, [snake], 's');
    expect(waypointPath(gs, 's', snake.head, { x: -1, y: 0 })).toBeNull();
    expect(waypointPath(gs, 's', snake.head, { x: 11, y: 5 })).toBeNull();
    expect(waypointPath(gs, 's', snake.head, snake.head)).toEqual([]);
    expect(waypointDistance(gs, 's', snake.head, snake.head)).toBe(0);
  });

  test('a path is measured in the UNIT own moves: knight L-hops, rook ray landings', () => {
    const knight = makePiece('k', { x: 0, y: 0 }, 'knight');
    const gs = makeGameState('g', 1, [knight], 'k');
    // (1,1) is one square diagonally away and FOUR knight moves out of the
    // corner — the classic case a step-based BFS would call distance 2.
    const path = waypointPath(gs, 'k', knight.head, { x: 1, y: 1 })!;
    expect(path).not.toBeNull();
    expect(path.length).toBe(4);
    expect(path[path.length - 1]).toEqual({ x: 1, y: 1 });
    // Every hop is a legal L-jump.
    let from = knight.head;
    for (const hop of path) {
      const [dx, dy] = [Math.abs(hop.x - from.x), Math.abs(hop.y - from.y)];
      expect([dx, dy].sort().join()).toBe('1,2');
      from = hop;
    }

    // A rook crosses the whole board in two ray moves.
    const rook = makePiece('r', { x: 0, y: 0 }, 'rook');
    const rookGs = makeGameState('g', 1, [rook], 'r');
    expect(waypointDistance(rookGs, 'r', rook.head, { x: 10, y: 10 })).toBe(2);
    expect(waypointDistance(rookGs, 'r', rook.head, { x: 0, y: 7 })).toBe(1);
  });

  test('a slider ray stops at a blocked square, so the path goes around', () => {
    // A hazard wall across row 5 leaves one opening, at x=10. The rook's ray
    // straight up its own file dies on the wall, so the shortest path is the
    // three-move detour through the opening.
    const rook = makePiece('r', { x: 0, y: 0 }, 'rook');
    const gs = makeGameState('g', 1, [rook], 'r');
    for (let x = 0; x <= 9; x++) gs.board.hazards.push({ x, y: 5 });

    expect(waypointPath(gs, 'r', rook.head, { x: 0, y: 10 })).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    // Beyond the wall on its own file is unreachable in one move, but the
    // squares up to it are not.
    expect(waypointDistance(gs, 'r', rook.head, { x: 0, y: 4 })).toBe(1);
  });
});

describe('waypointRoute: a pawn plans through its ORIENTATION', () => {
  // A pawn's only step is forward and a quarter turn costs a whole turn, so
  // its reachability is a property of (square, facing). The search plans over
  // both, which is what makes any target reachable at all — before it did, a
  // pawn could only ever walk the ray it happened to face.
  //
  // Wire orientation dy -1 faces api +y ("up"); its quarter turns are api ±x.
  const FACING_UP = { dx: 0, dy: -1 };

  /** The route as a readable script: 'turn' for a rotation, else the cell. */
  const script = (route: { cell: Coord; rotation?: { dx: number; dy: number } }[]) =>
    route.map(s => (s.rotation ? `turn ${s.rotation.dx},${s.rotation.dy}` : `${s.cell.x},${s.cell.y}`));

  test('a target BEHIND the pawn costs two quarter turns plus the steps — the shortest plan', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', FACING_UP);
    const gs = makeGameState('g', 1, [pawn], 'p');

    const route = waypointRoute(gs, 'p', pawn.head, { x: 5, y: 3 })!;
    expect(route).not.toBeNull();
    // There is no 180° turn: two quarter turns, then the two steps.
    expect(script(route)).toEqual(['turn 1,0', 'turn 0,1', '5,4', '5,3']);
    expect(waypointDistance(gs, 'p', pawn.head, { x: 5, y: 3 })).toBe(4);
    // A rotation spends the turn on the square it stands on, so the cells-only
    // projection repeats it — route length is TURNS, not squares.
    expect(waypointPath(gs, 'p', pawn.head, { x: 5, y: 3 })).toEqual([
      { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 },
    ]);
  });

  test('a target off the ray plans the rotation first, then walks it out', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', FACING_UP);
    const gs = makeGameState('g', 1, [pawn], 'p');

    // Three squares to the api +x side: turn once, then step three times.
    expect(script(waypointRoute(gs, 'p', pawn.head, { x: 8, y: 5 })!))
      .toEqual(['turn 1,0', '6,5', '7,5', '8,5']);
  });

  test('a diagonal-off-ray target INTERLEAVES steps and a rotation', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', FACING_UP);
    const gs = makeGameState('g', 1, [pawn], 'p');

    // (7,7) is two up and two across: walk the leg it already faces, turn
    // once, walk the other. Five turns — cheaper than turning first (six).
    expect(script(waypointRoute(gs, 'p', pawn.head, { x: 7, y: 7 })!))
      .toEqual(['5,6', '5,7', 'turn 1,0', '6,7', '7,7']);
  });

  test('the start orientation can be overridden — the probe every rotation candidate uses', () => {
    const pawn = makePiece('p', { x: 5, y: 5 }, 'pawn', FACING_UP);
    const gs = makeGameState('g', 1, [pawn], 'p');
    const target = { x: 8, y: 5 };

    // Facing up it is four turns away (one rotation + three steps); ALREADY
    // facing api +x it is three. That difference is exactly what makes a
    // rotation candidate outscore standing still.
    expect(waypointDistance(gs, 'p', pawn.head, target)).toBe(4);
    expect(waypointDistance(gs, 'p', pawn.head, target, { orientation: { dx: 1, dy: 0 } })).toBe(3);
  });

  test('regression: units that cannot rotate plan exactly as before — no rotation steps', () => {
    const knight = makePiece('k', { x: 0, y: 0 }, 'knight');
    const knightGs = makeGameState('g', 1, [knight], 'k');
    const knightRoute = waypointRoute(knightGs, 'k', knight.head, { x: 1, y: 1 })!;
    expect(knightRoute).toHaveLength(4);
    expect(knightRoute.every(s => s.rotation === undefined)).toBe(true);

    const rook = makePiece('r', { x: 0, y: 0 }, 'rook');
    const rookGs = makeGameState('g', 1, [rook], 'r');
    expect(waypointRoute(rookGs, 'r', rook.head, { x: 10, y: 10 })!.map(s => s.cell))
      .toEqual([{ x: 10, y: 0 }, { x: 10, y: 10 }]);

    const snake = makeSnake('s', { x: 5, y: 5 });
    const snakeGs = makeGameState('g', 1, [snake], 's');
    const snakeRoute = waypointRoute(snakeGs, 's', snake.head, { x: 8, y: 5 })!;
    expect(snakeRoute.map(s => s.cell)).toEqual([{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }]);
    expect(snakeRoute.every(s => s.rotation === undefined)).toBe(true);
  });
});

describe('computeWaypointProgressByMove', () => {
  test('scores every direction once from the pre-move board; the on-path step gets 1', () => {
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');

    // Target 5 cells right → best candidate distance 4, window closes at 8.
    const table = computeWaypointProgressByMove(gs, { kind: 'goto', target: { x: 10, y: 5 } });
    expect(table).not.toBeNull();
    // On-path step: distance 4 → the full bonus.
    expect(table!.right!.gotoProgress).toBe(1);
    expect(table!.right!.nearProgress).toBe(0);
    // Perpendicular: distance 6 (two steps off the best path) → 2 − 6/4. Still
    // well above zero — a detour this early in a long journey keeps much of its
    // pull, which is the self-scaling window that lets other heuristics win a
    // near-equal route.
    expect(table!.up!.gotoProgress).toBeCloseTo(0.5);
    // Straight away from the target is strictly worse: our own body blocks the
    // direct return, so the route round it is distance 8 — the window's edge.
    expect(table!.left!.gotoProgress).toBe(0);
    expect(table!.left!.gotoProgress).toBeLessThan(table!.up!.gotoProgress);
    expect(table!.up!.gotoProgress).toBeLessThan(table!.right!.gotoProgress);
  });

  test('returns null when no waypoint is active, so callers skip the context entirely', () => {
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');
    expect(computeWaypointProgressByMove(gs, null)).toBeNull();
    expect(computeWaypointProgressByMove(gs, undefined)).toBeNull();
  });
});

describe('ActiveGameManager goto/near intents', () => {
  let mgr: ActiveGameManager;
  const userId = 'user-1';

  beforeAll(() => {
    mgr = ActiveGameManager.getInstance();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mgr.setMoveSubmitter(async () => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  // Per-move evaluations shaped like the LOBSTER fold's own telemetry row
  // (see lobster/telemetry.ts breakdownOf / TelemetryEvaluation): `breakdown`
  // is keyed by the fold's OWN feature names — material, reach, room, food, …
  // — never by `trapped` / `regicide` / `gotoProgress` / `nearProgress`, none
  // of which a lobster row ever carries (that legacy-shaped fixture is what
  // let the goto scale defect ship unnoticed). `bounds` is the fold's own
  // worst/est/best triple for the candidate; `fatal: true` marks a candidate
  // the fold's worst case reads as DEAD in both directions
  // (`bounds.lo === bounds.hi === -Infinity`), the real signal
  // `getWaypointBiasedMove`'s certain-fatal veto reads.
  function makeEvaluations(
    scores: Partial<Record<Direction, number>>,
    fatal: Partial<Record<Direction, boolean>> = {}
  ): MoveEvaluation[] {
    return (Object.keys(scores) as Direction[]).map((move) => {
      const score = scores[move]!;
      const isFatal = fatal[move] ?? false;
      return {
        move,
        score,
        numStates: 1,
        breakdown: {
          engine: 'lobster',
          profile: 'lobster-territory',
          weights: { material: 10, reach: 1, room: 3, food: 4 },
          weighted: { materialScore: score, reachScore: 0, roomScore: 0, foodScore: 0 },
          material: score,
          reach: 0,
          room: 0,
          food: 0,
        },
        bounds: isFatal
          ? { lo: Number.NEGATIVE_INFINITY, est: Number.NEGATIVE_INFINITY, hi: Number.NEGATIVE_INFINITY }
          : { lo: score, est: score, hi: score },
      };
    });
  }

  function makeTurnData(gs: GameState, botMove: Direction, evaluations: MoveEvaluation[]): TurnData {
    return {
      gameState: gs,
      moveEvaluations: evaluations,
      territoryCells: {},
      safeMoves: ['up', 'left', 'right'],
      botRecommendation: botMove,
      timestamp: Date.now(),
    };
  }

  // Drives the transport side of one snake's turn intake, the way the Firebase
  // interface feeds the manager, and marks the snake as user-selected.
  function processMove(gameId: string, snakes: Snake[], turn: number, botMove: Direction, evaluations: MoveEvaluation[]) {
    const gs = makeGameState(gameId, turn, snakes, 'A');
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has('A')) {
      mgr.registerGame(gs, 'A');
    }
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    mgr.updateBoard(gameId, gs);
    mgr.setBotRecommendation(gameId, 'A', botMove, makeTurnData(gs, botMove, evaluations));
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = userId;
    return cs;
  }

  test('setting a goto waypoint mid-turn re-stages via the biased matrix (weighted vote, not a path override)', () => {
    const gameId = 'g-goto-bias';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // Bot prefers 'up' on raw scores; 'right' is the shortest-path step toward
    // the target and wins once the goto weight (300) is integrated.
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('bot');

    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId)).toBe(true);

    expect(cs.intent.kind).toBe('goto');
    expect(cs.staged?.move).toBe('right');
    expect(cs.staged?.source).toBe('waypoint');
    // The rendered route is conditioned on the staged move: first cell is the
    // staged destination, then the shortest path onward to the target.
    expect(cs.gotoRoute[0]).toEqual({ x: 6, y: 5 });
    expect(cs.gotoRoute[cs.gotoRoute.length - 1]).toEqual({ x: 8, y: 5 });
    expect(cs.gotoRoute.length).toBe(3);
    // A single target is all committed leg — nothing to fade.
    expect(cs.gotoRouteFirstLeg).toBe(cs.gotoRoute.length);
  });

  test('regression: a snake still navigates in single orthogonal steps', () => {
    const gameId = 'g-goto-snake-steps';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    // A target four cells away on the diagonal is four steps of route, one
    // cell per move — a snake reads the same per-unit adjacency every piece
    // does and gets exactly the step graph it always had. Both 'up' and
    // 'right' start a shortest path and take the same goto weight, so the raw
    // bot scores still settle it: the weight is added to them, not a path
    // override.
    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 7, y: 7 }, userId)).toBe(true);

    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('waypoint');
    expect(cs.gotoRoute).toHaveLength(4);
    for (let i = 0; i < cs.gotoRoute.length; i++) {
      const from = i === 0 ? { x: 5, y: 5 } : cs.gotoRoute[i - 1];
      expect(Math.abs(cs.gotoRoute[i].x - from.x) + Math.abs(cs.gotoRoute[i].y - from.y)).toBe(1);
    }
    expect(cs.gotoRoute[cs.gotoRoute.length - 1]).toEqual({ x: 7, y: 7 });
  });

  test('the drawn route follows the move that will actually commit, not the one the target wanted', () => {
    const gameId = 'g-goto-outvoted';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // 'up' outscores 'right' by more than the goto weight can close, so
    // the matrix keeps 'up' even with the target dead ahead to the right. The
    // green path must start at the staged cell (5,6) and route from THERE —
    // the visual and the committed move are one mechanism.
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 1000, right: 90, left: 80 }));

    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId)).toBe(true);

    expect(cs.staged?.move).toBe('up');
    expect(cs.gotoRoute[0]).toEqual({ x: 5, y: 6 });
    expect(cs.gotoRoute[cs.gotoRoute.length - 1]).toEqual({ x: 8, y: 5 });
  });

  test('the goto weight cannot buy a certain-fatal move (veto survives the bias)', () => {
    const gameId = 'g-goto-veto';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // 'right' is the on-path move — without the veto it would win the bias
    // (3 + 4×1 = 7 beats 'up's raw 5) — but the fold's own worst-case verdict
    // reads it as DEAD (a real engine fact, not a synthetic breakdown flag).
    const evaluations = makeEvaluations({ up: 5, right: 3, left: 1 }, { right: true });
    const cs = processMove(gameId, snakes, 1, 'up', evaluations);

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);

    // 'up' (5 + 4×0) and 'left' (1 + 4×0) keep their raw scores; both beat the
    // vetoed 'right' because the veto removes it from the pool entirely,
    // rather than merely being outscored.
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('waypoint');
  });

  test('a goto never outranks the fold recommendation by more than the fold\'s own scale allows', () => {
    // The bias is bounded to `weight` (an order of magnitude under
    // `material` = 10, the fold's own survival-cliff scale — see
    // GOTO_PROGRESS_WEIGHT in active-game-manager.ts). A candidate more than
    // that bound behind the leader can never win the bias alone, however
    // perfectly it lines up with the target.
    const gameId = 'g-goto-bounded';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // 'up' leads 'right' by 6, which is more than the maximum possible goto
    // contribution (weight × stat, stat ≤ 1). 'right' is dead on the target
    // line (stat 1), yet it must still lose.
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 10, right: 4, left: 1 }));

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);

    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('waypoint');
  });

  test('shift+alt append builds a target queue; appending a queued cell removes it', () => {
    const gameId = 'g-goto-queue';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 6, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId, true);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 8 }, userId, true);

    expect(mgr.getWaypointsForGame(gameId)['A']).toEqual({
      type: 'green',
      cells: [{ x: 6, y: 5 }, { x: 8, y: 5 }, { x: 8, y: 8 }],
    });
    // Only the ACTIVE target (head of the queue) is handed to the engine.
    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toEqual({ kind: 'goto', target: { x: 6, y: 5 } });

    // Append-toggle: appending an already-queued cell removes it.
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId, true);
    expect(mgr.getWaypointsForGame(gameId)['A'].cells).toEqual([{ x: 6, y: 5 }, { x: 8, y: 8 }]);
  });

  test('the route spans the WHOLE queue, chaining a leg per target', () => {
    const gameId = 'g-goto-multileg';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    // Three targets forming an L: right along y=5, then up the x=8 column.
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 8 }, userId, true);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 5, y: 8 }, userId, true);

    const route = cs.gotoRoute;
    // The drawn path must reach every queued target, in order — not stop at the
    // first one. Manhattan legs on an open board: 3 + 3 + 3 cells, plus the
    // staged step the route is anchored on.
    const idx8_5 = route.findIndex(c => c.x === 8 && c.y === 5);
    const idx8_8 = route.findIndex(c => c.x === 8 && c.y === 8);
    const idx5_8 = route.findIndex(c => c.x === 5 && c.y === 8);
    expect(idx8_5).toBeGreaterThanOrEqual(0);
    expect(idx8_8).toBeGreaterThan(idx8_5);
    expect(idx5_8).toBeGreaterThan(idx8_8);
    // The last cell IS the final target — the route ends where the plan ends.
    expect(route[route.length - 1]).toEqual({ x: 5, y: 8 });
    // `firstLeg` marks the boundary the client fades at: everything up to and
    // including the ACTIVE target is this turn's committed leg, the rest is
    // prediction. It must land exactly on targets[0].
    expect(cs.gotoRouteFirstLeg).toBe(idx8_5 + 1);
    expect(route[cs.gotoRouteFirstLeg - 1]).toEqual({ x: 8, y: 5 });
    const projected = mgr.getRoutesForGame(gameId)['A'];
    expect(projected.cells).toEqual(route);
    expect(projected.firstLeg).toBe(cs.gotoRouteFirstLeg);
    // Every step is orthogonally adjacent to the previous one: one continuous
    // walkable trajectory, with no jump across the seam between legs.
    for (let i = 1; i < route.length; i++) {
      const d = Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y);
      expect(d).toBe(1);
    }
  });

  test('a single target still produces exactly the first leg (no behaviour change)', () => {
    const gameId = 'g-goto-singleleg';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);

    expect(cs.gotoRoute[0]).toEqual({ x: 6, y: 5 });
    expect(cs.gotoRoute[cs.gotoRoute.length - 1]).toEqual({ x: 8, y: 5 });
    expect(cs.gotoRoute.length).toBe(3);
  });

  test('later legs path around the snake as it WILL be, never back through its own neck', () => {
    const gameId = 'g-goto-neck';
    // Body extends DOWN from the head, so the column ABOVE the head is empty
    // board and the return leg's shortest path does not involve the current
    // head cell (which the graph already blocks). That isolates the bug: the
    // only thing standing in the way is the body the snake WILL have.
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, left: 3, right: 1 }));

    // Up the column to (5,8), then back down to (5,6). Measured against the
    // CURRENT board the return leg is simply (5,7) then (5,6) — but (5,7) is
    // where the snake's neck will be the instant it arrives at (5,8), so that
    // first step is a 180° reversal into itself.
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 5, y: 8 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 5, y: 6 }, userId, true);

    const route = cs.gotoRoute;
    const firstLeg = cs.gotoRouteFirstLeg;
    expect(route[firstLeg - 1]).toEqual({ x: 5, y: 8 });

    // The step immediately after arriving must not re-enter the cell the snake
    // came from — that is the neck.
    expect(route[firstLeg]).not.toEqual(route[firstLeg - 2]);

    // More generally: no cell may be re-entered while the body still covers it.
    // route[i] is the head at turn i+1 and the tail clears it at turn
    // i+bodyLength, so a later visit must arrive strictly after that.
    const bodyLength = snakes[0].body.length;
    const lastSeen = new Map<string, number>();
    route.forEach((c, i) => {
      const key = `${c.x},${c.y}`;
      const prev = lastSeen.get(key);
      if (prev !== undefined) expect(i + 1).toBeGreaterThan(prev + bodyLength);
      lastSeen.set(key, i);
    });

    // And it still gets there, by a continuous walkable detour.
    expect(route[route.length - 1]).toEqual({ x: 5, y: 6 });
    for (let i = 1; i < route.length; i++) {
      const d = Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y);
      expect(d).toBe(1);
    }
  });

  test('an unreachable leg truncates the route at the last reachable target', () => {
    const gameId = 'g-goto-truncate';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    // Second target is off-board, so its leg can never be pathed. The route
    // must still show everything up to the reachable first target rather than
    // collapsing to nothing or drawing a jump across the gap.
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    (cs.intent as { kind: 'goto'; targets: Coord[] }).targets.push({ x: 99, y: 99 });
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 8 }, userId, true);

    const route = cs.gotoRoute;
    expect(route.length).toBeGreaterThan(0);
    expect(route[route.length - 1]).toEqual({ x: 8, y: 5 });
    expect(route.some(c => c.x === 8 && c.y === 8)).toBe(false);
    // Truncated to the committed leg only, so nothing renders faded.
    expect(cs.gotoRouteFirstLeg).toBe(route.length);
  });

  test('reaching the active target shifts the queue; the last arrival reverts to heuristic', () => {
    const gameId = 'g-goto-arrive';
    let snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'right', makeEvaluations({ up: 5, right: 3, left: 1 }));
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 6, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 7, y: 5 }, userId, true);

    expect(cs.intent.kind).toBe('goto');

    // Head arrives on the first target → the queue shifts, intent stays goto.
    snakes = [makeSnake('A', { x: 6, y: 5 })];
    mgr.updateBoard(gameId, makeGameState(gameId, 2, snakes, 'A'));
    expect(cs.intent.kind).toBe('goto');
    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toEqual({ kind: 'goto', target: { x: 7, y: 5 } });

    // Head arrives on the last target → the plan is done, back to heuristic.
    snakes = [makeSnake('A', { x: 7, y: 5 })];
    mgr.updateBoard(gameId, makeGameState(gameId, 3, snakes, 'A'));
    expect(cs.intent.kind).toBe('heuristic');
    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toBeNull();
    expect(cs.gotoRoute).toEqual([]);
  });

  test('near: biased staging pulls toward the target, never auto-clears, and renders no route', () => {
    const gameId = 'g-near';
    let snakes = [makeSnake('A', { x: 5, y: 5 })];
    // Bot prefers 'up' on raw scores, but the near target at (8,5) makes
    // 'right' the ideal-approach step (stat 1 → +250), overtaking it.
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    expect(mgr.setWaypoint(gameId, 'A', { type: 'blue', x: 8, y: 5 }, userId)).toBe(true);

    expect(cs.intent.kind).toBe('near');
    expect(cs.staged?.move).toBe('right');
    expect(cs.staged?.source).toBe('waypoint');
    expect(mgr.getRoutesForGame(gameId)['A']).toBeUndefined();
    expect(mgr.getWaypointsForGame(gameId)['A']).toEqual({ type: 'blue', cells: [{ x: 8, y: 5 }] });

    // Landing on a near target does NOT clear it — "stay close" has no arrival.
    snakes = [makeSnake('A', { x: 8, y: 5 })];
    mgr.updateBoard(gameId, makeGameState(gameId, 2, snakes, 'A'));
    expect(cs.intent.kind).toBe('near');
  });

  test('with no evaluations for this turn the intent falls through to the bot move, labelled truthfully', () => {
    const gameId = 'g-goto-noevals';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', []);

    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId)).toBe(true);

    expect(cs.intent.kind).toBe('goto');
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('bot');
  });

  test('clearing removes the target, the route, and reverts to the bot recommendation', () => {
    const gameId = 'g-goto-clear';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    expect(cs.gotoRoute.length).toBeGreaterThan(0);

    expect(mgr.setWaypoint(gameId, 'A', null, userId)).toBe(true);

    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.gotoRoute).toEqual([]);
    expect(mgr.getWaypointsForGame(gameId)['A']).toBeUndefined();
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('bot');
  });

  // ── ONE command lifecycle ────────────────────────────────────────────────
  // The intent IS the command; waypoint cells, the green route and the intent
  // mode are all DERIVED from it. So there is exactly one rule to hold: a new
  // command replaces the old one, and a command ends when the unit does. Every
  // projection follows for free — which is what stops a superseded or dead
  // unit's numbered target badges lingering on the board.

  test('a new command REPLACES the old one — the goto queue and its route go with it', () => {
    const gameId = 'g-goto-override';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 8 }, userId, true);
    expect(mgr.getWaypointsForGame(gameId)['A'].cells).toHaveLength(2);
    expect(cs.gotoRoute.length).toBeGreaterThan(0);

    // A manual selection is a new command: the whole queue and the drawn route
    // go with it, not just the active target.
    mgr.setUserSelection(gameId, 'A', 'left');
    expect(cs.intent.kind).toBe('manual');
    expect(cs.gotoRoute).toEqual([]);
    expect(cs.gotoRouteRotations).toEqual([]);
    expect(mgr.getWaypointsForGame(gameId)['A']).toBeUndefined();
    expect(mgr.getRoutesForGame(gameId)['A']).toBeUndefined();

    // And so is a near target, and a fresh goto (which replaces, never appends).
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 8 }, userId, true);
    mgr.setWaypoint(gameId, 'A', { type: 'blue', x: 3, y: 3 }, userId);
    expect(mgr.getWaypointsForGame(gameId)['A']).toEqual({ type: 'blue', cells: [{ x: 3, y: 3 }] });
    expect(cs.gotoRoute).toEqual([]);

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 2, y: 2 }, userId);
    expect(mgr.getWaypointsForGame(gameId)['A'].cells).toEqual([{ x: 2, y: 2 }]);
  });

  test('a unit that DIES loses its command: no queue, no route, nothing left to draw', () => {
    const gameId = 'g-goto-death';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 8 }, userId, true);
    expect(mgr.getWaypointsForGame(gameId)['A'].cells).toHaveLength(2);
    expect(cs.gotoRoute.length).toBeGreaterThan(0);

    // The next canonical board no longer carries the unit at all.
    const gone = makeGameState(gameId, 2, snakes, 'A');
    gone.board.snakes = [];
    mgr.updateBoard(gameId, gone);

    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.intentBy).toBeNull();
    expect(cs.gotoRoute).toEqual([]);
    expect(cs.gotoRouteFirstLeg).toBe(0);
    expect(mgr.getWaypointsForGame(gameId)['A']).toBeUndefined();
    expect(mgr.getRoutesForGame(gameId)['A']).toBeUndefined();
    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toBeNull();
  });

  test('a unit still ON the board but at zero health is dead too — same clearing', () => {
    const gameId = 'g-goto-death-health';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    expect(cs.intent.kind).toBe('goto');

    const starved = makeGameState(gameId, 2, [makeSnake('A', { x: 5, y: 5 })], 'A');
    starved.board.snakes[0].health = 0;
    mgr.updateBoard(gameId, starved);

    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.gotoRoute).toEqual([]);
    expect(mgr.getWaypointsForGame(gameId)['A']).toBeUndefined();
  });

  test('the game ending takes every command with it', () => {
    const gameId = 'g-goto-gameend';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    expect(mgr.getWaypointsForGame(gameId)['A']).toBeDefined();

    mgr.endGame(gameId, makeGameState(gameId, 2, snakes, 'A'));

    expect(mgr.getWaypointsForGame(gameId)).toEqual({});
    expect(mgr.getRoutesForGame(gameId)).toEqual({});
    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toBeNull();
  });

  test('only the user currently selecting the snake may change its waypoint', () => {
    const gameId = 'g-goto-perm';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 5, right: 3, left: 1 }));

    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, 'someone-else')).toBe(false);
    expect(cs.intent.kind).toBe('heuristic');
  });
});
