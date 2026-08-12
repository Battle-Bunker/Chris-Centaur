import { GameState, BoardSnapshot, Direction, Coord } from '../types/battlesnake';
import { BoardEvaluator } from '../logic/board-evaluator';
import { BoardGraph } from '../logic/board-graph';
import { CellOwnership } from '../logic/multi-source-bfs';
import { DecisionLogger } from '../logic/decision-logger';

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
  // Per-cell Voronoi owner/distance for the current board (cell inspector).
  // Absent on the quick pass and interim recommendations.
  cellOwnership?: CellOwnership;
}

// The write-through publisher for staged moves. Firestore is the single
// source of truth for what is staged: EVERY staging action (bot
// recommendation, manual selection, queue step, waypoint step, revert to
// heuristic, suicide) funnels through stageMove, which invokes this submitter
// so the staged move is immediately represented in Firebase. The game server
// resolves each turn with the last staged move it received before the turn
// deadline — nothing on this side commits automatically.
export type MoveSubmitter = (
  gameId: string,
  snakeId: string,
  turn: number,
  move: Direction,
  source: IntendedMoveSource
) => Promise<void>;

// The optional HUMAN-triggered "done" signal (Submit All): marks one snake as
// finished for the turn in Firebase (moveStatuses.movedPlayerIDs), letting the
// game server resolve the turn early once EVERY alive player has committed.
// Never invoked automatically — only from an explicit user action. The staged
// move itself is unaffected: whatever is staged at resolution time is what
// plays, and a commit is irreversible for the turn.
export type MoveCommitter = (
  gameId: string,
  snakeId: string,
  turn: number
) => Promise<void>;

export type IntendedMoveSource = 'manual' | 'queue' | 'waypoint' | 'bot' | 'fallback';

// ── Fatal-move consent brand ────────────────────────────────────────────────
// A branded value proving a HUMAN explicitly consented to staging a
// certain-death move. There are exactly TWO mint points, both server-side and
// both inside this module (the symbol and mint function are deliberately NOT
// exported, so no other code path can forge consent):
//   1. confirmFatalMove — the dialog-accept message handler's entry point,
//      which re-validates fatality server-side before minting.
//   2. The kill-all / armed-suicide path, which is deliberate death by design.
// The brand rides on the manual intent, flows through computeIntendedMove into
// stageMove (the single staged-move writer), which refuses to stage an
// unconsented human certain-death move and falls back to the bot's move.
declare const fatalConsentBrand: unique symbol;
export type FatalMoveConsent = { readonly [fatalConsentBrand]: true };
function mintFatalMoveConsent(): FatalMoveConsent {
  return Object.freeze({}) as FatalMoveConsent;
}

export interface IntendedMove {
  direction: Direction;
  source: IntendedMoveSource;
  // Present only when a manual intent carries fatal-move consent.
  consent?: FatalMoveConsent;
}

// A controlled snake's resolved next move, bound as one atomic value to the
// (snakeId, turn) it was computed for. Written only by `stageMove`, replaced as
// a whole (its fields are readonly — never mutate one in place), and accepted at
// commit only through `stagedMoveForTurn`, which honours it solely when both the
// snake and turn align. `null` means there is no staged move for the snake.
export interface StagedMove {
  readonly snakeId: string;
  readonly turn: number;
  readonly move: Direction;
  readonly source: IntendedMoveSource;
  // True when this move carried explicit fatal-move consent (the user confirmed
  // the certain-death dialog, or used kill-all). Recorded onto the decision log
  // at commit so replays can distinguish a deliberate death from a bot mistake.
  readonly fatalConsented: boolean;
}

// A controlled snake's intention: ONE discriminated union, so two sources can
// never be populated at once (mutual exclusion is structural, not enforced by
// clearing logic). Set only through `setIntent`, which re-stages the move.
//  - heuristic: no user direction — the bot's recommendation drives the move
//  - manual:    the user picked a specific next move (single-turn; reset each turn)
//  - queue:     a multi-step premove path executing one cell per turn (persists)
//  - waypoint:  a click-target biasing the bot toward a cell (persists); green
//               'goto' carries a live `route`, blue 'near' leaves it empty
export type SnakeIntent =
  | { kind: 'heuristic' }
  | { kind: 'manual'; move: Direction; fatalConsent?: FatalMoveConsent }
  | { kind: 'queue'; cells: Coord[] }
  | { kind: 'waypoint'; style: 'green' | 'blue'; target: Coord; route: Coord[] };

// The active next-move source, exposed to clients as `activeIntentModes`. Mirrors
// the union's discriminant so the client contract is unchanged.
export type IntentMode = SnakeIntent['kind'];

export interface SnakeInfo {
  id: string;
  name: string;
  letter: string;
}

export interface ControlledSnake {
  id: string;
  name: string;
  letter: string;
  latestTurnData: TurnData | null;
  botRecommendation: Direction | null;
  selectedBy: string | null;
  // Persistent ownership: the last player to select this snake. Unlike
  // `selectedBy` (the single active selection, cleared on deselect/switch),
  // ownership persists after the player selects a different snake, drives the
  // on-board player-name tag, Tab cycling, and the takeover confirmation.
  // Survives disconnects (like name enrolments) so a reconnecting player keeps
  // their snakes.
  ownedBy: string | null;
  suicideArmed: boolean;
  // The snake's intention — the single source of truth for queue cells, the
  // waypoint + its live goto route, the manual selection, and the active mode.
  // Set only through `setIntent`. The client-facing projections (premoves,
  // waypoints, routes, activeIntentModes) are derived from this.
  intent: SnakeIntent;
  // The snake's REQUESTED move — the last move the active intent resolved to,
  // bound to its (snakeId, turn). Written only by `stageMove`, which starts
  // the publish-until-confirmed pipeline (`ensureStagedPublished`) so the
  // request lands in Firebase, the authoritative staged-move store. Shown to
  // clients as the ghost arrow whenever it differs from `confirmedStaged`.
  staged: StagedMove | null;
  // The staged move Firebase has CONFIRMED for this snake (from the
  // interface's privateMoves read-back listener): the latest server-acked
  // write for the turn. This is what the game server will actually play if
  // the turn ends now — clients render it as the solid arrow. The pipeline
  // re-publishes until this matches the requested move.
  confirmedStaged: { turn: number; move: Direction } | null;
  // The FINAL move Firebase selected for the turn, known at turn finalization
  // (deadline passed, or every alive player committed) — before the next
  // board arrives. Drives the client's double (committed) arrow.
  finalMove: { turn: number; move: Direction } | null;
  // In-flight marker for the publish pipeline: the (turn, move) last handed
  // to the submitter, so an unconfirmed request isn't re-published on every
  // event, only when the backstop retry decides it was lost.
  lastSubmittedTurn: number | null;
  lastSubmittedMove: Direction | null;
  // Backstop retry for the publish pipeline (single-shot, re-armed while the
  // confirmed staged move differs from the requested one).
  stagingRetryTimer: NodeJS.Timeout | null;
  // Dedupe for the manual Submit All commit: the turn this snake was last
  // marked done for, so repeated clicks don't spam moveStatuses writes.
  // Commitment is BINDING (Firestore rules freeze a committed snake's staged
  // move), so this also gates staging: no re-stage for a committed turn.
  lastCommittedTurn: number | null;
  // Submit All arrived while the requested move was still unconfirmed: the
  // commit is deferred and fires automatically the moment Firebase confirms
  // the requested move, so the frozen move is always the one the user asked
  // for. Cancelled if the user re-stages a different move first.
  pendingCommitTurn: number | null;
  // Dedupe for the fatal-move confirmation prompt: the (turn, move) we last
  // asked the user to confirm, so repeated re-stages within the same turn
  // don't spam the dialog.
  fatalPromptTurn: number | null;
  fatalPromptMove: Direction | null;
}

export interface ConnectedUser {
  userId: string;
  // The player's enrolled name — mandatory, unique per game, chosen on the
  // login screen before entering an active game. Keys the stable colour.
  name: string;
  color: string;
  selectedSnakeId: string | null;
}

// A per-game name enrolment: who owns the name and its stable colour.
// Enrolments live for the whole game (never released on disconnect) so the
// name→colour mapping — and uniqueness — is stable for the game's lifetime.
interface PlayerEnrolment {
  userId: string;
  name: string;
  color: string;
}

export type EnrolResult =
  | { user: ConnectedUser }
  | { error: 'name-taken' | 'invalid-name' };

