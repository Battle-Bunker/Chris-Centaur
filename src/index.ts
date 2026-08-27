import express from 'express';
import compression from 'compression';
import path from 'path';
import { createServer } from 'http';
import { VoronoiStrategy } from './logic/voronoi-strategy';
import { DecisionLogger } from './logic/decision-logger';
import { CommandLogger } from './logic/command-logger';
import { DecisionWorkerPool } from './logic/decision-worker-pool';
import { ActiveGameManager } from './server/active-game-manager';
import { ActivityController } from './server/activity-controller';
import { GameWebSocketServer } from './server/websocket-server';
import logsRouter from './routes/logs';
import configRouter from './routes/config';
import playRouter from './routes/play';
import connectionDebugRouter from './routes/connection-debug';
import activityRouter from './routes/activity';
import { ConnectionLogger } from './utils/connection-logger';
import { ServerEventLogger } from './logic/server-event-logger';
import { GameRegistry } from './logic/game-registry';
import { pool } from './database/db';
import {
  TacticToesFirebaseInterface,
  firebaseInterfaceConfigFromEnv,
} from './firebase/firebase-interface';

const app = express();
const port = parseInt(process.env.PORT || '5000');

// The history viewer's decision-log responses run to many megabytes of highly
// repetitive JSON; gzip shrinks them ~10x, which is most of the transfer time
// when replaying a game.
app.use(compression());

app.use(express.json());

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, '../src/web')));

const voronoiStrategy = new VoronoiStrategy();
const gameManager = ActiveGameManager.getInstance();
const serverEventLogger = ServerEventLogger.getInstance();
const gameRegistry = GameRegistry.getInstance();
// The single owner of instance idleness (awake rule, idle/wake subscribers,
// managed timers, shutdown ordering). The game manager registered itself as
// the game-progress source at construction; human actions are recorded from
// the WS user-intent handler, the dashboard page routes below, and the
// mutating API routes.
const activityController = ActivityController.getInstance();

// A dashboard page load is a VERIFIABLE human action for the awake rule:
// browsers only GET these documents when a human navigates (all data/polling
// endpoints live under /api and are deliberately not instrumented).
const markHumanAction = (
  _req: express.Request,
  _res: express.Response,
  next: express.NextFunction
) => {
  activityController.recordHumanAction();
  next();
};

// The Battlesnake HTTP interface is gone: games are driven exclusively through
// the TacticToes Firebase interface (see src/firebase/firebase-interface.ts).
// The HTTP server that remains serves only the centaur web UI and its APIs.
app.get('/', markHumanAction, (_req, res) => {
  res.redirect('/play');
});

app.use(logsRouter);
app.use(configRouter);
app.use(playRouter);
app.use(connectionDebugRouter);
app.use(activityRouter);

app.get('/config', markHumanAction, (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/config.html'));
});

app.get('/board-test', markHumanAction, (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/board-test.html'));
});

app.get('/history', markHumanAction, (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/history.html'));
});

app.get('/play', markHumanAction, (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/play.html'));
});

// Unified game viewer: works for both live (WebSocket) and finished
// (decision-log replay) games. See src/web/play-game.html.
app.get('/game/:id', markHumanAction, (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/play-game.html'));
});

// Legacy live-game URL now redirects to the unified viewer.
app.get('/play/:gameId', markHumanAction, (req, res) => {
  res.redirect(302, `/game/${encodeURIComponent(req.params.gameId)}`);
});

// Server activity page: audit autoscale behavior (boot/idle/wake/shutdown).
app.get('/activity', markHumanAction, (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/activity.html'));
});

app.get('/connection-debug', markHumanAction, (_req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/connection-debug.html'));
});

const httpServer = createServer(app);

const wsServer = new GameWebSocketServer(httpServer);
gameManager.startStaleGameCleanup(300000, 600000);

