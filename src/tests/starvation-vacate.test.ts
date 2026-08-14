/**
 * Starvation-aware body vacating in the BoardGraph passability layers.
 *
 * Health loss is movement-tied (snakes always move, so they lose exactly
 * 1/turn unless they eat). A snake with health h dies during relative turn h
 * unless it eats by then; eating ON turn h saves it (the engine checks the
 * eat branch before the starvation branch). If a walls-only BFS — ignoring
 * all bodies and hazards, a generous LOWER bound on the snake's earliest
 * possible eat e — cannot reach any already-spawned food within h turns
 * (e > h), the snake certainly starves and its whole body vacates from
 * arrival turn max(h + 1, 2) in the optimistic and physical layers, with the
 * conservative layer keeping its usual +1 buffer. Chess pieces never starve
 * (they can stand still), and a subject never gets its OWN body
 * starvation-vacated. New-food-spawn risk is accepted, same risk class as
 * the tail projections.
 */

import { BoardGraph } from '../logic/board-graph';
import { MultiSourceBFS, OWNER_UNREACHED } from '../logic/multi-source-bfs';
import { GameState, Snake, Coord } from '../types/battlesnake';

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
    facing: { dx: 0, dy: -1 },
    ...extra
  };
}

function makeGameState(
  snakes: Snake[],
  you: Snake,
  food: Coord[] = [],
  size: { width: number; height: number } = { width: 11, height: 11 }
): GameState {
  return {
    game: {
      id: 'test',
      ruleset: { name: 'standard', version: '1', settings: {} },
      timeout: 500,
      source: 'test',
      map: 'standard'
    },
    turn: 10,
    board: {
      width: size.width,
      height: size.height,
      snakes,
      food,
      hazards: []
    },
    you
  };
}

// Coord-based conveniences over the integer-indexed BoardGraph API.
const passAt = (graph: BoardGraph, coord: Coord, turn: number): boolean =>
  graph.isPassableAtTurnIdx(graph.cellIndexOf(coord), turn);
const passFor = (graph: BoardGraph, id: string, clearance: 'static' | 'conservative' | 'optimistic') => {
  const p = graph.passabilityIdxFor(id, { clearance });
  return (coord: Coord, turn: number): boolean => p.passableIdx(graph.cellIndexOf(coord), turn);
};

// Our subject snake, tucked into a corner away from the enemy under test.
const ourBody: Coord[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 }
];

// Enemy column at x=8: head (8,8) down to tail (8,3), length 6. The
// near-head interior segment (8,7) has a pure tail-projection vacate turn of
// 5, so any earlier opening can only come from starvation.
const enemyBody: Coord[] = [
  { x: 8, y: 8 },
  { x: 8, y: 7 },
  { x: 8, y: 6 },
  { x: 8, y: 5 },
  { x: 8, y: 4 },
  { x: 8, y: 3 }
];
const nearHeadSegment = { x: 8, y: 7 }; // tail-projection vacate turn 5
const enemyTail = { x: 8, y: 3 };       // tail-projection vacate turn 1

function makeGraph(enemyExtra: Partial<Snake>, food: Coord[] = []): BoardGraph {
  const us = makeSnake('us', ourBody, { health: 100 });
  const enemy = makeSnake('enemy', enemyBody, {
    customizations: { color: '#00FF00', head: 'default', tail: 'default' },
    ...enemyExtra
  });
  return new BoardGraph(makeGameState([us, enemy], us, food));
}