export interface ActiveGame {
  gameId: string;
  // The engine-server session this game belongs to (set by the Firebase
  // interface after registration). Used to build links to the game on the
  // engine server; null until known.
  sessionId: string | null;
  boardState: BoardSnapshot | null;
  boardStateTurn: number;
  snakes: Map<string, SnakeInfo>;
  controlledSnakes: Map<string, ControlledSnake>;
  connectedUsers: Map<string, ConnectedUser>;
  gameTimeout: number;
  startedAt: number;
  lastActivityAt: number;
  // Name enrolments keyed by the lowercased name. An enrolment is created the
  // first time a name subscribes and lives for the whole game — uniqueness and
  // the name-keyed colour are therefore stable across disconnect/reconnect.
  playerNames: Map<string, PlayerEnrolment>;
  turnExpiryTime: number | null;
  currentTurn: number;
  // The centaur identity we play as in this game (setup team whose id ==
  // configured centaur id). Set by the Firebase interface at registration;
  // null when unknown (e.g. legacy games).
  ourTeam: { id: string; name: string; color: string } | null;
}

const DISTINCT_COLORS = [
  '#008080', '#f58231', '#ffe119', '#bfef45',
  '#3cb44b', '#42d4f4', '#9a6324', '#911eb4',
  '#f032e6',
];

export type TurnUpdateCallback = (gameId: string, snakeId: string, turnData: TurnData) => void;
export type BoardUpdateCallback = (gameId: string, gameState: GameState) => void;
export type MoveCommittedCallback = (gameId: string, snakeId: string, move: Direction, source: string) => void;
export type GameListChangeCallback = (event: 'added' | 'removed' | 'updated', gameId: string, snakeId: string) => void;
export type GameEndCallback = (gameId: string, snakeId: string, finalGameState: GameState, gameOver: boolean) => void;
// Fired (coalesced once per event-loop tick) whenever any controlled snake's
// staged move / intent changed, so the WS layer can push the staged-arrow +
// intent projections without each mutation site broadcasting explicitly.
export type StagedChangeCallback = (gameId: string) => void;
// Fired when a human-sourced staged move was blocked by the fatal-move consent
// gate — the client should show the confirmation dialog for (snakeId, move).
export type FatalConfirmationCallback = (gameId: string, snakeId: string, move: Direction, turn: number) => void;

export class ActiveGameManager {
  private static instance: ActiveGameManager;
  private games: Map<string, ActiveGame> = new Map();
  private turnUpdateCallbacks: TurnUpdateCallback[] = [];
  private boardUpdateCallbacks: BoardUpdateCallback[] = [];
  private moveCommittedCallbacks: MoveCommittedCallback[] = [];
  private gameListChangeCallbacks: GameListChangeCallback[] = [];
  private gameEndCallbacks: GameEndCallback[] = [];
  private stagedChangeCallbacks: StagedChangeCallback[] = [];
  private fatalConfirmationCallbacks: FatalConfirmationCallback[] = [];
  // Games whose staged move changed since the last flush. Coalesced into one
  // notification per event-loop tick so a burst of stageMove calls within a
  // single operation broadcasts at most once.
  private stagedDirtyGames: Set<string> = new Set();
  private stagedFlushScheduled: boolean = false;
  private gameServerPing: number = 50;
  private pingInterval: NodeJS.Timer | null = null;
  private staleGameCleanupInterval: NodeJS.Timer | null = null;
  // Used to compute a green waypoint's goto route the moment it's set, so the
  // path shows immediately instead of waiting for the next turn.
  private routeEvaluator: BoardEvaluator = new BoardEvaluator();
  // Write-through publisher for staged moves (see MoveSubmitter). Firestore is
  // the single source of truth for staged moves; until a submitter is wired,
  // staging actions log an error instead of silently staying local.
  private moveSubmitter: MoveSubmitter | null = null;
  // Publisher for the human-triggered Submit All "done" signal. Optional and
  // never invoked automatically.
  private moveCommitter: MoveCommitter | null = null;

  private constructor() {}

  setMoveSubmitter(submitter: MoveSubmitter | null): void {
    this.moveSubmitter = submitter;
  }

  setMoveCommitter(committer: MoveCommitter | null): void {
    this.moveCommitter = committer;
  }

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

  onStagedChange(callback: StagedChangeCallback): void {
    this.stagedChangeCallbacks.push(callback);
  }

  onFatalConfirmationNeeded(callback: FatalConfirmationCallback): void {
    this.fatalConfirmationCallbacks.push(callback);
  }

  private notifyFatalConfirmationNeeded(gameId: string, snakeId: string, move: Direction, turn: number): void {
    for (const cb of this.fatalConfirmationCallbacks) {
      try {
        cb(gameId, snakeId, move, turn);
      } catch (e) {
        console.error('Error in fatal confirmation callback:', e);
      }
    }
  }

  // Mark a game's staged move as changed. Coalesces a burst of stageMove calls
  // (e.g. setIntent → stageMove, or per-snake re-staging) into a single
  // notification per event-loop tick. Uses setImmediate().unref() so a pending
  // flush never keeps the process alive on its own.
  private notifyStagedChange(gameId: string): void {
    this.stagedDirtyGames.add(gameId);
    if (this.stagedFlushScheduled) return;
    this.stagedFlushScheduled = true;
    setImmediate(() => {
      this.stagedFlushScheduled = false;
      const dirty = Array.from(this.stagedDirtyGames);
      this.stagedDirtyGames.clear();
      for (const id of dirty) {
        for (const cb of this.stagedChangeCallbacks) {
          try {
            cb(id);
          } catch (e) {
            console.error('Error in staged change callback:', e);
          }
        }
      }
    }).unref();
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
      // Only measure ping while games are actually running. A truly idle
      // server must generate zero background network traffic, or the
      // autoscale platform may never consider the instance quiescent.
      if (this.games.size === 0) return;
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
    // Keep the ping running for the whole process lifetime (simplest, and the
    // measured ping stays warm for when a game registers), but unref it so this
    // short-cycle timer never keeps the Node event loop alive on its own. That
    // lets the autoscale instance go genuinely idle and drain to zero once all
    // games and users are gone.
    if (typeof (this.pingInterval as any).unref === 'function') {
      (this.pingInterval as any).unref();
    }
    console.log('[ActiveGameManager] Server ping interval started (30s, unref\'d)');
  }

