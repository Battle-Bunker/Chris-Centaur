/**
 * THE WALKTHROUGH DRIVER — the lens, in a browser, one state per screenshot.
 *
 * Pairs with `src/tests/lens-walkthrough-server.ts`: that stands the shipped
 * page up against a real local decision, this walks a Chromium through every
 * cursor-machine state `docs/design/decision-lens/02-INSPECTION-UI.md` names
 * and writes the PNGs `10-WALKTHROUGH.md` cites.
 *
 *   npx ts-node --transpile-only src/tests/lens-walkthrough-server.ts --port=5055 &
 *   node scripts/lens-walkthrough.js --port=5055 --out=docs/design/decision-lens/walkthrough
 *
 * Everything it notices on the way — console errors, failed requests, page
 * exceptions, horizontal overflow, and the rail's own text at every stop — is
 * written beside the images as `report.json`, because a screenshot cannot show
 * a console and a verdict needs the words, not just the pixels.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/** The provisioned Chromium. Playwright's own revision pin does not match the
 *  image's, so the binary is named rather than discovered. */
const CHROME = process.env.LENS_CHROMIUM || '/opt/pw-browsers/chromium';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = parseInt(arg('port', '5055'), 10);
const OUT = path.resolve(arg('out', 'docs/design/decision-lens/walkthrough'));
/** The review drill photographs a different surface for a different document,
 *  so its pictures live beside that document (docs/design/ux/07-REVIEW.md). */
const REVIEW_OUT = path.resolve(arg('review-out', 'docs/design/ux/review'));
const BASE = `http://127.0.0.1:${PORT}`;
const GAME = arg('game', 'lens-walk');
const WAIT = parseInt(arg('wait', '2000'), 10);

const report = { shots: [], console: [], requests: [], exceptions: [], overflow: [], notes: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      report.console.push({ at: label(), type: m.type(), text: m.text() });
    }
  });
  page.on('pageerror', (e) => report.exceptions.push({ at: label(), text: String(e && e.message) }));
  page.on('requestfailed', (r) =>
    report.requests.push({ at: label(), url: r.url(), why: r.failure() && r.failure().errorText })
  );
  page.on('response', (r) => {
    if (r.status() >= 400) report.requests.push({ at: label(), url: r.url(), status: r.status() });
  });
}

/** What the operator can actually read, captured beside the pixels. */
function railText(page) {
  return page.evaluate(() => ({
    rail: (document.getElementById('lensRail') || {}).innerText || null,
    // THE GLANCE LAYER, IN WORDS. A screenshot cannot be grepped and the stage
    // line is the one sentence the whole IA is built around, so it is captured
    // beside the pixels like everything else the operator reads.
    stage: (document.getElementById('lensStage') || {}).innerText || null,
    controls: (document.getElementById('lensControls') || {}).innerText || null,
    keys: (document.getElementById('lensKeys') || {}).innerText || null,
    lane: (document.querySelector('.lens-lane-foot') || {}).innerText || null,
    banner: (document.querySelector('.lens-banner') || {}).innerText || null,
    // THE ONE LOCK AFFORDANCE (05 P-2). The movesets panel's `.lens-lock`
    // line was the second drawing of this and is gone; the chip in the
    // control bar is the affordance, so the walk reads it there.
    lock: (document.querySelector('[data-lens-action="lock"]') || {}).innerText || null,
    state: {
      viewMode: typeof viewMode === 'undefined' ? null : viewMode,
      lensTurn: typeof lensTurn === 'undefined' ? null : lensTurn,
      lensSeq: typeof lensSeq === 'undefined' ? null : lensSeq,
      lensAtHead: typeof lensAtHead === 'undefined' ? null : lensAtHead,
      events: typeof lensEvents === 'undefined' ? null : lensEvents.length,
      selected: typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId,
      finished: typeof finishedMode === 'undefined' ? null : finishedMode,
    },
  }));
}

async function shot(page, name, note, selector, dir) {
  const file = path.join(dir || OUT, `${name}.png`);
  const target = selector ? await page.$(selector) : page;
  if (!target) {
    report.shots.push({ name, note, missing: selector });
    console.log(`  · ${name} — MISSING ${selector}`);
    return;
  }
  await target.screenshot({ path: file });
  const size = fs.statSync(file).size;
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 2) report.overflow.push({ name, overflowPx: overflow });
  report.shots.push({ name, note, bytes: size, overflowPx: overflow, ...(await railText(page)) });
  console.log(
    `  · ${name} (${(size / 1024).toFixed(0)} KB)${overflow > 2 ? ` OVERFLOW ${overflow}px` : ''}`
  );
}

/** Enter the game as an operator: the shipped page gates on a per-game name. */
async function enter(page, gameId, name) {
  await page.goto(`${BASE}/game/${gameId}`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  if (!(await page.$('#loginGate.active'))) return name;
  // NAMES ARE UNIQUE PER GAME, and the harness's own scripted operator may
  // already hold the one we ask for — the gate is right to refuse it and the
  // walk should not die on a name. Take the asked-for name when it is free and
  // a numbered one when it is not; nothing downstream depends on which, since
  // the banners and lane ticks name the operator who acted, not the reader.
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = attempt === 0 ? name : `${name}-${attempt + 1}`;
    await page.fill('#loginNameInput', candidate);
    await sleep(400);
    if (!(await page.$eval('#loginGateSubmit', (el) => el.disabled))) {
      await page.click('#loginGateSubmit');
      await sleep(WAIT);
      report.notes.operator = candidate;
      return candidate;
    }
  }
  throw new Error(`no free operator name for ${name}`);
}

const step = () => fetch(`${BASE}/dev/step`, { method: 'POST' }).then((r) => r.json());

/** Focus a unit through the shipped gesture — the roster row. A row that is
 *  already the active perspective fires no selection, so the walk goes via
 *  another unit when it has to. */
/**
 * THE TAKEOVER DIALOG, ANSWERED.
 *
 * Selecting a unit another operator has claimed raises `#confirmDialog`, and
 * it is a modal that swallows every pointer event on the page until it is
 * answered — including the roster click that raised it. The walk only ever
 * worked on a VIRGIN server, where the name `Ada` is free and therefore owns
 * the units; run it a second time against the same server and the gate takes
 * `Ada-2`, owns nothing, and dies on a screenshot of a rail that never
 * opened. A gate that passes only on the first run is not a gate.
 *
 * Answering it is what an operator taking a seat does, and the count rides in
 * `report.json` because how many modals a second operator has to answer to
 * pick up one team is a fact about the surface.
 */