describe('Starvation-aware body vacating', () => {
  test('enemy at health 2 with NO food certainly starves: body opens at arrival turn 3, blocked at 1-2', () => {
    const graph = makeGraph({ health: 2 });
    const optimistic = passFor(graph, 'us', 'optimistic');
    const conservative = passFor(graph, 'us', 'conservative');

    // Optimistic subjective layer: h + 1 = 3.
    expect(optimistic(nearHeadSegment, 1)).toBe(false);
    expect(optimistic(nearHeadSegment, 2)).toBe(false);
    expect(optimistic(nearHeadSegment, 3)).toBe(true);

    // Physical (subject-agnostic) layer gets the same h + 1 timing.
    expect(passAt(graph, nearHeadSegment, 2)).toBe(false);
    expect(passAt(graph, nearHeadSegment, 3)).toBe(true);
    // ...and physicalVacateTurn (UI explanation payload) reflects the cap.
    expect(graph.physicalVacateTurn(graph.cellIndexOf(nearHeadSegment))).toBe(3);

    // Conservative keeps its usual +1 safety buffer on top of physical.
    expect(conservative(nearHeadSegment, 3)).toBe(false);
    expect(conservative(nearHeadSegment, 4)).toBe(true);

    // Static clearance projects nothing — interior stays a wall regardless.
    const staticPass = passFor(graph, 'us', 'static');
    expect(staticPass(nearHeadSegment, 3)).toBe(false);
  });

  test('same snake with food within walls-only distance 2 of its head does NOT starve (normal tail projection only)', () => {
    // Food at (7,7): walls-only BFS distance 2 from the enemy head (8,8),
    // e = 2 <= h = 2 — eating on turn h saves it.
    const graph = makeGraph({ health: 2 }, [{ x: 7, y: 7 }]);
    const optimistic = passFor(graph, 'us', 'optimistic');

    // No starvation opening at turn 3 or 4; the segment only opens at its
    // normal optimistic tail-projection turn (5 — the food is not confirmed
    // eatable this turn, so no optimistic eat delay either).
    expect(optimistic(nearHeadSegment, 3)).toBe(false);
    expect(optimistic(nearHeadSegment, 4)).toBe(false);
    expect(optimistic(nearHeadSegment, 5)).toBe(true);

    // Its tail still vacates normally on arrival.
    expect(optimistic(enemyTail, 1)).toBe(true);
  });

  test('food that exists but is farther than the health still means certain starvation', () => {
    // Food at (0,10): walls-only distance from (8,8) is 8 + 2 = 10 > h = 2.
    const graph = makeGraph({ health: 2 }, [{ x: 0, y: 10 }]);
    const optimistic = passFor(graph, 'us', 'optimistic');

    expect(optimistic(nearHeadSegment, 2)).toBe(false);
    expect(optimistic(nearHeadSegment, 3)).toBe(true);
  });

  test('health-1 enemy with no food: passable at turn 2, NEVER at turn 1 (very-next-turn floor)', () => {
    const graph = makeGraph({ health: 1 });
    const optimistic = passFor(graph, 'us', 'optimistic');

    // h + 1 = 2 and the explicit >= 2 clamp coincide: open at 2, not at 1.
    expect(optimistic(nearHeadSegment, 1)).toBe(false);
    expect(optimistic(nearHeadSegment, 2)).toBe(true);
    expect(passAt(graph, nearHeadSegment, 1)).toBe(false);
    expect(passAt(graph, nearHeadSegment, 2)).toBe(true);
  });

  test('a chess piece at health 1 is never starvation-vacated', () => {
    // Real pieces are collapsed to 1-cell bodies at translate time (no
    // segments at all); this hypothetical multi-cell piece exercises the
    // unitType guard directly: without it, health 1 with no food would open
    // the near-head segment at turn 2.
    const graph = makeGraph({ health: 1, unitType: 'pawn' });
    const optimistic = passFor(graph, 'us', 'optimistic');

    expect(optimistic(nearHeadSegment, 2)).toBe(false);
    expect(optimistic(nearHeadSegment, 3)).toBe(false);
    expect(optimistic(nearHeadSegment, 4)).toBe(false);
    // Pure tail projection still applies (vacate turn 5).
    expect(optimistic(nearHeadSegment, 5)).toBe(true);
  });

  test('starvation vacate composes with tail projections (per-segment min)', () => {
    // Length-10 enemy column: head (8,9) down to tail (8,0). Health 5 with
    // no food -> certain starvation, vacate turn 6.
    const longBody: Coord[] = [];
    for (let y = 9; y >= 0; y--) longBody.push({ x: 8, y });
    const us = makeSnake('us', ourBody, { health: 100 });
    const enemy = makeSnake('enemy', longBody, {
      health: 5,
      customizations: { color: '#00FF00', head: 'default', tail: 'default' }
    });
    const graph = new BoardGraph(makeGameState([us, enemy], us));
    const optimistic = passFor(graph, 'us', 'optimistic');

    // Far-from-head segment (8,1): tail projection already opens it at turn
    // 2, earlier than the starvation turn 6 — it stays turn 2.
    expect(optimistic({ x: 8, y: 1 }, 2)).toBe(true);

    // Near-head segment (8,8): tail projection alone would block it until
    // turn 9; starvation opens it at h + 1 = 6.
    expect(optimistic({ x: 8, y: 8 }, 5)).toBe(false);
    expect(optimistic({ x: 8, y: 8 }, 6)).toBe(true);

    // Conservative mirrors the tail-projection layer convention: +1.
    const conservative = passFor(graph, 'us', 'conservative');
    expect(conservative({ x: 8, y: 8 }, 6)).toBe(false);
    expect(conservative({ x: 8, y: 8 }, 7)).toBe(true);
  });

  describe('integration: territory flood fill through a starving wall', () => {
    // 7x7 board. Enemy "wall" seals column x=3 (head bent onto the far side,
    // tail trailing along the far edge so every wall segment's tail-projection
    // vacate turn is >= 9 — far beyond our arrival turns). Our snake sits on
    // the left; without starvation the right side is unreachable.
    const wallBody: Coord[] = [
      { x: 4, y: 6 }, // head (heads carry no segment; only reachable from the right)
      { x: 3, y: 6 },
      { x: 3, y: 5 },
      { x: 3, y: 4 },
      { x: 3, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 1 },
      { x: 6, y: 2 },
      { x: 6, y: 3 },
      { x: 6, y: 4 },
      { x: 6, y: 5 }
    ];
    const usBody: Coord[] = [
      { x: 0, y: 3 },
      { x: 0, y: 2 },
      { x: 0, y: 1 }
    ];

    function territoryFor(wallHealth: number, food: Coord[] = []) {
      const us = makeSnake('us', usBody, { health: 100 });
      const wall = makeSnake('wall', wallBody, {
        health: wallHealth,
        customizations: { color: '#00FF00', head: 'default', tail: 'default' }
      });
      const graph = new BoardGraph(
        makeGameState([us, wall], us, food, { width: 7, height: 7 })
      );
      const bfs = new MultiSourceBFS(graph);
      const result = bfs.compute(
        [{ id: 'us', position: usBody[0], isTeam: true }],
        food,
        { optimistic: true }
      );
      return { graph, result };
    }

    test('a healthy wall seals the right side of the board', () => {
      const { result } = territoryFor(100);
      // Left region only: x in 0..2 = 21 cells.
      expect(result.territoryCounts.get('us')).toBe(21);
      expect(result.ownerIndex[3 + 6 * 7]).toBe(OWNER_UNREACHED); // (3,6) wall cell
      expect(result.ownerIndex[5 + 3 * 7]).toBe(OWNER_UNREACHED); // (5,3) far side
    });

    test('the same wall at health 2 with food it can reach in time still seals', () => {
      // Food one step from the wall snake's head: e = 1 <= h = 2, no starvation.
      const { result } = territoryFor(2, [{ x: 4, y: 5 }]);
      expect(result.territoryCounts.get('us')).toBe(21);
      expect(result.ownerIndex[5 + 3 * 7]).toBe(OWNER_UNREACHED);
    });

    test('at health 2 with no food the wall starves and the flood fill claims the whole board', () => {
      const { result } = territoryFor(2);
      // Wall opens for arrivals >= 3; our BFS reaches (3,3) exactly at
      // distance 3 and floods the far side.
      expect(result.territoryCounts.get('us')).toBe(49);
      expect(result.ownerIndex[5 + 3 * 7]).toBe(0);          // (5,3) now ours
      expect(result.distanceIndex[3 + 3 * 7]).toBe(3);       // through the wall at turn 3
    });
  });
});
