import { Timestamp } from 'firebase/firestore';
import { Direction } from '../types/battlesnake';
import {
  apiCoordToIndex,
  buildGameState,
  continuationDirection,
  controlledSnakeIDs,
  deriveDeathCells,
  directionToMoveIndex,
  parseLatestTurn,
  parseTurn,
  toApiCoord,
} from '../firebase/translate';
import { TTGameSetup, TTGameStateDoc, TTTurn } from '../firebase/tactictoes-types';

// Full board 7x6 (including perimeter walls) -> api board 5x4.
const W = 7;
const H = 6;

const idx = (x: number, y: number) => y * W + x; // full-board coords, y down

function makeSetup(overrides: Partial<TTGameSetup> = {}): TTGameSetup {
  return {
    teams: [
      { id: 'centA', name: 'Reds', color: '#ff0000' },
      { id: 'centB', name: 'Blues', color: '#0000ff' },
    ],
    snakesPerTeam: 2,
    gamePlayers: [
      { id: 'centA', teamID: 'centA', letter: 'A' },
      { id: 'centA#2', teamID: 'centA', letter: 'B' },
      { id: 'centB', teamID: 'centB', letter: 'A' },
      { id: 'centB#2', teamID: 'centB', letter: 'B' },
    ],
    boardWidth: W,
    boardHeight: H,
    maxTurnTime: 10,
    ...overrides,
  };
}

function makeTurn(overrides: Partial<TTTurn> = {}): TTTurn {
  return {
    playerEnergy: { centA: 90, 'centA#2': 80, centB: 70, 'centB#2': 60 },
    startTime: null as any,
    endTime: null as any,
    moves: {},
    // The wire writes the death registry on every turn; empty means nobody died.
    deaths: {},
    alivePlayers: ['centA', 'centA#2', 'centB', 'centB#2'],
    food: [idx(2, 2)],
    hazards: [idx(3, 3)],
    playerPieces: {
      centA: [idx(1, 1), idx(1, 2)],
      'centA#2': [idx(5, 4), idx(5, 3)],
      centB: [idx(3, 1)],
      'centB#2': [idx(2, 4)],
    },
    // Every unit carries an orientation (wire coords, y down): head-minus-neck
    // for the multi-cell snakes, pointed at the centre for the single-cell units.
    orientation: {
      centA: { dx: 0, dy: -1 },
      'centA#2': { dx: 0, dy: 1 },
      centB: { dx: 0, dy: 1 },
      'centB#2': { dx: 0, dy: -1 },
    },
    winners: [],
    ...overrides,
  };
}

describe('toApiCoord', () => {
  it('strips the perimeter and flips the y axis like the TacticToes HTTP notifier', () => {
    // Full-board (1,1) is the top-left playable cell; api y is flipped so it
    // becomes the HIGHEST api y (H - 1 - 2 = 3).
    expect(toApiCoord(idx(1, 1), W, H)).toEqual({ x: 0, y: 3 });
    // Bottom-right playable cell (W-2, H-2) = (5,4) -> api (4, 0).
    expect(toApiCoord(idx(5, 4), W, H)).toEqual({ x: 4, y: 0 });
  });
});

describe('directionToMoveIndex', () => {
  // The invariant that keeps the two coordinate systems glued together:
  // stepping in api coords must land on the same cell as the full-board
  // index the server-compatible converter returns.
  const apiStep = (c: { x: number; y: number }, d: Direction) => {
    switch (d) {
      case 'up': return { x: c.x, y: c.y + 1 };
      case 'down': return { x: c.x, y: c.y - 1 };
      case 'left': return { x: c.x - 1, y: c.y };
      case 'right': return { x: c.x + 1, y: c.y };
    }
  };

  it.each<Direction>(['up', 'down', 'left', 'right'])(
    'agrees with the api-coordinate step for %s',
    (direction) => {
      const head = idx(3, 3); // central cell, all four moves stay on the board
      const moveIndex = directionToMoveIndex(direction, head, W, H);
      expect(toApiCoord(moveIndex, W, H)).toEqual(
        apiStep(toApiCoord(head, W, H), direction)
      );
    }
  );
});

