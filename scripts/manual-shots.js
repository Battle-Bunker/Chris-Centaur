/**
 * THE OPERATOR MANUAL'S OWN PICTURES.
 *
 * `docs/OPERATOR-MANUAL.md` is written for a human operator rather than for a
 * developer, and every region it names has to be a thing the reader can
 * recognise on their own screen. This takes those pictures — from a real
 * decision on the real page, driven the way the manual tells the operator to
 * drive it — and writes them to `docs/design/ux/manual/`.
 *
 *   node scripts/manual-shots.js --out=docs/design/ux/manual
 *
 * Two scenes, a server each, because the wire is fixed when the server is
 * built (`src/tests/lens-walkthrough-server.ts` §3.5) and one of the two
 * scenes is about a wire that costs something:
 *
 *   1. the free wire — the regions, the controls, the armed lock, the tour;
 *   2. `--latency=500 --jitter=60` — what the ladder says when the wire is
 *      slow, which is the half of the manual an operator reads at the worst
 *      possible moment.
 *
 * A SERVER PER SCENE IS ALSO A NAME PER SCENE. Operator names are unique per
 * game and this walk enrols one, so a second pass against the same process
 * enters under a different name — and a different name does not own the
 * units, which puts a takeover dialog between the camera and everything it
 * came to photograph.
 *
 * Every shot is under the 300 KB the manual budgets, and `report.json` beside
 * them carries the text of every region at the instant of its picture, plus
 * `LatencyView.read()`, because a screenshot cannot be grepped and a picture
 * of a readout is not evidence that the readout is right.
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

const OUT = path.resolve(arg('out', 'docs/design/ux/manual'));
const PORT = parseInt(arg('port', '5271'), 10);
const BUDGET_KB = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { shots: [], console: [], exceptions: [], notes: {} };

// ── one server per scene ──────────────────────────────────────────────────

function startServer(flags) {
  const child = spawn(
    path.join(ROOT, 'node_modules/.bin/ts-node'),
    [
      '--transpile-only',
      'src/tests/lens-walkthrough-server.ts',
      `--port=${PORT}`,
      '--seed=1',
      '--nodes=550',
      ...flags,
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server never ready:\n${log.join('')}`)), 180000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('[walkthrough] ready')) {
        clearTimeout(t);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`server exited ${code}:\n${log.join('')}`));
    });
  });
  return { child, ready };
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

// ── the page ──────────────────────────────────────────────────────────────

async function enter(page, name) {
  await page.goto(`http://127.0.0.1:${PORT}/game/lens-walk`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if (await page.$('#loginGate.active')) {
    await page.fill('#loginNameInput', name);
    await page.click('#loginGateSubmit');
    await sleep(2500);
  }
}

/** Everything the operator can read, captured beside the pixels. */
const words = (page) =>
  page.evaluate(() => {
    const t = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.innerText : null;
    };
    return {
      stage: t('#lensStage'),
      rail: t('#lensRail'),
      controls: t('#lensControls'),
      keys: t('#lensKeys'),
      lane: t('#lensLane'),
      latency: t('#latency-mount'),
      tourCard: t('.tour-card'),
      tourStep: window.Tour ? window.Tour.stepId() : null,
      latencyRead: window.LatencyView ? window.LatencyView.read() : null,
    };
  });

async function shot(page, name, note, selector, clip) {
  const target = selector ? await page.$(selector) : page;
  if (!target) {
    report.shots.push({ name, note, missing: selector });
    console.log(`  ✗ ${name} — no ${selector}`);
    return;
  }
  const file = path.join(OUT, `${name}.png`);
  await target.screenshot(clip ? { path: file, clip } : { path: file });
  const kb = Math.round(fs.statSync(file).size / 1024);
  report.shots.push({ name, note, kb, ...(await words(page)) });
  console.log(`  ${kb <= BUDGET_KB ? '·' : '!'} ${name} — ${kb} KB`);
  if (kb > BUDGET_KB) report.exceptions.push({ what: name, why: `${kb} KB over the ${BUDGET_KB} KB budget` });
}

