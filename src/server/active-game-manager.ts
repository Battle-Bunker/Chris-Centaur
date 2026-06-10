import { GameState, Direction, Coord } from '../types/battlesnake';
import { Response } from 'express';
import { BoardEvaluator } from '../logic/board-evaluator';

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
  // Live "goto" route the bot's waypoint pathfinder chose this turn (head →
  // green waypoint, excluding the head cell). Empty when no green waypoint is
  // set or the target is unreachable.
  gotoRoute?: Coord[];
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

export type IntendedMoveSource = 'manual' | 'queue' | 'waypoint' | 'bot' | 'fallback';

export interface IntendedMove {
  direction: Direction;
  source: IntendedMoveSource;
}

// The single "active next-move source" for a controlled snake. Exactly one is
// active at a time; activating one clears the state backing the other three
// (premove queue, waypoint, manual selection). See `transitionIntentMode`.
//  - heuristic: no user direction — the bot's recommendation drives the move
//  - manual:    the user picked a specific next move this turn
//  - queue:     a multi-step premove path is executing one cell per turn
//  - waypoint:  a click-target biases the bot toward a cell (green goto / blue near)
export type IntentMode = 'heuristic' | 'manual' | 'queue' | 'waypoint';

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
  // The active next-move source (see IntentMode). Maintained exclusively by
  // `transitionIntentMode`, so it always agrees with whichever of
  // premoveQueue / waypoint / manual-selection is currently populated.
  activeIntentMode: IntentMode;
  // The single resolved Direction that will commit at the turn deadline.
  // Maintained exclusively by `refreshStagedMove` (the one choke point that
  // runs computeIntendedMove and caches its result). The safety-timer commit
  // and the staged-arrow broadcast are pure reads of this field — never
  // recompute the intended move at those sites.
  stagedMove: Direction;
  // Live "goto" route (head → green waypoint) recomputed by the bot each turn.
  // Empty unless a green waypoint is set and reachable. Broadcast to every
  // client and drawn as the green dashed path.
  gotoRoute: Coord[];
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
  // Used to compute a green waypoint's goto route the moment it's set, so the
  // path shows immediately instead of waiting for the next /move.
  private routeEvaluator: BoardEvaluator = new BoardEvaluator();

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
        activeIntentMode: 'heuristic',
        stagedMove: 'up',
        gotoRoute: [],
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

    // Hold defers the commit to the deadline and drops any manual staging so
    // the snake reverts to its bot move (queue/waypoint persist). Re-derive the
    // stored stagedMove through the choke point, or the deadline commit and the
    // broadcast arrow would keep showing the now-cleared manual selection.
    if (controlled.activeIntentMode === 'manual') {
      this.transitionIntentMode(gameId, snakeId, controlled, 'heuristic');
    } else {
      this.refreshStagedMove(gameId, snakeId);
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

    // Releasing a hold ONLY clears the hold flag. It must not commit anything:
    // the per-snake deadline safety timer remains the sole commit path (the
    // armed-suicide kill is the one exception). Each released snake's pending
    // move still commits its stored stagedMove when its timer fires.
    const released: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      if (controlled.holdTurnsRemaining > 0) {
        controlled.holdTurnsRemaining = 0;
        released.push(snakeId);
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
      controlled.gotoRoute = [];
      if (controlled.activeIntentMode === 'waypoint') {
        this.transitionIntentMode(gameId, snakeId, controlled, 'heuristic');
      } else {
        this.refreshStagedMove(gameId, snakeId);
      }
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
    // Compute the green goto route now so the path renders immediately rather
    // than only after the next /move. Build a GameState whose `you` is THIS
    // snake so BoardGraph applies the right invulnerability/severability rules
    // (boardState.you is whichever snake last sent /move, which may differ).
    // This must run BEFORE transitionIntentMode so the staged-move refresh it
    // triggers can read the freshly-computed route head.
    controlled.gotoRoute = this.computeGotoRouteNow(
      game.boardState,
      snakeId,
      controlled.waypoint,
      this.getProjectedHead(gameId, snakeId) ?? undefined
    );
    // Setting a waypoint activates Waypoint mode (clearing queue + manual).
    this.transitionIntentMode(gameId, snakeId, controlled, 'waypoint');
    return true;
  }

  // Synchronously compute the green goto route from the latest shared board
  // state. Returns [] for blue/null waypoints or when there's no board state.
  private computeGotoRouteNow(
    boardState: GameState | null,
    snakeId: string,
    waypoint: { type: 'green' | 'blue'; x: number; y: number } | null,
    startHead?: Coord
  ): Coord[] {
    if (!boardState || !waypoint || waypoint.type !== 'green') return [];
    const targetSnake = boardState.board.snakes.find(s => s.id === snakeId);
    if (!targetSnake) return [];
    const gsForRoute: GameState = { ...boardState, you: targetSnake };
    return this.routeEvaluator.computeWaypointRoute(gsForRoute, snakeId, waypoint, startHead);
  }

  // Recompute and store the green goto route anchored at the snake's projected
  // head (the cell it will occupy after any move already committed this turn).
  // No-op unless the snake is actively in waypoint mode with a green waypoint.
  private recomputeGotoRoute(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    if (controlled.activeIntentMode !== 'waypoint' || !controlled.waypoint) return;
    controlled.gotoRoute = this.computeGotoRouteNow(
      game.boardState,
      snakeId,
      controlled.waypoint,
      this.getProjectedHead(gameId, snakeId) ?? undefined
    );
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
  // Derives "what move this snake intends this turn" from the active intent
  // method. This is NOT read at commit time — refreshStagedMove runs it once
  // per input change and caches the result into `stagedMove`, which is the
  // single field the safety-timer commit and the staged-arrow broadcast read.
  //
  // Priority (matches activeIntentMode — only one of manual/queue/waypoint can
  // ever be populated at once, see transitionIntentMode):
  //   1. manual user selection (this turn)  — already wiped the queue/waypoint
  //   2. queue head (adjacent to current head)
  //   3. goto route head (first step of the rendered green waypoint route)
  //   4. bot recommendation
  //   5. hard fallback ('up')
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

    // Waypoint mode HARD-OVERRIDES the move with the first step of the exact
    // route drawn on the board (computed by the same pathfinder). This makes
    // the affordance, the green visual, and the committed move one mechanism:
    // the snake always walks the path it shows.
    const gotoDir = this.getGotoRouteDirection(gameId, snakeId);
    if (gotoDir) {
      return { direction: gotoDir, source: 'waypoint' };
    }

    if (controlled?.botRecommendation) {
      // If a waypoint is set but its route is unusable this turn (target
      // unreachable, or route head not adjacent after a divergence), fall back
      // to the bot recommendation — which the board-evaluator still biases
      // toward the waypoint — but keep the 'waypoint' label so the source
      // matches the snake's active intent mode and renders in the user's colour.
      const source: IntendedMoveSource = controlled.waypoint ? 'waypoint' : 'bot';
      return { direction: controlled.botRecommendation, source };
    }

    return { direction: 'up', source: 'fallback' };
  }

  // Returns the move direction for the first step of the snake's live goto
  // route (the rendered green path), or null when waypoint mode isn't active,
  // the route is empty, or its head isn't adjacent to the current head (stale
  // route / divergence — caller falls back to the biased bot recommendation).
  private getGotoRouteDirection(gameId: string, snakeId: string): Direction | null {
    const game = this.games.get(gameId);
    if (!game?.boardState) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled || controlled.activeIntentMode !== 'waypoint') return null;
    if (!controlled.gotoRoute || controlled.gotoRoute.length === 0) return null;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const head = snake?.head || snake?.body?.[0];
    if (!head) return null;
    return ActiveGameManager.directionFromTo(head, controlled.gotoRoute[0]);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Single transition point for the active intent mode. Setting a mode clears
  // the state backing the OTHER three sources so exactly one is ever live:
  //   - leaving 'queue'    clears premoveQueue
  //   - leaving 'waypoint' clears waypoint + gotoRoute
  //   - leaving 'manual'   clears this turn's manual user selection
  // Callers set the new mode's own state (queue cells, waypoint cell, manual
  // selection) around this call; this helper never populates, only clears.
  private transitionIntentMode(gameId: string, snakeId: string, controlled: ControlledSnake, mode: IntentMode): void {
    if (mode !== 'queue' && controlled.premoveQueue.length > 0) {
      controlled.premoveQueue = [];
    }
    if (mode !== 'waypoint') {
      controlled.waypoint = null;
      controlled.gotoRoute = [];
    }
    if (mode !== 'manual') {
      const pending = controlled.pendingMove;
      if (pending && !pending.resolved && pending.userSelectionSource === 'manual') {
        pending.userSelectedMove = null;
        pending.userSelectionSource = null;
      }
    }
    controlled.activeIntentMode = mode;
    // The active method changed, so the resolved staged move may have changed
    // too — re-derive and cache it through the single choke point.
    this.refreshStagedMove(gameId, snakeId);
  }

  // The single choke point that maintains the stored `stagedMove`. It runs the
  // existing computeIntendedMove precedence ONCE and caches the resolved
  // direction, so the deadline commit and the staged-arrow broadcast are pure
  // reads. Call this on every input change (turn start, intent-mode switch,
  // queue set, waypoint/route set, manual selection, bot completion while
  // heuristic). Never write `stagedMove` from anywhere else.
  private refreshStagedMove(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    controlled.stagedMove = this.computeIntendedMove(gameId, snakeId).direction;
  }

  getActiveIntentModesForGame(gameId: string): { [snakeId: string]: IntentMode } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: IntentMode } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      result[snakeId] = cs.activeIntentMode;
    }
    return result;
  }

  getRoutesForGame(gameId: string): { [snakeId: string]: Coord[] } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: Coord[] } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.gotoRoute && cs.gotoRoute.length > 0) {
        result[snakeId] = cs.gotoRoute;
      }
    }
    return result;
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
  // anchor. Only the immediate next cell is consulted; subsequent cells
  // are advanced one per turn by `advancePremoveQueueAfterMove`.
  //
  // The queue is anchored at the PROJECTED head — the cell the snake will
  // occupy after any move already committed this turn — matching where the
  // path is rendered (drawPremoveOverlay) and where the client authors the
  // queue (addPremoveCellAt). Pre-commit the projected head equals the live
  // head, so this is identical to measuring from the live head in the common
  // case; it only differs when a move is already committed this turn.
  private getPremoveDirection(gameId: string, snakeId: string): Direction | null {
    const game = this.games.get(gameId);
    if (!game?.boardState) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled || controlled.premoveQueue.length === 0) return null;
    const anchor = this.getProjectedHead(gameId, snakeId);
    if (!anchor) return null;
    return ActiveGameManager.directionFromTo(anchor, controlled.premoveQueue[0]);
  }

  // Called after every resolved move to keep the queue in lock-step with the
  // actual snake position. If the move matches the planned next cell, pop it.
  // If it diverged (manual override, fallback move, etc.), abandon the plan —
  // the snake is now somewhere the queue can't reach, so the rest is stale.
  //
  // Anchoring + tolerance contract (matches the renderer and the client):
  // this runs AFTER resolvePendingMove set moveCommittedThisTurn/committedMove,
  // so getProjectedHead() returns the cell the snake will occupy this turn —
  // its real resulting position. Three outcomes, measured against that cell:
  //   1. DRAIN   — projected head == queue[0]: we stepped onto the planned
  //                cell, so pop it. If the queue is now empty, fall back to
  //                the heuristic (the plan is genuinely exhausted).
  //   2. HOLD    — projected head != queue[0] but is still adjacent to it
  //                (the bot/safety-timer covered a turn the queue couldn't
  //                resolve — a transient race or momentary non-adjacency).
  //                Keep the queue and the 'queue' mode untouched; next turn the
  //                live head equals this projected head, so the queue resolves
  //                again. This is the single-ambiguous-turn tolerance.
  //   3. CLEAR   — projected head is neither queue[0] nor adjacent to it: the
  //                snake's real position is provably off the planned path (true
  //                divergence). Abandon the plan and revert to the heuristic.
  private advancePremoveQueueAfterMove(gameId: string, snakeId: string, move: Direction): void {
    const game = this.games.get(gameId);
    if (!game?.boardState) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled || controlled.premoveQueue.length === 0) return;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const liveHead = snake?.head || snake?.body?.[0];
    const projected = this.getProjectedHead(gameId, snakeId);
    if (!projected) return;
    const next = controlled.premoveQueue[0];
    const headInfo = `liveHead=(${liveHead?.x},${liveHead?.y}) projectedHead=(${projected.x},${projected.y}) queueHead=(${next.x},${next.y}) move=${move}`;

    if (projected.x === next.x && projected.y === next.y) {
      controlled.premoveQueue.shift();
      // Queue drained → no source left, fall back to the heuristic.
      if (controlled.premoveQueue.length === 0 && controlled.activeIntentMode === 'queue') {
        console.log(`[ActiveGameManager] Premove queue drained for ${gameId}:${snakeId}: ${headInfo}`);
        this.transitionIntentMode(gameId, snakeId, controlled, 'heuristic');
      } else {
        console.log(`[ActiveGameManager] Premove queue advanced for ${gameId}:${snakeId}: ${headInfo}, ${controlled.premoveQueue.length} remaining`);
      }
    } else if (ActiveGameManager.directionFromTo(projected, next) !== null) {
      // Still adjacent to the plan head — a single ambiguous turn the bot
      // covered. Hold the queue; it resumes next turn from the projected head.
      console.log(`[ActiveGameManager] Premove queue held (bot covered one turn) for ${gameId}:${snakeId}: ${headInfo}, ${controlled.premoveQueue.length} retained`);
    } else {
      console.log(`[ActiveGameManager] Premove queue diverged for ${gameId}:${snakeId}: ${headInfo}, clearing`);
      controlled.premoveQueue = [];
      if (controlled.activeIntentMode === 'queue') {
        this.transitionIntentMode(gameId, snakeId, controlled, 'heuristic');
      }
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
    // Starting/replacing a queue activates Queue mode (clearing waypoint and
    // any manual selection). Emptying it falls back to the heuristic.
    if (sanitized.length > 0) {
      this.transitionIntentMode(gameId, snakeId, controlled, 'queue');
    } else if (controlled.activeIntentMode === 'queue') {
      this.transitionIntentMode(gameId, snakeId, controlled, 'heuristic');
    } else {
      this.refreshStagedMove(gameId, snakeId);
    }
    return true;
  }

  setPendingMove(gameId: string, snakeId: string, res: Response, gameTimeout: number, serverExpiryTime: number | null = null, turn: number = 0): PendingMove {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`Game ${gameId} not registered`);

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) throw new Error(`Snake ${snakeId} not controlled in game ${gameId}`);

    if (controlled.pendingMove && !controlled.pendingMove.resolved) {
      // Commit is a pure read of the stored staged move (no recomputation):
      // at this point stagedMove still holds the previous turn's resolved move
      // since this turn's board hasn't been processed yet.
      const move = controlled.stagedMove;
      console.log(`[ActiveGameManager] Previous-turn-cleanup for ${gameId}:${snakeId}: using ${move}`);
      this.resolvePendingMove(gameId, snakeId, move, 'previous-turn-cleanup');
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
          // The deadline is now the SOLE commit path for every snake (selected
          // or not). It commits by reading the already-stored stagedMove — no
          // recomputation — which refreshStagedMove has kept current through
          // every input change this turn (queue head, waypoint route, manual
          // selection, or the bot's recommendation while heuristic).
          const move = controlled.stagedMove;
          const heldNote = controlled.holdTurnsRemaining > 0 ? ` [held ${controlled.holdTurnsRemaining}]` : '';
          console.log(`[ActiveGameManager] Safety timer fired for ${gameId}:${snakeId}${heldNote}: using ${move} (mode: ${controlled.activeIntentMode}, selectedBy=${controlled.selectedBy})`);
          this.resolvePendingMove(gameId, snakeId, move, 'safety-timer');
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
  // Move-source priority for a controlled snake. Exactly one method is active
  // at a time (activeIntentMode); computeIntendedMove resolves it to a single
  // direction and refreshStagedMove caches that into `stagedMove`:
  //   1. Manual user selection         — setUserSelection (marks
  //                                      pending.userSelectionSource='manual'
  //                                      and clears the queue; this is the
  //                                      "manual override drops the plan"
  //                                      contract)
  //   2. Queued premove (queue head)   — getPremoveDirection, applied
  //                                      identically to selected AND
  //                                      unselected snakes.
  //   3. Goto route head (waypoint)    — first step of the rendered green path
  //   4. Bot recommendation            — the heuristic default
  //   5. Hard fallback                 — literal 'up' if nothing else available
  //
  // Every controlled snake (selected or not) stays staged until its per-snake
  // safety timer fires at the turn deadline — the sole commit path. The only
  // exception is the armed-suicide explicit kill.
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

      for (const [sid, cs] of game.controlledSnakes) {
        cs.moveCommittedThisTurn = false;
        cs.committedMove = null;
        if (cs.holdTurnsRemaining > 0) {
          cs.holdTurnsRemaining = Math.max(0, cs.holdTurnsRemaining - 1);
        }
        // Manual is a single-turn intent: a manual selection only applies to
        // the turn it was made on. With no carried-over selection, the snake
        // reverts to the heuristic. Queue and waypoint are multi-turn intents
        // and persist across turns. Route this through the single transition
        // point so the stale manual selection is cleared and the staged move is
        // re-derived (queue/waypoint are already empty while in manual mode, so
        // nothing multi-turn is lost).
        if (cs.activeIntentMode === 'manual') {
          this.transitionIntentMode(gameId, sid, cs, 'heuristic');
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
    // Store the bot's freshly-computed goto route (head → green waypoint). It
    // arrives empty unless a green waypoint is set and reachable, so this also
    // clears a stale route once the target is gone.
    controlled.gotoRoute = turnData.gotoRoute ?? [];

    if (controlled.pendingMove && !controlled.pendingMove.resolved) {
      controlled.pendingMove.botMove = move;
      controlled.pendingMove.turnData = turnData;
    }

    // Turn start: now that the new board state is stored, re-derive every
    // controlled snake's staged move so queue heads / waypoint routes anchor
    // to the fresh head positions. Heuristic snakes other than this one keep
    // last turn's bot recommendation until their own /move arrives and the
    // guard below refreshes them.
    if (boardUpdated) {
      for (const sid of game.controlledSnakes.keys()) {
        this.refreshStagedMove(gameId, sid);
      }
    }

    // Per-snake staged refresh on /move completion. computeIntendedMove (run by
    // refreshStagedMove) already enforces source precedence
    // (manual > queue > waypoint > bot), so re-deriving here can NOT let a late
    // bot result override a human-chosen move — it only folds in the fields that
    // just arrived for THIS snake:
    //   - heuristic: the fresh botRecommendation stored above
    //   - waypoint : the fresh gotoRoute stored above — this is the fix; a snake
    //                that isn't the turn-advancer never hits the boardUpdated
    //                refresh pass, so without this its staged move went stale
    //                against the new route and the deadline commit could diverge
    //   - queue    : re-anchors the queue head against the new board state
    // Manual is the one exception: its staged move was set explicitly by the
    // user's Space action and is single-turn, so a late bot result leaves it
    // untouched.
    if (controlled.activeIntentMode !== 'manual') {
      this.refreshStagedMove(gameId, snakeId);
    }

    // The armed-suicide path is a deliberate explicit-kill exception to the
    // deadline-only commit model: it resolves the move immediately. Every
    // other snake (selected or not) now stays staged until its safety timer.
    if (controlled.suicideArmed && controlled.pendingMove && !controlled.pendingMove.resolved) {
      const suicideMove = computeSuicideMove(turnData.gameState);
      console.log(`[ActiveGameManager] SUICIDE: submitting ${suicideMove} for ${gameId}:${snakeId} (turn ${incomingTurn})`);
      controlled.suicideArmed = false;
      this.resolvePendingMove(gameId, snakeId, suicideMove, 'suicide');
    }

    if (boardUpdated) {
      this.notifyBoardUpdate(gameId, turnData.gameState);
    }
    this.notifyTurnUpdate(gameId, snakeId, turnData);
  }

  // Stage a user's manual selection as the snake's next move. This is the
  // "manual override drops the plan" contract: it activates Manual mode
  // (clearing the queue + waypoint) and refreshes the stored stagedMove via
  // transitionIntentMode. Staging never commits — the move is finalized only
  // when the per-snake safety timer fires at the turn deadline.
  setUserSelection(gameId: string, snakeId: string, move: Direction): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled?.pendingMove || controlled.pendingMove.resolved) return;

    controlled.pendingMove.userSelectedMove = move;
    controlled.pendingMove.userSelectionSource = 'manual';
    this.transitionIntentMode(gameId, snakeId, controlled, 'manual');
    console.log(`[ActiveGameManager] User staged move for ${gameId}:${snakeId}: ${move} (mode: ${controlled.activeIntentMode}, turn ${game.currentTurn}, not yet committed)`);
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
        controlled.gotoRoute = [];
        if (controlled.activeIntentMode === 'waypoint') {
          this.transitionIntentMode(gameId, snakeId, controlled, 'heuristic');
        }
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

    // Re-anchor the green goto route at the cell we'll occupy after this
    // committed move, so the rendered path — and next turn's first step —
    // start from there instead of the now-stale head.
    this.recomputeGotoRoute(gameId, snakeId);

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
