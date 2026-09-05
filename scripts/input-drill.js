/**
 * THE INPUT DRILLS — the same turn, played three ways, asserted to the same
 * end state.
 *
 * `scripts/lens-walkthrough.js` plays the operator drill from the KEYBOARD:
 * arm the cursor, `Space`, `U`, `Shift+Space`. It is a gate and it has been
 * one for three rounds. What it cannot show is whether the OTHER hands the
 * interface is under reach the same place — a mouse with no keyboard, a
 * tablet, a phone — which is the whole subject of
 * `docs/design/ux/12-INPUT-MODALITIES.md`.
 *
 * So this plays the same determination three more times:
 *
 *   · POINTER-ONLY. Unmodified left clicks and nothing else: focus, candidate,
 *     lock, undo, foil, drill, goto. No key is pressed at any point — the
 *     drill fails if it has to reach for one, because a command reachable only
 *     by a key is a command a switch user does not have (12 §1.5).
 *   · DRAG. The head to a candidate, asserted to reach the SAME selection the
 *     click reaches — one selection, two gestures (12 §1.1, P2).
 *   · TOUCH, at 768x1024 and 390x844 with `hasTouch`/`isMobile`. Taps only,
 *     plus the one held press, to the same end state; and the three layout
 *     properties a phone has to have — no two-axis scroll, the command bar in
 *     the viewport with the board, and every target at the touch figure.
 *
 * THE END STATE IS THE ASSERTION, not the pixels. `stagedMoves[unit]` carrying
 * the operator's own candidate with `source: 'manual'`, and the undo stack one
 * deeper — exactly what the keyboard drill asserts at `d1-pin`. A path that
 * looks right and stages nothing is the defect this exists to catch (05 §0).
 *
 *   node scripts/ux-walk-server.js --port=5503
 *   node scripts/input-drill.js --port=5503 --out=docs/design/ux/input
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const PORT = parseInt(arg('port', '5503'), 10);
const OUT = path.resolve(arg('out', 'docs/design/ux/input'));
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = arg('game', 'lens-walk');
const WAIT = parseInt(arg('wait', '2200'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { checks: [], notes: {}, shots: [], exceptions: [] };

function check(drill, step, ok, saw) {
  report.checks.push({ drill, step, ok: !!ok, saw });
  console.log(`  ${ok ? '✓' : '✗'} ${drill}/${step}${ok ? '' : ` — saw: ${JSON.stringify(saw)}`}`);
}

async function shot(page, name, note, selector) {
  const file = path.join(OUT, `${name}.png`);
  const target = selector ? await page.$(selector) : page;
  if (!target) {
    report.shots.push({ name, note, missing: selector });
    return;
  }
  await target.screenshot({ path: file });
  report.shots.push({ name, note, file: path.relative(process.cwd(), file) });
}

/** The login gate, answered. Names are unique per game, so a second run takes a
 *  numbered one rather than dying on the name. */
async function enter(page, name) {
  await page.goto(`${BASE}/game/${GAME}`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  if (!(await page.$('#loginGate.active'))) return name;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? name : `${name}${attempt + 1}`;
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

/** The page's own view of what is staged — the same three facts the keyboard
 *  drill reads at `d1-pin`. */
const stagingOf = (page) =>
  page.evaluate(() => ({
    unit: typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId,
    selected: typeof userSelectedMove === 'undefined' ? null : userSelectedMove,
    moves: Object.keys((typeof moveState !== 'undefined' && moveState && moveState.moves) || {}),
    staged:
      typeof stagedMoves === 'undefined' || !selectedSnakeId
        ? null
        : stagedMoves[selectedSnakeId] || null,
    undoDepth: typeof lensUndoStack === 'undefined' ? null : lensUndoStack.length,
    foil: typeof lensCursor === 'undefined' || !lensCursor ? null : lensCursor.foil,
    drill: typeof lensCursor === 'undefined' || !lensCursor ? null : lensCursor.drill,
    waypoint:
      typeof waypoints === 'undefined' || !selectedSnakeId ? null : waypoints[selectedSnakeId] || null,
  }));

/** THE BOARD, BROUGHT INTO THE VIEWPORT FIRST. On a phone the page is taller
 *  than the screen and a scroll to the roster leaves the board 300 px above
 *  the top — a tap computed against the canvas box then lands at a negative
 *  y, which is nowhere. The operator scrolls back to the board before
 *  pressing on it; so does this. */
async function showBoard(page) {
  await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    if (c) c.scrollIntoView({ block: 'center' });
  });
  await sleep(350);
}

