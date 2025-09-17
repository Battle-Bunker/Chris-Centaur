import { GameState, Direction, Coord, Snake, Board, TeamInfo, VoronoiResult, SimulationConfig } from '../types/battlesnake';

export class VoronoiStrategy {
  private config: SimulationConfig = {
    maxDistance: 3,
    numRandomMoves: 10,
    maxSimulations: 100,
    maxEvaluationTimeMs: 400  // Leave buffer before 500ms timeout
  };

  setConfig(config: Partial<SimulationConfig>) {
    this.config = { ...this.config, ...config };
  }

  getBestMove(gameState: GameState, ourTeam?: TeamInfo): Direction {
    const result = this.getBestMoveWithDebug(gameState, ourTeam);
    return result.move;
  }

  getBestMoveWithDebug(gameState: GameState, ourTeam?: TeamInfo): { move: Direction; safeMoves: Direction[]; scores: Map<Direction, number> } {
    const startTime = Date.now();
    const possibleMoves = this.getSafeMoves(gameState);
    const scores = new Map<Direction, number>();
    const moveDetails = new Map<Direction, { fertileScore: number; eatsFood: boolean; foodDistance: number }>();
    
    if (possibleMoves.length === 0) {
      console.warn('No safe moves found! Defaulting to up');
      return { move: 'up', safeMoves: [], scores }; // Fallback if no safe moves
    }
    
    if (possibleMoves.length === 1) {
      scores.set(possibleMoves[0], 1);
      return { move: possibleMoves[0], safeMoves: possibleMoves, scores };
    }

    // Evaluate each possible move using Fertile Voronoi territory simulation
    let bestFertileScore = -Infinity;

    for (const move of possibleMoves) {
      // Check if we're running out of time
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime > this.config.maxEvaluationTimeMs) {
        console.log(`Time limit reached after ${elapsedTime}ms, using best move found so far`);
        break;
      }

      const remainingTime = this.config.maxEvaluationTimeMs - elapsedTime;
      const details = this.evaluateMoveWithFood(gameState, move, ourTeam, remainingTime);
      scores.set(move, details.fertileScore);
      moveDetails.set(move, details);
      
      if (details.fertileScore > bestFertileScore) {
        bestFertileScore = details.fertileScore;
      }
    }

    // Find all moves within 20% of the best fertile score
    const threshold = bestFertileScore * 0.8; // Within 20% means at least 80% of best
    const candidateMoves: Direction[] = [];
    
    for (const [move, details] of moveDetails) {
      if (details.fertileScore >= threshold) {
        candidateMoves.push(move);
        console.log(`Candidate move ${move}: fertile score=${details.fertileScore.toFixed(2)}, eats food=${details.eatsFood}, food distance=${details.foodDistance}`);
      }
    }

    // Select best move from candidates based on food criteria
    let bestMove = candidateMoves[0];
    if (candidateMoves.length > 1) {
      // First priority: moves that eat food
      const foodEatingMoves = candidateMoves.filter(m => moveDetails.get(m)!.eatsFood);
      
      if (foodEatingMoves.length > 0) {
        // Among food-eating moves, prefer highest fertile score
        bestMove = foodEatingMoves.reduce((a, b) => 
          moveDetails.get(a)!.fertileScore > moveDetails.get(b)!.fertileScore ? a : b
        );
        console.log(`Choosing ${bestMove} because it eats food`);
      } else {
        // Second priority: moves that minimize distance to nearest food
        bestMove = candidateMoves.reduce((a, b) => {
          const detailsA = moveDetails.get(a)!;
          const detailsB = moveDetails.get(b)!;
          
          // Lower food distance is better
          if (detailsA.foodDistance !== detailsB.foodDistance) {
            return detailsA.foodDistance < detailsB.foodDistance ? a : b;
          }
          
          // If equal distance, prefer higher fertile score
          return detailsA.fertileScore > detailsB.fertileScore ? a : b;
        });
        console.log(`Choosing ${bestMove} with food distance ${moveDetails.get(bestMove)!.foodDistance}`);
      }
    } else {
      console.log(`Only one candidate move within threshold: ${bestMove}`);
    }

