import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { GameState, MoveResponse, SnakeInfoResponse, Direction } from './types/battlesnake';
import { VoronoiStrategy } from './logic/voronoi-strategy-new';
import { TeamDetector } from './logic/team-detector';
import { GameLogger } from './utils/logger';
import { DecisionLogger } from './logic/decision-logger';
import { ActiveGameManager, TurnData } from './server/active-game-manager';
import { GameWebSocketServer } from './server/websocket-server';
import logsRouter from './routes/logs';
import configRouter from './routes/config';
import playRouter from './routes/play';

const app = express();
const port = parseInt(process.env.PORT || '5000');

app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    if (req.body.you) {
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
  const gameState: GameState = req.body;
  const gameId = gameState.game.id;
  const snakeId = gameState.you.id;

  if (!gameManager.getGameEntry(gameId, snakeId)) {
    gameManager.registerGame(gameState);
  }
  gameManager.updateGameState(gameId, snakeId, gameState);

  const overrideActive = gameManager.isOverrideEnabled(gameId, snakeId);

  if (overrideActive) {
    const gameTimeout = gameState.game.timeout || 500;
    const pending = gameManager.setPendingMove(gameId, snakeId, res, gameTimeout);

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
        timestamp: Date.now()
      };

      gameManager.setBotRecommendation(gameId, snakeId, result.move, turnData);
    } catch (error) {
      logger.logError('Error in centaur move calculation', error);
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
        timestamp: Date.now()
      };

      gameManager.setBotRecommendation(gameId, snakeId, result.move, turnData);

      const response: MoveResponse = {
        move: result.move,
        shout: `Team territory strategy! Turn ${gameState.turn}`
      };

      res.json(response);
    } catch (error) {
      logger.logError('Error in move calculation', error);
      const response: MoveResponse = {
        move: 'up',
        shout: 'Error fallback!'
      };
      res.json(response);
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

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/history.html'));
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/play.html'));
});

app.get('/play/:gameId/:snakeId', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/web/play-game.html'));
});

const httpServer = createServer(app);

const wsServer = new GameWebSocketServer(httpServer);
gameManager.startStaleGameCleanup(300000, 600000);

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
