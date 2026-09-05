/**
 * THE USABILITY EVALUATION DRIVER — the operator interface, measured.
 *
 * `lens-walkthrough.js` photographs every state and asserts that the
 * determination surface works. This asks a different question, and it is the
 * one `docs/design/ux/02-IA-AND-CONTROLS.md` cannot answer about itself: does
 * a human, on a half-second clock, actually GET the thing the IA claims to
 * have put in front of them.
 *
 *   npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts --port=5077 &
 *   node scripts/ux-eval.js --port=5077 --out=docs/design/ux/eval
 *
 * Four suites, each writing its own JSON beside the pictures:
 *
 *  · `heuristic` — every state the walkthrough reaches, plus the three it
 *    does not (the live clock, its urgent ramp, the fatal-consent dialog),
 *    with the measurements a screenshot cannot carry: element boxes, computed
 *    type sizes, what is clipped, what moved between two frames.
 *  · `scenarios` — four operator tasks, TIMED. The clock starts at the
 *    operator's first input and stops when the pixel that answers them is on
 *    screen; the count of presses and clicks rides along, because a fast
 *    answer that costs six keys is not a fast answer.
 *  · `a11y` — every text/ink pair's contrast ratio against its real computed
 *    background, protanopia and deuteranopia renderings of the board and the
 *    cards, the reduced-motion contract, a keyboard-only walk of every
 *    control, and whether the focus ring is actually visible where it lands.
 *  · `density` — 1280×720 and 1920×1080, at all three densities, with the
 *    overflow and clipping each one produces.
 *
 * Nothing here mutates the page's own sources: it is a reader with a
 * stopwatch. What it finds goes in `docs/design/ux/05-EVALUATION.md`.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = parseInt(arg('port', '5077'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/eval'));
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = arg('game', 'lens-walk');
const SUITE = arg('suite', 'all');
const WAIT = parseInt(arg('wait', '2000'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = () => fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json());

const out = { suites: {}, shots: [] };

/** A screenshot, with its size recorded — the budget is 300 KB apiece and a
 *  picture nobody can commit is a picture nobody looks at. */
async function shot(page, name, note, selector) {
  const file = path.join(OUT, `${name}.png`);
  const target = selector ? await page.$(selector) : page;
  if (!target) {
    out.shots.push({ name, note, missing: selector });
    console.log(`  · ${name} — MISSING ${selector}`);
    return null;
  }
  await target.screenshot({ path: file });
  const bytes = fs.statSync(file).size;
  out.shots.push({ name, note, bytes });
  console.log(`  · ${name} (${(bytes / 1024).toFixed(0)} KB)${bytes > 300000 ? ' — OVER BUDGET' : ''}`);
  return bytes;
}

async function enter(page, gameId, name) {
  await page.goto(`${BASE}/game/${gameId}`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  if (!(await page.$('#loginGate.active'))) return name;
  // NAMES ARE UNIQUE PER GAME and this harness is re-entered many times over
  // one server, so the numbered fallbacks run out. A run-scoped suffix keeps
  // every suite's operator distinct without depending on how many runs came
  // before it; nothing downstream cares which name it got.
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

/**
 * THE TAKEOVER DIALOG, ANSWERED. A unit another operator has claimed raises
 * `#confirmDialog` on selection, and it is a modal that swallows every pointer
 * event on the page until it is answered — including the roster click that
 * raised it. It is one of the three dialogs `§3.4` keeps on purpose, and
 * answering it is what an operator taking a seat does; it is recorded here
 * (`out.takeovers`) rather than hidden, because how many of them a second
 * operator has to answer to pick up a team is itself a measurement.
 */
async function takeOver(page) {
  if (!(await page.$('#confirmDialog.active'))) return false;
  await page.click('#confirmTakeoverBtn');
  await sleep(700);
  out.takeovers = (out.takeovers || 0) + 1;
  return true;
}

async function focusUnit(page, index) {
  await takeOver(page);
  const active = await page.evaluate(() => {
    const el = document.querySelector('.snake-info-item.active-perspective');
    return el ? [...document.querySelectorAll('.snake-info-item.selectable')].indexOf(el) : -1;
  });
  if (active === index) {
    const rows = await page.$$('.snake-info-item.selectable');
    const other = index === 0 ? 1 : 0;
    if (rows[other]) {
      await rows[other].click({ force: true });
      await sleep(WAIT);
      await takeOver(page);
    }
  }
  const again = await page.$$('.snake-info-item.selectable');
  if (again[index]) {
    await again[index].click({ force: true });
    await sleep(WAIT);
    await takeOver(page);
  }
}

/** The candidate the inspection reserve actually answered — the one candidate
 *  with a ranked list behind it. Borrowed from the walkthrough, because a
 *  measurement taken on the fallback measures the fallback. */
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
  if (!lock || (unit && lock.unit !== unit)) return null;
  const selector = `.lens-candidates [data-lens-candidate="${lock.to}"]`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cell = await page.$(selector);
    if (cell) {
      try {
        await takeOver(page);
        await cell.click({ timeout: 4000, force: true });
        await sleep(WAIT);
        return lock;
      } catch (_e) {
        /* the rail re-rendered under the handle; re-query */
      }
    }
    await sleep(300);
  }
  return lock;
}

// ═══════════════════════════════════════════════════ contrast, in the page

/**
 * WCAG 2.1 contrast, computed against the background that is actually
 * PAINTED — the nearest ancestor with a non-transparent background-color,
 * composited — rather than against whatever the stylesheet says nearby. Every
 * text node in the rail sits on `#2a2a2a` inside `#1a1a1a` inside the page,
 * and reading the ratio off the wrong one of those three is how a rail passes
 * an audit it fails on screen.
 */
function contrastProbe() {
  const lum = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const parse = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  /** The composited background under an element: walk up, painting each
   *  translucent layer onto the one beneath it. */
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a === 1) break;
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const seen = [];
  const all = document.querySelectorAll('*');
  for (const el of all) {
    // Only elements with their OWN visible text: a wrapper inherits its
    // children's words and would be counted once per level of nesting.
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
      .map((n) => n.textContent.trim())
      .join(' ');
    if (!own) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const fgRaw = parse(cs.color);
    if (!fgRaw) continue;
    const bg = bgOf(el);
    // A parent's `opacity` fades the text onto the ground the same way a
    // translucent colour does — `.lens-aff-off` is opacity .45 and its ratio
    // on screen is not the one its `color` claims.
    let alpha = fgRaw.a;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const o = Number(getComputedStyle(n).opacity);
      if (Number.isFinite(o) && o < 1) alpha *= o;
    }
    const fg = over({ ...fgRaw, a: alpha }, bg);
    const L1 = lum(fg.r, fg.g, fg.b);
    const L2 = lum(bg.r, bg.g, bg.b);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    // WCAG "large text": 18.66 px bold, or 24 px.
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    seen.push({
      text: own.slice(0, 60),
      selector:
        el.tagName.toLowerCase() +
        (el.id ? '#' + el.id : '') +
        (el.className && typeof el.className === 'string'
          ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
          : ''),
      color: cs.color,
      px: Number(px.toFixed(1)),
      weight,
      ratio: Number(ratio.toFixed(2)),
      need,
      pass: ratio >= need,
    });
  }
  return seen;
}


/** One row per distinct (selector, colour, size) — the rail repeats a class
 *  forty times and forty identical failures is one finding. */
