// Direct-Firebase interface to TacticToes.
//
// Instead of being poked over the Battlesnake HTTP API, this subsystem signs
// in to TacticToes' Firebase project as a bot principal and drives games
// through Firestore:
//
//   1. Exchange the bot API key for a Firebase custom token via the
//      `exchangeBotApiKey` callable, then signInWithCustomToken.
//   2. Listen to bots/{botId}/games for game invites the server writes at
//      game start.
//   3. For each live game, listen to the game document. Every appended turn
//      triggers a decision for each controlled snake (one bot identity can
//      own several snakes in Team Snek — originals and clones alike).
//   4. Stage a move by writing a privateMoves doc. Staging is repeatable:
//      the server resolves the turn with the LAST staged move whose server
//      timestamp precedes the turn's endTime, so later (better) moves
//      simply overwrite earlier ones.
//   5. Optionally "commit" close to the deadline by adding the snake to
//      moveStatuses.movedPlayerIDs. Committing tells the server this snake
//      is done, letting the turn resolve early once everyone has committed.
//      Until commit, the staging window stays open for re-staging.

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
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { Direction } from '../types/battlesnake';
import { VoronoiStrategy } from '../logic/voronoi-strategy-new';
import { TTGameInvite, TTGameStateDoc } from './tactictoes-types';
import { buildGameState, controlledSnakeIDs, directionToMoveIndex } from './translate';

export type CommitMode = 'immediate' | 'buffered' | 'never';

export interface FirebaseInterfaceConfig {
  projectId: string;
  apiKey: string;
  region: string;
  botId: string;
  botApiKey: string;
  commitMode: CommitMode;
  commitBufferMs: number;
  /** host:port of the emulator hub, e.g. "127.0.0.1:8080|9099|5001" style overrides for tests */
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

  const commitMode = (env.TACTICTOES_COMMIT_MODE || 'buffered') as CommitMode;
  return {
    projectId,
    apiKey,
    region: env.TACTICTOES_FUNCTIONS_REGION || 'us-central1',
    botId,
    botApiKey,
    commitMode: ['immediate', 'buffered', 'never'].includes(commitMode)
      ? commitMode
      : 'buffered',
    commitBufferMs: parseInt(env.TACTICTOES_COMMIT_BUFFER_MS || '2000', 10),
  };
}

interface WatchedGame {
  sessionID: string;
  gameID: string;
  unsubscribe: Unsubscribe;
  lastProcessedTurn: number;
  commitTimers: NodeJS.Timeout[];
}

export class TacticToesFirebaseInterface {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Firestore | null = null;
  private invitesUnsubscribe: Unsubscribe | null = null;
  private watchedGames = new Map<string, WatchedGame>();
  private stopped = false;

  constructor(
    private readonly strategy: VoronoiStrategy,
    private readonly config: FirebaseInterfaceConfig
  ) {}

  async start(): Promise<void> {
    const { config } = this;
    this.app = initializeApp(
      { projectId: config.projectId, apiKey: config.apiKey },
      'tactictoes'
    );
    this.auth = getAuth(this.app);
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

    // Recent-first invite feed. Finished games are filtered out on first
    // snapshot of their game doc, so replaying a few stale invites is cheap.
    const invitesQuery = query(
      collection(this.db, `bots/${config.botId}/games`),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    this.invitesUnsubscribe = onSnapshot(invitesQuery, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const invite = change.doc.data() as TTGameInvite;
        this.watchGame(invite.sessionID, invite.gameID);
      });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.invitesUnsubscribe?.();
    for (const game of this.watchedGames.values()) {
      game.unsubscribe();
      game.commitTimers.forEach(clearTimeout);
    }
    this.watchedGames.clear();
    if (this.app) await deleteApp(this.app);
    this.app = null;
  }

  private watchGame(sessionID: string, gameID: string): void {
    if (this.stopped || !this.db || this.watchedGames.has(gameID)) return;
    console.log(`[tt-firebase] Watching game ${gameID} in session ${sessionID}`);

    const gameRef = doc(this.db, `sessions/${sessionID}/games/${gameID}`);
    const watched: WatchedGame = {
      sessionID,
      gameID,
      lastProcessedTurn: -1,
      commitTimers: [],
      unsubscribe: onSnapshot(gameRef, (snapshot) => {
        const data = snapshot.data() as TTGameStateDoc | undefined;
        if (!data) return;
        this.onGameUpdate(watched, data).catch((err) => {
          console.error(`[tt-firebase] Error handling update for game ${gameID}:`, err);
        });
      }),
    };
    this.watchedGames.set(gameID, watched);
  }