  registerGame(gameState: GameState, ourTeam?: { id: string; name: string; color: string } | null): void {
    const gameId = gameState.game.id;
    const snakeId = gameState.you.id;

    let game = this.games.get(gameId);
    if (!game) {
      const now = Date.now();
      game = {
        gameId,
        sessionId: null,
        boardState: gameState,
        boardStateTurn: gameState.turn || 0,
        snakes: new Map(),
        controlledSnakes: new Map(),
        connectedUsers: new Map(),
        gameTimeout: gameState.game.timeout || 500,
        startedAt: now,
        lastActivityAt: now,
        playerNames: new Map(),
        turnExpiryTime: null,
        currentTurn: gameState.turn || 0,
        ourTeam: ourTeam ?? null,
      };
      this.games.set(gameId, game);
    }
    if (ourTeam && !game.ourTeam) game.ourTeam = ourTeam;

    for (const snake of gameState.board.snakes) {
      if (!game.snakes.has(snake.id)) {
        game.snakes.set(snake.id, {
          id: snake.id,
          name: snake.name,
          letter: snake.letter || '',
        });
      }
    }

    if (!game.controlledSnakes.has(snakeId)) {
      console.log(`[ActiveGameManager] Registering controlled snake: ${gameId}:${snakeId} (${gameState.you.name})`);
      game.controlledSnakes.set(snakeId, {
        id: snakeId,
        name: gameState.you.name,
        letter: gameState.you.letter || '',
        latestTurnData: null,
        botRecommendation: null,
        selectedBy: null,
        ownedBy: null,
        suicideArmed: false,
        intent: { kind: 'heuristic' },
        staged: null,
        confirmedStaged: null,
        finalMove: null,
        lastSubmittedTurn: null,
        lastSubmittedMove: null,
        stagingRetryTimer: null,
        lastCommittedTurn: null,
        pendingCommitTurn: null,
        fatalPromptTurn: null,
        fatalPromptMove: null,
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
      // Duplicate end signal for a snake we've already cleaned up. Don't
      // re-fire events that would bounce the UI; just no-op.
      console.log(`[ActiveGameManager] endGame for already-removed snake ${gameId}:${snakeId}, ignoring`);
      return;
    }

    // The end signal carries the actual final game state, which can be ahead
    // of the last turn we processed for this snake (other snakes kept playing
    // after ours died). Push it through the normal board-update pipeline so
    // the centaur paints the real final position instead of freezing on
    // whatever turn our snake last acted in.
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
    console.log(
      `[ActiveGameManager] endGame ${gameId}:${snakeId} processed — acceptedFinalState=${acceptedFinalState}, controlledSnakesRemaining=${game.controlledSnakes.size}, gameOver=${gameOver}`,
    );
    // Only emit snake-ended when the final state is fresh enough to apply.
    // A stale /end shouldn't rewind the UI's rendered turn.
    if (finalGameState && acceptedFinalState) {
      this.notifyGameEnd(gameId, snakeId, finalGameState, gameOver);
    }

    if (gameOver) {
      console.log(`[ActiveGameManager] All controlled snakes ended for game ${gameId}, removing game`);
      this.games.delete(gameId);
      this.logIfFullyIdle();
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

    // The contested check is on OWNERSHIP, not just the active selection: a
    // snake owned by another player requires the takeover confirmation even
    // when that player has since selected a different snake.
    if (controlled.ownedBy && controlled.ownedBy !== userId) {
      if (!force) {
        return { success: false, contestedBy: controlled.ownedBy };
      }
      const previousUserId = controlled.ownedBy;
      const previousUser = game.connectedUsers.get(previousUserId);
      const hadSelection = controlled.selectedBy === previousUserId;
      if (previousUser && hadSelection) {
        previousUser.selectedSnakeId = null;
      }
      controlled.selectedBy = userId;
      controlled.ownedBy = userId;
      user.selectedSnakeId = snakeId;
      return { success: true, revokedUserId: hadSelection ? previousUserId : undefined };
    }

    controlled.selectedBy = userId;
    // Selecting implicitly adds the snake to the player's owned set.
    controlled.ownedBy = userId;
    user.selectedSnakeId = snakeId;
    return { success: true };
  }

  suicideAllSnakes(gameId: string): { affected: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { affected: [] };

    const affected: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      affected.push(snakeId);

      const gameState = controlled.latestTurnData?.gameState;
      if (gameState) {
        const move = computeSuicideMove(gameState);
        console.log(`[ActiveGameManager] SUICIDE: staging ${move} for ${gameId}:${snakeId}`);
        // Kill-all is the second fatal-consent mint point: stage the suicide
        // move WITH consent so it flows through the single staged-move writer
        // (and its gate). The write-through submitter publishes it to Firebase
        // where it becomes the snake's staged move for the turn.
        this.setIntent(gameId, snakeId, { kind: 'manual', move, fatalConsent: mintFatalMoveConsent() });
      } else {
        // No turn data yet — arm, and the next turn's staging pass fires it.
        controlled.suicideArmed = true;
      }
    }
    if (affected.length > 0) {
      console.log(`[ActiveGameManager] SUICIDE staged/armed for game ${gameId}: ${affected.join(', ')}`);
    }
    return { affected };
  }

  // Submit All: the human-triggered "we're done this turn" signal. Commitment
  // is BINDING — Firestore rules freeze a committed snake's staged move for
  // the turn — so a snake is only committed once the move Firebase has
  // CONFIRMED is the requested one; committing earlier could freeze a stale
  // move mid-flight. Snakes whose request is still unconfirmed get a pending
  // commit that fires automatically the moment their confirmation lands
  // (setConfirmedStagedMove), keeping Submit All one click without ever
  // freezing the wrong move. Never called automatically.
  commitAllStaged(gameId: string): { affected: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { affected: [] };

    const affected: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      const staged = controlled.staged;
      // Only commit snakes staged for the current turn — a stale record means
      // this snake's decision for the new turn hasn't landed yet, and
      // committing it would mark "done" on a move that no longer applies.
      if (!staged || staged.turn !== game.boardStateTurn) continue;
      if (controlled.lastCommittedTurn === staged.turn) continue;
      affected.push(snakeId);

      const confirmed =
        controlled.confirmedStaged?.turn === staged.turn &&
        controlled.confirmedStaged.move === staged.move;
      if (confirmed) {
        this.commitSnakeNow(gameId, snakeId, controlled, staged.turn);
      } else if (controlled.pendingCommitTurn !== staged.turn) {
        controlled.pendingCommitTurn = staged.turn;
        console.log(`[ActiveGameManager] COMMIT deferred for ${gameId}:${snakeId} turn ${staged.turn} — waiting for Firebase to confirm ${staged.move}`);
      }
    }
    if (affected.length > 0) {
      console.log(`[ActiveGameManager] COMMIT-ALL for game ${gameId} turn ${game.boardStateTurn}: ${affected.join(', ')}`);
    }
    return { affected };
  }

  private commitSnakeNow(
    gameId: string,
    snakeId: string,
    controlled: ControlledSnake,
    turn: number
  ): void {
    if (controlled.lastCommittedTurn === turn) return;
    controlled.lastCommittedTurn = turn;
    controlled.pendingCommitTurn = null;

    if (this.moveCommitter) {
      this.moveCommitter(gameId, snakeId, turn).catch((err) => {
        console.error(`[ActiveGameManager] Failed to publish commit for ${gameId}:${snakeId} turn ${turn}:`, err);
        // Allow a retry on the next Submit All for this turn.
        if (controlled.lastCommittedTurn === turn) {
          controlled.lastCommittedTurn = null;
        }
      });
    } else {
      console.error(`[ActiveGameManager] No move committer wired — commit for ${gameId}:${snakeId} NOT published`);
    }
  }

  // Per-snake ownership snapshot broadcast to every client: the owning
  // player's id, name and colour (or null). Name/colour come from the live
  // connected user when present, else from the game-lifetime name enrolment
  // (ownership survives disconnects the same way enrolments do).
  getOwnersForGame(gameId: string): { [snakeId: string]: { userId: string; name: string; color: string } | null } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const out: { [snakeId: string]: { userId: string; name: string; color: string } | null } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (!cs.ownedBy) {
        out[snakeId] = null;
        continue;
      }
      const user = game.connectedUsers.get(cs.ownedBy);
      let name = user?.name;
      let color = user?.color;
      if (!name) {
        for (const enrolment of game.playerNames.values()) {
          if (enrolment.userId === cs.ownedBy) {
            name = enrolment.name;
            color = enrolment.color;
            break;
          }
        }
      }
      out[snakeId] = { userId: cs.ownedBy, name: name || 'Player', color: color || '#888888' };
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
      console.log(`[ActiveGameManager] Snake deselected ${gameId}:${snakeId} (turn ${game.currentTurn}), staged move=${controlled.staged?.move || 'none'} (${controlled.staged?.source || '-'}) — Firebase keeps the last staged move`);
    }
    user.selectedSnakeId = null;
  }

  /**
   * Enrol an operator into an active game under a mandatory, per-game-unique
   * player name. This is the single, race-safe uniqueness check: the enrolment
   * map is consulted and written synchronously here, so two tabs racing the
   * same name can never both win — the second gets `name-taken`.
   *
   * Reconnects are recognised by userId: the same userId re-subscribing with
   * its enrolled name reclaims the enrolment (and its stable colour) exactly.
   * Enrolments are never released for the lifetime of the game.
   */
  addConnectedUser(gameId: string, userId: string, name: string): EnrolResult | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const trimmed = (name || '').trim().substring(0, 20);
    // Defense in depth against markup injection: names are letters, digits,
    // spaces and a few safe punctuation marks only (output encoding on the
    // client remains mandatory regardless).
    if (!trimmed || !/^[\p{L}\p{N} _.\-']+$/u.test(trimmed)) {
      return { error: 'invalid-name' };
    }
    const key = trimmed.toLowerCase();

    const existing = game.playerNames.get(key);
    if (existing && existing.userId !== userId) {
      return { error: 'name-taken' };
    }

    // If this userId was previously enrolled under a DIFFERENT name (e.g. it
    // re-subscribed after picking a new name), keep the old enrolment parked —
    // enrolments are game-lifetime — but the connected user reflects the name
    // used now.
    const enrolment: PlayerEnrolment = existing || {
      userId,
      name: trimmed,
      color: this.colorForName(game, trimmed),
    };
    game.playerNames.set(key, enrolment);

    const prior = game.connectedUsers.get(userId);
    if (prior && prior.name === enrolment.name) return { user: prior };

    const user: ConnectedUser = {
      userId,
      name: enrolment.name,
      color: enrolment.color,
      selectedSnakeId: prior?.selectedSnakeId ?? null,
    };
    game.connectedUsers.set(userId, user);
    return { user };
  }

  /**
   * Names currently enrolled in a game (for the login screen's pre-check).
   * Pass the asking user's id to exclude their OWN enrolments — the server
   * allows the same userId to reclaim its name on reconnect, so the client
   * must not treat its own cookie-prefilled name as taken.
   */
  getEnrolledNames(gameId: string, excludeUserId?: string): string[] {
    const game = this.games.get(gameId);
    if (!game) return [];
    return Array.from(game.playerNames.values())
      .filter((e) => !excludeUserId || e.userId !== excludeUserId)
      .map((e) => e.name);
  }

  // Deterministic name-keyed colour: hash the lowercased name into the
  // distinct-colour set, then linearly probe past colours already held by
  // OTHER enrolled names so concurrent players stay visually distinct while
  // the same name always re-derives the same starting point. Once assigned,
  // the colour is stored on the enrolment and never changes for the game.
  private colorForName(game: ActiveGame, name: string): string {
    const key = name.toLowerCase();
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    }
    const used = new Set(Array.from(game.playerNames.values()).map((e) => e.color));
    const n = DISTINCT_COLORS.length;
    for (let i = 0; i < n; i++) {
      const candidate = DISTINCT_COLORS[(hash + i) % n];
      if (!used.has(candidate)) return candidate;
    }
    // All colours taken — accept the hash slot (collision unavoidable).
    return DISTINCT_COLORS[hash % n];
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

    game.connectedUsers.delete(userId);
    // The name enrolment (and its colour) is deliberately NOT released — it is
    // stable for the whole game, so a reconnect under the same name/userId
    // reclaims the identical colour.
  }

  getGame(gameId: string): ActiveGame | undefined {
    return this.games.get(gameId);
  }

  // Record which engine-server session a game belongs to (called by the
  // Firebase interface, which is the only component that knows it).
  setGameSession(gameId: string, sessionId: string): void {
    const game = this.games.get(gameId);
    if (game && game.sessionId !== sessionId) {
      game.sessionId = sessionId;
      this.notifyGameListChange('updated', gameId, '');
    }
  }

  getActiveGames(): Array<{
    gameId: string;
    sessionId: string | null;
    controlledSnakes: Array<{ id: string; name: string; letter: string }>;
    turn: number;
    gameState: GameState | null;
    startedAt: number;
    ourTeam: { id: string; name: string; color: string } | null;
  }> {
    const result: Array<any> = [];
    for (const game of this.games.values()) {
      const snakes: Array<{ id: string; name: string; letter: string }> = [];
      for (const cs of game.controlledSnakes.values()) {
        snakes.push({ id: cs.id, name: cs.name, letter: cs.letter });
      }
      result.push({
        gameId: game.gameId,
        sessionId: game.sessionId,
        controlledSnakes: snakes,
        turn: game.currentTurn,
        gameState: game.boardState,
        startedAt: game.startedAt,
        ourTeam: game.ourTeam,
      });
    }
    return result;
  }

  getGameState(gameId: string): {
    boardState: BoardSnapshot | null;
    controlledSnakes: Array<{
      id: string; name: string; letter: string;
      selectedBy: string | null;
      turnData: TurnData | null;
      botRecommendation: Direction | null;
    }>;
    connectedUsers: Array<ConnectedUser>;
    selections: { [snakeId: string]: { userId: string; color: string } | null };
    owners: { [snakeId: string]: { userId: string; name: string; color: string } | null };
    premoves: { [snakeId: string]: Coord[] };
    waypoints: { [snakeId: string]: { type: 'green' | 'blue'; x: number; y: number } };
    gameTimeout: number;
    turnExpiryTime: number | null;
    measuredPing: number;
  } | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const controlledSnakes: Array<{
      id: string; name: string; letter: string;
      selectedBy: string | null;
      turnData: TurnData | null;
      botRecommendation: Direction | null;
    }> = [];
    const selections: { [snakeId: string]: { userId: string; color: string } | null } = {};

    for (const cs of game.controlledSnakes.values()) {
      controlledSnakes.push({
        id: cs.id,
        name: cs.name,
        letter: cs.letter,
        selectedBy: cs.selectedBy,
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
      owners: this.getOwnersForGame(gameId),
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
    if (controlled?.intent.kind !== 'waypoint') return null;
    return { type: controlled.intent.style, x: controlled.intent.target.x, y: controlled.intent.target.y };
  }

  getWaypointsForGame(gameId: string): { [snakeId: string]: { type: 'green' | 'blue'; x: number; y: number } } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: { type: 'green' | 'blue'; x: number; y: number } } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.intent.kind === 'waypoint') {
        result[snakeId] = { type: cs.intent.style, x: cs.intent.target.x, y: cs.intent.target.y };
      }
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
      // Clearing only applies while in waypoint mode; otherwise leave the
      // current intent (queue/manual/heuristic) untouched and just re-stage.
      if (controlled.intent.kind === 'waypoint') {
        this.setIntent(gameId, snakeId, { kind: 'heuristic' });
      } else {
        this.stageMove(gameId, snakeId);
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

    // Compute the green goto route now so the path renders immediately rather
    // than only after the next /move. Build a GameState whose `you` is THIS
    // snake so BoardGraph applies the right invulnerability/severability rules
    // (boardState.you is whichever snake last sent /move, which may differ).
    const route = this.computeGotoRouteNow(
      game.boardState,
      snakeId,
      { type: waypoint.type, x, y },
      this.getProjectedHead(gameId, snakeId) ?? undefined
    );
    // Setting a waypoint activates Waypoint mode (replacing queue/manual).
    this.setIntent(gameId, snakeId, { kind: 'waypoint', style: waypoint.type, target: { x, y }, route });
    return true;
  }

  // The shared `game.boardState` is a BoardSnapshot with NO `you` — a single
  // shared board cannot have a meaningful "our snake" while many snakes are
  // controlled at once. Any perspective-dependent logic (BoardGraph
  // invulnerability/severability, route finding) MUST obtain a per-snake
  // GameState through this helper, which re-points `you` to the requested snake
  // by ID. Returns null when the snake isn't on the board. This is the only
  // sanctioned way to turn the shared snapshot into a GameState; reading `.you`
  // off the snapshot directly is a compile error by design.
  private viewFor(snapshot: BoardSnapshot, snakeId: string): GameState | null {
    const you = snapshot.board.snakes.find(s => s.id === snakeId);
    if (!you) return null;
    return { ...snapshot, you };
  }

  // Synchronously compute the green goto route from the latest shared board
  // state. Returns [] for blue/null waypoints or when there's no board state.
  private computeGotoRouteNow(
    boardState: BoardSnapshot | null,
    snakeId: string,
    waypoint: { type: 'green' | 'blue'; x: number; y: number } | null,
    startHead?: Coord
  ): Coord[] {
    if (!boardState || !waypoint || waypoint.type !== 'green') return [];
    const gsForRoute = this.viewFor(boardState, snakeId);
    if (!gsForRoute) return [];
    return this.routeEvaluator.computeWaypointRoute(gsForRoute, snakeId, waypoint, startHead);
  }

  // Recompute and store the green goto route anchored at the snake's projected
  // head (the cell it will occupy after any move already committed this turn).
  // No-op unless the snake is actively in waypoint mode with a green waypoint.
  private recomputeGotoRoute(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    if (controlled.intent.kind !== 'waypoint') return;
    controlled.intent.route = this.computeGotoRouteNow(
      game.boardState,
      snakeId,
      { type: controlled.intent.style, x: controlled.intent.target.x, y: controlled.intent.target.y },
      this.getProjectedHead(gameId, snakeId) ?? undefined
    );
  }

  getPremovesForGame(gameId: string): { [snakeId: string]: Coord[] } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: Coord[] } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.intent.kind === 'queue' && cs.intent.cells.length > 0) {
        result[snakeId] = cs.intent.cells;
      }
    }
    return result;
  }

  // The anchor cell for all "next turn" rendering: Q-mode adjacency,
  // candidate-arrow cells, queue-extension click targets. Nothing commits
  // mid-turn anymore (the game server resolves the turn from the last staged
  // move at its deadline), so the anchor is simply the snake's live head.
  getProjectedHead(gameId: string, snakeId: string): Coord | null {
    const game = this.games.get(gameId);
    if (!game?.boardState) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return null;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    return snake?.head || snake?.body?.[0] || null;
  }

  private static destinationOf(head: Coord, move: Direction): Coord {
    switch (move) {
      case 'up':    return { x: head.x,     y: head.y + 1 };
      case 'down':  return { x: head.x,     y: head.y - 1 };
      case 'left':  return { x: head.x - 1, y: head.y     };
      case 'right': return { x: head.x + 1, y: head.y     };
    }
  }

  // Non-mutating safety probe. Reports whether `move` would put THIS snake's
  // head on an impassable cell next turn — off-board, wall/hazard, our own
  // body, or a non-severable enemy body — evaluated from the committing snake's
  // OWN perspective via passabilityIdxFor(snakeId), so an invulnerable snake
  // attacking a weaker enemy is correctly NOT fatal. Uses optimistic turn-1
  // semantics, the same the goto-route and space BFS use, so a step onto a tail
  // that vacates this turn is not flagged.
  //
  // This NEVER changes the committed move. The staged move is sacrosanct and
  // commits verbatim; this exists solely so the UI can warn a human that the
  // move they staged is certain death.
  private isMoveFatal(gameId: string, snakeId: string, move: Direction): boolean {
    const game = this.games.get(gameId);
    // After /end the stored boardState can be a final payload with no `board`
    // (scores/winners only), so a UI staged-move hint has nothing to evaluate.
    if (!game?.boardState?.board?.snakes) return false;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const head = snake?.head || snake?.body?.[0];
    if (!head) return false;
    try {
      const dest = ActiveGameManager.destinationOf(head, move);

      // Own-tail refinement: if the staged move steps onto our OWN tail and
      // that cell has no food, then by definition we are NOT eating this turn,
      // so no speculative "could eat" may keep the tail in place. The tail
      // vacates unless the snake just ate (head already on food) — or, under
      // grow-next-turn, the body is too short for the tail to move. The tail
      // cell must be uniquely the tail (not stacked under an interior segment
      // from a just-completed growth) for this shortcut to apply.
      const body = snake?.body || [];
      const tail = body[body.length - 1];
      const isOwnTail = !!tail && dest.x === tail.x && dest.y === tail.y && body.length > 2;
      const tailStacked = isOwnTail &&
        body.slice(1, -1).some(seg => seg.x === tail.x && seg.y === tail.y);
      const food = game.boardState.board.food || [];
      const destHasFood = food.some(f => f.x === dest.x && f.y === dest.y);
      if (isOwnTail && !tailStacked && !destHasFood) {
        const justAte = food.some(f => f.x === head.x && f.y === head.y);
        return justAte;
      }

      const graph = new BoardGraph(game.boardState);
      if (!graph.isInBounds(dest)) return true;
      return !graph.passabilityIdxFor(snakeId, { clearance: 'optimistic' })
        .passableIdx(graph.cellIndexOf(dest), 1);
    } catch (e) {
      // A UI hint must never throw on the broadcast path — treat as not-fatal.
      console.error(`[ActiveGameManager] isMoveFatal failed for ${gameId}:${snakeId}:`, e);
      return false;
    }
  }

  // Public: is this snake's currently staged move certain death? Drives the
  // red "fatal staged move" marker in the centaur UI. Pure read — no mutation,
  // no effect on what is staged.
  isStagedMoveFatal(gameId: string, snakeId: string): boolean {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    const move = controlled?.staged?.move;
    if (!move) return false;
    return this.isMoveFatal(gameId, snakeId, move);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Derives "what move this snake intends this turn" from the active intent
  // method. This is NOT read at commit time — stageMove runs it once per input
  // change and binds the result into `staged`, which is the single record the
  // safety-timer commit and the staged-arrow broadcast read.
  //
  // Priority follows the snake's intention (a single discriminated union, so
  // only one of manual/queue/waypoint can be populated at once):
  //   1. manual user selection (this turn)
  //   2. queue head (adjacent to current head)
  //   3. goto route head (first step of the rendered green waypoint route)
  //   4. bot recommendation
  //   5. hard fallback ('up')
  // ────────────────────────────────────────────────────────────────────────
  computeIntendedMove(gameId: string, snakeId: string): IntendedMove {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    const intent = controlled?.intent;

    if (intent?.kind === 'manual') {
      return { direction: intent.move, source: 'manual', consent: intent.fatalConsent };
    }

    if (intent?.kind === 'queue') {
      const premoveDir = this.getPremoveDirection(gameId, snakeId);
      if (premoveDir) {
        return { direction: premoveDir, source: 'queue' };
      }
    }

    // Waypoint mode HARD-OVERRIDES the move with the first step of the exact
    // route drawn on the board (computed by the same pathfinder). This makes
    // the affordance, the green visual, and the committed move one mechanism:
    // the snake always walks the path it shows.
    if (intent?.kind === 'waypoint') {
      const gotoDir = this.getGotoRouteDirection(gameId, snakeId);
      if (gotoDir) {
        return { direction: gotoDir, source: 'waypoint' };
      }
    }

    if (controlled?.botRecommendation) {
      // Anything that reaches here is the bot's recommendation — manual, queue,
      // and the goto-route head were all unavailable this turn. Report it
      // truthfully as 'bot' even when a waypoint/queue is nominally set, so the
      // staged arrow renders grey and the user can never mistake a bot decision
      // for their own staged move (the disguised-'waypoint' label was Bug A).
      // The route/queue/manual fallback is logged at the stageMove choke
      // point where the active intent mode is known.
      return { direction: controlled.botRecommendation, source: 'bot' };
    }

    return { direction: 'up', source: 'fallback' };
  }

  // Returns the move direction for the first step of the snake's live goto
  // route (the rendered green path), or null when waypoint mode isn't active,
  // the route is empty, or its head isn't adjacent to the anchor (stale route /
  // divergence — caller falls back to the biased bot recommendation).
  //
  // The route is anchored at the PROJECTED head (recomputeGotoRoute /
  // computeGotoRouteNow both pass getProjectedHead as startHead), so the first
  // step MUST be measured from that same projected head — not the live head.
  // Pre-commit projected head == live head, so this is identical in the common
  // case; it only differs after a move is already committed this turn, which is
  // exactly when measuring from the live head returned null and silently
  // abandoned the green route the snake was displaying.
  private getGotoRouteDirection(gameId: string, snakeId: string): Direction | null {
    const game = this.games.get(gameId);
    if (!game?.boardState) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled || controlled.intent.kind !== 'waypoint') return null;
    if (controlled.intent.route.length === 0) return null;
    const anchor = this.getProjectedHead(gameId, snakeId);
    if (!anchor) return null;
    const target = controlled.intent.route[0];
    if (this.isStepBehindAnchor(gameId, snakeId, target)) {
      console.warn(`[ActiveGameManager] Stale goto route for ${gameId}:${snakeId}: first cell (${target.x},${target.y}) is the just-vacated neck — refusing 180° reversal, falling back to bot`);
      return null;
    }
    return ActiveGameManager.directionFromTo(anchor, target);
  }

  // The cell the snake occupied immediately BEFORE the anchor cell that queue
  // and goto-route steps are measured from — the snake's neck. Stepping onto
  // this cell is by definition a 180° reversal into the snake's own
  // just-vacated cell (certain death by the game rules), so it can never be a
  // valid queue/route step — adjacency alone is NOT sufficient validity.
  private cellBehindAnchor(gameId: string, snakeId: string): Coord | null {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game?.boardState?.board?.snakes || !controlled) return null;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const head = snake?.head || snake?.body?.[0];
    if (!head) return null;
    const neck = snake?.body?.[1];
    if (neck && (neck.x !== head.x || neck.y !== head.y)) {
      return neck;
    }
    return null;
  }

  private isStepBehindAnchor(gameId: string, snakeId: string, target: Coord): boolean {
    const behind = this.cellBehindAnchor(gameId, snakeId);
    return !!behind && behind.x === target.x && behind.y === target.y;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Single write point for a snake's intention. Replacing the union as a whole
  // is the mutual exclusion: the new intent structurally supersedes whatever
  // queue/waypoint/manual state the old one held — no field-by-field clearing.
  // Always re-stages the move so `staged` and the broadcast arrow track it.
  private setIntent(gameId: string, snakeId: string, intent: SnakeIntent): void {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    const previous = controlled.intent;
    if (previous.kind === 'manual' && intent.kind !== 'manual') {
      // A still-staged manual selection is being dropped before it committed
      // (e.g. the user set a queue/waypoint).
      // Log it so a manual move never silently disappears mid-turn.
      console.log(`[ActiveGameManager] Manual selection ${previous.move} for ${gameId}:${snakeId} cleared (intent → ${intent.kind})`);
    }
    controlled.intent = intent;
    this.stageMove(gameId, snakeId);
  }

  // The sole writer of `staged`: resolves the active intent to one Direction via
  // computeIntendedMove and binds it to the current (snakeId, turn) as one atomic
  // record. Call on every input change (turn start, intent-mode switch, queue or
  // waypoint set, manual selection, bot completion while heuristic). The deadline
  // commit and the staged-arrow broadcast only ever read `staged`.
  private stageMove(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    const previous = controlled.staged;
    const intended = this.computeIntendedMove(gameId, snakeId);
    const turn = game!.boardStateTurn;

    // Commitment is binding: Firestore rules reject staged writes for a
    // committed snake, so once this turn is committed the staged record is
    // frozen — intent changes still land but only apply from the next turn.
    if (controlled.lastCommittedTurn === turn) {
      console.log(`[ActiveGameManager] Staging frozen for ${gameId}:${snakeId} turn ${turn} (committed) — ${intended.source} ${intended.direction} not staged`);
      return;
    }

    // ── Fatal-move consent gate ─────────────────────────────────────────
    // A HUMAN-sourced certain-death move (manual click, queue step, waypoint
    // step) may only be staged when it carries a minted FatalMoveConsent.
    // Without consent we stage the bot's move instead and ask the client to
    // show a confirmation dialog. Bot-sourced moves are exempt: when the bot
    // itself picks a fatal move there is no better alternative to offer.
    let direction = intended.direction;
    let source = intended.source;
    const humanSourced = source === 'manual' || source === 'queue' || source === 'waypoint';
    if (humanSourced && !intended.consent && this.isMoveFatal(gameId, snakeId, direction)) {
      const fallback = controlled.botRecommendation;
      console.warn(`[ActiveGameManager] FATAL-MOVE GATE for ${gameId}:${snakeId} turn ${turn}: unconsented ${source} move ${direction} is certain death — staging ${fallback ? `bot move ${fallback}` : `fallback 'up'`} instead, awaiting confirmation`);
      if (controlled.fatalPromptTurn !== turn || controlled.fatalPromptMove !== direction) {
        controlled.fatalPromptTurn = turn;
        controlled.fatalPromptMove = direction;
        this.notifyFatalConfirmationNeeded(gameId, snakeId, direction, turn);
      }
      if (fallback) {
        direction = fallback;
        source = 'bot';
      } else {
        direction = 'up';
        source = 'fallback';
      }
    }

    // A new request supersedes a not-yet-fired deferred commit: the user is
    // no longer "done" with the move they submitted.
    if (controlled.pendingCommitTurn === turn && previous?.move !== direction) {
      console.log(`[ActiveGameManager] Deferred commit for ${gameId}:${snakeId} turn ${turn} cancelled — new staging ${direction} supersedes it`);
      controlled.pendingCommitTurn = null;
    }

    controlled.staged = {
      snakeId,
      turn,
      move: direction,
      source,
      // Consent only counts when the consented move is the one actually staged
      // (the gate above may have replaced it with the bot fallback).
      fatalConsented: !!intended.consent && direction === intended.direction,
    };
    this.logReversalTripwire(gameId, controlled, direction, source);
    this.logStagedMoveAnomalies(gameId, controlled, previous, intended);

    // Publish-until-confirmed: hand the requested move to the pipeline, which
    // writes it to Firebase and re-publishes until the read-back confirmation
    // matches. Firebase is the single source of truth for staged moves.
    this.ensureStagedPublished(gameId, snakeId);

    // Reactive sync: every stage (the single point all intent changes funnel
    // through) marks the game dirty so the staged arrow + intent projections
    // are pushed to clients, coalesced to once per event-loop tick.
    this.notifyStagedChange(gameId);
  }

  private static readonly STAGING_RETRY_MS = 1000;

  // The publish-until-confirmed pipeline. Invoked on every stage (the request
  // changed), on every Firebase confirmation update (to detect mismatches),
  // and from its own backstop timer. Terminates when the confirmed staged
  // move matches the requested one, or when the board has moved past the
  // requested turn (the snake's next stage re-enters the pipeline).
  private ensureStagedPublished(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    const requested = controlled.staged;
    if (!requested) return;

    const clearRetry = () => {
      if (controlled.stagingRetryTimer) {
        clearTimeout(controlled.stagingRetryTimer);
        controlled.stagingRetryTimer = null;
      }
    };

    // The board moved past this request — stop; it can never be confirmed
    // (the read-back listener for its turn is gone) and no longer matters.
    if (game.boardStateTurn > requested.turn) {
      clearRetry();
      return;
    }

    // The turn already finalized — Firebase picked its move; late publishes
    // can't change anything.
    if (controlled.finalMove?.turn === requested.turn) {
      clearRetry();
      return;
    }

    // Committed this turn — the rules now reject staged writes for this
    // snake, so publishing (or retrying) is pointless.
    if (controlled.lastCommittedTurn === requested.turn) {
      clearRetry();
      return;
    }

    // Firebase confirms the requested move — the pipeline is done.
    if (
      controlled.confirmedStaged?.turn === requested.turn &&
      controlled.confirmedStaged.move === requested.move
    ) {
      clearRetry();
      return;
    }

    const alreadySubmitted =
      controlled.lastSubmittedTurn === requested.turn &&
      controlled.lastSubmittedMove === requested.move;
    if (!alreadySubmitted) {
      controlled.lastSubmittedTurn = requested.turn;
      controlled.lastSubmittedMove = requested.move;
      if (this.moveSubmitter) {
        this.moveSubmitter(gameId, snakeId, requested.turn, requested.move, requested.source).catch((err) => {
          console.error(`[ActiveGameManager] Failed to publish staged move for ${gameId}:${snakeId} turn ${requested.turn}:`, err);
          // Clear the in-flight marker so the backstop republishes.
          if (
            controlled.lastSubmittedTurn === requested.turn &&
            controlled.lastSubmittedMove === requested.move
          ) {
            controlled.lastSubmittedTurn = null;
            controlled.lastSubmittedMove = null;
          }
        });
      } else {
        console.error(`[ActiveGameManager] No move submitter wired — staged move for ${gameId}:${snakeId} turn ${requested.turn} NOT published`);
      }
    }

    // Backstop: if Firebase hasn't confirmed the requested move by the next
    // tick, treat the write as lost and republish.
    clearRetry();
    const timer = setTimeout(() => {
      const cs = this.games.get(gameId)?.controlledSnakes.get(snakeId);
      if (!cs || cs.stagingRetryTimer !== timer) return;
      cs.stagingRetryTimer = null;
      const req = cs.staged;
      if (!req) return;
      if (cs.confirmedStaged?.turn === req.turn && cs.confirmedStaged.move === req.move) return;
      console.warn(`[ActiveGameManager] Staged move for ${gameId}:${snakeId} turn ${req.turn} (${req.move}) still unconfirmed — republishing`);
      cs.lastSubmittedTurn = null;
      cs.lastSubmittedMove = null;
      this.ensureStagedPublished(gameId, snakeId);
    }, ActiveGameManager.STAGING_RETRY_MS);
    timer.unref?.();
    controlled.stagingRetryTimer = timer;
  }

  // Whether this snake has a requested move for `turn` that Firebase has not
  // yet confirmed. Used by the interface's default-move inference: a commit
  // observed while a request is still unconfirmed must WAIT (the in-flight
  // write would beat the engine default), whereas a commit with no request
  // at all resolves to the deterministic default immediately.
  hasUnconfirmedRequest(gameId: string, snakeId: string, turn: number): boolean {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    const requested = controlled?.staged;
    if (!controlled || !requested || requested.turn !== turn) return false;
    return !(
      controlled.confirmedStaged?.turn === turn &&
      controlled.confirmedStaged.move === requested.move
    );
  }

  // Fed by the Firebase read-back listener: the latest server-acked staged
  // move for (snakeId, turn). Broadcast to clients as the solid arrow, and
  // used by the pipeline to decide whether the request needs republishing.
  setConfirmedStagedMove(gameId: string, snakeId: string, turn: number, move: Direction): void {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    if (controlled.confirmedStaged?.turn === turn && controlled.confirmedStaged.move === move) return;
    controlled.confirmedStaged = { turn, move };
    this.ensureStagedPublished(gameId, snakeId);

    // A deferred Submit All fires the moment the requested move is the
    // confirmed one — the freeze then provably locks the user's move.
    if (
      controlled.pendingCommitTurn === turn &&
      controlled.staged?.turn === turn &&
      controlled.staged.move === move
    ) {
      console.log(`[ActiveGameManager] Deferred commit firing for ${gameId}:${snakeId} turn ${turn} (${move} confirmed)`);
      this.commitSnakeNow(gameId, snakeId, controlled, turn);
    }

    this.notifyStagedChange(gameId);
  }

  // Fed by the Firebase interface when — and ONLY when — this snake's commit
  // is actually recorded in Firebase (the snake appears in
  // moveStatuses.movedPlayerIDs) and its confirmed staged move is known from
  // the read-back. Never inferred from timers or the turn expiry: the double
  // arrow is a report of observed Firebase state, nothing else. Turns that
  // resolve by timeout without a commit simply never show it.
  finalizeTurnMove(gameId: string, snakeId: string, turn: number, move: Direction): void {
    const controlled = this.games.get(gameId)?.controlledSnakes.get(snakeId);
    if (!controlled) return;
    if (controlled.finalMove?.turn === turn) return;
    if (controlled.stagingRetryTimer) {
      clearTimeout(controlled.stagingRetryTimer);
      controlled.stagingRetryTimer = null;
    }
    controlled.finalMove = { turn, move };
    this.notifyMoveCommitted(gameId, snakeId, move, 'firebase-final');
    this.notifyStagedChange(gameId);
  }

  // Permanent tripwire: a staged move whose destination is the snake's own
  // neck (the just-vacated cell) is a guaranteed 180° self-collision. This
  // should now be impossible for human-sourced moves (consent gate + neck
  // guards), so any hit is a bug worth a full state dump — or a deliberate
  // kill-all. Log-only; never alters the staged move.
  private logReversalTripwire(gameId: string, controlled: ControlledSnake, move: Direction, source: IntendedMoveSource): void {
    const game = this.games.get(gameId);
    const snake = game?.boardState?.board?.snakes?.find(s => s.id === controlled.id);
    const head = snake?.head || snake?.body?.[0];
    const neck = snake?.body?.[1];
    if (!head || !neck || (neck.x === head.x && neck.y === head.y)) return;
    const dest = ActiveGameManager.destinationOf(head, move);
    if (dest.x !== neck.x || dest.y !== neck.y) return;
    console.warn(`[ActiveGameManager] REVERSAL TRIPWIRE for ${gameId}:${controlled.id}: staged ${source} move ${move} steps onto own neck. State: ${JSON.stringify({
      turn: game?.boardStateTurn,
      move,
      source,
      head,
      neck,
      projectedHead: this.getProjectedHead(gameId, controlled.id),
      intent: controlled.intent,
      staged: controlled.staged,
      suicideArmed: controlled.suicideArmed,
    })}`);
  }

  // Surfaces the two previously-silent failure modes whenever a move is staged:
  // a human intent that silently fell back to the bot's move, and a manual
  // selection that changed direction or origin within the same turn.
  private logStagedMoveAnomalies(gameId: string, controlled: ControlledSnake, previous: StagedMove | null, intended: IntendedMove): void {
    const resolvedToBot = intended.source === 'bot' || intended.source === 'fallback';
    if (controlled.intent.kind !== 'heuristic' && resolvedToBot) {
      console.log(`[ActiveGameManager] Intent fallback for ${gameId}:${controlled.id}: intent=${controlled.intent.kind} could not be honoured this turn → committing ${intended.source} move ${intended.direction}`);
    }
    if (previous?.source === 'manual' && (intended.source !== 'manual' || intended.direction !== previous.move)) {
      console.log(`[ActiveGameManager] Staged move changed for ${gameId}:${controlled.id} within turn ${previous.turn}: was manual ${previous.move} → now ${intended.source} ${intended.direction}`);
    }
  }

  getActiveIntentModesForGame(gameId: string): { [snakeId: string]: IntentMode } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: IntentMode } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      result[snakeId] = cs.intent.kind;
    }
    return result;
  }

  getRoutesForGame(gameId: string): { [snakeId: string]: Coord[] } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: Coord[] } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.intent.kind === 'waypoint' && cs.intent.route.length > 0) {
        result[snakeId] = cs.intent.route;
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
    if (!controlled || controlled.intent.kind !== 'queue' || controlled.intent.cells.length === 0) return null;
    const anchor = this.getProjectedHead(gameId, snakeId);
    if (!anchor) return null;
    const target = controlled.intent.cells[0];
    // Adjacency alone is not validity: a retained queue cell can be the cell
    // the snake just vacated (its neck), and deriving a direction onto it is a
    // guaranteed 180° self-collision. Refuse it; the caller falls back to bot.
    if (this.isStepBehindAnchor(gameId, snakeId, target)) {
      console.warn(`[ActiveGameManager] Stale premove queue for ${gameId}:${snakeId}: first cell (${target.x},${target.y}) is the just-vacated neck — refusing 180° reversal, falling back to bot`);
      return null;
    }
    return ActiveGameManager.directionFromTo(anchor, target);
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
    if (!controlled || controlled.intent.kind !== 'queue' || controlled.intent.cells.length === 0) return;
    const cells = controlled.intent.cells;
    const snake = game.boardState.board.snakes.find(s => s.id === snakeId);
    const liveHead = snake?.head || snake?.body?.[0];
    // Called when a turn resolves, BEFORE the new board is applied: the cell
    // the snake lands on is the live head plus the move the server resolved.
    const projected = liveHead ? ActiveGameManager.destinationOf(liveHead, move) : null;
    if (!projected) return;
    const next = cells[0];
    const headInfo = `liveHead=(${liveHead?.x},${liveHead?.y}) projectedHead=(${projected.x},${projected.y}) queueHead=(${next.x},${next.y}) move=${move}`;

    if (projected.x === next.x && projected.y === next.y) {
      cells.shift();
      // Queue drained → no source left, fall back to the heuristic.
      if (cells.length === 0) {
        console.log(`[ActiveGameManager] Premove queue drained for ${gameId}:${snakeId}: ${headInfo}`);
        this.setIntent(gameId, snakeId, { kind: 'heuristic' });
      } else {
        console.log(`[ActiveGameManager] Premove queue advanced for ${gameId}:${snakeId}: ${headInfo}, ${cells.length} remaining`);
        this.stageMove(gameId, snakeId);
      }
    } else if (liveHead && next.x === liveHead.x && next.y === liveHead.y) {
      // The queue's next cell is the cell we are LEAVING this turn. Holding it
      // would make next turn's derived direction a 180° reversal into our own
      // just-vacated neck (this was the root cause of real reversal deaths).
      // The plan points backwards → it is stale, not "one ambiguous turn".
      console.log(`[ActiveGameManager] Premove queue points backwards for ${gameId}:${snakeId}: ${headInfo}, clearing`);
      this.setIntent(gameId, snakeId, { kind: 'heuristic' });
    } else if (ActiveGameManager.directionFromTo(projected, next) !== null) {
      // Still adjacent to the plan head — a single ambiguous turn the bot
      // covered. Hold the queue; it resumes next turn from the projected head.
      console.log(`[ActiveGameManager] Premove queue held (bot covered one turn) for ${gameId}:${snakeId}: ${headInfo}, ${cells.length} retained`);
    } else {
      console.log(`[ActiveGameManager] Premove queue diverged for ${gameId}:${snakeId}: ${headInfo}, clearing`);
      this.setIntent(gameId, snakeId, { kind: 'heuristic' });
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
    // Starting/replacing a queue activates Queue mode (replacing waypoint and
    // any manual selection). Emptying it falls back to the heuristic.
    if (sanitized.length > 0) {
      this.setIntent(gameId, snakeId, { kind: 'queue', cells: sanitized });
    } else if (controlled.intent.kind === 'queue') {
      this.setIntent(gameId, snakeId, { kind: 'heuristic' });
    } else {
      this.stageMove(gameId, snakeId);
    }
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Move-source priority for a controlled snake. The intent union holds exactly
  // one source at a time; computeIntendedMove resolves it to a single direction
  // and stageMove binds that into `staged`:
  //   1. Manual user selection         — setUserSelection (sets a single-turn
  //                                      {kind:'manual'} intent, structurally
  //                                      superseding any queue/waypoint; this is
  //                                      the "manual override drops the plan"
  //                                      contract)
  //   2. Queued premove (queue head)   — getPremoveDirection, applied
  //                                      identically to selected AND
  //                                      unselected snakes.
  //   3. Goto route head (waypoint)    — first step of the rendered green path
  //   4. Bot recommendation            — the heuristic default
  //   5. Hard fallback                 — literal 'up' if nothing else available
  //
  // Every staging action write-through publishes to Firebase (see stageMove);
  // the game server resolves each turn with the last staged move it received
  // before the turn deadline. There is no commit step on this side.
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
            letter: snake.letter || '',
          });
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
    // Re-anchor the green goto route at the PROJECTED head from the freshly
    // stored board state — do NOT adopt the strategy's route, which is anchored
    // at the LIVE head. Everywhere else on the server (getGotoRouteDirection,
    // recomputeGotoRoute, the rendered path) anchors at the projected head; if
    // we stored a live-head route here, after a move is committed this turn its
    // first cell is no longer adjacent to the projected head, getGotoRouteDirection
    // returns null, and the snake silently reverts to the bot's straight move
    // while still displaying the green path (Bug B). recomputeGotoRoute uses the
    // same BFS, so it self-clears the route to [] when the target is gone/
    // unreachable, and is a no-op when not in waypoint mode.
    this.recomputeGotoRoute(gameId, snakeId);

    // Re-stage ONLY this snake on its OWN turn-data update, never the others
    // when the board advances: each controlled snake gets its own
    // setBotRecommendation call per turn, and re-staging it there keeps every
    // snake's staged record bound to its own decision. computeIntendedMove
    // keeps manual > queue > waypoint > bot precedence, so a same-turn manual
    // selection stays authoritative.
    //
    // Manual is single-turn: the staged record carries the turn the manual
    // selection was made for. If that turn is behind the current board turn the
    // selection is stale (it was for a prior turn) and reverts to the heuristic;
    // a manual selection made for THIS turn (staged turn == board turn, e.g. the
    // bot-compute-window race) stays authoritative and is re-derived below.
    const prevStagedTurn = controlled.staged?.turn ?? null;
    controlled.staged = null;
    if (controlled.intent.kind === 'manual' && prevStagedTurn !== game.boardStateTurn) {
      this.setIntent(gameId, snakeId, { kind: 'heuristic' });
    } else {
      this.stageMove(gameId, snakeId);
    }

    // Armed suicide: the kill was requested before this snake had turn data.
    // Stage the suicide move now (with consent, the second fatal-consent mint
    // point); the write-through publishes it to Firebase where it becomes the
    // staged move the server resolves at the deadline.
    if (controlled.suicideArmed) {
      const suicideMove = computeSuicideMove(turnData.gameState);
      console.log(`[ActiveGameManager] SUICIDE: staging ${suicideMove} for ${gameId}:${snakeId} (turn ${incomingTurn})`);
      controlled.suicideArmed = false;
      this.setIntent(gameId, snakeId, { kind: 'manual', move: suicideMove, fatalConsent: mintFatalMoveConsent() });
    }

    if (boardUpdated) {
      this.notifyBoardUpdate(gameId, turnData.gameState);
    }
    this.notifyTurnUpdate(gameId, snakeId, turnData);
  }

  // Stage a user's manual selection as the snake's next move. This is the
  // "manual override drops the plan" contract: it replaces the intent with a
  // single-turn manual intent (structurally superseding any queue/waypoint) and
  // re-stages the move via setIntent, which write-through publishes it to
  // Firebase. The game server finalizes the turn from the last staged move at
  // its deadline.
  setUserSelection(gameId: string, snakeId: string, move: Direction): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return;

    this.setIntent(gameId, snakeId, { kind: 'manual', move });
    console.log(`[ActiveGameManager] User staged move for ${gameId}:${snakeId}: ${move} (intent: ${controlled.intent.kind}, turn ${game.currentTurn})`);
  }

  // The dialog-accept entry point — the FIRST fatal-consent mint point. Called
  // by the WS layer when the controlling user confirmed the fatal-move dialog.
  // The client message carries only the claim; fatality is RE-validated here,
  // server-side, before consent is minted, and the consented manual intent is
  // set through the normal single-writer path (setIntent → stageMove), whose
  // write-through publishes the consented move to Firebase. A confirmation
  // arriving after the turn resolved server-side simply stages for the current
  // turn (the stale one is ignored by the game server). Returns whether the
  // move was staged.
  confirmFatalMove(gameId: string, snakeId: string, move: Direction, userId: string): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return false;
    if (controlled.selectedBy !== userId) return false;
    const stillFatal = this.isMoveFatal(gameId, snakeId, move);
    const consent = stillFatal ? mintFatalMoveConsent() : undefined;
    console.log(`[ActiveGameManager] User CONFIRMED ${stillFatal ? 'fatal' : 'no-longer-fatal'} move ${move} for ${gameId}:${snakeId} — staging with${consent ? '' : 'out'} consent`);
    this.setIntent(gameId, snakeId, { kind: 'manual', move, fatalConsent: consent });
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
      controlled.letter = gameState.you.letter || controlled.letter;
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
    if (controlled?.intent.kind === 'waypoint' && controlled.intent.style === 'green') {
      const wp = controlled.intent.target;
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
        this.setIntent(gameId, snakeId, { kind: 'heuristic' });
      }
    }
  }

  // Called by the transport when a turn has RESOLVED server-side (the next
  // turn's board arrived), with the moves the game server actually applied for
  // our controlled snakes on `resolvedTurn`. Must run BEFORE the new turn's
  // board state is fed in, so queue advancement measures from the old head.
  //
  // This replaces the old HTTP commit step for bookkeeping only — nothing is
  // submitted here. The server already resolved the turn from the last staged
  // move it received; we record what happened (decision log), advance premove
  // queues in lock-step with the actual move, and notify the UI.
  applyResolvedMoves(gameId: string, resolvedTurn: number, moves: { [snakeId: string]: Direction }): void {
    const game = this.games.get(gameId);
    if (!game) return;

    for (const [snakeId, move] of Object.entries(moves)) {
      const controlled = game.controlledSnakes.get(snakeId);
      if (!controlled) continue;

      // Persist the move the server applied onto this turn's decision row.
      // The move resolved board turn `resolvedTurn`, whose decision was logged
      // with decision_logs.turn = resolvedTurn + 1 (the logger records the turn
      // the move executes INTO), so that +1 is the update key. The consent flag
      // counts only when the staged record is bound to this exact turn and the
      // applied move matches it (otherwise it's a bot/fallback move).
      const staged = controlled.staged;
      const fatalConsented = !!staged && staged.snakeId === snakeId &&
        staged.turn === resolvedTurn && staged.move === move && staged.fatalConsented;
      DecisionLogger.getInstance().recordSubmittedMove(gameId, snakeId, resolvedTurn + 1, move, fatalConsented);

      // Keep the server-side premove queue in lock-step with the actual move.
      // This works for both selected (client-driven) and unselected
      // (auto-pilot) snakes — whoever drove the move, the queue advances or
      // clears based on what actually happened.
      this.advancePremoveQueueAfterMove(gameId, snakeId, move);

      // No move-committed notification here: the UI's double arrow is driven
      // by finalizeTurnMove, which fires when Firebase finalizes the turn —
      // earlier than this board-delta bookkeeping.
    }
  }

  // Emit a single, greppable "fully idle" line once the manager holds zero
  // active games and zero connected users. This is the signal the operator
  // watches for in deployment logs before expecting the instance to scale to
  // zero (the unref'd timers no longer keep the event loop alive at that point).
  private logIfFullyIdle(): void {
    if (this.games.size > 0) return;
    let totalUsers = 0;
    for (const game of this.games.values()) {
      totalUsers += game.connectedUsers.size;
    }
    if (totalUsers > 0) return;
    console.log('[ActiveGameManager] Manager is now fully idle (no active games, no connected users) — instance can scale to zero');
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
          for (const [snakeId] of game.controlledSnakes) {
            this.notifyGameListChange('removed', gameId, snakeId);
          }
          this.games.delete(gameId);
          this.logIfFullyIdle();
        }
      }
    }, intervalMs);
    // Unref so this long-cycle timer doesn't keep the event loop alive on its
    // own, allowing the autoscale instance to drain to zero when idle.
    if (typeof (this.staleGameCleanupInterval as any).unref === 'function') {
      (this.staleGameCleanupInterval as any).unref();
    }
    console.log(`[ActiveGameManager] Stale-game cleanup interval started (every ${Math.round(intervalMs / 1000)}s, maxIdle ${Math.round(maxIdleMs / 1000)}s, unref'd)`);
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
