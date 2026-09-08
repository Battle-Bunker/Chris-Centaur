/**
 * THE INVARIANT: a unit is offered ITS OWN moves.
 *
 * The defect this pins: a knight on the board was offered the four orthogonal
 * neighbours of its square — a snake's move set — because the page enumerated
 * candidates itself whenever the wire's rows were not destination-keyed, and
 * the only enumeration it knew how to write was the snake one.
 *
 * There is now one function that answers "what may this unit be told to do":
 * `ActiveGameManager.getUnitCandidates`, which is `legalStagingCandidates` ⇒
 * the vendored engine's `legalActions`, for whatever unit it was asked about.
 * This test asks it for every kind on the `mixed` roster (snake, pawn, knight,
 * queen) and compares the answer to `legalActions` CELL FOR CELL, in the
 * engine's own full-board indices, plus the action identity each cell carries.
 *
 * If a candidate path ever grows a kind branch again, one of these fails: a
 * knight's eight jumps cannot be mistaken for a snake's four steps, and a
 * queen's rays cannot be mistaken for either.
 */

import { ActiveGameManager } from '../server/active-game-manager';
import { GameState, Snake, Coord } from '../types/battlesnake';
import { apiCoordToIndex } from '../firebase/translate';
import { grammarUnitAt, stagingBoard } from '../logic/staging-legality';
import { legalActions } from '../engine-vendor/engine/queries';
import { makeGameState as makeGameStateBase } from './board-fixtures';
import { MIXED_SCENARIO } from './local-game';

jest.mock('../logic/command-logger', () => {
  const logEvent = jest.fn();
  const logTurnState = jest.fn();
  return { CommandLogger: { getInstance: () => ({ logEvent, logTurnState }) } };
});

// `mixed` is 11x11, so the engine's full board — the perimeter wall included —
// is 13x13. Every index below is a full-board one.
const W = MIXED_SCENARIO.width;
const H = MIXED_SCENARIO.height;
const FULL_W = W + 2;
const FULL_H = H + 2;

function makeUnit(id: string, kind: string, head: Coord): Snake {
  const isPiece = kind !== 'snake';
  const body: Coord[] = isPiece
    ? [head]
    : [head, { x: head.x, y: Math.max(0, head.y - 1) }, { x: head.x, y: Math.max(0, head.y - 2) }];
  const snake: Snake = {
    orientation: { dx: 0, dy: -1 },
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head,
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
  };
  if (isPiece) snake.unitType = kind;
  return snake;
}

// The whole `mixed` roster, one wire unit per scenario unit, ids naming the
// kind so a failure reads as "knight was offered …".
const ROSTER = MIXED_SCENARIO.teams.flatMap((team, t) =>
  team.units.map((u, i) => ({
    id: `${team.id}-${u.kind}-${i}`,
    kind: u.kind,
    head: { x: u.x, y: u.y },
    team: team.id,
    t,
  }))
);

const SNAKES: Snake[] = ROSTER.map((r) => makeUnit(r.id, r.kind, r.head));

function boardState(gameId: string, youId: string): GameState {
  return makeGameStateBase(gameId, 0, SNAKES, youId, {
    game: {
      id: gameId,
      ruleset: { name: 'teamsnek', version: 'v1', settings: {} },
      map: 'standard',
      timeout: 500,
      source: 'test',
    },
    board: {
      width: W,
      height: H,
      food: MIXED_SCENARIO.food.map((f) => ({ x: f.x, y: f.y })),
      hazards: [],
      snakes: SNAKES,
    },
  });
}

describe('a unit is offered its own moves, and the engine says which they are', () => {
  const gameId = 'g-unit-candidates';
  let mgr: ActiveGameManager;

  beforeAll(() => {
    mgr = ActiveGameManager.getInstance();
    for (const r of ROSTER) {
      const gs = boardState(gameId, r.id);
      mgr.registerGame(gs, r.id, { id: r.team, name: r.team, color: '#e53935' });
      mgr.updateBoard(gameId, gs);
    }
  });

  afterAll(() => {
    mgr.setMoveSubmitter(null);
    mgr.setMoveCommitter(null);
  });

  test('the roster covers every kind the defect spanned', () => {
    expect(new Set(ROSTER.map((r) => r.kind))).toEqual(new Set(['snake', 'pawn', 'knight', 'queen']));
  });

  test.each(ROSTER.map((r) => [r.id, r.kind, r.head] as const))(
    '%s (%s) — candidates equal legalActions, cell for cell',
    (id, kind, head) => {
      const gs = boardState(gameId, id);
      const origin = apiCoordToIndex(head, FULL_W, FULL_H);
      const engine = legalActions(
        grammarUnitAt(kind, origin, gs.you.orientation),
        stagingBoard(gs.board)
      );

      // The wire carries a Direction for a trail unit and a destination index
      // for a piece; both name exactly one cell, and this maps the wire's word
      // back to the engine's index so the two lists are comparable without
      // either side re-deriving a rule.
      const offered = mgr.getUnitCandidates(gameId, id);
      const offeredCells = offered
        .map((c) => apiCoordToIndex(c.dest, FULL_W, FULL_H))
        .sort((a, b) => a - b);

      expect(offeredCells).toEqual(engine.map((e) => e.target).sort((a, b) => a - b));
      expect(offered).toHaveLength(engine.length);

      // And the ACTION identity travels with each cell, not just the cell.
      const byCell = new Map(engine.map((e) => [e.target, e.action.kind]));
      for (const c of offered) {
        expect(c.kind).toBe(byCell.get(apiCoordToIndex(c.dest, FULL_W, FULL_H)));
      }
    }
  );

  test('a knight is offered knight cells and never a snake fan', () => {
    const knight = ROSTER.find((r) => r.kind === 'knight')!;
    const head = knight.head;
    const offered = mgr.getUnitCandidates(gameId, knight.id);
    expect(offered.length).toBeGreaterThan(0);
    for (const c of offered) {
      const adx = Math.abs(c.dest.x - head.x);
      const ady = Math.abs(c.dest.y - head.y);
      // Every offered cell is an L-jump or the knight's own square (hold).
      const isJump = (adx === 1 && ady === 2) || (adx === 2 && ady === 1);
      const isHold = adx === 0 && ady === 0;
      expect(isJump || isHold).toBe(true);
      // The orthogonal neighbours — the snake fan the defect drew — are not
      // among them.
      expect(adx + ady).not.toBe(1);
    }
    // The wire word for a piece is its destination index, never a direction.
    expect(offered.every((c) => typeof c.move === 'number')).toBe(true);
  });

  test('a snake is offered its four steps, keyed by the engine action, not by a page table', () => {
    const snake = ROSTER.find((r) => r.kind === 'snake')!;
    const offered = mgr.getUnitCandidates(gameId, snake.id);
    expect(offered.map((c) => c.move).sort()).toEqual(['down', 'left', 'right', 'up']);
    expect(offered.every((c) => c.kind === 'move')).toBe(true);
  });

  test('a queen is offered rays, so the page cannot be indexing a fixed fan', () => {
    const queen = ROSTER.find((r) => r.kind === 'queen')!;
    const offered = mgr.getUnitCandidates(gameId, queen.id);
    // A queen in the open reaches far more than eight cells; a fixed
    // neighbour fan never could.
    expect(offered.length).toBeGreaterThan(8);
    expect(offered.some((c) => c.kind === 'stay')).toBe(true);
  });
});
