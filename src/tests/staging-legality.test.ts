/**
 * THE STAGING BOUNDARY — what a unit may be staged to, and the operator
 * commands built on that answer.
 *
 * `logic/staging-legality.ts` is an adapter and nothing else: every question
 * here has an answer the vendored engine already gives, so the tests are
 * written as EQUALITIES against `planUnitAction` — the same function
 * `resolveTurn` runs when it stages a move — rather than as a second statement
 * of the grammar. A test that re-derived the legal set would be the fourth
 * mirror the one-engine cut exists to delete.
 *
 * Covered here:
 *  - staging legality equals engine legality, for every kind, on a board
 *    carrying walls, hazards, food, trail units and pieces;
 *  - the pawn exception in both directions: its diagonal is legal only onto
 *    food or a body, and its side-square rotation is legal even against the
 *    perimeter it can never enter;
 *  - a slider's ray is staged clean through a body (staging is not arriving)
 *    while its COVER is cut at the first body, that cell included;
 *  - `canHold`: exactly the kinds whose own square plans an action;
 *  - the fast pass's refusal and its preference for continuing straight.
 *
 * The operator HOLD command's own semantics (which unit may be told to hold,
 * and what that stages) live in `piece-staging.test.ts` and in the manager;
 * what is pinned here is the predicate both of them are built on.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { apiCoordToIndex, toApiCoord } from '../firebase/translate';
import {
  canHold,
  certainlyFatalStaging,
  grammarUnitAt,
  grammarUnitOf,
  isKingUnit,
  isPieceUnit,
  legalStagingCandidates,
  quickStagingTarget,
  stagingActionFor,
  stagingBoard,
  stagingCover,
  stagingPath,
  stagingRotations,
} from '../logic/staging-legality';
import { planUnitAction } from '../engine-vendor/engine/moveGrammar';
import { legalTargets, pathOf } from '../engine-vendor/engine/queries';
import type { UnitType } from '@shared/types/Game';

const W = 9;
const H = 9;
const FULL_W = W + 2;
const FULL_H = H + 2;
const idx = (c: Coord) => apiCoordToIndex(c, FULL_W, FULL_H);
const at = (i: number) => toApiCoord(i, FULL_W, FULL_H);

const KINDS: UnitType[] = ['snake', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

function unit(
  id: string,
  head: Coord,
  opts: { unitType?: string; orientation?: { dx: number; dy: number }; body?: Coord[] } = {}
): Snake {
  const isPiece = !!opts.unitType && opts.unitType !== 'snake';
  const body = opts.body ?? (isPiece ? [head] : [head, { x: head.x, y: head.y - 1 }, { x: head.x, y: head.y - 2 }]);
  const s: Snake = {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head,
    length: body.length,
    shout: '',
    squad: '',
    orientation: opts.orientation ?? { dx: 0, dy: -1 },
    customizations: { color: '#fff', head: 'default', tail: 'default' },
  };
  if (opts.unitType) s.unitType = opts.unitType;
  return s;
}

/** A board with everything the grammar can trip over on it at once. */
function busyBoard(snakes: Snake[]): Board {
  return {
    width: W,
    height: H,
    food: [{ x: 4, y: 5 }, { x: 6, y: 6 }],
    hazards: [{ x: 3, y: 4 }, { x: 4, y: 4 }],
    snakes,
  };
}

// ── Legality equals the engine's ───────────────────────────────────────────

