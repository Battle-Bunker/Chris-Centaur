/**
 * Tests for the parallel anytime minimax pipeline:
 *  - evaluateChunk (the pure worker unit) returns worst-case aggregates
 *  - decideIteratively completes all chunks in inline-pool mode, emits
 *    periodic updates, and picks the same move as the synchronous decide()
 */

import { evaluateChunk, ChunkJob } from '../logic/decision-chunk';
import { DecisionEngine } from '../logic/decision-engine';
import { DecisionWorkerPool } from '../logic/decision-worker-pool';
import { GameState, Snake, Direction } from '../types/battlesnake';

function makeSnake(id: string, body: { x: number; y: number }[]): Snake {
  return {
    facing: { dx: 0, dy: -1 },
    id,
    name: id,
    health: 100,
    body,
    head: body[0],
    length: body.length,
    latency: '0',
    shout: '',
    squad: '',
    customizations: { color: '#888888', head: 'default', tail: 'default' },
  };
}

function makeGameState(snakes: Snake[], youId: string, food: { x: number; y: number }[] = []): GameState {
  return {
    game: {
      id: 'iterative-test',
      ruleset: { name: 'standard', version: '1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard',
    },
    turn: 3,
    board: { width: 11, height: 11, snakes, food, hazards: [] },
    you: snakes.find(s => s.id === youId)!,
  };
}

describe('evaluateChunk', () => {
  test('evaluates every move set and reports the worst score', () => {
    const us = makeSnake('us', [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ]);
    const enemy = makeSnake('enemy', [
      { x: 7, y: 5 },
      { x: 7, y: 4 },
      { x: 7, y: 3 },
    ]);
    const gameState = makeGameState([us, enemy], 'us', [{ x: 2, y: 2 }]);

    const moveSets: [string, Direction][][] = [
      [['enemy', 'up']],
      [['enemy', 'left']],
      [['enemy', 'right']],
    ];
    const job: ChunkJob = {
      gameState,
      teamSnakeIds: ['us'],
      ourMove: 'up',
      moveSets,
      simulatedSnakeIds: ['us', 'enemy'],
      h2hRisk: { enemyH2HRisk: 0, allyH2HRisk: 0 },
      waypointProgress: null,
    };

    const result = evaluateChunk(job);
    expect(result.ourMove).toBe('up');
    expect(result.statesEvaluated).toBe(3);
    expect(result.worstEvaluation).not.toBeNull();
    expect(result.worstScore).toBe(result.worstEvaluation!.score);
    expect(Number.isFinite(result.worstScore)).toBe(true);
  });

  test('empty move-set list yields no states and Infinity worst score', () => {
    const us = makeSnake('us', [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
    ]);
    const job: ChunkJob = {
      gameState: makeGameState([us], 'us'),
      teamSnakeIds: ['us'],
      ourMove: 'left',
      moveSets: [],
      simulatedSnakeIds: ['us'],
      h2hRisk: { enemyH2HRisk: 0, allyH2HRisk: 0 },
      waypointProgress: null,
    };
    const result = evaluateChunk(job);
    expect(result.statesEvaluated).toBe(0);
    expect(result.worstScore).toBe(Infinity);
    expect(result.worstEvaluation).toBeNull();
  });
});

describe('decideIteratively', () => {
  // Inline pool (size 0) — chunks run on the main thread via setImmediate,
  // exercising the full dispatch/aggregate/finalize flow deterministically.
  const inlinePool = new DecisionWorkerPool(0);

  test('completes all 3^k states and agrees with synchronous decide()', async () => {
    const us = makeSnake('us', [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ]);
    const enemy = makeSnake('enemy', [
      { x: 8, y: 5 },
      { x: 8, y: 4 },
      { x: 8, y: 3 },
    ]);
    const gameState = makeGameState([us, enemy], 'us', [{ x: 3, y: 8 }]);
    const teamIds = new Set(['us']);

    const engine = new DecisionEngine({ timeoutMs: 5000 });
    const syncDecision = engine.decide(gameState, teamIds);

    const iterEngine = new DecisionEngine({ timeoutMs: 5000 });
    const updates: Direction[] = [];
    const decision = await iterEngine.decideIteratively(gameState, teamIds, {
      deadlineMs: Date.now() + 5000,
      updateIntervalMs: 10,
      pool: inlinePool,
      onUpdate: d => updates.push(d.move),
    });

    // Full completion: every candidate move evaluated over the full 3^k
    // product (here k=1 nearby-free — enemy is 3 away, within nearbyDistance 5,
    // so 3 enemy moves per candidate move of ours).
    expect(decision.candidateMoves.length).toBeGreaterThan(1);
    for (const evaluation of decision.evaluations) {
      expect(evaluation.numStates).toBeGreaterThan(0);
    }

    // Final update was emitted and matches the returned decision.
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1]).toBe(decision.move);

    // Minimax parity with the synchronous engine (same states, same worst-case
    // aggregation) — same chosen move and same per-move worst scores.
    expect(decision.move).toBe(syncDecision.move);
    const syncScores = new Map(syncDecision.evaluations.map(e => [e.move, e.worstScore]));
    for (const evaluation of decision.evaluations) {
      expect(evaluation.worstScore).toBeCloseTo(syncScores.get(evaluation.move)!, 6);
    }
  });

  test('deadline finalizes early with a usable decision', async () => {
    // Crowd the board so 3^k is large enough that a ~0ms deadline cuts it off.
    const us = makeSnake('us', [
      { x: 10, y: 10 },
      { x: 10, y: 9 },
      { x: 10, y: 8 },
    ]);
    const enemies: Snake[] = [];
    const spots = [
      [8, 10], [12, 10], [10, 12], [8, 8], [12, 12], [12, 8],
    ];
    spots.forEach(([x, y], i) => {
      enemies.push(makeSnake(`e${i}`, [
        { x, y },
        { x, y: y - 1 },
        { x, y: y - 2 },
      ]));
    });
    const bigState: GameState = {
      ...makeGameState([us, ...enemies], 'us', [{ x: 1, y: 1 }]),
      board: { width: 21, height: 21, snakes: [us, ...enemies], food: [{ x: 1, y: 1 }], hazards: [] },
    };

    const engine = new DecisionEngine({ timeoutMs: 5000 });
    const decision = await engine.decideIteratively(bigState, new Set(['us']), {
      deadlineMs: Date.now(),      // already expired — finalize on first tick
      updateIntervalMs: 10,
      pool: inlinePool,
    });

    expect(decision.candidateMoves.length).toBeGreaterThan(0);
    expect(decision.candidateMoves).toContain(decision.move);
  });
});
