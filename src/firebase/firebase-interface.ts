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

// Read-back + finalization state for ONE turn of a watched game. Torn down
// and rebuilt whenever the turn advances.
interface TurnWatch {
  turn: number;
  endTimeMs: number;
  // Per owned alive snake: listener on its privateMoves for this turn.
  moveUnsubs: Unsubscribe[];
  // Listener on moveStatuses/{turn} to catch all-players-committed.
  statusUnsub: Unsubscribe | null;
  // Fires shortly after the turn deadline to finalize by timeout.
  finalizeTimer: NodeJS.Timeout | null;
  // Latest server-acked staged move per owned snake (ts <= endTime).
  confirmed: Map<string, { ts: number; direction: Direction }>;
  finalized: boolean;
}

interface WatchedGame {
  sessionID: string;
  gameID: string;
  unsubscribe: Unsubscribe;
  lastProcessedTurn: number;
  registered: boolean;
  latestDoc: TTGameStateDoc | null;
  turnWatch: TurnWatch | null;
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

    const gameRef = doc(this.db, `sessions/${sessionID}/games/${gameID}`);
    const watched: WatchedGame = {
      sessionID,
      gameID,
      lastProcessedTurn: -1,
      registered: false,
      latestDoc: null,
      turnWatch: null,
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
    if (tw.finalizeTimer) clearTimeout(tw.finalizeTimer);
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

  // Sets up the per-turn read-back listeners and finalization triggers:
  //  - one privateMoves listener per owned alive snake (playerID +
  //    moveNumber equality query — the rules require the playerID filter),
  //    reporting the latest server-acked write as the CONFIRMED staged move;
  //  - a moveStatuses listener that finalizes when every alive player has
  //    committed (early turn resolution);
  //  - a deadline timer that finalizes shortly after endTime.
  // Finalization reports each snake's confirmed staged move (ts <= endTime)
  // as the turn's final selection — known before the next board arrives.
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
      finalizeTimer: null,
      confirmed: new Map(),
      finalized: false,
    };
    watched.turnWatch = tw;

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
          if (!best) return;
          const chosen: { ts: number; direction: Direction } = best;
          tw.confirmed.set(snakeId, chosen);
          this.gameManager.setConfirmedStagedMove(
            watched.gameID,
            snakeId,
            turnNumber,
            chosen.direction
          );
        }, (err) => {
          console.error(`[tt-firebase] privateMoves read-back failed for ${snakeId} turn ${turnNumber}:`, err);
        })
      );
    }

    // Early resolution: once every alive player has committed, the server
    // processes the turn immediately — the staged moves at this instant are
    // final.
    tw.statusUnsub = onSnapshot(
      doc(
        this.db,
        `sessions/${watched.sessionID}/games/${watched.gameID}/moveStatuses/${turnNumber}`
      ),
      (snapshot) => {
        const status = snapshot.data() as { alivePlayerIDs?: string[]; movedPlayerIDs?: string[] } | undefined;
        if (!status?.alivePlayerIDs || !status.movedPlayerIDs) return;
        const moved = new Set(status.movedPlayerIDs);
        if (status.alivePlayerIDs.every((id) => moved.has(id))) {
          this.finalizeTurn(watched, tw, aliveOurs, 'all-committed');
        }
      },
      (err) => {
        console.error(`[tt-firebase] moveStatuses listener failed for turn ${turnNumber}:`, err);
      }
    );

    // Deadline: after endTime (+ a small buffer for write stragglers) no new
    // staged move can count, so the confirmed state is the final selection.
    const FINALIZE_BUFFER_MS = 300;
    const delay = Math.max(0, endTimeMs - Date.now() + FINALIZE_BUFFER_MS);
    tw.finalizeTimer = setTimeout(() => {
      this.finalizeTurn(watched, tw, aliveOurs, 'deadline');
    }, delay);
    tw.finalizeTimer.unref?.();
  }

  private finalizeTurn(
    watched: WatchedGame,
    tw: TurnWatch,
    aliveOurs: string[],
    reason: string
  ): void {
    if (tw.finalized || watched.turnWatch !== tw) return;
    tw.finalized = true;
    console.log(`[tt-firebase] Turn ${tw.turn} of ${watched.gameID} finalized (${reason})`);
    for (const snakeId of aliveOurs) {
      const confirmed = tw.confirmed.get(snakeId);
      this.gameManager.finalizeTurnMove(
        watched.gameID,
        snakeId,
        tw.turn,
        confirmed?.direction ?? null
      );
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

  /**
   * The MoveCommitter implementation for the human-triggered Submit All: adds
   * the snake to moveStatuses.movedPlayerIDs so the game server can resolve
   * the turn early once every alive player has committed. Firestore rules
   * accept one owned snake per write, so multi-snake commits arrive as one
   * write each. The staged move is untouched — whatever privateMoves holds at
   * resolution time is what plays.
   */
  private async publishCommit(gameId: string, snakeId: string, turn: number): Promise<void> {
    if (!this.db) throw new Error('Firebase interface not started');
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