describe('staging legality equals engine legality', () => {
  test.each(KINDS)('%s: the offered set is exactly planUnitAction’s', (kind) => {
    const subject = unit('U', { x: 4, y: 3 }, { unitType: kind, orientation: { dx: 0, dy: -1 } });
    const other = unit('T', { x: 6, y: 3 }, { unitType: 'rook' });
    const trail = unit('S', { x: 2, y: 6 });
    const board = busyBoard([subject, other, trail]);
    const shape = stagingBoard(board);
    const gu = grammarUnitOf(subject, board);

    // The engine's own answer, derived cell by cell from the grammar with the
    // pawn target set the queries build for it.
    const pawnTargets = new Set<number>([
      ...board.food.map(idx),
      ...board.snakes.flatMap((s) => s.body.map(idx)),
    ]);
    const expected: number[] = [];
    for (let cell = 0; cell < FULL_W * FULL_H; cell++) {
      const action = planUnitAction(
        kind,
        gu.occupancy[0],
        cell,
        FULL_W,
        FULL_H,
        gu.orientation,
        pawnTargets
      );
      if (action) expected.push(cell);
    }

    const offered = legalStagingCandidates(gu, shape);
    expect(offered.map((c) => c.dest)).toEqual(expected);
    // ...and every offered action is the action the engine plans for it.
    for (const c of offered) {
      expect(c.action).toEqual(
        planUnitAction(kind, gu.occupancy[0], c.dest, FULL_W, FULL_H, gu.orientation, pawnTargets)
      );
      expect(stagingActionFor(gu, c.dest, shape)).toEqual(c.action);
    }
  });

  test('the adapter and the raw query agree on every kind, whatever it faces', () => {
    for (const kind of KINDS) {
      for (const orientation of [
        { dx: 0, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
      ]) {
        const subject = unit('U', { x: 5, y: 5 }, { unitType: kind, orientation });
        const board = busyBoard([subject, unit('S', { x: 5, y: 7 })]);
        const gu = grammarUnitOf(subject, board);
        const shape = stagingBoard(board);
        expect(legalStagingCandidates(gu, shape).map((c) => c.dest)).toEqual(
          legalTargets(gu, shape)
        );
      }
    }
  });

  test('a trail unit may stage the perimeter — legal, and fatal', () => {
    const snake = unit('S', { x: 0, y: 4 }, { body: [{ x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }] });
    const board = busyBoard([snake]);
    const shape = stagingBoard(board);
    const gu = grammarUnitOf(snake, board);
    // The wall square to its left, in full-board terms.
    const wall = idx({ x: -1, y: 4 });
    expect(legalTargets(gu, shape)).toContain(wall);
    expect(stagingActionFor(gu, wall, shape)).toEqual({ kind: 'move', path: [wall] });
    expect(certainlyFatalStaging(gu, wall, shape)).toBe('wall');
  });

  test('a trail unit has no hold: its own square is not a move', () => {
    const snake = unit('S', { x: 4, y: 4 });
    const board = busyBoard([snake]);
    const gu = grammarUnitOf(snake, board);
    expect(stagingActionFor(gu, gu.occupancy[0], stagingBoard(board))).toBeNull();
  });
});

// ── The pawn, in both directions ───────────────────────────────────────────

describe('the pawn exception', () => {
  const orientation = { dx: 0, dy: -1 }; // wire dy grows downward: api "up"

  test('a diagonal is legal only onto food or a body', () => {
    const pawn = unit('P', { x: 4, y: 4 }, { unitType: 'pawn', orientation });
    const bare: Board = { width: W, height: H, food: [], hazards: [], snakes: [pawn] };
    const gu = grammarUnitOf(pawn, bare);
    const leftDiagonal = idx({ x: 3, y: 5 });
    const rightDiagonal = idx({ x: 5, y: 5 });
    expect(stagingActionFor(gu, leftDiagonal, stagingBoard(bare))).toBeNull();
    expect(stagingActionFor(gu, rightDiagonal, stagingBoard(bare))).toBeNull();

    // A meal on one, a body on the other: both become moves.
    const victim = unit('V', { x: 5, y: 5 }, { unitType: 'rook' });
    const fed: Board = { ...bare, food: [{ x: 3, y: 5 }], snakes: [pawn, victim] };
    const gu2 = grammarUnitOf(pawn, fed);
    expect(stagingActionFor(gu2, leftDiagonal, stagingBoard(fed))).toEqual({
      kind: 'move',
      path: [leftDiagonal],
    });
    expect(stagingActionFor(gu2, rightDiagonal, stagingBoard(fed))).toEqual({
      kind: 'move',
      path: [rightDiagonal],
    });
  });

  test('its own body counts as a diagonal target — the grammar makes no exception', () => {
    const pawn = unit('P', { x: 4, y: 4 }, { unitType: 'pawn', orientation });
    const ally = unit('A', { x: 5, y: 5 }, { unitType: 'pawn' });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [pawn, ally] };
    const gu = grammarUnitOf(pawn, board);
    expect(stagingActionFor(gu, idx({ x: 5, y: 5 }), stagingBoard(board))).toEqual({
      kind: 'move',
      path: [idx({ x: 5, y: 5 })],
    });
  });

  test('a rotation is legal against the perimeter, which the pawn never enters', () => {
    // Facing api-up with its back to the left wall: the side square to its
    // left IS the perimeter. The mirror this adapter replaced refused it.
    const pawn = unit('P', { x: 0, y: 4 }, { unitType: 'pawn', orientation });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [pawn] };
    const gu = grammarUnitOf(pawn, board);
    const shape = stagingBoard(board);
    const wallSide = idx({ x: -1, y: 4 });
    expect(stagingActionFor(gu, wallSide, shape)).toEqual({
      kind: 'rotate',
      orientation: { dx: -1, dy: 0 },
    });
    expect(stagingRotations(gu, shape).map((r) => r.target)).toContain(wallSide);
    // A rotation enters nothing, so it walks no cells and is never fatal.
    expect(stagingPath(gu, wallSide, shape)).toEqual([]);
    expect(certainlyFatalStaging(gu, wallSide, shape)).toBeNull();
  });

  test('a pawn covers its two diagonals and the square in front, never its sides', () => {
    const pawn = unit('P', { x: 4, y: 4 }, { unitType: 'pawn', orientation });
    const victim = unit('V', { x: 5, y: 5 }, { unitType: 'rook' });
    const board: Board = { width: W, height: H, food: [{ x: 3, y: 5 }], hazards: [], snakes: [pawn, victim] };
    const cover = stagingCover(grammarUnitOf(pawn, board), stagingBoard(board)).map(at);
    expect(cover).toEqual(
      expect.arrayContaining([
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 5, y: 5 },
      ])
    );
    expect(cover).not.toContainEqual({ x: 3, y: 4 });
    expect(cover).not.toContainEqual({ x: 5, y: 4 });
  });
});

