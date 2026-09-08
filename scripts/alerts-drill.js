/**
 * THE ALERT DRILL — every event in the catalogue, triggered and asserted.
 *
 * `src/web/alerts.js` is the one surface here that spends attention the
 * operator did not offer, so it is the one surface whose SILENCE has to be
 * proved as carefully as its noise. This walks a Chromium through the shipped
 * page against `src/tests/lens-walkthrough-server.ts` and asserts, per event,
 * that it fires; and then asserts the four things that stop it firing — the
 * per-event cooldown, the per-turn earcon budget, the master mute and the
 * per-event opt-out.
 *
 *   node scripts/alerts-drill.js --out=docs/design/ux/alerts
 *
 * A FAILED ASSERTION FAILS THE RUN (exit 1). Every check is written down in
 * `report.json` beside the shots with the module's own `Alerts.log()` entry
 * that satisfied it, because "the alert fired" is a claim about a log line and
 * a screenshot cannot carry one.
 *
 * THE AUDIO IS STUBBED, NOT SILENCED. `page.addInitScript` replaces
 * `AudioContext` before any page script runs with a recorder that answers the
 * whole of the API the module uses (`createOscillator`, `createGain`,
 * `currentTime`, `state`, `resume`) and pushes every `start()` onto
 * `window.__earcons`. So the assertion is on the CALL — three rising notes for
 * a priority-1 motif, one low note for a priority-3 — and this box needs no
 * sound card. `Notification` is stubbed the same way, because a drill must be
 * able to prove the "only while hidden" rule without a permission prompt.
 *
 * A SERVER PER SCENE, for the same two reasons `scripts/lens-latency-shots.js`
 * gives: the injected wire is fixed at construction, so a scene that wants a
 * slow wire is a different server; and operator names are unique per game, so
 * a second entry into a live game arrives as a stranger and gets a takeover
 * dialog instead of the units.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';
const ROOT = path.resolve(__dirname, '..');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const OUT = path.resolve(arg('out', 'docs/design/ux/alerts'));
const PORT = parseInt(arg('port', '5191'), 10);
const ONLY = arg('only', '');
/** Longer than a real turn, and only here. Every threshold in the module is a
 *  fraction of the turn budget (as `03-LATENCY.md` §3.2's are), so a long
 *  budget drills the same rules with the same proportions — and leaves room
 *  for a screenshot, which costs a few hundred milliseconds of its own. */
