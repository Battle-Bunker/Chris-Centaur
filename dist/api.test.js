"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const voronoi_strategy_1 = require("./logic/voronoi-strategy");
const team_detector_1 = require("./logic/team-detector");
const logger_1 = require("./utils/logger");
// Create the Express app
function createApp() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
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
    // Move endpoint
    app.post('/move', (req, res) => {
        const gameState = req.body;
        try {
            const teams = teamDetector.detectTeams(gameState.board.snakes);
            const ourTeam = teams.find(team => team.snakes.some(snake => snake.id === gameState.you.id));
            const result = voronoiStrategy.getBestMoveWithDebug(gameState, ourTeam);
            logger.logMove(gameState, result.safeMoves, result.move, result.scores);
            const response = {
                move: result.move,
                shout: `Team territory strategy! Turn ${gameState.turn}`
            };
            res.json(response);
        }
        catch (error) {
            logger.logError('Error in move calculation', error);
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
    return app;
}
describe('Battlesnake API', () => {
    let app;
    beforeEach(() => {
        app = createApp();
    });
    describe('GET /', () => {
        test('should return snake info', async () => {
            const response = await (0, supertest_1.default)(app).get('/');
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('apiversion', '1');
            expect(response.body).toHaveProperty('author');
            expect(response.body).toHaveProperty('color');
            expect(response.body).toHaveProperty('head');
            expect(response.body).toHaveProperty('tail');
        });
    });
    describe('POST /start', () => {
        test('should acknowledge game start', async () => {
            const gameState = {
                game: {
                    id: 'test-game',
                    ruleset: { name: 'standard', version: '1.0.0', settings: {} },
                    map: 'standard',
                    timeout: 500,
                    source: 'test'
                },
                turn: 0,
                board: {
                    width: 11,
                    height: 11,
                    snakes: [{
                            id: 'test-snake',
                            name: 'Test Snake',
                            latency: '100',
                            health: 100,
                            body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
                            head: { x: 5, y: 5 },
                            length: 3,
                            shout: '',
                            squad: '',
                            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                        }],
                    food: [],
                    hazards: []
                },
                you: {
                    id: 'test-snake',
                    name: 'Test Snake',
                    latency: '100',
                    health: 100,
                    body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
                    head: { x: 5, y: 5 },
                    length: 3,
                    shout: '',
                    squad: '',
                    customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                }
            };
            const response = await (0, supertest_1.default)(app)
                .post('/start')
                .send(gameState);
            expect(response.status).toBe(200);
            expect(response.text).toBe('ok');
        });
    });
    describe('POST /move', () => {
        test('should return valid move for simple board', async () => {
            const gameState = {
                game: {
                    id: 'test-game',
                    ruleset: { name: 'standard', version: '1.0.0', settings: {} },
                    map: 'standard',
                    timeout: 500,
                    source: 'test'
                },
                turn: 1,
                board: {
                    width: 11,
                    height: 11,
                    snakes: [{
                            id: 'test-snake',
                            name: 'Test Snake',
                            latency: '100',
                            health: 100,
                            body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
                            head: { x: 5, y: 5 },
                            length: 3,
                            shout: '',
                            squad: '',
                            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                        }],
                    food: [],
                    hazards: []
                },
                you: {
                    id: 'test-snake',
                    name: 'Test Snake',
                    latency: '100',
                    health: 100,
                    body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
                    head: { x: 5, y: 5 },
                    length: 3,
                    shout: '',
                    squad: '',
                    customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                }
            };
            const response = await (0, supertest_1.default)(app)
                .post('/move')
                .send(gameState);
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('move');
            expect(['up', 'down', 'left', 'right']).toContain(response.body.move);
            expect(response.body).toHaveProperty('shout');
        });
        test('should not move out of bounds when at edge', async () => {
            const gameState = {
                game: {
                    id: 'test-game',
                    ruleset: { name: 'standard', version: '1.0.0', settings: {} },
                    map: 'standard',
                    timeout: 500,
                    source: 'test'
                },
                turn: 1,
                board: {
                    width: 11,
                    height: 11,
                    snakes: [{
                            id: 'test-snake',
                            name: 'Test Snake',
                            latency: '100',
                            health: 100,
                            body: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
                            head: { x: 0, y: 0 },
                            length: 3,
                            shout: '',
                            squad: '',
                            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                        }],
                    food: [],
                    hazards: []
                },
                you: {
                    id: 'test-snake',
                    name: 'Test Snake',
                    latency: '100',
                    health: 100,
                    body: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
                    head: { x: 0, y: 0 },
                    length: 3,
                    shout: '',
                    squad: '',
                    customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                }
            };
            const response = await (0, supertest_1.default)(app)
                .post('/move')
                .send(gameState);
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('move');
            // With correct coordinate system: (0,0) is bottom-left
            // Cannot move down (would go to y=-1) or left (would go to x=-1)
            // Cannot move right (body at x=1,y=0)
            // CAN move up (would go to y=1)
            expect(response.body.move).not.toBe('down'); // FIXED: down is out of bounds
            expect(response.body.move).not.toBe('left'); // left is out of bounds
            // The only valid move should be 'up'
            expect(response.body.move).toBe('up');
        });
        test('should handle multiple snakes correctly', async () => {
            const gameState = {
                game: {
                    id: 'test-game',
                    ruleset: { name: 'standard', version: '1.0.0', settings: {} },
                    map: 'standard',
                    timeout: 500,
                    source: 'test'
                },
                turn: 1,
                board: {
                    width: 11,
                    height: 11,
                    snakes: [
                        {
                            id: 'test-snake',
                            name: 'Test Snake',
                            latency: '100',
                            health: 100,
                            body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
                            head: { x: 5, y: 5 },
                            length: 3,
                            shout: '',
                            squad: 'team-a',
                            customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                        },
                        {
                            id: 'enemy-snake',
                            name: 'Enemy Snake',
                            latency: '100',
                            health: 100,
                            body: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }],
                            head: { x: 6, y: 5 },
                            length: 3,
                            shout: '',
                            squad: 'team-b',
                            customizations: { color: '#0000FF', head: 'default', tail: 'default' }
                        }
                    ],
                    food: [],
                    hazards: []
                },
                you: {
                    id: 'test-snake',
                    name: 'Test Snake',
                    latency: '100',
                    health: 100,
                    body: [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }],
                    head: { x: 5, y: 5 },
                    length: 3,
                    shout: '',
                    squad: 'team-a',
                    customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                }
            };
            const response = await (0, supertest_1.default)(app)
                .post('/move')
                .send(gameState);
            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('move');
            // Should not move right into enemy snake
            expect(response.body.move).not.toBe('right');
        });
    });
    describe('POST /end', () => {
        test('should acknowledge game end', async () => {
            const gameState = {
                game: {
                    id: 'test-game',
                    ruleset: { name: 'standard', version: '1.0.0', settings: {} },
                    map: 'standard',
                    timeout: 500,
                    source: 'test'
                },
                turn: 100,
                board: {
                    width: 11,
                    height: 11,
                    snakes: [],
                    food: [],
                    hazards: []
                },
                you: {
                    id: 'test-snake',
                    name: 'Test Snake',
                    latency: '100',
                    health: 0,
                    body: [],
                    head: { x: 0, y: 0 },
                    length: 0,
                    shout: '',
                    squad: '',
                    customizations: { color: '#FF0000', head: 'default', tail: 'default' }
                }
            };
            const response = await (0, supertest_1.default)(app)
                .post('/end')
                .send(gameState);
            expect(response.status).toBe(200);
            expect(response.text).toBe('ok');
        });
    });
});
