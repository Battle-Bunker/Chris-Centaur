#!/usr/bin/env node
'use strict';
/*
 * DID THE DEPTH LAYER RUN AT ALL?
 *
 * `mechanism.cluster === null` means the cluster enumeration was never reached
 * — `clusterOf` is called from `improve` and nowhere else, and `improve` is the
 * refinement rung. `mechanism.scout.plies` is what the scout actually spent.
 * A decision with `cluster: null` has, by construction, no enumeration, no
 * scout threads and no acute focus, because all three hang off that one call.
 *
 * usage: node depthran.js <batch-dir> [cell-substring]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [batch, cellFilter] = process.argv.slice(2);
if (!batch) {
  console.error('usage: depthran.js <batch-dir> [cell-substring]');
  process.exit(2);
}

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

/** cell -> bot -> counters */
const acc = new Map();
for (const f of files) {
  let text;
  try {
    text = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
  } catch {
    continue;
  }
  const lines = text
    .trim()
    .split('\n')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const hdr = lines.find((o) => o.kind === 'header');
  if (!hdr) continue;
  const cell = hdr.config?.name ?? 'unknown';
  const budget = hdr.config?.budgetMs ?? 0;
  const botOf = new Map((hdr.seats ?? []).map((x) => [x.teamID, x.bot]));
  if (!acc.has(cell)) acc.set(cell, { budget, bots: new Map() });
  const byBot = acc.get(cell).bots;
  for (const t of lines.filter((o) => o.kind === 'turn')) {
    for (const team of Object.keys(t.telemetry ?? {})) {
      const tt = t.telemetry[team];
      const m = tt?.mechanism;
      if (m == null) continue;
      const bot = botOf.get(team);
      if (!byBot.has(bot))
        byBot.set(bot, {
          n: 0,
          clusterRan: 0,
          plies: 0,
          threads: 0,
          deepest: 0,
          fired: 0,
          focusPlies: 0,
          outsidePlies: 0,
          wall: 0,
        });
      const a = byBot.get(bot);
      a.n++;
      a.wall += tt.wallMs ?? 0;
      if (m.cluster != null) a.clusterRan++;
      const sc = m.scout ?? {};
      a.plies += sc.plies ?? 0;
      a.threads += sc.threads ?? 0;
      a.deepest = Math.max(a.deepest, sc.deepestPlies ?? 0);
      if (sc.focus?.fired === true) a.fired++;
      a.focusPlies += sc.focus?.focusPlies ?? 0;
      a.outsidePlies += sc.focus?.outsidePlies ?? 0;
    }
  }
}

const pct = (n, d) => (d === 0 ? '—' : ((100 * n) / d).toFixed(1) + '%');
console.log(`# did the depth layer run? ${files.length} replays`);
console.log('');
console.log(
  '| cell | budget | bot | decisions | enumeration ran | scout plies/dec | threads/dec | deepest | focus FIRED |'
);
console.log('|---|---:|---|---:|---:|---:|---:|---:|---:|');
for (const [cell, c] of [...acc.entries()].sort()) {
  for (const [bot, a] of [...c.bots.entries()].sort()) {
    console.log(
      `| ${cell} | ${c.budget}ms | ${bot} | ${a.n} | **${pct(a.clusterRan, a.n)}** | ${(
        a.plies / a.n
      ).toFixed(2)} | ${(a.threads / a.n).toFixed(2)} | ${a.deepest} | **${pct(a.fired, a.n)}** |`
    );
  }
}