function foldContrast(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = `${r.selector}|${r.color}|${r.px}|${r.weight}`;
    const hit = by.get(key);
    if (hit) {
      hit.count += 1;
      if (r.ratio < hit.ratio) hit.ratio = r.ratio;
      continue;
    }
    by.set(key, { ...r, count: 1 });
  }
  return [...by.values()].sort((a, b) => a.ratio - b.ratio);
}

// ═════════════════════════════════════════════ colour-vision simulation

/**
 * Protanopia and deuteranopia as an SVG `feColorMatrix` over the whole
 * document. Brettel/Viénot-style linear approximations — the same matrices
 * the browser-extension simulators use. Good enough for the only question
 * being asked: does a mark that carries meaning survive losing the hue.
 */
const CVD = {
  protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
};

async function applyCVD(page, kind) {
  await page.evaluate(
    ([id, m]) => {
      const old = document.getElementById('cvd-sim');
      if (old) old.remove();
      if (!m) {
        document.documentElement.style.filter = '';
        return;
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'cvd-sim';
      svg.setAttribute('style', 'position:absolute;width:0;height:0');
      svg.innerHTML =
        `<filter id="${id}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="` +
        `${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0` +
        `"/></filter>`;
      document.body.appendChild(svg);
      document.documentElement.style.filter = `url(#${id})`;
    },
    [kind || 'none', kind ? CVD[kind] : null]
  );
  await sleep(400);
}

// ═══════════════════════════════════════════════════════════ the suites

/**
 * SUITE 1 — HEURISTIC EVALUATION.
 *
 * Every state, and for each one the measurements a picture cannot carry: the
 * boxes, the computed sizes, what is clipped and what moved. The three states
 * the walkthrough never reaches are driven here rather than waited for —
 * the live clock (the harness steps turns by hand, so `turnExpiryTime` is
 * never in the future), its urgent ramp, and the fatal-consent dialog.
 */
async function heuristic(context) {
  console.log('\n── heuristic ──');
  const page = await context.newPage();
  const found = [];
  await enter(page, GAME, 'Eval');
  await step();
  await sleep(WAIT);
  await page.keyboard.press('Escape');
  await sleep(400);

  await shot(page, 'h01-idle', 'live head, no unit focused — L1 alone');
  await shot(page, 'h01b-stage', 'the stage line and the strip, with nothing focused', '#lensStage');

  // ── the stage line's order, across a determination ──────────────────────
  //
  // §1.4 rule 1: nothing above L2 may MOVE. The line is read in one fixation
  // and the eye lands where it landed last turn, so the question is whether a
  // unit keeps its PLACE in the sentence when its state changes.
  await focusUnit(page, 0);
  const orderBefore = await page.evaluate(() =>
    [...document.querySelectorAll('#lensStage .lens-stage-move')].map((e) =>
      (e.textContent || '').trim().split(/\s/)[0]
    )
  );
  await selectAnsweredCandidate(page, 'red-A');
  await page.keyboard.press(' ');
  await sleep(1400);
  const orderAfter = await page.evaluate(() =>
    [...document.querySelectorAll('#lensStage .lens-stage-move')].map((e) =>
      (e.textContent || '').trim().split(/\s/)[0]
    )
  );
  // A pin only moves a unit from `members` to `boundedBy` when the NEXT
  // partition is computed, so the order has to be read across a turn: the
  // question is whether the unit an operator's eye is trained on keeps its
  // place in the sentence when its state changes.
  await step();
  await sleep(WAIT);
  const orderNextTurn = await page.evaluate(() =>
    [...document.querySelectorAll('#lensStage .lens-stage-move')].map((e) =>
      (e.textContent || '').trim().split(/\s/)[0]
    )
  );
  found.push({
    id: 'stage-order',
    before: orderBefore,
    afterPinSameTurn: orderAfter,
    afterPinNextTurn: orderNextTurn,
    stableWithinTurn: JSON.stringify(orderBefore) === JSON.stringify(orderAfter),
    stableAcrossTurn: JSON.stringify(orderBefore) === JSON.stringify(orderNextTurn),
  });
  await shot(page, 'h02-stage-after-pin', 'the stage line after one pin — the same units, in what order?', '#lensStage');

  // ── the decision, measured ───────────────────────────────────────────────
  await focusUnit(page, 0);
  await selectAnsweredCandidate(page, 'red-A');
  await sleep(600);
  await shot(page, 'h03-rail', 'the whole rail at CANDIDATE with a conditional answered', '.lens-rail');
  await shot(page, 'h03b-cards', 'L2 — rank 1 and the foil as cards', '.lens-movesets');
  await shot(page, 'h03c-controls', 'the control bar', '#lensControls');

  found.push({
    id: 'movesets-measured',
    ...(await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.lens-movesets .lens-table tr')];
      const cell = (tr, n) => tr.querySelector(`td:nth-child(${n})`);
      const clipped = (el) => (el ? el.scrollWidth - el.clientWidth : 0);
      return {
        rowCount: rows.length,
        rows: rows.map((tr) => ({
          cls: tr.className,
          rank: (cell(tr, 1)?.innerText || '').replace(/\s+/g, ' ').trim(),
          assignment: (cell(tr, 6)?.innerText || '').trim(),
          assignmentClippedPx: clipped(cell(tr, 6)),
          unless: (cell(tr, 5)?.innerText || '').trim(),
          unlessClippedPx: clipped(cell(tr, 5)),
          band: !!tr.querySelector('.lens-band-span'),
          bandWidthPct: tr.querySelector('.lens-band-span')?.style.width || null,
          delta: (cell(tr, 4)?.innerText || '').trim(),
          heightPx: Math.round(tr.getBoundingClientRect().height),
          fontPx: parseFloat(getComputedStyle(cell(tr, 6) || tr).fontSize),
        })),
        // Is the pin/lock affordance said once, or twice, in two grammars?
        lockLine: document.querySelector('.lens-lock')?.innerText || null,
        lockChip:
          [...document.querySelectorAll('#lensControls .lens-aff')]
            .map((e) => e.innerText.replace(/\s+/g, ' ').trim())
            .find((t) => /^⦿ ?lock/.test(t)) || null,
        // Where the legend sits relative to the two cards it glosses.
        legendTop: document.querySelector('.lens-legend')?.getBoundingClientRect().top ?? null,
        leadTop: document.querySelector('.lens-row-lead')?.getBoundingClientRect().top ?? null,
      };
    })),
  });

  // DOES THE CHIP PROMISE AN ACTION IT CANNOT TAKE? The chip is drawn
  // `primary` — violet border, white ink, the loudest thing in the bar —
  // whenever a lock affordance exists at all, including when the count it
  // prints beside itself is `pins 0`. Read it in both states.
  const chipState = () =>
    page.evaluate(() => {
      const chip = [...document.querySelectorAll('#lensControls .lens-aff')].find((e) =>
        /^⦿/.test(e.innerText)
      );
      return chip
        ? {
            text: chip.innerText.replace(/\s+/g, ' ').trim(),
            cls: chip.className,
            opacity: getComputedStyle(chip).opacity,
            borderColor: getComputedStyle(chip).borderTopColor,
          }
        : null;
    });
  const chipWithRows = await chipState();
  // Back to the incumbent candidate, where nothing is retained and the lock
  // has nothing to pin.
  await page.evaluate(() => {
    const first = document.querySelector('.lens-candidates [data-lens-candidate]');
    if (first) first.click();
  });
  await sleep(900);
  const chipNoRows = await chipState();
  found.push({ id: 'lock-chip-states', withRows: chipWithRows, noRows: chipNoRows });
  await shot(page, 'h03d-lock-zero', 'the lock chip where it would pin nothing', '#lensControls');
  await selectAnsweredCandidate(page, 'red-A');
  await sleep(500);

  // ── DOES `Space` DO WHAT THE BAR SAYS IT WILL? ──────────────────────────
  //
  // `stageSelectedMove` returns on four guards and says nothing on any of
  // them, and one of those guards is `userSelectedMove` — the variable the
  // rail's candidate click is supposed to set. §3.3 says the rail's click and
  // the board's were unified for exactly this reason ("an operator who picked
  // a candidate in the rail and pressed `Space` staged nothing"). This reads
  // the gate at each of the two ways a cursor gets onto a candidate: focus
  // auto-advance (Law D) and a click on the rail's own candidate row.
  const gate = () =>
    page.evaluate(() => ({
      selectedSnakeId: typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId,
      userSelectedMove: typeof userSelectedMove === 'undefined' ? null : userSelectedMove,
      cursorUnit: typeof lensCursor === 'undefined' ? null : lensCursor && lensCursor.unit,
      cursorCandidate: typeof lensCursor === 'undefined' ? null : lensCursor && lensCursor.candidate,
      undoDepth: typeof lensUndoStack === 'undefined' ? null : lensUndoStack.length,
      lockChip:
        [...document.querySelectorAll('#lensControls .lens-aff')]
          .map((e) => e.innerText.replace(/\s+/g, ' ').trim())
          .find((t) => /^⦿/.test(t)) || null,
    }));
  await page.keyboard.press('Escape');
  await sleep(300);
  await focusUnit(page, 0);
  await sleep(700);
  const afterAutoAdvance = await gate();
  await page.keyboard.press(' ');
  await sleep(1200);
  const pressedOnAutoAdvance = await gate();
  // A DIFFERENT candidate from the one focus already advanced to: clicking the
  // row the cursor is already on proves nothing either way.
  const otherCell = await page.evaluate((at) => {
    const cells = [...document.querySelectorAll('.lens-candidates [data-lens-candidate]')];
    const pick = cells.find((e) => Number(e.getAttribute('data-lens-candidate')) !== at);
    return pick ? pick.getAttribute('data-lens-candidate') : null;
  }, afterAutoAdvance.cursorCandidate);
  if (otherCell) {
    const railCell = await page.$(`.lens-candidates [data-lens-candidate="${otherCell}"]`);
    if (railCell) {
      await railCell.click({ force: true });
      await sleep(1400);
    }
  }
  const afterRailClick = await gate();
  await page.keyboard.press(' ');
  await sleep(1200);
  const pressedAfterRailClick = await gate();
  found.push({
    id: 'space-precondition',
    afterAutoAdvance,
    pressedOnAutoAdvance,
    railClickTarget: otherCell,
    afterRailClick,
    pressedAfterRailClick,
    silentOnAutoAdvance:
      afterAutoAdvance.cursorCandidate != null &&
      pressedOnAutoAdvance.undoDepth === afterAutoAdvance.undoDepth,
    silentAfterRailClick:
      afterRailClick.cursorCandidate != null &&
      pressedAfterRailClick.undoDepth === afterRailClick.undoDepth,
  });
  await shot(page, 'h03e-after-space', 'the bar after a `Space` that did nothing', '#lensControls');

  // ── THE SAME QUESTION, WITH A `moveState` TO ANSWER IT ───────────────────
  //
  // The two reads above are silent for a reason the walkthrough server cannot
  // help: it never sends `controlled-snake-turn-data`, so
  // `setupMoveStateForSnake` has no `moveEvaluations` and `moveState.moves`
  // is `{}` for the whole run. `Space` cannot stage anything here whatever
  // the rail does, which means the harness has NEVER exercised staging — and
  // the rail's candidate click has to be tested against a `moveState` that
  // exists.
  //
  // So one is built, in exactly the shape `processMoveEvaluations` produces
  // for a SNAKE — `move` a Direction string, `position`/`positionKey` the
  // destination cell — over the rail's own candidate cells. Then the rail row
  // is clicked and `userSelectedMove` is read. That is the whole defect: `to`
  // is a full-board index and `moves[k].move` is `'up'`, so the lookup that
  // decides between `selectMove` (which arms `Space`) and `lensSelectCandidate`
  // (which does not) compared `'up'` against `'109'` and never hit.
  const synthetic = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.lens-candidates [data-lens-candidate]')].map((e) =>
      parseInt(e.getAttribute('data-lens-candidate'), 10)
    );
    const board = currentGameState && currentGameState.board;
    if (!board || cells.length === 0) return { built: false };
    const dirs = ['up', 'down', 'left', 'right'];
    const moves = {};
    const byPos = new Map();
    cells.forEach((to, i) => {
      const c = BoardRenderer.moveDestinationCell(to, board);
      if (!c) return;
      const dir = dirs[i % 4];
      moves[dir] = {
        key: dir,
        move: dir,
        direction: dir,
        kind: 'move',
        label: dir.toUpperCase(),
        position: c,
        positionKey: `${c.x},${c.y}`,
        isSafe: true,
        isEvaluated: true,
        displayScore: 0,
      };
      byPos.set(moves[dir].positionKey, moves[dir]);
    });
    const head =
      (board.snakes.find((s) => s.id === selectedSnakeId) || {}).head || { x: 0, y: 0 };
    moveState = {
      head,
      moves,
      selectedMove: null,
      candidatesByPosition: byPos,
      holdCandidate: null,
      selectedSnake: selectedSnakeId,
    };
    userSelectedMove = null;
    return { built: true, cells, keys: Object.keys(moves) };
  });
  let syntheticClick = { skipped: true };
  if (synthetic.built) {
    const target = synthetic.cells[synthetic.cells.length - 1];
    const cell = await page.$(`.lens-candidates [data-lens-candidate="${target}"]`);
    if (cell) {
      await cell.click({ force: true });
      await sleep(900);
    }
    syntheticClick = {
      skipped: false,
      target,
      ...(await page.evaluate(() => ({
        userSelectedMove: typeof userSelectedMove === 'undefined' ? null : userSelectedMove,
        selectedMove: moveState && moveState.selectedMove,
      }))),
    };
  }
  found.push({
    id: 'rail-click-arms-space',
    synthetic,
    afterClick: syntheticClick,
    armsSpace: !syntheticClick.skipped && syntheticClick.userSelectedMove !== null,
  });


  // ── L0: the clock, which the harness never runs ─────────────────────────
  //
  // `/dev/step` plays a turn on demand, so `turnExpiryTime` is never a future
  // instant and `startTurnTimer` paints the idle bar forever. The clock is the
  // whole of L0 and going unphotographed is not the same as working, so it is
  // driven here through the page's own updater at three points on the ramp.
  for (const [name, remaining, budget, note] of [
    ['h04-clock-full', 1400, 1500, 'L0 at arrival — the bar full'],
    ['h05-clock-half', 700, 1500, 'L0 halfway through the turn'],
    ['h06-clock-urgent', 380, 1500, 'L0 under 500 ms — the urgent ramp'],
  ]) {
    await page.evaluate(([r, b]) => updateTurnClock(r, b), [remaining, budget]);
    await sleep(250);
    await shot(page, name, note, '#turnClock');
  }
  found.push({
    id: 'clock-urgency-channel',
    ...(await page.evaluate(() => {
      const read = (r, b) => {
        updateTurnClock(r, b);
        const c = document.getElementById('turnClock');
        const f = document.getElementById('turnClockFill');
        return {
          cls: c.className,
          fill: getComputedStyle(f).backgroundImage,
          width: f.style.width,
          height: getComputedStyle(c).height,
          border: getComputedStyle(c).borderTopColor,
        };
      };
      const normal = read(700, 1500);
      const urgent = read(380, 1500);
      return {
        normal,
        urgent,
        // The only thing that distinguishes "you have 380 ms" from "you have
        // 700 ms", other than the length that is already there.
        differsOnlyInHue:
          normal.height === urgent.height && normal.border === urgent.border,
      };
    })),
  });
  // The mark: absent while nobody has measured a flight time, present when
  // `ux-latency` sets one. Both are states an operator sees.
  await page.evaluate(() => {
    window.__lensLastSafePressMs = 260;
    updateTurnClock(700, 1500);
  });
  await sleep(200);
  await shot(page, 'h07-clock-safe-mark', 'L0 with a last-safe-press notch set', '#turnClock');
  await page.evaluate(() => {
    delete window.__lensLastSafePressMs;
    updateTurnClock(null, null);
  });

  // ── the fatal-consent dialog, the one irreversible gesture ──────────────
  await page.evaluate(() => {
    const id = typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId;
    showFatalMoveDialog(id, 'up', typeof currentGameState !== 'undefined' ? currentGameState.turn : 1);
  });
  await sleep(500);
  await shot(page, 'h08-fatal-dialog', 'the certain-death consent — a dialog kept on purpose (§3.4)');
  found.push({
    id: 'fatal-dialog',
    ...(await page.evaluate(() => {
      const el = document.getElementById('fatalMoveDialog');
      const box = el.getBoundingClientRect();
      const canvas = document.getElementById('gameCanvas').getBoundingClientRect();
      const overlaps = !(
        box.right < canvas.left ||
        box.left > canvas.right ||
        box.bottom < canvas.top ||
        box.top > canvas.bottom
      );
      return {
        text: el.innerText.replace(/\s+/g, ' ').trim(),
        role: el.getAttribute('role'),
        ariaModal: el.getAttribute('aria-modal'),
        // Does opening it move the keyboard into the dialog, or leave focus
        // wherever it was on a surface the dialog is covering?
        focusAfterOpen: document.activeElement
          ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '')
          : null,
        coversBoard: overlaps,
      };
    })),
  });
  await page.evaluate(() => hideFatalMoveDialog());
  await sleep(300);

  // ── the modal reference, and what it costs ──────────────────────────────
  await page.keyboard.press('Control+/');
  await sleep(600);
  await shot(
    page,
    'h09-shortcuts-modal',
    'Ctrl+/ — the full reference, and the board it costs',
    '#shortcutsOverlay > *'
  );
  found.push({
    id: 'shortcuts-modal',
    ...(await page.evaluate(() => {
      const el = document.querySelector('#shortcutsOverlay.open');
      if (!el) return { present: false };
      const b = el.getBoundingClientRect();
      const c = document.getElementById('gameCanvas').getBoundingClientRect();
      return {
        present: true,
        coversBoardPct: Number(
          (
            (Math.max(0, Math.min(b.right, c.right) - Math.max(b.left, c.left)) *
              Math.max(0, Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top))) /
            (c.width * c.height) *
            100
          ).toFixed(1)
        ),
        role: el.getAttribute('role'),
      };
    })),
  });
  await page.keyboard.press('Escape');
  await sleep(300);

  // ── the lane and the provenance: L4, and how loud it is ─────────────────
  await shot(page, 'h10-lane', 'the intra-turn lane at the head', '#lensLane');
  await shot(page, 'h11-keys', 'the cheat strip, the scheme picker and the density picker', '#lensKeys');

  // ── the rail's total height against the viewport it lives in ────────────
  found.push({
    id: 'rail-extent',
    ...(await page.evaluate(() => {
      const panel = document.getElementById('selectedSnakePanel');
      const rail = document.getElementById('lensRail');
      return {
        viewportH: window.innerHeight,
        panelH: Math.round(panel.getBoundingClientRect().height),
        panelScrollH: panel.scrollHeight,
        railScrollH: rail.scrollHeight,
        scrolls: panel.scrollHeight > panel.clientHeight + 2,
        // What is BELOW the fold when the panel is at the top: the control bar
        // is the half the drill asserts on, and it lives at the bottom.
        controlsBelowFold:
          document.getElementById('lensControls').getBoundingClientRect().bottom >
          panel.getBoundingClientRect().bottom,
      };
    })),
  });

  out.suites.heuristic = found;
  await page.close();
}

