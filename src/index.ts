import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { GameState, SnakeInfoResponse, Direction, Coord } from './types/battlesnake';
import { VoronoiStrategy } from './logic/voronoi-strategy-new';
import { TeamDetector } from './logic/team-detector';
import { GameLogger } from './utils/logger';
import { DecisionLogger } from './logic/decision-logger';
import { ActiveGameManager, TurnData } from './server/active-game-manager';
import { GameWebSocketServer } from './server/websocket-server';
import { MoveAnalyzer } from './logic/move-analyzer';
import { BoardGraph } from './logic/board-graph';
import logsRouter from './routes/logs';
import configRouter from './routes/config';
import playRouter from './routes/play';

const app = express();
const port = parseInt(process.env.PORT || '5000');

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    if (req.body.you?.head) {
      console.log(`  Snake position: (${req.body.you.head.x}, ${req.body.you.head.y})`);
      console.log(`  Board size: ${req.body.board?.width}x${req.body.board?.height}`);
      console.log(`  Turn: ${req.body.turn}`);
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '../src/web')));

const voronoiStrategy = new VoronoiStrategy();
const teamDetector = new TeamDetector();
const logger = new GameLogger();
const gameManager = ActiveGameManager.getInstance();
const firstMoveMoveAnalyzer = new MoveAnalyzer();

function getMoveDestination(head: Coord, move: Direction): Coord {
  switch (move) {
    case 'up': return { x: head.x, y: head.y + 1 };
    case 'down': return { x: head.x, y: head.y - 1 };
    case 'left': return { x: head.x - 1, y: head.y };
    case 'right': return { x: head.x + 1, y: head.y };
  }
}

app.get('/', (req, res) => {
  const info: SnakeInfoResponse = {
    apiversion: "1",
    author: "TeamSnekBot",
    color: "#FFD700",
    head: "default",
    tail: "default",
    version: "1.0.0"
  };
  res.json(info);
});

app.post('/start', (req, res) => {
  const gameState: GameState = req.body;
  logger.startGame(gameState);
  gameManager.registerGame(gameState);
  res.status(200).send('ok');
});

app.post('/move', async (req, res) => {
  const arrivalTime = Date.now();
  const gameState: GameState = req.body;
  const gameId = gameState.game.id;
  const snakeId = gameState.you.id;

  const game = gameManager.getGame(gameId);
  if (!game || !game.controlledSnakes.has(snakeId)) {
    gameManager.registerGame(gameState);
  }
  gameManager.updateGameState(gameId, snakeId, gameState);

  const gameTimeout = gameState.game.timeout || 500;
  const turnExpiryTime = (gameState.game as any).turnExpiryTime || null;
  gameManager.recordTurnArrival(gameId, arrivalTime, gameTimeout, turnExpiryTime);
  const pending = gameManager.setPendingMove(gameId, snakeId, res, gameTimeout, turnExpiryTime, gameState.turn);

  if (gameState.turn === 0) {
    try {
      const graph = new BoardGraph(gameState);
      const analysis = firstMoveMoveAnalyzer.analyzeMoves(gameState.you, gameState, graph);
      const candidates: Direction[] = [...analysis.safe, ...analysis.risky];

      let bestMove: Direction;
      if (candidates.length > 0) {
        // Prefer the move closest to food among non-lethal candidates.
        bestMove = candidates[0];
        let bestDist = Infinity;
        for (const move of candidates) {
          const dest = getMoveDestination(gameState.you.head, move);
          for (const food of gameState.board.food) {
            const dist = Math.abs(dest.x - food.x) + Math.abs(dest.y - food.y);
            if (dist < bestDist) {
              bestDist = dist;
              bestMove = move;
            }
          }
        }
        if (gameState.board.food.length === 0) {
          bestMove = candidates[0];
        }
      } else {
        // Spawn-trapped (extremely rare on turn 0). Pick the deterministic
        // least-bad direction instead of falling back to a hardcoded 'up' or
        // a closest-food iteration over all 4 cardinal moves — picking the
        // closest-food cell could be a wall or another snake's body.
        bestMove = firstMoveMoveAnalyzer.pickLeastBadMove(
          gameState.you,
          gameState,
          analysis.reasonByMove
        );
      }

      // Emit a structured unsafe-pick log whenever the chosen turn-0 move is
      // anything other than 'safe' — covers both the spawn-trapped case AND
      // the case where we had to take a risky (h2h-loss) move because no
      // truly safe moves exist.
      if (!analysis.safe.includes(bestMove)) {
        MoveAnalyzer.logUnsafePick({
          source: 'first-move',
          gameState,
          snake: gameState.you,
          reasonByMove: analysis.reasonByMove,
          chosen: bestMove,
          score: null,
          extra: {
            spawnTrapped: candidates.length === 0,
            riskyCandidates: analysis.risky,
          },
        });
      }

      console.log(`[FirstMove] Turn 0 for ${gameId}:${snakeId}: candidates=${candidates.join(',')||'<none>'}, chose=${bestMove}`);

      const turnData: TurnData = {
        gameState,
        moveEvaluations: [],
        territoryCells: {},
        safeMoves: candidates,
        botRecommendation: bestMove,
        timestamp: Date.now()
      };

      gameManager.setBotRecommendation(gameId, snakeId, bestMove, turnData);
    } catch (error) {
      logger.logError('Error in first-move calculation', error);
      if (!pending.resolved) {
        gameManager.setBotRecommendation(gameId, snakeId, 'up', {
          gameState,
          moveEvaluations: [],
          territoryCells: {},
          safeMoves: [],
          botRecommendation: 'up',
          timestamp: Date.now()
        });
      }
    }
  } else {
    try {
      const teams = teamDetector.detectTeams(gameState.board.snakes);
      const ourTeam = teams.find(team => team.snakes.some(snake => snake.id === snakeId));
      const result = await voronoiStrategy.getBestMoveWithDebug(gameState, ourTeam);

      const turnData: TurnData = {
        gameState,
        moveEvaluations: result.moveEvaluations,
        territoryCells: result.territoryCells,
        safeMoves: result.safeMoves,
        botRecommendation: result.move,
        timestamp: Date.now(),
        lethalityByMove: result.lethalityByMove,
      };

      gameManager.setBotRecommendation(gameId, snakeId, result.move, turnData);
    } catch (error) {
      logger.logError('Error in move calculation', error);
      if (!pending.resolved) {
        gameManager.setBotRecommendation(gameId, snakeId, 'up', {
          gameState,
          moveEvaluations: [],
          territoryCells: {},
          safeMoves: [],
          botRecommendation: 'up',
          timestamp: Date.now()
        });
      }
    }
  }
});

app.post('/end', (req, res) => {
  const gameState: GameState = req.body;
  logger.endGame(gameState);
  gameManager.endGame(gameState.game.id, gameState.you.id);
  res.status(200).send('ok');
});

app.use(logsRouter);
app.use(configRouter);
app.use(playRouter);

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

app.get('/play/:gameId', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/play-game.html'));
});

const httpServer = createServer(app);

const wsServer = new GameWebSocketServer(httpServer);
gameManager.startStaleGameCleanup(300000, 600000);
gameManager.startServerPing();

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`🐍 Battlesnake Team Snek Bot running on port ${port}!`);
  console.log(`Visit http://localhost:${port} for snake info`);
  console.log(`Visit http://localhost:${port}/config for configuration`);
  console.log(`Visit http://localhost:${port}/play for centaur play`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  const decisionLogger = DecisionLogger.getInstance();
  await decisionLogger.shutdown();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  const decisionLogger = DecisionLogger.getInstance();
  await decisionLogger.shutdown();
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
