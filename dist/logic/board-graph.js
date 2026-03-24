"use strict";
/**
 * Board graph representation for unified pathfinding.
 * Builds an unweighted graph with edges only for passable boundaries.
 * Includes optimistic passability calculations for body segments.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardGraph = void 0;
class BoardGraph {
    constructor(gameState, config) {
        this.width = gameState.board.width;
        this.height = gameState.board.height;
        this.config = {
            tailGrowthTiming: 'grow-next-turn',
            maxLookaheadTurns: 5,
            ...config
        };
        this.ourInvulnerabilityLevel = gameState.you.invulnerabilityLevel ?? 0;
        this.adjacencyList = new Map();
        this.blockedCells = new Set();
        this.bodySegmentInfo = new Map();
        this.snakeFoodReachByTurn = new Map();
        this.buildGraph(gameState);
    }
    /**
     * Build the graph representation with passability rules.
     * Snake heads are NOT blocked - they are starting points for territory calculation.
     * Only snake body segments (excluding heads and possibly tails) are blocked.
     */
    buildGraph(gameState) {
        const { board } = gameState;
        // Clear and rebuild blocked cells set
        this.blockedCells.clear();
        this.bodySegmentInfo.clear();
        this.snakeFoodReachByTurn.clear();
        // First pass: Calculate food reachability for each snake (BFS from head)
        this.calculateSnakeFoodReachability(gameState);
        // Second pass: Calculate body segment disappear turns and blocking
        for (const snake of board.snakes) {
            if (snake.health <= 0)
                continue;
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
                if (isSeverable)
                    continue;
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
                    // Check if snake just ate (will grow)
                    const justAte = this.snakeJustAte(snake, board.food);
                    if (this.config.tailGrowthTiming === 'grow-same-turn' && justAte) {
                        // Tail won't move this turn if snake just ate
                        this.blockedCells.add(key);
                    }
                    else if (this.config.tailGrowthTiming === 'grow-next-turn') {
                        // In grow-next-turn mode, tail always moves unless it's the only body segment after head
                        if (snake.body.length === 2) {
                            // Two segment snake - tail doesn't leave a space
                            this.blockedCells.add(key);
                        }
                        // Otherwise tail will move, so it's not blocked
                    }
                }
                else {
                    // Non-tail, non-head segments are always blocked
                    this.blockedCells.add(key);
                }
            }
        }
        // Add hazards as blocked (impassable terrain)
        for (const hazard of board.hazards) {
            this.blockedCells.add(this.coordToKey(hazard));
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
                const neighbors = [
                    { x: x, y: y + 1 }, // up
                    { x: x, y: y - 1 }, // down
                    { x: x - 1, y: y }, // left
                    { x: x + 1, y: y } // right
                ];
                const passableNeighbors = new Set();
                for (const neighbor of neighbors) {
                    // Check bounds
                    if (neighbor.x < 0 || neighbor.x >= this.width ||
                        neighbor.y < 0 || neighbor.y >= this.height) {
                        continue; // Out of bounds
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
    calculateSnakeFoodReachability(gameState) {
        const { board } = gameState;
        // Create a temporary blocked set for BFS (only blocked by other snake bodies)
        const tempBlocked = new Set();
        for (const snake of board.snakes) {
            if (snake.health <= 0)
                continue;
            // Skip body segments of severable foreign snakes (passable due to invulnerability)
            const isSeverable = snake.id !== gameState.you.id &&
                (snake.invulnerabilityLevel ?? 0) < this.ourInvulnerabilityLevel;
            if (isSeverable)
                continue;
            // Block all body segments except heads
            for (let i = 1; i < snake.body.length; i++) {
                tempBlocked.add(this.coordToKey(snake.body[i]));
            }
        }
        // Add hazards
        for (const hazard of board.hazards) {
            tempBlocked.add(this.coordToKey(hazard));
        }
        // Create food position set
        const foodSet = new Set(board.food.map(f => this.coordToKey(f)));
        // Run BFS from each snake's head
        for (const snake of board.snakes) {
            if (snake.health <= 0)
                continue;
            const foodByTurn = [];
            const visited = new Set();
            let currentLevel = [snake.head];
            visited.add(this.coordToKey(snake.head));
            // Check if head is on food
            if (foodSet.has(this.coordToKey(snake.head))) {
                foodByTurn.push(1);
            }
            else {
                foodByTurn.push(0);
            }
            for (let turn = 1; turn <= this.config.maxLookaheadTurns; turn++) {
                const nextLevel = [];
                let foodFoundThisTurn = 0;
                for (const pos of currentLevel) {
                    const neighbors = [
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
                        if (visited.has(neighborKey))
                            continue;
                        if (tempBlocked.has(neighborKey))
                            continue;
                        visited.add(neighborKey);
                        nextLevel.push(neighbor);
                        if (foodSet.has(neighborKey)) {
                            foodFoundThisTurn++;
                        }
                    }
                }
                foodByTurn.push(foodFoundThisTurn);
                currentLevel = nextLevel;
                if (currentLevel.length === 0)
                    break;
            }
            this.snakeFoodReachByTurn.set(snake.id, foodByTurn);
        }
    }
    /**
     * Check if a snake just ate food (head is on food).
     */
    snakeJustAte(snake, food) {
        return food.some(f => f.x === snake.head.x && f.y === snake.head.y);
    }
    /**
     * Get passable neighbors for a cell.
     */
    getNeighbors(coord) {
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
    getNeighborsOptimistic(coord, arrivalTurn) {
        const neighbors = [
            { x: coord.x, y: coord.y + 1 },
            { x: coord.x, y: coord.y - 1 },
            { x: coord.x - 1, y: coord.y },
            { x: coord.x + 1, y: coord.y }
        ];
        const passable = [];
        for (const neighbor of neighbors) {
            if (!this.isInBounds(neighbor))
                continue;
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
    isPassableAtTurn(coord, arrivalTurn) {
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
    getBodySegmentInfo(coord) {
        return this.bodySegmentInfo.get(this.coordToKey(coord));
    }
    /**
     * Check if a coordinate is within board bounds.
     */
    isInBounds(coord) {
        return coord.x >= 0 && coord.x < this.width &&
            coord.y >= 0 && coord.y < this.height;
    }
    /**
     * Check if a cell is passable (in bounds and not blocked).
     * This is the single source of truth for passability.
     */
    isPassable(coord) {
        if (!this.isInBounds(coord)) {
            return false;
        }
        const key = this.coordToKey(coord);
        return !this.blockedCells.has(key);
    }
    /**
     * Get the set of blocked cell keys (for direct iteration if needed).
     */
    getBlockedCells() {
        return this.blockedCells;
    }
    /**
     * Get all body segment info (for debugging/visualization).
     */
    getAllBodySegmentInfo() {
        return this.bodySegmentInfo;
    }
    /**
     * Convert coordinate to string key.
     */
    coordToKey(coord) {
        return `${coord.x},${coord.y}`;
    }
    /**
     * Convert string key to coordinate.
     */
    keyToCoord(key) {
        const [x, y] = key.split(',').map(Number);
        return { x, y };
    }
    /**
     * Get all cells in the board.
     */
    getAllCells() {
        const cells = [];
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
    getDimensions() {
        return { width: this.width, height: this.height };
    }
}
exports.BoardGraph = BoardGraph;
