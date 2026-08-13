import { Server as HTTPServer, IncomingMessage } from 'http';
import { createHash } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { ActiveGameManager } from './active-game-manager';
import { Direction } from '../types/battlesnake';
import { ConnectionLogger } from '../utils/connection-logger';
import { ConfigStore } from './configStore';
import { DEFAULT_CONFIG } from '../config/game-config';
import { ServerEventLogger } from '../logic/server-event-logger';
import { PendingGameRegistry } from '../logic/pending-game-registry';
import { ActivityController, ManagedTimerHandle, transientTimeout } from './activity-controller';
import {
  IDLE_CLOSE_CODE,
  IDLE_CLOSE_REASON,
  SERVER_IDLE_SWEEP_INTERVAL_MS,
  SOCKET_KEEPALIVE_INTERVAL_MS,
} from '../shared/idle-policy';

interface WSClient {
  ws: WebSocket;
  gameId: string;
  userId: string;
  isLobby: boolean;
  connId: string;
  ip: string;
  userAgent: string;
  connectedAt: number;
  lastActivityAt: number;
  // Socket-aliveness flag for the SOCKET-KEEPALIVE ping/pong loop (nothing to
  // do with the DB liveness heartbeat or the human activity heartbeat). Set
  // true on every pong (and on any inbound frame); the socket-keepalive sweep
  // sets it false right before pinging, so a socket that misses a full
  // interval's pong is treated as dead and terminated. NOTE: this is
  // connection aliveness, NOT user activity — it must never bump
  // lastActivityAt or the 30-minute idle sweep would never fire.
  isAlive: boolean;
}

/** Inbound message types that represent real user intent. Pings (which the
 *  client sends every 5s for latency measurement) deliberately do NOT count
 *  — otherwise the idle sweep would never fire. The dedicated `activity`
 *  heartbeat from IdleWatcher is what keeps an active human "alive". */
const USER_INTENT_TYPES = new Set([
  'select-snake',
  'deselect',
  'suicide-all',
  'select-move',
  'confirm-fatal-move',
  'set-waypoint',
  'activity',
]);

interface WSMessage {
  type: string;
  [key: string]: any;
}

export class GameWebSocketServer {
  private wss: WebSocketServer;
  private clients: Set<WSClient> = new Set();
  private gameManager: ActiveGameManager;
  private connLogger: ConnectionLogger;
  // Managed by the ActivityController with scope 'always', NOT 'while-active':
  // under the amended awake rule the instance can be IDLE while untouched tabs
  // are still connected, and these two loops are precisely what digests such
  // tabs — the socket keepalive stops the proxy dropping them into a reconnect
  // churn, and the idle sweep is the only mechanism that eventually closes
  // them (4001). Both are already free at zero clients (no traffic, sweep
  // skips its DB read), so running through idle costs nothing.
  private idleSweepInterval: ManagedTimerHandle | null = null;
  private socketKeepaliveInterval: ManagedTimerHandle | null = null;
  // Last REAL user activity per userId, persisted across reconnects. Without
  // this, every proxy-drop → auto-reconnect cycle produced a brand-new client
  // whose lastActivityAt reset to "now" (and `subscribe-game` counted as
  // intent), so no connection ever looked idle to the sweep and an abandoned
  // tab kept the autoscale deployment alive indefinitely.
  private userActivity: Map<string, number> = new Map();
  private configStore: ConfigStore = new ConfigStore();
  // Current idle timeout in ms. Refreshed from the config store at the start
  // of every sweep tick, so changing `idleTimeoutMinutes` on the /config page
  // takes effect within one sweep interval (~1 minute) without a redeploy.
  private idleTimeoutMs: number = DEFAULT_CONFIG.idleTimeoutMinutes * 60 * 1000;
  // Last known Firebase connection status; replayed to every new connection
  // and re-broadcast on change (drives the red error banner in the web UI).
  private latestFirebaseStatus: unknown = null;

  broadcastFirebaseStatus(status: unknown): void {
    this.latestFirebaseStatus = status;
    for (const client of this.clients) {
      this.send(client.ws, { type: 'firebase-status', status });
    }
  }

