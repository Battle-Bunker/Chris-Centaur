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

export interface SnakeInfo {
  id: string;
  name: string;
  emoji: string;
}

export interface ControlledSnake {
  id: string;
  name: string;
  emoji: string;
  pendingMove: PendingMove | null;
  latestTurnData: TurnData | null;
  botRecommendation: Direction | null;
  selectedBy: string | null;
  moveCommittedThisTurn: boolean;
  committedMove: Direction | null;
}

export interface ConnectedUser {
  userId: string;
  color: string;
  selectedSnakeId: string | null;
  nickname: string | null;
}

export interface ActiveGame {
  gameId: string;
  boardState: GameState | null;
  boardStateTurn: number;
  snakes: Map<string, SnakeInfo>;
  controlledSnakes: Map<string, ControlledSnake>;
  connectedUsers: Map<string, ConnectedUser>;
  gameTimeout: number;
  startedAt: number;
  lastActivityAt: number;
  colorPool: string[];
  turnExpiryTime: number | null;
  currentTurn: number;
}

const DISTINCT_COLORS = [
  '#e6194B', '#f58231', '#ffe119', '#bfef45',
  '#3cb44b', '#42d4f4', '#4363d8', '#911eb4',
  '#f032e6',
];

export type TurnUpdateCallback = (gameId: string, snakeId: string, turnData: TurnData) => void;
export type BoardUpdateCallback = (gameId: string, gameState: GameState) => void;
export type MoveCommittedCallback = (gameId: string, snakeId: string, move: Direction, source: string) => void;
export type GameListChangeCallback = (event: 'added' | 'removed' | 'updated', gameId: string, snakeId: string) => void;

export class ActiveGameManager {
  private static instance: ActiveGameManager;
  private games: Map<string, ActiveGame> = new Map();
  private turnUpdateCallbacks: TurnUpdateCallback[] = [];
  private boardUpdateCallbacks: BoardUpdateCallback[] = [];
  private moveCommittedCallbacks: MoveCommittedCallback[] = [];
  private gameListChangeCallbacks: GameListChangeCallback[] = [];
  private gameServerPing: number = 50;
  private pingInterval: NodeJS.Timer | null = null;

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

  onBoardUpdate(callback: BoardUpdateCallback): void {
    this.boardUpdateCallbacks.push(callback);
  }

