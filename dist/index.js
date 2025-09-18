"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const voronoi_strategy_1 = require("./logic/voronoi-strategy");
const team_detector_1 = require("./logic/team-detector");
const logger_1 = require("./utils/logger");
const app = (0, express_1.default)();
const port = parseInt(process.env.PORT || '5000');
app.use(express_1.default.json());
// Request logging middleware - log ALL incoming requests
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
app.use(express_1.default.static(path_1.default.join(__dirname, '../src/web')));
const voronoiStrategy = new voronoi_strategy_1.VoronoiStrategy();
const teamDetector = new team_detector_1.TeamDetector();
const logger = new logger_1.GameLogger();
// Battlesnake info endpoint
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
// Game start endpoint
app.post('/start', (req, res) => {
    const gameState = req.body;
    logger.startGame(gameState);
    res.status(200).send('ok');
});
// Move endpoint - core logic
app.post('/move', (req, res) => {
    const gameState = req.body;
    try {
        // Detect teams based on color
        const teams = teamDetector.detectTeams(gameState.board.snakes);
        const ourTeam = teams.find(team => team.snakes.some(snake => snake.id === gameState.you.id));
        // Get best move using Voronoi strategy with logging
        const result = voronoiStrategy.getBestMoveWithDebug(gameState, ourTeam);
        // Old logger disabled - new format logging happens in strategy
        // logger.logMove(gameState, result.safeMoves, result.move, result.scores);
        const response = {
            move: result.move,
            shout: `Team territory strategy! Turn ${gameState.turn}`
        };
        res.json(response);
    }
    catch (error) {
        logger.logError('Error in move calculation', error);
        // Fallback to safe move
        const response = {
            move: 'up',
            shout: 'Error fallback!'
        };
        res.json(response);
    }
});
// Game end endpoint
app.post('/end', (req, res) => {
    const gameState = req.body;
    logger.endGame(gameState);
    res.status(200).send('ok');
});
// Simple web interface
app.get('/config', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../src/web/config.html'));
});
app.listen(port, '0.0.0.0', () => {
    console.log(`🐍 Battlesnake Team Snek Bot running on port ${port}!`);
    console.log(`Visit http://localhost:${port} for snake info`);
    console.log(`Visit http://localhost:${port}/config for configuration`);
});
//# sourceMappingURL=index.js.map