import { Server as HTTPServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { ActiveGameManager, TurnData } from './active-game-manager';
import { Direction } from '../types/battlesnake';

interface WSClient {
  ws: WebSocket;
  gameId: string;
  userId: string;
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
      const client: WSClient = { ws, gameId: '', userId: '', isLobby: false };
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
        this.handleDisconnect(client);
        this.clients.delete(client);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err);
        this.handleDisconnect(client);
        this.clients.delete(client);
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
  }

  private handleMessage(client: WSClient, msg: WSMessage): void {
    switch (msg.type) {
      case 'subscribe-game': {
        const gameId = msg.gameId || '';
        const userId = msg.userId || '';
        client.gameId = gameId;
        client.userId = userId;
        client.isLobby = false;

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
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const expected = `${dd}/${mm}/${yyyy}`;
        if (msg.password !== expected) {
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
    }
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

    this.broadcastToGame(gameId, {
      type: 'selections-update',
      selections,
      connectedUsers,
      holds,
      stagedMoves,
    });
  }

  private sendToUser(gameId: string, userId: string, msg: any): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.gameId === gameId && client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data);
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
        client.ws.send(data);
      }
    }
  }

  private broadcastToGame(gameId: string, msg: any): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.gameId === gameId && !client.isLobby && client.ws.readyState === WebSocket.OPEN) {
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
