/**
 * Severing in simulated candidate-move board states.
 *
 * The server's collision pass (SnekProcessor.checkSnakeCollisionsTiered) lets a
 * snake that STRICTLY out-invulnerates another move onto that snake's body and
 * SEVER it: the contacted segment and everything behind it are removed, and the
 * owner survives shortened. BoardGraph's passabilityFor already models this for
 * move legality, but the Simulator used to leave the target body intact — the
 * mover survived the pass-through, yet every heuristic then evaluated a board
 * where the severed wall still stood (and the mover's head overlapped it), so
 * moves through severable bodies were scored as leading into fatal pockets.
 *
 * Also guards the companion bug: deepCopyBoard dropped invulnerabilityExpiryTurn,
 * so BoardGraphs built over simulated boards read every buff as "this turn only"
 * and severability-aware lookahead (e.g. the trapped floodfill) went blind.
 */

import { Simulator, MoveSet } from '../logic/simulator';
import { BoardGraph } from '../logic/board-graph';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

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
    customizations: { color: '#FF0000', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra
  };
}

function makeGameState(snakes: Snake[], you: Snake, turn = 10): GameState {
  return {
    game: {
      id: 'test',
      ruleset: { name: 'standard', version: '1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard'
    },
    turn,
    board: {
      width: 11,
      height: 11,
      snakes,
      food: [],
      hazards: []
    },
    you
  };
}

const moves = (entries: [string, Direction][]): MoveSet => new Map(entries);

/**
 * Us at (5,5) pointing up; the enemy runs down the x=6 column with its head at
 * (6,9), so (6,5) — immediately to our right — is deep interior body that does
 * not vacate for many turns. Moving right is fatal unless we can sever.
 */
function severingScenario(ourExtra: Partial<Snake>, enemyExtra: Partial<Snake> = {}) {
  const us = makeSnake('us', [
    { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }
  ], ourExtra);
  const enemy = makeSnake('enemy', [
    { x: 6, y: 9 }, { x: 6, y: 8 }, { x: 6, y: 7 }, { x: 6, y: 6 },
    { x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }
  ], enemyExtra);
  return makeGameState([us, enemy], us);
}

describe('severing in simulated board states', () => {
  const simulator = new Simulator();

  test('a strictly more invulnerable mover severs the enemy body at the contact segment', () => {
    const gameState = severingScenario({ invulnerabilityLevel: 2, invulnerabilityExpiryTurn: 20 });
    const result = simulator.simulateNextBoardState(
      gameState,
      moves([['us', 'right'], ['enemy', 'up']])
    );

    expect(result.deadSnakeIds.size).toBe(0);

    const us = result.board.snakes.find(s => s.id === 'us')!;
    expect(us.head).toEqual({ x: 6, y: 5 });
    expect(us.length).toBe(3);

    // Enemy moved up (new head (6,10), tail (6,2) vacated), then lost the
    // contacted segment (6,5) and everything behind it.
    const enemy = result.board.snakes.find(s => s.id === 'enemy')!;
    expect(enemy.body).toEqual([
      { x: 6, y: 10 }, { x: 6, y: 9 }, { x: 6, y: 8 }, { x: 6, y: 7 }, { x: 6, y: 6 }
    ]);
    expect(enemy.length).toBe(5);
  });

  test('a frozen (unmoved) snake can still be severed', () => {
    const gameState = severingScenario({ invulnerabilityLevel: 2, invulnerabilityExpiryTurn: 20 });
    const result = simulator.simulateNextBoardState(gameState, moves([['us', 'right']]));

    expect(result.deadSnakeIds.size).toBe(0);
    const enemy = result.board.snakes.find(s => s.id === 'enemy')!;
    // Frozen enemy keeps its pre-move body up to the contact cell (6,5).
    expect(enemy.body).toEqual([
      { x: 6, y: 9 }, { x: 6, y: 8 }, { x: 6, y: 7 }, { x: 6, y: 6 }
    ]);
    expect(enemy.length).toBe(4);
  });

  test('equal invulnerability never severs — the mover dies on the body', () => {
    const gameState = severingScenario(
      { invulnerabilityLevel: 2, invulnerabilityExpiryTurn: 20 },
      { invulnerabilityLevel: 2, invulnerabilityExpiryTurn: 20 }
    );
    const result = simulator.simulateNextBoardState(
      gameState,
      moves([['us', 'right'], ['enemy', 'up']])
    );

    expect(result.deadSnakeIds).toEqual(new Set(['us']));
    const enemy = result.board.snakes.find(s => s.id === 'enemy')!;
    expect(enemy.length).toBe(8); // intact after moving
  });

  test('a buff that expires on the current turn no longer governs the arrival collision', () => {
    // Arrival turn is 11; expiry 10 means the level projects to 0 there.
    const gameState = severingScenario({ invulnerabilityLevel: 2, invulnerabilityExpiryTurn: 10 });
    const result = simulator.simulateNextBoardState(
      gameState,
      moves([['us', 'right'], ['enemy', 'up']])
    );

    expect(result.deadSnakeIds).toEqual(new Set(['us']));
  });

  test('a level with no expiry schedule applies this turn only (conservative default)', () => {
    const gameState = severingScenario({ invulnerabilityLevel: 2 });
    const result = simulator.simulateNextBoardState(
      gameState,
      moves([['us', 'right'], ['enemy', 'up']])
    );

    expect(result.deadSnakeIds).toEqual(new Set(['us']));
  });

  test("an enemy buff lapsing before we arrive stops protecting its body", () => {
    // Nominal levels are equal (1 vs 1), but the enemy's lapses at turn 10 while
    // ours holds to 30 — at the arrival turn (11) we strictly out-invulnerate.
    const gameState = severingScenario(
      { invulnerabilityLevel: 1, invulnerabilityExpiryTurn: 30 },
      { invulnerabilityLevel: 1, invulnerabilityExpiryTurn: 10 }
    );
    const result = simulator.simulateNextBoardState(
      gameState,
      moves([['us', 'right'], ['enemy', 'up']])
    );

    expect(result.deadSnakeIds.size).toBe(0);
    const enemy = result.board.snakes.find(s => s.id === 'enemy')!;
    expect(enemy.length).toBe(5);
  });

  test('simulated boards preserve invulnerabilityExpiryTurn for downstream evaluation', () => {
    const gameState = severingScenario(
      { invulnerabilityLevel: 2, invulnerabilityExpiryTurn: 20 },
      { invulnerabilityLevel: 1, invulnerabilityExpiryTurn: 15 }
    );
    const result = simulator.simulateNextBoardState(
      gameState,
      moves([['us', 'up'], ['enemy', 'up']])
    );

    const us = result.board.snakes.find(s => s.id === 'us')!;
    const enemy = result.board.snakes.find(s => s.id === 'enemy')!;
    expect(us.invulnerabilityExpiryTurn).toBe(20);
    expect(enemy.invulnerabilityExpiryTurn).toBe(15);
  });

  test('severability-aware lookahead still works on a BoardGraph built over a simulated board', () => {
    // Regression: deepCopyBoard dropped the expiry, so the post-move BoardGraph
    // fell back to "level applies this turn only" and read our invulnerability
    // as 0 from the first lookahead turn — enemy walls we were entitled to
    // sever were treated as solid, and pocket moves were falsely marked fatal.
    const gameState = severingScenario({ invulnerabilityLevel: 2, invulnerabilityExpiryTurn: 40 });
    const result = simulator.simulateNextBoardState(
      gameState,
      moves([['us', 'up'], ['enemy', 'up']])
    );

    const nextGameState: GameState = {
      ...gameState,
      turn: gameState.turn + 1,
      board: result.board,
      you: result.board.snakes.find(s => s.id === 'us')!
    };
    const graph = new BoardGraph(nextGameState);
    const pass = graph.passabilityIdxFor('us', { clearance: 'optimistic' });

    // (6,6) is deep enemy interior on the post-move board; only severability
    // can make it passable one turn out.
    expect(pass.passableIdx(graph.cellIndex(6, 6), 1)).toBe(true);
  });
});

/**
 * Engine-aligned movement physics: the game engine pops every snake's tail
 * BEFORE resolving collisions (eating or not) and grows by duplicating the
 * NEW tail — so "ate last turn" is visible as a stacked tail. These pin the
 * simulator to those semantics (mirrored by regression tests on the server's
 * SnekProcessor in the TacticToes repo).
 */
describe('engine-aligned tail and eating physics', () => {
  const simulator = new Simulator();

  test('moving into own tail cell while eating survives (tail pops before food)', () => {
    // 2x2 coil: head (2,1), body (1,1), (1,2), tail (2,2). Food on the tail
    // cell. Moving down onto the tail is legal because the tail pops first;
    // the eat then duplicates the NEW tail.
    const us = makeSnake('us', [
      { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }
    ]);
    const gs = makeGameState([us], us);
    gs.board.food = [{ x: 2, y: 1 }];

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'down']]));

    expect(result.deadSnakeIds.has('us')).toBe(false);
    const sim = result.board.snakes.find(s => s.id === 'us')!;
    expect(sim.body).toEqual([
      { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 1, y: 1 }
    ]);
    expect(sim.health).toBe(100);
    expect(result.board.food).toEqual([]);
  });

  test('moving into own STACKED tail cell dies (ate last turn, one pop is not enough)', () => {
    const us = makeSnake('us', [
      { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 1 }
    ]);
    const gs = makeGameState([us], us);

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'down']]));

    expect(result.deadSnakeIds.has('us')).toBe(true);
  });

  test("an enemy's tail vacates even when that enemy eats this turn", () => {
    // Enemy head (8,8) moving onto food at (8,9); its tail (8,5) still pops —
    // eating no longer blocks tail vacation. We step onto the vacated cell.
    const us = makeSnake('us', [
      { x: 8, y: 4 }, { x: 7, y: 4 }, { x: 6, y: 4 }
    ]);
    const enemy = makeSnake('enemy', [
      { x: 8, y: 8 }, { x: 8, y: 7 }, { x: 8, y: 6 }, { x: 8, y: 5 }
    ], { customizations: { color: '#00FF00', head: 'default', tail: 'default' } });
    const gs = makeGameState([us, enemy], us);
    gs.board.food = [{ x: 8, y: 9 }];

    const result = simulator.simulateNextBoardState(
      gs, moves([['us', 'up'], ['enemy', 'up']])
    );

    expect(result.deadSnakeIds.has('us')).toBe(false);
    expect(result.deadSnakeIds.has('enemy')).toBe(false);
    const simEnemy = result.board.snakes.find(s => s.id === 'enemy')!;
    // Enemy grew by duplicating its new tail; the old tail cell (8,5) is ours.
    expect(simEnemy.body).toEqual([
      { x: 8, y: 9 }, { x: 8, y: 8 }, { x: 8, y: 7 }, { x: 8, y: 6 }, { x: 8, y: 6 }
    ]);
    const simUs = result.board.snakes.find(s => s.id === 'us')!;
    expect(simUs.head).toEqual({ x: 8, y: 5 });
  });

  test('eating restores health to the configured maxHealth, not a hardcoded 100', () => {
    const us = makeSnake('us', [
      { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }
    ], { health: 5, maxHealth: 40 });
    const gs = makeGameState([us], us);
    gs.board.food = [{ x: 3, y: 2 }];

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));

    const sim = result.board.snakes.find(s => s.id === 'us')!;
    expect(sim.health).toBe(40);
    // maxHealth must survive deepCopyBoard so chained simulations (boards
    // simulated from this result) keep restoring to the configured max.
    expect(sim.maxHealth).toBe(40);
  });

  test('a snake without maxHealth keeps the engine-default 100 on eating', () => {
    const us = makeSnake('us', [
      { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }
    ], { health: 5 });
    const gs = makeGameState([us], us);
    gs.board.food = [{ x: 3, y: 2 }];

    const result = simulator.simulateNextBoardState(gs, moves([['us', 'right']]));

    const sim = result.board.snakes.find(s => s.id === 'us')!;
    expect(sim.health).toBe(100);
    expect(sim.maxHealth).toBeUndefined();
  });

  test("an enemy's STACKED tail does not vacate this turn", () => {
    // Enemy ate last turn: tail duplicated at (8,5). One pop leaves a copy,
    // so stepping onto (8,5) is fatal.
    const us = makeSnake('us', [
      { x: 8, y: 4 }, { x: 7, y: 4 }, { x: 6, y: 4 }
    ]);
    const enemy = makeSnake('enemy', [
      { x: 8, y: 8 }, { x: 8, y: 7 }, { x: 8, y: 6 }, { x: 8, y: 5 }, { x: 8, y: 5 }
    ], { customizations: { color: '#00FF00', head: 'default', tail: 'default' } });
    const gs = makeGameState([us, enemy], us);

    const result = simulator.simulateNextBoardState(
      gs, moves([['us', 'up'], ['enemy', 'up']])
    );

    expect(result.deadSnakeIds.has('us')).toBe(true);
  });
});
