import express from 'express';
import { DecisionLogger } from '../logic/decision-logger';
import { CommandLogger } from '../logic/command-logger';
import { ActivityController } from '../server/activity-controller';
import { ActiveGameManager } from '../server/active-game-manager';
import {
  OWNER_NEUTRAL,
  OWNER_UNREACHED,
  computeTerritoryView,
} from '../logic/territory-view';

/**
 * The read side of the lens store.
 *
 * Every route here answers off the five tables. What changed under them is the
 * SHAPE of the answer, not the questions: `/api/logs` used to serve one
 * per-unit decision row carrying a `move_evaluations` blob, and now serves the
 * event log the decision actually produced, in the one order there is.
 * `/api/logs/commands` used to serve raw command rows PLUS a per-turn snapshot
 * of the live broadcast shape; the snapshot is gone, because folding the
 * events through the same reducer the live client runs is a stronger form of
 * the same intent than a second representation of the same state.
 */

const router = express.Router();
const logger = DecisionLogger.getInstance();

// Get list of games with metadata
router.get('/api/logs/games', async (_req, res) => {
  try {
    const games = await logger.getGames();
    res.json(games);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// The per-game board timeline: one canonical settlement per BOARD turn,
// straight out of `turn_boards`. There is no merge and no synthesis — one
// board per turn, stored once, in one turn domain.
// ?sinceTurn= makes the fetch incremental.
router.get('/api/games/:gameId/turns', async (req, res) => {
  try {
    const sinceTurn = req.query.sinceTurn != null
      ? parseInt(req.query.sinceTurn as string, 10)
      : undefined;
    const result = await logger.getTurnTimeline(
      req.params.gameId,
      Number.isFinite(sinceTurn as number) ? sinceTurn : undefined,
    );
    res.json(result);
  } catch (error) {
    console.error('Error building turn timeline:', error);
    res.status(500).json({ error: 'Failed to build turn timeline' });
  }
});

// The intra-turn event log, filtered. The payload of each row is the
// `TurnEvent` verbatim — the same bytes the live client folded — so a client
// reading this and a client reading the websocket run the same reducer over
// the same objects.
router.get('/api/logs', async (req, res) => {
  try {
    const startTurn = req.query.startTurn ? parseInt(req.query.startTurn as string, 10) : undefined;
    const endTurn = req.query.endTurn ? parseInt(req.query.endTurn as string, 10) : undefined;
    const events = await logger.queryLogs({
      gameId: (req.query.game_id as string) || (req.query.gameId as string),
      unitKey: (req.query.unit_key as string) || (req.query.unitKey as string),
      kind: req.query.kind as string,
      startTurn,
      endTurn,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 1000,
      offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
    });
    res.json({ events });
  } catch (error) {
    console.error('Error querying logs:', error);
    res.status(500).json({ error: 'Failed to query logs' });
  }
});

// Command history for one game: every event an operator authored, in
// (turn, seq) order, with the identity that authored it. The per-turn
// command-state snapshot is gone with `command_turn_states` — a client that
// wants the state at a moment folds the events to that `seq`.
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

/**
 * ONE CELL'S TERRITORY, DERIVED ON DEMAND.
 *
 * The whole-board Voronoi ownership grid used to be computed every turn,
 * stored on `turn_states`, shipped on every board update and painted as an
 * overlay. It is deleted (04 §5.3 #14): it answers the PRE-CLUSTER question —
 * which unit could reach this cell first — and it cannot show what a moveset
 * trades between members, which is the only question the lens asks. The
 * ORIENTATION it gave is worth keeping, so it comes back here: the Alt+click
 * inspector asks about the one cell under the pointer, when a human points at
 * it, and the answer is derived from the settlement the turn is stored under
 * rather than shipped ahead of a question nobody asked.
 *
 * `sources`, `owner` and `distance` are the same three fields the deleted
 * per-unit inspection test asserted, in the same units.
 */
router.get('/api/games/:gameId/turns/:turn/territory', async (req, res) => {
  try {
    const turn = parseInt(req.params.turn, 10);
    const x = parseInt(String(req.query.x), 10);
    const y = parseInt(String(req.query.y), 10);
    if (!Number.isFinite(turn) || !Number.isFinite(x) || !Number.isFinite(y)) {
      res.status(400).json({ error: 'turn, x and y are required' });
      return;
    }
    // The LIVE board first: a turn still in play has not been flushed, and an
    // inspector pointing at the board in front of them must not be told the
    // square does not exist yet.
    const live = ActiveGameManager.getInstance().settlementFor(req.params.gameId, turn);
    const settlement = live ?? (await logger.getTurnSettlement(req.params.gameId, turn));
    if (!settlement) {
      res.status(404).json({ error: `no board stored for turn ${turn}` });
      return;
    }
    const board = settlement.board;
    if (x < 0 || x >= board.width || y < 0 || y >= board.height) {
      res.status(400).json({ error: 'cell is off the board' });
      return;
    }
    const ownership = computeTerritoryView(settlement);
    const index = y * ownership.width + x;
    const ownerIndex = ownership.owner[index] ?? OWNER_UNREACHED;
    res.json({
      turn,
      x,
      y,
      owner: ownerIndex >= 0 ? (ownership.sources[ownerIndex] ?? null) : null,
      neutral: ownerIndex === OWNER_NEUTRAL,
      unreached: ownerIndex === OWNER_UNREACHED,
      distance: ownership.distance[index] ?? -1,
      vacatesAt: ownership.vacatesAt[index] ?? 0,
      sources: ownership.sources,
    });
  } catch (error) {
    console.error('Error deriving territory view:', error);
    res.status(500).json({ error: 'Failed to derive the territory view' });
  }
});

// Clear old logs (admin endpoint). Deletes the two HOT classes only: the
// event log and the moveset projection. `turn_boards` and `decisions` are
// retained for the life of the game — they are the re-run input and the
// basis, and a turn whose events have aged out is still inspectable because
// of them. Retention is a latency decision, not a loss.
router.delete('/api/logs/old', async (req, res) => {
  // Mutating admin call → verifiable human action for the awake rule.
  ActivityController.getInstance().recordHumanAction();
  try {
    const daysToKeep = req.query.days ? parseInt(req.query.days as string, 10) : 7;
    await logger.clearOldLogs(daysToKeep);
    await CommandLogger.getInstance().clearOldEvents(daysToKeep);
    res.json({ message: `Cleared hot logs older than ${daysToKeep} days` });
  } catch (error) {
    console.error('Error clearing old logs:', error);
    res.status(500).json({ error: 'Failed to clear old logs' });
  }
});

export default router;
