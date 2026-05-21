import { Server as HTTPServer, IncomingMessage } from 'http';
import { createHash } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { ActiveGameManager, TurnData } from './active-game-manager';
import { Direction } from '../types/battlesnake';
import { ConnectionLogger } from '../utils/connection-logger';
import {
  IDLE_TIMEOUT_MS,
  IDLE_CLOSE_CODE,
  IDLE_CLOSE_REASON,
  SERVER_IDLE_SWEEP_INTERVAL_MS,
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
}

/** Inbound message types that represent real user intent. Pings (which the
 *  client sends every 5s for latency measurement) deliberately do NOT count
 *  — otherwise the idle sweep would never fire. The dedicated `activity`
 *  heartbeat from IdleWatcher is what keeps an active human "alive". */
const USER_INTENT_TYPES = new Set([
  'subscribe-game',
  'subscribe-lobby',
  'select-snake',
  'deselect',
  'hold-snake',
  'release-all-holds',
  'suicide-all',
  'select-move',
  'submit-move',
  'set-premove',
  'set-nickname',
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
  private idleSweepInterval: NodeJS.Timeout | null = null;

  constructor(server: HTTPServer) {
    this.gameManager = ActiveGameManager.getInstance();
    this.connLogger = ConnectionLogger.getInstance();

    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.startIdleSweep();

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

      ws.on('message', (data: Buffer) => {
        try {
          const msg: WSMessage = JSON.parse(data.toString());
          if (msg && typeof msg.type === 'string' && USER_INTENT_TYPES.has(msg.type)) {
            client.lastActivityAt = Date.now();
          }
          this.handleMessage(client, msg);
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
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
        measuredPing: this.gameManager.getMeasuredPing(),
        selections: this.getSelectionsForGame(gameId),
        holds: this.gameManager.getHoldStates(gameId),
        stagedMoves: this.getStagedMovesForGame(gameId),
        premoves: this.gameManager.getPremovesForGame(gameId),
        waypoints: this.gameManager.getWaypointsForGame(gameId),
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
        safeMoves: turnData.safeMoves,
        botRecommendation: turnData.botRecommendation,
        timeout: turnData.gameState.game.timeout || 500,
        timestamp: turnData.timestamp,
        moveCommitted: game?.controlledSnakes.get(snakeId)?.moveCommittedThisTurn || false,
        committedMove: game?.controlledSnakes.get(snakeId)?.committedMove || null,
      });
    });

    this.gameManager.onMoveCommitted((gameId, snakeId, move, source) => {
      this.broadcastToGame(gameId, {
        type: 'move-committed',
        gameId,
        snakeId,
        move,
        source,
      });
    });

    this.gameManager.onGameListChange((event, gameId, snakeId) => {
      console.log(`[WebSocket] Game list changed: ${event} ${gameId}:${snakeId}`);
      this.broadcastLobbyUpdate();
    });

    this.gameManager.onGameEnd((gameId, snakeId, finalGameState, gameOver) => {
      const finalSnakes = finalGameState.board.snakes || [];
      const survived = finalSnakes.some(s => s.id === snakeId);
      const won = survived && finalSnakes.length === 1;
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
        client.gameId = gameId;
        client.userId = userId;
        client.isLobby = false;

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

        const user = this.gameManager.addConnectedUser(gameId, userId);
        const gameState = this.gameManager.getGameState(gameId);

        this.send(client.ws, {
          type: 'game-subscribed',
          gameId,
          userId,
          userColor: user?.color || '#888888',
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
              moveCommitted: controlled.moveCommittedThisTurn,
              committedMove: controlled.committedMove,
              botRecommendation: controlled.botRecommendation,
              stagedMove: controlled.pendingMove?.userSelectedMove || null,
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

      case 'hold-snake': {
        if (!client.gameId || !client.userId) break;
        const snakeId = msg.snakeId;
        if (!snakeId) break;
        const result = this.gameManager.holdSnake(client.gameId, snakeId, client.userId);
        this.send(client.ws, {
          type: 'hold-result',
          snakeId,
          success: result.success,
          holdTurnsRemaining: result.holdTurnsRemaining,
        });
        this.broadcastSelectionsUpdate(client.gameId);
        break;
      }

      case 'release-all-holds': {
        if (!client.gameId || !client.userId) break;
        this.gameManager.releaseAllHolds(client.gameId);
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
        const result = this.gameManager.suicideAllSnakes(client.gameId);
        this.send(client.ws, { type: 'suicide-result', success: true, affected: result.affected });
        this.broadcastSelectionsUpdate(client.gameId);
        break;
      }

      case 'select-move': {
        const validMoves: Direction[] = ['up', 'down', 'left', 'right'];
        const snakeId = msg.snakeId;
        if (client.gameId && client.userId && snakeId && msg.move && validMoves.includes(msg.move)) {
          const game = this.gameManager.getGame(client.gameId);
          const controlled = game?.controlledSnakes.get(snakeId);
          if (controlled && controlled.selectedBy === client.userId) {
            this.gameManager.setUserSelection(client.gameId, snakeId, msg.move as Direction);
            this.broadcastSelectionsUpdate(client.gameId);
          }
        }
        break;
      }

      case 'submit-move': {
        const validMoves: Direction[] = ['up', 'down', 'left', 'right'];
        const snakeId = msg.snakeId;
        if (client.gameId && client.userId && snakeId && msg.move && validMoves.includes(msg.move)) {
          const game = this.gameManager.getGame(client.gameId);
          const controlled = game?.controlledSnakes.get(snakeId);
          if (!controlled || controlled.selectedBy !== client.userId) {
            this.send(client.ws, {
              type: 'move-submitted',
              success: false,
              error: 'You do not have this snake selected',
              snakeId,
            });
            break;
          }
          const success = this.gameManager.submitUserMove(
            client.gameId, snakeId, msg.move as Direction
          );
          this.send(client.ws, {
            type: 'move-submitted',
            success,
            move: msg.move,
            snakeId,
          });
          if (success) this.broadcastSelectionsUpdate(client.gameId);
        }
        break;
      }

      case 'set-premove': {
        if (!client.gameId || !client.userId) break;
        const snakeId = msg.snakeId;
        if (!snakeId) break;
        const ok = this.gameManager.setPremoveQueue(
          client.gameId, snakeId, msg.queue, client.userId
        );
        if (ok) this.broadcastSelectionsUpdate(client.gameId);
        break;
      }

      case 'set-waypoint': {
        if (!client.gameId || !client.userId) break;
        const snakeId = msg.snakeId;
        if (!snakeId) break;
        // msg.waypoint may be null (clear) or {type, x, y}
        const ok = this.gameManager.setWaypoint(
          client.gameId, snakeId, msg.waypoint ?? null, client.userId
        );
        if (ok) this.broadcastSelectionsUpdate(client.gameId);
        break;
      }

      case 'set-nickname': {
        if (!client.gameId || !client.userId) break;
        const nickname = typeof msg.nickname === 'string' ? msg.nickname : null;
        const success = this.gameManager.setUserNickname(client.gameId, client.userId, nickname);
        if (success) {
          this.broadcastSelectionsUpdate(client.gameId);
        }
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
        // Heartbeat from IdleWatcher signalling the user has been active.
        // lastActivityAt was already bumped above by the USER_INTENT_TYPES
        // check; nothing more to do here. Don't reply — a silent ack keeps
        // this off the wire when the tab is idle.
        break;
      }
    }
  }

  private startIdleSweep(): void {
    if (this.idleSweepInterval) return;
    this.idleSweepInterval = setInterval(() => {
      const cutoff = Date.now() - IDLE_TIMEOUT_MS;
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
          } catch (e) {
            // best-effort: socket may already be tearing down
          }
        }
      }
    }, SERVER_IDLE_SWEEP_INTERVAL_MS);
    // Don't keep the event loop alive solely for the sweep timer.
    if (typeof this.idleSweepInterval.unref === 'function') {
      this.idleSweepInterval.unref();
    }
  }

  /** Emit a single line whenever the active-connection count changes. Called
   *  from the add/delete sites so every transition shows up exactly once. */
  private logActiveConnections(reason: string, connId: string): void {
    console.log(
      `[WebSocket] Active connections: ${this.clients.size} ` +
        `(${reason} conn=${connId})`,
    );
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

  private getStagedMovesForGame(gameId: string): { [snakeId: string]: { move: string; committed: boolean; color: string } } {
    const game = this.gameManager.getGame(gameId);
    if (!game) return {};

    const staged: { [snakeId: string]: { move: string; committed: boolean; color: string } } = {};
    for (const [snakeId, cs] of game.controlledSnakes) {
      const userColor = cs.selectedBy
        ? game.connectedUsers.get(cs.selectedBy)?.color || '#4CAF50'
        : '#4CAF50';
      if (cs.moveCommittedThisTurn && cs.committedMove) {
        staged[snakeId] = { move: cs.committedMove, committed: true, color: userColor };
      } else if (cs.pendingMove && !cs.pendingMove.resolved && cs.pendingMove.userSelectedMove) {
        staged[snakeId] = { move: cs.pendingMove.userSelectedMove, committed: false, color: userColor };
      }
    }
    return staged;
  }

  private broadcastSelectionsUpdate(gameId: string): void {
    const game = this.gameManager.getGame(gameId);
    if (!game) return;

    const selections = this.getSelectionsForGame(gameId);
    const connectedUsers = Array.from(game.connectedUsers.values());
    const holds = this.gameManager.getHoldStates(gameId);
    const stagedMoves = this.getStagedMovesForGame(gameId);
    const premoves = this.gameManager.getPremovesForGame(gameId);
    const waypoints = this.gameManager.getWaypointsForGame(gameId);

    this.broadcastToGame(gameId, {
      type: 'selections-update',
      selections,
      connectedUsers,
      holds,
      stagedMoves,
      premoves,
      waypoints,
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

  private sendLobbyState(ws: WebSocket): void {
    const games = this.gameManager.getActiveGames();
    this.send(ws, {
      type: 'lobby-update',
      games,
    });
  }

  private broadcastLobbyUpdate(): void {
    const games = this.gameManager.getActiveGames();
    const msg = { type: 'lobby-update', games };
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
