/**
 * THE SECONDARY SCREENS, IN A BROWSER — the lobby, history, config and
 * activity pages, with no Postgres and no Firebase.
 *
 * Sibling of `lens-walkthrough-server.ts`. That one stands `play-game.html` up
 * against a real running decision; this one stands up the four pages an
 * operator uses AROUND the live view, because every one of them reads its data
 * from a route that needs a database:
 *
 *   /play      ← WebSocket `subscribe-lobby` → `lobby-update` (SHIPPED
 *                `GameWebSocketServer` over the SHIPPED `ActiveGameManager`,
 *                so the card shape is the production one)
 *   /history   ← `/api/logs/games`            (served from a fixture list)
 *   /config    ← `/api/config`                (the SHIPPED registry metadata
 *                from `CONFIG_UI`, values from an in-memory store)
 *                and `/api/bots`, `/api/play/game/:id/bot` — the SHIPPED
 *                read-only bot-binding routes over an in-memory
 *                `config_store` (see `docs/BOT-BINDING.md`)
 *   /activity  ← `/api/activity/events`       (a synthetic but shape-exact
 *                boot/woke/went-idle/suspended/shutdown stream, including a
 *                silent-kill period with heartbeat forensics)
 *
 * Usage:
 *   npx ts-node --transpile-only src/tests/secondary-screens-server.ts --port=5056
 *   node scripts/secondary-screens-shots.js --port=5056 --out=docs/design/ux/screens
 */

import express from 'express';
import path from 'path';
import { createServer } from 'http';

import { ActiveGameManager } from '../server/active-game-manager';
import { GameWebSocketServer } from '../server/websocket-server';
import playRouter from '../routes/play';
import { BotRegistry } from '../config/bot-binding';
import { setBotRegistryForTests } from '../config/bot-store';
import { CONFIG_UI } from '../config/heuristics';
import { DEFAULT_CONFIG } from '../config/game-config';
import { MIXED_SCENARIO, SNAKE_SCENARIO, buildBoard } from './local-game';
import type { Board, BoardSnapshot, Game } from '../types/battlesnake';

