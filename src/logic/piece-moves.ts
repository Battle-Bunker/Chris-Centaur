// Chess-piece movement legality, MIRRORED from the TacticToes engine:
//   TacticToes functions/src/gameprocessors/chess/pieceMoves.ts
// Keep this file in lockstep with the server — the centaur uses it to decide
// whether a clicked destination is a legal single move for a piece THIS turn,
// so any divergence makes the client stage moves the server rejects (→ stay).
//
// Everything here works in FULL-BOARD coordinates (perimeter wall included,
// y grows downward — the wire convention). Callers convert from the engine's
// api coords with the translate helpers (apiCoordToIndex / toApiCoord).

export interface Facing {
  dx: number;
  dy: number;
}

// A pawn becomes a queen when its weight reaches the configured threshold
// (GameSetup.pawnPromotionWeight); this is the default.
export const DEFAULT_PAWN_PROMOTION_WEIGHT = 10;

export const isPieceType = (t?: string): boolean => t !== undefined && t !== 'snake';

export const toXY = (index: number, boardWidth: number): { x: number; y: number } => ({
  x: index % boardWidth,
  y: Math.floor(index / boardWidth),
});

export const toIndex = (x: number, y: number, boardWidth: number): number => y * boardWidth + x;

// Interior = every square that is not part of the perimeter wall.
export const isInterior = (x: number, y: number, boardWidth: number, boardHeight: number): boolean =>
  x >= 1 && x <= boardWidth - 2 && y >= 1 && y <= boardHeight - 2;

export type PieceAction =
  | { kind: 'stay' }
  | { kind: 'move'; path: number[] }
  | { kind: 'rotate'; facing: Facing };

/**
 * Plans a piece's staged destination into an action.
 *
 * Returns null when the destination is not legal for this piece — the caller
 * substitutes the default action (stay). `pawnTargets` holds every square
 * containing food or another unit at the start of the turn: a pawn's
 * diagonal-forward step is legal only into one of those (attack or eat).
 * Staging a pawn's side square means "spend the turn rotating to face that
 * way"; the square behind is never legal.
 */
export const planPieceAction = (
  type: string,
  origin: number,
  dest: number,
  boardWidth: number,
  boardHeight: number,
  facing?: Facing,
  pawnTargets?: Set<number>,
): PieceAction | null => {
  if (dest === origin) return { kind: 'stay' };
  if (!Number.isInteger(dest) || dest < 0 || dest >= boardWidth * boardHeight) return null;
  const o = toXY(origin, boardWidth);
  const d = toXY(dest, boardWidth);
  // Origins are always interior and the interior is convex, so a straight
  // ray between interior squares never touches the perimeter wall — only the
  // destination needs the check.
  if (!isInterior(d.x, d.y, boardWidth, boardHeight)) return null;
  const dx = d.x - o.x;
  const dy = d.y - o.y;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  switch (type) {
    case 'knight':
      return (adx === 1 && ady === 2) || (adx === 2 && ady === 1)
        ? { kind: 'move', path: [dest] }
        : null;
    case 'king':
      return Math.max(adx, ady) === 1 ? { kind: 'move', path: [dest] } : null;
    case 'rook':
      return (dx === 0) !== (dy === 0) ? { kind: 'move', path: rayPath(o, d, boardWidth) } : null;
    case 'bishop':
      return adx === ady && adx > 0 ? { kind: 'move', path: rayPath(o, d, boardWidth) } : null;
    case 'queen':
      return (dx === 0) !== (dy === 0) || (adx === ady && adx > 0)
        ? { kind: 'move', path: rayPath(o, d, boardWidth) }
        : null;
    case 'pawn': {
      if (!facing) return null;
      if (dx === facing.dx && dy === facing.dy) return { kind: 'move', path: [dest] };
      // Side squares: a full-turn quarter rotation toward that side.
      if ((dx === -facing.dy && dy === facing.dx) || (dx === facing.dy && dy === -facing.dx)) {
        return { kind: 'rotate', facing: { dx, dy } };
      }
      // Diagonal-forward: attack/eat only.
      const diag1 = { dx: facing.dx - facing.dy, dy: facing.dy + facing.dx };
      const diag2 = { dx: facing.dx + facing.dy, dy: facing.dy - facing.dx };
      if ((dx === diag1.dx && dy === diag1.dy) || (dx === diag2.dx && dy === diag2.dy)) {
        return pawnTargets?.has(dest) ? { kind: 'move', path: [dest] } : null;
      }
      return null;
    }
    default:
      return null;
  }
};

// One legal candidate for a piece this turn: the destination's FULL-BOARD
// index plus the action staging it would plan (stay / move-with-path /
// rotate-with-facing).
export interface PieceCandidate {
  dest: number;
  action: PieceAction;
}

/**
 * Enumerates every legal single-move destination for a piece THIS turn —
 * slider ray squares, knight jumps, king steps, pawn forward /
 * legal-diagonals / two side-square rotations, plus stay (the origin square).
 *
 * Implemented as an interior-square loop validated through planPieceAction so
 * the enumerated set can NEVER diverge from the staging validator: a candidate
 * is offered if and only if staging it would not degrade to stay.
 */
export const legalPieceDestinations = (
  type: string,
  origin: number,
  boardWidth: number,
  boardHeight: number,
  facing?: Facing,
  pawnTargets?: Set<number>,
): PieceCandidate[] => {
  const candidates: PieceCandidate[] = [];
  for (let y = 1; y <= boardHeight - 2; y++) {
    for (let x = 1; x <= boardWidth - 2; x++) {
      const dest = toIndex(x, y, boardWidth);
      const action = planPieceAction(type, origin, dest, boardWidth, boardHeight, facing, pawnTargets);
      if (action) candidates.push({ dest, action });
    }
  }
  return candidates;
};

const rayPath = (
  o: { x: number; y: number },
  d: { x: number; y: number },
  boardWidth: number
): number[] => {
  const steps = Math.max(Math.abs(d.x - o.x), Math.abs(d.y - o.y));
  const sx = Math.sign(d.x - o.x);
  const sy = Math.sign(d.y - o.y);
  const path: number[] = [];
  for (let i = 1; i <= steps; i++) {
    path.push(toIndex(o.x + sx * i, o.y + sy * i, boardWidth));
  }
  return path;
};