/**
 * SUITE 2 — THE TIMED SCENARIOS.
 *
 * Four tasks, each with two numbers: the time-to-first-relevant-paint (the
 * fixation proxy — when the pixel that answers the operator is first on
 * screen, measured from the input that asked for it) and the interaction
 * count. A `MutationObserver` armed before the input is what makes the first
 * number a measurement rather than a `sleep` plus a guess.
 */
async function scenarios(context) {
  console.log('\n── scenarios ──');
  const page = await context.newPage();
  await enter(page, GAME, 'Timer');
  await step();
  await sleep(WAIT);
  await page.keyboard.press('Escape');
  await sleep(400);

  /**
   * Arm a watcher on `selector` and stop the clock at the first frame after
   * it CHANGES — and, where a needle is given, first matches it. Measuring
   * "does it match now" is worthless: the strip already said `3 units` before
   * the turn arrived, and a stopwatch that reads 0.2 ms is a stopwatch that
   * never started. The baseline is taken at arm time and the hit requires the
   * text to differ from it.
   */
  const arm = (selector, needle) =>
    page.evaluate(
      ([sel, re]) => {
        const el0 = document.querySelector(sel);
        window.__evalMark = {
          t0: performance.now(),
          t1: null,
          base: el0 ? el0.innerText : null,
          sel,
          re,
        };
        const hit = () => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const text = el.innerText || '';
          if (text === window.__evalMark.base) return false;
          return re ? new RegExp(re).test(text) : true;
        };
        const obs = new MutationObserver(() => {
          if (window.__evalMark.t1 === null && hit()) {
            // The record fires before paint; the frame after it is the first
            // moment the operator's retina could have had it.
            requestAnimationFrame(() => {
              if (window.__evalMark.t1 === null) window.__evalMark.t1 = performance.now();
            });
          }
        });
        obs.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
        });
        window.__evalObs = obs;
      },
      [selector, needle || null]
    );
  /** Poll for up to `budget` ms, then give up and say so — a null here is a
   *  finding (the interface never answered), not a broken measurement. */
  const read = async (budget = 4000) => {
    const until = Date.now() + budget;
    for (;;) {
      const v = await page.evaluate(() => {
        const m = window.__evalMark;
        return m && m.t1 !== null ? Number((m.t1 - m.t0).toFixed(1)) : null;
      });
      if (v !== null || Date.now() > until) {
        await page.evaluate(() => {
          if (window.__evalObs) window.__evalObs.disconnect();
        });
        return v;
      }
      await sleep(50);
    }
  };

  /** Play turns until the answered candidate carries a ranked list with a
   *  runner-up on it. The inspection reserve answers ONE conditional per
   *  decision and some of its answers are one row long; a contrastive
   *  scenario measured on a list with no rank 2 measures nothing. */
  const withFoil = async (tries = 6) => {
    for (let i = 0; i < tries; i++) {
      // A drill starts from a clean slate: an armed gesture left over from an
      // earlier step is cancelled before anything is measured, exactly as
      // `lens-walkthrough.js`'s own operator drill does.
      await page.keyboard.press('Escape');
      await sleep(300);
      await focusUnit(page, 0);
      await selectAnsweredCandidate(page, 'red-A');
      await sleep(500);
      const rows = await page.evaluate(
        () => document.querySelectorAll('.lens-movesets .lens-table tr[data-lens-moveset]').length
      );
      if (rows > 1) return rows;
      await step();
      await sleep(WAIT);
    }
    return 0;
  };

  const results = [];

  // ── S1 — a unit with no plan, seen and pinned ───────────────────────────
  //
  // The task as posed is "one turn from a fatal cell". Fatality is a SERVER
  // verdict here — the page learns it only from `fatal-move-confirmation-
  // needed`, in response to a stage it has already sent — so the state an
  // operator can actually be alerted to before they act is the strip's own
  // alarm channel: `◦ N no plan`, the segment the IA built for exactly this
  // (`§2.2`, research #6, the idle-worker alert). The fatal dialog is timed
  // separately below, as the second half of the same task: what it costs once
  // the server does say so.
  {
    await page.keyboard.press('Escape');
    await sleep(300);
    await arm('#lensStage', 'unit');
    await step();
    const paint = await read();
    await sleep(600);
    const strip = await page.evaluate(() => ({
      stage: document.querySelector('#lensStage .lens-stage-line')?.innerText || null,
      biz: [...document.querySelectorAll('#lensStage .lens-biz span')].map((e) => e.innerText),
      alarm: !!document.querySelector('#lensStage .lens-biz-open'),
    }));
    // Now the intervention: focus the flagged unit and pin a safe move.
    let keys = 0;
    let clicks = 0;
    const t0 = Date.now();
    // Two clicks: the roster row that focuses the unit, and the candidate the
    // reserve answered — the only candidate with a ranked list behind it, and
    // therefore the only one `Space` can pin a chosen row of.
    const rows = await withFoil();
    clicks += 2;
    // THE PRECONDITION `Space` SILENTLY DEPENDS ON. `stageSelectedMove`
    // returns with no message on four guards, and `userSelectedMove` is the
    // one a rail click is supposed to set (§3.3 says the rail's candidate
    // click and the board's were unified for exactly this). Read it either
    // side of the press, so a press that does nothing is a measurement of
    // WHY rather than a shrug.
    const gate = await page.evaluate(() => ({
      selectedSnakeId: typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId,
      userSelectedMove: typeof userSelectedMove === 'undefined' ? null : userSelectedMove,
      moveSubmitted: typeof moveSubmitted === 'undefined' ? null : moveSubmitted,
      cursorUnit: typeof lensCursor === 'undefined' ? null : lensCursor && lensCursor.unit,
      cursorCandidate: typeof lensCursor === 'undefined' ? null : lensCursor && lensCursor.candidate,
    }));
    await arm('#lensControls', 'undoes');
    await page.keyboard.press(' ');
    keys += 1;
    const pinPaint = await read();
    const ms = Date.now() - t0;
    const gateAfter = await page.evaluate(() => ({
      userSelectedMove: typeof userSelectedMove === 'undefined' ? null : userSelectedMove,
      undoDepth: typeof lensUndoStack === 'undefined' ? null : lensUndoStack.length,
      notice: document.querySelector('.lens-undo-note, .banner-notice')?.innerText || null,
    }));
    const pinned = await page.evaluate(
      () => document.querySelector('#lensControls')?.innerText.replace(/\s+/g, ' ').trim() || null
    );
    results.push({
      id: 'S1',
      task: 'a unit has no plan for this turn — seen, then pinned to a chosen move',
      firstRelevantPaintMs: paint,
      note: 'from board-update to the L1 strip carrying the count',
      alarmDrawn: strip.alarm,
      strip: strip.biz,
      stage: strip.stage,
      interventionMs: ms,
      pinAckPaintMs: pinPaint,
      keystrokes: keys,
      clicks,
      rowsInList: rows,
      gateBeforePress: gate,
      gateAfterPress: gateAfter,
      controlsAfter: pinned,
    });
    await shot(page, 's1-pinned', 'S1 — the unit pinned, and what the bar says about undoing it', '#selectedSnakePanel');
    // And the second half: the server's own fatal verdict, and its cost.
    const fatalT = await page.evaluate(() => {
      const t0 = performance.now();
      showFatalMoveDialog(
        typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId,
        'up',
        typeof currentGameState !== 'undefined' ? currentGameState.turn : 1
      );
      return performance.now() - t0;
    });
    await sleep(400);
    results.push({
      id: 'S1b',
      task: 'the server refuses a certain-death move — the consent dialog',
      firstRelevantPaintMs: Number(fatalT.toFixed(1)),
      keystrokes: 1,
      clicks: 0,
      note: 'Enter confirms, Escape cancels — a dialog kept on purpose for the irreversible',
    });
    await page.evaluate(() => hideFatalMoveDialog());
    await sleep(300);
  }

  // ── S2 — why do the top two candidates differ? ──────────────────────────
  //
  // The contrastive pair is the object the research says actually moves a
  // human's decision. It is now drawn without being asked for, so the paint
  // cost is zero — and that is not the whole question. The question is how
  // long it takes to SEE the difference, which on two three-token assignment
  // strings is a character-by-character comparison the interface either helps
  // with or does not.
  {
    const rowsSeen = await withFoil();
    const pair = await page.evaluate(() => {
      const cellOf = (tr) => tr.querySelector('td:nth-child(6)');
      const lead = document.querySelector('.lens-row-lead');
      const foil = document.querySelector('.lens-row-foil');
      const toks = (tr) =>
        tr ? [...tr.querySelectorAll('td:nth-child(6) .lens-move')].map((e) => e.innerText.trim()) : [];
      const a = toks(lead);
      const b = toks(foil);
      const differing = a.length === b.length ? a.map((t, i) => t !== b[i]) : null;
      return {
        lead: a,
        foil: b,
        leadDelta: lead?.querySelector('td:nth-child(4)')?.innerText.trim() ?? null,
        foilDelta: foil?.querySelector('td:nth-child(4)')?.innerText.trim() ?? null,
        leadUnless: lead ? (cellOf(lead) && lead.querySelector('td:nth-child(5)').innerText.trim()) : null,
        foilUnless: foil ? foil.querySelector('td:nth-child(5)').innerText.trim() : null,
        differing,
        differingCount: differing ? differing.filter(Boolean).length : null,
        // Is the differing token marked in any way at all — a class, a
        // colour, a glyph — or does the operator diff the strings by eye?
        differingMarked: differing
          ? [...(foil ? foil.querySelectorAll('td:nth-child(6) .lens-move') : [])].some(
              (e, i) => differing[i] && e.className !== 'lens-move'
            )
          : null,
        foilLine: document.querySelector('.lens-foil')?.innerText.trim() ?? null,
      };
    });
    // The one gesture that puts the difference on the board, where it IS a
    // difference display: `F`.
    await arm('#gameCanvas');
    const t0 = Date.now();
    await page.keyboard.press('f');
    await sleep(700);
    const ms = Date.now() - t0;
    await shot(page, 's2-foil-latched', 'S2 — the foil on the board, where the difference is spatial', '#gameCanvas');
    await shot(page, 's2-cards', 'S2 — the two cards the operator has to diff by eye', '.lens-movesets');
    results.push({
      id: 'S2',
      task: 'the top two candidates differ only in one unit — how fast can the operator tell why',
      firstRelevantPaintMs: 0,
      note: 'the foil is drawn at full size without being asked for — the card costs no keypress (was `F` before the IA work)',
      boardLatchMs: ms,
      rowsInList: rowsSeen,
      keystrokes: 0,
      keystrokesToBoard: 1,
      clicks: 0,
      ...pair,
    });
    await page.keyboard.press('f');
    await sleep(400);
  }

  // ── S3 — undo a lock after a widen ──────────────────────────────────────
  {
    await withFoil();
    let keys = 0;
    // The lock. A multi-unit lock ARMS, so it is two presses by design.
    await arm('#lensControls', 'press again|pins');
    const tLock = Date.now();
    await page.keyboard.press('Shift+ ');
    keys += 1;
    const armPaint = await read();
    await sleep(500);
    const armed = await page.evaluate(
      () => document.querySelector('#lensControls')?.innerText.replace(/\s+/g, ' ').trim() || ''
    );
    if (/press again/i.test(armed)) {
      await page.keyboard.press('Shift+ ');
      keys += 1;
    }
    await sleep(1200);
    const lockMs = Date.now() - tLock;
    await shot(page, 's3-locked', 'S3 — the lock committed', '#lensControls');
    // PHASE A — the undo INSIDE the turn the lock was taken in. This is the
    // reversal §3.4 promises and the one an operator on a 500 ms clock is
    // actually reaching for.
    await arm('#lensControls', 'nothing yet');
    const tSame = Date.now();
    await page.keyboard.press('u');
    keys += 1;
    const sameUndoPaint = await read();
    await sleep(700);
    const sameTurnUndo = await page.evaluate(() => ({
      controls: document.querySelector('#lensControls')?.innerText.replace(/\s+/g, ' ').trim() || null,
      notice: document.querySelector('.lens-undo-note')?.innerText.trim() || null,
    }));
    const sameTurnMs = Date.now() - tSame;
    await shot(page, 's3-undo-same-turn', 'S3a — the lock undone inside its own turn', '#lensControls');

    // PHASE B — lock again, let a PEER WIDEN arrive (which in this harness
    // only happens during a decision, i.e. across a turn boundary), and then
    // reach for the same undo.
    await withFoil();
    await page.keyboard.press('Shift+ ');
    await sleep(600);
    if (/press again/i.test(await page.evaluate(() => document.getElementById('lensControls').innerText))) {
      await page.keyboard.press('Shift+ ');
    }
    await sleep(1200);
    const stackBeforeWiden = await page.evaluate(
      () => document.querySelector('#lensControls')?.innerText.replace(/\s+/g, ' ').trim() || null
    );
    // ONE boundary, read before any other: the flag says "the stack was
    // cleared by THIS turn", and a second turn over an already-empty stack
    // has nothing new to say, so a measurement that steps three times to
    // catch a widen measures the second answer and not the first.
    let banner = null;
    await step();
    for (let i = 0; i < 40 && !banner; i++) {
      banner = await page.evaluate(() => document.querySelector('.lens-banner')?.innerText || null);
      if (!banner) await sleep(100);
    }
    const stackAfterOneTurn = await page.evaluate(
      () => document.querySelector('#lensControls')?.innerText.replace(/\s+/g, ' ').trim() || null
    );
    for (let turn = 0; turn < 2 && !banner; turn++) {
      await step();
      for (let i = 0; i < 40 && !banner; i++) {
        banner = await page.evaluate(() => document.querySelector('.lens-banner')?.innerText || null);
        if (!banner) await sleep(100);
      }
    }
    const stackAfterWiden = await page.evaluate(
      () => document.querySelector('#lensControls')?.innerText.replace(/\s+/g, ' ').trim() || null
    );
    await shot(page, 's3-widen', 'S3 — a peer widened the cluster while the lock stood', '.lens-rail');
    // And now the undo, across that widen.
    await focusUnit(page, 0);
    await arm('#lensControls', 'nothing yet|undo');
    const tUndo = Date.now();
    await page.keyboard.press('u');
    keys += 1;
    const undoPaint = await read();
    await sleep(900);
    const undoMs = Date.now() - tUndo;
    const after = await page.evaluate(() => ({
      controls: document.querySelector('#lensControls')?.innerText.replace(/\s+/g, ' ').trim() || null,
      notice: document.querySelector('.banner-notice, .lens-banner')?.innerText.trim() || null,
      stage: document.querySelector('#lensStage .lens-stage-line')?.innerText.trim() || null,
    }));
    await shot(page, 's3-undone', 'S3 — the lock undone after the widen', '#selectedSnakePanel');
    results.push({
      id: 'S3',
      task: 'undo a lock, after a peer has widened the cluster underneath it',
      lockMs,
      lockArmPaintMs: armPaint,
      sameTurnUndoMs: sameTurnMs,
      sameTurnUndoPaintMs: sameUndoPaint,
      sameTurnUndo,
      stackBeforeWiden,
      stackAfterOneTurn,
      stackAfterWiden,
      widenBanner: banner,
      undoMs,
      undoAckPaintMs: undoPaint,
      keystrokes: keys,
      clicks: 2,
      after,
    });
  }

  // ── S4 — switch key scheme mid-turn ─────────────────────────────────────
  {
    await focusUnit(page, 0);
    await sleep(400);
    const before = await page.evaluate(() => document.getElementById('lensKeys').innerText.replace(/\s+/g, ' '));
    await arm('#lensKeys', '\\bj\\b');
    const t0 = Date.now();
    await page.click('[data-lens-scheme="vim"]');
    const paint = await read();
    await sleep(400);
    const ms = Date.now() - t0;
    const after = await page.evaluate(() => document.getElementById('lensKeys').innerText.replace(/\s+/g, ' '));
    // And it must DRIVE: a relabelled strip over a keymap the handler never
    // consults is the failure a picture cannot show.
    const rowOf = () =>
      page.evaluate(() => document.querySelector('.lens-movesets .lens-row-cursor')?.getAttribute('data-lens-moveset') ?? null);
    await selectAnsweredCandidate(page, 'red-A');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('k');
      await sleep(100);
    }
    const rowBefore = await rowOf();
    const tKey = Date.now();
    await page.keyboard.press('j');
    await sleep(600);
    const rowAfter = await rowOf();
    await shot(page, 's4-vim', 'S4 — the strip after the scheme switch', '#lensKeys');
    // Is the switch reachable from the keyboard at all, mid-turn?
    const reachable = await page.evaluate(() => {
      const btn = document.querySelector('[data-lens-scheme="vim"]');
      return {
        tabbable: btn ? btn.tabIndex >= 0 || btn.tagName === 'BUTTON' : false,
        hasKeyBinding: /scheme/i.test(document.getElementById('lensKeys')?.innerText || ''),
      };
    });
    results.push({
      id: 'S4',
      task: 'switch key scheme mid-turn',
      firstRelevantPaintMs: paint,
      totalMs: ms,
      keystrokes: 0,
      clicks: 1,
      drives: rowBefore !== rowAfter,
      driveMs: Date.now() - tKey,
      reachable,
      stripBefore: before.slice(0, 120),
      stripAfter: after.slice(0, 120),
    });
    await page.click('[data-lens-scheme="bracket"]');
    await sleep(400);
  }

  out.suites.scenarios = results;
  await page.close();
}

