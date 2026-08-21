/**
 * Legality tests for the chess-piece movement mirror
 * (src/logic/piece-moves.ts), which must stay in lockstep with the TacticToes
 * engine's functions/src/gameprocessors/engine/moveGrammar.ts — the centaur uses
 * it to decide whether a clicked destination is a legal single move (anything
 * illegal stages "stay").
 *
 * All coordinates are FULL-BOARD (perimeter included, y grows downward).
 */

import { legalPieceDestinations, planPieceAction, toIndex } from '../logic/piece-moves';

// 13x13 full board (11x11 playable interior).
const W = 13;
const H = 13;
const idx = (x: number, y: number) => toIndex(x, y, W);

// Piece parked mid-board.
const ORIGIN = idx(6, 6);

// Every plan takes the unit's orientation; only the pawn's gates legality, so the
// non-pawn tests share this one.
const F = { dx: 1, dy: 0 };

describe('planPieceAction — rook', () => {
  it('moves any distance along a row or column, with the traversed ray as path', () => {
    expect(planPieceAction('rook', ORIGIN, idx(6, 2), W, H, F)).toEqual({
      kind: 'move',
      path: [idx(6, 5), idx(6, 4), idx(6, 3), idx(6, 2)],
    });
    expect(planPieceAction('rook', ORIGIN, idx(9, 6), W, H, F)).toEqual({
      kind: 'move',
      path: [idx(7, 6), idx(8, 6), idx(9, 6)],
    });
  });

  it('rejects diagonals and knight-shaped targets', () => {
    expect(planPieceAction('rook', ORIGIN, idx(7, 7), W, H, F)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, idx(7, 8), W, H, F)).toBeNull();
  });

  it('rejects a destination on the perimeter wall even when it is on-ray', () => {
    expect(planPieceAction('rook', ORIGIN, idx(0, 6), W, H, F)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, idx(6, 12), W, H, F)).toBeNull();
  });
});

describe('planPieceAction — bishop / queen / knight / king', () => {
  it('bishop moves along diagonals only', () => {
    expect(planPieceAction('bishop', ORIGIN, idx(9, 9), W, H, F)).toEqual({
      kind: 'move',
      path: [idx(7, 7), idx(8, 8), idx(9, 9)],
    });
    expect(planPieceAction('bishop', ORIGIN, idx(4, 8), W, H, F)).toEqual({
      kind: 'move',
      path: [idx(5, 7), idx(4, 8)],
    });
    expect(planPieceAction('bishop', ORIGIN, idx(6, 3), W, H, F)).toBeNull();
  });

  it('queen combines rook and bishop rays', () => {
    expect(planPieceAction('queen', ORIGIN, idx(6, 9), W, H, F)).toEqual({
      kind: 'move',
      path: [idx(6, 7), idx(6, 8), idx(6, 9)],
    });
    expect(planPieceAction('queen', ORIGIN, idx(3, 3), W, H, F)).toEqual({
      kind: 'move',
      path: [idx(5, 5), idx(4, 4), idx(3, 3)],
    });
    expect(planPieceAction('queen', ORIGIN, idx(7, 8), W, H, F)).toBeNull();
  });

  it('knight takes the 8 L-jumps, touching only the destination', () => {
    for (const [dx, dy] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
      expect(planPieceAction('knight', ORIGIN, idx(6 + dx, 6 + dy), W, H, F)).toEqual({
        kind: 'move',
        path: [idx(6 + dx, 6 + dy)],
      });
    }
    expect(planPieceAction('knight', ORIGIN, idx(6, 8), W, H, F)).toBeNull();
    expect(planPieceAction('knight', ORIGIN, idx(8, 8), W, H, F)).toBeNull();
  });

  it('king steps one square in any of the 8 directions', () => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      expect(planPieceAction('king', ORIGIN, idx(6 + dx, 6 + dy), W, H, F)).toEqual({
        kind: 'move',
        path: [idx(6 + dx, 6 + dy)],
      });
    }
    expect(planPieceAction('king', ORIGIN, idx(6, 8), W, H, F)).toBeNull();
  });
});

