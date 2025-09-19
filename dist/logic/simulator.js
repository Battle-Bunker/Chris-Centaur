"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Simulator = void 0;
class Simulator {
    /**
     * Simulate the next board state given a set of moves for all snakes
     */
    simulateNextBoardState(gameState, moveSet) {
        // Deep copy the board
        const newBoard = this.deepCopyBoard(gameState.board);
        const deadSnakeIds = new Set();
        // Track new head positions for collision detection
        const newHeadPositions = new Map();
        const headCollisions = new Map(); // position -> snake ids
        // Step 1: Move all snake heads
        for (const snake of newBoard.snakes) {
            if (!this.isAlive(snake)) {
                deadSnakeIds.add(snake.id);
                continue;
            }
            const move = moveSet.get(snake.id);
            if (!move)
                continue; // Skip if no move provided
            const newHead = this.getNewHead(snake.head, move);
            newHeadPositions.set(snake.id, newHead);
            // Track potential head-to-head collisions
            const posKey = `${newHead.x},${newHead.y}`;
            if (!headCollisions.has(posKey)) {
                headCollisions.set(posKey, []);
            }
            headCollisions.get(posKey).push(snake.id);
        }
        // Step 2: Resolve head-to-head collisions
        for (const [, snakeIds] of headCollisions.entries()) {
            if (snakeIds.length > 1) {
                // Multiple snakes moved to same position
                const collidingSnakes = snakeIds.map(id => newBoard.snakes.find(s => s.id === id));
                // Find the longest snake(s)
                const maxLength = Math.max(...collidingSnakes.map(s => s.length));
                const survivors = collidingSnakes.filter(s => s.length === maxLength);
                // If multiple snakes of same length, all die
                if (survivors.length > 1) {
                    for (const snake of collidingSnakes) {
                        deadSnakeIds.add(snake.id);
                    }
                }
                else {
                    // Shorter snakes die
                    for (const snake of collidingSnakes) {
                        if (snake.length < maxLength) {
                            deadSnakeIds.add(snake.id);
                        }
                    }
                }
            }
        }
        // Step 3: Check for wall and body collisions
        for (const [snakeId, newHead] of newHeadPositions.entries()) {
            if (deadSnakeIds.has(snakeId))
                continue;
            // Check wall collision
            if (newHead.x < 0 || newHead.x >= newBoard.width ||
                newHead.y < 0 || newHead.y >= newBoard.height) {
                deadSnakeIds.add(snakeId);
                continue;
            }
            // Check body collision (including other snakes)
            for (const snake of newBoard.snakes) {
                if (!this.isAlive(snake) || deadSnakeIds.has(snake.id))
                    continue;
                // Check collision with each body segment
                for (let i = 0; i < snake.body.length; i++) {
                    const segment = snake.body[i];
                    // Skip tail if it's about to move (and snake isn't eating)
                    if (i === snake.body.length - 1) {
                        // Check if snake will eat at its NEW position
                        const snakeNewHead = newHeadPositions.get(snake.id);
                        const willEat = snakeNewHead ? (gameState.board.food ?? []).some(f => f.x === snakeNewHead.x && f.y === snakeNewHead.y) : false;
                        if (!willEat && snake.id !== snakeId)
                            continue;
                        // Allow moving into own tail if not eating
                        if (snake.id === snakeId && !willEat)
                            continue;
                    }
                    if (segment.x === newHead.x && segment.y === newHead.y) {
                        deadSnakeIds.add(snakeId);
                        break;
                    }
                }
            }
        }
        // Step 4: Update snake positions for surviving snakes
        for (const snake of newBoard.snakes) {
            if (deadSnakeIds.has(snake.id))
                continue;
            const newHead = newHeadPositions.get(snake.id);
            if (!newHead)
                continue;
            // Check if snake is eating
            const foodIndex = newBoard.food.findIndex(f => f.x === newHead.x && f.y === newHead.y);
            const isEating = foodIndex !== -1;
            // Update body
            const newBody = [newHead, ...snake.body];
            if (!isEating) {
                newBody.pop(); // Remove tail if not eating
            }
            else {
                // Remove the eaten food
                newBoard.food.splice(foodIndex, 1);
                snake.health = 100; // Reset health when eating
            }
            // Update snake
            snake.head = newHead;
            snake.body = newBody;
            snake.length = newBody.length;
            // Decrease health if not eating
            if (!isEating) {
                snake.health -= 1;
                // Check if snake starved
                if (snake.health <= 0) {
                    deadSnakeIds.add(snake.id);
                }
            }
            // Apply hazard damage
            if (newBoard.hazards.some(h => h.x === newHead.x && h.y === newHead.y)) {
                snake.health -= 15; // Standard hazard damage
                if (snake.health <= 0) {
                    deadSnakeIds.add(snake.id);
                }
            }
        }
        // Step 5: Remove dead snakes from the board
        newBoard.snakes = newBoard.snakes.filter(s => !deadSnakeIds.has(s.id));
        return {
            board: newBoard,
            deadSnakeIds
        };
    }
    getNewHead(head, move) {
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
    isAlive(snake) {
        return snake.health > 0 && snake.body.length > 0;
    }
    deepCopyBoard(board) {
        return {
            height: board.height,
            width: board.width,
            food: (board.food ?? []).map(f => ({ x: f.x, y: f.y })),
            hazards: (board.hazards ?? []).map(h => ({ x: h.x, y: h.y })),
            snakes: (board.snakes ?? []).map(snake => ({
                id: snake.id,
                name: snake.name,
                latency: snake.latency,
                health: snake.health,
                body: (snake.body ?? []).map(b => ({ x: b.x, y: b.y })),
                head: { x: snake.head.x, y: snake.head.y },
                length: snake.length,
                shout: snake.shout,
                squad: snake.squad,
                customizations: { ...(snake.customizations ?? {}) }
            }))
        };
    }
}
exports.Simulator = Simulator;
