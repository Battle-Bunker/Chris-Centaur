#!/usr/bin/env node
'use strict';
/*
 * THE POTION MECHANISM ROWS — offence and DEFENCE, mined from replays.
 *
 * Extends the offensive rows a sibling thread already mines
 * (`ppruns/potion-mech.js`: pickups, severs, windowSevers, collectorDeaths) with
 * the three rows this branch's defensive half is about, and which nothing else
 * counts:
 *
 *   collectorKills     a unit of THEIRS that died within W turns of its own
 *                      pickup, with one of OUR units in the same clash — the
 *                      counter-attack that collapses their window, which is the
 *                      behaviour `eval/potion-defense@1` exists to buy
 *   underWindowLosses  our units that died while an ENEMY window was open — the
 *                      cost of not defending, and the row that should FALL
 *   underWindowSevered our body cells cut while one was — the same cost in the
 *                      currency the share metric is denominated in
 *
 * Everything is per seat's BOT, mined off the replay stream every paired run
 * already writes, with no engine change and no second run.
 *
 * usage: node mech.js <batch-dir> [--window 3]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
const batch = args[0];
let W = 3;
for (let i = 1; i < args.length; i++) if (args[i] === '--window') W = Number(args[++i]);
if (!batch) { console.error('usage: mech.js <batch-dir> [--window N]'); process.exit(2); }

const FIELDS = ['games', 'pickups', 'severs', 'severWeight', 'windowSevers', 'windowSeverWeight',
  'collectorDeaths', 'collectorKills', 'underWindowLosses', 'underWindowSevered', 'deaths'];

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.jsonl.gz')) files.push(p);
  }
})(path.join(batch, 'arms'));

const acc = new Map();
function bump(arm, cell, bot, field, by = 1) {
  const k = `${arm} ${cell} ${bot}`;
  let c = acc.get(k);
  if (c === undefined) {
    c = { arm, cell, bot };
    for (const f of FIELDS) c[f] = 0;
    acc.set(k, c);
  }
  c[field] += by;
}

for (const file of files) {
  const arm = /\/arms\/([^/]+)\//.exec(file)[1];
  // A replay still being written is a truncated gzip member. Skip it rather
  // than dying: this tool is run mid-batch on purpose.
  let text;
  try { text = zlib.gunzipSync(fs.readFileSync(file)).toString(); } catch { continue; }
  const lines = text.split('\n');
  const teamBot = new Map();
  const lastPickupTurn = new Map();   // unitID -> turn of its own last pickup
  const teamPickupTurns = new Map();  // teamID -> [turns]
  let cell = null;
  for (const line of lines) {
    if (!line) continue;
    const o = JSON.parse(line);
    if (o.kind === 'header') {
      cell = o.config.name;
      for (const s of o.seats) { teamBot.set(s.teamID, s.bot); bump(arm, cell, s.bot, 'games'); }
      continue;
    }
    if (o.kind !== 'turn') continue;
    const teamOf = (unitID) => {
      const dash = unitID.lastIndexOf('-');
      const t = dash > 0 ? unitID.slice(0, dash) : null;
      if (t !== null && teamBot.has(t)) return t;
      const u = (o.board.snakes || []).find((s) => s.id === unitID);
      return u ? u.teamID : null;
    };
    /** Was some team OTHER than `team` inside its own window at this turn? */
    const enemyWindowOpen = (team) => {
      for (const [t, turns] of teamPickupTurns) {
        if (t === team) continue;
        if (turns.some((tp) => o.turn - tp >= 0 && o.turn - tp <= W)) return true;
      }
      return false;
    };

    for (const pc of o.world.potionsCollected) {
      const t = teamOf(pc.unitID);
      if (t === null) continue;
      bump(arm, cell, teamBot.get(t), 'pickups');
      lastPickupTurn.set(pc.unitID, o.turn);
      if (!teamPickupTurns.has(t)) teamPickupTurns.set(t, []);
      teamPickupTurns.get(t).push(o.turn);
    }

    for (const cl of o.events.clashes || []) {
      if (cl.kind !== 'sever') continue;
      const attacker = cl.survivorID ?? null;
      if (attacker === null) continue;
      const at = teamOf(attacker);
      if (at === null) continue;
      const sc = o.events.severedCells || {};
      let w = 0;
      for (const [vid, cells] of Object.entries(sc)) {
        if (vid === attacker) continue;
        if (!(cl.playerIDs || []).includes(vid)) continue;
        const n = Array.isArray(cells) ? cells.length : 0;
        w += n;
        const vt = teamOf(vid);
        if (vt !== null && enemyWindowOpen(vt)) bump(arm, cell, teamBot.get(vt), 'underWindowSevered', n);
      }
      bump(arm, cell, teamBot.get(at), 'severs');
      bump(arm, cell, teamBot.get(at), 'severWeight', w);
      const own = teamPickupTurns.get(at) || [];
      if (own.some((tp) => o.turn - tp >= 0 && o.turn - tp <= W)) {
        bump(arm, cell, teamBot.get(at), 'windowSevers');
        bump(arm, cell, teamBot.get(at), 'windowSeverWeight', w);
      }
    }

    // Who was in a clash with whom this turn — the attribution for a kill.
    const partners = new Map();
    for (const cl of o.events.clashes || []) {
      for (const a of cl.playerIDs || []) {
        if (!partners.has(a)) partners.set(a, new Set());
        for (const b of cl.playerIDs || []) if (b !== a) partners.get(a).add(b);
      }
    }

    for (const uid of Object.keys(o.events.deaths || {})) {
      const t = teamOf(uid);
      if (t === null) continue;
      const bot = teamBot.get(t);
      bump(arm, cell, bot, 'deaths');
      const p = lastPickupTurn.get(uid);
      const wasCollector = p !== undefined && o.turn - p >= 0 && o.turn - p <= W;
      if (wasCollector) bump(arm, cell, bot, 'collectorDeaths');
      // THE DEFENSIVE SAVE: their collector, dead, with one of ours in the
      // clash. Credited to every OTHER team present, because that is who
      // collapsed the window and the replay does not name a single killer for
      // a contest with no strict maximum.
      if (wasCollector) {
        const credited = new Set();
        for (const other of partners.get(uid) || []) {
          const ot = teamOf(other);
          if (ot === null || ot === t || credited.has(ot)) continue;
          credited.add(ot);
          bump(arm, cell, teamBot.get(ot), 'collectorKills');
        }
      }
      if (enemyWindowOpen(t)) bump(arm, cell, bot, 'underWindowLosses');
    }
  }
}

