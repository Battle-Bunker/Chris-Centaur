/**
 * The SCOREBOARD: the units table read as a scoreboard rather than a roster.
 *
 * It is a strict superset of the compact Team | Score | Units table the game
 * server's own frontend shows, so everything that table says must be sayable
 * from here — and everything here has to be portable to a client that has no
 * notion of control or ownership at all.
 *
 * Covers:
 *  - the team header carrying the team's HUMAN name, never its document id;
 *  - the team's SCORE being the summed weight of its LIVING units, exactly as
 *    the game engine computes it;
 *  - unit rows inside a team group being labelled by letter alone;
 *  - dead units staying listed, struck through, and scoring nothing;
 *  - clash inspection: the records a board carries, the collisions they fold
 *    into, and what the panel says about each one.
 */

import { buildBoardState, toApiCoord } from '../firebase/translate';
import { Snake } from '../types/battlesnake';
import { TTGameSetup, TTTurn } from '../firebase/tactictoes-types';

const BoardRenderer = require('../web/board-renderer.js');

function makeContainer() {
  return {
    innerHTML: '',
    addEventListener() { /* the delegated handler registers here */ },
    querySelector: () => ({ title: '' }),
  };
}

/** One unit, named the way the game server names units: "<team> <letter>". */
function unit(
  id: string,
  teamName: string,
  teamID: string,
  letter: string,
  weight: number,
  color: string,
): Snake {
  return {
    id,
    name: `${teamName} ${letter}`,
    teamName,
    teamID,
    letter,
    latency: '0',
    health: 100,
    body: [{ x: 1, y: 1 }],
    head: { x: 1, y: 1 },
    length: weight,
    shout: '',
    squad: teamID,
    orientation: { dx: 0, dy: -1 },
    customizations: { color, head: 'default', tail: 'default' },
    unitType: 'rook',
  };
}

// Two teams whose ids are the opaque 20-character document ids a real game
// carries — the thing the header must NOT print.
const OUR_ID = 'AR2EK3C5BHYDXQMOTENA';
const THEIR_ID = 'ZQ9WM4L2VBKDNRXPTUCF';

const ourA = unit('a', 'Chris', OUR_ID, 'A', 5, '#4CAF50');
const ourB = unit('b', 'Chris', OUR_ID, 'B', 3, '#4CAF50');
const ourC = unit('c', 'Chris', OUR_ID, 'C', 9, '#4CAF50');
const theirA = unit('x', 'Alice', THEIR_ID, 'A', 4, '#e57373');

function render(snakes: Snake[], opts: Record<string, unknown> = {}) {
  const c = makeContainer();
  BoardRenderer.renderSnakeInfo(
    c, { turn: 6, board: { width: 11, height: 11, snakes } }, 'a',
    { groupByTeam: true, ...opts },
  );
  return c.innerHTML;
}

describe('scoreboard: team identity', () => {
  test('the header names the team, it does not print its document id', () => {
    const html = render([ourA, theirA]);
    expect(html).toContain('>Chris<');
    expect(html).toContain('>Alice<');
    expect(html).not.toContain(OUR_ID);
    expect(html).not.toContain(THEIR_ID);
  });

  test('a log predating the teamName field recovers the name from the unit label', () => {
    // "Chris A" minus the letter is the team's name — the naming rule the
    // game server applies, run backwards.
    const legacy = { ...ourA, teamName: undefined } as Snake;
    expect(BoardRenderer.teamDisplayName(legacy)).toBe('Chris');
  });

  test('with no name anywhere the raw id is SHORTENED, never printed whole', () => {
    const nameless = {
      ...ourA, teamName: undefined, name: '', letter: '',
    } as unknown as Snake;
    const shown = BoardRenderer.teamDisplayName(nameless);
    expect(shown).not.toBe(OUR_ID);
    expect(shown.length).toBeLessThan(OUR_ID.length);
    expect(OUR_ID.startsWith(shown.replace('…', ''))).toBe(true);
  });

  test('the "our team" marker is a separate span, so a spectator loses only it', () => {
    const html = render([ourA, theirA]);
    expect(html).toContain('<span class="team-group-ours">(our team)</span>');
    // Exactly one team is ours.
    expect(html.match(/team-group-ours/g)).toHaveLength(1);
  });

  test('the team colour swatch survives the rewrite', () => {
    expect(render([ourA])).toContain('class="team-group-swatch" style="background-color:#4CAF50;"');
  });
});