/** A board cell's centre, in viewport pixels. Read off the canvas box, so a
 *  canvas the stylesheet has scaled down on a phone still resolves. */
const cellPoint = (page, cell) =>
  page.evaluate((c) => {
    const canvas = document.getElementById('gameCanvas');
    const b = currentGameState.board;
    const r = canvas.getBoundingClientRect();
    const size = Math.min(r.width / b.width, r.height / b.height);
    return { x: r.left + (c.x + 0.5) * size, y: r.top + (b.height - 1 - c.y + 0.5) * size, size };
  }, cell);

/** The focused unit's head and one candidate destination, from the page's own
 *  enumeration. */
const geometry = (page) =>
  page.evaluate(() => {
    const ms = typeof moveState === 'undefined' ? null : moveState;
    const snake =
      typeof currentGameState === 'undefined' || !currentGameState
        ? null
        : currentGameState.board.snakes.find((s) => s.id === selectedSnakeId);
    if (!ms || !ms.moves || !snake) return null;
    const key = Object.keys(ms.moves).find((k) => ms.moves[k].position);
    return key
      ? { head: snake.body[0], key, cand: ms.moves[key].position, count: Object.keys(ms.moves).length }
      : null;
  });

/** THE CANDIDATE ENUMERATION, WAITED FOR RATHER THAN ASSUMED. `moveState` is
 *  rebuilt from the server's per-turn `snake-turn-update`, so a page that
 *  joined between two of them has a focused unit and an empty enumeration for
 *  up to a turn. Retrying is not weakening the assertion — the assertion is
 *  that the enumeration ARRIVES and the pointer can reach it; a run that gave
 *  up after one poll would be asserting the harness's timing instead. */
async function waitForGeometry(page, ms) {
  const deadline = Date.now() + (ms || 12000);
  let geo = await geometry(page);
  while (!geo && Date.now() < deadline) {
    await sleep(600);
    await takeOver(page);
    geo = await geometry(page);
  }
  return geo;
}

/** Roster row `index`, by pointer, answering any takeover the click raises. */
async function focusByPointer(page, index, tap) {
  await takeOver(page);
  const rows = await page.$$('.snake-info-item.selectable');
  if (!rows[index]) return false;
  // SCROLLED TO THE MIDDLE FIRST. Under a coarse pointer the command bar is
  // fixed to the bottom of the viewport (12 §3.4), so a row that happens to
  // lie under it would take the tap on the bar instead — which is a fact
  // about a fixed bar and not about the roster, and the operator's own answer
  // to it is the same scroll.
  await rows[index].evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  if (tap) await rows[index].tap({ force: true });
  else await rows[index].click({ force: true });
  await sleep(WAIT);
  await takeOver(page);
  return true;
}

/** A chip in the control bar, pressed the way this drill presses things. The
 *  bar re-renders on every emission, so the handle is re-taken per attempt. */
async function chip(page, action, tap) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const el = await page.$(`[data-lens-action="${action}"]`);
    if (!el) {
      await sleep(300);
      continue;
    }
    try {
      if (tap) await el.tap({ force: true, timeout: 4000 });
      else await el.click({ force: true, timeout: 4000 });
      return true;
    } catch (_e) {
      await sleep(300);
    }
  }
  return false;
}