    return { move: bestMove, safeMoves: possibleMoves, scores };
  }

  private getSafeMoves(gameState: GameState): Direction[] {
    const head = gameState.you.head;
    const allMoves: Direction[] = ['up', 'down', 'left', 'right'];
    const safeMoves: Direction[] = [];

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

  private getNewHeadPosition(head: Coord, direction: Direction): Coord {
    // CRITICAL FIX: Battlesnake coordinate system has y=0 at BOTTOM
    // 'up' increases y (moves away from bottom)
    // 'down' decreases y (moves toward bottom)
    switch (direction) {
      case 'up': return { x: head.x, y: head.y + 1 };  // FIXED: up increases y
      case 'down': return { x: head.x, y: head.y - 1 };  // FIXED: down decreases y
      case 'left': return { x: head.x - 1, y: head.y };
      case 'right': return { x: head.x + 1, y: head.y };
    }
  }

  private evaluateMoveRisk(position: Coord, move: Direction, gameState: GameState): { isSafe: boolean; riskScore: number; hasHazard: boolean } {
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
        const snakeCouldEatFood = board.food.some(food => 
          this.manhattanDistance(snake.head, food) <= 1
        );
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

  private evaluateHeadToHeadRisk(position: Coord, gameState: GameState): { isSafe: boolean; riskScore: number } {
    let riskScore = 0;
    
    for (const enemySnake of gameState.board.snakes) {
      if (enemySnake.id === gameState.you.id) continue;
      
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
        } else if (gameState.you.length === enemySnake.length) {
          // Both die - very dangerous
          return { isSafe: false, riskScore: 900 };
        } else {
          // We lose head-to-head - deadly
          return { isSafe: false, riskScore: 950 };
        }
      }
    }
    
    return { isSafe: true, riskScore };
  }

  private isSafePosition(position: Coord, gameState: GameState): boolean {
    const moveRisk = this.evaluateMoveRisk(position, 'up', gameState); // Direction doesn't matter for basic safety
    return moveRisk.isSafe;
  }

  private evaluateMoveWithFood(gameState: GameState, move: Direction, ourTeam?: TeamInfo, remainingTimeMs?: number): { fertileScore: number; eatsFood: boolean; foodDistance: number } {
    // Check if this move eats food
    const newHead = this.getNewHeadPosition(gameState.you.head, move);
    const eatsFood = gameState.board.food.some(food => 
      food.x === newHead.x && food.y === newHead.y
    );
    
    // Get path-based food distance from BFS calculation
    // First, we need to get the food distance map for the current board state
    const { foodDistanceMap } = this.calculateEnhancedDistanceMapBFS(gameState.board);
    const newHeadKey = `${newHead.x},${newHead.y}`;
    
    // Get the actual path distance to nearest food from the new head position
    let nearestFoodDistance = foodDistanceMap.get(newHeadKey) || Number.MAX_VALUE;
    
    // If no food on board or unreachable, use a default high distance
    if (gameState.board.food.length === 0 || nearestFoodDistance === Number.MAX_VALUE) {
      nearestFoodDistance = 100;
    }
    
    // Calculate average fertile score from simulations
    let totalFertileScore = 0;
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
      const voronoiResult = this.calculateFertileVoronoiTerritories(simulatedState, ourTeam);
      
      if (ourTeam) {
        const teamKey = this.getTeamKey(gameState.you);
        totalFertileScore += voronoiResult.teamFertileScores?.get(teamKey) || 0;
      } else {
        totalFertileScore += voronoiResult.fertileScores?.get(gameState.you.id) || 0;
      }
      
      actualSimulations++;
    }

    const avgFertileScore = actualSimulations > 0 ? totalFertileScore / actualSimulations : 0;
    
    return {
      fertileScore: avgFertileScore,
      eatsFood: eatsFood,
      foodDistance: nearestFoodDistance  // Use the actual nearest food distance from new head
    };
  }

  private evaluateMove(gameState: GameState, move: Direction, ourTeam?: TeamInfo, remainingTimeMs?: number): number {
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
      } else {
        totalScore += voronoiResult.territories.get(gameState.you.id) || 0;
      }
      
      actualSimulations++;
    }

    return actualSimulations > 0 ? totalScore / actualSimulations : 0;
  }

  private simulateGameState(gameState: GameState, ourMove: Direction): GameState {
    // Create an efficient deep copy of the game state
    const simulated = this.cloneGameState(gameState);
    
    // Move our snake
    const newHead = this.getNewHeadPosition(simulated.you.head, ourMove);
    simulated.you.body = [newHead, ...simulated.you.body];
    simulated.you.head = newHead;
    
    // Remove tail unless food was eaten
    const ateFood = simulated.board.food.some(food => 
      food.x === newHead.x && food.y === newHead.y
    );
    if (!ateFood) {
      simulated.you.body.pop();
    } else {
      // Remove eaten food efficiently
      simulated.board.food = simulated.board.food.filter(food =>
        !(food.x === newHead.x && food.y === newHead.y)
      );
      simulated.you.length++;
    }

    // Simulate other snakes with random moves within distance
    for (const snake of simulated.board.snakes) {
      if (snake.id === simulated.you.id) continue;
      
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

  private cloneGameState(gameState: GameState): GameState {
    // Efficient manual cloning instead of JSON.parse(JSON.stringify())
    const clonedSnakes: Snake[] = gameState.board.snakes.map(snake => ({
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

    const ourSnakeClone = clonedSnakes.find(s => s.id === gameState.you.id)!;

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

  private moveSnakeEfficient(snake: Snake, direction: Direction, gameState: GameState): void {
    const newHead = this.getNewHeadPosition(snake.head, direction);
    snake.body.unshift(newHead);
    snake.head = newHead;
    
    // Check if food was eaten
    const ateFood = gameState.board.food.some(food => 
      food.x === newHead.x && food.y === newHead.y
    );
    
    if (!ateFood) {
      snake.body.pop();
    } else {
      snake.length++;
      // Remove eaten food from board
      gameState.board.food = gameState.board.food.filter(food =>
        !(food.x === newHead.x && food.y === newHead.y)
      );
    }
  }

  private getSafeMovesForSnake(snake: Snake, gameState: GameState): Direction[] {
    const head = snake.head;
    const allMoves: Direction[] = ['up', 'down', 'left', 'right'];
    const safeMoves: Direction[] = [];

    for (const move of allMoves) {
      const newHead = this.getNewHeadPosition(head, move);
      if (this.isSafePosition(newHead, gameState)) {
        safeMoves.push(move);
      }
    }

    return safeMoves;
  }

  private moveSnake(snake: Snake, direction: Direction, gameState: GameState): void {
    const newHead = this.getNewHeadPosition(snake.head, direction);
    snake.body.unshift(newHead);
    snake.head = newHead;
    
    // Check if food was eaten
    const ateFood = gameState.board.food.some(food => 
      food.x === newHead.x && food.y === newHead.y
    );
    
    if (!ateFood) {
      snake.body.pop();
    }
  }

  private manhattanDistance(a: Coord, b: Coord): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  private calculateFertileVoronoiTerritories(gameState: GameState, ourTeam?: TeamInfo): VoronoiResult {
    const { board } = gameState;
    const territories = new Map<string, number>();
    const teamTerritories = new Map<string, number>();
    const foodControlled = new Map<string, number>();
    const teamFoodControlled = new Map<string, number>();
    const fertileScores = new Map<string, number>();
    const teamFertileScores = new Map<string, number>();
    const foodDistances = new Map<string, number>();
    const teamFoodDistances = new Map<string, number>();
    
    // Initialize counts
    for (const snake of board.snakes) {
      territories.set(snake.id, 0);
      foodControlled.set(snake.id, 0);
      fertileScores.set(snake.id, 0);
      foodDistances.set(snake.id, 0);
      const teamKey = this.getTeamKey(snake);
      if (!teamTerritories.has(teamKey)) {
        teamTerritories.set(teamKey, 0);
        teamFoodControlled.set(teamKey, 0);
        teamFertileScores.set(teamKey, 0);
        teamFoodDistances.set(teamKey, 0);
      }
    }

    // Use enhanced BFS to calculate territories and food distances
    const { distanceMap, foodDistanceMap } = this.calculateEnhancedDistanceMapBFS(board);
    
    // Sanity check: Ensure distanceMap has data
    if (distanceMap.size === 0) {
      console.warn('Warning: DistanceMap is empty, BFS may have failed to seed properly');
      // Return minimal territories for all snakes to avoid complete failure
      for (const snake of board.snakes) {
        territories.set(snake.id, 1);
        fertileScores.set(snake.id, 1);
        const teamKey = this.getTeamKey(snake);
        teamTerritories.set(teamKey, (teamTerritories.get(teamKey) || 0) + 1);
        teamFertileScores.set(teamKey, (teamFertileScores.get(teamKey) || 0) + 1);
      }
      return { territories, teamTerritories, fertileScores, teamFertileScores, foodControlled, teamFoodControlled, foodDistances, teamFoodDistances };
    }

    // Count territories and food control
    let totalCellsAssigned = 0;
    let unassignedCells = 0;
    const snakeFoodDistanceSum = new Map<string, number>();
    const snakeFoodDistanceCount = new Map<string, number>();
    
    // First pass: count territories and check food control
    for (let x = 0; x < board.width; x++) {
      for (let y = 0; y < board.height; y++) {
        const key = `${x},${y}`;
        const cellInfo = distanceMap.get(key);
        
        if (cellInfo && cellInfo.closestSnake) {
          const snakeId = cellInfo.closestSnake.id;
          const teamKey = this.getTeamKey(cellInfo.closestSnake);
          
          // Count territory
          territories.set(snakeId, (territories.get(snakeId) || 0) + 1);
          teamTerritories.set(teamKey, (teamTerritories.get(teamKey) || 0) + 1);
          
          // Track food distance for this cell
          const foodDist = foodDistanceMap.get(key) || 100;
          snakeFoodDistanceSum.set(snakeId, (snakeFoodDistanceSum.get(snakeId) || 0) + foodDist);
          snakeFoodDistanceCount.set(snakeId, (snakeFoodDistanceCount.get(snakeId) || 0) + 1);
          
          // Check if this cell contains food
          const isFood = board.food.some(food => food.x === x && food.y === y);
          if (isFood) {
            foodControlled.set(snakeId, (foodControlled.get(snakeId) || 0) + 1);
            teamFoodControlled.set(teamKey, (teamFoodControlled.get(teamKey) || 0) + 1);
          }
          
          totalCellsAssigned++;
        } else {
          unassignedCells++;
        }
      }
    }
    
    // Calculate average food distances
    for (const [snakeId, sum] of snakeFoodDistanceSum) {
      const count = snakeFoodDistanceCount.get(snakeId) || 1;
      foodDistances.set(snakeId, sum / count);
    }
    
    // Aggregate team food distances
    for (const snake of board.snakes) {
      const snakeId = snake.id;
      const teamKey = this.getTeamKey(snake);
      const snakeDist = foodDistances.get(snakeId) || 100;
      const currentTeamDist = teamFoodDistances.get(teamKey) || 0;
      const teamSnakeCount = board.snakes.filter(s => this.getTeamKey(s) === teamKey).length;
      
      // Average the food distances for team snakes
      teamFoodDistances.set(teamKey, currentTeamDist + (snakeDist / teamSnakeCount));
    }
    
    // Calculate fertile scores (territory + food bonus)
    const FOOD_BONUS_MULTIPLIER = 10; // Each food adds 10 to the territory value
    
    for (const snake of board.snakes) {
      const snakeId = snake.id;
      const teamKey = this.getTeamKey(snake);
      
      const territory = territories.get(snakeId) || 0;
      const food = foodControlled.get(snakeId) || 0;
      const fertileScore = territory + (food * FOOD_BONUS_MULTIPLIER);
      
      fertileScores.set(snakeId, fertileScore);
      teamFertileScores.set(teamKey, (teamFertileScores.get(teamKey) || 0) + fertileScore);
    }
    
    // Log summary for debugging
    if (totalCellsAssigned > 0) {
      console.log(`Fertile Voronoi: ${totalCellsAssigned} cells assigned, ${unassignedCells} unassigned`);
      for (const [snakeId, score] of fertileScores) {
        const territory = territories.get(snakeId) || 0;
        const food = foodControlled.get(snakeId) || 0;
        const foodDist = foodDistances.get(snakeId) || 0;
        console.log(`Snake ${snakeId}: territory=${territory}, food=${food}, fertile=${score.toFixed(0)}, avgFoodDist=${foodDist.toFixed(1)}`);
      }
    }

    return { territories, teamTerritories, fertileScores, teamFertileScores, foodControlled, teamFoodControlled, foodDistances, teamFoodDistances };
  }

  private calculateVoronoiTerritories(gameState: GameState, ourTeam?: TeamInfo): VoronoiResult {
    const { board } = gameState;
    const territories = new Map<string, number>();
    const teamTerritories = new Map<string, number>();
    
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
    
    // Sanity check: Ensure distanceMap has data
    if (distanceMap.size === 0) {
      console.warn('Warning: DistanceMap is empty, BFS may have failed to seed properly');
      // Return minimal territories for all snakes to avoid complete failure
      for (const snake of board.snakes) {
        territories.set(snake.id, 1);
        const teamKey = this.getTeamKey(snake);
        teamTerritories.set(teamKey, (teamTerritories.get(teamKey) || 0) + 1);
      }
      return { territories, teamTerritories };
    }

    // Count territories based on closest snake
    let totalCellsAssigned = 0;
    let unassignedCells = 0;
    
    for (let x = 0; x < board.width; x++) {
      for (let y = 0; y < board.height; y++) {
        const key = `${x},${y}`;
        const cellInfo = distanceMap.get(key);
        
        if (cellInfo && cellInfo.closestSnake) {
          territories.set(cellInfo.closestSnake.id, (territories.get(cellInfo.closestSnake.id) || 0) + 1);
          
          const teamKey = this.getTeamKey(cellInfo.closestSnake);
          teamTerritories.set(teamKey, (teamTerritories.get(teamKey) || 0) + 1);
          totalCellsAssigned++;
        } else {
          unassignedCells++;
        }
      }
    }

    // Sanity checks
    const totalBoardCells = board.width * board.height;
    const calculatedTotal = totalCellsAssigned + unassignedCells;
    
    if (calculatedTotal !== totalBoardCells) {
      console.warn(`Territory calculation error: calculated ${calculatedTotal} cells, expected ${totalBoardCells}`);
    }
    
    if (totalCellsAssigned === 0) {
      console.warn('Warning: No territories assigned to any snakes! Voronoi calculation may have failed');
    }
    
    // Validate all territory counts are non-negative
    for (const [snakeId, territory] of territories) {
      if (territory < 0) {
        console.warn(`Invalid territory count for snake ${snakeId}: ${territory}`);
        territories.set(snakeId, 0);
      }
    }
    
    // Log territory summary for debugging
    if (totalCellsAssigned > 0) {
      console.log(`Voronoi territories: ${totalCellsAssigned} cells assigned, ${unassignedCells} unassigned (${board.snakes.length} snakes)`);
    }

    return { territories, teamTerritories };
  }

  private isPositionOccupied(position: Coord, snakes: Snake[]): boolean {
    for (const snake of snakes) {
      for (const bodyPart of snake.body) {
        if (position.x === bodyPart.x && position.y === bodyPart.y) {
          return true;
        }
      }
    }
    return false;
  }

  private isPositionOccupiedByOtherSnakes(position: Coord, snakes: Snake[], excludeSnake: Snake): boolean {
    for (const snake of snakes) {
      if (snake.id === excludeSnake.id) continue; // Skip the excluded snake
      for (const bodyPart of snake.body) {
        if (position.x === bodyPart.x && position.y === bodyPart.y) {
          return true;
        }
      }
    }
    return false;
  }

  private isPositionHazard(position: Coord, hazards: Coord[]): boolean {
    return hazards.some(hazard => 
      position.x === hazard.x && position.y === hazard.y
    );
  }

  private getTeamKey(snake: Snake): string {
    // Use squad field for team detection, fallback to color
    return snake.squad || snake.customizations.color;
  }

  private calculateEnhancedDistanceMapBFS(board: Board): {
    distanceMap: Map<string, { distance: number; closestSnake: Snake | null }>;
    foodDistanceMap: Map<string, number>;
  } {
    const distanceMap = new Map<string, { distance: number; closestSnake: Snake | null }>();
    const foodDistanceMap = new Map<string, number>();
    const queue: Array<{ x: number; y: number; distance: number; snake: Snake; nearestFoodDist: number }> = [];
    const visited = new Set<string>();
    
    // Pre-calculate which cells contain food for quick lookup
    const foodPositions = new Set<string>();
    for (const food of board.food) {
      foodPositions.add(`${food.x},${food.y}`);
    }
    
    // Initialize BFS from all snake heads for territory calculation
    for (const snake of board.snakes) {
      const head = snake.head;
      const key = `${head.x},${head.y}`;
      
      if (!this.isPositionHazard(head, board.hazards)) {
        // Check if head is on food
        const nearestFoodDist = foodPositions.has(key) ? 0 : Number.MAX_VALUE;
        
        queue.push({ x: head.x, y: head.y, distance: 0, snake, nearestFoodDist });
        distanceMap.set(key, { distance: 0, closestSnake: snake });
        foodDistanceMap.set(key, nearestFoodDist);
        visited.add(key);
      }
    }
    
    const directions = [
      { dx: 0, dy: 1 },  // up
      { dx: 0, dy: -1 }, // down
      { dx: 1, dy: 0 },  // right
      { dx: -1, dy: 0 }  // left
    ];
    
    // Multi-source BFS for territory calculation and food distance tracking
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
        
        // Skip if position is occupied by snake bodies
        if (this.isPositionOccupied(newPos, board.snakes)) {
          continue;
        }
        
        // Skip if already visited
        if (visited.has(key)) {
          continue;
        }
        
        // Calculate distance with hazard penalty
        const isHazardous = this.isPositionHazard(newPos, board.hazards);
        const hazardPenalty = isHazardous ? 2 : 0;
        const newDistance = current.distance + 1 + hazardPenalty;
        
        // Calculate nearest food distance for this new position
        let newNearestFoodDist = current.nearestFoodDist;
        if (foodPositions.has(key)) {
          // This cell contains food - path distance is the distance we traveled to get here
          newNearestFoodDist = newDistance;
        } else if (current.nearestFoodDist !== Number.MAX_VALUE) {
          // We've seen food before, increment the distance
          newNearestFoodDist = current.nearestFoodDist + 1 + hazardPenalty;
        }
        
        const existingInfo = distanceMap.get(key);
        
        // If unvisited or this is a shorter path, update
        if (!existingInfo || newDistance < existingInfo.distance) {
          distanceMap.set(key, { distance: newDistance, closestSnake: current.snake });
          foodDistanceMap.set(key, newNearestFoodDist);
          queue.push({ x: newX, y: newY, distance: newDistance, snake: current.snake, nearestFoodDist: newNearestFoodDist });
          visited.add(key);
        } else if (existingInfo && newDistance === existingInfo.distance) {
          // Tie-breaking: prefer our snake, then by snake ID for consistency
          if (this.shouldPreferSnake(current.snake, existingInfo.closestSnake)) {
            distanceMap.set(key, { distance: newDistance, closestSnake: current.snake });
            // Also update food distance if this path is better
            const currentFoodDist = foodDistanceMap.get(key);
            if (!currentFoodDist || newNearestFoodDist < currentFoodDist) {
              foodDistanceMap.set(key, newNearestFoodDist);
            }
          }
        }
      }
    }
    
    // Now do a reverse BFS from food to fill in any cells we might have missed
    // This ensures every reachable cell has a food distance
    const foodQueue: Array<{ x: number; y: number; distance: number }> = [];
    const foodVisited = new Set<string>();
    
    // Initialize from all food positions
    for (const food of board.food) {
      const key = `${food.x},${food.y}`;
      foodQueue.push({ x: food.x, y: food.y, distance: 0 });
      foodVisited.add(key);
      // Update the food distance map for food cells themselves
      if (!foodDistanceMap.has(key) || foodDistanceMap.get(key)! > 0) {
        foodDistanceMap.set(key, 0);
      }
    }
    
    // BFS from food to calculate distances to all reachable cells
    let foodQueueIndex = 0;
    while (foodQueueIndex < foodQueue.length) {
      const current = foodQueue[foodQueueIndex++];
      
      for (const dir of directions) {
        const newX = current.x + dir.dx;
        const newY = current.y + dir.dy;
        const key = `${newX},${newY}`;
        
        // Check bounds
        if (newX < 0 || newX >= board.width || newY < 0 || newY >= board.height) {
          continue;
        }
        
        // Skip if already visited for food distance
        if (foodVisited.has(key)) {
          continue;
        }
        
        // Skip if position is occupied by snake bodies (can't reach food through bodies)
        if (this.isPositionOccupied({ x: newX, y: newY }, board.snakes)) {
          continue;
        }
        
        // Calculate distance with hazard penalty
        const isHazardous = this.isPositionHazard({ x: newX, y: newY }, board.hazards);
        const hazardPenalty = isHazardous ? 2 : 0;
        const newDistance = current.distance + 1 + hazardPenalty;
        
        // Update food distance if this path is shorter or if no distance was set
        const currentDist = foodDistanceMap.get(key);
        if (!currentDist || currentDist === Number.MAX_VALUE || newDistance < currentDist) {
          foodDistanceMap.set(key, newDistance);
        }
        
        foodQueue.push({ x: newX, y: newY, distance: newDistance });
        foodVisited.add(key);
      }
    }
    
    return { distanceMap, foodDistanceMap };
  }

  private calculateDistanceMapBFS(board: Board): Map<string, { distance: number; closestSnake: Snake | null }> {
    const distanceMap = new Map<string, { distance: number; closestSnake: Snake | null }>();
    const queue: Array<{ x: number; y: number; distance: number; snake: Snake }> = [];
    const visited = new Set<string>();
    
    // Initialize BFS from all snake heads simultaneously
    for (const snake of board.snakes) {
      const head = snake.head;
      const key = `${head.x},${head.y}`;
      
      // Always seed snake heads, but check for hazards
      // Snake heads can be on their own body, but we still want to start territory calculation from them
      if (!this.isPositionHazard(head, board.hazards)) {
        queue.push({ x: head.x, y: head.y, distance: 0, snake });
        distanceMap.set(key, { distance: 0, closestSnake: snake });
        visited.add(key);
      }
    }
    
    const directions = [
      { dx: 0, dy: 1 },  // down
      { dx: 0, dy: -1 }, // up
      { dx: 1, dy: 0 },  // right
      { dx: -1, dy: 0 }  // left
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
        
        // Skip if position is occupied by snake bodies
        if (this.isPositionOccupied(newPos, board.snakes)) {
          continue;
        }
        
        // Skip if already visited
        if (visited.has(key)) {
          continue;
        }
        
        // Calculate distance with hazard penalty
        const isHazardous = this.isPositionHazard(newPos, board.hazards);
        const hazardPenalty = isHazardous ? 2 : 0; // Hazards cost 3 instead of 1 (1 + 2 penalty)
        const newDistance = current.distance + 1 + hazardPenalty;
        const existingInfo = distanceMap.get(key);
        
        // If unvisited or this is a shorter path, update
        if (!existingInfo || newDistance < existingInfo.distance) {
          distanceMap.set(key, { distance: newDistance, closestSnake: current.snake });
          queue.push({ x: newX, y: newY, distance: newDistance, snake: current.snake });
          visited.add(key);
        } else if (existingInfo && newDistance === existingInfo.distance) {
          // Tie-breaking: prefer our snake, then by snake ID for consistency
          if (this.shouldPreferSnake(current.snake, existingInfo.closestSnake)) {
            distanceMap.set(key, { distance: newDistance, closestSnake: current.snake });
          }
        }
      }
    }
    
    return distanceMap;
  }

  private shouldPreferSnake(newSnake: Snake, currentSnake: Snake | null): boolean {
    if (!currentSnake) return true;
    
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