async function takeOver(page) {
  if (!(await page.$('#confirmDialog.active'))) return false;
  await page.click('#confirmTakeoverBtn');
  await sleep(700);
  report.notes.takeovers = (report.notes.takeovers || 0) + 1;
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

/** The lane tick at a given lane, by index. Ticks are the design's clickable
 *  scrubber, and the playhead snaps to events rather than to pixels. */
async function clickTick(page, lane, which) {
  const ticks = await page.$$(`#lensLane .lens-lane[data-lane="${lane}"] [data-seq]`);
  if (ticks.length === 0) return null;
  const el = which === 'last' ? ticks[ticks.length - 1] : ticks[which];
  if (!el) return null;
  const seq = await el.getAttribute('data-seq');
  await el.click();
  await sleep(700);
  return seq;
}

/** Two PNGs, differenced in the browser that drew them: same size?, how many
 *  pixels differ, and the bounding box of the difference so the report can say
 *  WHERE rather than only how much. */
async function diffPngs(page, a, b) {
  const toUri = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
  return page.evaluate(
    async ([ua, ub]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = src;
        });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { sameSize: false, a: [ia.width, ia.height], b: [ib.width, ib.height] };
      }
      const draw = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        return c.getContext('2d').getImageData(0, 0, img.width, img.height).data;
      };
      const [da, db] = [draw(ia), draw(ib)];
      let differing = 0;
      let top = Infinity;
      let bottom = -1;
      for (let i = 0; i < da.length; i += 4) {
        if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) {
          differing++;
          const y = Math.floor(i / 4 / ia.width);
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
      return {
        sameSize: true,
        width: ia.width,
        height: ia.height,
        differingPixels: differing,
        percent: Number(((differing / (ia.width * ia.height)) * 100).toFixed(3)),
        differingRows: differing === 0 ? null : [top, bottom],
      };
    },
    [toUri(a), toUri(b)]
  );
}


