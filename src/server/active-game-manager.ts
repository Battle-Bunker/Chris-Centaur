import { GameState, Direction, Coord } from '../types/battlesnake';
import { Response } from 'express';
import { ConfigStore } from './configStore';
import { DEFAULT_CONFIG } from '../config/game-config';

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
  // Why a user selection was set this turn. 'manual' = explicit human input
  // (arrow keys, WASD, click on candidate cell, submit). 'queue' = the queue
  // head was pre-staged on the user's behalf. Drives intended-move priority:
  // a 'manual' selection beats the queue and clears it for that one turn;
  // a 'queue' selection is just a hint that the queue head is the intent.
  userSelectionSource: 'manual' | 'queue' | null;
  botMove: Direction | null;
  resolved: boolean;
}

export type IntendedMoveSource = 'manual' | 'queue' | 'bot' | 'fallback';

export interface IntendedMove {
  direction: Direction;
  source: IntendedMoveSource;
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
  holdTurnsRemaining: number;
  suicideArmed: boolean;
  premoveQueue: Coord[];
  // User-directed waypoint for centaur play. Persists across selection
  // changes; green waypoints auto-clear when the head arrives, blue
  // waypoints are cleared only when the user clicks the same cell again.
  waypoint: { type: 'green' | 'blue'; x: number; y: number } | null;
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
export type GameEndCallback = (gameId: string, snakeId: string, finalGameState: GameState, gameOver: boolean) => void;

export class ActiveGameManager {
  private static instance: ActiveGameManager;
  private games: Map<string, ActiveGame> = new Map();
  private turnUpdateCallbacks: TurnUpdateCallback[] = [];
  private boardUpdateCallbacks: BoardUpdateCallback[] = [];
  private moveCommittedCallbacks: MoveCommittedCallback[] = [];
  private gameListChangeCallbacks: GameListChangeCallback[] = [];
  private gameEndCallbacks: GameEndCallback[] = [];
  private gameServerPing: number = 50;
  private pingInterval: NodeJS.Timer | null = null;
  private staleGameCleanupInterval: NodeJS.Timer | null = null;
  private configStore: ConfigStore = new ConfigStore();

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

  onGameEnd(callback: GameEndCallback): void {
    this.gameEndCallbacks.push(callback);
  }

