#!/usr/bin/env node
'use strict';
/*
 * THE WITHIN-GAME READING, AND ITS OWN FLOOR.
 *
 * Both contenders sit in the same game, so the treatment reading is
 *
 *     G = sharePar(subject) − sharePar(control)
 *
 * computed per game and blocked over seeds. `rotateSeats` puts each bot in
 * every seat once per block, so G is not a statement about board position.
 *
 * THE FLOOR TO QUOTE IS NOT EITHER SEAT'S. The two arms are IDENTICAL builds
 * with identical configs and identical seeds, so the pair is an A/A null — and
 * what it floors is the run-to-run noise on G itself, which is the BETWEEN-ARM
 * DIFFERENCE of G, block by block. Quoting a seat's own sharePar spread instead
 * would be quoting the wrong instrument (HANDOFF.md §3).
 *
 * `sharePar` is share of end weight × teams, par 1, so the seats SUM to the
 * team count: G is a contrast, mechanically anti-correlated between the two
 * seats, and never two independent effects.
 *
 * usage: node within.js <batch-dir> <subject-bot> <control-bot>
 */
const fs = require('fs');
const path = require('path');

const [batch, subject, control] = process.argv.slice(2);
if (!batch || !subject || !control) {
  console.error('usage: within.js <batch-dir> <subject> <control>');
  process.exit(2);
}

const armsDir = path.join(batch, 'arms');
const arms = fs.readdirSync(armsDir);
/** arm -> cell -> block(seed) -> [G per game] */
const data = new Map();
for (const arm of arms) {
  const per = new Map();
  const sweeps = fs.readdirSync(path.join(armsDir, arm));
  for (const sw of sweeps) {
    const mf = path.join(armsDir, arm, sw, 'manifest.jsonl');
    if (!fs.existsSync(mf)) continue;
    for (const line of fs.readFileSync(mf, 'utf8').trim().split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line);
      const s = r.results.find((x) => x.bot === subject);
      const c = r.results.find((x) => x.bot === control);
      if (!s || !c) continue;
      const g = s.sharePar - c.sharePar;
      if (!per.has(r.cell)) per.set(r.cell, new Map());
      const byBlock = per.get(r.cell);
      if (!byBlock.has(r.block)) byBlock.set(r.block, []);
      byBlock.get(r.block).push(g);
    }
  }
  data.set(arm, per);
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Bootstrap over BLOCKS, which is the resampling unit: a block is one seed
 * played through every seat rotation, and the rotations within it are the same
 * board and are not independent. */
function boot(blockMeans, iters = 20000) {
  const n = blockMeans.length;
  if (n < 2) return { mean: mean(blockMeans), lo: NaN, hi: NaN, half: NaN, n };
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = [];
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += blockMeans[Math.floor(rnd() * n)];
    out.push(s / n);
  }
  out.sort((a, b) => a - b);
  const lo = out[Math.floor(0.025 * iters)];
  const hi = out[Math.floor(0.975 * iters)];
  return { mean: mean(blockMeans), lo, hi, half: (hi - lo) / 2, n };
}

const cells = new Set();
for (const per of data.values()) for (const c of per.keys()) cells.add(c);

const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
console.log(`# within-game G = sharePar(${subject}) − sharePar(${control}); blocked over seeds`);
console.log('');
console.log('| cell | arm | blocks | G | 95% CI | half-width |');
console.log('|---|---|---:|---:|:--|---:|');
const perArmBlockG = new Map(); // cell -> arm -> Map(block -> mean G)
for (const cell of [...cells].sort()) {
  perArmBlockG.set(cell, new Map());
  for (const arm of arms) {
    const byBlock = data.get(arm).get(cell);
    if (!byBlock) continue;
    const bm = new Map();
    for (const [b, gs] of byBlock) bm.set(b, mean(gs));
    perArmBlockG.get(cell).set(arm, bm);
    const r = boot([...bm.values()]);
    console.log(`| ${cell} | ${arm} | ${r.n} | ${f(r.mean)} | [${f(r.lo)}, ${f(r.hi)}] | ${f(r.half)} |`);
  }
  // Pooled over the two identical arms — the reading to quote.
  const all = [];
  for (const bm of perArmBlockG.get(cell).values()) all.push(...bm.values());
  const r = boot(all);
  console.log(`| ${cell} | **POOLED** | ${r.n} | **${f(r.mean)}** | [${f(r.lo)}, ${f(r.hi)}] | ${f(r.half)} |`);
}

console.log('');
console.log('## The A/A floor on G — between-arm difference, block by block');
console.log('');
console.log('| cell | blocks | mean ΔG | 95% CI | HALF-WIDTH = THE FLOOR |');
console.log('|---|---:|---:|:--|---:|');
for (const cell of [...cells].sort()) {
  const byArm = [...perArmBlockG.get(cell).entries()];
  if (byArm.length < 2) continue;
  const [a1, m1] = byArm[0];
  const [a2, m2] = byArm[1];
  const d = [];
  for (const [b, v] of m1) if (m2.has(b)) d.push(v - m2.get(b));
  const r = boot(d);
  console.log(`| ${cell} (${a1}−${a2}) | ${r.n} | ${f(r.mean)} | [${f(r.lo)}, ${f(r.hi)}] | **${f(r.half)}** |`);
}
