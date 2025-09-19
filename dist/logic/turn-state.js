"use strict";
/**
 * Turn state management for tracking information between turns.
 * Specifically tracks which snakes ate food last turn for tail safety detection.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TurnStateManager = void 0;
class TurnStateManager {
    constructor() {
        this.states = new Map();
    }
    static getInstance() {
        if (!TurnStateManager.instance) {
            TurnStateManager.instance = new TurnStateManager();
        }
        return TurnStateManager.instance;
    }
    /**
     * Update state based on current game state.
     * Detects which snakes ate food by comparing lengths.
     */
    updateState(gameId, turn, snakes) {
        const previousState = this.states.get(gameId);
        const snakesAteFood = new Set();
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
        const currentLengths = new Map();
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
    getSnakesAteLastTurn(gameId) {
        const state = this.states.get(gameId);
        return state?.snakesAteFood || new Set();
    }
    /**
     * Clear all stored state.
     */
    clear() {
        this.states.clear();
    }
}
exports.TurnStateManager = TurnStateManager;