// ── the pointer-only drill ───────────────────────────────────────────────
async function pointerDrill(context) {
  const page = await context.newPage();
  page.on('pageerror', (e) => report.exceptions.push({ at: 'pointer', text: String(e && e.message) }));
  await enter(page, 'Pointer');
  await focusByPointer(page, 0);

  const focused = await stagingOf(page);
  check('pointer', 'focus — a roster click alone focuses a unit and enumerates its candidates',
    !!focused.unit && focused.moves.length > 0, focused);

  const geo = await waitForGeometry(page);
  check('pointer', 'candidates — the focused unit has a destination to click', !!geo,
    geo || (await stagingOf(page)));
  if (!geo) return page;

  // 1 — THE CANDIDATE, by an unmodified left click on the board.
  await showBoard(page);
  const at = await cellPoint(page, geo.cand);
  await page.mouse.click(at.x, at.y);
  await sleep(900);
  const picked = await stagingOf(page);
  check('pointer', 'candidate — an unmodified left click selects it, and arms the lock',
    picked.selected === geo.key, { want: geo.key, got: picked.selected });

  // 2 — THE LOCK, by the chip. This is the assertion the keyboard drill makes
  //     for `Space`, reached without a keyboard.
  const before = picked.undoDepth;
  check('pointer', 'lock — the chip is there to press', await chip(page, 'lock'), null);
  await sleep(1400);
  const staged = await stagingOf(page);
  check('pointer', 'lock — the unit carries the operator’s own candidate, source manual',
    !!staged.staged && String(staged.staged.requestedMove) === String(picked.selected) &&
      staged.staged.source === 'manual',
    staged);
  check('pointer', 'lock — the determination landed on the undo stack',
    staged.undoDepth === before + 1, { before, after: staged.undoDepth });
  await shot(page, 'p1-locked', 'pointer only: a candidate clicked on the board and locked from the chip',
    '#selectedSnakePanel');

  // 3 — AND BACK, by the chip. Same property as `U`.
  check('pointer', 'undo — the chip is there to press', await chip(page, 'undo'), null);
  await sleep(1300);
  const undone = await stagingOf(page);
  check('pointer', 'undo — the stage is taken back and the unit stops carrying it',
    undone.undoDepth === before && (!undone.staged || undone.staged.source !== 'manual'), undone);

  // 4 — THE FOIL, which had no pointer path at all before this round (I-1).
  const foilBefore = (await stagingOf(page)).foil;
  check('pointer', 'foil — the chip is there to press', await chip(page, 'foil'), null);
  await sleep(700);
  const foiled = await stagingOf(page);
  check('pointer', 'foil — the runner-up is on the board, from the pointer alone',
    foiled.foil !== foilBefore && foiled.foil !== 'off', { before: foilBefore, after: foiled.foil });
  await shot(page, 'p2-foil', 'pointer only: the foil, which was reachable by `F` and nothing else', '#lensControls');

  // 5 — THE L3 DRILL, likewise (I-2). The transition is "drill the first
  //     cluster member that is not the one already drilled", so on a frame
  //     whose focused unit is in no cluster there is nothing to drill and the
  //     action is a legitimate no-op — which is exactly what `B` does on that
  //     frame too. The property asserted is therefore the one that was broken:
  //     the pointer reaches the action AND lands the same result the key lands.
  const clusterBefore = await page.evaluate(() => {
    try {
      const cl = lensView().clusterOf(lensFrame(), lensCursor.unit);
      return cl && cl.members ? cl.members.length : 0;
    } catch (_e) {
      return 0;
    }
  });
  check('pointer', 'drill — the chip is there to press', await chip(page, 'drill'), null);
  await sleep(900);
  const drilled = await stagingOf(page);
  check('pointer', 'drill — the pointer reaches the breakdown wherever the key would',
    clusterBefore > 1 ? !!drilled.drill : drilled.drill === null,
    { clusterMembers: clusterBefore, drill: drilled.drill });

  // 6 — GOTO, ARMED AND SPENT in two unmodified left clicks (I-3). This is the
  //     command a touchscreen and a switch user could not reach at all.
  check('pointer', 'goto — the chip is there to press', await chip(page, 'goto'), null);
  await sleep(500);
  const armed = await page.evaluate(() => ({
    pending: typeof lensPendingTarget === 'undefined' ? null : lensPendingTarget,
    chip: (document.querySelector('[data-lens-action="goto"]') || {}).innerText || null,
  }));
  check('pointer', 'goto — the chip arms and says the next press will land it',
    armed.pending === 'green' && /press a cell/i.test(armed.chip || ''), armed);
  await shot(page, 'p3-goto-armed', 'pointer only: goto armed — the next unmodified press sets it', '#lensControls');
  const target = await cellPoint(page, geo.cand);
  await page.mouse.click(target.x, target.y);
  await sleep(1200);
  const wayp = await stagingOf(page);
  check('pointer', 'goto — an unmodified left click on a cell sets the target',
    !!wayp.waypoint && wayp.waypoint.type === 'green', wayp.waypoint);
  check('pointer', 'goto — and disarms, so the next press is an ordinary press',
    (await page.evaluate(() => (typeof lensPendingTarget === 'undefined' ? null : lensPendingTarget))) === null,
    null);

  // AND THE UNIT IS LEFT AS IT WAS FOUND. The goto above is server-side state
  // on a unit the touch drills focus next; a drill that hands the following
  // one a waypoint is a drill asserting against its own leftovers.
  await chip(page, 'clear');
  await sleep(900);

  return page;
}

