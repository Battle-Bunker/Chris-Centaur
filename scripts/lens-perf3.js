/**
 * ROUND 3 — THE SHIPPED PAGE, RE-TIMED, ON A LAPTOP THAT IS NOT THIS BOX.
 *
 * `scripts/lens-latency-profile.js` (round 1) times the four spans of a turn
 * by wrapping the page's own functions. `scripts/lens-churn.js` (round 2) asks
 * what a second costs. Six modules landed after both of them — `tokens.css`,
 * `alerts.js`, `tour.js`, `review.js`, the motion/marks vocabulary, `prefs.js`
 * and `input-layer.js` — and nothing re-profiled the page they landed on.
 *
 * This is that re-profile, and it adds the six things round 1 could not say:
 *
 *   (a) CPU THROTTLING. `Emulation.setCPUThrottlingRate` at 1x, 4x and 6x.
 *       Every number round 1 and round 2 published is a number from a shared
 *       cloud box at 1x, and the operator's laptop is not this box. A budget
 *       stated at 1x is a budget stated for the one machine nobody uses.
 *   (b) INPUT LATENCY. Press → the chip acknowledging it is PAINTED, and
 *       press → the board is PAINTED, p50/p95 over N presses. Two clocks per
 *       press: the browser's own Event Timing `duration` (press to the next
 *       paint, 8 ms granularity, and the only one that counts the time before
 *       our handler ran) and a double-`requestAnimationFrame` stamp taken from
 *       a capture-phase listener installed before any page script (precise,
 *       and an over-read by at most one frame). Both are reported, because
 *       either alone can be argued with.
 *   (c) LONG TASKS per turn, > 50 ms, with what of ours was inside them and
 *       what the CDP sampler says was inside the rest.
 *   (d) THE COST OF EACH NEW MODULE, isolated: `--ablate=alerts.js` serves
 *       that script as an empty body, so the page runs with the module's
 *       mount absent and everything else identical. The difference between a
 *       run with it and a run without it is that module's cost, including the
 *       style, layout and paint it CAUSES — which a wrapper around its own
 *       draw could never see.
 *   (e) STYLE RECALC AND LAYOUT COUNTS PER TURN, from CDP
 *       `Performance.getMetrics` read either side of each `/dev/step`.
 *   (f) COLD LOAD (`--mode=cold`): script bytes, requests, what is in front of
 *       first paint, and the PARSE/COMPILE time under it — taken from a v8
 *       trace rather than guessed at, because round 1 proved JSON parse is not
 *       a cost and did not measure script compile at all.
 *
 * Nothing measured here is a copy of shipped code: every span is the page's
 * own function, wrapped in place.
 *
 *   node scripts/ux-walk-server.js --port=5341
 *   node scripts/lens-perf3.js --port=5341 --turns=8 --throttle=4
 *   node scripts/lens-perf3.js --port=5341 --ablate=alerts.js
 *   node scripts/lens-perf3.js --port=5341 --mode=cold
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
const PORT = parseInt(arg('port', '5341'), 10);
const TURNS = parseInt(arg('turns', '8'), 10);
const PRESSES = parseInt(arg('presses', '40'), 10);
const MOVES = parseInt(arg('moves', '200'), 10);
const THROTTLE = parseFloat(arg('throttle', '1'));
const MODE = arg('mode', 'turns');
const ABLATE = arg('ablate', '').split(',').map((s) => s.trim()).filter(Boolean);
const LABEL = arg('label', `perf3-${MODE}-${THROTTLE}x${ABLATE.length ? '-no-' + ABLATE.join('+') : ''}`);
const OUT = arg('out', '');
const GAME = arg('game', 'lens-walk');
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── statistics ─────────────────────────────────────────────────────────────
const stats = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    n: s.length,
    sum: +s.reduce((a, b) => a + b, 0).toFixed(2),
    p50: +at(50).toFixed(2),
    p95: +at(95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
  };
};

// ───────────────────────────────────────────────────────────────────────────
// INIT — installed before any page script. Three things that cannot be
// wrapped afterwards: the parse, the geometry getters, and a capture-phase
// listener that must be the FIRST one to see a press.
// ───────────────────────────────────────────────────────────────────────────
const INIT = () => {
  const L = {
    msgs: [],
    spans: [],
    open: null,
    longTasks: [],
    events: [],          // Event Timing entries for keydown / pointerdown
    presses: [],         // {t0, kind, chipPaintMs, boardPaintMs}
    press: null,
    turnNo: -1,
  };
  window.__p3 = L;

  const rawParse = JSON.parse;
  JSON.parse = function (text) {
    const t0 = performance.now();
    const out = rawParse.apply(this, arguments);
    if (typeof text === 'string' && text.length > 512) {
      L.msgs.push({ t: t0, bytes: text.length, type: out && out.type ? out.type : '?', parseMs: performance.now() - t0 });
    }
    return out;
  };

  const geom = ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'];
  for (const prop of geom) {
    for (const proto of [HTMLElement.prototype, Element.prototype]) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.get) continue;
      Object.defineProperty(proto, prop, {
        configurable: true,
        get() { if (L.open) L.open.layoutReads++; return d.get.call(this); },
      });
    }
  }
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (L.open) L.open.layoutReads++;
    return rect.apply(this, arguments);
  };

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) L.longTasks.push({ t: e.startTime, ms: e.duration, turn: L.turnNo });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* not every build ships longtask */ }

  // EVENT TIMING. `duration` is press-to-next-paint, rounded up to 8 ms, and
  // it is the only clock that includes the time before our handler ran — the
  // input delay a busy main thread adds, which is exactly what a 4x CPU is
  // being asked about. `durationThreshold: 0` because the default is 104 ms
  // and every press we hope to measure is below it.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name !== 'keydown' && e.name !== 'pointerdown') continue;
        L.events.push({
          name: e.name,
          t: e.startTime,
          durationMs: e.duration,
          delayMs: +(e.processingStart - e.startTime).toFixed(2),
          handlerMs: +(e.processingEnd - e.processingStart).toFixed(2),
        });
      }
    }).observe({ type: 'event', durationThreshold: 0, buffered: true });
  } catch (e) { /* no event timing */ }

  // THE PRESS, STAMPED BEFORE ANY PAGE HANDLER. Registered here — before the
  // page's own scripts exist — and in the capture phase at the window, so it
  // is the first listener on the path and `t0` is the press and not the press
  // plus whatever ran ahead of us.
  const onPress = (kind) => (ev) => {
    if (!ev.isTrusted) return;
    const rec = { t0: performance.now(), kind, chipPaintMs: null, boardPaintMs: null, turn: L.turnNo };
    L.press = rec;
    L.presses.push(rec);
  };
  window.addEventListener('keydown', onPress('key'), true);
  window.addEventListener('pointerdown', onPress('pointer'), true);

  // A PAINT STAMP. The first rAF runs before the frame it is in is painted;
  // the second runs at the top of the NEXT frame, which is after that paint
  // was committed. So this is an over-read by at most one frame and never an
  // under-read, which is the direction a latency number should err in.
  L.stampPaint = (rec, field) => {
    if (!rec || rec[field] !== null) return;
    rec[field] = -1;                       // claimed, so a second mutation does not re-arm
    requestAnimationFrame(() => requestAnimationFrame(() => {
      rec[field] = +(performance.now() - rec.t0).toFixed(2);
    }));
  };
};

