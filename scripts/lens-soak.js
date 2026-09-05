/**
 * THE LONG SESSION — 200 turns with every module live, and what the page holds
 * on to while they go past.
 *
 * `scripts/lens-latency-profile.js` asks what a turn COSTS. This asks the other
 * question, the one an operator who leaves the tab open all afternoon is
 * actually exposed to: what does the page ACCUMULATE? A surface can be fast
 * per turn and still be unusable by turn 400 because every turn left something
 * behind — a listener on a node that no longer exists, an interval nobody
 * cleared, an array that only ever grows, a cache with no ceiling.
 *
 * The five modules the operator page now runs are all live here: the lens view
 * (`lens-view.js` + `lens-panel.js`), `latency.js`, `alerts.js`, `tour.js` and
 * `page-chrome.js`, plus `board-renderer.js`, `keynav-machine.js` and
 * `ws-client.js` underneath them.
 *
 * WHAT IS MEASURED, per turn:
 *   · JS heap used            — CDP `Performance.getMetrics`, after a forced
 *                               `HeapProfiler.collectGarbage`, so the curve is
 *                               retained bytes and not GC sawtooth.
 *   · DOM node count          — `Nodes` from the same metrics block.
 *   · Event listener count    — `JSEventListeners`, the browser's own count of
 *                               live registrations, plus a per-module ledger
 *                               this script installs before any page script
 *                               runs (`addEventListener` / `removeEventListener`
 *                               wrapped, attributed by stack).
 *   · Live timers             — `setTimeout` / `setInterval` wrapped the same
 *                               way, so an interval nobody clears is named.
 *   · Detached DOM            — heap snapshots at turn 50 and turn 200,
 *                               differenced on nodes whose class name begins
 *                               `Detached `.
 *
 * WHAT IS DRIVEN, interleaved with the turns (see `DRILLS`): hover, focus,
 * candidate selection, moveset walk, foil, drill, scrub, undo, lock, lane
 * expand — the same gestures `scripts/lens-walkthrough.js` photographs, run on
 * a schedule instead of once. The wire is reshaped through `/dev/wire` on a
 * cycle so the latency ladder actually changes state (and so `alerts.js` has
 * something to raise), and the tour is opened once and closed.
 *
 * Usage:
 *   npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts --port=5311 &
 *   node scripts/lens-soak.js --port=5311 --turns=200 --out=docs/design/ux/soak/after
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = parseInt(arg('port', '5311'), 10);
const TURNS = parseInt(arg('turns', '200'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/soak'));
const GAME = arg('game', 'lens-walk');
const LABEL = arg('label', 'soak');
const NO_DRILLS = process.argv.includes('--no-drills');
const SNAP_AT = arg('snapshots', '50,200')
  .split(',')
  .map((n) => parseInt(n, 10))
  .filter((n) => n > 0);
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ────────────────────────────────────────────────────────────────────────
 * THE LEDGER, installed before any page script runs.
 *
 * `Performance.getMetrics` gives the browser's own totals, which are the
 * ground truth and cannot be argued with. They also cannot say WHOSE listener
 * it is, and "listeners grew by 1,400" is not a finding anybody can act on.
 * So both: the browser counts, and this attributes.
 *
 * Attribution is by stack. Every module on this page is its own file, so the
 * first frame naming a known script is the module that asked. Inline page code
 * shows up as the document URL and is called `play-game.html`.
 * ──────────────────────────────────────────────────────────────────────── */
