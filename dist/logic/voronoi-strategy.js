"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoronoiStrategy = void 0;
class VoronoiStrategy {
    constructor() {
        this.config = {
            maxDistance: 3,
            numRandomMoves: 10,
            maxSimulations: 100,
            maxEvaluationTimeMs: 400 // Leave buffer before 500ms timeout
        };
    }
    setConfig(config) {
        this.config = { ...this.config, ...config };
    }
    getBestMove(gameState, ourTeam) {
        const startTime = Date.now();
        const possibleMoves = this.getSafeMoves(gameState);
        if (possibleMoves.length === 0) {
            return 'up'; // Fallback if no safe moves
        }
        if (possibleMoves.length === 1) {
            return possibleMoves[0];
        }
        // Evaluate each possible move using Voronoi territory simulation with time bounds
        let bestMove = possibleMoves[0];
        let bestScore = -Infinity;
        for (const move of possibleMoves) {
            // Check if we're running out of time
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime > this.config.maxEvaluationTimeMs) {
                console.log(`Time limit reached after ${elapsedTime}ms, using best move found so far`);
                break;
            }
            const remainingTime = this.config.maxEvaluationTimeMs - elapsedTime;
            const score = this.evaluateMove(gameState, move, ourTeam, remainingTime);
            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
        return bestMove;
    }
    getSafeMoves(gameState) {
        const head = gameState.you.head;
        const allMoves = ['up', 'down', 'left', 'right'];
        const safeMoves = [];
        for (const move of allMoves) {
            const newHead = this.getNewHeadPosition(head, move);
            const moveRisk = this.evaluateMoveRisk(newHead, move, gameState);
            // Only consider moves that won't result in immediate death
            if (moveRisk.isSafe) {
                safeMoves.push(move);
            }
        }
        return safeMoves.length > 0 ? safeMoves : allMoves; // Fallback to any move if all moves are risky
    }
    getNewHeadPosition(head, direction) {
        switch (direction) {
            case 'up': return { x: head.x, y: head.y - 1 };
            case 'down': return { x: head.x, y: head.y + 1 };
            case 'left': return { x: head.x - 1, y: head.y };
            case 'right': return { x: head.x + 1, y: head.y };
        }
    }
    evaluateMoveRisk(position, move, gameState) {
        const { board } = gameState;
        // Check board boundaries
        if (position.x < 0 || position.x >= board.width ||
            position.y < 0 || position.y >= board.height) {
            return { isSafe: false, riskScore: 1000, hasHazard: false };
        }
        let riskScore = 0;
        let hasHazard = false;
        // Check hazards (not immediately deadly but risky)
        for (const hazard of board.hazards) {
            if (position.x === hazard.x && position.y === hazard.y) {
                hasHazard = true;
                riskScore += 15; // Hazard cost
                // Only avoid hazards if health is too low
                if (gameState.you.health <= 15) {
                    return { isSafe: false, riskScore: riskScore + 500, hasHazard: true };
                }
            }
        }
        // Check collision with snake bodies
        for (const snake of board.snakes) {
            // Check body collision (excluding tail tip which will move unless snake ate food)
            for (let i = 0; i < snake.body.length - 1; i++) {
                const bodyPart = snake.body[i];
                if (position.x === bodyPart.x && position.y === bodyPart.y) {
                    return { isSafe: false, riskScore: 1000, hasHazard };
                }
            }
            // Check potential tail collision (if snake might eat food)
            const tail = snake.body[snake.body.length - 1];
            if (position.x === tail.x && position.y === tail.y) {
                // Check if this snake might eat food this turn
                const snakeCouldEatFood = board.food.some(food => this.manhattanDistance(snake.head, food) <= 1);
                if (snakeCouldEatFood) {
                    return { isSafe: false, riskScore: 800, hasHazard };
                }
            }
        }
        // Check head-to-head collision risks
        const headToHeadRisk = this.evaluateHeadToHeadRisk(position, gameState);
        if (!headToHeadRisk.isSafe) {
            return { isSafe: false, riskScore: headToHeadRisk.riskScore, hasHazard };
        }
        riskScore += headToHeadRisk.riskScore;
        return { isSafe: true, riskScore, hasHazard };
    }
    evaluateHeadToHeadRisk(position, gameState) {
        let riskScore = 0;
        for (const enemySnake of gameState.board.snakes) {
            if (enemySnake.id === gameState.you.id)
                continue;
            // Check if enemy snake could move to this position
            const enemyHead = enemySnake.head;
            const enemyCanReachPosition = this.manhattanDistance(enemyHead, position) === 1;
            if (enemyCanReachPosition) {
                // Head-to-head collision rules:
                // 1. Longer snake wins
                // 2. Equal length -> both die
                // 3. Shorter snake dies
                if (gameState.you.length > enemySnake.length) {
                    // We win head-to-head, but still some risk
                    riskScore += 10;
                }
                else if (gameState.you.length === enemySnake.length) {
                    // Both die - very dangerous
                    return { isSafe: false, riskScore: 900 };
                }
                else {
                    // We lose head-to-head - deadly
                    return { isSafe: false, riskScore: 950 };
                }
            }
        }
        return { isSafe: true, riskScore };
    }
    isSafePosition(position, gameState) {
        const moveRisk = this.evaluateMoveRisk(position, 'up', gameState); // Direction doesn't matter for basic safety
        return moveRisk.isSafe;
    }
    evaluateMove(gameState, move, ourTeam, remainingTimeMs) {
        let totalScore = 0;
        const maxSimulations = Math.min(this.config.maxSimulations, this.config.numRandomMoves);
        // Dynamically adjust simulation count based on remaining time
        const timePerSimulation = 2; // Estimated ms per simulation
        const timeBasedMaxSims = remainingTimeMs ? Math.floor(remainingTimeMs / timePerSimulation) : maxSimulations;
        const simulations = Math.min(maxSimulations, timeBasedMaxSims, 50); // Cap at 50 for safety
        const startTime = Date.now();
        let actualSimulations = 0;
        for (let i = 0; i < simulations; i++) {
            // Check time budget for each simulation
            if (remainingTimeMs && (Date.now() - startTime) > remainingTimeMs * 0.8) {
                console.log(`Breaking evaluation early after ${actualSimulations} simulations due to time constraint`);
                break;
            }
            const simulatedState = this.simulateGameState(gameState, move);
            const voronoiResult = this.calculateVoronoiTerritories(simulatedState, ourTeam);
            if (ourTeam) {
                const teamKey = this.getTeamKey(gameState.you);
                totalScore += voronoiResult.teamTerritories.get(teamKey) || 0;
            }
            else {
                totalScore += voronoiResult.territories.get(gameState.you.id) || 0;
            }
            actualSimulations++;
        }
        return actualSimulations > 0 ? totalScore / actualSimulations : 0;
    }
    simulateGameState(gameState, ourMove) {
        // Create an efficient deep copy of the game state
        const simulated = this.cloneGameState(gameState);
        // Move our snake
        const newHead = this.getNewHeadPosition(simulated.you.head, ourMove);
        simulated.you.body = [newHead, ...simulated.you.body];
        simulated.you.head = newHead;
        // Remove tail unless food was eaten
        const ateFood = simulated.board.food.some(food => food.x === newHead.x && food.y === newHead.y);
        if (!ateFood) {
            simulated.you.body.pop();
        }
        else {
            // Remove eaten food efficiently
            simulated.board.food = simulated.board.food.filter(food => !(food.x === newHead.x && food.y === newHead.y));
            simulated.you.length++;
        }
        // Simulate other snakes with random moves within distance
        for (const snake of simulated.board.snakes) {
            if (snake.id === simulated.you.id)
                continue;
            const distance = this.manhattanDistance(snake.head, simulated.you.head);
            if (distance <= this.config.maxDistance) {
                // Simulate this snake with a random safe move
                const safeMoves = this.getSafeMovesForSnake(snake, simulated);
                if (safeMoves.length > 0) {
                    const randomMove = safeMoves[Math.floor(Math.random() * safeMoves.length)];
                    this.moveSnakeEfficient(snake, randomMove, simulated);
                }
            }
        }
        return simulated;
    }
    cloneGameState(gameState) {
        // Efficient manual cloning instead of JSON.parse(JSON.stringify())
        const clonedSnakes = gameState.board.snakes.map(snake => ({
            id: snake.id,
            name: snake.name,
            latency: snake.latency,
            health: snake.health,
            body: snake.body.map(coord => ({ x: coord.x, y: coord.y })),
            head: { x: snake.head.x, y: snake.head.y },
            length: snake.length,
            shout: snake.shout,
            squad: snake.squad,
            customizations: {
                color: snake.customizations.color,
                head: snake.customizations.head,
                tail: snake.customizations.tail
            }
        }));
        const clonedFood = gameState.board.food.map(food => ({ x: food.x, y: food.y }));
        const clonedHazards = gameState.board.hazards.map(hazard => ({ x: hazard.x, y: hazard.y }));
        const ourSnakeClone = clonedSnakes.find(s => s.id === gameState.you.id);
        return {
            game: gameState.game, // Immutable reference sharing is fine
            turn: gameState.turn,
            board: {
                height: gameState.board.height,
                width: gameState.board.width,
                food: clonedFood,
                hazards: clonedHazards,
                snakes: clonedSnakes
            },
            you: ourSnakeClone
        };
    }
    moveSnakeEfficient(snake, direction, gameState) {
        const newHead = this.getNewHeadPosition(snake.head, direction);
        snake.body.unshift(newHead);
        snake.head = newHead;
        // Check if food was eaten
        const ateFood = gameState.board.food.some(food => food.x === newHead.x && food.y === newHead.y);
        if (!ateFood) {
            snake.body.pop();
        }
        else {
            snake.length++;
            // Remove eaten food from board
            gameState.board.food = gameState.board.food.filter(food => !(food.x === newHead.x && food.y === newHead.y));
        }
    }
    getSafeMovesForSnake(snake, gameState) {
        const head = snake.head;
        const allMoves = ['up', 'down', 'left', 'right'];
        const safeMoves = [];
        for (const move of allMoves) {
            const newHead = this.getNewHeadPosition(head, move);
            if (this.isSafePosition(newHead, gameState)) {
                safeMoves.push(move);
            }
        }
        return safeMoves;
    }
    moveSnake(snake, direction, gameState) {
        const newHead = this.getNewHeadPosition(snake.head, direction);
        snake.body.unshift(newHead);
        snake.head = newHead;
        // Check if food was eaten
        const ateFood = gameState.board.food.some(food => food.x === newHead.x && food.y === newHead.y);
        if (!ateFood) {
            snake.body.pop();
        }
    }
    manhattanDistance(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    calculateVoronoiTerritories(gameState, ourTeam) {
        const { board } = gameState;
        const territories = new Map();
        const teamTerritories = new Map();
        // Initialize territory counts
        for (const snake of board.snakes) {
            territories.set(snake.id, 0);
            const teamKey = this.getTeamKey(snake);
            if (!teamTerritories.has(teamKey)) {
                teamTerritories.set(teamKey, 0);
            }
        }
        // Use multi-source BFS to calculate proper Voronoi territories
        const distanceMap = this.calculateDistanceMapBFS(board);
        // Count territories based on closest snake
        for (let x = 0; x < board.width; x++) {
            for (let y = 0; y < board.height; y++) {
                const position = { x, y };
                const key = `${x},${y}`;
                const cellInfo = distanceMap.get(key);
                if (cellInfo && cellInfo.closestSnake) {
                    territories.set(cellInfo.closestSnake.id, (territories.get(cellInfo.closestSnake.id) || 0) + 1);
                    const teamKey = this.getTeamKey(cellInfo.closestSnake);
                    teamTerritories.set(teamKey, (teamTerritories.get(teamKey) || 0) + 1);
                }
            }
        }
        return { territories, teamTerritories };
    }
    isPositionOccupied(position, snakes) {
        for (const snake of snakes) {
            for (const bodyPart of snake.body) {
                if (position.x === bodyPart.x && position.y === bodyPart.y) {
                    return true;
                }
            }
        }
        return false;
    }
    isPositionHazard(position, hazards) {
        return hazards.some(hazard => position.x === hazard.x && position.y === hazard.y);
    }
    getTeamKey(snake) {
        // Use squad field for team detection, fallback to color
        return snake.squad || snake.customizations.color;
    }
    calculateDistanceMapBFS(board) {
        const distanceMap = new Map();
        const queue = [];
        const visited = new Set();
        // Initialize BFS from all snake heads simultaneously
        for (const snake of board.snakes) {
            const head = snake.head;
            const key = `${head.x},${head.y}`;
            if (!this.isPositionOccupied(head, board.snakes) && !this.isPositionHazard(head, board.hazards)) {
                queue.push({ x: head.x, y: head.y, distance: 0, snake });
                distanceMap.set(key, { distance: 0, closestSnake: snake });
                visited.add(key);
            }
        }
        const directions = [
            { dx: 0, dy: 1 }, // down
            { dx: 0, dy: -1 }, // up
            { dx: 1, dy: 0 }, // right
            { dx: -1, dy: 0 } // left
        ];
        // Multi-source BFS
        let queueIndex = 0;
        while (queueIndex < queue.length) {
            const current = queue[queueIndex++];
            for (const dir of directions) {
                const newX = current.x + dir.dx;
                const newY = current.y + dir.dy;
                const newPos = { x: newX, y: newY };
                const key = `${newX},${newY}`;
                // Check bounds
                if (newX < 0 || newX >= board.width || newY < 0 || newY >= board.height) {
                    continue;
                }
                // Skip if position is occupied or hazardous
                if (this.isPositionOccupied(newPos, board.snakes) || this.isPositionHazard(newPos, board.hazards)) {
                    continue;
                }
                // Skip if already visited
                if (visited.has(key)) {
                    continue;
                }
                const newDistance = current.distance + 1;
                const existingInfo = distanceMap.get(key);
                // If unvisited or this is a shorter path, update
                if (!existingInfo || newDistance < existingInfo.distance) {
                    distanceMap.set(key, { distance: newDistance, closestSnake: current.snake });
                    queue.push({ x: newX, y: newY, distance: newDistance, snake: current.snake });
                    visited.add(key);
                }
                else if (existingInfo && newDistance === existingInfo.distance) {
                    // Tie-breaking: prefer our snake, then by snake ID for consistency
                    if (this.shouldPreferSnake(current.snake, existingInfo.closestSnake)) {
                        distanceMap.set(key, { distance: newDistance, closestSnake: current.snake });
                    }
                }
            }
        }
        return distanceMap;
    }
    shouldPreferSnake(newSnake, currentSnake) {
        if (!currentSnake)
            return true;
        // Prefer snakes with higher health in tie-breaking
        if (newSnake.health !== currentSnake.health) {
            return newSnake.health > currentSnake.health;
        }
        // Prefer snakes with longer length
        if (newSnake.length !== currentSnake.length) {
            return newSnake.length > currentSnake.length;
        }
        // Finally, use consistent string comparison for deterministic results
        return newSnake.id < currentSnake.id;
    }
}
exports.VoronoiStrategy = VoronoiStrategy;
//# sourceMappingURL=voronoi-strategy.js.map