describe('planPieceAction — pawn (orientation, rotation encoding, diagonal-onto-target)', () => {
  // Orientation right (+x). Wire convention: y grows downward.
  const orientation = { dx: 1, dy: 0 };

  it('steps one square straight forward', () => {
    expect(planPieceAction('pawn', ORIGIN, idx(7, 6), W, H, orientation)).toEqual({
      kind: 'move',
      path: [idx(7, 6)],
    });
  });

  it('encodes a quarter rotation as staging the SIDE square (never a step for a pawn)', () => {
    // dest below (y+1): dx=0=-orientation.dy, dy=1=orientation.dx → rotate to face down.
    expect(planPieceAction('pawn', ORIGIN, idx(6, 7), W, H, orientation)).toEqual({
      kind: 'rotate',
      orientation: { dx: 0, dy: 1 },
    });
    // dest above (y-1): the opposite quarter turn.
    expect(planPieceAction('pawn', ORIGIN, idx(6, 5), W, H, orientation)).toEqual({
      kind: 'rotate',
      orientation: { dx: 0, dy: -1 },
    });
  });

  it('never allows the square directly behind', () => {
    expect(planPieceAction('pawn', ORIGIN, idx(5, 6), W, H, orientation)).toBeNull();
  });

  it('allows diagonal-forward ONLY onto a target square (food or unit)', () => {
    const diagUp = idx(7, 5);
    const diagDown = idx(7, 7);
    // No target set / target set without the square → illegal.
    expect(planPieceAction('pawn', ORIGIN, diagUp, W, H, orientation)).toBeNull();
    expect(planPieceAction('pawn', ORIGIN, diagUp, W, H, orientation, new Set([idx(9, 9)]))).toBeNull();
    // Square holds food or a unit at turn start → legal single step.
    expect(planPieceAction('pawn', ORIGIN, diagUp, W, H, orientation, new Set([diagUp]))).toEqual({
      kind: 'move',
      path: [diagUp],
    });
    expect(planPieceAction('pawn', ORIGIN, diagDown, W, H, orientation, new Set([diagDown]))).toEqual({
      kind: 'move',
      path: [diagDown],
    });
    // Diagonal-BACKWARD is never legal, target or not.
    expect(planPieceAction('pawn', ORIGIN, idx(5, 5), W, H, orientation, new Set([idx(5, 5)]))).toBeNull();
  });
});

describe('planPieceAction — shared rules', () => {
  it('own square is always a legal stay', () => {
    for (const type of ['rook', 'bishop', 'knight', 'queen', 'king', 'pawn']) {
      expect(planPieceAction(type, ORIGIN, ORIGIN, W, H, F)).toEqual({ kind: 'stay' });
    }
  });

  it('rejects off-board and non-integer destinations', () => {
    expect(planPieceAction('rook', ORIGIN, -1, W, H, F)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, W * H, W, H, F)).toBeNull();
    expect(planPieceAction('rook', ORIGIN, 6.5, W, H, F)).toBeNull();
  });

  it('rejects unknown unit types (snakes never plan piece actions)', () => {
    expect(planPieceAction('snake', ORIGIN, idx(7, 6), W, H, F)).toBeNull();
  });
});

