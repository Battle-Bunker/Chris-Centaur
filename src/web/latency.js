/**
 * THE WIRE, SAID OUT LOUD — the operator's latency surface.
 *
 * Two clocks run under this interface and the page conflated them into one
 * badge (`01-RESEARCH.md` §4):
 *
 *   Clock A — THE DEADLINE. `turnExpiryTime`, which the page already counts
 *     down correctly. What it never did was subtract the flight time of the
 *     PRESS: a lock issued at T lands at T + one-way-up + the centaur's own
 *     work, so there is a moment inside the countdown after which a press is
 *     no longer a press. That moment is drawn here as a second mark on the
 *     clock — the LAST SAFE PRESS — and it is the one thing that turns the
 *     ping number from trivia into a decision input.
 *
 *   Clock B — FRESHNESS. How old is the thing on screen. The rail says
 *     `seq 29 · 30/30 · LIVE`, which is a counter and not an age. This draws
 *     the age, on a ladder whose rungs are FRACTIONS OF THE TURN BUDGET
 *     rather than absolute milliseconds, because the budget is per game
 *     (500 ms to 1,500 ms on the same code) and a threshold in milliseconds
 *     would mean something different in each.
 *
 * HOW IT DRAWS, and this is a constraint and not a preference. Peripheral
 * vision reads MOTION and BRIGHTNESS; it does not read colour, shape detail or
 * text. Everything urgent here is therefore encoded twice — as a bar that
 * shortens (motion) and a fill that brightens (luminance) — and the words are
 * for the reader who has already looked. Nothing is red unless there is
 * nothing left to do about it, nothing is modal (a modal on a 500 ms clock is
 * a lost turn), and nothing flashes: the pulse is one 900 ms transient per
 * state change and it is off entirely under `prefers-reduced-motion`.
 *
 * WHAT IT OWNS. `<div id="latency-mount">` — the strip under the board header,
 * and `play-game.html`'s only concession to this module besides its script tag
 * — and nothing else on the page. It reads the wire through
 * `WSClient.observe`: the same
 * socket the page is using, with no second connection and no second copy of
 * the message handler — and it hands its readings back out through
 * `LatencyView.read()` so the surfaces that are not its own (the turn clock
 * on the board's edge, the board's own optimistic ink) can be drawn by their
 * owners from the same numbers rather than from a second estimate.
 *
 * Measured, designed and photographed in `docs/design/ux/03-LATENCY.md`; the
 * wire it was designed against is injected by
 * `src/tests/lens-walkthrough-server.ts --latency=… --jitter=… --loss=…`,
 * because in this dev environment both hops are free and a latency surface
 * built against a free wire is a surface nobody has ever read.
 */
