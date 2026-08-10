/**
 * Regression tests for the StagedMove record under the Firebase write-through
 * model: each snake's next move is bound as one atomic value to its
 * (snakeId, turn), re-derived per-snake each turn, and — the core contract —
 * EVERY staging action is published through the MoveSubmitter so Firebase is
 * the single source of truth for staged moves. There is no commit step: the
 * game server resolves each turn with the last staged move it received.
 */

import { ActiveGameManager, TurnData, MoveEvaluation } from '../server/active-game-manager';
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

// Per-move evaluations where `best` outscores every other candidate. The goto/
// near re-bias re-scores THESE, so a waypoint intent can only resolve to a move
// when the turn carries evaluations (it is a vote in the matrix, not an
// override).
function makeEvaluations(best: Direction): MoveEvaluation[] {
  return (['up', 'down', 'left', 'right'] as Direction[]).map((move) => ({
    move,
    score: move === best ? 500 : 10,
    numStates: 1,
    breakdown: {
      trapped: 0,
      weights: { gotoProgress: 300, nearProgress: 250 },
      weighted: { gotoProgressScore: 0, nearProgressScore: 0 },
    },
  }));
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

    // A goto target supersedes the manual selection and publishes the move the
    // re-biased matrix picks.
    mgr.setBotRecommendation(gameId, 'A', 'right', {
      ...makeTurnData(makeGameState(gameId, 0, snakes, 'A'), 'right'),
      moveEvaluations: makeEvaluations('up'),
    });
    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 5, y: 9 }, 'u1')).toBe(true);
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('waypoint');

    // Cancelling human intervention (clearing the target → heuristic) re-stages
    // the bot's recommendation and publishes THAT too.
    expect(mgr.setWaypoint(gameId, 'A', null, 'u1')).toBe(true);
    expect(cs.intent.kind).toBe('heuristic');
    expect(cs.staged?.move).toBe('right');
    expect(cs.staged?.source).toBe('bot');

    expect(publishedFor('A').map((p) => [p.turn, p.move])).toEqual([
      [0, 'right'],
      [0, 'left'],
      // The interim setBotRecommendation re-stages the still-active manual
      // 'left' — an unchanged move, so the pipeline dedupes it rather than
      // republishing.
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

  test('Submit All: commits only Firebase-confirmed requests immediately; unconfirmed ones defer until their confirmation lands', () => {
    const gameId = 'g-commit-all';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];
    const commits: Array<{ snakeId: string; turn: number }> = [];
    mgr.setMoveCommitter(async (_gameId, snakeId, turn) => {
      commits.push({ snakeId, turn });
    });

    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'left');
    // Only A's request is confirmed at click time.
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');

    // Both are "affected" (the user's intent covers both), but only A's
    // commit publishes now — committing B before confirmation could freeze a
    // stale move, since commitment is binding under the Firestore rules.
    expect(mgr.commitAllStaged(gameId).affected.sort()).toEqual(['A', 'B']);
    expect(commits).toEqual([{ snakeId: 'A', turn: 0 }]);

    // B's confirmation lands → its deferred commit fires automatically.
    mgr.setConfirmedStagedMove(gameId, 'B', 0, 'left');
    expect(commits).toEqual([{ snakeId: 'A', turn: 0 }, { snakeId: 'B', turn: 0 }]);

    // Repeat click: deduped, no further writes.
    expect(mgr.commitAllStaged(gameId).affected).toEqual([]);
    expect(commits).toHaveLength(2);

    // A advances to turn 1; B's staged record is still bound to turn 0 and
    // must be SKIPPED (committing it would mark "done" on a stale decision).
    processTurn(gameId, 'A', snakes, 1, 'up');
    mgr.setConfirmedStagedMove(gameId, 'A', 1, 'up');
    expect(mgr.commitAllStaged(gameId).affected).toEqual(['A']);
    expect(commits[2]).toEqual({ snakeId: 'A', turn: 1 });

    // Committing never touches the staged moves themselves.
    const csA = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(csA.staged?.move).toBe('up');

    mgr.setMoveCommitter(null);
  });

  test('Submit All: a deferred commit is cancelled when the user stages a different move first', () => {
    const gameId = 'g-commit-cancel';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    const commits: Array<{ snakeId: string; turn: number }> = [];
    mgr.setMoveCommitter(async (_gameId, snakeId, turn) => {
      commits.push({ snakeId, turn });
    });

    processTurn(gameId, 'A', snakes, 0, 'right');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    // Submit All while 'right' is unconfirmed → deferred.
    mgr.commitAllStaged(gameId);
    expect(cs.pendingCommitTurn).toBe(0);

    // The user changes their mind before confirmation — no longer "done".
    mgr.setUserSelection(gameId, 'A', 'left');
    expect(cs.pendingCommitTurn).toBeNull();

    // The old move's confirmation arriving must NOT fire the cancelled commit.
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
    expect(commits).toEqual([]);

    mgr.setMoveCommitter(null);
  });

  test('binding commitment: staging is frozen for a committed turn (no restage, no publish) and thaws on the next turn', () => {
    const gameId = 'g-commit-freeze';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];
    mgr.setMoveCommitter(async () => undefined);

    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'left');
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
    mgr.commitAllStaged(gameId);

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';
    expect(cs.lastCommittedTurn).toBe(0);
    const publishesBefore = publishedFor('A').length;

    // Post-commit manual staging: the Firestore rules would reject the write,
    // so the manager freezes the staged record and publishes nothing.
    mgr.setUserSelection(gameId, 'A', 'up');
    expect(cs.staged?.move).toBe('right');
    expect(publishedFor('A')).toHaveLength(publishesBefore);

    // The next turn thaws staging (B advances the board, then A's own intake).
    processTurn(gameId, 'B', snakes, 1, 'down');
    processTurn(gameId, 'A', snakes, 1, 'down');
    expect(cs.staged?.turn).toBe(1);
    expect(cs.staged?.move).toBe('down');

    mgr.setMoveCommitter(null);
  });

  test('applyResolvedMoves: bookkeeping only — leaves the goto queue alone and publishes nothing new for the resolved turn', () => {
    const gameId = 'g-resolve';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processTurn(gameId, 'A', snakes, 0, 'up');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    // Two queued goto targets, neither of them reached by this move.
    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 5, y: 9 }, 'u1')).toBe(true);
    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 5, y: 10 }, 'u1', true)).toBe(true);
    const publishedBefore = publishedFor('A').length;

    const committed: Array<{ snakeId: string; move: Direction; source: string }> = [];
    mgr.onMoveCommitted((_gameId, snakeId, move, source) => {
      if (_gameId === gameId) committed.push({ snakeId, move, source });
    });

    mgr.applyResolvedMoves(gameId, 0, { A: 'up' });

    // The goto queue is NOT advanced here — arrival is detected from the board
    // in updateGameState, which is authoritative about where the snake actually
    // ended up. No move-committed notification fires here either; the double
    // arrow is driven by finalizeTurnMove, which happens earlier.
    expect(cs.intent.kind).toBe('goto');
    expect((cs.intent as { kind: 'goto'; targets: Coord[] }).targets).toEqual([
      { x: 5, y: 9 },
      { x: 5, y: 10 },
    ]);
    expect(committed).toEqual([]);
    expect(publishedFor('A')).toHaveLength(publishedBefore);
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

  test('hasUnconfirmedRequest: true while a request awaits confirmation, false after it matches or when no request exists', () => {
    const gameId = 'g-unconfirmed';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processTurn(gameId, 'A', snakes, 0, 'right');

    // Request published but not yet confirmed.
    expect(mgr.hasUnconfirmedRequest(gameId, 'A', 0)).toBe(true);
    // A stale confirmation (different move) does not settle it.
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'up');
    expect(mgr.hasUnconfirmedRequest(gameId, 'A', 0)).toBe(true);
    // The matching confirmation settles it.
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
    expect(mgr.hasUnconfirmedRequest(gameId, 'A', 0)).toBe(false);
    // No request exists for other turns / unknown snakes.
    expect(mgr.hasUnconfirmedRequest(gameId, 'A', 5)).toBe(false);
    expect(mgr.hasUnconfirmedRequest(gameId, 'nobody', 0)).toBe(false);
  });

  test('finalizeTurnMove: fires the move-committed (double arrow) signal only for snakes whose Firebase commit was observed', () => {
    const gameId = 'g-finalize';
    const snakes = [makeSnake('A', { x: 5, y: 5 }), makeSnake('B', { x: 8, y: 8 })];
    processTurn(gameId, 'A', snakes, 0, 'right');
    processTurn(gameId, 'B', snakes, 0, 'left');

    const committed: Array<{ snakeId: string; move: Direction; source: string }> = [];
    mgr.onMoveCommitted((gId, snakeId, move, source) => {
      if (gId === gameId) committed.push({ snakeId, move, source });
    });

    // A's commit was observed in moveStatuses with a confirmed staged move.
    mgr.setConfirmedStagedMove(gameId, 'A', 0, 'right');
    mgr.finalizeTurnMove(gameId, 'A', 0, 'right');
    // Repeat finalization is a no-op.
    mgr.finalizeTurnMove(gameId, 'A', 0, 'right');
    // B was never committed on Firebase — the interface never calls
    // finalizeTurnMove for it, so it never gets a double arrow.

    expect(committed).toEqual([{ snakeId: 'A', move: 'right', source: 'firebase-final' }]);
    const csA = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(csA.finalMove).toEqual({ turn: 0, move: 'right' });
    const csB = mgr.getGame(gameId)!.controlledSnakes.get('B')!;
    expect(csB.finalMove).toBeNull();
  });
});