/**
 * SUITE 3 — ACCESSIBILITY.
 */
async function a11y(browser) {
  console.log('\n── a11y ──');
  const found = {};

  // ── contrast, over every state that draws different ink ─────────────────
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();
  await enter(page, GAME, 'A11y');
  await step();
  await sleep(WAIT);
  await page.keyboard.press('Escape');
  await sleep(400);
  const rows = [];
  rows.push(...(await page.evaluate(contrastProbe)));
  await focusUnit(page, 0);
  await selectAnsweredCandidate(page, 'red-A');
  await sleep(600);
  rows.push(...(await page.evaluate(contrastProbe)));
  await page.keyboard.press('b');
  await sleep(1000);
  rows.push(...(await page.evaluate(contrastProbe)));
  await page.keyboard.press('Shift+ ');
  await sleep(700);
  rows.push(...(await page.evaluate(contrastProbe)));
  await page.keyboard.press('Escape');
  await sleep(400);
  const folded = foldContrast(rows);
  found.contrast = {
    pairs: folded.length,
    failing: folded.filter((r) => !r.pass).length,
    worst: folded.slice(0, 30),
  };
  console.log(`  contrast: ${folded.filter((r) => !r.pass).length} of ${folded.length} distinct pairs below AA`);

  // ── colour vision ───────────────────────────────────────────────────────
  await focusUnit(page, 0);
  await selectAnsweredCandidate(page, 'red-A');
  await sleep(600);
  await shot(page, 'a01-normal-board', 'the board, normal vision', '#gameCanvas');
  await shot(page, 'a02-normal-cards', 'the cards, normal vision', '.lens-movesets');
  for (const kind of ['protanopia', 'deuteranopia']) {
    await applyCVD(page, kind);
    await shot(page, `a03-${kind}-board`, `the board under ${kind}`, '#gameCanvas');
    await shot(page, `a04-${kind}-cards`, `rank 1 and the foil under ${kind}`, '.lens-movesets');
    await shot(page, `a05-${kind}-controls`, `the control bar under ${kind}`, '#lensControls');
    await page.evaluate(() => updateTurnClock(380, 1500));
    await sleep(200);
    await shot(page, `a06-${kind}-clock-urgent`, `the clock's urgent ramp under ${kind}`, '#turnClock');
    await page.evaluate(() => updateTurnClock(null, null));
  }
  await applyCVD(page, null);

  // ── keyboard-only operation, and whether focus is visible ───────────────
  //
  // Tab from the top of the document and record every stop: what it is, and
  // whether the ring the CSS promises is actually painted where it lands.
  await page.evaluate(() => {
    document.body.focus();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  // THE DOOR IN IS `Shift+Tab`. `Tab` itself is the unit cycle — the shipped
  // binding, which every scheme promises to leave alone — so the focus order
  // is entered from the body and walked forwards from there. A walk that only
  // ever presses Tab from the body measures the cycle, not the order.
  //
  // The walk starts at the FIRST focusable element rather than wherever
  // `Shift+Tab` happens to land (which is the last one, and one Tab from the
  // end of the document), so what is recorded is the order an operator
  // actually traverses.
  found.focusableInDom = await page.evaluate(() => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    return [...document.querySelectorAll(sel)].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    }).length;
  });
  await page.evaluate(() => {
    const sel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
    const first = [...document.querySelectorAll(sel)].find((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
    if (first) first.focus();
  });
  const stops = [];
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        // An index over the whole document, so two identically-labelled
        // controls (the roster's four `ID` buttons) are two stops and not one
        // repeat that ends the walk early.
        at: [...document.querySelectorAll('*')].indexOf(el),
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: typeof el.className === 'string' ? el.className.slice(0, 60) : null,
        text: (el.innerText || el.value || el.getAttribute('aria-label') || '').slice(0, 40).replace(/\s+/g, ' '),
        outlineWidth: cs.outlineWidth,
        outlineStyle: cs.outlineStyle,
        boxShadow: cs.boxShadow === 'none' ? null : cs.boxShadow.slice(0, 40),
        visible: box.width > 0 && box.height > 0,
        inViewport: box.top >= 0 && box.bottom <= window.innerHeight,
      };
    });
    if (!stop) break;
    if (stops.length && JSON.stringify(stops[stops.length - 1]) === JSON.stringify(stop)) break;
    // A wrap back to the element the walk started on means the order is
    // closed and every stop in it has been seen.
    if (stops.length > 1 && JSON.stringify(stops[0]) === JSON.stringify(stop)) break;
    stops.push(stop);
  }
  found.tabOrder = {
    stops: stops.length,
    withoutVisibleRing: stops.filter(
      (s) => (s.outlineStyle === 'none' || parseFloat(s.outlineWidth) === 0) && !s.boxShadow
    ),
    list: stops,
  };
  console.log(`  keyboard: ${stops.length} tab stops, ${found.tabOrder.withoutVisibleRing.length} with no visible ring`);

  // Which of the rail's own controls the keyboard can reach at all.
  found.railReachable = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const focusable = (el) =>
      el.tabIndex >= 0 || ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    return {
      chips: q('#lensControls .lens-aff[data-lens-action]').map((e) => ({
        text: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 30),
        focusable: focusable(e),
        role: e.getAttribute('role'),
      })),
      schemeButtons: q('.lens-scheme button').map((e) => ({ text: e.innerText, focusable: focusable(e) })),
      movesetRows: q('.lens-movesets [data-lens-moveset]').map((e) => ({
        key: e.getAttribute('data-lens-moveset'),
        tabIndex: e.tabIndex,
      })),
      candidateRows: q('.lens-candidates [data-lens-candidate]').map((e) => ({
        cell: e.getAttribute('data-lens-candidate'),
        tabIndex: e.tabIndex,
      })),
      laneTicks: q('#lensLane [data-seq]').map((e) => ({ tabIndex: e.tabIndex })).slice(0, 4),
    };
  });

  // ── CAN THE KEYBOARD ACTIVATE WHAT IT CAN FOCUS? ────────────────────────
  //
  // The scheme and density pickers are real `<button>`s, so they take focus
  // and a `focus-visible` ring. They are bound on `pointerdown`, and a
  // keyboard activation of a button dispatches `click` and never
  // `pointerdown` — so a control that looks operable from the keyboard, and
  // rings when it is focused, may still do nothing when it is pressed.
  found.keyboardActivation = await page.evaluate(async () => {
    const read = () => {
      try {
        return localStorage.getItem('lensKeyScheme');
      } catch (_e) {
        return null;
      }
    };
    const before = read();
    const btn = [...document.querySelectorAll('#lensKeys [data-lens-scheme]')].find(
      (b) => !b.classList.contains('on')
    );
    if (!btn) return { tested: false };
    btn.focus();
    const focused = document.activeElement === btn;
    // Exactly what a browser does for Enter or Space on a focused button.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    const after = read();
    return {
      tested: true,
      target: btn.getAttribute('data-lens-scheme'),
      focusable: focused,
      schemeBefore: before,
      schemeAfter: after,
      activated: before !== after,
    };
  });

  // Focus ring, photographed where it lands.
  await focusUnit(page, 0);
  await page.evaluate(() => {
    const el = document.querySelector('#lensControls .lens-aff[data-lens-action]');
    if (el && el.focus) el.focus();
  });
  await sleep(300);
  await shot(page, 'a07-focus-chip', 'the focus ring on a control chip, if it takes focus', '#lensControls');
  await page.evaluate(() => {
    const el = document.querySelector('.lens-scheme button');
    if (el) el.focus();
  });
  await sleep(300);
  await shot(page, 'a08-focus-scheme', 'the focus ring on the scheme picker', '#lensKeys');
  await page.close();
  await context.close();

  // ── prefers-reduced-motion ──────────────────────────────────────────────
  const rm = await browser.newContext({
    viewport: { width: 1500, height: 950 },
    reducedMotion: 'reduce',
  });
  const rmPage = await rm.newPage();
  await enter(rmPage, GAME, 'Motion');
  await step();
  await sleep(WAIT);
  await rmPage.keyboard.press('Escape');
  await focusUnit(rmPage, 0);
  await sleep(600);
  found.reducedMotion = await rmPage.evaluate(() => {
    const read = (sel, label) => {
      const el = document.querySelector(sel);
      if (!el) return { label, present: false };
      const cs = getComputedStyle(el);
      return {
        label,
        present: true,
        transition: cs.transitionDuration,
        animation: cs.animationName + ' ' + cs.animationDuration,
      };
    };
    // Everything that moves on this page, asked whether it still does.
    return [
      read('#turnClockFill', 'the clock fill (L0)'),
      read('.game-card', 'lobby game card'),
      read('.nav-link', 'lobby nav link'),
      read('#connectionStatus', 'the connection pill'),
      read('.server-status-badge', 'the server badge'),
      read('.lens-banner', 'the widen banner'),
      read('.timer-display', 'the header countdown'),
    ];
  });
  // The board's own arrival pulse is a canvas animation, not CSS: ask the
  // renderer whether it consults the media query at all.
  found.reducedMotionCanvas = await rmPage.evaluate(() => ({
    queryMatches: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    rendererConsults:
      typeof window.__lensReducedMotion !== 'undefined' ||
      /prefers-reduced-motion/.test(
        [...document.querySelectorAll('script[src]')].map((s) => s.src).join(' ')
      ),
  }));
  await shot(rmPage, 'a09-reduced-motion', 'the rail under prefers-reduced-motion');
  await rmPage.close();
  await rm.close();

  out.suites.a11y = found;
}

