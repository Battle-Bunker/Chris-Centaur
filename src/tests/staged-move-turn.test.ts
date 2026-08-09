/**
 * Regression tests for the StagedMove record under the Firebase write-through
 * model: each snake's next move is bound as one atomic value to its
 * (snakeId, turn), re-derived per-snake each turn, and — the core contract —
 * EVERY staging action is published through the MoveSubmitter so Firebase is
 * the single source of truth for staged moves. There is no commit step: the
 * game server resolves each turn with the last staged move it received.
 */

import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

function makeSnake(id: string, head: Coord, length = 3): Snake {
  const body: Coord[] = [];
  for (let i = 0; i < length; i++) {
    body.push({ x: head.x, y: head.y - i });
  }
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head,
    length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
}

function makeGameState(gameId: string, turn: number, snakes: Snake[], youId: string): GameState {
  const you = snakes.find((s) => s.id === youId)!;
  return {
    game: { id: gameId, ruleset: { name: 'standard', version: '1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
    you,
  };
}

function makeTurnData(gs: GameState, botMove: Direction): TurnData {
  return {
    gameState: gs,
    moveEvaluations: [],
    territoryCells: {},
    safeMoves: ['up', 'down', 'left', 'right'],
    botRecommendation: botMove,
    timestamp: Date.now(),
  };
}

interface Published {
  gameId: string;
  snakeId: string;
  turn: number;
  move: Direction;
  source: string;
}

describe('Staged move (snakeId, turn) tagging and Firebase write-through', () => {
  let mgr: ActiveGameManager;
  let warnSpy: jest.SpyInstance;
  let published: Published[];

  beforeEach(() => {
    jest.useFakeTimers();
    mgr = ActiveGameManager.getInstance();
    published = [];
    mgr.setMoveSubmitter(async (gameId, snakeId, turn, move, source) => {
      published.push({ gameId, snakeId, turn, move, source });
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  function publishedFor(snakeId: string): Published[] {
    return published.filter((p) => p.snakeId === snakeId);
  }

  // Drives the transport side of one snake's turn intake (register + turn data
  // + bot recommendation), the way the Firebase interface feeds the manager.
  function processTurn(gameId: string, snakeId: string, snakes: Snake[], turn: number, botMove: Direction) {
    const gs = makeGameState(gameId, turn, snakes, snakeId);
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has(snakeId)) {
      mgr.registerGame(gs);
    }
    mgr.updateGameState(gameId, snakeId, gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    mgr.setBotRecommendation(gameId, snakeId, botMove, makeTurnData(gs, botMove));
  }

  test('write-through: staging the bot recommendation publishes (turn, move) to Firebase', () => {
    const gameId = 'g-publish';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];

    processTurn(gameId, 'A', snakes, 0, 'right');

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.staged?.move).toBe('right');
    expect(cs.staged?.turn).toBe(0);
    expect(publishedFor('A')).toEqual([
      { gameId, snakeId: 'A', turn: 0, move: 'right', source: 'bot' },
    ]);
  });

  test('write-through: every staging action publishes — manual override, then revert to bot, each land in Firebase', () => {
    const gameId = 'g-restage';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processTurn(gameId, 'A', snakes, 0, 'right');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    // Manual override re-stages and re-publishes.
    mgr.setUserSelection(gameId, 'A', 'left');
    expect(cs.staged?.move).toBe('left');
    expect(cs.staged?.source).toBe('manual');

    // A "go to"-style plan (premove queue) supersedes the manual selection and
    // publishes its first step.
    expect(mgr.setPremoveQueue(gameId, 'A', [{ x: 5, y: 6 }], 'u1')).toBe(true);
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('queue');

    // Cancelling human intervention (clearing the queue → heuristic) re-stages
    // the bot's recommendation and publishes THAT too.
    expect(mgr.setPremoveQueue(gameId, 'A', [], 'u1')).toBe(true);
    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.staged?.move).toBe('right');
    expect(cs.staged?.source).toBe('bot');

    expect(publishedFor('A').map((p) => [p.turn, p.move])).toEqual([
      [0, 'right'],
      [0, 'left'],
      [0, 'up'],
      [0, 'right'],
    ]);
  });

  test('write-through dedupe: re-staging the identical (turn, move) does not publish twice', () => {
    const gameId = 'g-dedupe';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processTurn(gameId, 'A', snakes, 0, 'right');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    mgr.setUserSelection(gameId, 'A', 'right'); // same move, different source
    mgr.setUserSelection(gameId, 'A', 'right');

    expect(publishedFor('A')).toHaveLength(1);
    expect(cs.staged?.source).toBe('manual'); // local mirror still re-tagged
  });

  test('isolation: another snake\'s board-advancing turn never retags or republishes this snake\'s staged move', () => {
    const gameId = 'g-iso';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];

    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'left');
    const csB = mgr.getGame(gameId)!.controlledSnakes.get('B')!;
    expect(csB.staged?.turn).toBe(0);
    const bPublishesBefore = publishedFor('B').length;

    // A advances the shared board to turn 1. B must be untouched: same staged
    // record, no new publish.
    processTurn(gameId, 'A', snakes, 1, 'left');
    expect(csB.staged?.turn).toBe(0);
    expect(publishedFor('B')).toHaveLength(bPublishesBefore);

    // B's own turn-1 intake re-derives and publishes for turn 1.
    processTurn(gameId, 'B', snakes, 1, 'up');
    expect(csB.staged?.turn).toBe(1);
    expect(csB.staged?.move).toBe('up');
    expect(publishedFor('B').slice(-1)[0]).toEqual(
      { gameId, snakeId: 'B', turn: 1, move: 'up', source: 'bot' },
    );
  });

  test('manual is single-turn: a stale manual reverts to heuristic on the snake\'s OWN next turn', () => {
    const gameId = 'g-manual-stale';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];

    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'right');
    mgr.setUserSelection(gameId, 'B', 'left');
    const csB = mgr.getGame(gameId)!.controlledSnakes.get('B')!;
    expect(csB.intent.kind).toBe('manual');
    expect(csB.staged?.move).toBe('left');

    // A advances the board; B still manual (cross-snake isolation).
    processTurn(gameId, 'A', snakes, 1, 'left');
    expect(csB.intent.kind).toBe('manual');

    // B's own turn-1 intake: the turn-0 manual is stale → heuristic, and the
    // new bot move for turn 1 is published.
    processTurn(gameId, 'B', snakes, 1, 'up');
    expect(csB.intent.kind).toBe('heuristic');
    expect(csB.staged?.move).toBe('up');
    expect(csB.staged?.turn).toBe(1);
    expect(publishedFor('B').slice(-1)[0]).toEqual(
      { gameId, snakeId: 'B', turn: 1, move: 'up', source: 'bot' },
    );
  });

  test('same-turn manual staged during the bot compute window stays authoritative over the late bot recommendation', () => {
    const gameId = 'g-manual-race';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];

    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'left');
    processTurn(gameId, 'A', snakes, 1, 'left'); // board now on turn 1

    // The user stages a manual move for B while B's bot decision is still
    // computing (boardStateTurn is already 1).
    const gsB1 = makeGameState(gameId, 1, snakes, 'B');
    mgr.updateGameState(gameId, 'B', gsB1);
    mgr.setUserSelection(gameId, 'B', 'left');

    const csB = mgr.getGame(gameId)!.controlledSnakes.get('B')!;
    expect(csB.staged?.move).toBe('left');
    expect(csB.staged?.turn).toBe(1);

    // The late bot recommendation must NOT displace the same-turn manual, and
    // the identical re-stage is deduped (no extra publish).
    const publishesBefore = publishedFor('B').length;
    mgr.setBotRecommendation(gameId, 'B', 'up', makeTurnData(gsB1, 'up'));
    expect(csB.intent.kind).toBe('manual');
    expect(csB.staged?.move).toBe('left');
    expect(csB.staged?.turn).toBe(1);
    expect(publishedFor('B')).toHaveLength(publishesBefore);
  });

  test('Submit All: commitAllStaged publishes a done-signal per current-turn snake, deduped per turn, skipping stale records', () => {
    const gameId = 'g-commit-all';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];
    const commits: Array<{ snakeId: string; turn: number }> = [];
    mgr.setMoveCommitter(async (_gameId, snakeId, turn) => {
      commits.push({ snakeId, turn });
    });

    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'left');

    // Both snakes staged for turn 0 → both committed, one write each.
    expect(mgr.commitAllStaged(gameId).affected.sort()).toEqual(['A', 'B']);
    expect(commits).toEqual([{ snakeId: 'A', turn: 0 }, { snakeId: 'B', turn: 0 }]);

    // Repeat click: deduped, no further writes.
    expect(mgr.commitAllStaged(gameId).affected).toEqual([]);
    expect(commits).toHaveLength(2);

    // A advances to turn 1; B's staged record is still bound to turn 0 and
    // must be SKIPPED (committing it would mark "done" on a stale decision).
    processTurn(gameId, 'A', snakes, 1, 'up');
    expect(mgr.commitAllStaged(gameId).affected).toEqual(['A']);
    expect(commits[2]).toEqual({ snakeId: 'A', turn: 1 });

    // Committing never touches the staged moves themselves.
    const csA = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(csA.staged?.move).toBe('up');

    mgr.setMoveCommitter(null);
  });

  test('applyResolvedMoves: bookkeeping only — advances the premove queue with the server\'s actual move, publishes nothing new for the resolved turn', () => {
    const gameId = 'g-resolve';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processTurn(gameId, 'A', snakes, 0, 'up');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    // Queue two cells ahead; first step matches the bot's 'up'.
    expect(mgr.setPremoveQueue(gameId, 'A', [{ x: 5, y: 6 }, { x: 5, y: 7 }], 'u1')).toBe(true);
    expect(cs.staged?.move).toBe('up');

    const committed: Array<{ snakeId: string; move: Direction; source: string }> = [];
    mgr.onMoveCommitted((_gameId, snakeId, move, source) => {
      if (_gameId === gameId) committed.push({ snakeId, move, source });
    });

    mgr.applyResolvedMoves(gameId, 0, { A: 'up' });

    // The queue advanced past the consumed cell. No move-committed
    // notification fires here — the double arrow is driven by
    // finalizeTurnMove, which happens earlier.
    expect(cs.intent.kind).toBe('queue');
    expect((cs.intent as { kind: 'queue'; cells: Coord[] }).cells).toEqual([{ x: 5, y: 7 }]);
    expect(committed).toEqual([]);
  });

  test('pipeline: a matching Firebase confirmation ends the publish loop; no republish after the retry interval', () => {
    const gameId = 'g-confirm-match';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processTurn(gameId, 'A', snakes, 0, 'right');
    expect(publishedFor('A')).toHaveLength(1);

    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.confirmedStaged).toEqual({ turn: 0, move: 'right' });

    jest.advanceTimersByTime(3000);
    expect(publishedFor('A')).toHaveLength(1); // no retry needed
  });

  test('pipeline: a mismatched confirmation (stale write won) triggers a republish via the backstop retry', () => {
    const gameId = 'g-confirm-mismatch';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processTurn(gameId, 'A', snakes, 0, 'right');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';
    mgr.setUserSelection(gameId, 'A', 'left');
    expect(publishedFor('A').map((p) => p.move)).toEqual(['right', 'left']);

    // Firebase confirms the OLD write — the requested 'left' is not what is
    // staged. The backstop must clear the in-flight marker and republish.
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
    jest.advanceTimersByTime(1100);
    expect(publishedFor('A').map((p) => p.move)).toEqual(['right', 'left', 'left']);

    // Once the confirmation catches up, the loop stops.
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'left');
    jest.advanceTimersByTime(3000);
    expect(publishedFor('A')).toHaveLength(3);
  });

  test('pipeline: a failed publish is retried by the backstop until confirmed', async () => {
    const gameId = 'g-publish-fail';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];

    let failures = 0;
    mgr.setMoveSubmitter(async (gId, snakeId, turn, move, source) => {
      if (failures < 1) {
        failures++;
        throw new Error('simulated network failure');
      }
      published.push({ gameId: gId, snakeId, turn, move, source });
    });

    processTurn(gameId, 'A', snakes, 0, 'right');
    await Promise.resolve(); // let the rejection handler run
    expect(publishedFor('A')).toHaveLength(0);

    jest.advanceTimersByTime(1100);
    expect(publishedFor('A').map((p) => p.move)).toEqual(['right']);
  });

  test('finalizeTurnMove: fires the move-committed (double arrow) signal with the Firebase-selected move; null means no signal', () => {
    const gameId = 'g-finalize';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];
    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'left');

    const committed: Array<{ snakeId: string; move: Direction; source: string }> = [];
    mgr.onMoveCommitted((gId, snakeId, move, source) => {
      if (gId === gameId) committed.push({ snakeId, move, source });
    });

    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
    mgr.finalizeTurnMove(gameId, 'A', 0, 'right');
    // B had nothing confirmed — no double arrow for it.
    mgr.finalizeTurnMove(gameId, 'B', 0, null);
    // Repeat finalization is a no-op.
    mgr.finalizeTurnMove(gameId, 'A', 0, 'right');

    expect(committed).toEqual([{ snakeId: 'A', move: 'right', source: 'firebase-final' }]);
    const csA = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(csA.finalMove).toEqual({ turn: 0, move: 'right' });
  });
});