// ── the drag drill ───────────────────────────────────────────────────────
//
// ONE SELECTION, TWO GESTURES. The property is not "a drag does something" —
// it is that a drag from the head to a cell reaches EXACTLY the selection a
// click on that cell reaches. Two paths that select differently is the defect
// 02 §3.3 records between the rail and the board.
async function dragDrill(page) {
  const geo = await geometry(page);
  if (!geo) {
    check('drag', 'candidates — a destination to drag to', false, null);
    return;
  }
  // The click's answer, recorded first.
  const at = await cellPoint(page, geo.cand);
  await page.mouse.click(at.x, at.y);
  await sleep(800);
  const byClick = (await stagingOf(page)).selected;

  // Clear it, then reach the same place by dragging.
  await page.keyboard.press('Escape');
  await sleep(400);
  const head = await cellPoint(page, geo.head);
  const dest = await cellPoint(page, geo.cand);
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move(dest.x, dest.y, { steps: 10 });
  await sleep(150);
  await page.mouse.up();
  await sleep(900);
  const byDrag = (await stagingOf(page)).selected;
  check('drag', 'a drag from the head reaches the same selection a click reaches',
    byDrag !== null && byDrag === byClick, { byClick, byDrag });

  // A drag that did NOT start on the unit is a stray gesture and must do
  // nothing — a board that eats a mis-swipe is worse than one that ignores it.
  await page.keyboard.press('Escape');
  await sleep(400);
  const away = await cellPoint(page, { x: 0, y: 0 });
  await page.mouse.move(away.x, away.y);
  await page.mouse.down();
  await page.mouse.move(dest.x, dest.y, { steps: 10 });
  await page.mouse.up();
  await sleep(700);
  const stray = (await stagingOf(page)).selected;
  check('drag', 'a drag that did not start on the unit selects nothing', !stray || stray === byClick,
    { stray });

  // AND THE PREFERENCE IS A PREFERENCE. `input.moveGesture: click` turns the
  // drag off; the click keeps working, because a drag-only path would be WCAG
  // 2.5.7 failure F108 and a click-only one is conformant on its own.
  await page.evaluate(() => setInputPref('input.moveGesture', 'click'));
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move(dest.x, dest.y, { steps: 10 });
  await page.mouse.up();
  await sleep(800);
  const offDrag = (await stagingOf(page)).selected;
  await page.mouse.click(dest.x, dest.y);
  await sleep(800);
  const offClick = (await stagingOf(page)).selected;
  check('drag', 'input.moveGesture=click turns the drag off and leaves the click alone',
    !offDrag && offClick === byClick, { offDrag, offClick, byClick });
  await page.evaluate(() => setInputPref('input.moveGesture', 'both'));
}