/**
 * SUITE 4 — DENSITY AND LEGIBILITY.
 */
async function density(browser) {
  console.log('\n── density ──');
  const found = [];
  for (const [w, h] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await context.newPage();
    await enter(page, GAME, `D${w}`);
    await step();
    await sleep(WAIT);
    await page.keyboard.press('Escape');
    await focusUnit(page, 0);
    await selectAnsweredCandidate(page, 'red-A');
    await sleep(700);
    for (const d of ['compact', 'default', 'roomy']) {
      // A REAL pointer press. The pickers are bound on `pointerdown`, and a
      // synthetic `element.click()` dispatches only `click` — so driving them
      // any other way measures a density that never changed.
      await page.click(`#lensKeys [data-lens-density="${d}"]`);
      await sleep(500);
      // The whole viewport once per size, at the shipped density — that is the
      // layout question. The other two densities are answered by the rail
      // itself, which is the only thing that changes, and a 1920 × 1080 page
      // shot is 300 KB whether or not it is carrying the answer.
      if (d === 'default') await shot(page, `d-${w}x${h}-${d}`, `${w}×${h}, density ${d}`);
      await shot(page, `d-${w}x${h}-rail-${d}`, `${w}×${h}, the rail at ${d} density`, '#selectedSnakePanel');
      found.push({
        viewport: `${w}x${h}`,
        density: d,
        ...(await page.evaluate(() => {
          const panel = document.getElementById('selectedSnakePanel');
          const canvas = document.getElementById('gameCanvas');
          const clip = (sel) => {
            const el = document.querySelector(sel);
            return el ? Math.max(0, el.scrollWidth - el.clientWidth) : null;
          };
          const smallest = [...document.querySelectorAll('#selectedSnakePanel *')]
            .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
            .map((e) => parseFloat(getComputedStyle(e).fontSize))
            .filter((n) => Number.isFinite(n));
          return {
            pageOverflowPx:
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            boardPx: canvas ? canvas.getBoundingClientRect().width : null,
            railPx: panel ? Math.round(panel.getBoundingClientRect().width) : null,
            railScrollH: panel ? panel.scrollHeight : null,
            railVisibleH: panel ? panel.clientHeight : null,
            railScrolls: panel ? panel.scrollHeight > panel.clientHeight + 2 : null,
            controlsBelowFold: (() => {
              const c = document.getElementById('lensControls');
              return c && panel
                ? c.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom
                : null;
            })(),
            stageBelowFold: (() => {
              const s = document.getElementById('lensStage');
              return s ? s.getBoundingClientRect().top > window.innerHeight : null;
            })(),
            movesetsClippedPx: clip('.lens-movesets'),
            minFontPx: smallest.length ? Math.min(...smallest) : null,
            underTenPx: smallest.filter((n) => n < 10).length,
            tenPxOrLess: smallest.filter((n) => n <= 10).length,
            textNodes: smallest.length,
            // IS THE SCALE A SCALE? `--lens-size` is the one number density is
            // supposed to be, so the honest measure is how much of the rail's
            // type actually derives from it: the histogram of sizes, and the
            // count of text that does not move when the number does.
            lensSize: getComputedStyle(panel).getPropertyValue('--lens-size').trim(),
            lensPad: getComputedStyle(panel).getPropertyValue('--lens-pad').trim(),
            sizeHistogram: (() => {
              const h = {};
              for (const n of smallest) h[n] = (h[n] || 0) + 1;
              return h;
            })(),
          };
        })),
      });
      console.log(`  ${w}x${h} ${d}: ${JSON.stringify(found[found.length - 1].minFontPx)}px smallest`);
    }
    await page.close();
    await context.close();
  }
  out.suites.density = found;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const want = (name) => SUITE === 'all' || SUITE === name;

  if (want('heuristic')) await heuristic(context);
  if (want('scenarios')) await scenarios(context);
  await context.close();
  if (want('a11y')) await a11y(browser);
  if (want('density')) await density(browser);

  fs.writeFileSync(path.join(OUT, 'eval-report.json'), JSON.stringify(out, null, 2));
  console.log(`\nreport → ${path.join(OUT, 'eval-report.json')}`);
  const over = out.shots.filter((s) => s.bytes > 300000);
  if (over.length) console.error(`OVER BUDGET: ${over.map((s) => s.name).join(', ')}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'eval-report.json'),
    JSON.stringify({ ...out, fatal: String(e && e.stack) }, null, 2)
  );
  process.exit(1);
});
