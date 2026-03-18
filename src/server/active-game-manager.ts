import { GameState, Direction } from '../types/battlesnake';
import { Response } from 'express';

export interface MoveEvaluation {
  move: Direction;
  score: number;
  numStates: number;
  breakdown: any;
  projectedTerritoryCells?: { [snakeId: string]: { x: number; y: number }[] };
}

export interface TurnData {
  gameState: GameState;
  moveEvaluations: MoveEvaluation[];
  territoryCells: { [snakeId: string]: { x: number; y: number }[] };
  safeMoves: Direction[];
  botRecommendation: Direction | null;
  timestamp: number;
}

interface PendingMove {
  res: Response;
  timer: NodeJS.Timeout;
  turnData: TurnData | null;
  userSelectedMove: Direction | null;
  botMove: Direction | null;
  resolved: boolean;
}

interface GameSnakeEntry {
  gameId: string;
  snakeId: string;
  snakeName: string;
  snakeEmoji: string;
  overrideEnabled: boolean;
  latestGameState: GameState | null;
  latestTurnData: TurnData | null;
  pendingMove: PendingMove | null;
  gameTimeout: number;
  startedAt: number;
  lastActivityAt: number;
}

type GameSnakeKey = string;

function makeKey(gameId: string, snakeId: string): GameSnakeKey {
  return `${gameId}:${snakeId}`;
}

export type TurnUpdateCallback = (gameId: string, snakeId: string, turnData: TurnData) => void;
export type GameListChangeCallback = (event: 'added' | 'removed' | 'updated', gameId: string, snakeId: string) => void;

export class ActiveGameManager {
  private static instance: ActiveGameManager;
  private games: Map<GameSnakeKey, GameSnakeEntry> = new Map();
  private turnUpdateCallbacks: TurnUpdateCallback[] = [];
  private gameListChangeCallbacks: GameListChangeCallback[] = [];

  private constructor() {}

  static getInstance(): ActiveGameManager {
    if (!ActiveGameManager.instance) {
      ActiveGameManager.instance = new ActiveGameManager();
    }
    return ActiveGameManager.instance;
  }

  onTurnUpdate(callback: TurnUpdateCallback): void {
    this.turnUpdateCallbacks.push(callback);
  }

  onGameListChange(callback: GameListChangeCallback): void {
    this.gameListChangeCallbacks.push(callback);
  }

  private notifyGameListChange(event: 'added' | 'removed' | 'updated', gameId: string, snakeId: string): void {
    for (const cb of this.gameListChangeCallbacks) {
      try {
        cb(event, gameId, snakeId);
      } catch (e) {
        console.error('Error in game list change callback:', e);
      }
    }
  }

  private notifyTurnUpdate(gameId: string, snakeId: string, turnData: TurnData): void {
    for (const cb of this.turnUpdateCallbacks) {
      try {
        cb(gameId, snakeId, turnData);
      } catch (e) {
        console.error('Error in turn update callback:', e);
      }
    }
  }

  registerGame(gameState: GameState): void {
    const key = makeKey(gameState.game.id, gameState.you.id);
    if (!this.games.has(key)) {
      console.log(`[ActiveGameManager] Registering game: ${key} (snake: ${gameState.you.name}, turn: ${gameState.turn})`);
      const now = Date.now();
      this.games.set(key, {
        gameId: gameState.game.id,
        snakeId: gameState.you.id,
        snakeName: gameState.you.name,
        snakeEmoji: gameState.you.emoji || '',
        overrideEnabled: false,
        latestGameState: gameState,
        latestTurnData: null,
        pendingMove: null,
        gameTimeout: gameState.game.timeout || 500,
        startedAt: now,
        lastActivityAt: now
      });
      this.notifyGameListChange('added', gameState.game.id, gameState.you.id);
    }
  }

  endGame(gameId: string, snakeId: string): void {
    const key = makeKey(gameId, snakeId);
    const entry = this.games.get(key);
    if (entry) {
      console.log(`[ActiveGameManager] Ending game: ${key} (was active for ${Math.round((Date.now() - entry.startedAt) / 1000)}s)`);
      if (entry.pendingMove && !entry.pendingMove.resolved) {
        this.resolvePendingMove(key, entry.pendingMove.botMove || 'up');
      }
      this.games.delete(key);
      this.notifyGameListChange('removed', gameId, snakeId);
    } else {
      console.log(`[ActiveGameManager] endGame called for unknown game: ${key} (not in active set)`);
    }
  }

  isOverrideEnabled(gameId: string, snakeId: string): boolean {
    const entry = this.games.get(makeKey(gameId, snakeId));
    return entry?.overrideEnabled ?? false;
  }

  setOverrideEnabled(gameId: string, snakeId: string, enabled: boolean): void {
    const entry = this.games.get(makeKey(gameId, snakeId));
    if (entry) {
      entry.overrideEnabled = enabled;
    }
  }

