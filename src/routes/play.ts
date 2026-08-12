import express from 'express';
import { ActiveGameManager } from '../server/active-game-manager';
import { PendingGameRegistry } from '../logic/pending-game-registry';

const router = express.Router();

router.get('/api/play/games', (req, res) => {
  const manager = ActiveGameManager.getInstance();
  const games = manager.getActiveGames();
  const pendingGames = PendingGameRegistry.getInstance().list();
  console.log(
    `[Play API] GET /api/play/games → ${games.length} active, ${pendingGames.length} pending`
  );
  res.json({ games, pendingGames });
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

// Names already enrolled in an active game. The login screen polls this to
// pre-validate the typed name (the authoritative, race-safe check still
// happens at enrol time inside the game manager).
router.get('/api/play/game/:gameId/players', (req, res) => {
  const manager = ActiveGameManager.getInstance();
  if (!manager.getGame(req.params.gameId)) {
    res.status(404).json({ error: 'Game not found' });
    return;
  }
  const excludeUserId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  res.json({ names: manager.getEnrolledNames(req.params.gameId, excludeUserId) });
});

export default router;
