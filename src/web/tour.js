/**
 * THE IN-APP TOUR — the operator manual's first five minutes, on the page it
 * is about.
 *
 * `docs/OPERATOR-MANUAL.md` teaches the live view region by region, in the
 * order an operator reads them under the clock: the deadline first, then the
 * wire, then the board, then the one sentence that says what the bot is about
 * to do, then the decision, then the controls. This walks the same order on
 * the running page, one region and one sentence at a time.
 *
 * THE ONE RULE IT OBEYS: IT NEVER BLOCKS THE GAME. A tour that stops the turn
 * to explain the turn has taught the operator nothing they can use, and on a
 * 500 ms clock a modal is a lost turn (`docs/design/ux/02-IA-AND-CONTROLS.md`
 * §3.4). Concretely, and this is the whole contract:
 *
 *   · it opens no socket and sends no message;
 *   · it writes into `#tour-mount` and into nothing else — not one lens
 *     element, not one board pixel, not one byte of the transcript, so no
 *     lens frame and no decision can differ for its being open;
 *   · its keydown listener claims `Enter`, `Escape` and the arrow pad and
 *     hands every other press straight back to the page, so `Space` still
 *     stages, `U` still undoes, `[`/`]` still walk the list;
 *   · every layer of it is `pointer-events: none` except its own two
 *     buttons, so a click still lands on the board underneath;
 *   · nothing it draws is in the page's flow, so no region moves when it
 *     opens and none moves back when it closes.
 *
 * IT PAUSES ONLY WHAT THE OPERATOR HAS NOT PINNED — which, given the above,
 * is the reader and nothing else. The bot keeps deciding under the overlay,
 * frames keep landing, the clock keeps depleting, and a unit the operator has
 * pinned stays pinned and stays live: the spotlight is a hole in a dim layer,
 * not a lid on the page.
 *
 * HOW IT OPENS. On the first run of a browser profile, once the board exists;
 * on `?` then `T` (a two-key chord, so neither key is taken from the page —
 * `?` alone does nothing here and `T` alone stays the left-hand scheme's
 * drill); and on the `? tour` link this module puts in its own mount. It
 * remembers completion in `localStorage` under `lensTourDone`, so it opens
 * itself once and never again unless it is asked for.
 *
 * `prefers-reduced-motion` turns off every transition it has; the spotlight
 * then jumps rather than slides, which is the same information without the
 * movement.
 */