  constructor(server: HTTPServer) {
    this.gameManager = ActiveGameManager.getInstance();
    this.connLogger = ConnectionLogger.getInstance();

    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.startIdleSweep();
    this.startSocketKeepalive();

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const ip =
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        'unknown';
      const userAgent = (req.headers['user-agent'] as string) || 'unknown';
      const connId = this.connLogger.newConnId();

      const now = Date.now();
      const client: WSClient = {
        ws,
        gameId: '',
        userId: '',
        isLobby: false,
        connId,
        ip,
        userAgent,
        connectedAt: now,
        lastActivityAt: now,
        isAlive: true,
      };
      this.clients.add(client);
      this.logActiveConnections('connect', connId);

      this.connLogger.log({
        ts: Date.now(),
        side: 'server',
        type: 'server-connect',
        connId,
        ip,
        userAgent,
      });

      // Hand the server-assigned conn id to the client so it can be echoed back
      // on debug POSTs. Lets us correlate server/client timelines deterministically.
      this.send(ws, { type: 'debug-hello', connId });

      // Push the current Firebase connection status so a page that loaded
      // while the bot was down shows the banner immediately (no polling).
      if (this.latestFirebaseStatus) {
        this.send(ws, { type: 'firebase-status', status: this.latestFirebaseStatus });
      }

      ws.on('message', (data: Buffer) => {
        try {
          // Any inbound frame proves the socket is alive for the keepalive loop.
          // This is liveness only — it must NOT touch lastActivityAt unless the
          // message is genuine user intent (handled below).
          client.isAlive = true;
          const msg: WSMessage = JSON.parse(data.toString());
          if (msg && typeof msg.type === 'string' && USER_INTENT_TYPES.has(msg.type)) {
            client.lastActivityAt = Date.now();
            if (client.userId) {
              this.userActivity.set(client.userId, client.lastActivityAt);
            }
            // Every USER_INTENT message is a VERIFIABLE human action for the
            // instance-level awake rule: state-mutating commands, and the
            // 'activity' heartbeat, which the client only sends after real
            // local input (key/click/touch/mouse) since its last beat. Socket
            // keepalives, pings and auto-resubscribes never reach this branch,
            // so a connected-but-untouched tab counts as nothing.
            ActivityController.getInstance().recordHumanAction();
            // Real state-mutating intent — this (not mere connections or
            // presence heartbeats) marks the server "active" on the
            // /activity timeline. The 'activity' heartbeat fires on any
            // gesture (mouse move, tab focus) and only feeds the idle
            // clock above, never the activity timeline.
            if (msg.type !== 'activity') {
              ServerEventLogger.getInstance().recordUserIntent();
            }
          }
          this.handleMessage(client, msg);
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      });

      // Protocol-level pong replies keep the socket marked alive for the
      // keepalive sweep. Like inbound messages, this is liveness only and must
      // never bump lastActivityAt.
      ws.on('pong', () => {
        client.isAlive = true;
      });

      ws.on('close', (code: number, reasonBuf: Buffer) => {
        const reason = reasonBuf?.toString() || '';
        this.connLogger.log({
          ts: Date.now(),
          side: 'server',
          type: 'server-disconnect',
          connId: client.connId,
          gameId: client.gameId || undefined,
          userId: client.userId || undefined,
          ip: client.ip,
          code,
          reason,
          durationMs: Date.now() - client.connectedAt,
        });
        this.handleDisconnect(client);
        if (this.clients.delete(client)) {
          this.logActiveConnections('disconnect', client.connId);
        }
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        this.connLogger.log({
          ts: Date.now(),
          side: 'server',
          type: 'server-error',
          connId: client.connId,
          gameId: client.gameId || undefined,
          userId: client.userId || undefined,
          ip: client.ip,
          message: (err as Error)?.message || String(err),
        });
        this.handleDisconnect(client);
        if (this.clients.delete(client)) {
          this.logActiveConnections('error', client.connId);
        }
      });
    });

    this.gameManager.onBoardUpdate((gameId, gameState) => {
      const game = this.gameManager.getGame(gameId);

      this.broadcastToGame(gameId, {
        type: 'board-update',
        gameId,
        turn: gameState.turn,
        gameState: gameState,
        turnExpiryTime: game?.turnExpiryTime || null,
        selections: this.getSelectionsForGame(gameId),
        owners: this.gameManager.getOwnersForGame(gameId),
        stagedMoves: this.getStagedMovesForGame(gameId),
        waypoints: this.gameManager.getWaypointsForGame(gameId),
        routes: this.gameManager.getRoutesForGame(gameId),
        activeIntentModes: this.gameManager.getActiveIntentModesForGame(gameId),
      });

      this.broadcastLobbyUpdate();
    });