// The TacticToes Firebase interface is the SOLE game transport: it signs in
// as the centaur, discovers games via invite docs, feeds turns to the game
// manager, and publishes every staged move to Firestore (the single source of
// truth for staged moves). Without the TACTICTOES_* env vars the process only
// serves the web UI — see README.md for configuration.
const ttFirebaseConfig = firebaseInterfaceConfigFromEnv(process.env);
const ttFirebase = ttFirebaseConfig
  ? new TacticToesFirebaseInterface(voronoiStrategy, ttFirebaseConfig)
  : null;
if (ttFirebase) {
  // Attach the status listener BEFORE start() so a failure during the initial
  // (async) connect is captured and pushed to the UI, not lost.
  ttFirebase.onStatusChange((status) => wsServer.broadcastFirebaseStatus(status));
  ttFirebase.start().catch((err) => {
    console.error('[tt-firebase] Failed to start Firebase interface:', err);
  });

  // Autoscale hygiene: the Firebase transport follows the controller's awake
  // rule. On idle (no verifiable human action for the grace window, and no
  // progressing game within the 10-minute human-attention cap) the Firestore
  // streams are suspended so the process holds no outbound connections; any
  // verifiable human action wakes it and resumes exactly like the old
  // presence-driven resume. DELIBERATE BEHAVIOR CHANGE from the old
  // presence coupling: a progressing game now holds the transport up with
  // ZERO connected clients (bounded by the human-attention cap), and a
  // connected-but-untouched tab no longer holds it up at all.
  activityController.onIdle('firebase-suspend', () => ttFirebase.suspend());
  activityController.onWake('firebase-resume', () =>
    ttFirebase.resume().catch((err) => {
      // Status is already set to 'error' and pushed to the UI; log it too
      // so the failure is visible in the server log with full detail.
      console.error('[tt-firebase] Resume after suspension failed:', err);
    })
  );
} else {
  console.error(
    '[tt-firebase] NOT CONFIGURED — the centaur cannot play. Set TACTICTOES_CENTAUR_ID, ' +
    'TACTICTOES_CENTAUR_API_KEY, TACTICTOES_FIREBASE_PROJECT_ID, TACTICTOES_FIREBASE_API_KEY ' +
    'and TACTICTOES_FUNCTIONS_REGION (see README.md). Serving the web UI only.'
  );
}

// Idle teardown, after the Firebase suspend above: terminate the decision
// worker threads (they are unref'd but still hold memory); the pool respawns
// lazily on the next decision after a wake.
activityController.onIdle('decision-worker-pool', () => {
  DecisionWorkerPool.shutdownSharedIfRunning();
});

// The same for the LOBSTER evaluation pool, which is a second and separate set
// of worker threads (src/lobster/parallel): unref'd, so they never hold the
// loop open, but each one holds its own EngineSubstrate for every board it was
// pushed. It respawns warm on the next decision after a wake.
if (ttFirebase) {
  activityController.onIdle('lobster-evaluation-workers', () => {
    void ttFirebase.releaseEvaluationWorkers();
  });
}

// Firebase connection status surface: the centaur is nonfunctional without its
// Firebase connection, so the web UI shows a red banner (with a Retry button)
// whenever it is down. Status changes are pushed over the WebSocket; these
// endpoints cover initial page load and the retry action.
const NOT_CONFIGURED_STATUS = {
  state: 'not_configured',
  error:
    'TACTICTOES_* environment variables are missing — the centaur cannot connect to Firebase.',
  since: Date.now(),
};
if (!ttFirebase) {
  wsServer.broadcastFirebaseStatus(NOT_CONFIGURED_STATUS);
}

app.get('/api/firebase-status', (_req, res) => {
  res.json(ttFirebase ? ttFirebase.getStatus() : NOT_CONFIGURED_STATUS);
});