describe('continuationDirection', () => {
  it('matches the engine default: step along the wire orientation', () => {
    // Wire y grows downward, so wire dy -1 is api 'up'.
    const turn = makeTurn({
      orientation: {
        centA: { dx: 0, dy: -1 },
        'centA#2': { dx: 0, dy: 1 },
        centB: { dx: -1, dy: 0 },
        'centB#2': { dx: 1, dy: 0 },
      },
    });
    expect(continuationDirection(turn, 'centA')).toBe('up');
    expect(continuationDirection(turn, 'centA#2')).toBe('down');
    expect(continuationDirection(turn, 'centB')).toBe('left');
    expect(continuationDirection(turn, 'centB#2')).toBe('right');
  });
});

describe('controlledSnakeIDs', () => {
  it('returns the whole team of the given centaur — every gamePlayer with teamID == centaurId', () => {
    expect(controlledSnakeIDs(makeSetup(), 'centA')).toEqual(['centA', 'centA#2']);
    expect(controlledSnakeIDs(makeSetup(), 'centB')).toEqual(['centB', 'centB#2']);
    expect(controlledSnakeIDs(makeSetup(), 'someoneElse')).toEqual([]);
  });
});

describe('buildGameState', () => {
  it('produces a Battlesnake view matching the HTTP payload shape', () => {
    const state = buildGameState('g1', makeSetup(), makeTurn(), 4, 'centA#2', 123456);

    expect(state.turn).toBe(4);
    expect(state.board.width).toBe(W - 2);
    expect(state.board.height).toBe(H - 2);
    expect(state.game.timeout).toBe(10_000);
    expect((state.game as any).turnExpiryTime).toBe(123456);

    // you: the team's second snake, named from team name + letter, with the
    // team colour and flipped body.
    expect(state.you.id).toBe('centA#2');
    expect(state.you.name).toBe('Reds B');
    expect(state.you.letter).toBe('B');
    expect(state.you.health).toBe(80);
    expect(state.you.head).toEqual({ x: 4, y: 0 });
    expect(state.you.body).toEqual([{ x: 4, y: 0 }, { x: 4, y: 1 }]);
    expect(state.you.customizations.color).toBe('#ff0000');
    expect(state.you.teamID).toBe('centA');
    expect(state.you.squad).toBe('centA');

    // Teammates share a colour, opponents differ — that is what the engine's
    // TeamDetector groups by.
    const byId = new Map(state.board.snakes.map((s) => [s.id, s]));
    expect(byId.get('centA')!.customizations.color).toBe('#ff0000');
    expect(byId.get('centA')!.letter).toBe('A');
    expect(byId.get('centA')!.name).toBe('Reds A');
    expect(byId.get('centB')!.customizations.color).toBe('#0000ff');
    expect(byId.get('centB#2')!.customizations.color).toBe('#0000ff');
    expect(byId.get('centB#2')!.name).toBe('Blues B');
    expect(state.board.snakes).toHaveLength(4);

    expect(state.board.food).toEqual([{ x: 1, y: 2 }]);
    expect(state.board.hazards).toEqual([{ x: 2, y: 1 }]);
  });

  it('omits turnExpiryTime when no deadline is supplied', () => {
    const state = buildGameState('g1', makeSetup(), makeTurn(), 0, 'centA', null);
    expect((state.game as any).turnExpiryTime).toBeUndefined();
  });
});

describe('apiCoordToIndex', () => {
  it('is the exact inverse of toApiCoord over every playable cell', () => {
    for (let y = 1; y <= H - 2; y++) {
      for (let x = 1; x <= W - 2; x++) {
        const index = idx(x, y);
        expect(apiCoordToIndex(toApiCoord(index, W, H), W, H)).toBe(index);
      }
    }
  });
});

