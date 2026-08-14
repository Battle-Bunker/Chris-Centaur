/**
 * Golden-master tests for VoronoiStrategy.getBestMoveIterative — the full
 * strategy stack (config -> team detection -> iterative engine -> debug
 * payload assembly) pinned on three fixed boards:
 *   1. open board         — territory-maximizing move on an empty midfield;
 *   2. contested corridor — refuses the one-cell channel an enemy contests;
 *   3. near-trapped pocket — picks the exit that preserves reachable space.
 *
 * Deterministic by construction: inline worker pool (DECISION_POOL_SIZE=0,
 * chunks run on this thread), default config (ConfigStore mocked to empty),
 * explicit far-future deadlines, no timers or randomness anywhere in the
 * pipeline. Chosen moves and integer stats are pinned exactly; scores and
 * float stats with toBeCloseTo, so a heuristic change that alters decisions
 * fails loudly while benign float noise does not.
 */

// Inline pool BEFORE anything imports the shared pool.
process.env.DECISION_POOL_SIZE = '0';

// Keep the DB entirely out: default config and no-op decision logging.
jest.mock('../server/configStore', () => ({
  ConfigStore: class {
    async getAll() {
      return {};
    }
  },
}));
const logDecision = jest.fn();
const logTurnState = jest.fn();
jest.mock('../logic/decision-logger', () => ({
  DecisionLogger: {
    getInstance: () => ({ logDecision, logTurnState }),
  },
}));

import { VoronoiStrategy } from '../logic/voronoi-strategy';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

function makeSnake(id: string, color: string, body: Coord[]): Snake {
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
    // Distinct colors: TeamDetector keys on color when squad/teamID are
    // absent, so each snake is its own team.
    customizations: { color, head: 'default', tail: 'default' },
  };
}