  onMoveCommitted(callback: MoveCommittedCallback): void {
    this.moveCommittedCallbacks.push(callback);
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

  private notifyBoardUpdate(gameId: string, gameState: GameState): void {
    for (const cb of this.boardUpdateCallbacks) {
      try {
        cb(gameId, gameState);
      } catch (e) {
        console.error('Error in board update callback:', e);
      }
    }
  }

  private notifyMoveCommitted(gameId: string, snakeId: string, move: Direction, source: string): void {
    for (const cb of this.moveCommittedCallbacks) {
      try {
        cb(gameId, snakeId, move, source);
      } catch (e) {
        console.error('Error in move committed callback:', e);
      }
    }
  }

  getMeasuredPing(): number {
    return this.gameServerPing;
  }

  recordTurnArrival(gameId: string, arrivalTime: number, gameTimeout: number): void {
    const game = this.games.get(gameId);
    if (!game) return;

    game.turnExpiryTime = arrivalTime + gameTimeout - this.gameServerPing;
  }

  startServerPing(gameServerUrl: string = 'https://engine.battlesnake.com'): void {
    if (this.pingInterval) return;

    const pingGameServer = async () => {
      try {
        const start = Date.now();
        const response = await fetch(gameServerUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        const elapsed = Date.now() - start;
        if (response.ok || response.status < 500) {
          this.gameServerPing = this.gameServerPing > 0
            ? Math.round(this.gameServerPing * 0.7 + elapsed * 0.3)
            : elapsed;
        }
      } catch {
      }
    };

    pingGameServer();
    this.pingInterval = setInterval(pingGameServer, 30000);
  }

  registerGame(gameState: GameState): void {
    const gameId = gameState.game.id;
    const snakeId = gameState.you.id;

    let game = this.games.get(gameId);
    if (!game) {
      const now = Date.now();
      game = {
        gameId,
        boardState: gameState,
        boardStateTurn: gameState.turn || 0,
        snakes: new Map(),
        controlledSnakes: new Map(),
        connectedUsers: new Map(),
        gameTimeout: gameState.game.timeout || 500,
        startedAt: now,
        lastActivityAt: now,
        colorPool: [...DISTINCT_COLORS],
        turnExpiryTime: null,
        currentTurn: gameState.turn || 0,
      };
      this.games.set(gameId, game);
    }

    for (const snake of gameState.board.snakes) {
      if (!game.snakes.has(snake.id)) {
        game.snakes.set(snake.id, {
          id: snake.id,
          name: snake.name,
          emoji: snake.emoji || '',
        });
      }
    }

    if (!game.controlledSnakes.has(snakeId)) {
      console.log(`[ActiveGameManager] Registering controlled snake: ${gameId}:${snakeId} (${gameState.you.name})`);
      game.controlledSnakes.set(snakeId, {
        id: snakeId,
        name: gameState.you.name,
        emoji: gameState.you.emoji || '',
        pendingMove: null,
        latestTurnData: null,
        botRecommendation: null,
        selectedBy: null,
        moveCommittedThisTurn: false,
        committedMove: null,
      });
      this.notifyGameListChange('added', gameId, snakeId);
    }
  }

  endGame(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[ActiveGameManager] endGame called for unknown game: ${gameId}:${snakeId}`);
      return;
    }

    const controlled = game.controlledSnakes.get(snakeId);
    if (controlled) {
      if (controlled.pendingMove && !controlled.pendingMove.resolved) {
        this.resolvePendingMove(gameId, snakeId, controlled.pendingMove.botMove || 'up', 'game-end');
      }
      game.controlledSnakes.delete(snakeId);
      this.notifyGameListChange('removed', gameId, snakeId);
    }

    if (game.controlledSnakes.size === 0) {
      console.log(`[ActiveGameManager] All controlled snakes ended for game ${gameId}, removing game`);
      this.games.delete(gameId);
    }
  }

  isSnakeSelected(gameId: string, snakeId: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    return controlled?.selectedBy !== null && controlled?.selectedBy !== undefined;
  }

  selectSnake(gameId: string, snakeId: string, userId: string, force: boolean = false): { success: boolean; contestedBy?: string; revokedUserId?: string } {
    const game = this.games.get(gameId);
    if (!game) return { success: false };

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return { success: false };

    const user = game.connectedUsers.get(userId);
    if (!user) return { success: false };

    if (user.selectedSnakeId && user.selectedSnakeId !== snakeId) {
      this.deselectSnake(gameId, userId);
    }

    if (controlled.selectedBy && controlled.selectedBy !== userId) {
      if (!force) {
        return { success: false, contestedBy: controlled.selectedBy };
      }
      const previousUserId = controlled.selectedBy;
      const previousUser = game.connectedUsers.get(previousUserId);
      if (previousUser) {
        previousUser.selectedSnakeId = null;
      }
      controlled.selectedBy = userId;
      user.selectedSnakeId = snakeId;
      return { success: true, revokedUserId: previousUserId };
    }

    controlled.selectedBy = userId;
    user.selectedSnakeId = snakeId;
    return { success: true };
  }

  deselectSnake(gameId: string, userId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const user = game.connectedUsers.get(userId);
    if (!user || !user.selectedSnakeId) return;

    const snakeId = user.selectedSnakeId;
    const controlled = game.controlledSnakes.get(snakeId);
    if (controlled && controlled.selectedBy === userId) {
      controlled.selectedBy = null;

      if (game.currentTurn > 0 && controlled.pendingMove && !controlled.pendingMove.resolved && controlled.pendingMove.botMove) {
        console.log(`[ActiveGameManager] Auto-pilot-deselect for ${gameId}:${snakeId}: submitting ${controlled.pendingMove.botMove}`);
        this.resolvePendingMove(gameId, snakeId, controlled.pendingMove.botMove, 'auto-pilot-deselect');
      }
    }
    user.selectedSnakeId = null;
  }

  addConnectedUser(gameId: string, userId: string): ConnectedUser | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    if (game.connectedUsers.has(userId)) {
      return game.connectedUsers.get(userId)!;
    }

    const color = game.colorPool.length > 0
      ? game.colorPool.shift()!
      : DISTINCT_COLORS[game.connectedUsers.size % DISTINCT_COLORS.length];

    const user: ConnectedUser = {
      userId,
      color,
      selectedSnakeId: null,
      nickname: null,
    };
    game.connectedUsers.set(userId, user);
    return user;
  }

  setUserNickname(gameId: string, userId: string, nickname: string | null): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const user = game.connectedUsers.get(userId);
    if (!user) return false;
    user.nickname = nickname && nickname.trim().length > 0 ? nickname.trim().substring(0, 20) : null;
    return true;
  }

  removeConnectedUser(gameId: string, userId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const user = game.connectedUsers.get(userId);
    if (!user) return;

    if (user.selectedSnakeId) {
      const controlled = game.controlledSnakes.get(user.selectedSnakeId);
      if (controlled && controlled.selectedBy === userId) {
        controlled.selectedBy = null;
      }
    }

    game.colorPool.push(user.color);
    game.connectedUsers.delete(userId);
  }

  getGame(gameId: string): ActiveGame | undefined {
    return this.games.get(gameId);
  }

  getActiveGames(): Array<{
    gameId: string;
    controlledSnakes: Array<{ id: string; name: string; emoji: string }>;
    turn: number;
    gameState: GameState | null;
    startedAt: number;
  }> {
    const result: Array<any> = [];
    for (const game of this.games.values()) {
      const snakes: Array<{ id: string; name: string; emoji: string }> = [];
      for (const cs of game.controlledSnakes.values()) {
        snakes.push({ id: cs.id, name: cs.name, emoji: cs.emoji });
      }
      result.push({
        gameId: game.gameId,
        controlledSnakes: snakes,
        turn: game.currentTurn,
        gameState: game.boardState,
        startedAt: game.startedAt,
      });
    }
    return result;
  }

  getGameState(gameId: string): {
    boardState: GameState | null;
    controlledSnakes: Array<{
      id: string; name: string; emoji: string;
      selectedBy: string | null;
      moveCommittedThisTurn: boolean;
      committedMove: Direction | null;
      turnData: TurnData | null;
      botRecommendation: Direction | null;
    }>;
    connectedUsers: Array<ConnectedUser>;
    selections: { [snakeId: string]: { userId: string; color: string } | null };
    gameTimeout: number;
    turnExpiryTime: number | null;
    measuredPing: number;
  } | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const controlledSnakes: Array<{
      id: string; name: string; emoji: string;
      selectedBy: string | null;
      moveCommittedThisTurn: boolean;
      committedMove: Direction | null;
      turnData: TurnData | null;
      botRecommendation: Direction | null;
    }> = [];
    const selections: { [snakeId: string]: { userId: string; color: string } | null } = {};

    for (const cs of game.controlledSnakes.values()) {
      controlledSnakes.push({
        id: cs.id,
        name: cs.name,
        emoji: cs.emoji,
        selectedBy: cs.selectedBy,
        moveCommittedThisTurn: cs.moveCommittedThisTurn,
        committedMove: cs.committedMove,
        turnData: cs.latestTurnData,
        botRecommendation: cs.botRecommendation,
      });
      if (cs.selectedBy) {
        const user = game.connectedUsers.get(cs.selectedBy);
        selections[cs.id] = {
          userId: cs.selectedBy,
          color: user?.color || '#888888',
        };
      } else {
        selections[cs.id] = null;
      }
    }

    return {
      boardState: game.boardState,
      controlledSnakes,
      connectedUsers: Array.from(game.connectedUsers.values()),
      selections,
      gameTimeout: game.gameTimeout,
      turnExpiryTime: game.turnExpiryTime,
      measuredPing: this.gameServerPing,
    };
  }

  setPendingMove(gameId: string, snakeId: string, res: Response, gameTimeout: number): PendingMove {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game ${gameId} not registered`);

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) throw new Error(`Snake ${snakeId} not controlled in game ${gameId}`);

    if (controlled.pendingMove && !controlled.pendingMove.resolved) {
      this.resolvePendingMove(gameId, snakeId, controlled.pendingMove.botMove || 'up', 'previous-turn-cleanup');
    }

    const bufferMs = 100;
    const timeoutMs = Math.max(gameTimeout - bufferMs, 50);
    if (game.currentTurn === 0) {
      console.log(`[ActiveGameManager] Turn 0 safety timer for ${gameId}:${snakeId}: gameTimeout=${gameTimeout}ms, buffer=${bufferMs}ms, firing in ${timeoutMs}ms`);
    }

    const pending: PendingMove = {
      res,
      timer: setTimeout(() => {
        if (!pending.resolved) {
          const move = pending.userSelectedMove || pending.botMove || 'up';
          const source = pending.userSelectedMove ? 'user-selection' : (pending.botMove ? 'bot-recommendation' : 'fallback');
          console.log(`[ActiveGameManager] Safety timer fired for ${gameId}:${snakeId}: using ${move} (source: ${source})`);
          this.resolvePendingMove(gameId, snakeId, move, 'safety-timer');
        }
      }, timeoutMs),
      turnData: null,
      userSelectedMove: null,
      botMove: null,
      resolved: false
    };

    controlled.pendingMove = pending;
    controlled.moveCommittedThisTurn = false;
    controlled.committedMove = null;
    return pending;
  }

