/**
 * THE INSTRUMENT — what the operator was SHOWN against what was TRUE.
 *
 * `docs/design/ux/03-LATENCY.md` built the ladder and the last-safe-press
 * notch against a constant injected delay, which is enough to reach every rung
 * and not enough to ask whether any rung is RIGHT. This drives the SHIPPED
 * page through eight turns under each of five named wires
 * (`src/tests/latency-profiles.ts`) and answers three questions the pictures
 * cannot:
 *
 *   1. HOW MANY PRESSES LANDED TOO LATE while the surface said they were
 *      safe. The operator here presses at the notch — the last instant the
 *      page claims a lock still lands — and the transport's own ledger says
 *      when the press actually reached the centaur. A press the surface
 *      called safe and that arrived after the deadline is the failure the
 *      whole notch exists to prevent, and it is counted rather than argued.
 *   2. HOW LONG THE LADDER LAGGED THE TRUTH. The true rung is computed from
 *      the same ladder rules over the transport's real holds and the harness's
 *      own turn stamps; the shown rung is sampled off `LatencyView.read()` at
 *      40 Hz. The gap between a true transition and the shown one is the lag.
 *   3. FALSE ALARMS AND MISSES. Time spent shown-bad while truly fine, and —
 *      the one `01-RESEARCH.md` §4 calls the only unacceptable failure — time
 *      spent shown-fine while truly bad.
 *
 * WHY THE TRUTH IS KNOWABLE HERE. The browser, the centaur and the game
 * server are one process on one clock, and the wire is injected rather than
 * real. So `Date.now()` means the same thing on both sides of every
 * measurement, the injected hold of every frame is recorded
 * (`GameWebSocketServer.transportLedger`), and the turn's own stamps are
 * written as they happen (`/dev/truth`). Nothing below estimates anything the
 * page also estimates: where the page says `rtt/2`, this reads the hold.
 *
 *   node scripts/latency-sim.js                        # all five, 8 turns
 *   node scripts/latency-sim.js --profiles=mobile --turns=4 --keep
 *
 * Writes `<out>/latency-sim.json` (every sample and every press) and prints
 * the summary table that belongs in `13-LATENCY-2.md` §2.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const flag = (name) => process.argv.includes(`--${name}`);

const PROFILES = arg('profiles', 'lan,regional,continental,mobile,saturated').split(',').filter(Boolean);
const TURNS = parseInt(arg('turns', '8'), 10);
const SEED = parseInt(arg('seed', '1'), 10);
const PORT = parseInt(arg('port', '5123'), 10);
/** The turn clock every profile is measured on. Long enough that a screenshot
 *  is not needed to see a rung and short enough to be a real turn; every
 *  threshold on the surface is a fraction of it, so the ladder is the same
 *  ladder at any budget (03 §4). */
const BUDGET_MS = parseInt(arg('budget', '1500'), 10);
/** How far inside the notch the operator presses. The point of the number is
 *  that it is SMALL: an operator who presses with a whole budget to spare
 *  never tests the notch, and one who presses after it is not following the
 *  surface. 40 ms is a hand's worth of slop on the last safe instant. */
