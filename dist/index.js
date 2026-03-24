"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const http_1 = require("http");
const voronoi_strategy_new_1 = require("./logic/voronoi-strategy-new");
const team_detector_1 = require("./logic/team-detector");
const logger_1 = require("./utils/logger");
const decision_logger_1 = require("./logic/decision-logger");
const active_game_manager_1 = require("./server/active-game-manager");
const websocket_server_1 = require("./server/websocket-server");
const logs_1 = __importDefault(require("./routes/logs"));
const config_1 = __importDefault(require("./routes/config"));
const play_1 = __importDefault(require("./routes/play"));
const app = (0, express_1.default)();
const port = parseInt(process.env.PORT || '5000');
app.use(express_1.default.json());
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
app.use(express_1.default.static(path_1.default.join(__dirname, '../src/web')));
const voronoiStrategy = new voronoi_strategy_new_1.VoronoiStrategy();
const teamDetector = new team_detector_1.TeamDetector();
const logger = new logger_1.GameLogger();
const gameManager = active_game_manager_1.ActiveGameManager.getInstance();
app.get('/', (req, res) => {
    const info = {
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
    const gameState = req.body;
    logger.startGame(gameState);
    gameManager.registerGame(gameState);
    res.status(200).send('ok');
});
app.post('/move', async (req, res) => {
    const gameState = req.body;
    const gameId = gameState.game.id;
    const snakeId = gameState.you.id;
    const game = gameManager.getGame(gameId);
    if (!game || !game.controlledSnakes.has(snakeId)) {
        gameManager.registerGame(gameState);
    }
    gameManager.updateGameState(gameId, snakeId, gameState);
    const gameTimeout = gameState.game.timeout || 500;
    const pending = gameManager.setPendingMove(gameId, snakeId, res, gameTimeout);
    try {
        const teams = teamDetector.detectTeams(gameState.board.snakes);
        const ourTeam = teams.find(team => team.snakes.some(snake => snake.id === snakeId));
        const result = await voronoiStrategy.getBestMoveWithDebug(gameState, ourTeam);
        const turnData = {
            gameState,
            moveEvaluations: result.moveEvaluations,
            territoryCells: result.territoryCells,
            safeMoves: result.safeMoves,
            botRecommendation: result.move,
            timestamp: Date.now()
        };
        gameManager.setBotRecommendation(gameId, snakeId, result.move, turnData);
    }
    catch (error) {
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
});
app.post('/end', (req, res) => {
    const gameState = req.body;
    logger.endGame(gameState);
    gameManager.endGame(gameState.game.id, gameState.you.id);
    res.status(200).send('ok');
});
app.use(logs_1.default);
app.use(config_1.default);
app.use(play_1.default);
app.get('/config', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../src/web/config.html'));
});
app.get('/board-test', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../src/web/board-test.html'));
});
app.get('/history', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../src/web/history.html'));
});
app.get('/play', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../src/web/play.html'));
});
app.get('/play/:gameId', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../src/web/play-game.html'));
});
const httpServer = (0, http_1.createServer)(app);
const wsServer = new websocket_server_1.GameWebSocketServer(httpServer);
gameManager.startStaleGameCleanup(300000, 600000);
httpServer.listen(port, '0.0.0.0', () => {
    console.log(`🐍 Battlesnake Team Snek Bot running on port ${port}!`);
    console.log(`Visit http://localhost:${port} for snake info`);
    console.log(`Visit http://localhost:${port}/config for configuration`);
    console.log(`Visit http://localhost:${port}/play for centaur play`);
});
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    const decisionLogger = decision_logger_1.DecisionLogger.getInstance();
    await decisionLogger.shutdown();
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully...');
    const decisionLogger = decision_logger_1.DecisionLogger.getInstance();
    await decisionLogger.shutdown();
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
