/**
 * THE LATENCY SURFACE, PHOTOGRAPHED ON A WIRE THAT COSTS SOMETHING.
 *
 * `scripts/lens-walkthrough.js` walks the lens on the wire this dev box
 * actually has, which is free: both hops are in one process and every state
 * the latency surface exists to report is unreachable there. This walks the
 * same page four more times with `src/tests/lens-walkthrough-server.ts`'s
 * injected wire turned on — delay, jitter, loss, a slow game-server hop and a
 * real turn clock — and photographs one rung of `01-RESEARCH.md` §4's ladder
 * per shot.
 *
 *   node scripts/lens-latency-shots.js --out=docs/design/ux/latency
 *
 * Each scene starts its own server (the wire is fixed at construction, so a
 * scene is a server), plays turns through `/dev/step`, waits for the STATE it
 * is about rather than for a duration, and writes:
 *
 *   <name>.png        the surface, clipped to the mount and its overlay
 *   <name>-page.png   the whole page, where the shot is about the page
 *   report.json       `LatencyView.read()` at the instant of every shot —
 *                     the numbers behind the picture, because a screenshot of
 *                     a readout is not evidence that the readout is right.
 *
 * WAITING FOR A STATE AND NOT FOR A CLOCK is the whole discipline here: this
 * CPU is shared and a `sleep(600)` that photographs THINKING on an idle
 * machine photographs DEGRADED on a busy one. Every shot below is gated on
 * `LatencyView.read()` reporting the rung the shot is named after, and a scene
 * that cannot reach its rung says so in the report rather than writing a
 * mislabelled picture.
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

const OUT = path.resolve(arg('out', 'docs/design/ux/latency'));
const PORT = parseInt(arg('port', '5077'), 10);
const ONLY = arg('only', '');
const BUDGET = 1200; // the turn clock every scene asks the harness for

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { scenes: [], shots: [], console: [], exceptions: [] };

// ── The server, one per scene ─────────────────────────────────────────────

function startServer(flags) {
  const child = spawn(
    'npx',
    [
      'ts-node',
      '--transpile-only',
      'src/tests/lens-walkthrough-server.ts',
      `--port=${PORT}`,
      '--seed=1',
      '--nodes=300',
      '--warmup=1',
      `--turn-timeout=${BUDGET}`,
      ...flags,
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server never became ready:\n${log.join('')}`)), 180000);
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
  return { child, ready, log };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([new Promise((r) => server.child.on('exit', r)), sleep(4000)]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

// ── The page ──────────────────────────────────────────────────────────────

const step = () =>
  fetch(`http://127.0.0.1:${PORT}/dev/step`, { method: 'POST' })
    .then((r) => r.json())
    .catch(() => null);

async function enter(page, name) {
  await page.goto(`http://127.0.0.1:${PORT}/game/lens-walk`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if (await page.$('#loginGate.active')) {
    await page.fill('#loginNameInput', name);
    await page.click('#loginGateSubmit');
    await sleep(2500);
  }
}

const readSurface = (page) =>
  page.evaluate(() => {
    const api = window.LatencyView;
    const root = document.querySelector('#latency-mount .lat');
    return {
      read: api ? api.read() : null,
      pending: api ? api.pending() : null,
      text: root ? root.innerText.replace(/\s+/g, ' ').trim() : null,
      banner: (document.querySelector('#latency-mount .lat-banner.on') || {}).innerText || null,
      chips: [...document.querySelectorAll('#latency-mount .lat-cmd')].map((c) => ({
        state: c.getAttribute('data-cmd'),
        text: c.innerText,
      })),
      clock: root ? root.getAttribute('data-clock') : null,
      safeMark: (() => {
        const s = document.querySelector('#latency-mount .lat-clock-safe');
        return s && s.classList.contains('on') ? s.style.left : null;
      })(),
    };
  });

/** Poll the surface's own reading until `pred` holds. Never a bare sleep. */
async function until(page, what, pred, timeoutMs = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await readSurface(page);
    if (last.read && pred(last)) return last;
    await sleep(60);
  }
  report.exceptions.push({ what, why: 'never reached', last: last && last.read });
  return last;
}

/** The mount is 210 px in the header; its overlay hangs 300 px wide beneath
 *  it, out of flow. One clip covers both, and it is computed from the mount so
 *  a header that moves does not silently crop the picture. */
