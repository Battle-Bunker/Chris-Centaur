/**
 * THE CLIENT, TIMED — one turn, arrival to interaction, at the walkthrough's
 * real frame sizes.
 *
 * Pairs with `src/tests/lens-walkthrough-server.ts` exactly as
 * `scripts/lens-walkthrough.js` does: that walk photographs the states, this
 * one times them. Four spans per turn, all on `performance.now()` inside the
 * page that is doing the work:
 *
 *   arrival   — the websocket frame lands (bytes, before any parse)
 *   parse     — `JSON.parse` of that frame, plus the lens revive on top of it
 *   board     — the first `BoardRenderer.renderBoard` that draws the new turn
 *   rail      — the fold (`frameAtSeq`) + the view-model (`renderFrame`) +
 *               the panel's HTML + the `innerHTML` that installs it
 *   response  — a hover and a pin, gesture to the frame that answers it
 *
 * Everything is measured by WRAPPING the page's own globals, so no measured
 * function is a copy of the shipped one, and the numbers are of the shipped
 * page rather than of a harness that resembles it. Forced layout is counted
 * the same way: the geometry getters are wrapped and their reads attributed to
 * whichever render span is open.
 *
 *   npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts --port=5155 &
 *   node scripts/lens-latency-profile.js --port=5155 --turns=6 --out=/tmp/prof.json
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const PORT = parseInt(arg('port', '5155'), 10);
const TURNS = parseInt(arg('turns', '6'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/latency-profile.json'));
const LABEL = arg('label', 'run');
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = arg('game', 'lens-walk');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The walkthrough's own focus gesture, so the profile is of the same rail the
 *  walk photographs: a roster row that is already the active perspective fires
 *  no selection, so go via another unit first. */
async function focusUnit(page, index) {
  const active = await page.evaluate(() => {
    const el = document.querySelector('.snake-info-item.active-perspective');
    return el ? [...document.querySelectorAll('.snake-info-item.selectable')].indexOf(el) : -1;
  });
  if (active === index) {
    const rows = await page.$$('.snake-info-item.selectable');
    const other = index === 0 ? 1 : 0;
    if (rows[other]) { await rows[other].click(); await sleep(1200); }
  }
  const again = await page.$$('.snake-info-item.selectable');
  if (again[index]) { await again[index].click({ timeout: 5000 }).catch(() => {}); await sleep(1200); }
  await dismissDialog(page);
}

/** A contested selection opens the takeover confirm. It intercepts every
 *  later click, so it is answered rather than waited out. */
async function dismissDialog(page) {
  const dialog = await page.$('#confirmDialog.active');
  if (!dialog) return;
  const yes = await page.$('#confirmDialog .confirm-dialog-confirm, #confirmDialogConfirm');
  if (yes) await yes.click({ timeout: 5000 }).catch(() => {});
  else await page.keyboard.press('Escape');
  await sleep(800);
}

/** Installed BEFORE any page script: the two things that cannot be wrapped
 *  afterwards, because the page has already taken its own reference. */