  getActiveGames(): Array<{
    gameId: string;
    snakeId: string;
    snakeName: string;
    snakeEmoji: string;
    overrideEnabled: boolean;
    turn: number;
    gameState: GameState | null;
  }> {
    const result: Array<any> = [];
    for (const entry of this.games.values()) {
      result.push({
        gameId: entry.gameId,
        snakeId: entry.snakeId,
        snakeName: entry.snakeName,
        snakeEmoji: entry.snakeEmoji,
        overrideEnabled: entry.overrideEnabled,
        turn: entry.latestGameState?.turn ?? 0,
        gameState: entry.latestGameState
      });
    }
    return result;
  }

  getGameEntry(gameId: string, snakeId: string): GameSnakeEntry | undefined {
    return this.games.get(makeKey(gameId, snakeId));
  }

  setPendingMove(gameId: string, snakeId: string, res: Response, gameTimeout: number): PendingMove {
    const key = makeKey(gameId, snakeId);
    const entry = this.games.get(key);
    if (!entry) {
      throw new Error(`Game ${gameId}/${snakeId} not registered`);
    }

    if (entry.pendingMove && !entry.pendingMove.resolved) {
      this.resolvePendingMove(key, entry.pendingMove.botMove || 'up');
    }

    const bufferMs = 100;
    const timeoutMs = Math.max(gameTimeout - bufferMs, 50);

    const pending: PendingMove = {
      res,
      timer: setTimeout(() => {
        if (!pending.resolved) {
          const move = pending.userSelectedMove || pending.botMove || 'up';
          const source = pending.userSelectedMove ? 'user-selection' : (pending.botMove ? 'bot-recommendation' : 'fallback');
          console.log(`[ActiveGameManager] Safety timer fired for ${key}: using ${move} (source: ${source})`);
          this.resolvePendingMove(key, move);
        }
      }, timeoutMs),
      turnData: null,
      userSelectedMove: null,
      botMove: null,
      resolved: false
    };

    entry.pendingMove = pending;
    return pending;
  }

  setBotRecommendation(gameId: string, snakeId: string, move: Direction, turnData: TurnData): void {
    const key = makeKey(gameId, snakeId);
    const entry = this.games.get(key);
    if (!entry) return;

    entry.latestGameState = turnData.gameState;
    entry.latestTurnData = turnData;

    if (entry.pendingMove && !entry.pendingMove.resolved) {
      entry.pendingMove.botMove = move;
      entry.pendingMove.turnData = turnData;
    }

    this.notifyTurnUpdate(gameId, snakeId, turnData);
  }

  setUserSelection(gameId: string, snakeId: string, move: Direction): void {
    const key = makeKey(gameId, snakeId);
    const entry = this.games.get(key);
    if (entry?.pendingMove && !entry.pendingMove.resolved) {
      entry.pendingMove.userSelectedMove = move;
    }
  }

  submitUserMove(gameId: string, snakeId: string, move: Direction): boolean {
    const key = makeKey(gameId, snakeId);
    const entry = this.games.get(key);
    if (!entry?.pendingMove || entry.pendingMove.resolved) {
      console.log(`[ActiveGameManager] submitUserMove rejected for ${key}: ${!entry?.pendingMove ? 'no pending move' : 'already resolved'}`);
      return false;
    }

    console.log(`[ActiveGameManager] User submitted move for ${key}: ${move}`);
    entry.pendingMove.userSelectedMove = move;
    this.resolvePendingMove(key, move);
    return true;
  }

  updateGameState(gameId: string, snakeId: string, gameState: GameState): void {
    const key = makeKey(gameId, snakeId);
    const entry = this.games.get(key);
    if (entry) {
      entry.latestGameState = gameState;
      entry.gameTimeout = gameState.game.timeout || entry.gameTimeout;
      entry.lastActivityAt = Date.now();
      if (gameState.you) {
        entry.snakeName = gameState.you.name || entry.snakeName;
        entry.snakeEmoji = (gameState.you as any).emoji || entry.snakeEmoji;
      }
    }
  }

  private resolvePendingMove(key: GameSnakeKey, move: Direction): void {
    const entry = this.games.get(key);
    if (!entry?.pendingMove || entry.pendingMove.resolved) return;

    const pending = entry.pendingMove;
    pending.resolved = true;
    clearTimeout(pending.timer);

    try {
      pending.res.json({
        move: move,
        shout: `Centaur mode! Turn ${entry.latestGameState?.turn ?? '?'}`
      });
    } catch (e) {
      console.error('Error sending centaur move response:', e);
    }

    entry.pendingMove = null;
  }

  startStaleGameCleanup(intervalMs: number = 300000, maxIdleMs: number = 600000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.games) {
        const idleTime = now - entry.lastActivityAt;
        if (idleTime > maxIdleMs) {
          console.log(`[ActiveGameManager] Cleaning up stale game: ${key} (idle: ${Math.round(idleTime / 1000)}s)`);
          if (entry.pendingMove && !entry.pendingMove.resolved) {
            this.resolvePendingMove(key, entry.pendingMove.botMove || 'up');
          }
          this.games.delete(key);
          this.notifyGameListChange('removed', entry.gameId, entry.snakeId);
        }
      }
    }, intervalMs);
  }
}
