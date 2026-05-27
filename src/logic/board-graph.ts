/**
 * Board graph representation for unified pathfinding.
 * Builds an unweighted graph with edges only for passable boundaries.
 * Includes optimistic passability calculations for body segments.
 */

import { GameState, Coord, Snake } from '../types/battlesnake';
import { DEFAULT_CONFIG } from '../config/game-config';

export type CellKey = string;

export interface BoardGraphConfig {
  // Tail growth variant: 
  // 'grow-same-turn' - snake grows immediately when eating (tail doesn't move)
  // 'grow-next-turn' - snake grows on turn after eating (tail moves when eating)
  tailGrowthTiming: 'grow-same-turn' | 'grow-next-turn';
  
  // Maximum turns to look ahead for optimistic passability
  maxLookaheadTurns: number;
  
  // Game-rules: damage per turn taken when standing on a hazard cell. The
  // floodfill / move-analyzer use this together with the snake's current
  // health to decide whether a hazard cell should be treated as impassable.
  hazardDamagePerTurn: number;
  
  // Game-rules: snake health when freshly fed. Used as the fallback when the
  // incoming GameState does not declare a health value.
  maxHealth: number;
}

export interface BodySegmentInfo {
  snakeId: string;
  coord: Coord;
  optimisticDisappearTurn: number;
  conservativeDisappearTurn: number;
}

export class BoardGraph {
  private adjacencyList: Map<CellKey, Set<CellKey>>;
  private blockedCells: Set<CellKey>;
  private hazardCells: Set<CellKey>;
  private width: number;
  private height: number;
  private config: BoardGraphConfig;
  private ourInvulnerabilityLevel: number;
  
  private bodySegmentInfo: Map<CellKey, BodySegmentInfo>;
  private snakeFoodReachByTurn: Map<string, number[]>;
  
  constructor(gameState: GameState, config?: Partial<BoardGraphConfig>) {
    this.width = gameState.board.width;
    this.height = gameState.board.height;
    this.config = {
      // Match official Battlesnake rules: when a snake eats, its body grows
      // immediately and the tail does not vacate that turn. This is the safer
      // default; modes with grow-next-turn semantics can opt in via config.
      tailGrowthTiming: 'grow-same-turn',
      maxLookaheadTurns: 5,
      // Defaults match Team Snek behaviour: hazards are an instant kill
      // (damage >= maxHealth), and a freshly fed snake caps at maxHealth.
      // Sourced from `DEFAULT_CONFIG` so there's a single source of truth.
      hazardDamagePerTurn: DEFAULT_CONFIG.hazardDamagePerTurn,
      maxHealth: DEFAULT_CONFIG.maxHealth,
      ...config
    };
    this.ourInvulnerabilityLevel = gameState.you.invulnerabilityLevel ?? 0;
    
    this.adjacencyList = new Map();
    this.blockedCells = new Set();
    this.hazardCells = new Set();
    this.bodySegmentInfo = new Map();
    this.snakeFoodReachByTurn = new Map();
    
    this.buildGraph(gameState);
  }
  
