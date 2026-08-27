/**
 * Turn resolution — through the repo's VENDORED resolver and nothing else.
 *
 * Adapted from `bench/prod/sim.ts`. `marshalBoard` (src/logic/turn-oracle.ts)
 * is the repo's own board->engine marshaller and `resolveTurn`
 * (src/engine-vendor/engine/resolveTurn.ts) is the byte-for-byte copy of the
 * server's rules, so nothing in this file is a second encoding of anything:
 * the board goes in, the settled board comes out.
 *
 * Two additions over the bench version, both of them things the resolver
 * deliberately leaves to its caller (`resolveTurn.ts:35-39`):
 *   - the full typed EVENT set (deaths with reasons, clashes, severs,
 *     exhaustions, rotations) is returned rather than a count, because a
 *     replay has to carry what happened, not how much;
 *   - pawn promotion, mirrored from `Simulator.promoteIfDue` as before.
 * Food/potion spawning and invulnerability effects live in `world.ts`.
 *
 * LEGALITY is judged by `planUnitAction`, the vendored movement grammar the
 * server itself uses.
 */

import type { Board, CentaurMove, Coord, Direction, Snake } from '../src/types/battlesnake';
import { isPieceUnit } from '../src/logic/piece-threats';
import { DEFAULT_PAWN_PROMOTION_WEIGHT } from '../src/logic/piece-moves';
import { marshalBoard, resolveTurn, type MarshalledBoard } from '../src/logic/turn-oracle';
import { planUnitAction } from '../src/engine-vendor/engine/moveGrammar';
import type { ClashKind, UnitType } from '../src/engine-vendor/shared/types/Game';

import { TeamDetector } from '../src/logic/team-detector';

export type StagedMoves = ReadonlyMap<string, CentaurMove>;

/**
 * Resolution events in api coordinates. The engine speaks full-board indices;
 * everything a replay carries is in api coords so a miner never has to know
 * the board's wall convention to read one.
 */
export interface ReplayClash {
  readonly cell: Coord;
  readonly subStep: number;
  readonly kind: ClashKind;
  readonly playerIDs: string[];
  readonly victimIDs: string[];
  readonly survivorID?: string;
  readonly reason: string;
}

export interface ReplayDeath {
  readonly cell: Coord;
  readonly subStep: number;
  readonly cause: ClashKind;
}

export interface TurnEvents {
  /** Every unit removed this turn, by id, with the engine's own cause. */
  readonly deaths: Record<string, ReplayDeath>;
  /** Typed collision events, in engine order, followed by regicide records. */
  readonly clashes: ReplayClash[];
  /** Cells cut from each SURVIVING unit by a sever, in api coords. */
  readonly severedCells: Record<string, Coord[]>;
  /** Units that ran out of health and halted (some recover on food). */
  readonly exhaustions: ReadonlyArray<{ unitID: string; cell: Coord; cause: ClashKind }>;
  /** Teams whose last king fell this turn. */
  readonly eliminatedTeamIDs: ReadonlyArray<string>;
  /**
   * Units whose frozen tier was below zero and which either died or survived a
   * sever. The server keys its EARLY BUFF EXPIRY off exactly this list
   * (`scheduleVulnerableCollisionBuffExpiry`), so `world.ts` needs it and a
   * miner reading potion arms needs to see it.
   */
  readonly vulnerableCollided: ReadonlyArray<string>;
  /** Units whose staged action turned out to be a rotation. */
  readonly rotations: Record<string, { dx: number; dy: number }>;
  /** Pawns that promoted to queens after the food phase. */
  readonly promotions: string[];
  readonly subStepCount: number;
}

export interface TurnOutcome {
  readonly board: Board;
  readonly events: TurnEvents;
  /** Every unit's staged cell as the resolver saw it — null when it staged nothing. */
  readonly resolvedCells: Record<string, number | null>;
}

/** api cell one step in `move` from `head` — the wire's own convention. */
export function destinationOf(head: Coord, move: Direction): Coord {
  switch (move) {
    case 'up':
      return { x: head.x, y: head.y + 1 };
    case 'down':
      return { x: head.x, y: head.y - 1 };
    case 'left':
      return { x: head.x - 1, y: head.y };
    case 'right':
      return { x: head.x + 1, y: head.y };
    default:
      return head;
  }
}

