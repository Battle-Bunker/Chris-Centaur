import express from 'express';
import compression from 'compression';
import path from 'path';
import { createServer } from 'http';
import { VoronoiStrategy } from './logic/voronoi-strategy-new';
import { DecisionLogger } from './logic/decision-logger';
import { ActiveGameManager } from './server/active-game-manager';
import { GameWebSocketServer } from './server/websocket-server';
import logsRouter from './routes/logs';
import configRouter from './routes/config';
import playRouter from './routes/play';
import connectionDebugRouter from './routes/connection-debug';
import activityRouter from './routes/activity';
import { ConnectionLogger } from './utils/connection-logger';
import { ServerEventLogger } from './logic/server-event-logger';
import { GameRegistry } from './logic/game-registry';
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

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use(express.static(path.join(__dirname, '../src/web')));

const voronoiStrategy = new VoronoiStrategy();
const gameManager = ActiveGameManager.getInstance();
const serverEventLogger = ServerEventLogger.getInstance();
const gameRegistry = GameRegistry.getInstance();

// The Battlesnake HTTP interface is gone: games are driven exclusively through
// the TacticToes Firebase interface (see src/firebase/firebase-interface.ts).
// The HTTP server that remains serves only the centaur web UI and its APIs.
app.get('/', (_req, res) => {
  res.redirect('/play');
});

app.use(logsRouter);
app.use(configRouter);
app.use(playRouter);
app.use(connectionDebugRouter);
app.use(activityRouter);

app.get('/config', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/config.html'));
});

app.get('/board-test', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/board-test.html'));
});

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/history.html'));
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/play.html'));
});

// Unified game viewer: works for both live (WebSocket) and finished
// (decision-log replay) games. See src/web/play-game.html.
app.get('/game/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/play-game.html'));
});

// Legacy live-game URL now redirects to the unified viewer.
app.get('/play/:gameId', (req, res) => {
  res.redirect(302, `/game/${encodeURIComponent(req.params.gameId)}`);
});

// Server activity page: audit autoscale behavior (boot/idle/wake/shutdown).
app.get('/activity', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/activity.html'));
});

app.get('/connection-debug', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/connection-debug.html'));
});

const httpServer = createServer(app);

const wsServer = new GameWebSocketServer(httpServer);
gameManager.startStaleGameCleanup(300000, 600000);
gameManager.startServerPing();

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

  // Autoscale hygiene: mirror the web-client idle lifecycle onto the Firebase
  // transport. When the last web client disconnects (idle sweep, tab close),
  // suspend the Firestore streams after a short grace period so the process
  // holds no outbound connections and autoscale can drain to zero. The grace
  // period absorbs transient zero-client windows during page navigations.
  // Any client (re)connecting cancels the pending suspend / resumes at once.
  const FIREBASE_SUSPEND_GRACE_MS = 60_000;
  let suspendTimer: NodeJS.Timeout | null = null;
  wsServer.onPresenceChange((count) => {
    if (count === 0) {
      if (!suspendTimer) {
        suspendTimer = setTimeout(() => {
          suspendTimer = null;
          void ttFirebase.suspend();
        }, FIREBASE_SUSPEND_GRACE_MS);
        suspendTimer.unref?.();
      }
    } else {
      if (suspendTimer) {
        clearTimeout(suspendTimer);
        suspendTimer = null;
      }
      void ttFirebase.resume().catch((err) => {
        // Status is already set to 'error' and pushed to the UI; log it too
        // so the failure is visible in the server log with full detail.
        console.error('[tt-firebase] Resume after suspension failed:', err);
      });
    }
  });
} else {
  console.error(
    '[tt-firebase] NOT CONFIGURED — the centaur cannot play. Set TACTICTOES_CENTAUR_ID, ' +
    'TACTICTOES_CENTAUR_API_KEY, TACTICTOES_FIREBASE_PROJECT_ID, TACTICTOES_FIREBASE_API_KEY ' +
    'and TACTICTOES_FUNCTIONS_REGION (e.g. us-central1, australia-southeast1) ' +
    '(see README.md). Serving the web UI only.'
  );
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

let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  // Write the shutdown event first, bounded by a short timeout so an
  // unreachable database can never block process exit.
  await serverEventLogger.recordShutdownAndFlush(signal);
  if (ttFirebase) await ttFirebase.stop().catch(() => undefined);
  gameManager.shutdown();
  wsServer.shutdown();
  const decisionLogger = DecisionLogger.getInstance();
  await decisionLogger.shutdown();
  await ConnectionLogger.getInstance().shutdown();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
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
