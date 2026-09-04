/**
 * THE WALKTHROUGH DRIVER — the lens, in a browser, one state per screenshot.
 *
 * Pairs with `src/tests/lens-walkthrough-server.ts`: that stands the shipped
 * page up against a real local decision, this walks a Chromium through every
 * cursor-machine state `docs/design/decision-lens/02-INSPECTION-UI.md` names
 * and writes the PNGs `10-WALKTHROUGH.md` cites.
 *
 *   npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts --port=5055 &
 *   node scripts/lens-walkthrough.js --port=5055 --out=docs/design/decision-lens/walkthrough
 *
 * Everything it notices on the way — console errors, failed requests, page
 * exceptions, horizontal overflow, and the rail's own text at every stop — is
 * written beside the images as `report.json`, because a screenshot cannot show
 * a console and a verdict needs the words, not just the pixels.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/** The provisioned Chromium. Playwright's own revision pin does not match the
 *  image's, so the binary is named rather than discovered. */
const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = parseInt(arg('port', '5055'), 10);
const OUT = path.resolve(arg('out', 'docs/design/decision-lens/walkthrough'));
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = arg('game', 'lens-walk');
const WAIT = parseInt(arg('wait', '2000'), 10);

const report = { shots: [], console: [], requests: [], exceptions: [], overflow: [], notes: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      report.console.push({ at: label(), type: m.type(), text: m.text() });
    }
  });
  page.on('pageerror', (e) => report.exceptions.push({ at: label(), text: String(e && e.message) }));
  page.on('requestfailed', (r) =>
    report.requests.push({ at: label(), url: r.url(), why: r.failure() && r.failure().errorText })
  );
  page.on('response', (r) => {
    if (r.status() >= 400) report.requests.push({ at: label(), url: r.url(), status: r.status() });
  });
}

/** What the operator can actually read, captured beside the pixels. */
function railText(page) {
  return page.evaluate(() => ({
    rail: (document.getElementById('lensRail') || {}).innerText || null,
    lane: (document.querySelector('.lens-lane-foot') || {}).innerText || null,
    banner: (document.querySelector('.lens-banner') || {}).innerText || null,
    lock: (document.querySelector('.lens-lock') || {}).innerText || null,
    state: {
      viewMode: typeof viewMode === 'undefined' ? null : viewMode,
      lensTurn: typeof lensTurn === 'undefined' ? null : lensTurn,
      lensSeq: typeof lensSeq === 'undefined' ? null : lensSeq,
      lensAtHead: typeof lensAtHead === 'undefined' ? null : lensAtHead,
      events: typeof lensEvents === 'undefined' ? null : lensEvents.length,
      selected: typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId,
      finished: typeof finishedMode === 'undefined' ? null : finishedMode,
    },
  }));
}

async function shot(page, name, note, selector) {
  const file = path.join(OUT, `${name}.png`);
  const target = selector ? await page.$(selector) : page;
  if (!target) {
    report.shots.push({ name, note, missing: selector });
    console.log(`  · ${name} — MISSING ${selector}`);
    return;
  }
  await target.screenshot({ path: file });
  const size = fs.statSync(file).size;
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 2) report.overflow.push({ name, overflowPx: overflow });
  report.shots.push({ name, note, bytes: size, overflowPx: overflow, ...(await railText(page)) });
  console.log(
    `  · ${name} (${(size / 1024).toFixed(0)} KB)${overflow > 2 ? ` OVERFLOW ${overflow}px` : ''}`
  );
}

/** Enter the game as an operator: the shipped page gates on a per-game name. */
async function enter(page, gameId, name) {
  await page.goto(`${BASE}/game/${gameId}`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  if (await page.$('#loginGate.active')) {
    await page.fill('#loginNameInput', name);
    await page.click('#loginGateSubmit');
    await sleep(WAIT);
  }
}

const step = () => fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json());

/** Focus a unit through the shipped gesture — the roster row. A row that is
 *  already the active perspective fires no selection, so the walk goes via
 *  another unit when it has to. */