  private unwatchGame(watched: WatchedGame): void {
    watched.unsubscribe();
    watched.commitTimers.forEach(clearTimeout);
    this.watchedGames.delete(watched.gameID);
    this.strategy.onGameEnd(watched.gameID);
    console.log(`[tt-firebase] Stopped watching game ${watched.gameID}`);
  }

  private async onGameUpdate(watched: WatchedGame, data: TTGameStateDoc): Promise<void> {
    const turnNumber = data.turns.length - 1;
    if (turnNumber < 0 || turnNumber <= watched.lastProcessedTurn) return;
    watched.lastProcessedTurn = turnNumber;

    const turn = data.turns[turnNumber];
    if (turn.winners.length > 0) {
      this.unwatchGame(watched);
      return;
    }

    const ourSnakes = controlledSnakeIDs(data.setup, this.config.botId).filter((id) =>
      turn.alivePlayers.includes(id)
    );
    if (ourSnakes.length === 0) {
      this.unwatchGame(watched);
      return;
    }

    const endTimeMs =
      turn.endTime instanceof Timestamp ? turn.endTime.toMillis() : Date.now() + 10_000;

    for (const snakeId of ourSnakes) {
      try {
        const gameState = buildGameState(
          watched.gameID,
          data.setup,
          turn,
          turnNumber,
          snakeId,
          endTimeMs
        );
        const direction = await this.strategy.getBestMove(gameState);
        await this.stageMove(watched, turnNumber, snakeId, direction, data, endTimeMs);
      } catch (err) {
        console.error(
          `[tt-firebase] Failed to stage move for ${snakeId} on turn ${turnNumber}:`,
          err
        );
      }
    }
  }

  /**
   * Writes the staged move. Safe to call repeatedly for the same turn — the
   * server picks the last write before the turn deadline.
   */
  private async stageMove(
    watched: WatchedGame,
    turnNumber: number,
    snakeId: string,
    direction: Direction,
    data: TTGameStateDoc,
    endTimeMs: number
  ): Promise<void> {
    if (!this.db) return;

    const headIndex = data.turns[turnNumber].playerPieces[snakeId]?.[0];
    if (headIndex === undefined) return;

    const moveIndex = directionToMoveIndex(
      direction,
      headIndex,
      data.setup.boardWidth,
      data.setup.boardHeight
    );

    await addDoc(
      collection(this.db, `sessions/${watched.sessionID}/games/${watched.gameID}/privateMoves`),
      {
        gameID: watched.gameID,
        moveNumber: turnNumber,
        playerID: snakeId,
        move: moveIndex,
        timestamp: serverTimestamp(),
      }
    );
    console.log(
      `[tt-firebase] Staged ${direction} (index ${moveIndex}) for ${snakeId} turn ${turnNumber}`
    );

    if (this.config.commitMode === 'never') return;

    const commitDelay =
      this.config.commitMode === 'immediate'
        ? 0
        : Math.max(0, endTimeMs - Date.now() - this.config.commitBufferMs);
    const timer = setTimeout(() => {
      this.commitMove(watched, turnNumber, snakeId).catch((err) => {
        console.error(`[tt-firebase] Commit failed for ${snakeId} turn ${turnNumber}:`, err);
      });
    }, commitDelay);
    timer.unref?.();
    watched.commitTimers.push(timer);
  }

  /**
   * Marks the snake as done for the turn (moveStatuses.movedPlayerIDs). The
   * rules allow one snake per write, so multi-snake bots commit one by one.
   */
  private async commitMove(
    watched: WatchedGame,
    turnNumber: number,
    snakeId: string
  ): Promise<void> {
    if (!this.db || this.stopped) return;
    // A newer turn means this one already resolved; nothing to commit.
    if (watched.lastProcessedTurn > turnNumber) return;

    await updateDoc(
      doc(this.db, `sessions/${watched.sessionID}/games/${watched.gameID}/moveStatuses/${turnNumber}`),
      { movedPlayerIDs: arrayUnion(snakeId) }
    );
    console.log(`[tt-firebase] Committed ${snakeId} for turn ${turnNumber}`);
  }
}
