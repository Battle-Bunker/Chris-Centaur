/**
 * The board-timeline merge and the slim decision-row serialization — the two
 * pure halves of the turn_states split. The hybrid-game fixture (old-format
 * rows for early turns, native rows for later turns of the SAME game, as a
 * mid-game deploy produces) is the canonical case: every format branch in the
 * read path must be per-row, never per-game.
 */

import {
  mergeTimelineRows,
  slimGameStateForLog,
  slimSnakeForLog,
} from '../logic/turn-timeline';

function board(turn: number, extra: any = {}) {
  return {
    game: { id: 'g1' },
    turn,
    board: { width: 11, height: 11, food: [], hazards: [], snakes: [{ id: 'A' }] },
    ...extra,
  };
}

describe('mergeTimelineRows', () => {
  test('hybrid game: old-format rows fill the turns native rows do not cover, contiguously', () => {
    // Old format covers board turns 0..2 (per-snake rows, `you` embedded);
    // native covers 2..4 (deploy landed during turn 2, both formats wrote it).
    const synthesized = [0, 1, 2].map((t) => ({
      game_state: { ...board(t), you: { id: 'A', head: { x: 1, y: 1 } } },
      territory: { A: [{ x: 0, y: 0 }] },
      cell_ownership: null,
    }));
    const native = [2, 3, 4].map((t) => ({
      turn: t,
      game_state: board(t, { lastMoves: { A: 'up' } }),
      territory: null,
      cell_ownership: { width: 11 },
    }));

    const merged = mergeTimelineRows(native, synthesized);

    expect(merged.map((r) => r.turn)).toEqual([0, 1, 2, 3, 4]);
    expect(merged.map((r) => r.native)).toEqual([false, false, true, true, true]);
    // The overlap turn prefers the native row.
    expect(merged[2].game_state.lastMoves).toEqual({ A: 'up' });
    // Synthesized rows carry the grids their decision blob had.
    expect(merged[0].territory).toEqual({ A: [{ x: 0, y: 0 }] });
  });

  test('synthesized rows are you-less: the picked snake\'s perspective never leaks into the timeline', () => {
    const merged = mergeTimelineRows([], [
      { game_state: { ...board(5), you: { id: 'B', head: { x: 9, y: 9 } } } },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].game_state.you).toBeUndefined();
    expect(merged[0].game_state.board).toBeDefined();
  });

  test('board-less (slim) and malformed candidates are never board sources; gaps are preserved, order ascending', () => {
    const merged = mergeTimelineRows(
      [
        { turn: 7, game_state: board(7) },
        { turn: 3, game_state: board(3) },
        { turn: 9, game_state: null }, // territory-only native row: not a board source
      ],
      [
        { game_state: { turn: 5, you: { id: 'A' } } }, // slim row — no board
        { game_state: null },
        { game_state: { ...board(1), turn: undefined } },
      ],
    );
    expect(merged.map((r) => r.turn)).toEqual([3, 7]);
  });

  test('empty inputs produce an empty timeline', () => {
    expect(mergeTimelineRows([], [])).toEqual([]);
  });
});

describe('slim decision-row game_state', () => {
  const you = {
    id: 'centA#2',
    name: 'Alpha B',
    latency: '0',
    health: 73,
    body: [{ x: 4, y: 4 }, { x: 4, y: 3 }, { x: 4, y: 2 }],
    head: { x: 4, y: 4 },
    length: 3,
    shout: '',
    squad: 'centA',
    teamID: 'centA',
    letter: 'B',
    customizations: { color: '#ff0000', head: 'default', tail: 'default' },
  };

  test('keeps every field the listing and replay panel read; drops the body and the board', () => {
    const gs = {
      game: { id: 'g1' },
      turn: 12,
      board: { width: 11, height: 11, snakes: [you], food: [] },
      you,
    };
    const slim = slimGameStateForLog(gs);

    // The universal turn key survives (the whole client keys rows on it).
    expect(slim.turn).toBe(12);
    // Everything getGames' game_state->'you' extraction reads survives.
    expect(slim.you).toMatchObject({
      id: 'centA#2',
      name: 'Alpha B',
      health: 73,
      length: 3,
      head: { x: 4, y: 4 },
      squad: 'centA',
      teamID: 'centA',
      letter: 'B',
      customizations: { color: '#ff0000' },
    });
    // The duplication is gone.
    expect(slim.board).toBeUndefined();
    expect(slim.you.body).toBeUndefined();
    expect(slim.game).toBeUndefined();
  });

  test('tolerates absent optional identity fields and null input', () => {
    const bare = slimSnakeForLog({ id: 'x', name: 'X', health: 1, length: 1, head: { x: 0, y: 0 } });
    expect(bare.letter).toBeUndefined();
    expect(bare.teamID).toBeUndefined();
    expect(bare.customizations).toEqual({ color: '' });
    expect(slimSnakeForLog(null)).toBeNull();
    expect(slimGameStateForLog(null)).toEqual({ turn: 0, you: null });
  });
});
