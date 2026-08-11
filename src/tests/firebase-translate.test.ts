import { Direction } from '../types/battlesnake';
import {
  buildGameState,
  continuationDirection,
  controlledSnakeIDs,
  directionToMoveIndex,
  toApiCoord,
} from '../firebase/translate';
import { TTGameSetup, TTTurn } from '../firebase/tactictoes-types';

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
    playerHealth: { centA: 90, 'centA#2': 80, centB: 70, 'centB#2': 60 },
    startTime: null as any,
    endTime: null as any,
    scores: {},
    alivePlayers: ['centA', 'centA#2', 'centB', 'centB#2'],
    food: [idx(2, 2)],
    hazards: [idx(3, 3)],
    playerPieces: {
      centA: [idx(1, 1), idx(1, 2)],
      'centA#2': [idx(5, 4), idx(5, 3)],
      centB: [idx(3, 1)],
      'centB#2': [idx(2, 4)],
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
  it('matches the engine default: step in the head−neck direction', () => {
    // Head at (3,3), neck at (3,4) in full-board coords (y down): the snake
    // last moved full-board-up, which is api 'up'.
    expect(continuationDirection([idx(3, 3), idx(3, 4)], W)).toBe('up');
    expect(continuationDirection([idx(3, 3), idx(2, 3)], W)).toBe('right');
    expect(continuationDirection([idx(3, 3), idx(4, 3)], W)).toBe('left');
    expect(continuationDirection([idx(3, 3), idx(3, 2)], W)).toBe('down');
  });

  it('returns null when the snake has no direction yet', () => {
    expect(continuationDirection([idx(3, 3)], W)).toBeNull();
    expect(continuationDirection([idx(3, 3), idx(3, 3)], W)).toBeNull(); // stacked spawn
    expect(continuationDirection(undefined, W)).toBeNull();
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
