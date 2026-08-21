/**
 * Severing in simulated candidate-move board states.
 *
 * The server's collision phase (engine/turnEngine.ts) lets a
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

/**
 * FROZEN STATE — nothing leaves the board mid-turn.
 *
 * The engine removes a dead unit only once the whole collision phase is over:
 * until then it HALTS where it stood and stays there as a collision object,
 * body and all. So a unit dying this turn never opens a square for anybody
 * else this turn, and "that cell frees up when they die" — which the simulator
 * used to grant, by skipping any snake already in its running dead set — is
 * exactly the reasoning the engine now forbids.
 *
 * This also makes the resolution order-independent, which is the property the
 * engine is built around: whether A is condemned before or after B is
 * adjudicated cannot change B's outcome.
 */
describe('frozen state: a unit that dies this turn keeps blocking for the rest of it', () => {
  const simulator = new Simulator();

  /**
   * `doomed` (length 3, head (5,5)) walks head-on into `bully` (length 5) and
   * loses the head-to-head at (5,6). `follower` (length 3, head (4,4)) steps
   * right onto (5,4) — an INTERIOR segment of `doomed` (index 1, so not the
   * tail that pops), which is still there.
   */
  function corpseScenario() {
    const doomed = makeSnake('doomed', [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }], {
      customizations: { color: '#00FF00', head: 'default', tail: 'default' },
    });
    const bully = makeSnake('bully', [
      { x: 5, y: 7 }, { x: 5, y: 8 }, { x: 5, y: 9 }, { x: 5, y: 10 }, { x: 4, y: 10 },
    ], { customizations: { color: '#0000FF', head: 'default', tail: 'default' } });
    const follower = makeSnake('follower', [
      { x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 },
    ]);
    return makeGameState([doomed, bully, follower], follower);
  }

  test('its body still kills a unit that steps onto it in the same turn', () => {
    const gs = corpseScenario();
    const result = simulator.simulateNextBoardState(
      gs,
      // doomed goes up into bully's head square and loses; follower steps onto
      // doomed's index-1 segment at (5,4) in the very same turn.
      moves([['doomed', 'up'], ['bully', 'down'], ['follower', 'right']])
    );

    expect(result.deadSnakeIds.has('doomed')).toBe(true);
    // THE POINT: the corpse blocked. follower does not get to walk through it.
    expect(result.deadSnakeIds.has('follower')).toBe(true);
  });

  test('the same square is walkable once the corpse is genuinely gone', () => {
    // Positive control: with `doomed` shifted off (5,4) entirely, the step is
    // ordinary and survivable — so the death above really is what blocked it.
    const gs = corpseScenario();
    const doomed = gs.board.snakes.find(s => s.id === 'doomed')!;
    doomed.body = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }];
    doomed.head = doomed.body[0];

    const result = simulator.simulateNextBoardState(
      gs, moves([['doomed', 'up'], ['bully', 'down'], ['follower', 'right']])
    );
    expect(result.deadSnakeIds.has('doomed')).toBe(true);
    expect(result.deadSnakeIds.has('follower')).toBe(false);
  });

  test('a PIECE killed on its square still holds it against a second arrival', () => {
    // A light pawn is taken by a heavy rook stepping onto its square, and a
    // snake steps onto the same square in the same turn. The pawn's stack is
    // still there for the whole turn, so the snake meets a contest it loses —
    // it does not stroll onto a conveniently emptied cell.
    const pawn = makeSnake('pawn', [{ x: 6, y: 5 }], { unitType: 'pawn', length: 4 });
    const snake = makeSnake('snake', [{ x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }], {
      customizations: { color: '#00FF00', head: 'default', tail: 'default' },
    });
    const gs = makeGameState([pawn, snake], snake);

    const result = simulator.simulateNextBoardState(gs, moves([['snake', 'up']]));
    // Weight 3 against the pawn's weight 4 at equal tier: the snake loses.
    expect(result.deadSnakeIds.has('snake')).toBe(true);
  });
});