function makeGameState(gameId: string, snakes: Snake[], youId: string, food: Coord[]): GameState {
  return {
    game: {
      id: gameId,
      ruleset: { name: 'standard', version: '1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard',
    },
    turn: 10,
    board: { width: 11, height: 11, snakes, food, hazards: [] },
    you: snakes.find((s) => s.id === youId)!,
  };
}

async function run(gameState: GameState) {
  const strategy = new VoronoiStrategy();
  return strategy.getBestMoveIterative(gameState, undefined, null, {
    deadlineMs: Date.now() + 60_000,
  });
}

function evalFor(result: { moveEvaluations: any[] }, move: Direction) {
  const e = result.moveEvaluations.find((x) => x.move === move);
  expect(e).toBeDefined();
  return e;
}

beforeEach(() => {
  logDecision.mockClear();
  logTurnState.mockClear();
});

describe('VoronoiStrategy.getBestMoveIterative golden masters', () => {
  test('open board: takes the territory-maximizing move', async () => {
    // Us mid-board pointing up; lone enemy in the far corner (outside the
    // nearby-simulation radius, so 1 state per candidate); food to our right.
    // Territory dominates: up (100 cells) beats the food-side right (93).
    const us = makeSnake('us', '#111111', [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ]);
    const enemy = makeSnake('enemy', '#222222', [
      { x: 0, y: 10 },
      { x: 0, y: 9 },
      { x: 0, y: 8 },
    ]);
    const gameState = makeGameState('gm-open', [us, enemy], 'us', [{ x: 8, y: 5 }]);

    const result = await run(gameState);

    expect(result.move).toBe('up');
    expect(result.safeMoves).toEqual(['up', 'left', 'right']);
    expect(result.scores.get('up')).toBeCloseTo(974.6216116420064, 6);
    expect(result.scores.get('left')).toBeCloseTo(925.878112807455, 6);
    expect(result.scores.get('right')).toBeCloseTo(940.9690218983641, 6);

    const up = evalFor(result, 'up');
    expect(up.numStates).toBe(1);
    expect(up.breakdown.myTerritory).toBe(100);
    expect(up.breakdown.foodDistance).toBe(5);
    expect(up.breakdown.foodProximity).toBeCloseTo(0.5454545454545454, 9);
    expect(up.breakdown.selfSpace).toBeCloseTo(5.686240703077327, 9);
    expect(up.breakdown.trapped).toBe(0);
    expect(up.breakdown.deaths).toBe(0);

    const left = evalFor(result, 'left');
    expect(left.breakdown.myTerritory).toBe(90);
    expect(left.breakdown.selfSpace).toBeCloseTo(5.446711546122731, 9);

    const right = evalFor(result, 'right');
    expect(right.breakdown.myTerritory).toBe(93);
    expect(right.breakdown.foodDistance).toBe(3);
    expect(right.breakdown.foodProximity).toBeCloseTo(0.7272727272727273, 9);

    // Current-board Voronoi payload: our midfield snake owns most of the
    // board against a cornered enemy.
    expect(result.territoryCells['us']).toHaveLength(101);
    expect(result.territoryCells['enemy']).toHaveLength(14);
    expect(result.cellOwnership).toBeTruthy();

    // Debug/DB assembly ran once each.
    expect(logDecision).toHaveBeenCalledTimes(1);
    expect(logDecision.mock.calls[0][0].botRecommendation).toBe('up');
    expect(logDecision.mock.calls[0][0].safeMoves).toEqual(['up', 'left', 'right']);
    expect(logTurnState).toHaveBeenCalledTimes(1);
    expect(logTurnState.mock.calls[0][0].gameId).toBe('gm-open');
  });

  test('contested corridor: refuses the channel the enemy contests', async () => {
    // A one-cell corridor along row 5 (walled above and below by neutral
    // snake bodies whose heads point away) with food inside; the enemy
    // approaches head-on from the right, 4 cells away (inside the nearby
    // radius -> 3 enemy replies per candidate). Entering the corridor
    // (right) collapses our space and territory; the engine turns away.
    const us = makeSnake('us', '#111111', [
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
    ]);
    const enemy = makeSnake('enemy', '#222222', [
      { x: 7, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
    ]);
    const wall = makeSnake('wall', '#333333', [
      { x: 6, y: 8 }, { x: 6, y: 7 }, { x: 6, y: 6 },
      { x: 5, y: 6 }, { x: 4, y: 6 },
    ]);
    const wall2 = makeSnake('wall2', '#444444', [
      { x: 6, y: 2 }, { x: 6, y: 3 }, { x: 6, y: 4 },
      { x: 5, y: 4 }, { x: 4, y: 4 },
    ]);
    // Second food top-left breaks the up/down symmetry so the pinned move is
    // strictly best, not a tie resolved by enumeration order.
    const gameState = makeGameState('gm-corridor', [us, enemy, wall, wall2], 'us', [
      { x: 5, y: 5 },
      { x: 2, y: 8 },
    ]);

    const result = await run(gameState);

    expect(result.move).toBe('up');
    expect(result.safeMoves).toEqual(['up', 'down', 'right']);
    expect(result.scores.get('up')).toBeCloseTo(432.3083391459327, 6);
    expect(result.scores.get('down')).toBeCloseTo(408.49015732775086, 6);
    expect(result.scores.get('right')).toBeCloseTo(185.191123211846, 6);

    const up = evalFor(result, 'up');
    expect(up.numStates).toBe(3);
    expect(up.breakdown.myTerritory).toBe(24);
    expect(up.breakdown.selfSpace).toBeCloseTo(2.6457513110645907, 9);
    expect(up.breakdown.deaths).toBe(0);
    expect(up.breakdown.trapped).toBe(0);

    const down = evalFor(result, 'down');
    expect(down.numStates).toBe(3);
    expect(down.breakdown.myTerritory).toBe(23);
    expect(down.breakdown.selfSpace).toBeCloseTo(2.6457513110645907, 9);

    // Worst case inside the corridor: squeezed to a sliver of space.
    const right = evalFor(result, 'right');
    expect(right.numStates).toBe(3);
    expect(right.breakdown.myTerritory).toBe(15);
    expect(right.breakdown.selfSpace).toBeCloseTo(0.5773502691896257, 9);
    expect(right.breakdown.deaths).toBe(0);
  });

  test('near-trapped pocket: picks the exit that preserves space', async () => {
    // Our snake has coiled a pocket against the left wall; right leads back
    // toward the open board, down turns into the pocket's dead space.
    const us = makeSnake('us', '#111111', [
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 2 },
    ]);
    const enemy = makeSnake('enemy', '#222222', [
      { x: 8, y: 8 },
      { x: 8, y: 7 },
      { x: 8, y: 6 },
    ]);
    const gameState = makeGameState('gm-pocket', [us, enemy], 'us', [{ x: 5, y: 9 }]);

    const result = await run(gameState);

    expect(result.move).toBe('right');
    expect(result.safeMoves).toEqual(['up', 'down', 'right']);
    expect(result.scores.get('right')).toBeCloseTo(485.0697580112788, 6);
    expect(result.scores.get('up')).toBeCloseTo(464.7211521390788, 6);
    expect(result.scores.get('down')).toBeCloseTo(373.45407685048605, 6);

    const right = evalFor(result, 'right');
    expect(right.numStates).toBe(1);
    expect(right.breakdown.myTerritory).toBe(41);
    expect(right.breakdown.selfSpace).toBeCloseTo(2.1505813167606567, 9);
    expect(right.breakdown.deaths).toBe(0);
    expect(right.breakdown.trapped).toBe(0);

    const up = evalFor(result, 'up');
    expect(up.breakdown.myTerritory).toBe(38);
    expect(up.breakdown.selfSpace).toBeCloseTo(2.03100960115899, 9);

    const down = evalFor(result, 'down');
    expect(down.breakdown.myTerritory).toBe(29);
    expect(down.breakdown.selfSpace).toBeCloseTo(1.8371173070873836, 9);
  });
});