  /**
   * Build the graph representation with passability rules.
   * Snake heads are NOT blocked - they are starting points for territory calculation.
   * Only snake body segments (excluding heads and possibly tails) are blocked.
   */
  private buildGraph(gameState: GameState): void {
    const { board } = gameState;
    
    // Clear and rebuild blocked cells set
    this.blockedCells.clear();
    this.hazardCells.clear();
    this.bodySegmentInfo.clear();
    this.snakeFoodReachByTurn.clear();
    
    // First pass: Calculate food reachability for each snake (BFS from head)
    this.calculateSnakeFoodReachability(gameState);
    
    // Second pass: Calculate body segment disappear turns and blocking
    for (const snake of board.snakes) {
      if (snake.health <= 0) continue;
      
      // Foreign snake bodies are passable if their invulnerabilityLevel < ours
      const isSeverable = snake.id !== gameState.you.id &&
        (snake.invulnerabilityLevel ?? 0) < this.ourInvulnerabilityLevel;
      
      // Get cumulative food reachable by turn for this snake
      const cumulativeFoodByTurn = this.snakeFoodReachByTurn.get(snake.id) || [];
      
      // Add body segments as blocked (but NOT the head at index 0)
      for (let i = 1; i < snake.body.length; i++) {
        const segment = snake.body[i];
        const key = this.coordToKey(segment);
        
        // If this is a severable foreign snake, skip adding to blocked/bodySegmentInfo
        if (isSeverable) continue;
        
        // Calculate turns from tail: body[length-1] is tail (disappears in 1 turn if not eating)
        // body[i] disappears in (length - i) turns if not eating
        const turnsFromTail = snake.body.length - i;
        const optimisticDisappearTurn = turnsFromTail;
        
        // Conservative disappear turn: add potential food eaten within k turns
        // where k = optimisticDisappearTurn (inclusive, because food at turn k can stall the tail)
        let conservativeDisappearTurn = optimisticDisappearTurn;
        if (optimisticDisappearTurn <= this.config.maxLookaheadTurns) {
          // Sum up food reachable up to AND including optimisticDisappearTurn turns
          // This ensures we account for food the snake could eat right before the segment disappears
          let potentialFoodEaten = 0;
          for (let t = 0; t <= optimisticDisappearTurn && t < cumulativeFoodByTurn.length; t++) {
            potentialFoodEaten += cumulativeFoodByTurn[t];
          }
          conservativeDisappearTurn = optimisticDisappearTurn + potentialFoodEaten;
        }
        
        // Store segment info
        this.bodySegmentInfo.set(key, {
          snakeId: snake.id,
          coord: segment,
          optimisticDisappearTurn,
          conservativeDisappearTurn
        });
        
        // Tail special case (last segment)
        if (i === snake.body.length - 1) {
          // Tail will NOT vacate next turn if any of these is true:
          //   * the snake's head sits on a food cell (just ate)
          //   * the last two body coords are stacked (snake ate last turn,
          //     body grew, tail hasn't moved yet)
          //   * the snake is only two segments long, so the tail is the
          //     same cell as the segment immediately behind the head
          const tailWillStay = this.tailIsBlocked(snake, board.food);
          
          if (tailWillStay) {
            this.blockedCells.add(key);
          } else if (this.config.tailGrowthTiming === 'grow-same-turn' && this.snakeJustAte(snake, board.food)) {
            // Already covered by tailIsBlocked, but guard the legacy code path explicitly.
            this.blockedCells.add(key);
          }
          // Otherwise tail will move on the next turn, so it's not blocked.
        } else {
          // Non-tail, non-head segments are always blocked
          this.blockedCells.add(key);
        }
      }
    }
    
    // Hazards: always tracked separately so MoveAnalyzer / UI can flag them.
    // Only block as impassable terrain when stepping on the hazard would be
    // immediately lethal to OUR snake (i.e. the per-turn damage would drop our
    // health to 0 or below). Otherwise leave them passable so BFS / scoring can
    // still consider them — penalising hazards is the scorer's job.
    const hazardDamage = this.config.hazardDamagePerTurn;
    const ourHealth = gameState.you.health ?? this.config.maxHealth;
    const hazardLethalForUs = hazardDamage > 0 && hazardDamage >= ourHealth;
    for (const hazard of board.hazards) {
      const key = this.coordToKey(hazard);
      this.hazardCells.add(key);
      if (hazardLethalForUs) {
        this.blockedCells.add(key);
      }
    }
    
    // Build adjacency list for all cells
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const cellKey = this.coordToKey({ x, y });
        
        // Skip if this cell itself is blocked
        if (this.blockedCells.has(cellKey)) {
          this.adjacencyList.set(cellKey, new Set());
          continue;
        }
        
        // Check all four neighbors
        const neighbors: Coord[] = [
          { x: x, y: y + 1 },  // up
          { x: x, y: y - 1 },  // down
          { x: x - 1, y: y },  // left
          { x: x + 1, y: y }   // right
        ];
        
        const passableNeighbors = new Set<CellKey>();
        
        for (const neighbor of neighbors) {
          // Check bounds
          if (neighbor.x < 0 || neighbor.x >= this.width ||
              neighbor.y < 0 || neighbor.y >= this.height) {
            continue;  // Out of bounds
          }
          
          const neighborKey = this.coordToKey(neighbor);
          
          // Check if neighbor is blocked
          if (!this.blockedCells.has(neighborKey)) {
            passableNeighbors.add(neighborKey);
          }
        }
        
        this.adjacencyList.set(cellKey, passableNeighbors);
      }
    }
  }
  
  /**
   * Calculate food reachability from each snake's head using BFS.
   * Stores the count of NEW food reached at each distance/turn.
   * This is used for conservative disappear turn calculation.
   */
  private calculateSnakeFoodReachability(gameState: GameState): void {
    const { board } = gameState;
    
    // Create a temporary blocked set for BFS (only blocked by other snake bodies)
    const tempBlocked = new Set<CellKey>();
    
    for (const snake of board.snakes) {
      if (snake.health <= 0) continue;
      // Skip body segments of severable foreign snakes (passable due to invulnerability)
      const isSeverable = snake.id !== gameState.you.id &&
        (snake.invulnerabilityLevel ?? 0) < this.ourInvulnerabilityLevel;
      if (isSeverable) continue;
      // Block all body segments except heads
      for (let i = 1; i < snake.body.length; i++) {
        tempBlocked.add(this.coordToKey(snake.body[i]));
      }
    }
    
    // NOTE: hazards are intentionally NOT added to the BFS-blocked set here.
    // Hazards are not physical barriers — every snake can move into them and
    // simply takes damage. Treating them as walls causes false-negative food
    // reachability (and downstream tail-disappear-turn) calculations.
    
    // Create food position set
    const foodSet = new Set<CellKey>(
      board.food.map(f => this.coordToKey(f))
    );
    
    // Run BFS from each snake's head
    for (const snake of board.snakes) {
      if (snake.health <= 0) continue;
      
      const foodByTurn: number[] = [];
      const visited = new Set<CellKey>();
      
      let currentLevel: Coord[] = [snake.head];
      visited.add(this.coordToKey(snake.head));
      
      // Check if head is on food
      if (foodSet.has(this.coordToKey(snake.head))) {
        foodByTurn.push(1);
      } else {
        foodByTurn.push(0);
      }
      
      for (let turn = 1; turn <= this.config.maxLookaheadTurns; turn++) {
        const nextLevel: Coord[] = [];
        let foodFoundThisTurn = 0;
        
        for (const pos of currentLevel) {
          const neighbors: Coord[] = [
            { x: pos.x, y: pos.y + 1 },
            { x: pos.x, y: pos.y - 1 },
            { x: pos.x - 1, y: pos.y },
            { x: pos.x + 1, y: pos.y }
          ];
          
          for (const neighbor of neighbors) {
            if (neighbor.x < 0 || neighbor.x >= this.width ||
                neighbor.y < 0 || neighbor.y >= this.height) {
              continue;
            }
            
            const neighborKey = this.coordToKey(neighbor);
            
            if (visited.has(neighborKey)) continue;
            if (tempBlocked.has(neighborKey)) continue;
            
            visited.add(neighborKey);
            nextLevel.push(neighbor);
            
            if (foodSet.has(neighborKey)) {
              foodFoundThisTurn++;
            }
          }
        }
        
        foodByTurn.push(foodFoundThisTurn);
        currentLevel = nextLevel;
        
        if (currentLevel.length === 0) break;
      }
      
      this.snakeFoodReachByTurn.set(snake.id, foodByTurn);
    }
  }
  
  /**
   * Check if a snake just ate food (head is on food).
   */
  private snakeJustAte(snake: Snake, food: Coord[]): boolean {
    return food.some(f => 
      f.x === snake.head.x && f.y === snake.head.y
    );
  }
  
  /**
   * Determine whether a snake's tail will *not* vacate next turn (and is
   * therefore impassable to anyone hoping to chase it). The tail stays when:
   *   1. The snake just ate (its head is currently on a food cell), so a new
   *      segment will be appended and the tail won't move.
   *   2. The last two body coords are stacked — the snake ate previously but
   *      the duplicate tail segment hasn't been consumed yet.
   *
   * NOTE: A length-2 snake is NOT inherently blocked. Its tail vacates on the
   * next move just like any other snake, unless one of the two conditions
   * above also holds. Battlesnake spawns at length 3 and the standard rules
   * never produce a length-2 state, but the helper stays defensive in case
   * a custom ruleset or a simulated mid-step state passes one in.
   */
  private tailIsBlocked(snake: Snake, food: Coord[]): boolean {
    if (this.snakeJustAte(snake, food)) return true;
    if (snake.body.length >= 2) {
      const last = snake.body[snake.body.length - 1];
      const prev = snake.body[snake.body.length - 2];
      if (last.x === prev.x && last.y === prev.y) return true;
    }
    return false;
  }
  
  /**
   * Get passable neighbors for a cell.
   */
  getNeighbors(coord: Coord): Coord[] {
    const key = this.coordToKey(coord);
    const neighborKeys = this.adjacencyList.get(key);
    
    if (!neighborKeys) {
      return [];
    }
    
    return Array.from(neighborKeys).map(k => this.keyToCoord(k));
  }
  
  /**
   * Get passable neighbors for a cell with optimistic passability.
   * Considers body segments as passable if they will have disappeared by arrivalTurn.
   */
  getNeighborsOptimistic(coord: Coord, arrivalTurn: number): Coord[] {
    const neighbors: Coord[] = [
      { x: coord.x, y: coord.y + 1 },
      { x: coord.x, y: coord.y - 1 },
      { x: coord.x - 1, y: coord.y },
      { x: coord.x + 1, y: coord.y }
    ];
    
    const passable: Coord[] = [];
    
    for (const neighbor of neighbors) {
      if (!this.isInBounds(neighbor)) continue;
      
      if (this.isPassableAtTurn(neighbor, arrivalTurn)) {
        passable.push(neighbor);
      }
    }
    
    return passable;
  }
  
  /**
   * Check if a cell is passable at a given turn.
   * For body segments, checks if the conservative disappear turn is <= arrivalTurn.
   */
  isPassableAtTurn(coord: Coord, arrivalTurn: number): boolean {
    if (!this.isInBounds(coord)) {
      return false;
    }
    
    const key = this.coordToKey(coord);
    
    // Check if it's a body segment
    const segmentInfo = this.bodySegmentInfo.get(key);
    if (segmentInfo) {
      // Only consider within lookahead range
      if (arrivalTurn <= this.config.maxLookaheadTurns) {
        // Cell is passable if it will have disappeared by the time we arrive
        return segmentInfo.conservativeDisappearTurn <= arrivalTurn;
      }
      // Beyond lookahead range, use normal blocking
      return !this.blockedCells.has(key);
    }
    
    // For non-body-segment cells, use normal blocking
    return !this.blockedCells.has(key);
  }
  
  /**
   * Get body segment info for a cell (if it's a body segment).
   */
  getBodySegmentInfo(coord: Coord): BodySegmentInfo | undefined {
    return this.bodySegmentInfo.get(this.coordToKey(coord));
  }
  
  /**
   * Check if a coordinate is within board bounds.
   */
  isInBounds(coord: Coord): boolean {
    return coord.x >= 0 && coord.x < this.width &&
           coord.y >= 0 && coord.y < this.height;
  }
  
  /**
   * Check if a cell is passable (in bounds and not blocked).
   * This is the single source of truth for passability.
   */
  isPassable(coord: Coord): boolean {
    if (!this.isInBounds(coord)) {
      return false;
    }
    const key = this.coordToKey(coord);
    return !this.blockedCells.has(key);
  }
  
  /**
   * Get the set of blocked cell keys (for direct iteration if needed).
   */
  getBlockedCells(): Set<CellKey> {
    return this.blockedCells;
  }
  
  /**
   * Whether the given coord contains a hazard tile (regardless of whether
   * it is currently lethal to our snake).
   */
  isHazard(coord: Coord): boolean {
    return this.hazardCells.has(this.coordToKey(coord));
  }
  
  /**
   * Get the set of hazard cell keys.
   */
  getHazardCells(): Set<CellKey> {
    return this.hazardCells;
  }
  
  /**
   * Get all body segment info (for debugging/visualization).
   */
  getAllBodySegmentInfo(): Map<CellKey, BodySegmentInfo> {
    return this.bodySegmentInfo;
  }
  
  /**
   * Convert coordinate to string key.
   */
  coordToKey(coord: Coord): CellKey {
    return `${coord.x},${coord.y}`;
  }
  
  /**
   * Convert string key to coordinate.
   */
  keyToCoord(key: CellKey): Coord {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  }
  
  /**
   * Get all cells in the board.
   */
  getAllCells(): Coord[] {
    const cells: Coord[] = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        cells.push({ x, y });
      }
    }
    return cells;
  }
  
  /**
   * Get board dimensions.
   */
  getDimensions(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
