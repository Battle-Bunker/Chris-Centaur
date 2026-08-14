/**
 * Pure {axis, distance} state machine for keyboard destination selection.
 *
 * Shared between the browser page (via <script src="/keynav-machine.js">,
 * loaded before play-game.html's inline script, as window.KeyNavMachine) and
 * the Jest unit tests (src/tests/keynav-machine.test.ts, via require). The
 * page owns everything DOM- and candidate-shaped (which squares hold
 * candidates, flashing, selection); this module owns only the transitions.
 *
 * The cursor state is {axis, distance}:
 *   - axis is a direction vector {dx, dy} in api board coords (y grows
 *     upward) — the unit's wire orientation on a fresh seed, then whatever the
 *     last transition selected.
 *   - distance 0 means the hold (stay) candidate; >= 1 means axis·distance.
 *
 * Transitions take a context describing the unit's live legality:
 *   { ring, maxDist(axis) -> number, canHold, axisFor(digit) -> axis|null,
 *     orientation: axis (the unit's wire orientation as an api axis, orientationOf) }
 * and return { ok: false } (caller flashes "unavailable") or
 * { ok: true, axis, distance } (caller selects the candidate there).
 */
(function (global) {
  'use strict';

  const axisEq = (a, b) => !!a && !!b && a.dx === b.dx && a.dy === b.dy;
  // `|| 0` normalizes the -0 that negating 0 produces.
  const neg = (a) => ({ dx: -a.dx || 0, dy: -a.dy || 0 });

  // Clockwise screen angle of an api-coord axis in [0, 2π): straight up is
  // 0, screen-right is π/2.
  function cwFromUp(axis) {
    const a = Math.atan2(axis.dx, axis.dy);
    return a < 0 ? a + 2 * Math.PI : a;
  }

  // Per-type legal orientation sets in WIRE coords (y grows DOWNWARD), copied
  // verbatim from legalOrientations() in src/logic/piece-moves.ts — the
  // lockstep mirror of the engine's pieceMoves.ts. Keep all three in step;
  // src/tests/keynav-machine.test.ts asserts the parity.
  const WIRE_ORTHOGONALS = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
  ];
  const WIRE_DIAGONALS = [
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 },
  ];
  const WIRE_KNIGHT_OFFSETS = [
    { dx: 1, dy: 2 }, { dx: 2, dy: 1 }, { dx: 2, dy: -1 }, { dx: 1, dy: -2 },
    { dx: -1, dy: -2 }, { dx: -2, dy: -1 }, { dx: -2, dy: 1 }, { dx: -1, dy: 2 },
  ];

  // Axis rings: the same sets as api-coord axes (one y-flip), ordered
  // clockwise from straight up — the order arrow Right walks. A knight's
  // "axes" are its eight L-offsets.
  const ring = (wire) => wire
    .map((f) => ({ dx: f.dx, dy: -f.dy || 0 }))
    .sort((a, b) => cwFromUp(a) - cwFromUp(b));
  const ORTHO_AXES = ring(WIRE_ORTHOGONALS);
  const DIAG_AXES = ring(WIRE_DIAGONALS);
  const ALL_AXES = ring(WIRE_ORTHOGONALS.concat(WIRE_DIAGONALS));
  const KNIGHT_AXES = ring(WIRE_KNIGHT_OFFSETS);

  function ringFor(unitType) {
    switch (unitType) {
      case 'knight': return KNIGHT_AXES;
      case 'bishop': return DIAG_AXES;
      case 'queen':
      case 'king': return ALL_AXES;
      default: return ORTHO_AXES; // orthogonally-oriented types (rook, snake, pawn)
    }
  }

  // Numpad digit → ring index, reading the keypad as a compass clockwise
  // from up (8, then 9 = up-right, and on around). Knights read their
  // L-ring in the same order, so every key's OPPOSITE key is its exact
  // negation for every type. 5 is hold, handled inside numpadStep.
  const NUMPAD_ORDER = [8, 9, 6, 3, 2, 1, 4, 7];

  function numpadAxisFor(unitType, digit) {
    const axes = unitType === 'knight' ? KNIGHT_AXES : ALL_AXES;
    return axes[NUMPAD_ORDER.indexOf(digit)] || null;
  }

  // Physical numpad keys → digit. e.code names the physical key and is the
  // same with NumLock on (e.key '8') or off (e.key 'ArrowUp'), so one map
  // covers both keycode regimes.
  const NUMPAD_DIGIT_CODES = {
    Numpad1: 1, Numpad2: 2, Numpad3: 3, Numpad4: 4, Numpad5: 5,
    Numpad6: 6, Numpad7: 7, Numpad8: 8, Numpad9: 9,
  };

  // The current axis is always a member of the type's legal axis ring: a
  // unit's orientation is always in its type's legal orientation set (the
  // engine invariant), and every transition below only ever selects ring
  // axes. Ring walks therefore exist only for CANDIDATE availability — a
  // ring axis can lack a board-legal destination this turn.

  // The first axis with a board-legal candidate, walking the ring from
  // `from` in `dir` order ('right' = clockwise) and wrapping; `from` itself
  // comes up last, so it is re-selected only when it is the sole
  // candidate-bearing axis. Returns null when no axis has a candidate.
  function nextLegalAxis(from, dir, ctx) {
    const n = ctx.ring.length;
    const idx = ctx.ring.findIndex((a) => axisEq(a, from));
    if (idx < 0) throw new Error('keyNav axis off the legal axis ring');
    const dirStep = dir === 'right' ? 1 : -1;
    for (let i = 1; i <= n; i++) {
      const a = ctx.ring[(((idx + dirStep * i) % n) + n) % n];
      if (ctx.maxDist(a) >= 1) return a;
    }
    return null;
  }

  const ok = (axis, distance) => ({ ok: true, axis, distance });
  const unavailable = () => ({ ok: false });

  // A unit's orientation as an api-coord axis: the wire orientation verbatim, y
  // flipped (wire y grows downward). A knight's orientation is its raw L-offset
  // — its axes ARE the L-offsets; every other type's is a unit vector.
  function orientationOf(unit) {
    return { dx: unit.orientation.dx, dy: -unit.orientation.dy || 0 };
  }

  // KeyNav axis seeding priority: selected candidate → staged move → wire
  // orientation. The later sources fill in the AXIS only when the selection is
  // the hold candidate (which has no direction of its own); the distance
  // always reflects the actual selection.
  function seedNav(selNav, stagedAxis, orientation) {
    return { axis: selNav.axis || stagedAxis || orientation, distance: selNav.distance };
  }

  // {axis, distance} ← a candidate offset from the unit's head, so keyboard
  // steering picks up seamlessly from a click. A zero/absent offset is the
  // hold candidate: it keeps prevAxis as memory (seedNav fills in the wire
  // orientation when there is none).
  function deriveFromOffset(unitType, dx, dy, prevAxis) {
    if (!dx && !dy) return { axis: prevAxis || null, distance: 0 };
    if (unitType === 'knight') return { axis: { dx, dy }, distance: 1 };
    return {
      axis: { dx: Math.sign(dx), dy: Math.sign(dy) },
      distance: Math.max(Math.abs(dx), Math.abs(dy)),
    };
  }

  // One signed-distance rule for every extend/retract: the cursor projected
  // onto the pressed axis as a signed scalar, plus one. Reaching hold with
  // `cross` (numpad) FLIPS the axis to the direction of travel, so further
  // presses of the same key extend out the far side — and units that cannot
  // hold pass straight through to the far ray. Without `cross` (arrow Down)
  // the step floors at hold, keeping the current axis.
  function step(state, axis, ctx, cross) {
    const s = axisEq(state.axis, axis) ? state.distance
      : axisEq(state.axis, neg(axis)) ? -state.distance
        : null;
    let s2 = s === null ? 1 : s + 1;
    if (s2 === 0) {
      if (ctx.canHold) return ok(cross ? axis : state.axis, 0);
      if (!cross) return unavailable();
      s2 = 1;
    }
    if (!cross && s2 > 0) return unavailable(); // Down never crosses hold
    const out = s2 > 0 ? axis : neg(axis);
    const d = Math.abs(s2);
    return d <= ctx.maxDist(out) ? ok(out, d) : unavailable();
  }

  // 4-arrow pad transition. dir: 'left' | 'right' | 'up' | 'down'.
  function arrowStep(state, dir, ctx) {
    if (dir === 'left' || dir === 'right') {
      // Rotate the ring, skipping candidate-less axes. Switching axis
      // always resets distance to 1.
      const axis = nextLegalAxis(state.axis, dir, ctx);
      return axis ? ok(axis, 1) : unavailable();
    }
    if (dir === 'up') {
      if (ctx.maxDist(state.axis) < 1) {
        // No board-legal candidate along the current axis this turn: Up
        // selects the first axis clockwise that has one, at distance 1.
        const axis = nextLegalAxis(state.axis, 'right', ctx);
        return axis ? ok(axis, 1) : unavailable();
      }
      // Extend one square, clamped at the last board-legal ray square.
      const d = Math.min(state.distance + 1, ctx.maxDist(state.axis));
      return d === state.distance ? unavailable() : ok(state.axis, d);
    }
    // down: retract one toward hold, keeping the axis.
    return step(state, neg(state.axis), ctx, false);
  }

  // Numpad transition. digit: 1-9. 5 selects hold AND resets the axis to
  // the wire orientation — "no change".
  function numpadStep(state, digit, ctx) {
    if (digit === 5) {
      return ctx.canHold ? ok(ctx.orientation, 0) : unavailable();
    }
    const axis = ctx.axisFor(digit);
    if (!axis || !ctx.ring.some((a) => axisEq(a, axis))) {
      return unavailable(); // e.g. a diagonal key for a rook
    }
    return step(state, axis, ctx, true);
  }

  // Pawn keys resolve to one of five primitives; a side is the pawn's OWN
  // left/right (counter-clockwise / clockwise of its orientation). Arrow
  // Left/Right pick the rotation candidates — or, chorded with a held
  // Up, the diagonal-forward candidates (which exist only when legal:
  // attack/eat squares). Keys with no entry (numpad 1/3 — nothing behind a
  // pawn is ever legal) are unavailable.
  const PAWN_KEYS = {
    up: ['forward'], 8: ['forward'],
    down: ['retract'], 2: ['retract'],
    left: ['side', 'left'], right: ['side', 'right'],
    4: ['rotate', 'left'], 6: ['rotate', 'right'],
    7: ['diagonal', 'left'], 9: ['diagonal', 'right'],
    5: ['hold'],
  };

  // Pawn transition for both pads. key: an arrow dir or a numpad digit;
  // `chorded` is true while Up is held. A pawn's orientation IS its forward
  // axis, so every primitive is plain axis arithmetic: rotations sit on the
  // orientation's perpendiculars, diagonals on orientation + perpendicular.
  function pawnStep(state, key, chorded, ctx) {
    const entry = PAWN_KEYS[key];
    if (!entry) return unavailable();
    const prim = entry[0] === 'side' ? (chorded ? 'diagonal' : 'rotate') : entry[0];
    const fa = ctx.orientation;
    switch (prim) {
      case 'forward':
        return ctx.maxDist(fa) >= 1 ? ok(fa, 1) : unavailable();
      case 'retract':
        return step(state, neg(state.axis), ctx, false);
      case 'hold':
        return ctx.canHold ? ok(fa, 0) : unavailable();
      default: {
        const side = entry[1];
        const p = side === 'left'
          ? { dx: -fa.dy || 0, dy: fa.dx }
          : { dx: fa.dy, dy: -fa.dx || 0 };
        const axis = prim === 'rotate' ? p : { dx: fa.dx + p.dx, dy: fa.dy + p.dy };
        return ctx.maxDist(axis) >= 1 ? ok(axis, 1) : unavailable();
      }
    }
  }

  const api = {
    ORTHO_AXES,
    DIAG_AXES,
    ALL_AXES,
    KNIGHT_AXES,
    NUMPAD_ORDER,
    NUMPAD_DIGIT_CODES,
    axisEq,
    ringFor,
    numpadAxisFor,
    orientationOf,
    seedNav,
    deriveFromOffset,
    arrowStep,
    numpadStep,
    pawnStep,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.KeyNavMachine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
