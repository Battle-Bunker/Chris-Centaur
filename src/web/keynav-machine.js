/**
 * Pure {axis, distance} state machine for keyboard destination selection.
 *
 * Shared between the browser page (via <script src="/keynav-machine.js">,
 * loaded before play-game.html's inline script, as window.KeyNavMachine) and
 * the Jest unit tests (src/tests/keynav-machine.test.ts, via require) — the
 * single source of truth for how the keyboard cursor moves. The page owns
 * everything DOM- and candidate-shaped (which squares hold candidates, the
 * hold candidate itself, flashing, selection); this module owns only the
 * transitions.
 *
 * The cursor state is {axis, distance}:
 *   - axis is a direction vector {dx, dy} in api board coords (y grows
 *     upward) drawn from the unit's axis ring, or the sentinel TWELVE — the
 *     "12:00" hold state, where no directional axis is retained and the
 *     conceptual pointer sits straight up.
 *   - distance 0 means the hold (stay) candidate; >= 1 means axis·distance.
 *
 * Owner-confirmed semantics implemented here:
 *   - Switching axis (arrow Left/Right, or a numpad key from a different
 *     axis) RESETS distance to 1 — never preserved across an axis change.
 *   - From the TWELVE state, arrow Right selects the first legal axis
 *     STRICTLY clockwise of 12:00, arrow Left the first strictly
 *     counter-clockwise (an axis exactly at 12:00 is a full turn away in
 *     either direction, so it is only chosen when it is the sole legal axis).
 *   - Numpad 5 (hold) resets the axis to TWELVE.
 *   - Numpad opposite-key retraction that reaches hold FLIPS the axis to the
 *     direction of travel (the pressed key), so further presses of the same
 *     key extend out the far side. This is the only way to cross hold.
 *   - Arrow Down retracts to hold KEEPING the axis; Down at hold is
 *     unavailable (Down never crosses hold). Arrow Up from hold with a
 *     retained axis re-extends it to distance 1. Up at TWELVE selects the
 *     STRAIGHT-UP axis at distance 1 when that axis is legal, else the first
 *     legal axis clockwise of 12:00 (the same axis Right would pick) — for
 *     EVERY unit, snakes included: a turn-0 snake's Up selects the board-up
 *     move. Snakes still cannot hold, so their Down at distance 1 flashes.
 *   - FACING (owner's universal-facing redesign): every unit has a facing —
 *     the direction of its LAST actual movement, 12:00 on turn 0 or when it
 *     held. Facing and the keyNav current axis are the same concept, so the
 *     axis seeds as: selected candidate → staged move → facing → 12:00
 *     (deriveFacing + seedNav below). Pawns' ENGINE facing (Snake.facing on
 *     the wire) is authoritative — a diagonal step does not change it.
 *
 * Transitions take a context describing the unit's live legality:
 *   { ring, maxDist(axis) -> number, canHold, axisFor(digit) -> axis|null }
 * and return { ok: false } (caller flashes "unavailable") or
 * { ok: true, axis, distance } (caller selects the candidate there).
 */