    this.gameManager.onTurnUpdate((gameId, snakeId, turnData) => {
      const game = this.gameManager.getGame(gameId);

      this.broadcastToGame(gameId, {
        type: 'snake-turn-update',
        gameId,
        snakeId,
        turn: turnData.gameState.turn,
        moveEvaluations: turnData.moveEvaluations,
        territoryCells: turnData.territoryCells,
        cellOwnership: turnData.cellOwnership || null,
        safeMoves: turnData.safeMoves,
        botRecommendation: turnData.botRecommendation,
        timeout: turnData.gameState.game.timeout || 500,
        timestamp: turnData.timestamp,
        turnExpiryTime: game?.turnExpiryTime || null,
        // Carry the full staged-move map so each snake's grey (bot) arrow
        // appears/refreshes as soon as its own turn data lands — board-update
        // only fires once per turn, so this per-snake update fills the others'
        // arrows in as their decisions complete.
        stagedMoves: this.getStagedMovesForGame(gameId),
        routes: this.gameManager.getRoutesForGame(gameId),
        activeIntentModes: this.gameManager.getActiveIntentModesForGame(gameId),
      });
    });

    this.gameManager.onMoveCommitted((gameId, snakeId, move, source) => {
      this.broadcastToGame(gameId, {
        type: 'move-committed',
        gameId,
        snakeId,
        move,
        source,
        // Refresh staged moves so the committing snake flips to its double
        // (committed) arrow immediately, not only on the next broadcast.
        stagedMoves: this.getStagedMovesForGame(gameId),
        routes: this.gameManager.getRoutesForGame(gameId),
        activeIntentModes: this.gameManager.getActiveIntentModesForGame(gameId),
      });
    });

    this.gameManager.onGameListChange((event, gameId, snakeId) => {
      console.log(`[WebSocket] Game list changed: ${event} ${gameId}:${snakeId}`);
      this.broadcastLobbyUpdate();
    });

    // Pending (unstarted) lobbies come and go independently of active games.
    PendingGameRegistry.getInstance().onChange(() => {
      this.broadcastLobbyUpdate();
    });

    // Reactive staged-arrow sync: the game manager coalesces every staged-move
    // / intent change into one notification per game per tick, so we just push
    // the current selections snapshot (which carries staged moves, waypoints,
    // waypoints, routes and intent modes) to subscribers.
    this.gameManager.onStagedChange((gameId) => {
      this.broadcastSelectionsUpdate(gameId);
    });

    // Fatal-move consent gate: when the manager blocks an unconsented human
    // certain-death move, prompt ONLY the controlling user to confirm it.
    this.gameManager.onFatalConfirmationNeeded((gameId, snakeId, move, turn) => {
      const game = this.gameManager.getGame(gameId);
      const userId = game?.controlledSnakes.get(snakeId)?.selectedBy;
      if (!userId) return;
      this.sendToUser(gameId, userId, {
        type: 'fatal-move-confirmation-needed',
        gameId,
        snakeId,
        move,
        turn,
      });
    });