(function (global) {
  'use strict';

  // ── The ladder, as fractions of the turn budget ────────────────────────
  //
  // `01-RESEARCH.md` §4 justifies every one of these. They are stored as
  // fractions on purpose: 250 ms is the p50 gap between our own emissions on a
  // 500 ms turn (7–10 per turn, `07-MEASURED.md` §1), which is half a budget,
  // and it is half a budget on a 1,500 ms turn too.
  const THINKING_FRAC = 0.5;   // a gap this long is normal; the bot is thinking
  const DEGRADED_FRAC = 1.0;   // a gap a whole budget long is news
  const RTT_DEGRADED_FRAC = 0.3; // flight time worth a third of the turn
  const RTT_DEGRADED_FLOOR_MS = 150; // §4's own absolute anchor
  const RTT_WARN_FRAC = 0.1;
  // A write unacknowledged for this many round trips is a DEGRADED trigger of
  // its own — §4's last rule, and the only signal that catches a hop that is
  // up, fast and simply not answering.
  const PENDING_RTT_MULTIPLE = 3;
  const PENDING_FLOOR_MS = 1200;

  const DEFAULT_BUDGET_MS = 500;   // `active-game-manager.ts` gameTimeout fallback
  const BUDGET_MIN_MS = 150;
  const BUDGET_MAX_MS = 60000;
  const PING_INTERVAL_MS = 1000;   // the page's own is 5 s: too coarse to steer by
  const TICK_MS = 100;             // the readout's own cadence, off the deadline
  // ...and the cadence when NOTHING on the strip is moving at 10 Hz. See
  // `tick()`: the only thing that changes between ticks on a quiet wire is an
  // age counter inside the banner sentence, and a sentence that re-renders ten
  // times a second is the same sentence to a reader and ten times the layouts
  // to the browser — for the whole length of a session.
  const IDLE_TICK_MS = 1000;
  const SERVER_WORK_DEFAULT_MS = 20;
  const CHIP_HOLD_OK_MS = 2500;
  const CHIP_HOLD_BAD_MS = 9000;

  // ── Round 2's constants (`docs/design/ux/13-LATENCY-2.md`) ─────────────
  //
  // THE NOTCH IS A BAND BECAUSE THE PRESS COST IS A DISTRIBUTION. §2's
  // instrument pressed once a turn at the notch under five wires and measured
  // what the press actually cost. `rtt/2 + work` was 27 ms conservative at the
  // median on a LAN and 695 ms OPTIMISTIC at the 95th on `mobile` — because a
  // press does not only fly, it waits for a centaur that is in the middle of a
  // decision. A line drawn from an average is a promise the tail cannot keep,
  // so the surface draws the spread it has actually seen and puts the hard
  // mark at the confident end of it.
  // 0.75 AND NOT 0.9, AND THE INSTRUMENT PICKED IT. At 0.9 the band on
  // `mobile` swallowed the whole turn: the surface refused all eight presses
  // and SEVEN of them would have landed (§4). A notch that says "no press
  // lands" on a wire where most presses land costs the operator more turns
  // than the one late press it prevents. 0.75 is the setting that priced both
  // failures against each other on the measurements rather than on taste, and
  // `latency.notchConfidence` is there for an operator who disagrees.
  const NOTCH_CONFIDENCE_DEFAULT = 0.75;
  const NOTCH_SAMPLES_MAX = 16;
  // A gap in the frames with the pings still answering is the BOT thinking; a
  // gap with the pings unanswered too is the WIRE holding. They call for
  // opposite things from an operator — wait, versus do not press — and before
  // this they were one sentence. Two missed pings is the discriminator.
  const PING_SILENCE_MULTIPLE = 2.5;
  // The net graph: how many turns of history the peripheral strip carries.
  // Twelve is about ten seconds of a 1.5 s game and about six of a 500 ms one,
  // which is the window an operator can still remember pressing inside.
  const HISTORY_TURNS = 12;
  // How long a reconnect is worth saying something about. After this the page
  // is simply the page again and a standing notice is furniture.
  const RECONNECT_NOTICE_MS = 6000;

  /** One preference, through the one store, with a fallback that must work if
   *  `prefs.js` has not loaded (or is not on this page at all). */
  function pref(name, fallback) {
    try {
      const p = global.Prefs;
      if (p && typeof p.get === 'function') {
        const v = p.get('latency.' + name, fallback);
        return v === undefined || v === null ? fallback : v;
      }
    } catch (e) { /* a preference store may not break the readout */ }
    return fallback;
  }

  // What an outbound envelope is called, and what answers it. A command with
  // no answer of its own is acknowledged by the next broadcast that would
  // carry its effect — which is weaker, and is drawn as weaker: those chips
  // settle to `applied`, never to `acknowledged`.
  const COMMANDS = {
    'lens-lock': { label: 'lock', ack: ['lens-lock'], strong: true },
    'lens-conditional': { label: 'ask', ack: ['lens-conditional-rows'], strong: true, byRequest: true },
    'lens-breakdown': { label: 'drill', ack: ['lens-breakdown-rows'], strong: true, byRequest: true },
    'toggle-hold': { label: 'hold', ack: ['toggle-hold-result'], strong: true },
    'suicide-all': { label: 'suicide', ack: ['suicide-result'], strong: true },
    'confirm-fatal-move': { label: 'confirm', ack: ['confirm-fatal-move-result'], strong: true },
    'select-snake': { label: 'select', ack: ['snake-selected', 'selection-contested', 'selections-update'], strong: true },
    'subscribe-game': { label: 'subscribe', ack: ['game-subscribed', 'enrol-error'], strong: true },
    'deselect': { label: 'deselect', ack: ['selections-update'], strong: false },
    'select-move': { label: 'stage', ack: ['selections-update', 'board-update', 'snake-turn-update'], strong: false },
    'commit-all-staged': { label: 'commit', ack: ['selections-update', 'board-update', 'snake-turn-update'], strong: false },
    'set-waypoint': { label: 'waypoint', ack: ['selections-update', 'board-update'], strong: false },
    'clear-human-input': { label: 'clear', ack: ['selections-update', 'board-update'], strong: false },
  };

  // ── State ───────────────────────────────────────────────────────────────
  // The same dev hook the page reads, read the same way, so this module's
  // pings and the page's clock estimate cannot disagree about what "now" is.
  const DEV_CLOCK_BIAS_MS = (() => {
    const v = parseInt(new URLSearchParams(global.location.search).get('clockBias'), 10);
    return Number.isFinite(v) ? v : 0;
  })();

  const wire = {
    open: false,
    closedAt: null,
    closeCode: null,
    // NTP-style, over the transport's own ping/pong: the same estimator the
    // page runs, on the same samples, because both streams' pongs are visible
    // here and a second opinion about the clock would be a second clock.
    samples: [],
    offsetMs: null,
    rttMs: null,
    oneWayDownMs: null,
    serverWorkMs: null,
    lastFrameSentAt: null,   // server clock, newest `lens-frames`
    lastBoardSentAt: null,   // server clock, newest `board-update`
    lastAnySentAt: null,
    turn: null,
    deadlineAt: null,        // server clock
    budgetMs: DEFAULT_BUDGET_MS,
    gameLagMs: null,
    droppedTurns: 0,
    lastSeenTurn: null,
    // ── Round 2 ─────────────────────────────────────────────────────────
    // When a pong last came back. The one fact that tells a quiet BOT apart
    // from a holding WIRE, and the page already had it and threw it away.
    lastPongAt: null,
    // AN UNANSWERED PING IS A MEASUREMENT, NOT A MISSING ONE. This is the send
    // time of the oldest ping still outstanding, and while it is outstanding
    // the true round trip is AT LEAST `now − pingSentAt`. Under a queue that
    // grows — the `saturated` wire, a mobile stall — a smoothed average of the
    // pongs that have come back is reporting the wire as it was several
    // seconds ago, which is exactly the `LIVE while DEGRADED` miss §2 found.
    // The floor tracks the truth with no lag at all and costs one number.
    // Send times of the pings still outstanding, oldest first.
    pingsOut: [],
    // The press cost, as a SAMPLE SET and not only as an average: the notch
    // band is a quantile of these, and an average cannot have a quantile.
    workSamples: [],
    // The client's own clock at the moment the board for the current turn
    // landed. Operator think time is measured from here — it is the one
    // segment of §1 that only the browser can see.
    boardSeenAt: null,
    lastThinkMs: null,
    // The server-stamped skeleton of the current turn, read off the events
    // `lens-frames` already carries. Nothing new is asked of the wire.
    seg: null,
    lastSeg: null,
    // The last N turns, for the peripheral net graph.
    history: [],
    // A reconnect the operator has not been told about yet.
    reconnectedAt: null,
    turnsMissedOnReconnect: 0,
  };
  const pending = [];        // {id, type, label, at, ack, strong, byRequest, requestId}
  const chips = [];          // {label, state, ms, note, at, until}
  let commandSeq = 0;
  let lastState = null;

  function nowMs() { return Date.now() + DEV_CLOCK_BIAS_MS; }
  /**
   * THE ROUND TRIP THE OPERATOR IS ACTUALLY ON.
   *
   * `wire.rttMs` is an EMA over the pongs that came back, which is the right
   * number to READ ("the connection you have") and the wrong number to STEER
   * BY while a queue is filling: it can only fall behind, because it is an
   * average of samples that have already completed. A ping that has been out
   * for 4,000 ms is proof that the round trip is at least 4,000 ms, available
   * now rather than when it returns.
   *
   * So the ladder and the notch use `max(EMA, the outstanding ping's age)` and
   * the strip's `rtt N ms` cell keeps showing the EMA. The floor can only
   * raise the reading, never lower it, so it cannot hide a bad wire.
   */
  function rttNow() {
    // Pings older than this are not evidence of a slow wire, they are evidence
    // of a lost pong; by then the freshness rungs have long since fired on the
    // frames themselves and the floor has nothing left to add.
    const cutoff = nowMs() - 30000;
    while (wire.pingsOut.length > 0 && wire.pingsOut[0] < cutoff) wire.pingsOut.shift();
    const floor = wire.pingsOut.length === 0 ? null : nowMs() - wire.pingsOut[0];
    if (wire.rttMs === null) return floor;
    return floor === null ? wire.rttMs : Math.max(wire.rttMs, floor);
  }
  function serverNow() { return nowMs() + (wire.offsetMs === null ? 0 : wire.offsetMs); }
  function ema(prev, next, alpha) { return prev === null ? next : prev + (next - prev) * alpha; }

  // ── Reading the wire ────────────────────────────────────────────────────

  function onPong(msg) {
    if (typeof msg.clientTime !== 'number' || typeof msg.serverTime !== 'number') return;
    // BEFORE THE VALIDITY CHECK, and deliberately: a pong that came back is
    // evidence the wire is up even when the RTT it implies is unusable (a
    // clock step, a 60-second queue). The rung that reads this wants "did
    // anything come back", not "was the number good".
    wire.lastPongAt = nowMs();
    // MATCHED, NOT COUNTED. The pong echoes the `clientTime` it was sent
    // with, so a pong clears exactly the ping it answers and every older one
    // — which matters because a DROPPED pong would otherwise leave a counter
    // permanently short and pin the floor at "a ping has been out for ever".
    wire.pingsOut = wire.pingsOut.filter((t) => t > msg.clientTime);
    const rtt = nowMs() - msg.clientTime;
    if (rtt < 0 || rtt > 60000) return;  // the clock stepped mid-flight
    const offset = msg.serverTime - msg.clientTime - rtt / 2;
    wire.samples.push({ rtt, offset });
    if (wire.samples.length > 12) wire.samples.shift();
    // The low-RTT half bounds the offset most tightly, so it is what the
    // estimate is taken from; the RTT itself is smoothed separately, because
    // an operator reading it wants the connection it HAS and not its best
    // moment.
    const sorted = wire.samples.slice().sort((a, b) => a.rtt - b.rtt);
    const n = Math.max(1, Math.min(5, Math.ceil(sorted.length / 2)));
    const target = sorted.slice(0, n).reduce((s, x) => s + x.offset, 0) / n;
    wire.offsetMs = ema(wire.offsetMs, target, wire.samples.length < 4 ? 0.5 : 0.15);
    wire.rttMs = ema(wire.rttMs, rtt, 0.3);
  }

  function onInbound(ev) {
    const msg = ev.msg;
    if (!msg) return;
    // The DOWN hop, measured rather than halved: the server stamps every
    // envelope before it lets go of it, so this is the real one-way and not
    // an assumption that the wire is symmetric. Under `--latency-down` it is
    // the injected number, which is how the reading was checked.
    if (typeof msg.serverSentAt === 'number') {
      const oneWay = ev.at + DEV_CLOCK_BIAS_MS + (wire.offsetMs || 0) - msg.serverSentAt;
      if (oneWay > -1000 && oneWay < 60000) wire.oneWayDownMs = ema(wire.oneWayDownMs, oneWay, 0.3);
      wire.lastAnySentAt = msg.serverSentAt;
    }
    switch (ev.type) {
      case 'pong':
        onPong(msg);
        break;
      case 'lens-frames':
        if (typeof msg.serverSentAt === 'number') wire.lastFrameSentAt = msg.serverSentAt;
        noteSegments(msg.events);
        break;
      case 'board-update':
      case 'game-subscribed':
        // A BOARD, and not merely an envelope. `game-subscribed` is answered
        // for an unknown game too — which is exactly what a REPLAYED page
        // gets, since its id names no live game — and an envelope with no
        // turn in it is not a wire this surface has anything to say about.
        if (typeof msg.serverSentAt === 'number' && typeof msg.turn === 'number') {
          wire.lastBoardSentAt = msg.serverSentAt;
        }
        if (typeof msg.turn === 'number') {
          // A TURN THAT NEVER ARRIVED. The board's own turn number is the only
          // witness a client has that a broadcast was dropped, and under
          // `--loss` it is the witness that fires.
          if (wire.lastSeenTurn !== null && msg.turn > wire.lastSeenTurn + 1) {
            const missed = msg.turn - wire.lastSeenTurn - 1;
            wire.droppedTurns += missed;
            // A gap that spans a reconnect is not the same news as a gap on a
            // live socket: the first is "the game moved on while you were
            // away" and the second is "your wire is losing frames". Both are
            // counted; only the first is worth a sentence about coming back.
            if (wire.reconnectedAt !== null) wire.turnsMissedOnReconnect += missed;
          }
          if (msg.turn !== wire.turn) closeTurn(msg.turn);
          wire.lastSeenTurn = msg.turn;
          wire.turn = msg.turn;
          // THE ONE SEGMENT ONLY THE BROWSER CAN SEE. Operator think time is
          // measured from the moment the board landed HERE, in the client's
          // own clock, because that is when a human could first have looked
          // at it — not from the server stamp, which is a moment nobody saw.
          wire.boardSeenAt = nowMs();
        }
        if (typeof msg.turnExpiryTime === 'number' && msg.turnExpiryTime > 0) {
          wire.deadlineAt = msg.turnExpiryTime;
          // THE BUDGET, IN THE SERVER'S OWN CLOCK. Both ends of this
          // subtraction are server-stamped, so it carries no skew at all and
          // needs no correcting — which is what makes it safe to hang every
          // threshold off.
          //
          // TAKEN WHOLE AND NEVER SMOOTHED. This was an EMA and the pictures
          // caught it: an average lags, so on the first frames of a turn
          // `remaining` exceeded the averaged `budget`, the bar's fill clamped
          // to 100 % and the last-safe-press notch clamped WITH it — pinned
          // off the right edge, which is precisely where it says nothing. The
          // sample is not noisy and does not want averaging: it is one number
          // per turn, and because `serverSentAt` is stamped no later than the
          // deadline it defines, taking it whole also makes
          // `remaining ≤ budget` true by construction, which is what keeps the
          // notch on the bar.
          if (typeof msg.serverSentAt === 'number') {
            const budget = msg.turnExpiryTime - msg.serverSentAt;
            if (budget >= BUDGET_MIN_MS && budget <= BUDGET_MAX_MS) wire.budgetMs = budget;
          }
        } else if (ev.type === 'board-update') {
          wire.deadlineAt = null;
        }
        if (msg.gameLagMs === null || typeof msg.gameLagMs === 'number') {
          wire.gameLagMs = msg.gameLagMs;
        }
        break;
      default:
        break;
    }
    settle(ev);
  }

  /**
   * WHERE THE CENTAUR'S HALF OF THE TURN WENT, read off frames the page
   * already receives.
   *
   * `lens-frames` carries `TurnEvent`s and every one of them is stamped
   * `atWall` by the ONE writer that orders them (`ActiveGameManager`), so the
   * four moments that decompose the centaur's own share of a turn are already
   * on the wire and were being thrown away:
   *
   *   `board.arrived`   the turn reached the centaur
   *   `decision.begin`  the kernel was entered — the gap before it is QUEUE
   *   `emission` (1st)  the first answer existed
   *   `decision.end`    the kernel stopped
   *
   * Nothing new is asked of the server for this and no second timeline is
   * invented: these are the same stamps `07-REVIEW.md`'s why-panel reads back
   * out of storage, so a turn reviewed later decomposes the same way it did
   * live. The scan is a switch over ~39 events a turn (`03` §1.2) and does not
   * touch the DOM.
   */
  function noteSegments(events) {
    if (!Array.isArray(events)) return;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e || typeof e.atWall !== 'number') continue;
      switch (e.kind) {
        case 'board.arrived':
          wire.seg = {
            turn: typeof e.turn === 'number' ? e.turn : wire.turn,
            arrivedAt: e.atWall,
            beganAt: null,
            firstEmitAt: null,
            endedAt: null,
          };
          break;
        case 'decision.begin':
          if (wire.seg !== null && wire.seg.beganAt === null) wire.seg.beganAt = e.atWall;
          break;
        case 'emission':
          if (wire.seg !== null && wire.seg.firstEmitAt === null) wire.seg.firstEmitAt = e.atWall;
          break;
        case 'decision.end':
          if (wire.seg !== null) wire.seg.endedAt = e.atWall;
          break;
        default:
          break;
      }
    }
  }

  /** A turn ended. Keep its shape for the graph, and for the strip to draw
   *  while the next turn has not produced one yet — a bar that empties every
   *  time the board changes is a bar nobody can read. */
  function closeTurn(nextTurn) {
    if (wire.seg !== null) wire.lastSeg = wire.seg;
    wire.history.push({
      turn: wire.turn === null ? nextTurn - 1 : wire.turn,
      rttMs: wire.rttMs === null ? null : Math.round(wire.rttMs),
      botMs:
        wire.seg === null || wire.seg.beganAt === null || wire.seg.endedAt === null
          ? null
          : Math.round(wire.seg.endedAt - wire.seg.beganAt),
      gameLagMs: wire.gameLagMs,
      dropped: wire.droppedTurns,
    });
    if (wire.history.length > HISTORY_TURNS) wire.history.shift();
    wire.seg = null;
    wire.lastThinkMs = null;
  }

  function onOutbound(ev) {
    if (ev.type === 'ping') return;              // measurement, not a command
    const spec = COMMANDS[ev.type];
    if (!spec) return;
    // OPERATOR THINK TIME, ended. The segment runs from the board landing in
    // this browser to the gesture, and it is the one segment of the turn the
    // operator OWNS — the bar exists to make that distinction visible, so it
    // is measured rather than left as the remainder of the others.
    if (wire.boardSeenAt !== null) {
      wire.lastThinkMs = Math.max(0, Math.round(ev.at + DEV_CLOCK_BIAS_MS - wire.boardSeenAt));
    }
    const entry = {
      id: ++commandSeq,
      type: ev.type,
      label: labelFor(spec, ev.msg),
      at: ev.at + DEV_CLOCK_BIAS_MS,
      ack: spec.ack,
      strong: spec.strong,
      requestId: spec.byRequest && ev.msg ? ev.msg.requestId : null,
    };
    pending.push(entry);
    // OPTIMISTIC, AND IMMEDIATELY: the gesture is on screen in the frame it
    // was made in, before anything has answered it. Everything after this is
    // reconciliation.
    chips.push({ id: entry.id, label: entry.label, state: 'pending', at: entry.at, note: null, ms: null });
    draw();
  }

  function labelFor(spec, msg) {
    if (!msg) return spec.label;
    if (spec.label === 'lock' && Array.isArray(msg.pins)) {
      return `lock ${msg.pins.length} pin${msg.pins.length === 1 ? '' : 's'}`;
    }
    if (spec.label === 'ask' && msg.lock && msg.lock.unit) return `ask ${msg.lock.unit}`;
    if (msg.snakeId) return `${spec.label} ${msg.snakeId}`;
    return spec.label;
  }

  /** One inbound frame, matched against the writes waiting for an answer. */
  function settle(ev) {
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      if (p.ack.indexOf(ev.type) < 0) continue;
      if (p.requestId && ev.msg && ev.msg.requestId !== p.requestId) continue;
      pending.splice(i, 1);
      const ms = Math.max(0, Math.round(nowMs() - p.at));
      // The centaur's own work, separated from the flight: this is what the
      // last-safe-press mark needs, and guessing it was the alternative.
      if (p.strong && wire.rttMs !== null) {
        wire.serverWorkMs = Math.max(0, ema(wire.serverWorkMs, ms - wire.rttMs, 0.3));
      }
      // THE PRESS COST, KEPT WHOLE. `ms` is what this command actually cost,
      // end to end, and it is the only honest sample of "what a press costs"
      // this page can take. The EMA above smooths it into a number; these keep
      // the SPREAD, which is what the notch band is drawn from — an average
      // has no 90th percentile and the tail is where a press is lost.
      if (p.strong) {
        wire.workSamples.push(ms);
        if (wire.workSamples.length > NOTCH_SAMPLES_MAX) wire.workSamples.shift();
      }
      const refused = ev.msg && ev.msg.ok === false;
      const contested = ev.type === 'selection-contested';
      const chip = chips.find((c) => c.id === p.id);
      if (chip) {
        chip.ms = ms;
        if (refused || contested) {
          // ROLLED BACK, AND SAID SO. The server disagreed with the picture
          // the press was made against; the optimistic chip does not quietly
          // vanish, it becomes the refusal and stays long enough to read.
          chip.state = 'refused';
          chip.note = refusalText(ev.msg, contested);
          chip.until = nowMs() + CHIP_HOLD_BAD_MS;
        } else {
          chip.state = p.strong ? 'ack' : 'applied';
          chip.until = nowMs() + CHIP_HOLD_OK_MS;
        }
      }
      draw();
      return;
    }
  }

  function refusalText(msg, contested) {
    if (contested) return 'another operator holds it';
    if (!msg) return 'refused';
    if (msg.detail) return String(msg.detail);
    if (msg.refusal) return String(msg.refusal);
    if (msg.error) return String(msg.error);
    return 'refused';
  }

  // ── The notch, as a band ────────────────────────────────────────────────

  /** The p-quantile of a sample list, nearest rank. Null on an empty list —
   *  never 0, which would be a promise that a press costs nothing. */
  function quantile(xs, p) {
    if (xs.length === 0) return null;
    const s = xs.slice().sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
    return s[i];
  }

  /**
   * WHAT A PRESS COSTS, AS A RANGE.
   *
   * Two estimates of the same quantity, and the honest thing is to draw both:
   *
   *   · the MEDIAN cost — what a press usually costs, and where the notch used
   *     to be drawn as a line;
   *   · the CONFIDENT cost — the `latency.notchConfidence` quantile of the
   *     costs this page has actually observed, which is where a press should
   *     stop if the operator wants to be right nine times in ten.
   *
   * The two sources are combined rather than chosen between: `rtt/2 + work` is
   * available from the first pong and needs no command to have been sent, and
   * the observed command costs are the real thing but only exist once the
   * operator has pressed something. The band is `[median, confident]` over
   * whichever of them there is, and it collapses to the old single number when
   * there is only one sample — which is the state the old line was always in.
   */
  function pressCost() {
    const rtt = rttNow();
    const work = wire.serverWorkMs === null ? SERVER_WORK_DEFAULT_MS : wire.serverWorkMs;
    const modelled = rtt === null ? null : rtt / 2 + work;
    const seen = wire.workSamples;
    let conf = Number(pref('notchConfidence', NOTCH_CONFIDENCE_DEFAULT));
    if (!(conf >= 0.5 && conf <= 0.999)) conf = NOTCH_CONFIDENCE_DEFAULT;
    const seenMid = quantile(seen, 0.5);
    const seenHigh = quantile(seen, conf);
    if (modelled === null && seenMid === null) return { mid: null, high: null, conf, n: seen.length };
    const mid = seenMid === null ? modelled : modelled === null ? seenMid : Math.max(modelled, seenMid);
    // The high end is never below the middle one: a band that inverts under a
    // short sample list would draw a notch to the RIGHT of the median mark and
    // say the opposite of what it means.
    const high = Math.max(mid, seenHigh === null ? mid : seenHigh);
    return { mid: Math.round(mid), high: Math.round(high), conf, n: seen.length };
  }

  /**
   * A GAP IN THE FRAMES IS NOT ONE THING.
   *
   * The bot thinking and the wire holding produce the same silence and ask for
   * opposite responses — wait, versus do not press — and the surface said the
   * same sentence for both. The transport's own ping answers it: a pong that
   * came back during the gap proves the wire is carrying, so the silence is
   * the kernel's. Two and a half ping intervals with nothing back and the
   * wire is the suspect.
   *
   * Returns 'bot', 'wire', or null when there is no gap worth attributing.
   */
  function gapCause() {
    if (!wire.open) return 'wire';
    if (wire.lastPongAt === null) return null;
    return nowMs() - wire.lastPongAt > PING_INTERVAL_MS * PING_SILENCE_MULTIPLE ? 'wire' : 'bot';
  }

  /**
   * WHERE THE TURN'S TIME WENT — the model of `13-LATENCY-2.md` §1, filled in
   * from what is actually on the wire, and honest about which is which.
   *
   * Every entry says `how`: `measured` (two stamps, subtracted), `estimated`
   * (a model — `rtt/2` is the only one) or `unknown` (nobody reports it, and
   * an unknown drawn as zero is a lie the operator cannot check). The order is
   * the order the milliseconds are spent in.
   */
  function spend() {
    const seg = wire.seg !== null && wire.seg.beganAt !== null ? wire.seg : wire.lastSeg;
    const rtt = wire.rttMs;
    const cost = pressCost();
    const rows = [];
    const add = (key, label, ms, how) => rows.push({ key, label, ms, how });
    add('game', 'game server → centaur', wire.gameLagMs, wire.gameLagMs === null ? 'unknown' : 'measured');
    if (seg !== null && seg.beganAt !== null) {
      add('queue', 'centaur, before the kernel', Math.max(0, Math.round(seg.beganAt - seg.arrivedAt)), 'measured');
      add(
        'think1',
        'kernel → first answer',
        seg.firstEmitAt === null ? null : Math.max(0, Math.round(seg.firstEmitAt - seg.beganAt)),
        seg.firstEmitAt === null ? 'unknown' : 'measured'
      );
      add(
        'think2',
        'kernel, refining',
        seg.firstEmitAt === null || seg.endedAt === null
          ? null
          : Math.max(0, Math.round(seg.endedAt - seg.firstEmitAt)),
        seg.endedAt === null ? 'unknown' : 'measured'
      );
    } else {
      add('queue', 'centaur, before the kernel', null, 'unknown');
      add('think1', 'kernel → first answer', null, 'unknown');
      add('think2', 'kernel, refining', null, 'unknown');
    }
    add(
      'push',
      'centaur → browser',
      wire.oneWayDownMs === null ? null : Math.round(wire.oneWayDownMs),
      wire.oneWayDownMs === null ? 'unknown' : 'measured'
    );
    // The operator's own share: closed at the press, and running until then.
    const think = wire.lastThinkMs !== null
      ? wire.lastThinkMs
      : wire.boardSeenAt === null ? null : Math.max(0, Math.round(nowMs() - wire.boardSeenAt));
    add('operator', wire.lastThinkMs !== null ? 'you' : 'you, so far', think, think === null ? 'unknown' : 'measured');
    add('press', 'browser → centaur', rtt === null ? null : Math.round(rtt / 2), rtt === null ? 'unknown' : 'estimated');
    // NOBODY REPORTS THE SUBMIT HOP. The centaur writes the move and the game
    // server resolves it; no stamp for either reaches this page, so it is
    // drawn as unknown rather than folded into the press estimate. This is the
    // one segment of the model the wire genuinely cannot answer, and saying so
    // is the difference between a decomposition and a decoration.
    add('submit', 'centaur → game server', null, 'unknown');
    return { rows, costHighMs: cost.high };
  }

  /** Writes that have waited longer than a wire this fast can explain. */
  function overdue() {
    const limit = Math.max(PENDING_FLOOR_MS, PENDING_RTT_MULTIPLE * (wire.rttMs || 0));
    const now = nowMs();
    return pending.filter((p) => now - p.at > limit);
  }

  // ── The ladder ──────────────────────────────────────────────────────────

  function read() {
    const B = wire.budgetMs;
    const now = serverNow();
    const rtt = wire.rttMs === null ? null : Math.round(wire.rttMs);
    // What the RUNGS steer by. See `rttNow`: the reading is the average, the
    // steer is the average or the outstanding ping, whichever is worse.
    const rttLive = rttNow();
    const rttSteer = rttLive === null ? null : Math.round(rttLive);
    const work = wire.serverWorkMs === null ? SERVER_WORK_DEFAULT_MS : Math.round(wire.serverWorkMs);
    // The press has to fly UP and then be worked. Half the round trip is the
    // best estimate of the up hop this page can make on its own; the work is
    // measured off the commands that answer for themselves.
    // THE BAND, AND THE NUMBER THE LADDER STEERS BY. `slack` stays the name
    // every other surface reads (`alerts.js`, the board's ink) and it is now
    // the CONFIDENT end of the band rather than the middle of it: §2's
    // instrument lost a press on `mobile` that the old middle-of-the-band
    // number called safe by 8 ms. A notch that is right half the time is a
    // notch that loses half the presses made on it.
    const cost = pressCost();
    const slackMid = rtt === null && cost.mid === null ? null : cost.mid;
    const slack = cost.high === null ? (rtt === null ? null : Math.round(rtt / 2 + work)) : cost.high;
    const frameAge = wire.lastFrameSentAt === null ? null : Math.max(0, Math.round(now - wire.lastFrameSentAt));
    const boardAge = wire.lastBoardSentAt === null ? null : Math.max(0, Math.round(now - wire.lastBoardSentAt));
    const remaining = wire.deadlineAt === null ? null : Math.round(wire.deadlineAt - now);
    const age = frameAge === null ? boardAge : frameAge;
    const rttDegraded = Math.max(RTT_DEGRADED_FLOOR_MS, RTT_DEGRADED_FRAC * B);
    const late = overdue();
    const cause = gapCause();

    // §4'S STALE, LITERALLY: "no emission past the deadline". Not "an old
    // emission past the deadline" — the deadline is the moment by which the
    // turn was to have been decided, so a clock that has run out with nothing
    // arriving since it ran out is stale however recently the last thing
    // landed. The pictures caught the weaker reading calling a page THINKING
    // 189 ms after its deadline had passed, which is the silent degradation
    // §4 names as the only unacceptable failure.
    const pastDeadlineUnfed =
      remaining !== null &&
      remaining < 0 &&
      (wire.lastFrameSentAt === null || wire.lastFrameSentAt < wire.deadlineAt);

    /**
     * BETWEEN TURNS IS NOT STALE, and calling it stale was the single largest
     * error this surface made.
     *
     * §2's instrument spent between 18 % and 38 % of every run being told the
     * page was STALE while the truth was LIVE, on every profile including the
     * LAN — and the cause was not a threshold. It was that a turn's clock runs
     * out BEFORE the next turn's board is published (405–869 ms before, §2's
     * `turn visible after` column), so `no emission past the deadline` is true
     * for a third of every turn on a perfectly healthy wire. An alarm that
     * fires every turn is furniture; the operator learns to read past it, and
     * then reads past the one that mattered.
     *
     * The demotion is narrow, and each clause is load-bearing:
     *   · the deadline has passed and nothing has come since — the STALE
     *     condition itself, so this only ever RE-READS that state;
     *   · the pings are still answering, so the wire is not the suspect;
     *   · THIS TURN WAS ANSWERED — an emission exists and it was before the
     *     deadline — so the thing on screen is a decided turn and not a turn
     *     that ran out of time;
     *   · and the silence is still shorter than a whole budget, so a wire that
     *     stops after the deadline still degrades on schedule.
     *
     * Delete any one of them and this becomes the silent degradation
     * `01-RESEARCH.md` §4 rules out. With all four it is the honest reading:
     * the turn is over, the board is right, and the next one is on its way.
     */
    const answeredInTime =
      wire.seg !== null &&
      wire.seg.firstEmitAt !== null &&
      wire.deadlineAt !== null &&
      wire.seg.firstEmitAt <= wire.deadlineAt;
    const betweenTurns =
      pastDeadlineUnfed &&
      cause !== 'wire' &&
      answeredInTime &&
      age !== null &&
      age <= DEGRADED_FRAC * B;

    let state = 'LIVE';
    let why = null;
    if (!wire.open) {
      state = 'DISCONNECTED';
      why = wire.closeCode === null
        ? 'the socket is not open'
        : `socket closed (${wire.closeCode}) — reconnecting`;
    } else if (betweenTurns) {
      state = 'LIVE';
      why = `turn ${wire.turn} decided — waiting for the next board`;
    } else if (pastDeadlineUnfed) {
      state = 'STALE';
      why = age === null
        ? `no decision frame since this turn's deadline, ${-remaining} ms ago`
        : `no decision frame for ${age} ms, past this turn's deadline`;
    } else if (age !== null && age > DEGRADED_FRAC * B * 2) {
      state = 'STALE';
      why = `no decision frame for ${age} ms`;
    } else if (rttSteer !== null && rttSteer > rttDegraded) {
      state = 'DEGRADED';
      why =
        rtt !== null && rttSteer > rtt * 1.5
          ? `a ping has been out ${rttSteer} ms — the round trip is climbing`
          : `${rttSteer} ms round trip — a press needs ${slack} ms to land`;
    } else if (wire.gameLagMs !== null && wire.gameLagMs > DEGRADED_FRAC * B) {
      state = 'DEGRADED';
      why = `the game server is ${wire.gameLagMs} ms behind`;
    } else if (late.length > 0) {
      state = 'DEGRADED';
      const oldest = Math.round(nowMs() - late[0].at);
      why = `${late.length} write${late.length === 1 ? '' : 's'} unacknowledged for ${oldest} ms`;
    } else if (age !== null && age > DEGRADED_FRAC * B) {
      state = 'DEGRADED';
      // WHICH SILENCE THIS IS. The same gap means "the bot is still working"
      // or "your wire is holding", and the two ask opposite things of an
      // operator. The pings answer it (see `gapCause`), and saying which is
      // the difference between a diagnosis and a number.
      why = cause === 'wire'
        ? `nothing has arrived for ${age} ms and the wire is not answering either`
        : `no decision frame for ${age} ms — the wire is up, the bot is quiet`;
    } else if (age !== null && age > THINKING_FRAC * B) {
      state = 'THINKING';
    }
    if (wire.droppedTurns > 0 && state === 'LIVE') {
      state = 'DEGRADED';
      why = `${wire.droppedTurns} board update${wire.droppedTurns === 1 ? '' : 's'} never arrived`;
    }

    /**
     * WHAT THE OPERATOR CAN STILL SAFELY DO. The rung says what is wrong; this
     * says what to do about it, and it is a different sentence in each case
     * because the answers are genuinely different — a stalled wire and a
     * closed socket both stop a press, but only one of them will come back on
     * its own inside this turn.
     */
    let advice = null;
    if (state === 'DISCONNECTED') {
      advice = 'nothing you press now leaves this page — the reconnect resubscribes and replays the turn';
    } else if (wire.reconnectedAt !== null && nowMs() - wire.reconnectedAt < RECONNECT_NOTICE_MS) {
      advice =
        `reconnected` +
        (wire.turnsMissedOnReconnect > 0
          ? ` — ${wire.turnsMissedOnReconnect} turn${wire.turnsMissedOnReconnect === 1 ? '' : 's'} resolved while you were away`
          : ' — no turn was missed') +
        (age === null ? '' : `, the board on screen is ${age} ms old`);
    } else if (cause === 'wire' && state !== 'LIVE') {
      advice =
        remaining !== null && slack !== null && remaining <= slack
          ? 'the wire is holding — a lock issued now will not land this turn'
          : 'the wire is holding — what is on screen is the last thing that got through';
    } else if (slack !== null && slack >= B) {
      // NO SAFE PRESS ANYWHERE IN THIS TURN, said outright. §4 found the band
      // can swallow a whole turn on a bad wire, and a bar that is simply red
      // from end to end does not tell an operator that the turn is not theirs
      // — it reads as "hurry", which is the opposite of the true instruction.
      advice = `no press lands inside this turn: a lock needs ${slack} ms and the turn is ${Math.round(B)} ms — read, do not press`;
    } else if (state === 'DEGRADED' && remaining !== null && slack !== null && remaining > slack) {
      advice = `a lock still lands: ${remaining - slack} ms of press left`;
    }

    return {
      state,
      why,
      advice,
      /** True while the rung is LIVE because the turn is DECIDED and the next
       *  board has not arrived — not because everything is fresh. */
      betweenTurns,
      turn: wire.turn,
      budgetMs: B,
      rttMs: rtt,
      oneWayDownMs: wire.oneWayDownMs === null ? null : Math.round(wire.oneWayDownMs),
      serverWorkMs: work,
      clockOffsetMs: wire.offsetMs === null ? null : Math.round(wire.offsetMs),
      // Both in the SERVER's clock, so a caller drawing them subtracts its own
      // skew-corrected now and never the raw one.
      deadlineAt: wire.deadlineAt,
      lastSafePressAt: wire.deadlineAt === null || slack === null ? null : wire.deadlineAt - slack,
      pressSlackMs: slack,
      /** The round trip the RUNGS steer by — the average, or an outstanding
       *  ping's age, whichever is worse. `rttMs` stays the average. */
      rttSteerMs: rttSteer,
      /** True when the confident press cost is longer than the whole turn:
       *  there is no instant in this turn at which a lock is known to land. */
      noSafePress: slack !== null && slack >= B,
      /** The band the notch is the confident end of: `mid` is the usual cost,
       *  `high` the `confidence` quantile, `n` how many real presses it was
       *  measured on (0 ⇒ the band is the model alone and collapses to a
       *  line). A surface drawing its own mark should draw `high`. */
      pressCost: { midMs: slackMid, highMs: cost.high, confidence: cost.conf, samples: cost.n },
      /** 'bot' — the wire is answering and the kernel is quiet; 'wire' — even
       *  the pings have stopped; null — no gap worth attributing. */
      gapCause: cause,
      /** The turn's wall clock, decomposed. See `spend()`. */
      spend: spend().rows,
      /** The last turns, oldest first, for a caller drawing a history. */
      history: wire.history.slice(),
      reconnectedMsAgo: wire.reconnectedAt === null ? null : Math.round(nowMs() - wire.reconnectedAt),
      turnsMissedOnReconnect: wire.turnsMissedOnReconnect,
      remainingMs: remaining,
      frameAgeMs: frameAge,
      boardAgeMs: boardAge,
      gameLagMs: wire.gameLagMs,
      droppedTurns: wire.droppedTurns,
      pending: pending.length,
      overdue: late.length,
      thresholds: {
        thinkingMs: Math.round(THINKING_FRAC * B),
        degradedMs: Math.round(DEGRADED_FRAC * B),
        rttDegradedMs: Math.round(rttDegraded),
        rttWarnMs: Math.round(RTT_WARN_FRAC * B),
        pendingMs: Math.round(Math.max(PENDING_FLOOR_MS, PENDING_RTT_MULTIPLE * (wire.rttMs || 0))),
      },
    };
  }

  // ── Drawing ─────────────────────────────────────────────────────────────

  const CSS = `
/* THE MOUNT CONTRIBUTES A FIXED HEIGHT AND NEVER MOVES THE BOARD ONCE IT IS
   THERE. Everything exceptional — the degraded banner, the command chips — is
   drawn in an overlay anchored under it, because a surface whose job is to
   report a bad connection must not RELAYOUT THE PAGE when the connection goes
   bad: a board that jumps a row the moment the wire degrades is a worse
   failure than the degradation. The mount is also EMPTY until a wire exists at
   all, so a replayed game — which has no socket — has no strip.

   A FULL-WIDTH STRIP AND NOT A CHIP IN THE HEADER. It was a 210 px box at the
   end of the header's flex row and the first photographs killed that: four
   numbers and a state word do not fit in 210 px, so the line ran out past the
   card's edge and was clipped mid-word: the readout said "board +50" and
   stopped there. The deadline bar is also the one thing on this surface the
   PERIPHERY is meant to read, and a 210 px bar puts the whole last-safe-press
   question inside a centimetre. Across the board's own width both problems
   go away at once. */
#latency-mount:empty { display: none; }
#latency-mount { position: relative; width: 100%; height: 26px; margin: 0 0 var(--space-4); font-size: var(--size-11); color: var(--lat-mount-ink); }
.lat { position: absolute; left: 0; right: 0; top: 0; }
.lat-head { display: flex; flex-direction: column; gap: var(--space-3); }
.lat-clock {
  position: relative; height: 5px; border-radius: var(--radius-2); overflow: hidden;
  background: var(--lat-track-bg); box-shadow: inset 0 0 0 1px var(--lat-track-line);
}
/* Motion and brightness, which is what the periphery can read: the bar
   shortens as the turn runs out and its fill brightens as it does. */
.lat-clock-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0%; background: var(--clock-run);
}
.lat[data-clock="warn"] .lat-clock-fill { background: var(--clock-warn); }
.lat[data-clock="urgent"] .lat-clock-fill { background: var(--clock-urgent); }
.lat[data-clock="past"] .lat-clock-fill { background: var(--clock-past); }
/* THE LAST SAFE PRESS: where the countdown stops being a countdown you can
   act inside. A notch and not a colour, so it survives the fill under it. */
.lat-clock-safe {
  position: absolute; top: -1px; bottom: -1px; width: 2px; left: 100%;
  background: var(--clock-notch); display: none;
}
.lat-clock-safe.on { display: block; }
/* THE BAND. The press cost is a distribution and the notch is its confident
   end; this is the spread between that and the usual press, so an operator
   can see HOW UNCERTAIN the mark is and not only where it is. It is drawn
   under the fill's own tone rather than over it — uncertainty is not
   urgency — and it disappears entirely when the two ends agree, which is
   what a steady wire looks like. */
.lat-clock-band {
  position: absolute; top: 0; bottom: 0; left: 100%; width: 0%;
  background: var(--clock-band); display: none;
}
.lat-clock-band.on { display: block; }
.lat-line { display: flex; align-items: center; gap: var(--space-6); white-space: nowrap; height: 15px; }
/* WHERE THE TURN'S TIME WENT — inside the line that already exists, in the
   horizontal space between the state word and the numbers, so the strip's
   HEIGHT does not change and the board below it does not move. A second row
   would have been easier to draw and would have cost thirty pixels of board
   on every page that has a socket. */
.lat-spend {
  display: flex; height: 6px; width: 190px; flex: 0 0 auto; margin-left: var(--space-10);
  border-radius: var(--radius-1); overflow: hidden; box-shadow: inset 0 0 0 1px var(--lat-seg-line);
}
.lat-spend[hidden] { display: none; }
.lat-seg { height: 100%; min-width: 0; }
.lat-seg[data-seg="game"]     { background: var(--lat-seg-game); }
.lat-seg[data-seg="queue"]    { background: var(--lat-seg-centaur); }
.lat-seg[data-seg="think1"]   { background: var(--lat-seg-kernel); }
.lat-seg[data-seg="think2"]   { background: var(--lat-seg-kernel-2); }
.lat-seg[data-seg="push"]     { background: var(--lat-seg-push); }
.lat-seg[data-seg="operator"] { background: var(--lat-seg-you); }
.lat-seg[data-seg="press"]    { background: var(--lat-seg-push); }
.lat-seg[data-seg="submit"]   { background: var(--lat-seg-unknown); }
/* NOT MEASURED, AND SAID SO IN THE INK. A hatch and not a paler tone: paler
   reads as "less of it", hatched reads as "we did not see it", and the whole
   point of the bar is that the two are different claims. */
.lat-seg[data-how="estimated"], .lat-seg[data-how="unknown"] {
  background-image: repeating-linear-gradient(
    135deg, var(--lat-seg-hatch) 0 2px, transparent 2px 4px
  );
}
.lat-seg[data-how="unknown"] { background-color: var(--lat-seg-unknown); }
/* THE NET GRAPH — the last turns, one bar each, at the far right where the
   eye that has finished with the numbers lands. Bars and not a line: a line
   needs an axis to be read and an axis needs room this strip has not got,
   while a row of bars reads as a SHAPE at a glance, which is the only way it
   will ever be read. Nothing here animates, in any motion setting: a history
   that slides is a history that is moving when the wire is not. */
.lat-hist { display: flex; align-items: flex-end; gap: 1px; height: 11px; flex: 0 0 auto; margin-left: var(--space-10); }
.lat-hist[hidden] { display: none; }
.lat-bar { width: 3px; background: var(--lat-hist-ink); min-height: 1px; }
.lat-bar[data-grade="warn"] { background: var(--lat-hist-warn); }
.lat-bar[data-grade="bad"]  { background: var(--lat-hist-bad); }
.lat-bar[data-drop="1"]     { box-shadow: inset 0 -2px 0 0 var(--lat-hist-drop); }
.lat-dot { width: 7px; height: 7px; border-radius: var(--radius-round); background: var(--lat-live); flex: 0 0 auto; }
.lat[data-state="THINKING"] .lat-dot { background: var(--lat-thinking); }
.lat[data-state="DEGRADED"] .lat-dot { background: var(--lat-degraded); }
.lat[data-state="STALE"] .lat-dot { background: var(--lat-stale); opacity: var(--lat-stale-alpha); }
.lat[data-state="DISCONNECTED"] .lat-dot { background: var(--lat-disconnected); }
.lat-state { font-weight: var(--weight-bold); letter-spacing: 0.04em; color: var(--lat-state-ink); font-size: var(--size-10); }
.lat[data-state="DEGRADED"] .lat-state, .lat[data-state="STALE"] .lat-state { color: var(--lat-degraded); }
.lat[data-state="DISCONNECTED"] .lat-state { color: var(--lat-num-bad); }
/* The words on the left where reading starts, the numbers hard right against
   the bar's own end, so the eye that has just read the bar lands on them. */
.lat-nums {
  display: flex; gap: var(--space-10); margin-left: auto;
  font-variant-numeric: tabular-nums; color: var(--lat-num-ink);
}
.lat-num[data-grade="warn"] { color: var(--lat-num-warn); }
.lat-num[data-grade="bad"] { color: var(--lat-num-bad); }
/* The overlay: out of flow, so nothing below it moves when it appears. */
.lat-over {
  position: absolute; top: 29px; right: 0; width: var(--lat-over-w); z-index: var(--z-lat-over);
  display: flex; flex-direction: column; gap: var(--space-3); pointer-events: none;
  text-align: left;
}
.lat-banner {
  display: none; padding: var(--space-3) var(--space-7); border-radius: var(--radius-3); white-space: normal;
  background: var(--lat-banner-bg); color: var(--lat-banner-ink);
  border-left: 3px solid var(--lat-banner-rule); line-height: 1.35;
}
.lat-banner.on { display: block; }
/* WHAT YOU CAN STILL DO. Under the diagnosis and dimmer than it: the rung is
   the news and this is the instruction, and an instruction as loud as the
   news is two things shouting. */
.lat-advice { display: none; margin-top: var(--space-2); opacity: 0.8; }
.lat-advice.on { display: block; }
.lat[data-state="DISCONNECTED"] .lat-banner {
  background: var(--lat-banner-bad-bg); color: var(--lat-banner-bad-ink); border-left-color: var(--lat-banner-bad-rule);
}
.lat-cmds { display: flex; flex-wrap: wrap; gap: var(--space-4); justify-content: flex-end; }
/* An inline-BLOCK and not the default inline: a chip whose refusal runs to two
   lines must carry its own background onto the second one, and an inline box
   paints only the first. The first photographs caught the naked half-line. */
.lat-cmd {
  display: inline-block; max-width: 100%; white-space: normal;
  padding: 1px var(--space-5); border-radius: var(--radius-3); font-variant-numeric: tabular-nums;
  background: var(--lat-cmd-bg); color: var(--lat-cmd-ink); box-shadow: inset 0 0 0 1px var(--lat-cmd-line);
}
.lat-cmd[data-cmd="pending"] { color: var(--lat-cmd-pending-ink); box-shadow: inset 0 0 0 1px var(--lat-cmd-pending-line); }
.lat-cmd[data-cmd="ack"] { color: var(--lat-cmd-ack-ink); box-shadow: inset 0 0 0 1px var(--lat-cmd-ack-line); }
.lat-cmd[data-cmd="applied"] { color: var(--lat-cmd-applied-ink); }
.lat-cmd[data-cmd="refused"] { color: var(--lat-cmd-refused-ink); box-shadow: inset 0 0 0 1px var(--lat-cmd-refused-line); }
/* One transient per state change — never a loop, never above 3 Hz, and gone
   entirely for a reader who asked for less motion. The @media block that used
   to be here is tokens.css group E: it zeroes --dur-lat-arrive, and an
   animation of zero duration leaves the element at its own resting opacity,
   which is exactly what "animation: none" did. One rule, one place, for every
   sheet on the page. */
@keyframes lat-arrive { from { opacity: 0.25; } to { opacity: 1; } }
.lat-pulse { animation: lat-arrive var(--dur-lat-arrive) ease-out 1; }
`;

  let root = null;
  const el = {};
  const written = {};

  /**
   * NO WIRE, NO WIDGET. A replayed game opens no socket at all — the page
   * falls into `finishedMode` on the open timeout and reads `/api/logs`
   * instead — and a latency readout there would either lie ("DISCONNECTED"
   * about a connection nobody asked for) or report on nothing. So the mount
   * stays empty until a frame has actually arrived over a socket, which also
   * means a replayed page's header is the height it always was.
   */
  function haveWire() {
    return wire.lastBoardSentAt !== null;
  }

  /** The stylesheet, installed once and at load: `#latency-mount:empty` is
   *  part of it, and a mount that is empty because no wire exists yet must
   *  already be collapsed by the time the page lays itself out. */
  function ensureStyle() {
    if (global.document.getElementById('latency-style')) return;
    const style = global.document.createElement('style');
    style.id = 'latency-style';
    style.textContent = CSS;
    global.document.head.appendChild(style);
  }

  function ensureMount() {
    if (root) return true;
    if (!haveWire()) return false;
    const mount = global.document.getElementById('latency-mount');
    if (!mount) return false;
    ensureStyle();
    mount.innerHTML =
      '<div class="lat" data-state="LIVE" data-clock="idle">' +
      '<div class="lat-head">' +
      '<div class="lat-clock"><div class="lat-clock-fill"></div>' +
      '<div class="lat-clock-band"></div><div class="lat-clock-safe"></div></div>' +
      '<div class="lat-line"><span class="lat-dot"></span>' +
      '<span class="lat-state">—</span>' +
      // BUILT ONCE, LIKE THE FOUR NUMBERS. Eight segments and twelve history
      // bars, created at mount and only ever written into afterwards: these
      // change on every turn, and an `innerHTML` that rebuilds twenty nodes
      // per turn for the life of a session is the exact waste §2.2 of
      // `03-LATENCY.md` was about.
      '<span class="lat-spend">' +
      SPEND_KEYS.map((k) => `<i class="lat-seg" data-seg="${k}" data-how="unknown" style="width:0%"></i>`).join('') +
      '</span>' +
      '<span class="lat-nums">' +
      // THE FOUR CELLS ARE BUILT ONCE. Two of these four numbers are AGES —
      // how old the last frame is, how old the board is — so their text
      // changes on EVERY tick of a 10 Hz readout, which meant the old
      // `el.nums.innerHTML = …` destroyed and rebuilt four spans ten times a
      // second for the life of the session. The markup below is character for
      // character what `numsHTML` used to produce; `drawNums` now writes the
      // value text and the grade attribute in place.
      NUM_CELLS.map((c) => `<span class="lat-num" data-grade="none">${c.label}&nbsp;<span class="lat-v">—</span></span>`).join('') +
      '</span>' +
      '<span class="lat-hist">' +
      new Array(HISTORY_TURNS).fill(0).map(() => '<i class="lat-bar" style="height:1px"></i>').join('') +
      '</span>' +
      '</div>' +
      '</div>' +
      '<div class="lat-over"><div class="lat-banner"><span class="lat-why"></span>' +
      '<span class="lat-advice"></span></div><div class="lat-cmds"></div></div>' +
      '</div>';
    root = mount.querySelector('.lat');
    el.fill = mount.querySelector('.lat-clock-fill');
    el.safe = mount.querySelector('.lat-clock-safe');
    el.state = mount.querySelector('.lat-state');
    el.nums = mount.querySelector('.lat-nums');
    el.num = Array.prototype.slice.call(mount.querySelectorAll('.lat-num'));
    el.numV = el.num.map((n) => n.querySelector('.lat-v'));
    el.banner = mount.querySelector('.lat-banner');
    el.why = mount.querySelector('.lat-why');
    el.advice = mount.querySelector('.lat-advice');
    el.cmds = mount.querySelector('.lat-cmds');
    el.band = mount.querySelector('.lat-clock-band');
    el.spend = mount.querySelector('.lat-spend');
    el.seg = Array.prototype.slice.call(mount.querySelectorAll('.lat-seg'));
    el.hist = mount.querySelector('.lat-hist');
    el.bar = Array.prototype.slice.call(mount.querySelectorAll('.lat-bar'));
    return true;
  }

  /** Write only what changed. Nothing here reads geometry — the whole surface
   *  is expressed in percentages and text, so a draw can never force a
   *  reflow of the board it sits above. */
  function set(node, key, value) {
    if (written[key] === value) return;
    written[key] = value;
    node.textContent = value;
  }
  function setAttr(node, key, name, value) {
    if (written[key] === value) return;
    written[key] = value;
    node.setAttribute(name, value);
  }
  function setStyle(node, key, prop, value) {
    if (written[key] === value) return;
    written[key] = value;
    node.style[prop] = value;
  }

  function grade(value, warn, bad) {
    if (value === null) return 'none';
    if (value >= bad) return 'bad';
    if (value >= warn) return 'warn';
    return 'ok';
  }

  /**
   * THE FOUR NUMBERS, as a table rather than as a template.
   *
   * Each cell says how to read its value out of a `read()` and how to grade
   * it. The labels are the ones that were in `numsHTML`, in the same order,
   * and `— / +Nms / Nms` is the same formatting: the rendered strip is
   * character-identical to what the template produced. What changed is that
   * the four spans are now built once, at mount, and only their text and
   * their `data-grade` are written afterwards — because two of these four are
   * AGES and therefore change on every tick, and rebuilding the strip at
   * 10 Hz for the life of a session is ten forced layouts a second for a
   * readout the operator mostly is not looking at.
   */
  /** The bar's segments, in the order the milliseconds are spent. Same keys
   *  `spend()` produces, and the markup is built from this list once. */
  const SPEND_KEYS = ['game', 'queue', 'think1', 'think2', 'push', 'operator', 'press', 'submit'];

  const NUM_CELLS = [
    {
      label: 'rtt',
      value: (r) => (r.rttMs === null ? '—' : `${r.rttMs}ms`),
      grade: (r) => grade(r.rttMs, r.thresholds.rttWarnMs, r.thresholds.rttDegradedMs),
    },
    {
      label: 'frame',
      value: (r) => (r.frameAgeMs === null ? '—' : `+${r.frameAgeMs}ms`),
      grade: (r) => grade(r.frameAgeMs, r.thresholds.thinkingMs, r.thresholds.degradedMs),
    },
    {
      label: 'board',
      value: (r) => (r.boardAgeMs === null ? '—' : `+${r.boardAgeMs}ms`),
      grade: (r) => grade(r.boardAgeMs, r.budgetMs, r.budgetMs * 2),
    },
    // `—` and not `0`: nobody reported the game server's own clock, which is
    // a different statement from "the hop was instant".
    {
      label: 'game',
      value: (r) => (r.gameLagMs === null ? '—' : `+${r.gameLagMs}ms`),
      grade: (r) => grade(r.gameLagMs, r.thresholds.thinkingMs, r.thresholds.degradedMs),
    },
  ];

  function drawNums(r) {
    for (let i = 0; i < NUM_CELLS.length; i++) {
      const cell = NUM_CELLS[i];
      set(el.numV[i], `num${i}v`, cell.value(r));
      setAttr(el.num[i], `num${i}g`, 'data-grade', cell.grade(r));
    }
  }

  /**
   * THE SPEND BAR. Eight widths, as percentages of the turn budget, written in
   * place. No geometry is read (03 §3.3's rule survives round 2 intact) and
   * nothing here can force a layout: a percentage width is resolved against a
   * parent whose width the browser already knows.
   *
   * A segment longer than the whole budget clamps, and the bar does not
   * normalise to 100 %: a turn that overran its budget SHOULD show a bar that
   * fills and stops, because that is what happened. Normalising would draw an
   * overrun and an on-time turn identically.
   */
  function drawSpend(r) {
    const on = pref('spend', true) !== false && r.spend !== undefined;
    if (written.spendOn !== on) { written.spendOn = on; el.spend.hidden = !on; }
    if (!on) return;
    const B = r.budgetMs > 0 ? r.budgetMs : DEFAULT_BUDGET_MS;
    let title = 'where this turn went — ';
    for (let i = 0; i < SPEND_KEYS.length; i++) {
      const row = r.spend[i];
      const node = el.seg[i];
      if (!row || !node) continue;
      // An UNKNOWN segment still gets a sliver: a hatched 2 % is the reading
      // "nobody reports this", and zero width would be the reading "it costs
      // nothing", which is a different and false claim.
      const frac = row.ms === null ? 0.02 : Math.max(0, Math.min(1, row.ms / B));
      setStyle(node, `seg${i}w`, 'width', `${(frac * 100).toFixed(1)}%`);
      setAttr(node, `seg${i}h`, 'data-how', row.how);
      title += `${row.label} ${row.ms === null ? (row.how === 'estimated' ? '?' : '—') : `${row.ms}ms`}` +
        (row.how === 'measured' ? '' : ` (${row.how})`) +
        (i === SPEND_KEYS.length - 1 ? '' : ' · ');
    }
    setAttr(el.spend, 'spendTitle', 'title', title);
  }

  /**
   * THE NET GRAPH. One bar a turn, height by round trip against the budget,
   * with a red foot on a turn that lost a board. Twelve bars, written in
   * place, oldest at the left.
   *
   * WHY A HISTORY AT ALL, on a surface whose whole argument is that the
   * periphery reads only brightness and motion: because the ladder answers
   * "is it bad NOW" and an operator's actual question after a lost press is
   * "has it been bad", and a rung cannot answer that. The graph is not for
   * the periphery — it is the smallest thing that lets a look, rather than a
   * memory, settle whether this turn was unusual.
   */
  function drawHistory(r) {
    const on = pref('history', true) !== false;
    if (written.histOn !== on) { written.histOn = on; el.hist.hidden = !on; }
    if (!on) return;
    const B = r.budgetMs > 0 ? r.budgetMs : DEFAULT_BUDGET_MS;
    const rows = r.history;
    const start = HISTORY_TURNS - rows.length;
    for (let i = 0; i < HISTORY_TURNS; i++) {
      const row = i < start ? null : rows[i - start];
      const node = el.bar[i];
      if (!node) continue;
      const rtt = row === null ? null : row.rttMs;
      // Height against the DEGRADED threshold rather than the largest sample:
      // a graph that rescales to its own worst point says nothing about
      // whether the worst point was bad.
      const frac = rtt === null ? 0 : Math.max(0.09, Math.min(1, rtt / (r.thresholds.rttDegradedMs * 1.5)));
      setStyle(node, `bar${i}h`, 'height', `${Math.round(frac * 11)}px`);
      setAttr(
        node, `bar${i}g`, 'data-grade',
        rtt === null ? 'none' : rtt > r.thresholds.rttDegradedMs ? 'bad' : rtt > r.thresholds.rttWarnMs ? 'warn' : 'ok'
      );
      setAttr(node, `bar${i}d`, 'data-drop', row !== null && row.dropped > 0 ? '1' : '0');
      setAttr(
        node, `bar${i}t`, 'title',
        row === null ? '' : `turn ${row.turn} · rtt ${rtt === null ? '—' : `${rtt}ms`}` +
          (row.botMs === null ? '' : ` · bot ${row.botMs}ms`) +
          (row.gameLagMs === null ? '' : ` · game +${row.gameLagMs}ms`)
      );
    }
    setAttr(el.hist, 'histTitle', 'title', `the last ${rows.length} turn${rows.length === 1 ? '' : 's'} — bar height is the round trip against the DEGRADED threshold`);
  }

  function chipsHTML() {
    const now = nowMs();
    for (let i = chips.length - 1; i >= 0; i--) {
      if (chips[i].until !== undefined && chips[i].until < now) chips.splice(i, 1);
    }
    const shown = chips.slice(-4);
    return shown
      .map((c) => {
        // Never negative: the chip is stamped from `WSClient`'s own clock and
        // read back through the corrected one, so a fast answer can round
        // below zero and "select −1ms" is not a thing that happened.
        const age = Math.max(0, c.state === 'pending' ? Math.round(now - c.at) : c.ms);
        const mark = c.state === 'pending' ? '⟳' : c.state === 'refused' ? '✗' : '✓';
        // The whole reason in the tooltip; enough of it on the chip to know
        // which refusal this is without the chip becoming a paragraph.
        const short = c.note && c.note.length > 46 ? `${c.note.slice(0, 45)}…` : c.note;
        const note = short ? ` — ${escapeText(short)}` : '';
        return (
          `<span class="lat-cmd" data-cmd="${c.state}" title="${escapeText(c.label)}${
            c.note ? ` — ${escapeText(c.note)}` : ''
          }">` +
          `${mark} ${escapeText(c.label)} ${age}ms${note}</span>`
        );
      })
      .join('');
  }

  function escapeText(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  }

  /**
   * A HIDDEN TAB IS NOT READ, SO IT IS NOT DRAWN.
   *
   * An operator holds this page open for hours and spends a good part of them
   * looking at something else. The readout is a *display* and nothing else
   * depends on it — `LatencyView.read()` recomputes from state on every call,
   * `alerts.js` polls `read()` rather than the DOM, and the board's optimistic
   * ink reads `pending()` — so a tick that paints a strip nobody can see is
   * pure waste, ten times a second, for as long as the tab is in the
   * background. The tick still runs (the wire is still measured); only the
   * painting is skipped, and `visibilitychange` repaints in full on return.
   */
  function hidden() {
    const d = global.document;
    return !!(d && d.visibilityState === 'hidden');
  }

  /**
   * THE TICK, AT THE RATE THE STRIP ACTUALLY MOVES.
   *
   * Measured on an idle page, the readout cost **10 forced layouts a second,
   * for ever**, and the cause was one string: on a wire the ladder is not
   * calling LIVE, the banner reads `no decision frame for 1234 ms` — an age
   * counter, so a different string on every one of the ten ticks a second, so
   * a text write, a style recalculation and a layout on every one of them. The
   * page an operator leaves open all afternoon spent its whole afternoon
   * re-laying-out a sentence that says the same thing.
   *
   * Two things on this strip genuinely move at 10 Hz and both of them are
   * conditional: the depleting clock (only while a turn deadline is running)
   * and a pending command chip's own age (only while a write is unanswered).
   * With neither of those in play the strip is repainted once a second, which
   * is indistinguishable to a reader and a tenth of the work. Event-driven
   * draws — an arrival, a socket open or close, a command — are never gated;
   * only the timer is.
   */
  function tick() {
    if (hidden()) return;
    const fast = wire.deadlineAt !== null || pending.length > 0;
    if (!fast && nowMs() - lastPaintAt < IDLE_TICK_MS) return;
    draw();
  }

  function draw() {
    if (!ensureMount()) return;
    if (hidden()) return;
    lastPaintAt = nowMs();
    const r = read();

    if (r.state !== lastState) {
      lastState = r.state;
      root.classList.remove('lat-pulse');
      // Force the animation to restart without reading layout: toggling on the
      // next frame is enough and `void offsetWidth` would be a forced reflow
      // for a decoration.
      global.requestAnimationFrame(() => root && root.classList.add('lat-pulse'));
    }
    setAttr(root, 'state', 'data-state', r.state);
    set(el.state, 'stateText', r.state);

    // THE CLOCK. A depleting bar, and the notch that says where a press stops
    // being one. Both are percentages of the budget, so neither reads layout.
    const remaining = r.remainingMs;
    if (remaining === null) {
      setStyle(el.fill, 'fillW', 'width', '0%');
      setAttr(root, 'clock', 'data-clock', 'idle');
      if (el.safe.classList.contains('on')) el.safe.classList.remove('on');
      if (el.band.classList.contains('on')) el.band.classList.remove('on');
      written.safeL = undefined;
      written.bandL = undefined;
      written.bandW = undefined;
    } else {
      const frac = Math.max(0, Math.min(1, remaining / r.budgetMs));
      setStyle(el.fill, 'fillW', 'width', `${(frac * 100).toFixed(1)}%`);
      // THE NOTCH, AT THE CONFIDENT END OF THE BAND, and the band behind it.
      // `pressSlackMs` is now the `notchConfidence` quantile of the observed
      // press costs, so the hard mark is where a press stops being safe NINE
      // TIMES IN TEN rather than half the time; the band runs from there back
      // to the usual cost, so the operator can see how wide the disagreement
      // is. On a steady wire the two coincide and the band vanishes, which is
      // the right amount of ink for a wire with nothing to say.
      const safeFrac =
        r.pressSlackMs === null ? null : Math.max(0, Math.min(1, (remaining - r.pressSlackMs) / r.budgetMs));
      if (safeFrac === null) {
        if (el.safe.classList.contains('on')) el.safe.classList.remove('on');
        if (el.band.classList.contains('on')) el.band.classList.remove('on');
      } else {
        if (!el.safe.classList.contains('on')) el.safe.classList.add('on');
        setStyle(el.safe, 'safeL', 'left', `${(safeFrac * 100).toFixed(1)}%`);
        const midMs = r.pressCost && r.pressCost.midMs !== null ? r.pressCost.midMs : r.pressSlackMs;
        const midFrac = Math.max(0, Math.min(1, (remaining - midMs) / r.budgetMs));
        const w = Math.max(0, midFrac - safeFrac);
        if (w < 0.004) {
          if (el.band.classList.contains('on')) el.band.classList.remove('on');
        } else {
          if (!el.band.classList.contains('on')) el.band.classList.add('on');
          setStyle(el.band, 'bandL', 'left', `${(safeFrac * 100).toFixed(1)}%`);
          setStyle(el.band, 'bandW', 'width', `${(w * 100).toFixed(1)}%`);
        }
      }
      // Past the notch the press is no longer safe, and that is a different
      // reading from "the turn is nearly over" — so it is its own rung.
      const past = remaining <= 0;
      const unsafe = r.pressSlackMs !== null && remaining <= r.pressSlackMs;
      setAttr(root, 'clock', 'data-clock', past ? 'past' : unsafe ? 'urgent' : frac < 0.35 ? 'warn' : 'ok');
    }

    drawNums(r);
    drawSpend(r);
    drawHistory(r);

    // ONE BANNER REGION, never modal, never red for a recoverable state.
    let banner = r.why;
    if (banner !== null && r.state === 'DEGRADED' && r.remainingMs !== null && r.pressSlackMs !== null
        && r.remainingMs <= r.pressSlackMs) {
      banner += ' · a lock issued now may not land this turn';
    }
    // A RECONNECT IS WORTH SAYING EVEN ON A GOOD RUNG. Everything else here
    // is suppressed at LIVE — silence is the signal — but "you were gone and
    // the game moved" is news precisely because the wire is fine again, and a
    // page that comes back silently is a page that lies by omission about the
    // turns it missed.
    const backAgain = r.reconnectedMsAgo !== null && r.reconnectedMsAgo < RECONNECT_NOTICE_MS;
    // ...and so is "no press lands in this turn", which can be true while the
    // rung is perfectly healthy: a wire can be steady, fast to report and
    // still slower than the whole turn budget.
    const on =
      (banner !== null && r.state !== 'LIVE' && r.state !== 'THINKING') || backAgain || r.noSafePress;
    if (written.bannerOn !== on) {
      written.bannerOn = on;
      el.banner.classList.toggle('on', on);
    }
    set(el.why, 'bannerText', on ? (banner === null ? '' : banner) : '');
    const adviceOn = on && r.advice !== null;
    if (written.adviceOn !== adviceOn) {
      written.adviceOn = adviceOn;
      el.advice.classList.toggle('on', adviceOn);
    }
    set(el.advice, 'adviceText', adviceOn ? r.advice : '');

    const cmds = chipsHTML();
    if (written.cmds !== cmds) { written.cmds = cmds; el.cmds.innerHTML = cmds; }
  }

  // ── The panel write guard ───────────────────────────────────────────────
  //
  // 61 % OF RAIL REBUILDS INSTALL MARKUP THAT IS ALREADY THERE
  // (`docs/design/ux/03-LATENCY.md` §1.4). `lensRender` assigns `innerHTML`
  // unconditionally on all fifteen of its call sites, and an `innerHTML`
  // assignment destroys and rebuilds every node under it — so a rebuild that
  // changes no pixel still drops focus, text selection and scroll position
  // inside a panel the operator is reading, which is exactly what
  // `01-RESEARCH.md` P3 asks the surface never to do.
  //
  // This makes an identical write a no-op, on those two elements only, by
  // remembering the string that was last installed THROUGH THIS SETTER. Every
  // write to these elements goes through it, so the memory cannot go stale;
  // any write with different content passes through untouched. It is a
  // no-op-elimination and never a difference in what is drawn, which is what
  // the walkthrough's pixel diff is the gate on.
  //
  // ITS PERMANENT HOME IS `lensRender`, in `play-game.html`, which belongs to
  // another surface owner. It is installed from here so the measurement and
  // the fix ship together rather than the measurement shipping alone.
  function installPanelWriteGuard(ids) {
    const own = Object.getOwnPropertyDescriptor(global.Element.prototype, 'innerHTML');
    if (!own || !own.set) return 0;
    let installed = 0;
    for (const id of ids) {
      const node = global.document.getElementById(id);
      if (!node || node.__latGuarded) continue;
      node.__latGuarded = true;
      let last = null;
      Object.defineProperty(node, 'innerHTML', {
        configurable: true,
        get() { return own.get.call(this); },
        set(value) {
          const next = String(value);
          if (last !== null && next === last) return;
          last = next;
          own.set.call(this, next);
        },
      });
      installed++;
    }
    return installed;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  let ticker = null;

  let visibilityBound = false;
  let lastPaintAt = -Infinity;
  let pinger = null;

  function sendPing() {
    const ws = global.WSClient && global.WSClient.socket ? global.WSClient.socket() : null;
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: 'ping', clientTime: nowMs() }));
        wire.pingsOut.push(nowMs());
      } catch (e) { /* the socket went */ }
    }
  }

  function install() {
    if (!global.WSClient || !global.WSClient.observe) return false;
    global.WSClient.observe((ev) => {
      if (ev.kind === 'in') onInbound(ev);
      else if (ev.kind === 'out') onOutbound(ev);
      else if (ev.kind === 'open') {
        wire.open = true;
        wire.closedAt = null;
        wire.closeCode = null;
        // A burst, so a usable RTT exists before the first deadline matters.
        for (let i = 0; i < 4; i++) global.setTimeout(sendPing, 60 + i * 220);
        draw();
      } else if (ev.kind === 'close') {
        wire.open = false;
        wire.closedAt = ev.at;
        wire.closeCode = ev.code;
        draw();
      }
    });
    ensureStyle();
    if (ticker === null) ticker = global.setInterval(tick, TICK_MS);
    if (!visibilityBound && global.document && global.document.addEventListener) {
      visibilityBound = true;
      global.document.addEventListener('visibilitychange', () => {
        if (!hidden()) draw();
      });
    }
    if (pinger === null) pinger = global.setInterval(sendPing, PING_INTERVAL_MS);
    ensureMount();
    installPanelWriteGuard(['lensRail', 'lensLane']);
    draw();
    return true;
  }

  const api = {
    install,
    /** Every number this surface has, for the surfaces it does not own — the
     *  turn clock on the board's edge and the board's optimistic ink. Read
     *  only: nothing here is a setter and nothing mutates on a read. */
     read,
    /** The writes still waiting for the server, oldest first. A board drawing
     *  optimistic ink draws THESE and clears them when they leave. */
    pending: () => pending.map((p) => ({ type: p.type, label: p.label, ageMs: Math.round(nowMs() - p.at) })),
    installPanelWriteGuard,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LatencyView = api;
    if (global.document && global.document.readyState !== 'loading') install();
    else if (global.document) global.document.addEventListener('DOMContentLoaded', install);
  }
})(typeof window !== 'undefined' ? window : globalThis);
