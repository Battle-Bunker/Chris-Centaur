/**
 * Regression tests for:
 *  1. The fatal-move consent gate: a HUMAN-AUTHORED certain-death move (a
 *     manual selection) stages only with minted consent; without it the bot's
 *     move is staged instead and a confirmation prompt fires. Bot-sourced fatal
 *     moves are exempt, and so are waypoint-sourced ones — since the goto/near
 *     redesign that direction is chosen by the heuristic matrix, not by the
 *     human. The kill-all path carries consent implicitly.
 *  2. The reversal tripwire: any staged move onto the snake's own neck is a
 *     guaranteed 180° self-collision and must log full state.
 */

import { ActiveGameManager, TurnData, MoveEvaluation } from '../server/active-game-manager';
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

  test('exemption: a WAYPOINT-sourced fatal move stages without any prompt or fallback', () => {
    const gameId = 'g-wp-fatal';
    const snakes = [makeSnake('A', { x: 5, y: 5 })];
    // Evaluations where the reversal 'down' both outscores everything AND is the
    // shortest-path step toward a goto target below the snake, so the biased
    // matrix pick lands on it. A goto/near direction is chosen by the heuristic
    // matrix (trapped veto + argmax), not dictated by the human, so the consent
    // gate must not intercept it — asking the operator to confirm a move the BOT
    // picked is exactly the prompt fatigue this narrowing removes.
    const evaluations: MoveEvaluation[] = (['down', 'up', 'left'] as Direction[]).map((move) => ({
      move,
      score: move === 'down' ? 500 : 10,
      numStates: 1,
      breakdown: {
        trapped: 0,
        weights: { gotoProgress: 300, nearProgress: 250 },
        weighted: { gotoProgressScore: 0, nearProgressScore: 0 },
      },
    }));
    const gs = makeGameState(gameId, 0, snakes, 'A');
    mgr.registerGame(gs);
    mgr.updateGameState(gameId, 'A', gs);
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    mgr.setBotRecommendation(gameId, 'A', 'up', { ...makeTurnData(gs, 'up'), moveEvaluations: evaluations });

    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = 'u1';
    expect(mgr.setWaypoint(gameId, 'A', { type: 'green', x: 5, y: 0 }, 'u1')).toBe(true);

    expect(cs.staged?.move).toBe('down');
    expect(cs.staged?.source).toBe('waypoint');
    expect(prompts).toHaveLength(0);
    expect(warnedText()).not.toMatch(/FATAL-MOVE GATE/);
    // The move is still surfaced to the human as certain death by the
    // source-agnostic marker — the gate is narrowed, not the warning.
    expect(mgr.isStagedMoveFatal(gameId, 'A')).toBe(true);
  });
});