describe('scoreboard: team score', () => {
  test('the score is the summed weight of the team’s living units', () => {
    const html = render([ourA, ourB, ourC, theirA]);
    expect(html).toContain('data-team-score="17"'); // 5 + 3 + 9
    expect(html).toContain('data-team-score="4"');
  });

  test('a dead unit stays listed but scores nothing', () => {
    // C is gone from the board; the roster still remembers it.
    const html = render([ourA, ourB], { deadSnakes: [ourC] });
    expect(html).toContain('data-team-score="8"'); // 5 + 3, not 17
    expect(html).toContain('data-copy-id="c"');
  });

  test('a dead unit’s row is struck through and marked dead', () => {
    const html = render([ourA], { deadSnakes: [ourC] });
    expect(html).toContain('text-decoration:line-through;');
    expect(html).toContain('(dead)');
  });

  test('the score helper matches the engine rule directly', () => {
    expect(BoardRenderer.teamScore([ourA, ourB, ourC], new Set(['c']))).toBe(8);
    expect(BoardRenderer.teamScore([], new Set())).toBe(0);
    // Weight is the unit-generic size stat: a piece’s stack, a snake’s body.
    expect(BoardRenderer.unitWeight({ body: [1, 2, 3, 4] })).toBe(4);
    expect(BoardRenderer.unitWeight({ length: 7, body: [1] })).toBe(7);
  });
});

describe('scoreboard: unit rows', () => {
  test('inside a team group a row is labelled by its letter alone', () => {
    const html = render([ourA, ourB]);
    expect(html).toContain('class="snake-name">A (You)');
    expect(html).toContain('class="snake-name">B<');
    // The team's name is the heading's job, not every row's.
    expect(html).not.toContain('Chris A');
  });

  test('ungrouped rendering keeps the full name — there is no heading to lean on', () => {
    const c = makeContainer();
    BoardRenderer.renderSnakeInfo(c, { turn: 6, board: { snakes: [ourA] } }, 'a', {});
    expect(c.innerHTML).toContain('Chris A');
  });

  test('the per-row id control and the health/weight stats are untouched', () => {
    const html = render([ourA]);
    expect(html).toContain('data-copy-id="a"');
    expect(html).toContain('title="Weight"');
    expect(html).toContain('title="Health"');
  });
});

// ── Clash inspection ───────────────────────────────────────────────────────

// One record per cell per event. (4,4) carries TWO events — a contest on
// sub-step 3 and a wall death on sub-step 1 — and (4,5) carries a third. The
// dead unit's other body cells are NOT marked: a kill is one record, on the
// cell it happened on.
const clashBoard = {
  width: 11,
  height: 11,
  snakes: [ourA, theirA],
  clashes: [
    {
      cell: { x: 4, y: 4 }, subStep: 3, kind: 'contest',
      playerIDs: ['b', 'x'], victimIDs: ['b'], survivorID: 'x',
      reason: 'Outweighed',
    },
    {
      cell: { x: 4, y: 5 }, subStep: 3, kind: 'sever',
      playerIDs: ['b', 'x'], victimIDs: [], survivorID: 'x',
      reason: 'Body severed by a higher tier',
    },
    {
      cell: { x: 4, y: 4 }, subStep: 1, kind: 'wall',
      playerIDs: ['c'], victimIDs: ['c'],
      reason: 'Hit the wall',
    },
  ],
};

