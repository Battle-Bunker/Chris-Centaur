import express from 'express';
import { DecisionLogger } from '../logic/decision-logger';
import { CommandLogger } from '../logic/command-logger';

const router = express.Router();
const logger = DecisionLogger.getInstance();

// Get list of games with metadata
router.get('/api/logs/games', async (req, res) => {
  try {
    const games = await logger.getGames();
    res.json(games);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// Query logs with filters
router.get('/api/logs', async (req, res) => {
  try {
    const filters = {
      gameId: req.query.game_id as string || req.query.gameId as string,
      snakeId: req.query.snake_id as string || req.query.snakeId as string,
      startTurn: req.query.startTurn ? parseInt(req.query.startTurn as string, 10) : undefined,
      endTurn: req.query.endTurn ? parseInt(req.query.endTurn as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 1000,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0
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
        bot_recommendation: log.bot_recommendation,
        submitted_move: log.submitted_move ?? null,
        fatal_consent: log.fatal_consent ?? null,
        server_move: log.server_move ?? null,
        move_evaluations: typeof log.move_evaluations === 'string' 
          ? JSON.parse(log.move_evaluations)
          : log.move_evaluations,
        game_state: typeof log.game_state === 'string'
          ? JSON.parse(log.game_state)
          : log.game_state,
        timestamp: log.timestamp
      }))
    });
  } catch (error) {
    console.error('Error querying logs:', error);
    res.status(500).json({ error: 'Failed to query logs' });
  }
});

// Command history for one game: the raw operator command events (goto/near/
// manual/…, with operator attribution) plus the per-turn command-state
// snapshots keyed by the board turn whose END they describe. The history
// viewer feeds the snapshots straight into the live render paths.
router.get('/api/logs/commands', async (req, res) => {
  try {
    const gameId = (req.query.game_id as string) || (req.query.gameId as string);
    if (!gameId) {
      res.status(400).json({ error: 'game_id is required' });
      return;
    }
    const commands = await CommandLogger.getInstance().getGameCommands(gameId);
    res.json(commands);
  } catch (error) {
    console.error('Error querying command logs:', error);
    res.status(500).json({ error: 'Failed to query command logs' });
  }
});

// Clear old logs (admin endpoint)
router.delete('/api/logs/old', async (req, res) => {
  try {
    const daysToKeep = req.query.days ? parseInt(req.query.days as string, 10) : 7;
    await logger.clearOldLogs(daysToKeep);
    await CommandLogger.getInstance().clearOldCommands(daysToKeep);
    res.json({ message: `Cleared logs older than ${daysToKeep} days` });
  } catch (error) {
    console.error('Error clearing old logs:', error);
    res.status(500).json({ error: 'Failed to clear old logs' });
  }
});

export default router;