/**
 * EDGE EXCHANGES — the UNIFORM rule.
 *
 * Two units whose HEADS exchange through one edge in one sub-step contest that
 * edge on frozen tier then frozen weight. It is uniform across every unit:
 * having a trail makes no difference, and length makes no difference. The only
 * exemption the engine has is a JUMP (a knight crosses no edge), and a
 * knight's L-offset can never land on an adjacent cell anyway, so nothing can
 * exchange heads with one.
 *
 * The loser is SQUASHED AGAINST ITS OWN NECK: it dies on the cell its head
 * held at the start of the turn, never on the one it was reaching for. The
 * winner completes into that cell and is its survivor, never re-adjudicated
 * against the corpse it just made there.
 *
 * INVERTED. This used to be modelled the other way round: a multi-cell snake
 * was exempt because its body "swept in behind the head", so a would-be
 * swapper met a segment and the meeting resolved through the body rules —
 * mutual annihilation at equal tier whatever the weights, and a piece dying on
 * a snake's neck. That exemption is gone. Two length-2 snakes exchanging is a
 * pure weight contest; so is a piece exchanging with a multi-cell snake.
 *
 * Head CHASING is a different event and is unchanged: if the target moved away
 * or aside, its old cell is its NECK by the time you arrive, and the body-wall
 * rules apply. You cannot chase a head.
 */
