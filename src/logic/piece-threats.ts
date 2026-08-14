/**
 * Unit-threat module: contest adjudication plus the per-decision UNIT threat
 * map — one mechanism answering, for every square, "which other units could
 * take this square next turn and hurt us there?" for BOTH unit kinds:
 * snakes (the old bespoke head-to-head adjacency scan) and chess pieces.
 *
 * CONTEST RULE (the engine's stationary-square adjudication, tier FIRST,
 * weight second): when units contest a square, everyone below the top
 * invulnerability tier at the square dies with weight never consulted; among
 * the top tier the unique heaviest survives, and ties kill all. For pieces,
 * `snake.length` carries the WEIGHT (stack size), not a body cell count.
 * `winsStationaryContest` is the ONE encoding of that rule, shared by:
 *  - BoardGraph's subjective passability (may WE walk onto a piece square?),
 *  - the Simulator's mover-vs-stationary-piece resolution,
 *  - the threat map below (would the unit kill-or-tie US at a square?).
 *
 * PER-KIND REACH (one generator per unit kind):
 *  - snake: the head's 4 orthogonal neighbors — deliberately UNfiltered by
 *    occupancy or legality (matching the legacy h2h scan: a snake whose only
 *    adjacent option is its own body still "threatens" the square; we don't
 *    model enemy-suicide filtering here).
 *  - sliders (rook/bishop/queen): full rays from the current square, blocked
 *    by CURRENT occupancy — any unit body/stack stops the ray, but the
 *    blocker square itself IS reachable (contests happen there). Range is
 *    deliberately NOT capped by the piece's health: a piece can overspend
 *    health on a long move and still kill in-flight before it dies.
 *  - knight: the 8 L-jumps; king: the 8 adjacent steps.
 *  - pawn: the faced square plus BOTH diagonal-forwards (from snake.facing,
 *    wire convention — api cell of a wire delta d is {x + d.dx, y - d.dy}).
 *    Diagonals threaten regardless of current occupancy: occupancy can change
 *    under the pawn before the turn resolves.
 * Squares outside the api board are excluded.
 *
 * THREAT SEMANTICS (identical for both kinds): an ENEMY unit marks a
 * reachable square only when it would WIN OR TIE the contest against the
 * subject there (win-or-tie = the subject does not win — one rule, negated).
 * An ALLY unit marks every reachable square: we never want the trade,
 * whoever would survive it.
 *
 * TIER TIMING (one rule for both kinds): both sides' tiers are projected to
 * the ARRIVAL turn (currentTurn + 1) — a level counts iff
 * arrivalTurn <= invulnerabilityExpiryTurn — with fallback expiry =
 * arrivalTurn when no expiry schedule is derivable (a visible nonzero level
 * with unknown expiry is assumed to still govern the next resolution).
 *
 * Why this is safe AND matches the raw-current-level read on every real
 * document: the engine expires effects at the END of the resolution that
 * produces turn P (dropping expiryTurn <= P), AFTER collisions — so every
 * effect visible in a turn-T document has expiryTurn >= T+1 and always
 * governs the next resolution. Projection and raw read therefore agree
 * whenever expiry data exists; the fallback covers the remaining
 * missing-schedule case in the same direction (level still applies), which
 * is the conservative direction for assessing an ENEMY's tier. This differs
 * deliberately from BoardGraph/Simulator's own expires-now fallback, which
 * serves OWN-capability conservatism (assume our buff is gone) in
 * passability/severing.
 */

import { Board, Snake } from '../types/battlesnake';

/**
 * Does a unit with (ourTier, ourWeight) WIN a stationary-square contest
 * against (theirTier, theirWeight) — i.e. survive it while the other dies?
 * Tier first, weight second, ties kill all (so a tie is NOT a win).
 */
export function winsStationaryContest(
  ourTier: number,
  ourWeight: number,
  theirTier: number,
  theirWeight: number
): boolean {
  if (theirTier < ourTier) return true;
  if (theirTier > ourTier) return false;
  return ourWeight > theirWeight;
}

