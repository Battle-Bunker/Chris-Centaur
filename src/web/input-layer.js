/**
 * THE INPUT LAYER — one place where a pointer becomes an operator's intent.
 *
 * Loaded by the browser page as `window.InputLayer` (<script
 * src="/input-layer.js">, before play-game.html's inline script) and by Jest
 * (`require`) for the parts that are pure. It owns three things and nothing
 * else:
 *
 *   1. THE PREFERENCES this round introduces (`input.moveGesture`,
 *      `input.handedness`, `input.targets`) — read through `window.Prefs` when
 *      the operator-preferences module is present, and out of `localStorage`
 *      under the same names when it is not, so the two merge without a second
 *      store. `Prefs` wins whenever it exists.
 *
 *   2. THE GESTURE RECOGNISER: a pure {idle → down → tap | longpress | drag}
 *      machine over pointer coordinates and a clock. It has no DOM in it, so
 *      the tap/long-press/drag thresholds are unit-testable
 *      (src/tests/input-layer.test.ts) rather than only observable through a
 *      browser.
 *
 *   3. THE WIRING, `install(host)`: the recogniser bound to the board and the
 *      rail, and the preference classes stamped on the document element. The
 *      host supplies every action as a callback — this module never reaches
 *      into the page's globals, and it NEVER decides what a gesture means for
 *      the game. `docs/design/ux/12-INPUT-MODALITIES.md` §3.
 *
 * WHAT THIS MODULE IS NOT. It is not a second state machine. Every gesture it
 * recognises ends in a call the KEYBOARD also makes — `selectMove`,
 * `runAction`, `setWaypoint` — so the destination cursor stays the one
 * {axis, distance} machine in `keynav-machine.js` and the lens cursor stays
 * the one in `lens-view.js`. A pointer that selected a candidate a different
 * way would be exactly the defect 02 §3.3 records.
 */
