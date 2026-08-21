import { Board, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { isPieceUnit } from './piece-threats';
import { DEFAULT_PAWN_PROMOTION_WEIGHT } from './piece-moves';
import { marshalBoard } from './turn-oracle';
import { resolveTurn } from '../engine-vendor/engine/resolveTurn';

// MoveSet type definition (previously from move-enumerator)
export type MoveSet = Map<string, Direction>;

/**
 * The invulnerability tier a unit carries into the resolution of THIS turn's
 * moves (the arrival turn, currentTurn + 1). A level governs that resolution
 * only while the arrival turn is still within its server-provided expiry;
 * absent an expiry the level is assumed to apply to the CURRENT turn only, so
 * it does not govern the arrival — the own-capability-conservative fallback
 * BoardGraph's severability uses, applied symmetrically to every unit so the
 * simulator, the passability layer and the path projection below agree on
 * what a move can do.
 */
export function tierAtArrival(unit: Snake, currentTurn: number): number {
  const expiry = unit.invulnerabilityExpiryTurn ?? currentTurn;
  return currentTurn + 1 <= expiry ? (unit.invulnerabilityLevel ?? 0) : 0;
}

export interface SimulatedBoardState {
  board: Board;
  deadSnakeIds: Set<string>;
}


/**
 * One turn of the real game, for lookahead.
 *
 * This used to be a second encoding of the rules — a hand-written collision
 * pass that drifted from the engine every time the engine moved, and that
 * never applied regicide at all. It is now a marshaller: the board goes into
 * the vendored `resolveTurn`, the settled result comes back out, and the only
 * things done here afterwards are the two the module deliberately leaves to
 * its caller (pawn promotion, and the bot's own ally-trade guard).
 */
export class Simulator {
  /**
   * Simulate the next board state given a set of moves for all snakes.
   *
   * Units ABSENT from `moveSet` are FROZEN — given an empty path, which the
   * engine resolves as a unit that holds. That is the lookahead's own
   * long-standing contract and the thing that bounds its branching factor:
   * the move set names every unit being modelled, and the rest of the board
   * stands still rather than multiplying the tree.
   *
   * Same assumption turn-oracle.ts makes for turn N+0 scoring, for the same
   * reason: a unit stands where we can see it standing.
   *
   * `teamSnakeIds` keeps one deliberate BOT heuristic, and it is not a rule:
   * we never let our own snake profit from a teammate's death in a collision
   * it was part of, because the positional heuristics would otherwise read the
   * freed space as a gain. It is applied AFTER resolution, by reading the real
   * clash records, so it never touches how the turn was adjudicated.
   */
  public simulateNextBoardState(
    gameState: GameState,
    moveSet: MoveSet,
    teamSnakeIds?: Set<string>
  ): SimulatedBoardState {
    const board = gameState.board;
    const marshalled = marshalBoard(board, gameState.turn);
    const byId = new Map((board.snakes ?? []).map(s => [s.id, s]));

    const units = marshalled.units.map(unit => {
      const move = moveSet.get(unit.id);
      if (move === undefined) return { ...unit, path: [] };
      const snake = byId.get(unit.id) as Snake;
      const dest = Simulator.destinationOf(snake.head, move);
      return { ...unit, stagedMove: marshalled.toIndex(dest) };
    });

    const result = resolveTurn({ ...marshalled.config, units });

    const deadSnakeIds = new Set<string>(Object.keys(result.deaths));
    // Anything that was already off the board (health <= 0, empty body) never
    // reached the engine at all, and stays counted as dead.
    for (const snake of board.snakes ?? []) {
      if (!marshalled.startHealth.has(snake.id)) deadSnakeIds.add(snake.id);
    }

    // The ally-trade guard (see the class doc): our snake does not walk away
    // from a collision that killed a teammate.
    if (teamSnakeIds) {
      const ourId = gameState.you.id;
      const killedAlly = result.clashes.some(
        clash =>
          clash.playerIDs.includes(ourId) &&
          clash.victimIDs.some(id => id !== ourId && teamSnakeIds.has(id))
      );
      if (killedAlly) deadSnakeIds.add(ourId);
    }

    const snakes: Snake[] = [];
    for (const snake of board.snakes ?? []) {
      const settled = result.board[snake.id];
      if (!settled || deadSnakeIds.has(snake.id)) continue;
      const cells = settled.occupancy.map(marshalled.toCell);
      const piece = isPieceUnit(snake);
      const next: Snake = {
        ...snake,
        // A piece keeps the bot's collapsed shape: one body cell, `length` is
        // its WEIGHT (translate.ts's convention). A snake is its whole body.
        body: piece ? [cells[0]] : cells,
        head: { ...cells[0] },
        length: settled.occupancy.length,
        health: settled.health,
        customizations: { ...snake.customizations },
        orientation: result.rotations[snake.id]
          ? { ...result.rotations[snake.id] }
          : { ...snake.orientation },
      };
      Simulator.promoteIfDue(next, board);
      snakes.push(next);
    }

    return {
      board: {
        height: board.height,
        width: board.width,
        food: result.food.map(marshalled.toCell),
        hazards: (board.hazards ?? []).map(h => ({ x: h.x, y: h.y })),
        hazardDamage: board.hazardDamage,
        pawnPromotionWeight: board.pawnPromotionWeight,
        maxHealthPerUnit: board.maxHealthPerUnit,
        fertileTiles: board.fertileTiles?.map(f => ({ x: f.x, y: f.y })),
        snakes,
      },
      deadSnakeIds,
    };
  }

  /**
   * Pawn promotion — one of the few things `resolveTurn` deliberately leaves
   * to its caller, because it is a game-level rule rather than a turn-
   * resolution one. Applied after growth, so a pawn that eats into the
   * threshold promotes the same turn: it RESETS to weight 1 as a queen,
   * keeping id/letter/orientation, and its health is clamped DOWN (never
   * raised) to the queen's configured max.
   */
  private static promoteIfDue(snake: Snake, board: Board): void {
    if (snake.unitType !== 'pawn') return;
    const threshold = board.pawnPromotionWeight ?? DEFAULT_PAWN_PROMOTION_WEIGHT;
    if (snake.length < threshold) return;
    snake.unitType = 'queen';
    snake.body = [snake.head];
    snake.length = 1;
    const queenMax = board.maxHealthPerUnit?.['queen'];
    if (queenMax !== undefined) snake.health = Math.min(snake.health, queenMax);
  }

  /** The api cell one step in `move` from `head`. */
  private static destinationOf(head: Coord, move: Direction): Coord {
    switch (move) {
      case 'up': return { x: head.x, y: head.y + 1 };
      case 'down': return { x: head.x, y: head.y - 1 };
      case 'left': return { x: head.x - 1, y: head.y };
      case 'right': return { x: head.x + 1, y: head.y };
      default: return head;
    }
  }
}