const LEDGER = `(() => {
  const MODULES = [
    'lens-view.js', 'lens-panel.js', 'latency.js', 'alerts.js', 'tour.js',
    'page-chrome.js', 'board-renderer.js', 'keynav-machine.js', 'ws-client.js',
    'dom-utils.js', 'idle-watcher.js', 'idle-policy.js', 'connection-debug.js',
    'server-status-badge.js', 'firebase-status-banner.js', 'replay-deeplink.js',
    'activity-periods.js',
  ];
  function blame() {
    const stack = (new Error()).stack || '';
    const lines = stack.split('\\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf('__soak') !== -1) continue;
      for (const m of MODULES) if (line.indexOf('/' + m) !== -1) return m;
      if (line.indexOf('/game/') !== -1 || line.indexOf('play-game') !== -1) return 'play-game.html';
    }
    return 'unknown';
  }
  const bump = (bag, key, by) => { bag[key] = (bag[key] || 0) + by; };

  const timers = { live: {}, made: {}, cleared: {} };
  const liveTimeout = new Map();   // id -> module
  const liveInterval = new Map();

  const rawST = window.setTimeout;
  const rawSI = window.setInterval;
  const rawCT = window.clearTimeout;
  const rawCI = window.clearInterval;

  window.setTimeout = function (fn, ms) {
    const who = blame();
    const args = Array.prototype.slice.call(arguments, 2);
    // The handle must be assigned BEFORE the callback can run, and a 0ms
    // timer in a task-starved page can. So the map is written first with a
    // placeholder the callback deletes by identity.
    let id;
    const wrapped = typeof fn === 'function'
      ? function () { liveTimeout.delete(id); bump(timers.live, who, -1); return fn.apply(this, arguments); }
      : fn;
    id = rawST.apply(window, [wrapped, ms].concat(args));
    liveTimeout.set(id, who);
    bump(timers.live, who, 1);
    bump(timers.made, who + ' (timeout)', 1);
    return id;
  };
  window.setInterval = function (fn, ms) {
    const who = blame();
    const args = Array.prototype.slice.call(arguments, 2);
    const id = rawSI.apply(window, [fn, ms].concat(args));
    liveInterval.set(id, who);
    bump(timers.live, who, 1);
    bump(timers.made, who + ' (interval)', 1);
    return id;
  };
  window.clearTimeout = function (id) {
    if (liveTimeout.has(id)) {
      bump(timers.live, liveTimeout.get(id), -1);
      bump(timers.cleared, liveTimeout.get(id), 1);
      liveTimeout.delete(id);
    }
    return rawCT.call(window, id);
  };
  window.clearInterval = function (id) {
    if (liveInterval.has(id)) {
      bump(timers.live, liveInterval.get(id), -1);
      bump(timers.cleared, liveInterval.get(id), 1);
      liveInterval.delete(id);
    }
    return rawCI.call(window, id);
  };

  /* Listeners. The handler is NEVER wrapped — a wrapped handler has a
   * different identity and \`removeEventListener\` with the original would
   * silently stop working, which would be this instrument breaking the thing
   * it is measuring. So the ledger is keyed on (target, type, listener,
   * capture) exactly as the DOM dedupes them, and a \`once\` registration is
   * counted separately because nothing can observe it firing without wrapping
   * it. Read \`net\` as "adds that were never removed, minus the once-shots
   * that may have retired themselves". */
  const listeners = { net: {}, added: {}, removed: {}, once: {} };
  const perTarget = new WeakMap();
  const rawAdd = EventTarget.prototype.addEventListener;
  const rawRemove = EventTarget.prototype.removeEventListener;
  const capOf = (opts) => (typeof opts === 'boolean' ? opts : !!(opts && opts.capture));

  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      if (fn) {
        let map = perTarget.get(this);
        if (map === undefined) { map = new Map(); perTarget.set(this, map); }
        const key = type + '\\u0000' + (capOf(opts) ? '1' : '0');
        let set = map.get(key);
        if (set === undefined) { set = new Map(); map.set(key, set); }
        if (!set.has(fn)) {
          const who = blame();
          set.set(fn, who);
          bump(listeners.net, who, 1);
          bump(listeners.added, who, 1);
          if (opts && opts.once) bump(listeners.once, who, 1);
        }
      }
    } catch (e) { /* never let the instrument break the page */ }
    return rawAdd.apply(this, arguments);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    try {
      const map = perTarget.get(this);
      if (map !== undefined && fn) {
        const key = type + '\\u0000' + (capOf(opts) ? '1' : '0');
        const set = map.get(key);
        if (set !== undefined && set.has(fn)) {
          const who = set.get(fn);
          set.delete(fn);
          bump(listeners.net, who, -1);
          bump(listeners.removed, who, 1);
        }
      }
    } catch (e) { /* as above */ }
    return rawRemove.apply(this, arguments);
  };

  const prune = (bag) => {
    const out = {};
    for (const k of Object.keys(bag)) if (bag[k] !== 0) out[k] = bag[k];
    return out;
  };
  window.__soak = {
    timers: () => ({
      live: prune(timers.live),
      liveTotal: Object.keys(timers.live).reduce((a, k) => a + timers.live[k], 0),
      intervals: liveInterval.size,
      timeouts: liveTimeout.size,
      made: prune(timers.made),
      cleared: prune(timers.cleared),
    }),
    listeners: () => ({
      net: prune(listeners.net),
      netTotal: Object.keys(listeners.net).reduce((a, k) => a + listeners.net[k], 0),
      added: prune(listeners.added),
      removed: prune(listeners.removed),
      once: prune(listeners.once),
    }),
  };
})();`;

