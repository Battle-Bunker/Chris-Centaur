/**
 * Unit tests for the pure keyboard destination-selection state machine
 * (src/web/keynav-machine.js — shared verbatim with play-game.html).
 *
 * Pins the {axis, distance} semantics:
 *   - the current axis is always a member of the type's legal axis ring (a
 *     unit's orientation is always in its type's legal orientation set —
 *     the engine invariant); ring walks exist only for candidate
 *     availability, when a ring axis has no board-legal destination;
 *   - switching axis (arrow Left/Right or a numpad key from a different
 *     axis) resets distance to 1;
 *   - arrow Left/Right rotate the type's legal axis ring, skipping
 *     candidate-less axes;
 *   - arrow Up extends along the current axis (a candidate-less axis
 *     selects the first axis clockwise that has one, at distance 1); arrow
 *     Down retracts toward hold, keeping the axis, and never crosses it;
 *   - numpad keys step a signed distance along the pressed axis — the
 *     opposite key retracts through hold and out the far side, flipping the
 *     axis to the direction of travel at the crossing; 5 selects hold and
 *     resets the axis to the wire orientation;
 *   - pawn keys resolve through one table: forward, rotations, diagonal
 *     chords, retract-to-hold;
 *   - the axis rings derive from the same per-type legal orientation sets as the
 *     engine (legalOrientations in src/logic/staging-legality.ts).
 */
import { legalOrientations } from '../logic/staging-legality';
import type { UnitType } from '@shared/types/Game';

const {
  ORTHO_AXES,
  DIAG_AXES,
  ALL_AXES,
  KNIGHT_AXES,
  NUMPAD_ORDER,
  arrowStep,
  numpadStep,
  pawnStep,
  deriveFromOffset,
  orientationOf,
  seedNav,
  ringFor,
  numpadAxisFor,
} = require('../web/keynav-machine.js');

type Axis = { dx: number; dy: number };
type NavState = { axis: Axis | null; distance: number };
type StepResult = { ok: boolean; axis?: Axis; distance?: number };

const akey = (a: Axis) => `${a.dx},${a.dy}`;

// Context builder: per-axis reach comes from `dist` (keyed "dx,dy"), falling
// back to `defaultDist` (0 = axis illegal). `orientation` is the unit's wire
// orientation as an api axis.
function makeCtx(
  unitType: string | undefined,
  opts: {
    dist?: Record<string, number>;
    defaultDist?: number;
    canHold?: boolean;
    orientation?: Axis;
  } = {}
) {
  return {
    ring: ringFor(unitType),
    maxDist: (a: Axis) =>
      opts.dist && akey(a) in opts.dist ? opts.dist[akey(a)] : (opts.defaultDist ?? 0),
    canHold: opts.canHold ?? true,
    axisFor: (digit: number) => numpadAxisFor(unitType, digit),
    orientation: opts.orientation ?? { dx: 0, dy: 1 },
  };
}

const nav = (axis: Axis, distance: number): NavState => ({ axis, distance });
const okStep = (axis: Axis, distance: number): StepResult => ({
  ok: true,
  axis,
  distance,
});

