import { Server as HTTPServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { ActiveGameManager, TurnData } from './active-game-manager';
import { Direction } from '../types/battlesnake';

interface WSClient {
  ws: WebSocket;
  gameId: string;
  snakeId: string;
  isLobby: boolean;
}

interface WSMessage {
  type: string;
  [key: string]: any;
}

export class GameWebSocketServer {
  private wss: WebSocketServer;
  private clients: Set<WSClient> = new Set();
  private gameManager: ActiveGameManager;

  constructor(server: HTTPServer) {
    this.gameManager = ActiveGameManager.getInstance();

    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const client: WSClient = { ws, gameId: '', snakeId: '', isLobby: false };
      this.clients.add(client);

      ws.on('message', (data: Buffer) => {
        try {
          const msg: WSMessage = JSON.parse(data.toString());
          this.handleMessage(client, msg);
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      });

      ws.on('close', () => {
        this.clients.delete(client);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        this.clients.delete(client);
      });
    });

    this.gameManager.onTurnUpdate((gameId, snakeId, turnData) => {
      this.broadcastToGame(gameId, snakeId, {
        type: 'turn-update',
        gameId,
        snakeId,
        turn: turnData.gameState.turn,
        gameState: turnData.gameState,
        moveEvaluations: turnData.moveEvaluations,
        territoryCells: turnData.territoryCells,
        safeMoves: turnData.safeMoves,
        botRecommendation: turnData.botRecommendation,
        timeout: turnData.gameState.game.timeout || 500,
        timestamp: turnData.timestamp
      });

      this.broadcastLobbyUpdate();
    });

    this.gameManager.onGameListChange((event, gameId, snakeId) => {
      console.log(`[WebSocket] Game list changed: ${event} ${gameId}:${snakeId}`);
      this.broadcastLobbyUpdate();
    });
  }

  private handleMessage(client: WSClient, msg: WSMessage): void {
    switch (msg.type) {
      case 'subscribe':
        client.gameId = msg.gameId || '';
        client.snakeId = msg.snakeId || '';
        const entry = this.gameManager.getGameEntry(client.gameId, client.snakeId);
        this.send(client.ws, {
          type: 'subscribed',
          gameId: client.gameId,
          snakeId: client.snakeId,
          overrideEnabled: entry?.overrideEnabled ?? false,
          gameState: entry?.latestGameState || null,
          turnData: entry?.latestTurnData || null
        });
        break;

      case 'select-move':
        const selectValidMoves: Direction[] = ['up', 'down', 'left', 'right'];
        if (client.gameId && client.snakeId && msg.move && selectValidMoves.includes(msg.move)) {
          this.gameManager.setUserSelection(client.gameId, client.snakeId, msg.move as Direction);
        }
        break;

      case 'submit-move':
        const validMoves: Direction[] = ['up', 'down', 'left', 'right'];
        if (client.gameId && client.snakeId && msg.move && validMoves.includes(msg.move)) {
          const success = this.gameManager.submitUserMove(
            client.gameId, client.snakeId, msg.move as Direction
          );
          this.send(client.ws, {
            type: 'move-submitted',
            success,
            move: msg.move
          });
          if (success) {
            this.broadcastToGame(client.gameId, client.snakeId, {
              type: 'move-committed',
              move: msg.move,
              source: 'user'
            });
          }
        } else if (msg.move && !validMoves.includes(msg.move)) {
          this.send(client.ws, {
            type: 'move-submitted',
            success: false,
            error: 'Invalid move. Must be one of: up, down, left, right'
          });
        }
        break;

      case 'set-override':
        if (client.gameId && client.snakeId) {
          this.gameManager.setOverrideEnabled(
            client.gameId, client.snakeId, !!msg.enabled
          );
          this.broadcastToGame(client.gameId, client.snakeId, {
            type: 'override-changed',
            enabled: !!msg.enabled
          });
        }
        break;

      case 'subscribe-lobby':
        client.isLobby = true;
        client.gameId = '';
        client.snakeId = '';
        this.sendLobbyState(client.ws);
        break;

      case 'ping':
        this.send(client.ws, { type: 'pong' });
        break;
    }
  }

  private sendLobbyState(ws: WebSocket): void {
    const games = this.gameManager.getActiveGames();
    this.send(ws, {
      type: 'lobby-update',
      games: games.map(g => ({
        gameId: g.gameId,
        snakeId: g.snakeId,
        snakeName: g.snakeName,
        overrideEnabled: g.overrideEnabled,
        turn: g.turn,
        gameState: g.gameState
      }))
    });
  }

  private broadcastLobbyUpdate(): void {
    const games = this.gameManager.getActiveGames();
    const msg = {
      type: 'lobby-update',
      games: games.map(g => ({
        gameId: g.gameId,
        snakeId: g.snakeId,
        snakeName: g.snakeName,
        overrideEnabled: g.overrideEnabled,
        turn: g.turn,
        gameState: g.gameState
      }))
    };
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.isLobby && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  private broadcastToGame(gameId: string, snakeId: string, msg: any): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.gameId === gameId && client.snakeId === snakeId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
      }
    }
  }

  private send(ws: WebSocket, msg: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