describe('legalPieceDestinations — the candidate enumerator', () => {
  const destSet = (cands: ReturnType<typeof legalPieceDestinations>) =>
    new Set(cands.map((c) => c.dest));

  it('never diverges from planPieceAction over the whole board (every type)', () => {
    const pawnTargets = new Set([idx(7, 5)]);
    const orientation = { dx: 1, dy: 0 };
    for (const type of ['rook', 'bishop', 'knight', 'queen', 'king', 'pawn']) {
      const cands = legalPieceDestinations(type, ORIGIN, W, H, orientation, pawnTargets);
      const byDest = new Map(cands.map((c) => [c.dest, c.action]));
      for (let dest = 0; dest < W * H; dest++) {
        const action = planPieceAction(type, ORIGIN, dest, W, H, orientation, pawnTargets);
        expect(byDest.get(dest) ?? null).toEqual(action);
      }
    }
  });

  it('rook: full rank + file rays plus stay, each move carrying its ray path', () => {
    const cands = legalPieceDestinations('rook', ORIGIN, W, H, F);
    // 10 file squares + 10 rank squares + stay on an 11x11 interior.
    expect(cands).toHaveLength(21);
    expect(destSet(cands).has(ORIGIN)).toBe(true);
    const far = cands.find((c) => c.dest === idx(6, 1))!;
    expect(far.action).toEqual({
      kind: 'move',
      path: [idx(6, 5), idx(6, 4), idx(6, 3), idx(6, 2), idx(6, 1)],
    });
  });

  it('bishop and queen: diagonal rays (queen = rook ∪ bishop)', () => {
    const bishop = legalPieceDestinations('bishop', ORIGIN, W, H, F);
    const queen = legalPieceDestinations('queen', ORIGIN, W, H, F);
    const rook = legalPieceDestinations('rook', ORIGIN, W, H, F);
    // Diagonals from (6,6) on an 11x11 interior: 5+5+5+5 = 20, plus stay.
    expect(bishop).toHaveLength(21);
    // Queen = 20 rook rays + 20 bishop rays + stay (stay counted once).
    expect(queen).toHaveLength(41);
    const queenDests = destSet(queen);
    for (const c of bishop) expect(queenDests.has(c.dest)).toBe(true);
    for (const c of rook) expect(queenDests.has(c.dest)).toBe(true);
  });

  it('knight: the 8 L-jumps plus stay; king: the 8 neighbours plus stay', () => {
    const knight = legalPieceDestinations('knight', ORIGIN, W, H, F);
    const king = legalPieceDestinations('king', ORIGIN, W, H, F);
    expect(knight).toHaveLength(9);
    expect(king).toHaveLength(9);
    expect(destSet(knight).has(idx(8, 7))).toBe(true);
    expect(destSet(king).has(idx(7, 7))).toBe(true);
    for (const c of knight.filter((k) => k.dest !== ORIGIN)) {
      expect(c.action).toEqual({ kind: 'move', path: [c.dest] });
    }
  });

  it('pawn: forward + two side-square rotations + stay, diagonal only onto a target', () => {
    const orientation = { dx: 1, dy: 0 };
    const noTargets = legalPieceDestinations('pawn', ORIGIN, W, H, orientation);
    // Forward, two rotations, stay — the empty diagonals are not offered.
    expect(noTargets).toHaveLength(4);
    expect(noTargets.find((c) => c.dest === ORIGIN)!.action).toEqual({ kind: 'stay' });
    expect(noTargets.find((c) => c.dest === idx(7, 6))!.action).toEqual({
      kind: 'move',
      path: [idx(7, 6)],
    });
    expect(noTargets.find((c) => c.dest === idx(6, 7))!.action).toEqual({
      kind: 'rotate',
      orientation: { dx: 0, dy: 1 },
    });
    expect(noTargets.find((c) => c.dest === idx(6, 5))!.action).toEqual({
      kind: 'rotate',
      orientation: { dx: 0, dy: -1 },
    });

    // A diagonal-forward target square adds exactly that candidate.
    const diag = idx(7, 5);
    const withTarget = legalPieceDestinations('pawn', ORIGIN, W, H, orientation, new Set([diag]));
    expect(withTarget).toHaveLength(5);
    expect(withTarget.find((c) => c.dest === diag)!.action).toEqual({
      kind: 'move',
      path: [diag],
    });
  });

  it('near a wall the rays stop at the interior edge (no perimeter candidates)', () => {
    const corner = idx(1, 1);
    const king = legalPieceDestinations('king', corner, W, H, F);
    // 3 in-board neighbours + stay.
    expect(king).toHaveLength(4);
    for (const c of king) {
      const x = c.dest % W;
      const y = Math.floor(c.dest / W);
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(W - 2);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThanOrEqual(H - 2);
    }
  });

  it('unknown types (snake) enumerate only stay', () => {
    const cands = legalPieceDestinations('snake', ORIGIN, W, H, F);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toEqual({ dest: ORIGIN, action: { kind: 'stay' } });
  });
});