describe('axis rings derive from the engine orientation sets', () => {
  // The clockwise-from-up screen order the rings are sorted into.
  const cwFromUp = (a: Axis) => {
    const ang = Math.atan2(a.dx, a.dy);
    return ang < 0 ? ang + 2 * Math.PI : ang;
  };

  test.each([
    ['rook', ORTHO_AXES],
    ['snake', ORTHO_AXES],
    ['pawn', ORTHO_AXES],
    ['bishop', DIAG_AXES],
    ['queen', ALL_AXES],
    ['king', ALL_AXES],
    ['knight', KNIGHT_AXES],
  ])('%s ring = legalOrientations y-flipped, sorted clockwise from up', (type, ring) => {
    const derived = legalOrientations(type as UnitType)
      .map((f) => ({ dx: f.dx, dy: -f.dy || 0 }))
      .sort((a, b) => cwFromUp(a) - cwFromUp(b));
    expect(ring).toEqual(derived);
  });

  test('unit type → axis ring mapping (unknown types face orthogonally)', () => {
    expect(ringFor('queen')).toBe(ALL_AXES);
    expect(ringFor('king')).toBe(ALL_AXES);
    expect(ringFor('rook')).toBe(ORTHO_AXES);
    expect(ringFor(undefined)).toBe(ORTHO_AXES); // snakes
    expect(ringFor('bishop').map(akey)).toEqual(['1,1', '1,-1', '-1,-1', '-1,1']);
    expect(ringFor('knight')).toHaveLength(8);
  });

  test('every ring is clockwise: NUMPAD_ORDER indexes it as a compass', () => {
    // 8 up, 9 up-right, 6 right, … — the compass digits read the ring in
    // ring order.
    expect(NUMPAD_ORDER).toEqual([8, 9, 6, 3, 2, 1, 4, 7]);
    expect(numpadAxisFor('queen', 8)).toEqual({ dx: 0, dy: 1 });
    expect(numpadAxisFor('queen', 9)).toEqual({ dx: 1, dy: 1 });
    expect(numpadAxisFor('queen', 6)).toEqual({ dx: 1, dy: 0 });
    expect(numpadAxisFor('queen', 3)).toEqual({ dx: 1, dy: -1 });
    expect(numpadAxisFor('queen', 2)).toEqual({ dx: 0, dy: -1 });
    expect(numpadAxisFor('queen', 1)).toEqual({ dx: -1, dy: -1 });
    expect(numpadAxisFor('queen', 4)).toEqual({ dx: -1, dy: 0 });
    expect(numpadAxisFor('queen', 7)).toEqual({ dx: -1, dy: 1 });
  });

  test('knight numpad anchoring: the derived map matches the pinned values', () => {
    // Pinned (api coords): 8=2up1right, 6=2right1down, 2=2down1left,
    // 4=2left1up, 7=2up1left, 9=2right1up, 3=2down1right, 1=2left1down.
    const pinned: Record<number, Axis> = {
      8: { dx: 1, dy: 2 },
      6: { dx: 2, dy: -1 },
      2: { dx: -1, dy: -2 },
      4: { dx: -2, dy: 1 },
      7: { dx: -1, dy: 2 },
      9: { dx: 2, dy: 1 },
      3: { dx: 1, dy: -2 },
      1: { dx: -2, dy: -1 },
    };
    for (const [digit, axis] of Object.entries(pinned)) {
      expect(numpadAxisFor('knight', Number(digit))).toEqual(axis);
    }
  });

  test("every key's opposite key maps to its exact negation, for every type", () => {
    const opposite: Record<number, number> = { 8: 2, 9: 1, 6: 4, 3: 7, 2: 8, 1: 9, 4: 6, 7: 3 };
    for (const type of ['queen', 'knight']) {
      for (const [digit, opp] of Object.entries(opposite)) {
        const a = numpadAxisFor(type, Number(digit));
        const b = numpadAxisFor(type, Number(opp));
        expect({ dx: -a.dx || 0, dy: -a.dy || 0 }).toEqual(b);
      }
    }
  });
});

describe('orientationOf: wire orientation → api axis', () => {
  test('flips the y axis (wire y grows downward)', () => {
    expect(orientationOf({ unitType: 'queen', orientation: { dx: 1, dy: 1 } })).toEqual({ dx: 1, dy: -1 });
    expect(orientationOf({ unitType: 'rook', orientation: { dx: 0, dy: -1 } })).toEqual({ dx: 0, dy: 1 });
    expect(orientationOf({ unitType: 'snake', orientation: { dx: -1, dy: 0 } })).toEqual({ dx: -1, dy: 0 });
  });

  test('a knight orientation keeps the exact L-offset (its axes ARE the L-offsets)', () => {
    expect(orientationOf({ unitType: 'knight', orientation: { dx: 1, dy: -2 } })).toEqual({ dx: 1, dy: 2 });
  });
});