/* ── the server side of the soak ──────────────────────────────────────── */
const step = () => fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json());
const wire = (body) =>
  fetch(`${BASE}/dev/wire`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

/* ── metrics ──────────────────────────────────────────────────────────── */
async function metrics(cdp, { gc } = { gc: true }) {
  if (gc) await cdp.send('HeapProfiler.collectGarbage');
  const { metrics: rows } = await cdp.send('Performance.getMetrics');
  const out = {};
  for (const r of rows) out[r.name] = r.value;
  return out;
}

/**
 * A heap snapshot, streamed off CDP and parsed for what a long session is
 * actually at risk of: DOM nodes the page has dropped but JS still holds.
 * V8 names those `Detached <ClassName>`, so they are countable without
 * walking the retainer graph.
 */
async function heapSnapshot(cdp, file) {
  const chunks = [];
  const onChunk = ({ chunk }) => chunks.push(chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', {
    reportProgress: false,
    treatGlobalObjectsAsRoots: true,
    captureNumericValue: false,
  });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const text = chunks.join('');
  if (process.env.LENS_SOAK_RAW && file) fs.writeFileSync(file + '.heapsnapshot', text);
  const snap = JSON.parse(text);
  const fields = snap.snapshot.meta.node_fields;
  const stride = fields.length;
  const nameAt = fields.indexOf('name');
  const sizeAt = fields.indexOf('self_size');
  const typeAt = fields.indexOf('type');
  const nodeTypes = snap.snapshot.meta.node_types[0];
  const detached = {};
  let detachedCount = 0;
  let detachedBytes = 0;
  const byName = {};
  for (let i = 0; i < snap.nodes.length; i += stride) {
    const name = snap.strings[snap.nodes[i + nameAt]];
    if (name === undefined) continue;
    const size = snap.nodes[i + sizeAt];
    if (name.startsWith('Detached ')) {
      detachedCount++;
      detachedBytes += size;
      detached[name] = (detached[name] || 0) + 1;
    }
    // The biggest retained *constructors*, so a heap that grew has somewhere
    // to point. Object/Array totals are the ones that move when a cache does.
    if (nodeTypes[snap.nodes[i + typeAt]] === 'object') {
      const b = byName[name] || (byName[name] = { count: 0, bytes: 0 });
      b.count++;
      b.bytes += size;
    }
  }
  const top = Object.entries(byName)
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 25)
    .map(([name, v]) => ({ name, count: v.count, bytes: v.bytes }));
  if (file) fs.writeFileSync(file, JSON.stringify({ detached, top }, null, 2));
  return {
    nodes: snap.nodes.length / stride,
    detachedCount,
    detachedBytes,
    detached: Object.fromEntries(
      Object.entries(detached)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
    ),
    top,
  };
}

/* ── the operator, on a schedule ──────────────────────────────────────── */

