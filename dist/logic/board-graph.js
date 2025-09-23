"use strict";
/**
 * Board graph representation for unified pathfinding.
 * Builds an unweighted graph with edges only for passable boundaries.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoardGraph = void 0;
class BoardGraph {
    constructor(gameState, config) {
        this.width = gameState.board.width;
        this.height = gameState.board.height;
        this.config = {
            tailGrowthTiming: 'grow-next-turn',
            ...config
        };
        this.adjacencyList = new Map();
        this.buildGraph(gameState);
    }
    /**
     * Build the graph representation with passability rules.
     * Snake heads are NOT blocked - they are starting points for territory calculation.
     * Only snake body segments (excluding heads and possibly tails) are blocked.
     */
    buildGraph(gameState) {
        const { board } = gameState;
        // Create set of blocked cells (snake bodies except heads and possibly tails)
        const blockedCells = new Set();
        for (const snake of board.snakes) {
            if (snake.health <= 0)
                continue;
            // Add body segments as blocked (but NOT the head at index 0)
            for (let i = 1; i < snake.body.length; i++) { // Start from 1 to skip head
                const segment = snake.body[i];
                const key = this.coordToKey(segment);
                // Tail special case (last segment)
                if (i === snake.body.length - 1) {
                    // Check if snake just ate (will grow)
                    const justAte = this.snakeJustAte(snake, board.food);
                    if (this.config.tailGrowthTiming === 'grow-same-turn' && justAte) {
                        // Tail won't move this turn if snake just ate
                        blockedCells.add(key);
                    }
                    else if (this.config.tailGrowthTiming === 'grow-next-turn') {
                        // In grow-next-turn mode, tail always moves unless it's the only body segment after head
                        // (Note: we already skip head, so length-1 here means 2 total segments)
                        if (snake.body.length === 2) {
                            // Two segment snake - tail doesn't leave a space
                            blockedCells.add(key);
                        }
                        // Otherwise tail will move, so it's not blocked
                    }
                }
                else {
                    // Non-tail, non-head segments are always blocked
                    blockedCells.add(key);
                }
            }
        }
        // Build adjacency list for all cells
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const cellKey = this.coordToKey({ x, y });
                // Skip if this cell itself is blocked
                if (blockedCells.has(cellKey)) {
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
                    if (!blockedCells.has(neighborKey)) {
                        passableNeighbors.add(neighborKey);
                    }
                }
                this.adjacencyList.set(cellKey, passableNeighbors);
            }
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
     * Check if a cell is passable (not blocked).
     */
    isPassable(coord) {
        const key = this.coordToKey(coord);
        const neighbors = this.adjacencyList.get(key);
        // A cell is passable if it exists and has at least one neighbor
        // (blocked cells have empty neighbor sets)
        return neighbors !== undefined && neighbors.size > 0;
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
}
exports.BoardGraph = BoardGraph;