describe('deriveFromOffset', () => {
  test('slider offset collapses to unit axis + Chebyshev distance', () => {
    expect(deriveFromOffset('queen', 3, 3, null)).toEqual({ axis: { dx: 1, dy: 1 }, distance: 3 });
    expect(deriveFromOffset('rook', 0, -4, null)).toEqual({ axis: { dx: 0, dy: -1 }, distance: 4 });
  });

  test('knight offset is its own axis at distance 1', () => {
    expect(deriveFromOffset('knight', 1, 2, null)).toEqual({ axis: { dx: 1, dy: 2 }, distance: 1 });
    expect(deriveFromOffset('knight', -2, -1, null)).toEqual({
      axis: { dx: -2, dy: -1 },
      distance: 1,
    });
  });

  test('zero offset (hold) keeps a previous axis as memory, else no axis', () => {
    const prev = { dx: 1, dy: -1 };
    expect(deriveFromOffset('queen', 0, 0, prev)).toEqual({ axis: prev, distance: 0 });
    expect(deriveFromOffset('queen', 0, 0, null)).toEqual({ axis: null, distance: 0 });
  });
});

describe('seedNav: axis seeding priority (candidate → staged → orientation)', () => {
  const orientation = { dx: -1, dy: 0 };
  const staged = { dx: 0, dy: -1 };

  test('a selected directional candidate wins over staged and orientation', () => {
    const sel = { axis: { dx: 1, dy: 0 }, distance: 2 };
    expect(seedNav(sel, staged, orientation)).toEqual(sel);
  });

  test('a hold selection takes the staged move axis (distance untouched)', () => {
    expect(seedNav({ axis: null, distance: 0 }, staged, orientation)).toEqual({
      axis: staged,
      distance: 0,
    });
  });

  test('with no staged axis the wire orientation seeds the axis', () => {
    expect(seedNav({ axis: null, distance: 0 }, null, orientation)).toEqual({
      axis: orientation,
      distance: 0,
    });
  });
});

describe('arrow Left/Right rotate the legal axis ring', () => {
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

  test('a candidate-less current axis rotates to the first legal axis past it', () => {
    // Rook whose current axis (up) is blocked: Right picks screen-right —
    // the next legal axis clockwise of up — and Left picks screen-left.
    const ctx = makeCtx('rook', { defaultDist: 2, dist: { '0,1': 0 } });
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 1), 'right', ctx)).toEqual(okStep({ dx: 1, dy: 0 }, 1));
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 1), 'left', ctx)).toEqual(okStep({ dx: -1, dy: 0 }, 1));
  });

  test('a sole legal axis is re-selected at distance 1 from either rotation', () => {
    // Only the up ray is legal and the cursor is already on it: rotation
    // has nowhere else to go and re-enters the same axis at distance 1.
    const ctx = makeCtx('rook', { dist: { '0,1': 3 } });
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 2), 'right', ctx)).toEqual(okStep({ dx: 0, dy: 1 }, 1));
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 2), 'left', ctx)).toEqual(okStep({ dx: 0, dy: 1 }, 1));
  });

  test('no legal axes: unavailable', () => {
    const ctx = makeCtx('rook', { defaultDist: 0 });
    expect(arrowStep(nav({ dx: 0, dy: 1 }, 1), 'right', ctx).ok).toBe(false);
  });

  test('an off-ring current axis is impossible and throws (plain assertion, no recovery)', () => {
    // Bishop on an orthogonal axis: no code path can produce this state.
    const ctx = makeCtx('bishop', { defaultDist: 2 });
    expect(() => arrowStep(nav({ dx: 0, dy: 1 }, 1), 'right', ctx)).toThrow(
      'off the legal axis ring'
    );
  });
});