/**
 * EVERY HANDLE IS DISPOSED, and this is not tidiness — it is the difference
 * between measuring the page and measuring the instrument.
 *
 * A Playwright `ElementHandle` is a global handle in the page's own V8 heap.
 * The roster and the rail are rebuilt several times a turn, so a handle taken
 * on one turn names a node the page has since dropped — and the handle keeps
 * that node, and its whole detached subtree, alive. A first version of this
 * driver did not dispose, and it reported the page growing 32 DOM nodes a
 * turn; the same run with the drills switched off reported −1.6. The 32 was
 * Playwright. Nothing here holds a handle across an `await` it does not need
 * to, and every handle is disposed in a `finally`.
 */
async function withHandle(promise, fn) {
  const h = await promise;
  if (!h) return null;
  try {
    return await fn(h);
  } finally {
    await h.dispose().catch(() => {});
  }
}

async function withHandles(promise, fn) {
  const hs = await promise;
  try {
    return await fn(hs);
  } finally {
    await Promise.all(hs.map((h) => h.dispose().catch(() => {})));
  }
}

/** Focus a roster row; the page ignores a click on the row already focused. */
async function focusUnit(page, index) {
  await withHandles(page.$$('.snake-info-item.selectable'), async (rows) => {
    if (!rows[index]) return;
    try {
      await rows[index].click({ timeout: 2000 });
    } catch (e) { /* the roster re-rendered under us; the next turn tries again */ }
  });
}

async function hoverBoard(page, box, t) {
  if (!box) return;
  const fx = 0.15 + ((t * 7) % 60) / 100;
  const fy = 0.15 + ((t * 11) % 60) / 100;
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
}

/** The candidate the reserve actually answered — the same one the walkthrough
 *  clicks, so the pin/lock path this soak exercises is the shipped one. */
async function clickAnsweredCandidate(page) {
  const lock = await page.evaluate(() => {
    const events = typeof lensEvents === 'undefined' ? [] : lensEvents;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      const locks = e && e.kind === 'conditional' && e.payload ? e.payload.locks : null;
      if (locks && locks[0]) return locks[0];
    }
    return null;
  });
  if (!lock) return false;
  return (
    (await withHandle(
      page.$(`.lens-candidates [data-lens-candidate="${lock.to}"]`),
      async (cell) => {
        try {
          await cell.click({ timeout: 2000 });
          return true;
        } catch (e) {
          return false;
        }
      }
    )) === true
  );
}

/**
 * THE DRILL SCHEDULE. Coprime periods, so the combinations that come up are
 * not the same four every ten turns; a soak whose gestures are in phase with
 * its turns is a soak that only ever visits a handful of states.
 */
const DRILLS = [
  { every: 1, name: 'hover', run: (p, ctx) => hoverBoard(p, ctx.box, ctx.turn) },
  { every: 2, name: 'moveset-hover', run: (p) =>
      withHandles(p.$$('.lens-movesets .lens-table tr'), async (rows) => {
        if (rows.length > 1) await rows[1].hover({ timeout: 1500 }).catch(() => {});
      }) },
  { every: 3, name: 'focus', run: (p, ctx) => focusUnit(p, ctx.turn % 2) },
  { every: 5, name: 'candidate', run: (p) => clickAnsweredCandidate(p) },
  { every: 5, name: 'moveset-walk', run: async (p) => {
      await p.keyboard.press(']');
      await p.keyboard.press('[');
    } },
  { every: 7, name: 'foil', run: async (p) => {
      await p.keyboard.press('f');
      await p.keyboard.press('f');
    } },
  { every: 7, name: 'drill', run: (p) => p.keyboard.press('b') },
  { every: 11, name: 'scrub', run: async (p) => {
      await p.keyboard.press('Home');
      await p.keyboard.press('>');
      await p.keyboard.press('n');
    } },
  { every: 11, name: 'undo', run: (p) => p.keyboard.press('u') },
  { every: 13, name: 'lock', run: async (p) => {
      await p.keyboard.press('Shift+ ');
      await p.keyboard.press('Escape');
    } },
  { every: 17, name: 'lane', run: (p) =>
      withHandle(p.$('#lensLane .lens-lane-foot'), async (foot) => {
        await foot.click({ timeout: 1500 }).catch(() => {});
        await foot.click({ timeout: 1500 }).catch(() => {});
      }) },
  { every: 19, name: 'alerts-pop', run: (p) =>
      withHandle(p.$('#alerts-mount button'), async (btn) => {
        await btn.click({ timeout: 1500 }).catch(() => {});
        await p.keyboard.press('Escape');
      }) },
];

