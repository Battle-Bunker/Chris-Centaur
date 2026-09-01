#!/usr/bin/env node
'use strict';
/*
 * DOES THE ARM-SERVICE GAP DECAY? — plans/decision by position in the sweep.
 *
 * armservice.js found the two identical arms of cycle c1 buying different
 * amounts of search: 19% apart on the first cell, 4-7% on the third, 1-4% on
 * the second. If the gap is a WARMUP artifact it should shrink as the run
 * proceeds and a warmup game would remove it. If it is steady it is a
 * scheduling asymmetry and the fix is different (pinning, or interleaving the
 * arms rather than running them as two long-lived processes).
 *
 * Games are ordered by finishedAt within an arm, which is the order the box
 * actually played them.
 *
 * usage: node armdrift.js <batch-dir> [bucketSize]
 */
const fs = require('fs');
const path = require('path');

const batch = process.argv[2];
const bucket = Number(process.argv[3] || 12);
const armsDir = path.join(batch, 'arms');
const perArm = new Map();

for (const arm of fs.readdirSync(armsDir)) {
  const rows = [];
  for (const sw of fs.readdirSync(path.join(armsDir, arm))) {
    const mf = path.join(armsDir, arm, sw, 'manifest.jsonl');
    if (!fs.existsSync(mf)) continue;
    for (const line of fs.readFileSync(mf, 'utf8').trim().split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line);
      let plans = 0;
      let dec = 0;
      for (const h of r.health || []) {
        plans += h.plansEvaluated || 0;
        dec += h.decisions || 0;
      }
      if (!dec) continue;
      rows.push({ t: Date.parse(r.finishedAt), rate: plans / dec, cell: r.cell, wall: r.wallMs });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  perArm.set(arm, rows);
}

const arms = [...perArm.keys()].sort();
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`# plans/decision by position in the run — ${path.basename(batch)}`);
console.log(`# arms: ${arms.join(' vs ')} · bucket = ${bucket} games`);
console.log('');
console.log(`| games | cell (first in bucket) | ${arms[0]} | ${arms[1] || '—'} | gap |`);
console.log('|---|---|---:|---:|---:|');

const n = Math.min(...arms.map((a) => perArm.get(a).length));
for (let i = 0; i < n; i += bucket) {
  const slices = arms.map((a) => perArm.get(a).slice(i, i + bucket));
  const rates = slices.map((s) => mean(s.map((r) => r.rate)));
  const gap = rates.length === 2 ? ((100 * (rates[0] - rates[1])) / rates[1]).toFixed(1) + '%' : '—';
  console.log(
    `| ${i + 1}-${Math.min(i + bucket, n)} | ${slices[0][0].cell} | ${rates[0].toFixed(1)} | ${
      rates[1] !== undefined ? rates[1].toFixed(1) : '—'
    } | **${gap}** |`
  );
}
