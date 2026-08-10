/**
 * Tests for the goto/near waypoint redesign: waypoints are weighted votes in
 * the heuristic matrix (bounded per-move shortest-path progress stats), never
 * hard path overrides; goto supports a queue of targets that shift on arrival;
 * the rendered green route is derived from the STAGED move (staged destination
 * first, shortest path onward) and recomputed on every stage.
 */

import {
  waypointPath,
  waypointDistance,
  gotoProgressStat,
  nearProgressStat,
  computeWaypointProgressByMove,
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
    expect(right.worstEvaluation.stats.gotoProgress).toBe(1);
    expect(up.worstEvaluation.stats.gotoProgress).toBeLessThan(1);
  });

  test('near: the ideal approach (distance 1) earns the full bonus and wins', () => {
    const engine = new DecisionEngine();
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');

    // Target two cells right: moving right reaches the ideal distance of 1.
    const decision = engine.decide(gs, new Set(['s']), { kind: 'near', target: { x: 7, y: 5 } });

    expect(decision.move).toBe('right');
    const right = decision.evaluations.find(e => e.move === 'right')!;
    expect(right.worstEvaluation.stats.nearProgress).toBe(1);
    expect(right.worstEvaluation.stats.gotoProgress).toBe(0);
  });

  test('near: landing ON the target earns nothing (arrival is never rewarded)', () => {
    const engine = new DecisionEngine();
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');

    // Target directly adjacent: the landing move gets a 0 stat — near's pull
    // simply vanishes at the doorstep rather than penalising below neutral.
    const decision = engine.decide(gs, new Set(['s']), { kind: 'near', target: { x: 6, y: 5 } });

    const right = decision.evaluations.find(e => e.move === 'right')!;
    expect(right.worstEvaluation.stats.nearProgress).toBe(0);
  });

  test('no waypoint: both progress stats stay 0 across every candidate', () => {
    const engine = new DecisionEngine();
    const snake = makeSnake('s', { x: 5, y: 5 });
    const gs = makeGameState('g', 1, [snake], 's');

    const decision = engine.decide(gs, new Set(['s']));
    for (const evaluation of decision.evaluations) {
      expect(evaluation.worstEvaluation.stats.gotoProgress).toBe(0);
      expect(evaluation.worstEvaluation.stats.nearProgress).toBe(0);
    }
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

  // Drives the transport side of one snake's turn intake, the way the Firebase
  // interface feeds the manager, and marks the snake as user-selected.
  function processMove(gameId: string, snakes: Snake[], turn: number, botMove: Direction, evaluations: MoveEvaluation[]) {
    const gs = makeGameState(gameId, turn, snakes, 'A');
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has('A')) {
      mgr.registerGame(gs);
    }
    mgr.updateGameState(gameId, 'A', gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
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
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));

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

  test('the drawn route follows the move that will actually commit, not the one the target wanted', () => {
    const gameId = 'g-goto-outvoted';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // 'up' outscores 'right' by more than the goto weight can close (300), so
    // the matrix keeps 'up' even with the target dead ahead to the right. The
    // green path must start at the staged cell (5,6) and route from THERE —
    // the visual and the committed move are one mechanism.
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 1000, right: 90, left: 80 }));

    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId)).toBe(true);

    expect(cs.staged?.move).toBe('up');
    expect(cs.gotoRoute[0]).toEqual({ x: 5, y: 6 });
    expect(cs.gotoRoute[cs.gotoRoute.length - 1]).toEqual({ x: 8, y: 5 });
  });

  test('the goto weight cannot buy a fatally-trapped move (veto survives the bias)', () => {
    const gameId = 'g-goto-veto';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const evaluations = makeEvaluations({ up: 100, right: 90, left: 80 });
    // Mark 'right' — the on-path move — as leading into a fatal pocket.
    (evaluations.find(e => e.move === 'right')!.breakdown as any).trapped = 1;
    const cs = processMove(gameId, snakes, 1, 'up', evaluations);

    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);

    // 'up' (100 + 300×0) and 'left' (80 + 300×0) keep their raw scores; both
    // beat the vetoed 'right' (390) because the veto removes it from the pool.
    expect(cs.staged?.move).toBe('up');
  });

  test('shift+alt append builds a target queue; appending a queued cell removes it', () => {
    const gameId = 'g-goto-queue';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));

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
    const cs = processMove(gameId, snakes, 1, 'right', makeEvaluations({ up: 100, right: 90, left: 80 }));
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 6, y: 5 }, userId);
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 7, y: 5 }, userId, true);

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

  test('near: biased staging pulls toward the target, never auto-clears, and renders no route', () => {
    const gameId = 'g-near';
    let snakes = [makeSnake('A', { x: 5, y: 5 })];
    // Bot prefers 'up' on raw scores, but the near target at (8,5) makes
    // 'right' the ideal-approach step (stat 1 → +250), overtaking it.
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));

    expect(mgr.setWaypoint(gameId, 'A', { type: 'blue', x: 8, y: 5 }, userId)).toBe(true);

    expect(cs.intent.kind).toBe('near');
    expect(cs.staged?.move).toBe('right');
    expect(cs.staged?.source).toBe('waypoint');
    expect(mgr.getRoutesForGame(gameId)['A']).toBeUndefined();
    expect(mgr.getWaypointsForGame(gameId)['A']).toEqual({ type: 'blue', cells: [{ x: 8, y: 5 }] });

    // Landing on a near target does NOT clear it — "stay close" has no arrival.
    snakes = [makeSnake('A', { x: 8, y: 5 })];
    mgr.updateGameState(gameId, 'A', makeGameState(gameId, 2, snakes, 'A'));
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
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));
    mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, userId);
    expect(cs.gotoRoute.length).toBeGreaterThan(0);

    expect(mgr.setWaypoint(gameId, 'A', null, userId)).toBe(true);

    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.gotoRoute).toEqual([]);
    expect(mgr.getWaypointsForGame(gameId)['A']).toBeUndefined();
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('bot');
  });

  test('only the user currently selecting the snake may change its waypoint', () => {
    const gameId = 'g-goto-perm';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const cs = processMove(gameId, snakes, 1, 'up', makeEvaluations({ up: 100, right: 90, left: 80 }));

    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 8, y: 5 }, 'someone-else')).toBe(false);
    expect(cs.intent.kind).toBe('heuristic');
  });
});