async function focusUnit(page, index) {
  const active = await page.evaluate(() => {
    const el = document.querySelector('.snake-info-item.active-perspective');
    return el ? [...document.querySelectorAll('.snake-info-item.selectable')].indexOf(el) : -1;
  });
  if (active === index) {
    const rows = await page.$$('.snake-info-item.selectable');
    const other = index === 0 ? 1 : 0;
    if (rows[other]) {
      await rows[other].click();
      await sleep(WAIT);
    }
  }
  const again = await page.$$('.snake-info-item.selectable');
  if (again[index]) {
    await again[index].click();
    await sleep(WAIT);
  }
}

/** The lane tick at a given lane, by index. Ticks are the design's clickable
 *  scrubber, and the playhead snaps to events rather than to pixels. */
async function clickTick(page, lane, which) {
  const ticks = await page.$$(`#lensLane .lens-lane[data-lane="${lane}"] [data-seq]`);
  if (ticks.length === 0) return null;
  const el = which === 'last' ? ticks[ticks.length - 1] : ticks[which];
  if (!el) return null;
  const seq = await el.getAttribute('data-seq');
  await el.click();
  await sleep(700);
  return seq;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();
  let at = 'boot';
  watch(page, () => at);

  // ── LIVE ────────────────────────────────────────────────────────────────
  at = 'live/enter';
  await enter(page, GAME, 'Ada');
  // One turn played with this browser attached, so the whole event stream
  // arrives over the socket rather than through the mid-turn anchor replay.
  at = 'live/step';
  await step();
  await sleep(WAIT);
  await page.keyboard.press('Escape');
  await sleep(500);
  await shot(page, '01-idle', 'live head, no unit focused — the NONE cursor state');

  at = 'live/hover-unit';
  const canvas = await page.$('#gameCanvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.82);
  await sleep(600);
  await shot(page, '02-hover-unit', 'pointer over a unit on the board — the tag calls up');

  // The cluster the scripted operator drilled is the first one; its anchor is
  // roster row 0, so the breakdown below has rows to draw.
  at = 'live/focus';
  await focusUnit(page, 0);
  await shot(page, '03-focus-unit', 'CANDIDATE state — focus auto-advances to the incumbent (Law D)');
  await shot(page, '03b-rail', 'the rail at CANDIDATE', '.lens-rail');
  await shot(page, '03c-board', 'the board at CANDIDATE — chips, tethers, the violet arrow', '#gameCanvas');

  at = 'live/hover-moveset';
  const rows = await page.$$('.lens-movesets .lens-table tr');
  if (rows.length > 1) {
    await rows[1].hover();
    await sleep(500);
  }
  await shot(page, '04-hover-moveset', 'pointer over moveset rank 2 — T4 says the cursor must not move', '.lens-rail');

  at = 'live/moveset-walk';
  await page.keyboard.press(']');
  await sleep(700);
  await shot(page, '05-moveset-next', 'the cursor walked one row down the conditional list', '.lens-rail');
  await shot(page, '05b-board', 'the board at the next rank — only disagreement draws', '#gameCanvas');
  await page.keyboard.press('[');
  await sleep(700);

  at = 'live/breakdown';
  await page.keyboard.press('b');
  await sleep(1200);
  await shot(page, '06-breakdown', 'BREAKDOWN drilled — members, terms, and the joint residual', '.lens-rail');
  await shot(page, '06b-breakdown-panel', 'the breakdown panel alone', '.lens-breakdown');

  at = 'live/unless';
  await shot(page, '07-movesets-panel', 'the MOVESETS table — depth ink and the `unless` cell per row', '.lens-movesets');

  at = 'live/foil';
  await page.keyboard.press('f');
  await sleep(700);
  await shot(page, '08-foil', 'the contrastive foil latched', '.lens-rail');
  await shot(page, '08b-foil-board', 'the foil on the board — teal, only where it differs', '#gameCanvas');
  await page.keyboard.press('f');
  await sleep(400);

  at = 'live/lane';
  await shot(page, '09-lane', 'the intra-turn lane at the head', '#lensLane');
  await page.click('#lensLane .lens-lane-foot');
  await sleep(500);
  await shot(page, '10-lane-expanded', 'the lane expanded — hollow attention ticks', '#lensLane');
  await page.click('#lensLane .lens-lane-foot');
  await sleep(400);

  at = 'live/scrub';
  await page.keyboard.press('Home');
  await sleep(700);
  await shot(page, '11-scrub-anchor', 'live-scrub at the turn anchor — determinations refuse');
  await page.keyboard.press('Shift+.');
  await page.keyboard.press('Shift+.');
  await sleep(700);
  await shot(page, '12-scrub-emission', 'live-scrub, two kernel emissions in', '.lens-rail');

  at = 'live/pinned';
  report.notes.operatorTicks = await page.evaluate(() =>
    [...document.querySelectorAll('#lensLane .lens-lane[data-lane="operator"] [data-seq]')].map((e) =>
      e.getAttribute('title')
    )
  );
  report.notes.pinnedSeq = await clickTick(page, 'operator', 0);
  await shot(page, '13-pinned', 'the frame after the operator pin — Rule E, drawn', '.lens-rail');
  await shot(page, '13b-pinned-board', 'the pinned unit on the board — padlock, no tether', '#gameCanvas');

  at = 'live/widen';
  report.notes.widenSeq = await clickTick(page, 'operator', 'last');
  await shot(page, '14-released-widen', 'the frame at the release — the cluster widens again', '.lens-rail');

  at = 'live/now';
  await page.keyboard.press('n');
  await sleep(700);
  await shot(page, '15-back-to-now', 'back at the live head — the lock affordance returns');

  // A widen that arrives WHILE the operator is reading: the scripted peer
  // releases its pin at emission 4 of the next turn.
  at = 'live/widen-banner';
  await step();
  let banner = null;
  for (let i = 0; i < 60; i++) {
    banner = await page.evaluate(() => {
      const el = document.querySelector('.lens-banner');
      return el ? el.innerText : null;
    });
    if (banner) break;
    await sleep(100);
  }
  report.notes.banner = banner;
  if (banner) {
    await shot(page, '16-widen-banner', 'the widen banner — additive uncertainty is staged', '.lens-rail');
  }
  await sleep(WAIT);

  at = 'live/lock';
  await focusUnit(page, 0);
  report.notes.lockBefore = await page.evaluate(() => {
    const el = document.querySelector('.lens-lock');
    return el ? el.innerText : null;
  });
  await page.keyboard.press('Shift+ ');
  await sleep(1200);
  report.notes.lockAfter = await page.evaluate(() => {
    const el = document.querySelector('.lens-lock');
    return el ? el.innerText : null;
  });
  await shot(page, '17-locked', 'after Shift+Space — the whole moveset pinned');
  await shot(page, '17b-locked-rail', 'the rail after the lock', '.lens-rail');

  // ── REPLAY ──────────────────────────────────────────────────────────────
  // The same recorded log, read back through `/api/logs` and the replay fold.
  at = 'replay/enter';
  const replay = await context.newPage();
  watch(replay, () => at);
  await replay.goto(`${BASE}/game/${GAME}-replay`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT * 2);
  await shot(replay, '18-replay', 'the same log, read back through the replay path');

  at = 'replay/focus';
  await focusUnit(replay, 0);
  await shot(replay, '19-replay-focus', 'a focused unit in replay — compare against 03');
  await shot(replay, '19b-replay-rail', 'the replay rail', '.lens-rail');
  await shot(replay, '19c-replay-board', 'the replay board', '#gameCanvas');

  at = 'replay/scrub';
  report.notes.replayScrubbedTo = await replay.evaluate(() => {
    const s = document.getElementById('playTurnSlider');
    if (!s) return null;
    s.value = String(Math.max(0, Number(s.value) - 1));
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value;
  });
  await sleep(WAIT);
  await shot(replay, '20-replay-scrub', 'the turn slider scrubbed back one turn');

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport → ${path.join(OUT, 'report.json')}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'report.json'),
    JSON.stringify({ ...report, fatal: String(e && e.stack) }, null, 2)
  );
  process.exit(1);
});