// ───────────────────────────────────────────────────────────────────────────
// WRAP — the page's own globals, once it has defined them.
// ───────────────────────────────────────────────────────────────────────────
const WRAP = () => {
  const L = window.__p3;
  const wrap = (holder, name, label, after) => {
    const fn = holder[name];
    if (typeof fn !== 'function' || fn.__p3) return false;
    const wrapped = function () {
      const parent = L.open;
      const span = { name: label, t: performance.now(), ms: 0, layoutReads: 0, turn: L.turnNo };
      L.open = span;
      try {
        return fn.apply(this, arguments);
      } finally {
        span.ms = performance.now() - span.t;
        L.open = parent;
        if (parent) parent.layoutReads += span.layoutReads;
        L.spans.push(span);
        if (after) { try { after(); } catch (e) { /* instrumentation only */ } }
      }
    };
    wrapped.__p3 = true;
    try {
      Object.defineProperty(holder, name, { configurable: true, enumerable: true, writable: true, value: wrapped });
    } catch (e) {
      try { holder[name] = wrapped; } catch (e2) { return false; }
    }
    return holder[name] === wrapped;
  };

  const done = {};
  for (const n of ['lensRender', 'renderGameBoard', 'renderSnakeInfo', 'ingestLensFrames',
                   'runScheduledRender', 'renderView', 'updateMoveControls', 'repaintBoard',
                   'renderLensControls', 'renderStageLine']) {
    done[n] = wrap(window, n, n);
  }
  const BR = typeof BoardRenderer === 'undefined' ? null : BoardRenderer;
  const LP = typeof LensPanel === 'undefined' ? null : LensPanel;
  if (BR) {
    // THE BOARD PAINT STAMP hangs off the shipped draw: the first
    // `renderBoard` that finishes after a press is the frame that answers it.
    done.renderBoard = wrap(BR, 'renderBoard', 'BoardRenderer.renderBoard',
      () => { if (L.press) L.stampPaint(L.press, 'boardPaintMs'); });
    done.createBoardOverlay = wrap(BR, 'createBoardOverlay', 'BoardRenderer.createBoardOverlay');
    done.renderSnakeInfoLib = wrap(BR, 'renderSnakeInfo', 'BoardRenderer.renderSnakeInfo');
  }
  if (LP) {
    done.railHTML = wrap(LP, 'railHTML', 'LensPanel.railHTML');
    done.laneHTML = wrap(LP, 'laneHTML', 'LensPanel.laneHTML');
    done.chipHTML = wrap(LP, 'chipHTML', 'LensPanel.chipHTML');
    done.stageHTML = wrap(LP, 'stageHTML', 'LensPanel.stageHTML');
  }
  if (window.LensView && !window.LensView.__p3shim) {
    const LV = window.LensView;
    const shim = { __p3shim: true };
    for (const k of Object.keys(LV)) {
      const v = LV[k];
      if (typeof v === 'function') { shim[k] = v; wrap(shim, k, `LensView.${k}`); }
      else Object.defineProperty(shim, k, { get: () => LV[k], enumerable: true });
    }
    window.LensView = shim;
  }

  // The four `innerHTML` writes `lensRender` makes. Round 1 wrapped two of
  // them; the stage line and the control chips are the two it did not, and
  // they are written on exactly the same schedule.
  const protoSetter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  for (const [id, label] of [['lensRail', 'rail.innerHTML'], ['lensLane', 'lane.innerHTML'],
                             ['lensControls', 'controls.innerHTML'], ['lensStage', 'stage.innerHTML']]) {
    const el = document.getElementById(id);
    if (!el || el.__p3wrapped) continue;
    el.__p3wrapped = true;
    // Delegate to whatever is ALREADY on this element, never past it: the
    // identical-write guard lives here as an own property, and a wrapper that
    // reached to the prototype would measure a page nobody ships.
    const setter = Object.getOwnPropertyDescriptor(el, 'innerHTML') || protoSetter;
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get() { return setter.get.call(this); },
      set(v) {
        const parent = L.open;
        const str = String(v);
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
        const span = { name: label, t: performance.now(), ms: 0, layoutReads: 0, turn: L.turnNo,
                       bytes: str.length, same: h === el.__p3hash };
        el.__p3hash = h;
        L.open = span;
        try { setter.set.call(this, v); }
        finally {
          span.ms = performance.now() - span.t;
          L.open = parent;
          if (parent) parent.layoutReads += span.layoutReads;
          L.spans.push(span);
        }
      },
    });
    done[label] = true;
  }

  // THE CHIP ACK. A press is acknowledged when the control bar's pixels
  // change, so the stamp is armed by a mutation of the bar and taken on the
  // paint after it. A press that changes no chip records nothing, which is
  // the honest answer for a press with no acknowledgement.
  const controls = document.getElementById('lensControls');
  if (controls && !controls.__p3obs) {
    controls.__p3obs = true;
    new MutationObserver(() => { if (L.press) L.stampPaint(L.press, 'chipPaintMs'); })
      .observe(controls, { childList: true, subtree: true, characterData: true, attributes: true });
  }
  return done;
};

