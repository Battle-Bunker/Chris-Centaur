/**
 * THE EXPLANATION AUDIT — five questions, timed, against the shipped rail.
 *
 * `05-EVALUATION.md` §2's method exactly: a `MutationObserver` armed against a
 * BASELINE before the operator's input, stopped at the first animation frame
 * after the DOM carries the answer, with the press and click counts riding
 * alongside — because a fast answer that costs six keys is not a fast answer.
 * The method is copied rather than imported because `scripts/ux-eval.js` is
 * another worker's file this round and a shared edit would be a merge conflict
 * over a stopwatch.
 *
 *   node scripts/ux-walk-server.js --port=5188 &
 *   node scripts/explain-eval.js --port=5188 --out=docs/design/ux/explain
 *
 * FIVE QUESTIONS, and the whole point of the suite is that a question with no
 * answer on the surface records `answered: false` rather than a large number.
 * An interface that never answers and an interface that answers slowly are
 * different findings and only one of them is a latency problem:
 *
 *   Q1  why is rank 1 above rank 2?
 *   Q2  what is rank 1 afraid of?
 *   Q3  which enemy reply hurts most?
 *   Q4  how sure is the bot?
 *   Q5  what changes if I pin this unit?
 *
 * Each question names the selectors that COULD answer it, in the order a
 * reader's eye would reach them, and the suite records which one actually did
 * and what it said. Run it before a change and after; the two reports are the
 * before/after in the same units.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = parseInt(arg('port', '5188'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/explain'));
const LABEL = arg('label', 'after');
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = arg('game', 'lens-walk');
const WAIT = parseInt(arg('wait', '2000'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = () => fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json());

const out = { label: LABEL, questions: [], shots: [], notes: {} };

async function shot(page, name, note, selector) {
  const file = path.join(OUT, `${name}.png`);
  const target = selector ? await page.$(selector) : page;
  if (!target) {
    out.shots.push({ name, note, missing: selector });
    return null;
  }
  await target.screenshot({ path: file });
  const bytes = fs.statSync(file).size;
  out.shots.push({ name, note, bytes });
  console.log(`  · ${name} (${(bytes / 1024).toFixed(0)} KB)`);
  return bytes;
}

async function enter(page, gameId, name) {
  await page.goto(`${BASE}/game/${gameId}`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  if (!(await page.$('#loginGate.active'))) return name;
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate =
      attempt === 0 ? name : `${name}-${attempt}${Math.floor(Math.random() * 90 + 10)}`;
    await page.fill('#loginNameInput', candidate);
    await sleep(400);
    if (!(await page.$eval('#loginGateSubmit', (el) => el.disabled))) {
      await page.click('#loginGateSubmit');
      await sleep(WAIT);
      return candidate;
    }
  }
  throw new Error(`no free operator name for ${name}`);
}

async function takeOver(page) {
  if (!(await page.$('#confirmDialog.active'))) return false;
  await page.click('#confirmTakeoverBtn');
  await sleep(700);
  return true;
}

async function focusUnit(page, index) {
  await takeOver(page);
  const rows = await page.$$('.snake-info-item.selectable');
  if (rows[index]) {
    await rows[index].click({ force: true });
    await sleep(WAIT);
    await takeOver(page);
  }
}

/** The candidate the inspection reserve actually answered — the one candidate
 *  with a ranked list behind it. A measurement taken on the fallback measures
 *  the fallback. */
async function selectAnsweredCandidate(page, unit) {
  const lock = await page.evaluate(() => {
    const events = typeof lensEvents === 'undefined' ? [] : lensEvents;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      const locks = e && e.kind === 'conditional' && e.payload ? e.payload.locks : null;
      if (locks && locks[0]) return locks[0];
    }
    return null;
  });
  if (lock && (!unit || lock.unit === unit)) {
    const selector = `.lens-candidates [data-lens-candidate="${lock.to}"]`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const cell = await page.$(selector);
      if (cell) {
        try {
          await takeOver(page);
          await cell.click({ timeout: 4000, force: true });
          await sleep(WAIT);
          break;
        } catch (_e) {
          /* the rail re-rendered under the handle; re-query */
        }
      }
      await sleep(300);
    }
  }
  return page.evaluate(
    () => document.querySelectorAll('.lens-movesets tr[data-lens-moveset]').length
  );
}

function makeClock(page) {
  const arm = (selector, needle) =>
    page.evaluate(
      ([sel, re]) => {
        const el0 = document.querySelector(sel);
        window.__xMark = { t0: performance.now(), t1: null, base: el0 ? el0.innerText : null };
        const hit = () => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const text = el.innerText || '';
          if (text === window.__xMark.base) return false;
          return re ? new RegExp(re).test(text) : true;
        };
        const obs = new MutationObserver(() => {
          if (window.__xMark.t1 === null && hit()) {
            requestAnimationFrame(() => {
              if (window.__xMark.t1 === null) window.__xMark.t1 = performance.now();
            });
          }
        });
        obs.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        window.__xObs = obs;
      },
      [selector, needle || null]
    );
  const read = async (budget = 4000) => {
    const until = Date.now() + budget;
    for (;;) {
      const v = await page.evaluate(() => {
        const m = window.__xMark;
        return m && m.t1 !== null ? Number((m.t1 - m.t0).toFixed(1)) : null;
      });
      if (v !== null || Date.now() > until) {
        await page.evaluate(() => {
          if (window.__xObs) window.__xObs.disconnect();
        });
        return v;
      }
      await sleep(50);
    }
  };
  return { arm, read };
}

