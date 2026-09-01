#!/usr/bin/env node
'use strict';
/*
 * DOES THE FLOOR ACTUALLY FALL AS 1/sqrt(BLOCKS)?
 *
 * The whole continuous programme rests on one assumption: that adding blocks
 * buys power, with the A/A floor shrinking as 1/sqrt(n). Every target in the
 * queue ("32 blocks", "73 blocks") is computed from it. It has never been
 * checked, and there is reason to doubt it — cycle c1 measured floors of
 * 0.38-0.40 at 8 blocks and cycle k1, at three times the blocks, came back
 * with 0.27 and 0.51.
 *
 * This takes ONE batch and computes its A/A floor on nested prefixes of its
 * own blocks: the first 6, the first 12, the first 18, all 24. Same games,
 * same cell, same everything — only the block count changes. If the floor
 * falls as 1/sqrt(n) the ratio column sits near 1. If it does not, the outcome
 * distribution is heavy-tailed, block-count targets are fiction, and the
 * programme needs a different estimator rather than more machine time.
 *
 * usage: node floorscale.js <subject> <control> <batch-dir> [<batch-dir> ...]
 */
const fs = require('fs');
const path = require('path');

const [subject, control, ...batches] = process.argv.slice(2);
if (!subject || !control || !batches.length) {
  console.error('usage: floorscale.js <subject> <control> <batch-dir> [...]');
  process.exit(2);
}

/** cell -> blockKey -> arm -> [G] */
const data = new Map();
for (const batch of batches) {
  const armsDir = path.join(batch, 'arms');
  if (!fs.existsSync(armsDir)) continue;
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
        const key = `${batch}#${r.block}`;
        if (!data.has(r.cell)) data.set(r.cell, new Map());
        const bb = data.get(r.cell);
        if (!bb.has(key)) bb.set(key, new Map());
        if (!bb.get(key).has(arm)) bb.get(key).set(arm, []);
        bb.get(key).get(arm).push(s.sharePar - c.sharePar);
      }
    }
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function boot(vals, iters = 40000) {
  const n = vals.length;
  if (n < 2) return { mean: NaN, half: NaN, n };
  let seed = 2468013579 % 0x7fffffff;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += vals[Math.floor(rnd() * n)];
    out[i] = s / n;
  }
  out.sort();
  return { mean: mean(vals), half: (out[Math.floor(0.975 * iters)] - out[Math.floor(0.025 * iters)]) / 2, n };
}

console.log(`# A/A floor on G = sharePar(${subject}) − sharePar(${control}) vs block count`);
console.log('#');
console.log('# "expected" scales the FULL-sample floor back up by sqrt(nFull/n).');
console.log('# ratio = measured / expected. Near 1.00 means the floor falls as 1/sqrt(n)');
console.log('# and block targets are meaningful. Well under 1 at small n means the floor');
console.log('# is NOT shrinking the way the power calculation assumes.');
console.log('');
console.log('| cell | blocks | A/A floor | expected from full sample | ratio |');
console.log('|---|---:|---:|---:|---:|');

for (const [cell, bb] of [...data].sort()) {
  const keys = [...bb.keys()].sort();
  const diffs = [];
  for (const k of keys) {
    const perArm = [...bb.get(k).entries()].sort();
    if (perArm.length !== 2) continue;
    diffs.push(mean(perArm[0][1]) - mean(perArm[1][1]));
  }
  const full = boot(diffs);
  const steps = [];
  for (let n = 6; n < diffs.length; n += 6) steps.push(n);
  steps.push(diffs.length);
  for (const n of steps) {
    const r = boot(diffs.slice(0, n));
    const expected = full.half * Math.sqrt(full.n / n);
    console.log(
      `| ${cell} | ${n} | ${r.half.toFixed(3)} | ${expected.toFixed(3)} | ${(r.half / expected).toFixed(2)} |`
    );
  }
}
