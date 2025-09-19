"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const decision_logger_1 = require("../logic/decision-logger");
const router = express_1.default.Router();
const logger = decision_logger_1.DecisionLogger.getInstance();
// Get list of games with metadata
router.get('/api/logs/games', async (req, res) => {
    try {
        const games = await logger.getGames();
        res.json(games);
    }
    catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
});
// Query logs with filters
router.get('/api/logs', async (req, res) => {
    try {
        const filters = {
            gameId: req.query.game_id || req.query.gameId,
            snakeId: req.query.snake_id || req.query.snakeId,
            startTurn: req.query.startTurn ? parseInt(req.query.startTurn, 10) : undefined,
            endTurn: req.query.endTurn ? parseInt(req.query.endTurn, 10) : undefined,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : 1000,
            offset: req.query.offset ? parseInt(req.query.offset, 10) : 0
        };
        const logs = await logger.queryLogs(filters);
        // Format response with decision data
        res.json({
            decisions: logs.map(log => ({
                turn: log.turn,
                snake_id: log.snake_id,
                snake_name: log.snake_name,
                position_x: log.position_x,
                position_y: log.position_y,
                health: log.health,
                safe_moves: log.safe_moves,
                chosen_move: log.chosen_move,
                move_evaluations: typeof log.move_evaluations === 'string'
                    ? JSON.parse(log.move_evaluations)
                    : log.move_evaluations,
                game_state: typeof log.game_state === 'string'
                    ? JSON.parse(log.game_state)
                    : log.game_state,
                timestamp: log.timestamp
            }))
        });
    }
    catch (error) {
        console.error('Error querying logs:', error);
        res.status(500).json({ error: 'Failed to query logs' });
    }
});
// Clear old logs (admin endpoint)
router.delete('/api/logs/old', async (req, res) => {
    try {
        const daysToKeep = req.query.days ? parseInt(req.query.days, 10) : 7;
        await logger.clearOldLogs(daysToKeep);
        res.json({ message: `Cleared logs older than ${daysToKeep} days` });
    }
    catch (error) {
        console.error('Error clearing old logs:', error);
        res.status(500).json({ error: 'Failed to clear old logs' });
    }
});
exports.default = router;
