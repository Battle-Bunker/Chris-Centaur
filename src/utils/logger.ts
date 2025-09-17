import * as fs from 'fs';
import * as path from 'path';
import { GameState, Direction, Coord } from '../types/battlesnake';

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

  startGame(gameState: GameState): void {
    this.gameId = gameState.game.id;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.currentLogFile = path.join(this.logDir, `game_${this.gameId}_${timestamp}.log`);
    
    this.log('=== GAME START ===');
    this.log(`Game ID: ${gameState.game.id}`);
    this.log(`Board: ${gameState.board.width}x${gameState.board.height}`);
    this.log(`Snake ID: ${gameState.you.id}`);
    this.log(`Starting position: (${gameState.you.head.x}, ${gameState.you.head.y})`);
    this.log(`Total snakes: ${gameState.board.snakes.length}`);
  }

  logMove(gameState: GameState, safeMoves: Direction[], chosenMove: Direction, scores: Map<Direction, number>): void {
    this.log(`\n=== TURN ${gameState.turn} ===`);
    this.log(`Current position: (${gameState.you.head.x}, ${gameState.you.head.y})`);
    this.log(`Health: ${gameState.you.health}`);
    this.log(`Safe moves: ${safeMoves.join(', ')}`);
    
    // Log calculated positions for each move
    const moves: Direction[] = ['up', 'down', 'left', 'right'];
    moves.forEach(move => {
      const newPos = this.getNewPosition(gameState.you.head, move);
      const isSafe = safeMoves.includes(move);
      this.log(`  ${move}: (${newPos.x}, ${newPos.y}) - ${isSafe ? 'SAFE' : 'UNSAFE'}`);
    });
    
    // Log scores
    if (scores.size > 0) {
      this.log('Move scores:');
      scores.forEach((score, move) => {
        this.log(`  ${move}: ${score.toFixed(2)}`);
      });
    }
    
    this.log(`CHOSEN MOVE: ${chosenMove}`);
    const finalPos = this.getNewPosition(gameState.you.head, chosenMove);
    this.log(`Next position will be: (${finalPos.x}, ${finalPos.y})`);
    
    // Verify boundary safety
    if (finalPos.x < 0 || finalPos.x >= gameState.board.width || 
        finalPos.y < 0 || finalPos.y >= gameState.board.height) {
      this.log('⚠️ WARNING: CHOSEN MOVE WILL GO OUT OF BOUNDS!');
      this.log(`Board boundaries: x=[0, ${gameState.board.width-1}], y=[0, ${gameState.board.height-1}]`);
    }
  }

  logError(message: string, error: any): void {
    this.log(`ERROR: ${message}`);
    if (error) {
      this.log(`Details: ${error.toString()}`);
      if (error.stack) {
        this.log(`Stack trace: ${error.stack}`);
      }
    }
  }

  endGame(gameState: GameState): void {
    this.log('\n=== GAME END ===');
    this.log(`Final turn: ${gameState.turn}`);
    this.log(`Surviving snakes: ${gameState.board.snakes.length}`);
    this.gameId = null;
    this.currentLogFile = null;
  }

  private getNewPosition(head: Coord, direction: Direction): Coord {
    switch (direction) {
      case 'up': return { x: head.x, y: head.y - 1 };
      case 'down': return { x: head.x, y: head.y + 1 };
      case 'left': return { x: head.x - 1, y: head.y };
      case 'right': return { x: head.x + 1, y: head.y };
    }
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