(function (global) {
  'use strict';

  // ── preferences ────────────────────────────────────────────────────────
  //
  // NAMED `input.*` AND READ THROUGH `window.Prefs` FIRST. The operator
  // preferences module owns the settings panel and the persistence; this
  // module owns only what the names mean. Where it is absent (the unit tests,
  // an older page) the same names are read out of localStorage, so an
  // operator's choice survives either way and neither store shadows the other.
  const DEFAULTS = {
    // 'both' — click-click AND drag reach the same selection (02 §3.3, P2).
    // 'click' — drag is inert, for the operator whose hand slips on a release.
    // 'drag' — a press-drag-release is required to SELECT; click-click still
    //          works, because 2.5.7 forbids a drag-only path outright.
    'input.moveGesture': 'both',
    // 'right' (default) | 'left' — mirrors the CONTROL COLUMN only. §1.6.
    'input.handedness': 'right',
    // 'auto' — 24 px floor everywhere, 44 px under a coarse pointer.
    // 'large' — the 44 px figure on every pointer.
    'input.targets': 'auto',
    // The held-press threshold, ms. 450 is between the platform long-press
    // (~500 ms) and the point a press stops reading as a tap.
    'input.longPressMs': 450,
  };

  const ALLOWED = {
    'input.moveGesture': ['both', 'click', 'drag'],
    'input.handedness': ['right', 'left'],
    'input.targets': ['auto', 'large'],
  };

  function pref(name) {
    const fallback = DEFAULTS[name];
    let value;
    const P = global.Prefs;
    if (P && typeof P.get === 'function') {
      try {
        value = P.get(name, fallback);
      } catch (_e) {
        value = undefined;
      }
    }
    if (value === undefined || value === null) {
      try {
        const raw = global.localStorage && global.localStorage.getItem(name);
        if (raw !== null && raw !== undefined) {
          value = typeof fallback === 'number' ? Number(raw) : raw;
        }
      } catch (_e) {
        /* storage unavailable → the default */
      }
    }
    if (value === undefined || value === null) return fallback;
    const allowed = ALLOWED[name];
    if (allowed && allowed.indexOf(value) < 0) return fallback;
    if (typeof fallback === 'number' && !Number.isFinite(value)) return fallback;
    return value;
  }

  function setPref(name, value) {
    const allowed = ALLOWED[name];
    if (allowed && allowed.indexOf(value) < 0) return false;
    const P = global.Prefs;
    if (P && typeof P.set === 'function') {
      try {
        P.set(name, value);
      } catch (_e) {
        /* fall through to the local mirror */
      }
    }
    try {
      if (global.localStorage) global.localStorage.setItem(name, String(value));
    } catch (_e) {
      /* storage unavailable → this session only */
    }
    return true;
  }

  // ── the gesture recogniser ─────────────────────────────────────────────
  //
  // ONE MACHINE, THREE OUTCOMES, and the outcomes are disjoint: a press that
  // became a long-press never also fires a tap, and a press that crossed the
  // slop never fires either. That disjointness is the whole reason this is a
  // machine and not three listeners — three independent timers over the same
  // press is how an interface ends up staging a move AND opening a panel on
  // one gesture.
  //
  // The clock is injected (`now`) and the timer is polled (`tick`) rather than
  // set with setTimeout, so a test can advance time deterministically and the
  // browser can drive it from a single interval. `pointerType` is carried
  // through because a long-press is a TOUCH gesture: the desktop platforms
  // both bind a held primary button to a simulated secondary click (§1.5), so
  // binding our own meaning to it on a mouse would collide with the operating
  // system.
  const SLOP_PX = 8;

  function createGesture(options) {
    const opts = options || {};
    const longPressMs = opts.longPressMs == null ? DEFAULTS['input.longPressMs'] : opts.longPressMs;
    const slop = opts.slop == null ? SLOP_PX : opts.slop;
    // Long-press is bound for coarse pointers only unless a host asks
    // otherwise; see the note above.
    const longPressTypes = opts.longPressTypes || ['touch', 'pen'];
    let state = null;

    const dist = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

    return {
      get active() {
        return state !== null;
      },
      /** The press. Returns nothing — a gesture is only known on release or
       *  on the timer. */
      down(ev) {
        state = {
          id: ev.pointerId == null ? 0 : ev.pointerId,
          type: ev.pointerType || 'mouse',
          from: { x: ev.x, y: ev.y },
          at: { x: ev.x, y: ev.y },
          t0: ev.t,
          moved: false,
          longPressed: false,
          dragging: false,
        };
        return null;
      },
      /** A move while down. Returns `{t:'dragstart'}` the first time the slop
       *  is crossed, `{t:'drag'}` after, and null when there is no press. */
      move(ev) {
        if (!state || (ev.pointerId != null && ev.pointerId !== state.id)) return null;
        state.at = { x: ev.x, y: ev.y };
        if (state.longPressed) return null;
        if (!state.moved && dist(state.from, state.at) > slop) {
          state.moved = true;
          state.dragging = true;
          return { t: 'dragstart', from: state.from, to: state.at, pointerType: state.type };
        }
        if (state.dragging) return { t: 'drag', from: state.from, to: state.at, pointerType: state.type };
        return null;
      },
      /** The clock, polled. Returns `{t:'longpress'}` exactly once per press. */
      tick(t) {
        if (!state || state.moved || state.longPressed) return null;
        if (longPressTypes.indexOf(state.type) < 0) return null;
        if (t - state.t0 < longPressMs) return null;
        state.longPressed = true;
        return { t: 'longpress', at: state.at, pointerType: state.type };
      },
      /** The release. `{t:'tap'}`, `{t:'dragend'}`, or null when the press
       *  already resolved as a long-press. */
      up(ev) {
        if (!state || (ev.pointerId != null && ev.pointerId !== state.id)) return null;
        const s = state;
        state = null;
        if (s.longPressed) return null;
        if (s.dragging) {
          return { t: 'dragend', from: s.from, to: { x: ev.x, y: ev.y }, pointerType: s.type };
        }
        return { t: 'tap', at: { x: ev.x, y: ev.y }, pointerType: s.type, held: ev.t - s.t0 };
      },
      cancel() {
        state = null;
      },
    };
  }

  // ── the preference classes ─────────────────────────────────────────────
  //
  // The two layout preferences are CLASSES ON THE ROOT and nothing else: the
  // stylesheet decides what they mean, so a preference cannot become a code
  // path. `input-coarse` is applied from the media query rather than from a
  // preference, and `input-targets-large` is the preference that forces the
  // same sizing on a fine pointer.
  function applyClasses(doc, get) {
    const root = doc && doc.documentElement;
    if (!root) return null;
    const hand = (get || pref)('input.handedness');
    const targets = (get || pref)('input.targets');
    root.classList.toggle('input-hand-left', hand === 'left');
    root.classList.toggle('input-targets-large', targets === 'large');
    return { hand, targets };
  }

  // ── the wiring ─────────────────────────────────────────────────────────
  //
  // `host` is every game meaning this layer needs, as a callback, so this file
  // knows about presses and the page knows about moves:
  //
  //   boardEl          the permanent ancestor of the canvas
  //   railEl           the rail container (outlives its rows)
  //   cellAt(point)    → {x,y} | null   (board coords, from pixels)
  //   headCell()       → {x,y} | null   (the focused unit's head)
  //   candidateAt(cell)→ moveKey | null (the candidate enumeration)
  //   selectMove(key)                    the ONE selection, keyboard's too
  //   setWaypoint(cell, type)            'green' = goto, 'blue' = near
  //   runAction(name)                    the ONE action dispatcher
  //   armedTarget()    → null|'green'|'blue'  what the next board press means
  //   clearArm()
  //   drillTarget(el)  → true when the element under a held press is drillable
  //
  // Everything is optional; a missing callback disables just its gesture.
  function install(host) {
    const h = host || {};
    const doc = h.document || global.document;
    if (!doc) return null;
    const get = h.pref || pref;
    applyClasses(doc, get);

    const gesture = createGesture({
      longPressMs: get('input.longPressMs'),
      longPressTypes: h.longPressTypes,
    });
    let timer = null;
    const now = () => (global.performance && global.performance.now ? global.performance.now() : Date.now());
    const stopTimer = () => {
      if (timer !== null) {
        global.clearInterval(timer);
        timer = null;
      }
    };
    const startTimer = (fire) => {
      stopTimer();
      timer = global.setInterval(() => {
        const g = gesture.tick(now());
        if (g) {
          stopTimer();
          fire(g);
        } else if (!gesture.active) {
          stopTimer();
        }
      }, 50);
    };

    const point = (e) => ({ x: e.clientX, y: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType, t: now() });

    // ── the board ────────────────────────────────────────────────────────
    //
    // NON-CAPTURING AND AFTER the shipped handler, which stays exactly as it
    // is: the shipped `handleBoardPointerDown` resolves the press (select a
    // unit, pick a candidate, set a waypoint) on the capture phase, and this
    // layer only ever ADDS the two gestures that had no meaning — a drag, and
    // a held press. A press that the shipped handler already answered is
    // still answered by it; the drag simply carries the release to a second
    // `selectMove`, which is the same call the click makes.
    if (h.boardEl) {
      const boardPointerDown = (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (e.target && e.target.closest && e.target.closest('#boardResizeHandle')) return;
        gesture.down(point(e));
        startTimer((g) => onBoardGesture(g, e));
      };
      const onBoardGesture = (g, srcEvent) => {
        if (g.t === 'longpress') {
          // THE TOUCH SECONDARY CLICK. Android and both desktop platforms
          // agree that a held press is the secondary click a touchscreen does
          // not have (§1.5); ours sets the goto target, which is what the
          // right button does. It is bound for touch/pen only, so a mouse's
          // held press is left to the operating system's own simulated
          // secondary click.
          const cell = h.cellAt && h.cellAt(g.at);
          if (cell && h.setWaypoint) {
            if (srcEvent && srcEvent.preventDefault) srcEvent.preventDefault();
            h.setWaypoint(cell, 'green');
          }
          return;
        }
        if (g.t === 'dragend') {
          const mode = get('input.moveGesture');
          if (mode === 'click') return;
          if (!h.cellAt || !h.headCell || !h.candidateAt || !h.selectMove) return;
          const from = h.cellAt(g.from);
          const head = h.headCell();
          // A DRAG IS ONLY A MOVE WHEN IT STARTED ON THE UNIT. Anywhere else
          // it is a stray gesture over the board and must do nothing —
          // silently doing something is how a drag-enabled board eats a
          // mis-swipe.
          if (!from || !head || from.x !== head.x || from.y !== head.y) return;
          const to = h.cellAt(g.to);
          if (!to) return;
          const key = h.candidateAt(to);
          if (key == null) return;
          // The SAME call the click makes — which is the same call the arrow
          // pad makes through `selectMove(key, nav)`. One selection.
          h.selectMove(key);
        }
      };
      h.boardEl.addEventListener('pointerdown', boardPointerDown);
      h.boardEl.addEventListener('pointermove', (e) => {
        const g = gesture.move(point(e));
        if (g && g.t === 'dragstart' && h.onDragStart) h.onDragStart(g);
      });
      const finish = (e) => {
        stopTimer();
        const g = gesture.up(point(e));
        if (g) onBoardGesture(g, e);
      };
      h.boardEl.addEventListener('pointerup', finish);
      h.boardEl.addEventListener('pointercancel', () => {
        stopTimer();
        gesture.cancel();
      });
    }

    // ── the rail ─────────────────────────────────────────────────────────
    //
    // ONE GESTURE ONLY: a held press on a moveset row is the L3 drill. It is
    // the touch twin of `B`, and it is never the ONLY way there — the chip in
    // the control bar carries the same action, because a meaning available
    // only to a timed press is unavailable to a switch user (§1.5, P5).
    if (h.railEl && h.runAction) {
      const railGesture = createGesture({
        longPressMs: get('input.longPressMs'),
        longPressTypes: h.longPressTypes,
      });
      let railTimer = null;
      let railRow = null;
      h.railEl.addEventListener('pointerdown', (e) => {
        railRow = e.target && e.target.closest ? e.target.closest('[data-lens-moveset]') : null;
        if (!railRow) return;
        railGesture.down(point(e));
        if (railTimer !== null) global.clearInterval(railTimer);
        railTimer = global.setInterval(() => {
          const g = railGesture.tick(now());
          if (g) {
            global.clearInterval(railTimer);
            railTimer = null;
            h.runAction('drill');
          } else if (!railGesture.active) {
            global.clearInterval(railTimer);
            railTimer = null;
          }
        }, 50);
      });
      h.railEl.addEventListener('pointermove', (e) => railGesture.move(point(e)));
      const railFinish = (e) => {
        if (railTimer !== null) {
          global.clearInterval(railTimer);
          railTimer = null;
        }
        railGesture.up(point(e));
        railRow = null;
      };
      h.railEl.addEventListener('pointerup', railFinish);
      h.railEl.addEventListener('pointercancel', () => {
        if (railTimer !== null) {
          global.clearInterval(railTimer);
          railTimer = null;
        }
        railGesture.cancel();
      });
    }

    return {
      gesture,
      refresh: () => applyClasses(doc, get),
    };
  }

  const api = {
    DEFAULTS,
    ALLOWED,
    SLOP_PX,
    pref,
    setPref,
    createGesture,
    applyClasses,
    install,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.InputLayer = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
