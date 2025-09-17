"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const voronoi_strategy_1 = require("./logic/voronoi-strategy");
const team_detector_1 = require("./logic/team-detector");
const app = (0, express_1.default)();
const port = parseInt(process.env.PORT || '5000');
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, '../src/web')));
const voronoiStrategy = new voronoi_strategy_1.VoronoiStrategy();
const teamDetector = new team_detector_1.TeamDetector();
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
    console.log(`Game ${gameState.game.id} started!`);
    res.status(200).send('ok');
});
// Move endpoint - core logic
app.post('/move', (req, res) => {
    const gameState = req.body;
    try {
        // Detect teams based on color
        const teams = teamDetector.detectTeams(gameState.board.snakes);
        const ourTeam = teams.find(team => team.snakes.some(snake => snake.id === gameState.you.id));
        // Get best move using Voronoi strategy
        const move = voronoiStrategy.getBestMove(gameState, ourTeam);
        const response = {
            move,
            shout: `Team territory strategy! Turn ${gameState.turn}`
        };
        console.log(`Turn ${gameState.turn}: Moving ${move}`);
        res.json(response);
    }
    catch (error) {
        console.error('Error in move calculation:', error);
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
    console.log(`Game ${gameState.game.id} ended!`);
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