// The TacticToes game transport: this centaur connects to the TacticToes
// Firebase project directly and drives every game through Firestore. There is
// no HTTP Battlesnake interface — Firebase is the single source of truth for
// what is staged, and the game server resolves each turn with the LAST staged
// move written before the turn deadline.
//
// Responsibilities:
//   1. Auth: exchange the centaur API key for a Firebase custom token via the
//      `exchangeCentaurApiKey` callable, then signInWithCustomToken.
//   2. Discovery: listen to centaurs/{centaurId}/games for the invite docs the
//      server writes at game start; open one game-doc listener per live game.
//   3. Turn intake: turns are append-only and immutable, so every turn is
//      handled exactly once — turn 0 included, with no special case anywhere
//      in this file. Each is translated into per-snake Battlesnake-shaped
//      GameStates (a centaur controls its whole team of snakes) and fed to
//      the ActiveGameManager, which computes and stages each snake's move.
//   4. Staged-move publishing: the manager write-through publishes EVERY
//      staging action (bot recommendation, manual selection, queue step,
//      waypoint step, revert-to-bot, suicide) through the MoveSubmitter this
//      module wires up, as a privateMoves write. Re-staging simply writes
//      again; the server takes the last write before the deadline. Nothing
//      commits automatically: the staging window stays open until the game
//      server's own turn timer fires, unless a human hits Submit All (which
//      writes moveStatuses through the MoveCommitter).
//   5. Resolution bookkeeping: when the next turn arrives, the moves the
//      server actually applied are read from the turn's authoritative `moves`
//      map and fed back (decision log, UI move-committed events).