describe('buildGameState with chess pieces', () => {
  const pieceSetup = () =>
    makeSetup({
      gamePlayers: [
        { id: 'centA', teamID: 'centA', letter: 'A' },
        { id: 'centA#2', teamID: 'centA', letter: 'B', unitType: 'pawn' },
        { id: 'centB', teamID: 'centB', letter: 'A', unitType: 'rook' },
        { id: 'centB#2', teamID: 'centB', letter: 'B' },
      ],
    });

  it('collapses a piece weight-stack to a 1-cell body with length = weight, attaching unitType and orientation', () => {
    const turn = makeTurn({
      playerPieces: {
        centA: [idx(1, 1), idx(1, 2)],
        // Pawn at weight 3: the wire idiom is 3 copies of its single square.
        'centA#2': [idx(5, 4), idx(5, 4), idx(5, 4)],
        centB: [idx(3, 1)],
        'centB#2': [idx(2, 4)],
      },
      orientation: {
        centA: { dx: 0, dy: -1 },
        'centA#2': { dx: -1, dy: 0 },
        centB: { dx: 0, dy: 1 },
        'centB#2': { dx: 0, dy: -1 },
      },
    });
    const state = buildGameState('g1', pieceSetup(), turn, 2, 'centA', null);
    const byId = new Map(state.board.snakes.map((s) => [s.id, s]));

    const pawn = byId.get('centA#2')!;
    expect(pawn.unitType).toBe('pawn');
    expect(pawn.body).toEqual([{ x: 4, y: 0 }]); // stack collapsed to one cell
    expect(pawn.head).toEqual({ x: 4, y: 0 });
    expect(pawn.length).toBe(3); // length = WEIGHT (stack size), not cell count
    // Orientation rides along verbatim (wire convention, y down).
    expect(pawn.orientation).toEqual({ dx: -1, dy: 0 });

    const rook = byId.get('centB')!;
    expect(rook.unitType).toBe('rook');
    expect(rook.body).toEqual([{ x: 2, y: 3 }]);
    expect(rook.length).toBe(1);
    expect(rook.orientation).toEqual({ dx: 0, dy: 1 });

    // Snakes keep their multi-cell body and length = cell count, with the
    // explicit 'snake' unit type attached.
    const snakeA = byId.get('centA')!;
    expect(snakeA.unitType).toBe('snake');
    expect(snakeA.body).toEqual([{ x: 0, y: 3 }, { x: 0, y: 2 }]);
    expect(snakeA.length).toBe(2);
    expect(snakeA.orientation).toEqual({ dx: 0, dy: -1 });
  });

  // Turn.orientation carries an orientation for EVERY unit; translate forwards it
  // verbatim — the UI anchors icon rotation and keyNav on this wire orientation.
  it('every unit carries its wire orientation verbatim', () => {
    const turn = makeTurn({
      playerPieces: {
        centA: [idx(1, 1), idx(1, 2)],
        'centA#2': [idx(5, 4), idx(5, 4), idx(5, 4)],
        centB: [idx(3, 1)],
        'centB#2': [idx(2, 4)],
      },
      orientation: {
        centA: { dx: 0, dy: -1 }, // snake: head-neck direction
        'centA#2': { dx: 1, dy: 0 }, // pawn: rotation-controlled
        centB: { dx: 0, dy: 1 }, // rook: last moved direction
        'centB#2': { dx: -1, dy: 0 }, // snake
      },
    });
    const state = buildGameState('g1', pieceSetup(), turn, 2, 'centA', null);
    const byId = new Map(state.board.snakes.map((s) => [s.id, s]));
    expect(byId.get('centA')!.orientation).toEqual({ dx: 0, dy: -1 });
    expect(byId.get('centA#2')!.orientation).toEqual({ dx: 1, dy: 0 });
    expect(byId.get('centB')!.orientation).toEqual({ dx: 0, dy: 1 });
    expect(byId.get('centB#2')!.orientation).toEqual({ dx: -1, dy: 0 });
  });

  it('turn.unitTypes overrides the setup type (pawn promotion mid-game)', () => {
    const turn = makeTurn({
      unitTypes: { 'centA#2': 'queen' },
    });
    const state = buildGameState('g1', pieceSetup(), turn, 9, 'centA', null);
    const promoted = state.board.snakes.find((s) => s.id === 'centA#2')!;
    expect(promoted.unitType).toBe('queen');
  });
});