    this.gameManager.onGameEnd((gameId, snakeId, finalGameState, gameOver) => {
      const finalSnakes = finalGameState.board?.snakes || [];
      const survived = finalSnakes.some(s => s.id === snakeId);
      const won = survived && finalSnakes.length === 1;
      const clientCount = this.clientsForGame(gameId);
      console.log(
        `[WS] broadcasting snake-ended for ${gameId}:${snakeId} — turn=${finalGameState.turn}, gameOver=${gameOver}, survived=${survived}, subscribers=${clientCount}`,
      );
      this.broadcastToGame(gameId, {
        type: 'snake-ended',
        gameId,
        snakeId,
        turn: finalGameState.turn,
        finalGameState,
        survived,
        won,
        gameOver,
      });
    });
  }

  private handleMessage(client: WSClient, msg: WSMessage): void {
    switch (msg.type) {
      case 'subscribe-game': {
        const gameId = msg.gameId || '';
        const userId = msg.userId || '';
        const playerName = typeof msg.playerName === 'string' ? msg.playerName : '';

        // Enrol FIRST (race-safe uniqueness check inside the manager) so a
        // rejected name never becomes a subscribed operator. Only active games
        // enrol — a finished/unknown game returns null and the client falls
        // back to the read-only replay with no login gate.
        const enrolResult = this.gameManager.addConnectedUser(gameId, userId, playerName);
        if (enrolResult && 'error' in enrolResult) {
          this.send(client.ws, {
            type: 'enrol-error',
            gameId,
            error: enrolResult.error,
            enrolledNames: this.gameManager.getEnrolledNames(gameId, userId),
          });
          break;
        }
        const user = enrolResult?.user ?? null;

        client.gameId = gameId;
        client.userId = userId;
        client.isLobby = false;

        // Subscribing is NOT user intent (the auto-reconnect loop re-subscribes
        // on every proxy drop). Restore this user's real idle clock so the
        // sweep sees continuity across reconnects; first-time users start now.
        const known = userId ? this.userActivity.get(userId) : undefined;
        if (known !== undefined) {
          client.lastActivityAt = known;
        } else if (userId) {
          this.userActivity.set(userId, client.lastActivityAt);
        }

        this.connLogger.log({
          ts: Date.now(),
          side: 'server',
          type: 'server-subscribe',
          connId: client.connId,
          gameId,
          userId,
          ip: client.ip,
          details: { kind: 'game' },
        });

        const gameState = this.gameManager.getGameState(gameId);

        this.send(client.ws, {
          type: 'game-subscribed',
          gameId,
          userId,
          userColor: user?.color || '#888888',
          playerName: user?.name || null,
          ...(gameState || {}),
        });

        this.broadcastSelectionsUpdate(gameId);
        break;
      }

      case 'select-snake': {
        if (!client.gameId || !client.userId) break;
        const snakeId = msg.snakeId;
        const force = !!msg.force;

        const result = this.gameManager.selectSnake(client.gameId, snakeId, client.userId, force);

        if (result.success) {
          this.broadcastSelectionsUpdate(client.gameId);

          if (result.revokedUserId) {
            this.sendToUser(client.gameId, result.revokedUserId, {
              type: 'selection-revoked',
              snakeId,
            });
          }

          const game = this.gameManager.getGame(client.gameId);
          const controlled = game?.controlledSnakes.get(snakeId);
          if (controlled) {
            this.send(client.ws, {
              type: 'snake-selected',
              snakeId,
              turnData: controlled.latestTurnData,
              botRecommendation: controlled.botRecommendation,
              stagedMove: controlled.intent.kind === 'manual' ? controlled.intent.move : null,
            });
          }
        } else if (result.contestedBy) {
          this.send(client.ws, {
            type: 'selection-contested',
            snakeId,
            contestedBy: result.contestedBy,
          });
        }
        break;
      }

      case 'deselect': {
        if (!client.gameId || !client.userId) break;
        this.gameManager.deselectSnake(client.gameId, client.userId);
        this.broadcastSelectionsUpdate(client.gameId);
        break;
      }

      case 'commit-all-staged': {
        // Submit All — the human-triggered "done this turn" signal. Publishes
        // a moveStatuses commit to Firebase for every snake staged for the
        // current turn, so the game server can resolve the turn early once
        // every player has committed. Staged moves are untouched.
        if (!client.gameId || !client.userId) break;
        this.gameManager.commitAllStaged(client.gameId, client.userId);
        this.broadcastSelectionsUpdate(client.gameId);
        break;
      }

      case 'suicide-all': {
        if (!client.gameId || !client.userId) break;
        // The shared secret is stored as a SHA-512 hash so the plaintext
        // password never lives in the repo. The client sends the raw input;
        // we hash it server-side and compare.
        const expectedHash = 'b109f3bbbc244eb82441917ed06d618b9008dd09b3befd1b5e07394c706a8bb980b1d7785e5976ec049b46df5f1326af5a2ea6d103fd07c95385ffab0cacbc86';
        const input = typeof msg.password === 'string' ? msg.password : '';
        const actualHash = createHash('sha512').update(input).digest('hex');
        if (actualHash !== expectedHash) {
          this.send(client.ws, { type: 'suicide-result', success: false, error: 'Invalid password' });
          break;
        }
        const result = this.gameManager.suicideAllSnakes(client.gameId, client.userId);
        this.send(client.ws, { type: 'suicide-result', success: true, affected: result.affected });
        this.broadcastSelectionsUpdate(client.gameId);
        break;
      }

      case 'select-move': {
        // Space (or the Stage button) on the client stages the inspected cell
        // as the snake's manual next move. Staging write-through publishes the
        // move to Firebase, where the game server resolves the turn from the
        // last staged move at the deadline. Manual staging
        // drops the queue/waypoint per the "manual override drops the plan"
        // contract (handled inside setUserSelection).
        const validMoves: Direction[] = ['up', 'down', 'left', 'right'];
        const snakeId = msg.snakeId;
        if (client.gameId && client.userId && snakeId && msg.move && validMoves.includes(msg.move)) {
          const game = this.gameManager.getGame(client.gameId);
          const controlled = game?.controlledSnakes.get(snakeId);
          if (controlled && controlled.selectedBy === client.userId) {
            // setUserSelection re-stages the move, which fires the coalesced
            // onStagedChange → broadcastSelectionsUpdate; no explicit broadcast.
            this.gameManager.setUserSelection(client.gameId, snakeId, msg.move as Direction);
          }
        }
        break;
      }

      case 'confirm-fatal-move': {
        // The user accepted the fatal-move confirmation dialog. The manager
        // re-validates fatality server-side and mints the consent brand there;
        // this message is only the claim. Late confirmations (turn already
        // committed) return false and are reported back.
        const validMoves: Direction[] = ['up', 'down', 'left', 'right'];
        const snakeId = msg.snakeId;
        if (client.gameId && client.userId && snakeId && msg.move && validMoves.includes(msg.move)) {
          const staged = this.gameManager.confirmFatalMove(
            client.gameId, snakeId, msg.move as Direction, client.userId
          );
          this.send(client.ws, { type: 'confirm-fatal-move-result', snakeId, move: msg.move, staged });
        }
        break;
      }

      case 'set-waypoint': {
        if (!client.gameId || !client.userId) break;
        const snakeId = msg.snakeId;
        if (!snakeId) break;
        // msg.waypoint may be null (clear) or {type, x, y}. msg.append (set by
        // shift+alt-click) TOGGLES the cell's membership in the goto queue
        // instead of replacing it. On success setWaypoint re-stages the move,
        // firing the coalesced onStagedChange → broadcastSelectionsUpdate; no
        // explicit broadcast.
        this.gameManager.setWaypoint(
          client.gameId, snakeId, msg.waypoint ?? null, client.userId, msg.append === true
        );
        break;
      }

      case 'subscribe-lobby':
        client.isLobby = true;
        client.gameId = '';
        client.userId = '';
        this.connLogger.log({
          ts: Date.now(),
          side: 'server',
          type: 'server-subscribe',
          connId: client.connId,
          ip: client.ip,
          details: { kind: 'lobby' },
        });
        this.sendLobbyState(client.ws);
        break;

      case 'ping': {
        const serverTime = Date.now();
        this.send(client.ws, {
          type: 'pong',
          serverTime,
          clientTime: msg.clientTime || null,
        });
        break;
      }

      case 'activity': {
        // ACTIVITY HEARTBEAT from IdleWatcher: sent only when the user has
        // produced real local input (key/click/touch/mouse) since the last
        // beat, so it is a verifiable human signal. lastActivityAt (and the
        // controller's human-action clock) were already bumped above by the
        // USER_INTENT_TYPES check; nothing more to do here. Don't reply — a
        // silent ack keeps this off the wire when the tab is idle.
        break;
      }

      case 'keepalive': {
        // SOCKET KEEPALIVE from the client (unconditional, input-independent).
        // Deliberately NOT in USER_INTENT_TYPES, so it keeps the socket warm
        // (and proxy idle timer reset) without resetting the 30-minute
        // user-idle window or the instance awake clock. The inbound frame
        // already marked isAlive above; nothing else to do.
        break;
      }
    }
  }

  /**
   * SOCKET KEEPALIVE — one of the three deliberately distinct "heartbeat-like"
   * mechanisms in this codebase (never conflate their names):
   *   1. liveness heartbeat  — ServerEventLogger's server_liveness DB upsert
   *      (death-watch; no websocket involved; runs in every state).
   *   2. socket keepalive    — THIS: the 25s WS protocol ping + app-level
   *      `keepalive` frame that stops proxies dropping connected sockets.
   *      Exists only while clients are connected; says NOTHING about humans.
   *   3. activity heartbeat  — the client's input-gated `activity` message
   *      proving a real human recently interacted (IdleWatcher).
   *
   * Every interval, terminate any socket that didn't answer the previous ping
   * (genuinely dead/zombie), then ping the rest. We also send a lightweight
   * application-level `keepalive` frame (wire type unchanged for client
   * compat) on the same cadence: the platform proxy is known to forward
   * application data frames (board updates flow through it), but may not
   * forward low-level ping frames, so the app-level frame guarantees
   * server→client traffic keeps the idle-but-open socket from being dropped
   * (~5-minute proxy window).
   */
  private startSocketKeepalive(): void {
    if (this.socketKeepaliveInterval) return;
    const keepaliveData = JSON.stringify({ type: 'keepalive', ts: 0 });
    this.socketKeepaliveInterval = ActivityController.getInstance().managedInterval('ws-socket-keepalive', () => {
      for (const client of this.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        if (!client.isAlive) {
          // Missed a full interval without any inbound frame or pong — treat as
          // a dead socket and terminate so the client reconnects fresh.
          console.log(
            `[WebSocket] Keepalive: terminating dead conn=${client.connId} ` +
              `user=${client.userId || '-'} game=${client.gameId || '-'}`,
          );
          this.connLogger.log({
            ts: Date.now(),
            side: 'server',
            type: 'server-keepalive-terminate',
            connId: client.connId,
            gameId: client.gameId || undefined,
            userId: client.userId || undefined,
            ip: client.ip,
            durationMs: Date.now() - client.connectedAt,
          });
          try { client.ws.terminate(); } catch { /* already tearing down */ }
          continue;
        }
        // Expect a pong (or any inbound frame) before the next sweep.
        client.isAlive = false;
        try { client.ws.ping(); } catch { /* best-effort */ }
        // App-level keepalive as the proxy-forwarding fallback.
        try { client.ws.send(keepaliveData); } catch { /* best-effort */ }
      }
    }, SOCKET_KEEPALIVE_INTERVAL_MS, { scope: 'always' });
  }

  /**
   * Real server close for graceful shutdown: stop the background timers,
   * close every client socket with 1001 (going away), then close the
   * WebSocketServer itself — all BEFORE httpServer.close(). Previously only
   * the timers were cleared and the client sockets stayed open, so with any
   * client attached the HTTP server's close callback never fired and
   * process.exit(0) was unreachable. Sockets that don't complete the close
   * handshake within a short bound are terminated so shutdown can never hang
   * on a dead client.
   */
  async shutdown(): Promise<void> {
    if (this.idleSweepInterval) {
      this.idleSweepInterval.clear();
      this.idleSweepInterval = null;
    }
    if (this.socketKeepaliveInterval) {
      this.socketKeepaliveInterval.clear();
      this.socketKeepaliveInterval = null;
    }

    const sockets = [...this.clients].map((client) => client.ws);
    await new Promise<void>((resolve) => {
      let settled = false;
      let remaining = sockets.length;
      let terminateBound: NodeJS.Timeout | null = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (terminateBound) clearTimeout(terminateBound);
        // Stops the server accepting new connections. In server-attached mode
        // this does NOT close client sockets — that's what the loop above is
        // for — so it completes promptly once the clients are gone.
        this.wss.close(() => resolve());
      };
      if (remaining === 0) {
        finish();
        return;
      }
      const oneClosed = () => {
        remaining--;
        if (remaining === 0) finish();
      };
      // Backstop: a client that never answers the close handshake would hold
      // its TCP socket (and therefore httpServer.close()) open indefinitely.
      terminateBound = transientTimeout(() => {
        for (const ws of sockets) {
          try { ws.terminate(); } catch { /* already down */ }
        }
      }, SHUTDOWN_CLOSE_BOUND_MS);
      for (const ws of sockets) {
        if (ws.readyState === WebSocket.CLOSED) {
          oneClosed();
          continue;
        }
        ws.once('close', oneClosed);
        try {
          ws.close(SHUTDOWN_CLOSE_CODE, SHUTDOWN_CLOSE_REASON);
        } catch {
          try { ws.terminate(); } catch { /* already down */ }
        }
      }
    });
  }

  private startIdleSweep(): void {
    if (this.idleSweepInterval) return;
    this.idleSweepInterval = ActivityController.getInstance().managedInterval('ws-idle-sweep', async () => {
      // With zero clients there is nothing to sweep — skip entirely (including
      // the config read) so an idle server generates no background database
      // traffic that could keep the autoscale instance from draining to zero.
      if (this.clients.size === 0) {
        if (this.userActivity.size > 0) {
          const pruneCutoff = Date.now() - this.idleTimeoutMs * 2;
          for (const [userId, ts] of this.userActivity) {
            if (ts < pruneCutoff) this.userActivity.delete(userId);
          }
        }
        return;
      }
      // Refresh the timeout from config (best-effort; keep last value on error).
      try {
        const minutes = await this.configStore.get('idleTimeoutMinutes');
        if (typeof minutes === 'number' && minutes > 0) {
          this.idleTimeoutMs = minutes * 60 * 1000;
        } else if (minutes === undefined) {
          this.idleTimeoutMs = DEFAULT_CONFIG.idleTimeoutMinutes * 60 * 1000;
        }
      } catch { /* keep current value */ }

      const cutoff = Date.now() - this.idleTimeoutMs;
      for (const client of this.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        if (client.lastActivityAt < cutoff) {
          const idleFor = Date.now() - client.lastActivityAt;
          console.log(
            `[WebSocket] Idle sweep: closing conn=${client.connId} ` +
              `user=${client.userId || '-'} game=${client.gameId || '-'} ` +
              `idleFor=${Math.round(idleFor / 1000)}s`,
          );
          this.connLogger.log({
            ts: Date.now(),
            side: 'server',
            type: 'server-idle-close',
            connId: client.connId,
            gameId: client.gameId || undefined,
            userId: client.userId || undefined,
            ip: client.ip,
            code: IDLE_CLOSE_CODE,
            reason: IDLE_CLOSE_REASON,
            durationMs: Date.now() - client.connectedAt,
            details: { idleForMs: idleFor },
          });
          try {
            client.ws.close(IDLE_CLOSE_CODE, IDLE_CLOSE_REASON);
          } catch {
            // best-effort: socket may already be tearing down
          }
        }
      }
      // Prune stale per-user activity records so the map can't grow without
      // bound. Anything older than 2× the idle window is long past useful —
      // any connection restoring it would be swept immediately anyway.
      const pruneCutoff = Date.now() - this.idleTimeoutMs * 2;
      for (const [userId, ts] of this.userActivity) {
        if (ts < pruneCutoff) this.userActivity.delete(userId);
      }
    }, SERVER_IDLE_SWEEP_INTERVAL_MS, { scope: 'always' });
  }

  /** Emit a single line whenever the active-connection count changes. Called
   *  from the add/delete sites so every transition shows up exactly once. */
  private logActiveConnections(reason: string, connId: string): void {
    console.log(
      `[WebSocket] Active connections: ${this.clients.size} ` +
        `(${reason} conn=${connId})`,
    );
    // Feed every connection-count change into the activity tracker so 0↔1
    // transitions emit went-idle / woke server events (includes idle-sweep
    // closes — they arrive here via the socket's close handler). NOTE: a
    // connection is deliberately NOT a human action for the awake rule — a
    // connected-but-untouched (auto-reconnecting) tab counts as nothing.
    ServerEventLogger.getInstance().setConnectionCount(this.clients.size);
  }

  private handleDisconnect(client: WSClient): void {
    if (client.gameId && client.userId) {
      this.gameManager.removeConnectedUser(client.gameId, client.userId);
      this.broadcastSelectionsUpdate(client.gameId);
    }
  }

  private getSelectionsForGame(gameId: string): { [snakeId: string]: { userId: string; color: string } | null } {
    const game = this.gameManager.getGame(gameId);
    if (!game) return {};

    const selections: { [snakeId: string]: { userId: string; color: string } | null } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      if (cs.selectedBy) {
        const user = game.connectedUsers.get(cs.selectedBy);
        selections[snakeId] = {
          userId: cs.selectedBy,
          color: user?.color || '#888888',
        };
      } else {
        selections[snakeId] = null;
      }
    }
    return selections;
  }

  // Staged moves drive the arrow render on every client. The projection lives
  // in the manager (getStagedMovesForGame) because the per-turn command-state
  // snapshot persists the identical shape — live play and the history replay
  // must render from the same data.
  private getStagedMovesForGame(gameId: string): { [snakeId: string]: { move: string | null; requestedMove: string; committed: boolean; color: string; source: string; fatal: boolean } } {
    return this.gameManager.getStagedMovesForGame(gameId);
  }

  private broadcastSelectionsUpdate(gameId: string): void {
    const game = this.gameManager.getGame(gameId);
    if (!game) return;

    const selections = this.getSelectionsForGame(gameId);
    const connectedUsers = Array.from(game.connectedUsers.values());
    const owners = this.gameManager.getOwnersForGame(gameId);
    const stagedMoves = this.getStagedMovesForGame(gameId);
    const waypoints = this.gameManager.getWaypointsForGame(gameId);
    const routes = this.gameManager.getRoutesForGame(gameId);
    const activeIntentModes = this.gameManager.getActiveIntentModesForGame(gameId);

    this.broadcastToGame(gameId, {
      type: 'selections-update',
      selections,
      connectedUsers,
      owners,
      stagedMoves,
      waypoints,
      routes,
      activeIntentModes,
    });
  }

  private sendToUser(gameId: string, userId: string, msg: any): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.gameId === gameId && client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        this.sendRaw(client, data, msg.type);
      }
    }
  }

  // The engine server's host, exposed to the lobby page so game cards can
  // link to the game on the engine server. Optional: when unset the cards
  // simply render no link.
  private engineHost(): string | null {
    return process.env.GAME_ENGINE_HOST || null;
  }

  private sendLobbyState(ws: WebSocket): void {
    const games = this.gameManager.getActiveGames();
    this.send(ws, {
      type: 'lobby-update',
      games,
      pendingGames: PendingGameRegistry.getInstance().list(),
      engineHost: this.engineHost(),
    });
  }

  private broadcastLobbyUpdate(): void {
    const games = this.gameManager.getActiveGames();
    const msg = {
      type: 'lobby-update',
      games,
      pendingGames: PendingGameRegistry.getInstance().list(),
      engineHost: this.engineHost(),
    };
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.isLobby && client.ws.readyState === WebSocket.OPEN) {
        this.sendRaw(client, data, msg.type);
      }
    }
  }

  private broadcastToGame(gameId: string, msg: any): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.gameId === gameId && !client.isLobby && client.ws.readyState === WebSocket.OPEN) {
        this.sendRaw(client, data, msg.type);
      }
    }
  }

  /** Count live (OPEN, non-lobby) subscribers currently watching a game. Used
   *  for diagnostics so we can tell whether a snake-ended broadcast actually had
   *  any client to reach. */
  private clientsForGame(gameId: string): number {
    let n = 0;
    for (const client of this.clients) {
      if (client.gameId === gameId && !client.isLobby && client.ws.readyState === WebSocket.OPEN) {
        n++;
      }
    }
    return n;
  }

  private send(ws: WebSocket, msg: any): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    // Best-effort backpressure check for direct (non-client-tracked) sends.
    if ((ws as any).bufferedAmount > BACKPRESSURE_TERMINATE_BYTES) {
      try { ws.terminate(); } catch {}
      return;
    }
    ws.send(JSON.stringify(msg));
  }

  /**
   * Send with backpressure handling. If the socket's send buffer is over the
   * threshold, drop superseded update types (board-update / snake-turn-update /
   * selections-update / lobby-update — the next turn supersedes them) instead
   * of letting Node buffer unbounded data for a slow/zombie client. If the
   * buffer stays high for a sustained period, terminate the connection so the
   * client can reconnect fresh.
   */
  private sendRaw(client: WSClient, data: string, msgType: string): void {
    const ws = client.ws;
    if (ws.readyState !== WebSocket.OPEN) return;

    const buffered = (ws as any).bufferedAmount as number;

    if (buffered > BACKPRESSURE_TERMINATE_BYTES) {
      console.warn(
        `[WebSocket] Backpressure terminate: conn=${client.connId} ` +
          `user=${client.userId || '-'} bufferedAmount=${buffered}B`,
      );
      this.connLogger.log({
        ts: Date.now(),
        side: 'server',
        type: 'server-backpressure-terminate',
        connId: client.connId,
        gameId: client.gameId || undefined,
        userId: client.userId || undefined,
        ip: client.ip,
        details: { bufferedAmount: buffered, msgType },
      });
      try { ws.terminate(); } catch {}
      return;
    }

    if (buffered > BACKPRESSURE_DROP_BYTES && SUPERSEDED_MSG_TYPES.has(msgType)) {
      this.connLogger.log({
        ts: Date.now(),
        side: 'server',
        type: 'server-backpressure-drop',
        connId: client.connId,
        gameId: client.gameId || undefined,
        userId: client.userId || undefined,
        ip: client.ip,
        details: { bufferedAmount: buffered, msgType },
      });
      return;
    }

    ws.send(data);
  }
}

// Graceful-shutdown close: 1001 "going away", the standard server-restart code.
const SHUTDOWN_CLOSE_CODE = 1001;
const SHUTDOWN_CLOSE_REASON = 'server-shutdown';
// How long shutdown waits for clients to answer the close handshake before
// terminating the stragglers outright.
const SHUTDOWN_CLOSE_BOUND_MS = 2000;

// 1 MB — drop superseded updates (next turn replaces them anyway) beyond this.
const BACKPRESSURE_DROP_BYTES = 1024 * 1024;
// 4 MB — terminate the socket; the client can reconnect and resync from scratch.
const BACKPRESSURE_TERMINATE_BYTES = 4 * 1024 * 1024;
const SUPERSEDED_MSG_TYPES = new Set([
  'board-update',
  'snake-turn-update',
  'selections-update',
  'lobby-update',
]);