describe('arrow Up/Down extend and retract', () => {
  const up = { dx: 0, dy: 1 };

  test('Up extends one square, clamped at the board-legal maximum', () => {
    const ctx = makeCtx('rook', { defaultDist: 3 });
    expect(arrowStep(nav(up, 2), 'up', ctx)).toEqual(okStep(up, 3));
    expect(arrowStep(nav(up, 3), 'up', ctx).ok).toBe(false);
  });

  test('Up from hold extends the current axis to distance 1', () => {
    const ctx = makeCtx('rook', { defaultDist: 3 });
    expect(arrowStep(nav(up, 0), 'up', ctx)).toEqual(okStep(up, 1));
  });

  test('Up on a blocked current axis selects the first legal axis clockwise at 1', () => {
    const ctx = makeCtx('rook', { defaultDist: 2, dist: { '0,1': 0 } });
    expect(arrowStep(nav(up, 0), 'up', ctx)).toEqual(okStep({ dx: 1, dy: 0 }, 1));
  });

  test('Up with no legal axis at all is unavailable', () => {
    const ctx = makeCtx('queen', { defaultDist: 0 });
    expect(arrowStep(nav(up, 0), 'up', ctx).ok).toBe(false);
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
});

describe('numpad: extend, retract, and the through-hold axis flip', () => {
  test('a direction key selects its axis at 1 and extends one square per press', () => {
    const ctx = makeCtx('queen', { defaultDist: 2 });
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 0), 9, ctx)).toEqual(okStep({ dx: 1, dy: 1 }, 1));
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
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 0), 4, ctx)).toEqual(okStep({ dx: -1, dy: 0 }, 1));
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
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 1), 9, ctx).ok).toBe(false);
  });
});

describe('numpad 5 selects hold and resets the axis to the wire orientation', () => {
  test('queen: 5 resets the axis to its wire orientation ("no change")', () => {
    const orientation = { dx: -1, dy: -1 };
    const ctx = makeCtx('queen', { defaultDist: 2, orientation });
    expect(numpadStep(nav({ dx: 1, dy: 1 }, 2), 5, ctx)).toEqual(okStep(orientation, 0));
  });

  test('after a 5-reset, Up extends forward along the wire orientation', () => {
    const orientation = { dx: 1, dy: 0 };
    const ctx = makeCtx('rook', { defaultDist: 3, orientation });
    const held = numpadStep(nav({ dx: 0, dy: 1 }, 2), 5, ctx);
    expect(held).toEqual(okStep(orientation, 0));
    expect(arrowStep(nav(held.axis as Axis, 0), 'up', ctx)).toEqual(okStep(orientation, 1));
  });

  test('is unavailable for units that cannot hold', () => {
    const ctx = makeCtx(undefined, { defaultDist: 1, canHold: false });
    expect(numpadStep(nav({ dx: 0, dy: 1 }, 1), 5, ctx).ok).toBe(false);
  });
});

describe('knight transitions over the L-ring', () => {
  test('opposite-key retraction through hold flips L-directions too', () => {
    const ctx = makeCtx('knight', { defaultDist: 1 });
    const upRightL = { dx: 2, dy: 1 };
    const downLeftL = { dx: -2, dy: -1 };
    expect(numpadStep(nav({ dx: 1, dy: 2 }, 0), 9, ctx)).toEqual(okStep(upRightL, 1));
    expect(numpadStep(nav(upRightL, 1), 1, ctx)).toEqual(okStep(downLeftL, 0));
    expect(numpadStep(nav(downLeftL, 0), 1, ctx)).toEqual(okStep(downLeftL, 1));
    // Knights lock at distance 1: a further press cannot extend.
    expect(numpadStep(nav(downLeftL, 1), 1, ctx).ok).toBe(false);
  });

  test('arrow Left/Right walk adjacent L-offsets', () => {
    const ctx = makeCtx('knight', { defaultDist: 1 });
    expect(arrowStep(nav({ dx: 1, dy: 2 }, 1), 'right', ctx)).toEqual(okStep({ dx: 2, dy: 1 }, 1));
    expect(arrowStep(nav({ dx: 1, dy: 2 }, 1), 'left', ctx)).toEqual(okStep({ dx: -1, dy: 2 }, 1));
  });
});