export const isPieceUnit = (s: Snake): boolean => (s.unitType ?? 'snake') !== 'snake';

export type UnitThreatKind = 'snake' | 'piece';

/** One unit threatening one square: who, which side, which reach/timing kind. */
export interface UnitThreatEntry {
  sourceUnitId: string;
  isAlly: boolean;
  sourceKind: UnitThreatKind;
}

export interface UnitThreatMap {
  width: number;
  height: number;
  /**
   * Sparse per-cell threat entries (index y * width + x); cells nobody
   * threatens hold undefined. Enemy entries already encode the contest
   * filter (an enemy the subject beats outright contributes nothing);
   * ally entries cover the unit's full reach.
   */
  entriesByCell: Array<UnitThreatEntry[] | undefined>;
}

/** Legacy piece-only projection of the unit threat map (counts per cell). */
export interface PieceThreatMap {
  width: number;
  height: number;
  /** Per-cell count of ENEMY pieces that could reach it next turn AND would win-or-tie the contest vs the subject. */
  enemyThreat: Uint8Array;
  /** Per-cell count of ALLY pieces that could reach it next turn (always an unwanted trade). */
  allyThreat: Uint8Array;
}

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]] as const;

/**
 * Every api-board square a SNAKE could move its head onto next turn: the 4
 * orthogonal neighbors, board-bounded but otherwise UNfiltered (no wall/body
 * legality — see the module doc). Cell indices (y * width + x).
 */
export function snakeReachableIdx(snakeUnit: Snake, board: Board): number[] {
  const W = board.width;
  const H = board.height;
  const { x, y } = snakeUnit.head;
  const out: number[] = [];
  for (const [dx, dy] of ORTHO) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx >= 0 && cx < W && cy >= 0 && cy < H) out.push(cy * W + cx);
  }
  return out;
}

/**
 * Every api-board square `piece` could reach with a single move next turn,
 * as cell indices (y * width + x). `occupied` marks CURRENT unit occupancy
 * (any body/stack cell) and blocks slider rays beyond the blocker square;
 * knight/king/pawn destinations ignore occupancy entirely (contests happen
 * on arrival). Exported for direct geometry tests.
 */
export function pieceReachableIdx(piece: Snake, board: Board, occupied: Uint8Array): number[] {
  const W = board.width;
  const H = board.height;
  const { x, y } = piece.head;
  const out: number[] = [];
  const push = (cx: number, cy: number): void => {
    if (cx >= 0 && cx < W && cy >= 0 && cy < H) out.push(cy * W + cx);
  };
  const rays = (dirs: ReadonlyArray<readonly [number, number]>): void => {
    for (const [dx, dy] of dirs) {
      let cx = x + dx;
      let cy = y + dy;
      while (cx >= 0 && cx < W && cy >= 0 && cy < H) {
        out.push(cy * W + cx);
        if (occupied[cy * W + cx] === 1) break; // blocker included, ray stops
        cx += dx;
        cy += dy;
      }
    }
  };

  switch (piece.unitType) {
    case 'rook':
      rays(ORTHO);
      break;
    case 'bishop':
      rays(DIAG);
      break;
    case 'queen':
      rays(ORTHO);
      rays(DIAG);
      break;
    case 'knight':
      for (const [dx, dy] of KNIGHT) push(x + dx, y + dy);
      break;
    case 'king':
      for (const [dx, dy] of [...ORTHO, ...DIAG]) push(x + dx, y + dy);
      break;
    case 'pawn': {
      const f = piece.facing;
      // Wire deltas (y down); api cell of wire delta d is {x + d.dx, y - d.dy}.
      const deltas = [
        { dx: f.dx, dy: f.dy },                    // forward
        { dx: f.dx - f.dy, dy: f.dy + f.dx },      // diagonal-forward 1
        { dx: f.dx + f.dy, dy: f.dy - f.dx },      // diagonal-forward 2
      ];
      for (const d of deltas) push(x + d.dx, y - d.dy);
      break;
    }
    default:
      break; // unknown/snake: no piece moves
  }
  return out;
}

