/**
 * Head-overlapping stacked runs (BoardGraph off-by-one regression).
 *
 * The engine stacks copies on the head cell at spawn ([H,H,H]) and right
 * after a sever ([H,H]). Once the head moves, its copy is just another body
 * copy the tail must pop through, so the engine-truth vacate turn of the
 * head cell is body.length − firstIndexOfRun where the run may start at
 * index 0. The old run detection counted such runs from their first BODY
 * index (i >= 1), under-counting by one.
 */

import { BoardGraph } from '../logic/board-graph';
import { GameState, Snake, Coord } from '../types/battlesnake';

let nextId = 0;
function makeSnake(body: Coord[]): Snake {
  return {
    orientation: { dx: 0, dy: -1 },
    id: `s${nextId++}`,
    name: 'test',
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

function makeState(snakes: Snake[], width = 7, height = 7): GameState {
  return {
    game: { id: 'stack-test', ruleset: { name: 'standard', version: '1', settings: {} }, timeout: 500, source: 'test', map: 'standard' },
    turn: 5,
    board: { width, height, snakes, food: [], hazards: [] },
    you: snakes[0],
  };
}

describe('BoardGraph head-overlapping stacked runs', () => {
  test('spawn triple-stack [H,H,H] vacates in 3 turns', () => {
    const cell = { x: 3, y: 3 };
    const spawn = makeSnake([cell, { ...cell }, { ...cell }]);
    const graph = new BoardGraph(makeState([spawn]));
    const idx = graph.cellIndexOf(cell);

    expect(graph.physicalVacateTurn(idx)).toBe(3);
    expect(graph.isPassableAtTurnIdx(idx, 2)).toBe(false);
    expect(graph.isPassableAtTurnIdx(idx, 3)).toBe(true);
    // The stacked head cell is a static wall (one pop still leaves copies).
    expect(graph.isPassableStaticIdx(idx)).toBe(false);
  });

  test('post-sever two-stack [H,H] vacates in 2 turns', () => {
    const cell = { x: 2, y: 4 };
    const severed = makeSnake([cell, { ...cell }]);
    const graph = new BoardGraph(makeState([severed]));
    const idx = graph.cellIndexOf(cell);

    expect(graph.physicalVacateTurn(idx)).toBe(2);
    expect(graph.isPassableAtTurnIdx(idx, 1)).toBe(false);
    expect(graph.isPassableAtTurnIdx(idx, 2)).toBe(true);
    expect(graph.isPassableStaticIdx(idx)).toBe(false);
  });

  test('ate-last-turn duplicated tail [h,a,b,c,c] still vacates in 2 turns', () => {
    const snake = makeSnake([
      { x: 3, y: 3 }, // head — distinct cell, must stay a non-segment
      { x: 3, y: 2 },
      { x: 3, y: 1 },
      { x: 3, y: 0 },
      { x: 3, y: 0 }, // duplicated tail from eating last turn
    ]);
    const graph = new BoardGraph(makeState([snake]));
    const tailIdx = graph.cellIndex(3, 0);

    // Run starts at body index 3 (NOT the head), so length 5 − 3 = 2.
    expect(graph.physicalVacateTurn(tailIdx)).toBe(2);
    expect(graph.isPassableAtTurnIdx(tailIdx, 1)).toBe(false);
    expect(graph.isPassableAtTurnIdx(tailIdx, 2)).toBe(true);
  });

  test("a non-stacked snake's head cell still reads as empty to another subject", () => {
    const normal = makeSnake([
      { x: 3, y: 3 }, // head
      { x: 3, y: 2 },
      { x: 3, y: 1 }, // tail
    ]);
    const other = makeSnake([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
    ]);
    const graph = new BoardGraph(makeState([normal, other]));
    const headIdx = graph.cellIndex(3, 3);

    // Physically: no segment is registered on a non-stacked head cell.
    expect(graph.physicalVacateTurn(headIdx)).toBe(0);
    expect(graph.isPassableStaticIdx(headIdx)).toBe(true);
    // Subjectively: another snake sees the head cell as empty (head-to-head
    // risk is modelled elsewhere, never as a body segment).
    const pass = graph.passabilityIdxFor(other.id, { clearance: 'conservative' });
    expect(pass.passableIdx(headIdx, 1)).toBe(true);
  });

  test("the subject's own stacked head remains the BFS origin, never a destination", () => {
    const cell = { x: 5, y: 5 };
    const spawn = makeSnake([cell, { ...cell }, { ...cell }]);
    const graph = new BoardGraph(makeState([spawn]));
    const idx = graph.cellIndexOf(cell);

    const pass = graph.passabilityIdxFor(spawn.id, { clearance: 'optimistic' });
    expect(pass.headIdx).toBe(idx);
    // Own head is the origin: not passable at any arrival turn.
    expect(pass.passableIdx(idx, 1)).toBe(false);
    expect(pass.passableIdx(idx, 5)).toBe(false);
  });
});
