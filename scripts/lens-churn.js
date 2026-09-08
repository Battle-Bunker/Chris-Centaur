/**
 * CHURN — what the operator page costs PER SECOND when nothing is happening,
 * and which module is paying for it.
 *
 * The soak (`scripts/lens-soak.js`) asks what a long session ACCUMULATES and
 * the answer turned out to be "almost nothing". This asks the other long-
 * session question, the one an accumulation curve cannot see: what does the
 * page SPEND, per second, for ever, whether or not a turn is arriving? A page
 * that leaks nothing and lays out thirty times a second is still the page that
 * flattens a laptop battery over an afternoon.
 *
 * The measurement is CDP `Performance.getMetrics` over a 25-second window:
 * `LayoutCount`, `RecalcStyleCount`, `ScriptDuration`, `LayoutDuration`,
 * `TaskDuration`. Two conditions:
 *
 *   · `idle`      — the page is open and no turn is being played. This is most
 *                   of an operator's afternoon.
 *   · `stepping`  — a turn every 1.5 s, which is a game in progress.
 *
 * ATTRIBUTION IS BY ABLATION, not by guessing. `--drop=latency.js,alerts.js`
 * installs an init script that swallows `setInterval` calls made from those
 * files — nothing else about them changes — and the difference between the
 * run with and the run without is that module's standing cost. A wrapper
 * around a module's own draw could only see the work that module does; the
 * layouts and style recalculations it CAUSES happen later, in the browser's
 * own rendering task, and ablation is the only thing that catches those.
 *
 * Usage:
 *   node scripts/lens-churn.js --port=5311
 *   node scripts/lens-churn.js --port=5311 --mode=stepping --drop=latency.js
 */

'use strict';

const fs = require('fs');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const PORT = parseInt(arg('port', '5311'), 10);
const GAME = arg('game', 'lens-walk');
const MODE = arg('mode', 'idle');
const WINDOW_MS = parseInt(arg('window', '25000'), 10);
const DROP = arg('drop', '').split(',').filter(Boolean);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ABLATE = `(() => {
  const DROP = ${JSON.stringify(DROP)};
  if (!DROP.length) return;
  const rawSI = window.setInterval;
  window.setInterval = function (fn, ms) {
    const stack = (new Error()).stack || '';
    for (const d of DROP) if (stack.indexOf('/' + d) !== -1) return 0;
    return rawSI.apply(window, arguments);
  };
})();`;

async function main() {
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(() => {
    try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ }
  });
  await context.addInitScript(ABLATE);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');

  await page.goto(`${BASE}/game/${GAME}`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  // NAMES ARE UNIQUE PER GAME and this harness never forgets one, so a fixed
  // name runs out after a handful of runs and the run that cannot enter reads
  // 0.2 layouts/s and looks like a spectacular win. A random suffix instead.
  if (await page.$('#loginGate.active')) {
    const name = `Churn-${Math.random().toString(36).slice(2, 8)}`;
    await page.fill('#loginNameInput', name);
    await sleep(500);
    if (!(await page.$eval('#loginGateSubmit', (el) => el.disabled))) {
      await page.click('#loginGateSubmit');
      await sleep(2200);
    }
  }
  const entered = !(await page.$('#loginGate.active'));
  await fetch(`${BASE}/dev/step`, { method: 'POST' }).catch(() => {});

  let stop = false;
  if (MODE === 'stepping') {
    void (async () => {
      while (!stop) {
        await fetch(`${BASE}/dev/step`, { method: 'POST' }).catch(() => {});
        await sleep(1500);
      }
    })();
  }
  await sleep(4000);

  const read = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const o = {};
    for (const r of metrics) o[r.name] = r.value;
    return o;
  };
  const a = await read();
  const t0 = Date.now();
  await sleep(WINDOW_MS);
  const b = await read();
  stop = true;
  const secs = (Date.now() - t0) / 1000;
  const per = (k, mul = 1) => (((b[k] - a[k]) * mul) / secs).toFixed(1).padStart(7);

  console.log(
    `${MODE.padEnd(8)} drop=[${(DROP.join(',') || 'none').padEnd(22)}]` +
      `  layouts/s ${per('LayoutCount')}  recalcs/s ${per('RecalcStyleCount')}` +
      `  script ms/s ${per('ScriptDuration', 1000)}  layout ms/s ${per('LayoutDuration', 1000)}` +
      `  task ms/s ${per('TaskDuration', 1000)}${entered ? '' : '   [DID NOT ENTER — discard]'}`
  );
  await browser.close();
}

main().catch((err) => {
  console.error('[churn] failed:', err);
  process.exit(1);
});
