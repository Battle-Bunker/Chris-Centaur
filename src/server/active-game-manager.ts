import { GameState, BoardSnapshot, Direction, Coord } from '../types/battlesnake';
import { BoardGraph } from '../logic/board-graph';
import { pickBestMove } from '../logic/decision-engine';
import { DEFAULT_CONFIG } from '../config/game-config';
import {
  WaypointContext,
  waypointPath,
  waypointDistance,
  gotoProgressStat,
  nearProgressStat,
} from '../logic/waypoint-pathing';
import { CellOwnership } from '../logic/multi-source-bfs';
import { DecisionLogger } from '../logic/decision-logger';
import { CommandLogger, OperatorRef } from '../logic/command-logger';

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

export type IntendedMoveSource = 'manual' | 'waypoint' | 'bot' | 'fallback';

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
//  - goto:      a QUEUE of click-targets (green). targets[0] is active and is the
//               only one handed to the decision engine, where it biases the
//               heuristic matrix through a bounded progress stat — it never
//               overrides the move. Arriving shifts the queue; an emptied queue
//               reverts to heuristic. (This replaced the cell-by-cell premove
//               queue: a chain of goto targets expresses the same multi-step
//               plan, but every step is still arbitrated by the full matrix
//               instead of walked blindly.)
//  - near:      a single click-target (blue) biasing the matrix toward staying
//               close WITHOUT ever arriving. Never auto-clears.
//
// The TARGETS are the only durable state. Routes and stats are always
// recomputed from the live board — see ControlledSnake.gotoRoute.
export type SnakeIntent =
  | { kind: 'heuristic' }
  | { kind: 'manual'; move: Direction; fatalConsent?: FatalMoveConsent }
  | { kind: 'goto'; targets: Coord[] }
  | { kind: 'near'; target: Coord };

// The active next-move source, exposed to clients as `activeIntentModes`. Mirrors
// the union's discriminant so the client contract is unchanged.
export type IntentMode = SnakeIntent['kind'];

// Staged-move projection broadcast to clients (and snapshotted per turn by the
// command logger): the three-layer requested → confirmed → final pipeline plus
// the render colour/source and the fatal warning flag.
export interface StagedMoveView {
  move: string | null;
  requestedMove: string;
  committed: boolean;
  color: string;
  source: string;
  fatal: boolean;
}

