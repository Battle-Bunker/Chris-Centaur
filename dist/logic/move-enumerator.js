"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoveEnumerator = void 0;
class MoveEnumerator {
    constructor(config = {}) {
        this.config = {
            maxNearbyDistance: config.maxNearbyDistance ?? 3,
            maxStates: config.maxStates ?? 729,
            timeoutMs: config.timeoutMs ?? 400
        };
    }
    /**
     * Enumerate all possible move combinations for nearby snakes
     * and random moves for distant snakes
     */
    enumerateMoveSets(gameState, startTime) {
        const nearbySnakes = this.getNearbySnakes(gameState);
        const distantSnakes = this.getDistantSnakes(gameState, nearbySnakes);
        // Get valid moves for each nearby snake
        const nearbyMovesMap = new Map();
        for (const snake of nearbySnakes) {
            nearbyMovesMap.set(snake.id, this.getValidMoves(snake, gameState));
        }
        // Generate Cartesian product for nearby snakes
        const moveSets = [];
        this.generateCartesianProduct(nearbySnakes, nearbyMovesMap, distantSnakes, gameState, moveSets, new Map(), 0, startTime);
        return moveSets;
    }
    /**
     * Get snakes within maxNearbyDistance of our head
     */
    getNearbySnakes(gameState) {
        const ourHead = gameState.you.head;
        return gameState.board.snakes.filter(snake => {
            if (!this.isAlive(snake))
                return false;
            const distance = this.manhattanDistance(ourHead, snake.head);
            return distance <= this.config.maxNearbyDistance;
        });
    }
    /**
     * Get snakes that are distant (not nearby)
     */
    getDistantSnakes(gameState, nearbySnakes) {
        const nearbyIds = new Set(nearbySnakes.map(s => s.id));
        return gameState.board.snakes.filter(snake => this.isAlive(snake) && !nearbyIds.has(snake.id));
    }
    /**
     * Get valid (non-death) moves for a snake
     */
    getValidMoves(snake, gameState) {
        const validMoves = [];
        const head = snake.head;
        const moves = [
            { dir: 'up', coord: { x: head.x, y: head.y + 1 } },
            { dir: 'down', coord: { x: head.x, y: head.y - 1 } },
            { dir: 'left', coord: { x: head.x - 1, y: head.y } },
            { dir: 'right', coord: { x: head.x + 1, y: head.y } }
        ];
        // First pass: get safe moves (avoiding certain death)
        for (const move of moves) {
            if (this.isSafeMove(move.coord, snake, gameState)) {
                validMoves.push(move.dir);
            }
        }
        // For our snake only: filter out risky head-to-head moves unless no other choice
        if (snake.id === gameState.you.id && validMoves.length > 0) {
            const nonRiskyMoves = [];
            for (const dir of validMoves) {
                const coord = dir === 'up' ? { x: head.x, y: head.y + 1 } :
                    dir === 'down' ? { x: head.x, y: head.y - 1 } :
                        dir === 'left' ? { x: head.x - 1, y: head.y } :
                            { x: head.x + 1, y: head.y };
                if (!this.isRiskyHeadToHead(coord, snake, gameState)) {
                    nonRiskyMoves.push(dir);
                }
            }
            // Use non-risky moves if available, otherwise use all valid moves
            if (nonRiskyMoves.length > 0) {
                return nonRiskyMoves;
            }
        }
        // If no safe moves, return all moves (snake will die anyway)
        return validMoves.length > 0 ? validMoves : ['up', 'down', 'left', 'right'];
    }
    /**
     * Check if a move is safe (won't result in immediate death)
     */
    isSafeMove(coord, snake, gameState) {
        // Check bounds
        if (coord.x < 0 || coord.x >= gameState.board.width ||
            coord.y < 0 || coord.y >= gameState.board.height) {
            return false;
        }
        // Check collision with snake bodies
        for (const otherSnake of gameState.board.snakes) {
            if (!this.isAlive(otherSnake))
                continue;
            for (let i = 0; i < otherSnake.body.length; i++) {
                const segment = otherSnake.body[i];
                // Allow moving into own tail if not eating
                if (otherSnake.id === snake.id && i === otherSnake.body.length - 1) {
                    // Check if snake will eat at its NEW position
                    const onFood = gameState.board.food.some(f => f.x === coord.x && f.y === coord.y);
                    if (!onFood)
                        continue;
                }
                if (segment.x === coord.x && segment.y === coord.y) {
                    return false;
                }
            }
        }
        // Hazards are valid but will be penalized in scoring
        return true;
    }
    /**
     * Check if a move is risky due to possible head-to-head collision
     * Returns true if the move could result in death from head-to-head with equal/larger snake
     */
    isRiskyHeadToHead(coord, snake, gameState) {
        for (const enemySnake of gameState.board.snakes) {
            if (enemySnake.id === snake.id)
                continue;
            if (!this.isAlive(enemySnake))
                continue;
            // Check if enemy snake's head is adjacent to this position
            const enemyHead = enemySnake.head;
            const distance = Math.abs(enemyHead.x - coord.x) + Math.abs(enemyHead.y - coord.y);
            if (distance === 1) {
                // Enemy could move to this position next turn
                // This is risky if we would lose or tie in head-to-head
                if (snake.length <= enemySnake.length) {
                    return true; // Risky move
                }
            }
        }
        return false;
    }
    /**
     * Generate Cartesian product of moves recursively
     */
    generateCartesianProduct(nearbySnakes, nearbyMovesMap, distantSnakes, gameState, results, currentMoveSet, index, startTime) {
        // Check time budget
        if (Date.now() - startTime > this.config.timeoutMs) {
            return;
        }
        // Check max states
        if (results.length >= this.config.maxStates) {
            return;
        }
        // Base case: all nearby snakes have moves assigned
        if (index >= nearbySnakes.length) {
            // Add random moves for distant snakes
            const fullMoveSet = new Map(currentMoveSet);
            for (const snake of distantSnakes) {
                const validMoves = this.getValidMoves(snake, gameState);
                const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
                fullMoveSet.set(snake.id, randomMove);
            }
            results.push(fullMoveSet);
            return;
        }
        // Recursive case: try each valid move for current snake
        const snake = nearbySnakes[index];
        const validMoves = nearbyMovesMap.get(snake.id) || [];
        for (const move of validMoves) {
            const newMoveSet = new Map(currentMoveSet);
            newMoveSet.set(snake.id, move);
            this.generateCartesianProduct(nearbySnakes, nearbyMovesMap, distantSnakes, gameState, results, newMoveSet, index + 1, startTime);
        }
    }
    manhattanDistance(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    isAlive(snake) {
        return snake.health > 0 && snake.body.length > 0;
    }
}
exports.MoveEnumerator = MoveEnumerator;
//# sourceMappingURL=move-enumerator.js.map