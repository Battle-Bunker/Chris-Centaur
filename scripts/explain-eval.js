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
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (c.re && !new RegExp(c.re).test(text)) continue;
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
  const { arm, read } = makeClock(page);

  await enter(page, GAME, 'Explain');
  await step();
  await sleep(WAIT);
  await page.keyboard.press('Escape');
  await sleep(400);

  // A list with a runner-up on it, or every contrastive measurement below is a
  // measurement of an empty table.
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
  out.notes.rows = rows;
  await shot(page, `${LABEL}-rail`, 'the rail with a ranked list under the cursor', '.lens-rail');
  await shot(page, `${LABEL}-movesets`, 'the movesets panel', '.lens-movesets');

  const record = async (id, question, candidates, work) => {
    const t0 = Date.now();
    const cost = work ? await work() : { keys: 0, clicks: 0, paint: 0 };
    const hit = await answeredBy(page, candidates);
    const row = {
      id,
      question,
      answered: hit !== null,
      by: hit ? hit.sel : null,
      says: hit ? hit.text : null,
      atY: hit ? hit.y : null,
      keys: cost.keys,
      clicks: cost.clicks,
      paintMs: cost.paint,
      totalMs: Date.now() - t0,
    };
    out.questions.push(row);
    console.log(
      `  ${row.answered ? '✓' : '✗'} ${id} — ${row.answered ? row.by : 'NOTHING ON SCREEN ANSWERS IT'}` +
        ` · ${row.keys}k ${row.clicks}c ${row.paintMs === null ? '—' : `${row.paintMs}ms`}`
    );
    return row;
  };

  // ── Q1 — why is rank 1 above rank 2? ────────────────────────────────────
  //
  // The answer has to name the ONE thing that decides the order. The foil line
  // names the runner-up and the rung it lost on; what neither it nor the
  // assignment cell has ever said is WHICH MEMBER carries the difference.
  await record(
    'Q1',
    'why is rank 1 above rank 2?',
    [
      { sel: '.lens-contrast', re: 'decid|differ|same plan' },
      { sel: '.lens-foil', re: 'foil #' },
      { sel: '.lens-move-diff' },
    ],
    async () => ({ keys: 0, clicks: 0, paint: 0 })
  );

  // The same question with the board brought in, which is what `F` is for.
  {
    await arm('#gameCanvas', null);
    const t = Date.now();
    await page.keyboard.press('f');
    const paint = await read(2000);
    out.notes.foilKey = { paintMs: paint, totalMs: Date.now() - t };
    await sleep(400);
    await page.keyboard.press('f');
    await sleep(300);
  }

  // ── Q2 — what is rank 1 afraid of? ──────────────────────────────────────
  //
  // The leader's own `unless` cell reads `leads on the proved floor`, which is
  // a statement about the comparison and not about the risk. What the leader
  // is BETTING ON is on the row — `citedUnits`, the vacuity cause, the loud
  // count — and none of it has ever been drawn for the row that is going to
  // happen.
  await record('Q2', 'what is rank 1 afraid of?', [
    { sel: '.lens-threats', re: 'open on|cliff|nothing' },
    { sel: '.lens-row-lead .lens-unless', re: 'resolve against us|refuted|dominated' },
    { sel: '.lens-unsure', re: 'open on' },
  ]);

  // ── Q3 — which enemy reply hurts most? ──────────────────────────────────
  await record('Q3', 'which enemy reply hurts most?', [
    { sel: '.lens-threats-list', re: '.' },
    { sel: '.lens-threats', re: 'at stake|loud|replies' },
  ]);

  // ── Q4 — how sure is the bot? ───────────────────────────────────────────
  //
  // `⌈w⌉` and the band are the width; the question is whether the ORDER is
  // proved, which is the margin read against the width. Nothing on the shipped
  // rail puts those two numbers in one sentence.
  await record('Q4', 'how sure is the bot?', [
    { sel: '.lens-unsure', re: 'margin|width|proved|cliff|advisory' },
    { sel: '.lens-row-lead .lens-width', re: '⌈' },
  ]);

  // ── Q5 — what changes if I pin this unit? ───────────────────────────────
  //
  // The list source line already answers the FIRST half (this list is the rows
  // a lock here would stage). The second half — what it costs against the
  // unconditional leader — is the pin count on the chip, and the two are never
  // in one place.
  {
    const before = await page.evaluate(
      () => document.querySelector('.lens-list-source')?.innerText || null
    );
    out.notes.listSource = before;
    await record('Q5', 'what changes if I pin this unit?', [
      { sel: '.lens-list-source', re: 'lock here would stage' },
      { sel: '[data-lens-action="lock"]', re: 'pins' },
    ]);
  }

  // The five explanation surfaces, photographed where they exist.
  for (const [sel, name] of [
    ['.lens-contrast', `${LABEL}-contrast`],
    ['.lens-threats', `${LABEL}-threats`],
    ['.lens-unsure', `${LABEL}-unsure`],
    ['.lens-line', `${LABEL}-line`],
  ]) {
    if (await page.$(sel)) await shot(page, name, sel, sel);
  }

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