// ───────────────────────────────────────────────────────────────────────────
async function newBrowser() {
  return chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}

/** The module ablation: the script is fetched and comes back empty, so the
 *  page runs with the module's mount absent and every other byte identical.
 *  This is "the mount removed" and not "the module disabled": nothing of it
 *  parses, nothing of it installs, and nothing of it costs. */
async function ablate(context, files) {
  for (const f of files) {
    await context.route(`**/${f}`, (route) =>
      route.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript', body: '' }));
  }
}

async function enter(page) {
  await page.goto(`${BASE}/game/${GAME}`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if (await page.$('#loginGate.active')) {
    for (let i = 0; i < 5; i++) {
      await page.fill('#loginNameInput', `P3-${Math.floor(Math.random() * 1e7)}`);
      await sleep(400);
      if (!(await page.$eval('#loginGateSubmit', (el) => el.disabled))) {
        await page.click('#loginGateSubmit');
        await sleep(2500);
        break;
      }
    }
  }
  return !(await page.$('#loginGate.active'));
}

async function dismissDialog(page) {
  if (!(await page.$('#confirmDialog.active'))) return;
  const yes = await page.$('#confirmDialog .confirm-dialog-confirm, #confirmDialogConfirm, #confirmTakeoverBtn');
  if (yes) await yes.click({ timeout: 5000 }).catch(() => {});
  else await page.keyboard.press('Escape');
  await sleep(800);
}

/** The walkthrough's own focus gesture — a row that is already the active
 *  perspective fires no selection, so it goes via another unit first. */
async function focusUnit(page, index) {
  const active = await page.evaluate(() => {
    const el = document.querySelector('.snake-info-item.active-perspective');
    return el ? [...document.querySelectorAll('.snake-info-item.selectable')].indexOf(el) : -1;
  });
  if (active === index) {
    const rows = await page.$$('.snake-info-item.selectable');
    const other = index === 0 ? 1 : 0;
    if (rows[other]) { await rows[other].click().catch(() => {}); await sleep(1200); }
  }
  const again = await page.$$('.snake-info-item.selectable');
  if (again[index]) { await again[index].click({ timeout: 5000 }).catch(() => {}); await sleep(1200); }
  await dismissDialog(page);
}

const readMetrics = async (cdp) => {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const o = {};
  for (const m of metrics) o[m.name] = m.value;
  return o;
};

// ───────────────────────────────────────────────────────────────────────────
// MODE: turns
// ───────────────────────────────────────────────────────────────────────────
async function runTurns() {
  const browser = await newBrowser();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(() => { try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ } });
  await context.addInitScript(INIT);
  await ablate(context, ABLATE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  const entered = await enter(page);
  await fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
  await sleep(1500);
  await focusUnit(page, 0);
  const answered = await page.evaluate(() => {
    const events = typeof lensEvents === 'undefined' ? [] : lensEvents;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      const locks = e && e.kind === 'conditional' && e.payload ? e.payload.locks : null;
      if (locks && locks[0]) return locks[0];
    }
    return null;
  });
  if (answered) {
    const cell = await page.$(`.lens-candidates [data-lens-candidate="${answered.to}"]`);
    if (cell) { await cell.click().catch(() => {}); await sleep(900); }
  }

  const wrapped = await page.evaluate(WRAP);
  await page.evaluate(() => {
    const L = window.__p3;
    L.msgs = []; L.spans = []; L.longTasks = []; L.events = []; L.presses = [];
  });

  // THE THROTTLE GOES ON AFTER THE SETUP, not before: a 6x page takes half a
  // minute to enter and the entry is not what is being measured.
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const settle = Math.round(1400 * Math.max(1, THROTTLE));

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');

  const perTurn = [];
  for (let i = 0; i < TURNS; i++) {
    await page.evaluate((n) => { window.__p3.turnNo = n; }, i);
    const before = await readMetrics(cdp);
    const t0 = Date.now();
    await fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
    await sleep(settle);
    const after = await readMetrics(cdp);
    const secs = (Date.now() - t0) / 1000;
    perTurn.push({
      turn: i,
      layouts: after.LayoutCount - before.LayoutCount,
      recalcs: after.RecalcStyleCount - before.RecalcStyleCount,
      scriptMs: +((after.ScriptDuration - before.ScriptDuration) * 1000).toFixed(2),
      layoutMs: +((after.LayoutDuration - before.LayoutDuration) * 1000).toFixed(2),
      taskMs: +((after.TaskDuration - before.TaskDuration) * 1000).toFixed(2),
      recalcMs: +((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000).toFixed(2),
      windowS: +secs.toFixed(2),
    });
  }
  const cpu = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable').catch(() => {});

  // THE TURN LEDGER IS CLOSED HERE, before a single press. The input phase
  // below drives forty more renders through the same spans, and folding those
  // into a per-turn average would report a turn that nobody plays.
  const raw = await page.evaluate(() => ({
    msgs: window.__p3.msgs,
    spans: window.__p3.spans,
    longTasks: window.__p3.longTasks,
    railNodes: document.querySelectorAll('#lensRail *').length,
    controlNodes: document.querySelectorAll('#lensControls *').length,
    nodes: document.querySelectorAll('*').length,
  }));

  // ── INPUT: N presses on the chip path, N on the board path ──────────────
  //
  // REAL PRESSES, through CDP's input domain, because Event Timing reports
  // trusted events only — a `dispatchEvent` from inside the page measures the
  // handler and nothing of the delay in front of it, which on a throttled CPU
  // is the half that matters.
  await page.evaluate(() => { window.__p3.presses = []; window.__p3.events = []; });
  const gap = Math.round(160 * Math.max(1, THROTTLE));
  await page.click('#gameCanvas', { position: { x: 5, y: 5 } }).catch(() => {});
  await dismissDialog(page);

  // CHIP: `F` toggles the foil, which changes the foil chip's tone and note
  // and nothing else on the page. One press, one acknowledgement.
  for (let i = 0; i < PRESSES; i++) {
    await page.keyboard.press('f').catch(() => {});
    await sleep(gap);
  }
  const chipPresses = await page.evaluate(() => {
    const L = window.__p3;
    const out = L.presses.slice();
    L.presses = [];
    return { presses: out, events: L.events.splice(0) };
  });

  // BOARD: the arrow pad walks the destination cursor, which restages the
  // arrow and repaints the canvas. It is the one press an operator makes most
  // and the only one whose answer is board pixels.
  const dirs = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
  for (let i = 0; i < PRESSES; i++) {
    await page.keyboard.press(dirs[i % dirs.length]).catch(() => {});
    await sleep(gap);
  }
  const boardPresses = await page.evaluate(() => {
    const L = window.__p3;
    const out = L.presses.slice();
    L.presses = [];
    return { presses: out, events: L.events.splice(0) };
  });

  // ── THE HOVER BURST ─────────────────────────────────────────────────────
  //
  // Every pointer move on this page is seen by TWO document-level capture
  // listeners before it reaches anything that wanted it, and a hover is the
  // one gesture an operator makes continuously. `ScriptDuration` over a burst
  // of real moves is the whole cost of a hover — the page's own handler plus
  // whatever the input layer does in front of it — and it is the only reading
  // that catches a listener whose work happens on a move nobody is pressing.
  const moveBefore = await readMetrics(cdp);
  const box = await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const mt0 = Date.now();
  for (let i = 0; i < MOVES; i++) {
    await page.mouse.move(box.x + box.w * (0.1 + 0.8 * ((i % 20) / 20)), box.y + box.h * (0.2 + 0.6 * (((i * 7) % 20) / 20)));
  }
  const moveAfter = await readMetrics(cdp);
  const moveSecs = (Date.now() - mt0) / 1000;

  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // Self time per function from the sampler, so a long task with 1 ms of our
  // work in it can still say where the other 60 went.
  const selfBy = new Map();
  let cpuTotalMs = 0;
  {
    const nodes = new Map();
    for (const n of cpu.profile.nodes) nodes.set(n.id, n);
    const samples = cpu.profile.samples || [];
    const deltas = cpu.profile.timeDeltas || [];
    cpuTotalMs = +(deltas.reduce((a, b) => a + Math.max(0, b), 0) / 1000).toFixed(1);
    const hits = new Map();
    for (let i = 0; i < samples.length; i++) hits.set(samples[i], (hits.get(samples[i]) || 0) + Math.max(0, deltas[i] || 0));
    for (const [id, us] of hits) {
      const n = nodes.get(id);
      if (!n) continue;
      const cf = n.callFrame;
      const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').split('/').pop() || '-'}:${cf.lineNumber + 1}`;
      selfBy.set(key, (selfBy.get(key) || 0) + us / 1000);
    }
  }
  const cpuTop = [...selfBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([fn, ms]) => ({ fn, ms: +ms.toFixed(1) }));

  const bySpan = {};
  for (const s of raw.spans) (bySpan[s.name] = bySpan[s.name] || []).push(s);
  const spanStats = {};
  for (const [name, xs] of Object.entries(bySpan)) {
    spanStats[name] = {
      ...stats(xs.map((s) => s.ms)),
      perTurn: +(xs.reduce((a, s) => a + s.ms, 0) / TURNS).toFixed(2),
      layoutReads: xs.reduce((a, s) => a + s.layoutReads, 0),
      ...(xs[0].bytes !== undefined
        ? { redundantWrites: xs.filter((s) => s.same).length,
            redundantMs: +xs.filter((s) => s.same).reduce((a, s) => a + s.ms, 0).toFixed(1) }
        : {}),
    };
  }

  const byType = {};
  for (const m of raw.msgs) (byType[m.type] = byType[m.type] || []).push(m);
  const msgStats = {};
  for (const [t, xs] of Object.entries(byType)) {
    msgStats[t] = { count: xs.length, perTurn: +(xs.length / TURNS).toFixed(1), parseMs: stats(xs.map((m) => m.parseMs)), bytes: stats(xs.map((m) => m.bytes)) };
  }

  // Arrival → the paint that answers it.
  const paints = (bySpan['BoardRenderer.renderBoard'] || []).slice().sort((a, b) => a.t - b.t);
  const rails = (bySpan['rail.innerHTML'] || []).slice().sort((a, b) => a.t - b.t);
  const arrivalToPaint = [];
  const arrivalToRail = [];
  for (const m of raw.msgs) {
    if (m.type === 'board-update') { const h = paints.find((p) => p.t >= m.t); if (h) arrivalToPaint.push(h.t + h.ms - m.t); }
    if (m.type === 'lens-frames') { const h = rails.find((p) => p.t >= m.t); if (h) arrivalToRail.push(h.t + h.ms - m.t); }
  }

  const longPerTurn = {};
  for (const lt of raw.longTasks) {
    if (lt.turn < 0) continue;
    longPerTurn[lt.turn] = (longPerTurn[lt.turn] || 0) + 1;
  }
  const longEntries = raw.longTasks.filter((lt) => lt.turn >= 0).map((lt) => {
    const inside = {};
    for (const s of raw.spans) if (s.t >= lt.t && s.t < lt.t + lt.ms) inside[s.name] = +((inside[s.name] || 0) + s.ms).toFixed(1);
    const named = Object.values(inside).reduce((a, b) => a + b, 0);
    return { turn: lt.turn, ms: +lt.ms.toFixed(1), namedMs: +named.toFixed(1), inside };
  });

  const inputOf = (batch) => ({
    presses: batch.presses.length,
    chipPaintMs: stats(batch.presses.map((p) => p.chipPaintMs)),
    boardPaintMs: stats(batch.presses.map((p) => p.boardPaintMs)),
    eventDurationMs: stats(batch.events.map((e) => e.durationMs)),
    inputDelayMs: stats(batch.events.map((e) => e.delayMs)),
    handlerMs: stats(batch.events.map((e) => e.handlerMs)),
  });

  const sum = (k) => perTurn.reduce((a, r) => a + r[k], 0);
  const result = {
    label: LABEL, at: new Date().toISOString(), entered, throttle: THROTTLE, ablated: ABLATE,
    turns: TURNS, wrapped,
    messages: msgStats,
    spans: spanStats,
    arrivalToBoardPaintMs: stats(arrivalToPaint),
    arrivalToRailMs: stats(arrivalToRail),
    perTurnMetrics: {
      layouts: +(sum('layouts') / TURNS).toFixed(1),
      recalcs: +(sum('recalcs') / TURNS).toFixed(1),
      scriptMs: +(sum('scriptMs') / TURNS).toFixed(1),
      layoutMs: +(sum('layoutMs') / TURNS).toFixed(1),
      recalcMs: +(sum('recalcMs') / TURNS).toFixed(1),
      taskMs: +(sum('taskMs') / TURNS).toFixed(1),
      rows: perTurn,
    },
    longTasks: {
      count: longEntries.length,
      perTurn: +(longEntries.length / TURNS).toFixed(2),
      ms: stats(longEntries.map((e) => e.ms)),
      entries: longEntries.slice(0, 24),
      byTurn: longPerTurn,
    },
    input: { chip: inputOf(chipPresses), board: inputOf(boardPresses) },
    hoverBurst: {
      moves: MOVES,
      seconds: +moveSecs.toFixed(2),
      scriptMs: +((moveAfter.ScriptDuration - moveBefore.ScriptDuration) * 1000).toFixed(1),
      layouts: moveAfter.LayoutCount - moveBefore.LayoutCount,
      recalcs: moveAfter.RecalcStyleCount - moveBefore.RecalcStyleCount,
      taskMs: +((moveAfter.TaskDuration - moveBefore.TaskDuration) * 1000).toFixed(1),
      scriptUsPerMove: +(((moveAfter.ScriptDuration - moveBefore.ScriptDuration) * 1e6) / MOVES).toFixed(1),
    },
    dom: { railNodes: raw.railNodes, controlNodes: raw.controlNodes, nodes: raw.nodes },
    cpu: { totalMs: cpuTotalMs, top: cpuTop },
  };
  await browser.close();
  return result;
}

// ───────────────────────────────────────────────────────────────────────────
// MODE: cold — bytes, requests, first paint, and the compile under it
// ───────────────────────────────────────────────────────────────────────────
async function runCold() {
  const browser = await newBrowser();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(() => {
    try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ }
    window.__long = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration }); })
        .observe({ type: 'longtask', buffered: true });
    } catch (e) { /* none */ }
  });
  await ablate(context, ABLATE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  // THE COMPILE, TRACED. `v8.compile` and `V8.CompileScript` are the parse and
  // compile of a script; `EvaluateScript` is running it. Round 1 proved JSON
  // parse is not a cost and never measured this one, and "no bundler unless
  // parse is the cost" needs the number rather than the assumption.
  const events = [];
  cdp.on('Tracing.dataCollected', ({ value }) => { for (const e of value) events.push(e); });
  await cdp.send('Tracing.start', {
    transferMode: 'ReportEvents',
    traceConfig: { includedCategories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.compile'] },
  });

  await page.goto(`${BASE}/game/${GAME}`, { waitUntil: 'load' });
  await sleep(6000);

  const ended = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await ended;

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = {};
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = p.startTime;
    const res = performance.getEntriesByType('resource').map((r) => ({
      url: r.name.replace(location.origin, ''), type: r.initiatorType,
      start: Math.round(r.startTime), end: Math.round(r.responseEnd),
      transfer: r.transferSize, decoded: r.decodedBodySize,
    })).sort((a, b) => a.start - b.start);
    const fcp = paints['first-contentful-paint'] || 0;
    let tti = fcp;
    const longs = (window.__long || []).slice().sort((a, b) => a.start - b.start);
    for (const lt of longs) {
      if (lt.start + lt.dur <= tti) continue;
      if (lt.start - tti >= 2000) break;
      tti = lt.start + lt.dur;
    }
    return {
      firstPaint: Math.round(paints['first-paint'] || 0),
      firstContentfulPaint: Math.round(fcp),
      domInteractive: Math.round(nav.domInteractive || 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      docTransfer: nav.transferSize || 0,
      docDecoded: nav.decodedBodySize || 0,
      tti: Math.round(tti),
      longTasksBeforeTti: longs.filter((l) => l.start < tti).map((l) => ({ start: Math.round(l.start), dur: Math.round(l.dur) })),
      resources: res,
    };
  });

  const bucket = { compileMs: 0, evaluateMs: 0, parseMs: 0, gcMs: 0 };
  const byName = {};
  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const ms = e.dur / 1000;
    byName[e.name] = +((byName[e.name] || 0) + ms).toFixed(2);
    if (e.name === 'v8.compile' || e.name === 'V8.CompileScript' || e.name === 'v8.compileModule') bucket.compileMs += ms;
    else if (e.name === 'v8.parseOnBackground' || e.name === 'v8.parseFunction') bucket.parseMs += ms;
    else if (e.name === 'EvaluateScript' || e.name === 'v8.run') bucket.evaluateMs += ms;
    else if (e.name.startsWith('V8.GC') || e.name === 'MajorGC' || e.name === 'MinorGC') bucket.gcMs += ms;
  }
  for (const k of Object.keys(bucket)) bucket[k] = +bucket[k].toFixed(1);

  const scripts = timing.resources.filter((r) => r.url.endsWith('.js'));
  const styles = timing.resources.filter((r) => r.url.endsWith('.css'));
  const beforeFcp = timing.resources.filter((r) => r.start < timing.firstContentfulPaint);

  await browser.close();
  return {
    label: LABEL, at: new Date().toISOString(), throttle: THROTTLE, ablated: ABLATE,
    ...timing,
    resources: undefined,
    requests: timing.resources.length + 1,
    scripts: { count: scripts.length, transfer: scripts.reduce((a, r) => a + r.transfer, 0), decoded: scripts.reduce((a, r) => a + r.decoded, 0) },
    styles: { count: styles.length, transfer: styles.reduce((a, r) => a + r.transfer, 0), decoded: styles.reduce((a, r) => a + r.decoded, 0) },
    blockingFirstPaint: beforeFcp.map((r) => `${r.url} (${r.start}→${r.end} ms, ${(r.transfer / 1024).toFixed(1)} KB)`),
    v8: bucket,
    traceTop: Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 15),
    resourceList: timing.resources,
  };
}

async function main() {
  const result = MODE === 'cold' ? await runCold() : await runTurns();
  const json = JSON.stringify(result, null, 2);
  if (OUT) {
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUT), json);
    console.error(`[perf3] ${LABEL} → ${OUT}`);
  }
  console.log(json);
}

main().catch((e) => { console.error(e); process.exit(1); });