import { FirebaseApp, deleteApp, initializeApp } from 'firebase/app';
import {
  Auth,
  connectAuthEmulator,
  getAuth,
  signInWithCustomToken,
} from 'firebase/auth';
import {
  Firestore,
  QuerySnapshot,
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
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { CentaurMove, Direction, GameState } from '../types/battlesnake';
import { transientInterval, transientTimeout } from '../server/activity-controller';
import { VoronoiStrategy } from '../logic/voronoi-strategy';
import { BoardGraph } from '../logic/board-graph';
import { MoveAnalyzer } from '../logic/move-analyzer';
import { TeamDetector } from '../logic/team-detector';
import { DecisionLogger } from '../logic/decision-logger';
import { GameRegistry } from '../logic/game-registry';
import { ServerEventLogger } from '../logic/server-event-logger';
import { GameLogger } from '../utils/logger';
import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { PendingGameRegistry } from '../logic/pending-game-registry';
import { TTGameInvite, TTGameSetup, TTGameStateDoc } from './tactictoes-types';
import {
  ParsedTurn,
  buildBoardState,
  continuationDirection,
  controlledSnakeIDs,
  deriveDeathCells,
  directionToMoveIndex,
  moveIndexToDirection,
  parseLatestTurn,
  parseTurn,
  snakeIdentity,
  unitTypeFor,
  withYou,
} from './translate';

export interface FirebaseInterfaceConfig {
  projectId: string;
  apiKey: string;
  region: string;
  centaurId: string;
  centaurApiKey: string;
  emulators?: {
    firestoreHost?: string;
    firestorePort?: number;
    authUrl?: string;
    functionsHost?: string;
    functionsPort?: number;
  };
}

/**
 * Builds the config from env, or returns null when the interface is not
 * configured (web-UI-only mode).
 *
 * Throws when the interface IS otherwise configured but
 * TACTICTOES_FUNCTIONS_REGION is missing. The region is deliberately NOT
 * defaulted: source code must stay deployment-agnostic, deployments point at
 * Firebase projects in different regions, and a silent us-central1 fallback
 * once produced a confusing functions/not-found in production. Failing startup
 * calls the missing value out instead of quietly degrading to UI-only mode.
 */
export function firebaseInterfaceConfigFromEnv(
  env: NodeJS.ProcessEnv
): FirebaseInterfaceConfig | null {
  const centaurId = env.TACTICTOES_CENTAUR_ID;
  const centaurApiKey = env.TACTICTOES_CENTAUR_API_KEY;
  const projectId = env.TACTICTOES_FIREBASE_PROJECT_ID;
  const apiKey = env.TACTICTOES_FIREBASE_API_KEY;
  const region = env.TACTICTOES_FUNCTIONS_REGION;
  if (!centaurId || !centaurApiKey || !projectId || !apiKey) return null;
  if (!region) {
    throw new Error(
      'TACTICTOES_FUNCTIONS_REGION is not set but the other TACTICTOES_* variables are. ' +
        'The functions region is required configuration with no default — set it to the ' +
        "region where the TacticToes project's Cloud Functions are deployed (see README.md)."
    );
  }

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
    region,
    centaurId,
    centaurApiKey,
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
  // Latest server-acked staged move per owned snake (ts <= endTime), i.e.
  // the move the server's own resolution rule would pick right now. Snakes
  // are decoded to a Direction; chess pieces keep the raw destination index.
  confirmed: Map<string, { ts: number; move: CentaurMove }>;
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
  // Serializes onGameUpdate per game: an early-resolving turn can deliver the
  // next snapshot while the previous one is mid-processing, and interleaved
  // runs would double-apply bookkeeping or misorder manager state updates.
  updateChain?: Promise<void>;
  registered: boolean;
  latestDoc: TTGameStateDoc | null;
  turnWatch: TurnWatch | null;
  // Watchdog state: when the last game-doc snapshot arrived. A listener the
  // SDK silently gave up on (emulator stream corruption, network partition)
  // otherwise leaves the centaur blind while the server plays default moves.
  lastSnapshotMs: number;
}

/**
 * Whether a watched game's silence is evidence of a dead listener.
 *
 * Silence alone is not: a turn is quiet BY DESIGN until it resolves, because
 * the next write to the game doc is the next turn being appended. That happens
 * at the current turn's `turnEndTimeMs` (sooner only if every player commits
 * early), so only silence PAST that deadline is suspicious. Turn 0 runs for
 * `firstTurnTime` — 60s by default — so a plain quiet window would condemn a
 * perfectly healthy game every few seconds.
 *
 * `turnEndTimeMs` of 0 means "no deadline known", falling back to plain
 * silence.
 */
export function listenerLooksDead(params: {
  now: number;
  lastSnapshotMs: number;
  turnEndTimeMs: number;
  graceMs: number;
}): boolean {
  const { now, lastSnapshotMs, turnEndTimeMs, graceMs } = params;
  if (now - lastSnapshotMs <= graceMs) return false;
  return now > turnEndTimeMs + graceMs;
}

/**
 * A missing status field means the invite predates the pending protocol —
 * started. 'finished' (stamped at game end by a planned TacticToes-side
 * change; never written today) means the game is over: never watch it, so a
 * stale invite replay can't even briefly open a listener on a finished game.
 */
export function inviteStatus(
  invite: Pick<TTGameInvite, 'status'>
): 'pending' | 'started' | 'finished' {
  if (invite.status === 'pending') return 'pending';
  if (invite.status === 'finished') return 'finished';
  return 'started';
}

/**
 * Whether our centaurStatus ack needs (re)writing: the doc is missing (first
 * ack) or the lobby flipped ready back to false to request a health recheck.
 */
export function needsReack(statusDoc: { ready?: unknown } | undefined): boolean {
  return statusDoc?.ready !== true;
}

export type GameDocSnapshotAction = 'process' | 'ignore' | 'endAndUnwatch' | 'unwatch';

/**
 * What a game-doc snapshot means for the watch lifecycle. Pure so the
 * deletion semantics are testable.
 *
 * Firestore never announces deletion as anything but a snapshot whose doc
 * does not exist, and this game-doc listener is the ONLY place the centaur
 * can observe it: the invite doc lives under centaurs/{id}/games — outside
 * the session subtree — so it survives a session delete (console cascade
 * included) and keeps replaying the dead game on every boot. Before this
 * helper existed those snapshots were silently ignored, which left the game
 * on /play until the idle sweep and, worse, left the watchedGames entry
 * starving the listener watchdog into a permanent client-rebuild loop.
 *
 * Non-existence is only authoritative from a server-backed snapshot: a
 * cache-first delivery can transiently claim a doc is missing, so
 * fromCache non-existence is ignored (the server delivery follows).
 *
 * - 'endAndUnwatch': a game we registered was deleted out from under us —
 *   end every controlled snake through the normal exit path, stop watching.
 * - 'unwatch': a stale invite replay points at a doc that no longer exists —
 *   nothing was ever registered, just stop watching.
 * - 'ignore': nothing actionable (no turns yet, or unconfirmed cache state).
 * - 'process': a live doc with turns — the normal pipeline.
 */
export function gameDocSnapshotAction(params: {
  exists: boolean;
  fromCache: boolean;
  hasTurns: boolean;
  registered: boolean;
}): GameDocSnapshotAction {
  const { exists, fromCache, hasTurns, registered } = params;
  if (!exists) {
    if (fromCache) return 'ignore';
    return registered ? 'endAndUnwatch' : 'unwatch';
  }
  return hasTurns ? 'process' : 'ignore';
}

export type InviteChangeAction =
  | 'trackPending' // start tracking a pending lobby (ack + setup subscription)
  | 'watch' // normal started-game flow
  | 'promote' // pending lobby just started: drop the tracking, then watch
  | 'dropPending' // invite deleted (team removed from the lobby)
  | 'none';

/**
 * What an invite-feed docChange means for this centaur, given whether the
 * game is currently tracked as pending. Pure so the pending → started
 * transition (and invite deletion) handling is testable.
 */
export function inviteChangeAction(
  changeType: 'added' | 'modified' | 'removed',
  status: 'pending' | 'started' | 'finished',
  currentlyPending: boolean
): InviteChangeAction {
  if (changeType === 'removed') {
    // NOTE: 'removed' is NOT evidence the game was deleted. The invite feed
    // is orderBy(createdAt desc) + limit(20), so an invite that merely falls
    // out of the window surfaces as 'removed' with nothing deleted. The
    // game-doc listener is the sole authority for a started game's existence
    // (see gameDocSnapshotAction); here removal only matters for pending
    // lobbies, whose invites really are deleted when the team is removed.
    return currentlyPending ? 'dropPending' : 'none';
  }
  if (status === 'finished') {
    // The game is over: nothing to watch. A finished invite that was somehow
    // still tracked as pending drops its lobby tracking. Games this centaur
    // is actively watching don't need handling here — the winners-bearing
    // final turn on the game doc ends them through the normal flow.
    return currentlyPending ? 'dropPending' : 'none';
  }
  if (status === 'pending') {
    // 'modified' while already pending is just the invite doc churning; the
    // setup subscription tracks the lobby's settings on its own.
    return currentlyPending ? 'none' : 'trackPending';
  }
  return currentlyPending ? 'promote' : 'watch';
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
  // Pending (unstarted) lobbies this centaur is invited to: gameID → setup-doc
  // subscription. Display data lives in the PendingGameRegistry; no game-doc
  // listener or turn pipeline is involved until the invite flips to started.
  private pendingGames = new Map<
    string,
    { sessionID: string; unsubscribe: Unsubscribe; statusUnsubscribe: Unsubscribe }
  >();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private rebuilding = false;
  private stopped = false;

  private readonly gameManager = ActiveGameManager.getInstance();
  private readonly teamDetector = new TeamDetector();
  private readonly gameLogger = new GameLogger();
  private readonly quickAnalyzer = new MoveAnalyzer();

  // Connection status surfaced to the web UI (banner + /api/firebase-status).
  // The centaur is nonfunctional without Firebase, so operators must be able to
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

  /**
   * One-line failure description with enough context to act on: Firebase
   * error code + message, plus which callable/region/project we were talking
   * to. The project id is masked because it is stored as a secret.
   */
  private connectFailureDetail(err: unknown): string {
    const e = err as { code?: string; message?: string };
    const proj = this.config.projectId;
    const masked = proj.length > 6 ? `${proj.slice(0, 4)}…` : proj;
    const code = e?.code ? `${e.code}: ` : '';
    return (
      `${code}${e?.message || String(err)} ` +
      `(exchangeCentaurApiKey @ region ${this.config.region}, project ${masked}, centaur ${this.config.centaurId})`
    );
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
   * reason to hold Firestore gRPC streams open (and a centaur with no
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
    this.detachPendingGames();
    this.teardownClient();
    console.log(
      '[tt-firebase] Suspended (instance idle: no verifiable human action within ' +
      'the grace window and no progressing game within the attention cap — ' +
      'allowing scale to zero)'
    );
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
    // Every awaiter of connectOp uses `.catch(() => undefined)`; without a
    // handler on the stored chain itself, a failed connect becomes an
    // unhandledRejection that kills the whole process (blank preview).
    this.connectOp.catch(() => undefined);
    try {
      await op;
    } catch (err) {
      // Log here — start() is reached by initial boot, resume() and the
      // banner Retry button, and several of those callers intentionally
      // swallow the rejection (status is their signal). Without this line a
      // failed retry/resume leaves no trace in the server log.
      const detail = this.connectFailureDetail(err);
      console.error(`[tt-firebase] Connect failed — ${detail}`, err);
      this.setStatus('error', detail);
      // Tear down the partially initialized app so a retry starts from a
      // clean slate instead of leaking one Firebase app per attempt.
      this.teardownClient();
      throw err;
    }

    // Listener watchdog: if a watched game's doc listener goes quiet when a
    // snapshot was actually DUE, the stream died without the error callback
    // firing (the SDK's gRPC Listen stream can die on corrupted
    // RESOURCE_EXHAUSTED frames and then go permanently silent). Resubscribing
    // on the same client does NOT recover — a fresh listen on a corrupted gRPC
    // session stays dead (verified empirically) — so go straight to a full
    // client rebuild.
    //
    // "Due" is the important word. A turn is quiet BY DESIGN until it
    // resolves: the next write to the game doc is the next turn being
    // appended, which happens at the current turn's endTime (sooner only if
    // every player commits early). So silence is only evidence of a dead
    // stream once that deadline has passed. A fixed quiet window is not —
    // turn 0 runs for `firstTurnTime`, 60s by default, and even ordinary
    // turns outlast a few seconds of silence, so a fixed window declares
    // healthy games blind over and over.
    //
    // Double-start hazard fix: clear any existing watchdog before assigning.
    // Previously start() overwrote the field unconditionally and only caller
    // discipline (retryConnect's watchdogTimer check) prevented a second
    // interval from leaking unstoppably.
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.watchdogTimer = transientInterval(() => {
      const GRACE_MS = 8_000;
      const now = Date.now();
      for (const watched of this.watchedGames.values()) {
        const dead = listenerLooksDead({
          now,
          lastSnapshotMs: watched.lastSnapshotMs,
          turnEndTimeMs: this.nextTurnDueBy(watched),
          graceMs: GRACE_MS,
        });
        if (!dead) continue;
        void this.rebuildClient();
        break;
      }
    }, 2_500);
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

    const exchange = httpsCallable<{ centaurId: string; apiKey: string }, { customToken: string }>(
      functions,
      'exchangeCentaurApiKey'
    );
    const { data } = await exchange({ centaurId: config.centaurId, apiKey: config.centaurApiKey });
    await signInWithCustomToken(this.auth, data.customToken);
    console.log(`[tt-firebase] Signed in as centaur:${config.centaurId}`);
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
      collection(this.db, `centaurs/${config.centaurId}/games`),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    this.invitesUnsubscribe = onSnapshot(
      invitesQuery,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const invite = change.doc.data() as TTGameInvite;
          const action = inviteChangeAction(
            change.type,
            inviteStatus(invite),
            this.pendingGames.has(invite.gameID)
          );
          switch (action) {
            case 'trackPending':
              this.trackPendingGame(invite.sessionID, invite.gameID);
              break;
            case 'promote':
              this.dropPendingGame(invite.gameID);
              this.watchGame(invite.sessionID, invite.gameID);
              break;
            case 'watch':
              this.watchGame(invite.sessionID, invite.gameID);
              break;
            case 'dropPending':
              this.dropPendingGame(invite.gameID);
              break;
          }
        });
        this.reconcilePendingGames(snapshot);
      },
      (err) => {
        // Terminal invite-stream failure. The game-doc watchdog only covers
        // watched games — with zero live games a dead invite feed would
        // otherwise leave the centaur blind forever while reporting 'connected'.
        console.error('[tt-firebase] Invite listener failed:', err);
        this.setStatus('error', `Invite listener failed: ${String((err as Error)?.message || err)}`);
        if (!this.stopped) {
          transientTimeout(() => {
            if (!this.stopped && this.connState === 'error') void this.rebuildClient();
          }, 5_000);
        }
      }
    );
  }

  /**
   * When the next game-doc write is expected: the current turn's endTime, at
   * which the server resolves the turn and appends the next one. Returns 0
   * when no deadline is known, which makes the caller fall back to plain
   * silence.
   */
  private nextTurnDueBy(watched: WatchedGame): number {
    const doc = watched.latestDoc;
    if (!doc) return 0;
    return parseLatestTurn(doc)?.endTimeMs(0) ?? 0;
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
   *
   * The per-turn read-back listeners must be re-opened explicitly
   * (restoreTurnWatch): they belong to the client being destroyed, and the
   * replayed game-doc snapshot will NOT rebuild them, because the turn number
   * hasn't advanced.
   */
  private async rebuildClient(): Promise<void> {
    if (this.rebuilding || this.stopped) {
      // Join an in-flight rebuild instead of silently returning, so
      // retryConnect() reports the real outcome.
      if (this.connectOp) await this.connectOp.catch(() => undefined);
      return;
    }
    this.rebuilding = true;
    console.warn('[tt-firebase] Game-doc snapshot overdue past the turn deadline — rebuilding Firebase client');
    let resolveOp: () => void = () => {};
    this.connectOp = new Promise<void>((r) => { resolveOp = r; });
    try {
      this.setStatus('connecting');
      for (const watched of this.watchedGames.values()) {
        watched.unsubscribe();
        watched.unsubscribe = () => {};
        this.teardownTurnWatch(watched);
      }
      this.detachPendingGames();
      this.teardownClient();

      await this.initClient();

      for (const watched of this.watchedGames.values()) {
        watched.lastSnapshotMs = Date.now();
        this.subscribeGameDoc(watched);
        this.restoreTurnWatch(watched);
      }
      console.warn('[tt-firebase] Firebase client rebuilt; listeners restored');
    } catch (err) {
      const detail = this.connectFailureDetail(err);
      console.error(`[tt-firebase] Client rebuild failed (will retry on next starvation) — ${detail}`, err);
      this.setStatus('error', detail);
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
    this.dropAllPendingGames();
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
        const action = gameDocSnapshotAction({
          exists: snapshot.exists(),
          fromCache: snapshot.metadata.fromCache,
          hasTurns: !!data && Array.isArray(data.turns) && data.turns.length > 0,
          registered: watched.registered,
        });
        if (action === 'ignore') return;
        if (action === 'endAndUnwatch' || action === 'unwatch') {
          this.dropDeletedGame(watched, action === 'endAndUnwatch');
          return;
        }
        watched.latestDoc = data!;
        watched.updateChain = (watched.updateChain ?? Promise.resolve())
          .then(() => this.onGameUpdate(watched, data!))
          .catch((err) => {
            console.error(`[tt-firebase] Error handling update for game ${watched.gameID}:`, err);
          });
      },
      (err) => {
        // Terminal listener error: the SDK will NOT retry after calling this.
        // Resubscribe after a short backoff.
        console.error(`[tt-firebase] Game listener error for ${watched.gameID} — resubscribing:`, err.message);
        watched.unsubscribe();
        transientTimeout(() => {
          if (!this.stopped && this.watchedGames.has(watched.gameID)) {
            this.subscribeGameDoc(watched);
          }
        }, 1000);
      }
    );
  }

  /**
   * A pending invite: the lobby exists but the game hasn't started. Ack it
   * (the lobby's presence indicator feeds off the centaurStatus doc) and
   * mirror the lobby's live settings into the PendingGameRegistry so /play
   * can show the pending bubble. No game-doc listener, no turn pipeline.
   */
  private trackPendingGame(sessionID: string, gameID: string): void {
    if (this.stopped || !this.db) return;
    if (this.pendingGames.has(gameID) || this.watchedGames.has(gameID)) return;
    console.log(`[tt-firebase] Tracking pending game ${gameID} in session ${sessionID}`);

    // Readiness ack, kept live: the lobby can request a health recheck by
    // flipping our ack back to ready == false (or the doc may not exist yet),
    // and we answer by (re)writing ready == true. Our own write settles the
    // doc at ready == true, so the listener cannot loop.
    const statusRef = doc(
      this.db,
      `sessions/${sessionID}/setups/${gameID}/centaurStatus/${this.config.centaurId}`
    );
    const statusUnsubscribe = onSnapshot(
      statusRef,
      (snapshot) => {
        if (!needsReack(snapshot.exists() ? snapshot.data() : undefined)) return;
        void setDoc(
          statusRef,
          { centaurId: this.config.centaurId, ready: true, respondedAt: serverTimestamp() },
          { merge: true }
        ).catch((err) => {
          console.error(`[tt-firebase] Failed to ack pending game ${gameID}:`, err);
        });
      },
      (err) => {
        console.error(`[tt-firebase] centaurStatus listener failed for ${gameID}:`, err);
      }
    );

    const unsubscribe = onSnapshot(
      doc(this.db, `sessions/${sessionID}/setups/${gameID}`),
      (snapshot) => {
        const setup = snapshot.data() as Partial<TTGameSetup> | undefined;
        if (!setup) return;
        PendingGameRegistry.getInstance().upsert({
          sessionID,
          gameID,
          boardWidth: setup.boardWidth ?? null,
          boardHeight: setup.boardHeight ?? null,
          snakesPerTeam: setup.snakesPerTeam ?? null,
          maxTurnTime: setup.maxTurnTime ?? null,
          teams: (setup.teams ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            ours: t.id === this.config.centaurId,
          })),
        });
      },
      (err) => {
        console.error(`[tt-firebase] Pending setup listener failed for ${gameID}:`, err);
      }
    );
    this.pendingGames.set(gameID, { sessionID, unsubscribe, statusUnsubscribe });
  }

  /**
   * Make the pending-game state a projection of the CURRENT invite query
   * result, not just an accumulation of docChanges: removals that happened
   * while no listener was attached (suspend/resume, client rebuild) are
   * invisible to docChanges but cannot hide from the full snapshot. Drops
   * tracked pending games whose invite is no longer pending, and display
   * registry entries that outlived their subscriptions (kept across a client
   * rebuild so the lobby doesn't flicker) whose invite is gone entirely.
   * Cache-only deliveries are skipped — they can lag the server and would
   * drop entries that still exist.
   */
  private reconcilePendingGames(snapshot: QuerySnapshot): void {
    if (snapshot.metadata.fromCache) return;
    const pendingIds = new Set<string>();
    for (const docSnap of snapshot.docs) {
      const invite = docSnap.data() as TTGameInvite;
      if (inviteStatus(invite) === 'pending') pendingIds.add(invite.gameID);
    }
    for (const gameID of [...this.pendingGames.keys()]) {
      if (!pendingIds.has(gameID)) this.dropPendingGame(gameID);
    }
    const registry = PendingGameRegistry.getInstance();
    for (const info of registry.list()) {
      if (!pendingIds.has(info.gameID) && !this.pendingGames.has(info.gameID)) {
        registry.remove(info.gameID);
      }
    }
  }

  private dropPendingGame(gameID: string): void {
    const pending = this.pendingGames.get(gameID);
    if (!pending) return;
    pending.unsubscribe();
    pending.statusUnsubscribe();
    this.pendingGames.delete(gameID);
    PendingGameRegistry.getInstance().remove(gameID);
    console.log(`[tt-firebase] Stopped tracking pending game ${gameID}`);
  }

  // Pending setup listeners belong to the client being torn down; the invite
  // replay on the next connect re-tracks (and re-acks) everything still pending.
  private dropAllPendingGames(): void {
    for (const gameID of [...this.pendingGames.keys()]) this.dropPendingGame(gameID);
  }

  // Detach the pending setup listeners WITHOUT clearing the display registry:
  // used by suspend/rebuild, where the invite replay on the next connect
  // re-tracks everything still pending and reconcilePendingGames sweeps away
  // whatever is gone. Clearing the registry here made every client rebuild
  // blink the lobby's pending cards out and back.
  private detachPendingGames(): void {
    for (const pending of this.pendingGames.values()) {
      pending.unsubscribe();
      pending.statusUnsubscribe();
    }
    this.pendingGames.clear();
  }

  /**
   * The game doc no longer exists (server-confirmed): it was deleted out from
   * under us — e.g. an admin deleted the session in the Firebase console,
   * whose delete cascades through the games subcollection. End every
   * controlled snake through the manager's normal exit path (no final state —
   * there is none) so /play drops the game immediately, then stop watching so
   * the listener watchdog doesn't condemn the dead doc's silence and rebuild
   * the client forever.
   */
  private dropDeletedGame(watched: WatchedGame, endSnakes: boolean): void {
    console.warn(
      `[tt-firebase] Game doc for ${watched.gameID} no longer exists — ` +
        (endSnakes ? 'ending game' : 'dropping stale invite watch')
    );
    if (endSnakes && this.gameManager.getGame(watched.gameID)) {
      this.gameManager.endGame(watched.gameID);
    }
    this.unwatchGame(watched);
  }

  private unwatchGame(watched: WatchedGame): void {
    watched.unsubscribe();
    this.teardownTurnWatch(watched);
    this.watchedGames.delete(watched.gameID);
    this.strategy.onGameEnd(watched.gameID);
    console.log(`[tt-firebase] Stopped watching game ${watched.gameID}`);
  }

  /**
   * Re-open the current turn's read-back listeners on a freshly rebuilt
   * client. Without this the centaur spends the REST of the turn blind to its own
   * staged moves: writes still land and still play, but nothing ever confirms
   * (the solid arrow never catches up to the ghost) and no commit is ever
   * observed (no finalization). A long first turn made that the normal case.
   */
  private restoreTurnWatch(watched: WatchedGame): void {
    const data = watched.latestDoc;
    if (!data) return;
    const pt = parseLatestTurn(data);
    if (!pt) return;
    // A turn we haven't processed yet is the replayed snapshot's job — it will
    // run the full pipeline, turn watch included.
    if (pt.turnNumber !== watched.lastProcessedTurn) return;

    if (pt.isFinal) return; // game over — nothing left to stage

    const aliveOurs = controlledSnakeIDs(data.setup, this.config.centaurId).filter((id) =>
      pt.alive(id)
    );
    if (aliveOurs.length === 0) return;

    const endTimeMs = pt.endTimeMs(Date.now() + 10_000);
    console.log(
      `[tt-firebase] Re-opening turn ${pt.turnNumber} read-back for ${watched.gameID} after client rebuild`
    );
    this.beginTurnWatch(watched, data.setup, pt, endTimeMs, aliveOurs);
  }

  private teardownTurnWatch(watched: WatchedGame): void {
    const tw = watched.turnWatch;
    if (!tw) return;
    tw.moveUnsubs.forEach((unsub) => unsub());
    tw.statusUnsub?.();
    watched.turnWatch = null;
  }

  private async onGameUpdate(watched: WatchedGame, data: TTGameStateDoc): Promise<void> {
    const pt = parseLatestTurn(data);
    if (!pt) return;
    const turnNumber = pt.turnNumber;
    // Turns are append-only and immutable: the server writes each one exactly
    // once, deadline included (TacticToes `startGame` for turn 0, `processTurn`
    // for the rest). So a snapshot that doesn't advance the turn number has
    // nothing new in it — the game doc simply changed elsewhere, or the SDK
    // re-delivered from cache then server.
    if (turnNumber <= watched.lastProcessedTurn) return;
    const prevProcessed = watched.lastProcessedTurn;
    // NOTE: lastProcessedTurn is advanced only after this turn's bookkeeping
    // and fast staging pass succeed — a throw mid-processing leaves the cursor
    // behind so the turn is retried on the next snapshot instead of being
    // silently skipped forever.

    const ourSnakes = controlledSnakeIDs(data.setup, this.config.centaurId);
    if (ourSnakes.length === 0) {
      this.unwatchGame(watched);
      return;
    }

    // Stale invite replay: if the game is ALREADY finished on its very first
    // snapshot, never surface it. Registering first and ending a moment later
    // flashes a phantom 1-turn game onto /play on every boot/reconnect (the
    // invite feed replays the 20 most recent invites, finished ones included).
    if (!watched.registered && pt.isFinal) {
      console.log(
        `[tt-firebase] Ignoring already-finished game ${watched.gameID} from invite replay`
      );
      this.unwatchGame(watched);
      return;
    }

    ServerEventLogger.getInstance().recordGameActivity(watched.gameID);

    const endTimeMs = pt.endTimeMs(Date.now() + 10_000);

    // ONE canonical (you-less) board state per turn — the single truth the
    // manager, the logs, and every broadcast operate on. Per-snake views are
    // derived from it with withYou only at the decision-engine boundary.
    const canonical = buildBoardState(watched.gameID, data.setup, pt.turn, turnNumber, endTimeMs);

    // First snapshot for this game: register every controlled snake so the
    // centaur UI lists them and the manager tracks their intents.
    if (!watched.registered) {
      watched.registered = true;
      const ourTeamEntry = data.setup.teams.find((t) => t.id === this.config.centaurId);
      const ourTeam = ourTeamEntry
        ? { id: ourTeamEntry.id, name: ourTeamEntry.name, color: ourTeamEntry.color }
        : null;
      this.gameLogger.startGame(canonical, ourSnakes);
      GameRegistry.getInstance().recordGameStart(canonical);
      for (const snakeId of ourSnakes) {
        // Identity from the setup, not the board: a snake already dead at
        // registration time (mid-game restart) isn't on the board anymore.
        this.gameManager.registerGame(canonical, snakeId, ourTeam, snakeIdentity(data.setup, snakeId));
      }
      // Let the manager know which engine-server session this game belongs
      // to, so the lobby can link to the game on the engine server.
      this.gameManager.setGameSession(watched.gameID, watched.sessionID);
    }

    // Read the moves the server actually applied on the PREVIOUS turn from
    // the new turn's authoritative `moves` map. Bookkeeping must run BEFORE
    // the new board is fed in so it measures against the old head. The map
    // also rides on the canonical state (GameState.lastMoves), where it drives
    // our own resolved-move bookkeeping and the decision log. It is NOT the
    // death channel any more — `deathCells` below is (see deriveDeathCells).
    if (turnNumber > 0) {
      const prevPt = parseTurn(data, turnNumber - 1)!;
      const lastMoves = this.deriveLastMoves(data.setup, prevPt, pt);
      canonical.lastMoves = lastMoves;
      // Everything that died this turn: its authoritative death cell, straight
      // from the turn's `deaths` registry, rides on the canonical state so the
      // renderer can mark the actual square — mid-ray deaths, starvation halts
      // and edge-contest losers that never left their own square included —
      // live and in the logged replay.
      const deathCells = deriveDeathCells(pt);
      if (Object.keys(deathCells).length > 0) canonical.deathCells = deathCells;
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

    // Final turn: close the game everywhere off the canonical final state.
    // The winners array (enriched with each winner's teamID from the setup)
    // rides along so the games registry can record the true winner — the
    // board-survivor fallback can't see team wins.
    if (pt.isFinal) {
      watched.lastProcessedTurn = turnNumber;
      // The game is over: the turn deadline is meaningless on the final state
      // (the old end path always passed null), so don't let it ride into the
      // stored turn row or the snake-ended payloads.
      delete (canonical.game as any).turnExpiryTime;
      (canonical as any).winners = pt.turn.winners.map((w) => {
        const teamID = data.setup.gamePlayers.find((gp) => gp.id === w.playerID)?.teamID ?? null;
        return {
          ...w,
          teamID,
          // Display name for the games table — winnerName must never hold a
          // raw team id.
          teamName: (teamID && data.setup.teams.find((t) => t.id === teamID)?.name) || null,
        };
      });
      // Persist the FINAL board too — the death positions were never
      // replayable before (no /move is made on the final turn, so no decision
      // row ever covered it).
      DecisionLogger.getInstance().logTurnState({
        gameId: watched.gameID,
        turn: turnNumber,
        gameState: canonical,
      });
      this.gameLogger.endGame(canonical);
      GameRegistry.getInstance().recordGameEnd(canonical);
      this.gameManager.endGame(watched.gameID, canonical);
      this.unwatchGame(watched);
      return;
    }

    // Persist this turn's canonical board onto the turn-state row (the
    // decision pass upserts the territory half; either order works).
    DecisionLogger.getInstance().logTurnState({
      gameId: watched.gameID,
      turn: turnNumber,
      gameState: canonical,
    });

    const aliveOurs = ourSnakes.filter((id) => pt.alive(id));
    if (aliveOurs.length === 0) {
      // All our snakes are dead but the game continues; nothing left to stage.
      // Keep watching so the UI still receives the final state at game end.
      watched.lastProcessedTurn = turnNumber;
      // The canonical board still advances so spectators see the game play
      // out — with a live turn clock, not one frozen at our death turn.
      this.gameManager.recordTurnArrival(
        watched.gameID,
        Date.now(),
        data.setup.maxTurnTime * 1000,
        endTimeMs
      );
      this.gameManager.updateBoard(watched.gameID, canonical);
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
    this.beginTurnWatch(watched, data.setup, pt, endTimeMs, aliveOurs);

    // Our chess pieces take a different intake path: no engine decision (the
    // minimax engine drives snakes only), no quick safe move — a piece with
    // no operator command stages nothing and the server defaults it to stay.
    const pieceUnits = new Set(
      aliveOurs.filter((id) => unitTypeFor(data.setup, pt.turn, id) !== 'snake')
    );

    // Feed the canonical board ONCE: goto-arrival checks for every controlled
    // snake, then the board advance and the single board-update broadcast.
    this.gameManager.updateBoard(watched.gameID, canonical);

    // FAST PASS: immediately stage a cheap safe move for every snake so a
    // short turn deadline never catches a snake with nothing staged (the
    // engine default is "continue straight", which is often a wall). The
    // full strategy pass below re-stages a better move; re-staging simply
    // supersedes this one in Firebase.
    const views = new Map<string, GameState>();
    for (const snakeId of aliveOurs) {
      const view = withYou(canonical, snakeId);
      if (!view) {
        // alivePlayers said the snake is alive but it isn't on the board —
        // inconsistent turn doc; skip rather than fabricate a view.
        console.error(`[tt-firebase] Alive snake ${snakeId} missing from board on turn ${turnNumber} of ${watched.gameID}`);
        continue;
      }
      if (pieceUnits.has(snakeId)) {
        // Piece turn intake: updateBoard above already advanced the board and
        // ran the goto-arrival shift; this refreshes the unit type (promotion)
        // and re-stages the piece's goto command against the new turn. No
        // quick safe move and no engine decision — an uncommanded piece
        // stages nothing and the server defaults it to stay.
        this.gameManager.updatePieceTurn(watched.gameID, snakeId, view);
        continue;
      }
      views.set(snakeId, view);
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

    // Bookkeeping and fast staging succeeded: the turn is consumed. (The full
    // pass below is fire-and-forget, so a failure there never skips a turn.)
    watched.lastProcessedTurn = turnNumber;

    // FULL PASS: one ANYTIME strategy decision per controlled alive snake, all
    // snakes launched CONCURRENTLY. Each decision fans its simulations out
    // across the shared worker-thread pool and reports an updated best move
    // every ~100ms; we forward a recommendation to the manager only when the
    // move actually changed (the write-through republishes to Firestore, so
    // unchanged updates would just flood the wire). The final recommendation
    // carries the full debug payload. Decisions stop at the shared deadline —
    // shortly before the turn's endTime, leaving room for the staging write.
    //
    // NOT awaited: onGameUpdate runs on a per-game serial chain, and a turn
    // can resolve EARLY (every snake committed) while these decisions are
    // still running — awaiting them here would delay the next turn's fast
    // pass behind a doomed computation. Stale results are dropped by the
    // manager's turn guard in setBotRecommendation; every branch below
    // handles its own errors.
    // Decisions are computed for our SNAKE units only — own pieces get no
    // engine recommendation (their moves are operator commands or stay).
    const deadlineMs = Math.max(Date.now() + 200, endTimeMs - 150);
    void Promise.all(
      // views holds SNAKE units only (pieces took the intake branch above),
      // so this fan-out is snake-only by construction.
      [...views.keys()].map(async (snakeId) => {
        const view = views.get(snakeId)!;
        try {
          const teams = this.teamDetector.detectTeams(view.board.snakes);
          const ourTeam = teams.find((team) => team.snakes.some((s) => s.id === snakeId));
          const waypoint = this.gameManager.getActiveWaypointTarget(watched.gameID, snakeId);

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
          // The fallback staging itself must never throw: this whole pass is
          // fire-and-forget (void Promise.all below), so a synchronous throw
          // from setBotRecommendation here would reject the voided promise
          // and land in index.ts's unhandledRejection handler — killing the
          // process over one snake's failed fallback. Log and move on.
          try {
            this.gameManager.setBotRecommendation(watched.gameID, snakeId, 'up', {
              gameState: view,
              moveEvaluations: [],
              territoryCells: {},
              safeMoves: [],
              botRecommendation: 'up',
              timestamp: Date.now(),
            });
          } catch (stagingErr) {
            console.error(`[tt-firebase] Fallback staging failed for ${snakeId} turn ${turnNumber} of ${watched.gameID}:`, stagingErr);
          }
        }
      })
    ).catch((err) => {
      // Belt-and-braces: nothing above should be able to reject, but a voided
      // Promise.all with no .catch would turn any future slip here into an
      // unhandledRejection → process exit. Contain it to a log line instead.
      console.error(`[tt-firebase] Decision pass rejected for game ${watched.gameID} turn ${turnNumber}:`, err);
    });
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
    setup: TTGameSetup,
    pt: ParsedTurn,
    endTimeMs: number,
    aliveOurs: string[]
  ): void {
    if (!this.db) return;
    this.teardownTurnWatch(watched);

    const turnNumber = pt.turnNumber;
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

    // Chess pieces confirm by RAW destination index — their staged move is any
    // legal square, so the adjacency decode (and its warning) never applies.
    const pieceUnits = new Set(
      aliveOurs.filter((id) => unitTypeFor(setup, pt.turn, id) !== 'snake')
    );

    // A snake finalizes once its commit is observed AND its outcome is
    // knowable from Firebase state (never from timers):
    //  - a confirmed staged move → that move;
    //  - provably nothing staged → the engine's deterministic default
    //    (step along its orientation). This inference is exact because ONLY
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
        this.gameManager.finalizeTurnMove(watched.gameID, snakeId, tw.turn, confirmed.move);
        return;
      }
      if (!tw.readBackReady.has(snakeId)) return;
      if (this.gameManager.hasUnconfirmedRequest(watched.gameID, snakeId, tw.turn)) return;
      if (pieceUnits.has(snakeId)) {
        // A piece's engine default is deterministic and always knowable: stay
        // on its own square.
        const stay = pt.headIndex(snakeId);
        if (stay === undefined) return;
        console.log(`[tt-firebase] Piece ${snakeId} committed with nothing staged — stay (${stay}) is final for turn ${tw.turn}`);
        this.gameManager.finalizeTurnMove(watched.gameID, snakeId, tw.turn, stay);
        return;
      }
      const def = continuationDirection(pt.turn, snakeId);
      console.log(`[tt-firebase] ${snakeId} committed with nothing staged — engine default ${def} is final for turn ${tw.turn}`);
      this.gameManager.finalizeTurnMove(watched.gameID, snakeId, tw.turn, def);
    };

    const movesCol = collection(
      this.db,
      `sessions/${watched.sessionID}/games/${watched.gameID}/privateMoves`
    );
    const width = pt.boardWidth;

    for (const snakeId of aliveOurs) {
      const headIndex = pt.headIndex(snakeId);
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
          // The confirmed move must be the one the server will actually
          // resolve with, so this mirrors processTurn's rule exactly: latest
          // SERVER-acked write (pending local writes have a null
          // serverTimestamp and don't count) whose timestamp is at or before
          // the turn's endTime. Both times are server-issued, so there is no
          // client clock in the comparison, and the turn's endTime never
          // moves once written.
          const isPiece = pieceUnits.has(snakeId);
          let best: { ts: number; move: CentaurMove } | null = null;
          snapshot.forEach((docSnap) => {
            const d = docSnap.data() as { move: number; timestamp: Timestamp | null };
            const ts = d.timestamp instanceof Timestamp ? d.timestamp.toMillis() : null;
            if (ts === null || ts > tw.endTimeMs) return;
            if (best && ts <= best.ts) return;
            if (isPiece) {
              // Pieces confirm by raw index: any square is a valid staged
              // destination (own square = stay), so no adjacency decode.
              best = { ts, move: d.move };
              return;
            }
            const direction = moveIndexToDirection(headIndex, d.move, width);
            if (!direction) {
              // Only reachable if the board moved under a staged write, which
              // append-only turns make impossible — so say so rather than
              // silently dropping the confirmation.
              console.warn(
                `[tt-firebase] Staged move for ${snakeId} turn ${tw.turn} is not adjacent to its head ` +
                  `(head=${headIndex}, move=${d.move}) — ignoring`
              );
              return;
            }
            best = { ts, move: direction };
          });
          if (best) {
            const chosen: { ts: number; move: CentaurMove } = best;
            tw.confirmed.set(snakeId, chosen);
            this.gameManager.setConfirmedStagedMove(
              watched.gameID,
              snakeId,
              turnNumber,
              chosen.move
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

  // The applied move for each snake on the prev → curr transition, read from
  // the new turn's authoritative `moves` map (the server records every
  // player's actually-applied move there, staged or engine default alike).
  private deriveLastMoves(setup: TTGameSetup, prev: ParsedTurn, curr: ParsedTurn): Record<string, Direction> {
    const width = prev.boardWidth;
    const result: Record<string, Direction> = {};
    for (const snakeId of Object.keys(prev.turn.playerPieces)) {
      // Chess pieces are skipped outright: their applied move is positional
      // (any square, own square = stay), so there is no direction bookkeeping —
      // and an adjacent piece step (king/pawn) must not masquerade as one.
      // This keeps applyResolvedMoves and decision-log server_moves snake-only
      // by construction; every dead unit's cell — snakes included — reaches
      // the renderer through deriveDeathCells instead.
      if (unitTypeFor(setup, prev.turn, snakeId) !== 'snake') continue;
      const prevHead = prev.headIndex(snakeId);
      if (prevHead === undefined) continue;
      // deploy-order tolerance: pre-moves turns from a not-yet-redeployed engine must not wedge the game
      const recorded = curr.turn.moves?.[snakeId];
      if (recorded === undefined) continue;
      const dir = moveIndexToDirection(prevHead, recorded, width);
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
    move: CentaurMove,
    source: string
  ): Promise<void> {
    if (!this.db || this.connState !== 'connected') {
      throw new Error('Firebase interface not connected');
    }
    const watched = this.watchedGames.get(gameId);
    const data = watched?.latestDoc;
    if (!watched || !data) throw new Error(`Unknown game ${gameId}`);

    // A numeric move is a chess piece's destination, ALREADY a full-board
    // index — it goes on the wire verbatim (no direction decode).
    let moveIndex: number;
    if (typeof move === 'number') {
      moveIndex = move;
    } else {
      const pt = parseTurn(data, turn);
      const headIndex = pt?.headIndex(snakeId);
      if (pt === null || headIndex === undefined) {
        throw new Error(`No head for ${snakeId} on turn ${turn} of ${gameId}`);
      }
      moveIndex = directionToMoveIndex(move, headIndex, pt.boardWidth, pt.boardHeight);
    }


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
