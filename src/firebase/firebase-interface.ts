// The TacticToes game transport: this bot connects to the TacticToes Firebase
// project directly and drives every game through Firestore. There is no HTTP
// Battlesnake interface — Firebase is the single source of truth for what is
// staged, and the game server resolves each turn with the LAST staged move
// written before the turn deadline.
//
// Responsibilities:
//   1. Auth: exchange the bot API key for a Firebase custom token via the
//      `exchangeBotApiKey` callable, then signInWithCustomToken.
//   2. Discovery: listen to bots/{botId}/games for the invite docs the server
//      writes at game start; open one game-doc listener per live game.
//   3. Turn intake: every appended turn is translated into per-snake
//      Battlesnake-shaped GameStates (one bot identity can own several snakes
//      in Team Snek — originals and clones) and fed to the ActiveGameManager,
//      which computes and stages each snake's move.
//   4. Staged-move publishing: the manager write-through publishes EVERY
//      staging action (bot recommendation, manual selection, queue step,
//      waypoint step, revert-to-bot, suicide) through the MoveSubmitter this
//      module wires up, as a privateMoves write. Re-staging simply writes
//      again; the server takes the last write before the deadline. There is
//      deliberately NO commit step (no moveStatuses writes): the staging
//      window stays open until the game server's own turn timer fires.
//   5. Resolution bookkeeping: when the next turn arrives, the moves the
//      server actually applied are derived from the board delta and fed back
//      (decision log, premove queue advancement, UI move-committed events).