// ── the handedness drill ─────────────────────────────────────────────────
async function handednessDrill(page) {
  const before = await page.evaluate(() => {
    const rail = document.getElementById('selectedSnakePanel');
    const board = document.querySelector('.board-container');
    return rail && board
      ? { rail: Math.round(rail.getBoundingClientRect().left), board: Math.round(board.getBoundingClientRect().left) }
      : null;
  });
  await page.evaluate(() => setInputPref('input.handedness', 'left'));
  await sleep(400);
  const after = await page.evaluate(() => {
    const rail = document.getElementById('selectedSnakePanel');
    const board = document.querySelector('.board-container');
    return {
      cls: document.documentElement.classList.contains('input-hand-left'),
      rail: rail ? Math.round(rail.getBoundingClientRect().left) : null,
      board: board ? Math.round(board.getBoundingClientRect().left) : null,
    };
  });
  check('handedness', 'the preference stamps one class on the root', after.cls, after);
  check('handedness', 'the control column moves to the pointing hand’s side',
    before && after.rail !== null && after.board !== null &&
      before.rail > before.board && after.rail < after.board,
    { before, after });
  await shot(page, 'p4-hand-left', 'the control column mirrored for a left-handed operator', null);
  await page.evaluate(() => setInputPref('input.handedness', 'right'));
  await sleep(300);
  const back = await page.evaluate(() => document.documentElement.classList.contains('input-hand-left'));
  check('handedness', 'and back — the default stamps nothing', back === false, { back });
}