describe('snake pad: the invariants fall out of the general rules', () => {
  // A mid-game snake orientation RIGHT: its axis seeds to {1,0} at distance 0
  // (nothing selected yet), its backward axis (left) has no candidate —
  // snakes cannot reverse — and it cannot hold. There is no snake branch in
  // the machine; everything below is a consequence of canHold:false and
  // maxDist ≤ 1.
  const right = { dx: 1, dy: 0 };
  const facingRightCtx = () =>
    makeCtx(undefined, { defaultDist: 1, dist: { '-1,0': 0 }, canHold: false, orientation: right });

  test('Up from the orientation seed selects the orientation move at distance 1', () => {
    expect(arrowStep(nav(right, 0), 'up', facingRightCtx())).toEqual(okStep(right, 1));
  });

  test('Left turns left from the orientation: orientation right → the up move', () => {
    expect(arrowStep(nav(right, 0), 'left', facingRightCtx())).toEqual(
      okStep({ dx: 0, dy: 1 }, 1)
    );
    // From an already-selected forward move the turn behaves identically.
    expect(arrowStep(nav(right, 1), 'left', facingRightCtx())).toEqual(
      okStep({ dx: 0, dy: 1 }, 1)
    );
  });

  test('Right turns right from the orientation: orientation right → the down move', () => {
    expect(arrowStep(nav(right, 0), 'right', facingRightCtx())).toEqual(
      okStep({ dx: 0, dy: -1 }, 1)
    );
  });

  test('the backward axis is skipped: two rotations pass over it', () => {
    // Left twice from the orientation lands on the down move — the backward
    // (left) axis has no candidate and is skipped by the ring rotation.
    const first = arrowStep(nav(right, 0), 'left', facingRightCtx());
    const second = arrowStep(nav(first.axis as Axis, 1), 'left', facingRightCtx());
    expect(second).toEqual(okStep({ dx: 0, dy: -1 }, 1));
  });

  test('Down flashes: snakes cannot hold (retract has nowhere to go)', () => {
    expect(arrowStep(nav(right, 1), 'down', facingRightCtx()).ok).toBe(false);
    expect(arrowStep(nav(right, 0), 'down', facingRightCtx()).ok).toBe(false);
  });

  test('Up at the selected orientation move cannot extend further', () => {
    expect(arrowStep(nav(right, 1), 'up', facingRightCtx()).ok).toBe(false);
  });
});