describe('edge exchanges are uniform: trails and lengths make no difference', () => {
  const simulator = new Simulator();

  /** `a` at (5,5) and `b` at (6,5) step straight into each other's heads. */
  function exchange(a: Snake, b: Snake) {
    return simulator.simulateNextBoardState(
      makeGameState([a, b], a), moves([['a', 'right'], ['b', 'left']])
    );
  }
  const green = { customizations: { color: '#00FF00', head: 'default', tail: 'default' } };

  test('two LENGTH-1 snakes: equal weight, so nobody is left standing', () => {
    const result = exchange(
      makeSnake('a', [{ x: 5, y: 5 }]),
      makeSnake('b', [{ x: 6, y: 5 }], green)
    );
    expect(result.deadSnakeIds).toEqual(new Set(['a', 'b']));
  });

  test('two LENGTH-2 snakes of equal weight deadlock — a weight contest, not two necks', () => {
    const result = exchange(
      makeSnake('a', [{ x: 5, y: 5 }, { x: 4, y: 5 }]),
      makeSnake('b', [{ x: 6, y: 5 }, { x: 7, y: 5 }], green)
    );
    expect(result.deadSnakeIds).toEqual(new Set(['a', 'b']));
  });

  test('UNEVEN multi-cell weight: the heavier crosses, the lighter is squashed at home', () => {
    // Weight 3 against weight 2. Under the old swept-in-neck doctrine BOTH
    // died here; under the uniform rule weight simply decides.
    const result = exchange(
      makeSnake('a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]),
      makeSnake('b', [{ x: 6, y: 5 }, { x: 7, y: 5 }], green)
    );
    expect(result.deadSnakeIds).toEqual(new Set(['b']));
    // The winner really did complete the step, onto the loser's own head cell.
    expect(result.board.snakes.find(s => s.id === 'a')!.head).toEqual({ x: 6, y: 5 });
  });

  test('length-1 against multi-cell is the same weight contest, not a special case', () => {
    const result = exchange(
      makeSnake('a', [{ x: 5, y: 5 }]),
      makeSnake('b', [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], green)
    );
    expect(result.deadSnakeIds).toEqual(new Set(['a']));
    expect(result.board.snakes.find(s => s.id === 'b')!.head).toEqual({ x: 5, y: 5 });
  });

  test('TIER is consulted before weight: the lighter, higher-tier snake crosses', () => {
    // Weight 2 at tier 1 against weight 4 at tier 0. A weight-only edge rule
    // would hand this to the heavier snake; the engine reads frozen tier
    // first. (This is also the one exchange shape where the old swept-in-neck
    // doctrine reached the same verdict, by a different route — the loser died
    // on the winner's neck rather than being squashed at home. The simulator
    // does not track death cells, so what is pinned here is the ordering.)
    const light = makeSnake('a', [{ x: 5, y: 5 }, { x: 4, y: 5 }], {
      invulnerabilityLevel: 1, invulnerabilityExpiryTurn: 99,
    });
    const heavy = makeSnake('b', [
      { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 },
    ], green);
    const result = exchange(light, heavy);

    expect(result.deadSnakeIds).toEqual(new Set(['b']));
    expect(result.board.snakes.map(s => s.id)).toEqual(['a']);
    expect(result.board.snakes[0].head).toEqual({ x: 6, y: 5 });
  });

  test('a PIECE exchanging heads with a multi-cell snake contests it like anything else', () => {
    // A weight-3 rook against a weight-2 snake. Under the old doctrine the
    // piece died bodyBlock on the snake's swept-in neck; now weight decides.
    const rook = makeSnake('a', [{ x: 5, y: 5 }], { unitType: 'rook', length: 3 });
    const snake = makeSnake('b', [{ x: 6, y: 5 }, { x: 7, y: 5 }], green);
    const heavierPiece = exchange(rook, snake);
    expect(heavierPiece.deadSnakeIds).toEqual(new Set(['b']));

    // And the other way round: a weight-1 rook against a weight-4 snake.
    const lightRook = makeSnake('a', [{ x: 5, y: 5 }], { unitType: 'rook', length: 1 });
    const bigSnake = makeSnake('b', [
      { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 },
    ], green);
    const heavierSnake = exchange(lightRook, bigSnake);
    expect(heavierSnake.deadSnakeIds).toEqual(new Set(['a']));
  });

  test('head CHASING is not an exchange: the neck rules still apply', () => {
    // `b` steps AWAY rather than into `a`, so the cell `a` enters is `b`'s
    // neck — a body wall at equal tier, and `a` dies on it.
    const a = makeSnake('a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);
    const b = makeSnake('b', [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }], green);
    const result = simulator.simulateNextBoardState(
      makeGameState([a, b], a), moves([['a', 'right'], ['b', 'up']])
    );
    expect(result.deadSnakeIds.has('a')).toBe(true);
    expect(result.deadSnakeIds.has('b')).toBe(false);
  });

  test("a squashed length-1 loser's death cell still blocks a third unit", () => {
    // Two length-1 snakes deadlock the edge, so BOTH are squashed at home and
    // neither crosses. Their corpses own no cells at all — each one's only
    // cell was the tail it shed — but the cells they died on are collision
    // objects for the rest of the turn, so `third` arriving on one meets the
    // pile rather than an empty square. Without that, a one-cell mover's cell
    // would read as vacated and this step would look free.
    const dot1 = makeSnake('a', [{ x: 5, y: 5 }]);
    const dot2 = makeSnake('b', [{ x: 6, y: 5 }], green);
    const third = makeSnake('third', [{ x: 5, y: 4 }, { x: 5, y: 3 }], {
      customizations: { color: '#0000FF', head: 'default', tail: 'default' },
    });
    const result = simulator.simulateNextBoardState(
      makeGameState([dot1, dot2, third], third),
      moves([['a', 'right'], ['b', 'left'], ['third', 'up']])
    );
    expect(result.deadSnakeIds).toEqual(new Set(['a', 'b', 'third']));
  });

  test('a multi-cell loser leaves its body MINUS the shed tail, and the tail cell is free', () => {
    // Weight 3 beats weight 2. The loser is squashed at (6,5); its tail (7,5)
    // departed anyway, because tails are never contingent on a contest ahead
    // of the head. So (7,5) is walkable and (6,5) is not — and (6,5) is where
    // the winner is standing.
    const winner = makeSnake('a', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }]);
    const loser = makeSnake('b', [{ x: 6, y: 5 }, { x: 7, y: 5 }], green);
    const onTail = makeSnake('third', [{ x: 7, y: 4 }, { x: 7, y: 3 }], {
      customizations: { color: '#0000FF', head: 'default', tail: 'default' },
    });
    const result = simulator.simulateNextBoardState(
      makeGameState([winner, loser, onTail], onTail),
      moves([['a', 'right'], ['b', 'left'], ['third', 'up']])
    );
    expect(result.deadSnakeIds).toEqual(new Set(['b']));
    expect(result.board.snakes.find(s => s.id === 'third')!.head).toEqual({ x: 7, y: 5 });
  });
});
