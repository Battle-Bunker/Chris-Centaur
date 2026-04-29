/**
 * Unified move analyzer that provides a single source of truth for move safety.
 * Returns both safe moves (definite survival) and risky moves (possible head-to-head death).
 */

import { GameState, Snake, Direction, Coord } from '../types/battlesnake';
import { TurnStateManager } from './turn-state';
import { BoardGraph } from './board-graph';

export interface H2HRiskInfo {
  hasEnemyRisk: boolean;   // Risk of h2h with equal/larger enemy
  hasAllyRisk: boolean;    // Risk of h2h with equal/larger ally
  enemyRiskCount: number;  // Number of threatening enemies
  allyRiskCount: number;   // Number of threatening allies
}

export interface MoveAnalysis {
  safe: Direction[];   // Moves that definitely won't cause death
  risky: Direction[];  // Moves that could result in head-to-head death
  h2hRiskByMove: Map<Direction, H2HRiskInfo>;  // H2H risk details per move
  reasonByMove: Map<Direction, LethalityReason>; // Why each direction is lethal/risky/safe
}

/**
 * The lethality classification for a candidate direction.
 * Used by safety logging, the trapped-state picker, and the Centaur play UI.
 */
export type LethalityReason =
  | 'safe'
  | 'wall'
  | 'own-body'
  | 'own-tail-blocked'
  | 'enemy-body'
  | 'enemy-tail-blocked'
  | 'hazard'
  | 'h2h-loss-enemy'
  | 'h2h-loss-ally';

/**
 * Survival-hope priority ordering (higher = better) for the trapped-state picker.
 * If we MUST pick a known-lethal direction, we pick the one with the most
 * realistic chance of actually surviving (e.g. a snake's tail might still
 * move and free up the cell), down to the most certainly-fatal options.
 */
const SURVIVAL_HOPE_PRIORITY: Record<LethalityReason, number> = {
  'safe': 100,
  'h2h-loss-enemy': 90,           // h2h is uncertain - enemy may move elsewhere
  'h2h-loss-ally': 89,
  'own-tail-blocked': 80,         // tail might still move (e.g. evaluator wrong about food)
  'enemy-tail-blocked': 70,
  'hazard': 60,                   // hazard is only lethal if we're low on health; still moves a turn
  'enemy-body': 30,
  'own-body': 20,
  'wall': 10,
};

const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

export interface UnsafePickLogContext {
  source: 'risky-best' | 'trapped-fallback' | 'first-move' | 'guardrail-corrected';
  gameState: GameState;
  snake: Snake;
  reasonByMove: Map<Direction, LethalityReason>;
  chosen: Direction;
  score?: number | null;
  extra?: Record<string, unknown>;
}

export class MoveAnalyzer {
  private tailSafetyRule: 'official' | 'custom';
  
  constructor(tailSafetyRule: 'official' | 'custom' = 'custom') {
    this.tailSafetyRule = tailSafetyRule;
  }
  /**
   * Analyzes available moves for a snake and categorizes them as safe or risky.
   * This is the single source of truth for move safety in the entire codebase.
   * Uses BoardGraph as the single source of truth for passability.
   */
  public analyzeMoves(snake: Snake, gameState: GameState, graph: BoardGraph, teamSnakeIds?: Set<string>): MoveAnalysis {
    // Update turn state to track which snakes ate food
    const turnStateManager = TurnStateManager.getInstance();
    turnStateManager.updateState(
      gameState.game.id, 
      gameState.turn, 
      gameState.board.snakes.map(s => ({id: s.id, length: s.length}))
    );
    const head = snake.head;
    const safe: Direction[] = [];
    const risky: Direction[] = [];
    const h2hRiskByMove = new Map<Direction, H2HRiskInfo>();
    const reasonByMove = new Map<Direction, LethalityReason>();
    
    // Analyze each possible move
    for (const direction of ALL_DIRECTIONS) {
      const newPosition = this.getNextPosition(head, direction);
      
      // Check for certain death using BoardGraph's passability (walls, bodies, lethal hazards)
      if (!graph.isPassable(newPosition)) {
        // Classify why and exclude from safe/risky entirely
        reasonByMove.set(direction, this.classifyImpassable(newPosition, snake, gameState, graph));
        continue;
      }
      
      // Get detailed head-to-head risk information
      const h2hRisk = this.getHeadToHeadRiskInfo(newPosition, snake, gameState, teamSnakeIds);
      h2hRiskByMove.set(direction, h2hRisk);
      
      // Check for head-to-head risk (any risk = risky move)
      if (h2hRisk.hasEnemyRisk || h2hRisk.hasAllyRisk) {
        risky.push(direction);
        // Prefer the more dangerous reason if both apply
        reasonByMove.set(direction, h2hRisk.hasEnemyRisk ? 'h2h-loss-enemy' : 'h2h-loss-ally');
      } else {
        safe.push(direction);
        reasonByMove.set(direction, 'safe');
      }
    }
    
    return { safe, risky, h2hRiskByMove, reasonByMove };
  }
  
