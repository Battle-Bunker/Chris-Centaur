/**
 * STAGING LEGALITY — what a unit may be staged to, asked of the engine.
 *
 * This module owns no rules. It is the api-coordinate adapter over the
 * vendored engine's own grammar queries (`src/engine-vendor/engine/queries.ts`
 * and the `moveGrammar` surface it re-exports), so the operator interface, the
 * piece candidate broadcast and the fast staging pass all ask the SAME code
 * the server stages with.
 *
 * It replaces `logic/piece-moves.ts`, whose header said "MIRRORED from
 * moveGrammar" and which drifted in exactly the places a mirror drifts: it
 * bounds-checked every destination before dispatching on kind, so a pawn with
 * its back to the perimeter lost the quarter turn the engine grants it (the
 * side square is signalling and is never entered — `moveGrammar.ts`), and it
 * knew nothing about trail units, whose staged wall is a legal and fatal move.
 * Both differences are now the engine's answer rather than ours.
 *
 * ── Coordinates ────────────────────────────────────────────────────────────
 * The engine thinks in FULL-BOARD indices: the perimeter wall is part of the
 * grid and y grows downward. The bot thinks in api coords (perimeter stripped,
 * y up). Everything crossing the boundary goes through `translate.ts`'s
 * `apiCoordToIndex` / `toApiCoord` — the one mapping in the codebase — and the
 * full-board dimensions are always `board.width + 2` by `board.height + 2`.
 * Functions here that take or return a plain `number` cell speak FULL-BOARD,
 * because that is what the wire stages and what the engine reads.
 */

import type { UnitType } from '@shared/types/Game';
import {
  BoardShape,
  GrammarUnit,
  actionOf,
  coverOf,
  legalTargets,
  pathOf,
  rotationTargets,
  stagedAction,
} from '../engine-vendor/engine/queries';
import {
  DEFAULT_PAWN_PROMOTION_WEIGHT,
  Orientation,
  UnitAction,
  isInterior,
  isPieceType,
  legalOrientations,
  planUnitAction,
  toIndex,
  toXY,
} from '../engine-vendor/engine/moveGrammar';
import type { Board, Coord, Snake } from '../types/battlesnake';
import { apiCoordToIndex, toApiCoord } from '../firebase/translate';

// The engine's movement surface, re-exported so a consumer has ONE import
// site for "what may this unit do" — the same reason `queries.ts` re-exports
// the grammar upstream.
export {
  DEFAULT_PAWN_PROMOTION_WEIGHT,
  isInterior,
  isPieceType,
  legalOrientations,
  planUnitAction,
  toIndex,
  toXY,
};
export type { BoardShape, GrammarUnit, Orientation, UnitAction };

/**
 * The action a staged destination plans. Named for the interface that reads
 * it — the staged record carries the stay/move/rotate discriminant so the UI
 * can label a candidate and route a pawn's arrow keys to its rotations — but
 * it IS the engine's `UnitAction`, not a parallel type.
 */
export type PieceAction = UnitAction;

/**
 * Can this unit kind HOLD — spend a whole turn on its own square, keeping its
 * orientation?
 *
 * A chess piece can: staging its own square plans `{ kind: 'stay' }`, which is
 * a real move on the wire, and standing still costs no movement health. A
 * SNAKE cannot: `planUnitAction` refuses a trail unit's own square (`adx + ady`
 * is 0, not 1), because a snake's head must vacate every turn — the wire has
 * no stay for it, only the four directions — so there is nothing for a hold
 * command to stage. The split is the grammar's `isPieceType`, deliberately:
 * hold is offered to exactly the units the engine can express it for.
 */
export const canHold = (unitType?: string): boolean => isPieceType(unitType as UnitType | undefined);

/** Is this unit a chess piece rather than a trail unit? */
export const isPieceUnit = (s: Snake): boolean => (s.unitType ?? 'snake') !== 'snake';

/** Is this unit a king — the unit whose loss ends its team under regicide? */
export const isKingUnit = (s: Snake): boolean => s.unitType === 'king';