describe('clash inspection', () => {
  test('a cell answers with every record that marks it', () => {
    expect(BoardRenderer.clashesAtCell(clashBoard, { x: 4, y: 4 })).toHaveLength(2);
    expect(BoardRenderer.clashesAtCell(clashBoard, { x: 0, y: 0 })).toHaveLength(0);
    expect(BoardRenderer.clashesAtCell({ snakes: [] }, { x: 4, y: 4 })).toEqual([]);
  });

  // INVERTED (was: "records differing only in which body cell they mark are
  // ONE collision"). The wire no longer writes a record per body cell of the
  // dead, so there is nothing to fold: every record IS an event, and two
  // records on one cell are two things that happened there.
  test('one record per cell per event — the fold is now the identity', () => {
    const all = BoardRenderer.boardClashes(clashBoard);
    expect(BoardRenderer.distinctClashes(all)).toHaveLength(3);
  });

  test('an exact duplicate is still swallowed, and REASON never identifies an event', () => {
    // Two genuinely different events that happen to share display text stay
    // two events; a byte-identical repeat collapses.
    const sameWords = [
      { cell: { x: 1, y: 1 }, subStep: 1, kind: 'contest', playerIDs: ['a', 'b'], victimIDs: ['a'], reason: 'Outweighed' },
      { cell: { x: 1, y: 1 }, subStep: 4, kind: 'contest', playerIDs: ['c', 'd'], victimIDs: ['c'], reason: 'Outweighed' },
      { cell: { x: 1, y: 1 }, subStep: 4, kind: 'contest', playerIDs: ['c', 'd'], victimIDs: ['c'], reason: 'Outweighed' },
    ];
    expect(BoardRenderer.distinctClashes(sameWords)).toHaveLength(2);
  });

  test('every clash cell is marked, so a survivor’s square is inspectable too', () => {
    expect([...BoardRenderer.clashCellKeys(clashBoard)].sort()).toEqual(['4,4', '4,5']);
  });

  test('the panel gives the reason, the sub-step and the participants', () => {
    const html = BoardRenderer.renderClashDetails(clashBoard, { x: 4, y: 4 }, {
      knownSnakes: [ourB, ourC],
    });
    expect(html).toContain('Clash at (4, 4)');
    expect(html).toContain('Outweighed');
    expect(html).toContain('sub-step 3');
    expect(html).toContain('Hit the wall');
    expect(html).toContain('sub-step 1');
    // Participants read as "<team> <letter>".
    expect(html).toContain('Chris B');
    expect(html).toContain('Alice A');
  });

  // INVERTED (was: "who died is READ OFF THE BOARD, not off the record"). The
  // board can no longer answer it: under frozen state a dead unit stays put as
  // a collision object for the rest of the turn, and a unit killed in an
  // earlier event can appear as a participant in a later one. `victimIDs` is
  // the server's own answer, per event.
  test('who died is READ OFF THE RECORD, not off the board', () => {
    const html = BoardRenderer.renderClashDetails(clashBoard, { x: 4, y: 4 }, {
      knownSnakes: [ourB, ourC],
    });
    expect(html).toMatch(/Chris B<\/span><span class="clash-outcome died"/);
    expect(html).toMatch(/Alice A<\/span><span class="clash-outcome survived"/);
  });

  test('a SEVER names no victim: the owner is cut, not killed, and reads as surviving', () => {
    const html = BoardRenderer.renderClashDetails(clashBoard, { x: 4, y: 5 }, {
      knownSnakes: [ourB, ourC],
    });
    expect(html).not.toContain('clash-outcome died');
    expect(html).toContain('Body severed by a higher tier');
  });

  test('a victim still standing on the board is reported dead anyway', () => {
    // `x` is alive on `clashBoard`, but this record says it died HERE — the
    // record wins, which is the whole point of reading victimIDs.
    const frozen = {
      snakes: [ourA, theirA],
      clashes: [{
        cell: { x: 2, y: 2 }, subStep: 2, kind: 'contest',
        playerIDs: ['a', 'x'], victimIDs: ['x'], survivorID: 'a',
        reason: 'Outweighed',
      }],
    };
    const html = BoardRenderer.renderClashDetails(frozen, { x: 2, y: 2 }, {});
    expect(html).toMatch(/Alice A<\/span><span class="clash-outcome died"/);
    expect(html).toMatch(/Chris A<\/span><span class="clash-outcome survived"/);
  });

  test('a cell with no clash renders nothing at all, which is how the panel stays shut', () => {
    expect(BoardRenderer.renderClashDetails(clashBoard, { x: 9, y: 9 }, {})).toBe('');
    expect(BoardRenderer.renderClashDetails({ snakes: [] }, { x: 1, y: 1 }, {})).toBe('');
  });

  test('a reason the server wrote cannot inject markup', () => {
    const hostile = {
      snakes: [],
      clashes: [{
        cell: { x: 1, y: 1 }, subStep: 1, kind: 'self',
        playerIDs: ['q'], victimIDs: ['q'], reason: '<img src=x onerror=1>',
      }],
    };
    const html = BoardRenderer.renderClashDetails(hostile, { x: 1, y: 1 }, {});
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).not.toContain('<img');
  });
});

// ── The wire ───────────────────────────────────────────────────────────────

