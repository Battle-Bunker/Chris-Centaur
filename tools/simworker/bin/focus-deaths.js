#!/usr/bin/env node
'use strict';
/*
 * DO THE EXTRA DEATHS HAPPEN ON THE TURNS THE FOCUS FIRED?
 *
 * Every acceptance cell has the branch bot dying more than the parent, and the
 * potion-free cell has it too — where both advisory terms read zero and the
 * candidate ordering has nothing to order, so NARROWING is the only change still
 * live. That isolates the suspect. This asks the next question without playing
 * another game, because the replays already carry, per turn and per seat, both
 * halves of it: `telemetry[team].mechanism.scout.focus.fired` and
 * `events.deaths` keyed by unit id (whose prefix is the team).
 *
 * The reading is a WITHIN-BOT rate ratio:
 *
 *     deaths per decision on turns the focus FIRED
 *     ------------------------------------------------
 *     deaths per decision on turns it did NOT
 *
 * Within-bot is the point. A comparison against the other bot would confound
 * narrowing with everything else about the position; comparing a bot's own
 * fired turns against its own quiet turns holds the bot fixed and asks only
 * whether the act of narrowing is when it loses units. A ratio near 1 says
 * narrowing is not where the deaths are and the suspect is wrong. Above 1 says
 * it is.
 *
 * THE CONFOUND, NAMED: the focus fires BECAUSE something acute is happening, and
 * acute situations are where units die anyway. So a ratio above 1 is expected
 * even from a perfect narrower, and the number that matters is the CONTROL's own
 * ratio — the parent bot has no narrowing, but it plays the same boards, so its
 * deaths-on-acute-turns rate is the baseline the treatment's has to beat. The
 * control's `fired` flag is always false, so its baseline is computed from the
 * TREATMENT's fired-turn set, matched by turn number within the same game.
 *
 * usage: node focusdeaths.js <batch-dir> [cell-substring]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [batch, cellFilter] = process.argv.slice(2);
if (!batch) {
  console.error('usage: focusdeaths.js <batch-dir> [cell-substring]');
  process.exit(2);
}

/** bot -> counters */
const acc = new Map();
const get = (bot) => {
  if (!acc.has(bot)) {
    acc.set(bot, {
      firedTurns: 0,
      quietTurns: 0,
      deathsOnFired: 0,
      deathsOnQuiet: 0,
      // matched baseline: this bot's deaths on turns when ANOTHER seat narrowed
      matchedTurns: 0,
      deathsOnMatched: 0,
      games: 0,
    });
  }
  return acc.get(bot);
};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.jsonl.gz')) out.push(p);
  }
  return out;
}

const files = walk(path.join(batch, 'arms'), []).filter(
  (f) => cellFilter === undefined || path.basename(f).includes(cellFilter)
);

for (const f of files) {
  let text;
  try {
    text = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
  } catch {
    continue;
  }
  const lines = text.trim().split('\n');
  let header = null;
  /** team -> bot name */
  const botOf = new Map();
  const turns = [];
  for (const line of lines) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.kind === 'header') {
      header = o;
      for (const s of o.seats ?? []) botOf.set(s.teamID, s.bot);
    } else if (o.kind === 'turn') {
      turns.push(o);
    }
  }
  if (header === null) continue;
  for (const bot of new Set(botOf.values())) get(bot).games++;

  for (const t of turns) {
    const tele = t.telemetry ?? {};
    // deaths this turn, by team
    const deadByTeam = new Map();
    for (const unitId of Object.keys(t.events?.deaths ?? {})) {
      const team = unitId.slice(0, unitId.lastIndexOf('-'));
      deadByTeam.set(team, (deadByTeam.get(team) ?? 0) + 1);
    }
    // which teams narrowed this turn
    const firedTeams = new Set();
    for (const team of Object.keys(tele)) {
      const fired = tele[team]?.mechanism?.scout?.focus?.fired;
      if (fired === true) firedTeams.add(team);
    }
    for (const team of Object.keys(tele)) {
      const bot = botOf.get(team);
      if (bot === undefined) continue;
      const m = tele[team]?.mechanism;
      if (m == null) continue; // a seat that did not decide (reflex) has none
      const a = get(bot);
      const d = deadByTeam.get(team) ?? 0;
      if (firedTeams.has(team)) {
        a.firedTurns++;
        a.deathsOnFired += d;
      } else {
        a.quietTurns++;
        a.deathsOnQuiet += d;
        // MATCHED BASELINE: this seat did not narrow, but somebody did, so the
        // board is in the state that makes a narrower narrow.
        if (firedTeams.size > 0) {
          a.matchedTurns++;
          a.deathsOnMatched += d;
        }
      }
    }
  }
}

const r = (n, d) => (d === 0 ? NaN : n / d);
const f = (x) => (Number.isFinite(x) ? x.toFixed(4) : '—');
console.log(`# deaths per decision, split by whether the focus narrowed that turn`);
console.log(`# ${files.length} replays${cellFilter ? ` matching "${cellFilter}"` : ''}`);
console.log('');
console.log(
  '| bot | games | decisions | narrowed | deaths/dec NARROWED | deaths/dec QUIET | ratio | deaths/dec on turns SOMEONE ELSE narrowed |'
);
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const [bot, a] of [...acc.entries()].sort()) {
  const dec = a.firedTurns + a.quietTurns;
  const onFired = r(a.deathsOnFired, a.firedTurns);
  const onQuiet = r(a.deathsOnQuiet, a.quietTurns);
  console.log(
    `| ${bot} | ${a.games} | ${dec} | ${a.firedTurns} | ${f(onFired)} | ${f(onQuiet)} | ${f(
      onFired / onQuiet
    )} | ${f(r(a.deathsOnMatched, a.matchedTurns))} |`
  );
}