/**
 * A staged CentaurMove as a FULL-board cell index. Snakes speak Directions,
 * pieces speak destination indices — and a piece's index is already a
 * full-board index (the wire and the engine share one index space).
 */
export function stagedCellOf(
  marshalled: MarshalledBoard,
  snake: Snake,
  move: CentaurMove
): number | null {
  if (typeof move === 'number') return move;
  if (move === undefined || move === null) return null;
  return marshalled.toIndex(destinationOf(snake.head, move));
}

export interface LegalityReport {
  /** Staged cells the vendored grammar refuses outright. */
  illegal: Array<{ unit: string; type: string; cell: number }>;
  /** Legal-but-not-a-move: the resolver falls back to the kind's default. */
  nonGrammatical: Array<{ unit: string; type: string; cell: number }>;
  /** Our alive units with no staged move at all. */
  unstaged: string[];
}

export function judgeLegality(
  board: Board,
  turn: number,
  ours: ReadonlyArray<string>,
  staged: StagedMoves
): LegalityReport {
  const marshalled = marshalBoard(board, turn);
  const pawnTargets = new Set<number>(marshalled.config.food);
  for (const u of marshalled.units) for (const c of u.occupancy) pawnTargets.add(c);
  const byId = new Map(marshalled.units.map((u) => [u.id, u]));
  const snakeById = new Map((board.snakes ?? []).map((s) => [s.id, s]));
  const out: LegalityReport = { illegal: [], nonGrammatical: [], unstaged: [] };

  for (const id of ours) {
    const unit = byId.get(id);
    if (unit === undefined) continue; // dead this turn — not ours to stage
    const move = staged.get(id);
    if (move === undefined) {
      out.unstaged.push(id);
      continue;
    }
    const snake = snakeById.get(id) as Snake;
    const cell = stagedCellOf(marshalled, snake, move);
    if (cell === null) {
      out.unstaged.push(id);
      continue;
    }
    const action = planUnitAction(
      unit.type as UnitType,
      unit.occupancy[0] as number,
      cell,
      marshalled.fullWidth,
      marshalled.fullHeight,
      unit.orientation,
      pawnTargets
    );
    if (action === null) out.illegal.push({ unit: id, type: unit.type, cell });
    else if (action.kind === 'stay' && unit.type === 'snake') {
      out.nonGrammatical.push({ unit: id, type: unit.type, cell });
    }
  }
  return out;
}

/**
 * One FULL turn: every unit on the board stages, the vendored resolver
 * adjudicates, and the settled board comes back. A unit absent from `staged`
 * takes the engine's own default (trail units continue straight, pieces hold)
 * — exactly what production does for a unit no bot spoke for.
 */
