#!/usr/bin/env node
'use strict';
/*
 * IS THE PAIR ACTUALLY A NULL? — arm-order service audit.
 *
 * WHY THIS EXISTS. In cycle c1 the between-arm difference of G came back
 * negative on two cells of three, and on the knight cell its interval
 * EXCLUDED ZERO between two byte-identical bundles. The programme has been
 * calling that "the piece-cell floor is broken", i.e. treating it as a
 * property of the board. There is a rival explanation that no one has tested:
 * the two arms are launched as two processes on the same box, and if the
 * FIRST-LAUNCHED arm gets systematically less CPU, then inside every game the
 * more compute-hungry contender loses more than the cheap one — which shows up
 * exactly as a non-zero ΔG, on the cells where the contenders differ most in
 * appetite.
 *
 * That would not be a noisy floor. It would be a BIAS, in a known direction,
 * against whichever contender costs more to run — and it would contaminate
 * every arm-paired reading in the programme, not just the piece cells.
 *
 * THE DIAGNOSTIC. Two identical arms must deliver identical search. So for the
 * SAME bot in the SAME cell, compare across arms:
 *   plans per decision  — how much search the budget actually bought
 *   wallMs per game     — how long the box took to play it
 * A difference in plans/dec between two identical builds is CPU service, not
 * bot behaviour. Nothing else can move it.
 *
 * usage: node armservice.js <batch-dir> [<batch-dir> ...]
 */
const fs = require('fs');
const path = require('path');

const batches = process.argv.slice(2);
if (!batches.length) {
  console.error('usage: armservice.js <batch-dir> [...]');
  process.exit(2);
}

/** cell -> bot -> arm -> {plans, dec, n, wall} */
const agg = new Map();
/** cell -> block -> arm -> wallMs */
const wallByBlock = new Map();

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
        if (!agg.has(r.cell)) agg.set(r.cell, new Map());
        const byBot = agg.get(r.cell);
        for (const h of r.health || []) {
          if (!byBot.has(h.bot)) byBot.set(h.bot, new Map());
          const byArm = byBot.get(h.bot);
          if (!byArm.has(arm)) byArm.set(arm, { plans: 0, dec: 0, n: 0 });
          const a = byArm.get(arm);
          a.plans += h.plansEvaluated || 0;
          a.dec += h.decisions || 0;
          a.n++;
        }
        const k = `${batch}#${r.block}`;
        if (!wallByBlock.has(r.cell)) wallByBlock.set(r.cell, new Map());
        const bb = wallByBlock.get(r.cell);
        if (!bb.has(k)) bb.set(k, new Map());
        if (!bb.get(k).has(arm)) bb.get(k).set(arm, []);
        bb.get(k).get(arm).push(r.wallMs || 0);
      }
    }
  }
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.log('# Arm-order service audit — two IDENTICAL arms must buy identical search');
console.log('');
console.log('| cell | bot | arm | games | plans/decision | vs other arm |');
console.log('|---|---|---|---:|---:|---:|');
const deltas = [];
for (const [cell, byBot] of [...agg].sort()) {
  for (const [bot, byArm] of [...byBot].sort()) {
    const arms = [...byArm].sort();
    const rates = arms.map(([, a]) => a.plans / (a.dec || 1));
    for (let i = 0; i < arms.length; i++) {
      const [arm, a] = arms[i];
      const other = rates.length === 2 ? rates[1 - i] : null;
      const rel = other ? ((100 * (rates[i] - other)) / other).toFixed(1) + '%' : '—';
      console.log(`| ${cell} | ${bot} | ${arm} | ${a.n} | ${rates[i].toFixed(1)} | ${rel} |`);
    }
    // A bot with no search at all (reflex) has no rate to compare.
    if (rates.length === 2 && rates[0] > 0 && rates[1] > 0) {
      deltas.push({ cell, bot, pct: (100 * (rates[0] - rates[1])) / rates[1] });
    }
  }
}

console.log('');
console.log('## Verdict on the arms');
console.log('');
if (!deltas.length) {
  console.log('Only one arm present — nothing to compare.');
} else {
  const m = mean(deltas.map((d) => d.pct));
  const neg = deltas.filter((d) => d.pct < 0).length;
  console.log(`Mean plans/decision difference, first arm vs second, over ${deltas.length} cell x bot pairs: **${m.toFixed(2)}%**`);
  console.log(`First arm bought LESS search in ${neg} of ${deltas.length} of them.`);
  console.log('');
  console.log('A pair of identical builds should sit within a percent or so of zero and');
  console.log('split the sign evenly. A consistent one-sided gap is CPU service, and it');
  console.log('biases every arm-paired reading against the hungrier contender.');
}

console.log('');
console.log('## Wall clock per game, by arm');
console.log('');
console.log('| cell | arm | games | mean wallMs |');
console.log('|---|---|---:|---:|');
for (const [cell, bb] of [...wallByBlock].sort()) {
  const byArm = new Map();
  for (const perArm of bb.values()) {
    for (const [arm, ws] of perArm) {
      if (!byArm.has(arm)) byArm.set(arm, []);
      byArm.get(arm).push(...ws);
    }
  }
  for (const [arm, ws] of [...byArm].sort()) {
    console.log(`| ${cell} | ${arm} | ${ws.length} | ${mean(ws).toFixed(0)} |`);
  }
}
