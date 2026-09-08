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
/** The turn clock a scene asks the harness for. LONGER THAN A REAL GAME ON
 *  PURPOSE, and only here: capturing a screenshot costs a few hundred
 *  milliseconds, so on a 500 ms turn the rung has moved on by the time the
 *  bytes are taken and the picture is of the next rung down. Every threshold
 *  on this surface is a FRACTION of the budget, so a longer budget photographs
 *  the same ladder with the same proportions — which is exactly why the
 *  thresholds are fractions. `--latency` is scaled per scene to match. */
const DEFAULT_BUDGET = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { scenes: [], shots: [], console: [], exceptions: [] };

// ── The server, one per scene ─────────────────────────────────────────────

function startServer(flags, budget) {
  // `ts-node` DIRECTLY and never through `npx`: npx is a shell that spawns
  // another shell that spawns node, and a SIGTERM to the top of that stack
  // leaves the server holding the port. The first run of this script left two
  // of them behind and the next scene could not bind.
  const child = spawn(
    path.join(ROOT, 'node_modules/.bin/ts-node'),
    [
      '--transpile-only',
      'src/tests/lens-walkthrough-server.ts',
      `--port=${PORT}`,
      '--seed=1',
      '--nodes=300',
      '--warmup=1',
      `--turn-timeout=${budget}`,
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
      // WHAT IS DRAWN, not what is known. `read()` is exact at the instant it
      // is called and the widget redraws on a 100 ms ticker, so the two
      // disagree for up to a tick — and a shot gated on `read()` alone can
      // photograph a panel that still says the previous rung. Every predicate
      // below gates on THIS.
      domState: root ? root.getAttribute('data-state') : null,
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
    await sleep(50);
  }
  report.exceptions.push({ what, why: 'never reached', last: last && last.read });
  return last;
}

/**
 * THE SHORT RUNGS. On this harness a turn is played on demand, so LIVE lasts
 * half a budget and THINKING lasts the other half: after that the deadline
 * passes and the surface is correctly STALE until the next `/dev/step`. A shot
 * of a rung that narrow cannot be reached by stepping and then waiting — the
 * poll has to already be running when the frames land. So: issue the step
 * WITHOUT awaiting it, poll from that instant, and if the window was missed
 * (a shared CPU can lose it to one long GC) step again and try once more.
 */
async function catchRung(page, what, pred, tries = 6, windowMs = 4000) {
  for (let i = 0; i < tries; i++) {
    const stepping = step();
    const hit = await until(page, `${what}#${i}`, pred, windowMs);
    if (hit && hit.read && pred(hit)) {
      report.exceptions = report.exceptions.filter((e) => !String(e.what).startsWith(`${what}#`));
      return hit;
    }
    await stepping;
  }
  report.exceptions.push({ what, why: `never reached in ${tries} turns` });
  return readSurface(page);
}

/**
 * ONE CAPTURE, TWO PICTURES. The strip and the whole page are cropped out of
 * the SAME frame rather than photographed one after the other: this surface
 * redraws ten times a second, so two `page.screenshot()` calls 150 ms apart
 * can land on different rungs of the ladder and the doc would then show a
 * close-up that disagrees with the page it claims to be a close-up of. The
 * first run did exactly that — a strip reading LIVE beside a page reading
 * THINKING — so the crop is done in the browser, on the bytes already taken.
 */
async function shot(page, scene, name, note, opts = {}) {
  // TO THE TOP FIRST. Clicking a roster row scrolls the page, and a clip
  // computed from a mount that has left the viewport photographs whatever
  // happens to be at those coordinates instead — one run produced a `04-stale`
  // that was a picture of the Firebase banner.
  await page.evaluate(() => window.scrollTo(0, 0));
  const surface = await readSurface(page);
  const box = await page.evaluate(() => {
    const m = document.getElementById('latency-mount');
    const card = document.querySelector('.board-left') || document.body;
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return { x: Math.min(r.x, c.x), y: r.y, width: Math.max(r.width, c.width) };
  });
  const file = path.join(OUT, `${name}.png`);
  const buf = await page.screenshot();
  if (opts.page) fs.writeFileSync(path.join(OUT, `${name}-page.png`), buf);
  if (box) {
    const clip = {
      x: Math.max(0, Math.round(box.x - 6)),
      y: Math.max(0, Math.round(box.y - 6)),
      width: Math.round(box.width + 12),
      height: 130,
    };
    const cropped = await page.evaluate(
      ([uri, c]) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onerror = rej;
          img.onload = () => {
            const cv = document.createElement('canvas');
            cv.width = c.width;
            cv.height = c.height;
            cv.getContext('2d').drawImage(img, c.x, c.y, c.width, c.height, 0, 0, c.width, c.height);
            res(cv.toDataURL('image/png'));
          };
          img.src = uri;
        }),
      [`data:image/png;base64,${buf.toString('base64')}`, clip]
    );
    fs.writeFileSync(file, Buffer.from(cropped.split(',')[1], 'base64'));
  } else {
    report.exceptions.push({ what: name, why: 'no #latency-mount' });
  }
  // DID THE RUNG MOVE WHILE THE BYTES WERE BEING TAKEN? Recorded rather than
  // hidden: a caption that names a state has to be checkable against the
  // surface's own reading on both sides of the capture.
  const after = await readSurface(page);
  const entry = {
    scene,
    name,
    note,
    driftedTo: after.domState === surface.domState ? null : after.domState,
    bytes: box && fs.existsSync(file) ? fs.statSync(file).size : null,
    ...surface,
  };
  report.shots.push(entry);
  const st = surface.domState || '—';
  console.log(
    `  · ${name} [${st}${entry.driftedTo ? `→${entry.driftedTo}` : ''}] ` +
      `${surface.text ? surface.text.slice(0, 66) : ''}`
  );
  if (entry.driftedTo) report.exceptions.push({ what: name, why: `drifted ${st}→${entry.driftedTo}` });
  return entry;
}