// ---------------------------------------------------------------------------
// Marshalling: an api board into the shape the grammar queries ask about
// ---------------------------------------------------------------------------

/** Full-board dimensions of an api board: the perimeter, re-added. */
export const fullDims = (board: Board): { fullW: number; fullH: number } => ({
  fullW: board.width + 2,
  fullH: board.height + 2,
});

/** The perimeter wall of a full-board grid, as indices. */
const perimeterOf = (fullW: number, fullH: number): number[] => {
  const walls: number[] = [];
  for (let y = 0; y < fullH; y++) {
    for (let x = 0; x < fullW; x++) {
      if (!isInterior(x, y, fullW, fullH)) walls.push(toIndex(x, y, fullW));
    }
  }
  return walls;
};

/**
 * The board a staging question is asked against: terrain, every standing body
 * and the food. Hazards are carried because the query surface takes them —
 * they damage and never block, which is the engine's own reading of them.
 */
export function stagingBoard(board: Board): BoardShape {
  const { fullW, fullH } = fullDims(board);
  return {
    boardWidth: fullW,
    boardHeight: fullH,
    walls: perimeterOf(fullW, fullH),
    hazards: (board.hazards ?? []).map((h) => apiCoordToIndex(h, fullW, fullH)),
    occupancy: (board.snakes ?? []).map((s) => ({
      id: s.id,
      cells: (s.body ?? []).map((seg) => apiCoordToIndex(seg, fullW, fullH)),
    })),
    food: (board.food ?? []).map((f) => apiCoordToIndex(f, fullW, fullH)),
  };
}

/** One unit as the grammar sees it: kind, occupancy (head first), facing. */
export function grammarUnitOf(snake: Snake, board: Board): GrammarUnit {
  const { fullW, fullH } = fullDims(board);
  const body = snake.body?.length ? snake.body : [snake.head];
  return {
    type: (snake.unitType ?? 'snake') as UnitType,
    occupancy: body.map((seg) => apiCoordToIndex(seg, fullW, fullH)),
    orientation: snake.orientation,
  };
}

/**
 * A grammar unit assembled from the parts the manager keeps separately: the
 * kind it is playing at THIS turn (promotion moves it), where its head stands
 * as a full-board index, and which way it faces. A piece's occupancy is its
 * square; nothing in the grammar reads a piece's stack depth.
 */
export const grammarUnitAt = (
  unitType: string | undefined,
  originIdx: number,
  orientation: Orientation
): GrammarUnit => ({
  type: (unitType ?? 'snake') as UnitType,
  occupancy: [originIdx],
  orientation,
});

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

/** One legal destination this turn: where to stage, and what staging plans. */
export interface StagingCandidate {
  /** FULL-BOARD destination index — the value the wire carries. */
  dest: number;
  action: PieceAction;
}

/**
 * Every cell this unit may legally be staged to, with the action each plans.
 *
 * Straight from `legalTargets` + `actionOf`, so the offered set can never
 * diverge from what the server accepts: a piece's own square (hold), a
 * slider's whole ray whatever stands on it, a knight's jumps, a pawn's step,
 * its two side-square rotations and the diagonals that hold food or a body.
 * A trail unit gets its four steps, the perimeter included — a legal move and
 * a fatal one, which is a judgement for the caller and not for the grammar.
 */
export function legalStagingCandidates(unit: GrammarUnit, board: BoardShape): StagingCandidate[] {
  return legalTargets(unit, board).map((dest) => ({
    dest,
    action: actionOf(unit, dest, board)!,
  }));
}

/** The action a destination plans for this unit, or null when it is illegal. */
export function stagingActionFor(
  unit: GrammarUnit,
  dest: number,
  board: BoardShape
): PieceAction | null {
  return actionOf(unit, dest, board);
}

/** The action a staged cell really produces, the server's default substituted. */
export function resolvedStagingAction(
  unit: GrammarUnit,
  staged: number | undefined,
  board: BoardShape
): PieceAction {
  return stagedAction(unit, staged, board);
}

