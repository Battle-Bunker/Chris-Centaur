/**
 * THE PERIPHERAL ALERT CHANNEL — what pulls an operator back who is not looking.
 *
 * `01-RESEARCH.md` P1 says the first 300 ms of a turn is one preattentive
 * glance and that the periphery reads MOTION and BRIGHTNESS, not text or
 * colour. `02-IA-AND-CONTROLS.md` built the surfaces that glance lands on —
 * the clock bar, the stage line, the unfinished-business strip, the cards —
 * and `03-LATENCY.md` put a ladder and a last-safe-press notch on the wire.
 * Every one of those assumes THE OPERATOR IS LOOKING AT THIS WINDOW. This
 * module is for the moments they are not: reading the breakdown, in another
 * tab, watching the other screen. It is the only surface here allowed to spend
 * attention the operator did not offer, so it is also the only one with a
 * budget, a mute and a per-event opt-out.
 *
 * WHAT IT OWNS. `<div id="alerts-mount">` — a preferences button, its popover
 * and a polite live region — plus one `position: fixed` ring appended to the
 * body and drawn over the board's own box (see `ensureMount` for why it
 * cannot live in the mount). Nothing else on the page is written by this file.
 * It sends nothing on the socket, it never focuses, never scrolls, never
 * opens a dialog and never changes what is staged: an alert that could change
 * a decision is a decision made by the alarm.
 *
 * WHERE THE EVENTS COME FROM. `WSClient.observe` — the same envelopes the
 * panels already receive, on the socket the page already has — and
 * `LatencyView.read()` for the wire's own ladder. NO NEW MESSAGE TYPE: an
 * alert channel that needs the server to tell it when to shout is an alert
 * channel that stops working the moment the server is the thing that is wrong.
 * Three facts it wanted and the wire does not carry are named in
 * `docs/design/ux/06-ALERTS.md` §6 with the proxies used instead.
 *
 * THE THREE CHANNELS, and none of them is a dialog:
 *   · a VISUAL PULSE at the board's edge — one transient, luminance and
 *     motion, never more than ~1.4 onsets a second (WCAG 2.3.1 allows three;
 *     this stays at half of it) and no animation at all under
 *     `prefers-reduced-motion`, where it holds still and then leaves;
 *   · an EARCON — a short synthesised motif, no assets, no speech, started
 *     only after a user gesture because every browser suspends an
 *     `AudioContext` created without one;
 *   · a browser NOTIFICATION, and only when `document.hidden` — a notification
 *     for a page the operator is looking at is a second copy of a thing they
 *     can already see.
 *
 * Designed, measured and justified in `docs/design/ux/06-ALERTS.md`.
 */
