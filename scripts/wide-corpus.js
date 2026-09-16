#!/usr/bin/env node
/**
 * READING THE WIDE CORPUS — the table, the paired tests, and the death census.
 *
 * `scripts/wide-corpus.sh` records the corpus: one JSON summary and one full
 * trace per (scenario, seed, arm). This reads what it recorded.
 *
 *   node scripts/wide-corpus.js table  <dir>              the summary table
 *   node scripts/wide-corpus.js pair   <dir> <A> <B>      a paired sign test
 *   node scripts/wide-corpus.js census <dir> [scenario]   deaths/parks/pickups
 *                                                          read off the traces
 *
 * `<A>` and `<B>` are `scenario` or `scenario:arm` (arm defaults to `mirror`).
 *
 * THE ONE RULE IT KEEPS, and it is `ab-compare.js`'s: NOTHING IS POOLED ACROSS
 * BOARD CLASSES. Every row of the table is one (scenario, arm) and the totals
 * column is a sum over that class's seeds only. `pair` will compare two classes
 * — that is what it is for — but only ever seed-by-seed, and only two classes
 * that were run at the same seeds, so the pairing is a real pairing: `long`
 * against `mixed` is the same game run twice as far, and `wide:material-only`
 * against `wide:mirror` is the same board against a different field. Two classes that do not share a roster are not made comparable by this
 * script and asking it for one prints the warning it deserves.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ARMS = ['mirror', 'material-only'];

function readCorpus(dir) {
  const jsonDir = path.join(dir, 'json');
  if (!fs.existsSync(jsonDir)) {
    process.stderr.write(`no ${jsonDir} — record the corpus first\n`);
    process.exit(1);
  }
  const runs = [];
  for (const f of fs.readdirSync(jsonDir).sort()) {
    if (!f.endsWith('.jsonl')) continue;
    const text = fs.readFileSync(path.join(jsonDir, f), 'utf8').trim();
    if (text === '') continue;
    for (const line of text.split('\n')) {
      const run = JSON.parse(line);
      run.arm = run.opponent ?? 'mirror';
      run.file = path.join(jsonDir, f);
      runs.push(run);
    }
  }
  return runs;
}

/** Exact two-sided binomial against p = 1/2 — `ab-compare.js`'s test, verbatim. */
function signTest(deltas) {
  const nonzero = deltas.filter((d) => d !== 0);
  const n = nonzero.length;
  const up = nonzero.filter((d) => d > 0).length;
  if (n === 0) return { n: 0, up: 0, down: 0, p: 1 };
  const choose = (a, b) => {
    let r = 1;
    for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1);
    return r;
  };
  const extreme = Math.min(up, n - up);
  let tail = 0;
  for (let k = 0; k <= extreme; k++) tail += choose(n, k);
  return { n, up, down: n - up, p: Math.min(1, (2 * tail) / Math.pow(2, n)) };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const per100 = (n, ut) => (ut === 0 ? 0 : (100 * n) / ut);
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '-');

/** Every (scenario, arm) group present, in the corpus's own scenario order. */
function groups(runs) {
  const order = [];
  const by = new Map();
  for (const r of runs) {
    const key = `${r.scenario}|${r.arm}`;
    if (!by.has(key)) {
      by.set(key, []);
      order.push(key);
    }
    by.get(key).push(r);
  }
  for (const rs of by.values()) rs.sort((a, b) => a.seed - b.seed);
  return { order, by };
}

function totalsOf(rs) {
  const c = (k) => sum(rs.map((r) => r.counters[k] ?? 0));
  const ut = c('unitTurns');
  const deaths = c('starvationDeaths') + c('otherDeaths');
  const causes = {};
  for (const r of rs) {
    for (const [k, v] of Object.entries(r.deathsByCause ?? {})) causes[k] = (causes[k] ?? 0) + v;
  }
  return {
    runs: rs.length,
    ut,
    turns: c('turns'),
    meals: c('meals'),
    grown: c('grownMeals'),
    deaths,
    causes,
    stationary: c('stationary'),
    longestPark: Math.max(...rs.map((r) => r.counters.longestPark ?? 0)),
    immobile: c('immobileUnitTurns'),
    deathsWhileImmobile: c('deathsWhileImmobile'),
    reversals: c('reversals'),
    unjustified: c('unjustifiedReversals'),
    seedKept: c('seedKept'),
    episodes: c('entrapmentEpisodes'),
    escaped: c('escapedEntrapments'),
    fatal: c('fatalEntrapments'),
    entrappedUt: c('entrappedUnitTurns'),
    leadSum: c('entrapmentLeadSum'),
    pickups: c('potionPickups'),
    reckless: c('recklessPickups'),
    profitable: c('profitablePickups'),
    profitableSafe: c('profitableSafePickups'),
    tierUps: c('potionTierUps'),
    tierDowns: c('potionTierDowns'),
    debuffedDeaths: c('deathsWhileDebuffed'),
    buffedDeaths: c('deathsWhileBuffed'),
    enemyEntries: c('enemyOccupiedEntries'),
    enemyEntriesLost: c('enemyOccupiedEntriesLost'),
    survivors: c('survivors'),
    crashed: rs.filter((r) => r.crashed !== null).length,
  };
}