const BUDGET = parseInt(arg('budget', '4000'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { budgetMs: BUDGET, scenes: [], checks: [], shots: [], console: [], exceptions: [] };
let failures = 0;

function check(scene, what, ok, evidence) {
  report.checks.push({ scene, what, ok: !!ok, evidence: evidence === undefined ? null : evidence });
  if (!ok) failures++;
  console.log(`   ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) console.log(`     evidence: ${JSON.stringify(evidence)}`);
}

// ── The server, one per scene ─────────────────────────────────────────────

function startServer(flags) {
  // `ux-walk-server.js` and not the harness directly: several worktrees on
  // this machine run the same file and a neighbour's process sweep must not
  // be able to reach this one (02 §4.2).
  const child = spawn(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'ux-walk-server.js'),
      `--port=${PORT}`,
      '--seed=1',
      '--nodes=300',
      '--warmup=1',
      `--turn-timeout=${BUDGET}`,
      ...flags,
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const lines = [];
  child.stdout.on('data', (d) => lines.push(String(d)));
  child.stderr.on('data', (d) => lines.push(String(d)));
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server never ready:\n${lines.join('')}`)), 180000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('[walkthrough] ready')) {
        clearTimeout(t);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`server exited ${code}:\n${lines.join('')}`));
    });
  });
  return { child, ready, lines };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([new Promise((r) => server.child.on('exit', r)), sleep(4000)]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

const step = () =>
  fetch(`http://127.0.0.1:${PORT}/dev/step`, { method: 'POST' })
    .then((r) => r.json())
    .catch(() => null);

// ── The page ──────────────────────────────────────────────────────────────

/**
 * THE STUBS, installed before a single page script runs.
 *
 * `AudioContext` answers everything `alerts.js` touches and records each
 * `start()`. `Notification` records each construction and lets the drill set
 * `permission` and, through `__hidden`, `document.hidden` — which is the only
 * way to test "only while the tab is hidden" without actually backgrounding a
 * headless page, whose visibility the automation harness itself controls.
 */
const STUBS = () => {
  window.__earcons = [];
  window.__notifications = [];
  class P {
    constructor() { this.value = 0; }
    setValueAtTime(v) { this.value = v; return this; }
    linearRampToValueAtTime(v) { this.value = v; return this; }
    exponentialRampToValueAtTime(v) { this.value = v; return this; }
  }
  class N {
    constructor() { this.gain = new P(); this.frequency = new P(); this.type = ''; }
    connect() { return this; }
    start(at) { window.__earcons.push({ hz: this.frequency.value, at, wall: Date.now() }); }
    stop() {}
  }
  window.AudioContext = class {
    constructor() { this.state = 'running'; this.destination = new N(); this.__t0 = Date.now(); }
    get currentTime() { return (Date.now() - this.__t0) / 1000; }
    createOscillator() { return new N(); }
    createGain() { return new N(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
  };
  window.webkitAudioContext = window.AudioContext;

  const Note = function (title, opts) {
    window.__notifications.push({ title, body: (opts || {}).body, tag: (opts || {}).tag });
    this.close = () => {};
  };
  Note.permission = 'granted';
  Note.requestPermission = () => Promise.resolve('granted');
  window.Notification = Note;

  // `document.hidden` is a getter on the prototype; the drill flips
  // `window.__hidden` and this makes the page believe it.
  window.__hidden = false;
  Object.defineProperty(document, 'hidden', { get: () => window.__hidden === true, configurable: true });
  Object.defineProperty(document, 'visibilityState', {
    get: () => (window.__hidden === true ? 'hidden' : 'visible'),
    configurable: true,
  });
};

async function newPage(browser, label) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  await page.addInitScript(STUBS);
  page.on('pageerror', (e) => report.exceptions.push({ at: label, text: String(e && e.message) }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.console.push({ at: label, text: m.text() });
  });
  return page;
}

let operatorSeq = 0;
async function enter(page) {
  await page.goto(`http://127.0.0.1:${PORT}/game/lens-walk`, { waitUntil: 'domcontentloaded' });
  await sleep(2200);
  if (await page.$('#loginGate.active')) {
    // Names are unique per game; a drill that hard-codes one cannot be run
    // twice against one process, and the failure looks like a takeover bug.
    const name = `drill-${Date.now().toString(36)}-${operatorSeq++}`;
    await page.fill('#loginNameInput', name);
    await page.click('#loginGateSubmit');
    await sleep(2200);
  }
  // The gesture the audio needs. It is a click on the page's own chrome, in a
  // corner nothing owns, because the module listens on `document` in capture
  // and this must be the same gesture an operator's first press would be.
  await page.mouse.click(4, 4);
  await sleep(120);
  return page;
}

/** Everything the drill asserts on, read in one evaluate so a check and its
 *  evidence describe the same instant. */
const readAlerts = (page) =>
  page.evaluate(() => {
    const ring = document.querySelector('.al-pulse');
    return {
      log: window.Alerts ? window.Alerts.log() : null,
      stats: window.Alerts ? window.Alerts.stats() : null,
      prefs: window.Alerts ? window.Alerts.prefs() : null,
      limits: window.Alerts ? window.Alerts.limits : null,
      ring: ring
        ? {
            on: ring.classList.contains('on'),
            alert: ring.getAttribute('data-alert'),
            priority: ring.getAttribute('data-priority'),
            width: ring.style.width,
            height: ring.style.height,
          }
        : null,
      say: (document.querySelector('#alerts-mount .al-say') || {}).textContent || null,
      earcons: window.__earcons.slice(),
      notifications: window.__notifications.slice(),
      ladder: window.LatencyView ? window.LatencyView.read().state : null,
      // The two numbers the notch is made of, and the count that gates it —
      // in the report, so a `press-window` that never fired says WHY.
      wire: window.LatencyView
        ? (() => {
            const r = window.LatencyView.read();
            return { remainingMs: r.remainingMs, pressSlackMs: r.pressSlackMs, rttMs: r.rttMs };
          })()
        : null,
      staged:
        typeof stagedMoves === 'undefined'
          ? null
          : Object.keys(stagedMoves).map((k) => ({ unit: k, committed: stagedMoves[k].committed })),
    };
  });

/** Poll the module's own log until `pred` holds. Never a bare sleep: this box
 *  is shared and a fixed wait photographs whatever the CPU allowed. */
async function until(page, what, pred, timeoutMs = 25000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await readAlerts(page);
    if (last && pred(last)) return last;
    await sleep(80);
  }
  return last;
}

const fired = (state, id) => (state && state.log ? state.log.filter((e) => e.id === id) : []);

/**
 * THE BYTES FIRST. The ring holds for 900 ms and a `page.screenshot()` costs a
 * few hundred of them, so a shot taken after three assertions is a photograph
 * of a ring that has already gone. Every call site that wants the ring UP
 * therefore shoots before it checks, and the shot records `ring.on` so the
 * report says which pictures actually caught one.
 */
async function shot(page, name, note) {
  const file = path.join(OUT, `${name}.png`);
  // The ring's own state on BOTH sides of the capture, because this surface
  // redraws four times a second and a caption that names one rung has to be
  // checkable against the surface's reading before and after the bytes were
  // taken — the discipline `lens-latency-shots.js` arrived at the hard way.
  const before = await readAlerts(page);
  const buf = await page.screenshot();
  fs.writeFileSync(file, buf);
  const state = await readAlerts(page);
  report.shots.push({
    name,
    note,
    bytes: buf.length,
    ring: before.ring,
    ringAfter: state.ring,
    say: before.say,
    ladder: before.ladder,
    ladderAfter: state.ladder,
    last: before.log && before.log.length ? before.log[before.log.length - 1] : null,
  });
  console.log(`   · ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
}

/**
 * Stage one legal move for the focused unit, by the page's own envelope.
 *
 * IN THIS HARNESS ONLY. `getStagedMovesForGame` skips a controlled snake with
 * nothing staged, and the walkthrough server steps the game itself rather than
 * through the staging pipeline — so until an operator presses, the broadcast's
 * `stagedMoves` is empty and there is by construction nothing unfinished. In a
 * real game every controlled snake is staged every turn.
 */
const stageOne = (page) =>
  page.evaluate(() => {
    const gs = typeof currentGameState === 'undefined' ? null : currentGameState;
    const id = typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId;
    if (!gs || !id) return null;
    const snake = (gs.board.snakes || []).find((s) => s.id === id);
    if (!snake) return null;
    const h = snake.head;
    const W = gs.board.width;
    const H = gs.board.height;
    const neck = snake.body && snake.body[1];
    const back = neck === undefined ? null
      : neck.x < h.x ? 'left' : neck.x > h.x ? 'right' : neck.y < h.y ? 'down' : 'up';
    const options = [
      h.y < H - 1 ? 'up' : null, h.y > 0 ? 'down' : null,
      h.x > 0 ? 'left' : null, h.x < W - 1 ? 'right' : null,
    ].filter((m) => m && m !== back);
    if (!options.length) return null;
    window.WSClient.socket().send(JSON.stringify({ type: 'select-move', snakeId: id, move: options[0] }));
    return { snakeId: id, move: options[0] };
  });

// ── Scene 1: the wire ─────────────────────────────────────────────────────
//
// The injected wire from `03-LATENCY.md` §3.5. A round trip worth more than a
// third of the budget is DEGRADED by the ladder's own rule; stopping the
// stepping past the deadline is STALE. Both are the ladder's readings, read
// through `LatencyView.read()` — the alert and the strip cannot disagree.

async function sceneWire(browser) {
  console.log('\n── wire: DEGRADED, STALE, the cooldown, the mute');
  const server = startServer([`--latency=${Math.round(BUDGET * 0.22)}`, '--jitter=40']);
  await server.ready;
  report.scenes.push({ scene: 'wire', flags: `latency=${Math.round(BUDGET * 0.22)} jitter=40` });
  const page = await newPage(browser, 'wire');
  try {
    await enter(page);
    step();

    const deg = await until(page, 'degraded', (s) => fired(s, 'wire-degraded').length > 0);
    await shot(page, '01-degraded', 'the ladder at DEGRADED, the ring on the board’s edge');
    const d = fired(deg, 'wire-degraded')[0];
    check('wire', 'wire-degraded fires on a wire the ladder calls DEGRADED', !!d, {
      ladder: deg && deg.ladder,
      entry: d || null,
    });
    check('wire', 'wire-degraded reaches the pulse', !!d && d.channels.includes('pulse'), d && d.channels);
    check(
      'wire',
      'the ring is drawn on the board’s own box, not the viewport',
      !!deg.ring && parseInt(deg.ring.width, 10) > 100 && parseInt(deg.ring.width, 10) < 1400,
      deg.ring
    );

    // THE COOLDOWN. The ladder is polled four times a second and the rung is
    // standing, so the module is asked to raise this event dozens of times.
    // What it must do is raise it once per cooldown and count the rest.
    const before = fired(deg, 'wire-degraded').length;
    const beforeSup = deg.stats.suppressed.cooldown;
    await sleep(2000);
    const after = await readAlerts(page);
    const spec = after.limits;
    check(
      'wire',
      'a standing rung is rate-limited, not repeated: ≤1 more raising in 2 s',
      fired(after, 'wire-degraded').length - before <= 1,
      { before, after: fired(after, 'wire-degraded').length, cooldownMs: spec && spec.earconMinGapMs }
    );
    check(
      'wire',
      'the refusals are counted rather than dropped',
      after.stats.suppressed.cooldown > beforeSup,
      { before: beforeSup, after: after.stats.suppressed.cooldown }
    );

    // THE NOTCH. `press-window` is `03-LATENCY.md` §3's last-safe-press mark
    // as an EVENT: the clock still running, the press no longer able to land,
    // and something still unfinished. It needs a wire that costs something —
    // on a free one the slack is `rtt/2 + work` ≈ 20 ms and the window is the
    // last half-percent of the turn, which is why this check lives in the
    // injected-wire scene and not the operator's.
    //
    // Caught the way `lens-latency-shots.js` catches a short rung: step
    // WITHOUT awaiting, so the poll is already running when the clock starts.
    //
    // UNFINISHED BUSINESS HAS TO BE MADE, in this harness and only in this
    // harness. `getStagedMovesForGame` skips a controlled snake with nothing
    // staged, and the walkthrough server steps the game itself rather than
    // through the staging pipeline — so until an operator presses, the
    // broadcast's `stagedMoves` is empty and there is by construction nothing
    // unfinished. In a real game every controlled snake is staged every turn.
    // So: stage one legal move, and the count is honest again.
    const rosterRows = await page.$$('.snake-info-item.selectable');
    if (rosterRows[0]) await rosterRows[0].click();
    // Waited for and not slept through: on this scene's wire a `select-snake`
    // and its answer cost the better part of two seconds, and a fixed sleep
    // that is right on a free wire is wrong on the only wire this scene has.
    for (let i = 0; i < 60; i++) {
      const got = await page.evaluate(() =>
        typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId
      );
      if (got) break;
      await sleep(150);
    }
    const staged = await stageOne(page);
    check('wire', 'a move is staged, so there is unfinished business to be past the notch with', !!staged, staged);
    // The first legal-looking direction may still be certain death on this
    // board, and the consent dialog that raises would sit over every picture
    // this scene takes. Dismissed; the staged bot substitute is what leaves
    // the business unfinished either way.
    await page.keyboard.press('Escape');
    await sleep(200);

    let notch = null;
    for (let i = 0; i < 12 && !notch; i++) {
      // The unfinished business has to still be there when the notch passes:
      // a turn can commit what was staged, and a window entered with nothing
      // open is a window nothing should fire in. Re-staged when it is gone,
      // which is also what makes the loop's later tries worth taking.
      const now = await readAlerts(page);
      if (!now.staged || now.staged.length === 0) await stageOne(page);
      const stepping = step();
      const hit = await until(page, `press-window#${i}`, (s) => fired(s, 'press-window').length > 0, BUDGET + 3000);
      if (fired(hit, 'press-window').length > 0) notch = hit;
      await stepping;
    }
    const pw = notch ? fired(notch, 'press-window')[0] : null;
    const lastSeen = notch || (await readAlerts(page));
    check('wire', 'press-window fires past the last-safe-press notch with unfinished business', !!pw, {
      entry: pw || null,
      ladder: lastSeen && lastSeen.ladder,
      wire: lastSeen && lastSeen.wire,
      staged: lastSeen && lastSeen.staged,
    });
    check('wire', 'it names how much is unfinished', !!pw && pw.detail.unfinished > 0, pw && pw.detail);
    check(
      'wire',
      'it fires while the clock is still running — past the deadline the ladder is already louder',
      !!pw && pw.detail.remainingMs > 0,
      pw && pw.detail
    );

    // STALE: stop feeding it and let the deadline pass.
    const stale = await until(page, 'stale', (s) => fired(s, 'wire-stale').length > 0, 3 * BUDGET + 8000);
    // Named for what it CATCHES rather than for what raised it: on this wire
    // the notch and the ladder land within the flash floor of each other, so
    // the ring the camera finds up is usually the notch's and the STALE
    // raising's own pulse is the one the budget refused. That is the budget
    // working, and the report records both sides of it.
    await shot(page, '02-notch', 'the last-safe-press notch on a slow wire, with the ladder degraded');
    const st = fired(stale, 'wire-stale')[0];
    check('wire', 'wire-stale fires once the deadline passes unfed', !!st, {
      ladder: stale && stale.ladder,
      entry: st || null,
    });
    check(
      'wire',
      'a STALE alert carries the ladder’s own sentence, not a second opinion',
      !!st && typeof st.text === 'string' && st.text.length > 0,
      st && st.text
    );

    // THE EARCON. Asserted as a CALL: the P2 motif is two notes, the P3 motif
    // one, and both are in the stub's list with their frequencies.
    const sounded = stale.log.filter((e) => e.channels.includes('earcon'));
    check('wire', 'at least one wire alert reached the earcon', sounded.length > 0, {
      sounded: sounded.map((e) => e.id),
      earcons: stale.earcons.length,
    });
    check(
      'wire',
      'the earcon is a synthesised motif — an oscillator per note, no asset fetched',
      stale.earcons.length >= sounded.length && stale.earcons.every((e) => e.hz > 200 && e.hz < 1200),
      stale.earcons.slice(0, 6)
    );

    // THE EARCON BUDGET, on its own terms: no two earcons closer than the
    // module's own minimum gap, ever, across everything raised so far.
    const gaps = [];
    for (let i = 1; i < stale.earcons.length; i++) {
      const g = stale.earcons[i].wall - stale.earcons[i - 1].wall;
      if (g > 5) gaps.push(g);              // notes inside one motif are ~0 ms apart
    }
    check(
      'wire',
      `no two earcons closer than ${spec.earconMinGapMs} ms`,
      gaps.every((g) => g >= spec.earconMinGapMs - 60),
      gaps
    );

    // THE MUTE. Everything else keeps working; only the sound stops. The
    // wait is the module's own flash floor: a probe fired inside it would be
    // refused the ring for the right reason and read as the wrong one.
    await page.evaluate(() => window.Alerts.setPrefs({ muted: true }));
    await sleep(spec.pulseMinGapMs + 150);
    const mutedAt = (await readAlerts(page)).earcons.length;
    await page.evaluate(() =>
      window.Alerts.observe({
        kind: 'in',
        at: Date.now(),
        type: 'lens-lock',
        msg: { type: 'lens-lock', ok: false, refusal: 'off-head', detail: 'muted-probe' },
      })
    );
    const muted = await readAlerts(page);
    const probe = fired(muted, 'lock-refused').filter((e) => e.key === 'lock:muted-probe');
    check('wire', 'mute silences the earcon', muted.earcons.length === mutedAt, {
      before: mutedAt,
      after: muted.earcons.length,
    });
    check('wire', 'mute does NOT silence the pulse', probe.length > 0 && probe[0].channels.includes('pulse'), probe[0] || null);
    check('wire', 'a muted alert says so in its own record', probe.length > 0 && probe[0].suppressed.includes('muted'), probe[0] || null);
    await page.evaluate(() => window.Alerts.setPrefs({ muted: false }));

    // THE PER-EVENT OPT-OUT.
    await page.evaluate(() => window.Alerts.setPrefs({ events: { 'lock-refused': false } }));
    const offBefore = (await readAlerts(page)).log.length;
    await page.evaluate(() =>
      window.Alerts.observe({
        kind: 'in',
        at: Date.now(),
        type: 'lens-lock',
        msg: { type: 'lens-lock', ok: false, refusal: 'off-head', detail: 'opt-out-probe' },
      })
    );
    const off = await readAlerts(page);
    check('wire', 'a switched-off event raises nothing at all', off.log.length === offBefore, {
      before: offBefore,
      after: off.log.length,
    });
    await page.evaluate(() => window.Alerts.setPrefs({ events: { 'lock-refused': true } }));
    // Dispatched rather than clicked at coordinates: in this harness Firebase
    // is not configured, so `firebase-status-banner.js` holds a fixed banner
    // over the header and intercepts every pointer event aimed at it. That is
    // the page's own furniture and not this module's to move — recorded in
    // §7 of the doc and worked around here.
    await page.$eval('#alerts-mount .al-btn', (el) => el.click());
    await sleep(200);
    const popOpen = await page.evaluate(() => {
      const pop = document.querySelector('#alerts-mount .al-pop');
      return { hidden: pop.hidden, rows: pop.querySelectorAll('[data-alert-pref]').length,
               hasMute: !!pop.querySelector('[data-alert-mute]'),
               hasVolume: !!pop.querySelector('[data-alert-volume]') };
    });
    check('wire', 'the popover carries a master mute, a volume and a row per event',
      popOpen.hidden === false && popOpen.hasMute && popOpen.hasVolume && popOpen.rows === 6, popOpen);
    await shot(page, '03-prefs', 'the preferences popover');
    await page.$eval('#alerts-mount .al-btn', (el) => el.click());
  } finally {
    await page.close();
    await stopServer(server);
  }
}