const INIT = () => {
  const L = {
    msgs: [],        // {t, bytes, type, parseMs}
    spans: [],       // {name, t, ms, layoutReads, detail}
    open: null,      // the render span currently attributed to
    longTasks: [],
  };
  window.__lat = L;

  // JSON.parse, timed and attributed. `ws-client.js` parses every frame here,
  // and a lens batch is tens of kilobytes.
  const rawParse = JSON.parse;
  JSON.parse = function (text) {
    const t0 = performance.now();
    const out = rawParse.apply(this, arguments);
    const ms = performance.now() - t0;
    if (typeof text === 'string' && text.length > 512) {
      L.msgs.push({
        t: t0,
        bytes: text.length,
        type: out && out.type ? out.type : '?',
        parseMs: ms,
      });
    }
    return out;
  };

  // Forced layout: every geometry read the renderers make, counted against
  // whichever span is open. A read inside a render is a reflow the render did
  // not have to pay for.
  const geom = ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'];
  for (const prop of geom) {
    for (const proto of [HTMLElement.prototype, Element.prototype]) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.get) continue;
      Object.defineProperty(proto, prop, {
        configurable: true,
        get() {
          if (L.open) L.open.layoutReads++;
          return d.get.call(this);
        },
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
      for (const e of list.getEntries()) {
        const a = (e.attribution || [])[0];
        L.longTasks.push({
          t: e.startTime,
          ms: e.duration,
          name: e.name,
          why: a ? `${a.name}/${a.containerType || '-'}` : '-',
        });
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* not every build ships longtask */ }
};

/** Wrap the page's own globals once the page has defined them. */
const WRAP = () => {
  const L = window.__lat;
  const wrap = (holder, name, label) => {
    const fn = holder[name];
    if (typeof fn !== 'function' || fn.__latWrapped) return false;
    const wrapped = function () {
      const parent = L.open;
      const span = { name: label, t: performance.now(), ms: 0, layoutReads: 0 };
      L.open = span;
      try {
        return fn.apply(this, arguments);
      } finally {
        span.ms = performance.now() - span.t;
        L.open = parent;
        // A nested span's layout reads belong to its parent too.
        if (parent) parent.layoutReads += span.layoutReads;
        L.spans.push(span);
      }
    };
    wrapped.__latWrapped = true;
    // esbuild's namespace objects expose their members as GETTERS, so a plain
    // assignment is a silent no-op and the span never records. Define over it.
    try {
      Object.defineProperty(holder, name, { configurable: true, enumerable: true, writable: true, value: wrapped });
    } catch (e) {
      try { holder[name] = wrapped; } catch (e2) { return false; }
    }
    return holder[name] === wrapped;
  };

  const done = {};
  for (const n of ['lensRender', 'renderGameBoard', 'renderSnakeInfo', 'ingestLensFrames',
                   'runScheduledRender', 'renderView', 'updateMoveControls', 'repaintBoard']) {
    done[n] = wrap(window, n, n);
  }
  // `BoardRenderer` and `LensPanel` are top-level `const`s in classic
  // scripts, so they are in the global LEXICAL environment and never on
  // `window`. They are reachable by name from global code (this is global
  // code) and their objects are mutable, so the methods are wrapped in place.
  const BR = typeof BoardRenderer === 'undefined' ? null : BoardRenderer;
  const LP = typeof LensPanel === 'undefined' ? null : LensPanel;
  if (BR) {
    done.renderBoard = wrap(BR, 'renderBoard', 'BoardRenderer.renderBoard');
    done.createBoardOverlay = wrap(BR, 'createBoardOverlay', 'BoardRenderer.createBoardOverlay');
    done.renderSnakeInfoLib = wrap(BR, 'renderSnakeInfo', 'BoardRenderer.renderSnakeInfo');
  }
  if (LP) {
    done.railHTML = wrap(LP, 'railHTML', 'LensPanel.railHTML');
    done.laneHTML = wrap(LP, 'laneHTML', 'LensPanel.laneHTML');
    done.inkFromTranscript = wrap(LP, 'inkFromTranscript', 'LensPanel.inkFromTranscript');
  }
  // `window.LensView` is an esbuild namespace whose members are NON-CONFIGURABLE
  // getters, so neither assignment nor `defineProperty` can wrap them in place.
  // The page reads `window.LensView` on every call (`lensView()`), so the
  // namespace itself is replaced by a delegating shim — measurement only, and
  // every function it forwards to is the shipped one.
  if (window.LensView && !window.LensView.__latShim) {
    const LV = window.LensView;
    const shim = { __latShim: true };
    for (const k of Object.keys(LV)) {
      const v = LV[k];
      if (typeof v === 'function') { shim[k] = v; wrap(shim, k, `LensView.${k}`); done[k] = true; }
      else Object.defineProperty(shim, k, { get: () => LV[k], enumerable: true });
    }
    window.LensView = shim;
  }

  // The two `innerHTML` writes that install the rail and the lane. Wrapped on
  // the ELEMENTS, not on the prototype, so the number is the cost of these two
  // panels and not of every string the page assigns anywhere.
  const setter = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  for (const [id, label] of [['lensRail', 'rail.innerHTML'], ['lensLane', 'lane.innerHTML']]) {
    const el = document.getElementById(id);
    if (!el || el.__latWrapped) continue;
    el.__latWrapped = true;
    Object.defineProperty(el, 'innerHTML', {
      configurable: true,
      get() { return setter.get.call(this); },
      set(v) {
        const parent = L.open;
        // The value's own identity, so the report can say how many of these
        // rebuilds installed markup character-identical to the markup already
        // in the element — a teardown that changed nothing.
        const str = String(v);
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
        const span = { name: label, t: performance.now(), ms: 0, layoutReads: 0, bytes: str.length, h, same: h === el.__latLastHash };
        el.__latLastHash = h;
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
  return done;
};

const stats = (xs) => {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return {
    n: s.length,
    sum: +s.reduce((a, b) => a + b, 0).toFixed(2),
    mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
    p50: +at(50).toFixed(2),
    p95: +at(95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
  };
};

async function main() {
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(INIT);
  const page = await context.newPage();

  await page.goto(`${BASE}/game/${GAME}`, { waitUntil: 'domcontentloaded' });
  await sleep(2000);
  if (await page.$('#loginGate.active')) {
    await page.fill('#loginNameInput', arg('name', 'Prof-' + Math.floor(Math.random() * 1e6)));
    await page.click('#loginGateSubmit');
    await sleep(2000);
  }
  // One turn before wrapping, so the wrap does not measure first-paint warmup.
  await fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json());
  await sleep(1500);
  // Focus a unit — the rail is only expensive once there is something in it.
  // A row that is ALREADY the active perspective fires no selection, so this
  // goes via another unit when it has to (the walkthrough's own gesture).
  await focusUnit(page, 0);
  // And T3's own cursor source: the candidate the reserve answered, which is
  // the only one with a ranked list under it. The full rail is what the
  // profile is of; the fallback rail is a third of it.
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
    if (cell) { await cell.click(); await sleep(900); }
  }

  const wrapped = await page.evaluate(WRAP);
  await page.evaluate(() => { window.__lat.msgs = []; window.__lat.spans = []; window.__lat.longTasks = []; });

  // ── THE TURNS ──────────────────────────────────────────────────────────
  // A CDP sampling profile over the same turns, because the wrapped spans can
  // only see functions this script knows the names of: a long task with 1 ms
  // of instrumented work inside it and 100 ms of duration is being spent
  // somewhere the wrappers do not reach, and the sampler says where.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  const turnMarks = [];
  for (let i = 0; i < TURNS; i++) {
    await page.evaluate((n) => { window.__lat.turnStart = performance.now(); window.__lat.turnNo = n; }, i);
    await fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json());
    await sleep(1400);
    turnMarks.push(await page.evaluate(() => window.__lat.turnStart));
  }

  const cpu = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable').catch(() => {});

  // ── INTERACTION: hover, and a pin (T3's click on a candidate cell) ──────
  const interaction = await page.evaluate(async () => {
    const L = window.__lat;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
    const out = { hover: [], pin: [] };
    const canvas = document.getElementById('gameCanvas');
    const box = canvas.getBoundingClientRect();
    for (let i = 0; i < 12; i++) {
      const x = box.left + box.width * (0.12 + 0.05 * (i % 8));
      const y = box.top + box.height * 0.8;
      const t0 = performance.now();
      canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
      out.hover.push((await frame()) - t0);
    }
    const cells = [...document.querySelectorAll('.lens-candidates [data-lens-candidate]')];
    for (let i = 0; i < Math.min(8, cells.length * 4); i++) {
      const cell = cells[i % cells.length];
      const t0 = performance.now();
      cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      out.pin.push((await frame()) - t0);
    }
    out.candidateCells = cells.length;
    return out;
  });

  // Self time per function, from the sample counts. `deltas` are microseconds.
  const selfBy = new Map();
  {
    const nodes = new Map();
    for (const n of cpu.profile.nodes) nodes.set(n.id, n);
    const total = (cpu.profile.timeDeltas || []).reduce((a, b) => a + Math.max(0, b), 0);
    const hits = new Map();
    const samples = cpu.profile.samples || [];
    const deltas = cpu.profile.timeDeltas || [];
    for (let i = 0; i < samples.length; i++) {
      hits.set(samples[i], (hits.get(samples[i]) || 0) + Math.max(0, deltas[i] || 0));
    }
    for (const [id, us] of hits) {
      const n = nodes.get(id);
      if (!n) continue;
      const cf = n.callFrame;
      const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').split('/').pop() || '-'}:${cf.lineNumber + 1}`;
      selfBy.set(key, (selfBy.get(key) || 0) + us / 1000);
    }
    var cpuTotalMs = +(total / 1000).toFixed(1);
  }
  const cpuTop = [...selfBy.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([k, ms]) => ({ fn: k, ms: +ms.toFixed(1), pct: +((ms / Math.max(1, cpuTotalMs)) * 100).toFixed(1) }));

  const raw = await page.evaluate(() => ({
    msgs: window.__lat.msgs,
    spans: window.__lat.spans,
    longTasks: window.__lat.longTasks,
    railBytes: (document.getElementById('lensRail') || {}).innerHTML
      ? document.getElementById('lensRail').innerHTML.length : 0,
    railNodes: document.querySelectorAll('#lensRail *').length,
    laneNodes: document.querySelectorAll('#lensLane *').length,
    events: typeof lensEvents === 'undefined' ? null : lensEvents.length,
  }));

  const bySpan = {};
  for (const s of raw.spans) (bySpan[s.name] = bySpan[s.name] || []).push(s);
  const spanStats = {};
  for (const [name, xs] of Object.entries(bySpan)) {
    spanStats[name] = {
      ...stats(xs.map((s) => s.ms)),
      layoutReads: xs.reduce((a, s) => a + s.layoutReads, 0),
      ...(xs[0].bytes !== undefined
        ? {
            bytes: stats(xs.map((s) => s.bytes)),
            redundantWrites: xs.filter((s) => s.same).length,
            redundantMs: +xs.filter((s) => s.same).reduce((a, s) => a + s.ms, 0).toFixed(1),
          }
        : {}),
    };
  }
  const byType = {};
  for (const m of raw.msgs) (byType[m.type] = byType[m.type] || []).push(m);
  const msgStats = {};
  for (const [t, xs] of Object.entries(byType)) {
    msgStats[t] = { count: xs.length, parseMs: stats(xs.map((m) => m.parseMs)), bytes: stats(xs.map((m) => m.bytes)) };
  }

  // Arrival → the board paint that answers it: for each `board-update`, the
  // first `BoardRenderer.renderBoard` that STARTED after it.
  const paints = (bySpan['BoardRenderer.renderBoard'] || []).slice().sort((a, b) => a.t - b.t);
  const arrivalToPaint = [];
  const arrivalToRail = [];
  const rails = (bySpan['rail.innerHTML'] || []).slice().sort((a, b) => a.t - b.t);
  for (const m of raw.msgs) {
    if (m.type === 'board-update') {
      const hit = paints.find((p) => p.t >= m.t);
      if (hit) arrivalToPaint.push(hit.t + hit.ms - m.t);
    }
    if (m.type === 'lens-frames') {
      const hit = rails.find((p) => p.t >= m.t);
      if (hit) arrivalToRail.push(hit.t + hit.ms - m.t);
    }
  }

  const result = {
    label: LABEL,
    at: new Date().toISOString(),
    turns: TURNS,
    wrapped,
    messages: msgStats,
    spans: spanStats,
    arrivalToBoardPaintMs: stats(arrivalToPaint),
    arrivalToRailMs: stats(arrivalToRail),
    interaction: { hoverMs: stats(interaction.hover), pinMs: stats(interaction.pin), candidateCells: interaction.candidateCells },
    longTasks: {
      ...stats(raw.longTasks.map((t) => t.ms)),
      entries: raw.longTasks.slice(0, 20).map((lt) => {
        // What was running inside the block, by top-level span. A long task
        // with nothing of ours in it is the browser's own work (parse, decode,
        // GC) and says so by being empty.
        const inside = {};
        for (const s of raw.spans) {
          if (s.t >= lt.t && s.t < lt.t + lt.ms) inside[s.name] = +((inside[s.name] || 0) + s.ms).toFixed(1);
        }
        return { ...lt, inside };
      }),
    },
    dom: { railBytes: raw.railBytes, railNodes: raw.railNodes, laneNodes: raw.laneNodes, eventsHeld: raw.events },
    cpu: { totalMs: cpuTotalMs, top: cpuTop },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