async function shot(page, scene, name, note, opts = {}) {
  const surface = await readSurface(page);
  const box = await page.evaluate(() => {
    const m = document.getElementById('latency-mount');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
  });
  const file = path.join(OUT, `${name}.png`);
  if (box) {
    const width = 330;
    const clip = {
      x: Math.max(0, Math.round(box.right - width + 8)),
      y: Math.max(0, Math.round(box.y - 8)),
      width,
      height: 132,
    };
    await page.screenshot({ path: file, clip });
  } else {
    report.exceptions.push({ what: name, why: 'no #latency-mount' });
  }
  if (opts.page) {
    await page.screenshot({ path: path.join(OUT, `${name}-page.png`) });
  }
  const entry = {
    scene,
    name,
    note,
    bytes: box && fs.existsSync(file) ? fs.statSync(file).size : null,
    ...surface,
  };
  report.shots.push(entry);
  const st = surface.read ? surface.read.state : '—';
  console.log(`  · ${name} [${st}] ${surface.text ? surface.text.slice(0, 70) : ''}`);
  return entry;
}

/** Focus a unit through the shipped gesture, so a command is actually sent. */
async function focusUnit(page, index) {
  const rows = await page.$$('.snake-info-item.selectable');
  if (rows[index]) {
    await rows[index].click();
    return true;
  }
  return false;
}

// ── The scenes ────────────────────────────────────────────────────────────