// ── Scene 2: the operator ─────────────────────────────────────────────────
//
// A free wire and a real unit. The fatal case is produced the way an operator
// produces it: select a snake and press toward a wall. The server refuses the
// unconsented certain-death move, stages the bot's instead, and says so on the
// envelope the page already handles — which is the alert's source signal.

async function sceneOperator(browser) {
  console.log('\n── operator: the fatal cell, a refused lock, the notch, the hidden tab');
  const server = startServer([]);
  await server.ready;
  report.scenes.push({ scene: 'operator', flags: 'free wire' });
  const page = await newPage(browser, 'operator');
  try {
    await enter(page);
    await step();
    await sleep(600);

    // A unit, focused through the shipped gesture — the roster row.
    const rows = await page.$$('.snake-info-item.selectable');
    if (rows[0]) await rows[0].click();
    await sleep(500);
    const picked = await page.evaluate(() =>
      typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId
    );
    report.scenes[report.scenes.length - 1].unit = picked;
    check('operator', 'a unit is focused through the roster', !!picked, picked);

    // THE FATAL CELL, produced the way the operator produces it: a
    // `select-move` naming a direction that walks the head off the board.
    // The ENVELOPE is the page's own — the same bytes `stageSelectedMove()`
    // sends — rather than a cursor walk, because WHICH arrow key lands on a
    // wall depends on the seeded board and a drill that guesses is a drill
    // that is flaky. The refusal that comes back is the shipped one: the
    // server declines to stage an unconsented certain-death move, stages the
    // bot's instead, and says `fatal-move-confirmation-needed`.
    const aimed = await page.evaluate(() => {
      const gs = typeof currentGameState === 'undefined' ? null : currentGameState;
      const id = typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId;
      if (!gs || !id) return null;
      const snake = (gs.board.snakes || []).find((s) => s.id === id);
      if (!snake) return null;
      const h = snake.head;
      const W = gs.board.width;
      const H = gs.board.height;
      // The direction off the edge; on an interior head, the one that doubles
      // back onto the snake's own neck, which is equally certain death.
      const off =
        h.x === 0 ? 'left' : h.x === W - 1 ? 'right' : h.y === 0 ? 'down' : h.y === H - 1 ? 'up' : null;
      const neck = snake.body && snake.body[1];
      const back =
        neck === undefined
          ? null
          : neck.x < h.x ? 'left' : neck.x > h.x ? 'right' : neck.y < h.y ? 'down' : 'up';
      const move = off || back;
      if (!move) return null;
      window.WSClient.socket().send(JSON.stringify({ type: 'select-move', snakeId: id, move }));
      return { snakeId: id, move, head: h, board: { W, H } };
    });
    report.scenes[report.scenes.length - 1].fatalPress = aimed;

    const fatal = await until(page, 'fatal', (s) => fired(s, 'fatal-unpinned').length > 0, 12000);
    await shot(page, '04-fatal', 'a unit one turn from a fatal cell, nothing pinned');
    const f = fired(fatal, 'fatal-unpinned')[0];
    check('operator', 'fatal-unpinned fires on the server’s own certain-death refusal', !!f, {
      entry: f || null,
      press: aimed,
    });
    check('operator', 'a fatal alert is priority 1 — the loudest motif', !!f && f.priority === 1, f && f.priority);
    check(
      'operator',
      'a fatal alert reaches the pulse and the earcon',
      !!f && f.channels.includes('pulse') && f.channels.includes('earcon'),
      f && f.channels
    );
    check(
      'operator',
      'the priority-1 motif is three notes, rising',
      fatal.earcons.length >= 3 &&
        fatal.earcons.slice(-3)[0].hz < fatal.earcons.slice(-3)[1].hz &&
        fatal.earcons.slice(-3)[1].hz < fatal.earcons.slice(-3)[2].hz,
      fatal.earcons.slice(-3)
    );
    check('operator', 'the ring names the event that raised it', !!fatal.ring && fatal.ring.alert === 'fatal-unpinned', fatal.ring);
    await page.keyboard.press('Escape');

    // THE STAGED-FATAL BRANCH. The second source signal for the same event is
    // `stagedMoves[u].fatal` on a broadcast — the case where a certain-death
    // move is actually staged by the bot or a waypoint fallback rather than
    // refused. This harness cannot be made to trap a snake on demand, so the
    // envelope is handed to the module's own input port in the shape
    // `active-game-manager.ts::getStagedMovesForGame` broadcasts, and the
    // assertion is on the MAPPING, which is the half this drill can prove.
    const staged = await page.evaluate(() => {
      window.Alerts.observe({
        kind: 'in',
        at: Date.now(),
        type: 'board-update',
        msg: {
          type: 'board-update',
          turn: 9001,
          stagedMoves: {
            'drill-unit': {
              move: null, requestedMove: 'up', committed: false,
              color: '#888888', source: 'bot', fatal: true,
            },
            'drill-consented': {
              move: null, requestedMove: 'down', committed: false,
              color: '#4CAF50', source: 'manual', fatal: true,
            },
          },
          activeIntentModes: { 'drill-unit': 'heuristic', 'drill-consented': 'manual' },
        },
      });
      return window.Alerts.log().filter((e) => e.turn === 9001);
    });
    check(
      'operator',
      'a bot-staged fatal move with no determination raises the alert',
      staged.some((e) => e.id === 'fatal-unpinned' && e.detail.unit === 'drill-unit'),
      staged
    );
    check(
      'operator',
      'a fatal move the operator consented to raises NOTHING — the alarm does not second-guess a confirmed decision',
      !staged.some((e) => e.detail && e.detail.unit === 'drill-consented'),
      staged
    );

    // A LOCK THE SERVER REFUSED — the real refusal, on the real wire: a lock
    // naming a unit this centaur does not control is one of the two things
    // `websocket-server.ts` refuses, and it answers `lens-lock ok:false`.
    await page.evaluate(() => {
      const ws = window.WSClient.socket();
      ws.send(JSON.stringify({ type: 'lens-lock', pins: [{ unit: 'no-such-unit', to: 0 }], expected: [] }));
    });
    const refused = await until(page, 'refusal', (s) =>
      fired(s, 'lock-refused').some((e) => /no-such-unit|not yours/.test(String(e.text)))
    );
    await shot(page, '05-refused', 'a lock the server refused');
    const rf = fired(refused, 'lock-refused').filter((e) => /no-such-unit|not yours/.test(String(e.text)))[0];
    check('operator', 'lock-refused fires on the server’s own refusal envelope', !!rf, rf || null);
    check('operator', 'the refusal’s own words are carried, not a generic one', !!rf && /not yours/.test(rf.text), rf && rf.text);

    // THE HIDDEN TAB. A notification is the one channel gated on the operator
    // not looking, so both directions are asserted.
    await page.evaluate(() => window.Alerts.setPrefs({ notify: true }));
    const visibleBefore = (await readAlerts(page)).notifications.length;
    await page.evaluate(() =>
      window.Alerts.observe({
        kind: 'in',
        at: Date.now(),
        type: 'lens-lock',
        msg: { type: 'lens-lock', ok: false, refusal: 'off-head', detail: 'visible-probe' },
      })
    );
    const visible = await readAlerts(page);
    check('operator', 'no notification while the tab is visible', visible.notifications.length === visibleBefore, {
      before: visibleBefore,
      after: visible.notifications.length,
    });

    await page.evaluate(() => { window.__hidden = true; });
    await page.evaluate(() =>
      window.Alerts.observe({
        kind: 'in',
        at: Date.now(),
        type: 'lens-lock',
        msg: { type: 'lens-lock', ok: false, refusal: 'off-head', detail: 'hidden-probe' },
      })
    );
    const hidden = await readAlerts(page);
    check(
      'operator',
      'a notification once the tab is hidden',
      hidden.notifications.length > visible.notifications.length,
      hidden.notifications.slice(-2)
    );
    check(
      'operator',
      'one notification per event id — a tag, not a stack',
      hidden.notifications.every((n) => typeof n.tag === 'string' && n.tag.startsWith('centaur-alert-')),
      hidden.notifications.slice(-2)
    );
    await page.evaluate(() => { window.__hidden = false; });

  } finally {
    await page.close();
    await stopServer(server);
  }
}