  private notifyGameEnd(gameId: string, snakeId: string, finalGameState: GameState, gameOver: boolean): void {
    for (const cb of this.gameEndCallbacks) {
      try {
        cb(gameId, snakeId, finalGameState, gameOver);
      } catch (e) {
        console.error('Error in game end callback:', e);
      }
    }
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

  recordTurnArrival(gameId: string, arrivalTime: number, gameTimeout: number, serverExpiryTime: number | null = null): void {
    const game = this.games.get(gameId);
    if (!game) return;

    if (serverExpiryTime) {
      game.turnExpiryTime = serverExpiryTime;
    } else {
      game.turnExpiryTime = arrivalTime + gameTimeout - this.gameServerPing;
    }
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
        holdTurnsRemaining: 0,
        suicideArmed: false,
        premoveQueue: [],
        waypoint: null,
      });
      this.notifyGameListChange('added', gameId, snakeId);
    }
  }

  endGame(gameId: string, snakeId: string, finalGameState?: GameState): void {
    const game = this.games.get(gameId);
    if (!game) {
      console.log(`[ActiveGameManager] endGame called for unknown game: ${gameId}:${snakeId}`);
      return;
    }

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) {
      // Duplicate /end for a snake we've already cleaned up. Don't re-fire
      // events that would bounce the UI; just no-op.
      console.log(`[ActiveGameManager] endGame for already-removed snake ${gameId}:${snakeId}, ignoring`);
      return;
    }
    if (controlled.pendingMove && !controlled.pendingMove.resolved) {
      this.resolvePendingMove(gameId, snakeId, controlled.pendingMove.botMove || 'up', 'game-end');
    }

    // The /end payload from the engine carries the actual final game state,
    // which is typically several turns ahead of our last /move (because other
    // snakes kept playing after ours died, and the death-state turn itself
    // never came in via /move). Push it through the normal board-update
    // pipeline so the centaur paints the real final position instead of
    // freezing on whatever turn our snake last responded to.
    let acceptedFinalState = false;
    const incomingTurn = finalGameState?.turn ?? -1;
    if (finalGameState && incomingTurn >= game.boardStateTurn) {
      game.boardState = finalGameState;
      game.boardStateTurn = incomingTurn;
      game.currentTurn = Math.max(game.currentTurn, incomingTurn);
      game.lastActivityAt = Date.now();
      this.notifyBoardUpdate(gameId, finalGameState);
      acceptedFinalState = true;
    } else if (finalGameState) {
      console.log(`[ActiveGameManager] endGame final-state for ${gameId}:${snakeId} rejected as stale (incomingTurn=${incomingTurn} < boardStateTurn=${game.boardStateTurn})`);
    }

    game.controlledSnakes.delete(snakeId);
    this.notifyGameListChange('removed', gameId, snakeId);

    const gameOver = game.controlledSnakes.size === 0;
    // Only emit snake-ended when the final state is fresh enough to apply.
    // A stale /end shouldn't rewind the UI's rendered turn.
    if (finalGameState && acceptedFinalState) {
      this.notifyGameEnd(gameId, snakeId, finalGameState, gameOver);
    }

    if (gameOver) {
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

  holdSnake(gameId: string, snakeId: string, userId: string): { success: boolean; holdTurnsRemaining: number } {
    const game = this.games.get(gameId);
    if (!game) return { success: false, holdTurnsRemaining: 0 };

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return { success: false, holdTurnsRemaining: 0 };

    if (controlled.selectedBy && controlled.selectedBy !== userId) {
      return { success: false, holdTurnsRemaining: controlled.holdTurnsRemaining };
    }

    controlled.holdTurnsRemaining += 1;
    console.log(`[ActiveGameManager] Hold added for ${gameId}:${snakeId} by ${userId}: now holding ${controlled.holdTurnsRemaining} turn(s)`);

    if (controlled.pendingMove && !controlled.pendingMove.resolved) {
      controlled.pendingMove.userSelectedMove = null;
      controlled.pendingMove.userSelectionSource = null;
    }

    if (!controlled.selectedBy) {
      const user = game.connectedUsers.get(userId);
      if (user) {
        if (user.selectedSnakeId && user.selectedSnakeId !== snakeId) {
          this.deselectSnake(gameId, userId);
        }
        controlled.selectedBy = userId;
        user.selectedSnakeId = snakeId;
      }
    }

    return { success: true, holdTurnsRemaining: controlled.holdTurnsRemaining };
  }

  releaseAllHolds(gameId: string): { released: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { released: [] };

    const released: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      if (controlled.holdTurnsRemaining > 0) {
        controlled.holdTurnsRemaining = 0;
        released.push(snakeId);

        if (
          !controlled.selectedBy &&
          controlled.pendingMove &&
          !controlled.pendingMove.resolved &&
          controlled.botRecommendation
        ) {
          console.log(`[ActiveGameManager] Release-all: auto-piloting ${gameId}:${snakeId} with ${controlled.botRecommendation}`);
          this.resolvePendingMove(gameId, snakeId, controlled.botRecommendation, 'auto-pilot');
        }
      }
    }
    if (released.length > 0) {
      console.log(`[ActiveGameManager] Released holds for game ${gameId}: ${released.join(', ')}`);
    }
    return { released };
  }

  suicideAllSnakes(gameId: string): { affected: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { affected: [] };

    const affected: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      controlled.suicideArmed = true;
      controlled.holdTurnsRemaining = 0;
      affected.push(snakeId);

      if (controlled.pendingMove && !controlled.pendingMove.resolved && controlled.pendingMove.turnData) {
        const move = computeSuicideMove(controlled.pendingMove.turnData.gameState);
        console.log(`[ActiveGameManager] SUICIDE: immediately submitting ${move} for ${gameId}:${snakeId}`);
        controlled.suicideArmed = false;
        this.resolvePendingMove(gameId, snakeId, move, 'suicide');
      }
    }
    if (affected.length > 0) {
      console.log(`[ActiveGameManager] SUICIDE armed for game ${gameId}: ${affected.join(', ')}`);
    }
    return { affected };
  }

  getHoldStates(gameId: string): { [snakeId: string]: number } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const out: { [snakeId: string]: number } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      out[snakeId] = cs.holdTurnsRemaining;
    }
    return out;
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

      if (controlled.pendingMove && !controlled.pendingMove.resolved) {
        const staged = controlled.pendingMove.userSelectedMove;
        console.log(`[ActiveGameManager] Snake deselected ${gameId}:${snakeId} (turn ${game.currentTurn}), staged move=${staged || 'none'} — waiting for safety timer or reselection`);
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
    holds: { [snakeId: string]: number };
    premoves: { [snakeId: string]: Coord[] };
    waypoints: { [snakeId: string]: { type: 'green' | 'blue'; x: number; y: number } };
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

    const holds: { [snakeId: string]: number } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      holds[snakeId] = cs.holdTurnsRemaining;
    }

    return {
      boardState: game.boardState,
      controlledSnakes,
      connectedUsers: Array.from(game.connectedUsers.values()),
      selections,
      holds,
      premoves: this.getPremovesForGame(gameId),
      waypoints: this.getWaypointsForGame(gameId),
      gameTimeout: game.gameTimeout,
      turnExpiryTime: game.turnExpiryTime,
      measuredPing: this.gameServerPing,
    };
  }

  getWaypoint(gameId: string, snakeId: string): { type: 'green' | 'blue'; x: number; y: number } | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    return controlled?.waypoint || null;
  }

  getWaypointsForGame(gameId: string): { [snakeId: string]: { type: 'green' | 'blue'; x: number; y: number } } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: { type: 'green' | 'blue'; x: number; y: number } } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.waypoint) result[snakeId] = cs.waypoint;
    }
    return result;
  }

  // Set or clear a snake's waypoint. Only the user currently selecting the
  // snake may change it. Pass `waypoint=null` to clear. Returns true on success.
  setWaypoint(
    gameId: string,
    snakeId: string,
    waypoint: { type: 'green' | 'blue'; x: number; y: number } | null,
    userId: string
  ): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return false;
    if (controlled.selectedBy !== userId) return false;

    if (waypoint === null) {
      controlled.waypoint = null;
      return true;
    }

    const board = game.boardState?.board;
    const w = board?.width ?? 0;
    const h = board?.height ?? 0;
    const x = Math.floor(Number(waypoint.x));
    const y = Math.floor(Number(waypoint.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (w > 0 && (x < 0 || x >= w)) return false;
    if (h > 0 && (y < 0 || y >= h)) return false;
    if (waypoint.type !== 'green' && waypoint.type !== 'blue') return false;

    controlled.waypoint = { type: waypoint.type, x, y };
    return true;
  }

  getPremovesForGame(gameId: string): { [snakeId: string]: Coord[] } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: Coord[] } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.premoveQueue && cs.premoveQueue.length > 0) {
        result[snakeId] = cs.premoveQueue;
      }
    }
    return result;
  }

  // The cell the snake's head will occupy after the move it has already
  // committed this turn. If no move is committed yet, this is just the
  // current head. Anchors all "next turn" rendering: Q-mode adjacency,
  // candidate-arrow cells, queue-extension click targets.
  getProjectedHead(gameId: string, snakeId: string): Coord | null {
    const game = this.games.get(gameId);
    if (!game?.boardState) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return null;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const head = snake?.head || snake?.body?.[0];
    if (!head) return null;
    if (controlled.moveCommittedThisTurn && controlled.committedMove) {
      switch (controlled.committedMove) {
        case 'up':    return { x: head.x,     y: head.y + 1 };
        case 'down':  return { x: head.x,     y: head.y - 1 };
        case 'left':  return { x: head.x - 1, y: head.y     };
        case 'right': return { x: head.x + 1, y: head.y     };
      }
    }
    return head;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Single source of truth for "what move will this snake commit this turn".
  // Every commit-side decision (safety-timer fallback, auto-pilot for
  // unselected snakes) and every render-side broadcast (staged-move arrow)
  // reads from this one function, so the queue-vs-manual-vs-bot precedence
  // is encoded in exactly one place.
  //
  // Priority:
  //   1. manual user selection (this turn)  — already wiped the queue
  //   2. queue head (adjacent to current head)
  //   3. bot recommendation
  //   4. hard fallback ('up')
  //
  // An explicit user submit (submitUserMove) bypasses this function entirely
  // — it resolves the pending move synchronously rather than waiting for
  // the safety timer.
  // ────────────────────────────────────────────────────────────────────────
  computeIntendedMove(gameId: string, snakeId: string): IntendedMove {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    const pending = controlled?.pendingMove;

    if (pending && !pending.resolved &&
        pending.userSelectionSource === 'manual' && pending.userSelectedMove) {
      return { direction: pending.userSelectedMove, source: 'manual' };
    }

    const premoveDir = this.getPremoveDirection(gameId, snakeId);
    if (premoveDir) {
      return { direction: premoveDir, source: 'queue' };
    }

    if (controlled?.botRecommendation) {
      return { direction: controlled.botRecommendation, source: 'bot' };
    }

    return { direction: 'up', source: 'fallback' };
  }

  private static directionFromTo(from: Coord, to: Coord): Direction | null {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 1 && dy === 0) return 'right';
    if (dx === -1 && dy === 0) return 'left';
    if (dx === 0 && dy === 1) return 'up';
    if (dx === 0 && dy === -1) return 'down';
    return null;
  }

  // Returns the move direction the snake should take next according to its
  // premove queue, or null if the queue is empty / disconnected from the
  // current head. Only the immediate next cell is consulted; subsequent cells
  // are advanced one per turn by `advancePremoveQueueAfterMove`.
  private getPremoveDirection(gameId: string, snakeId: string): Direction | null {
    const game = this.games.get(gameId);
    if (!game?.boardState) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled || controlled.premoveQueue.length === 0) return null;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const head = snake?.head || snake?.body?.[0];
    if (!head) return null;
    return ActiveGameManager.directionFromTo(head, controlled.premoveQueue[0]);
  }

  // Called after every resolved move to keep the queue in lock-step with the
  // actual snake position. If the move matches the planned next cell, pop it.
  // If it diverged (manual override, fallback move, etc.), abandon the plan —
  // the snake is now somewhere the queue can't reach, so the rest is stale.
  private advancePremoveQueueAfterMove(gameId: string, snakeId: string, move: Direction): void {
    const game = this.games.get(gameId);
    if (!game?.boardState) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled || controlled.premoveQueue.length === 0) return;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const head = snake?.head || snake?.body?.[0];
    if (!head) return;
    const expected = ActiveGameManager.directionFromTo(head, controlled.premoveQueue[0]);
    if (expected === move) {
      controlled.premoveQueue.shift();
    } else {
      console.log(`[ActiveGameManager] Premove queue diverged for ${gameId}:${snakeId}: expected=${expected}, actual=${move}, clearing`);
      controlled.premoveQueue = [];
    }
  }

  setPremoveQueue(gameId: string, snakeId: string, queue: unknown, userId: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return false;
    if (controlled.selectedBy !== userId) return false;

    const sanitized: Coord[] = [];
    if (Array.isArray(queue)) {
      const board = game.boardState?.board;
      const w = board?.width ?? 0;
      const h = board?.height ?? 0;
      for (let i = 0; i < Math.min(queue.length, 200); i++) {
        const c = queue[i] as { x?: unknown; y?: unknown } | null;
        if (!c) continue;
        const x = Number(c.x);
        const y = Number(c.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        if (w > 0 && (ix < 0 || ix >= w)) continue;
        if (h > 0 && (iy < 0 || iy >= h)) continue;
        sanitized.push({ x: ix, y: iy });
      }
    }
    controlled.premoveQueue = sanitized;
    return true;
  }

  setPendingMove(gameId: string, snakeId: string, res: Response, gameTimeout: number, serverExpiryTime: number | null = null, turn: number = 0): PendingMove {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game ${gameId} not registered`);

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) throw new Error(`Snake ${snakeId} not controlled in game ${gameId}`);

    if (controlled.pendingMove && !controlled.pendingMove.resolved) {
      const intent = this.computeIntendedMove(gameId, snakeId);
      console.log(`[ActiveGameManager] Previous-turn-cleanup for ${gameId}:${snakeId}: using ${intent.direction} (source: ${intent.source})`);
      this.resolvePendingMove(gameId, snakeId, intent.direction, `previous-turn-cleanup:${intent.source}`);
    }

    const bufferMs = turn === 0 ? 5000 : 100;
    let timeoutMs: number;
    if (serverExpiryTime) {
      const now = Date.now();
      timeoutMs = Math.max(serverExpiryTime - now - bufferMs, 50);
    } else {
      timeoutMs = Math.max(gameTimeout - bufferMs, 50);
    }
    console.log(`[ActiveGameManager] Safety timer set for ${gameId}:${snakeId} turn ${game.currentTurn}: serverExpiryTime=${serverExpiryTime}, gameTimeout=${gameTimeout}ms, firing in ${timeoutMs}ms`);

    const pending: PendingMove = {
      res,
      timer: setTimeout(() => {
        if (!pending.resolved) {
          // Tab/hold marks the snake as held but the safety timer still fires
          // at deadline — falling back to the intended move so the snake
          // doesn't die from inaction. The hold's job is to defer the auto-
          // pilot mid-turn (giving the user time to think); at the deadline
          // the bot's recommendation (or queue head) is still the safest
          // available choice. computeIntendedMove enforces precedence.
          const intent = this.computeIntendedMove(gameId, snakeId);
          const heldNote = controlled.holdTurnsRemaining > 0 ? ` [held ${controlled.holdTurnsRemaining}]` : '';
          console.log(`[ActiveGameManager] Safety timer fired for ${gameId}:${snakeId}${heldNote}: using ${intent.direction} (source: ${intent.source}, selectedBy=${controlled.selectedBy})`);
          this.resolvePendingMove(gameId, snakeId, intent.direction, `safety-timer:${intent.source}`);
        } else {
          console.log(`[ActiveGameManager] Safety timer fired for ${gameId}:${snakeId} but already resolved`);
        }
      }, timeoutMs),
      turnData: null,
      userSelectedMove: null,
      userSelectionSource: null,
      botMove: null,
      resolved: false
    };

    controlled.pendingMove = pending;
    controlled.moveCommittedThisTurn = false;
    controlled.committedMove = null;
    return pending;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Move-source priority for a controlled snake (the single pipeline; see
  // also computeIntendedMove above and the mirror comment in
  // src/web/play-game.html near `let premoveAutoCommitTimer`):
  //   1. Explicit user submit          — submitUserMove → resolvePendingMove
  //                                      (synchronous; bypasses the pipeline)
  //   2. Manual user selection         — setUserSelection (marks
  //                                      pending.userSelectionSource='manual'
  //                                      and clears the queue; this is the
  //                                      "manual override drops the plan"
  //                                      contract)
  //   3. Queued premove (queue head)   — getPremoveDirection, applied
  //                                      identically to selected AND
  //                                      unselected snakes via
  //                                      computeIntendedMove. The asymmetry
  //                                      where selected snakes' queues were
  //                                      a client-side affordance is gone.
  //   4. Bot recommendation            — fallback used by the safety timer
  //                                      and the unselected-snake auto-pilot
  //   5. Hard fallback                 — literal 'up' if nothing else available
  //
  // Ownership of the premove queue: server-only mutations are done in
  // `setPremoveQueue` (in response to client `set-premove`), `setUserSelection`
  // (clear on 'manual' override), and `advancePremoveQueueAfterMove` (pop /
  // clear on divergence). Clients never advance the queue themselves; they
  // render the broadcast snapshot.
  // ────────────────────────────────────────────────────────────────────────
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
        if (cs.holdTurnsRemaining > 0) {
          cs.holdTurnsRemaining = Math.max(0, cs.holdTurnsRemaining - 1);
        }
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

    if (controlled.suicideArmed && controlled.pendingMove && !controlled.pendingMove.resolved) {
      const suicideMove = computeSuicideMove(turnData.gameState);
      console.log(`[ActiveGameManager] SUICIDE: submitting ${suicideMove} for ${gameId}:${snakeId} (turn ${incomingTurn})`);
      controlled.suicideArmed = false;
      this.resolvePendingMove(gameId, snakeId, suicideMove, 'suicide');
    } else if (controlled.holdTurnsRemaining > 0 && controlled.pendingMove && !controlled.pendingMove.resolved) {
      console.log(`[ActiveGameManager] Hold active for ${gameId}:${snakeId} (${controlled.holdTurnsRemaining} turns remaining): deferring auto-pilot, safety timer will submit ${move} at end of turn`);
    } else if (!controlled.selectedBy && controlled.pendingMove && !controlled.pendingMove.resolved && game.currentTurn > 0) {
      // Unselected snake: server drives the commit. Use computeIntendedMove
      // so queue-vs-bot precedence is identical to the selected-snake path.
      // If the queue exists but its head isn't adjacent (stale plan from a
      // pre-divergence position), clear it so we don't keep computing 'queue'
      // forever once it can never resolve to a direction.
      if (controlled.premoveQueue.length > 0 && !this.getPremoveDirection(gameId, snakeId)) {
        console.log(`[ActiveGameManager] Premove queue head not adjacent for ${gameId}:${snakeId}, clearing stale plan`);
        controlled.premoveQueue = [];
      }
      const intent = this.computeIntendedMove(gameId, snakeId);
      console.log(`[ActiveGameManager] Auto-pilot for ${gameId}:${snakeId}: submitting ${intent.direction} (source: ${intent.source})`);
      this.resolvePendingMove(gameId, snakeId, intent.direction, `auto-pilot:${intent.source}`);
    } else if (game.currentTurn === 0 && !controlled.selectedBy) {
      this.handleFirstTurnAutoPilot(gameId, snakeId, move, controlled);
    }

    if (boardUpdated) {
      this.notifyBoardUpdate(gameId, turnData.gameState);
    }
    this.notifyTurnUpdate(gameId, snakeId, turnData);
  }

  // Stage a user's selection for this turn. `source` discriminates between an
  // explicit human action ('manual' — priority 2, clears the queue per the
  // "manual override drops the plan" contract) and a pre-stage on the user's
  // behalf from the queue head ('queue' — priority 3, leaves the queue alone).
  setUserSelection(gameId: string, snakeId: string, move: Direction, source: 'manual' | 'queue' = 'manual'): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled?.pendingMove || controlled.pendingMove.resolved) return;

    controlled.pendingMove.userSelectedMove = move;
    controlled.pendingMove.userSelectionSource = source;

    if (source === 'manual' && controlled.premoveQueue.length > 0) {
      console.log(`[ActiveGameManager] Manual selection for ${gameId}:${snakeId} (${move}) — clearing premove queue (${controlled.premoveQueue.length} cells dropped)`);
      controlled.premoveQueue = [];
    }
    console.log(`[ActiveGameManager] User selected move for ${gameId}:${snakeId}: ${move} (source: ${source}, turn ${game.currentTurn}, not yet committed)`);
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
    controlled.pendingMove.userSelectionSource = 'manual';
    this.resolvePendingMove(gameId, snakeId, move, 'user-selection');
    return true;
  }

  private handleFirstTurnAutoPilot(gameId: string, snakeId: string, move: Direction, controlled: ControlledSnake): void {
    this.configStore.get('autoFirstMove').then(value => {
      const isAutoFirstMove = value !== undefined ? value : DEFAULT_CONFIG.autoFirstMove;
      console.log(`[ActiveGameManager] Turn 0 autoFirstMove check for ${gameId}:${snakeId}: autoFirstMove=${isAutoFirstMove} (raw db value=${JSON.stringify(value)})`);
      
      if (isAutoFirstMove && controlled.pendingMove && !controlled.pendingMove.resolved) {
        console.log(`[ActiveGameManager] Auto-pilot (autoFirstMove enabled) for ${gameId}:${snakeId}: submitting ${move} on turn 0`);
        this.resolvePendingMove(gameId, snakeId, move, 'auto-pilot');
      } else if (!isAutoFirstMove) {
        console.log(`[ActiveGameManager] Turn 0 override: holding ${gameId}:${snakeId} for manual control (bot recommends ${move})`);
      }
    }).catch(error => {
      console.error(`[ActiveGameManager] Error reading autoFirstMove config for ${gameId}:${snakeId}, defaulting to hold:`, error);
    });
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

    // Auto-clear green ("goto") waypoint when the snake's head has been
    // at the target cell at any point — check both the current head and
    // the most recent body segments so a snake that already advanced past
    // the target by the time /move fires still clears the waypoint.
    if (controlled?.waypoint && controlled.waypoint.type === 'green') {
      const wp = controlled.waypoint;
      const you = gameState.you;
      const head = you?.head;
      const body = you?.body || [];
      const headHit = !!head && head.x === wp.x && head.y === wp.y;
      // body[0] === head; body[1] is where the head was last turn. If the
      // snake stepped onto the target last turn and is now stepping off,
      // body[1] catches that case.
      const justSteppedThrough = body.length > 1 && body[1].x === wp.x && body[1].y === wp.y;
      if (headHit || justSteppedThrough) {
        console.log(`[ActiveGameManager] Auto-clearing green waypoint for ${gameId}:${snakeId} (head=${head?.x},${head?.y} wp=${wp.x},${wp.y} reason=${headHit ? 'head' : 'body[1]'})`);
        controlled.waypoint = null;
      }
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

    // Keep the server-side premove queue in lock-step with the actual move.
    // This works for both selected (client submitted) and unselected
    // (auto-pilot) snakes — whoever drove the move, the queue advances or
    // clears based on what actually happened.
    this.advancePremoveQueueAfterMove(gameId, snakeId, move);

    try {
      const headersSent = pending.res.headersSent;
      const finished = pending.res.writableFinished;
      const destroyed = pending.res.destroyed;
      if (headersSent || finished || destroyed) {
        console.error(`[ActiveGameManager] Response already consumed for ${gameId}:${snakeId}: headersSent=${headersSent}, finished=${finished}, destroyed=${destroyed}`);
      }
      pending.res.json({
        move: move,
        shout: `Centaur mode! Turn ${game.currentTurn}`
      });
      console.log(`[ActiveGameManager] Move response sent for ${gameId}:${snakeId}: ${move} (source: ${source}, headersSent=${pending.res.headersSent})`);
    } catch (e) {
      console.error(`[ActiveGameManager] Error sending move response for ${gameId}:${snakeId}:`, e);
    }

    controlled.pendingMove = null;

    this.notifyMoveCommitted(gameId, snakeId, move, source);
  }

  shutdown(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval as any);
      this.pingInterval = null;
    }
    if (this.staleGameCleanupInterval) {
      clearInterval(this.staleGameCleanupInterval as any);
      this.staleGameCleanupInterval = null;
    }
  }

  startStaleGameCleanup(intervalMs: number = 300000, maxIdleMs: number = 600000): void {
    if (this.staleGameCleanupInterval) return;
    this.staleGameCleanupInterval = setInterval(() => {
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

function computeSuicideMove(gameState: GameState): Direction {
  const you = gameState.you;
  const head = you.body[0];
  const neck = you.body[1];
  if (neck && (neck.x !== head.x || neck.y !== head.y)) {
    if (neck.x < head.x) return "left";
    if (neck.x > head.x) return "right";
    if (neck.y < head.y) return "down";
    return "up";
  }
  const w = gameState.board.width;
  const h = gameState.board.height;
  const distLeft = head.x;
  const distRight = w - 1 - head.x;
  const distDown = head.y;
  const distUp = h - 1 - head.y;
  const min = Math.min(distLeft, distRight, distDown, distUp);
  if (min === distLeft) return "left";
  if (min === distRight) return "right";
  if (min === distDown) return "down";
  return "up";
}
