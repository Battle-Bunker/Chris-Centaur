/**
 * Shoot the three IA mockups at the real board size, in the real viewport the
 * walkthrough uses (1500 × 950). No server: the files are self-contained, so
 * they load off `file://` exactly as they are committed.
 *
 *   node docs/design/ux/mockups/shoot.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';
const DIR = __dirname;
const SHOTS = ['a-rail-two-rows', 'b-watch-first', 'c-bottom-deck'];

(async () => {
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  for (const name of SHOTS) {
    await page.goto(`file://${path.join(DIR, `${name}.html`)}`, { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const file = path.join(DIR, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`  · ${name}.png (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