function table(dir) {
  const runs = readCorpus(dir);
  const { order, by } = groups(runs);
  const out = [];
  out.push(`# The wide corpus — ${runs.length} games`);
  out.push('');
  out.push(
    'Recorded by `scripts/wide-corpus.sh`, deterministic mode (`--nodes`), so every ' +
      'number is a function of (build, scenario, seed, arm). Nothing is pooled across ' +
      'board classes; every row is one class on one arm.'
  );
  out.push('');
  out.push('## Play');
  out.push('');
  out.push(
    '| class | arm | runs | unit-turns | meals/100 | grown/meals | deaths | deaths/100 | by cause | survivors | crashed |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const key of order) {
    const [scen, arm] = key.split('|');
    const t = totalsOf(by.get(key));
    const causes = Object.entries(t.causes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    out.push(
      `| \`${scen}\` | ${arm} | ${t.runs} | ${t.ut} | ${f2(per100(t.meals, t.ut))} | ` +
        `${f2(t.meals === 0 ? 0 : t.grown / t.meals)} | ${t.deaths} | ` +
        `${f3(per100(t.deaths, t.ut))} | ${causes || '—'} | ${t.survivors} | ${t.crashed} |`
    );
  }
  out.push('');
  out.push('## Parking, immobility and reversals, per 100 unit-turns');
  out.push('');
  out.push(
    '| class | arm | parked | longestPark (max) | immobile | diedImmobile | reversals | unjustified | seedKept |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const key of order) {
    const [scen, arm] = key.split('|');
    const t = totalsOf(by.get(key));
    out.push(
      `| \`${scen}\` | ${arm} | ${f2(per100(t.stationary, t.ut))}% | ${t.longestPark} | ` +
        `${f2(per100(t.immobile, t.ut))}% | ${t.deathsWhileImmobile} | ` +
        `${f2(per100(t.reversals, t.ut))}% | ${f2(per100(t.unjustified, t.ut))}% | ` +
        `${f2(per100(t.seedKept, t.ut))}% |`
    );
  }
  out.push('');
  out.push('## Entrapment instrument');
  out.push('');
  out.push(
    '| class | arm | episodes | escaped | fatal | entrapped unit-turns | mean lead before a fatal |'
  );
  out.push('|---|---|---|---|---|---|---|');
  for (const key of order) {
    const [scen, arm] = key.split('|');
    const t = totalsOf(by.get(key));
    out.push(
      `| \`${scen}\` | ${arm} | ${t.episodes} | ${t.escaped} | ${t.fatal} | ` +
        `${t.entrappedUt} (${f2(per100(t.entrappedUt, t.ut))}%) | ` +
        `${t.fatal === 0 ? '—' : f2(t.leadSum / t.fatal)} |`
    );
  }
  out.push('');
  out.push('## Potions (classes that have any)');
  out.push('');
  out.push(
    '| class | arm | pickups | profitable | reckless | profitable AND safe | tier ups | tier downs | died debuffed | died buffed |'
  );
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const key of order) {
    const t = totalsOf(by.get(key));
    if (t.pickups === 0 && t.tierUps === 0) continue;
    const [scen, arm] = key.split('|');
    out.push(
      `| \`${scen}\` | ${arm} | ${t.pickups} | ${t.profitable} | ${t.reckless} ` +
        `(${f2(t.pickups === 0 ? 0 : (100 * t.reckless) / t.pickups)}%) | ${t.profitableSafe} ` +
        `(${f2(t.pickups === 0 ? 0 : (100 * t.profitableSafe) / t.pickups)}%) | ` +
        `${t.tierUps} | ${t.tierDowns} | ${t.debuffedDeaths} | ${t.buffedDeaths} |`
    );
  }
  out.push('');
  out.push('## Enemy-occupied entries (D1 instrument, board-wide — read per team or not at all)');
  out.push('');
  out.push('| class | arm | entries | lost |');
  out.push('|---|---|---|---|');
  for (const key of order) {
    const [scen, arm] = key.split('|');
    const t = totalsOf(by.get(key));
    out.push(`| \`${scen}\` | ${arm} | ${t.enemyEntries} | ${t.enemyEntriesLost} |`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// The paired sign test between two groups of the corpus
// ---------------------------------------------------------------------------

const PAIR_METRICS = [
  'rates.mealsPer100',
  'rates.deathsPer100',
  'rates.stationaryPer100',
  'rates.immobileUnitTurnsPer100',
  'rates.reversalsPer100',
  'rates.entrappedUnitTurnsPer100',
  'rates.potionPickupsPer100',
  'rates.recklessPickupsPer100',
  'rates.enemyOccupiedEntriesLostPer100',
  'counters.survivors',
  'counters.longestPark',
  'counters.unitTurns',
];

const pick = (run, dotted) =>
  dotted.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), run);

function parseRef(ref) {
  const [scenario, arm] = ref.split(':');
  return { scenario, arm: arm ?? 'mirror' };
}

function pair(dir, refA, refB, metrics) {
  const runs = readCorpus(dir);
  const a = parseRef(refA);
  const b = parseRef(refB);
  const sel = (q) =>
    new Map(
      runs.filter((r) => r.scenario === q.scenario && r.arm === q.arm).map((r) => [r.seed, r])
    );
  const A = sel(a);
  const B = sel(b);
  const seeds = [...A.keys()].filter((s) => B.has(s)).sort((x, y) => x - y);
  process.stdout.write(`\n=== ${refA}  vs  ${refB}   (${seeds.length} paired seeds) ===\n`);
  if (seeds.length === 0) {
    process.stdout.write('  no seed is in both groups — nothing to pair\n');
    return;
  }
  process.stdout.write(
    `${'metric'.padEnd(38)}${'A'.padStart(10)}${'B'.padStart(10)}${'delta'.padStart(10)}` +
      `${'up/down'.padStart(10)}${'p'.padStart(10)}\n`
  );
  for (const m of metrics) {
    const as = seeds.map((s) => pick(A.get(s), m) ?? 0);
    const bs = seeds.map((s) => pick(B.get(s), m) ?? 0);
    const deltas = seeds.map((_, i) => bs[i] - as[i]);
    const st = signTest(deltas);
    const mA = sum(as) / as.length;
    const mB = sum(bs) / bs.length;
    process.stdout.write(
      `${m.padEnd(38)}${f3(mA).padStart(10)}${f3(mB).padStart(10)}` +
        `${f3(mB - mA).padStart(10)}${`${st.up}/${st.down}`.padStart(10)}` +
        `${(st.n === 0 ? '—' : st.p.toExponential(2)).padStart(10)}\n`
    );
  }
  // The death causes, which are counts and not rates, tested the same way.
  const causes = new Set();
  for (const s of seeds) {
    for (const k of Object.keys(A.get(s).deathsByCause ?? {})) causes.add(k);
    for (const k of Object.keys(B.get(s).deathsByCause ?? {})) causes.add(k);
  }
  for (const c of [...causes].sort()) {
    const as = seeds.map((s) => (A.get(s).deathsByCause ?? {})[c] ?? 0);
    const bs = seeds.map((s) => (B.get(s).deathsByCause ?? {})[c] ?? 0);
    const st = signTest(seeds.map((_, i) => bs[i] - as[i]));
    process.stdout.write(
      `${`deaths.${c}`.padEnd(38)}${String(sum(as)).padStart(10)}${String(sum(bs)).padStart(10)}` +
        `${String(sum(bs) - sum(as)).padStart(10)}${`${st.up}/${st.down}`.padStart(10)}` +
        `${(st.n === 0 ? '—' : st.p.toExponential(2)).padStart(10)}\n`
    );
  }
}

// ---------------------------------------------------------------------------
// The census — what the TRACES say, which is what an audit is written from
// ---------------------------------------------------------------------------

const RE_TURN = /^turn (\d+)/;
const RE_MOVE = /^ {2}T\s+(\d+) (\S+)\s+(\S+)\s+hp\s*(\d+) \((-?\d+),(-?\d+)\)->\((-?\d+),(-?\d+)\)(.*)$/;
const RE_DEATH = /^ {2}DEATH (\S+) \((\w+)\)/;
const RE_POTION = /^ {2}POTION x(\d+)/;

/**
 * One trace, read into the facts the audits are written from: who died of what
 * and when, how long every park ran, and every pickup's own reading.
 */
function readTrace(file) {
  const text = fs.readFileSync(file, 'utf8');
  const kindOf = new Map();
  const deaths = [];
  const parks = new Map(); // unit -> { run, longest, at }
  const pickups = [];
  let turn = 0;
  for (const line of text.split('\n')) {
    const t = RE_TURN.exec(line);
    if (t !== null) {
      turn = Number(t[1]);
      continue;
    }
    const m = RE_MOVE.exec(line);
    if (m !== null) {
      const [, tn, unit, kind, hp, fx, fy, , , tail] = m;
      kindOf.set(unit, kind);
      const p = parks.get(unit) ?? { run: 0, longest: 0, at: null, atTurn: 0 };
      if (tail.includes(' PARKED')) {
        p.run += 1;
        if (p.run > p.longest) {
          p.longest = p.run;
          p.at = `(${fx},${fy})`;
          p.atTurn = Number(tn);
        }
      } else p.run = 0;
      parks.set(unit, p);
      void hp;
      continue;
    }
    const d = RE_DEATH.exec(line);
    if (d !== null) {
      deaths.push({ turn, unit: d[1], kind: kindOf.get(d[1]) ?? '?', cause: d[2], line });
      continue;
    }
    if (RE_POTION.test(line)) {
      for (const bit of (/\[(.*)\]/.exec(line)?.[1] ?? '').split('; ')) {
        const unit = bit.split(' ')[0];
        if (unit === undefined || unit === '') continue;
        pickups.push({
          turn,
          unit,
          kind: kindOf.get(unit) ?? '?',
          reckless: bit.includes('EXPOSED'),
          arrivalBeaten: bit.includes('arrival=BEATEN'),
          enemyTier: Number(/enemyTier\+(\d+)/.exec(bit)?.[1] ?? 0),
          line,
        });
      }
    }
  }
  return { deaths, parks, pickups };
}

function census(dir, only) {
  const logDir = path.join(dir, 'logs');
  const files = fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith('.log'))
    .sort();
  const scenarios = require(path.join(process.cwd(), 'dist/tests/local-game.js')).SCENARIOS;
  const rows = new Map();
  const parkRows = [];
  const pickupRows = [];
  for (const f of files) {
    const m = /^(.*)-(\d+)-(mirror|material-only)\.log$/.exec(f);
    if (m === null) continue;
    const [, scen, seedStr, arm] = m;
    if (only !== undefined && scen !== only) continue;
    const ours = scenarios[scen]?.teams[0]?.id ?? 'red';
    const tr = readTrace(path.join(logDir, f));
    for (const d of tr.deaths) {
      const side = d.unit.startsWith(`${ours}-`) ? 'ours' : 'theirs';
      const key = `${scen}|${arm}|${side}|${d.kind}|${d.cause}`;
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    for (const [unit, p] of tr.parks) {
      if (p.longest >= 8) {
        parkRows.push({ scen, arm, seed: Number(seedStr), unit, kind: '', ...p });
      }
    }
    for (const p of tr.pickups) {
      pickupRows.push({ scen, arm, seed: Number(seedStr), ...p });
    }
  }
  process.stdout.write('\n== deaths by class / arm / side / kind / cause ==\n');
  for (const [k, v] of [...rows.entries()].sort()) {
    process.stdout.write(`${k.replace(/\|/g, '  ')}  ${v}\n`);
  }
  process.stdout.write('\n== parks of 8+ consecutive turns ==\n');
  for (const p of parkRows.sort((a, b) => b.longest - a.longest)) {
    process.stdout.write(
      `${p.scen} ${p.arm} seed ${p.seed}  ${p.unit}  ${p.longest} turns, longest ending T${p.atTurn} at ${p.at}\n`
    );
  }
  const rec = pickupRows.filter((p) => p.reckless).length;
  process.stdout.write(
    `\n== pickups ==\n${pickupRows.length} total, ${rec} reckless, ` +
      `${pickupRows.filter((p) => p.arrivalBeaten).length} arrival-beaten\n`
  );
}

function main() {
  const [mode, dir, ...rest] = process.argv.slice(2);
  if (mode === 'table' && dir !== undefined) return table(dir);
  if (mode === 'pair' && dir !== undefined && rest.length >= 2) {
    const flags = rest.filter((a) => a.startsWith('--'));
    const refs = rest.filter((a) => !a.startsWith('--'));
    const metricFlag = flags.find((f) => f.startsWith('--metrics='));
    const metrics = metricFlag === undefined ? PAIR_METRICS : metricFlag.slice(10).split(',');
    return pair(dir, refs[0], refs[1], metrics);
  }
  if (mode === 'census' && dir !== undefined) return census(dir, rest[0]);
  process.stdout.write(
    'usage:\n' +
      '  node scripts/wide-corpus.js table  <dir>\n' +
      '  node scripts/wide-corpus.js pair   <dir> <scenario[:arm]> <scenario[:arm]> [--metrics=a,b]\n' +
      '  node scripts/wide-corpus.js census <dir> [scenario]\n' +
      `arms: ${ARMS.join(', ')}\n`
  );
  process.exit(1);
}

main();
