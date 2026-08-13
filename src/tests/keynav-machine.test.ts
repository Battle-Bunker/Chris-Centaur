/**
 * Unit tests for the pure keyboard destination-selection state machine
 * (src/web/keynav-machine.js — shared verbatim with play-game.html).
 *
 * Pins the owner-confirmed {axis, distance} semantics:
 *   - switching axis (arrow Left/Right or a numpad key from a different
 *     axis) resets distance to 1;
 *   - the TWELVE ("12:00") hold state and its direction-sensitive arrow
 *     Left/Right first-legal-axis selection;
 *   - numpad 5 resetting the axis to TWELVE;
 *   - numpad opposite-key retraction flipping the axis to the direction of
 *     travel at the moment hold is reached (the only way to cross hold);
 *   - arrow Down retracting to hold KEEPING the axis, never crossing it,
 *     with arrow Up re-extending the kept axis to distance 1;
 *   - the confirmed knight numpad anchoring map.
 */
const {
  TWELVE,
  ORTHO_AXES,
  ALL_AXES,
  arrowStep,
  numpadStep,
  deriveFromOffset,
  ringFor,
  numpadAxisFor,
} = require('../web/keynav-machine.js');

type Axis = { dx: number; dy: number };
type NavState = { axis: Axis | string; distance: number };
type StepResult = { ok: boolean; axis?: Axis | string; distance?: number };

const akey = (a: Axis) => `${a.dx},${a.dy}`;

// Context builder: per-axis reach comes from `dist` (keyed "dx,dy"), falling
// back to `defaultDist` (0 = axis illegal).
function makeCtx(
  unitType: string | undefined,
  opts: { dist?: Record<string, number>; defaultDist?: number; canHold?: boolean } = {}
) {
  return {
    ring: ringFor(unitType),
    maxDist: (a: Axis) =>
      opts.dist && akey(a) in opts.dist ? opts.dist[akey(a)] : (opts.defaultDist ?? 0),
    canHold: opts.canHold ?? true,
    axisFor: (digit: number) => numpadAxisFor(unitType, digit),
  };
}

const nav = (axis: Axis | string, distance: number): NavState => ({ axis, distance });
const okStep = (axis: Axis | string, distance: number): StepResult => ({
  ok: true,
  axis,
  distance,
});

describe('deriveFromOffset', () => {
  test('slider offset collapses to unit axis + Chebyshev distance', () => {
    expect(deriveFromOffset('queen', 3, 3, null)).toEqual(okAxisDist({ dx: 1, dy: 1 }, 3));
    expect(deriveFromOffset('rook', 0, -4, null)).toEqual(okAxisDist({ dx: 0, dy: -1 }, 4));
  });

  test('knight offset is its own axis at distance 1', () => {
    expect(deriveFromOffset('knight', 1, 2, null)).toEqual(okAxisDist({ dx: 1, dy: 2 }, 1));
    expect(deriveFromOffset('knight', -2, -1, null)).toEqual(okAxisDist({ dx: -2, dy: -1 }, 1));
  });

  test('zero offset (hold) with no memory lands in the TWELVE state', () => {
    expect(deriveFromOffset('queen', 0, 0, null)).toEqual(okAxisDist(TWELVE, 0));
  });

  test('zero offset (hold) keeps a previous axis as memory', () => {
    const prev = { dx: 1, dy: -1 };
    expect(deriveFromOffset('queen', 0, 0, prev)).toEqual(okAxisDist(prev, 0));
  });

  function okAxisDist(axis: Axis | string, distance: number) {
    return { axis, distance };
  }
});

describe('12:00 state: arrow Left/Right first-legal-axis selection', () => {
  test('queen, all axes legal: Right picks up-right, Left picks up-left', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    expect(arrowStep(nav(TWELVE, 0), 'right', ctx)).toEqual(okStep({ dx: 1, dy: 1 }, 1));
    expect(arrowStep(nav(TWELVE, 0), 'left', ctx)).toEqual(okStep({ dx: -1, dy: 1 }, 1));
  });

  test('rook, all axes legal: straight up is not "clockwise of 12:00"', () => {
    const ctx = makeCtx('rook', { defaultDist: 2 });
    expect(arrowStep(nav(TWELVE, 0), 'right', ctx)).toEqual(okStep({ dx: 1, dy: 0 }, 1));
    expect(arrowStep(nav(TWELVE, 0), 'left', ctx)).toEqual(okStep({ dx: -1, dy: 0 }, 1));
  });

  test('skips illegal axes to the next one around', () => {
    // Rook with the right ray blocked: Right sweeps on to straight down.
    const ctx = makeCtx('rook', { defaultDist: 2, dist: { '1,0': 0 } });
    expect(arrowStep(nav(TWELVE, 0), 'right', ctx)).toEqual(okStep({ dx: 0, dy: -1 }, 1));
  });

  test('an axis exactly at 12:00 is chosen only as the sole legal axis', () => {
    const ctx = makeCtx('rook', { dist: { '0,1': 3 } });
    expect(arrowStep(nav(TWELVE, 0), 'right', ctx)).toEqual(okStep({ dx: 0, dy: 1 }, 1));
    expect(arrowStep(nav(TWELVE, 0), 'left', ctx)).toEqual(okStep({ dx: 0, dy: 1 }, 1));
  });

  test('no legal axes: unavailable', () => {
    const ctx = makeCtx('rook', { defaultDist: 0 });
    expect(arrowStep(nav(TWELVE, 0), 'right', ctx).ok).toBe(false);
  });

  test('Up at TWELVE is unavailable (nothing to extend along)', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    expect(arrowStep(nav(TWELVE, 0), 'up', ctx).ok).toBe(false);
  });

  test('Down at TWELVE is unavailable (Down never crosses hold)', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    expect(arrowStep(nav(TWELVE, 0), 'down', ctx).ok).toBe(false);
  });
});