  setBotRecommendation(gameId: string, snakeId: string, move: Direction, turnData: TurnData): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return;

    const incomingTurn = turnData.gameState.turn;
    game.lastActivityAt = Date.now();
    game.gameTimeout = turnData.gameState.game.timeout || game.gameTimeout;
    game.currentTurn = Math.max(game.currentTurn, incomingTurn);

    let boardUpdated = false;
    if (incomingTurn > game.boardStateTurn) {
      game.boardState = turnData.gameState;
      game.boardStateTurn = incomingTurn;

      for (const snake of turnData.gameState.board.snakes) {
        if (!game.snakes.has(snake.id)) {
          game.snakes.set(snake.id, {
            id: snake.id,
            name: snake.name,
            emoji: snake.emoji || '',
          });
        }
      }

      for (const cs of game.controlledSnakes.values()) {
        cs.moveCommittedThisTurn = false;
        cs.committedMove = null;
      }

      boardUpdated = true;
    } else if (incomingTurn === game.boardStateTurn) {
      const existingSnakeCount = game.boardState?.board.snakes.length || 0;
      const incomingSnakeCount = turnData.gameState.board.snakes.length;
      if (existingSnakeCount !== incomingSnakeCount) {
        console.log(`[ActiveGameManager] Consistency check: board snake count mismatch on turn ${incomingTurn}: existing=${existingSnakeCount} incoming=${incomingSnakeCount} (snake=${snakeId})`);
      }
    }

