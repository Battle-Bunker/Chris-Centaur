#!/usr/bin/env node
'use strict';
/*
 * THE ACCUMULATING WITHIN-GAME READING.
 *
 * Successor to $SP/ppruns/within.js, with two changes the continuous
 * programme needs.
 *
 * 1. IT POOLS ACROSS BATCHES. Pass any number of batch directories; blocks
 *    from different cycles on disjoint seed ranges add up, which is the whole
 *    point of running for days. Seeds are checked for collisions and a repeat
 *    is REFUSED loudly rather than double-counted.
 *
 * 2. IT POOLS THE TWO ARMS CORRECTLY. `within.js` concatenates the two arms'
 *    block means and bootstraps 2n values as if they were independent. They
 *    are not: the two arms play the SAME seed on the SAME board, so the pair
 *    is positively correlated and the resulting interval is too narrow — the
 *    error runs in the direction that makes a marginal result look decided.
 *    Here the two arms are AVERAGED WITHIN A BLOCK first, giving one value per
 *    block, and the bootstrap runs over blocks. Same point estimate, honest
 *    width.
 *
 * The A/A floor is unchanged in definition: the between-arm difference of G,
 * block by block, whose half-width is the smallest |G| that cell can claim.
 *
 * usage: node accum.js <subject> <control> <batch-dir> [<batch-dir> ...]
 */
const fs = require('fs');
const path = require('path');

const [subject, control, ...batches] = process.argv.slice(2);
if (!subject || !control || !batches.length) {
  console.error('usage: accum.js <subject> <control> <batch-dir> [<batch-dir> ...]');
  process.exit(2);
}

/** cell -> block key -> arm -> [G per game] */
const data = new Map();
const seenSeeds = new Map(); // cell -> seed -> batch that first used it
const collisions = [];
let games = 0;
const armNames = new Set();

for (const batch of batches) {
  const armsDir = path.join(batch, 'arms');
  if (!fs.existsSync(armsDir)) {
    console.error(`# SKIP ${batch} — no arms/ directory`);
    continue;
  }
  for (const arm of fs.readdirSync(armsDir)) {
    for (const sw of fs.readdirSync(path.join(armsDir, arm))) {
      const mf = path.join(armsDir, arm, sw, 'manifest.jsonl');
      if (!fs.existsSync(mf)) continue;
      for (const line of fs.readFileSync(mf, 'utf8').trim().split('\n')) {
        if (!line) continue;
        const r = JSON.parse(line);
        const s = r.results.find((x) => x.bot === subject);
        const c = r.results.find((x) => x.bot === control);
        if (!s || !c) continue;
        armNames.add(arm);
        games++;
        // A block is one seed through every seat rotation. Namespace it by
        // batch so two cycles never merge two different games into one block,
        // and record the seed so a REPEATED seed is caught rather than pooled.
        const seed = r.seed !== undefined ? r.seed : r.block;
        if (!seenSeeds.has(r.cell)) seenSeeds.set(r.cell, new Map());
        const ss = seenSeeds.get(r.cell);
        if (ss.has(seed) && ss.get(seed) !== batch) {
          collisions.push(`${r.cell} seed ${seed}: ${ss.get(seed)} and ${batch}`);
        } else if (!ss.has(seed)) ss.set(seed, batch);
        const key = `${batch}#${r.block}`;
        if (!data.has(r.cell)) data.set(r.cell, new Map());
        const byBlock = data.get(r.cell);
        if (!byBlock.has(key)) byBlock.set(key, new Map());
        const byArm = byBlock.get(key);
        if (!byArm.has(arm)) byArm.set(arm, []);
        byArm.get(arm).push(s.sharePar - c.sharePar);
      }
    }
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** Bootstrap over BLOCKS — the resampling unit. Rotations inside a block are
 * the same board and are not independent, so they are averaged, never resampled. */
function boot(vals, iters = 40000) {
  const n = vals.length;
  if (n < 2) return { mean: n ? mean(vals) : NaN, lo: NaN, hi: NaN, half: NaN, n };
  let seed = 987654321;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += vals[Math.floor(rnd() * n)];
    out[i] = s / n;
  }
  out.sort();
  const lo = out[Math.floor(0.025 * iters)];
  const hi = out[Math.floor(0.975 * iters)];
  return { mean: mean(vals), lo, hi, half: (hi - lo) / 2, n };
}

const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const arms = [...armNames].sort();

console.log(`# G = sharePar(${subject}) − sharePar(${control}), within game, blocked over seeds`);
console.log(`#`);
console.log(`# batches pooled: ${batches.length} — ${batches.map((b) => path.basename(b)).join(', ')}`);
console.log(`# arms: ${arms.join(', ')} · games read: ${games}`);
if (collisions.length) {
  console.log(`#`);
  console.log(`# !! SEED COLLISION — these batches are NOT independent and must not be pooled:`);
  for (const c of collisions.slice(0, 10)) console.log(`#    ${c}`);
  console.log(`#    (${collisions.length} total)`);
}
console.log('');
console.log('| cell | blocks | G (arms averaged in block) | 95% CI | half-width | A/A floor | clears floor? |');
console.log('|---|---:|---:|:--|---:|---:|---|');

const rows = [];
for (const cell of [...data.keys()].sort()) {
  const byBlock = data.get(cell);
  const pooled = []; // one value per block: the two arms averaged
  const diffs = []; // between-arm difference of G, per block: the A/A floor
  for (const byArm of byBlock.values()) {
    const perArm = arms.map((a) => (byArm.has(a) ? mean(byArm.get(a)) : null)).filter((x) => x !== null);
    if (!perArm.length) continue;
    pooled.push(mean(perArm));
    if (perArm.length === 2) diffs.push(perArm[0] - perArm[1]);
  }
  const g = boot(pooled);
  const fl = boot(diffs);
  // A reading clears its floor when the whole interval sits outside ±floor.
  const clears = Number.isFinite(fl.half) && (g.lo > fl.half || g.hi < -fl.half)
    ? 'YES'
    : Number.isFinite(fl.half) && (Math.abs(g.mean) > fl.half ? 'marginal' : 'no');
  rows.push({ cell, g, fl, clears });
  console.log(
    `| ${cell} | ${g.n} | **${f(g.mean)}** | [${f(g.lo)}, ${f(g.hi)}] | ${f(g.half)} | ${f(fl.half)} | ${clears} |`
  );
}

console.log('');
console.log('## The A/A floor on G — between-arm difference, block by block');
console.log('');
console.log('| cell | blocks | mean ΔG | 95% CI | FLOOR (half-width) | floor sound? |');
console.log('|---|---:|---:|:--|---:|---|');
for (const { cell, fl } of rows) {
  // Two IDENTICAL arms must average to zero. An interval that excludes zero
  // means the pair is not a null and no reading on this cell can be claimed.
  const sound = !Number.isFinite(fl.lo) ? '—' : fl.lo > 0 || fl.hi < 0 ? '**NO — excludes zero**' : 'yes';
  console.log(`| ${cell} | ${fl.n} | ${f(fl.mean)} | [${f(fl.lo)}, ${f(fl.hi)}] | **${f(fl.half)}** | ${sound} |`);
}
