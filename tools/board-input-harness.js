/**
 * Real-browser harness for the centaur board's input handling.
 *
 * Serves src/web statically, opens play-game.html with a stubbed WebSocket,
 * feeds it the messages a live game would send, then dispatches genuine
 * pointer events at board cells and reports what the page did. Exists because
 * board input is browser behaviour (event phases, element teardown, hit
 * testing) that no amount of reading the source can settle.
 *
 *   node tools/board-input-harness.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const WEB = path.join(__dirname, '..', 'src', 'web');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' };

// Minimal API stubs: enough that the page stays in LIVE mode instead of
// falling back to the finished-game replay path.
const API = {
  '/api/config': { ok: true },
  '/api/firebase-status': { connected: true },
  '/api/logs/games': [{ game_id: 'g1', default_snake_id: 'A', snakes: [{ snake_id: 'A', snake_name: 'A' }] }],
  '/api/play/game/g1': { gameId: 'g1', active: true },
};
const API_PREFIX = [
  ['/api/play/game/g1/players', { players: [], enrolled: true }],
];

// Decision-log rows: enough for the replay path to build a historic
// moveState (which is what candidate selection in history reads).
function allCells() {
  const cells = [];
  for (let x = 0; x < 11; x++) for (let y = 0; y < 11; y++) cells.push({ x, y });
  return cells;
}

function historicDecisions() {
  const rows = [];
  for (let t = 5; t <= 8; t++) {
    const head = { x: 5, y: 5 };
    const s = {
      id: 'A', name: 'A', health: 90, latency: '0', length: 3,
      body: [head, { x:5, y:4 }, { x:5, y:3 }], head,
      customizations: { color: '#4CAF50', head:'default', tail:'default' },
    };
    rows.push({
      snake_id: 'A', turn: t + 1, submitted_move: 'up', bot_recommendation: 'up',
      server_move: 'up', safe_moves: ['up','left','right'],
      // Territory must cover the board the way a real Voronoi result does:
      // clicking a cell that HAS a territory owner is what makes the replay
      // toggle its highlight and re-render, which is the teardown that used to
      // swallow the click.
      move_evaluations: { evaluations: moveEvaluations, territoryCells: { A: allCells() } },
      game_state: {
        game: { id:'g1', ruleset:{name:'standard',version:'1',settings:{}}, map:'standard', timeout:500, source:'test' },
        turn: t,
        board: { width: 11, height: 11, food: [], hazards: [], snakes: [s] },
        you: s,
      },
    });
  }
  return rows;
}

// The board timeline the replay now prefers. Native rows for the same turns
// the decision stub covers, plus the final board (turn 9) that only the
// timeline can have. `--no-turns` 404s the endpoint so the legacy
// per-snake-log fallback path gets exercised instead.
const NO_TURNS = process.argv.includes('--no-turns');
function timelineTurnsPayload() {
  const rows = historicDecisions().map((d) => ({
    turn: d.game_state.turn,
    game_state: { ...d.game_state, you: undefined },
    territory: d.move_evaluations.territoryCells,
    cell_ownership: null,
    native: true,
  }));
  const finalBoard = JSON.parse(JSON.stringify(rows[rows.length - 1].game_state));
  finalBoard.turn = 9;
  finalBoard.board.snakes = []; // everyone died on the final board
  finalBoard.lastMoves = { A: 'up' };
  rows.push({ turn: 9, game_state: finalBoard, territory: null, cell_ownership: null, native: true });
  return { turns: rows, finalTurn: 9, hasNative: true };
}

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/api/logs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ decisions: historicDecisions() }));
    return;
  }
  if (p === '/api/games/g1/turns') {
    if (NO_TURNS) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(timelineTurnsPayload()));
    return;
  }
  const pre = API_PREFIX.find(([k]) => p === k);
  if (pre) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pre[1]));
    return;
  }
  if (API[p] !== undefined) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(API[p]));
    return;
  }
  if (p.startsWith('/game/')) p = '/play-game.html';
  if (p === '/') p = '/play-game.html';
  const file = path.join(WEB, p);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    console.log('   [404]', req.url);
    res.writeHead(404); res.end('nope'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

const HEAD = { x: 5, y: 5 };
const snake = {
  id: 'A', name: 'A', health: 90, latency: '0', length: 3,
  body: [HEAD, { x:5, y:4 }, { x:5, y:3 }], head: HEAD,
  customizations: { color: '#4CAF50', head:'default', tail:'default' },
};
const boardState = {
  game: { id:'g1', ruleset:{name:'standard',version:'1',settings:{}}, map:'standard', timeout:500, source:'test' },
  turn: 7,
  board: { width: 11, height: 11, food: [], hazards: [], snakes: [snake] },
};
const BAD = process.argv.includes('--bad');
const moveEvaluations = ['up','left','right'].map(m => ({
  move: m, score: m === 'up' ? 10 : 5, numStates: 1,
  breakdown: BAD ? { trapped: 0, myLength: 3, weights: { myLength: 1 }, weighted: { myLengthScore: 3 } } : { ...{myLength: 1, myTerritory: 1, myControlledFood: 1, myControlledFertile: 1, teamLength: 1, teamTerritory: 1, teamControlledFood: 1, foodDistance: 1, foodProximity: 1, foodEaten: 1, enemyTerritory: 1, enemyLength: 1, edgePenalty: 1, selfSpace: 1, alliesEnoughSpace: 1, opponentsEnoughSpace: 1, kills: 1, deaths: 1, enemyH2HRisk: 1, allyH2HRisk: 1, gotoProgress: 1, nearProgress: 1, aggression: 1, trapped: 1}, weights: {myLength: 1, myTerritory: 1, myControlledFood: 1, myControlledFertile: 1, teamLength: 1, teamTerritory: 1, teamControlledFood: 1, foodProximity: 1, foodEaten: 1, enemyTerritory: 1, enemyLength: 1, edgePenalty: 1, selfSpace: 1, alliesEnoughSpace: 1, opponentsEnoughSpace: 1, kills: 1, deaths: 1, enemyH2HRisk: 1, allyH2HRisk: 1, gotoProgress: 1, nearProgress: 1, aggression: 1, trapped: 1}, weighted: {myLengthScore: 1, myTerritoryScore: 1, myControlledFoodScore: 1, myControlledFertileScore: 1, teamLengthScore: 1, teamTerritoryScore: 1, teamControlledFoodScore: 1, foodProximityScore: 1, foodEatenScore: 1, enemyTerritoryScore: 1, enemyLengthScore: 1, edgePenaltyScore: 1, selfSpaceScore: 1, alliesEnoughSpaceScore: 1, opponentsEnoughSpaceScore: 1, killsScore: 1, deathsScore: 1, enemyH2HRiskScore: 1, allyH2HRiskScore: 1, gotoProgressScore: 1, nearProgressScore: 1, aggressionScore: 1, trappedScore: 1} },
}));

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--run-all-compositor-stages-before-draw'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

  // Stub WebSocket before any page script runs; expose a push channel.
  await page.addInitScript(() => {
    window.__sent = [];
    class FakeWS {
      constructor() {
        this.readyState = 1;
        window.__ws = this;
        setTimeout(() => this.onopen && this.onopen(), 0);
      }
      send(d) { window.__sent.push(JSON.parse(d)); }
      close() {}
    }
    FakeWS.OPEN = 1;
    window.WebSocket = FakeWS;
    window.__push = (msg) => window.__ws.onmessage({ data: JSON.stringify(msg) });
    window.__raf = { calls: 0, fires: 0, errors: [] };
    const _raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      window.__raf.calls++;
      return _raf((t) => {
        window.__raf.fires++;
        try { cb(t); } catch (e) { window.__raf.errors.push(String(e && e.message || e)); throw e; }
      });
    };
    document.cookie = 'centaurPlayerName=Tester';
  });

  await page.goto(`http://localhost:${port}/game/g1`);
  await page.waitForTimeout(600);
  // The login gate must be satisfied before the page opens its socket.
  if (await page.locator('#loginGate').isVisible().catch(() => false)) {
    await page.fill('#loginNameInput', 'Tester');
    await page.click('#loginGateSubmit');
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(600);
  const boot = await page.evaluate(() => ({
    hasWs: !!window.__ws,
    loginGate: (() => { const g = document.getElementById('loginGate'); return g ? getComputedStyle(g).display : 'absent'; })(),
    visibleDialogs: [...document.querySelectorAll('[id$="Gate"],[id$="Dialog"],[id$="Overlay"]')]
      .filter(e => getComputedStyle(e).display !== 'none')
      .map(e => e.id),
  }));
  console.log('boot state:', JSON.stringify(boot));
  if (!boot.hasWs) {
    console.log('--- console so far ---');
    logs.slice(0, 20).forEach(l => console.log(l));
    await browser.close(); server.close(); return;
  }

  await page.evaluate(([boardState, moveEvaluations]) => {
    window.__push({ type: 'game-subscribed', userColor: '#e91e63', playerName: 'Tester',
      boardState, controlledSnakes: [{ id:'A', name:'A', emoji:'' }],
      connectedUsers: [], selections: {}, owners: {}, stagedMoves: {},
      waypoints: {}, routes: {}, activeIntentModes: { A: 'heuristic' },
      measuredPing: 10, turnExpiryTime: Date.now() + 100000 });
    window.__push({ type: 'snake-selected', snakeId: 'A' });
    window.__push({ type: 'snake-turn-update', snakeId: 'A', turn: 7,
      moveEvaluations, territoryCells: {}, safeMoves: ['up','left','right'],
      botRecommendation: 'up', timestamp: Date.now(),
      moveCommitted: false, committedMove: null,
      stagedMoves: {}, routes: {}, activeIntentModes: { A: 'heuristic' } });
  }, [boardState, moveEvaluations]);

  await page.waitForTimeout(300);

  const state = async () => page.evaluate(() => {
    const selOverlay = [...document.querySelectorAll('#boardOverlay .cell-button.selected')]
      .map(b => (b.title || '').split(' ')[0]);
    const selKeypad = [...document.querySelectorAll('#moveButtons .move-button.selected')]
      .map(b => b.textContent.trim().split(/\s+/)[0]);
    return {
      overlayButtons: document.querySelectorAll('#boardOverlay .cell-button').length,
      selectedOverlay: selOverlay,
      selectedKeypad: selKeypad,
    };
  });

  console.log('after setup:', JSON.stringify(await state()));
  console.log('rAF at setup:', JSON.stringify(await page.evaluate(() => window.__raf)));

  // Where is the 'up' candidate cell (5,6) on screen?
  const geom = await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const r = c.getBoundingClientRect();
    const btns = [...document.querySelectorAll('#boardOverlay .cell-button')].map(b => {
      const br = b.getBoundingClientRect();
      return { title: b.title, cx: br.left + br.width/2, cy: br.top + br.height/2 };
    });
    return { rect: { left:r.left, top:r.top, width:r.width, height:r.height },
             clientWidth: c.clientWidth, buttons: btns };
  });
  console.log('canvas rect:', JSON.stringify(geom.rect), 'clientWidth', geom.clientWidth);
  console.log('overlay buttons:', JSON.stringify(geom.buttons, null, 1));

  // Instrument: does rAF fire at all here, and is the overlay rebuilt?
  await page.evaluate(() => {
    window.__diag = { overlayCalls: [] };
    const orig = BoardRenderer.createBoardOverlay;
    BoardRenderer.createBoardOverlay = function (el, canvas, board, moveState, cb) {
      window.__diag.overlayCalls.push(moveState ? moveState.selectedMove : 'no-moveState');
      return orig.apply(this, arguments);
    };
  });

  const target = geom.buttons.find(b => /^LEFT/i.test(b.title || ''));
  console.log(`\nBOARD click on LEFT candidate at (${target.cx.toFixed(1)}, ${target.cy.toFixed(1)})`);
  await page.mouse.move(target.cx, target.cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
  console.log('  after BOARD click:', JSON.stringify(await state()));
  console.log('  diag:', JSON.stringify(await page.evaluate(() => ({ ...window.__diag, raf: window.__raf }))));

  // Reset to the default, then drive the keypad for comparison.
  await page.evaluate(() => window.__push({ type: 'snake-selected', snakeId: 'A' }));
  await page.waitForTimeout(150);
  console.log('  reset:            ', JSON.stringify(await state()));
  await page.click('#moveButtons .move-button:nth-child(4)').catch(async () => {
    await page.evaluate(() => BoardRenderer._moveClickHandler('left'));
  });
  await page.waitForTimeout(250);
  console.log('  after KEYPAD click:', JSON.stringify(await state()));

  // Exercise every binding and report what the page sent to the server.
  const wsSince = async (fn) => {
    await page.evaluate(() => { window.__sent.length = 0; });
    await fn();
    await page.waitForTimeout(200);
    return page.evaluate(() => window.__sent.filter(m => m.type !== 'ping'));
  };
  // Earlier interactions scroll the page; bring the board back into view and
  // re-measure, or the synthetic clicks land outside the viewport.
  await page.evaluate(() => document.getElementById('gameCanvas').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(150);
  const geom2 = await page.evaluate(() => {
    const c = document.getElementById('gameCanvas');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, clientWidth: c.clientWidth };
  });
  const cellPx = geom2.clientWidth / 11, ox = geom2.left + 2, oy = geom2.top + 2;
  const at = (cx, cy) => [ox + cx*cellPx + cellPx/2, oy + (10-cy)*cellPx + cellPx/2];
  console.log('re-measured canvas:', JSON.stringify(geom2), '-> cell(8,8) at', JSON.stringify(at(8,8)));

  const press = (button, mods) => async () => {
    const [x, y] = at(8, 8);
    await page.mouse.move(x, y);
    for (const k of mods) await page.keyboard.down(k);
    await page.mouse.down({ button });
    await page.mouse.up({ button });
    for (const k of mods) await page.keyboard.up(k);
  };

  await page.evaluate(() => {
    window.__hits = [];
    const orig = BoardRenderer.getClickedCell;
    BoardRenderer.getClickedCell = function (canvas, board, ev) {
      const r = orig.apply(this, arguments);
      window.__hits.push({ button: ev.button, type: ev.type, cell: r });
      return r;
    };
  });
  console.log('\n--- bindings ---');
  console.log('Right-click        ->', JSON.stringify(await wsSince(press('right', []))));
  console.log('Shift+Right-click  ->', JSON.stringify(await wsSince(press('right', ['Shift']))));
  console.log('Ctrl+Left-click    ->', JSON.stringify(await wsSince(press('left', ['Control']))));
  const inspected = await (async () => {
    await (press('left', ['Alt']))();
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const p = document.getElementById('cellInspectPopup');
      return p ? getComputedStyle(p).display : 'absent';
    });
  })();
  console.log('Alt+Left-click     -> cell inspect popup display:', inspected);
  console.log('handler hits:', JSON.stringify(await page.evaluate(() => window.__hits)));
  console.log('selected snake:', JSON.stringify(await page.evaluate(() =>
    document.querySelectorAll('#boardOverlay .cell-button').length + ' overlay buttons')));

  // ── HISTORIC MODE ────────────────────────────────────────────────────
  console.log('\n--- historic mode ---');
  const entered = await page.evaluate(async () => {
    if (typeof enterFinishedMode === 'function') { await enterFinishedMode(); }
    await new Promise(r => setTimeout(r, 500));
    // State at the opening position (the last explorable turn).
    const atEnd = {
      liveMaxTurn: typeof liveMaxTurn !== 'undefined' ? liveMaxTurn : -1,
      header: document.getElementById('currentTurn').textContent,
      hasMoveState: !!(typeof historicMoveState !== 'undefined' && historicMoveState),
      panel: document.getElementById('moveButtons').textContent.trim().slice(0, 70),
    };
    // Scrub back to a turn with decision data.
    await enterHistoric(7);
    await new Promise(r => setTimeout(r, 300));
    return { viewMode: typeof viewMode !== 'undefined' ? viewMode : '?',
             atEnd,
             headerAt7: document.getElementById('currentTurn').textContent,
             hasHistoricMoveState: !!(typeof historicMoveState !== 'undefined' && historicMoveState) };
  }).catch(e => ({ error: String(e.message || e) }));
  console.log('entered:', JSON.stringify(entered));

  if (entered.hasHistoricMoveState) {
    await page.evaluate(() => document.getElementById('gameCanvas').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    const hg = await page.evaluate(() => {
      const c = document.getElementById('gameCanvas');
      const r = c.getBoundingClientRect();
      const btns = [...document.querySelectorAll('#boardOverlay .cell-button')].map(b => {
        const br = b.getBoundingClientRect();
        return { title: b.title, cx: br.left + br.width/2, cy: br.top + br.height/2 };
      });
      return { buttons: btns };
    });
    const hstate = async () => page.evaluate(() => ({
      selectedOverlay: [...document.querySelectorAll('#boardOverlay .cell-button.selected')].map(b => (b.title||'').split(' ')[0]),
      selectedKeypad: [...document.querySelectorAll('#moveButtons .move-button.selected')].map(b => b.textContent.trim().split(/\s+/)[0]),
    }));
    console.log('  overlay buttons:', hg.buttons.length, '| before:', JSON.stringify(await hstate()));
    const lt = hg.buttons.find(b => /^LEFT/i.test(b.title || ''));
    if (!lt) { console.log('  !! no LEFT candidate in historic overlay'); }
    else {
      await page.mouse.move(lt.cx, lt.cy);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(250);
      console.log('  after HISTORIC board click on LEFT:', JSON.stringify(await hstate()));
    }
  }

  console.log('--- console ---');
  logs.slice(0, 25).forEach(l => console.log(l));

  await browser.close();
  server.close();
})();