(function (global) {
  'use strict';

  // ── The glance, and the turn ────────────────────────────────────────────
  //
  // P1's 300 ms. An alert raised inside the first glance of a turn is riding
  // an eye that is already on the board, so it gets the pulse and NOT the
  // sound: the sound exists to buy a saccade that is already being made.
  const GLANCE_MS = 300;

  const DEFAULT_BUDGET_MS = 500;   // the same fallback `latency.js` uses
  const POLL_MS = 250;             // the ladder is polled, not pushed

  // ── The flash budget ────────────────────────────────────────────────────
  //
  // WCAG 2.3.1 (Level A) forbids more than three flashes in any one second.
  // A pulse here is one onset and one decay, and a new one is refused inside
  // PULSE_MIN_GAP_MS of the last — so the worst case this module can produce
  // is 1000/700 ≈ 1.4 onsets a second, comfortably under the limit even
  // before the general-flash threshold (the ring is a thin border at low
  // saturation, never a full-screen red) is taken into account.
  const PULSE_MS = 900;
  const PULSE_MIN_GAP_MS = 700;

  // ── The sound budget ────────────────────────────────────────────────────
  //
  // EEMUA 191 / ISA-18.2 put a steady-state process operator at about one
  // alarm per ten minutes and call ten in ten minutes a flood. Those numbers
  // are for a shift, and our operator's unit of time is a 500 ms turn, so the
  // shape of the rule is taken and the base is not: the per-event cooldown is
  // expressed in TURN BUDGETS (as every threshold in `03-LATENCY.md` §3.2 is),
  // and the rolling-minute ceiling is what catches a wire that flaps.
  const EARCON_MIN_GAP_MS = 700;   // two earcons never overlap or run together
  const EARCON_PER_TURN = 2;       // a turn that needs three things said is a turn already lost
  const EARCON_WINDOW_MS = 60000;
  const EARCON_PER_WINDOW = 8;

  // A standing condition that survives this many CONSECUTIVE turns escalates
  // one step: the earcon gains a pulse and a hidden tab earns a notification
  // it would not otherwise get. It does NOT get louder and it does not repeat
  // faster — a repeating alarm is the mechanism by which alarms stop being
  // heard.
  const ESCALATE_TURNS = 3;

  const LOG_MAX = 200;

  /**
   * THE CATALOGUE. One row per thing that may interrupt, and nothing may
   * interrupt that is not on it.
   *
   *   priority  1 highest. Chooses the earcon motif and the ring's weight.
   *   gapTurns  the per-event cooldown, in turn budgets.
   *   gapMs     ...with an absolute floor, for a game with a short budget.
   *   notify    may raise a browser Notification when the tab is hidden.
   *             An event without it can still earn one by escalating.
   */
  const EVENTS = {
    'fatal-unpinned': {
      priority: 1,
      gapTurns: 2,
      gapMs: 1500,
      notify: true,
      label: 'a unit is one turn from a fatal cell',
      say: (d) => `${d.unit || 'a unit'} is one turn from a fatal cell and nothing has pinned it`,
    },
    'press-window': {
      priority: 2,
      gapTurns: 1,
      gapMs: 1200,
      notify: false,
      label: 'the last safe press has passed',
      say: (d) =>
        `past the last safe press with ${d.unfinished} unit${d.unfinished === 1 ? '' : 's'} unfinished`,
    },
    'wire-stale': {
      priority: 2,
      gapTurns: 4,
      gapMs: 2500,
      notify: true,
      label: 'the board on screen is stale',
      say: (d) => d.why || 'no decision frame since this turn’s deadline',
    },
    'wire-degraded': {
      priority: 3,
      gapTurns: 6,
      gapMs: 4000,
      notify: false,
      label: 'the wire is degraded',
      say: (d) => d.why || 'the wire is degraded',
    },
    'lock-refused': {
      priority: 2,
      gapTurns: 1,
      gapMs: 900,
      notify: true,
      label: 'the server refused a press',
      say: (d) => d.why || 'the server refused that press',
    },
    'stage-drift': {
      priority: 3,
      gapTurns: 2,
      gapMs: 1500,
      notify: false,
      label: 'the bot re-staged a unit you had determined',
      say: (d) => `the bot is staging ${d.unit || 'a unit'} you had determined (${d.mode})`,
    },
  };

  const EVENT_IDS = Object.keys(EVENTS);

  /** The events a preattentive glance at a fresh board already answers —
   *  `01-RESEARCH.md` P1's list, one for one. See `earcon()`. */
  const GLANCE_ANSWERS = {
    'press-window': true,     // "time left", as a shape on the clock
    'wire-stale': true,       // "is this frame live and fresh"
    'wire-degraded': true,    // ditto
  };

  // ── Preferences ─────────────────────────────────────────────────────────
  //
  // WCAG 1.4.2 wants a way to stop sound and a volume independent of the
  // system's; every alarm guideline in §2 of the doc wants a per-event
  // opt-out, because the one thing that reliably kills an alert channel is a
  // channel the operator cannot narrow and therefore mutes whole.
  //
  // THE VALUES LIVE IN `prefs.js` (docs/design/ux/12-PREFERENCES.md §2.3).
  // This module says which four preferences it reads and how they map onto
  // the shape the rest of the file already uses; the store owns the defaults,
  // the validation, the migration from the old `centaurAlerts` key and the
  // change events — including the one from another tab, which this channel
  // never had. The popover on the alert button and the settings panel are two
  // affordances onto ONE value, which is a UI decision (the mute must be one
  // click from the alert that is annoying you); two stores would be the
  // duplication `12` is about.
  const PREF_IDS = ['alerts.muted', 'alerts.volume', 'alerts.notify', 'alerts.events'];

  function defaults() {
    const events = {};
    for (const id of EVENT_IDS) events[id] = true;
    return { muted: false, volume: 0.6, notify: false, events };
  }

  let prefs = defaults();

  /** A page with no store — a fixture, a unit test — keeps the defaults and
   *  loses only the persistence. */
  function prefStore() {
    return global.Prefs && typeof global.Prefs.get === 'function' ? global.Prefs : null;
  }

  function loadPrefs() {
    const P = prefStore();
    if (!P) { prefs = defaults(); return prefs; }
    const events = P.get('alerts.events') || {};
    const out = defaults();
    out.muted = P.get('alerts.muted');
    out.notify = P.get('alerts.notify');
    out.volume = P.get('alerts.volume');
    // THE CATALOGUE IS THIS FILE'S. The store carries a flag per event id and
    // an id it does not know takes its default here rather than there, so a
    // new row in `EVENTS` needs no migration.
    for (const id of EVENT_IDS) {
      if (typeof events[id] === 'boolean') out.events[id] = events[id];
    }
    prefs = out;
    return prefs;
  }

  function savePrefs() {
    const P = prefStore();
    if (!P) return;   // private mode; the preference still holds for this page
    P.setMany({
      'alerts.muted': prefs.muted,
      'alerts.volume': prefs.volume,
      'alerts.notify': prefs.notify,
      'alerts.events': prefs.events,
    });
  }

  // ── State ───────────────────────────────────────────────────────────────

  const wire = {
    turn: null,
    turnAt: 0,                 // local ms at which this turn's board landed
    budgetMs: DEFAULT_BUDGET_MS,
    staged: {},                // snakeId -> StagedMoveView, as broadcast
    modes: {},                 // snakeId -> IntentMode, as broadcast
    /** Units the operator pressed on THIS turn. A stage the operator asked
     *  for is not drift, and the only record of who asked is the outbound
     *  envelope this module watched go past. */
    touched: new Set(),
    touchedTurn: null,
  };

  const armed = Object.create(null);   // id -> {at, turn, key, streak, lastTurn}
  const log = [];
  const stats = {
    raised: 0,
    pulsed: 0,
    sounded: 0,
    notified: 0,
    suppressed: { off: 0, cooldown: 0, budget: 0, muted: 0, glance: 0, flash: 0, silent: 0 },
  };

  let earconAt = 0;
  let earconTurnCount = 0;
  let earconTurn = null;
  const earconWindow = [];
  let pulseAt = 0;

  function nowMs() { return Date.now(); }

  function ladder() {
    const api = global.LatencyView;
    if (!api || typeof api.read !== 'function') return null;
    try { return api.read(); } catch (e) { return null; }
  }

  // ── Reading the wire ────────────────────────────────────────────────────
  //
  // Every branch below reads an envelope `play-game.html` already handles.
  // Nothing here asks for anything, and nothing here is a second copy of the
  // page's parse: this is the SAME parsed object, handed past on its way to
  // the page's own handler by `ws-client.js`'s observatory.

  /** The outbound press. Watched only so a stage the operator asked for is
   *  never reported back to them as the bot's doing. */
  const OPERATOR_PRESSES = {
    'select-move': 'snakeId',
    'set-waypoint': 'snakeId',
    'clear-human-input': 'snakeId',
    'toggle-hold': 'snakeIds',
    'lens-lock': 'pins',
    'confirm-fatal-move': 'snakeId',
    'commit-all-staged': null,
  };

  function noteOutbound(msg) {
    if (!msg || !msg.type) return;
    if (!(msg.type in OPERATOR_PRESSES)) return;
    if (wire.touchedTurn !== wire.turn) {
      wire.touched.clear();
      wire.touchedTurn = wire.turn;
    }
    const field = OPERATOR_PRESSES[msg.type];
    if (field === null) {
      for (const id of Object.keys(wire.staged)) wire.touched.add(id);
      return;
    }
    const value = msg[field];
    if (typeof value === 'string') wire.touched.add(value);
    else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === 'string') wire.touched.add(entry);
        else if (entry && typeof entry.unit === 'string') wire.touched.add(entry.unit);
      }
    }
  }

  function absorbBoard(msg) {
    const turn = typeof msg.turn === 'number' ? msg.turn : wire.turn;
    if (turn !== wire.turn) {
      wire.turn = turn;
      wire.turnAt = nowMs();
      wire.touched.clear();
      wire.touchedTurn = turn;
      earconTurn = turn;
      earconTurnCount = 0;
    }
    if (msg.stagedMoves) wire.staged = msg.stagedMoves;
    if (msg.activeIntentModes) wire.modes = msg.activeIntentModes;
  }

  function absorbSelections(msg) {
    if (msg.stagedMoves) wire.staged = msg.stagedMoves;
    if (msg.activeIntentModes) wire.modes = msg.activeIntentModes;
  }

  /**
   * THE UNIT SCAN — the two per-unit alerts, off `stagedMoves` and
   * `activeIntentModes`, which every `board-update` and `selections-update`
   * already carries.
   *
   * FATAL AND UNPINNED. `StagedMoveView.fatal` is the server's own
   * certain-death verdict on the move that is staged; `committed` is whether
   * the turn has frozen it. What is deliberately NOT alerted is a fatal move
   * the operator asked for: `activeIntentModes` says `manual`, which means
   * they went through the consent dialog to put the unit there. Shouting at
   * an operator for a decision they confirmed one press ago is how a channel
   * teaches its operator to mute it.
   *
   * DRIFT. A unit under a standing determination (`goto`, `near`, `hold`,
   * `manual`) whose staged move came from the bot — `source` is `bot` or
   * `fallback`, which `active-game-manager.ts` sets truthfully precisely so
   * this can be told apart — or whose requested move changed on a turn the
   * operator did not press. That is `getWaypointBiasedMove` having failed and
   * the heuristic having taken the unit back, which the board draws in grey
   * and which nothing says out loud.
   */
  const DRIFT_SOURCES = { bot: true, fallback: true };
  const lastRequested = Object.create(null);

  function scanUnits() {
    for (const id of Object.keys(wire.staged)) {
      const sm = wire.staged[id];
      if (!sm || typeof sm !== 'object') continue;
      const mode = wire.modes[id] || 'heuristic';

      if (sm.fatal === true && sm.committed !== true && mode !== 'manual') {
        raise('fatal-unpinned', { unit: id, mode, key: `${id}:${wire.turn}` });
      }

      const requested = sm.requestedMove === undefined ? null : String(sm.requestedMove);
      const previous = lastRequested[id];
      lastRequested[id] = { turn: wire.turn, move: requested };
      if (mode === 'heuristic') continue;
      if (wire.touched.has(id)) continue;
      const botSourced = DRIFT_SOURCES[sm.source] === true;
      // A CHANGE ONLY COUNTS INSIDE ONE TURN. Every turn restages every unit,
      // so a move that differs from the previous TURN's is the ordinary
      // operation of a standing waypoint and not news. What is news is the
      // move changing under the operator mid-turn without a press of theirs,
      // or the source falling back to the bot at all.
      const changed =
        previous !== undefined && previous.turn === wire.turn && previous.move !== requested;
      if (botSourced || changed) {
        raise('stage-drift', {
          unit: id,
          mode,
          from: previous === undefined ? null : previous.move,
          to: requested,
          key: `${id}:${wire.turn}`,
        });
      }
    }
  }

  /** Unfinished business, as `02-IA-AND-CONTROLS.md` §2.2 counts it: a unit
   *  this centaur controls whose move for this turn is not frozen. */
  function unfinished() {
    let n = 0;
    for (const id of Object.keys(wire.staged)) {
      const sm = wire.staged[id];
      if (sm && sm.committed !== true) n++;
    }
    return n;
  }

  function onInbound(msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'board-update':
        absorbBoard(msg);
        scanUnits();
        break;
      case 'selections-update':
        absorbSelections(msg);
        scanUnits();
        break;
      case 'fatal-move-confirmation-needed':
        // The server refused an unconsented certain-death press and staged
        // the bot's move instead. This is the one fatal signal that arrives
        // whether or not anybody was looking, and it is always worth saying.
        raise('fatal-unpinned', {
          unit: msg.snakeId || null,
          move: msg.move || null,
          key: `${msg.snakeId}:${msg.turn}`,
        });
        break;
      case 'lens-lock':
        if (msg.ok === false) {
          raise('lock-refused', {
            what: 'lock',
            why: `lock refused — ${msg.detail || msg.refusal || 'no reason given'}`,
            key: `lock:${msg.detail || msg.refusal}`,
          });
        }
        break;
      case 'toggle-hold-result':
        if (msg.ok === false) {
          raise('lock-refused', {
            what: 'hold',
            why: `hold refused — ${msg.reason || 'no reason given'}`,
            key: `hold:${msg.reason}`,
          });
        }
        break;
      case 'selection-contested':
      case 'selection-revoked':
        raise('lock-refused', {
          what: 'selection',
          why:
            msg.type === 'selection-revoked'
              ? 'another operator took a unit you held'
              : 'another operator holds that unit',
          key: `${msg.type}:${msg.snakeId || ''}`,
        });
        break;
      default:
        break;
    }
  }

  // ── The ladder, polled ──────────────────────────────────────────────────
  //
  // `LatencyView` owns the ladder and draws it; this reads the same object it
  // draws from, so an alert and the strip can never disagree about the rung.
  // A rung is alerted on its EDGE — the transition into it — and a standing
  // rung then escalates by turn count rather than by repeating.

  let lastRung = null;

  function poll() {
    const r = ladder();
    if (!r) return;
    if (typeof r.budgetMs === 'number' && r.budgetMs > 0) wire.budgetMs = r.budgetMs;

    // NOTHING IS ALERTED BEFORE THE WIRE HAS EVER BEEN UP. `LatencyView`
    // correctly reads DISCONNECTED for the second or two between the page
    // loading and the socket opening, and an alarm every operator hears on
    // every page load is the textbook nuisance alert — the one that teaches
    // them the channel is wrong before it has ever been right. The ladder is
    // only alerted on once a `board-update` has arrived; after that a close
    // is real news and is treated as such.
    if (wire.turn === null) {
      lastRung = r.state;
      return;
    }

    const rung = r.state;
    if (rung !== lastRung) {
      lastRung = rung;
      if (rung === 'STALE' || rung === 'DISCONNECTED') {
        raise('wire-stale', { why: r.why, rung, key: rung });
      } else if (rung === 'DEGRADED') {
        raise('wire-degraded', { why: r.why, rung, key: rung });
      }
    } else if (rung === 'STALE' || rung === 'DISCONNECTED') {
      raise('wire-stale', { why: r.why, rung, key: rung });
    } else if (rung === 'DEGRADED') {
      raise('wire-degraded', { why: r.why, rung, key: rung });
    }

    // THE NOTCH, AND WHAT IS STILL OPEN. `03-LATENCY.md` §3 draws the last
    // safe press as a mark on the clock; this is the same fact as an event.
    // It fires only while the clock is still running — past the deadline the
    // ladder is already saying something louder — and only when there is
    // something left to press about.
    if (
      r.remainingMs !== null &&
      r.pressSlackMs !== null &&
      r.remainingMs > 0 &&
      r.remainingMs <= r.pressSlackMs
    ) {
      const left = unfinished();
      if (left > 0) {
        raise('press-window', { unfinished: left, remainingMs: r.remainingMs, key: `turn:${wire.turn}` });
      }
    }
  }

  // ── Raising ─────────────────────────────────────────────────────────────

  function record(entry) {
    log.push(entry);
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  }

  function raise(id, detail) {
    const spec = EVENTS[id];
    if (!spec) return null;
    const now = nowMs();
    const key = detail && detail.key !== undefined ? String(detail.key) : id;

    if (prefs.events[id] !== true) {
      stats.suppressed.off++;
      return null;
    }

    const prior = armed[id];
    const gap = Math.max(spec.gapMs, spec.gapTurns * wire.budgetMs);
    if (prior && prior.key === key && now - prior.at < gap) {
      stats.suppressed.cooldown++;
      prior.seen++;
      return null;
    }

    // The streak is counted in TURNS, not in raisings: a condition that
    // survives from one turn to the next is STANDING, and standing is what
    // escalation is about. A raising whose key changed is a different
    // condition and starts its own count.
    const sameCondition = !!prior && prior.key === key;
    const since = sameCondition && prior.since !== null ? prior.since : wire.turn;
    const streak =
      sameCondition && wire.turn !== null && since !== null ? wire.turn - since + 1 : 1;
    armed[id] = { at: now, key, since, streak, lastTurn: wire.turn, seen: 1 };

    const escalated = streak >= ESCALATE_TURNS;
    const priority = escalated ? Math.max(1, spec.priority - 1) : spec.priority;

    stats.raised++;
    const entry = {
      id,
      at: now,
      turn: wire.turn,
      priority,
      escalated,
      streak,
      key,
      text: spec.say(detail || {}),
      detail: detail || {},
      channels: [],
      suppressed: [],
    };

    const seen = pulse(id, priority);
    if (seen === true) entry.channels.push('pulse');
    else entry.suppressed.push(seen);

    if (say) {
      say.textContent = entry.text;
      entry.channels.push('live-region');
    }

    const sound = earcon(priority, entry);
    if (sound === true) entry.channels.push('earcon');
    else entry.suppressed.push(sound);

    if (notify(spec, escalated, entry)) entry.channels.push('notification');

    record(entry);
    return entry;
  }

  // ── The pulse ───────────────────────────────────────────────────────────
  //
  // ONE TRANSIENT AT THE BOARD'S EDGE, and drawn OVER the board rather than
  // beside it: an alert that reflows the page has moved the thing the
  // operator was about to click. It is `position: fixed`, `pointer-events:
  // none` and sized from the canvas's own box at pulse time, so it tracks
  // every size the resize grip can drag without owning a single one of the
  // board's own styles.

  const CSS = `
#alerts-mount { position: relative; display: inline-flex; align-items: center; gap: var(--space-6); }

.al-btn {
  background: var(--al-btn-bg); color: var(--al-btn-ink); border: 1px solid var(--al-btn-line); border-radius: var(--radius-4);
  font: var(--weight-bold) var(--size-11)/1 var(--font-ui-short);
  letter-spacing: .04em; padding: var(--space-5) var(--space-8); cursor: pointer;
}
.al-btn[data-muted="1"] { color: var(--al-btn-muted-ink); border-color: var(--al-btn-muted-line); }
.al-btn:focus-visible { outline: var(--focus-ring-width) solid var(--al-focus); outline-offset: var(--focus-ring-offset); }

/* RIGHT-ANCHORED, because the mount is at the right end of the header row and
   a popover that opens leftwards from there runs off the page — which the
   first photograph caught it doing. Below the page's own modals (z 2000) and
   above everything else: a preferences panel is not an emergency. */
.al-pop {
  position: absolute; top: 100%; right: 0; z-index: var(--z-alert-pop); margin-top: var(--space-6); min-width: var(--al-pop-w);
  background: var(--al-pop-bg); border: 1px solid var(--al-btn-line); border-radius: var(--radius-6);
  padding: var(--space-10) var(--space-12); color: var(--al-pop-ink);
  font: var(--size-12)/1.45 var(--font-ui-short);
  box-shadow: var(--shadow-pop);
}
.al-pop h4 { margin: 0 0 var(--space-6); font-size: var(--size-11); letter-spacing: .06em; color: var(--al-pop-head-ink); text-transform: uppercase; }
.al-pop label { display: flex; align-items: center; gap: var(--space-7); padding: var(--space-3) 0; cursor: pointer; }
.al-pop input[type="range"] { flex: 1; }
.al-pop .al-sep { border-top: 1px solid var(--al-pop-sep); margin: var(--space-8) 0 var(--space-6); }
.al-pop .al-note { color: var(--al-pop-note-ink); font-size: var(--size-11); margin-top: var(--space-6); }
.al-pop button {
  background: var(--al-pop-btn-bg); color: var(--al-pop-ink); border: 1px solid var(--al-btn-line); border-radius: var(--radius-4);
  padding: var(--space-4) var(--space-8); font-size: var(--size-11); cursor: pointer; margin-right: var(--space-6);
}

.al-say {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}

/* THE RING. A border and nothing else: no fill, no wash over the board, no
   saturated red — the general-flash threshold is about area and luminance
   change, and a 3 px edge changes neither by much. Brightness IS the signal
   (P1's peripheral rule), so priority is spelled as weight and opacity and
   the hue is only ever a second reading of it. */
.al-pulse {
  /* ABOVE THE PAGE'S OWN MODALS (z 2000), and this is deliberate: the fatal
     consent dialog is up at exactly the moment the fatal alert fires, and a
     peripheral cue drawn underneath the thing it is about is not a peripheral
     cue. Below the login gate (z 3000), which is not a game state. */
  position: fixed; pointer-events: none; z-index: var(--z-alert-ring);
  border-style: solid; border-width: var(--al-ring-width); border-radius: var(--radius-4);
  border-color: var(--al-ring-p2-off);
  opacity: 0; transition: opacity var(--dur-al-ring-on) linear, border-color var(--dur-al-ring-on) linear;
}
.al-pulse[data-priority="1"] { border-width: var(--al-ring-width-p1); border-color: var(--al-ring-p1-off); }
.al-pulse.on { opacity: 1; border-color: var(--al-ring-p2-on); }
.al-pulse.on[data-priority="1"] { border-color: var(--al-ring-p1-on); }
.al-pulse.on[data-priority="3"] { border-color: var(--al-ring-p3-on); }
.al-pulse.off { opacity: 0; transition: opacity var(--dur-al-ring-off) ease-out, border-color var(--dur-al-ring-off) ease-out; }

/* NO ANIMATION AT ALL under reduced motion: the ring appears, holds, and is
   removed. A fade is still motion, and the whole point of the preference is
   that the transient itself is the problem. The @media block that used to be
   here is tokens.css group E, which zeroes --dur-al-ring-on and -off; a
   transition of zero duration and "transition: none" are the same pixels. */
`;

  let mount = null;
  let btn = null;
  let pop = null;
  let ring = null;
  let say = null;
  let ringTimer = null;

  function ensureStyle() {
    if (!global.document || global.document.getElementById('alerts-style')) return;
    const style = global.document.createElement('style');
    style.id = 'alerts-style';
    style.textContent = CSS;
    global.document.head.appendChild(style);
  }

  function reducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /** The board's box, or the viewport's. Read at pulse time and never cached:
   *  the canvas is resizable and a stale rectangle would draw the ring around
   *  where the board used to be. */
  function edgeBox() {
    const canvas = global.document && global.document.getElementById('gameCanvas');
    if (canvas && canvas.getBoundingClientRect) {
      const r = canvas.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) {
        return { left: r.left - 6, top: r.top - 6, width: r.width + 12, height: r.height + 12 };
      }
    }
    const w = global.innerWidth || 0;
    const h = global.innerHeight || 0;
    return { left: 4, top: 4, width: Math.max(0, w - 8), height: Math.max(0, h - 8) };
  }

  /** @returns true, or the name of what refused it. */
  function pulse(id, priority) {
    if (!ring && !ensureMount()) return 'nomount';
    if (!ring) return 'nomount';
    const now = nowMs();
    if (now - pulseAt < PULSE_MIN_GAP_MS) {               // the flash budget
      stats.suppressed.flash++;
      return 'flash';
    }
    pulseAt = now;
    const box = edgeBox();
    ring.style.left = `${Math.round(box.left)}px`;
    ring.style.top = `${Math.round(box.top)}px`;
    ring.style.width = `${Math.round(box.width)}px`;
    ring.style.height = `${Math.round(box.height)}px`;
    ring.setAttribute('data-priority', String(priority));
    ring.setAttribute('data-alert', id);
    ring.classList.remove('off');
    ring.classList.add('on');
    stats.pulsed++;
    if (ringTimer) global.clearTimeout(ringTimer);
    const hold = reducedMotion() ? PULSE_MS + 600 : PULSE_MS;
    ringTimer = global.setTimeout(() => {
      ring.classList.remove('on');
      ring.classList.add('off');
      ringTimer = null;
    }, hold);
    return true;
  }

  // ── The earcon ──────────────────────────────────────────────────────────
  //
  // SYNTHESISED, NOT LOADED: three motifs are a few lines of WebAudio and no
  // bytes on the wire, and a page that fetches an mp3 to say the connection
  // is bad has chosen the worst possible moment to need the network.
  //
  // URGENT BUT NOT STARTLING, in the parameters Edworthy's work says urgency
  // actually lives in: PULSE COUNT and SPEED first, fundamental second,
  // harmonic content third. So priority 1 is three quick rising pulses,
  // priority 2 is two falling ones and priority 3 is a single low note —
  // three motifs that are different in RHYTHM, which survives a bad laptop
  // speaker, rather than different in pitch alone, which does not. Startle is
  // a property of the ONSET, not of the level: every pulse has an 18 ms
  // attack ramp and a soft release, nothing is a square wave, nothing peaks
  // above 0.09 of full scale, and the whole motif is under 600 ms — far
  // inside WCAG 1.4.2's three seconds, and short enough that it cannot mask
  // whatever the operator's screen reader is saying.

  const MOTIFS = {
    1: { notes: [740, 880, 1046.5], step: 130, dur: 0.11, gain: 0.09 },
    2: { notes: [622.25, 523.25], step: 155, dur: 0.13, gain: 0.075 },
    3: { notes: [415.3], step: 0, dur: 0.16, gain: 0.055 },
  };

  let ctx = null;
  let ctxBlocked = false;

  function audioCtor() {
    return global.AudioContext || global.webkitAudioContext || null;
  }

  /** Created on a GESTURE and never before. Every current browser starts an
   *  `AudioContext` suspended when there has been no user activation, and a
   *  context created at load and never resumed is a channel that silently
   *  does nothing — the exact failure mode an alert channel must not have. */
  function unlock() {
    const Ctor = audioCtor();
    if (!Ctor) { ctxBlocked = true; return null; }
    try {
      if (!ctx) ctx = new Ctor();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
    } catch (e) {
      ctxBlocked = true;
      ctx = null;
    }
    return ctx;
  }

  function audible() {
    return !!ctx && !ctxBlocked && (!ctx.state || ctx.state === 'running');
  }

  function play(priority) {
    const motif = MOTIFS[priority] || MOTIFS[3];
    const c = ctx;
    if (!c) return false;
    let t0;
    try { t0 = c.currentTime; } catch (e) { return false; }
    for (let i = 0; i < motif.notes.length; i++) {
      const at = t0 + (i * motif.step) / 1000;
      let osc;
      let gain;
      try {
        osc = c.createOscillator();
        gain = c.createGain();
      } catch (e) { return false; }
      osc.type = 'triangle';
      osc.frequency.value = motif.notes[i];
      const peak = motif.gain * prefs.volume;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.018);       // no click
      gain.gain.setValueAtTime(peak, at + motif.dur);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + motif.dur + 0.07);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(at);
      osc.stop(at + motif.dur + 0.09);
    }
    return true;
  }

  /** @returns true, or the name of the budget that refused it. */
  function earcon(priority, entry) {
    if (prefs.muted) { stats.suppressed.muted++; return 'muted'; }
    if (prefs.volume <= 0) { stats.suppressed.muted++; return 'muted'; }
    const now = nowMs();
    // THE GLANCE RULE, and exactly how far it reaches. `01-RESEARCH.md` P1
    // names the four things a preattentive glance at a fresh board answers —
    // time left, unfinished business, freshness, where attention was — and
    // three of this catalogue's events are precisely those readings. An
    // earcon for one of them inside the first 300 ms of a turn buys a saccade
    // that is already being made, so it is spent on nothing.
    //
    // The other three are NOT on that list, deliberately: `02 §2.2` refuses
    // to put a fatal count in the unfinished-business strip at all, and a
    // refusal and a drift are facts about a press rather than about the
    // board. Those always sound. And nothing is suppressed by the glance
    // while the tab is hidden: there is no glance to ride.
    const glanceCarries = GLANCE_ANSWERS[entry.id] === true;
    const looking = !global.document || global.document.hidden !== true;
    if (glanceCarries && looking && wire.turnAt && now - wire.turnAt < GLANCE_MS) {
      stats.suppressed.glance++;
      return 'glance';
    }
    if (now - earconAt < EARCON_MIN_GAP_MS) { stats.suppressed.budget++; return 'budget'; }
    if (earconTurn === wire.turn && earconTurnCount >= EARCON_PER_TURN) {
      stats.suppressed.budget++;
      return 'budget';
    }
    while (earconWindow.length && now - earconWindow[0] > EARCON_WINDOW_MS) earconWindow.shift();
    if (earconWindow.length >= EARCON_PER_WINDOW) { stats.suppressed.budget++; return 'budget'; }
    if (!audible()) { stats.suppressed.silent++; return 'silent'; }
    if (!play(entry.escalated ? Math.max(1, priority) : priority)) {
      stats.suppressed.silent++;
      return 'silent';
    }
    earconAt = now;
    earconTurnCount = earconTurn === wire.turn ? earconTurnCount + 1 : 1;
    earconTurn = wire.turn;
    earconWindow.push(now);
    stats.sounded++;
    return true;
  }

  // ── The notification ────────────────────────────────────────────────────
  //
  // ONLY WHEN THE TAB IS HIDDEN. A system notification for a page the
  // operator is already looking at is a duplicate of something on screen and
  // costs a dismissal; the whole reason this channel exists is the operator
  // who is in another window. Permission is asked for from the popover's own
  // button and nowhere else, because a permission prompt on page load is
  // reflexively blocked and blocks the channel for good.

  function notify(spec, escalated, entry) {
    if (!prefs.notify) return false;
    if (!global.document || global.document.hidden !== true) return false;
    if (!(spec.notify || escalated)) return false;
    const N = global.Notification;
    if (!N || N.permission !== 'granted') return false;
    try {
      const n = new N('Centaur — ' + spec.label, {
        body: entry.text,
        // One notification per event id: a replaced notification is one
        // interruption, a stack of six is a flood the operator now has to
        // clear before they can act.
        tag: `centaur-alert-${entry.id}`,
        renotify: false,
        silent: true,          // the earcon is this module's sound, not the OS's
      });
      n.onclick = () => {
        try { global.focus(); n.close(); } catch (e) { /* nothing to do */ }
      };
      stats.notified++;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── The mount ───────────────────────────────────────────────────────────

  function optionRow(id) {
    return (
      `<label><input type="checkbox" data-alert-pref="${id}"` +
      `${prefs.events[id] ? ' checked' : ''}> <span>${EVENTS[id].label}</span></label>`
    );
  }

  function renderPop() {
    if (!pop) return;
    pop.innerHTML =
      '<h4>Alerts</h4>' +
      `<label><input type="checkbox" data-alert-mute${prefs.muted ? ' checked' : ''}> ` +
      '<span>Mute all sound</span></label>' +
      '<label><span>Volume</span>' +
      `<input type="range" min="0" max="100" step="5" value="${Math.round(prefs.volume * 100)}" data-alert-volume></label>` +
      '<div class="al-sep"></div>' +
      EVENT_IDS.map(optionRow).join('') +
      '<div class="al-sep"></div>' +
      '<button type="button" data-alert-test>Test sound</button>' +
      '<button type="button" data-alert-notify>Desktop alerts</button>' +
      '<div class="al-note" data-alert-note></div>';
    const note = pop.querySelector('[data-alert-note]');
    if (note) {
      const N = global.Notification;
      const perm = N ? N.permission : 'unsupported';
      note.textContent =
        `Desktop alerts fire only while this tab is hidden (permission: ${perm}).` +
        ' Sound starts after your first click or keypress, as browsers require.';
    }
    if (btn) btn.setAttribute('data-muted', prefs.muted ? '1' : '0');
  }

  function onPopInput(e) {
    const t = e.target;
    if (!t) return;
    if (t.hasAttribute && t.hasAttribute('data-alert-mute')) {
      prefs.muted = !!t.checked;
      savePrefs();
      if (btn) btn.setAttribute('data-muted', prefs.muted ? '1' : '0');
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-alert-volume')) {
      const v = parseInt(t.value, 10);
      prefs.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : prefs.volume;
      savePrefs();
      return;
    }
    if (t.getAttribute && t.getAttribute('data-alert-pref')) {
      prefs.events[t.getAttribute('data-alert-pref')] = !!t.checked;
      savePrefs();
    }
  }

  function onPopClick(e) {
    const t = e.target;
    if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-alert-test')) {
      unlock();
      // The test is the only place this module makes a sound nobody asked
      // for, and it is a press away from the volume slider on purpose.
      if (audible()) play(2);
      return;
    }
    if (t.hasAttribute('data-alert-notify')) {
      const N = global.Notification;
      if (!N) return;
      prefs.notify = true;
      savePrefs();
      if (N.permission === 'default' && typeof N.requestPermission === 'function') {
        try {
          const p = N.requestPermission();
          if (p && typeof p.then === 'function') p.then(renderPop, () => {});
        } catch (err) { /* the old callback form; nothing to do */ }
      }
      renderPop();
    }
  }

  function ensureMount() {
    if (mount) return true;
    if (!global.document) return false;
    const host = global.document.getElementById('alerts-mount');
    if (!host) return false;
    ensureStyle();
    host.innerHTML =
      '<button type="button" class="al-btn" data-muted="0" aria-expanded="false" ' +
      'aria-haspopup="dialog" title="Alert channel: mute, volume, and which events may interrupt.">' +
      'ALERTS</button>' +
      '<div class="al-pop" role="dialog" aria-label="Alert preferences" hidden></div>' +
      // THE FOURTH CHANNEL, and the one that costs nothing: a polite live
      // region. An operator on a screen reader gets neither the ring nor the
      // motif, and the text every alert already carries is exactly what they
      // need. Polite, never assertive — an assertive region interrupts the
      // row the operator is in the middle of reading, which on a 500 ms turn
      // is the one thing worse than missing the alert.
      '<div class="al-say" role="status" aria-live="polite"></div>';
    mount = host;
    btn = host.querySelector('.al-btn');
    pop = host.querySelector('.al-pop');
    say = host.querySelector('.al-say');
    // THE RING GOES ON THE BODY AND NOT IN THE MOUNT, and the first
    // photograph is why. `.header` is `position: fixed; z-index: 1000`, which
    // is a STACKING CONTEXT: a child of it can be given z-index 2500 and
    // still be painted underneath the page's own consent dialog at 2000,
    // because 2500 only orders it against its siblings inside the header. A
    // peripheral cue drawn beneath the modal it is about is not a peripheral
    // cue — and the fatal alert fires at exactly the moment that modal is up.
    // So the ring is a root-level layer of this module's own making. It is
    // still `pointer-events: none`, still writes nothing outside itself, and
    // is still the only thing this file puts anywhere but its mount.
    ring = global.document.querySelector('body > .al-pulse');
    if (!ring) {
      ring = global.document.createElement('div');
      ring.className = 'al-pulse';
      ring.setAttribute('aria-hidden', 'true');
      global.document.body.appendChild(ring);
    }
    renderPop();
    btn.addEventListener('click', () => {
      const open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) renderPop();
    });
    pop.addEventListener('change', onPopInput);
    pop.addEventListener('input', onPopInput);
    pop.addEventListener('click', onPopClick);
    return true;
  }

  // ── Install ─────────────────────────────────────────────────────────────

  let poller = null;
  let gestured = false;

  function onGesture() {
    if (gestured) return;
    gestured = true;
    unlock();
  }

  function install() {
    loadPrefs();
    // A change made anywhere else — the settings panel, another tab — is this
    // channel's business: the mute is the one preference an operator changes
    // from whichever surface is closest.
    const P = prefStore();
    if (P && typeof P.subscribe === 'function') {
      P.subscribe((ids) => {
        if (!ids.some((id) => PREF_IDS.indexOf(id) >= 0)) return;
        loadPrefs();
        renderPop();
        if (btn) btn.setAttribute('data-muted', prefs.muted ? '1' : '0');
      });
    }
    if (!global.document) return false;
    ensureMount();
    if (global.WSClient && typeof global.WSClient.observe === 'function') {
      global.WSClient.observe((ev) => {
        if (!ev) return;
        if (ev.kind === 'in') onInbound(ev.msg);
        else if (ev.kind === 'out') noteOutbound(ev.msg);
      });
    }
    // The gesture that starts the audio. `once` on both, capture so a handler
    // that stops propagation upstream cannot silence the channel, and
    // passive so nothing here can delay an operator's press by a frame.
    const opts = { once: true, capture: true, passive: true };
    global.document.addEventListener('pointerdown', onGesture, opts);
    global.document.addEventListener('keydown', onGesture, opts);
    if (poller === null) poller = global.setInterval(poll, POLL_MS);
    return true;
  }

  const api = {
    install,
    /** THE ONE INPUT. `install` wires this to `WSClient.observe`; a drill
     *  hands it the same envelopes verbatim. */
    observe: (ev) => {
      if (!ev) return;
      if (ev.kind === 'in') onInbound(ev.msg);
      else if (ev.kind === 'out') noteOutbound(ev.msg);
    },
    /** One turn of the ladder poll, for a caller that does not want to wait
     *  for the interval. */
    poll,
    /** Everything this channel has raised, oldest first, with the channels
     *  each alert actually reached and the budgets that refused it. */
    log: () => log.slice(),
    stats: () => JSON.parse(JSON.stringify(stats)),
    prefs: () => JSON.parse(JSON.stringify(prefs)),
    setPrefs: (next) => {
      if (!next || typeof next !== 'object') return api.prefs();
      if (typeof next.muted === 'boolean') prefs.muted = next.muted;
      if (typeof next.notify === 'boolean') prefs.notify = next.notify;
      if (typeof next.volume === 'number') prefs.volume = Math.max(0, Math.min(1, next.volume));
      if (next.events && typeof next.events === 'object') {
        for (const id of EVENT_IDS) {
          if (typeof next.events[id] === 'boolean') prefs.events[id] = next.events[id];
        }
      }
      savePrefs();
      renderPop();
      return api.prefs();
    },
    /** The catalogue, for a drill that would otherwise hard-code it. */
    catalogue: () =>
      EVENT_IDS.map((id) => ({
        id,
        priority: EVENTS[id].priority,
        gapTurns: EVENTS[id].gapTurns,
        gapMs: EVENTS[id].gapMs,
        notify: EVENTS[id].notify,
        label: EVENTS[id].label,
      })),
    limits: {
      glanceMs: GLANCE_MS,
      pulseMs: PULSE_MS,
      pulseMinGapMs: PULSE_MIN_GAP_MS,
      earconMinGapMs: EARCON_MIN_GAP_MS,
      earconPerTurn: EARCON_PER_TURN,
      earconWindowMs: EARCON_WINDOW_MS,
      earconPerWindow: EARCON_PER_WINDOW,
      escalateTurns: ESCALATE_TURNS,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.Alerts = api;
    if (global.document && global.document.readyState !== 'loading') install();
    else if (global.document) global.document.addEventListener('DOMContentLoaded', install);
  }
})(typeof window !== 'undefined' ? window : globalThis);