// Everything a client (live or replay) needs to render the command state of a
// game's snakes, in exactly the shape the live WebSocket broadcast uses. The
// command logger persists one of these per (game, turn) when the turn
// resolves, so the history viewer replays command state through the same
// render paths as live play.
export interface CommandTurnState {
  stagedMoves: { [snakeId: string]: StagedMoveView };
  waypoints: { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } };
  routes: { [snakeId: string]: { cells: Coord[]; firstLeg: number } };
  activeIntentModes: { [snakeId: string]: IntentMode };
  owners: { [snakeId: string]: { userId: string; name: string; color: string } | null };
  // The operator whose command produced each snake's ACTIVE intent (null for
  // heuristic / bot-driven snakes). Unlike `owners` this tracks the command,
  // not the persistent snake ownership.
  operators: { [snakeId: string]: OperatorRef | null };
}

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
  // Who armed the pending suicide (kill-all before turn data existed), so the
  // deferred staging attributes to the right operator.
  suicideArmedBy: OperatorRef | null;
  // The snake's intention — the single source of truth for the goto/near
  // targets, the manual selection, and the active mode. Set only through
  // `setIntent`. The client-facing projections (waypoints, routes,
  // activeIntentModes) are derived from this.
  intent: SnakeIntent;
  // The operator whose command produced the CURRENT intent. Null while the
  // intent is heuristic (bot-driven). Preserved across server-side intent
  // transitions that continue the same command (goto arrival shifts), so
  // command attribution survives deselects and disconnects for as long as the
  // command is in force. Feeds the command log and the staged-arrow colour.
  intentBy: OperatorRef | null;
  // DERIVED display cache for the green goto path — deliberately NOT part of
  // the intent, because it is never durable state. Recomputed by
  // `refreshGotoRoute` on every stage: while a move is staged it is
  // [stagedDestination, ...shortestPath(stagedDestination → targets[0])]; once
  // the staged move is consumed it re-anchors as the plain shortest path from
  // the projected head. Empty whenever goto isn't active.
  gotoRoute: Coord[];
  // How many leading cells of `gotoRoute` belong to the FIRST leg (head →
  // targets[0]), including the staged step. Everything after this index is a
  // prediction that assumes each earlier target is reached, so the client draws
  // it faded. 0 when there is no route.
  gotoRouteFirstLeg: number;
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
        suicideArmedBy: null,
        intent: { kind: 'heuristic' },
        intentBy: null,
        gotoRoute: [],
        gotoRouteFirstLeg: 0,
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

  suicideAllSnakes(gameId: string, byUserId?: string): { affected: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { affected: [] };

    const operator = this.operatorFor(game, byUserId);
    const affected: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      affected.push(snakeId);

      const gameState = controlled.latestTurnData?.gameState;
      if (gameState) {
        const move = computeSuicideMove(gameState);
        console.log(`[ActiveGameManager] SUICIDE: staging ${move} for ${gameId}:${snakeId}`);
        this.logCommandEvent(gameId, snakeId, 'suicide', operator, { move });
        // Kill-all is the second fatal-consent mint point: stage the suicide
        // move WITH consent so it flows through the single staged-move writer
        // (and its gate). The write-through submitter publishes it to Firebase
        // where it becomes the snake's staged move for the turn.
        this.setIntent(gameId, snakeId, { kind: 'manual', move, fatalConsent: mintFatalMoveConsent() }, operator);
      } else {
        // No turn data yet — arm, and the next turn's staging pass fires it.
        this.logCommandEvent(gameId, snakeId, 'suicide', operator, { armed: true });
        controlled.suicideArmed = true;
        controlled.suicideArmedBy = operator;
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
  commitAllStaged(gameId: string, byUserId?: string): { affected: string[] } {
    const game = this.games.get(gameId);
    if (!game) return { affected: [] };

    const operator = this.operatorFor(game, byUserId);
    const affected: string[] = [];
    for (const [snakeId, controlled] of game.controlledSnakes) {
      const staged = controlled.staged;
      // Only commit snakes staged for the current turn — a stale record means
      // this snake's decision for the new turn hasn't landed yet, and
      // committing it would mark "done" on a move that no longer applies.
      if (!staged || staged.turn !== game.boardStateTurn) continue;
      if (controlled.lastCommittedTurn === staged.turn) continue;
      affected.push(snakeId);
      this.logCommandEvent(gameId, snakeId, 'commit', operator, {
        move: staged.move,
        source: staged.source,
      });

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
    waypoints: { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } };
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
      waypoints: this.getWaypointsForGame(gameId),
      gameTimeout: game.gameTimeout,
      turnExpiryTime: game.turnExpiryTime,
      measuredPing: this.gameServerPing,
    };
  }

  // The active waypoint target handed to the decision engine on each decision:
  // the head of the goto queue, or the near target. Null when none is set.
  getActiveWaypointTarget(gameId: string, snakeId: string): WaypointContext | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return null;
    if (controlled.intent.kind === 'goto' && controlled.intent.targets.length > 0) {
      return { kind: 'goto', target: controlled.intent.targets[0] };
    }
    if (controlled.intent.kind === 'near') {
      return { kind: 'near', target: controlled.intent.target };
    }
    return null;
  }

  // Client projection: every waypoint cell per snake. Green carries the whole
  // goto queue in order (cells[0] is the active target); blue has one cell.
  getWaypointsForGame(gameId: string): { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: { type: 'green' | 'blue'; cells: Coord[] } } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.intent.kind === 'goto' && cs.intent.targets.length > 0) {
        result[snakeId] = { type: 'green', cells: cs.intent.targets };
      } else if (cs.intent.kind === 'near') {
        result[snakeId] = { type: 'blue', cells: [cs.intent.target] };
      }
    }
    return result;
  }

  // Set, append or clear a snake's waypoint. Only the user currently selecting
  // the snake may change it. Pass `waypoint=null` to clear. `append=true` with
  // a green waypoint while a goto queue is active TOGGLES the cell's queue
  // membership (append if absent, remove if already queued); otherwise the
  // waypoint replaces whatever intent was active. Returns true on success.
  setWaypoint(
    gameId: string,
    snakeId: string,
    waypoint: { type: 'green' | 'blue'; x: number; y: number } | null,
    userId: string,
    append: boolean = false
  ): boolean {
    const game = this.games.get(gameId);
    if (!game) return false;
    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return false;
    if (controlled.selectedBy !== userId) return false;
    const operator = this.operatorFor(game, userId);

    if (waypoint === null) {
      // Clearing only applies while in a waypoint mode; otherwise leave the
      // current intent (manual/heuristic) untouched and just re-stage.
      if (controlled.intent.kind === 'goto' || controlled.intent.kind === 'near') {
        this.logCommandEvent(gameId, snakeId, 'waypoint-clear', operator, {
          cleared: controlled.intent.kind,
        });
        this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
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

    if (waypoint.type === 'blue') {
      this.logCommandEvent(gameId, snakeId, 'near-set', operator, { target: { x, y } });
      this.setIntent(gameId, snakeId, { kind: 'near', target: { x, y } }, operator);
      return true;
    }

    if (append && controlled.intent.kind === 'goto') {
      // Toggle queue membership: appending an already-queued cell removes it.
      const targets = controlled.intent.targets;
      const existing = targets.findIndex(t => t.x === x && t.y === y);
      if (existing >= 0) {
        targets.splice(existing, 1);
        this.logCommandEvent(gameId, snakeId, 'goto-remove', operator, {
          target: { x, y },
          targets: targets.slice(),
        });
        if (targets.length === 0) {
          this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
        } else {
          // The queue continues under the toggling operator's command.
          controlled.intentBy = operator;
          this.stageMove(gameId, snakeId);
        }
      } else {
        targets.push({ x, y });
        this.logCommandEvent(gameId, snakeId, 'goto-append', operator, {
          target: { x, y },
          targets: targets.slice(),
        });
        controlled.intentBy = operator;
        this.stageMove(gameId, snakeId);
      }
      return true;
    }

    // Replace (or start) the goto queue with this single target. setIntent →
    // stageMove refreshes the derived route immediately, so the green path
    // renders the instant the user clicks, not only after the next decision.
    this.logCommandEvent(gameId, snakeId, 'goto-set', operator, {
      target: { x, y },
      targets: [{ x, y }],
    });
    this.setIntent(gameId, snakeId, { kind: 'goto', targets: [{ x, y }] }, operator);
    return true;
  }

  private viewFor(snapshot: BoardSnapshot, snakeId: string): GameState | null {
    const you = snapshot.board.snakes.find(s => s.id === snakeId);
    if (!you) return null;
    return { ...snapshot, you };
  }

  // Recompute the DERIVED green goto display route for a snake: the snake's
  // full predicted trajectory through EVERY queued target, chained
  // head → targets[0] → targets[1] → … so the board shows how it gets between
  // waypoints, not just to the first one.
  //
  // The first leg encodes the two-path duality the goto feature needs:
  //  - While a move is STAGED for this turn it starts
  //    [stagedDestination, ...shortestPath(stagedDestination → targets[0])] —
  //    the path the snake will actually walk, conditioned on the move the
  //    heuristic matrix chose (which may differ from the pure shortest-path
  //    first step when survival heuristics outvoted it).
  //  - With nothing staged for this turn it starts at the projected head —
  //    the "immediately optimal" path for the next decision.
  //
  // Uses the SAME `waypointPath` the evaluator's stat and the staging re-bias
  // use, so the number scored, the path drawn, and the move committed cannot
  // disagree. Exception-safe and side-effect-free beyond writing `gotoRoute`.
  private refreshGotoRoute(gameId: string, snakeId: string): void {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return;
    if (controlled.intent.kind !== 'goto' || controlled.intent.targets.length === 0) {
      controlled.gotoRoute = [];
      controlled.gotoRouteFirstLeg = 0;
      return;
    }
    try {
      const targets = controlled.intent.targets;
      const boardState = game.boardState;
      const gs = boardState ? this.viewFor(boardState, snakeId) : null;
      const anchor = this.getProjectedHead(gameId, snakeId);
      if (!gs || !anchor) {
        controlled.gotoRoute = [];
        controlled.gotoRouteFirstLeg = 0;
        return;
      }
      const board = gs.board;
      // One graph for every leg: waypointPath would otherwise rebuild the whole
      // typed-array board per call, and this runs on every stage.
      const graph = new BoardGraph(gs);
      const staged = controlled.staged;
      const stagedPending = !!staged && staged.turn === game.boardStateTurn;

      // Where the path starts, and how many turns from now that cell is
      // occupied — the BFS clock every subsequent leg continues from.
      const route: Coord[] = [];
      let from: Coord;
      let turnCursor: number;
      if (stagedPending) {
        const stagedDest = ActiveGameManager.destinationOf(anchor, staged!.move);
        const inBounds = stagedDest.x >= 0 && stagedDest.x < board.width && stagedDest.y >= 0 && stagedDest.y < board.height;
        if (!inBounds) {
          controlled.gotoRoute = [];
          controlled.gotoRouteFirstLeg = 0;
          return;
        }
        // The staged cell is reached one move in the future, so the rest of the
        // route is pathed with the clock already advanced by one.
        route.push(stagedDest);
        from = stagedDest;
        turnCursor = 1;
      } else {
        from = anchor;
        turnCursor = 0;
      }

      // Walk the WHOLE queue, one leg per target, so the board shows the
      // snake's full predicted trajectory rather than just the first hop.
      // Each leg's BFS starts at the turn the previous target is reached, which
      // matters because passability is turn-aware: bodies recede as the clock
      // advances, so a later leg legitimately sees more open board than the
      // same leg measured from turn 0 would. (Optimistic clearance has no
      // look-ahead ceiling — `optimisticDisappear` holds the true geometric
      // vacate turn — so the accumulated turns stay meaningful arbitrarily far
      // out.)
      //
      // Legs beyond the first are a PREDICTION in a way the first leg is not:
      // the first is conditioned on the move actually staged this turn, while
      // the rest assume the snake reaches each target and that other snakes'
      // bodies only recede from where they are now. That is exactly what makes
      // it useful for planning around a snake's default trajectory — but it is
      // not a commitment, and only targets[0] ever reaches the decision engine.
      // Every leg after the first must path against the snake as it WILL BE,
      // not as it is. The board graph models our body receding as the tail
      // advances, but it has no idea the head is about to walk the earlier
      // legs — so without this a later leg routes straight back through the
      // cells the snake just filled, most visibly doubling back into the neck
      // it would have created by arriving at the previous target.
      //
      // Occupancy is derived from the route itself. `route[i]` is where the
      // head stands at turn i+1, so the body still covers that cell until the
      // tail clears it at turn i+bodyLength. Arriving there any earlier is a
      // self-collision. Body length is taken as it is now: growth from food
      // eaten along the way is unknowable, and under-estimating length only
      // makes the prediction slightly optimistic rather than wrong-shaped.
      const bodyLength = Math.max(1, gs.you.body?.length ?? gs.you.length ?? 1);
      const occupancyByCell = new Map<number, number[]>();
      const noteOccupied = (cells: Coord[], firstRouteIndex: number) => {
        cells.forEach((c, n) => {
          const idx = graph.cellIndexOf(c);
          const at = occupancyByCell.get(idx);
          if (at) at.push(firstRouteIndex + n);
          else occupancyByCell.set(idx, [firstRouteIndex + n]);
        });
      };
      const occupied = (cellIdx: number, arrivalTurn: number): boolean => {
        const at = occupancyByCell.get(cellIdx);
        if (!at) return false;
        for (const i of at) {
          if (arrivalTurn >= i + 1 && arrivalTurn <= i + bodyLength) return true;
        }
        return false;
      };
      noteOccupied(route, 0);

      let firstLeg = 0;
      for (const target of targets) {
        const legStartIndex = route.length;
        const leg = waypointPath(gs, snakeId, from, target, { graph, startTurn: turnCursor, occupied });
        // Unreachable leg: stop at the last target we can actually get to
        // rather than drawing a path that skips a gap. With nothing reachable
        // at all this leaves just the staged step (or an empty route), so the
        // user still sees which way the snake is about to go.
        if (leg === null) break;
        route.push(...leg);
        noteOccupied(leg, legStartIndex);
        turnCursor += leg.length;
        from = target;
        // The first completed leg is the only part conditioned on the move
        // actually staged this turn; the client fades everything after it.
        if (firstLeg === 0) firstLeg = route.length;
      }
      controlled.gotoRoute = route;
      controlled.gotoRouteFirstLeg = firstLeg > 0 ? firstLeg : route.length;
    } catch (e) {
      // A display cache must never break staging/commit paths.
      console.error(`[ActiveGameManager] refreshGotoRoute failed for ${gameId}:${snakeId}:`, e);
      controlled.gotoRoute = [];
      controlled.gotoRouteFirstLeg = 0;
    }
  }

  // Resolve the goto/near intent to a move by re-running the SAME selection the
  // decision engine uses, over this turn's per-move evaluations with the
  // waypoint progress contribution re-derived from the CURRENT target:
  //   adjusted(move) = engineScore(move)
  //                  - recordedWaypointContribution(move)   // bias applied at decision time
  //                  + weight × progressStat(move)          // bias for the target as it is NOW
  // then pickBestMove (the shared trapped-veto + argmax exported from the
  // decision engine). This makes a target set or moved MID-TURN take effect
  // immediately, and guarantees the staged move is always "the best output of
  // the heuristic matrix with the waypoint weight integrated" — never a hard
  // path override.
  //
  // Returns null when this turn's evaluations aren't available (turn 0, the
  // fast staging pass, error paths), letting computeIntendedMove fall through
  // to the bot recommendation labelled truthfully as 'bot'.
  private getWaypointBiasedMove(gameId: string, snakeId: string): Direction | null {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    if (!game || !controlled) return null;
    const wp = this.getActiveWaypointTarget(gameId, snakeId);
    if (!wp) return null;

    const turnData = controlled.latestTurnData;
    if (!turnData || turnData.gameState.turn !== game.boardStateTurn) return null;
    const evaluations = turnData.moveEvaluations;
    if (!evaluations || evaluations.length === 0) return null;

    try {
      // Evaluations were computed from this turn's board; measure progress from
      // the same anchor (that state's head) so the re-bias is apples-to-apples
      // with the engine's own computation.
      const gs = turnData.gameState;
      const head = gs.you.head;
      const graph = new BoardGraph(gs);
      const baseDist = waypointDistance(gs, snakeId, head, wp.target, { graph });

      const candidates: Array<{ move: Direction; score: number; trapped: number }> = [];
      for (const evaluation of evaluations) {
        const breakdown: any = evaluation.breakdown || {};
        const weighted = breakdown.weighted || {};
        const weights = breakdown.weights || {};
        const dest = ActiveGameManager.destinationOf(head, evaluation.move);
        const candDist = waypointDistance(gs, snakeId, dest, wp.target, { graph, startTurn: 1 });
        const stat = wp.kind === 'goto'
          ? gotoProgressStat(baseDist, candDist)
          : nearProgressStat(baseDist, candDist);
        const weight = wp.kind === 'goto'
          ? (weights.gotoProgress ?? DEFAULT_CONFIG.gotoProgress)
          : (weights.nearProgress ?? DEFAULT_CONFIG.nearProgress);
        const recorded = (weighted.gotoProgressScore ?? 0) + (weighted.nearProgressScore ?? 0);
        candidates.push({
          move: evaluation.move,
          score: evaluation.score - recorded + weight * stat,
          trapped: breakdown.trapped ?? 0,
        });
      }
      return pickBestMove(candidates);
    } catch (e) {
      // Never let waypoint math break staging; fall back to the bot move.
      console.error(`[ActiveGameManager] getWaypointBiasedMove failed for ${gameId}:${snakeId}:`, e);
      return null;
    }
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
  // only one of manual/goto/near can be populated at once):
  //   1. manual user selection (this turn)
  //   2. the waypoint-biased move — the heuristic matrix re-scored with the
  //      CURRENT target's progress contribution (getWaypointBiasedMove)
  //   3. bot recommendation
  //   4. hard fallback ('up')
  //
  // Note what step 2 is NOT: a click-target never dictates the move. It is a
  // weighted vote in the same matrix every other heuristic feeds, so survival
  // terms retain the power to outvote it. The rendered green path follows this
  // choice (refreshGotoRoute), so the visual and the committed move agree.
  // ────────────────────────────────────────────────────────────────────────
  computeIntendedMove(gameId: string, snakeId: string): IntendedMove {
    const game = this.games.get(gameId);
    const controlled = game?.controlledSnakes.get(snakeId);
    const intent = controlled?.intent;

    if (intent?.kind === 'manual') {
      return { direction: intent.move, source: 'manual', consent: intent.fatalConsent };
    }

    if (intent?.kind === 'goto' || intent?.kind === 'near') {
      const biasedDir = this.getWaypointBiasedMove(gameId, snakeId);
      if (biasedDir) {
        return { direction: biasedDir, source: 'waypoint' };
      }
    }

    if (controlled?.botRecommendation) {
      // Anything that reaches here is the bot's recommendation — manual and the
      // waypoint re-bias were both unavailable this turn. Report it truthfully
      // as 'bot' even when a waypoint is nominally set, so the staged arrow
      // renders grey and the user can never mistake a bot decision for their
      // own staged move. The fallback is logged at the stageMove choke point
      // where the active intent mode is known.
      return { direction: controlled.botRecommendation, source: 'bot' };
    }

    return { direction: 'up', source: 'fallback' };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Single write point for a snake's intention. Replacing the union as a whole
  // is the mutual exclusion: the new intent structurally supersedes whatever
  // queue/waypoint/manual state the old one held — no field-by-field clearing.
  // Always re-stages the move so `staged` and the broadcast arrow track it.
  // `by` is the operator whose command produced this intent (callers pass the
  // existing intentBy for server-side continuations like goto arrival shifts);
  // it is forced to null for heuristic — the bot has no commanding operator.
  private setIntent(gameId: string, snakeId: string, intent: SnakeIntent, by: OperatorRef | null): void {
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
    controlled.intentBy = intent.kind === 'heuristic' ? null : by;
    this.stageMove(gameId, snakeId);
  }

  // Resolve a userId to the operator identity commands are attributed to:
  // the live connected user, else the game-lifetime name enrolment (so a
  // command from a momentarily-disconnected but enrolled player still
  // attributes correctly).
  private operatorFor(game: ActiveGame, userId: string | null | undefined): OperatorRef | null {
    if (!userId) return null;
    const user = game.connectedUsers.get(userId);
    if (user) return { userId, name: user.name, color: user.color };
    for (const enrolment of game.playerNames.values()) {
      if (enrolment.userId === userId) {
        return { userId, name: enrolment.name, color: enrolment.color };
      }
    }
    return { userId, name: 'Player', color: '#888888' };
  }

  // Append one row to the command-event log. Never throws into the game path
  // (the CommandLogger enqueue is synchronous and exception-free).
  private logCommandEvent(
    gameId: string,
    snakeId: string | null,
    eventType: string,
    operator: OperatorRef | null,
    payload: unknown
  ): void {
    const game = this.games.get(gameId);
    CommandLogger.getInstance().logEvent({
      gameId,
      snakeId,
      turn: game?.boardStateTurn ?? 0,
      eventType,
      operator,
      payload,
    });
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
    // A HUMAN-AUTHORED certain-death move may only be staged when it carries a
    // minted FatalMoveConsent. Without consent we stage the bot's move instead
    // and ask the client to show a confirmation dialog. Bot-sourced moves are
    // exempt: when the bot itself picks a fatal move there is no better
    // alternative to offer.
    //
    // 'waypoint' is deliberately EXCLUDED from the gate. Since the goto/near
    // redesign the direction is BOT-chosen — the heuristic matrix with the
    // waypoint weight integrated — so the bot's own death-aversion already
    // arbitrates it. Prompting would ask the human to confirm a move the bot
    // picked, and the fallback would swap one bot-chosen move for another. The
    // source-agnostic red marker (isStagedMoveFatal) still flags it in the UI.
    let direction = intended.direction;
    let source = intended.source;
    const humanSourced = source === 'manual';
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

    // Refresh the derived green path AFTER `controlled.staged` is final: the
    // fatal-move gate above can replace the staged direction, and the drawn
    // path must follow the move that will actually commit, not the one the
    // target wanted.
    this.refreshGotoRoute(gameId, snakeId);

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

  // Staged moves drive the arrow render on every client. Three layers per
  // snake, all pure reads of this manager's mirrors of Firebase state:
  //  - `requestedMove`: the last move the user/bot requested (ghost arrow
  //    whenever it differs from the confirmed move — optimistic state).
  //  - `move`: the CONFIRMED staged move from the Firebase read-back (solid
  //    arrow — what the game server will play if the turn ends now). Null
  //    until the first confirmation for the turn lands.
  //  - `committed`: true once Firebase finalized the turn's move (deadline
  //    passed or all players committed) — the double arrow; `move` then
  //    carries the final selection.
  // Color/source are derived from the requested record's source: heuristic =
  // grey/'bot' (bot-seeded), any human method (manual/queue/waypoint) = the
  // commanding operator's color (which survives deselects), falling back to
  // the selecting user's.
  //
  // Every controlled snake gets an entry, gated only on having a `staged`
  // record. The client only draws arrows for snakes present on the board, so
  // eliminated snakes are naturally skipped there.
  //
  // Shared by the live WebSocket broadcast and the per-turn command-state
  // snapshot, so live play and the history replay render from the same data.
  getStagedMovesForGame(gameId: string): { [snakeId: string]: StagedMoveView } {
    const game = this.games.get(gameId);
    if (!game) return {};

    const BOT_COLOR = '#888888';
    const staged: { [snakeId: string]: StagedMoveView } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (!cs.staged) continue;
      const requested = cs.staged;
      const userColor =
        cs.intentBy?.color ||
        (cs.selectedBy ? game.connectedUsers.get(cs.selectedBy)?.color : undefined) ||
        '#4CAF50';
      // Colour/source reflect the TRUE origin of the requested move, NOT the
      // nominal activeIntentMode. A waypoint/queue that fell back to the bot's
      // move this turn has source 'bot'/'fallback' and renders grey — so a
      // user-coloured arrow always guarantees the user's own requested move.
      const isBot = requested.source === 'bot' || requested.source === 'fallback';
      const color = isBot ? BOT_COLOR : userColor;
      // `fatal` flags a certain-death requested move so the client can warn
      // the human; it NEVER changes what is staged.
      const fatal = this.isStagedMoveFatal(gameId, snakeId);
      const confirmed = cs.confirmedStaged?.turn === requested.turn ? cs.confirmedStaged.move : null;
      const final = cs.finalMove?.turn === requested.turn ? cs.finalMove.move : null;
      staged[snakeId] = {
        move: final ?? confirmed,
        requestedMove: requested.move,
        committed: final !== null,
        color,
        source: requested.source,
        fatal,
      };
    }
    return staged;
  }

  // The command-state snapshot for a game, in exactly the live broadcast
  // shape (see CommandTurnState). Persisted per turn by applyResolvedMoves.
  getCommandStateForGame(gameId: string): CommandTurnState | null {
    const game = this.games.get(gameId);
    if (!game) return null;

    const stagedMoves = this.getStagedMovesForGame(gameId);
    const operators: { [snakeId: string]: OperatorRef | null } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      // A snake dead since an earlier turn keeps its last staged record; it is
      // not part of THIS turn's command state, so drop the stale entry.
      if (cs.staged && cs.staged.turn !== game.boardStateTurn) {
        delete stagedMoves[snakeId];
      }
      operators[snakeId] = cs.intentBy;
    }

    return {
      stagedMoves,
      waypoints: this.getWaypointsForGame(gameId),
      routes: this.getRoutesForGame(gameId),
      activeIntentModes: this.getActiveIntentModesForGame(gameId),
      owners: this.getOwnersForGame(gameId),
      operators,
    };
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

  // Client projection: the predicted trajectory per snake. `firstLeg` is how
  // many leading cells are the committed-this-turn leg (head → targets[0]);
  // the client renders the remainder faded because it is a prediction.
  getRoutesForGame(gameId: string): { [snakeId: string]: { cells: Coord[]; firstLeg: number } } {
    const game = this.games.get(gameId);
    if (!game) return {};
    const result: { [snakeId: string]: { cells: Coord[]; firstLeg: number } } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.intent.kind === 'goto' && cs.gotoRoute.length > 0) {
        result[snakeId] = { cells: cs.gotoRoute, firstLeg: cs.gotoRouteFirstLeg };
      }
    }
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────
  // Move-source priority for a controlled snake. The intent union holds exactly
  // one source at a time; computeIntendedMove resolves it to a single direction
  // and stageMove binds that into `staged`:
  //   1. Manual user selection         — setUserSelection (sets a single-turn
  //                                      {kind:'manual'} intent, structurally
  //                                      superseding any goto/near target; this
  //                                      is the "manual override drops the plan"
  //                                      contract)
  //   2. Waypoint-biased move          — getWaypointBiasedMove: the heuristic
  //                                      matrix re-scored with the CURRENT
  //                                      goto/near target's progress weight,
  //                                      applied identically to selected AND
  //                                      unselected snakes.
  //   3. Bot recommendation            — the heuristic default
  //   4. Hard fallback                 — literal 'up' if nothing else available
  //
  // Every staging action write-through publishes to Firebase (see stageMove);
  // the game server resolves each turn with the last staged move it received
  // before the turn deadline. There is no commit step on this side.
  //
  // Ownership of the goto queue: server-only mutations are done in
  // `setWaypoint` (in response to client `set-waypoint`), `setUserSelection`
  // (clear on 'manual' override), and the arrival check in `updateGameState`
  // (shift on arrival). Clients never advance the queue themselves; they
  // render the broadcast snapshot.
  // ────────────────────────────────────────────────────────────────────────
  setBotRecommendation(gameId: string, snakeId: string, move: Direction, turnData: TurnData): void {
    const game = this.games.get(gameId);
    if (!game) return;

    const controlled = game.controlledSnakes.get(snakeId);
    if (!controlled) return;

    const incomingTurn = turnData.gameState.turn;
    // Early-resolution race guard: a turn can resolve before its deadline
    // (every snake committed), so a decision computed for the PREVIOUS board
    // can land here after the game has advanced. Staging it would bind a
    // stale move to the new turn — drop it instead; the new turn's own fast
    // and full passes supply its moves.
    if (incomingTurn < game.boardStateTurn) {
      console.log(
        `[ActiveGameManager] Dropping stale bot recommendation for ${gameId}:${snakeId} ` +
        `(computed for turn ${incomingTurn}, board is at turn ${game.boardStateTurn})`
      );
      return;
    }
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
    // The green goto route is NOT refreshed here: it is derived from the move
    // that will actually commit, so it is recomputed inside stageMove once
    // `staged` is final (the re-stage below). Recomputing it now — before
    // `staged` is cleared and re-derived — would anchor the drawn path on the
    // previous turn's staged move.

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
      this.setIntent(gameId, snakeId, { kind: 'heuristic' }, null);
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
      const armedBy = controlled.suicideArmedBy;
      controlled.suicideArmedBy = null;
      this.setIntent(gameId, snakeId, { kind: 'manual', move: suicideMove, fatalConsent: mintFatalMoveConsent() }, armedBy);
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

    // Only the selecting user can reach this path (validated by the WS layer),
    // so the command attributes to them.
    const operator = this.operatorFor(game, controlled.selectedBy);
    this.logCommandEvent(gameId, snakeId, 'manual-move', operator, { move });
    this.setIntent(gameId, snakeId, { kind: 'manual', move }, operator);
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
    const operator = this.operatorFor(game, userId);
    this.logCommandEvent(gameId, snakeId, 'fatal-move-confirmed', operator, { move, stillFatal });
    this.setIntent(gameId, snakeId, { kind: 'manual', move, fatalConsent: consent }, operator);
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

    // Arrival SHIFTS the goto queue: reaching targets[0] promotes the next
    // target, and only an emptied queue reverts to the heuristic. Check both
    // the current head and body[1] so a snake that already advanced past the
    // target by the time this fires still registers the arrival.
    // (Near is single-target and deliberately never auto-clears — "stay close"
    // has no arrival condition.)
    if (controlled?.intent.kind === 'goto' && controlled.intent.targets.length > 0) {
      const wp = controlled.intent.targets[0];
      const you = gameState.you;
      const head = you?.head;
      const body = you?.body || [];
      const headHit = !!head && head.x === wp.x && head.y === wp.y;
      // body[0] === head; body[1] is where the head was last turn. If the
      // snake stepped onto the target last turn and is now stepping off,
      // body[1] catches that case.
      const justSteppedThrough = body.length > 1 && body[1].x === wp.x && body[1].y === wp.y;
      if (headHit || justSteppedThrough) {
        const remaining = controlled.intent.targets.slice(1);
        console.log(`[ActiveGameManager] Goto target reached for ${gameId}:${snakeId} (head=${head?.x},${head?.y} target=${wp.x},${wp.y} reason=${headHit ? 'head' : 'body[1]'}) — ${remaining.length} target(s) remaining`);
        // System event (no operator): the queue shifting on arrival is a
        // consequence of the standing goto command, not a new command.
        this.logCommandEvent(gameId, snakeId, 'goto-target-reached', null, {
          target: { x: wp.x, y: wp.y },
          targets: remaining,
        });
        this.setIntent(
          gameId,
          snakeId,
          remaining.length > 0 ? { kind: 'goto', targets: remaining } : { kind: 'heuristic' },
          // The remaining queue continues the SAME command — attribution is
          // preserved so replays keep crediting the commanding operator.
          remaining.length > 0 ? controlled.intentBy : null
        );
      }
    }
  }

  // Called by the transport when a turn has RESOLVED server-side (the next
  // turn's board arrived), with the moves the game server actually applied for
  // our controlled snakes on `resolvedTurn`. Must run BEFORE the new turn's
  // board state is fed in, so the bookkeeping measures from the old head.
  //
  // This replaces the old HTTP commit step for bookkeeping only — nothing is
  // submitted here. The server already resolved the turn from the last staged
  // move it received; we record what happened (decision log) and notify the UI.
  // The goto queue is NOT advanced here: arrival is detected from the board
  // itself in `updateGameState`, which is authoritative about where the snake
  // actually ended up.
  applyResolvedMoves(gameId: string, resolvedTurn: number, moves: { [snakeId: string]: Direction }): void {
    const game = this.games.get(gameId);
    if (!game) return;

    // Snapshot every snake's command state AS IT STOOD WHEN THIS TURN ENDED.
    // We run before the new board is fed in, so goto queues are un-shifted,
    // staged records still bind to resolvedTurn, and operator attribution is
    // exactly what was in force at the deadline. The history viewer replays
    // this snapshot through the same render paths the live client uses.
    if (game.boardStateTurn === resolvedTurn) {
      const state = this.getCommandStateForGame(gameId);
      if (state) {
        CommandLogger.getInstance().logTurnState(gameId, resolvedTurn, state);
      }
    }

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