// ── Scene 3: drift, reduced motion, the flash budget ──────────────────────

async function sceneDrift(browser) {
  console.log('\n── drift, reduced motion, the flash budget');
  const server = startServer([]);
  await server.ready;
  report.scenes.push({ scene: 'drift', flags: 'free wire, prefers-reduced-motion' });
  const page = await newPage(browser, 'drift');
  try {
    // The whole scene runs under the preference, so the rule is proved on the
    // shipped stylesheet rather than on a claim about it.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enter(page);
    await step();
    await sleep(500);

    // THE PER-TURN EARCON CEILING, measured on a FRESH PAGE so the rolling
    // minute is still empty and the ceiling under test is the per-turn
    // one rather than the flood one. Six raisings, spaced wider than the
    // 700 ms earcon floor so THAT is not the ceiling either: what is left is
    // the per-turn cap, and the check asserts both of its sides.
    const flood = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, window.Alerts.limits.earconMinGapMs + 150));
      const before = window.__earcons.length;
      const t = 9100;
      window.Alerts.observe({
        kind: 'in', at: Date.now(), type: 'board-update',
        msg: { type: 'board-update', turn: t, stagedMoves: {}, activeIntentModes: {} },
      });
      for (let i = 0; i < 6; i++) {
        window.Alerts.observe({
          kind: 'in', at: Date.now(), type: 'lens-lock',
          msg: { type: 'lens-lock', ok: false, refusal: 'off-head', detail: `flood-${i}` },
        });
        await new Promise((r) => setTimeout(r, 750));
      }
      const raised = window.Alerts.log().filter((e) => e.turn === t);
      return {
        raised: raised.length,
        sounded: raised.filter((e) => e.channels.includes('earcon')).length,
        notes: window.__earcons.length - before,
        limit: window.Alerts.limits.earconPerTurn,
        budgetRefusals: raised.filter((e) => e.suppressed.includes('budget')).length,
      };
    });
    check(
      'operator',
      `six raisings in one turn, spaced past the earcon floor, sound at most ${flood.limit} of them`,
      flood.sounded <= flood.limit,
      flood
    );
    check(
      'operator',
      '…and the check is not vacuous: the per-turn cap, not silence, is what stopped them',
      flood.sounded >= 1 && flood.budgetRefusals >= 1,
      flood
    );
    check('drift', 'the flood is still raised and still logged — limited, not discarded', flood.raised >= 6, flood);

    const drift = await page.evaluate(() => {
      const t = 9200;
      // The operator sets a waypoint (a standing determination) …
      window.Alerts.observe({
        kind: 'in', at: Date.now(), type: 'board-update',
        msg: {
          type: 'board-update', turn: t,
          stagedMoves: { 'd1': { move: null, requestedMove: 'up', committed: false, color: '#4CAF50', source: 'waypoint', fatal: false } },
          activeIntentModes: { d1: 'goto' },
        },
      });
      const quiet = window.Alerts.log().filter((e) => e.turn === t).length;
      // … and the next broadcast of the SAME turn has the bot staging it.
      window.Alerts.observe({
        kind: 'in', at: Date.now(), type: 'selections-update',
        msg: {
          type: 'selections-update',
          stagedMoves: { 'd1': { move: null, requestedMove: 'left', committed: false, color: '#888888', source: 'bot', fatal: false } },
          activeIntentModes: { d1: 'goto' },
        },
      });
      return { quiet, after: window.Alerts.log().filter((e) => e.turn === t) };
    });
    check('drift', 'a waypoint the bot is honouring is silent', drift.quiet === 0, drift.quiet);
    check(
      'drift',
      'stage-drift fires when the bot re-stages a unit under a standing determination',
      drift.after.some((e) => e.id === 'stage-drift' && e.detail.unit === 'd1'),
      drift.after
    );

    // …and NOT when the operator did it themselves.
    const own = await page.evaluate(() => {
      const t = 9201;
      window.Alerts.observe({
        kind: 'in', at: Date.now(), type: 'board-update',
        msg: {
          type: 'board-update', turn: t,
          stagedMoves: { 'd2': { move: null, requestedMove: 'up', committed: false, color: '#4CAF50', source: 'waypoint', fatal: false } },
          activeIntentModes: { d2: 'goto' },
        },
      });
      window.Alerts.observe({ kind: 'out', at: Date.now(), type: 'select-move', msg: { type: 'select-move', snakeId: 'd2', move: 'left' } });
      window.Alerts.observe({
        kind: 'in', at: Date.now(), type: 'selections-update',
        msg: {
          type: 'selections-update',
          stagedMoves: { 'd2': { move: null, requestedMove: 'left', committed: false, color: '#888888', source: 'bot', fatal: false } },
          activeIntentModes: { d2: 'goto' },
        },
      });
      return window.Alerts.log().filter((e) => e.turn === t);
    });
    check('drift', 'a change the operator pressed for is not reported back to them as drift', own.length === 0, own);

    // THE FLASH BUDGET. Ten raisings back to back; WCAG 2.3.1 allows three
    // flashes a second and the module's own floor is one per 700 ms, so the
    // count of ring onsets over the burst is what is asserted.
    //
    // The burst is deliberately long enough that the floor is NOT the whole
    // answer: twelve raisings over ~2.9 s could produce twelve onsets, and
    // the check is vacuous unless at least two get through — so both bounds
    // are asserted, the ceiling and the floor.
    const flash = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, window.Alerts.limits.pulseMinGapMs + 150));
      const t0 = Date.now();
      const before = window.Alerts.stats().pulsed;
      const refusedBefore = window.Alerts.stats().suppressed.flash;
      for (let i = 0; i < 12; i++) {
        window.Alerts.observe({
          kind: 'in', at: Date.now(), type: 'lens-lock',
          msg: { type: 'lens-lock', ok: false, refusal: 'off-head', detail: `flash-${i}` },
        });
        await new Promise((r) => setTimeout(r, 240));
      }
      return {
        onsets: window.Alerts.stats().pulsed - before,
        elapsedMs: Date.now() - t0,
        refused: window.Alerts.stats().suppressed.flash - refusedBefore,
        minGapMs: window.Alerts.limits.pulseMinGapMs,
      };
    });
    const perSecond = flash.onsets / (flash.elapsedMs / 1000);
    check(
      'drift',
      `twelve raisings in ${Math.round(flash.elapsedMs)} ms produce ${flash.onsets} ring onsets — under WCAG 2.3.1's three a second`,
      perSecond <= 3,
      { ...flash, perSecond: Number(perSecond.toFixed(2)) }
    );
    check(
      'drift',
      '…and the check is not vacuous: at least two of them did get through',
      flash.onsets >= 2,
      { ...flash, perSecond: Number(perSecond.toFixed(2)) }
    );
    check('drift', 'the refused flashes are counted', flash.refused > 0, flash.refused);

    // REDUCED MOTION. The stylesheet must have taken the transitions off.
    const motion = await page.evaluate(() => {
      const ring = document.querySelector('.al-pulse');
      const cs = getComputedStyle(ring);
      return {
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        transition: cs.transitionDuration,
        position: cs.position,
        pointerEvents: cs.pointerEvents,
      };
    });
    check('drift', 'the page is under prefers-reduced-motion', motion.reduced === true, motion);
    check(
      'drift',
      'the ring does not animate under reduced motion',
      /^0s(,\s*0s)*$/.test(String(motion.transition).trim()),
      motion
    );
    check('drift', 'the ring never takes a click — the channel cannot block input', motion.pointerEvents === 'none' && motion.position === 'fixed', motion);
    await shot(page, '06-reduced-motion', 'the ring under prefers-reduced-motion');

    // PERSISTENCE. The preference is the operator's, and it has to survive the
    // reload that a page this long-lived will certainly get.
    await page.evaluate(() => window.Alerts.setPrefs({ muted: true, volume: 0.25, events: { 'stage-drift': false } }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1800);
    const persisted = await page.evaluate(() => window.Alerts.prefs());
    check(
      'drift',
      'mute, volume and the per-event opt-out survive a reload',
      persisted.muted === true && Math.abs(persisted.volume - 0.25) < 0.001 && persisted.events['stage-drift'] === false,
      persisted
    );
    await page.evaluate(() => window.Alerts.setPrefs({ muted: false, volume: 0.6, events: { 'stage-drift': true } }));
  } finally {
    await page.close();
    await stopServer(server);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const scenes = { wire: sceneWire, operator: sceneOperator, drift: sceneDrift };
    for (const [name, fn] of Object.entries(scenes)) {
      if (ONLY && !ONLY.split(',').includes(name)) continue;
      await fn(browser);
    }
  } finally {
    await browser.close();
    check(
      'all',
      'at least one photograph caught the ring actually up',
      report.shots.some((sh) => sh.ring && sh.ring.on),
      report.shots.map((sh) => ({ name: sh.name, on: sh.ring && sh.ring.on, alert: sh.ring && sh.ring.alert }))
    );
    report.failures = failures;
    report.passed = report.checks.filter((c) => c.ok).length;
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  }
  console.log(
    `\n${report.passed}/${report.checks.length} checks passed` +
      `${failures ? `, ${failures} FAILED` : ''}; ${report.shots.length} shots → ${OUT}`
  );
  if (report.exceptions.length) console.log('page exceptions:', report.exceptions.slice(0, 4));
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