/** The ladder, cycled. `/dev/wire` reshapes the transport under a page that
 *  stays open, which is the only way a single session sees the ladder change
 *  state — and the only way `alerts.js`'s wire events fire more than once. */
const WIRES = [
  { latency: 0 },
  { latency: 110, jitter: 30 },
  { latency: 0 },
  { latency: 240, jitter: 60 },
  { latency: 0 },
  { latency: 60 },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(() => {
    try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ }
  });
  await context.addInitScript(LEDGER);

  const page = await context.newPage();
  const report = {
    label: LABEL,
    turns: TURNS,
    startedAt: new Date().toISOString(),
    console: [],
    exceptions: [],
    samples: [],
    snapshots: {},
    drills: {},
  };
  page.on('console', (m) => {
    if (m.type() === 'error') report.console.push({ turn: report.samples.length, text: m.text() });
  });
  page.on('pageerror', (e) =>
    report.exceptions.push({ turn: report.samples.length, text: String(e && e.message) })
  );

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');

  // ── enter ───────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/game/${GAME}`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if (await withHandle(page.$('#loginGate.active'), () => true)) {
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.fill('#loginNameInput', attempt === 0 ? 'Soak' : `Soak-${attempt + 1}`);
      await sleep(400);
      if (!(await page.$eval('#loginGateSubmit', (el) => el.disabled))) {
        await page.click('#loginGateSubmit');
        await sleep(2200);
        break;
      }
    }
  }
  // The gesture `alerts.js` waits for before it may make a sound, in a corner
  // nothing owns — the same one the alerts drill uses.
  await page.mouse.click(4, 4);
  await step();
  await sleep(1500);
  await focusUnit(page, 0);
  await sleep(800);

  // Taken once and released at once: the canvas outlives every turn, but the
  // HANDLE does not need to, and a handle held for 200 turns is one more
  // global root in the heap this run is trying to read.
  const box = await withHandle(page.$('#gameCanvas'), (c) => c.boundingBox());

  // The baseline is taken AFTER entry and one turn, because the cost of
  // standing the page up is not a leak and charging it to turn 1 would put a
  // step in the curve that no later turn repeats.
  const base = await metrics(cdp);
  report.baseline = base;

  let wireAt = -1;
  for (let t = 1; t <= TURNS; t++) {
    // The wire moves every 40 turns, so the ladder changes state five times in
    // a 200-turn soak rather than never.
    const wantWire = Math.floor((t - 1) / 40) % WIRES.length;
    if (wantWire !== wireAt) {
      wireAt = wantWire;
      await wire(WIRES[wireAt]).catch(() => {});
    }

    await step();
    await sleep(120);

    const ctx = { turn: t, box };
    for (const d of NO_DRILLS ? [] : DRILLS) {
      if (t % d.every !== 0) continue;
      try {
        await d.run(page, ctx);
        report.drills[d.name] = (report.drills[d.name] || 0) + 1;
      } catch (e) {
        report.drills[`${d.name}!error`] = (report.drills[`${d.name}!error`] || 0) + 1;
      }
    }

    // THE TOUR, ONCE. It is a module with an interval and four document
    // listeners; a session that never opens it never finds out whether it
    // gives them back.
    if (t === 20 && !NO_DRILLS) {
      await page.evaluate(() => window.Tour && window.Tour.open && window.Tour.open());
      await sleep(500);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await sleep(300);
      await page.keyboard.press('Escape');
      await sleep(300);
      report.drills.tour = (report.drills.tour || 0) + 1;
    }

    // GC BEFORE EVERY SAMPLE, not every fifth. Between collections this page
    // holds four to five thousand nodes it has already dropped, so an ungc'd
    // node count reads 1,859 one turn and 8,163 the next and says nothing
    // about what is RETAINED — which is the only question a soak asks.
    const m = await metrics(cdp, { gc: true });
    const inst = await page.evaluate(() =>
      window.__soak ? { timers: window.__soak.timers(), listeners: window.__soak.listeners() } : null
    );
    // THE PAGE'S OWN COLLECTIONS, counted. A heap that grows says how much;
    // only the page can say what of. Every one of these is a top-level binding
    // in `play-game.html`'s script or a module's public read.
    const held = await page.evaluate(() => {
      const size = (v) =>
        v === undefined || v === null
          ? null
          : typeof v.size === 'number'
            ? v.size
            : typeof v.length === 'number'
              ? v.length
              : Object.keys(v).length;
      const of = (name) => {
        try { return size(eval(name)); } catch (e) { return null; }
      };
      return {
        turnTimeline: of('turnTimeline'),
        timelineTurns: of('timelineTurns'),
        historicEvents: of('historicEvents'),
        historicEventsInflight: of('historicEventsInflight'),
        lensEvents: of('lensEvents'),
        lensTranscript: of('lensTranscript'),
        lensTrails: of('lensTrails'),
        lensPending: of('lensPending'),
        lensUndoStack: of('lensUndoStack'),
        snakeLastSeen: of('snakeLastSeen'),
        connectedUsers: of('connectedUsers'),
        enrolledNames: of('enrolledNames'),
        controlledSnakeTurnData: of('controlledSnakeTurnData'),
        gameEndedSnakes: of('gameEndedSnakes'),
        alertsLog: window.Alerts ? window.Alerts.log().length : null,
        latencyPending: window.LatencyView ? window.LatencyView.pending().length : null,
      };
    });
    const dom = await page.evaluate(() => {
      const n = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getElementsByTagName('*').length : null;
      };
      return {
        rail: n('#lensRail'),
        lane: n('#lensLane'),
        stage: n('#lensStage'),
        controls: n('#lensControls'),
        roster: n('#snakeInfo'),
        timeline: n('#timelineScrubber') || n('.timeline-scrubber'),
        alerts: n('#alerts-mount'),
        latency: n('#latency-mount'),
        tour: n('#tour-mount'),
        chrome: n('#pageChrome') || n('.page-chrome'),
        body: document.body.getElementsByTagName('*').length,
        head: document.head.getElementsByTagName('*').length,
        detachedRoots: null,
      };
    });
    report.samples.push({
      turn: t,
      gc: true,
      dom,
      held,
      heapUsed: m.JSHeapUsedSize,
      heapTotal: m.JSHeapTotalSize,
      nodes: m.Nodes,
      documents: m.Documents,
      listeners: m.JSEventListeners,
      layouts: m.LayoutCount,
      recalcs: m.RecalcStyleCount,
      scriptMs: Math.round((m.ScriptDuration || 0) * 1000),
      layoutMs: Math.round((m.LayoutDuration || 0) * 1000),
      timersLive: inst && inst.timers.liveTotal,
      intervalsLive: inst && inst.timers.intervals,
      listenersNet: inst && inst.listeners.netTotal,
    });
    if (SNAP_AT.includes(t)) {
      report.snapshots[`turn${t}`] = await heapSnapshot(
        cdp,
        path.join(OUT, `${LABEL}-heap-${t}.json`)
      );
      report.snapshots[`turn${t}`].instrument = inst;
      console.log(
        `  · turn ${t}: snapshot — ${report.snapshots[`turn${t}`].detachedCount} detached nodes, ` +
          `${(report.snapshots[`turn${t}`].detachedBytes / 1024).toFixed(0)} KB`
      );
    }
    if (t % 10 === 0 || t === 1) {
      const s = report.samples[report.samples.length - 1];
      console.log(
        `  turn ${String(t).padStart(3)}  heap ${(s.heapUsed / 1048576).toFixed(1)} MB  ` +
          `nodes ${s.nodes}  listeners ${s.listeners}  timers ${s.timersLive}  ` +
          `net ${s.listenersNet}`
      );
    }
  }

  const finalInst = await page.evaluate(() =>
    window.__soak ? { timers: window.__soak.timers(), listeners: window.__soak.listeners() } : null
  );
  report.instrument = finalInst;
  report.alerts = await page.evaluate(() =>
    window.Alerts ? { stats: window.Alerts.stats(), log: window.Alerts.log().length } : null
  );
  report.ladder = await page.evaluate(() =>
    window.LatencyView ? window.LatencyView.read().state : null
  );

  // ── the curves, as slopes ───────────────────────────────────────────────
  // A least-squares fit over the second half only. The first turns of any page
  // are still filling caches that are SUPPOSED to fill — the roster, the
  // timeline, the fonts — and a fit that includes them measures warm-up and
  // calls it a leak.
  const half = report.samples.slice(Math.floor(report.samples.length / 2));
  const slope = (key) => {
    const pts = half.filter((s) => s[key] !== undefined && s[key] !== null);
    if (pts.length < 3) return null;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p.turn, 0) / n;
    const my = pts.reduce((a, p) => a + p[key], 0) / n;
    let num = 0;
    let den = 0;
    for (const p of pts) {
      num += (p.turn - mx) * (p[key] - my);
      den += (p.turn - mx) ** 2;
    }
    return den === 0 ? null : num / den;
  };
  const first = report.samples[0];
  const last = report.samples[report.samples.length - 1];
  report.growth = {
    perTurn: {
      heapBytes: slope('heapUsed'),
      nodes: slope('nodes'),
      listeners: slope('listeners'),
      timers: slope('timersLive'),
      listenersNet: slope('listenersNet'),
    },
    firstToLast: {
      heapBytes: last.heapUsed - first.heapUsed,
      nodes: last.nodes - first.nodes,
      listeners: last.listeners - first.listeners,
      timers: last.timersLive - first.timersLive,
      listenersNet: last.listenersNet - first.listenersNet,
    },
    first: { turn: first.turn, heapMB: +(first.heapUsed / 1048576).toFixed(2), nodes: first.nodes, listeners: first.listeners },
    last: { turn: last.turn, heapMB: +(last.heapUsed / 1048576).toFixed(2), nodes: last.nodes, listeners: last.listeners },
  };

  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));
  console.log(`\n${LABEL}: ${TURNS} turns`);
  console.log(
    `  heap    ${report.growth.first.heapMB} → ${report.growth.last.heapMB} MB  ` +
      `(${(report.growth.perTurn.heapBytes / 1024).toFixed(2)} KB/turn)`
  );
  console.log(
    `  nodes   ${report.growth.first.nodes} → ${report.growth.last.nodes}  ` +
      `(${report.growth.perTurn.nodes.toFixed(2)}/turn)`
  );
  console.log(
    `  listen  ${report.growth.first.listeners} → ${report.growth.last.listeners}  ` +
      `(${report.growth.perTurn.listeners.toFixed(2)}/turn)`
  );
  console.log(`  timers  live ${last.timersLive}, intervals ${finalInst.timers.intervals}`);
  console.log(`  net listeners by module: ${JSON.stringify(finalInst.listeners.net)}`);
  console.log(`  live timers by module:   ${JSON.stringify(finalInst.timers.live)}`);
  console.log(`  exceptions: ${report.exceptions.length}, console errors: ${report.console.length}`);
  console.log(`  → ${path.join(OUT, `${LABEL}.json`)}`);

  await browser.close();
}

main().catch((err) => {
  console.error('[soak] failed:', err);
  process.exit(1);
});
