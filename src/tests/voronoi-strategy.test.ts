/**
 * Golden-master tests for VoronoiStrategy.getBestMoveIterative — the full
 * strategy stack (config -> team detection -> iterative engine -> debug
 * payload assembly) pinned on six fixed boards:
 *   1. open board         — territory-maximizing move on an empty midfield;
 *   2. contested corridor — refuses the one-cell channel an enemy contests;
 *   3. near-trapped pocket — picks the exit that preserves reachable space;
 *   4. contested midline  — same-turn arrivals go to the heavier snake, so no
 *      neutral seam survives between snakes of different length;
 *   5-6. knight on the board, at both sides of the displacement threshold —
 *      a piece takes ground off a snake only by out-weighing the claim it made,
 *      and then claims it in the piece's own moves (L-jumps, not snake steps).
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
    orientation: { dx: 0, dy: -1 },
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
    expect(result.scores.get('up')).toBeCloseTo(969.6216116420064, 6);
    expect(result.scores.get('left')).toBeCloseTo(920.878112807455, 6);
    expect(result.scores.get('right')).toBeCloseTo(935.9690218983641, 6);

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
    //
    // The two wall snakes are length 5 to our 3, so under the tie rule they
    // WIN the cells they reach on the same turn we do — which is what the
    // second food at (2,7) now discriminates: going up we get there first and
    // own it, going down we arrive level with the heavier wall snake and lose
    // it (its earlier home at (2,8) is a cell that wall reaches level with us
    // from EITHER candidate, leaving up and down indistinguishable).
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
      { x: 2, y: 7 },
    ]);

    const result = await run(gameState);

    expect(result.move).toBe('up');
    expect(result.safeMoves).toEqual(['up', 'down', 'right']);
    expect(result.scores.get('up')).toBeCloseTo(370.6917936636112, 6);
    expect(result.scores.get('down')).toBeCloseTo(342.3281572999748, 6);
    expect(result.scores.get('right')).toBeCloseTo(180.191123211846, 6);

    const up = evalFor(result, 'up');
    expect(up.numStates).toBe(3);
    expect(up.breakdown.myTerritory).toBe(18);
    expect(up.breakdown.foodDistance).toBe(3);
    expect(up.breakdown.selfSpace).toBeCloseTo(2.23606797749979, 9);
    expect(up.breakdown.deaths).toBe(0);
    expect(up.breakdown.trapped).toBe(0);

    const down = evalFor(result, 'down');
    expect(down.numStates).toBe(3);
    expect(down.breakdown.myTerritory).toBe(17);
    // The heavier wall snake reaches (2,7) on the same turn we would from
    // here, so the food is not ours to count.
    expect(down.breakdown.foodDistance).toBe(1000);
    expect(down.breakdown.selfSpace).toBeCloseTo(2.23606797749979, 9);

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
    // Our 8-long body outweighs the 3-long enemy, so every cell of the
    // midfield we reach on the same turn it does is ours under the tie rule —
    // which lifts all three candidates' territory without reordering them.
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
    expect(result.scores.get('right')).toBeCloseTo(542.98484809835, 6);
    expect(result.scores.get('up')).toBeCloseTo(522.6049894151541, 6);
    expect(result.scores.get('down')).toBeCloseTo(428.0697580112788, 6);

    const right = evalFor(result, 'right');
    expect(right.numStates).toBe(1);
    expect(right.breakdown.myTerritory).toBe(53);
    expect(right.breakdown.selfSpace).toBeCloseTo(2.4748737341529163, 9);
    expect(right.breakdown.deaths).toBe(0);
    expect(right.breakdown.trapped).toBe(0);

    const up = evalFor(result, 'up');
    expect(up.breakdown.myTerritory).toBe(49);
    expect(up.breakdown.selfSpace).toBeCloseTo(2.3717082451262845, 9);

    const down = evalFor(result, 'down');
    expect(down.breakdown.myTerritory).toBe(40);
    expect(down.breakdown.selfSpace).toBeCloseTo(2.1505813167606567, 9);
  });

  test('snake vs snake: the heavier snake takes the contested midline (ties are no longer neutral)', async () => {
    // Two snakes facing each other across an empty board, five cells apart, so
    // the whole column x=5 (and every other equidistant cell) is reached by
    // both on the same turn. That used to leave a neutral seam nobody owned or
    // expanded through; the tie rule hands each of those cells to whoever wins
    // the collision, and with equal tiers that is the longer snake — so the
    // seam disappears and the board splits with no neutral cell anywhere.
    const us = makeSnake('us', '#111111', [
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
      { x: 0, y: 5 },
      { x: 0, y: 4 },
    ]);
    const enemy = makeSnake('enemy', '#222222', [
      { x: 7, y: 5 },
      { x: 8, y: 5 },
      { x: 9, y: 5 },
    ]);
    const gameState = makeGameState('gm-midline', [us, enemy], 'us', []);

    const result = await run(gameState);

    const { sources, owner } = result.cellOwnership;
    const usIdx = sources.indexOf('us');
    const at = (x: number, y: number) => y * 11 + x;

    // The contested midline is ours, top to bottom.
    for (let y = 0; y < 11; y++) expect(owner[at(5, y)]).toBe(usIdx);
    // And with the weights unequal, no cell on the board stays neutral.
    expect(owner.filter((o) => o === -1)).toHaveLength(0);
    expect(result.territoryCells['us']).toHaveLength(66);
    expect(result.territoryCells['enemy']).toHaveLength(55);
  });

  // Both knight goldens share the open-board geometry, with the corner enemy
  // replaced by a knight. Reach is no longer what divides the board — snakes
  // divide it and a piece takes squares only by out-weighing the snake that
  // claimed them — so the pair is pinned at the two sides of that threshold.
  function knightBoard(gameId: string, knightWeight: number): GameState {
    const us = makeSnake('us', '#111111', [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ]);
    const knight = makeSnake('knight', '#222222', [{ x: 0, y: 10 }]);
    knight.unitType = 'knight';
    // A piece's `length` is its stack WEIGHT, not a body cell count.
    knight.length = knightWeight;
    return makeGameState(gameId, [us, knight], 'us', [{ x: 8, y: 5 }]);
  }

  test('knight of our own weight: reach buys it nothing, because it could not HOLD a square against us', async () => {
    // Equal tier, equal weight: every contest with our snake is a mutual kill,
    // which is not holding the square, so the knight displaces nothing. It
    // keeps the one square it stands on — a physical wall no snake can enter —
    // and we own the whole rest of the board. That the knight sweeps most of
    // the board in three jumps is now beside the point.
    const result = await run(knightBoard('gm-knight-even', 3));

    expect(result.territoryCells['knight']).toEqual([{ x: 0, y: 10 }]);
    expect(result.territoryCells['us']).toHaveLength(120);
    expect(result.cellOwnership.owner.filter((o) => o === -1)).toHaveLength(0); // no neutral

    // With every candidate owning the same 120 cells, territory says nothing
    // and the food pull decides — where the open-board fixture's step-walking
    // enemy did dent our territory enough for 'up' to win.
    expect(result.move).toBe('right');
    expect(evalFor(result, 'up').breakdown.myTerritory).toBe(120);
    expect(evalFor(result, 'right').breakdown.myTerritory).toBe(120);
    expect(evalFor(result, 'right').breakdown.foodDistance).toBe(3);
    expect(result.scores.get('right')).toBeCloseTo(1122.1413814712837, 6);
  });

  test('heavier knight: it displaces us wherever it can be there in time, and its claim distances are L-jumps', async () => {
    // Weight 6 to our 3, so the knight wins every contest it can reach in
    // time — "in time" being the turn OUR snake would first be standing there.
    // Near its corner that gate is wide open and the knight takes the ground;
    // around our head the snake is there first and keeps it.
    const result = await run(knightBoard('gm-knight-heavy', 6));

    expect(result.territoryCells['knight']).toHaveLength(100);
    // What is left to us is the compact blob where our step count still beats
    // the knight's jump count — the only ground it cannot be standing on first.
    expect(result.territoryCells['us']).toHaveLength(21);

    // The claimed distances ARE knight moves. Its two nearest in-board jumps
    // land at distance 1, while the squares physically ADJACENT to it cost
    // three jumps — the exact inversion a step metric can never produce.
    const { sources, owner, distance } = result.cellOwnership;
    const knightIdx = sources.indexOf('knight');
    const at = (x: number, y: number) => y * 11 + x;
    for (const [x, y, d] of [[2, 9, 1], [1, 8, 1], [0, 9, 3], [1, 10, 3]]) {
      expect(owner[at(x, y)]).toBe(knightIdx);
      expect(distance[at(x, y)]).toBe(d);
    }
    // Our own doorstep is ours: the knight needs two jumps to reach it and we
    // are standing there on turn one.
    expect(owner[at(5, 6)]).toBe(sources.indexOf('us'));
    expect(distance[at(5, 6)]).toBe(1);

    // Our own move still comes from the same matrix over the new territory:
    // 'right', the one candidate that keeps the food inside what is left to us.
    expect(result.move).toBe('right');
    expect(result.scores.get('right')).toBeCloseTo(374.1635562995723, 6);
    expect(evalFor(result, 'right').breakdown.myTerritory).toBe(14);
    expect(evalFor(result, 'right').breakdown.foodDistance).toBe(3);
    // From 'up' the knight holds the food square, so no food is ours at all.
    expect(evalFor(result, 'up').breakdown.myTerritory).toBe(8);
    expect(evalFor(result, 'up').breakdown.foodDistance).toBe(1000);
  });
});
