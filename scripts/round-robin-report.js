#!/usr/bin/env node
/**
 * THE ROUND-ROBIN TABLE — the arithmetic `round-robin.sh` deliberately does not
 * do.
 *
 *     node scripts/round-robin-report.js .round-robin [--md] [--class mixed]
 *
 * It reads every `<class>__<arm>__seat<N>.jsonl` under the directory and prints
 * one block per board class. Nothing is pooled across classes, ever, for the
 * reason `ab-compare.js` gives at length: `snakes`, `mixed`, `potions` and
 * `sparse` have different rosters, different food densities and different death
 * causes, and a mean over them is a number with no referent.
 *
 * ── WHAT IS REPORTED, AND WHY IT IS THAT AND NOT A WIN RATE ────────────────
 *
 * The runner has no win/draw/loss counter yet — every game runs to the turn cap
 * and stops, and `stepGame` never adjudicates a match. So the outcome column is
 * WEIGHT AT THE CAP: the total occupancy of the units still standing when the
 * cap stopped the game, per side. Material is what the game is won with and the
 * only quantity `DEFAULT_WEIGHTS` denominates the cliff in, so who is holding
 * more of it is the closest reading of "who was ahead" the transcript carries.
 *
 * It is reported as a SHARE, `ours / (ours + theirs)`, and never as a
 * difference, because `mixed`, `snakes` and `potions` seat one default against
 * TWO opponents: a raw difference there is one team against two and is negative
 * for a bot that is winning. The share's baseline is the MIRROR arm's own
 * share on the same class and seat — the run where every team plays the default
 * profile — and not 1/3, because the seats are not symmetric either. The `Δ`
 * column is the matchup's share minus that baseline, and it is the only number
 * in the table that answers "did the default do better or worse than it does
 * against itself".
 *
 * The two seats are printed separately AND pooled, and the pooled row is
 * flagged when the seats disagree in sign: a matchup that only holds from one
 * seat is a fact about the seat, and saying so is the whole reason both are run.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let dir = null;
let only = null;
let md = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--md') md = true;
  else if (args[i] === '--class') only = args[++i];
  else dir = args[i];
}
if (dir === null) {
  console.error('usage: round-robin-report.js DIR [--md] [--class NAME]');
  process.exit(2);
}

// name -> { class, arm, seat, runs[] }
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.jsonl'))
  .sort();

const cells = new Map(); // `${class}|${arm}|${seat}` -> aggregate
const classes = [];
const arms = [];

for (const f of files) {
  const m = /^(.+?)__(.+?)__seat(\d+)\.jsonl$/.exec(f);
  if (m === null) continue;
  const [, klass, arm, seat] = m;
  if (only !== null && klass !== only) continue;
  const runs = fs
    .readFileSync(path.join(dir, f), 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
  if (runs.length === 0) continue;
  if (!classes.includes(klass)) classes.push(klass);
  if (!arms.includes(arm)) arms.push(arm);
  const agg = {
    seeds: runs.length,
    crashed: runs.filter((r) => r.crashed !== null).length,
    oursDeaths: 0,
    theirsDeaths: 0,
    oursMeals: 0,
    theirsMeals: 0,
    oursUnitTurns: 0,
    theirsUnitTurns: 0,
    oursSeedKept: 0,
    theirsSeedKept: 0,
    oursWeight: 0,
    theirsWeight: 0,
    oursSurvivors: 0,
    theirsSurvivors: 0,
    // Per-seed share, kept so the pooled share can be checked against the
    // per-seed spread rather than reported as if six seeds were one game.
    shares: [],
    // Seeds the opponent was wiped out on, and seeds we were.
    wipedThem: 0,
    wipedUs: 0,
  };
  for (const r of runs) {
    const c = r.counters;
    for (const k of Object.keys(agg)) {
      if (typeof c[k] === 'number') agg[k] += c[k];
    }
    const tot = c.oursWeight + c.theirsWeight;
    agg.shares.push(tot === 0 ? 0 : c.oursWeight / tot);
    if (c.theirsSurvivors === 0) agg.wipedThem++;
    if (c.oursSurvivors === 0) agg.wipedUs++;
  }
  agg.share = agg.oursWeight + agg.theirsWeight === 0
    ? 0
    : agg.oursWeight / (agg.oursWeight + agg.theirsWeight);
  cells.set(`${klass}|${arm}|${seat}`, agg);
}

const ORDER = ['mirror', 'material-only', 'random-legal', 'glutton', 'aggressive', 'territorial', 'cautious'];
arms.sort((a, b) => {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
});
const CLASS_ORDER = ['mixed', 'snakes', 'potions', 'sparse', 'sparse-lean'];
classes.sort((a, b) => {
  const ia = CLASS_ORDER.indexOf(a);
  const ib = CLASS_ORDER.indexOf(b);
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || (a < b ? -1 : 1);
});

const seats = ['0', '1'];
const pool = (klass, arm) => {
  const parts = seats.map((s) => cells.get(`${klass}|${arm}|${s}`)).filter(Boolean);
  if (parts.length === 0) return null;
  const out = { seeds: 0, crashed: 0, shares: [], wipedThem: 0, wipedUs: 0 };
  for (const key of [
    'oursDeaths', 'theirsDeaths', 'oursMeals', 'theirsMeals', 'oursUnitTurns',
    'theirsUnitTurns', 'oursSeedKept', 'theirsSeedKept', 'oursWeight',
    'theirsWeight', 'oursSurvivors', 'theirsSurvivors',
  ]) {
    out[key] = parts.reduce((a, p) => a + p[key], 0);
  }
  for (const p of parts) {
    out.seeds += p.seeds;
    out.crashed += p.crashed;
    out.wipedThem += p.wipedThem;
    out.wipedUs += p.wipedUs;
    out.shares.push(...p.shares);
  }
  out.share = out.oursWeight + out.theirsWeight === 0
    ? 0
    : out.oursWeight / (out.oursWeight + out.theirsWeight);
  return out;
};

const n3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
const rate = (n, d) => (d === 0 ? 'n/a' : ((100 * n) / d).toFixed(1));
const sgn = (x) => (x >= 0 ? `+${x.toFixed(3)}` : x.toFixed(3));

const rows = [];
for (const klass of classes) {
  const base = pool(klass, 'mirror');
  const baseSeat = Object.fromEntries(
    seats.map((s) => [s, cells.get(`${klass}|mirror|${s}`)])
  );
  const lines = [];
  const head = [
    'arm', 'seeds', 'ourDeaths', 'theirDeaths', 'ourMeals', 'theirMeals',
    'ourSeed%', 'theirSeed%', 'share', 'Δ vs mirror', 'seat0 Δ', 'seat1 Δ',
    'wiped them', 'wiped us',
  ];
  for (const arm of arms) {
    const p = pool(klass, arm);
    if (p === null) continue;
    const d = base === null ? NaN : p.share - base.share;
    const dSeat = seats.map((s) => {
      const c = cells.get(`${klass}|${arm}|${s}`);
      const b = baseSeat[s];
      return c === undefined || b === undefined ? NaN : c.share - b.share;
    });
    lines.push([
      arm,
      String(p.seeds),
      String(p.oursDeaths),
      String(p.theirsDeaths),
      String(p.oursMeals),
      String(p.theirsMeals),
      rate(p.oursSeedKept, p.oursUnitTurns),
      rate(p.theirsSeedKept, p.theirsUnitTurns),
      n3(p.share),
      arm === 'mirror' ? '—' : sgn(d),
      arm === 'mirror' ? '—' : sgn(dSeat[0]),
      arm === 'mirror' ? '—' : sgn(dSeat[1]),
      String(p.wipedThem),
      String(p.wipedUs),
    ]);
    if (p.crashed > 0) lines[lines.length - 1][0] += ` (CRASHED ${p.crashed})`;
  }
  rows.push({ klass, head, lines });
}

const widths = (head, lines) =>
  head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));

for (const { klass, head, lines } of rows) {
  console.log('');
  if (md) {
    console.log(`### \`${klass}\``);
    console.log('');
    console.log(`| ${head.join(' | ')} |`);
    console.log(`|${head.map(() => '---').join('|')}|`);
    for (const l of lines) console.log(`| ${l.join(' | ')} |`);
  } else {
    console.log(`=== ${klass} ===`);
    const w = widths(head, lines);
    console.log(head.map((h, i) => h.padEnd(w[i])).join('  '));
    for (const l of lines) console.log(l.map((c, i) => c.padEnd(w[i])).join('  '));
  }
}

// THE SEAT-DISAGREEMENT FLAG. A matchup whose two seats move the share in
// OPPOSITE directions is not a matchup result, it is a seat result, and the
// pooled row above hides that by construction. Named here rather than starred
// in the table so it cannot be skimmed past.
console.log('');
console.log('=== seats that disagree in sign (the pooled row is not a matchup result) ===');
let any = false;
for (const klass of classes) {
  for (const arm of arms) {
    if (arm === 'mirror') continue;
    const d = seats.map((s) => {
      const c = cells.get(`${klass}|${arm}|${s}`);
      const b = cells.get(`${klass}|mirror|${s}`);
      return c === undefined || b === undefined ? NaN : c.share - b.share;
    });
    if (!Number.isFinite(d[0]) || !Number.isFinite(d[1])) continue;
    if (Math.sign(d[0]) !== Math.sign(d[1]) && d[0] !== 0 && d[1] !== 0) {
      console.log(`  ${klass} vs ${arm}: seat0 ${sgn(d[0])}, seat1 ${sgn(d[1])}`);
      any = true;
    }
  }
}
if (!any) console.log('  (none)');

// THE ONE CLAIM THE WHOLE EXERCISE IS FOR: the default should never lose to a
// fixed weight table. Printed on its own, per class and per seat, because a
// pooled loss and a one-seat loss are different findings.
console.log('');
console.log('=== matchups the default is BEHIND its own mirror on (share Δ < 0) ===');
let behind = false;
for (const klass of classes) {
  for (const arm of arms) {
    if (arm === 'mirror') continue;
    for (const s of seats) {
      const c = cells.get(`${klass}|${arm}|${s}`);
      const b = cells.get(`${klass}|mirror|${s}`);
      if (c === undefined || b === undefined) continue;
      const d = c.share - b.share;
      if (d < 0) {
        console.log(
          `  ${klass} seat${s} vs ${arm}: ${sgn(d)} ` +
            `(share ${n3(c.share)} against mirror ${n3(b.share)}, ` +
            `deaths ${c.oursDeaths}/${c.theirsDeaths}, meals ${c.oursMeals}/${c.theirsMeals})`
        );
        behind = true;
      }
    }
  }
}
if (!behind) console.log('  (none)');