// ── Rays: staging is not arriving ──────────────────────────────────────────

describe('a capture stops a ray in cover, never in staging', () => {
  test('the whole ray may be staged; the cover is cut at the first body, inclusive', () => {
    const rook = unit('R', { x: 1, y: 4 }, { unitType: 'rook' });
    const blocker = unit('B', { x: 4, y: 4 }, { unitType: 'knight' });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [rook, blocker] };
    const shape = stagingBoard(board);
    const gu = grammarUnitOf(rook, board);

    const beyond = idx({ x: 7, y: 4 });
    expect(stagingActionFor(gu, beyond, shape)).not.toBeNull();
    expect(stagingPath(gu, beyond, shape)).toEqual(pathOf(gu, beyond, shape));
    // The engine is handed the untruncated ray — what it meets is the
    // collision phase's business.
    expect(stagingPath(gu, beyond, shape)!.map(at)).toContainEqual({ x: 4, y: 4 });

    const cover = stagingCover(gu, shape).map(at);
    expect(cover).toContainEqual({ x: 4, y: 4 }); // the capture square itself
    expect(cover).not.toContainEqual({ x: 5, y: 4 }); // and nothing past it
  });

  test('a hazard cuts nothing: it costs health and the unit still arrives', () => {
    const rook = unit('R', { x: 1, y: 4 }, { unitType: 'rook' });
    const board: Board = {
      width: W,
      height: H,
      food: [],
      hazards: [{ x: 3, y: 4 }],
      snakes: [rook],
    };
    const cover = stagingCover(grammarUnitOf(rook, board), stagingBoard(board)).map(at);
    expect(cover).toContainEqual({ x: 3, y: 4 });
    expect(cover).toContainEqual({ x: 6, y: 4 });
  });
});

// ── canHold, and what the hold command is built on ─────────────────────────

describe('canHold is exactly the kinds whose own square plans an action', () => {
  test.each(KINDS)('%s', (kind) => {
    const subject = unit('U', { x: 4, y: 4 }, { unitType: kind });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [subject] };
    const gu = grammarUnitOf(subject, board);
    const own = gu.occupancy[0];
    const plans = stagingActionFor(gu, own, stagingBoard(board));
    expect(canHold(kind)).toBe(plans !== null);
    if (plans) expect(plans).toEqual({ kind: 'stay' });
  });

  test('an absent kind is a trail unit, and a trail unit cannot hold', () => {
    expect(canHold(undefined)).toBe(false);
    expect(canHold('snake')).toBe(false);
  });

  test('a held piece stages its own square, whatever else is legal for it', () => {
    // What the manager's hold command resolves to: the origin index, with no
    // board lookup — which is why it survives across turns. The claim under
    // test is that the origin index is a move the server accepts.
    const queen = unit('Q', { x: 4, y: 4 }, { unitType: 'queen' });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [queen] };
    const shape = stagingBoard(board);
    const origin = idx({ x: 4, y: 4 });
    const gu = grammarUnitAt('queen', origin, queen.orientation);
    expect(legalStagingCandidates(gu, shape).map((c) => c.dest)).toContain(origin);
    expect(stagingActionFor(gu, origin, shape)).toEqual({ kind: 'stay' });
    expect(certainlyFatalStaging(gu, origin, shape)).toBeNull();
  });
});

