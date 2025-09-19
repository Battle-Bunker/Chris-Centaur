"use strict";
/**
 * Unified move analyzer that provides a single source of truth for move safety.
 * Returns both safe moves (definite survival) and risky moves (possible head-to-head death).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MoveAnalyzer = void 0;
const turn_state_1 = require("./turn-state");
class MoveAnalyzer {
    constructor(tailSafetyRule = 'custom') {
        this.tailSafetyRule = tailSafetyRule;
    }
    /**
     * Analyzes available moves for a snake and categorizes them as safe or risky.
     * This is the single source of truth for move safety in the entire codebase.
     */
    analyzeMoves(snake, gameState) {
        // Update turn state to track which snakes ate food
        const turnStateManager = turn_state_1.TurnStateManager.getInstance();
        const snakesAteLastTurn = turnStateManager.updateState(gameState.game.id, gameState.turn, gameState.board.snakes.map(s => ({ id: s.id, length: s.length })));
        const head = snake.head;
        const allDirections = ['up', 'down', 'left', 'right'];
        const safe = [];
        const risky = [];
        // Analyze each possible move
        for (const direction of allDirections) {
            const newPosition = this.getNextPosition(head, direction);
            // Check for certain death (walls, body collisions)
            if (!this.isPositionSurvivable(newPosition, snake, gameState)) {
                // This move causes certain death - exclude it entirely
                continue;
            }
            // Check for head-to-head risk
            if (this.hasHeadToHeadRisk(newPosition, snake, gameState)) {
                risky.push(direction);
            }
            else {
                safe.push(direction);
            }
        }
        return { safe, risky };
    }
    /**
     * Checks if a position would result in certain death (wall or body collision).
     * Does NOT consider head-to-head risks.
     */
    isPositionSurvivable(position, snake, gameState) {
        const { board } = gameState;
        // Check board boundaries
        if (position.x < 0 || position.x >= board.width ||
            position.y < 0 || position.y >= board.height) {
            return false; // Wall collision
        }
        // Check collision with any snake body (including our own)
        for (const otherSnake of board.snakes) {
            // Skip dead snakes
            if (otherSnake.health <= 0)
                continue;
            for (let i = 0; i < otherSnake.body.length; i++) {
                const segment = otherSnake.body[i];
                // Check if this is a tail position
                if (i === otherSnake.body.length - 1) {
                    // Get snakes that ate last turn from turn state
                    const turnStateManager = turn_state_1.TurnStateManager.getInstance();
                    const snakesAteLastTurn = turnStateManager.getSnakesAteLastTurn(gameState.game.id);
                    // Determine if tail is safe based on rule variant
                    let tailIsSafe = false;
                    if (this.tailSafetyRule === 'official') {
                        // Official rules: tail stays in place if snake eats this turn
                        const wouldEatThisTurn = board.food.some(food => food.x === position.x && food.y === position.y);
                        tailIsSafe = !wouldEatThisTurn;
                    }
                    else {
                        // Custom rules: tail stays if snake ate last turn (grows this turn)
                        tailIsSafe = !snakesAteLastTurn.has(otherSnake.id);
                    }
                    if (tailIsSafe) {
                        continue; // Tail will move out of the way
                    }
                }
                // Check for collision
                if (segment.x === position.x && segment.y === position.y) {
                    return false; // Body collision
                }
            }
        }
        // Position is survivable (no certain death)
        return true;
    }
    /**
     * Checks if a position has risk of head-to-head collision.
     * Only considers collisions where we would lose or tie.
     */
    hasHeadToHeadRisk(position, snake, gameState) {
        const { board } = gameState;
        for (const enemySnake of board.snakes) {
            // Skip ourselves and dead snakes
            if (enemySnake.id === snake.id || enemySnake.health <= 0)
                continue;
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
     * Gets the next position given a current position and direction.
     */
    getNextPosition(position, direction) {
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
exports.MoveAnalyzer = MoveAnalyzer;
