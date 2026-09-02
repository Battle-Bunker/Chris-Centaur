import { Board, Coord, Direction, GameState, Snake } from '../types/battlesnake';
import { aggregateExpiryTurn } from '../firebase/translate';
import { isPieceUnit } from './piece-threats';
import { StagedAction, marshalBoard, resolvePartialTurn } from './turn-oracle';

// MoveSet type definition (previously from move-enumerator)
export type MoveSet = Map<string, Direction>;

/**
 * The invulnerability tier a unit carries into the resolution of THIS turn's
 * moves (the arrival turn, currentTurn + 1) — settlement's INPUT tier, which
 * it then advances and hands back as `Settlement.tiers`. A level governs that
 * resolution only while the arrival turn is still within its expiry;
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
 * the vendored `settleTurn`, the settled result comes back out, and the only
 * things done here afterwards are the two the module deliberately leaves to
 * its caller (pawn promotion, and the bot's own ally-trade guard).
 *
 * TIER, EFFECTS AND POTIONS ARE PART OF THAT RESULT. They used to ride the
 * `...snake` spread through untouched, which meant a simulated turn could not
 * move a tier window at all: an enemy's transient buff never lapsed, our own
 * transient debuff never lifted, and a potion the simulated move landed on
 * cost nobody anything. Settlement writes all three and this file copies them
 * out; nothing here recomputes what a pickup or an expiry does.
 */
export class Simulator {
  /**
   * Simulate the next board state given a set of moves for all snakes.
   *
   * `moveSet` names every unit being modelled; the rest of the board is
   * FROZEN — one turn behind in time, a collision incumbent and nothing else.
   * That is what bounds the lookahead's branching factor, and it is the same
   * PARTIAL-TIME-ADVANCE CONTRACT turn-oracle.ts applies to turn N+0 scoring.
   * `resolvePartialTurn` is the single implementation of it; read the contract
   * there before changing anything here.
   *
   * (The territory BFS compensates for the half-turn skew on its own side:
   * board-evaluator gives every SIMULATED snake `startDelay: 1`, because it
   * has spent its move, while a frozen snake floods from distance 0 with its
   * move still in hand.)
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

    const staged = new Map<string, StagedAction>();
    for (const unit of marshalled.units) {
      const move = moveSet.get(unit.id);
      if (move === undefined) continue; // frozen: see resolvePartialTurn
      const snake = byId.get(unit.id) as Snake;
      staged.set(unit.id, { stagedMove: marshalled.toIndex(Simulator.destinationOf(snake.head, move)) });
    }

    const result = resolvePartialTurn(marshalled, staged);

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

    // THE TIER STATE OF THE NEXT TURN IS THE SETTLEMENT'S, NOT THIS BOARD'S.
    // It used to ride through on the `...snake` spread, which froze every tier
    // window at its observed value: a three-turn buff never lapsed across a
    // simulated turn, a collected potion never charged anybody, and a potion
    // taken on the simulated move left the board with no effect at all. All
    // three are `settleTurn` outputs now and none of them is computed here.
    const hadSchedule = board.activeEffects !== undefined;
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
        // Orientation and KIND are settlement outputs too: the engine rewrites
        // facing and promotes pawns itself, so the bot reads both back rather
        // than re-deriving either.
        orientation: result.orientation[snake.id]
          ? { ...result.orientation[snake.id] }
          : { ...snake.orientation },
        // A unit that declared no kind is a snake by the bot's convention; keep
      // that shape and read the settled kind back only where one was declared.
      unitType: snake.unitType === undefined ? undefined : (result.unitTypes[snake.id] ?? snake.unitType),
        invulnerabilityLevel: result.tiers[snake.id] ?? 0,
      };
      // How long that level is safe to bank on: the earliest expiry among the
      // effects SETTLEMENT left this unit holding. A board that carried no
      // schedule can say nothing new, so its stated expiry — an absolute turn
      // number, which the passing of a turn does not move — rides across.
      const expiry = aggregateExpiryTurn(result.effects, snake.id);
      if (hadSchedule && expiry !== null) next.invulnerabilityExpiryTurn = expiry;
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
        // Potions the turn did not collect, and the schedule as it closed. The
        // simulated board used to carry neither, so a lookahead played every
        // turn after the first on a board with no potions and no effects on it.
        invulnerabilityPotions: result.potions.map(marshalled.toCell),
        invulnerabilityPotionsEnabled: board.invulnerabilityPotionsEnabled,
        invulnerabilityPotionWindowTurns: board.invulnerabilityPotionWindowTurns,
        activeEffects: hadSchedule || result.effects.length > 0 ? result.effects : undefined,
        snakes,
      },
      deadSnakeIds,
    };
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
