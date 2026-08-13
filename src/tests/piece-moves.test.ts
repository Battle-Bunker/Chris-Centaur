/**
 * Legality tests for the chess-piece movement mirror
 * (src/logic/piece-moves.ts), which must stay in lockstep with the TacticToes
 * engine's functions/src/gameprocessors/chess/pieceMoves.ts — the centaur uses
 * it to decide whether a clicked destination is a legal single move (anything
 * illegal stages "stay").
 *
 * All coordinates are FULL-BOARD (perimeter included, y grows downward).
 */

import { planPieceAction, toIndex } from '../logic/piece-moves';

// 13x13 full board (11x11 playable interior).
const W = 13;
const H = 13;
const idx = (x: number, y: number) => toIndex(x, y, W);

// Piece parked mid-board.
const ORIGIN = idx(6, 6);

describe('planPieceAction — rook', () => {
  it('moves any distance along a row or column, with the traversed ray as path', () => {
    expect(planPieceAction('rook', ORIGIN, idx(6, 2), W, H)).toEqual({
      kind: 'move',
      path: [idx(6, 5), idx(6, 4), idx(6, 3), idx(6, 2)],
    });
    expect(planPieceAction('rook', ORIGIN, idx(9, 6), W, H)).toEqual({
      kind: 'move',
      path: [idx(7, 6), idx(8, 6), idx(9, 6)],
    });
  });

  it('rejects diagonals and knight-shaped targets', () => {
    expect(planPieceAction('rook', ORIGIN, idx(7, 7), W, H)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, idx(7, 8), W, H)).toBeNull();
  });

  it('rejects a destination on the perimeter wall even when it is on-ray', () => {
    expect(planPieceAction('rook', ORIGIN, idx(0, 6), W, H)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, idx(6, 12), W, H)).toBeNull();
  });
});

describe('planPieceAction — bishop / queen / knight / king', () => {
  it('bishop moves along diagonals only', () => {
    expect(planPieceAction('bishop', ORIGIN, idx(9, 9), W, H)).toEqual({
      kind: 'move',
      path: [idx(7, 7), idx(8, 8), idx(9, 9)],
    });
    expect(planPieceAction('bishop', ORIGIN, idx(4, 8), W, H)).toEqual({
      kind: 'move',
      path: [idx(5, 7), idx(4, 8)],
    });
    expect(planPieceAction('bishop', ORIGIN, idx(6, 3), W, H)).toBeNull();
  });

  it('queen combines rook and bishop rays', () => {
    expect(planPieceAction('queen', ORIGIN, idx(6, 9), W, H)).toEqual({
      kind: 'move',
      path: [idx(6, 7), idx(6, 8), idx(6, 9)],
    });
    expect(planPieceAction('queen', ORIGIN, idx(3, 3), W, H)).toEqual({
      kind: 'move',
      path: [idx(5, 5), idx(4, 4), idx(3, 3)],
    });
    expect(planPieceAction('queen', ORIGIN, idx(7, 8), W, H)).toBeNull();
  });

  it('knight takes the 8 L-jumps, touching only the destination', () => {
    for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      expect(planPieceAction('knight', ORIGIN, idx(6 + dx, 6 + dy), W, H)).toEqual({
        kind: 'move',
        path: [idx(6 + dx, 6 + dy)],
      });
    }
    expect(planPieceAction('knight', ORIGIN, idx(6, 8), W, H)).toBeNull();
    expect(planPieceAction('knight', ORIGIN, idx(8, 8), W, H)).toBeNull();
  });

  it('king steps one square in any of the 8 directions', () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      expect(planPieceAction('king', ORIGIN, idx(6 + dx, 6 + dy), W, H)).toEqual({
        kind: 'move',
        path: [idx(6 + dx, 6 + dy)],
      });
    }
    expect(planPieceAction('king', ORIGIN, idx(6, 8), W, H)).toBeNull();
  });
});

describe('planPieceAction — pawn (facing, rotation encoding, diagonal-onto-target)', () => {
  // Facing right (+x). Wire convention: y grows downward.
  const facing = { dx: 1, dy: 0 };

  it('steps one square straight forward', () => {
    expect(planPieceAction('pawn', ORIGIN, idx(7, 6), W, H, facing)).toEqual({
      kind: 'move',
      path: [idx(7, 6)],
    });
  });

  it('encodes a quarter rotation as staging the SIDE square (never a step for a pawn)', () => {
    // dest below (y+1): dx=0=-facing.dy, dy=1=facing.dx → rotate to face down.
    expect(planPieceAction('pawn', ORIGIN, idx(6, 7), W, H, facing)).toEqual({
      kind: 'rotate',
      facing: { dx: 0, dy: 1 },
    });
    // dest above (y-1): the opposite quarter turn.
    expect(planPieceAction('pawn', ORIGIN, idx(6, 5), W, H, facing)).toEqual({
      kind: 'rotate',
      facing: { dx: 0, dy: -1 },
    });
  });

  it('never allows the square directly behind', () => {
    expect(planPieceAction('pawn', ORIGIN, idx(5, 6), W, H, facing)).toBeNull();
  });

  it('allows diagonal-forward ONLY onto a target square (food or unit)', () => {
    const diagUp = idx(7, 5);
    const diagDown = idx(7, 7);
    // No target set / target set without the square → illegal.
    expect(planPieceAction('pawn', ORIGIN, diagUp, W, H, facing)).toBeNull();
    expect(planPieceAction('pawn', ORIGIN, diagUp, W, H, facing, new Set([idx(9, 9)]))).toBeNull();
    // Square holds food or a unit at turn start → legal single step.
    expect(planPieceAction('pawn', ORIGIN, diagUp, W, H, facing, new Set([diagUp]))).toEqual({
      kind: 'move',
      path: [diagUp],
    });
    expect(planPieceAction('pawn', ORIGIN, diagDown, W, H, facing, new Set([diagDown]))).toEqual({
      kind: 'move',
      path: [diagDown],
    });
    // Diagonal-BACKWARD is never legal, target or not.
    expect(planPieceAction('pawn', ORIGIN, idx(5, 5), W, H, facing, new Set([idx(5, 5)]))).toBeNull();
  });

  it('is illegal without a facing', () => {
    expect(planPieceAction('pawn', ORIGIN, idx(7, 6), W, H)).toBeNull();
  });
});

describe('planPieceAction — shared rules', () => {
  it('own square is always a legal stay', () => {
    for (const type of ['rook', 'bishop', 'knight', 'queen', 'king', 'pawn']) {
      expect(planPieceAction(type, ORIGIN, ORIGIN, W, H)).toEqual({ kind: 'stay' });
    }
  });

  it('rejects off-board and non-integer destinations', () => {
    expect(planPieceAction('rook', ORIGIN, -1, W, H)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, W * H, W, H)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, 6.5, W, H)).toBeNull();
  });

  it('rejects unknown unit types (snakes never plan piece actions)', () => {
    expect(planPieceAction('snake', ORIGIN, idx(7, 6), W, H)).toBeNull();
  });
});