describe('maxHealth from setup.maxHealthPerUnit', () => {
  it('attaches the configured per-type max, resolved by CURRENT unit type', () => {
    const setup = makeSetup({
      gamePlayers: [
        { id: 'centA', teamID: 'centA', letter: 'A' },
        { id: 'centA#2', teamID: 'centA', letter: 'B', unitType: 'pawn' },
        { id: 'centB', teamID: 'centB', letter: 'A', unitType: 'rook' },
        { id: 'centB#2', teamID: 'centB', letter: 'B' },
      ],
      maxEnergyPerUnit: { snake: 150, pawn: 30, queen: 80 },
    });
    // centA#2 promoted mid-game: the QUEEN max applies, not the pawn's.
    const turn = makeTurn({ unitTypes: { 'centA#2': 'queen' } });
    const state = buildGameState('g1', setup, turn, 3, 'centA', null);
    const byId = new Map(state.board.snakes.map((s) => [s.id, s]));

    expect(byId.get('centA')!.maxHealth).toBe(150); // snake key
    expect(byId.get('centA#2')!.maxHealth).toBe(80); // current type (queen) wins
    expect(byId.get('centB')!.maxHealth).toBe(100); // rook: key absent -> default
    expect(byId.get('centB#2')!.maxHealth).toBe(150); // implicit snake
    // `you` is built by the same path.
    expect(state.you.maxHealth).toBe(150);
  });

  it('defaults every unit to 100 when the setup carries no maxHealthPerUnit', () => {
    const state = buildGameState('g1', makeSetup(), makeTurn(), 0, 'centA', null);
    for (const snake of state.board.snakes) {
      expect(snake.maxHealth).toBe(100);
    }
  });
});

describe('hazardDamage from setup', () => {
  it('rides on the board verbatim when the setup configures it', () => {
    const state = buildGameState('g1', makeSetup({ hazardDamage: 25 }), makeTurn(), 0, 'centA', null);
    expect(state.board.hazardDamage).toBe(25);
  });

  it('stays absent when the setup omits it — readers default to 100', () => {
    const state = buildGameState('g1', makeSetup(), makeTurn(), 0, 'centA', null);
    expect(state.board.hazardDamage).toBeUndefined();
  });
});

describe('pawnPromotionWeight and maxHealthPerUnit ride on the board for the Simulator', () => {
  it('rides pawnPromotionWeight on the board verbatim when the setup configures it', () => {
    const state = buildGameState('g1', makeSetup({ pawnPromotionWeight: 4 }), makeTurn(), 0, 'centA', null);
    expect(state.board.pawnPromotionWeight).toBe(4);
  });

  it('stays absent when the setup omits pawnPromotionWeight — readers default to DEFAULT_PAWN_PROMOTION_WEIGHT', () => {
    const state = buildGameState('g1', makeSetup(), makeTurn(), 0, 'centA', null);
    expect(state.board.pawnPromotionWeight).toBeUndefined();
  });

  it('rides the FULL maxHealthPerUnit map on the board, including types not currently fielded', () => {
    // A pawns-only setup can still configure the queen's max for the moment a
    // pawn promotes — the map is config, not derived from what is on board.
    const state = buildGameState(
      'g1',
      makeSetup({ maxEnergyPerUnit: { pawn: 100, queen: 30 } }),
      makeTurn(),
      0,
      'centA',
      null
    );
    expect(state.board.maxHealthPerUnit).toEqual({ pawn: 100, queen: 30 });
  });

  it('stays absent when the setup omits maxHealthPerUnit', () => {
    const state = buildGameState('g1', makeSetup(), makeTurn(), 0, 'centA', null);
    expect(state.board.maxHealthPerUnit).toBeUndefined();
  });
});