describe('clashes and team names on the wire', () => {
  const setup: TTGameSetup = {
    teams: [
      { id: OUR_ID, name: 'Chris', color: '#4CAF50' },
      { id: THEIR_ID, name: 'Alice', color: '#e57373' },
    ],
    snakesPerTeam: 1,
    gamePlayers: [
      { id: 'p1', teamID: OUR_ID, letter: 'A', unitType: 'rook' },
      { id: 'p2', teamID: THEIR_ID, letter: 'A', unitType: 'rook' },
    ],
    boardWidth: 7,
    boardHeight: 7,
    maxTurnTime: 10,
  };

  function turnWith(clashes: TTTurn['clashes']): TTTurn {
    return {
      playerHealth: { p1: 100, p2: 100 },
      startTime: null as never,
      endTime: null as never,
      alivePlayers: ['p1', 'p2'],
      food: [],
      hazards: [],
      playerPieces: { p1: [8, 8, 8], p2: [16, 16] },
      moves: {},
      deaths: {},
      winners: [],
      unitTypes: { p1: 'rook', p2: 'rook' },
      orientation: { p1: { dx: 0, dy: -1 }, p2: { dx: 0, dy: 1 } },
      clashes,
    };
  }

  test('the team NAME rides on every unit, so no client has to guess it', () => {
    const board = buildBoardState('g', setup, turnWith([]), 4, null).board;
    expect(board.snakes.map((s) => s.teamName)).toEqual(['Chris', 'Alice']);
  });

  test('clashes arrive in the renderer’s coordinates — kind, victims, survivor and all', () => {
    const board = buildBoardState('g', setup, turnWith([
      {
        index: 16, subStep: 2, kind: 'contest',
        playerIDs: ['p1', 'p2'], victimIDs: ['p2'], survivorID: 'p1',
        reason: 'Outweighed',
      },
    ]), 4, null).board;
    expect(board.clashes).toEqual([
      {
        cell: toApiCoord(16, 7, 7),
        subStep: 2,
        kind: 'contest',
        playerIDs: ['p1', 'p2'],
        victimIDs: ['p2'],
        survivorID: 'p1',
        reason: 'Outweighed',
      },
    ]);
  });

  test('every ClashKind rides through verbatim, regicide included', () => {
    const kinds = [
      'contest', 'edge', 'bodyBlock', 'sever', 'hazard',
      'starvation', 'wall', 'self', 'regicide',
    ] as const;
    const board = buildBoardState('g', setup, turnWith(
      kinds.map((kind, i) => ({
        index: 16 + i, subStep: 1, kind,
        playerIDs: ['p1'], victimIDs: kind === 'sever' ? [] : ['p1'],
        reason: `display text for ${kind}`,
      }))
    ), 4, null).board;
    expect(board.clashes!.map((c) => c.kind)).toEqual([...kinds]);
    // Regicide is a whole-team removal the engine dates at the turn's last
    // sub-step; it maps like any other event, with its victim named.
    const regicide = board.clashes!.find((c) => c.kind === 'regicide')!;
    expect(regicide.victimIDs).toEqual(['p1']);
    expect(regicide.cell).toEqual(toApiCoord(16 + 8, 7, 7));
  });

  test('a survivorless record simply carries no survivorID', () => {
    // Two units annihilating each other: nobody is left standing, so the
    // server withdraws the field rather than naming a unit that did not
    // outlive the record.
    const board = buildBoardState('g', setup, turnWith([
      {
        index: 16, subStep: 1, kind: 'contest',
        playerIDs: ['p1', 'p2'], victimIDs: ['p1', 'p2'],
        reason: 'Deadlock: no unique survivor',
      },
    ]), 4, null).board;
    expect(board.clashes![0]).not.toHaveProperty('survivorID');
    expect(board.clashes![0].victimIDs).toEqual(['p1', 'p2']);
  });

  test('a turn with no collisions carries no clash field at all', () => {
    expect(buildBoardState('g', setup, turnWith([]), 4, null).board.clashes).toBeUndefined();
    const noField = turnWith([]);
    delete noField.clashes;
    expect(buildBoardState('g', setup, noField, 4, null).board.clashes).toBeUndefined();
  });

  // INVERTED (was: "a snake-game clash keeps its missing sub-step missing").
  // Snake-only games run the same unified engine now, so every record is
  // dated — a whole-move unit records sub-step 1. A record from an older
  // document with no sub-step at all is normalised to 1 rather than reaching
  // the renderer undated.
  test('every clash is dated: a whole-move unit records sub-step 1', () => {
    const board = buildBoardState('g', setup, turnWith([
      { index: 16, subStep: 1, kind: 'starvation', playerIDs: ['p1'], victimIDs: ['p1'], reason: 'Ran out of health' },
    ]), 4, null).board;
    expect(board.clashes![0].subStep).toBe(1);

    const legacy = turnWith([
      { index: 16, kind: 'wall', playerIDs: ['p1'], victimIDs: ['p1'], reason: 'Hit the wall' } as never,
    ]);
    expect(buildBoardState('g', setup, legacy, 4, null).board.clashes![0].subStep).toBe(1);
  });

  test('severed cells ride onto the board in api coords, keyed by unit', () => {
    const turn = turnWith([]);
    turn.severedCells = { p1: [16, 17] };
    const board = buildBoardState('g', setup, turn, 4, null).board;
    expect(board.severedCells).toEqual({
      p1: [toApiCoord(16, 7, 7), toApiCoord(17, 7, 7)],
    });
    // No sever, no field.
    expect(buildBoardState('g', setup, turnWith([]), 4, null).board.severedCells).toBeUndefined();
  });
});