  /**
   * Classify all four directions for a snake regardless of safety, returning the
   * lethality reason for each. Useful for the trapped-state picker, the first-move
   * fallback, the safety-guardrail re-check, and the Centaur play UI.
   */
  public classifyAllDirections(
    snake: Snake,
    gameState: GameState,
    graph: BoardGraph,
    teamSnakeIds?: Set<string>
  ): Map<Direction, LethalityReason> {
    const result = new Map<Direction, LethalityReason>();
    for (const direction of ALL_DIRECTIONS) {
      const newPosition = this.getNextPosition(snake.head, direction);
      if (!graph.isPassable(newPosition)) {
        result.set(direction, this.classifyImpassable(newPosition, snake, gameState, graph));
        continue;
      }
      const h2hRisk = this.getHeadToHeadRiskInfo(newPosition, snake, gameState, teamSnakeIds);
      if (h2hRisk.hasEnemyRisk) {
        result.set(direction, 'h2h-loss-enemy');
      } else if (h2hRisk.hasAllyRisk) {
        result.set(direction, 'h2h-loss-ally');
      } else {
        result.set(direction, 'safe');
      }
    }
    return result;
  }
  
  /**
   * Pick the "least bad" direction when no safe and no risky moves exist.
   * Priority: safe > h2h-loss > own-tail > enemy-tail > hazard > enemy-body > own-body > wall.
   * Tie-break: prefer the move whose destination is closest to the board centre,
   * then by canonical Direction order ('up', 'down', 'left', 'right').
   */
  public pickLeastBadMove(
    snake: Snake,
    gameState: GameState,
    classifications: Map<Direction, LethalityReason>
  ): Direction {
    const board = gameState.board;
    const cx = (board.width - 1) / 2;
    const cy = (board.height - 1) / 2;
    
    let best: Direction = ALL_DIRECTIONS[0];
    let bestPriority = -Infinity;
    let bestCenterDist = Infinity;
    let bestDirIdx = Infinity;
    
    for (let i = 0; i < ALL_DIRECTIONS.length; i++) {
      const dir = ALL_DIRECTIONS[i];
      const reason = classifications.get(dir) ?? 'wall';
      const priority = SURVIVAL_HOPE_PRIORITY[reason];
      const dest = this.getNextPosition(snake.head, dir);
      const centerDist = Math.abs(dest.x - cx) + Math.abs(dest.y - cy);
      
      if (
        priority > bestPriority ||
        (priority === bestPriority && centerDist < bestCenterDist) ||
        (priority === bestPriority && centerDist === bestCenterDist && i < bestDirIdx)
      ) {
        best = dir;
        bestPriority = priority;
        bestCenterDist = centerDist;
        bestDirIdx = i;
      }
    }
    
    return best;
  }
  
  /**
   * Emit a single structured log line whenever the bot picks a move that's not
   * in the `safe` set (i.e. risky, trapped-fallback, first-move, or guardrail-corrected).
   * This is the diagnostic foundation for investigating any remaining bot suicides.
   */
  public static logUnsafePick(ctx: UnsafePickLogContext): void {
    const { source, gameState, snake, reasonByMove, chosen, score, extra } = ctx;
    const reasons: Record<string, LethalityReason> = {};
    for (const dir of ALL_DIRECTIONS) {
      reasons[dir] = reasonByMove.get(dir) ?? 'safe';
    }
    const payload = {
      event: 'unsafe-pick',
      source,
      gameId: gameState.game.id,
      snakeId: snake.id,
      snakeName: snake.name,
      turn: gameState.turn,
      head: { x: snake.head.x, y: snake.head.y },
      bodyLength: snake.body.length,
      health: snake.health,
      reasons,
      chosen,
      chosenReason: reasons[chosen],
      score: score ?? null,
      ...(extra ?? {}),
    };
    console.log(`[BotSafety] ${JSON.stringify(payload)}`);
  }
  
