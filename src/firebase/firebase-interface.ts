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
  collection,
  connectFirestoreEmulator,
  doc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from 'firebase/functions';
import { Direction } from '../types/battlesnake';
import { VoronoiStrategy } from '../logic/voronoi-strategy-new';
import { TeamDetector } from '../logic/team-detector';
import { DecisionLogger } from '../logic/decision-logger';
import { GameRegistry } from '../logic/game-registry';
import { ServerEventLogger } from '../logic/server-event-logger';
import { GameLogger } from '../utils/logger';
import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { TTGameInvite, TTGameStateDoc, TTTurn } from './tactictoes-types';
import {
  buildGameState,
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

  return {
    projectId,
    apiKey,
    region: env.TACTICTOES_FUNCTIONS_REGION || 'us-central1',
    botId,
    botApiKey,
  };
}

interface WatchedGame {
  sessionID: string;
  gameID: string;
  unsubscribe: Unsubscribe;
  lastProcessedTurn: number;
  registered: boolean;
  latestDoc: TTGameStateDoc | null;
}

export class TacticToesFirebaseInterface {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Firestore | null = null;
  private invitesUnsubscribe: Unsubscribe | null = null;
  private watchedGames = new Map<string, WatchedGame>();
  private stopped = false;

  private readonly gameManager = ActiveGameManager.getInstance();
  private readonly teamDetector = new TeamDetector();
  private readonly gameLogger = new GameLogger();

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

    // Wire the write-through publisher: every staging action in the manager
    // lands in Firestore as a privateMoves write.
    this.gameManager.setMoveSubmitter(
      (gameId, snakeId, turn, move, source) =>
        this.publishStagedMove(gameId, snakeId, turn, move, source)
    );

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
    this.gameManager.setMoveSubmitter(null);
    this.invitesUnsubscribe?.();
    for (const game of this.watchedGames.values()) {
      game.unsubscribe();
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
      registered: false,
      latestDoc: null,
      unsubscribe: onSnapshot(gameRef, (snapshot) => {
        const data = snapshot.data() as TTGameStateDoc | undefined;
        if (!data || !Array.isArray(data.turns) || data.turns.length === 0) return;
        watched.latestDoc = data;
        this.onGameUpdate(watched, data).catch((err) => {
          console.error(`[tt-firebase] Error handling update for game ${gameID}:`, err);
        });
      }),
    };
    this.watchedGames.set(gameID, watched);
  }

  private unwatchGame(watched: WatchedGame): void {
    watched.unsubscribe();
    this.watchedGames.delete(watched.gameID);
    this.strategy.onGameEnd(watched.gameID);
    console.log(`[tt-firebase] Stopped watching game ${watched.gameID}`);
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
      return;
    }

    this.gameManager.recordTurnArrival(
      watched.gameID,
      Date.now(),
      data.setup.maxTurnTime * 1000,
      endTimeMs
    );

    // One decision per controlled alive snake. setBotRecommendation stages the
    // resolved intent (manual > queue > waypoint > bot), and the manager's
    // write-through publishes the staged move to Firestore.
    for (const snakeId of aliveOurs) {
      const view = buildGameState(watched.gameID, data.setup, turn, turnNumber, snakeId, endTimeMs);
      this.gameManager.updateGameState(watched.gameID, snakeId, view);

      try {
        const teams = this.teamDetector.detectTeams(view.board.snakes);
        const ourTeam = teams.find((team) => team.snakes.some((s) => s.id === snakeId));
        const waypoint = this.gameManager.getWaypoint(watched.gameID, snakeId);
        const result = await this.strategy.getBestMoveWithDebug(view, ourTeam, waypoint);

        const turnData: TurnData = {
          gameState: view,
          moveEvaluations: result.moveEvaluations,
          territoryCells: result.territoryCells,
          safeMoves: result.safeMoves,
          botRecommendation: result.move,
          timestamp: Date.now(),
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
    }
  }

  // The applied move for each snake on the prev → curr transition: the head
  // delta when the snake survived, else the recorded submitted move index.
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
      const newHead = currTurn.playerPieces[snakeId]?.[0];
      let dir = newHead !== undefined ? moveIndexToDirection(prevHead, newHead, width) : null;
      if (!dir) {
        const recorded = currTurn.moves?.[snakeId];
        if (recorded !== undefined) dir = moveIndexToDirection(prevHead, recorded, width);
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
    if (!this.db) throw new Error('Firebase interface not started');
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
}