// Cooldown: retryConnect() already joins any in-flight attempt, but a public
// unauthenticated endpoint should not let outsiders force back-to-back
// Firebase sign-ins. One attempt per 10s is plenty for a human operator.
let lastRetryAt = 0;
app.post('/api/firebase-retry', async (_req, res) => {
  if (!ttFirebase) {
    res.status(409).json(NOT_CONFIGURED_STATUS);
    return;
  }
  const now = Date.now();
  if (now - lastRetryAt < 10_000) {
    res.status(429).json(ttFirebase.getStatus());
    return;
  }
  lastRetryAt = now;
  // The Retry button is a verifiable human action (mutating API call).
  activityController.recordHumanAction();
  console.log('[tt-firebase] Operator retry-connect requested');
  const status = await ttFirebase.retryConnect();
  if (status.state === 'error') {
    console.error(`[tt-firebase] Retry-connect failed: ${status.error}`);
  } else {
    console.log(`[tt-firebase] Retry-connect result: ${status.state}`);
  }
  res.json(status);
});

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`🐍 Chris-Centaur running on port ${port}!`);
  console.log(`Visit http://localhost:${port} for snake info`);
  console.log(`Visit http://localhost:${port}/config for configuration`);
  console.log(`Visit http://localhost:${port}/play for centaur play`);
  serverEventLogger.recordBoot({ port, pid: process.pid });
  // Idempotent: only creates games rows for logged games that don't have one.
  void gameRegistry.backfillFromDecisionLogs();
});

// ── Graceful shutdown: ordering owned by the ActivityController ─────────────
// Steps run strictly in this registration order, each awaited, a failing step
// logged and skipped (see ActivityController.shutdown). The sequence: write
// the shutdown event (bounded flush) → real WS close (client sockets + wss,
// so httpServer.close() can actually complete) → Firebase stop → game-manager
// timers → logger flushes → pg pool end (AFTER both logger flushes — the
// loggers only flush; the pool is owned here) → worker-pool terminate → HTTP
// close and exit.
activityController.onShutdown('server-event-flush', (signal) =>
  // Bounded by a short internal timeout so an unreachable database can never
  // block process exit.
  serverEventLogger.recordShutdownAndFlush(signal)
);
activityController.onShutdown('ws-close', () => wsServer.shutdown());
if (ttFirebase) {
  activityController.onShutdown('firebase-stop', () => ttFirebase.stop());
}
activityController.onShutdown('game-manager-timers', () => gameManager.shutdown());
activityController.onShutdown('command-logger-flush', () => CommandLogger.getInstance().shutdown());
activityController.onShutdown('decision-logger-flush', () => DecisionLogger.getInstance().shutdown());
activityController.onShutdown('connection-logger-close', () => ConnectionLogger.getInstance().shutdown());
activityController.onShutdown('pg-pool-end', () => pool.end());
activityController.onShutdown('decision-worker-pool', () => DecisionWorkerPool.shutdownSharedIfRunning());
activityController.onShutdown('http-close', () => {
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  // Kick idle keep-alive HTTP connections loose so close() can complete; the
  // WS sockets are already gone (ws-close step above — the old bug was that
  // they never were, leaving process.exit unreachable).
  httpServer.closeIdleConnections();
});

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  await activityController.shutdown(signal);
}

process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });
// Additional catchable signals — best-effort exit-cause instrumentation for
// the /activity audit (autoscale's real kill is uncatchable; these cover
// everything that IS catchable so an unlabeled gap truly means silent kill).
process.on('SIGHUP', () => { void gracefulShutdown('SIGHUP'); });
process.on('SIGQUIT', () => { void gracefulShutdown('SIGQUIT'); });
process.on('SIGUSR2', () => { void gracefulShutdown('SIGUSR2'); });

// Fatal error paths: record the cause (timeout-bounded flush) then exit
// non-zero. Node's default behavior is preserved apart from the logging.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  void serverEventLogger
    .recordShutdownAndFlush('uncaughtException', 2000, { cause: String(err?.message || err) })
    .finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  void serverEventLogger
    .recordShutdownAndFlush('unhandledRejection', 2000, {
      cause: String((reason as Error)?.message || reason),
    })
    .finally(() => process.exit(1));
});
// beforeExit fires when the event loop drains without an explicit exit — an
// unexpected quiet death worth labeling. (recordShutdownAndFlush is a no-op
// if an exit cause was already recorded.)
process.on('beforeExit', (code) => {
  void serverEventLogger.recordShutdownAndFlush('beforeExit', 2000, { code });
});