const arg = (name: string, fallback: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const PORT = parseInt(arg('port', '5056'), 10);
const WEB = path.join(__dirname, '../web');

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A settled board for a fixture game, so the lobby's minimap has real ink. */
function snapshot(id: string, board: Board, turn: number): BoardSnapshot {
  const game: Game = {
    id,
    ruleset: { name: 'standard', version: 'v1', settings: {} },
    map: 'standard',
    timeout: 500,
    source: 'secondary-screens',
  };
  return { game, turn, board };
}

/** The synthetic activity stream: three process lifetimes, one of them ended
 *  by a silent kill whose end is bounded by the liveness heartbeat, which is
 *  the case `activity-periods.js` exists to draw honestly. */
function activityEvents(now: number): Array<{
  id: number;
  ts: number;
  type: string;
  detail: Record<string, unknown> | null;
}> {
  const out: Array<{ id: number; ts: number; type: string; detail: Record<string, unknown> | null }> = [];
  let id = 1;
  const push = (ts: number, type: string, detail: Record<string, unknown> | null = null): void => {
    out.push({ id: id++, ts: Math.round(ts), type, detail });
  };

  // Lifetime 1 — five days ago, ended cleanly.
  const b1 = now - 5 * DAY;
  push(b1, 'boot', { pid: 101, version: '1.0.0' });
  push(b1 + 2 * HOUR, 'woke', { reason: 'human-action' });
  push(b1 + 3 * HOUR, 'went-idle', { reason: 'grace-window-elapsed', idleMs: 600000 });
  push(b1 + 5 * HOUR, 'suspended', { what: 'firebase', reason: 'inactivity' });
  push(b1 + 6 * HOUR, 'shutdown', { signal: 'SIGTERM' });

  // Lifetime 2 — three days ago, silent kill: no shutdown row, the next boot
  // carries the previous lifetime's last heartbeat.
  const b2 = now - 3 * DAY;
  push(b2, 'boot', { pid: 202, version: '1.0.0' });
  push(b2 + 0.5 * HOUR, 'woke', { reason: 'human-action' });
  push(b2 + 1.5 * HOUR, 'went-idle', { reason: 'grace-window-elapsed' });
  push(b2 + 4 * HOUR, 'woke', { reason: 'game-progress' });
  push(b2 + 5 * HOUR, 'went-idle', { reason: 'grace-window-elapsed' });

  // Lifetime 3 — yesterday, still running.
  const b3 = now - 1 * DAY;
  push(b3, 'boot', {
    pid: 303,
    version: '1.0.0',
    prevLastAliveAt: b2 + 5.4 * HOUR,
    prevEndClass: 'silent-kill',
  });
  push(b3 + 1 * HOUR, 'woke', { reason: 'human-action' });
  push(b3 + 2 * HOUR, 'went-idle', { reason: 'grace-window-elapsed' });
  push(now - 3 * HOUR, 'woke', { reason: 'human-action' });
  push(now - 40 * 60_000, 'went-idle', { reason: 'grace-window-elapsed' });
  push(now - 12 * 60_000, 'woke', { reason: 'human-action' });
  return out;
}

/** Finished games, in the shape `/api/logs/games` returns. */
function historyGames(now: number): unknown[] {
  const rows = [
    { id: 'a17f8c2e-4d31-4b90-9f22-6ce0b1d47a51', turns: 214, w: 11, h: 11, win: 'Chris Centaur', end: null },
    { id: 'b2c94d10-77aa-4f6d-8c31-0e5d9b3a2f88', turns: 96, w: 11, h: 11, win: null, end: 'draw' },
    { id: 'c38a5e77-1bf0-42d9-b0aa-4d7e6c1902ab', turns: 341, w: 19, h: 19, win: 'Bluefang', end: null },
    { id: 'd4b17f09-9e2c-4a15-8d63-2f0c7ab54e19', turns: 58, w: 11, h: 11, win: 'Chris Centaur', end: null },
    { id: 'e5c208aa-3b41-4c78-91de-7a6b0f2c3d40', turns: 172, w: 11, h: 11, win: null, end: null },
  ];
  return rows.map((r, i) => ({
    game_id: r.id,
    team_key: 'chris-centaur',
    team_label: 'Chris Centaur',
    team_color: '#4CAF50',
    timestamp: new Date(now - (i + 1) * 7 * HOUR).toISOString(),
    turns: r.turns,
    default_snake_id: `snake-${i}-a`,
    snakes: [
      { snake_id: `snake-${i}-a`, snake_name: 'Ada', color: '#e53935', length: 9 + i },
      { snake_id: `snake-${i}-b`, snake_name: 'Bea', color: '#1e88e5', length: 6 + i },
    ],
    started_at: now - (i + 1) * 7 * HOUR,
    ended_at: now - (i + 1) * 7 * HOUR + r.turns * 700,
    final_turn: r.turns,
    board_width: r.w,
    board_height: r.h,
    ruleset_name: 'standard',
    winner_snake_id: null,
    winner_name: r.win,
    end_reason: r.end,
  }));
}

function main(): void {
  const app = express();
  app.use(express.json());
  app.use(express.static(WEB));

  // ── The pages, mounted the way `src/index.ts` mounts them ───────────────
  const page = (file: string) => (_req: express.Request, res: express.Response): void => {
    // `root` + leaf, not an absolute path: a worktree lives under `.claude/`
    // and `send`'s `dotfiles: 'ignore'` 404s any path with a dot-segment.
    res.sendFile(file, { root: WEB });
  };
  app.get('/', (_req, res) => res.redirect('/play'));
  app.get('/play', page('play.html'));
  app.get('/history', page('history.html'));
  app.get('/config', page('config.html'));
  app.get('/activity', page('activity.html'));
  app.get('/connection-debug', page('connection-debug.html'));
  app.get('/game/:id', page('play-game.html'));

  // ── Bot bindings, off an in-memory `config_store` ───────────────────────
  const store: Record<string, unknown> = {
    'bot.default': 'lobster-territory',
    'bot.game.live-mixed': { bot: 'material-only', name: 'excursion-A' },
    'bot.catalog': {
      'quiet-arm': { bot: 'lobster-territory', candidates: { gainOrdering: false } },
    },
    // A deliberately broken binding, so the refusals surface has something to
    // show: `docs/BOT-BINDING.md` §Refusals is only visible when one exists.
    'bot.centaur.broken-centaur': { bot: 'no-such-bot' },
  };
  setBotRegistryForTests(
    new BotRegistry({ read: async () => ({ ...store }) })
  );

  // ── The lobby, over the shipped manager + socket ────────────────────────
  const manager = ActiveGameManager.getInstance();
  const liveBoard = buildBoard({ ...MIXED_SCENARIO, seed: 3 });
  const liveSnap = snapshot('live-mixed', liveBoard, 47);
  const teamId = (MIXED_SCENARIO.teams[0] as { id: string }).id;
  for (const s of (liveBoard.snakes ?? []).filter((s) => s.teamID === teamId)) {
    manager.registerGame(liveSnap, s.id, { id: teamId, name: 'Chris Centaur', color: '#4CAF50' });
  }
  const otherBoard = buildBoard({ ...SNAKE_SCENARIO, seed: 9 });
  const otherSnap = snapshot('live-snakes', otherBoard, 8);
  const otherTeam = (SNAKE_SCENARIO.teams[0] as { id: string }).id;
  for (const s of (otherBoard.snakes ?? []).filter((s) => s.teamID === otherTeam)) {
    manager.registerGame(otherSnap, s.id, { id: otherTeam, name: 'Chris Centaur', color: '#4CAF50' });
  }

  app.use(playRouter);

  // ── The read routes the pages call, off fixtures ────────────────────────
  app.get('/api/logs/games', (_req, res) => res.json(historyGames(Date.now())));
  app.get('/api/games/:gameId/turns', (_req, res) =>
    res.json({ turns: [], finalTurn: null, hasNative: false })
  );
  app.get('/api/logs', (_req, res) => res.json({ events: [] }));
  app.get('/api/logs/commands', (_req, res) => res.json([]));

  const configValues: Record<string, unknown> = {};
  app.get('/api/config', (_req, res) =>
    res.json({ config: { ...DEFAULT_CONFIG, ...configValues }, defaults: DEFAULT_CONFIG, ui: CONFIG_UI })
  );
  app.post('/api/config', (req, res) => {
    Object.assign(configValues, req.body as Record<string, unknown>);
    res.json({ config: { ...DEFAULT_CONFIG, ...configValues } });
  });
  app.delete('/api/config', (_req, res) => {
    for (const k of Object.keys(configValues)) delete configValues[k];
    res.json({ config: { ...DEFAULT_CONFIG } });
  });

  app.get('/api/activity/events', (req, res) => {
    const start = req.query.start == null ? -Infinity : Number(req.query.start);
    const end = req.query.end == null ? Infinity : Number(req.query.end);
    const all = activityEvents(Date.now());
    res.json({
      events: all.filter((e) => e.ts >= start && e.ts <= end),
      serverNow: Date.now(),
      truncated: false,
    });
  });

  app.get('/api/firebase-status', (_req, res) =>
    res.json({ state: 'connected', error: null, since: Date.now() - 3 * HOUR })
  );
  app.post('/api/firebase-retry', (_req, res) =>
    res.json({ state: 'connected', error: null, since: Date.now() })
  );
  app.get('/api/connection-log/recent', (_req, res) => res.json({ events: [], logFile: '(harness)' }));
  app.post('/api/connection-log/client', (_req, res) => res.json({ ok: true }));

  const httpServer = createServer(app);
  // The lobby's `subscribe-lobby` is answered by the shipped server.
  new GameWebSocketServer(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`[secondary-screens] http://127.0.0.1:${PORT}/play  (also /history /config /activity)`);
  });
}

main();