// The arms are identical builds, so per-bot rows add.
const pooled = new Map();
for (const r of acc.values()) {
  const k = `${r.cell} ${r.bot}`;
  let p = pooled.get(k);
  if (p === undefined) { p = { cell: r.cell, bot: r.bot }; for (const f of FIELDS) p[f] = 0; pooled.set(k, p); }
  for (const f of FIELDS) p[f] += r[f];
}

const per = (x, n) => (n === 0 ? '-' : (x / n).toFixed(3));
console.log(`# potion mechanism, window=${W} turns, ${files.length} replays, arms pooled`);
console.log('');
console.log('| cell | bot | games | pickups/g | windowSevers/g | windowSevWt/g | collectorKills/g | underWindowLosses/g | underWindowSevered/g | collectorDeaths/g | severWt/g | deaths/g |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const p of [...pooled.values()].sort((a, b) => a.cell.localeCompare(b.cell) || a.bot.localeCompare(b.bot))) {
  console.log(`| ${p.cell} | ${p.bot} | ${p.games} | ${per(p.pickups, p.games)} | ${per(p.windowSevers, p.games)} | ` +
    `${per(p.windowSeverWeight, p.games)} | ${per(p.collectorKills, p.games)} | ${per(p.underWindowLosses, p.games)} | ` +
    `${per(p.underWindowSevered, p.games)} | ${per(p.collectorDeaths, p.games)} | ${per(p.severWeight, p.games)} | ${per(p.deaths, p.games)} |`);
}
console.log('');
console.log(JSON.stringify([...pooled.values()]));