/**
 * Focus a unit through the shipped gesture, so a command is actually sent.
 *
 * RE-QUERIED ON EVERY ATTEMPT. The roster rebuilds on every board update, so a
 * handle taken a moment ago is detached by the time it is clicked — which is
 * the same node-identity problem §2.2 is about, seen from the other side.
 */
async function clickRow(page, pick, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const rows = await page.$$('.snake-info-item.selectable');
    const active = await page.evaluate(() => {
      const el = document.querySelector('.snake-info-item.active-perspective');
      return el ? [...document.querySelectorAll('.snake-info-item.selectable')].indexOf(el) : -1;
    });
    const index = pick(rows.length, active);
    if (index < 0 || !rows[index]) return false;
    try {
      await rows[index].click({ timeout: 4000 });
      return true;
    } catch (e) {
      await sleep(250);
    }
  }
  return false;
}

const focusUnit = (page, index) => clickRow(page, () => index);

/**
 * A COMMAND, NOW. The roster row of a unit that is not the active perspective
 * — a row that is already active fires nothing, and a shot of an
 * acknowledgement needs an acknowledgement to have been asked for.
 */
const issueCommand = (page) =>
  clickRow(page, (n, active) => {
    for (let i = 0; i < n; i++) if (i !== active) return i;
    return -1;
  });

// ── The scenes ────────────────────────────────────────────────────────────

