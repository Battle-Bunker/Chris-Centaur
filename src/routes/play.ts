import express from 'express';
import { ActiveGameManager } from '../server/active-game-manager';

const router = express.Router();

router.get('/api/play/games', (req, res) => {
  const manager = ActiveGameManager.getInstance();
  const games = manager.getActiveGames();
  console.log(`[Play API] GET /api/play/games → ${games.length} active games`);
  res.json(games);
});

router.get('/api/play/game/:gameId', (req, res) => {
  const manager = ActiveGameManager.getInstance();
  const gameState = manager.getGameState(req.params.gameId);
  if (!gameState) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }
  res.json(gameState);
});

export default router;