describe('unit-kind predicates', () => {
  test('a piece is anything that is not a trail unit; a king is a king', () => {
    expect(isPieceUnit(unit('S', { x: 1, y: 1 }))).toBe(false);
    expect(isPieceUnit(unit('P', { x: 1, y: 1 }, { unitType: 'snake' }))).toBe(false);
    expect(isPieceUnit(unit('P', { x: 1, y: 1 }, { unitType: 'pawn' }))).toBe(true);
    expect(isKingUnit(unit('K', { x: 1, y: 1 }, { unitType: 'king' }))).toBe(true);
    expect(isKingUnit(unit('Q', { x: 1, y: 1 }, { unitType: 'queen' }))).toBe(false);
  });
});

// ── The fast pass ──────────────────────────────────────────────────────────

describe('the fast staging pass refuses only what is certainly fatal', () => {
  test('the mover’s own body is refused; its vacating tail is not', () => {
    // A snake curled so that stepping left re-enters its own second segment.
    const body: Coord[] = [
      { x: 4, y: 4 },
      { x: 4, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
    ];
    const snake = unit('S', { x: 4, y: 4 }, { body });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [snake] };
    const shape = stagingBoard(board);
    const gu = grammarUnitOf(snake, board);
    // body[3] is the tail; body[1..2] are occupied next turn whatever happens.
    expect(certainlyFatalStaging(gu, idx({ x: 4, y: 3 }), shape)).toBe('own-body');
    expect(certainlyFatalStaging(gu, idx({ x: 3, y: 4 }), shape)).toBeNull();
    expect(certainlyFatalStaging(gu, idx({ x: 5, y: 4 }), shape)).toBeNull();
  });

  test('it keeps going the way the unit already faces when that is not fatal', () => {
    // Wire dy grows downward, so { dx: 0, dy: -1 } is api "up".
    const snake = unit('S', { x: 4, y: 4 }, { orientation: { dx: 0, dy: -1 } });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [snake] };
    const target = quickStagingTarget(grammarUnitOf(snake, board), stagingBoard(board));
    expect(at(target!)).toEqual({ x: 4, y: 5 });
  });

  test('facing a wall it stages something else, and never the wall', () => {
    const snake = unit('S', { x: 4, y: 8 }, {
      orientation: { dx: 0, dy: -1 },
      body: [{ x: 4, y: 8 }, { x: 4, y: 7 }, { x: 4, y: 6 }],
    });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [snake] };
    const shape = stagingBoard(board);
    const gu = grammarUnitOf(snake, board);
    const target = quickStagingTarget(gu, shape);
    expect(target).not.toBeNull();
    expect(certainlyFatalStaging(gu, target!, shape)).toBeNull();
    expect(at(target!)).not.toEqual({ x: 4, y: 9 });
  });

  test('boxed in, it still stages a legal move rather than nothing', () => {
    // A snake in the top-left corner with its body filling both escapes: every
    // option is fatal, and the pass must still name one.
    const body: Coord[] = [
      { x: 0, y: 8 },
      { x: 1, y: 8 },
      { x: 1, y: 7 },
      { x: 0, y: 7 },
    ];
    const snake = unit('S', { x: 0, y: 8 }, { body, orientation: { dx: 0, dy: -1 } });
    const board: Board = { width: W, height: H, food: [], hazards: [], snakes: [snake] };
    const shape = stagingBoard(board);
    const gu = grammarUnitOf(snake, board);
    const target = quickStagingTarget(gu, shape);
    expect(target).not.toBeNull();
    expect(legalTargets(gu, shape)).toContain(target);
  });
});