(function (global) {
  'use strict';

  // Hold with no directional axis: the conceptual pointer sits at 12:00.
  const TWELVE = 'twelve';

  const axisEq = (a, b) => !!a && !!b && a.dx === b.dx && a.dy === b.dy;
  const isVector = (a) => !!a && typeof a === 'object';

  // Axis rings in api board coords (y grows upward), ordered CLOCKWISE on
  // screen so arrow Right advances clockwise, arrow Left counter-clockwise.
  const ORTHO_AXES = [
    { dx: 0, dy: 1 }, { dx: 1, dy: 0 }, { dx: 0, dy: -1 }, { dx: -1, dy: 0 },
  ];
  const DIAG_AXES = [
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 }, { dx: -1, dy: 1 },
  ];
  const ALL_AXES = [
    { dx: 0, dy: 1 }, { dx: 1, dy: 1 }, { dx: 1, dy: 0 }, { dx: 1, dy: -1 },
    { dx: 0, dy: -1 }, { dx: -1, dy: -1 }, { dx: -1, dy: 0 }, { dx: -1, dy: 1 },
  ];
  // Knight "axes" are the eight L-offsets themselves, clockwise from
  // two-up-one-right.
  const KNIGHT_AXES = [
    { dx: 1, dy: 2 }, { dx: 2, dy: 1 }, { dx: 2, dy: -1 }, { dx: 1, dy: -2 },
    { dx: -1, dy: -2 }, { dx: -2, dy: -1 }, { dx: -2, dy: 1 }, { dx: -1, dy: 2 },
  ];
  // Engine lastMoves direction strings → api-coord axes (y grows upward).
  const DIRECTION_AXES = {
    up: { dx: 0, dy: 1 }, down: { dx: 0, dy: -1 },
    left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
  };
  // Numpad digit → api-coord direction, reading the keypad as a compass
  // (8 = up, 9 = up-right, …). 5 is hold, handled inside numpadStep.
  const NUMPAD_AXES = {
    8: { dx: 0, dy: 1 }, 9: { dx: 1, dy: 1 }, 6: { dx: 1, dy: 0 },
    3: { dx: 1, dy: -1 }, 2: { dx: 0, dy: -1 }, 1: { dx: -1, dy: -1 },
    4: { dx: -1, dy: 0 }, 7: { dx: -1, dy: 1 },
  };
  // Knight numpad anchoring: an orthogonal key is two steps that way with
  // the minor step CLOCKWISE (8 = 2up1right, 6 = 2right1down, 2 = 2down1left,
  // 4 = 2left1up); each diagonal key is the counter-clockwise partner of its
  // neighbouring orthogonal (7 = 2up1left, 9 = 2right1up, 3 = 2down1right,
  // 1 = 2left1down). Every key's OPPOSITE key maps to its exact negation,
  // so retract-through-hold works unchanged for knights.
  const KNIGHT_NUMPAD_AXES = {
    8: { dx: 1, dy: 2 }, 6: { dx: 2, dy: -1 }, 2: { dx: -1, dy: -2 }, 4: { dx: -2, dy: 1 },
    7: { dx: -1, dy: 2 }, 9: { dx: 2, dy: 1 }, 3: { dx: 1, dy: -2 }, 1: { dx: -2, dy: -1 },
  };

  function ringFor(unitType) {
    switch (unitType) {
      case 'knight': return KNIGHT_AXES;
      case 'bishop': return DIAG_AXES;
      case 'queen':
      case 'king': return ALL_AXES;
      default: return ORTHO_AXES; // rook, snake, historic letter/emoji units
    }
  }

  function numpadAxisFor(unitType, digit) {
    const map = unitType === 'knight' ? KNIGHT_NUMPAD_AXES : NUMPAD_AXES;
    return map[digit] || null;
  }

  // Clockwise angle from 12:00 in [0, 2π), api coords (y up): straight up is
  // 0, screen-right is π/2.
  function cwAngleFromTwelve(axis) {
    const a = Math.atan2(axis.dx, axis.dy);
    return a < 0 ? a + 2 * Math.PI : a;
  }

  function legalAxes(ctx) {
    return ctx.ring.filter((a) => ctx.maxDist(a) >= 1);
  }

  // From the TWELVE state: the first legal axis strictly clockwise
  // (dir 'right') or strictly counter-clockwise (dir 'left') of 12:00. An
  // axis exactly at 12:00 sweeps a full turn, so it is picked only when it
  // is the sole legal axis.
  function axisFromTwelve(dir, ctx) {
    const TAU = 2 * Math.PI;
    let best = null;
    let bestSweep = Infinity;
    for (const a of legalAxes(ctx)) {
      const cw = cwAngleFromTwelve(a);
      const sweep = cw === 0 ? TAU : (dir === 'right' ? cw : TAU - cw);
      if (sweep < bestSweep) {
        bestSweep = sweep;
        best = a;
      }
    }
    return best;
  }

  const ok = (axis, distance) => ({ ok: true, axis, distance });
  const unavailable = () => ({ ok: false });

  // Universal FACING for a unit, as an api-coord axis from its ring, or null
  // for the 12:00 state (turn 0 / just spawned / the unit held last turn).
  // The ONE shared derivation for keyNav axis seeding AND board icon
  // rotation, live and replay:
  //   - PAWNS: the ENGINE facing (Snake.facing, wire convention: dy grows
  //     DOWNWARD) is authoritative for legality and display — a diagonal
  //     step does not change engine facing, so UI last-move derivation must
  //     not diverge from it.
  //   - Everything else: the engine's authoritative lastMoves direction when
  //     present (snakes), else the direction of last actual movement —
  //     previous head → current head from the previous board. Knights keep
  //     the raw L-offset (their axes ARE the L-offsets); sliders normalize
  //     to a unit axis.
  function deriveFacing(unit, previousBoard, lastMoves) {
    if (!unit) return null;
    if (unit.unitType === 'pawn') {
      const f = unit.facing;
      if (!f || (!f.dx && !f.dy)) return null;
      // Wire facing has y growing downward; api y grows upward.
      return { dx: Math.sign(f.dx), dy: -Math.sign(f.dy) };
    }
    const lastMove = lastMoves && unit.id != null ? lastMoves[unit.id] : null;
    if (lastMove && DIRECTION_AXES[lastMove]) return DIRECTION_AXES[lastMove];
    const head = unit.head || (unit.body && unit.body[0]) || null;
    const prev = previousBoard && previousBoard.snakes
      ? previousBoard.snakes.find((s) => s.id === unit.id)
      : null;
    const prevHead = prev ? prev.head || (prev.body && prev.body[0]) || null : null;
    if (!head || !prevHead) return null; // turn 0 / just appeared → 12:00
    const dx = head.x - prevHead.x;
    const dy = head.y - prevHead.y;
    if (!dx && !dy) return null; // held (didn't move) → 12:00
    if (unit.unitType === 'knight') return { dx, dy };
    return { dx: Math.sign(dx), dy: Math.sign(dy) };
  }

  // KeyNav axis seeding priority: selected candidate → staged move → facing
  // → 12:00. `selNav` is the {axis, distance} derived from the current
  // selection (deriveFromOffset); the staged axis and facing fill in the
  // AXIS only when the earlier sources landed at TWELVE — the distance
  // always reflects the actual selection.
  function seedNav(selNav, stagedAxis, facing) {
    let nav = selNav;
    if (nav.axis === TWELVE && stagedAxis && stagedAxis !== TWELVE) {
      nav = { axis: stagedAxis, distance: nav.distance };
    }
    if (nav.axis === TWELVE && facing) {
      nav = { axis: facing, distance: nav.distance };
    }
    return nav;
  }

  // {axis, distance} ← a candidate offset from the unit's head, so keyboard
  // steering picks up seamlessly from a click. A zero/absent offset is the
  // hold candidate: it keeps prevAxis as memory, else lands in TWELVE.
  function deriveFromOffset(unitType, dx, dy, prevAxis) {
    if (!dx && !dy) return { axis: prevAxis || TWELVE, distance: 0 };
    if (unitType === 'knight') return { axis: { dx, dy }, distance: 1 };
    return {
      axis: { dx: Math.sign(dx), dy: Math.sign(dy) },
      distance: Math.max(Math.abs(dx), Math.abs(dy)),
    };
  }

  // 4-arrow pad transition. dir: 'left' | 'right' | 'up' | 'down'.
  function arrowStep(state, dir, ctx) {
    if (dir === 'left' || dir === 'right') {
      let axis = null;
      if (isVector(state.axis)) {
        const axes = legalAxes(ctx);
        const idx = axes.findIndex((a) => axisEq(a, state.axis));
        if (idx >= 0) {
          axis = axes[(idx + (dir === 'right' ? 1 : -1) + axes.length) % axes.length];
        }
      }
      // TWELVE (or a current axis no longer legal): pick relative to 12:00.
      if (!axis) axis = axisFromTwelve(dir, ctx);
      if (!axis) return unavailable();
      return ok(axis, 1); // switching axis always resets distance to 1
    }
    if (dir === 'up') {
      if (!isVector(state.axis)) {
        // TWELVE: Up adds one unit straight up when that axis is legal for
        // the unit; otherwise (e.g. bishop) it falls back to the first
        // legal axis clockwise of 12:00 — the axis Right would pick. The
        // facing-relative pad applies to EVERY unit: a snake at TWELVE
        // (turn 0, or held facing) gets the board-up move from Up too.
        const straightUp = ctx.ring.find((a) => a.dx === 0 && a.dy === 1);
        const axis = straightUp && ctx.maxDist(straightUp) >= 1
          ? straightUp
          : axisFromTwelve('right', ctx);
        return axis ? ok(axis, 1) : unavailable();
      }
      const d = Math.min(state.distance + 1, ctx.maxDist(state.axis));
      if (d < 1 || d === state.distance) return unavailable();
      return ok(state.axis, d);
    }
    // down: retract one, into hold at 1 — keeping the axis — and never past.
    if (state.distance >= 2) return ok(state.axis, state.distance - 1);
    if (state.distance === 1 && ctx.canHold) return ok(state.axis, 0);
    return unavailable(); // already at hold, or the unit cannot hold
  }

  // Numpad transition. digit: 1-9 (5 = hold).
  function numpadStep(state, digit, ctx) {
    if (digit === 5) {
      if (!ctx.canHold) return unavailable();
      return ok(TWELVE, 0); // selecting hold resets the axis to 12:00
    }
    const axis = ctx.axisFor(digit);
    if (!axis || !ctx.ring.some((a) => axisEq(a, axis))) {
      return unavailable(); // e.g. a diagonal key for a rook
    }
    if (isVector(state.axis) && state.distance >= 1) {
      if (axisEq(state.axis, axis)) {
        // Same direction again: extend one square per press.
        if (state.distance + 1 > ctx.maxDist(axis)) return unavailable();
        return ok(axis, state.distance + 1);
      }
      if (axisEq(state.axis, { dx: -axis.dx, dy: -axis.dy })) {
        // Opposite direction: retract one per press. Reaching hold FLIPS the
        // axis to the direction of travel; units that cannot hold pass
        // straight through to the opposite ray.
        if (state.distance > 1) return ok(state.axis, state.distance - 1);
        if (ctx.canHold) return ok(axis, 0);
        return ctx.maxDist(axis) >= 1 ? ok(axis, 1) : unavailable();
      }
    }
    // A different axis, the retained axis out of hold, or TWELVE: distance 1.
    return ctx.maxDist(axis) >= 1 ? ok(axis, 1) : unavailable();
  }

  const api = {
    TWELVE,
    ORTHO_AXES,
    DIAG_AXES,
    ALL_AXES,
    KNIGHT_AXES,
    NUMPAD_AXES,
    KNIGHT_NUMPAD_AXES,
    axisEq,
    ringFor,
    numpadAxisFor,
    deriveFacing,
    seedNav,
    deriveFromOffset,
    arrowStep,
    numpadStep,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.KeyNavMachine = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