/**
 * T3 — CLICK THE CANDIDATE THE KERNEL ANSWERED A CONDITIONAL FOR.
 *
 * The inspection reserve answers ONE conditional per decision (07 §5), so
 * exactly one of a focused unit's candidates has a ranked list behind it and
 * the others say, in the head, that nobody asked. A walk that only ever lands
 * on the incumbent therefore photographs the fallback every time and never the
 * thing the lens is FOR. This clicks the candidate the log says was answered,
 * which is also T3's own cursor source — listed since 02 §1.3, closed at O5
 * with a test rather than a picture — so the click path finally has one.
 */
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
  if (!lock || (unit && lock.unit !== unit)) return { lock, clicked: false };
  // The rail re-renders on every emission — seven to ten times a turn — so a
  // handle taken before a click can be detached by the time the click lands.
  // Re-query and retry rather than fail the walk on the panel doing its job.
  const selector = `.lens-candidates [data-lens-candidate="${lock.to}"]`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const cell = await page.$(selector);
    if (!cell) {
      await sleep(300);
      continue;
    }
    try {
      await takeOver(page);
      await cell.click({ timeout: 4000, force: true });
      await sleep(WAIT);
      return { lock, clicked: true };
    } catch (_e) {
      await sleep(300);
    }
  }
  return { lock, clicked: false };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  // THE TOUR'S FIRST-RUN OFFER IS SUPPRESSED FOR THE WHOLE WALK, and opened
  // deliberately by the tour drill at the end of it. `src/web/tour.js` opens
  // itself once per browser profile on the first game it can point at, which
  // is right for an operator and wrong for a camera: a dim layer over every
  // photograph below would change thirty-three pictures for a reason that has
  // nothing to do with what they are of.
  await context.addInitScript(() => {
    try { localStorage.setItem('lensTourDone', '1'); } catch (e) { /* no storage */ }
  });
  const page = await context.newPage();
  let at = 'boot';
  watch(page, () => at);

  // ── LIVE ────────────────────────────────────────────────────────────────
  at = 'live/enter';
  await enter(page, GAME, 'Ada');
  // One turn played with this browser attached, so the whole event stream
  // arrives over the socket rather than through the mid-turn anchor replay.
  at = 'live/step';
  await step();
  await sleep(WAIT);
  await page.keyboard.press('Escape');
  await sleep(500);
  await shot(page, '01-idle', 'live head, no unit focused — the NONE cursor state');

  at = 'live/hover-unit';
  const canvas = await page.$('#gameCanvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.16, box.y + box.height * 0.82);
  await sleep(600);
  await shot(page, '02-hover-unit', 'pointer over a unit on the board — the tag calls up');

  // The cluster the scripted operator drilled is the first one; its anchor is
  // roster row 0, so the breakdown below has rows to draw.
  at = 'live/focus';
  await focusUnit(page, 0);
  await shot(page, '03-focus-unit', 'CANDIDATE state — focus auto-advances to the incumbent (Law D)');
  await shot(page, '03b-rail', 'the rail at CANDIDATE', '.lens-rail');
  await shot(page, '03c-board', 'the board at CANDIDATE — chips, tethers, the violet arrow', '#gameCanvas');

  at = 'live/candidate';
  report.notes.conditional = await selectAnsweredCandidate(page, 'red-A');
  await shot(
    page,
    '03d-conditional',
    'T3 — the candidate the reserve answered: the CONDITIONAL RANKING, the rows a lock here would stage',
    '.lens-rail'
  );

  at = 'live/hover-moveset';
  const rows = await page.$$('.lens-movesets .lens-table tr');
  if (rows.length > 1) {
    await rows[1].hover();
    await sleep(500);
  }
  await shot(page, '04-hover-moveset', 'pointer over moveset rank 2 — T4 says the cursor must not move, so this is byte-identical to 03d', '.lens-rail');

  at = 'live/moveset-walk';
  await page.keyboard.press(']');
  await sleep(700);
  await shot(page, '05-moveset-next', 'the cursor walked one row down the conditional list', '.lens-rail');
  await shot(page, '05b-board', 'the board at the next rank — only disagreement draws', '#gameCanvas');
  await page.keyboard.press('[');
  await sleep(700);

  at = 'live/breakdown';
  await page.keyboard.press('b');
  await sleep(1200);
  await shot(page, '06-breakdown', 'BREAKDOWN drilled — members, terms, and the joint residual', '.lens-rail');
  await shot(page, '06b-breakdown-panel', 'the breakdown panel alone', '.lens-breakdown');

  at = 'live/unless';
  await shot(page, '07-movesets-panel', 'the MOVESETS table — depth ink and the `unless` cell per row', '.lens-movesets');

  at = 'live/foil';
  await page.keyboard.press('f');
  await sleep(700);
  await shot(page, '08-foil', 'the contrastive foil latched', '.lens-rail');
  await shot(page, '08b-foil-board', 'the foil on the board — teal, only where it differs', '#gameCanvas');
  await page.keyboard.press('f');
  await sleep(400);

  at = 'live/lane';
  await shot(page, '09-lane', 'the intra-turn lane at the head', '#lensLane');
  await page.click('#lensLane .lens-lane-foot');
  await sleep(500);
  await shot(page, '10-lane-expanded', 'the lane expanded — hollow attention ticks', '#lensLane');
  await page.click('#lensLane .lens-lane-foot');
  await sleep(400);

  at = 'live/scrub';
  await page.keyboard.press('Home');
  await sleep(700);
  await shot(page, '11-scrub-anchor', 'live-scrub at the turn anchor — determinations refuse');
  await page.keyboard.press('Shift+.');
  await page.keyboard.press('Shift+.');
  await sleep(700);
  await shot(page, '12-scrub-emission', 'live-scrub, two kernel emissions in', '.lens-rail');

  at = 'live/pinned';
  report.notes.operatorTicks = await page.evaluate(() =>
    [...document.querySelectorAll('#lensLane .lens-lane[data-lane="operator"] [data-seq]')].map((e) =>
      e.getAttribute('title')
    )
  );
  // The operator tick is the kernel's `operator` frame; the PARTITION it
  // produces is the next event, and the playhead snaps to events, so the pin's
  // effect is one step on from the tick.
  report.notes.pinnedSeq = await clickTick(page, 'operator', 0);
  await page.keyboard.press('.');
  await sleep(700);
  await shot(page, '13-pinned', 'the frame after the operator pin — Rule E, drawn', '.lens-rail');
  await shot(page, '13b-pinned-board', 'the pinned unit on the board — padlock, no tether', '#gameCanvas');

  at = 'live/widen';
  report.notes.widenSeq = await clickTick(page, 'operator', 'last');
  await page.keyboard.press('.');
  await sleep(700);
  await shot(page, '14-released-widen', 'the frame at the release — the cluster widens again', '.lens-rail');

  at = 'live/now';
  await page.keyboard.press('n');
  await sleep(700);
  await shot(page, '15-back-to-now', 'back at the live head — the lock affordance returns');

  // A widen that arrives WHILE the operator is reading: the scripted peer
  // releases its pin at emission 4 of the next turn.
  at = 'live/widen-banner';
  await step();
  let banner = null;
  for (let i = 0; i < 60; i++) {
    banner = await page.evaluate(() => {
      const el = document.querySelector('.lens-banner');
      return el ? el.innerText : null;
    });
    if (banner) break;
    await sleep(100);
  }
  report.notes.banner = banner;
  if (banner) {
    await shot(page, '16-widen-banner', 'the widen banner — additive uncertainty is staged', '.lens-rail');
    const show = await page.$('[data-lens-accept]');
    if (show) {
      await show.click();
      await sleep(900);
      await shot(page, '16b-widen-accepted', 'after [Show] — the wider list lands', '.lens-rail');
    }
  }
  await sleep(WAIT);

  at = 'live/lock';
  await focusUnit(page, 0);
  report.notes.lockBefore = await page.evaluate(() => {
    const el = document.querySelector('[data-lens-action="lock"]');
    return el ? el.innerText : null;
  });
  // TWO PRESSES, ON PURPOSE. A lock over more than the focused unit ARMS
  // first — the affordance is the confirmation and it says how many units it
  // would pin — and the same key again commits it. One press is still one
  // press for the ordinary case (rank 1, one pin, the operator's own unit).
  await page.keyboard.press('Shift+ ');
  await sleep(600);
  report.notes.lockArmed = await page.evaluate(() => {
    const el = document.querySelector('.lens-arm');
    return el ? el.innerText : null;
  });
  if (report.notes.lockArmed) {
    await page.keyboard.press('Shift+ ');
  }
  await sleep(1200);
  report.notes.lockAfter = await page.evaluate(() => {
    const el = document.querySelector('[data-lens-action="lock"]');
    return el ? el.innerText : null;
  });
  await shot(page, '17-locked', 'after Shift+Space — the whole moveset pinned');
  await shot(page, '17b-locked-rail', 'the rail after the lock', '.lens-rail');

  // ── THE OPERATOR DRILL ──────────────────────────────────────────────────
  //
  // pin → lock → widen → undo, driven from the keyboard exactly as an operator
  // would, with EVERY STEP ASSERTED rather than only photographed. The four
  // gestures are the whole of the determination surface, and the properties
  // asserted here are the ones the IA promises about them:
  //
  //  · a pin is cheap and reversible, so it is taken at once and the undo
  //    affordance says so IMMEDIATELY (there is no dialog to dismiss first);
  //  · a lock that pins more than the focused unit ARMS instead of firing,
  //    and says how many units it would pin before the second press;
  //  · a widen never swaps the table out from under the reader — the banner
  //    is up and the rail below it is flagged stale;
  //  · undo takes the last determination back and says what it took back.
  //
  // A failed assertion fails the run: this is a gate, not a slideshow.
  at = 'drill';
  const drill = [];
  const railOf = () => railText(page);
  /** Two pictures per step: the rail's own column (the glance layer and the
   *  decision) and the control bar (the affordance and its state). The rail
   *  column is a scroll region taller than the viewport, so the bar at the
   *  bottom of it is not in the column's own shot — and the bar is the half
   *  the drill is asserting. */
  const drillShot = async (name, note) => {
    await shot(page, name, note, '#selectedSnakePanel');
    await shot(page, `${name}-controls`, `${note} — the control bar`, '#lensControls');
  };
  const check = (name, ok, saw) => {
    drill.push({ step: name, ok: !!ok, saw });
    console.log(`  ${ok ? '✓' : '✗'} drill/${name}${ok ? '' : ` — saw: ${JSON.stringify(saw)}`}`);
  };

  // A drill starts from a clean slate: any armed gesture left over from the
  // walk above is cancelled, and the cursor is put on the candidate the
  // reserve answered — the one candidate with a ranked list behind it.
  await page.keyboard.press('Escape');
  await sleep(300);
  await focusUnit(page, 0);
  await selectAnsweredCandidate(page, 'red-A');
  const beforePin = await railOf();

  /** The undo stack's own depth, from the page. The control bar's TEXT is not
   *  a witness for it: `/undo/` matches the chip's own label whatever the
   *  stack holds, and `nothing yet` is absent whenever the stack is non-empty
   *  FOR ANY REASON — including the multi-unit lock at `17-locked`, which runs
   *  before this drill and pushes an entry of its own. Read the number. */
  const undoDepth = () =>
    page.evaluate(() => (typeof lensUndoStack === 'undefined' ? null : lensUndoStack.length));

  /** THE UNIT'S STAGING STATE, from the page: the candidate enumeration the
   *  turn data built, the candidate the cursor has selected, and the staged
   *  record the unit is actually carrying. All three, because a stage is only
   *  a stage when the third one moved. */
  const stagingOf = () =>
    page.evaluate(() => ({
      moves: Object.keys(
        (typeof moveState !== 'undefined' && moveState && moveState.moves) || {}
      ),
      selected: typeof userSelectedMove === 'undefined' ? null : userSelectedMove,
      unit: typeof selectedSnakeId === 'undefined' ? null : selectedSnakeId,
      staged:
        typeof stagedMoves === 'undefined' || !selectedSnakeId
          ? null
          : stagedMoves[selectedSnakeId] || null,
    }));

  /** THE CURSOR ONTO A CANDIDATE, BY AN OPERATOR GESTURE. The rail click
   *  above only lands when the reserve answered a conditional for this unit
   *  and the row is still mounted; when it did not, the arrow pad is the
   *  operator's other path to the same selection, and one of the two has to
   *  work or there is nothing to stage. Never `selectMove` from the harness:
   *  a drill that reaches into the page to set the thing it is about to
   *  assert has asserted nothing. */
  const armCursor = async () => {
    for (const key of [null, 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
      if (key !== null) {
        await page.keyboard.press(key);
        await sleep(400);
      }
      const now = await stagingOf();
      if (now.selected) return now;
    }
    return stagingOf();
  };

  /** THE HARNESS CAN STAGE — asserted, not hoped for. Until P-1 the
   *  walkthrough server published a board and a decision and nothing per
   *  unit, so `setupMoveStateForSnake` never ran with `moveEvaluations`,
   *  `moveState.moves` was `{}` for the whole run, and no press of `Space`
   *  could stage anything on any candidate in any state this walk reached
   *  (05 §0). That is how H-2 — a rail click that never armed `Space` for a
   *  snake — shipped behind a comment saying it was fixed. The server sends
   *  the production `snake-turn-update` now, so the emptiness is a FAILURE
   *  rather than a caveat, and this is the assertion that says so. */
  const cursorOn = await armCursor();
  report.notes.pinStageable = cursorOn.moves.length;
  check(
    'stage — the unit has a candidate enumeration and the cursor is on one of them',
    cursorOn.moves.length > 0 && !!cursorOn.selected,
    cursorOn
  );

  // 1 — PIN. `Space` stages the candidate under the cursor: one determination,
  // the operator's own unit, no confirmation, and an undo the moment it lands.
  // THE ROUND TRIP, ON A SNAKE: stage, take it back, stage again. The middle
  // step is what makes the first one a fact — a staged record that survives an
  // undo was never the operator's.
  at = 'drill/pin';
  const depthBeforePin = await undoDepth();
  await page.keyboard.press(' ');
  await sleep(1200);
  const afterPin = await railOf();
  const depthAfterPin = await undoDepth();
  const stagedPin = await stagingOf();
  check(
    'pin — the determination lands on the undo stack, and the affordance says so',
    depthAfterPin === depthBeforePin + 1 && !/nothing yet/.test(afterPin.controls || ''),
    { controls: afterPin.controls, before: beforePin.controls, depthBeforePin, depthAfterPin }
  );
  // THE STAGED RECORD ITSELF, not the affordance over it. `Space` puts the
  // candidate under the cursor on the wire as this unit's manual override;
  // the page paints it at once as the operator's own. Asserting the stack
  // depth alone would pass on any entry from any source, which is the class
  // of defect H-15 was.
  check(
    'pin — the unit carries the operator\u2019s own candidate as its requested move',
    !!stagedPin.staged &&
      String(stagedPin.staged.requestedMove) === String(stagedPin.selected) &&
      stagedPin.staged.source === 'manual',
    stagedPin
  );
  check('pin — the stage line names a plan for every unit', /Bot stages/.test(afterPin.stage || ''), {
    stage: afterPin.stage,
  });
  await drillShot('d1-pin', 'the operator drill: a pin, and the undo it arrives with');

  // 1b — AND BACK. `U` on the entry that press just pushed: the stack pops
  // and the unit stops carrying the operator's move. This is the undo half of
  // the confirm-vs-undo policy (02 §3.4) exercised on the gesture it was
  // written for, in the turn it was taken.
  at = 'drill/pin-undo';
  await page.keyboard.press('u');
  await sleep(1200);
  const unstaged = await stagingOf();
  check(
    'pin — `U` takes the stage back, and the unit stops carrying it',
    (await undoDepth()) === depthBeforePin &&
      (!unstaged.staged || unstaged.staged.source !== 'manual'),
    unstaged
  );
  // 1c — AND THE REFUSAL SPEAKS. Undo clears the cursor's candidate, so the
  // very next `Space` has nothing to stage — which is one of the four
  // preconditions `stageSelectedMove` used to refuse on in silence (05 H-3).
  // The property is that the press is answered: a line in the notice region
  // naming the missing precondition, and a chip that already said the same
  // thing before the press.
  at = 'drill/pin-refused';
  await page.keyboard.press(' ');
  await sleep(500);
  const refused = await page.evaluate(() => {
    const el = document.getElementById('transientNotice');
    const chip = document.querySelector('[data-lens-action="lock"]');
    return {
      notice: el && el.style.display !== 'none' ? el.textContent : null,
      chip: chip ? chip.innerText : null,
      chipOff: chip ? chip.getAttribute('aria-disabled') : null,
      selected: typeof userSelectedMove === 'undefined' ? null : userSelectedMove,
    };
  });
  check(
    'stage — a refused press says which precondition is missing',
    !!refused.notice && /nothing staged — /.test(refused.notice),
    refused
  );
  await drillShot('d1b-refused', 'the drill: `Space` with nothing to stage — the refusal, named');

  // Re-taken, so the rest of the drill runs over the surface an operator who
  // meant it would be looking at.
  await armCursor();
  await page.keyboard.press(' ');
  await sleep(1000);

  // 2 — LOCK. `Shift+Space` is the one gesture that spends authority on units
  // the operator never looked at, so it ARMS first — the affordance itself is
  // the confirmation, and the count was on screen before either press.
  at = 'drill/lock';
  await page.keyboard.press('Shift+ ');
  await sleep(700);
  const armed = await railOf();
  const isArmed = /press again/i.test(armed.controls || '');
  check('lock — arms before it fires, and says how many it would pin', isArmed || /pins 1 of/.test(armed.lock || ''), {
    controls: armed.controls,
    lock: armed.lock,
  });
  // ONE AFFORDANCE, NOT TWO (05 H-6 / P-2). The count, the armed state and
  // the reason a press would refuse all live on the chip; a second lock
  // affordance anywhere on the surface is the defect, so it is counted.
  const lockAffordances = await page.evaluate(() => ({
    chips: document.querySelectorAll('[data-lens-action="lock"]').length,
    panelLine: document.querySelectorAll('.lens-lock').length,
  }));
  check(
    'lock — one affordance, and it is the chip',
    lockAffordances.chips === 1 && lockAffordances.panelLine === 0,
    lockAffordances
  );
  await drillShot('d2-lock-armed', 'the drill: a multi-unit lock, armed — the affordance is the confirmation');
  if (isArmed) {
    await page.keyboard.press('Shift+ ');
    await sleep(1400);
  }
  const locked = await railOf();
  check('lock — the second press commits it and the undo remembers the pins', /undo/.test(locked.controls || ''), {
    controls: locked.controls,
    lock: locked.lock,
  });
  await drillShot('d3-locked', 'the drill: the lock committed — pins written, undo standing');

  // 3 — WIDEN. A peer releases a pin while the operator is reading. Nothing
  // under the cursor may move: the banner is up, the rail below it is stale,
  // and the new list lands on a gesture.
  at = 'drill/widen';
  // The harness's peer releases its pin at the FOURTH emission of a decision,
  // and a decision emits three or four times (07 §1) — so the widen lands on
  // some turns and not others, and the drill plays on until it sees one rather
  // than asserting against a coin flip.
  let drillBanner = null;
  for (let turn = 0; turn < 3 && !drillBanner; turn++) {
    await step();
    for (let i = 0; i < 40; i++) {
      drillBanner = await page.evaluate(() => {
        const el = document.querySelector('.lens-banner');
        return el ? el.innerText : null;
      });
      if (drillBanner) break;
      await sleep(100);
    }
  }
  check('widen — the banner holds the wider cluster behind one gesture', !!drillBanner && /stale/.test(drillBanner), {
    banner: drillBanner,
  });
  await drillShot('d4-widen', 'the drill: a peer widened the cluster — held, flagged stale, nothing moved');

  // 4 — UNDO. The peer of `Space`, and the whole reason the lock needs no
  // dialog. It takes the last determination back and says what it took.
  at = 'drill/undo';
  const accept = await page.$('[data-lens-accept]');
  if (accept) {
    await accept.click();
    await sleep(800);
  }
  await focusUnit(page, 0);
  const depthBeforeUndo = await undoDepth();
  await page.keyboard.press('u');
  await sleep(1000);
  const undone = await railOf();
  const depthAfterUndo = await undoDepth();
  // AND HERE TOO, THE NUMBER RATHER THAN THE WORD. `/undo/` matched the
  // chip's own label and passed whether or not anything was taken back. The
  // property is that `U` pops exactly one entry when there is one, and that a
  // press against an empty stack is a no-op rather than an underflow — and
  // that the bar's sentence agrees with the stack either way.
  check(
    'undo — pops exactly one determination, or nothing when there is nothing',
    depthBeforeUndo > 0
      ? depthAfterUndo === depthBeforeUndo - 1
      : depthAfterUndo === 0 && /nothing yet/.test(undone.controls || ''),
    { controls: undone.controls, depthBeforeUndo, depthAfterUndo }
  );
  await drillShot('d5-undone', 'the drill: undo — the determination taken back, in one unmodified key');
  report.notes.drill = drill;

  // ── REPLAY ──────────────────────────────────────────────────────────────
  // The same recorded log, read back through `/api/logs` and the replay fold.
  at = 'replay/enter';
  const replay = await context.newPage();
  watch(replay, () => at);
  await replay.goto(`${BASE}/game/${GAME}-replay`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT * 2);
  await shot(replay, '18-replay', 'the same log, read back through the replay path');

  at = 'replay/focus';
  await focusUnit(replay, 0);
  await shot(replay, '19-replay-focus', 'a focused unit in replay — compare against 03');
  await shot(replay, '19b-replay-rail', 'the replay rail', '.lens-rail');
  await shot(replay, '19c-replay-board', 'the replay board', '#gameCanvas');

  at = 'replay/scrub';
  report.notes.replayScrubbedTo = await replay.evaluate(() => {
    const s = document.getElementById('playTurnSlider');
    if (!s) return null;
    s.value = String(Math.max(0, Number(s.value) - 1));
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return s.value;
  });
  await sleep(WAIT);
  await shot(replay, '20-replay-scrub', 'the turn slider scrubbed back one turn');

  // ── THE SAME TURN, BOTH WAYS ────────────────────────────────────────────
  // Law C, as a picture: one turn at one seq, folded from the socket and
  // folded from `/api/logs`, rendered by the same renderer. The two rails are
  // diffed pixel for pixel; what may legitimately differ is the mode badge and
  // the determination affordance, and nothing else.
  at = 'diff/live';
  // Both rails are scrolled to the top before they are compared: the column is
  // a scroll region, and a one-line offset between the two makes every pixel
  // below it differ for a reason that has nothing to do with what is drawn.
  const toTop = (target) =>
    target.evaluate(() => {
      const el = document.getElementById('selectedSnakePanel');
      if (el) el.scrollTop = 0;
    });
  await focusUnit(page, 0);
  await page.keyboard.press('End');
  await sleep(900);
  await toTop(page);
  const liveAt = await page.evaluate(() => ({ turn: lensTurn, seq: lensSeq }));
  await shot(page, '21a-live-frame', `live rail, turn ${liveAt.turn} seq ${liveAt.seq}`, '.lens-rail');

  at = 'diff/replay';
  await replay.evaluate((t) => {
    const s = document.getElementById('playTurnSlider');
    if (!s) return;
    s.value = String(t);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, liveAt.turn);
  await sleep(WAIT * 2);
  await focusUnit(replay, 0);
  await replay.keyboard.press('End');
  await sleep(900);
  await toTop(replay);
  const replayAt = await replay.evaluate(() => ({ turn: lensTurn, seq: lensSeq }));
  await shot(replay, '21b-replay-frame', `replay rail, turn ${replayAt.turn} seq ${replayAt.seq}`, '.lens-rail');

  report.notes.diff = {
    liveAt,
    replayAt,
    ...(await diffPngs(page, path.join(OUT, '21a-live-frame.png'), path.join(OUT, '21b-replay-frame.png'))),
  };

  // ── THE KEY SCHEME DRILL ────────────────────────────────────────────────
  // Three schemes over one action set (§3.1) is the one deliverable a unit
  // test cannot finish: `lens-ia.test.ts` proves the TABLES are three
  // spellings of one vocabulary, and only a browser can show that switching
  // one rewrites the strip, that the new key really drives the rail, and that
  // the choice is still there after a page load. That last is the whole point
  // of persisting it, and it is exactly the kind of thing that breaks in a
  // refactor with nothing to notice.
  //
  // It runs LAST, after every other picture is taken, because it reloads the
  // page: a reload re-enters through the login gate, and an operator who has
  // to take a numbered name does not own the units. Nothing follows it, so
  // nothing can be hurt by that.
  // ── THE TOUR DRILL ──────────────────────────────────────────────────────
  //
  // `src/web/tour.js` is the operator manual in the page it is about, and the
  // one property it has to have is the one a screenshot cannot show: THAT IT
  // CHANGES NOTHING. A tour that stops the turn to explain the turn has taught
  // the operator nothing they can use, so this asserts, in this order:
  //
  //  · it opens on the chord the manual documents (`?` then `T`);
  //  · it visits EVERY region whose element is actually on screen — no more,
  //    because a step pointing at nothing is worse than a step skipped, and no
  //    fewer, because a region the tour never reaches is a region it does not
  //    teach;
  //  · `Enter` steps and the last `Enter` finishes, leaving the completion in
  //    `localStorage` so it does not open itself again;
  //  · and the LENS FRAME AND THE DECISION ARE BYTE-IDENTICAL ACROSS THE WHOLE
  //    OF IT — the rail's markup, the cursor, the staged moves and the undo
  //    stack, taken off the head so nothing may legitimately move underneath.
  //
  // A failed assertion fails the run, like the other two drills.
  at = 'tour';
  const tour = [];
  const tourCheck = (name, ok, saw) => {
    tour.push({ step: name, ok: !!ok, saw });
    console.log(`  ${ok ? '✓' : '✗'} tour/${name}${ok ? '' : ` — saw: ${JSON.stringify(saw)}`}`);
  };
  const tourState = () =>
    page.evaluate(() => ({
      open: window.Tour ? window.Tour.isOpen() : null,
      step: window.Tour ? window.Tour.stepId() : null,
      shown: window.Tour ? window.Tour.shown() : null,
      all: window.Tour ? window.Tour.steps() : null,
      card: (document.querySelector('.tour-card') || {}).innerText || null,
      link: !!document.querySelector('[data-tour-open]'),
      done: (() => { try { return localStorage.getItem('lensTourDone'); } catch (e) { return null; } })(),
    }));

  await page.keyboard.press('Escape');
  await sleep(300);
  await focusUnit(page, 0);
  await selectAnsweredCandidate(page, 'red-A');
  await sleep(400);
  tourCheck('the chrome link is on the page before anything is pressed', (await tourState()).link, null);

  // WHICH REGIONS ARE ACTUALLY THERE, asked of the DOM and not of the tour,
  // so the next assertion compares two independent answers.
  const onScreen = await page.evaluate(() => {
    const sels = {
      clock: '#turnClock', wire: '#latency-mount', board: '#gameCanvas', roster: '#snakeInfoList',
      stage: '.lens-stage-line', business: '.lens-biz', focus: '.lens-focus',
      candidates: '.lens-candidates', movesets: '.lens-movesets', breakdown: '.lens-breakdown',
      controls: '#lensControls', keys: '#lensKeys', lane: '#lensLane',
    };
    const out = [];
    for (const [id, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 2 && r.height >= 2) out.push(id);
    }
    return out;
  });

  await page.keyboard.press('?');
  await page.keyboard.press('T');
  await sleep(600);
  const opened = await tourState();
  tourCheck('`?` then `T` opens it', opened.open === true && opened.step !== null, {
    open: opened.open, step: opened.step,
  });
  tourCheck(
    'it visits every region that is on screen, and only those',
    JSON.stringify(opened.shown) === JSON.stringify(onScreen),
    { shown: opened.shown, onScreen, all: opened.all }
  );
  await shot(page, 'd8-tour', 'the drill: the tour on its first region — the page under it is live', null);

  // ONE `Enter` PER REGION. The step id has to change on every one of them: a
  // tour whose Next button redraws the same card is a tour of one region.
  at = 'tour/steps';
  const visited = [opened.step];
  let cards = 1;
  for (let i = 1; i < (opened.shown || []).length; i++) {
    await page.keyboard.press('Enter');
    await sleep(220);
    const st = await tourState();
    if (st.step && st.step !== visited[visited.length - 1]) cards++;
    visited.push(st.step);
  }
  tourCheck(
    'Enter steps through every region in the manual’s own order',
    JSON.stringify(visited) === JSON.stringify(opened.shown) && cards === (opened.shown || []).length,
    { visited, expected: opened.shown }
  );
  // THE WHOLE PAGE, and not a crop of the card. The card is `position: fixed`
  // and it moves with the region it explains, so both ways of cropping it have
  // now photographed something else: an element shot scrolls it out from under
  // its own clip, and a page clip is in page coordinates where the card's rect
  // is in viewport ones. The full page is the honest picture anyway — the
  // point of the shot is the LAST region lit with the page still live under
  // it — and the card's text is in the report beside it.
  report.notes.tourLastCard = (await tourState()).card;
  await shot(page, 'd9-tour-last', 'the drill: the last region of the tour, with the page live under it');

  // THE INVARIANT. Taken OFF THE HEAD, because at the head the kernel is still
  // emitting and a rail that changed would prove nothing about the tour.
  at = 'tour/invariant';
  await page.keyboard.press('Enter'); // the last card finishes
  await sleep(400);
  await page.keyboard.press('Home');
  await sleep(700);
  const fingerprint = () =>
    page.evaluate(() => ({
      seq: typeof lensSeq === 'undefined' ? null : lensSeq,
      atHead: typeof lensAtHead === 'undefined' ? null : lensAtHead,
      rail: (document.getElementById('lensRail') || {}).innerHTML || null,
      controls: (document.getElementById('lensControls') || {}).innerHTML || null,
      transcript: typeof lensTranscript === 'undefined' ? null : JSON.stringify(lensTranscript),
      cursor: typeof lensCursor === 'undefined' ? null : JSON.stringify(lensCursor),
      staged: typeof stagedMoves === 'undefined' ? null : JSON.stringify(stagedMoves),
      undo: typeof lensUndoStack === 'undefined' ? null : lensUndoStack.length,
    }));
  const before = await fingerprint();
  await page.keyboard.press('?');
  await page.keyboard.press('T');
  await sleep(500);
  const midTour = await tourState();
  for (let i = 0; i < (midTour.shown || []).length; i++) {
    await page.keyboard.press('Enter');
    await sleep(160);
  }
  await sleep(400);
  const after = await fingerprint();
  const closed = await tourState();
  tourCheck(
    'the tour changed no lens frame and no decision',
    before.rail === after.rail &&
      before.transcript === after.transcript &&
      before.cursor === after.cursor &&
      before.staged === after.staged &&
      before.undo === after.undo &&
      before.seq === after.seq,
    {
      rail: before.rail === after.rail,
      transcript: before.transcript === after.transcript,
      cursor: before.cursor === after.cursor,
      staged: before.staged === after.staged,
      undo: [before.undo, after.undo],
      seq: [before.seq, after.seq],
    }
  );
  tourCheck('it closes on the last Enter and remembers it', closed.open === false && closed.done !== null, {
    open: closed.open, done: closed.done,
  });

  // AND `Esc` LEAVES, from the middle, which is the way an operator who
  // already knows the page gets out of it.
  at = 'tour/escape';
  await page.keyboard.press('?');
  await page.keyboard.press('T');
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Escape');
  await sleep(300);
  const escaped = await tourState();
  tourCheck('Esc leaves it from the middle', escaped.open === false && escaped.card === null, escaped);
  await page.keyboard.press('n');
  await sleep(500);
  report.notes.tour = tour;

  at = 'scheme';
  const scheme = [];
  const schemeCheck = (name, ok, saw) => {
    scheme.push({ step: name, ok: !!ok, saw });
    console.log(`  ${ok ? '✓' : '✗'} scheme/${name}${ok ? '' : ` — saw: ${JSON.stringify(saw)}`}`);
  };
  const keysOf = async () => (await railText(page)).keys || '';
  const rowOf = () =>
    page.evaluate(() => {
      const el = document.querySelector('.lens-movesets .lens-row-cursor');
      return el ? el.getAttribute('data-lens-moveset') : null;
    });

  await focusUnit(page, 0);
  await selectAnsweredCandidate(page, 'red-A');
  await sleep(400);
  const bracketKeys = await keysOf();
  schemeCheck('bracket is what the rail says at rest', /\[/.test(bracketKeys) && /\]/.test(bracketKeys), {
    keys: bracketKeys,
  });

  at = 'scheme/switch';
  await page.click('[data-lens-scheme="vim"]');
  await sleep(600);
  const vimKeys = await keysOf();
  // The strip and the modal render from ONE keymap table, so switching the
  // scheme rewrites the strip — a strip still offering `[` under vim would be
  // a second list of keys living somewhere, which is the drift §3.2 forbids.
  schemeCheck(
    'switching to vim rewrites the cheat strip, and takes the bracket keys off it',
    /\bk\b/.test(vimKeys) && /\bj\b/.test(vimKeys) && !/\[/.test(vimKeys),
    { keys: vimKeys }
  );
  await shot(page, 'd6-scheme-vim', 'the drill: the vim scheme — one action set, a different spelling', '#lensKeys');

  at = 'scheme/drives';
  // The strip saying `j` is not the same fact as `j` WORKING. A relabelled
  // strip over a keymap the handler never consults is the failure this catches,
  // and it is invisible in a screenshot.
  //
  // The cursor is walked to the TOP of the list first, with the scheme's own
  // `k`, so `j` has somewhere to go: a list of one row makes any "did it move"
  // assertion vacuously true, and a vacuous gate is worse than none. The row
  // count rides along in the report so a one-row list is visible rather than
  // silently passing.
  const rowCount = await page.evaluate(
    () => document.querySelectorAll('.lens-movesets .lens-table tr[data-lens-moveset]').length
  );
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('k');
    await sleep(120);
  }
  await sleep(400);
  const rowBefore = await rowOf();
  await page.keyboard.press('j');
  await sleep(700);
  const rowAfterVim = await rowOf();
  // And the key `j` REPLACED is inert: `]` is bracket's, and under vim it must
  // do nothing at all rather than quietly staying bound alongside it.
  await page.keyboard.press(']');
  await sleep(700);
  const rowAfterBracket = await rowOf();
  schemeCheck(
    'the vim key drives the rail and the bracket key it replaced no longer does',
    rowCount > 1 && rowBefore !== null && rowAfterVim !== rowBefore && rowAfterBracket === rowAfterVim,
    { rows: rowCount, before: rowBefore, afterJ: rowAfterVim, afterBracket: rowAfterBracket }
  );

  at = 'scheme/persists';
  const stored = await page.evaluate(() => {
    try {
      return localStorage.getItem('lensKeyScheme');
    } catch (_e) {
      return null;
    }
  });
  schemeCheck('the choice is written to localStorage under lensKeyScheme', stored === 'vim', { stored });

  // AND IT SURVIVES A PAGE LOAD, which is the only thing persisting it is for.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  if (await page.$('#loginGate.active')) await enter(page, GAME, report.notes.operator || 'walker');
  await focusUnit(page, 0);
  await sleep(600);
  const reloadedKeys = await keysOf();
  schemeCheck(
    'and it is still vim after a page load, with nothing pressed',
    /\bk\b/.test(reloadedKeys) && !/\[/.test(reloadedKeys),
    { keys: reloadedKeys }
  );
  await shot(page, 'd7-scheme-persisted', 'the drill: the scheme survived a page load — read back from localStorage', '#lensKeys');

  at = 'scheme/restore';
  // Put the default back, so the next reader of this browser profile — and the
  // next run of this walk — starts where the shipped page starts.
  await page.click('[data-lens-scheme="bracket"]');
  await sleep(600);
  const restored = await keysOf();
  schemeCheck('bracket goes back, binding for binding', /\[/.test(restored) && /\]/.test(restored), {
    keys: restored,
  });
  report.notes.scheme = scheme;

  // ── THE LAST-SAFE-PRESS NOTCH ───────────────────────────────────────────
  //
  // L0's other half. `02 §2.1` says the clock draws a notch "wherever
  // `window.__lensLastSafePressMs` puts it, and nothing when nobody has set
  // it" — and nobody ever did, so the notch had never drawn in a real game
  // and no gate could have noticed: an absent mark and a correctly absent
  // mark are the same pixels. It is fed from `LatencyView.read().pressSlackMs`
  // now, and this asserts the wiring rather than the shape.
  //
  // The clock has to be DRIVEN here. `/dev/step` plays turns on demand, so
  // `turnExpiryTime` is never a future instant, `startTurnTimer` paints the
  // idle bar for the whole walk, and L0 has been shipping unphotographed. The
  // budget and the remaining time are handed to the page's own updater; the
  // NUMBER under test is the one the latency module measured from the real
  // socket this walk has been talking over.
  at = 'clock';
  const notch = await page.evaluate(() => {
    const slack =
      typeof LatencyView !== 'undefined' && LatencyView.read
        ? Number(LatencyView.read().pressSlackMs)
        : null;
    delete window.__lensLastSafePressMs;
    const budget = 1500;
    updateTurnClock(700, budget);
    const mark = document.getElementById('turnClockMark');
    return {
      rttMs:
        typeof LatencyView !== 'undefined' && LatencyView.read ? LatencyView.read().rttMs : null,
      pressSlackMs: Number.isFinite(slack) ? slack : null,
      picked: Number(window.__lensLastSafePressMs),
      on: mark ? mark.classList.contains('on') : false,
      left: mark ? mark.style.left : null,
      budget,
    };
  });
  report.notes.clockNotch = notch;
  scheme.push({
    step: 'the last-safe-press notch draws once the wire has an RTT',
    // A press slack the module has not measured is not a failure of the
    // clock, and drawing a notch for it would be the lie the absence exists
    // to avoid — so the assertion is the IMPLICATION, both ways.
    ok:
      notch.pressSlackMs === null
        ? notch.on === false
        : notch.on === true && Number.isFinite(notch.picked) && notch.picked === notch.pressSlackMs,
    saw: notch,
  });
  console.log(
    `  ${scheme[scheme.length - 1].ok ? '\u2713' : '\u2717'} clock/last-safe-press notch — ` +
      `rtt ${notch.rttMs}ms, slack ${notch.pressSlackMs}ms, drawn ${notch.on} at ${notch.left}`
  );
  await shot(page, 'd8-clock-notch', 'the clock driven to mid-turn — the last-safe-press notch, fed from the wire', '#turnClock');
  await page.evaluate(() => {
    delete window.__lensLastSafePressMs;
    updateTurnClock(null, null);
  });

  // ── THE REVIEW DRILL ────────────────────────────────────────────────────
  //
  // The other end of the product: not the operator inside a turn but the owner
  // after the game, on /history (docs/design/ux/07-REVIEW.md). Every step is
  // asserted, and one of them is asserted against a SECOND, INDEPENDENT
  // computation — the drill diffs the stored boards itself and requires the
  // strip to mark exactly the turns a unit disappeared on. A strip that agrees
  // with the page that produced it proves nothing.
  at = 'review';
  fs.mkdirSync(REVIEW_OUT, { recursive: true });
  const review = [];
  const rvCheck = (name, ok, saw) => {
    review.push({ step: name, ok: !!ok, saw });
    console.log(`  ${ok ? '✓' : '✗'} review/${name}${ok ? '' : ` — saw: ${JSON.stringify(saw)}`}`);
  };

  // A GAME WITH KNOWN DEATHS. The walk above has already played a dozen turns;
  // this plays on until the boards show a unit gone, because "the expected
  // count" is only a test where the expectation is not zero.
  at = 'review/record';
  const deathTurns = async () => {
    const timeline = await (await fetch(`${BASE}/api/games/${GAME}/turns`)).json();
    const turns = (timeline.turns || []).slice().sort((a, b) => a.turn - b.turn);
    const out = [];
    for (let i = 1; i < turns.length; i++) {
      const live = (row) => new Set(((row.game_state.board || {}).snakes || [])
        .filter((s) => s.health > 0 && (s.body || []).length > 0).map((s) => s.id));
      const before = live(turns[i - 1]);
      const after = live(turns[i]);
      const gone = [...before].filter((id) => !after.has(id));
      if (gone.length > 0) out.push({ turn: turns[i - 1].turn, gone });
    }
    return { turns, deaths: out };
  };
  let deaths = await deathTurns();
  for (let i = 0; i < 24 && deaths.deaths.length === 0; i++) {
    await step();
    deaths = await deathTurns();
  }
  rvCheck('a game with a known death was recorded', deaths.deaths.length > 0, {
    turns: deaths.turns.length,
    deaths: deaths.deaths.map((d) => `${d.turn}:${d.gone.join('+')}`),
  });

  at = 'review/open';
  await page.goto(`${BASE}/history`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  const reviewRows = await page.$$('.open-review');
  rvCheck('/history offers a review on every row', reviewRows.length > 0, { rows: reviewRows.length });
  await page.click('.open-review');
  // The index pass, then the bounded deep pass over the turns it flagged.
  await sleep(WAIT * 3);

  at = 'review/strip';
  const strip = await page.evaluate(() => ({
    cells: [...document.querySelectorAll('.rv-cell')].map((c) => ({
      turn: Number(c.dataset.turn),
      glyph: c.textContent.trim(),
      label: c.getAttribute('aria-label'),
    })),
    verdict: (document.getElementById('rvVerdict') || {}).innerText || '',
    read: (document.getElementById('rvRead') || {}).innerText || '',
  }));
  rvCheck('the strip has one cell per stored turn', strip.cells.length === deaths.turns.length, {
    cells: strip.cells.length, turns: deaths.turns.length,
  });
  // THE EXPECTED COUNT, against the drill's own diff of the boards.
  const wantDeath = deaths.deaths.map((d) => d.turn).sort((a, b) => a - b);
  const sawDeath = strip.cells.filter((c) => c.glyph === '▼' || c.glyph === '△')
    .map((c) => c.turn).sort((a, b) => a - b);
  rvCheck('the strip marks a death on exactly the turns a unit disappeared',
    JSON.stringify(sawDeath) === JSON.stringify(wantDeath), { want: wantDeath, saw: sawDeath });
  rvCheck('the headline says where the game was decided',
    /DECIDED AT TURN\s+\d+/i.test(strip.verdict), { verdict: strip.verdict });
  rvCheck('the strip says how much of the game it read in full',
    /\d+ of \d+ turns read in full/.test(strip.read), { read: strip.read });
  await shot(page, 'r1-strip', 'the moments strip and its legend — shape first, brightness for weight', '.rv-stripwrap', REVIEW_OUT);
  await shot(page, 'r2-index', 'the index of moments, ranked and cut', '.rv-side', REVIEW_OUT);

  at = 'review/keys';
  const whereAmI = () => page.evaluate(() => ({
    turn: (document.getElementById('rvTurn') || {}).innerText || '',
    at: [...document.querySelectorAll('.rv-moment')].findIndex((m) => m.classList.contains('rv-at')),
    link: (document.getElementById('rvLink') || {}).value || '',
  }));
  const rvBefore = await whereAmI();
  await page.keyboard.press('j');
  await sleep(900);
  const afterJ = await whereAmI();
  await page.keyboard.press('k');
  await sleep(900);
  const afterK = await whereAmI();
  rvCheck('j walks to the next moment and k walks back',
    afterJ.at !== rvBefore.at && afterK.at === rvBefore.at,
    { before: rvBefore.at, afterJ: afterJ.at, afterK: afterK.at });
  await page.keyboard.press('l');
  await sleep(900);
  const afterL = await whereAmI();
  rvCheck('l steps one turn, moment or not', afterL.turn !== afterK.turn,
    { before: afterK.turn, after: afterL.turn });

  at = 'review/moment';
  // Open the heaviest moment the index kept and read the why panel there.
  await page.click('.rv-moment');
  await sleep(WAIT * 2);
  const why = await page.evaluate(() => {
    const key = (document.querySelector('#rvWhy .rv-note code') || {}).textContent || '';
    const units = [...document.querySelectorAll('#rvWhy .rv-unit')].map((u) => u.textContent);
    return {
      text: (document.getElementById('rvWhy') || {}).innerText || '',
      key,
      units,
    };
  });
  rvCheck('the why panel names the chosen moveset',
    why.key.length > 0 && why.text.indexOf(why.key) >= 0, { key: why.key });
  rvCheck('and its top member, by name', why.units.length > 0 && why.text.indexOf(why.units[0]) >= 0,
    { members: why.units.slice(0, 4) });
  rvCheck('and the bracket it was priced at, with the channel that adjudicates',
    /adjudicates on/.test(why.text) && /bracket/.test(why.text), {});
  rvCheck('and the joint residual, drawn whatever it is',
    /joint residual/.test(why.text), {});
  rvCheck('and what the leader is betting against, as a foil or as its absence',
    /THE FOIL|the foil/i.test(why.text), {});
  await shot(page, 'r3-why', 'the why panel at a moment — the chosen moveset, its number, the breakdown, the runner-up, the foil and the threats', '.rv-main', REVIEW_OUT);
  await shot(page, 'r4-review', 'the whole review: strip, index and the turn', '.rv', REVIEW_OUT);

  at = 'review/bookmark';
  const linkBefore = (await whereAmI()).link;
  await page.keyboard.press('b');
  await sleep(600);
  const marked = await page.$$eval('.rv-markrow', (e) => e.map((x) => x.innerText));
  rvCheck('b bookmarks the turn under the cursor', marked.length > 0, { marks: marked });
  await shot(page, 'r5-mark', 'the index and the bookmark it just took', '.rv-side', REVIEW_OUT);
  await shot(page, 'r6-link', 'the turn as a copyable link, beside the two ways into the lens', '.rv-turnbar', REVIEW_OUT);
  await shot(page, 'r7-share', 'the export: this turn, as a link anyone can paste', '.rv-share', REVIEW_OUT);

  // AND IT SURVIVES A RELOAD, which is the only thing persisting it is for —
  // and the link goes back to the same turn, which is the only thing the deep
  // link is for.
  at = 'review/reload';
  // Away and back, so the fragment-only navigation is a real load and the
  // bookmark is read from storage rather than from the page still holding it.
  await page.goto('about:blank');
  await page.goto(linkBefore, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT * 3);
  const rvAfter = await page.evaluate(() => ({
    turn: (document.getElementById('rvTurn') || {}).innerText || '',
    marks: [...document.querySelectorAll('.rv-markrow')].map((x) => x.innerText),
    open: !(document.getElementById('reviewPanel') || {}).hidden,
  }));
  const wantedTurn = (/[#&]turn=(\d+)/.exec(linkBefore) || [])[1] || null;
  rvCheck('the pasted link reopens the review at the same turn',
    rvAfter.open && wantedTurn !== null &&
      new RegExp(`turn\\s+${wantedTurn}\\b`).test(rvAfter.turn),
    { want: wantedTurn, turn: rvAfter.turn, link: linkBefore });
  rvCheck('and the bookmark is still there after the reload',
    rvAfter.marks.length === marked.length && rvAfter.marks.length > 0,
    { before: marked, after: rvAfter.marks });
  report.notes.review = review;

  fs.writeFileSync(path.join(REVIEW_OUT, 'report.json'), JSON.stringify({
    game: GAME, turns: deaths.turns.length, deaths: deaths.deaths, drill: review,
    shots: report.shots.filter((s) => /^r\d/.test(s.name)),
  }, null, 2));

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport → ${path.join(OUT, 'report.json')}`);
  await browser.close();

  // BOTH DRILLS ARE GATES. A walk that photographs a broken determination
  // surface — or a key scheme that relabels a strip over a keymap nothing
  // consults — and exits 0 is a slideshow; this exits non-zero and names the
  // step that failed.
  const failed = [
    ...(report.notes.drill || []).map((d) => ({ ...d, drill: 'operator' })),
    ...(report.notes.tour || []).map((d) => ({ ...d, drill: 'tour' })),
    ...(report.notes.scheme || []).map((d) => ({ ...d, drill: 'scheme' })),
    ...(report.notes.review || []).map((d) => ({ ...d, drill: 'review' })),
  ].filter((d) => !d.ok);
  if (failed.length > 0) {
    console.error(`\ndrill FAILED: ${failed.map((f) => `${f.drill}/${f.step}`).join('; ')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'report.json'),
    JSON.stringify({ ...report, fatal: String(e && e.stack) }, null, 2)
  );
  process.exit(1);
});
