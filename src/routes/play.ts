import express from 'express';
import { ActiveGameManager } from '../server/active-game-manager';

const router = express.Router();

router.get('/api/play/games', (req, res) => {
  const manager = ActiveGameManager.getInstance();
  const games = manager.getActiveGames();
  console.log(`[Play API] GET /api/play/games → ${games.length} active games`);
  res.json(games.map(g => ({
    gameId: g.gameId,
    snakeId: g.snakeId,
    snakeName: g.snakeName,
    snakeEmoji: g.snakeEmoji,
    overrideEnabled: g.overrideEnabled,
    turn: g.turn,
    gameState: g.gameState
  })));
});

router.get('/api/play/game/:gameId/:snakeId', (req, res) => {
  const manager = ActiveGameManager.getInstance();
  const entry = manager.getGameEntry(req.params.gameId, req.params.snakeId);
  if (!entry) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }
  res.json({
    gameId: entry.gameId,
    snakeId: entry.snakeId,
    snakeName: entry.snakeName,
    snakeEmoji: entry.snakeEmoji,
    overrideEnabled: entry.overrideEnabled,
    gameState: entry.latestGameState,
    turnData: entry.latestTurnData
  });
});

export default router;