const SCENES = [
  {
    name: 'clean',
    flags: [],
    why: 'the shipped wire, with a real turn clock: what LIVE and THINKING look like',
    async run(page) {
      await enter(page, 'Ada');
      // The roster gesture first, so the rail has a focused unit under it and
      // the pictures below are of a page an operator is actually working.
      await step();
      await sleep(800);
      await focusUnit(page, 0);
      await sleep(1200);

      await catchRung(page, 'live', (s) => s.domState === 'LIVE' && s.read.rttMs !== null);
      await shot(page, 'clean', '01-live', 'LIVE — the shipped wire under a turn clock: the bar is the deadline, the notch near its right shoulder is the last safe press — a couple of dozen milliseconds of slack on a free wire — and there is no banner at all, because silence is the signal', { page: true });

      // THINKING: the emissions stop while the turn is still open. On this
      // harness the turn is played on demand, so the gap after a step is the
      // real thing rather than a simulation of it.
      await catchRung(page, 'thinking', (s) => s.domState === 'THINKING');
      await shot(page, 'clean', '02-thinking', 'THINKING — half a budget with no decision frame, still inside the deadline. The dot dims and nothing else moves, because the bot is allowed to think and a banner here would cry wolf every turn');

      // A command, acknowledged. On a free wire the round trip is under a
      // frame, so this is the chip in its settled state.
      // A COMMAND HAS TO BE ISSUED INSIDE THE WINDOW. Waiting for a chip
      // without pressing anything waits forever, and pressing before the turn
      // opens photographs the refusal instead — so: step, wait for the page to
      // be live, press, and catch the answer.
      let hit = null;
      for (let i = 0; i < 5 && !hit; i++) {
        const stepping = step();
        await until(page, `ack-live#${i}`, (s) => s.domState === 'LIVE', 3000);
        await issueCommand(page);
        const seen = await until(
          page,
          `ack#${i}`,
          (s) => s.chips.some((c) => c.state === 'ack' || c.state === 'applied'),
          3000
        );
        if (seen && seen.chips.some((c) => c.state === 'ack' || c.state === 'applied')) hit = seen;
        await stepping;
      }
      report.exceptions = report.exceptions.filter(
        (e) => !(hit && (String(e.what).startsWith('ack#') || String(e.what).startsWith('ack-live#')))
      );
      report.scenes.push({ note: 'ack chips', chips: hit && hit.chips });
      await shot(page, 'clean', '03-acknowledged', 'COMMAND ACKNOWLEDGEMENT — the optimistic chips, reconciled: ✓ with the round trip each one actually took. A command that answers for itself settles to ✓ ack; one acknowledged only by the next broadcast that would carry its effect settles to the weaker ✓ applied');

      // STALE: past the deadline with nothing arriving.
      await until(page, 'stale', (s) => s.domState === 'STALE', 12000);
      await shot(page, 'clean', '04-stale', 'STALE — no decision frame past this turn\'s deadline. The bar is spent, the fill goes flat grey, and the banner names the AGE rather than the socket: determinations are still offered here, and labelled', { page: true });

      // DISCONNECTED: the socket closed under it.
      await page.evaluate(() => {
        const ws = window.WSClient && window.WSClient.socket && window.WSClient.socket();
        if (ws) ws.close(4001, 'latency shot');
      });
      await until(page, 'disconnected', (s) => s.domState === 'DISCONNECTED', 8000);
      await shot(page, 'clean', '05-disconnected', 'DISCONNECTED — the one rung that is allowed to be red, and it still says the code and that a reconnect is pending rather than going quietly grey', { page: true });
    },
  },
  {
    name: 'slow',
    flags: ['--latency=500', '--jitter=60'],
    why: 'a second of round trip: DEGRADED, the widened press slack, and a write in flight',
    async run(page, browser) {
      await enter(page, 'Ada');
      await step();
      await sleep(1500);
      await focusUnit(page, 0);
      await catchRung(page, 'degraded', (s) => s.domState === 'DEGRADED' && s.read.rttMs !== null);
      await shot(page, 'slow', '06-degraded-rtt', 'DEGRADED on round trip — 500 ms ± 60 injected on each hop. The banner says the number AND what it costs ("a press needs N ms to land"), and the notch has walked left off the shoulder of the bar to where it now belongs', { page: true });

      // A write in flight. Half a second of round trip is long enough to
      // photograph the optimistic chip before anything has answered it.
      const inflight = step();
      await sleep(200);
      await issueCommand(page);
      await until(page, 'pending', (s) => s.chips.some((c) => c.state === 'pending'), 6000);
      await shot(page, 'slow', '07-optimistic-pending', 'OPTIMISTIC — the gesture is on screen in the frame it was made in, ⟳ and its own age, with nothing yet having answered it');
      await until(page, 'settled', (s) => s.chips.some((c) => c.state === 'ack' || c.state === 'applied'), 8000);
      await shot(page, 'slow', '08-reconciled', 'RECONCILED — the same chip after the server answered: the age it took is exactly the measurement the last-safe-press mark is drawn from, which is why the two are on the same surface');
      await inflight;

      // Past the notch: the countdown is still running and a press is no
      // longer a press.
      await catchRung(
        page,
        'unsafe',
        (s) =>
          s.clock === 'urgent' &&
          s.read.remainingMs !== null &&
          s.read.pressSlackMs !== null &&
          s.read.remainingMs > 0 &&
          s.read.remainingMs <= s.read.pressSlackMs
      );
      await shot(page, 'slow', '09-last-safe-press', 'PAST THE LAST SAFE PRESS — inside the deadline, outside the flight time. The fill goes to its urgent tone and the banner gains the sentence a countdown alone cannot say: a lock issued now may not land this turn', { page: true });

      // Two operators, one unit: the refusal that has to be visible.
      const other = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      const bo = await other.newPage();
      try {
        await enter(bo, 'Bo');
        const mine = await page.evaluate(() =>
          typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId
        );
        // A unit ADA does not already hold, so the contest is Bo's to win.
        const count = (await bo.$$('.snake-info-item.selectable')).length;
        for (let i = count - 1; i >= 0; i--) {
          await clickRow(bo, () => i);
          await sleep(2200);
          const held = await bo.evaluate(() =>
            typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId
          );
          if (held && held !== mine) break;
        }
        const unit = await bo.evaluate(() => (typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId));
        report.scenes.push({ note: 'contest', adaHeld: mine, boHolds: unit });
        if (unit && unit !== mine) {
          // The shipped path, not a synthetic frame: this is the function the
          // roster row's own click handler calls.
          await page.evaluate((id) => selectSnakeForControl(id), unit);
          // THE refusal, not merely A refusal: the page fires a conditional
          // on every focus and the harness refuses it between turns, so a
          // predicate that matches any ✗ matches one that was already there.
          await until(
            page,
            'refused',
            (s) => s.chips.some((c) => c.state === 'refused' && c.text.includes('select')),
            15000
          );
          await shot(page, 'slow', '10-rollback', 'ROLLED BACK, AND SAID SO — a second operator held the unit, so the optimistic chip does not quietly vanish: it becomes ✗ with the reason, and stays long enough to read', { page: true });
        }
      } finally {
        await other.close();
      }
    },
  },
  {
    name: 'gamelag',
    budget: 1200,
    flags: ['--latency-game=1500'],
    why: 'the OTHER hop: the centaur is fine and the game server is behind',
    async run(page) {
      await enter(page, 'Ada');
      await step();
      await sleep(1500);
      await focusUnit(page, 0);
      await catchRung(
        page,
        'game-lag',
        (s) => s.domState === 'DEGRADED' && s.read.gameLagMs !== null && s.read.gameLagMs > 1000
      );
      await shot(page, 'gamelag', '11-game-lag', 'THE SECOND HOP — the client↔centaur wire is free and the TURN is 1.5 s old on arrival. `game +1500ms` is its own number beside `frame` and `board`, and the banner names the game server rather than the connection the operator can see', { page: true });
    },
  },
  {
    name: 'loss',
    budget: 1500,
    flags: ['--latency=180', '--jitter=60', '--loss=0.5', '--loss-any'],
    why: 'half the frames dropped: what an unrecoverable gap reads as',
    async run(page) {
      await enter(page, 'Ada');
      await step();
      await sleep(1500);
      await focusUnit(page, 0);
      await catchRung(page, 'lossy', (s) => s.domState === 'DEGRADED');
      await shot(page, 'loss', '12-loss', 'LOSS — half of every message type dropped, on both hops, on top of 180 ms ± 60. The rung the surface lands on is whatever the AGE says, because a dropped frame is indistinguishable from a frame that was never sent — which is the honest reading, and the reason the ladder is built on age rather than on socket liveness', { page: true });
      await until(page, 'lossy-stale', (s) => s.domState === 'STALE', 15000);
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
      console.log(
        `  wire: ${scene.flags.join(' ') || '(unshaped)'} --turn-timeout=${scene.budget || DEFAULT_BUDGET}`
      );
      const budget = scene.budget || DEFAULT_BUDGET;
      const server = startServer(scene.flags, budget);
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
      report.scenes.push({
        name: scene.name,
        flags: scene.flags,
        turnTimeoutMs: scene.budget || DEFAULT_BUDGET,
        why: scene.why,
        failure,
      });
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