describe('pawn key table (pawnStep)', () => {
  // A pawn orientation up (api {0,1}): forward at {0,1}, rotations on the two
  // perpendiculars, diagonal-forward candidates at {-1,1}/{1,1} when legal.
  const up = { dx: 0, dy: 1 };
  const pawnCtx = (opts: { dist?: Record<string, number>; canHold?: boolean } = {}) =>
    makeCtx('pawn', {
      dist: opts.dist ?? { '0,1': 1, '-1,0': 1, '1,0': 1 },
      canHold: opts.canHold ?? true,
      orientation: up,
    });

  test('Up / numpad 8 select the forward move at distance 1', () => {
    expect(pawnStep(nav(up, 0), 'up', false, pawnCtx())).toEqual(okStep(up, 1));
    expect(pawnStep(nav(up, 0), 8, false, pawnCtx())).toEqual(okStep(up, 1));
  });

  test('forward blocked: Up flashes', () => {
    const ctx = pawnCtx({ dist: { '-1,0': 1, '1,0': 1 } });
    expect(pawnStep(nav(up, 0), 'up', false, ctx).ok).toBe(false);
  });

  test("Left/Right (bare) select the rotation candidates on the pawn's sides", () => {
    expect(pawnStep(nav(up, 0), 'left', false, pawnCtx())).toEqual(okStep({ dx: -1, dy: 0 }, 1));
    expect(pawnStep(nav(up, 0), 'right', false, pawnCtx())).toEqual(okStep({ dx: 1, dy: 0 }, 1));
  });

  test('numpad 4/6 are the same rotations', () => {
    expect(pawnStep(nav(up, 0), 4, false, pawnCtx())).toEqual(okStep({ dx: -1, dy: 0 }, 1));
    expect(pawnStep(nav(up, 0), 6, false, pawnCtx())).toEqual(okStep({ dx: 1, dy: 0 }, 1));
  });

  test("sides are the PAWN's left/right, not the screen's (orientation left)", () => {
    // Orientation left (api {-1,0}): the pawn's left is screen-down, its right
    // screen-up.
    const left = { dx: -1, dy: 0 };
    const ctx = makeCtx('pawn', {
      dist: { '-1,0': 1, '0,-1': 1, '0,1': 1 },
      orientation: left,
    });
    expect(pawnStep(nav(left, 0), 'left', false, ctx)).toEqual(okStep({ dx: 0, dy: -1 }, 1));
    expect(pawnStep(nav(left, 0), 'right', false, ctx)).toEqual(okStep({ dx: 0, dy: 1 }, 1));
  });

  test('Up+Left / Up+Right chords select the diagonal-forward candidates when legal', () => {
    const ctx = pawnCtx({ dist: { '0,1': 1, '-1,0': 1, '1,0': 1, '-1,1': 1, '1,1': 1 } });
    expect(pawnStep(nav(up, 0), 'left', true, ctx)).toEqual(okStep({ dx: -1, dy: 1 }, 1));
    expect(pawnStep(nav(up, 0), 'right', true, ctx)).toEqual(okStep({ dx: 1, dy: 1 }, 1));
  });

  test('numpad 7/9 are the same diagonals, and flash when not legal', () => {
    const ctx = pawnCtx({ dist: { '0,1': 1, '-1,0': 1, '1,0': 1, '1,1': 1 } });
    expect(pawnStep(nav(up, 0), 9, false, ctx)).toEqual(okStep({ dx: 1, dy: 1 }, 1));
    expect(pawnStep(nav(up, 0), 7, false, ctx).ok).toBe(false); // no target there
  });

  test('a chorded Left with no legal diagonal flashes (never falls back to the rotation)', () => {
    expect(pawnStep(nav(up, 0), 'left', true, pawnCtx()).ok).toBe(false);
  });

  test('Down / numpad 2 retract to hold, keeping the axis; at hold they flash', () => {
    expect(pawnStep(nav(up, 1), 'down', false, pawnCtx())).toEqual(okStep(up, 0));
    expect(pawnStep(nav(up, 1), 2, false, pawnCtx())).toEqual(okStep(up, 0));
    expect(pawnStep(nav(up, 0), 'down', false, pawnCtx()).ok).toBe(false);
    expect(pawnStep(nav(up, 0), 2, false, pawnCtx()).ok).toBe(false);
  });

  test('numpad 5 selects hold at the orientation axis ("no change")', () => {
    expect(pawnStep(nav({ dx: 1, dy: 0 }, 1), 5, false, pawnCtx())).toEqual(okStep(up, 0));
  });

  test('numpad 1/3 flash: nothing behind a pawn is ever legal', () => {
    expect(pawnStep(nav(up, 0), 1, false, pawnCtx()).ok).toBe(false);
    expect(pawnStep(nav(up, 0), 3, false, pawnCtx()).ok).toBe(false);
  });
});
