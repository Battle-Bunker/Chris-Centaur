/**
 * COMMAND AUTHORITY, ROUND-TRIPPED (docs/design/ux/16-COMMANDS.md §2).
 *
 * `authority` is one number that rides WITH a goto/near command — page →
 * `set-waypoint` → the unit's intent → the progress weight the fold's own
 * re-scoring multiplies. This walks that whole path in one file, because the
 * defect it repairs was precisely a number that existed at one end and was not
 * read at the other.
 *
 * The messages are put through `JSON.parse(JSON.stringify(...))` on purpose:
 * the page sends this payload as JSON text, and a field that survives a call
 * but not an encoding is not on the wire.
 *
 * The last test is the one that must never be deleted: an authority is a
 * LOUDER VOTE, not an override. The certain-fatal veto runs on membership of
 * the candidate pool, before any score is compared, so no multiplier reaches
 * it.
 */

import { ActiveGameManager, TurnData, MoveEvaluation } from '../server/active-game-manager';
import { GameState, Snake, Coord, Direction } from '../types/battlesnake';
import { makeSnakeAt, makeGameState, makeTurnData as makeTurnDataBase } from './board-fixtures';

const userId = 'user-authority';

/** Exactly what `websocket-server`'s `set-waypoint` case does with a message. */
interface WaypointMessage {
  type: 'set-waypoint';
  snakeId: string;
  waypoint: { type: 'green' | 'blue'; x: number; y: number; authority?: unknown } | null;
  append?: boolean;
}

function makeSnake(id: string, head: Coord, length = 3): Snake {
  return makeSnakeAt(id, head, length, { health: 90 });
}

/** Lobster-shaped telemetry rows: `bounds.lo === -Infinity` is the fold's own
 *  DEAD verdict, the single fact the certain-fatal veto reads. */
function makeEvaluations(
  scores: Partial<Record<Direction, number>>,
  fatal: Partial<Record<Direction, boolean>> = {}
): MoveEvaluation[] {
  return (Object.keys(scores) as Direction[]).map((move) => {
    const score = scores[move]!;
    const isFatal = fatal[move] ?? false;
    return {
      move,
      score,
      breakdown: {
        engine: 'lobster',
        profile: 'lobster-territory',
        weights: { material: 10, reach: 1, room: 3, food: 4 },
        weighted: { materialScore: score },
        material: score,
      },
      bounds: isFatal
        ? { lo: Number.NEGATIVE_INFINITY, est: Number.NEGATIVE_INFINITY, hi: Number.NEGATIVE_INFINITY }
        : { lo: score, est: score, hi: score },
    };
  });
}

function makeTurnData(gs: GameState, botMove: Direction, evaluations: MoveEvaluation[]): TurnData {
  return makeTurnDataBase(gs, botMove, { moveEvaluations: evaluations });
}

