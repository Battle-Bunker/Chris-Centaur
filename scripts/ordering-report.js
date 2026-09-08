#!/usr/bin/env node
/**
 * THE ORDERING REPORT — reads `--probe` rows and answers the three questions
 * of `docs/design/ORDERING.md` off one population.
 *
 * Every number here is a fold over rows the runner wrote; nothing is re-run and
 * nothing is estimated. Usage:
 *
 *   node scripts/ordering-report.js base-mixed.jsonl base-snakes.jsonl ...
 */
'use strict';
const fs = require('fs');

const rows = [];
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() !== '') rows.push(JSON.parse(line));
  }
}

const q = (xs, p) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const pct = (n, d) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`);

/** THE DECISION CLASS — cluster size and contact, the two axes the kernel's own
 *  partition is cut on, plus the candidate count as the width of the space. */
const classOf = (r) => {
  const c = r.shape.maxCluster >= 3 ? '3+' : String(r.shape.maxCluster);
  const k = r.shape.contact === 0 ? 'free' : r.shape.contact === 1 ? 'contact1' : 'contact2+';
  return `cluster${c}/${k}`;
};
const widthOf = (r) => (r.shape.candSum <= 8 ? '≤8' : r.shape.candSum <= 24 ? '9-24' : '25+');

const ref = rows.filter((r) => r.scale === 1);
const byKey = new Map(ref.map((r) => [`${r.scenario}|${r.seed}|${r.turn}|${r.team}`, r]));

// ---------------------------------------------------------------- section 1
console.log('== 1. RANK OF THE STAGED PLAN, at 1x, by class ==');
console.log('class                     n   trials(p50)  rank p50  p90   max  lead-chg p50  wasted');
const classes = new Map();
for (const r of ref) {
  const k = classOf(r);
  if (!classes.has(k)) classes.set(k, []);
  classes.get(k).push(r);
}
const order = [...classes.keys()].sort();
const line = (name, rs) => {
  const ranks = rs.map((r) => r.winnerRank);
  const nodes = rs.reduce((a, r) => a + r.nodes, 0);
  const wasted = rs.reduce((a, r) => a + r.wastedNodes, 0);
  console.log(
    `${name.padEnd(22)} ${String(rs.length).padStart(5)}  ${String(q(rs.map((r) => r.trials), 0.5)).padStart(10)}  ${String(q(ranks, 0.5)).padStart(8)}  ${String(q(ranks, 0.9)).padStart(4)}  ${String(Math.max(...ranks)).padStart(4)}  ${String(q(rs.map((r) => r.leaderChanges), 0.5)).padStart(12)}  ${pct(wasted, nodes).padStart(6)}`
  );
};
for (const k of order) line(k, classes.get(k));
line('ALL', ref);
console.log();
console.log('by scenario:');
for (const s of [...new Set(ref.map((r) => r.scenario))].sort()) {
  line(s, ref.filter((r) => r.scenario === s));
}
console.log();
console.log('by candidate width (candSum):');
for (const w of ['≤8', '9-24', '25+']) {
  const rs = ref.filter((r) => widthOf(r) === w);
  if (rs.length > 0) line(w, rs);
}
console.log();
{
  const rungs = new Map();
  for (const r of ref) rungs.set(r.winnerRung || '?', (rungs.get(r.winnerRung || '?') ?? 0) + 1);
  console.log('rung the 1x answer arrived on: ' + [...rungs].sort().map(([k, v]) => `${k} ${v} (${pct(v, ref.length)})`).join('  '));
}
console.log();
console.log('rank distribution, all classes:');
const buckets = [1, 2, 3, 5, 10, 25, 100, Infinity];
let seen = 0;
for (let i = 0; i < buckets.length; i++) {
  const lo = i === 0 ? 1 : buckets[i - 1] + 1;
  const hi = buckets[i];
  const n = ref.filter((r) => r.winnerRank >= lo && r.winnerRank <= hi).length;
  seen += n;
  const label = hi === Infinity ? `>${buckets[i - 1]}` : lo === hi ? `${hi}` : `${lo}-${hi}`;
  console.log(`  rank ${label.padEnd(8)} ${String(n).padStart(5)}  ${pct(n, ref.length).padStart(6)}  cum ${pct(seen, ref.length)}`);
}

// ---------------------------------------------------------------- section 2
console.log();
console.log('== 2. 1x AGAINST 4x, per decision, on the SAME board ==');
for (const scale of [...new Set(rows.map((r) => r.scale))].filter((s) => s !== 1).sort()) {
  const alt = rows.filter((r) => r.scale === scale);
  const paired = alt
    .map((r) => ({ alt: r, ref: byKey.get(`${r.scenario}|${r.seed}|${r.turn}|${r.team}`) }))
    .filter((p) => p.ref !== undefined);
  const diff = paired.filter((p) => p.alt.changed);
  // "Late-generated" = the reference arm NEVER priced the plan the deep arm
  // ended on. Ordering is the only lever that could have reached it.
  const never = diff.filter((p) => p.alt.refRankOfWinner === 0);
  const reached = diff.filter((p) => p.alt.refRankOfWinner > 0);
  console.log(`scale ${scale}: ${paired.length} paired decisions`);
  console.log(`  staged set differs:            ${diff.length}  (${pct(diff.length, paired.length)})`);
  console.log(`  ... 1x NEVER priced the ${scale}x answer:  ${never.length}  (${pct(never.length, diff.length)} of differences)`);
  console.log(`  ... 1x DID price it and refused:      ${reached.length}  (${pct(reached.length, diff.length)} of differences)`);
  if (reached.length > 0) {
    const rk = reached.map((p) => p.alt.refRankOfWinner);
    console.log(`      rank it was priced at, at 1x: p50 ${q(rk, 0.5)}  p90 ${q(rk, 0.9)}  max ${Math.max(...rk)}`);
    const tr = reached.map((p) => p.ref.trials);
    console.log(`      trials the 1x arm made:       p50 ${q(tr, 0.5)}  p90 ${q(tr, 0.9)}`);
  }
  const rungs = new Map();
  for (const p of paired) {
    const k = p.alt.winnerRung || '?';
    rungs.set(k, (rungs.get(k) ?? 0) + 1);
  }
  console.log(`  the ${scale}x answer's rung: ` + [...rungs].sort().map(([k, v]) => `${k} ${v} (${pct(v, paired.length)})`).join('  '));
  const nrungs = new Map();
  for (const p of never) {
    const k = p.alt.winnerRung || '?';
    nrungs.set(k, (nrungs.get(k) ?? 0) + 1);
  }
  console.log(`  ... on the NEVER-PRICED ones: ` + [...nrungs].sort().map(([k, v]) => `${k} ${v} (${pct(v, never.length)})`).join('  '));
  console.log('  differences by class:');
  const cls = new Map();
  for (const p of paired) {
    const k = classOf(p.ref);
    if (!cls.has(k)) cls.set(k, { n: 0, d: 0, never: 0 });
    const e = cls.get(k);
    e.n++;
    if (p.alt.changed) e.d++;
    if (p.alt.changed && p.alt.refRankOfWinner === 0) e.never++;
  }
  for (const k of [...cls.keys()].sort()) {
    const e = cls.get(k);
    console.log(`    ${k.padEnd(22)} n=${String(e.n).padStart(5)}  differ ${pct(e.d, e.n).padStart(6)}  of those never-priced ${pct(e.never, e.d)}`);
  }
}
