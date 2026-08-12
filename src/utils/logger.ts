import * as fs from 'fs';
import * as path from 'path';
import { BoardSnapshot } from '../types/battlesnake';

export class GameLogger {
  private logDir = 'game-logs';
  private currentLogFile: string | null = null;
  private gameId: string | null = null;

  constructor() {
    // Create log directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  // Takes the canonical (you-less) board state: one game has one log, not one
  // per controlled snake.
  startGame(gameState: BoardSnapshot, controlledSnakeIds: string[] = []): void {
    this.gameId = gameState.game.id;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(this.logDir, `game_${this.gameId}_${timestamp}.log`);

    this.log('=== GAME START ===');
    this.log(`Game ID: ${gameState.game.id}`);
    this.log(`Board: ${gameState.board.width}x${gameState.board.height}`);
    if (controlledSnakeIds.length > 0) {
      this.log(`Controlled snakes: ${controlledSnakeIds.join(', ')}`);
    }
    this.log(`Total snakes: ${gameState.board.snakes.length}`);
  }

  endGame(gameState: BoardSnapshot): void {
    this.log('\n=== GAME END ===');
    this.log(`Final turn: ${gameState.turn}`);
    this.log(`Surviving snakes: ${gameState.board?.snakes?.length ?? 'unknown'}`);
    this.gameId = null;
    this.currentLogFile = null;
  }

  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    // Log to console
    console.log(message);
    
    // Log to file
    if (this.currentLogFile) {
      fs.appendFileSync(this.currentLogFile, logMessage);
    }
  }
}