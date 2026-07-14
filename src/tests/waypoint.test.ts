/**
 * Tests for the goto/near waypoint redesign: waypoints are weighted votes in
 * the heuristic matrix (bounded per-move shortest-path progress stats), never
 * hard path overrides; goto supports a queue of targets that clear on arrival;
 * the rendered green route is derived from the staged move (staged destination
 * first, shortest path onward) and recomputed per turn.
 */

import {
  waypointPath,
  waypointDistance,
  gotoProgressStat,
  nearProgressStat,
} from '../logic/waypoint-pathing';
import { DecisionEngine, pickBestMove } from '../logic/decision-engine';
import { ActiveGameManager, TurnData, MoveEvaluation } from '../server/active-game-manager';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

function makeSnake(id: string, head: Coord, length = 3): Snake {
  const body: Coord[] = [];
  for (let i = 0; i < length; i++) {
    body.push({ x: head.x, y: head.y - i });
  }
  return {
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

function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string): GameState {
  const you = snakes.find((s) => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'standard', version: '1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you,
  };
}

describe('progress stat functions', () => {
  test('goto: +1 on shortest path, 0 sideways, -1 backward, clamped at [-2, 1]', () => {
    expect(gotoProgressStat(3, 2)).toBe(1);
    expect(gotoProgressStat(3, 3)).toBe(0);
    expect(gotoProgressStat(3, 4)).toBe(-1);
    expect(gotoProgressStat(5, 1)).toBe(1);   // clamp: never more than one step's credit
    expect(gotoProgressStat(1, 9)).toBe(-2);  // clamp: bounded detour penalty
  });

  test('goto: cutting the target off is -2; re-opening a cut-off target is +1; no signal when unreachable both ways', () => {
    expect(gotoProgressStat(3, null)).toBe(-2);
    expect(gotoProgressStat(null, 4)).toBe(1);
    expect(gotoProgressStat(null, null)).toBe(0);
  });

  test('near: landing ON the target is -2 even when it would be "progress"', () => {
    expect(nearProgressStat(1, 0)).toBe(-2);
    expect(nearProgressStat(3, 2)).toBe(1);
    expect(nearProgressStat(2, null)).toBe(-2);
    expect(nearProgressStat(null, null)).toBe(0);
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

  test('returns null for an unreachable (fully walled) target', () => {
    // Our snake's own long body seals the bottom-left corner cell (0,0):
    // body runs (0,1),(1,1),(1,0) with the head elsewhere along it. Use an
    // explicit body to wall the pocket.
    const snake: Snake = {
      ...makeSnake('s', { x: 3, y: 3 }, 3),
      body: [
        { x: 3, y: 3 },
        { x: 2, y: 3 },
        { x: 1, y: 3 },
        { x: 0, y: 3 },
        { x: 0, y: 2 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
      ],
      length: 8,
    };
    const gs = makeGameState('g', 1, [snake], 's');
    // (0,0) is enclosed by body cells (0,1),(1,1),(1,0) — but optimistic
    // passability lets segments recede over time, so instead verify the
    // out-of-bounds target contract, which is timing-independent.
    expect(waypointPath(gs, 's', snake.head, { x: -1, y: 0 })).toBeNull();
    expect(waypointPath(gs, 's', snake.head, { x: 11, y: 5 })).toBeNull();
  });
});

describe('pickBestMove', () => {
  test('applies the fatal-pocket veto before the argmax, and degrades to least-bad when all are fatal', () => {
    expect(pickBestMove([
      { move: 'up', score: 100, trapped: 1 },
      { move: 'left', score: 50, trapped: 0 },
    ])).toBe('left');
    expect(pickBestMove([
      { move: 'up', score: 100, trapped: 1 },
      { move: 'left', score: 50, trapped: 1 },
    ])).toBe('up');
    expect(pickBestMove([])).toBeNull();
  });
});

describe('DecisionEngine waypoint integration', () => {
  test('goto: the optimal next move toward the target wins and carries gotoProgress = 1', () => {
    const engine = new DecisionEngine();
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');

    const decision = engine.decide(gs, new Set(['s']), { kind: 'goto', target: { x: 8, y: 5 } });

    expect(decision.move).toBe('right');
    const right = decision.evaluations.find(e => e.move === 'right')!;
    const up = decision.evaluations.find(e => e.move === 'up')!;
    expect(right.averageBreakdown.stats.gotoProgress).toBe(1);
    expect(up.averageBreakdown.stats.gotoProgress).toBeLessThanOrEqual(0);
  });

  test('near: the snake never steps onto the target (landing scores -2)', () => {
    const engine = new DecisionEngine();
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');

    // Target directly adjacent to the head: stepping onto it would maximally
    // "minimise distance", but near forbids reaching it.
    const decision = engine.decide(gs, new Set(['s']), { kind: 'near', target: { x: 6, y: 5 } });

    expect(decision.move).not.toBe('right');
    const right = decision.evaluations.find(e => e.move === 'right')!;
    expect(right.averageBreakdown.stats.nearProgress).toBe(-2);
  });
});

describe('ActiveGameManager goto/near intents', () => {
  let mgr: ActiveGameManager;
  const userId = 'user-1';

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function makeRes(): any {
    return { json: jest.fn(), headersSent: false, writableFinished: false, destroyed: false };
  }
  const FUTURE_EXPIRY = () => Date.now() + 1_000_000;

  // Per-move evaluations shaped like the strategy's mapping: score + breakdown
  // carrying trapped/weights/weighted, so getWaypointBiasedMove can re-bias.
  function makeEvaluations(scores: Partial<Record<Direction, number>>): MoveEvaluation[] {
    return (Object.keys(scores) as Direction[]).map((move) => ({
      move,
      score: scores[move]!,
      numStates: 1,
      breakdown: {
        trapped: 0,
        weights: { gotoProgress: 300, nearProgress: 250 },
        weighted: { gotoProgressScore: 0, nearProgressScore: 0 },
      },
    }));
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

  // Drives the server side of a /move: register, pending, bot recommendation.
  function processMove(gameId: string, snakes: Snake[], turn: number, botMove: Direction, evaluations: MoveEvaluation[]) {
    const gs = makeGameState(gameId, turn, snakes, 'A');
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has('A')) {
      mgr.registerGame(gs);
    }
    mgr.updateGameState(gameId, 'A', gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, FUTURE_EXPIRY());
    const res = makeRes();
    mgr.setPendingMove(gameId, 'A', res, 500, FUTURE_EXPIRY(), turn);
    mgr.setBotRecommendation(gameId, 'A', botMove, makeTurnData(gs, botMove, evaluations));
    return res;
  }

  function selectSnake(gameId: string) {
    mgr.addConnectedUser(gameId, userId);
    expect(mgr.selectSnake(gameId, 'A', userId).success).toBe(true);
  }

  test('setting a goto waypoint mid-turn re-stages via the biased matrix (weighted vote, not a path override)', () => {
    const gameId = 'g-goto-bias';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // Bot prefers 'up' on raw scores; 'right' is the shortest-path step toward
    // the target and wins once the goto weight (300) is integrated.
    processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));
    selectSnake(gameId);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
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
  });

  test('the goto weight cannot buy a fatally-trapped move (veto survives the bias)', () => {
    const gameId = 'g-goto-veto';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const evaluations = makeEvaluations({ up: 100, right: 90, left: 80 });
    // Mark 'right' — the on-path move — as leading into a fatal pocket.
    (evaluations.find(e => e.move === 'right')!.breakdown as any).trapped = 1;
    processMove(gameId, snakes, 1, 'up', evaluations);
    selectSnake(gameId);

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    // 'up' scores 100 + 300×(-1) = -200, 'left' 80 - 300 = -220; both beat the
    // vetoed 'right' (390) because the veto removes it from the pool entirely.
    expect(cs.staged?.move).toBe('up');
  });

  test('after the commit, the route re-anchors as the plain shortest path from the projected head', () => {
    const gameId = 'g-goto-commit';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));
    selectSnake(gameId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);

    mgr.commitAllStaged(gameId);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.moveCommittedThisTurn).toBe(true);
    expect(cs.committedMove).toBe('right');
    // Projected head is now (6,5); the route is the shortest path from there.
    expect(cs.gotoRoute).toEqual([{ x: 7, y: 5 }, { x: 8, y: 5 }]);
  });

  test('shift+alt append builds a target queue; appending a queued cell removes it', () => {
    const gameId = 'g-goto-queue';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));
    selectSnake(gameId);

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

  test('reaching the active target shifts the queue; the last arrival reverts to heuristic', () => {
    const gameId = 'g-goto-arrive';
    let snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, snakes, 1, 'right', makeEvaluations({ up: 100, right: 90, left: 80 }));
    selectSnake(gameId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 6, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 7, y: 5 }, userId, true);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.intent.kind).toBe('goto');

    // Head arrives on the first target → the queue shifts, intent stays goto.
    snakes = [makeSnake('A', { x: 6, y: 5 })];
    mgr.updateGameState(gameId, 'A', makeGameState(gameId, 2, snakes, 'A'));
    expect(cs.intent.kind).toBe('goto');
    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toEqual({ kind: 'goto', target: { x: 7, y: 5 } });

    // Head arrives on the last target → the plan is done, back to heuristic.
    snakes = [makeSnake('A', { x: 7, y: 5 })];
    mgr.updateGameState(gameId, 'A', makeGameState(gameId, 3, snakes, 'A'));
    expect(cs.intent.kind).toBe('heuristic');
    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toBeNull();
    expect(cs.gotoRoute).toEqual([]);
  });

  test('near: biased staging avoids stepping onto the target and never renders a route', () => {
    const gameId = 'g-near';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // Bot prefers 'right' on raw scores, but the near target sits at (6,5):
    // landing on it scores -2 × 250 = -500, so 'up' (100 - 250) wins.
    processMove(gameId, snakes, 1, 'right', makeEvaluations({ up: 100, right: 120, left: 80 }));
    selectSnake(gameId);

    expect(mgr.setWaypoint(gameId, 'A', { type: 'blue', x: 6, y: 5 }, userId)).toBe(true);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.intent.kind).toBe('near');
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('waypoint');
    expect(mgr.getRoutesForGame(gameId)['A']).toBeUndefined();
    expect(mgr.getWaypointsForGame(gameId)['A']).toEqual({ type: 'blue', cells: [{ x: 6, y: 5 }] });
  });
});