async function focusUnit(page, index) {
  const rows = await page.$$('.snake-info-item.selectable');
  if (!rows[index]) return false;
  await rows[index].click();
  await sleep(1400);
  return true;
}

/** The one candidate the reserve answered a conditional for is the only one
 *  with a ranked list behind it (10-WALKTHROUGH §1.3b), so the manual's
 *  picture of the two cards has to be taken on that one. */
async function selectAnsweredCandidate(page, unit) {
  const lock = await page.evaluate((u) => {
    const ev = (typeof lensEvents === 'undefined' ? [] : lensEvents).filter(
      (e) => e.kind === 'conditional' && e.payload && e.payload.lock
    );
    const hit = ev.find((e) => e.payload.lock.unit === u) || ev[0];
    return hit ? hit.payload.lock : null;
  }, unit);
  if (!lock) return null;
  for (const sel of [`[data-lens-candidate="${lock.to}"]`, `td[data-lens-candidate="${lock.to}"]`]) {
    const cell = await page.$(sel);
    if (cell) {
      await cell.click();
      await sleep(1200);
      return lock;
    }
  }
  return null;
}

/** Poll the latency surface's own DRAWN state — never a bare sleep, because
 *  this CPU is shared and a sleep that catches a rung on an idle machine
 *  catches the next one down on a busy one. */
async function untilState(page, want, timeoutMs = 25000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await page.evaluate(() => {
      const root = document.querySelector('#latency-mount .lat');
      return {
        drawn: root ? root.getAttribute('data-state') : null,
        read: window.LatencyView ? window.LatencyView.read() : null,
      };
    });
    if (last.drawn === want) return last;
    step();
    await sleep(120);
  }
  report.exceptions.push({ what: `latency/${want}`, why: 'never reached', last: last && last.read });
  return last;
}

// ── scene 1: the regions, the controls, the tour ──────────────────────────

async function sceneRegions(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  // THE TOUR IS OPENED DELIBERATELY, LATER. Its first-run offer is a real
  // behaviour and it is photographed as one at `12-tour`; a dim layer over
  // every other picture in the manual is not what those pictures are of.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.exceptions.push({ what: 'page', why: String(e && e.message) }));
  page.on('console', (m) => {
    if (m.type() === 'error') report.console.push(m.text());
  });

  await enter(page, 'manual');
  // Two turns so the wire has delivered a board and the roster has plans:
  // the strip is empty (and `display:none`) until a `board-update` has
  // actually landed, and the stage line has nothing to say before one has.
  await step();
  await sleep(1200);
  await step();
  await sleep(1600);

  await shot(page, '01-live-view', 'the whole live view at 1500 × 950, nothing focused');
  await shot(page, '02-clock', 'the turn clock on the board’s top edge', '#turnClock');
  await shot(page, '03-glance', 'the stage line and the unfinished-business strip', '#lensStage');

  await focusUnit(page, 0);
  report.notes.answered = await selectAnsweredCandidate(page, 'red-A');
  await shot(page, '04-rail', 'the rail with a unit focused and the answered candidate under the cursor', '.lens-rail');
  await shot(page, '05-cards', 'rank 1 and the foil as two full-size cards, ranks 3+ one line each', '.lens-movesets');
  await shot(page, '06-board', 'the board at CANDIDATE — filled, hollow, dashed and ringed', '#gameCanvas');

  await page.keyboard.press('b');
  await sleep(1400);
  await shot(page, '07-breakdown', 'the breakdown drill, with the joint residual', '.lens-breakdown');

  await shot(page, '08-controls', 'the control bar — glyph · verb · key · state', '#lensControls');
  await shot(page, '09-keys', 'the cheat strip, and the scheme and density pickers', '#lensKeys');
  await shot(page, '10-lane', 'the intra-turn timeline lane', '#lensLane');

  // THE ARMED LOCK. The one confirmation on this surface, and the manual's
  // most important picture: the count is on screen before either press.
  await page.keyboard.press('Escape');
  await sleep(400);
  await focusUnit(page, 0);
  await selectAnsweredCandidate(page, 'red-A');
  await page.keyboard.press('Shift+ ');
  await sleep(800);
  report.notes.armed = (await words(page)).controls;
  await shot(page, '11-lock-armed', 'Shift+Space arms a multi-unit lock — the affordance is the confirmation', '#lensControls');
  await page.keyboard.press('Escape');
  await sleep(400);

  // THE TOUR. Opened the way an operator opens it, stepped to the end, and
  // photographed on the region the manual teaches first.
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await page.keyboard.press('?');
  await page.keyboard.press('T');
  await sleep(700);
  report.notes.tourOpen = await page.evaluate(() => (window.Tour ? window.Tour.isOpen() : null));
  report.notes.tourShown = await page.evaluate(() => (window.Tour ? window.Tour.shown() : null));
  await shot(page, '12-tour', 'the guided tour on its first region — the page underneath is live', null);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await sleep(500);
  await shot(page, '13-tour-card', 'a tour card — one region, one sentence, Enter next, Esc leave', '.tour-card');
  await page.keyboard.press('Escape');
  await sleep(400);
  report.notes.tourClosed = await page.evaluate(() => (window.Tour ? !window.Tour.isOpen() : null));

  await ctx.close();
}

