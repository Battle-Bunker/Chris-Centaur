import {
  PLAYER_PALETTE,
  RESERVED_BOARD_COLORS,
  NEUTRAL_BOARD_COLORS,
  colorForArrivalIndex,
} from '../shared/player-palette';
import { ActiveGameManager } from '../server/active-game-manager';
import { BoardSnapshot, Snake } from '../types/battlesnake';

jest.mock('../logic/command-logger', () => ({
  CommandLogger: { getInstance: () => ({ logEvent: jest.fn(), logTurnState: jest.fn() }) },
}));

// ---------------------------------------------------------------------------
// Colour maths. OKLab is the space the palette was designed in: Euclidean
// distance there tracks "how different do these look" far better than RGB or
// HSL, and OKLCH hue is what says "these are the same colour, one is just
// lighter" — the failure mode the ordering rule exists to prevent.
// ---------------------------------------------------------------------------
function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function toOklab(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const R = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const G = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const B = srgbToLinear(parseInt(h.slice(4, 6), 16));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toOklab(a);
  const [l2, a2, b2] = toOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function lightness(hex: string): number {
  return toOklab(hex)[0];
}

function chroma(hex: string): number {
  const [, a, b] = toOklab(hex);
  return Math.hypot(a, b);
}

function hue(hex: string): number {
  const [, a, b] = toOklab(hex);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b)) % 360;
  return d > 180 ? 360 - d : d;
}

describe('player palette — ordering and distinctness', () => {
  it('is a fixed, ordered list of at least 12 unique hex colours', () => {
    expect(PLAYER_PALETTE.length).toBeGreaterThanOrEqual(12);
    for (const c of PLAYER_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(PLAYER_PALETTE).size).toBe(PLAYER_PALETTE.length);
  });

  it('clears every reserved board colour', () => {
    // 0.12 OKLab is roughly "nobody would call these the same colour" at the
    // sizes the board draws — a tag outline, an arrow, a name badge. The
    // board's neutrals are a weaker constraint: a saturated colour is already
    // unmistakable next to grey, so they only need the palette to have chroma.
    const cases: Array<[Record<string, string>, number]> = [
      [RESERVED_BOARD_COLORS as Record<string, string>, 0.12],
      [NEUTRAL_BOARD_COLORS as Record<string, string>, 0.1],
    ];
    for (const [group, floor] of cases) {
      for (const [name, reserved] of Object.entries(group)) {
        for (const c of PLAYER_PALETTE) {
          const d = deltaE(c, reserved);
          if (d < floor) {
            throw new Error(
              `${c} is only ${d.toFixed(3)} from reserved ${name} (${reserved}), floor ${floor}`,
            );
          }
        }
      }
    }
  });

  it('holds no yellow or yellow-green, and stays mid-tone and saturated', () => {
    for (const c of PLAYER_PALETTE) {
      const h = hue(c);
      // Fertile ground is a yellow hatch; anything in this hue band dissolves
      // into the terrain it is standing on.
      expect(h < 56 || h > 148).toBe(true);
      // Light enough to separate from the black grid, dark enough to separate
      // from the white cell, saturated enough to separate from the grey a
      // bot-sourced arrow uses.
      expect(lightness(c)).toBeGreaterThan(0.4);
      expect(lightness(c)).toBeLessThan(0.8);
      expect(chroma(c)).toBeGreaterThan(0.07);
    }
  });

  it('keeps every prefix mutually distinct, with a floor that only relaxes as it grows', () => {
    // The guarantee the ordering buys: a game with N players uses
    // PLAYER_PALETTE[0..N), so what matters is the WORST pair inside each
    // prefix. These floors are the design targets, not the measured values —
    // a change that dips below them has made a small game harder to read.
    const floors: Array<[number, number]> = [
      [2, 0.34], [3, 0.26], [4, 0.18], [5, 0.15], [6, 0.15],
      [7, 0.15], [8, 0.14], [9, 0.14], [10, 0.14], [11, 0.11], [12, 0.09],
    ];
    for (const [k, floor] of floors) {
      let worst = Infinity;
      let pair = '';
      for (let i = 0; i < k; i++) {
        for (let j = i + 1; j < k; j++) {
          const d = deltaE(PLAYER_PALETTE[i], PLAYER_PALETTE[j]);
          if (d < worst) {
            worst = d;
            pair = `${PLAYER_PALETTE[i]}/${PLAYER_PALETTE[j]}`;
          }
        }
      }
      if (worst < floor) {
        throw new Error(
          `prefix of ${k}: closest pair ${pair} is ${worst.toFixed(3)}, below the ${floor} floor`,
        );
      }
    }
  });

  it('never places a same-hue lightness twin next to its partner in the order', () => {
    // "Player 8" must never read as "player 7, but lighter": consecutive
    // entries are different HUES, not different tints of one.
    for (let i = 1; i < PLAYER_PALETTE.length; i++) {
      const gap = hueGap(PLAYER_PALETTE[i - 1], PLAYER_PALETTE[i]);
      if (gap < 45) {
        throw new Error(
          `entries ${i - 1} (${PLAYER_PALETTE[i - 1]}) and ${i} (${PLAYER_PALETTE[i]}) ` +
            `share a hue (${gap.toFixed(0)}° apart)`,
        );
      }
    }
  });

  it('wraps past the end of the list and shrugs off a bad index', () => {
    expect(colorForArrivalIndex(0)).toBe(PLAYER_PALETTE[0]);
    expect(colorForArrivalIndex(PLAYER_PALETTE.length)).toBe(PLAYER_PALETTE[0]);
    expect(colorForArrivalIndex(PLAYER_PALETTE.length + 3)).toBe(PLAYER_PALETTE[3]);
    expect(colorForArrivalIndex(-1)).toBe(PLAYER_PALETTE[0]);
    expect(colorForArrivalIndex(NaN)).toBe(PLAYER_PALETTE[0]);
  });
});