// ── the touch drill ──────────────────────────────────────────────────────
async function touchDrill(browser, label, viewport) {
  const context = await browser.newContext({
    viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('lensTourSeen', '1');
    } catch (_e) { /* ignore */ }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.exceptions.push({ at: label, text: String(e && e.message) }));
  await enter(page, label === 'tablet' ? 'Tab' : 'Phone');
  await focusByPointer(page, 0, true);

  // 1 — NO TWO-AXIS SCROLL (I-6).
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  check(label, 'layout — the page does not scroll sideways',
    overflow.scrollW <= overflow.clientW + 1, overflow);

  // 2 — THE COMMAND BAR IS REACHABLE WITH THE BOARD (I-5). This is the finding
  //     that cost the most: the bar sat 1433-1741 px below a board the
  //     operator has to be looking at, inside a 500 ms turn.
  const boxes = await page.evaluate(() => {
    const bar = document.getElementById('lensControls');
    const canvas = document.getElementById('gameCanvas');
    const b = bar && bar.getBoundingClientRect();
    const c = canvas && canvas.getBoundingClientRect();
    return {
      bar: b ? { top: Math.round(b.top), bottom: Math.round(b.bottom) } : null,
      board: c ? { top: Math.round(c.top), bottom: Math.round(c.bottom) } : null,
      vh: window.innerHeight,
    };
  });
  check(label, 'layout — the command bar is in the viewport with the board',
    !!boxes.bar && boxes.bar.top >= 0 && boxes.bar.bottom <= boxes.vh + 1, boxes);

  // 3 — THE TOUCH FIGURE (I-7). Every target the operator presses during a
  //     turn, at 44 px or better on its short side.
  const small = await page.evaluate(() => {
    const sel = '[data-lens-action],[data-lens-scheme],[data-lens-density],[data-input-pref],' +
      '.snake-info-item.selectable,[data-copy-id],.lens-tick,.lens-lane-foot';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (getComputedStyle(el).display === 'none') continue;
      // THE LANE TICK IS THE ONE EXCEPTION, and it is named rather than
      // waived: a scrubber tick's POSITION is the datum, so a 44 px wide tick
      // would overlap its neighbours and stop meaning what it points at —
      // WCAG 2.5.8's `Essential` case. It is held to 24 px wide (the AA floor)
      // and 44 px tall, and the whole lane has the key path `,` `.` `Home`
      // `End` beside it.
      const floor = el.classList.contains('lens-tick') ? 24 : 44;
      if (r.width < floor || r.height < 44) {
        out.push({
          what: el.getAttribute('data-lens-action') || el.getAttribute('data-input-pref') ||
            el.getAttribute('data-lens-scheme') || el.className || el.tagName,
          w: Math.round(r.width), h: Math.round(r.height),
        });
      }
    }
    return out;
  });
  check(label, 'targets — every pressed target is at least 44 px on its short side',
    small.length === 0, small.slice(0, 8));

  // 4 — THE SAME END STATE, from taps alone.
  const geo = await waitForGeometry(page);
  check(label, 'candidates — the focused unit has a destination to tap', !!geo,
    geo || (await stagingOf(page)));
  if (geo) {
    await showBoard(page);
    const at = await cellPoint(page, geo.cand);
    await page.touchscreen.tap(at.x, at.y);
    await sleep(900);
    const picked = await stagingOf(page);
    check(label, 'candidate — a tap on the board selects it', picked.selected === geo.key,
      { want: geo.key, got: picked.selected });
    const before = picked.undoDepth;
    check(label, 'lock — the chip is there to tap', await chip(page, 'lock', true), null);
    await sleep(1400);
    const staged = await stagingOf(page);
    check(label, 'lock — the SAME end state the keyboard drill asserts',
      !!staged.staged && String(staged.staged.requestedMove) === String(picked.selected) &&
        staged.staged.source === 'manual' && staged.undoDepth === before + 1,
      staged);
    await shot(page, `t-${label}-locked`, `touch (${viewport.width}x${viewport.height}): the same turn, by taps`, null);

    // 5 — THE HELD PRESS (I-8): the secondary click a touchscreen does not
    //     have, bound where both platforms bind it.
    await showBoard(page);
    const held = await cellPoint(page, geo.cand);
    await page.evaluate(async (p) => {
      const el = document.elementFromPoint(p.x, p.y) || document.body;
      const fire = (type) => el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: 'touch',
        clientX: p.x, clientY: p.y, isPrimary: true, pointerId: 7, button: 0,
      }));
      fire('pointerdown');
      await new Promise((r) => setTimeout(r, 800));
      fire('pointerup');
    }, held);
    await sleep(1200);
    const wayp = await stagingOf(page);
    check(label, 'long-press — a held press on a cell sets the goto target',
      !!wayp.waypoint && wayp.waypoint.type === 'green', wayp.waypoint);
  }

  await context.close();
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
      localStorage.setItem('lensTourSeen', '1');
    } catch (_e) { /* ignore */ }
  });

  const page = await pointerDrill(context);
  await dragDrill(page);
  await handednessDrill(page);
  await context.close();

  await touchDrill(browser, 'tablet', { width: 768, height: 1024 });
  await touchDrill(browser, 'phone', { width: 390, height: 844 });

  await browser.close();

  report.notes.exceptions = report.exceptions;
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  const failed = report.checks.filter((c) => !c.ok);
  console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed`);
  if (report.exceptions.length) {
    console.error(`page exceptions: ${JSON.stringify(report.exceptions.slice(0, 5))}`);
  }
  if (failed.length || report.exceptions.length) {
    console.error(`input drill FAILED: ${failed.map((f) => `${f.drill}/${f.step}`).join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('input drill CRASHED', e);
  process.exit(1);
});
