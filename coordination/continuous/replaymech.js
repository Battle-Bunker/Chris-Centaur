#!/usr/bin/env node
'use strict';
/*
 * THE MECHANISM, READ OFF THE REPLAYS — zero new games.
 *
 * Cycles k1+k2 found the free potion-ordering slot (`potionOrder`) scoring
 * -0.145 [-0.258, -0.035] against `plain` on the interior-hazard cell,
 * replicated across two independent runs, while doing nothing on two
 * hazard-free cells. The proposed mechanism is that sorting a potion pickup as
 * a gain draws units across hazard cells to reach potions.
 *
 * That is a claim about PLAY, and the replays already on disk can check it
 * without a single new game. For each bot, in the same games, this counts:
 *
 *   potions   potions actually collected — does the ordering slot change
 *             behaviour at all? If potionOrder collects no more potions than
 *             plain, the slot is inert and the score difference is something
 *             else entirely.
 *   hazOcc    unit-turns spent standing on a hazard cell, per 100 unit-turns.
 *             The direct measure of "walks into hazards".
 *   hazHeadT  turns the bot moved a head ONTO a hazard cell (entries, not
 *             occupancy) per 100 head-moves — occupancy double-counts a unit
 *             that is merely stuck.
 *   health    mean team health per unit at end of turn; hazard damage is a
 *             health cost, so if the story is right this should be lower for
 *             the potion bots on hazard cells and equal on hazard-free ones.
 *   deaths    units lost, from the turn events.
 *
 * All three bots sit in the SAME game, so every count is paired on the board
 * and the seat rotation cancels position.
 *
 * usage: node replaymech.js <batch-dir> [<batch-dir> ...]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const batches = process.argv.slice(2);
if (!batches.length) {
  console.error('usage: replaymech.js <batch-dir> [...]');
  process.exit(2);
}

/** cell -> bot -> counters */
const agg = new Map();
let potionsSpawned = 0;
let gamesSeen = 0;
function slot(cell, bot) {
  if (!agg.has(cell)) agg.set(cell, new Map());
  const m = agg.get(cell);
  if (!m.has(bot))
    m.set(bot, { games: 0, potions: 0, unitTurns: 0, hazOcc: 0, headMoves: 0, hazHead: 0, healthSum: 0, healthN: 0, deaths: 0 });
  return m.get(bot);
}

async function readReplay(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let seatBot = null;
  let cell = null;
  let prevHeads = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.kind === 'header') {
      cell = d.config && d.config.name;
      seatBot = new Map();
      for (const s of d.seats) seatBot.set(s.teamID, s.bot);
      for (const s of d.seats) slot(cell, s.bot).games++;
      gamesSeen++;
      continue;
    }
    if (d.kind !== 'turn' || !seatBot) continue;

    const hz = new Set((d.board.hazards || []).map((h) => `${h.x},${h.y}`));

    // occupancy and head entries, per team
    const heads = new Map();
    for (const sn of d.board.snakes || []) {
      const bot = seatBot.get(sn.teamID);
      if (!bot) continue;
      const a = slot(cell, bot);
      for (const seg of sn.body || []) {
        a.unitTurns++;
        if (hz.has(`${seg.x},${seg.y}`)) a.hazOcc++;
      }
      const h = sn.head;
      if (h) {
        heads.set(sn.id, `${h.x},${h.y}`);
        // a head ENTRY is a head on a hazard cell that was not there last turn
        if (prevHeads && prevHeads.has(sn.id)) {
          a.headMoves++;
          const now = `${h.x},${h.y}`;
          if (hz.has(now) && prevHeads.get(sn.id) !== now) a.hazHead++;
        }
      }
    }
    prevHeads = heads;

    for (const st of d.standings || []) {
      const bot = seatBot.get(st.teamID);
      if (!bot) continue;
      const a = slot(cell, bot);
      if (st.units > 0) {
        a.healthSum += st.health / st.units;
        a.healthN++;
      }
    }

    for (const p of (d.world && d.world.potionsCollected) || []) {
      // The entry is {unitID: 'red-3', cell: {x,y}} — the team is the prefix.
      const uid = p.unitID || p.id || '';
      const team = p.teamID || (typeof uid === 'string' ? uid.split('-')[0] : null);
      const bot = team && seatBot.get(team);
      if (bot) slot(cell, bot).potions++;
    }
    for (const p of (d.world && d.world.potionsSpawned) || []) potionsSpawned++;

    const deaths = (d.events && d.events.deaths) || {};
    for (const id of Object.keys(deaths)) {
      const team = id.split('-')[0];
      const bot = seatBot.get(team);
      if (bot) slot(cell, bot).deaths++;
    }
  }
}

(async () => {
  const files = [];
  for (const batch of batches) {
    const armsDir = path.join(batch, 'arms');
    if (!fs.existsSync(armsDir)) continue;
    for (const arm of fs.readdirSync(armsDir)) {
      for (const sw of fs.readdirSync(path.join(armsDir, arm))) {
        const dir = path.join(armsDir, arm, sw);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const f of fs.readdirSync(dir)) {
          if (f.endsWith('.jsonl.gz')) files.push(path.join(dir, f));
        }
      }
    }
  }
  console.log(`# replay mechanism — ${files.length} replays from ${batches.length} batch(es)`);
  for (const f of files) await readReplay(f);

  console.log('');
  console.log(`# potions spawned across all replays: ${potionsSpawned} (${(potionsSpawned / (gamesSeen || 1)).toFixed(2)} per game)`);
  console.log('');
  console.log('| cell | bot | games | potions/game | hazard occupancy per 100 unit-turns | head entries into hazard per 100 moves | mean health/unit | deaths/game |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const [cell, byBot] of [...agg].sort()) {
    for (const [bot, a] of [...byBot].sort()) {
      console.log(
        `| ${cell} | ${bot} | ${a.games} | ${(a.potions / a.games).toFixed(2)} | ${(
          (100 * a.hazOcc) / (a.unitTurns || 1)
        ).toFixed(2)} | ${((100 * a.hazHead) / (a.headMoves || 1)).toFixed(2)} | ${(
          a.healthSum / (a.healthN || 1)
        ).toFixed(1)} | ${(a.deaths / a.games).toFixed(2)} |`
      );
    }
  }
})();