export function resolveFullTurn(board: Board, turn: number, staged: StagedMoves): TurnOutcome {
  const marshalled = marshalBoard(board, turn);
  const byId = new Map((board.snakes ?? []).map((s) => [s.id, s]));
  const resolvedCells: Record<string, number | null> = {};

  const units = marshalled.units.map((unit) => {
    const move = staged.get(unit.id);
    if (move === undefined) {
      resolvedCells[unit.id] = null;
      return { ...unit };
    }
    const snake = byId.get(unit.id) as Snake;
    const cell = stagedCellOf(marshalled, snake, move);
    resolvedCells[unit.id] = cell;
    if (cell === null) return { ...unit };
    return { ...unit, stagedMove: cell };
  });

  const result = resolveTurn({ ...marshalled.config, units });
  const dead = new Set<string>(Object.keys(result.deaths));
  for (const snake of board.snakes ?? []) {
    if (!marshalled.startHealth.has(snake.id)) dead.add(snake.id);
  }

  const promotions: string[] = [];
  const snakes: Snake[] = [];
  for (const snake of board.snakes ?? []) {
    const settled = result.board[snake.id];
    if (!settled || dead.has(snake.id)) continue;
    const cells = settled.occupancy.map(marshalled.toCell);
    const piece = isPieceUnit(snake);
    const next: Snake = {
      ...snake,
      body: piece ? [cells[0] as Coord] : cells,
      head: { ...(cells[0] as Coord) },
      length: settled.occupancy.length,
      health: settled.health,
      customizations: { ...snake.customizations },
      orientation: result.rotations[snake.id]
        ? { ...result.rotations[snake.id] }
        : { ...snake.orientation },
    };
    if (promoteIfDue(next, board)) promotions.push(next.id);
    snakes.push(next);
  }

  const severedCells: Record<string, Coord[]> = {};
  for (const [id, cells] of Object.entries(result.severedCells)) {
    severedCells[id] = cells.map(marshalled.toCell);
  }

  const nextBoard: Board = {
    ...board,
    food: result.food.map(marshalled.toCell),
    hazards: (board.hazards ?? []).map((h) => ({ x: h.x, y: h.y })),
    snakes,
  };

  const deaths: Record<string, ReplayDeath> = {};
  for (const [id, d] of Object.entries(result.deaths)) {
    deaths[id] = { cell: marshalled.toCell(d.cell), subStep: d.subStep, cause: d.cause };
  }

  return {
    board: nextBoard,
    resolvedCells,
    events: {
      deaths,
      clashes: (result.clashes ?? []).map((c) => ({
        cell: marshalled.toCell(c.index),
        subStep: c.subStep,
        kind: c.kind,
        playerIDs: c.playerIDs,
        victimIDs: c.victimIDs,
        ...(c.survivorID !== undefined ? { survivorID: c.survivorID } : {}),
        reason: c.reason,
      })),
      severedCells,
      exhaustions: (result.exhaustions ?? []).map((e) => ({
        unitID: e.unitID,
        cell: marshalled.toCell(e.cell),
        cause: e.cause,
      })),
      eliminatedTeamIDs: result.eliminatedTeamIDs,
      vulnerableCollided: result.vulnerableCollided ?? [],
      rotations: result.rotations as Record<string, { dx: number; dy: number }>,
      promotions,
      subStepCount: result.subStepCount,
    },
  };
}

/** Mirrored from `Simulator.promoteIfDue` — the caller's half of the rules. */
function promoteIfDue(snake: Snake, board: Board): boolean {
  if (snake.unitType !== 'pawn') return false;
  const threshold = board.pawnPromotionWeight ?? DEFAULT_PAWN_PROMOTION_WEIGHT;
  if (snake.length < threshold) return false;
  snake.unitType = 'queen';
  snake.body = [snake.head];
  snake.length = 1;
  const queenMax = board.maxHealthPerUnit?.['queen'];
  if (queenMax !== undefined) snake.health = Math.min(snake.health, queenMax);
  return true;
}

// ------------------------------------------------------------------ scoring

export interface TeamStanding {
  readonly teamID: string;
  readonly units: number;
  /** Sum of unit weights — the same material unit the evaluators speak in. */
  readonly material: number;
  readonly hasKing: boolean;
  readonly health: number;
}

export function standings(board: Board): TeamStanding[] {
  const by = new Map<string, { units: number; material: number; hasKing: boolean; health: number }>();
  for (const s of board.snakes ?? []) {
    if (s.health <= 0 || s.body.length === 0) continue;
    const team = TeamDetector.getTeamKey(s);
    const row = by.get(team) ?? { units: 0, material: 0, hasKing: false, health: 0 };
    row.units += 1;
    row.material += Math.max(1, s.length);
    row.health += s.health;
    if (s.unitType === 'king') row.hasKing = true;
    by.set(team, row);
  }
  return [...by.entries()].map(([teamID, r]) => ({ teamID, ...r }));
}

export function standingFor(board: Board, teamID: string): TeamStanding {
  return (
    standings(board).find((r) => r.teamID === teamID) ?? {
      teamID,
      units: 0,
      material: 0,
      hasKing: false,
      health: 0,
    }
  );
}

export function teamAlive(board: Board, teamID: string): boolean {
  return (board.snakes ?? []).some(
    (s) => TeamDetector.getTeamKey(s) === teamID && s.health > 0 && s.body.length > 0
  );
}

export function unitsOf(board: Board, teamID: string): Snake[] {
  return (board.snakes ?? []).filter(
    (s) => TeamDetector.getTeamKey(s) === teamID && s.health > 0 && s.body.length > 0
  );
}

export function livingTeams(board: Board): string[] {
  return [
    ...new Set(
      (board.snakes ?? [])
        .filter((s) => s.health > 0 && s.body.length > 0)
        .map((s) => TeamDetector.getTeamKey(s))
    ),
  ].sort();
}
