/**
 * THE SECONDARY-SCREEN CAMERA — one PNG per operator screen, plus what the
 * page said on the way past.
 *
 * Pairs with `src/tests/secondary-screens-server.ts`, the way
 * `lens-walkthrough.js` pairs with `lens-walkthrough-server.ts`:
 *
 *   npx ts-node --transpile-only src/tests/secondary-screens-server.ts --port=5056 &
 *   node scripts/secondary-screens-shots.js --port=5056 \
 *     --out=docs/design/ux/screens --prefix=after
 *
 * Console errors, failed requests, page exceptions and horizontal overflow are
 * written beside the images as `<prefix>-report.json`, because a screenshot
 * cannot show a console and a verdict needs the words as well as the pixels.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = parseInt(arg('port', '5056'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/screens'));
const PREFIX = arg('prefix', 'after');
const BASE = `http://127.0.0.1:${PORT}`;
const WAIT = parseInt(arg('wait', '1200'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { base: BASE, prefix: PREFIX, shots: [], console: [], requests: [], exceptions: [] };

/** Every screen the operator reaches from the header, plus the two states that
 *  only exist after an interaction. `act` runs before the shutter. */
const SCREENS = [
  { name: 'play', url: '/play', note: 'Game list / entry' },
  { name: 'history', url: '/history', note: 'Replay browsing' },
  { name: 'config', url: '/config', note: 'Bot identity, binding and heuristics' },
  { name: 'activity', url: '/activity', note: 'What the bot did unattended' },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();

  let at = 'boot';
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      report.console.push({ at, type: m.type(), text: m.text() });
    }
  });
  page.on('pageerror', (e) => report.exceptions.push({ at, text: String(e && e.message) }));
  page.on('requestfailed', (r) =>
    report.requests.push({ at, url: r.url(), why: r.failure() && r.failure().errorText })
  );
  page.on('response', (r) => {
    if (r.status() >= 400) report.requests.push({ at, url: r.url(), status: r.status() });
  });

  for (const screen of SCREENS) {
    at = screen.name;
    await page.goto(BASE + screen.url, { waitUntil: 'domcontentloaded' });
    await sleep(WAIT);
    if (screen.act) await screen.act(page);
    const file = path.join(OUT, `${PREFIX}-${screen.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const size = fs.statSync(file).size;
    // Everything committed here has to stay under 300 KB; a page that draws
    // more than that gets clipped to the fold rather than silently bloating
    // the repo.
    if (size > 300 * 1024) {
      // Ladder down until it fits: the fold instead of the full page, then a
      // narrower viewport. A page whose flat chrome compresses well never
      // gets here; a full-bleed gradient does.
      await page.screenshot({ path: file, fullPage: false });
      for (const width of [1200, 1024, 900]) {
        if (fs.statSync(file).size <= 300 * 1024) break;
        await page.setViewportSize({ width, height: 800 });
        await sleep(200);
        await page.screenshot({ path: file, fullPage: false });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await sleep(200);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    report.shots.push({
      name: screen.name,
      url: screen.url,
      note: screen.note,
      bytes: fs.statSync(file).size,
      horizontalOverflow: overflow,
      title: await page.title(),
    });
    console.log(`  · ${PREFIX}-${screen.name}.png  ${fs.statSync(file).size} B${overflow ? '  OVERFLOW' : ''}`);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, `${PREFIX}-report.json`), JSON.stringify(report, null, 2) + '\n');
  const bad = report.exceptions.length + report.requests.length;
  console.log(
    `${report.shots.length} shots · ${report.console.length} console · ` +
    `${report.requests.length} bad requests · ${report.exceptions.length} exceptions`
  );
  if (bad > 0) console.log(JSON.stringify({ requests: report.requests, exceptions: report.exceptions }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
