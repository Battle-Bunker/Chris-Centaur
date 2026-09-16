/**
 * THE COMMANDS PANEL, PHOTOGRAPHED — before and after the split.
 *
 * `docs/design/ux/16-COMMANDS.md` §3 claims the operator's commands stop
 * moving when the bot's panels change size. A claim about position is a claim
 * a picture can check, so this takes the pictures from a real decision on the
 * real page — the walkthrough server, the same one the walk and the manual
 * shots use — and records the measured box of every region beside them.
 *
 *   node scripts/commands-shots.js --phase=before --port=5731
 *   node scripts/commands-shots.js --phase=after  --port=5731
 *
 * `report-<phase>.json` carries the DOM rectangles of `#lensControls` over
 * three successive turns. That is the actual evidence: if the top of the
 * commands region has the same `y` on every turn, nothing above it is pushing
 * it around.
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

const PHASE = arg('phase', 'after');
const PORT = parseInt(arg('port', '5731'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/screens/commands'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const child = spawn(
    path.join(ROOT, 'node_modules/.bin/ts-node'),
    ['--transpile-only', 'src/tests/lens-walkthrough-server.ts', `--port=${PORT}`, '--seed=1', '--nodes=550'],
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

/** The measured boxes — the evidence the pictures illustrate. */
const boxes = (page) =>
  page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      controls: box('#lensControls'),
      stage: box('#lensStage'),
      rail: box('#lensRail'),
      lane: box('#lensLane'),
      commands: box('#railCommands'),
      bot: box('#railBot'),
    };
  });

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = startServer();
  const report = { phase: PHASE, turns: [] };
  let browser = null;
  try {
    await server.ready;
    browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${PORT}/game/lens-walk`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    if (await page.$('#loginGate.active')) {
      await page.fill('#loginNameInput', `shots-${PHASE}`);
      await page.click('#loginGateSubmit');
      await sleep(2500);
    }
    await step();
    await sleep(1500);
    const rows = await page.$$('.snake-info-item.selectable');
    if (rows[0]) {
      await rows[0].click();
      await sleep(1400);
    }

    // Three turns: the bot's panels grow and shrink with the decision, and the
    // commands region must not move while they do.
    for (let i = 0; i < 3; i++) {
      report.turns.push(await boxes(page));
      if (i === 0) {
        const rail = await page.$('#selectedSnakePanel');
        if (rail) await rail.screenshot({ path: path.join(OUT, `${PHASE}-rail.png`) });
        await page.screenshot({ path: path.join(OUT, `${PHASE}-page.png`) });
      }
      await step();
      await sleep(1600);
    }

    const ys = report.turns.map((t) => (t.controls ? t.controls.y : null));
    report.controlsYStable = ys.every((y) => y !== null && y === ys[0]);
    fs.writeFileSync(path.join(OUT, `report-${PHASE}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${PHASE}: #lensControls y over three turns = ${ys.join(', ')} — stable: ${report.controlsYStable}`);
  } finally {
    if (browser) await browser.close();
    await stopServer(server);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
