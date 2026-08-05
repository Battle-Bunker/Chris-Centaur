/**
 * Regression tests for:
 *  1. The 180° neck-reversal root cause: a premove queue / goto route whose
 *     first cell is the snake's just-vacated neck must never derive a move
 *     (adjacency alone is not validity), and the queue HOLD tolerance must not
 *     retain a cell the snake is moving away from.
 *  2. The fatal-move consent gate: a HUMAN-sourced certain-death move (manual /
 *     queue / waypoint) stages only with minted consent; without it the bot's
 *     move is staged instead and a confirmation prompt fires. Bot-sourced fatal
 *     moves are exempt. The kill-all path carries consent implicitly.
 */

import { ActiveGameManager, TurnData } from '../server/active-game-manager';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';

// Body extends straight DOWN from the head: body[1] (the neck) is at
// (head.x, head.y - 1), so 'down' is always a 180° reversal / certain death.
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

describe('Fatal-move consent gate + neck-reversal guards', () => {
  let mgr: ActiveGameManager;
  let warnSpy: jest.SpyInstance;
  let prompts: Array<{ gameId: string; snakeId: string; move: Direction; turn: number }>;
  let published: Array<{ snakeId: string; turn: number; move: Direction; source: string }>;

  beforeAll(() => {
    mgr = ActiveGameManager.getInstance();
    prompts = [];
    mgr.onFatalConfirmationNeeded((gameId, snakeId, move, turn) => {
      prompts.push({ gameId, snakeId, move, turn });
    });
  });

  beforeEach(() => {
    jest.useFakeTimers();
    prompts.length = 0;
    published = [];
    mgr.setMoveSubmitter(async (_gameId, snakeId, turn, move, source) => {
      published.push({ snakeId, turn, move, source });
    });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  function warnedText(): string {
    return warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
  }

  // Drives the transport side of one snake's turn intake, the way the
  // Firebase interface feeds the manager.
  function processMove(gameId: string, snakeId: string, snakes: Snake[], turn: number, botMove: Direction) {
    const gs = makeGameState(gameId, turn, snakes, snakeId);
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has(snakeId)) {
      mgr.registerGame(gs);
    }
    mgr.updateGameState(gameId, snakeId, gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    mgr.setBotRecommendation(gameId, snakeId, botMove, makeTurnData(gs, botMove));
  }

  test('gate: an unconsented manual certain-death move stages the bot move instead and prompts once', () => {
    const gameId = 'g-gate';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, 'A', snakes, 0, 'up');

    // 'down' walks the head onto the neck at (5,4) — certain death.
    mgr.setUserSelection(gameId, 'A', 'down');

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('bot');
    expect(warnedText()).toMatch(/FATAL-MOVE GATE/);
    expect(prompts).toEqual([{ gameId, snakeId: 'A', move: 'down', turn: 0 }]);

    // Re-staging the same blocked move within the turn must not re-prompt.
    mgr.setUserSelection(gameId, 'A', 'down');
    expect(prompts).toHaveLength(1);
  });

  test('gate: confirmFatalMove re-validates, mints consent, and stages the fatal move as manual', () => {
    const gameId = 'g-confirm';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, 'A', snakes, 0, 'up');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    mgr.setUserSelection(gameId, 'A', 'down');
    expect(cs.staged?.move).toBe('up'); // blocked → bot fallback

    // Wrong user → rejected.
    expect(mgr.confirmFatalMove(gameId, 'A', 'down', 'intruder')).toBe(false);
    expect(cs.staged?.move).toBe('up');

    // Controlling user confirms → consented manual staged.
    expect(mgr.confirmFatalMove(gameId, 'A', 'down', 'u1')).toBe(true);
    expect(cs.staged?.move).toBe('down');
    expect(cs.staged?.source).toBe('manual');
    // The consented reversal also trips the permanent tripwire log.
    expect(warnedText()).toMatch(/REVERSAL TRIPWIRE/);

    // And the consented move is what write-through published to Firebase
    // verbatim (pure passthrough — never rewritten).
    expect(published[published.length - 1]).toEqual({ snakeId: 'A', turn: 0, move: 'down', source: 'manual' });
  });

  test('exemption: a BOT-sourced fatal move stages without any prompt or fallback', () => {
    const gameId = 'g-bot-fatal';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // The bot itself recommends the reversal (no better alternative exists).
    processMove(gameId, 'A', snakes, 0, 'down');

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.staged?.move).toBe('down');
    expect(cs.staged?.source).toBe('bot');
    expect(prompts).toHaveLength(0);
    expect(warnedText()).not.toMatch(/FATAL-MOVE GATE/);
  });

  test('kill-all: the suicide path stages with implicit consent and publishes its deliberate death move', () => {
    const gameId = 'g-suicide';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, 'A', snakes, 0, 'up');

    const result = mgr.suicideAllSnakes(gameId);
    expect(result.affected).toContain('A');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    expect(cs.staged?.source).toBe('manual');
    // The suicide move must be certain death — for this snake that is 'down'
    // (onto the neck). Whatever computeSuicideMove picks, it must NOT have
    // been swapped for the bot's 'up' by the gate, and it must be the move
    // write-through published to Firebase.
    expect(cs.staged?.move).not.toBe('up');
    expect(published[published.length - 1]).toEqual({
      snakeId: 'A', turn: 0, move: cs.staged?.move, source: 'manual',
    });
    expect(prompts).toHaveLength(0);
  });

  test('neck guard: a queue whose first cell is the just-vacated neck derives NO move (falls back to bot)', () => {
    const gameId = 'g-queue-neck';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, 'A', snakes, 0, 'up');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    // Queue head = (5,4) = the neck. Adjacent to the head, so the old code
    // derived a perfect 180° reversal from it.
    expect(mgr.setPremoveQueue(gameId, 'A', [{ x: 5, y: 4 }], 'u1')).toBe(true);
    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('bot');
    expect(warnedText()).toMatch(/Stale premove queue .* just-vacated neck/);
    // The neck guard fires before the fatal gate, so no confirmation prompt.
    expect(prompts).toHaveLength(0);
  });

  test('turn-72 pattern: a queue cell equal to the current head is cleared at commit, not HELD into a next-turn reversal', () => {
    const gameId = 'g-hold-backwards';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    processMove(gameId, 'A', snakes, 0, 'up');
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';

    // Queue head = the CURRENT head cell (5,5): directionFromTo(head, cells[0])
    // is null, so the bot's 'up' stages. The old HOLD branch then retained
    // (5,5) because it is adjacent to the projected head (5,6) — and next turn
    // (head at (5,6), neck at (5,5)) it derived 'down': the exact reversal that
    // killed snake #mepf2x on turn 72 of game qBLZZS36mve52yHabN3G.
    expect(mgr.setPremoveQueue(gameId, 'A', [{ x: 5, y: 5 }], 'u1')).toBe(true);
    expect(cs.staged?.move).toBe('up'); // queue unresolvable → bot

    // The server resolved the turn with 'up' → queue advancement bookkeeping.
    mgr.applyResolvedMoves(gameId, 0, { A: 'up' });

    // The backwards-pointing plan must be CLEARED, not held.
    expect(cs.intent.kind).toBe('heuristic');
  });
});
