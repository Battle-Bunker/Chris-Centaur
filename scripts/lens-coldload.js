/**
 * COLD LOAD — what it costs to OPEN the operator page.
 *
 * The soak (`scripts/lens-soak.js`) asks what a long session accumulates. This
 * asks the first question of the same session: how long is the operator
 * looking at nothing, and what did the page make them download to stop doing
 * so. An operator opens this page at the start of a match, on a network they
 * did not choose, and every byte in front of first paint is a byte the game is
 * already running without them.
 *
 * Measured with the cache cleared (`Network.clearBrowserCache`, plus a fresh
 * context per run), because a warm reload is not the load anybody complains
 * about.
 *
 *   · first paint / first contentful paint  — the paint timeline
 *   · DOM interactive, DCL, load            — the navigation timing
 *   · time to interactive                   — FCP, then the first 2 s window
 *                                             with no long task in it
 *   · per-resource transfer and decoded size, in request order, so the load
 *     ORDER is visible and not inferred from the markup
 *   · long tasks before TTI, with their start and length
 *
 * Usage:
 *   node scripts/lens-coldload.js --port=5311 --runs=3 --out=docs/design/ux/soak
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
const RUNS = parseInt(arg('runs', '3'), 10);
const GAME = arg('game', 'lens-walk');
const LABEL = arg('label', 'coldload');
const OUT = path.resolve(arg('out', 'docs/design/ux/soak'));
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Long tasks have to be observed from before the first byte, so the observer
 *  is installed as an init script rather than after `goto` returns. */
const OBSERVE = `(() => {
  window.__long = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) { /* no longtask support */ }
})();`;

async function once(browser) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(() => {
    try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ }
  });
  await context.addInitScript(OBSERVE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  await page.goto(`${BASE}/game/${GAME}`, { waitUntil: 'load' });
  // Long enough for the socket to open and the first frames to land, so a
  // long task caused by the first `board-update` is inside the window.
  await sleep(6000);

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paints = {};
    for (const p of performance.getEntriesByType('paint')) paints[p.name] = p.startTime;
    const res = performance
      .getEntriesByType('resource')
      .map((r) => ({
        url: r.name.replace(location.origin, ''),
        type: r.initiatorType,
        start: Math.round(r.startTime),
        end: Math.round(r.responseEnd),
        transfer: r.transferSize,
        decoded: r.decodedBodySize,
      }))
      .sort((a, b) => a.start - b.start);
    const fcp = paints['first-contentful-paint'] || 0;
    // TTI: the first moment after FCP with two clear seconds behind it.
    const long = (window.__long || []).slice().sort((a, b) => a.start - b.start);
    let tti = fcp;
    for (const t of long) {
      if (t.start + t.duration <= tti) continue;
      if (t.start - tti >= 2000) break;
      tti = t.start + t.dur;
    }
    return {
      firstPaint: Math.round(paints['first-paint'] || 0),
      firstContentfulPaint: Math.round(fcp),
      domInteractive: Math.round(nav.domInteractive || 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      tti: Math.round(tti),
      documentTransfer: nav.transferSize || 0,
      documentDecoded: nav.decodedBodySize || 0,
      longTasks: long.map((t) => ({ start: Math.round(t.start), dur: Math.round(t.dur) })),
      resources: res,
    };
  });
  await context.close();
  return timing;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length === 0 ? null : s[Math.floor(s.length / 2)];
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(browser));
  await browser.close();

  const pick = (k) => median(runs.map((r) => r[k]));
  const last = runs[runs.length - 1];
  const scripts = last.resources.filter((r) => r.type === 'script');
  const bytes = (rows, key) => rows.reduce((a, r) => a + (r[key] || 0), 0);
  const report = {
    label: LABEL,
    runs: runs.length,
    median: {
      firstPaint: pick('firstPaint'),
      firstContentfulPaint: pick('firstContentfulPaint'),
      domInteractive: pick('domInteractive'),
      domContentLoaded: pick('domContentLoaded'),
      loadEvent: pick('loadEvent'),
      tti: pick('tti'),
    },
    document: { transfer: last.documentTransfer, decoded: last.documentDecoded },
    scripts: {
      count: scripts.length,
      transfer: bytes(scripts, 'transfer'),
      decoded: bytes(scripts, 'decoded'),
      rows: scripts,
    },
    other: last.resources.filter((r) => r.type !== 'script'),
    longTasks: last.longTasks,
    all: runs,
  };
  fs.writeFileSync(path.join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2));

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`\n${LABEL} — median of ${runs.length} cold loads`);
  console.log(`  first paint          ${report.median.firstPaint} ms`);
  console.log(`  first contentful     ${report.median.firstContentfulPaint} ms`);
  console.log(`  DOM interactive      ${report.median.domInteractive} ms`);
  console.log(`  DOMContentLoaded     ${report.median.domContentLoaded} ms`);
  console.log(`  load                 ${report.median.loadEvent} ms`);
  console.log(`  time to interactive  ${report.median.tti} ms`);
  console.log(
    `  document             ${kb(report.document.transfer)} on the wire, ${kb(report.document.decoded)} decoded`
  );
  console.log(
    `  ${report.scripts.count} scripts        ${kb(report.scripts.transfer)} on the wire, ${kb(report.scripts.decoded)} decoded`
  );
  for (const r of report.scripts.rows) {
    console.log(
      `      ${String(r.start).padStart(5)}→${String(r.end).padEnd(5)} ms  ${kb(r.transfer).padStart(9)} / ${kb(r.decoded).padStart(9)}  ${r.url}`
    );
  }
  for (const r of report.other) {
    console.log(
      `      ${String(r.start).padStart(5)}→${String(r.end).padEnd(5)} ms  ${kb(r.transfer).padStart(9)} / ${kb(r.decoded).padStart(9)}  ${r.url} (${r.type})`
    );
  }
  console.log(`  long tasks: ${report.longTasks.map((t) => `${t.dur}ms@${t.start}`).join(', ') || 'none'}`);
  console.log(`  → ${path.join(OUT, `${LABEL}.json`)}`);
}

main().catch((err) => {
  console.error('[coldload] failed:', err);
  process.exit(1);
});