  /**
   * Decide the lethality reason for a destination cell already known to be impassable.
   * Walls (out-of-bounds) come first; otherwise we identify the snake & segment that
   * blocks the cell, and finally fall back to hazard.
   */
  private classifyImpassable(
    position: Coord,
    snake: Snake,
    gameState: GameState,
    graph: BoardGraph
  ): LethalityReason {
    if (!graph.isInBounds(position)) {
      return 'wall';
    }
    const board = gameState.board;
    
    // Identify which snake / segment this cell belongs to (if any).
    for (const otherSnake of board.snakes) {
      if (otherSnake.health <= 0) continue;
      for (let i = 1; i < otherSnake.body.length; i++) {
        const seg = otherSnake.body[i];
        if (seg.x !== position.x || seg.y !== position.y) continue;
        const isTail = i === otherSnake.body.length - 1;
        const isOurs = otherSnake.id === snake.id;
        if (isTail) {
          return isOurs ? 'own-tail-blocked' : 'enemy-tail-blocked';
        }
        return isOurs ? 'own-body' : 'enemy-body';
      }
    }
    
    // Fall back to hazard - the only remaining reason a cell would be marked impassable.
    if (graph.isHazard(position)) {
      return 'hazard';
    }
    
    // Shouldn't normally happen, but be conservative.
    return 'wall';
  }
  
  /**
   * Checks if a position has risk of head-to-head collision.
   * Only considers collisions where we would lose or tie.
   */
  private hasHeadToHeadRisk(position: Coord, snake: Snake, gameState: GameState): boolean {
    const { board } = gameState;
    
    for (const enemySnake of board.snakes) {
      // Skip ourselves and dead snakes
      if (enemySnake.id === snake.id || enemySnake.health <= 0) continue;
      
      // Check if enemy head is adjacent to our potential position
      const enemyHead = enemySnake.head;
      const distance = Math.abs(position.x - enemyHead.x) + Math.abs(position.y - enemyHead.y);
      
      if (distance === 1) {
        // Enemy could move to our position next turn
        // This is risky if we would lose (smaller) or tie (same size)
        if (snake.length <= enemySnake.length) {
          return true; // Risky head-to-head
        }
      }
    }
    
    return false; // No head-to-head risk
  }
  
  /**
   * Gets detailed head-to-head risk information for a position.
   * Distinguishes between enemy and ally h2h risks.
   */
  private getHeadToHeadRiskInfo(position: Coord, snake: Snake, gameState: GameState, teamSnakeIds?: Set<string>): H2HRiskInfo {
    const { board } = gameState;
    const result: H2HRiskInfo = {
      hasEnemyRisk: false,
      hasAllyRisk: false,
      enemyRiskCount: 0,
      allyRiskCount: 0
    };
    
    for (const otherSnake of board.snakes) {
      // Skip ourselves and dead snakes
      if (otherSnake.id === snake.id || otherSnake.health <= 0) continue;
      
      // Check if other snake's head is adjacent to our potential position
      const otherHead = otherSnake.head;
      const distance = Math.abs(position.x - otherHead.x) + Math.abs(position.y - otherHead.y);
      
      if (distance === 1) {
        // Other snake could move to our position next turn
        // This is risky if we would lose (smaller) or tie (same size)
        if (snake.length <= otherSnake.length) {
          // Determine if this is an ally or enemy
          const isAlly = teamSnakeIds?.has(otherSnake.id) ?? false;
          
          if (isAlly) {
            result.hasAllyRisk = true;
            result.allyRiskCount++;
          } else {
            result.hasEnemyRisk = true;
            result.enemyRiskCount++;
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * Gets the next position given a current position and direction.
   */
  private getNextPosition(position: Coord, direction: Direction): Coord {
    switch (direction) {
      case 'up':
        return { x: position.x, y: position.y + 1 };
      case 'down':
        return { x: position.x, y: position.y - 1 };
      case 'left':
        return { x: position.x - 1, y: position.y };
      case 'right':
        return { x: position.x + 1, y: position.y };
    }
  }
}