describe('arrow Left/Right axis switch resets distance to 1', () => {
  test('rotating clockwise from a deep extension lands at distance 1', () => {
    const ctx = makeCtx('rook', { defaultDist: 5 });
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 3), 'right', ctx)).toEqual(okStep({ dx: 1, dy: 0 }, 1));
  });

  test('rotating counter-clockwise likewise resets to 1', () => {
    const ctx = makeCtx('queen', { defaultDist: 5 });
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 4), 'left', ctx)).toEqual(okStep({ dx: -1, dy: 1 }, 1));
  });

  test('rotation wraps around the legal ring, skipping illegal axes', () => {
    const ctx = makeCtx('rook', { defaultDist: 2, dist: { '1,0': 0 } });
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 2), 'right', ctx)).toEqual(okStep({ dx: 0, dy: -1 }, 1));
    expect(arrowStep(nav({ dx: 0, dy: -1 }, 1), 'left', ctx)).toEqual(okStep({ dx: 0, dy: 1 }, 1));
  });

  test('rotating with a retained axis at hold re-enters at distance 1', () => {
    const ctx = makeCtx('rook', { defaultDist: 2 });
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 0), 'right', ctx)).toEqual(okStep({ dx: 1, dy: 0 }, 1));
  });
});

describe('arrow Up/Down extend and retract', () => {
  const up = { dx: 0, dy: 1 };

  test('Up extends one square, clamped at the board-legal maximum', () => {
    const ctx = makeCtx('rook', { defaultDist: 3 });
    expect(arrowStep(nav(up, 2), 'up', ctx)).toEqual(okStep(up, 3));
    expect(arrowStep(nav(up, 3), 'up', ctx).ok).toBe(false);
  });

  test('Down retracts one square, then into hold KEEPING the axis', () => {
    const ctx = makeCtx('rook', { defaultDist: 3 });
    expect(arrowStep(nav(up, 3), 'down', ctx)).toEqual(okStep(up, 2));
    expect(arrowStep(nav(up, 1), 'down', ctx)).toEqual(okStep(up, 0));
  });

  test('a further Down at hold is unavailable — Down never crosses hold', () => {
    const ctx = makeCtx('rook', { defaultDist: 3 });
    expect(arrowStep(nav(up, 0), 'down', ctx).ok).toBe(false);
  });

  test('Up from hold with a retained axis re-extends it to distance 1', () => {
    const ctx = makeCtx('rook', { defaultDist: 3 });
    expect(arrowStep(nav(up, 0), 'up', ctx)).toEqual(okStep(up, 1));
  });

  test('snakes (no hold, reach 1) can neither extend nor retract', () => {
    const ctx = makeCtx(undefined, { defaultDist: 1, canHold: false });
    expect(arrowStep(nav(up, 1), 'up', ctx).ok).toBe(false);
    expect(arrowStep(nav(up, 1), 'down', ctx).ok).toBe(false);
  });
});