const PRESS_MARGIN_MS = parseInt(arg('press-margin', '40'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/latency/sim'));
const SAMPLE_MS = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The ladder, restated once, over TRUE numbers ──────────────────────────
//
// These constants are `src/web/latency.js`'s, and the function below is its
// `read()` with the estimates replaced by measurements: the page's smoothed
// RTT becomes the hold the transport actually applied, the page's
// skew-corrected age becomes the real age of the newest frame that had
// actually been delivered, and the page's `budgetMs` becomes the harness's
// own turn clock. It is a SECOND COPY on purpose — an oracle that reused the
// page's own reading would be checking the page against itself.
const THINKING_FRAC = 0.5;
const DEGRADED_FRAC = 1.0;
const RTT_DEGRADED_FRAC = 0.3;
const RTT_DEGRADED_FLOOR_MS = 150;
const RANK = { LIVE: 0, THINKING: 1, DEGRADED: 2, STALE: 3, DISCONNECTED: 4 };

function trueLadder({ rttMs, frameAgeMs, remainingMs, gameLagMs, budgetMs, fedSinceDeadline }) {
  const B = budgetMs;
  if (remainingMs !== null && remainingMs < 0 && !fedSinceDeadline) return 'STALE';
  if (frameAgeMs !== null && frameAgeMs > DEGRADED_FRAC * B * 2) return 'STALE';
  if (rttMs !== null && rttMs > Math.max(RTT_DEGRADED_FLOOR_MS, RTT_DEGRADED_FRAC * B)) return 'DEGRADED';
  if (gameLagMs !== null && gameLagMs > DEGRADED_FRAC * B) return 'DEGRADED';
  if (frameAgeMs !== null && frameAgeMs > DEGRADED_FRAC * B) return 'DEGRADED';
  if (frameAgeMs !== null && frameAgeMs > THINKING_FRAC * B) return 'THINKING';
  return 'LIVE';
}

// ── The server, one per profile ───────────────────────────────────────────

function startServer(profile) {
  const child = spawn(
    path.join(ROOT, 'node_modules/.bin/ts-node'),
    [
      '--transpile-only',
      'src/tests/lens-walkthrough-server.ts',
      `--port=${PORT}`,
      '--seed=1',
      '--nodes=300',
      '--warmup=1',
      `--turn-timeout=${BUDGET_MS}`,
      `--profile=${profile}`,
      `--wire-seed=${SEED}`,
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server never ready:\n${log.join('')}`)), 240000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('[walkthrough] ready')) { clearTimeout(t); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`server exited ${code}:\n${log.slice(-20).join('')}`)); });
  });
  return { child, ready, log };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([new Promise((r) => server.child.on('exit', r)), sleep(4000)]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

const get = (route) => fetch(`http://127.0.0.1:${PORT}${route}`).then((r) => r.json()).catch(() => null);
const step = () => fetch(`http://127.0.0.1:${PORT}/dev/step`, { method: 'POST' }).then((r) => r.json()).catch(() => null);

// ── The page, with a sampler and a press driver inside it ─────────────────

/**
 * SAMPLED IN THE PAGE, NOT OVER CDP. A `page.evaluate` round trip costs a few
 * milliseconds and this needs 40 samples a second for a minute: driven from
 * node the sampling would itself be a load on the thing being measured, and
 * the timestamps would be the driver's rather than the page's. The whole
 * record is drained once, at the end.
 *
 * THE PRESS DRIVER IS IN THE PAGE FOR THE SAME REASON, and for a stronger
 * one: the press must happen AT the notch, and a notch on a 1.5 s turn is a
 * moment about 40 ms wide. A driver in node would be pressing at a moment
 * decided one round trip ago.
 */
const INSTRUMENT = () => {
  const sim = { samples: [], presses: [], out: [], armed: null, marks: [] };
  window.__latSim = sim;
  const read = () => (window.LatencyView ? window.LatencyView.read() : null);
  const domState = () => {
    const el = document.querySelector('#latency-mount .lat');
    return el ? el.getAttribute('data-state') : null;
  };
  setInterval(() => {
    const r = read();
    if (!r) return;
    // The DOM's state and not only `read()`'s: the widget redraws on its own
    // ticker, so what is DRAWN can trail what is KNOWN by up to a tick, and
    // "what the operator was shown" is the drawn one.
    sim.samples.push([Date.now(), r.state, domState(), r.remainingMs, r.frameAgeMs, r.rttMs, r.pressSlackMs, r.boardAgeMs, r.why, r.overdue, r.droppedTurns, r.budgetMs, r.turn]);
    if (sim.samples.length > 200000) sim.samples.splice(0, 100000);
  }, 25);
  if (window.WSClient && window.WSClient.observe) {
    window.WSClient.observe((ev) => {
      if (ev.kind === 'out' && ev.type && ev.type !== 'ping' && ev.type !== 'activity') {
        sim.out.push([Date.now(), ev.type]);
      }
    });
  }
  // A press at the notch: poll the surface's own reading, and the moment it
  // says the last safe instant is within `margin`, make the shipped gesture.
  sim.press = (margin) =>
    new Promise((res) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        const r = read();
        // AT THE NOTCH AND INSIDE THE TURN. `remaining > 0` is not pedantry:
        // without it a driver that arms after a deadline has already passed
        // fires at once, and a press made 700 ms into a dead clock tests
        // nothing about the notch it was supposed to be standing on.
        if (r && r.remainingMs !== null && r.pressSlackMs !== null
            && r.remainingMs > 0 && r.remainingMs <= r.pressSlackMs + margin) {
          clearInterval(timer);
          const rows = [].slice.call(document.querySelectorAll('.snake-info-item.selectable'));
          const active = document.querySelector('.snake-info-item.active-perspective');
          let idx = -1;
          for (let i = 0; i < rows.length; i++) if (rows[i] !== active) { idx = i; break; }
          const at = Date.now();
          // POINTERDOWN AND NOT `click()`. The roster's handler is delegated
          // on `pointerdown` (`board-renderer.js::delegateUnitTableInput`), so
          // a synthetic `click()` reaches nothing and the press this whole
          // instrument is about is never sent. The first run of this script
          // measured three presses that produced no frame at all.
          if (idx >= 0) {
            try {
              rows[idx].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            } catch (e) { idx = -1; }
          }
          sim.presses.push({ at, shown: r, clicked: idx >= 0 });
          res({ ok: idx >= 0, at });
          return;
        }
        if (Date.now() - t0 > 12000) { clearInterval(timer); res({ ok: false, at: null }); }
      }, 8);
    });
};

async function enter(page, name) {
  await page.goto(`http://127.0.0.1:${PORT}/game/lens-walk`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if (await page.$('#loginGate.active')) {
    await page.fill('#loginNameInput', name);
    await page.click('#loginGateSubmit');
    await sleep(2500);
  }
  // A confirmation dialog over the roster would eat the press driver's click.
  await page.evaluate(() => {
    const d = document.getElementById('confirmDialog');
    if (d) {
      const obs = new MutationObserver(() => {
        const yes = d.querySelector('#confirmYes, .confirm-yes, button');
        if (d.classList.contains('active') && yes) yes.click();
      });
      obs.observe(d, { attributes: true });
    }
  });
}

// ── Reconstructing the truth ──────────────────────────────────────────────

/**
 * The transport ledger, folded into the two timelines an oracle needs.
 *
 * `at` is when the shaping decided about a frame — for a DOWN frame that is
 * the moment the server let go of it, which is what `serverSentAt` stamps, so
 * `at` is the frame's own age origin and `at + holdMs` is when the browser
 * could first have seen it. A dropped frame has no delivery and therefore
 * never refreshes anything, which is the whole reason loss and delay are one
 * ladder rather than two.
 */
function foldLedger(rows) {
  const deliveries = [];   // {sentAt, deliveredAt, type}
  const upHolds = [];      // {at, holdMs, type, landedAt, dropped}
  const downHolds = [];
  for (const r of rows) {
    if (r.dir === 'down') {
      if (!r.dropped) {
        downHolds.push({ at: r.at, holdMs: r.holdMs });
        if (r.type === 'lens-frames' || r.type === 'board-update') {
          deliveries.push({ sentAt: r.at, deliveredAt: r.at + r.holdMs, type: r.type });
        }
      }
    } else {
      upHolds.push({ at: r.at, holdMs: r.holdMs, type: r.type, dropped: r.dropped, landedAt: r.dropped ? null : r.at + r.holdMs });
    }
  }
  deliveries.sort((a, b) => a.deliveredAt - b.deliveredAt);
  downHolds.sort((a, b) => a.at - b.at);
  upHolds.sort((a, b) => a.at - b.at);
  return { deliveries, upHolds, downHolds };
}

/** The newest frame the client can possibly have, at instant `t`. */
function newestAt(deliveries, t, type) {
  let best = null;
  for (const d of deliveries) {
    if (d.deliveredAt > t) break;
    if (type && d.type !== type) continue;
    if (best === null || d.sentAt > best.sentAt) best = d;
  }
  return best;
}

/** The turn whose deadline is running at `t`. */
function turnAt(turns, t) {
  let cur = null;
  for (const row of turns) if (row.arrivedAt <= t) cur = row;
  return cur;
}

function trueStateAt(t, { turns, deliveries, downHolds, upHolds }) {
  const row = turnAt(turns, t);
  const frame = newestAt(deliveries, t, 'lens-frames');
  const board = newestAt(deliveries, t, 'board-update');
  const frameAgeMs = frame === null ? null : t - frame.sentAt;
  // TRUE RTT: the two holds the transport actually applied, most recent of
  // each. Where a hop has carried nothing yet, the other hop stands in for it
  // — these profiles shape both hops alike, and an oracle with no number at
  // all would silently score every rung as reachable.
  let lastDown = null;
  for (const d of downHolds) { if (d.at > t) break; lastDown = d; }
  let lastUp = null;
  for (const u of upHolds) { if (u.at > t) break; lastUp = u; }
  const down = lastDown === null ? null : lastDown.holdMs;
  const up = lastUp === null ? null : lastUp.holdMs;
  const rttMs = down === null && up === null ? null : (down === null ? up * 2 : up === null ? down * 2 : down + up);
  const remainingMs = row === null || row.deadlineAt === null ? null : row.deadlineAt - t;
  // THE TURN'S OWN BUDGET, exactly as the page defines it: the deadline minus
  // the moment the envelope carrying it was let go of. `recordTurnArrival`
  // subtracts a 50 ms delivery estimate, so this is 1,450 on a 1,500 ms clock
  // and the oracle's thresholds land where the page's do.
  const budgetMs = row === null || row.deadlineAt === null ? BUDGET_MS : row.deadlineAt - row.arrivedAt;
  const fedSinceDeadline =
    row !== null && row.deadlineAt !== null && frame !== null && frame.sentAt >= row.deadlineAt;
  return {
    state: trueLadder({
      rttMs,
      frameAgeMs,
      remainingMs,
      gameLagMs: row === null ? null : row.gameLagMs,
      budgetMs,
      fedSinceDeadline,
    }),
    rttMs,
    frameAgeMs,
    remainingMs,
    boardAgeMs: board === null ? null : t - board.sentAt,
    turn: row === null ? null : row.turn,
    deadlineAt: row === null ? null : row.deadlineAt,
  };
}

// ── The measurements ──────────────────────────────────────────────────────

const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
};

function measure(profile, samples, presses, truth, ledger) {
  const folded = foldLedger(ledger);
  const oracle = { turns: truth, ...folded };

  // THE MEASURED WINDOW OPENS WHEN THE PAGE HAS A WIRE. Before the socket is
  // open the surface reads DISCONNECTED and it is RIGHT to — there is no
  // connection — while an oracle built out of the server's own stamps has no
  // way to know the browser has not finished loading yet. Scoring that stretch
  // would credit the surface with seconds of "false alarm" for correctly
  // reporting a socket that did not exist. The window opens at the first
  // sample where the page has ever had a wire (an RTT or a frame age), and it
  // closes with the samples, so every reconnect AFTER that is scored.
  // The opener is a DEADLINE and not merely a socket: the ladder is a ladder
  // about a turn, its thresholds are fractions of that turn's budget, and
  // until a `board-update` has carried one the page is honestly working off
  // its 500 ms fallback while the oracle knows the real 1,500. Comparing
  // there compares two different budgets, not two readings of one wire.
  const first = samples.findIndex((s) => s[3] !== null && s[12] !== null);
  const inPlay = (first < 0 ? [] : samples.slice(first)).filter((s) => turnAt(truth, s[0]) !== null);

  // 1. THE PRESSES.
  const pressRows = presses.map((p) => {
    const row = turnAt(truth, p.at);
    // The frame the press produced, found in the up ledger: the first command
    // frame at or after the press. `select-snake` and the `lens-conditional`
    // the page fires with it are the two the roster gesture sends.
    let landed = null;
    let dropped = false;
    for (const u of folded.upHolds) {
      if (u.at < p.at - 20) continue;
      if (u.type !== 'select-snake' && u.type !== 'lens-conditional') continue;
      landed = u.landedAt;
      dropped = u.dropped;
      break;
    }
    const deadlineAt = row === null ? null : row.deadlineAt;
    return {
      turn: row === null ? null : row.turn,
      at: p.at,
      clicked: p.clicked,
      shownRemainingMs: p.shown.remainingMs,
      shownSlackMs: p.shown.pressSlackMs,
      shownState: p.shown.state,
      // What the surface CLAIMED about this press: it was made at or inside
      // the notch, so the surface said it lands.
      shownSafe: p.shown.remainingMs !== null && p.shown.pressSlackMs !== null
        && p.shown.remainingMs > 0,
      landedAt: landed,
      dropped,
      lateBy: landed === null || deadlineAt === null ? null : Math.round(landed - deadlineAt),
    };
  });
  const answered = pressRows.filter((p) => p.lateBy !== null);
  const late = answered.filter((p) => p.lateBy > 0);
  const lostPresses = pressRows.filter((p) => p.dropped).length;

  // 2. THE LADDER, SHOWN AGAINST TRUE.
  let lagSamples = [];
  let falseAlarmMs = 0;
  let missMs = 0;
  let falseAlarmRuns = 0;
  let missRuns = 0;
  let inFalse = false;
  let inMiss = false;
  let pendingSince = null;   // when the truth got worse and the page had not
  let pendingRank = null;
  const trace = [];
  const why = {};
  const missWhy = {};
  let prevTrue = null;
  for (let i = 0; i < inPlay.length; i++) {
    const s = inPlay[i];
    const t = s[0];
    const shown = s[2] || s[1];   // what was DRAWN, falling back to what was known
    const tr = trueStateAt(t, oracle);
    const dt = i === 0 ? SAMPLE_MS : Math.min(500, t - inPlay[i - 1][0]);
    const shownRank = RANK[shown] ?? 0;
    const trueRank = RANK[tr.state] ?? 0;
    if (prevTrue !== null && trueRank > (RANK[prevTrue] ?? 0) && pendingSince === null) {
      pendingSince = t;
      pendingRank = trueRank;
    }
    if (pendingSince !== null && shownRank >= pendingRank) {
      lagSamples.push(t - pendingSince);
      pendingSince = null;
      pendingRank = null;
    }
    // A rung the truth left before the page ever reached it: the page never
    // caught up, which is a MISS and not a lag sample.
    if (pendingSince !== null && trueRank < pendingRank) { pendingSince = null; pendingRank = null; }
    const bad = (r) => r >= RANK.DEGRADED;
    if (bad(shownRank) && !bad(trueRank)) { falseAlarmMs += dt; if (!inFalse) { falseAlarmRuns++; inFalse = true; } }
    else inFalse = false;
    if (!bad(shownRank) && bad(trueRank)) { missMs += dt; if (!inMiss) { missRuns++; inMiss = true; } }
    else inMiss = false;
    if (bad(shownRank) && !bad(trueRank)) {
      const key = `${shown} while ${tr.state}: ${String(s[8] || '').replace(/\d+/g, 'N')}`;
      why[key] = (why[key] || 0) + 1;
    }
    if (!bad(shownRank) && bad(trueRank)) {
      const key = `${shown} while ${tr.state}`;
      missWhy[key] = (missWhy[key] || 0) + 1;
    }
    prevTrue = tr.state;
    trace.push([t, shown, tr.state, s[3], tr.remainingMs, s[4], tr.frameAgeMs, s[5], tr.rttMs, s[8], s[11], s[12], tr.turn]);
  }

  // 2b. HOW LATE THE OPERATOR LEARNS A TURN EXISTS. The centaur stamps
  //     `arrivedAt` when the turn reaches it; this is the first instant the
  //     page was counting down THAT turn's clock. The difference is the
  //     centaur's own publish path plus the down hop — the two segments of
  //     §1 the operator cannot act on and is not currently shown — and while
  //     it runs, the page is honestly reporting the previous turn as expired.
  const turnLags = [];
  for (const row of truth) {
    const seen = inPlay.find((s) => s[12] === row.turn);
    if (seen !== undefined && seen[0] >= row.arrivedAt) turnLags.push(seen[0] - row.arrivedAt);
  }

  const spanMs = inPlay.length < 2 ? 0 : inPlay[inPlay.length - 1][0] - inPlay[0][0];
  // 3. THE NOTCH ITSELF: how far the surface's estimate of the press cost sat
  //    from the cost the press actually paid.
  const slackError = pressRows
    .filter((p) => p.landedAt !== null && p.shownSlackMs !== null)
    .map((p) => Math.round(p.landedAt - p.at) - p.shownSlackMs);

  return {
    profile,
    turns: truth.length,
    samples: inPlay.length,
    spanMs,
    presses: pressRows.length,
    pressesAnswered: answered.length,
    pressesLate: late.length,
    pressesLost: lostPresses,
    lateByP50: pct(late.map((p) => p.lateBy), 50),
    lateByMax: late.length === 0 ? null : Math.max(...late.map((p) => p.lateBy)),
    slackErrP50: pct(slackError, 50),
    slackErrP95: pct(slackError, 95),
    lagP50: pct(lagSamples, 50),
    lagP95: pct(lagSamples, 95),
    lagMax: lagSamples.length === 0 ? null : Math.max(...lagSamples),
    lagSamples: lagSamples.length,
    turnLagP50: pct(turnLags, 50),
    turnLagMax: turnLags.length === 0 ? null : Math.max(...turnLags),
    falseAlarmRuns,
    falseAlarmMs: Math.round(falseAlarmMs),
    falseAlarmPct: spanMs === 0 ? null : +((100 * falseAlarmMs) / spanMs).toFixed(1),
    missRuns,
    missMs: Math.round(missMs),
    missPct: spanMs === 0 ? null : +((100 * missMs) / spanMs).toFixed(1),
    droppedDown: ledger.filter((r) => r.dir === 'down' && r.dropped).length,
    droppedUp: ledger.filter((r) => r.dir === 'up' && r.dropped).length,
    downFrames: ledger.filter((r) => r.dir === 'down').length,
    holdDownP50: pct(ledger.filter((r) => r.dir === 'down' && !r.dropped).map((r) => Math.round(r.holdMs)), 50),
    holdDownP95: pct(ledger.filter((r) => r.dir === 'down' && !r.dropped).map((r) => Math.round(r.holdMs)), 95),
    queueDownMax: ledger.filter((r) => r.dir === 'down').reduce((m, r) => Math.max(m, Math.round(r.queueMs)), 0),
    falseAlarmWhy: why,
    missWhy,
    upTypes: ledger.filter((r) => r.dir === 'up').reduce((m, r) => ({ ...m, [r.type]: (m[r.type] || 0) + 1 }), {}),
    presses_: pressRows,
    trace,
  };
}

// ── One profile, end to end ───────────────────────────────────────────────

async function run(profile, browser) {
  console.log(`\n── ${profile} ──`);
  const server = startServer(profile);
  let out = null;
  try {
    await server.ready;
    const wire = await get('/dev/wire');
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', (e) => console.log(`  ! page error: ${String(e).slice(0, 120)}`));
    await page.addInitScript(INSTRUMENT);
    await enter(page, `sim-${profile}`);
    // A turn to settle: the clock estimate wants a few pongs before the first
    // notch it draws means anything.
    await step();
    await sleep(1500);
    for (let i = 0; i < TURNS; i++) {
      const stepping = step();
      const pressed = await page.evaluate((m) => window.__latSim.press(m), PRESS_MARGIN_MS);
      await stepping;
      if (!pressed.ok) console.log(`  · turn ${i + 1}: no press (the notch never came round)`);
      await sleep(250);
    }
    await sleep(800);
    const record = await page.evaluate(() => ({
      samples: window.__latSim.samples,
      presses: window.__latSim.presses,
      out: window.__latSim.out,
    }));
    const truth = await get('/dev/truth');
    const wirelog = await get('/dev/wire-log');
    await page.close();
    out = measure(profile, record.samples, record.presses, truth.turns, wirelog.rows);
    out.wire = wire;
    console.log(
      `  ${out.samples} samples over ${(out.spanMs / 1000).toFixed(1)}s · ` +
        `${out.presses} presses, ${out.pressesLate} late · ` +
        `lag p50 ${out.lagP50}ms · miss ${out.missPct}% · false ${out.falseAlarmPct}%`
    );
  } catch (e) {
    console.log(`  ! ${profile} failed: ${String(e).slice(0, 400)}`);
    out = { profile, error: String(e).slice(0, 400) };
  } finally {
    await stopServer(server);
  }
  return out;
}

// ── The table ─────────────────────────────────────────────────────────────

function table(rows) {
  const cols = [
    ['profile', (r) => r.profile],
    ['RTT held p50/p95', (r) => (r.holdDownP50 === null ? '—' : `${r.holdDownP50 * 2}/${r.holdDownP95 * 2} ms`)],
    ['drops ↓/↑', (r) => `${r.droppedDown}/${r.droppedUp}`],
    ['max queue', (r) => `${r.queueDownMax} ms`],
    ['presses', (r) => `${r.presses}`],
    ['late', (r) => `${r.pressesLate}` + (r.lateByMax === null ? '' : ` (≤${r.lateByMax} ms)`)],
    ['notch error p50/p95', (r) => (r.slackErrP50 === null ? '—' : `${r.slackErrP50}/${r.slackErrP95} ms`)],
    ['ladder lag p50/max', (r) => (r.lagP50 === null ? '—' : `${r.lagP50}/${r.lagMax} ms`)],
    ['turn visible after', (r) => (r.turnLagP50 === null ? '—' : `${r.turnLagP50}/${r.turnLagMax} ms`)],
    ['false alarm', (r) => `${r.falseAlarmPct}% (${r.falseAlarmRuns})`],
    ['MISSED', (r) => `${r.missPct}% (${r.missRuns})`],
  ];
  const body = rows.filter((r) => !r.error);
  const lines = [
    `| ${cols.map((c) => c[0]).join(' | ')} |`,
    `|${cols.map(() => '---').join('|')}|`,
    ...body.map((r) => `| ${cols.map((c) => c[1](r)).join(' | ')} |`),
  ];
  return lines.join('\n');
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const rows = [];
  try {
    for (const p of PROFILES) rows.push(await run(p, browser));
  } finally {
    await browser.close();
  }
  const md = table(rows);
  const json = {
    at: new Date().toISOString(),
    turns: TURNS,
    budgetMs: BUDGET_MS,
    seed: SEED,
    pressMarginMs: PRESS_MARGIN_MS,
    table: md,
    rows: flag('keep') ? rows : rows.map((r) => ({ ...r, trace: undefined })),
  };
  fs.writeFileSync(path.join(OUT, 'latency-sim.json'), JSON.stringify(json, null, 1));
  console.log(`\n${md}\n\nwrote ${path.join(OUT, 'latency-sim.json')}`);
  const failed = rows.filter((r) => r.error);
  if (failed.length > 0) {
    console.log(`\n${failed.length} profile(s) failed: ${failed.map((f) => f.profile).join(', ')}`);
    process.exitCode = 1;
  }
}

void main();