describe('goto/near authority: page → wire → store → bias', () => {
  let mgr: ActiveGameManager;

  beforeAll(() => {
    mgr = ActiveGameManager.getInstance();
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mgr.setMoveSubmitter(async () => {});
  });

  afterEach(() => {
    mgr.setMoveSubmitter(null);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  /** Drives the transport side of one snake's turn intake and marks it ours. */
  function processMove(
    gameId: string,
    snakes: Snake[],
    turn: number,
    botMove: Direction,
    evaluations: MoveEvaluation[]
  ) {
    const gs = makeGameState(gameId, turn, snakes, 'A');
    const existing = mgr.getGame(gameId);
    if (!existing || !existing.controlledSnakes.has('A')) mgr.registerGame(gs, 'A');
    mgr.recordTurnArrival(gameId, Date.now(), 500, Date.now() + 1_000_000);
    mgr.updateBoard(gameId, gs);
    mgr.setBotRecommendation(gameId, 'A', botMove, makeTurnData(gs, botMove, evaluations));
    const cs = mgr.getGame(gameId)!.controlledSnakes.get('A')!;
    cs.selectedBy = userId;
    return cs;
  }

  /** The handler's own body, over a message that has been through the wire. */
  function deliver(gameId: string, msg: WaypointMessage): boolean {
    const wire = JSON.parse(JSON.stringify(msg)) as WaypointMessage;
    return mgr.setWaypoint(gameId, wire.snakeId, wire.waypoint, userId, wire.append === true);
  }

  test('the authority the page sends is the authority the store holds and the projection shows', () => {
    const gameId = 'wa-roundtrip';
    processMove(gameId, [makeSnake('A', { x: 5, y: 5 })], 1, 'up', makeEvaluations({ up: 5, right: 3 }));

    expect(
      deliver(gameId, {
        type: 'set-waypoint',
        snakeId: 'A',
        waypoint: { type: 'green', x: 8, y: 5, authority: 5 },
      })
    ).toBe(true);

    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toEqual({
      kind: 'goto',
      target: { x: 8, y: 5 },
      authority: 5,
    });
    // And back out to the page, on the same projection the board marker and
    // the goto chip read.
    expect(mgr.getWaypointsForGame(gameId)['A'].authority).toBe(5);
  });

  test('an append re-voices the queue at the authority of the press that extended it', () => {
    const gameId = 'wa-append';
    processMove(gameId, [makeSnake('A', { x: 5, y: 5 })], 1, 'up', makeEvaluations({ up: 5, right: 3 }));

    deliver(gameId, { type: 'set-waypoint', snakeId: 'A', waypoint: { type: 'green', x: 6, y: 5, authority: 2 } });
    deliver(gameId, {
      type: 'set-waypoint',
      snakeId: 'A',
      waypoint: { type: 'green', x: 8, y: 5, authority: 10 },
      append: true,
    });

    const way = mgr.getWaypointsForGame(gameId)['A'];
    expect(way.cells).toEqual([{ x: 6, y: 5 }, { x: 8, y: 5 }]);
    expect(way.authority).toBe(10);
  });

  test('a near target carries its own authority too — one dial, not one per kind', () => {
    const gameId = 'wa-near';
    processMove(gameId, [makeSnake('A', { x: 5, y: 5 })], 1, 'up', makeEvaluations({ up: 5, right: 3 }));

    deliver(gameId, { type: 'set-waypoint', snakeId: 'A', waypoint: { type: 'blue', x: 8, y: 5, authority: 5 } });

    expect(mgr.getActiveWaypointTarget(gameId, 'A')).toEqual({
      kind: 'near',
      target: { x: 8, y: 5 },
      authority: 5,
    });
  });

  test('nonsense from the wire is normalised at the boundary, never propagated', () => {
    const gameId = 'wa-clamp';
    processMove(gameId, [makeSnake('A', { x: 5, y: 5 })], 1, 'up', makeEvaluations({ up: 5, right: 3 }));
    const authorityAfter = (authority: unknown): number => {
      deliver(gameId, { type: 'set-waypoint', snakeId: 'A', waypoint: { type: 'green', x: 8, y: 5, authority } });
      return mgr.getWaypointsForGame(gameId)['A'].authority;
    };

    expect(authorityAfter(undefined)).toBe(1);   // the shipped weight, unchanged
    expect(authorityAfter('loud')).toBe(1);
    expect(authorityAfter(null)).toBe(1);
    expect(authorityAfter(0)).toBe(1);
    expect(authorityAfter(-40)).toBe(1);
    expect(authorityAfter(1e6)).toBe(10);        // the top of the band
    expect(authorityAfter(2.5)).toBe(2.5);       // inside the band, taken as given
  });

  test('×1 loses a lead the weight cannot close; ×10 wins the same position', () => {
    // 'up' leads the on-path 'right' by 6 — more than the whole goto weight
    // (4 × stat ≤ 4), which is the shape of the complaint: a meal one step the
    // other way is worth ~10 in the fold's own material term.
    const evaluations = () => makeEvaluations({ up: 10, right: 4, left: 1 });

    const quiet = 'wa-quiet';
    const csQuiet = processMove(quiet, [makeSnake('A', { x: 5, y: 5 })], 1, 'up', evaluations());
    deliver(quiet, { type: 'set-waypoint', snakeId: 'A', waypoint: { type: 'green', x: 8, y: 5, authority: 1 } });
    expect(csQuiet.staged?.move).toBe('up');

    const loud = 'wa-loud';
    const csLoud = processMove(loud, [makeSnake('A', { x: 5, y: 5 })], 1, 'up', evaluations());
    deliver(loud, { type: 'set-waypoint', snakeId: 'A', waypoint: { type: 'green', x: 8, y: 5, authority: 10 } });
    // 4 + 4 × 10 × 1 = 44 against 'up''s 10: the operator is now audible.
    expect(csLoud.staged?.move).toBe('right');
    expect(csLoud.staged?.source).toBe('waypoint');
  });

  test('NO AUTHORITY BUYS A CERTAIN DEATH — the veto is membership, not magnitude', () => {
    const gameId = 'wa-veto';
    // 'right' is the on-path move and the fold's own worst case reads it DEAD.
    const evaluations = makeEvaluations({ up: 5, right: 3, left: 1 }, { right: true });
    const cs = processMove(gameId, [makeSnake('A', { x: 5, y: 5 })], 1, 'up', evaluations);

    deliver(gameId, { type: 'set-waypoint', snakeId: 'A', waypoint: { type: 'green', x: 8, y: 5, authority: 10 } });

    expect(cs.staged?.move).toBe('up');
    expect(cs.staged?.source).toBe('waypoint');
  });
});