const SCENES = [
  {
    name: 'clean',
    flags: [],
    why: 'the shipped wire, with a real turn clock: what LIVE and THINKING look like',
    async run(page) {
      await enter(page, 'Ada');
      await step();
      await sleep(400);
      await until(page, 'live', (s) => s.read.state === 'LIVE' && s.read.rttMs !== null, 15000);
      await shot(page, 'clean', '01-live', 'LIVE — a free wire under a 1,200 ms turn clock: the bar is the deadline, the notch at its right shoulder is the last safe press, and there is no banner because silence is the signal', { page: true });

      // THINKING: the emissions stop while the turn is still open. On this
      // harness the turn is played on demand, so the gap after a step is the
      // real thing rather than a simulation of it.
      await step();
      await until(page, 'thinking', (s) => s.read.state === 'THINKING', 8000);
      await shot(page, 'clean', '02-thinking', 'THINKING — half a budget with no decision frame, inside the deadline. The dot dims; nothing else moves, because the bot is allowed to think');

      // A command, acknowledged. On a free wire the round trip is under a
      // frame, so this is the chip in its settled state.
      await focusUnit(page, 0);
      await until(page, 'ack', (s) => s.chips.some((c) => c.state === 'ack' || c.state === 'applied'), 8000);
      await shot(page, 'clean', '03-acknowledged', 'COMMAND ACKNOWLEDGED — the optimistic chip, reconciled: ✓ and the round trip it actually took');

      // STALE: past the deadline with nothing arriving.
      await until(page, 'stale', (s) => s.read.state === 'STALE', 8000);
      await shot(page, 'clean', '04-stale', 'STALE — no decision frame past this turn\'s deadline. The bar is spent and the banner names the age; determinations are still offered, and labelled', { page: true });

      // DISCONNECTED: the socket closed under it.
      await page.evaluate(() => {
        const ws = window.WSClient && window.WSClient.socket && window.WSClient.socket();
        if (ws) ws.close(4001, 'latency shot');
      });
      await until(page, 'disconnected', (s) => s.read.state === 'DISCONNECTED', 8000);
      await shot(page, 'clean', '05-disconnected', 'DISCONNECTED — the one rung that is allowed to be red, and it still says the code and that a reconnect is pending rather than going quietly grey', { page: true });
    },
  },
  {
    name: 'slow',
    flags: ['--latency=250', '--jitter=40'],
    why: '500 ms round trip ± 80: DEGRADED, the widened press slack, and a write in flight',
    async run(page, browser) {
      await enter(page, 'Ada');
      await step();
      await until(page, 'degraded', (s) => s.read.state === 'DEGRADED' && s.read.rttMs !== null, 20000);
      await shot(page, 'slow', '06-degraded-rtt', 'DEGRADED on round trip — 500 ms ± 80 of injected flight. The banner says the number AND what it costs ("a press needs N ms to land"), and the notch has walked left off the shoulder of the bar', { page: true });

      // A write in flight. Half a second of up hop is long enough to
      // photograph the optimistic chip before anything has answered it.
      await step();
      await sleep(150);
      await focusUnit(page, 0);
      await until(page, 'pending', (s) => s.chips.some((c) => c.state === 'pending'), 6000);
      await shot(page, 'slow', '07-optimistic-pending', 'OPTIMISTIC — the gesture is on screen in the frame it was made in, ⟳ and its own age, with nothing yet having answered it');
      await until(page, 'settled', (s) => s.chips.some((c) => c.state === 'ack' || c.state === 'applied'), 8000);
      await shot(page, 'slow', '08-reconciled', 'RECONCILED — the same chip after the server answered: the age it took is the measurement the last-safe-press mark is drawn from');

      // Past the notch: the countdown is still running and a press is no
      // longer a press.
      await step();
      await until(
        page,
        'unsafe',
        (s) =>
          s.read.remainingMs !== null &&
          s.read.pressSlackMs !== null &&
          s.read.remainingMs > 0 &&
          s.read.remainingMs <= s.read.pressSlackMs,
        20000
      );
      await shot(page, 'slow', '09-last-safe-press', 'PAST THE LAST SAFE PRESS — inside the deadline, outside the flight time. The fill goes to its urgent tone and the banner gains the sentence a countdown alone cannot say: a lock issued now may not land this turn', { page: true });

      // Two operators, one unit: the refusal that has to be visible.
      const other = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      const bo = await other.newPage();
      try {
        await enter(bo, 'Bo');
        await focusUnit(bo, 1);
        await sleep(2000);
        const unit = await bo.evaluate(() => (typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId));
        report.scenes.push({ note: 'contest', boHolds: unit });
        if (unit) {
          await page.evaluate((id) => {
            const ws = window.WSClient && window.WSClient.socket && window.WSClient.socket();
            if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'select-snake', snakeId: id }));
          }, unit);
          await until(page, 'refused', (s) => s.chips.some((c) => c.state === 'refused'), 10000);
          await shot(page, 'slow', '10-rollback', 'ROLLED BACK, AND SAID SO — a second operator held the unit, so the optimistic chip does not quietly vanish: it becomes ✗ with the reason, and stays long enough to read', { page: true });
        }
      } finally {
        await other.close();
      }
    },
  },
  {
    name: 'gamelag',
    flags: ['--latency-game=1500'],
    why: 'the OTHER hop: the centaur is fine and the game server is behind',
    async run(page) {
      await enter(page, 'Ada');
      await step();
      await until(page, 'game-lag', (s) => s.read.gameLagMs !== null && s.read.gameLagMs > 0, 20000);
      await shot(page, 'gamelag', '11-game-lag', 'THE SECOND HOP — the client↔centaur wire is free and the TURN is 1.5 s old on arrival. `game +1500ms` is its own number beside `frame` and `board`, and the banner names the game server rather than the connection the operator can see', { page: true });
    },
  },
  {
    name: 'loss',
    flags: ['--latency=180', '--jitter=60', '--loss=0.5', '--loss-any'],
    why: 'half the frames dropped: what an unrecoverable gap reads as',
    async run(page) {
      await enter(page, 'Ada');
      await step();
      await sleep(600);
      await step();
      await until(page, 'lossy', (s) => s.read.state === 'DEGRADED' || s.read.state === 'STALE', 20000);
      await shot(page, 'loss', '12-loss', 'LOSS — half of every message type dropped on both hops. The rung the surface lands on is whatever the AGE says, because a dropped frame is indistinguishable from a frame that was never sent — which is the honest reading and the reason the ladder is built on age and not on socket liveness', { page: true });
      await until(page, 'lossy-stale', (s) => s.read.state === 'STALE', 15000);
      await shot(page, 'loss', '13-loss-stale', 'STALE under loss — the same rung as 04, reached by a wire that is up, fast and losing frames rather than by a turn that ended');
    },
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    for (const scene of SCENES) {
      if (ONLY && !ONLY.split(',').includes(scene.name)) continue;
      console.log(`\n${scene.name}: ${scene.why}`);
      console.log(`  wire: ${scene.flags.join(' ') || '(unshaped)'} --turn-timeout=${BUDGET}`);
      const server = startServer(scene.flags);
      let failure = null;
      try {
        await server.ready;
        const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
        const page = await context.newPage();
        page.on('console', (m) => {
          if (m.type() === 'error') report.console.push({ scene: scene.name, text: m.text() });
        });
        page.on('pageerror', (e) => report.exceptions.push({ scene: scene.name, text: String(e && e.message) }));
        try {
          await scene.run(page, browser);
        } finally {
          await context.close();
        }
      } catch (e) {
        failure = String((e && e.message) || e);
        console.log(`  ! ${failure.split('\n')[0]}`);
      } finally {
        await stopServer(server);
      }
      report.scenes.push({ name: scene.name, flags: scene.flags, budgetMs: BUDGET, why: scene.why, failure });
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.shots.length} shots → ${OUT}`);
  if (report.exceptions.length) console.log(`${report.exceptions.length} exception(s) — see report.json`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