import { FirebaseApp, deleteApp, initializeApp } from 'firebase/app';
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  signInWithCustomToken,
} from 'firebase/auth';
import {
  Firestore,
  Timestamp,
  Unsubscribe,
  addDoc,
  arrayUnion,
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { Direction, GameState } from '../types/battlesnake';
import { VoronoiStrategy } from '../logic/voronoi-strategy-new';
import { BoardGraph } from '../logic/board-graph';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { TeamDetector } from '../logic/team-detector';
import { DecisionLogger } from '../logic/decision-logger';
import { GameRegistry } from '../logic/game-registry';
import { ServerEventLogger } from '../logic/server-event-logger';
import { GameLogger } from '../utils/logger';
import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { TTGameInvite, TTGameStateDoc, TTTurn } from './tactictoes-types';
import {
  buildGameState,
  continuationDirection,
  controlledSnakeIDs,
  directionToMoveIndex,
  moveIndexToDirection,
} from './translate';

export interface FirebaseInterfaceConfig {
  projectId: string;
  apiKey: string;
  region: string;
  botId: string;
  botApiKey: string;
  emulators?: {
    firestoreHost?: string;
    firestorePort?: number;
    authUrl?: string;
    functionsHost?: string;
    functionsPort?: number;
  };
}

/** Builds the config from env, or returns null when the interface is not configured. */
export function firebaseInterfaceConfigFromEnv(
  env: NodeJS.ProcessEnv
): FirebaseInterfaceConfig | null {
  const botId = env.TACTICTOES_BOT_ID;
  const botApiKey = env.TACTICTOES_BOT_API_KEY;
  const projectId = env.TACTICTOES_FIREBASE_PROJECT_ID;
  const apiKey = env.TACTICTOES_FIREBASE_API_KEY;
  if (!botId || !botApiKey || !projectId || !apiKey) return null;

  // Emulator plumbing for local integration testing against the Firebase
  // emulator suite: TACTICTOES_EMULATOR_FIRESTORE=host:port,
  // TACTICTOES_EMULATOR_AUTH=http://host:port,
  // TACTICTOES_EMULATOR_FUNCTIONS=host:port.
  let emulators: FirebaseInterfaceConfig['emulators'];
  if (env.TACTICTOES_EMULATOR_FIRESTORE || env.TACTICTOES_EMULATOR_AUTH || env.TACTICTOES_EMULATOR_FUNCTIONS) {
    emulators = {};
    if (env.TACTICTOES_EMULATOR_FIRESTORE) {
      const [host, port] = env.TACTICTOES_EMULATOR_FIRESTORE.split(':');
      emulators.firestoreHost = host;
      emulators.firestorePort = parseInt(port, 10);
    }
    if (env.TACTICTOES_EMULATOR_AUTH) {
      emulators.authUrl = env.TACTICTOES_EMULATOR_AUTH;
    }
    if (env.TACTICTOES_EMULATOR_FUNCTIONS) {
      const [host, port] = env.TACTICTOES_EMULATOR_FUNCTIONS.split(':');
      emulators.functionsHost = host;
      emulators.functionsPort = parseInt(port, 10);
    }
  }

  return {
    projectId,
    apiKey,
    region: env.TACTICTOES_FUNCTIONS_REGION || 'us-central1',
    botId,
    botApiKey,
    emulators,
  };
}

// Read-back + finalization state for ONE turn of a watched game. Torn down
// and rebuilt whenever the turn advances.
interface TurnWatch {
  turn: number;
  endTimeMs: number;
  // Per owned alive snake: listener on its privateMoves for this turn.
  moveUnsubs: Unsubscribe[];
  // Listener on moveStatuses/{turn}: the ONLY finalization trigger — a snake
  // finalizes exactly when its commit is observed in movedPlayerIDs.
  statusUnsub: Unsubscribe | null;
  // Latest server-acked staged move per owned snake (ts <= endTime).
  confirmed: Map<string, { ts: number; direction: Direction }>;
  // Snakes whose privateMoves read-back has delivered at least one snapshot
  // (even an empty one) — the precondition for trusting "nothing staged".
  readBackReady: Set<string>;
  // Our snakes whose commit has been observed in movedPlayerIDs. A snake
  // finalizes once committed here AND its outcome is knowable: a confirmed
  // staged move, or provably-nothing-staged with the engine default.
  committedSnakes: Set<string>;
}

interface WatchedGame {
  sessionID: string;
  gameID: string;
  unsubscribe: Unsubscribe;
  lastProcessedTurn: number;
  registered: boolean;
  latestDoc: TTGameStateDoc | null;
  turnWatch: TurnWatch | null;
  // Watchdog state: when the last game-doc snapshot arrived. A listener the
  // SDK silently gave up on (emulator stream corruption, network partition)
  // otherwise leaves the bot blind while the server plays default moves.
  lastSnapshotMs: number;
}

export type FirebaseConnState = 'connecting' | 'connected' | 'error' | 'suspended';

export interface FirebaseStatus {
  state: FirebaseConnState;
  error: string | null;
  since: number;
}

export class TacticToesFirebaseInterface {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Firestore | null = null;
  private static appInstanceCounter = 0;
  private invitesUnsubscribe: Unsubscribe | null = null;
  private watchedGames = new Map<string, WatchedGame>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private rebuilding = false;
  private stopped = false;

  private readonly gameManager = ActiveGameManager.getInstance();
  private readonly teamDetector = new TeamDetector();
  private readonly gameLogger = new GameLogger();
  private readonly quickAnalyzer = new MoveAnalyzer('custom');

  // Connection status surfaced to the web UI (banner + /api/firebase-status).
  // The bot is nonfunctional without Firebase, so operators must be able to
  // see (and retry) a failed connection without shelling into the server.
  private connState: FirebaseConnState = 'connecting';
  private connError: string | null = null;
  private connSince: number = Date.now();
  private statusListener: ((status: FirebaseStatus) => void) | null = null;
  // Single in-flight connect/rebuild operation; retryConnect() joins it
  // rather than racing a second sign-in.
  private connectOp: Promise<void> | null = null;
  // Desired presence state: true while at least one web client should keep
  // the transport alive. suspend()/resume() re-check this after every await
  // so a client that connects mid-suspend always wins (and vice versa).
  private desiredActive = true;

  constructor(
    private readonly strategy: VoronoiStrategy,
    private readonly config: FirebaseInterfaceConfig
  ) {}

  getStatus(): FirebaseStatus {
    return { state: this.connState, error: this.connError, since: this.connSince };
  }

  onStatusChange(listener: (status: FirebaseStatus) => void): void {
    this.statusListener = listener;
  }

  private setStatus(state: FirebaseConnState, error: string | null = null): void {
    if (state === this.connState && error === this.connError) return;
    this.connState = state;
    this.connError = error;
    this.connSince = Date.now();
    this.statusListener?.(this.getStatus());
  }

  /**
   * Operator-triggered reconnect (banner Retry button). If the initial
   * start() never succeeded there is no watchdog/listener state to preserve,
   * so run start() again; otherwise reuse the rebuildClient() recovery path.
   * Never throws — the resulting status carries the failure.
   */
  /**
   * Autoscale hygiene: while no human is connected to the web UI there is no
   * reason to hold Firestore gRPC streams open (and a centaur bot with no
   * operator can't meaningfully play anyway). suspend() tears the client down
   * exactly like stop() but stays resumable; resume() re-runs the start path.
   * The recent-first invite replay on resume re-discovers any still-live
   * games, so cleared watch state is rebuilt for free.
   */
  async suspend(): Promise<void> {
    this.desiredActive = false;
    if (this.stopped || this.connState === 'suspended') return;
    // Let any in-flight connect settle so we don't tear down under it.
    if (this.connectOp) await this.connectOp.catch(() => undefined);
    // A client may have (re)connected while we awaited — presence wins.
    if (this.desiredActive || this.stopped) return;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    for (const watched of this.watchedGames.values()) {
      watched.unsubscribe();
      this.teardownTurnWatch(watched);
    }
    this.watchedGames.clear();
    this.teardownClient();
    console.log('[tt-firebase] Suspended (no web clients — allowing scale to zero)');
    this.setStatus('suspended');
    // Presence can also return during the (synchronous) teardown above via a
    // resume() that saw connState !== 'suspended' and bailed. Converge here.
    if (this.desiredActive && !this.stopped) {
      await this.resume().catch(() => undefined);
    }
  }

  async resume(): Promise<void> {
    this.desiredActive = true;
    if (this.stopped) return;
    // If a connect/rebuild/suspend is in flight, let it settle; the settled
    // path re-checks desiredActive and converges (see suspend()).
    if (this.connectOp) {
      await this.connectOp.catch(() => undefined);
    }
    if (!this.desiredActive || this.stopped || this.connState !== 'suspended') return;
    console.log('[tt-firebase] Resuming after suspension (web client returned)');
    await this.start();
  }

  async retryConnect(): Promise<FirebaseStatus> {
    if (this.stopped || this.connState === 'connected') {
      return this.getStatus();
    }
    if (this.connState === 'suspended') {
      try {
        await this.resume();
      } catch { /* status already set to error */ }
      return this.getStatus();
    }
    // If a rebuild or start is already in flight (watchdog or a concurrent
    // retry), join it instead of racing a second one.
    if (this.connectOp) {
      await this.connectOp.catch(() => undefined);
      return this.getStatus();
    }
    try {
      if (this.watchdogTimer) {
        await this.rebuildClient();
      } else {
        await this.start();
      }
    } catch {
      // status already set to 'error' by start()/rebuildClient()
    }
    return this.getStatus();
  }

  async start(): Promise<void> {
    const op = (async () => {
      this.setStatus('connecting');
      await this.initClient();
    })();
    this.connectOp = op.finally(() => {
      this.connectOp = null;
    });
    try {
      await op;
    } catch (err) {
      this.setStatus('error', String((err as Error)?.message || err));
      // Tear down the partially initialized app so a retry starts from a
      // clean slate instead of leaking one Firebase app per attempt.
      this.teardownClient();
      throw err;
    }

    // Listener watchdog: if a watched game's doc listener goes quiet for
    // longer than the staleness window, the stream died without the error
    // callback firing (the SDK's gRPC Listen stream against the emulator can
    // die on corrupted RESOURCE_EXHAUSTED frames and then go permanently
    // silent). Resubscribing on the same client does NOT recover — a fresh
    // listen on a corrupted gRPC session stays dead (verified empirically) —
    // so go straight to a full client rebuild (new app, re-sign-in, re-watch
    // with turn cursors preserved). A live game delivers a snapshot at least
    // once per turn, so during active games this fires only when truly blind;
    // a spurious rebuild on a genuinely-quiet game (long human turns) costs
    // one sign-in and replays a state we already processed.
    this.watchdogTimer = setInterval(() => {
      const STALE_MS = 8_000;
      const now = Date.now();
      for (const watched of this.watchedGames.values()) {
        if (now - watched.lastSnapshotMs > STALE_MS) {
          void this.rebuildClient();
          break;
        }
      }
    }, 2_500);
    this.watchdogTimer.unref?.();
  }

  /**
   * Create the Firebase app/auth/firestore stack, sign in, wire the manager's
   * write-through publishers, and start the invite feed. Extracted from
   * start() so rebuildClient() can recreate everything from scratch.
   */
  private async initClient(): Promise<void> {
    const { config } = this;
    this.app = initializeApp(
      { projectId: config.projectId, apiKey: config.apiKey },
      `tactictoes-${++TacticToesFirebaseInterface.appInstanceCounter}`
    );
    this.auth = getAuth(this.app);
    // NOTE: in Node the SDK always uses the gRPC transport, so a corrupted
    // stream cannot be avoided at the transport level — silent listener death
    // is handled by the watchdog + rebuildClient() recovery path instead.
    this.db = getFirestore(this.app);
    const functions = getFunctions(this.app, config.region);

    if (config.emulators?.authUrl) {
      connectAuthEmulator(this.auth, config.emulators.authUrl, { disableWarnings: true });
    }
    if (config.emulators?.firestoreHost && config.emulators.firestorePort) {
      connectFirestoreEmulator(
        this.db,
        config.emulators.firestoreHost,
        config.emulators.firestorePort
      );
    }
    if (config.emulators?.functionsHost && config.emulators.functionsPort) {
      connectFunctionsEmulator(
        functions,
        config.emulators.functionsHost,
        config.emulators.functionsPort
      );
    }

    const exchange = httpsCallable<{ botId: string; apiKey: string }, { customToken: string }>(
      functions,
      'exchangeBotApiKey'
    );
    const { data } = await exchange({ botId: config.botId, apiKey: config.botApiKey });
    await signInWithCustomToken(this.auth, data.customToken);
    console.log(`[tt-firebase] Signed in as bot:${config.botId}`);
    this.setStatus('connected');

    // Wire the write-through publisher: every staging action in the manager
    // lands in Firestore as a privateMoves write.
    this.gameManager.setMoveSubmitter(
      (gameId, snakeId, turn, move, source) =>
        this.publishStagedMove(gameId, snakeId, turn, move, source)
    );
    // Wire the human-triggered Submit All commit (never called automatically).
    this.gameManager.setMoveCommitter(
      (gameId, snakeId, turn) => this.publishCommit(gameId, snakeId, turn)
    );

    // Recent-first invite feed. Finished games are filtered out on first
    // snapshot of their game doc, so replaying a few stale invites is cheap.
    const invitesQuery = query(
      collection(this.db, `bots/${config.botId}/games`),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    this.invitesUnsubscribe = onSnapshot(
      invitesQuery,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          const invite = change.doc.data() as TTGameInvite;
          this.watchGame(invite.sessionID, invite.gameID);
        });
      },
      (err) => {
        // Terminal invite-stream failure. The game-doc watchdog only covers
        // watched games — with zero live games a dead invite feed would
        // otherwise leave the bot blind forever while reporting 'connected'.
        console.error('[tt-firebase] Invite listener failed:', err);
        this.setStatus('error', `Invite listener failed: ${String((err as Error)?.message || err)}`);
        if (!this.stopped) {
          setTimeout(() => {
            if (!this.stopped && this.connState === 'error') void this.rebuildClient();
          }, 5_000).unref?.();
        }
      }
    );
  }

  /** Best-effort teardown of the current Firebase app stack. */
  private teardownClient(): void {
    this.invitesUnsubscribe?.();
    this.invitesUnsubscribe = null;
    const oldApp = this.app;
    this.app = null;
    this.auth = null;
    this.db = null;
    if (oldApp) {
      // Deleting a wedged app can itself hang; don't let it block anything.
      void deleteApp(oldApp).catch(() => {});
    }
  }

  /**
   * Full recovery from a wedged Firestore client: tear down the app entirely,
   * recreate it (fresh gRPC session), sign in again, and resubscribe every
   * watched game in place. Turn cursors (lastProcessedTurn) and registration
   * state survive, so the first snapshot after recovery is either a no-op or
   * an immediate catch-up to the turns we went blind for.
   */
  private async rebuildClient(): Promise<void> {
    if (this.rebuilding || this.stopped) {
      // Join an in-flight rebuild instead of silently returning, so
      // retryConnect() reports the real outcome.
      if (this.connectOp) await this.connectOp.catch(() => undefined);
      return;
    }
    this.rebuilding = true;
    console.warn('[tt-firebase] Listener starvation persisted after resubscribe — rebuilding Firebase client');
    let resolveOp: () => void = () => {};
    this.connectOp = new Promise<void>((r) => { resolveOp = r; });
    try {
      this.setStatus('connecting');
      for (const watched of this.watchedGames.values()) {
        watched.unsubscribe();
        watched.unsubscribe = () => {};
        this.teardownTurnWatch(watched);
      }
      this.teardownClient();

      await this.initClient();

      for (const watched of this.watchedGames.values()) {
        watched.lastSnapshotMs = Date.now();
        this.subscribeGameDoc(watched);
      }
      console.warn('[tt-firebase] Firebase client rebuilt; listeners restored');
    } catch (err) {
      console.error('[tt-firebase] Client rebuild failed (will retry on next starvation):', err);
      this.setStatus('error', String((err as Error)?.message || err));
      // Push the starvation clocks forward so the watchdog waits a full
      // window before retrying the rebuild.
      for (const watched of this.watchedGames.values()) {
        watched.lastSnapshotMs = Date.now();
      }
    } finally {
      this.rebuilding = false;
      this.connectOp = null;
      resolveOp();
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.gameManager.setMoveSubmitter(null);
    this.gameManager.setMoveCommitter(null);
    this.invitesUnsubscribe?.();
    for (const game of this.watchedGames.values()) {
      game.unsubscribe();
      this.teardownTurnWatch(game);
    }
    this.watchedGames.clear();
    if (this.app) await deleteApp(this.app);
    this.app = null;
  }

  private watchGame(sessionID: string, gameID: string): void {
    if (this.stopped || !this.db || this.watchedGames.has(gameID)) return;
    console.log(`[tt-firebase] Watching game ${gameID} in session ${sessionID}`);

    const watched: WatchedGame = {
      sessionID,
      gameID,
      lastProcessedTurn: -1,
      registered: false,
      latestDoc: null,
      turnWatch: null,
      lastSnapshotMs: Date.now(),
      unsubscribe: () => {},
    };
    this.subscribeGameDoc(watched);
    this.watchedGames.set(gameID, watched);
  }

  /**
   * (Re)subscribe the game-doc listener. Kept separate from watchGame so the
   * watchdog can replace a dead listener in place: lastProcessedTurn survives,
   * so a resubscription that replays the current doc state is a no-op unless
   * we actually missed turns — in which case we catch up immediately.
   */
  private subscribeGameDoc(watched: WatchedGame): void {
    if (this.stopped || !this.db) return;
    const gameRef = doc(this.db, `sessions/${watched.sessionID}/games/${watched.gameID}`);
    watched.lastSnapshotMs = Date.now();
    watched.unsubscribe = onSnapshot(
      gameRef,
      (snapshot) => {
        watched.lastSnapshotMs = Date.now();
        const data = snapshot.data() as TTGameStateDoc | undefined;
        if (!data || !Array.isArray(data.turns) || data.turns.length === 0) return;
        watched.latestDoc = data;
        this.onGameUpdate(watched, data).catch((err) => {
          console.error(`[tt-firebase] Error handling update for game ${watched.gameID}:`, err);
        });
      },
      (err) => {
        // Terminal listener error: the SDK will NOT retry after calling this.
        // Resubscribe after a short backoff.
        console.error(`[tt-firebase] Game listener error for ${watched.gameID} — resubscribing:`, err.message);
        watched.unsubscribe();
        setTimeout(() => {
          if (!this.stopped && this.watchedGames.has(watched.gameID)) {
            this.subscribeGameDoc(watched);
          }
        }, 1000);
      }
    );
  }

  private unwatchGame(watched: WatchedGame): void {
    watched.unsubscribe();
    this.teardownTurnWatch(watched);
    this.watchedGames.delete(watched.gameID);
    this.strategy.onGameEnd(watched.gameID);
    console.log(`[tt-firebase] Stopped watching game ${watched.gameID}`);
  }

  private teardownTurnWatch(watched: WatchedGame): void {
    const tw = watched.turnWatch;
    if (!tw) return;
    tw.moveUnsubs.forEach((unsub) => unsub());
    tw.statusUnsub?.();
    watched.turnWatch = null;
  }

  private async onGameUpdate(watched: WatchedGame, data: TTGameStateDoc): Promise<void> {
    const turnNumber = data.turns.length - 1;
    if (turnNumber <= watched.lastProcessedTurn) return;
    const prevProcessed = watched.lastProcessedTurn;
    watched.lastProcessedTurn = turnNumber;

    const turn = data.turns[turnNumber];
    const ourSnakes = controlledSnakeIDs(data.setup, this.config.botId);
    if (ourSnakes.length === 0) {
      this.unwatchGame(watched);
      return;
    }

    ServerEventLogger.getInstance().recordGameActivity(watched.gameID);

    const endTimeMs =
      turn.endTime instanceof Timestamp ? turn.endTime.toMillis() : Date.now() + 10_000;

    // First snapshot for this game: register every controlled snake so the
    // centaur UI lists them and the manager tracks their intents.
    if (!watched.registered) {
      watched.registered = true;
      for (const snakeId of ourSnakes) {
        const view = buildGameState(watched.gameID, data.setup, turn, turnNumber, snakeId, endTimeMs);
        if (snakeId === ourSnakes[0]) {
          this.gameLogger.startGame(view);
          GameRegistry.getInstance().recordGameStart(view);
        }
        this.gameManager.registerGame(view);
      }
    }

    // Derive the moves the server actually applied on the PREVIOUS turn from
    // the board delta (falling back to the recorded move index for snakes that
    // died this turn). Bookkeeping must run BEFORE the new board is fed in so
    // premove-queue advancement measures from the old head.
    if (turnNumber > 0) {
      const prevTurn = data.turns[turnNumber - 1];
      const lastMoves = this.deriveLastMoves(data, prevTurn, turn);
      if (prevProcessed === turnNumber - 1) {
        const ours: { [snakeId: string]: Direction } = {};
        for (const snakeId of ourSnakes) {
          if (lastMoves[snakeId]) ours[snakeId] = lastMoves[snakeId];
        }
        this.gameManager.applyResolvedMoves(watched.gameID, turnNumber - 1, ours);
      }
      // The decision-log row for the prior board turn is keyed by this
      // arriving turn (decision_logs.turn = boardTurn + 1).
      DecisionLogger.getInstance().recordServerMoves(watched.gameID, turnNumber, lastMoves);
    }

    // Final turn: hand every snake its final state, close the game everywhere.
    if (turn.winners.length > 0) {
      const anyView = buildGameState(
        watched.gameID, data.setup, turn, turnNumber, ourSnakes[0], null
      );
      this.gameLogger.endGame(anyView);
      GameRegistry.getInstance().recordGameEnd(anyView);
      for (const snakeId of ourSnakes) {
        const view = buildGameState(watched.gameID, data.setup, turn, turnNumber, snakeId, null);
        this.gameManager.endGame(watched.gameID, snakeId, view);
      }
      this.unwatchGame(watched);
      return;
    }

    const aliveOurs = ourSnakes.filter((id) => turn.alivePlayers.includes(id));
    if (aliveOurs.length === 0) {
      // All our snakes are dead but the game continues; nothing left to stage.
      // Keep watching so the UI still receives the final state at game end.
      this.teardownTurnWatch(watched);
      return;
    }

    this.gameManager.recordTurnArrival(
      watched.gameID,
      Date.now(),
      data.setup.maxTurnTime * 1000,
      endTimeMs
    );

    // Read-back + finalization for this turn: confirm what Firebase actually
    // holds as each snake's staged move, and detect the turn's final
    // selection (deadline or all-committed) before the next board arrives.
    this.beginTurnWatch(watched, data, turnNumber, endTimeMs, aliveOurs);

    // FAST PASS: immediately stage a cheap safe move for every snake so a
    // short turn deadline never catches a snake with nothing staged (the
    // engine default is "continue straight", which is often a wall). The
    // full strategy pass below re-stages a better move; re-staging simply
    // supersedes this one in Firebase.
    const views = new Map<string, GameState>();
    for (const snakeId of aliveOurs) {
      const view = buildGameState(watched.gameID, data.setup, turn, turnNumber, snakeId, endTimeMs);
      views.set(snakeId, view);
      this.gameManager.updateGameState(watched.gameID, snakeId, view);
      try {
        const quick = this.quickSafeMove(view);
        if (quick) {
          this.gameManager.setBotRecommendation(watched.gameID, snakeId, quick, {
            gameState: view,
            moveEvaluations: [],
            territoryCells: {},
            safeMoves: [],
            botRecommendation: quick,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        console.error(`[tt-firebase] Quick staging failed for ${snakeId} turn ${turnNumber}:`, err);
      }
    }

    // FULL PASS: one ANYTIME strategy decision per controlled alive snake, all
    // snakes launched CONCURRENTLY. Each decision fans its simulations out
    // across the shared worker-thread pool and reports an updated best move
    // every ~100ms; we forward a recommendation to the manager only when the
    // move actually changed (the write-through republishes to Firestore, so
    // unchanged updates would just flood the wire). The final recommendation
    // carries the full debug payload. Decisions stop at the shared deadline —
    // shortly before the turn's endTime, leaving room for the staging write.
    const deadlineMs = Math.max(Date.now() + 200, endTimeMs - 150);
    await Promise.all(
      aliveOurs.map(async (snakeId) => {
        const view = views.get(snakeId)!;
        try {
          const teams = this.teamDetector.detectTeams(view.board.snakes);
          const ourTeam = teams.find((team) => team.snakes.some((s) => s.id === snakeId));
          const waypoint = this.gameManager.getWaypoint(watched.gameID, snakeId);

          let lastForwarded: Direction | null = null;
          const result = await this.strategy.getBestMoveIterative(view, ourTeam, waypoint, {
            deadlineMs,
            onRecommendation: (move, decision) => {
              if (move === lastForwarded) return;
              lastForwarded = move;
              this.gameManager.setBotRecommendation(watched.gameID, snakeId, move, {
                gameState: view,
                moveEvaluations: [],
                territoryCells: {},
                safeMoves: decision.candidateMoves,
                botRecommendation: move,
                timestamp: Date.now(),
              });
            },
          });

          const turnData: TurnData = {
            gameState: view,
            moveEvaluations: result.moveEvaluations,
            territoryCells: result.territoryCells,
            safeMoves: result.safeMoves,
            botRecommendation: result.move,
            timestamp: Date.now(),
            cellOwnership: result.cellOwnership,
          };
          this.gameManager.setBotRecommendation(watched.gameID, snakeId, result.move, turnData);
        } catch (err) {
          console.error(`[tt-firebase] Decision failed for ${snakeId} turn ${turnNumber}:`, err);
          this.gameManager.setBotRecommendation(watched.gameID, snakeId, 'up', {
            gameState: view,
            moveEvaluations: [],
            territoryCells: {},
            safeMoves: [],
            botRecommendation: 'up',
            timestamp: Date.now(),
          });
        }
      })
    );
  }

  // A cheap (~1ms) safe move for the fast staging pass: prefer continuing
  // straight when that is safe, else the analyzer's first safe move, else a
  // risky one. Returns null when the snake has no non-lethal move at all.
  private quickSafeMove(view: GameState): Direction | null {
    const graph = new BoardGraph(view);
    const analysis = this.quickAnalyzer.analyzeMoves(view.you, view, graph);
    const head = view.you.head;
    const neck = view.you.body[1];
    let straight: Direction | null = null;
    if (neck && (neck.x !== head.x || neck.y !== head.y)) {
      if (head.x > neck.x) straight = 'right';
      else if (head.x < neck.x) straight = 'left';
      else if (head.y > neck.y) straight = 'up';
      else straight = 'down';
    }
    if (straight && analysis.safe.includes(straight)) return straight;
    return analysis.safe[0] ?? analysis.risky[0] ?? null;
  }

  // Sets up the per-turn read-back listeners and the finalization trigger:
  //  - one privateMoves listener per owned alive snake (playerID +
  //    moveNumber equality query — the rules require the playerID filter),
  //    reporting the latest server-acked write as the CONFIRMED staged move;
  //  - a moveStatuses listener: the ONLY finalization trigger. A snake's
  //    move finalizes (double arrow) exactly when its commit is OBSERVED in
  //    movedPlayerIDs and its confirmed staged move is known — a report of
  //    real Firebase state, never a local-clock guess. Turns that resolve by
  //    timeout without commits never finalize; the next board just arrives.
  private beginTurnWatch(
    watched: WatchedGame,
    data: TTGameStateDoc,
    turnNumber: number,
    endTimeMs: number,
    aliveOurs: string[]
  ): void {
    if (!this.db) return;
    this.teardownTurnWatch(watched);

    const tw: TurnWatch = {
      turn: turnNumber,
      endTimeMs,
      moveUnsubs: [],
      statusUnsub: null,
      confirmed: new Map(),
      readBackReady: new Set(),
      committedSnakes: new Set(),
    };
    watched.turnWatch = tw;

    // A snake finalizes once its commit is observed AND its outcome is
    // knowable from Firebase state (never from timers):
    //  - a confirmed staged move → that move;
    //  - provably nothing staged → the engine's deterministic default
    //    (continue the previous move). This inference is exact because ONLY
    //    this server can write this snake's privateMoves (Firestore rules):
    //    once the read-back has delivered its state and the manager holds no
    //    unconfirmed request that a retry could still land, no staged write
    //    can exist or appear.
    // Whichever listener completes the picture fires this; the manager
    // dedupes repeat calls per (snake, turn).
    const maybeFinalize = (snakeId: string) => {
      if (!tw.committedSnakes.has(snakeId)) return;
      const confirmed = tw.confirmed.get(snakeId);
      if (confirmed) {
        this.gameManager.finalizeTurnMove(watched.gameID, snakeId, tw.turn, confirmed.direction);
        return;
      }
      if (!tw.readBackReady.has(snakeId)) return;
      if (this.gameManager.hasUnconfirmedRequest(watched.gameID, snakeId, tw.turn)) return;
      const def = continuationDirection(turnData.playerPieces[snakeId], width);
      if (!def) return; // no previous direction — the engine's fallback pick isn't reproduced
      console.log(`[tt-firebase] ${snakeId} committed with nothing staged — engine default ${def} is final for turn ${tw.turn}`);
      this.gameManager.finalizeTurnMove(watched.gameID, snakeId, tw.turn, def);
    };

    const movesCol = collection(
      this.db,
      `sessions/${watched.sessionID}/games/${watched.gameID}/privateMoves`
    );
    const width = data.setup.boardWidth;
    const turnData = data.turns[turnNumber];

    for (const snakeId of aliveOurs) {
      const headIndex = turnData.playerPieces[snakeId]?.[0];
      if (headIndex === undefined) continue;
      const q = query(
        movesCol,
        where('moveNumber', '==', turnNumber),
        where('playerID', '==', snakeId)
      );
      tw.moveUnsubs.push(
        onSnapshot(q, (snapshot) => {
          // The first delivery (even empty, even from cache-then-server)
          // makes "nothing staged" a trustworthy observation.
          tw.readBackReady.add(snakeId);
          // Latest SERVER-acked write wins (pending local writes have a null
          // serverTimestamp and don't count as confirmation). Writes stamped
          // after endTime are ignored — the game server ignores them too.
          let best: { ts: number; direction: Direction } | null = null;
          snapshot.forEach((docSnap) => {
            const d = docSnap.data() as { move: number; timestamp: Timestamp | null };
            const ts = d.timestamp instanceof Timestamp ? d.timestamp.toMillis() : null;
            if (ts === null || ts > tw.endTimeMs) return;
            if (best && ts <= best.ts) return;
            const direction = moveIndexToDirection(headIndex, d.move, width);
            if (direction) best = { ts, direction };
          });
          if (best) {
            const chosen: { ts: number; direction: Direction } = best;
            tw.confirmed.set(snakeId, chosen);
            this.gameManager.setConfirmedStagedMove(
              watched.gameID,
              snakeId,
              turnNumber,
              chosen.direction
            );
          }
          // A commit observed before this delivery may now be resolvable —
          // via the confirmation above, or via the nothing-staged default.
          maybeFinalize(snakeId);
        }, (err) => {
          console.error(`[tt-firebase] privateMoves read-back failed for ${snakeId} turn ${turnNumber}:`, err);
        })
      );
    }

    // The finalization trigger: a snake's move is committed exactly when the
    // moveStatuses doc records it in movedPlayerIDs. This is observed
    // Firebase state — commits made by any operator (this server's Submit
    // All, another client, or a commit that raced the listener attach) are
    // all reported by the snapshot.
    const ours = new Set(aliveOurs);
    tw.statusUnsub = onSnapshot(
      doc(
        this.db,
        `sessions/${watched.sessionID}/games/${watched.gameID}/moveStatuses/${turnNumber}`
      ),
      (snapshot) => {
        const status = snapshot.data() as { movedPlayerIDs?: string[] } | undefined;
        if (!status?.movedPlayerIDs) return;
        for (const snakeId of status.movedPlayerIDs) {
          if (!ours.has(snakeId) || tw.committedSnakes.has(snakeId)) continue;
          tw.committedSnakes.add(snakeId);
          console.log(`[tt-firebase] Commit observed for ${snakeId} turn ${tw.turn}`);
          maybeFinalize(snakeId);
        }
      },
      (err) => {
        console.error(`[tt-firebase] moveStatuses listener failed for turn ${turnNumber}:`, err);
      }
    );
  }

  // The applied move for each snake on the prev → curr transition. The
  // server records every player's actually-applied move (staged or engine
  // default) in the new turn's `moves` map, so that is authoritative; the
  // head delta remains as a fallback for games recorded before that change.
  private deriveLastMoves(
    data: TTGameStateDoc,
    prevTurn: TTTurn,
    currTurn: TTTurn
  ): Record<string, Direction> {
    const width = data.setup.boardWidth;
    const result: Record<string, Direction> = {};
    for (const snakeId of Object.keys(prevTurn.playerPieces)) {
      const prevHead = prevTurn.playerPieces[snakeId]?.[0];
      if (prevHead === undefined) continue;
      let dir: Direction | null = null;
      const recorded = currTurn.moves?.[snakeId];
      if (recorded !== undefined) dir = moveIndexToDirection(prevHead, recorded, width);
      if (!dir) {
        const newHead = currTurn.playerPieces[snakeId]?.[0];
        if (newHead !== undefined) dir = moveIndexToDirection(prevHead, newHead, width);
      }
      if (dir) result[snakeId] = dir;
    }
    return result;
  }

  /**
   * The MoveSubmitter implementation: writes the staged move as a privateMoves
   * doc. Repeatable per snake per turn — the game server resolves the turn
   * with the last write whose server timestamp precedes the turn's endTime.
   */
  private async publishStagedMove(
    gameId: string,
    snakeId: string,
    turn: number,
    move: Direction,
    source: string
  ): Promise<void> {
    if (!this.db || this.connState !== 'connected') {
      throw new Error('Firebase interface not connected');
    }
    const watched = this.watchedGames.get(gameId);
    const data = watched?.latestDoc;
    if (!watched || !data) throw new Error(`Unknown game ${gameId}`);

    const turnData = data.turns[turn];
    const headIndex = turnData?.playerPieces?.[snakeId]?.[0];
    if (headIndex === undefined) {
      throw new Error(`No head for ${snakeId} on turn ${turn} of ${gameId}`);
    }

    const moveIndex = directionToMoveIndex(
      move,
      headIndex,
      data.setup.boardWidth,
      data.setup.boardHeight
    );

    await addDoc(
      collection(this.db, `sessions/${watched.sessionID}/games/${watched.gameID}/privateMoves`),
      {
        gameID: watched.gameID,
        moveNumber: turn,
        playerID: snakeId,
        move: moveIndex,
        timestamp: serverTimestamp(),
      }
    );
    console.log(
      `[tt-firebase] Staged ${move} (index ${moveIndex}, source ${source}) for ${snakeId} turn ${turn}`
    );
  }

  /**
   * The MoveCommitter implementation for the human-triggered Submit All: adds
   * the snake to moveStatuses.movedPlayerIDs so the game server can resolve
   * the turn early once every alive player has committed. Firestore rules
   * accept one owned snake per write, so multi-snake commits arrive as one
   * write each. The staged move is untouched — whatever privateMoves holds at
   * resolution time is what plays.
   */
  private async publishCommit(gameId: string, snakeId: string, turn: number): Promise<void> {
    if (!this.db || this.connState !== 'connected') {
      throw new Error('Firebase interface not connected');
    }
    const watched = this.watchedGames.get(gameId);
    if (!watched) throw new Error(`Unknown game ${gameId}`);

    await updateDoc(
      doc(
        this.db,
        `sessions/${watched.sessionID}/games/${watched.gameID}/moveStatuses/${turn}`
      ),
      { movedPlayerIDs: arrayUnion(snakeId) }
    );
    console.log(`[tt-firebase] Committed ${snakeId} as done for turn ${turn}`);
  }
}