describe('parseTurn', () => {
  const makeDoc = (turns: TTTurn[]): TTGameStateDoc => ({ setup: makeSetup(), turns });

  it('returns null for a turn number the doc does not have', () => {
    const doc = makeDoc([makeTurn()]);
    expect(parseTurn(doc, 1)).toBeNull();
    expect(parseTurn(doc, -1)).toBeNull();
    expect(parseLatestTurn(makeDoc([]))).toBeNull();
  });

  it('exposes the raw turn, its number and the FULL board dimensions', () => {
    const t0 = makeTurn();
    const t1 = makeTurn({ alivePlayers: ['centA'] });
    const doc = makeDoc([t0, t1]);

    const pt = parseTurn(doc, 0)!;
    expect(pt.turn).toBe(t0);
    expect(pt.turnNumber).toBe(0);
    expect(pt.boardWidth).toBe(W);
    expect(pt.boardHeight).toBe(H);

    const latest = parseLatestTurn(doc)!;
    expect(latest.turn).toBe(t1);
    expect(latest.turnNumber).toBe(1);
  });

  it('isFinal reflects the winners array', () => {
    expect(parseLatestTurn(makeDoc([makeTurn()]))!.isFinal).toBe(false);
    const finalTurn = makeTurn({ winners: [{ playerID: 'centA', score: 10 }] });
    expect(parseLatestTurn(makeDoc([finalTurn]))!.isFinal).toBe(true);
  });

  it('alive() checks alivePlayers membership', () => {
    const pt = parseLatestTurn(makeDoc([makeTurn({ alivePlayers: ['centA', 'centB#2'] })]))!;
    expect(pt.alive('centA')).toBe(true);
    expect(pt.alive('centB#2')).toBe(true);
    expect(pt.alive('centB')).toBe(false);
    expect(pt.alive('nobody')).toBe(false);
  });

  it('appliedMoveIndex()/piecePath() read the authoritative moves/paths maps', () => {
    // A rook that died mid-ray: the wire records its death square in `moves`
    // and a path that ends on that square.
    const deathSquare = idx(3, 1);
    const turn = makeTurn({
      moves: { centB: deathSquare },
      paths: { centB: [idx(2, 1), deathSquare] },
    });
    const pt = parseLatestTurn(makeDoc([turn]))!;
    expect(pt.appliedMoveIndex('centB')).toBe(deathSquare);
    expect(pt.piecePath('centB')).toEqual([idx(2, 1), deathSquare]);
    expect(pt.appliedMoveIndex('ghost')).toBeUndefined();
    expect(pt.piecePath('centA')).toBeUndefined(); // snakes carry no paths entry
    // Malformed doc without moves/paths maps: undefined, never a throw.
    const malformed = parseLatestTurn(
      makeDoc([makeTurn({ moves: undefined as any, paths: undefined })])
    )!;
    expect(malformed.appliedMoveIndex('centA')).toBeUndefined();
    expect(malformed.piecePath('centA')).toBeUndefined();
  });

  it('pieces()/headIndex() read playerPieces, tolerating absent snakes', () => {
    const pt = parseLatestTurn(makeDoc([makeTurn()]))!;
    expect(pt.pieces('centA')).toEqual([idx(1, 1), idx(1, 2)]);
    expect(pt.headIndex('centA')).toBe(idx(1, 1));
    expect(pt.pieces('ghost')).toBeUndefined();
    expect(pt.headIndex('ghost')).toBeUndefined();
    // Malformed doc without playerPieces: undefined, never a throw.
    const malformed = parseLatestTurn(makeDoc([makeTurn({ playerPieces: undefined as any })]))!;
    expect(malformed.headIndex('centA')).toBeUndefined();
  });

  describe('endTimeMs', () => {
    it('returns the server-stamped deadline when endTime is a Timestamp', () => {
      const stamped = makeTurn({ endTime: Timestamp.fromMillis(123_456) });
      const pt = parseLatestTurn(makeDoc([stamped]))!;
      expect(pt.endTimeMs(0)).toBe(123_456);
      expect(pt.endTimeMs(999_999)).toBe(123_456); // fallback ignored when stamped
    });

    it('returns the CALLER-CHOSEN fallback when endTime is missing — the two call-site semantics stay distinct', () => {
      const pt = parseLatestTurn(makeDoc([makeTurn()]))!; // endTime: null
      // Watchdog semantics: 0 = "no deadline known", plain-silence fallback.
      expect(pt.endTimeMs(0)).toBe(0);
      // Turn-processing semantics: assume a near deadline.
      const soon = Date.now() + 10_000;
      expect(pt.endTimeMs(soon)).toBe(soon);
    });
  });
});