// ── scene 2: a wire that costs something ──────────────────────────────────

async function sceneWire(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.exceptions.push({ what: 'page', why: String(e && e.message) }));
  await enter(page, 'manual');
  await step();
  await sleep(1500);

  const degraded = await untilState(page, 'DEGRADED');
  report.notes.degraded = degraded && degraded.read;
  await shot(page, '20-degraded', 'the ladder at DEGRADED, on a 500 ms wire with jitter');
  // THE STRIP IS CROPPED OUT OF THE PAGE AND NOT SHOT AS AN ELEMENT. On this
  // head `#latency-mount` is duplicated in `play-game.html` — the header keeps
  // a stale copy from one branch and the board keeps the full-width strip from
  // another — and `getElementById` takes the first, so the surface is drawn
  // into a zero-width header box and an element shot of it times out. The
  // manual says so, and this photographs what an operator actually sees.
  await shot(page, '20b-degraded-strip', 'the top of the page at DEGRADED — where the strip actually lands', null, {
    x: 0, y: 0, width: 1500, height: 130,
  });

  const stale = await untilState(page, 'STALE');
  report.notes.stale = stale && stale.read;
  await shot(page, '21-stale', 'the ladder at STALE — the deadline passed and nothing has arrived since');
  await shot(page, '21b-stale-strip', 'the top of the page at STALE', null, {
    x: 0, y: 0, width: 1500, height: 130,
  });

  await ctx.close();
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  const scenes = [
    { name: 'regions', flags: ['--turn-timeout=3000'], run: sceneRegions },
    {
      name: 'wire',
      flags: ['--turn-timeout=3000', '--latency=500', '--jitter=60'],
      run: sceneWire,
    },
  ];
  for (const scene of scenes) {
    console.log(`\n── ${scene.name} (${scene.flags.join(' ') || 'free wire'})`);
    const server = startServer(scene.flags);
    try {
      await server.ready;
      await scene.run(browser);
    } catch (e) {
      report.exceptions.push({ what: scene.name, why: String(e && e.message) });
      console.error(`  ! ${scene.name}: ${e && e.message}`);
    } finally {
      await stopServer(server);
      await sleep(600);
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport → ${path.join(OUT, 'report.json')}`);
  const over = report.shots.filter((s) => s.kb && s.kb > BUDGET_KB);
  const missing = report.shots.filter((s) => s.missing);
  if (over.length || missing.length || report.exceptions.length) {
    console.error(
      `\nNOT CLEAN: ${over.length} over budget, ${missing.length} missing, ` +
        `${report.exceptions.length} exceptions`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
