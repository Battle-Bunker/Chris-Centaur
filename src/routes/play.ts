import express from 'express';
import { ActiveGameManager } from '../server/active-game-manager';
import { PendingGameRegistry } from '../logic/pending-game-registry';
import { botRegistry } from '../config/bot-store';
import { behaviourId } from '../config/build-identity';

const router = express.Router();

router.get('/api/play/games', (_req, res) => {
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

/**
 * WHICH BOT THIS GAME IS PLAYING. Read-only, deliberately: a binding is
 * changed by writing a `config_store` row (see `docs/BOT-BINDING.md`), and an
 * endpoint that could re-bind a live game's objective function from an
 * unauthenticated GET surface is not a thing this server should own.
 *
 * `observed: true` means the answer is what the decision seam ACTUALLY
 * resolved for this game — the only authority on what has been played.
 * `observed: false` means no turn has been decided yet, so the answer is what
 * the next decision would resolve to, which a store edit can still change.
 *
 * `refusals` carries the bindings the last load REJECTED. An operator whose
 * stored bot has a typo'd weight key otherwise sees a game quietly playing the
 * default and no reason anywhere.
 */
router.get('/api/play/game/:gameId/bot', (req, res) => {
  const gameId = req.params.gameId;
  const registry = botRegistry();
  const observed = registry.observedFor(gameId);
  const binding =
    observed ?? registry.resolveFor(gameId, process.env.TACTICTOES_CENTAUR_ID ?? '');
  res.json({
    gameId,
    observed: observed !== null,
    botId: binding.identity.botId,
    behaviourId: binding.identity.behaviourId,
    name: binding.spec.name,
    engine: binding.spec.engine,
    profile: binding.spec.profile.name,
    stagingSafety: binding.spec.stagingSafety ?? null,
    candidates: binding.spec.candidates ?? null,
    source: binding.source,
    key: binding.key,
    refusals: registry.warnings(),
  });
});

/** Every bot this deployment can bind, built-ins plus whatever `bot.catalog`
 * adds — the list an operator picks a name from. */
router.get('/api/bots', (_req, res) => {
  const registry = botRegistry();
  res.json({
    behaviourId: behaviourId(),
    bots: Object.entries(registry.catalog()).map(([name, spec]) => ({
      name,
      engine: spec.engine,
      profile: spec.profile.name,
    })),
    refusals: registry.warnings(),
  });
});

export default router;
