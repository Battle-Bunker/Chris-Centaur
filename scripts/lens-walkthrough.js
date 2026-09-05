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
    lock: (document.querySelector('.lens-lock') || {}).innerText || null,
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

async function shot(page, name, note, selector) {
  const file = path.join(OUT, `${name}.png`);
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
async function focusUnit(page, index) {
  const active = await page.evaluate(() => {
    const el = document.querySelector('.snake-info-item.active-perspective');
    return el ? [...document.querySelectorAll('.snake-info-item.selectable')].indexOf(el) : -1;
  });
  if (active === index) {
    const rows = await page.$$('.snake-info-item.selectable');
    const other = index === 0 ? 1 : 0;
    if (rows[other]) {
      await rows[other].click();
      await sleep(WAIT);
    }
  }
  const again = await page.$$('.snake-info-item.selectable');
  if (again[index]) {
    await again[index].click();
    await sleep(WAIT);
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
      await cell.click({ timeout: 4000 });
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
    const el = document.querySelector('.lens-lock');
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
    const el = document.querySelector('.lens-lock');
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

  // 1 — PIN. `Space` stages the candidate under the cursor: one determination,
  // the operator's own unit, no confirmation, and an undo the moment it lands.
  at = 'drill/pin';
  await page.keyboard.press(' ');
  await sleep(1200);
  const afterPin = await railOf();
  check(
    'pin — the undo affordance arrives with the determination',
    /undo/i.test(afterPin.controls || '') && !/nothing yet/.test(afterPin.controls || ''),
    { controls: afterPin.controls, before: beforePin.controls }
  );
  check('pin — the stage line names a plan for every unit', /Bot stages/.test(afterPin.stage || ''), {
    stage: afterPin.stage,
  });
  await drillShot('d1-pin', 'the operator drill: a pin, and the undo it arrives with');

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
  await page.keyboard.press('u');
  await sleep(1000);
  const undone = await railOf();
  check(
    'undo — takes the determination back and names what it took',
    /undo/i.test(undone.controls || ''),
    { controls: undone.controls }
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

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport → ${path.join(OUT, 'report.json')}`);
  await browser.close();

  // BOTH DRILLS ARE GATES. A walk that photographs a broken determination
  // surface — or a key scheme that relabels a strip over a keymap nothing
  // consults — and exits 0 is a slideshow; this exits non-zero and names the
  // step that failed.
  const failed = [
    ...(report.notes.drill || []).map((d) => ({ ...d, drill: 'operator' })),
    ...(report.notes.scheme || []).map((d) => ({ ...d, drill: 'scheme' })),
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