describe('player palette — assignment by arrival order', () => {
  let mgr: ActiveGameManager;
  const gameId = 'palette-game';

  function makeBoard(id: string): BoardSnapshot {
    const unit: Snake = {
      id: 'A',
      name: 'A unit',
      latency: '0',
      health: 100,
      body: [{ x: 1, y: 1 }],
      head: { x: 1, y: 1 },
      length: 1,
      shout: '',
      squad: '',
      orientation: { dx: 0, dy: -1 },
      customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    };
    return {
      game: { id, ruleset: { name: 'teamsnek', version: 'v1', settings: {} }, map: 'standard', timeout: 500, source: 'test' },
      turn: 0,
      board: { width: 11, height: 11, food: [], hazards: [], snakes: [unit] },
    } as unknown as BoardSnapshot;
  }

  beforeEach(() => {
    // The manager is a singleton; each case gets its own game id so the
    // enrolment state written here cannot reach any other suite.
    mgr = ActiveGameManager.getInstance();
    mgr.registerGame(makeBoard(gameId), 'A');
  });

  afterEach(() => {
    mgr.endGame(gameId);
  });

  function enrol(userId: string, name: string): string {
    const result = mgr.addConnectedUser(gameId, userId, name);
    if (!result || !('user' in result)) throw new Error(`enrol failed for ${name}`);
    return result.user.color;
  }

  it('hands the Nth arrival the Nth palette colour, whatever they are called', () => {
    expect(enrol('u1', 'Alice')).toBe(PLAYER_PALETTE[0]);
    expect(enrol('u2', 'Bob')).toBe(PLAYER_PALETTE[1]);
    expect(enrol('u3', 'Cara')).toBe(PLAYER_PALETTE[2]);
    expect(enrol('u4', 'Dee')).toBe(PLAYER_PALETTE[3]);
  });

  it('gives the same arrival order the same colours in a different game', () => {
    const other = 'palette-game-2';
    mgr.registerGame(makeBoard(other), 'A');
    try {
      const first = mgr.addConnectedUser(other, 'x1', 'Zebedee');
      const second = mgr.addConnectedUser(other, 'x2', 'Yolanda');
      expect(first && 'user' in first && first.user.color).toBe(PLAYER_PALETTE[0]);
      expect(second && 'user' in second && second.user.color).toBe(PLAYER_PALETTE[1]);
    } finally {
      mgr.endGame(other);
    }
  });

  it('keeps a player on their arrival colour across disconnect and reconnect', () => {
    const alice = enrol('u1', 'Alice');
    enrol('u2', 'Bob');

    mgr.removeConnectedUser(gameId, 'u1');
    // Someone else arriving while Alice is away must not take her slot: the
    // enrolment (and its arrival index) outlives the connection.
    const cara = enrol('u3', 'Cara');
    expect(cara).toBe(PLAYER_PALETTE[2]);

    expect(enrol('u1', 'Alice')).toBe(alice);
    expect(alice).toBe(PLAYER_PALETTE[0]);
  });

  it('reports the same colour through the owners projection every consumer reads', () => {
    enrol('u1', 'Alice');
    mgr.selectSnake(gameId, 'A', 'u1');
    const owners = mgr.getOwnersForGame(gameId);
    expect(owners['A']).toEqual(
      expect.objectContaining({ userId: 'u1', name: 'Alice', color: PLAYER_PALETTE[0] }),
    );
  });
});