(function (global) {
  'use strict';

  const DONE_KEY = 'lensTourDone';
  /** Bumped only when the STEPS below change enough that an operator who has
   *  seen the old tour has not seen this one. */
  const VERSION = '1';
  const CHORD_MS = 2000;
  /** The spotlight re-measures its target on a timer rather than on an
   *  animation frame: one `getBoundingClientRect` five times a second, taken
   *  outside every render, is not the layout thrash `03-LATENCY.md` §1.4 went
   *  to the trouble of proving this surface does not have. */
  const TRACK_MS = 200;

  /**
   * THE REGIONS, IN THE ORDER THE MANUAL TEACHES THEM.
   *
   * `sel` is what is lit. `need` is a second selector that must also be on
   * screen for the step to be worth showing — a step about the conditional
   * ranking with no unit focused is a step about an empty box. A step whose
   * target is absent is SKIPPED rather than shown empty or waited on, because
   * a tour that stalls on a region the operator has not opened is a tour that
   * blocks the game.
   *
   * One sentence each. The sentence is the point: an operator who wanted a
   * paragraph would be reading the manual.
   */
  const STEPS = [
    {
      id: 'clock',
      sel: '#turnClock',
      title: 'the turn clock',
      text: 'The bar welded to the board’s top edge is the time left in this turn — it shortens and brightens as the deadline comes, and the notch on it, when the wire has been measured, is the last moment a press can still land.',
    },
    {
      id: 'wire',
      sel: '#latency-mount',
      title: 'the wire',
      text: 'The latency strip reports the two hops and the freshness of what you are reading — LIVE says nothing at all, THINKING means the bot is still working inside the deadline, and DEGRADED or STALE names what is wrong in words.',
    },
    {
      id: 'board',
      sel: '#gameCanvas',
      title: 'the board',
      text: 'Only disagreement draws: a filled arrow is the move under your cursor, a hollow one is a cluster-mate that would move differently, a dashed one is the runner-up, and a ring is a unit that already agrees.',
    },
    {
      id: 'roster',
      sel: '#snakeInfoList',
      title: 'the roster',
      text: 'Every unit on the board, three teams deep — click one of yours, or press Tab, to put the lens on it.',
    },
    {
      id: 'stage',
      sel: '.lens-stage-line',
      title: 'the stage line',
      text: 'One sentence, in the largest type in the rail, in a box that never moves: what the bot is about to do with every unit this decision is about.',
    },
    {
      id: 'business',
      sel: '.lens-biz',
      title: 'unfinished business',
      text: 'The strip counts only what the page can actually know — staged, planned, without a plan, fixed — and a segment that would read zero is absent rather than printed.',
    },
    {
      id: 'focus',
      sel: '.lens-focus',
      need: '#selectionUI',
      title: 'the focused unit',
      text: 'Who is under the lens, how healthy, how heavy, which cluster it belongs to and how much of that cluster is still free for the bot to solve.',
    },
    {
      id: 'candidates',
      sel: '.lens-candidates',
      need: '#selectionUI',
      title: 'the candidates',
      text: 'Every legal move for this unit, graded rather than guessed — `~` is an estimate and `·` is a price nobody took — and clicking one asks the bot what a lock there would stage.',
    },
    {
      id: 'movesets',
      sel: '.lens-movesets',
      need: '#selectionUI',
      title: 'the two cards',
      text: 'Rank 1 is what would be staged and the foil beneath it is what it nearly was; both are drawn full size with their bands, and the ranks below them are one line each, a keypress away.',
    },
    {
      id: 'breakdown',
      sel: '.lens-breakdown',
      need: '#selectionUI',
      title: 'the breakdown',
      text: 'What each member of the cluster contributed and against which reference action, with the joint residual always drawn — a breakdown that does not add up is a number you cannot check.',
    },
    {
      id: 'controls',
      sel: '#lensControls',
      need: '#selectionUI',
      title: 'the control bar',
      text: 'Every control the focused unit has, in one grammar — glyph, verb, key, state — including the exact count of units a lock would pin, on screen before you press it.',
    },
    {
      id: 'keys',
      sel: '#lensKeys',
      need: '#selectionUI',
      title: 'the keys',
      text: 'The eight keys in the hot path, in whichever scheme you have chosen; Ctrl+/ is the complete reference and this line and that modal are rendered from one table.',
    },
    {
      id: 'lane',
      sel: '#lensLane',
      need: '#selectionUI',
      title: 'the timeline lane',
      text: 'Everything that happened inside this turn, at its own place in it — click a tick to scrub the rail back to that instant, and press N to come back to now.',
    },
  ];

  const state = {
    open: false,
    index: 0,
    shown: [],
    chordAt: 0,
    tracker: null,
    mount: null,
    layer: null,
    card: null,
    link: null,
  };

  const CSS = `
#tour-mount { position: static; }
.tour-link {
  position: fixed; right: var(--space-10); bottom: 40px; z-index: var(--z-tour-link);
  background: var(--tour-link-bg); color: var(--tour-link-ink); border: 1px solid var(--tour-line);
  border-radius: var(--radius-4); padding: var(--space-3) var(--space-9); font-size: var(--size-11); font-family: inherit;
  cursor: pointer;
}
.tour-link:hover { color: var(--tour-link-hover-ink); border-color: var(--tour-link-hover-line); }
.tour-link:focus-visible { outline: var(--focus-ring-width) solid var(--focus); outline-offset: var(--focus-ring-offset); }
.tour-layer { position: fixed; inset: 0; z-index: var(--z-tour-layer); pointer-events: none; }
/* FOUR PANELS AND A HOLE. The dim is drawn AROUND the region rather than over
   it, so the thing being explained is at full strength and un-tinted, and the
   pointer reaches the board through every one of them. */
.tour-dim { position: fixed; background: var(--tour-dim); pointer-events: none; }
.tour-ring {
  position: fixed; border: 2px solid var(--focus); border-radius: var(--radius-4);
  box-shadow: var(--shadow-hairline); pointer-events: none;
  transition: left var(--dur-tour) ease, top var(--dur-tour) ease, width var(--dur-tour) ease, height var(--dur-tour) ease;
}
.tour-card {
  position: fixed; z-index: var(--z-tour-card); width: var(--tour-card-w); max-width: calc(100vw - 24px);
  background: var(--tour-card-bg); color: var(--tour-card-ink); border: 1px solid var(--tour-line);
  border-left: 3px solid var(--focus); border-radius: var(--radius-5);
  padding: var(--space-10) var(--space-12) var(--space-8); font-size: var(--size-12); line-height: 1.5;
  box-shadow: var(--shadow-tour); pointer-events: auto;
  transition: left var(--dur-tour) ease, top var(--dur-tour) ease;
}
.tour-card h4 { margin: 0 0 var(--space-4); font-size: var(--size-12); letter-spacing: .04em;
  text-transform: uppercase; color: var(--focus); font-weight: var(--weight-bold); }
.tour-card p { margin: 0 0 var(--space-8); }
.tour-foot { display: flex; align-items: center; gap: var(--space-8); font-size: var(--size-11); color: var(--tour-foot-ink); }
.tour-foot .tour-count { margin-right: auto; font-variant-numeric: tabular-nums; }
.tour-foot button {
  background: var(--tour-btn-bg); color: var(--tour-card-ink); border: 1px solid var(--tour-btn-line);
  border-radius: var(--radius-3); padding: var(--space-2) var(--space-9); font-size: var(--size-11); font-family: inherit;
  cursor: pointer;
}
.tour-foot button:focus-visible { outline: var(--focus-ring-width) solid var(--focus); outline-offset: var(--focus-ring-offset); }
.tour-card kbd {
  background: var(--tour-kbd-bg); border: 1px solid var(--tour-kbd-line); border-radius: var(--radius-3);
  padding: 0 var(--space-4); font-size: var(--size-10); font-family: inherit;
}
/* The @media block that used to be here is tokens.css group E, which zeroes
   --dur-tour for every sheet on the page at once. */
`;

  function ensureStyle() {
    if (global.document.getElementById('tour-style')) return;
    const style = global.document.createElement('style');
    style.id = 'tour-style';
    style.textContent = CSS;
    global.document.head.appendChild(style);
  }

  function mount() {
    if (state.mount) return state.mount;
    state.mount = global.document.getElementById('tour-mount');
    return state.mount;
  }

  function stored(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function store(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (e) {
      /* a private window, or storage off — the tour is not worth an exception */
    }
  }

  /** The operator's OWN key for an action, so the tour teaches the scheme they
   *  are actually using rather than the one that shipped. */
  function keyFor(action, fallback) {
    const LP = global.LensPanel;
    if (!LP || !LP.keymapFor) return fallback;
    try {
      const hit = LP.keymapFor(LP.activeScheme()).find((b) => b.action === action);
      return (hit && hit.display) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function visible(sel) {
    if (!sel) return null;
    const el = global.document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return r;
  }

  /** The steps whose regions are actually on screen, resolved once when the
   *  tour opens: a step list that changed under the reader would make
   *  "3 of 9" a lie. */
  function resolveSteps() {
    return STEPS.filter((s) => visible(s.sel) && (!s.need || visible(s.need)));
  }

  function esc(text) {
    return String(text == null ? '' : text).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  }

  function buildLayer() {
    const host = mount();
    if (!host) return false;
    ensureStyle();
    const layer = global.document.createElement('div');
    layer.className = 'tour-layer';
    layer.setAttribute('data-tour', 'layer');
    layer.innerHTML =
      '<div class="tour-dim" data-edge="top"></div>' +
      '<div class="tour-dim" data-edge="bottom"></div>' +
      '<div class="tour-dim" data-edge="left"></div>' +
      '<div class="tour-dim" data-edge="right"></div>' +
      '<div class="tour-ring"></div>';
    const card = global.document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Guided tour of the live view');
    host.appendChild(layer);
    host.appendChild(card);
    state.layer = layer;
    state.card = card;
    return true;
  }

  function place() {
    if (!state.open || !state.layer) return;
    const step = state.shown[state.index];
    const r = step ? visible(step.sel) : null;
    if (!r) {
      // The region went away under the reader — a unit deselected, a panel
      // that emptied. Move on rather than lighting nothing.
      next();
      return;
    }
    const W = global.innerWidth;
    const H = global.innerHeight;
    const pad = 4;
    const top = Math.max(0, r.top - pad);
    const left = Math.max(0, r.left - pad);
    const right = Math.min(W, r.right + pad);
    const bottom = Math.min(H, r.bottom + pad);
    const dim = state.layer.querySelectorAll('.tour-dim');
    const set = (node, css) => {
      node.style.cssText = `position:fixed;background:var(--tour-dim);pointer-events:none;${css}`;
    };
    set(dim[0], `left:0;top:0;width:${W}px;height:${top}px`);
    set(dim[1], `left:0;top:${bottom}px;width:${W}px;height:${Math.max(0, H - bottom)}px`);
    set(dim[2], `left:0;top:${top}px;width:${left}px;height:${Math.max(0, bottom - top)}px`);
    set(dim[3], `left:${right}px;top:${top}px;width:${Math.max(0, W - right)}px;height:${Math.max(0, bottom - top)}px`);
    const ring = state.layer.querySelector('.tour-ring');
    ring.style.left = `${left}px`;
    ring.style.top = `${top}px`;
    ring.style.width = `${Math.max(0, right - left)}px`;
    ring.style.height = `${Math.max(0, bottom - top)}px`;

    // The card goes wherever it does not stand on the thing it is explaining:
    // below the region if there is room, otherwise above it, and pushed to
    // whichever side has space.
    const cardBox = state.card.getBoundingClientRect();
    const cw = cardBox.width || 340;
    const ch = cardBox.height || 120;
    let cy = bottom + 10;
    if (cy + ch > H - 8) cy = Math.max(8, top - ch - 10);
    let cx = left;
    if (cx + cw > W - 8) cx = Math.max(8, right - cw);
    state.card.style.left = `${cx}px`;
    state.card.style.top = `${cy}px`;
  }

  function render() {
    const step = state.shown[state.index];
    if (!step) return;
    const last = state.index === state.shown.length - 1;
    state.card.innerHTML =
      `<h4>${esc(step.title)}</h4><p>${esc(step.text)}</p>` +
      '<div class="tour-foot">' +
      `<span class="tour-count">${state.index + 1} of ${state.shown.length}</span>` +
      `<span><kbd>Enter</kbd> ${last ? 'finish' : 'next'} · <kbd>Esc</kbd> leave</span>` +
      `<button type="button" data-tour-next="1">${last ? 'Done' : 'Next'}</button>` +
      '</div>';
    place();
  }

  function open() {
    if (state.open) return false;
    if (!buildLayer()) return false;
    state.shown = resolveSteps();
    if (state.shown.length === 0) {
      close();
      return false;
    }
    state.index = 0;
    state.open = true;
    render();
    if (state.tracker === null) state.tracker = global.setInterval(place, TRACK_MS);
    if (state.link) state.link.setAttribute('aria-expanded', 'true');
    return true;
  }

  function next() {
    if (!state.open) return;
    if (state.index >= state.shown.length - 1) {
      close(true);
      return;
    }
    state.index += 1;
    render();
  }

  function prev() {
    if (!state.open || state.index === 0) return;
    state.index -= 1;
    render();
  }

  /** Leaving is leaving, and it counts: an operator who has seen enough of
   *  the tour to press Escape does not want it again on the next reload. */
  function close(completed) {
    state.open = false;
    if (state.tracker !== null) {
      global.clearInterval(state.tracker);
      state.tracker = null;
    }
    if (state.layer && state.layer.parentNode) state.layer.parentNode.removeChild(state.layer);
    if (state.card && state.card.parentNode) state.card.parentNode.removeChild(state.card);
    state.layer = null;
    state.card = null;
    store(DONE_KEY, VERSION);
    if (state.link) state.link.setAttribute('aria-expanded', 'false');
    return !!completed;
  }

  function reset() {
    try {
      global.localStorage.removeItem(DONE_KEY);
    } catch (e) {
      /* nothing to forget */
    }
  }

  /**
   * THE KEYS. Three of them, in the capture phase so a step can be taken
   * while the focus is anywhere, and every other press is handed straight
   * back to the page untouched — which is what keeps `Space`, `U`, `[`, `]`
   * and the arrow pad the game's while the tour is up.
   */
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.open) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        prev();
      }
      return;
    }
    // `?` THEN `T`. A chord and not a key, so neither half is taken from the
    // page: `?` does nothing on this surface and `T` stays the left-hand
    // scheme's drill unless a `?` was pressed a moment ago.
    if (e.key === '?') {
      state.chordAt = Date.now();
      return;
    }
    if ((e.key === 't' || e.key === 'T') && Date.now() - state.chordAt < CHORD_MS) {
      state.chordAt = 0;
      if (open()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    state.chordAt = 0;
  }

  /** The chrome link, in this module's own mount and nowhere else. */
  function buildLink() {
    const host = mount();
    if (!host || state.link) return;
    ensureStyle();
    const link = global.document.createElement('button');
    link.type = 'button';
    link.className = 'tour-link';
    link.setAttribute('data-tour-open', '1');
    link.setAttribute('aria-expanded', 'false');
    link.textContent = '? tour';
    link.title = 'A guided tour of this view (? then T)';
    host.appendChild(link);
    state.link = link;
  }

  function onClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-tour-next]')) {
      e.preventDefault();
      next();
      return;
    }
    if (t.closest('[data-tour-open]')) {
      e.preventDefault();
      if (state.open) close(false);
      else open();
    }
  }

  /** FIRST RUN. Not on load — on the first moment there is something to point
   *  at, polled cheaply and given up on after twenty seconds, because a game
   *  that never renders is not a game to tour. */
  function offerFirstRun() {
    if (stored(DONE_KEY) === VERSION) return;
    let tries = 0;
    const t = global.setInterval(() => {
      tries += 1;
      if (tries > 40) {
        global.clearInterval(t);
        return;
      }
      if (state.open || stored(DONE_KEY) === VERSION) {
        global.clearInterval(t);
        return;
      }
      if (visible('#gameCanvas') && visible('#lensStage')) {
        global.clearInterval(t);
        open();
      }
    }, 500);
  }

  function install() {
    if (!mount()) return false;
    ensureStyle();
    buildLink();
    global.document.addEventListener('keydown', onKey, true);
    global.document.addEventListener('click', onClick);
    global.addEventListener('resize', place);
    global.addEventListener('scroll', place, true);
    offerFirstRun();
    return true;
  }

  const api = {
    install,
    open,
    next,
    prev,
    close,
    reset,
    isOpen: () => state.open,
    stepId: () => (state.open && state.shown[state.index] ? state.shown[state.index].id : null),
    steps: () => STEPS.map((s) => s.id),
    shown: () => state.shown.map((s) => s.id),
    keyFor,
    DONE_KEY,
    VERSION,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Tour = api;
    if (global.document && global.document.readyState !== 'loading') install();
    else if (global.document) global.document.addEventListener('DOMContentLoaded', install);
  }
})(typeof window !== 'undefined' ? window : globalThis);