    controlled.latestTurnData = turnData;
    controlled.botRecommendation = move;

    if (controlled.pendingMove && !controlled.pendingMove.resolved) {
      controlled.pendingMove.botMove = move;
      controlled.pendingMove.turnData = turnData;
    }

    if (!controlled.selectedBy && controlled.pendingMove && !controlled.pendingMove.resolved && game.currentTurn > 0) {
      console.log(`[ActiveGameManager] Auto-pilot for ${gameId}:${snakeId}: submitting ${move}`);
      this.resolvePendingMove(gameId, snakeId, move, 'auto-pilot');
    } else if (game.currentTurn === 0 && !controlled.selectedBy) {
      console.log(`[ActiveGameManager] Turn 0 override: holding ${gameId}:${snakeId} for manual control (bot recommends ${move})`);
    }

    if (boardUpdated) {
      this.notifyBoardUpdate(gameId, turnData.gameState);
    }
    this.notifyTurnUpdate(gameId, snakeId, turnData);
  }

  setUserSelection(gameId: string, snakeId: string, move: Direction): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (controlled?.pendingMove && !controlled.pendingMove.resolved) {
      controlled.pendingMove.userSelectedMove = move;
    }
  }

  submitUserMove(gameId: string, snakeId: string, move: Direction): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled?.pendingMove || controlled.pendingMove.resolved) {
      console.log(`[ActiveGameManager] submitUserMove rejected for ${gameId}:${snakeId}: ${!controlled?.pendingMove ? 'no pending move' : 'already resolved'}`);
      return false;
    }

    console.log(`[ActiveGameManager] User submitted move for ${gameId}:${snakeId}: ${move}`);
    controlled.pendingMove.userSelectedMove = move;
    this.resolvePendingMove(gameId, snakeId, move, 'user-selection');
    return true;
  }

  updateGameState(gameId: string, snakeId: string, gameState: GameState): void {
    const game = this.games.get(gameId);
    if (!game) return;

    game.gameTimeout = gameState.game.timeout || game.gameTimeout;
    game.lastActivityAt = Date.now();

    const controlled = game.controlledSnakes.get(snakeId);
    if (controlled) {
      controlled.name = gameState.you.name || controlled.name;
      controlled.emoji = gameState.you.emoji || controlled.emoji;
    }

    const boardSnakeIds = new Set(gameState.board.snakes.map(s => s.id));
    const youId = gameState.you.id;
    if (!boardSnakeIds.has(youId)) {
      console.log(`[ActiveGameManager] Consistency check: our snake ${youId} not found in board snakes array`);
    }
  }

  private resolvePendingMove(gameId: string, snakeId: string, move: Direction, source: string = 'unknown'): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled?.pendingMove || controlled.pendingMove.resolved) return;

    const pending = controlled.pendingMove;
    pending.resolved = true;
    clearTimeout(pending.timer);

    controlled.moveCommittedThisTurn = true;
    controlled.committedMove = move;

    try {
      pending.res.json({
        move: move,
        shout: `Centaur mode! Turn ${game.currentTurn}`
      });
    } catch (e) {
      console.error('Error sending centaur move response:', e);
    }

    controlled.pendingMove = null;

    this.notifyMoveCommitted(gameId, snakeId, move, source);
  }

  startStaleGameCleanup(intervalMs: number = 300000, maxIdleMs: number = 600000): void {
    setInterval(() => {
      const now = Date.now();
      for (const [gameId, game] of this.games) {
        const idleTime = now - game.lastActivityAt;
        if (idleTime > maxIdleMs) {
          console.log(`[ActiveGameManager] Cleaning up stale game: ${gameId} (idle: ${Math.round(idleTime / 1000)}s)`);
          for (const [snakeId, controlled] of game.controlledSnakes) {
            if (controlled.pendingMove && !controlled.pendingMove.resolved) {
              this.resolvePendingMove(gameId, snakeId, controlled.pendingMove.botMove || 'up', 'stale-cleanup');
            }
            this.notifyGameListChange('removed', gameId, snakeId);
          }
          this.games.delete(gameId);
        }
      }
    }, intervalMs);
  }
}
