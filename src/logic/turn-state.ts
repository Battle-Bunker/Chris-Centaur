/**
 * Turn state management for tracking information between turns.
 * Specifically tracks which snakes ate food last turn for tail safety detection.
 */

interface TurnStateData {
  gameId: string;
  turn: number;
  snakesAteFood: Set<string>; // Snake IDs that ate food this turn
  snakeLengths: Map<string, number>; // Snake ID to length
}

export class TurnStateManager {
  private static instance: TurnStateManager;
  private states: Map<string, TurnStateData> = new Map();
  
  private constructor() {}
  
  public static getInstance(): TurnStateManager {
    if (!TurnStateManager.instance) {
      TurnStateManager.instance = new TurnStateManager();
    }
    return TurnStateManager.instance;
  }
  
  /**
   * Update state based on current game state.
   * Detects which snakes ate food by comparing lengths.
   */
  public updateState(gameId: string, turn: number, snakes: Array<{id: string; length: number}>): Set<string> {
    const previousState = this.states.get(gameId);
    const snakesAteFood = new Set<string>();
    
    if (previousState && previousState.turn === turn - 1) {
      // Compare lengths to detect who ate food
      for (const snake of snakes) {
        const prevLength = previousState.snakeLengths.get(snake.id);
        if (prevLength !== undefined && snake.length > prevLength) {
          snakesAteFood.add(snake.id);
        }
      }
    }
    
    // Store current state for next turn
    const currentLengths = new Map<string, number>();
    for (const snake of snakes) {
      currentLengths.set(snake.id, snake.length);
    }
    
    this.states.set(gameId, {
      gameId,
      turn,
      snakesAteFood,
      snakeLengths: currentLengths
    });
    
    // Clean up old games (keep only last 10)
    if (this.states.size > 10) {
      const oldestKey = this.states.keys().next().value;
      if (oldestKey !== undefined) {
        this.states.delete(oldestKey);
      }
    }
    
    return snakesAteFood;
  }
  
  /**
   * Get snakes that ate food in the previous turn.
   */
  public getSnakesAteLastTurn(gameId: string): Set<string> {
    const state = this.states.get(gameId);
    return state?.snakesAteFood || new Set();
  }
  
  /**
   * Clear all stored state.
   */
  public clear(): void {
    this.states.clear();
  }
}