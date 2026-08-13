/**
 * GameRegistry.recordGameEnd — winner capture from the canonical final state.
 *
 * The Firebase interface enriches the canonical final board with a top-level
 * `winners` array ({ playerID, score, teamID, teamName } per winning snake)
 * before calling recordGameEnd. These tests pin the games-table fields
 * (winnerSnakeId / winnerName / endReason) for the finish shapes the engine
 * produces:
 *   (i)  elimination — one team left alive, winners = that team's snakes;
 *   (ii) turn-limit / multi-survivor — several teams still on the board,
 *        winners = the top-scoring team's snakes;
 *   (iii) turn-limit tie — winners spans multiple teams → a draw;
 * plus the legacy standard-engine fallback (no winners array, sole survivor).
 *
 * winnerName must be a DISPLAY name (team name), never a raw team id.
 */

// Capture every insert chain the registry fires instead of touching a DB.
const inserted: any[] = [];
jest.mock('../database/db', () => {
  const chain: any = {};
  chain.values = (v: any) => {
    inserted.push(v);
    return chain;
  };
  chain.onConflictDoNothing = () => chain;
  chain.onConflictDoUpdate = () => chain;
  chain.then = (onOk: any, onErr: any) => Promise.resolve(undefined).then(onOk, onErr);
  chain.catch = (onErr: any) => Promise.resolve(undefined).catch(onErr);
  return {
    db: {
      insert: () => chain,
      execute: async () => ({ rows: [] }),
    },
    pool: { end: async () => {} },
  };
});

import { GameRegistry } from '../logic/game-registry';
import { BoardSnapshot, Snake } from '../types/battlesnake';

function snake(id: string, name: string, teamID: string): Snake {
  return {
    id,
    name,
    latency: '0',
    health: 100,
    body: [{ x: 1, y: 1 }],
    head: { x: 1, y: 1 },
    length: 1,
    shout: '',
    squad: teamID,
    customizations: { color: '#f00', head: 'default', tail: 'default' },
    teamID,
  } as Snake;
}

// Canonical final state as the Firebase interface hands it to recordGameEnd:
// buildBoardState output plus the enriched winners array.
function canonicalFinal(
  gameId: string,
  snakes: Snake[],
  winners: Array<{ playerID: string; score: number; teamID: string | null; teamName: string | null }>
): BoardSnapshot {
  const state: BoardSnapshot = {
    game: {
      id: gameId,
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} as any },
      map: 'standard',
      timeout: 5000,
      source: 'tactictoes-firebase',
    },
    turn: 42,
    board: { width: 11, height: 11, food: [], hazards: [], snakes },
  };
  (state as any).winners = winners;
  return state;
}

const redA = snake('team-red', 'Red Rockets A', 'team-red');
const redB = snake('team-red#2', 'Red Rockets B', 'team-red');
const blueA = snake('team-blue', 'Blue Blazers A', 'team-blue');
const blueB = snake('team-blue#2', 'Blue Blazers B', 'team-blue');

const redWinners = [
  { playerID: 'team-red', score: 5, teamID: 'team-red', teamName: 'Red Rockets' },
  { playerID: 'team-red#2', score: 3, teamID: 'team-red', teamName: 'Red Rockets' },
];

function freshRegistry(): GameRegistry {
  return new (GameRegistry as any)();
}

function lastInsert(): any {
  expect(inserted.length).toBeGreaterThan(0);
  return inserted[inserted.length - 1];
}

beforeEach(() => {
  inserted.length = 0;
});

describe('GameRegistry.recordGameEnd', () => {
  test('elimination finish: winning team recorded with its display name', () => {
    // Only the winning team's snakes remain on the final board.
    const state = canonicalFinal('game-elim', [redA, redB], redWinners);
    freshRegistry().recordGameEnd(state);

    const row = lastInsert();
    expect(row.winnerSnakeId).toBe('team-red');
    expect(row.winnerName).toBe('Red Rockets'); // display name, NOT 'team-red'
    expect(row.endReason).toBe('winner');
    expect(row.finalTurn).toBe(42);
  });

  test('turn-limit finish with multiple survivors: top team wins on score', () => {
    // Both teams still on the board; winners carries only the top team.
    const state = canonicalFinal('game-maxturns', [redA, redB, blueA, blueB], redWinners);
    freshRegistry().recordGameEnd(state);

    const row = lastInsert();
    expect(row.winnerSnakeId).toBe('team-red');
    expect(row.winnerName).toBe('Red Rockets');
    expect(row.endReason).toBe('winner');
  });

  test('turn-limit tie: winners spanning several teams records a draw', () => {
    const tied = [
      ...redWinners,
      { playerID: 'team-blue', score: 4, teamID: 'team-blue', teamName: 'Blue Blazers' },
      { playerID: 'team-blue#2', score: 4, teamID: 'team-blue', teamName: 'Blue Blazers' },
    ];
    const state = canonicalFinal('game-tie', [redA, redB, blueA, blueB], tied);
    freshRegistry().recordGameEnd(state);

    const row = lastInsert();
    expect(row.winnerSnakeId).toBeNull();
    expect(row.winnerName).toBeNull();
    expect(row.endReason).toBe('draw');
  });

  test('empty winners array records a draw', () => {
    const state = canonicalFinal('game-empty', [], []);
    freshRegistry().recordGameEnd(state);

    const row = lastInsert();
    expect(row.winnerSnakeId).toBeNull();
    expect(row.winnerName).toBeNull();
    expect(row.endReason).toBe('draw');
  });

  test('missing teamName falls back to teamID rather than losing the winner', () => {
    const state = canonicalFinal('game-noname', [redA], [
      { playerID: 'team-red', score: 5, teamID: 'team-red', teamName: null },
    ]);
    freshRegistry().recordGameEnd(state);

    const row = lastInsert();
    expect(row.winnerSnakeId).toBe('team-red');
    expect(row.winnerName).toBe('team-red');
    expect(row.endReason).toBe('winner');
  });

  test('standard-engine fallback: no winners array, sole board survivor', () => {
    const state = canonicalFinal('game-legacy', [redA], [] as any);
    delete (state as any).winners;
    freshRegistry().recordGameEnd(state);

    const row = lastInsert();
    expect(row.winnerSnakeId).toBe('team-red');
    expect(row.winnerName).toBe('Red Rockets A');
    expect(row.endReason).toBe('elimination');
  });

  test('recordGameEnd is deduped per game id within a registry instance', () => {
    const registry = freshRegistry();
    const state = canonicalFinal('game-dedupe', [redA, redB], redWinners);
    registry.recordGameEnd(state);
    registry.recordGameEnd(state);
    expect(inserted.length).toBe(1);
  });
});