/**
 * WHICH PIXEL ANSWERED. The candidates are listed in the order a reader's eye
 * reaches them, and the FIRST one that both exists and satisfies the question's
 * own predicate is the answer. A question no selector satisfies is recorded as
 * unanswered — which is a finding about the interface and not a failed
 * measurement.
 */
async function answeredBy(page, candidates) {
  return page.evaluate((list) => {
    for (const c of list) {
      const el = document.querySelector(c.sel);
      if (!el) continue;
      // `innerText` applies `text-transform`, so a head the CSS uppercases
      // comes back uppercase; the predicate is about the words and not about
      // the casing a stylesheet chose.
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (c.re && !new RegExp(c.re, 'i').test(text)) continue;
      if (!c.re && text === '') continue;
      const box = el.getBoundingClientRect();
      return { sel: c.sel, text: text.slice(0, 400), y: Math.round(box.top), h: Math.round(box.height) };
    }
    return null;
  }, candidates);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('lensTourDone', '1');
    } catch (e) {
      /* no storage */
    }
  });
  const page = await context.newPage();

  await enter(page, GAME, 'Explain');
  await step();
  await sleep(WAIT);
  await page.keyboard.press('Escape');
  await sleep(400);

  /**
   * THE FIVE QUESTIONS, over whatever list is under the cursor.
   *
   * They are asked TWICE, because the rail draws two different lists and only
   * one of them has ever carried a number:
   *
   *  · `conditional` — the rows a lock here would stage. This is the list an
   *    operator reads at the moment they decide whether to overrule, and every
   *    row on it is `unpriced`: `conform` returns a plan, not a bound.
   *  · `retained`    — the reservoir's own priced rows, restricted to the
   *    candidate under the cursor. Bounds, dominance conditions and a loud
   *    reading, all of them real.
   *
   * A reading that is only true of one of the two is not a finding about the
   * interface, it is a finding about which list was measured.
   */
  const { arm, read } = makeClock(page);
  const askFive = async (phase) => {
    // TIME TO FIRST RELEVANT PAINT, on the one input that changes what the
    // explanation is about: `]` walks the cursor to the next row, so every
    // reading under the table has to be recomputed and redrawn for a different
    // pair. The clock starts at the press and stops at the first frame after
    // the strip carries a sentence that differs from the one it carried.
    await arm('.lens-movesets', null);
    const t0 = Date.now();
    await page.keyboard.press(']');
    const paint = await read(3000);
    out.notes[`${phase}Walk`] = { paintMs: paint, totalMs: Date.now() - t0, keys: 1, clicks: 0 };
    await sleep(300);
    await page.keyboard.press('[');
    await sleep(400);

    const record = async (id, question, candidates) => {
      const t0 = Date.now();
      const hit = await answeredBy(page, candidates);
      const row = {
        phase,
        id,
        question,
        answered: hit !== null,
        by: hit ? hit.sel : null,
        says: hit ? hit.text : null,
        atY: hit ? hit.y : null,
        totalMs: Date.now() - t0,
      };
      out.questions.push(row);
      console.log(
        `  ${row.answered ? '✓' : '✗'} ${phase}/${id} — ` +
          `${row.answered ? row.by : 'NOTHING ON SCREEN ANSWERS IT'}`
      );
      return row;
    };

    // Q1 — the answer has to name the ONE thing that decides the order. The
    // foil line names the runner-up and the rung it lost on; what neither it
    // nor the assignment cell ever said is WHICH MEMBER carries the difference.
    await record('Q1', 'why is rank 1 above rank 2?', [
      { sel: '.lens-contrast', re: 'decid|differ|same moves' },
      { sel: '.lens-foil', re: 'foil #' },
      { sel: '.lens-move-diff', re: null },
    ]);

    // Q2 — the leader's own `unless` cell reads `leads on the proved floor`,
    // which is a statement about the COMPARISON and not about the risk.
    await record('Q2', 'what is rank 1 afraid of?', [
      { sel: '.lens-threats', re: 'open on|cliff|carries no bounds|nothing is named' },
      { sel: '.lens-row-lead .lens-unless', re: 'resolve against us|refuted|dominated' },
    ]);

    // Q3 — a RANKING, not a set: which of the named units holds the most.
    await record('Q3', 'which enemy reply hurts most?', [
      { sel: '.lens-threats-list .lens-threat', re: null },
      { sel: '.lens-threats', re: 'at stake|held replies|carries no bounds' },
    ]);

    // Q4 — `⌈w⌉` and the band are the WIDTH; the question is whether the ORDER
    // is proved, which is the margin read against that width.
    await record('Q4', 'how sure is the bot?', [
      { sel: '.lens-unsure', re: 'not proved|is proved|carries a price|cliff|open' },
      { sel: '.lens-row-lead .lens-width', re: '⌈' },
    ]);

    // Q5 — the list-source line answers the first half (this list is the rows a
    // lock would stage); the pin count on the chip is the second, and the two
    // have never been in one place.
    await record('Q5', 'what changes if I pin this unit?', [
      { sel: '.lens-list-source', re: 'lock here would stage|no conditional was answered' },
      { sel: '[data-lens-action="lock"]', re: 'pins' },
    ]);
  };

  // ── PHASE 1 — the conditional list ──────────────────────────────────────
  let rows = 0;
  for (let i = 0; i < 6 && rows < 2; i++) {
    await page.keyboard.press('Escape');
    await sleep(250);
    await focusUnit(page, 0);
    rows = await selectAnsweredCandidate(page, 'red-A');
    if (rows > 1) break;
    await step();
    await sleep(WAIT);
  }
  out.notes.conditionalRows = rows;
  out.notes.listSource = await page.evaluate(() => {
    const el = document.querySelector('.lens-list-source');
    return el ? el.innerText : null;
  });
  await shot(page, `${LABEL}-rail`, 'the rail over the conditional list', '.lens-rail');
  await shot(page, `${LABEL}-movesets`, 'the movesets panel over the conditional list', '.lens-movesets');
  await askFive('conditional');
  for (const [sel, name] of [
    ['.lens-contrast', `${LABEL}-contrast`],
    ['.lens-threats', `${LABEL}-threats`],
    ['.lens-unsure', `${LABEL}-unsure`],
    ['.lens-line', `${LABEL}-line`],
  ]) {
    if (await page.$(sel)) await shot(page, name, sel, sel);
  }

  // ── PHASE 2 — the reservoir's own priced rows ───────────────────────────
  //
  // Any roster row and any candidate whose list is the RESTRICTED one with a
  // runner-up on it. This is the list that carries bounds, and it is where
  // every reading this round added has something to say.
  let priced = null;
  for (let unit = 0; unit < 3 && priced === null; unit++) {
    await page.keyboard.press('Escape');
    await sleep(250);
    await focusUnit(page, unit);
    const cells = await page.$$('.lens-candidates tr[data-lens-candidate]');
    for (const cell of cells) {
      try {
        await cell.click({ force: true, timeout: 3000 });
      } catch (_e) {
        continue;
      }
      await sleep(600);
      const state = await page.evaluate(() => ({
        source: document.querySelector('.lens-list-source')
          ? document.querySelector('.lens-list-source').innerText
          : '',
        rows: document.querySelectorAll('.lens-movesets tr[data-lens-moveset]').length,
        widths: document.querySelectorAll('.lens-movesets .lens-width').length,
      }));
      if (state.rows > 1 && state.widths > 0) {
        priced = { unit, ...state };
        break;
      }
    }
  }
  out.notes.priced = priced;
  if (priced !== null) {
    await shot(page, `${LABEL}-priced-rail`, 'the rail over the priced retained rows', '.lens-rail');
    await shot(page, `${LABEL}-priced-movesets`, 'the priced list', '.lens-movesets');
    await askFive('retained');
    for (const [sel, name] of [
      ['.lens-contrast', `${LABEL}-priced-contrast`],
      ['.lens-threats', `${LABEL}-priced-threats`],
      ['.lens-unsure', `${LABEL}-priced-unsure`],
      ['.lens-line', `${LABEL}-priced-line`],
    ]) {
      if (await page.$(sel)) await shot(page, name, sel, sel);
    }
  } else {
    console.log('  · no priced list with a runner-up was reachable this run');
  }

  // WHAT THE TWO L3 PREFERENCES BUY BACK. Every reading added this round is
  // ink in a column that already scrolls at 1280×720 (05 H-17), so the cost is
  // measured with them on and with them off, through `Prefs` itself rather than
  // through a class the page would have to be told about.
  out.notes.railWithL3 = await page.evaluate(() => {
    const rail = document.getElementById('lensRail');
    return rail ? rail.scrollHeight : null;
  });
  out.notes.railWithoutL3 = await page.evaluate(() => {
    if (!window.Prefs) return null;
    window.Prefs.set('explain.threats', false);
    window.Prefs.set('explain.line', false);
    const rail = document.getElementById('lensRail');
    return rail ? rail.scrollHeight : null;
  });
  await sleep(400);
  await page.evaluate(() => {
    if (!window.Prefs) return;
    window.Prefs.set('explain.threats', true);
    window.Prefs.set('explain.line', true);
  });
  await sleep(400);

  // THE RAIL'S OWN HEIGHT, because every one of these is new ink in a column
  // that already scrolls at 1280×720 (05 H-17).
  out.notes.railExtent = await page.evaluate(() => {
    const panel = document.getElementById('selectedSnakePanel');
    const rail = document.getElementById('lensRail');
    return panel && rail
      ? { panelH: Math.round(panel.getBoundingClientRect().height), railScrollH: rail.scrollHeight }
      : null;
  });

  fs.writeFileSync(path.join(OUT, `report-${LABEL}.json`), JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path.join(OUT, `report-${LABEL}.json`)}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