describe('numpad: extend, retract, and the through-hold axis flip', () => {
  test('a direction key extends one square per press up to the maximum', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    expect(numpadStep(nav(TWELVE, 0), 9, ctx)).toEqual(okStep({ dx: 1, dy: 1 }, 1));
    expect(numpadStep(nav({ dx: 1, dy: 1 }, 1), 9, ctx)).toEqual(okStep({ dx: 1, dy: 1 }, 2));
    expect(numpadStep(nav({ dx: 1, dy: 1 }, 2), 9, ctx).ok).toBe(false);
  });

  test('opposite key retracts; reaching hold flips the axis to the travel direction', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    const upRight = { dx: 1, dy: 1 };
    const downLeft = { dx: -1, dy: -1 };
    // 9,9 then 1: retract to distance 1 (axis still up-right).
    expect(numpadStep(nav(upRight, 2), 1, ctx)).toEqual(okStep(upRight, 1));
    // 1 again: reach hold — axis FLIPS to down-left, the direction of travel.
    expect(numpadStep(nav(upRight, 1), 1, ctx)).toEqual(okStep(downLeft, 0));
    // 1 again: extend out the far side along the flipped axis.
    expect(numpadStep(nav(downLeft, 0), 1, ctx)).toEqual(okStep(downLeft, 1));
    expect(numpadStep(nav(downLeft, 1), 1, ctx)).toEqual(okStep(downLeft, 2));
  });

  test('a numpad key from a different axis resets distance to 1', () => {
    const ctx = makeCtx('queen', { defaultDist: 4 });
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 3), 6, ctx)).toEqual(okStep({ dx: 1, dy: 0 }, 1));
  });

  test('from hold with a retained axis, the same-direction key re-extends it', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 0), 8, ctx)).toEqual(okStep({ dx: 0, dy: 1 }, 1));
  });

  test('from hold, any other direction key selects that axis at distance 1', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    // Opposite of the retained axis included — hold was not reached by this
    // key, so there is no flip-crossing, just a fresh distance-1 selection.
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 0), 2, ctx)).toEqual(okStep({ dx: 0, dy: -1 }, 1));
    expect(numpadStep(nav(TWELVE, 0), 4, ctx)).toEqual(okStep({ dx: -1, dy: 0 }, 1));
  });

  test('units that cannot hold pass straight through to the opposite ray', () => {
    const snakeCtx = makeCtx(undefined, { defaultDist: 1, canHold: false });
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 1), 2, snakeCtx)).toEqual(okStep({ dx: 0, dy: -1 }, 1));
    const blocked = makeCtx(undefined, {
      defaultDist: 1,
      dist: { '0,-1': 0 },
      canHold: false,
    });
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 1), 2, blocked).ok).toBe(false);
  });

  test('a key outside the unit ring is unavailable (diagonal key, rook)', () => {
    const ctx = makeCtx('rook', { defaultDist: 2 });
    expect(numpadStep(nav(TWELVE, 0), 9, ctx).ok).toBe(false);
  });
});

describe('numpad 5 (hold)', () => {
  test('selects hold and RESETS the axis to the 12:00 state', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    expect(numpadStep(nav({ dx: 1, dy: 1 }, 2), 5, ctx)).toEqual(okStep(TWELVE, 0));
  });

  test('is unavailable for units that cannot hold', () => {
    const ctx = makeCtx(undefined, { defaultDist: 1, canHold: false });
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 1), 5, ctx).ok).toBe(false);
  });
});

describe('knight transitions and anchoring', () => {
  test('confirmed numpad anchoring: orthogonals minor-step clockwise, diagonals ccw partners', () => {
    expect(numpadAxisFor('knight', 8)).toEqual({ dx: 1, dy: 2 });
    expect(numpadAxisFor('knight', 6)).toEqual({ dx: 2, dy: -1 });
    expect(numpadAxisFor('knight', 2)).toEqual({ dx: -1, dy: -2 });
    expect(numpadAxisFor('knight', 4)).toEqual({ dx: -2, dy: 1 });
    expect(numpadAxisFor('knight', 7)).toEqual({ dx: -1, dy: 2 });
    expect(numpadAxisFor('knight', 9)).toEqual({ dx: 2, dy: 1 });
    expect(numpadAxisFor('knight', 3)).toEqual({ dx: 1, dy: -2 });
    expect(numpadAxisFor('knight', 1)).toEqual({ dx: -2, dy: -1 });
  });

  test('opposite-key retraction through hold flips L-directions too', () => {
    const ctx = makeCtx('knight', { defaultDist: 1 });
    const upRightL = { dx: 2, dy: 1 };
    const downLeftL = { dx: -2, dy: -1 };
    expect(numpadStep(nav(TWELVE, 0), 9, ctx)).toEqual(okStep(upRightL, 1));
    expect(numpadStep(nav(upRightL, 1), 1, ctx)).toEqual(okStep(downLeftL, 0));
    expect(numpadStep(nav(downLeftL, 0), 1, ctx)).toEqual(okStep(downLeftL, 1));
    // Knights lock at distance 1: a further press cannot extend.
    expect(numpadStep(nav(downLeftL, 1), 1, ctx).ok).toBe(false);
  });

  test('12:00 arrow selection over the L-ring: nearest L-offsets either side of straight up', () => {
    const ctx = makeCtx('knight', { defaultDist: 1 });
    expect(arrowStep(nav(TWELVE, 0), 'right', ctx)).toEqual(okStep({ dx: 1, dy: 2 }, 1));
    expect(arrowStep(nav(TWELVE, 0), 'left', ctx)).toEqual(okStep({ dx: -1, dy: 2 }, 1));
  });
});

describe('rings', () => {
  test('unit type → axis ring mapping', () => {
    expect(ringFor('queen')).toBe(ALL_AXES);
    expect(ringFor('king')).toBe(ALL_AXES);
    expect(ringFor('rook')).toBe(ORTHO_AXES);
    expect(ringFor(undefined)).toBe(ORTHO_AXES); // snakes and historic units
    expect(ringFor('bishop').map(akey)).toEqual(['1,1', '1,-1', '-1,-1', '-1,1']);
    expect(ringFor('knight')).toHaveLength(8);
  });
});