/**
 * Build the subject-relative UNIT threat map for one decision, or null when
 * no other living unit exists on the board. One computation covers both unit
 * kinds; per-kind reach and the shared tier-timing rule are documented in
 * the module header.
 */
export function computeUnitThreatMap(
  subject: Snake,
  board: Board,
  currentTurn: number,
  teamSnakeIds?: Set<string>
): UnitThreatMap | null {
  const others = board.snakes.filter((s) => s.health > 0 && s.id !== subject.id);
  if (others.length === 0) return null;

  const W = board.width;
  const H = board.height;
  const cells = W * H;

  // Current occupancy (every living unit's body/stack cells, heads included)
  // is only consulted by slider rays — built lazily so snake-only boards
  // never pay for it.
  let occupied: Uint8Array | null = null;
  const getOccupied = (): Uint8Array => {
    if (occupied) return occupied;
    occupied = new Uint8Array(cells);
    for (const s of board.snakes) {
      if (s.health <= 0) continue;
      for (const seg of s.body) {
        if (seg.x >= 0 && seg.x < W && seg.y >= 0 && seg.y < H) {
          occupied[seg.y * W + seg.x] = 1;
        }
      }
    }
    return occupied;
  };

  // One tier-timing rule for both kinds (see module doc): arrival-turn
  // projection, with a missing expiry schedule assumed to still cover the
  // arrival turn.
  const arrivalTurn = currentTurn + 1;
  const tierOf = (s: Snake): number =>
    arrivalTurn <= (s.invulnerabilityExpiryTurn ?? arrivalTurn)
      ? (s.invulnerabilityLevel ?? 0)
      : 0;

  const entriesByCell: Array<UnitThreatEntry[] | undefined> = new Array(cells);

  for (const unit of others) {
    const sourceKind: UnitThreatKind = isPieceUnit(unit) ? 'piece' : 'snake';
    const isAlly = teamSnakeIds?.has(unit.id) ?? false;
    // Enemy units only threaten where they would win-or-tie the contest —
    // exactly "the subject does NOT win" under the one shared rule. Allies
    // threaten their full reach regardless.
    if (!isAlly && winsStationaryContest(tierOf(subject), subject.length, tierOf(unit), unit.length)) {
      continue;
    }
    const reach = sourceKind === 'piece'
      ? pieceReachableIdx(unit, board, getOccupied())
      : snakeReachableIdx(unit, board);
    const entry: UnitThreatEntry = { sourceUnitId: unit.id, isAlly, sourceKind };
    for (const idx of reach) {
      (entriesByCell[idx] ??= []).push(entry);
    }
  }

  return { width: W, height: H, entriesByCell };
}

/**
 * Piece-only projection of the unit threat map (per-cell counts), or null on
 * a piece-free board (the common snake-only game — the caller pays nothing).
 * Kept as the module's piece-plane view; the mechanism lives entirely in
 * computeUnitThreatMap.
 */
export function computePieceThreatMap(
  subject: Snake,
  board: Board,
  currentTurn: number,
  teamSnakeIds?: Set<string>
): PieceThreatMap | null {
  const hasPiece = board.snakes.some(
    (s) => s.health > 0 && s.id !== subject.id && isPieceUnit(s)
  );
  if (!hasPiece) return null;

  const unitMap = computeUnitThreatMap(subject, board, currentTurn, teamSnakeIds)!;
  const cells = unitMap.width * unitMap.height;
  const enemyThreat = new Uint8Array(cells);
  const allyThreat = new Uint8Array(cells);
  for (let idx = 0; idx < cells; idx++) {
    const entries = unitMap.entriesByCell[idx];
    if (!entries) continue;
    for (const e of entries) {
      if (e.sourceKind !== 'piece') continue;
      const target = e.isAlly ? allyThreat : enemyThreat;
      if (target[idx] < 255) target[idx]++;
    }
  }
  return { width: unitMap.width, height: unitMap.height, enemyThreat, allyThreat };
}
