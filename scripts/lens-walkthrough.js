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
  /** THE STAGED ARROW'S OPERATOR, photographed off the frame the page is
   *  holding at the one moment in the whole walk when a named operator has
   *  staged something (11-MOTION-AND-MARKS.md §6.2). It is READ here and
   *  ASSERTED in `motion/marks`, where the rest of P-4 is, because a second
   *  determination taken later would put a moment in the harness's own game
   *  log that the review drill then photographs — a drill must not change the
   *  game it is walking through. */
  const stagedArrowFrame = await page.evaluate(() => {
    const live = (typeof stagedMoves === 'undefined' ? null : stagedMoves) || {};
    const decorated = stagedWithMarks(live) || {};
    const me = (connectedUsers || []).find((u) => u.userId === userId) || null;
    return {
      rows: Object.keys(live).map((unit) => {
        const v = live[unit] || {};
        const by = v.by || null;
        return {
          unit,
          source: v.source,
          color: v.color,
          by: by ? { userId: by.userId, name: by.name, color: by.color } : null,
          mark: (decorated[unit] || {}).mark || null,
          fromId: by ? LensPanel.operatorMark(by.userId) : '',
          fromName: by ? LensPanel.operatorMark(by.name) : '',
          fromPalette: by ? window.LensView.markForColor(by.color) : null,
        };
      }),
      me: me ? { userId: me.userId, name: me.name, color: me.color } : null,
      meMark: me ? window.LensView.markForColor(me.color) : null,
      // The renderer draws what the page resolved and nothing else: no
      // palette, no directory, no second opinion about who staged this.
      drawnByTheRenderer: String(BoardRenderer.renderBoard).includes('stagedForThisSnake.mark'),
      rendererHoldsNoPalette:
        !String(BoardRenderer.drawArrowMark).includes('markForColor') &&
        !String(BoardRenderer.drawArrowMark).includes('OPERATOR_MARKS'),
    };
  });
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
  // THE ONE PICTURE OF THE MARK ON THE ARROW. Everywhere else in this walk the
  // board carries bot-sourced arrows, which are nobody's determination and
  // draw exactly the pixels they always did; this is the single frame in which
  // a named operator has staged something, so it is the frame the new ink is
  // photographed in (11-MOTION-AND-MARKS.md §6.2).
  await shot(
    page,
    'd1c-pin-arrow',
    'the drill: the staged arrow wearing the mark of the operator who staged it',
    '#gameCanvas'
  );

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

  // ── THE MOTION DRILL ────────────────────────────────────────────────────
  //
  // `docs/design/ux/11-MOTION-AND-MARKS.md` §8. Motion is not screenshot-
  // testable — a PNG of a transition is a PNG of one moment — so it is
  // asserted the way `06-ALERTS.md` asserts its ring: on the CLASS, on the
  // COMPUTED duration, and on the TOKEN the duration came from. The third is
  // the one that matters: a hard-coded `0.6s` that happens to match the spec
  // today passes a bare duration check and fails the day the token moves, so
  // every assertion here compares the element against `:root`, never against
  // a number written in this file.
  //
  // A failed assertion fails the run, like the other drills.
  at = 'motion';
  // THE WALK'S OWN PAGE, BACK IN FRONT. The replay page above was opened in
  // the same context, which puts this one in the background — and a
  // background tab in Chromium throttles the timers and events a one-shot
  // animation's teardown rides on. Nothing about the surface depends on
  // being foreground; the drill's stopwatch does.
  await page.bringToFront();
  const motion = [];
  const mCheck = (name, ok, saw) => {
    motion.push({ step: name, ok: !!ok, saw });
    console.log(`  ${ok ? '✓' : '✗'} motion/${name}${ok ? '' : ` — saw: ${JSON.stringify(saw)}`}`);
  };

  /** Durations are written as `140ms` in the token and read back as `0.14s`
   *  from `getComputedStyle`. Both go to milliseconds before they meet. */
  const ms = (v) => {
    const t = String(v || '').trim().split(',')[0].trim();
    if (t.endsWith('ms')) return Math.round(parseFloat(t) * 1000) / 1000;
    if (t.endsWith('s')) return Math.round(parseFloat(t) * 1000000) / 1000;
    return NaN;
  };

  /** The five verbs, off `:root`, exactly as the sheet declares them. */
  const verbs = () =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const g = (n) => cs.getPropertyValue(n).trim();
      return {
        enter: g('--motion-enter'),
        exit: g('--motion-exit'),
        emphasis: g('--motion-emphasis'),
        emphasisFade: g('--motion-emphasis-fade'),
        state: g('--motion-state'),
        stateNear: g('--motion-state-near'),
        progress: g('--motion-progress'),
        easeEmphasis: g('--ease-emphasis'),
      };
    });

  const v0 = await verbs();
  mCheck('the vocabulary is declared on :root — five verbs and the fade', [
    v0.enter, v0.exit, v0.emphasis, v0.state, v0.stateNear, v0.progress, v0.emphasisFade,
  ].every((x) => Number.isFinite(ms(x)) && ms(x) > 0), v0);

  // THE REST STATE FIRST, and it is the whole of §8's first claim: the pulse
  // layer does not exist until a widen is accepted, so the resting page is the
  // page it was before this work and the walkthrough's own PNGs still diff
  // clean against the run before it.
  mCheck(
    'rest: no pulse layer on the page',
    (await page.evaluate(() => !document.getElementById('lensPulseLayer'))),
    null
  );

  // EMPHASIS. The pulse is fired on the units the board actually has, which is
  // what `lensAcceptWiden` hands it, and the layer is measured while it is up.
  const pulse = await page.evaluate(() => {
    const board = typeof activeBoard !== "undefined" ? activeBoard() : null;
    const units = board && board.snakes ? board.snakes.slice(0, 2).map((s) => s.id) : [];
    const layer = lensPulseArrival(units);
    if (!layer) return { made: false, units };
    const rings = [...layer.querySelectorAll('.lens-arrival-pulse')];
    const cs = rings[0] ? getComputedStyle(rings[0]) : null;
    const layerCs = getComputedStyle(layer);
    return {
      made: true,
      units,
      rings: rings.length,
      name: cs && cs.animationName,
      duration: cs && cs.animationDuration,
      iterations: cs && cs.animationIterationCount,
      timing: cs && cs.animationTimingFunction,
      pointerEvents: layerCs && layerCs.pointerEvents,
      // §1.1's three conditions, asserted rather than asserted-in-a-comment.
      outOfFlow: layerCs && layerCs.position,
      text: layer.textContent,
    };
  });
  mCheck('emphasis: the pulse draws one ring per arrived unit', pulse.made && pulse.rings === pulse.units.length, pulse);
  mCheck('emphasis: it is the shared keyframe, not a local one', pulse.name === 'motion-arrival', pulse.name);
  mCheck(
    'emphasis: its duration IS --motion-emphasis, read off :root',
    ms(pulse.duration) === ms(v0.emphasis),
    { computed: pulse.duration, token: v0.emphasis }
  );
  mCheck('emphasis: one shot, never a loop', pulse.iterations === '1', pulse.iterations);
  mCheck(
    'emphasis: the layer takes no input and carries no text — what licenses the transform',
    pulse.pointerEvents === 'none' && pulse.outOfFlow === 'absolute' && pulse.text === '',
    pulse
  );
  mCheck(
    'emphasis: the accept path is what fires it',
    (await page.evaluate(() => String(lensAcceptWiden).includes('lensPulseArrival'))),
    null
  );
  await sleep(1400);
  mCheck(
    'emphasis: the layer removes itself, so the rest state is unchanged',
    (await page.evaluate(() => !document.getElementById('lensPulseLayer'))),
    (await page.evaluate(() => document.visibilityState))
  );

  // STATE CHANGE, both registers. The ladder's strip is the peripheral one and
  // the chip is the foveal one; §2.3 is the reason they are two numbers.
  const states = await page.evaluate(() => {
    const strip = document.querySelector('#latency-mount .lat');
    const probe = document.createElement('div');
    probe.className = 'lat-pulse';
    (strip || document.body).appendChild(probe);
    const p = getComputedStyle(probe);
    const out = { pulseName: p.animationName, pulseDuration: p.animationDuration };
    probe.remove();
    const chip = document.querySelector('.lens-aff');
    const tick = document.querySelector('.lens-tick');
    out.chip = chip ? getComputedStyle(chip).transitionDuration : null;
    out.chipProps = chip ? getComputedStyle(chip).transitionProperty : null;
    out.tick = tick ? getComputedStyle(tick).transitionDuration : null;
    out.tickProps = tick ? getComputedStyle(tick).transitionProperty : null;
    const fill = document.getElementById('turnClockFill');
    out.progress = fill ? getComputedStyle(fill).transitionDuration : null;
    return out;
  });
  mCheck('state change: the ladder names the shared keyframe', states.pulseName === 'motion-state-arrive', states.pulseName);
  mCheck(
    'state change (peripheral): the ladder IS --motion-state',
    ms(states.pulseDuration) === ms(v0.state),
    { computed: states.pulseDuration, token: v0.state }
  );
  mCheck(
    'state change (foveal): the chip IS --motion-state-near',
    ms(states.chip) === ms(v0.stateNear),
    { computed: states.chip, token: v0.stateNear }
  );
  mCheck(
    'the rail’s rule: the chip transitions COLOURS ONLY — nothing that reflows',
    !!states.chipProps && !/transform|width|height|padding|margin|font-size|border-width/.test(states.chipProps),
    states.chipProps
  );
  mCheck(
    'state change (foveal): the moments strip’s hover IS --motion-state-near',
    ms(states.tick) === ms(v0.stateNear),
    { computed: states.tick, token: v0.stateNear }
  );
  mCheck(
    'the rail’s rule: the tick transitions opacity only — its transform is its seq',
    states.tickProps === 'opacity',
    states.tickProps
  );

  // ENTER and EXIT, on the one element they were measured on: the alert ring,
  // which `Alerts.install()` puts on `document.body` at load. It is opacity 0
  // and `pointer-events: none`, so toggling its class to read the other half
  // of the pair moves no pixel anyone can see.
  const ring = await page.evaluate(() => {
    const el = document.querySelector('body > .al-pulse');
    if (!el) return null;
    // The ring keeps whatever class its last real alert left on it — by this
    // point in the walk that is usually `off` — so both halves of the pair are
    // read from a KNOWN class list and the original is put back afterwards.
    const was = el.className;
    el.className = 'al-pulse';
    const on = getComputedStyle(el).transitionDuration;
    el.className = 'al-pulse off';
    const off = getComputedStyle(el).transitionDuration;
    el.className = was;
    return { on, off, was };
  });
  mCheck('enter: the alert ring’s onset IS --motion-enter', !!ring && ms(ring.on) === ms(v0.enter), { ring, token: v0.enter });
  mCheck('exit: the alert ring’s decay IS --motion-exit', !!ring && ms(ring.off) === ms(v0.exit), { ring, token: v0.exit });
  mCheck(
    'enter and exit are not the same number — an onset is detected, a decay is landed on',
    !!ring && ms(ring.off) > ms(ring.on) * 3,
    ring
  );

  // REDUCED MOTION. §4's semantics, and the asymmetry is the assertion: four
  // verbs go instant and the fifth STAYS, as a single fade with no transform
  // at all. A blanket "everything is 0s" check would pass a page that had
  // quietly deleted the arrival pulse, which is the outcome §4 argues against.
  at = 'motion/reduced';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sleep(200);
  const vR = await verbs();
  mCheck(
    'reduced motion: enter, exit, state, state-near and progress are all instant',
    [vR.enter, vR.exit, vR.state, vR.stateNear, vR.progress].every((x) => ms(x) === 0),
    vR
  );
  mCheck('reduced motion: the fade duration is untouched', ms(vR.emphasisFade) === ms(v0.emphasisFade), vR.emphasisFade);
  const rPulse = await page.evaluate(() => {
    const board = typeof activeBoard !== "undefined" ? activeBoard() : null;
    const units = board && board.snakes ? board.snakes.slice(0, 1).map((s) => s.id) : [];
    const layer = lensPulseArrival(units);
    if (!layer) return null;
    const el = layer.querySelector('.lens-arrival-pulse');
    const cs = getComputedStyle(el);
    return {
      name: cs.animationName,
      duration: cs.animationDuration,
      iterations: cs.animationIterationCount,
      transform: cs.transform,
    };
  });
  mCheck('reduced motion: the pulse is NOT deleted — it is still there', !!rPulse, rPulse);
  mCheck('reduced motion: it becomes the fade keyframe', !!rPulse && rPulse.name === 'motion-arrival-reduced', rPulse);
  mCheck(
    'reduced motion: over --motion-emphasis-fade',
    !!rPulse && ms(rPulse.duration) === ms(vR.emphasisFade),
    { computed: rPulse && rPulse.duration, token: vR.emphasisFade }
  );
  mCheck('reduced motion: one iteration', !!rPulse && rPulse.iterations === '1', rPulse);
  mCheck(
    'reduced motion: and no MOVEMENT at all — the preference is about movement',
    !!rPulse && (rPulse.transform === 'none' || rPulse.transform === 'matrix(1, 0, 0, 1, 0, 0)'),
    rPulse && rPulse.transform
  );
  const rRing = await page.evaluate(() => {
    const el = document.querySelector('body > .al-pulse');
    return el ? getComputedStyle(el).transitionDuration : null;
  });
  mCheck('reduced motion: the alert ring does not animate', ms(rRing) === 0, rRing);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await sleep(200);
  await page.evaluate(() => {
    const l = document.getElementById('lensPulseLayer');
    if (l) l.remove();
  });

  // ── THE MARKS ───────────────────────────────────────────────────────────
  //
  // `11-MOTION-AND-MARKS.md` §5, and §6.3 is why the second operator is
  // injected rather than entered: the walkthrough server enrols ONE operator,
  // because names are unique per game and a second entry arrives as a stranger
  // and gets a takeover dialog instead of the units. So the drill puts a
  // second operator in the PAGE'S OWN directory — id, name and the palette's
  // index-1 hue — and asserts the property P-4 is about: that two operators'
  // determinations are told apart WITHOUT a hue. Nothing on the server is
  // mocked and no envelope is faked; the shipped page has no code path that
  // invents an operator.
  at = 'motion/marks';

  const alphabet = await page.evaluate(() => ({
    marks: window.LensView.OPERATOR_MARKS,
    byIndex: [0, 1, 2, 3].map((i) => window.LensView.markForArrivalIndex(i)),
    firstFour: ['#156cdd', '#ff4d6d', '#0a7e3a', '#8629c0'].map((c) => window.LensView.markForColor(c)),
    unknown: window.LensView.markForColor('#888888'),
    wraps: window.LensView.markForArrivalIndex(12) === window.LensView.markForArrivalIndex(0),
  }));
  mCheck('marks: twelve of them, one per palette entry', alphabet.marks.length === 12, alphabet.marks);
  mCheck(
    'marks: the mark and the hue are two readings of ONE arrival index',
    alphabet.firstFour.every((m, i) => m === alphabet.byIndex[i]),
    alphabet
  );
  mCheck('marks: they wrap where the palette wraps, and not before', alphabet.wraps === true, alphabet.wraps);
  mCheck(
    'marks: a colour the palette does not name gets NO mark, never a guess',
    alphabet.unknown === null,
    alphabet.unknown
  );
  mCheck(
    'marks: none of them is a glyph 02 §2.5 already spent',
    alphabet.marks.every((m) => !'▸◇⚠◦🔒⦿↺⛨◎◉✕⚑●▲○•'.includes(m)),
    alphabet.marks
  );

  const two = await page.evaluate(() => {
    // A SECOND OPERATOR, in the page's own directory only (11 §6.3).
    const dots = [...document.querySelectorAll('#connectedUsers .user-badge')];
    const mine = dots.map((d) => (d.querySelector('.user-mark') || {}).textContent || null);
    const map = {
      'op-ada': window.LensView.markForColor('#156cdd'),
      Ada: window.LensView.markForColor('#156cdd'),
      'op-ben': window.LensView.markForColor('#ff4d6d'),
      Ben: window.LensView.markForColor('#ff4d6d'),
    };
    LensPanel.setOperatorMarks(map);
    const lane = LensPanel.laneHTML(
      [
        { lane: 'operator', seq: 1, atWorkMs: 1, kind: 'pin', color: '#156cdd', operator: 'Ada', operatorId: 'op-ada', unit: 'red-A', shape: 'solid' },
        { lane: 'operator', seq: 2, atWorkMs: 2, kind: 'pin', color: '#ff4d6d', operator: 'Ben', operatorId: 'op-ben', unit: 'red-B', shape: 'solid' },
        { lane: 'operator', seq: 3, atWorkMs: 3, kind: 'selection', color: '#156cdd', operator: 'Ada', operatorId: 'op-ada', unit: 'red-A', shape: 'hollow' },
      ],
      { seq: 3, expanded: true }
    );
    const strip = LensPanel.movesetsHTML([
      { op: 'panel.movesets', args: ['a', 1, 2, 7, false, 'retained', 0, false] },
      { op: 'panel.movesets.fixed', args: ['red-A', 108, 'pinned', 'Ada'] },
      { op: 'panel.movesets.fixed', args: ['red-B', 119, 'pinned', 'Ben'] },
    ]);
    const el = document.createElement('div');
    el.innerHTML = lane;
    const laneMarks = [...el.querySelectorAll('.lens-tick')].map((t) => t.textContent);
    const el2 = document.createElement('div');
    el2.innerHTML = strip;
    const stripMarks = [...el2.querySelectorAll('.lens-mark')].map((t) => t.textContent);
    return { rosterMarks: mine, laneMarks, stripMarks, map };
  });
  mCheck(
    'marks: two operators, two different marks on the timeline lane',
    two.laneMarks[0] === two.map['op-ada'] &&
      two.laneMarks[1] === two.map['op-ben'] &&
      two.laneMarks[0] !== two.laneMarks[1],
    two
  );
  mCheck(
    'marks: attention stays unattributed — a hollow tick is still ○',
    two.laneMarks[2] === '○',
    two.laneMarks
  );
  mCheck(
    'marks: the rail’s fixed strip carries the SAME two marks',
    two.stripMarks.length === 2 &&
      two.stripMarks[0] === two.laneMarks[0] &&
      two.stripMarks[1] === two.laneMarks[1],
    two
  );
  mCheck(
    'marks: the roster badge carries a mark beside its hue dot',
    Array.isArray(two.rosterMarks) && two.rosterMarks.length > 0 && two.rosterMarks.every((m) => !!m),
    two.rosterMarks
  );

  // THE BOARD. The renderer draws `bound.mark` where it drew `•`; the page
  // resolves it off the same directory the strip read, so the glyph on a
  // unit's head plate is the glyph beside that operator's name in the rail.
  const boardMark = await page.evaluate(() => ({
    resolvedByThePage: String(lensInk).includes('bound.mark'),
    drawnByTheRenderer: String(BoardRenderer.renderLensHandle).includes('bound.mark'),
    fallback: String(BoardRenderer.renderLensHandle).includes('"•"'),
    directory: LensPanel.operatorMark('op-ada'),
  }));
  mCheck(
    'marks: the board’s fixed chip draws the mark, resolved on the rail’s own directory',
    boardMark.resolvedByThePage && boardMark.drawnByTheRenderer && boardMark.fallback,
    boardMark
  );

  // And the page is put back the way the walk found it, so nothing after this
  // drill sees an operator the server never sent.
  await page.evaluate(() => typeof renderConnectedUsers !== "undefined" && renderConnectedUsers());

  // ── THE STAGED ARROW ────────────────────────────────────────────────────
  //
  // §6.2's one field, closed. Everything above this point is asserted against
  // an operator the DRILL put in the page's directory; this is asserted
  // against the one the SERVER sent, on the frame the page was actually
  // holding at `drill/pin` — `stagedMoves`, straight off `selections-update`,
  // with `StagedMoveView.by` on it. Nothing is staged here: `drill/pin` has
  // already made the one determination this walk makes, and a second one taken
  // for a picture would put a moment in the harness's own game log that the
  // review drill later photographs.
  at = 'motion/marks-arrow';
  const arrow = stagedArrowFrame;
  const attributed = arrow.rows.filter((r) => r.by !== null);
  mCheck(
    'marks: the wire says who staged the arrow — StagedMoveView carries `by`',
    attributed.length > 0 && attributed.every((r) => !!r.by.userId && !!r.by.color),
    arrow.rows
  );
  mCheck(
    'marks: the arrow’s mark IS the pinning operator’s, off the frame’s own `by`',
    attributed.length > 0 &&
      attributed.every((r) => !!r.mark && r.mark === r.fromId && r.mark === r.fromPalette),
    attributed
  );
  mCheck(
    'marks: and it is the mark that operator wears everywhere else',
    !!arrow.meMark && attributed.every((r) => r.by.userId !== arrow.me.userId || r.mark === arrow.meMark),
    { me: arrow.me, meMark: arrow.meMark, attributed }
  );
  mCheck(
    'marks: a bot-sourced arrow is nobody’s determination and gets NO mark',
    arrow.rows.every((r) => (r.source === 'bot' || r.source === 'fallback' ? r.by === null && r.mark === null : true)),
    arrow.rows
  );
  mCheck(
    'marks: the renderer draws the resolved glyph and holds no palette of its own',
    arrow.drawnByTheRenderer && arrow.rendererHoldsNoPalette,
    arrow
  );
  report.notes.motion = motion;

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
      // The completion is a PREFERENCE now (12 §4), read through the store
      // rather than off a key of the tour's own.
      done: window.Prefs ? window.Prefs.get('tour.doneVersion') : null,
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
  tourCheck('it closes on the last Enter and remembers it', closed.open === false && closed.done === '1', {
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
  // THE CHOICE IS A PREFERENCE, and since `12-PREFERENCES.md` it is written
  // where every other preference is: one versioned document, under the
  // namespaced id `lens.scheme`, and not a key of the lens's own.
  const stored = await page.evaluate(() => {
    let doc = null;
    try { doc = JSON.parse(localStorage.getItem('centaur.prefs.v1') || 'null'); } catch (_e) { doc = null; }
    return {
      pref: window.Prefs ? window.Prefs.get('lens.scheme') : null,
      inDoc: doc && doc.values ? doc.values['lens.scheme'] : null,
    };
  });
  schemeCheck('the choice is written to the preference store under lens.scheme',
    stored.pref === 'vim' && stored.inDoc === 'vim', stored);

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

  // ── THE TURN BUDGET (05 H-14 / P-8) ─────────────────────────────────────
  //
  // The bar's full length used to be "the longest remaining time seen this
  // turn", so a page that ATTACHED MID-TURN learned a short budget and drew a
  // full bar over a half-spent turn. This puts the page in exactly that state
  // — nothing learned this turn, a third of the budget left — and asserts the
  // bar reads a third. The budget itself is asserted against the board's own
  // `game.timeout`, which is the field the server computes the deadline from.
  const budget = await page.evaluate(() => {
    const onBoard =
      currentGameState && currentGameState.game ? currentGameState.game.timeout : null;
    const fromServer = turnBudgetFromServer();
    turnClockBudget = 0; // a page that has watched none of this turn
    const remaining = Math.round((fromServer || 0) / 3);
    updateTurnClock(remaining, turnBudgetFromServer() ?? turnClockBudget);
    const fill = document.getElementById('turnClockFill');
    const width = fill ? parseFloat(fill.style.width) : null;
    updateTurnClock(null, null);
    return { onBoard, fromServer, remaining, width };
  });
  report.notes.turnBudget = budget;
  scheme.push({
    step: 'the turn budget is the server’s, so a mid-turn attach draws the time that is left',
    ok:
      budget.fromServer !== null &&
      budget.fromServer === budget.onBoard &&
      budget.width !== null &&
      Math.abs(budget.width - 33.3) < 2,
    saw: budget,
  });
  console.log(
    `  ${scheme[scheme.length - 1].ok ? '\u2713' : '\u2717'} clock/turn budget — ` +
      `${budget.fromServer}ms from the board, bar ${budget.width}% with a third left`
  );
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

  // ── THE PREFERENCES DRILL ───────────────────────────────────────────────
  //
  // `docs/design/ux/12-PREFERENCES.md` §6.1. Six modules used to keep eleven
  // `localStorage` keys between them; they now read one store, and three
  // properties of that store are the kind a unit test cannot finish because
  // they are about a browser profile surviving a page load:
  //
  //  · ROUND TRIP — every preference set THROUGH THE PANEL (a panel that
  //    writes the wrong id is exactly the bug one store makes possible),
  //    reloaded, and then EACH MODULE ASKED WHAT IT READ. A preference that
  //    persists and that nobody reads is not a preference.
  //  · MIGRATION — the nine legacy keys planted with known values, loaded,
  //    and every one of them asserted at its new id; the legacy keys gone,
  //    named in `migrated`; and `centaur.lastTurn`, which §4 rules is session
  //    state, untouched beside them.
  //  · CORRUPTION — a document with a bad enum, an out-of-range number, a
  //    string where a boolean belongs and, on the next load, a truncated
  //    payload: the page must come up with NO exception, every corrupt id
  //    must read its default, and the valid ids beside them must survive.
  //
  // It runs LAST because it is the one drill that deliberately changes what
  // the page looks like, and nothing is photographed after it.
  at = 'prefs';
  const prefsDrill = [];
  const pfCheck = (name, ok, saw) => {
    prefsDrill.push({ step: name, ok: !!ok, saw });
    console.log(`  ${ok ? '✓' : '✗'} prefs/${name}${ok ? '' : ` — saw: ${JSON.stringify(saw)}`}`);
  };
  const allPrefs = () => page.evaluate(() => window.Prefs.all());
  let prefsEntry = 0;
  const reenter = async () => {
    prefsEntry += 1;
    if (await page.$('#loginGate.active')) await enter(page, GAME, `prefs-${prefsEntry}`);
  };
  /** The panel's own control, driven the way the operator drives it: the
   *  handler under test is the panel's, never `Prefs.set`. A range is set by
   *  value plus the `input` event the browser itself would send, because a
   *  slider cannot be typed into. */
  const setControl = (id, value, flag) =>
    page.evaluate(([pid, val, fl]) => {
      const sel = fl
        ? `#prefs-panel [data-pref="${pid}"][data-flag="${fl}"]`
        : `#prefs-panel [data-pref="${pid}"]:not([data-flag])`;
      const el = document.querySelector(sel);
      if (!el) return false;
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = String(val);
      el.dispatchEvent(new Event(el.type === 'range' ? 'input' : 'change', { bubbles: true }));
      return true;
    }, [id, value, flag || null]);

  // THE CHROME'S WAY IN, on a screen that has chrome. The review drill left
  // the browser on /history, which is one of the five.
  at = 'prefs/chrome';
  const chromeWayIn = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.chrome-status .chip')]
      .find((c) => /Preferences/.test(c.title || ''));
    const sheet = (document.querySelector('.keysheet') || {}).innerText || '';
    return { chip: !!chip, sheet: /Ctrl \+ ,/.test(sheet) || /preferences/i.test(sheet) };
  });
  pfCheck('the chrome offers the panel, and its key sheet says the chord',
    chromeWayIn.chip && chromeWayIn.sheet, chromeWayIn);

  // ── 1. ROUND TRIP ───────────────────────────────────────────────────────
  at = 'prefs/panel';
  await enter(page, GAME, `prefs-${(prefsEntry += 1)}`);
  await page.keyboard.press('Control+,');
  await sleep(500);
  const panelOpen = await page.evaluate(() => ({
    open: window.Prefs.panel.isOpen(),
    groups: [...document.querySelectorAll('#prefs-panel [data-prefs-group]')].map((g) => g.getAttribute('data-prefs-group')),
    controls: document.querySelectorAll('#prefs-panel [data-pref]').length,
  }));
  pfCheck('Ctrl+, opens the panel on the live view, which has no chrome at all',
    panelOpen.open === true, panelOpen);
  pfCheck('it is generated from the schema — one section per group',
    JSON.stringify(panelOpen.groups) === JSON.stringify(['lens', 'board', 'alerts', 'wire', 'tour', 'review', 'chrome']),
    panelOpen.groups);
  await shot(page, 'p1-prefs-panel', 'the settings panel — one section per module, generated from the schema table', '.prefs-pop');

  at = 'prefs/set';
  const WANT = {
    'lens.scheme': 'vim',
    'lens.density': 'compact',
    'board.tagMode': 'never',
    'board.sizePx': 620,
    'alerts.muted': true,
    'alerts.volume': 0.25,
    'alerts.notify': true,
    'wire.numbers': false,
    'chrome.landing': 'history',
  };
  for (const [id, value] of Object.entries(WANT)) {
    const ok = await setControl(id, value);
    if (!ok) pfCheck(`the panel has a control for ${id}`, false, null);
    await sleep(120);
  }
  await setControl('alerts.events', false, 'stage-drift');
  await sleep(200);
  const afterSet = await allPrefs();
  pfCheck(
    'every control wrote its own preference and no other',
    Object.entries(WANT).every(([id, v]) =>
      typeof v === 'number' ? Math.abs(afterSet[id] - v) < 0.001 : afterSet[id] === v) &&
      afterSet['alerts.events']['stage-drift'] === false &&
      afterSet['alerts.events']['fatal-unpinned'] === true,
    afterSet
  );
  const storedDoc = await page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }, 'centaur.prefs.v1');
  pfCheck('and it landed in ONE versioned document, not nine keys',
    !!storedDoc && storedDoc.v === 1 && storedDoc.values['lens.scheme'] === 'vim' &&
      storedDoc.values['board.sizePx'] === 620,
    storedDoc && storedDoc.values);

  // THE RELOAD, AND WHAT EACH MODULE READ.
  at = 'prefs/reload';
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  await reenter();
  await sleep(WAIT);
  // THE WIRE STRIP MOUNTS ON THE FIRST FRAME AND NOT BEFORE (`latency.js`:
  // no wire, no widget), so the read waits for a turn rather than racing the
  // socket — a preference the module has not had a chance to apply yet is a
  // fact about this script's timing and not about the store.
  for (let i = 0; i < 10 && !(await page.$('.lat')); i++) {
    await step();
    await sleep(600);
  }
  const read = await page.evaluate(() => ({
    scheme: typeof LensPanel === 'undefined' ? null : LensPanel.activeScheme(),
    density: (document.getElementById('selectedSnakePanel') || { classList: { contains: () => null } })
      .classList.contains('lens-compact'),
    tagMode: typeof tagDisplayMode === 'undefined' ? null : tagDisplayMode,
    sizePref: typeof boardSizePref === 'undefined' ? null : boardSizePref,
    canvas: (document.getElementById('gameCanvas') || { style: {} }).style.width,
    wantCanvas: typeof clampBoardSize === 'undefined' ? null : clampBoardSize(620) + 'px',
    alerts: window.Alerts ? window.Alerts.prefs() : null,
    nums: (document.querySelector('.lat') || { getAttribute: () => null }).getAttribute('data-nums'),
    // The strip's own KEY CAPS, rather than its running text: `innerText`
    // glues `k` and `j` together and a word-boundary match on it is a test of
    // the whitespace.
    keys: [...document.querySelectorAll('#lensKeys kbd')].map((k) => k.textContent),
  }));
  pfCheck('lens-panel read the scheme, and the cheat strip is spelled in it',
    read.scheme === 'vim' && read.keys.includes('k') && read.keys.includes('j') &&
      !read.keys.includes('[') && !read.keys.includes(']'),
    read);
  pfCheck('the rail read the density', read.density === true, read);
  pfCheck('the board renderer read the tag mode', read.tagMode === 'never', read);
  pfCheck('the board read its size, and the canvas is that size clamped to the layout',
    read.sizePref === 620 && read.canvas === read.wantCanvas, read);
  pfCheck('alerts read the mute, the volume and the per-event opt-out',
    !!read.alerts && read.alerts.muted === true &&
      Math.abs(read.alerts.volume - 0.25) < 0.001 && read.alerts.notify === true &&
      read.alerts.events['stage-drift'] === false,
    read.alerts);
  pfCheck('the wire strip read its own preference', read.nums === 'off', read);
  // Photographed only where there IS a wire: the strip stays empty until a
  // frame has arrived over a socket (`latency.js` — no wire, no widget), and
  // a walk that dies on a missing widget is photographing its own timing.
  const wireVisible = await page.evaluate(() => {
    const el = document.getElementById('latency-mount');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  });
  if (wireVisible) {
    await shot(page, 'p2-wire-numbers-off',
      'the wire strip with its four numbers put away — the state word and the clock stay', '#latency-mount');
  }

  at = 'prefs/chrome-read';
  await page.goto(`${BASE}/history`, { waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  const brand = await page.evaluate(() => {
    const a = document.querySelector('.header .brand');
    return a ? a.getAttribute('href') : null;
  });
  pfCheck('page-chrome read the landing screen', brand === '/history', { brand });

  // ── 2. MIGRATION ────────────────────────────────────────────────────────
  at = 'prefs/migrate';
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('lensKeyScheme', 'lefthand');
    localStorage.setItem('lensDensity', 'roomy');
    localStorage.setItem('unitTagsHiddenByDefault', '1');
    localStorage.setItem('boardSizePx', '99999');
    localStorage.setItem('centaurAlerts', JSON.stringify({
      muted: true, volume: 0.25, notify: true, events: { 'stage-drift': false },
    }));
    localStorage.setItem('lensTourDone', '1');
    localStorage.setItem('centaur.reviewMarks', JSON.stringify({
      'lens-walk': [{ turn: 3, focus: null, at: 1 }],
    }));
    // SESSION STATE, planted beside them (12 §4): the store must not touch it.
    localStorage.setItem('centaur.lastTurn', '{"lens-walk":4}');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  const migrated = await page.evaluate(() => ({
    values: window.Prefs.all(),
    from: window.Prefs.migrated(),
    left: ['lensKeyScheme', 'lensDensity', 'unitTagsHiddenByDefault', 'unitTagsTranslucentDefault',
      'boardSizePx', 'centaurAlerts', 'lensTourDone', 'centaur.reviewMarks']
      .filter((k) => localStorage.getItem(k) !== null),
    lastTurn: localStorage.getItem('centaur.lastTurn'),
  }));
  const mv = migrated.values;
  pfCheck('every legacy key arrived at its new id, losslessly',
    mv['lens.scheme'] === 'lefthand' && mv['lens.density'] === 'roomy' &&
      mv['board.tagMode'] === 'never' && mv['alerts.muted'] === true &&
      Math.abs(mv['alerts.volume'] - 0.25) < 0.001 && mv['alerts.notify'] === true &&
      mv['alerts.events']['stage-drift'] === false && mv['tour.doneVersion'] === '1' &&
      (mv['review.marks']['lens-walk'] || []).length === 1,
    mv);
  pfCheck('the out-of-range board size arrives in range rather than as it was stored',
    mv['board.sizePx'] === 1400, { size: mv['board.sizePx'] });
  pfCheck('the legacy keys are gone, and the document says which it was built from',
    migrated.left.length === 0 && migrated.from.length >= 7, migrated);
  pfCheck('session state beside them is untouched — 12 §4',
    migrated.lastTurn === '{"lens-walk":4}', { lastTurn: migrated.lastTurn });

  // ── 3. CORRUPTION ───────────────────────────────────────────────────────
  at = 'prefs/corrupt';
  const exceptionsBefore = report.exceptions.length;
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('centaur.prefs.v1', JSON.stringify({
      v: 1,
      values: {
        'lens.scheme': 'dvorak',      // not a scheme
        'board.sizePx': 'huge',       // not a number
        'alerts.volume': 5,           // out of range
        'alerts.muted': 'yes',        // not a boolean
        'alerts.events': 'all',       // not an object
        'review.marks': 3,            // not JSON the module could read
        'lens.density': 'roomy',      // VALID, beside them
        'tour.doneVersion': '1',      // VALID — and it keeps the tour shut
      },
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  const corrupt = await allPrefs();
  pfCheck('every corrupt value falls back to its default',
    corrupt['lens.scheme'] === 'bracket' && corrupt['board.sizePx'] === 550 &&
      Math.abs(corrupt['alerts.volume'] - 0.6) < 0.001 && corrupt['alerts.muted'] === false &&
      corrupt['alerts.events']['stage-drift'] === true &&
      JSON.stringify(corrupt['review.marks']) === '{}',
    corrupt);
  pfCheck('and the valid values beside them survive',
    corrupt['lens.density'] === 'roomy' && corrupt['tour.doneVersion'] === '1', corrupt);

  at = 'prefs/truncated';
  await page.evaluate(() => {
    localStorage.setItem('centaur.prefs.v1', '{"v":1,"values":{"lens.sch');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(WAIT);
  const truncated = await allPrefs();
  pfCheck('a document that does not parse is discarded whole, and the page comes up',
    truncated['lens.scheme'] === 'bracket' && truncated['lens.density'] === 'default' &&
      report.exceptions.length === exceptionsBefore,
    { scheme: truncated['lens.scheme'], exceptions: report.exceptions.length - exceptionsBefore });

  // ── 4. EXPORT AND IMPORT, through the panel and the clipboard ───────────
  at = 'prefs/export';
  await page.keyboard.press('Control+,');
  await sleep(400);
  await page.click('#prefs-panel [data-prefs-copy]');
  await sleep(300);
  const exported = await page.evaluate(() => {
    const box = document.querySelector('#prefs-panel [data-prefs-json]');
    let parsed = null;
    try { parsed = JSON.parse(box.value); } catch (e) { parsed = null; }
    return { ids: parsed ? Object.keys(parsed.values || {}).length : 0, status: (document.querySelector('#prefs-panel [data-prefs-status]') || {}).textContent };
  });
  pfCheck('Copy puts the whole set in the box as JSON',
    exported.ids === (await page.evaluate(() => window.Prefs.ids().length)), exported);

  at = 'prefs/import';
  const imported = await page.evaluate(() => {
    const box = document.querySelector('#prefs-panel [data-prefs-json]');
    box.value = JSON.stringify({
      v: 1,
      values: { 'lens.scheme': 'vim', 'alerts.volume': 0.4, 'no.such.pref': 1, 'board.sizePx': 'huge' },
    });
    document.querySelector('#prefs-panel [data-prefs-import]').click();
    return {
      status: (document.querySelector('#prefs-panel [data-prefs-status]') || {}).textContent,
      scheme: window.Prefs.get('lens.scheme'),
      volume: window.Prefs.get('alerts.volume'),
      size: window.Prefs.get('board.sizePx'),
    };
  });
  pfCheck('Import applies the ids that validate and names the ones that do not',
    imported.scheme === 'vim' && Math.abs(imported.volume - 0.4) < 0.001 &&
      imported.size === 550 && /no\.such\.pref/.test(imported.status || '') &&
      /board\.sizePx/.test(imported.status || ''),
    imported);

  at = 'prefs/reset';
  await page.click('#prefs-panel [data-prefs-reset="alerts"]');
  await sleep(250);
  const afterGroupReset = await allPrefs();
  pfCheck('Reset takes one group back and leaves the others where they are',
    Math.abs(afterGroupReset['alerts.volume'] - 0.6) < 0.001 && afterGroupReset['lens.scheme'] === 'vim',
    { volume: afterGroupReset['alerts.volume'], scheme: afterGroupReset['lens.scheme'] });
  await page.click('#prefs-panel [data-prefs-reset=""]');
  await sleep(250);
  const afterAll = await allPrefs();
  const shipped = await page.evaluate(() => window.Prefs.defaults());
  pfCheck('Reset everything is the shipped set, exactly',
    JSON.stringify(afterAll) === JSON.stringify(shipped), afterAll);
  await page.keyboard.press('Escape');
  report.notes.prefs = prefsDrill;

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport → ${path.join(OUT, 'report.json')}`);
  await browser.close();

  // EVERY DRILL IS A GATE. A walk that photographs a broken determination
  // surface — or a key scheme that relabels a strip over a keymap nothing
  // consults, or a motion vocabulary whose durations have drifted off their
  // own tokens — and exits 0 is a slideshow; this exits non-zero and names the
  // step that failed.
  const failed = [
    ...(report.notes.drill || []).map((d) => ({ ...d, drill: 'operator' })),
    ...(report.notes.tour || []).map((d) => ({ ...d, drill: 'tour' })),
    ...(report.notes.scheme || []).map((d) => ({ ...d, drill: 'scheme' })),
    ...(report.notes.review || []).map((d) => ({ ...d, drill: 'review' })),
    ...(report.notes.motion || []).map((d) => ({ ...d, drill: 'motion' })),
    ...(report.notes.prefs || []).map((d) => ({ ...d, drill: 'prefs' })),
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