/** The cells this unit would walk to reach `dest`, or null when illegal. */
export function stagingPath(
  unit: GrammarUnit,
  dest: number,
  board: BoardShape
): number[] | null {
  return pathOf(unit, dest, board);
}

/** The cells this unit could contest next turn, rays cut at the first body. */
export function stagingCover(unit: GrammarUnit, board: BoardShape): number[] {
  return coverOf(unit, board);
}

/** The turns this unit could spend rotating: the cell to stage, and the facing. */
export function stagingRotations(
  unit: GrammarUnit,
  board: BoardShape
): { target: number; orientation: Orientation }[] {
  return rotationTargets(unit, board);
}

/** A full-board destination index as an api coord on this board. */
export const destCoordOf = (dest: number, board: Board): Coord => {
  const { fullW, fullH } = fullDims(board);
  return toApiCoord(dest, fullW, fullH);
};

// ---------------------------------------------------------------------------
// The fast staging pass's refusal
// ---------------------------------------------------------------------------

/** Why a staged destination is certainly fatal to its own mover, or `null`. */
export type SelfFatalKind = 'wall' | 'own-body';

/**
 * Is this destination fatal to the mover BY GEOMETRY, with no other unit's
 * choice in it?
 *
 * Two arms, both properties of the mover's own turn-start occupancy and of the
 * terrain, so the answer is the same in every world any search could
 * enumerate — which is what makes it usable as a refusal in the ~1ms fast
 * staging pass, where nothing is settled and nothing is searched.
 *
 *  - WALL: the path crosses the perimeter. Only a trail unit can stage one at
 *    all (the grammar refuses a piece), and wherever on the path it happens it
 *    is the same death.
 *  - OWN BODY: `cells[1 .. len-2]` is still occupied next turn in every world —
 *    the body shifts by one and only the tail vacates. Index 0 is the mover's
 *    own head, which a trail unit cannot stage anyway.
 *
 * This is the api-side twin of `lobster/staging-safety.ts`'s
 * `certainlySelfFatal`, which states the same two theorems over the search's
 * bitboard substrate. Neither derives a rule: the PATH comes from the grammar,
 * and what is asserted about it is arithmetic on occupancy.
 */
export function certainlyFatalStaging(
  unit: GrammarUnit,
  dest: number,
  board: BoardShape
): SelfFatalKind | null {
  const path = pathOf(unit, dest, board);
  if (path === null || path.length === 0) return null; // illegal, or enters nothing

  const walls = new Set(board.walls);
  for (const cell of path) {
    if (walls.has(cell)) return 'wall';
  }

  // Trail units only: a piece's stack occupies one square, which it leaves.
  if (unit.type === 'snake' && unit.occupancy.length >= 3) {
    const last = unit.occupancy.length - 2;
    for (let i = 1; i <= last; i++) {
      if (path.includes(unit.occupancy[i])) return 'own-body';
    }
  }

  return null;
}

/**
 * A cheap safe move for the fast staging pass: the destination this unit
 * should be staged to before anything has been thought about.
 *
 * Preference order, and the whole of it: keep going the way the unit is
 * already facing when that is not certainly fatal (a trail unit's default IS
 * that step, so agreeing with it costs the least and reads the most
 * predictably), else the first legal destination that is not certainly fatal,
 * else the first legal destination at all — a unit boxed in stages something
 * rather than letting the server's default walk it into a wall it did not
 * choose. Null only when the grammar offers nothing.
 */
export function quickStagingTarget(unit: GrammarUnit, board: BoardShape): number | null {
  const targets = legalTargets(unit, board);
  if (targets.length === 0) return null;

  const origin = unit.occupancy[0];
  const { x, y } = toXY(origin, board.boardWidth);
  const ahead = toIndex(x + unit.orientation.dx, y + unit.orientation.dy, board.boardWidth);

  let firstSafe: number | null = null;
  for (const target of targets) {
    if (target === origin) continue; // holding is not a fast-pass answer for a mover
    if (certainlyFatalStaging(unit, target, board) !== null) continue;
    if (target === ahead) return ahead;
    if (firstSafe === null) firstSafe = target;
  }
  return firstSafe ?? targets[0];
}