/**
 * deriveDeathCells reads the turn's DEATH REGISTRY (`Turn.deaths`) and nothing
 * else. It used to reconstruct a death from the board plus the `moves` map,
 * and to cover pieces only — snakes were left to a direction-derived cell.
 * Both of those are gone: the registry is authoritative, it covers every unit
 * that died, and it is the only thing that can express the two cells no
 * derivation can (a fatal exhaustion halt, and an edge-contest loser that dies
 * without ever leaving its own square).
 */
describe('deriveDeathCells — straight off the death registry', () => {
  // centB is a rook; everyone else is a snake.
  const pieceSetup = () =>
    makeSetup({
      gamePlayers: [
        { id: 'centA', teamID: 'centA', letter: 'A' },
        { id: 'centA#2', teamID: 'centA', letter: 'B' },
        { id: 'centB', teamID: 'centB', letter: 'A', unitType: 'rook' },
        { id: 'centB#2', teamID: 'centB', letter: 'B' },
      ],
    });
  const makeDoc = (turns: TTTurn[]): TTGameStateDoc => ({ setup: pieceSetup(), turns });

  it('maps a piece that died mid-ray to the api cell the registry names', () => {
    // Rook at (3,1) slides toward (5,1) and dies mid-ray on (4,1).
    const deathSquare = idx(4, 1);
    const curr = makeTurn({
      alivePlayers: ['centA', 'centA#2', 'centB#2'],
      playerPieces: {
        centA: [idx(1, 2), idx(1, 1)],
        'centA#2': [idx(5, 3), idx(5, 4)],
        'centB#2': [idx(2, 3)],
      },
      moves: {
        centA: idx(1, 2),
        'centA#2': idx(5, 3),
        centB: deathSquare,
        'centB#2': idx(2, 3),
      },
      deaths: { centB: { cell: deathSquare, subStep: 2, cause: 'contest' } },
      paths: { centB: [deathSquare] },
    });
    const doc = makeDoc([makeTurn(), curr]);
    expect(deriveDeathCells(parseTurn(doc, 1)!)).toEqual({
      centB: toApiCoord(deathSquare, W, H),
    });
  });

  it('covers SNAKES too — the registry is not a pieces-only channel', () => {
    // centA (a snake) walked into the perimeter and died on the wall square.
    const wallSquare = idx(0, 1);
    const curr = makeTurn({
      alivePlayers: ['centA#2', 'centB', 'centB#2'],
      playerPieces: {
        'centA#2': [idx(5, 3), idx(5, 4)],
        centB: [idx(3, 1)],
        'centB#2': [idx(2, 3)],
      },
      moves: { centA: wallSquare, 'centA#2': idx(5, 3), centB: idx(3, 1), 'centB#2': idx(2, 3) },
      deaths: { centA: { cell: wallSquare, subStep: 1, cause: 'wall' } },
    });
    const doc = makeDoc([makeTurn(), curr]);
    expect(deriveDeathCells(parseTurn(doc, 1)!)).toEqual({
      centA: toApiCoord(wallSquare, W, H),
    });
  });

  it('marks a STARVED unit where it halted, which no move direction could say', () => {
    // centA#2 ran out of health part-way and halted on (5,3). It is dead, but
    // it never reached anything a direction from its old head would point at.
    const haltSquare = idx(5, 3);
    const curr = makeTurn({
      alivePlayers: ['centA', 'centB', 'centB#2'],
      playerPieces: { centA: [idx(1, 2), idx(1, 1)], centB: [idx(3, 1)], 'centB#2': [idx(2, 3)] },
      moves: { centA: idx(1, 2), 'centA#2': haltSquare, centB: idx(3, 1), 'centB#2': idx(2, 3) },
      deaths: { 'centA#2': { cell: haltSquare, subStep: 3, cause: 'exhaustion' } },
    });
    const doc = makeDoc([makeTurn(), curr]);
    expect(deriveDeathCells(parseTurn(doc, 1)!)).toEqual({
      'centA#2': toApiCoord(haltSquare, W, H),
    });
  });

  it('marks an EDGE-CONTEST loser on its OWN start square — it never crossed', () => {
    // centB#2 and centA tried to swap; centB#2 lost, fell back, and died on
    // the square it started the sub-step on. Its `moves` entry is that same
    // square, so the transition records no movement at all.
    const ownSquare = idx(2, 4);
    const curr = makeTurn({
      alivePlayers: ['centA', 'centA#2', 'centB'],
      playerPieces: {
        centA: [idx(1, 2), idx(1, 1)],
        'centA#2': [idx(5, 3), idx(5, 4)],
        centB: [idx(3, 1)],
      },
      moves: { centA: idx(1, 2), 'centA#2': idx(5, 3), centB: idx(3, 1), 'centB#2': ownSquare },
      deaths: { 'centB#2': { cell: ownSquare, subStep: 1, cause: 'edge' } },
    });
    const doc = makeDoc([makeTurn(), curr]);
    expect(deriveDeathCells(parseTurn(doc, 1)!)).toEqual({
      'centB#2': toApiCoord(ownSquare, W, H),
    });
  });

  it('reports several deaths from one turn, and nothing at all from a quiet one', () => {
    const curr = makeTurn({
      alivePlayers: ['centA'],
      playerPieces: { centA: [idx(1, 2), idx(1, 1)] },
      deaths: {
        'centA#2': { cell: idx(5, 3), subStep: 1, cause: 'bodyBlock' },
        centB: { cell: idx(4, 1), subStep: 2, cause: 'contest' },
        'centB#2': { cell: idx(2, 3), subStep: 1, cause: 'regicide' },
      },
    });
    const doc = makeDoc([makeTurn(), curr]);
    expect(Object.keys(deriveDeathCells(parseTurn(doc, 1)!)).sort()).toEqual([
      'centA#2', 'centB', 'centB#2',
    ]);

    // A turn where nobody died carries an empty registry and yields nothing.
    expect(deriveDeathCells(parseTurn(makeDoc([makeTurn()]), 0)!)).toEqual({});
  });

  it('tolerates a malformed registry entry rather than inventing a cell', () => {
    const curr = makeTurn({
      // Nothing on the wire should look like this; the guard is against
      // somebody else's JSON, not against the compiler.
      deaths: { centA: undefined as never, centB: { subStep: 1 } as never },
    });
    expect(deriveDeathCells(parseTurn(makeDoc([curr]), 0)!)).toEqual({});
  });
});
