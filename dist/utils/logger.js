"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameLogger = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class GameLogger {
    constructor() {
        this.logDir = 'game-logs';
        this.currentLogFile = null;
        this.gameId = null;
        // Create log directory if it doesn't exist
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }
    startGame(gameState) {
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
    logMove(gameState, safeMoves, chosenMove, scores) {
        this.log(`\n=== TURN ${gameState.turn} ===`);
        this.log(`Current position: (${gameState.you.head.x}, ${gameState.you.head.y})`);
        this.log(`Health: ${gameState.you.health}`);
        this.log(`Safe moves: ${safeMoves.join(', ')}`);
        // Log calculated positions for each move
        const moves = ['up', 'down', 'left', 'right'];
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
            this.log(`Board boundaries: x=[0, ${gameState.board.width - 1}], y=[0, ${gameState.board.height - 1}]`);
        }
    }
    logError(message, error) {
        this.log(`ERROR: ${message}`);
        if (error) {
            this.log(`Details: ${error.toString()}`);
            if (error.stack) {
                this.log(`Stack trace: ${error.stack}`);
            }
        }
    }
    endGame(gameState) {
        this.log('\n=== GAME END ===');
        this.log(`Final turn: ${gameState.turn}`);
        this.log(`Surviving snakes: ${gameState.board.snakes.length}`);
        this.gameId = null;
        this.currentLogFile = null;
    }
    getNewPosition(head, direction) {
        // FIXED: Battlesnake coordinate system has y=0 at BOTTOM
        switch (direction) {
            case 'up': return { x: head.x, y: head.y + 1 }; // up increases y
            case 'down': return { x: head.x, y: head.y - 1 }; // down decreases y
            case 'left': return { x: head.x - 1, y: head.y };
            case 'right': return { x: head.x + 1, y: head.y };
        }
    }
    log(message) {
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
exports.GameLogger = GameLogger;
