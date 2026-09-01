#!/usr/bin/env node
'use strict';
/*
 * DID THE DEPTH LAYER RUN AT ALL?
 *
 * `clusterOf` is called from `improve` and nowhere else, and `improve` is the
 * refinement rung, so a decision that never reached it has no enumeration, no
 * scout threads and no acute focus — all three hang off that one call.
 *
 * ── THE BUG THIS FILE SHIPPED WITH, AND WHAT IT COST ──────────────────────
 *
 * The first version read `mechanism.cluster`, `mechanism.scout.plies` and
 * `mechanism.scout.focus.fired`. Those are the RAW `MechanismReport` paths and
 * THE REPLAY STREAM DOES NOT CARRY THE RAW REPORT: `harness/lib/bots.ts`'s
 * `foldMechanism` flattens it into the scalars a manifest row can hold —
 * `clusterJoints`, `clusterEnumMs`, `scoutPlies`, `scoutThreads`,
 * `focusDecisions`, `focusFired`. Every lookup was `undefined`, every `??`
 * defaulted, and every cell printed 0.0% / 0.00 / false.
 *
 * It was believed. On its first outing it reported the enumeration running on
 * 0.0% of 7,680 acceptance decisions, for the treatment arm AND the control,
 * at 400 ms, 1,200 ms and 4,000 ms — which is exactly the shape a real
 * finding would have — and a third of a batch's conclusions were retracted on
 * it. Re-mined with the field names below, the same decisions read 100.0%
 * enumeration, ~31 joints and 8-15 plies per decision, with the acute focus
 * firing on 15.8-27.9% of the treatment arm's turns.
 *
 * THE LESSON, KEPT HERE BECAUSE THE NEXT MINER WILL HAVE IT TOO: a `??`
 * defaulting a missing field turns a typo into a measurement. So this file
 * REFUSES rather than defaults — a replay whose rows carry none of the fields
 * below is reported as unreadable, not as a zero.
 *
 * usage: node depth-ran.js <batch-dir> [cell-substring]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [batch, cellFilter] = process.argv.slice(2);
if (!batch) {
  console.error('usage: depth-ran.js <batch-dir> [cell-substring]');
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
          unreadable: 0,
          clusterRan: 0,
          joints: 0,
          plies: 0,
          threads: 0,
          deepest: 0,
          deepestRows: 0,
          improveCalls: 0,
          loopRows: 0,
          focusN: 0,
          fired: 0,
          focusPlies: 0,
          outsidePlies: 0,
          wall: 0,
        });
      const a = byBot.get(bot);
      a.n++;
      a.wall += tt.wallMs ?? 0;

      // THE REFUSAL. A folded row always carries `clusterJoints` — null when
      // the layer was never reached, a number when it was — so a row with the
      // key absent entirely is a row this miner does not understand, and
      // counting it as "the layer did not run" is the exact mistake above.
      if (!('clusterJoints' in m)) {
        a.unreadable++;
        continue;
      }

      // FOLDED FIELD NAMES, not the raw report's. `clusterJoints === null`
      // means `mechanism.cluster` was null, which means the enumeration was
      // never reached.
      if (m.clusterJoints !== null && m.clusterJoints !== undefined) a.clusterRan++;
      a.joints += m.clusterJoints ?? 0;
      a.plies += m.scoutPlies ?? 0;
      a.threads += m.scoutThreads ?? 0;
      // A column an older bundle never had must print as absent, not as a
      // measured 0 — the same discipline the `unreadable` count enforces one
      // level up.
      if (m.scoutDeepestPlies !== null && m.scoutDeepestPlies !== undefined) {
        a.deepestRows++;
        a.deepest = Math.max(a.deepest, m.scoutDeepestPlies);
      }

      // THE UPSTREAM CAUSE, when the bundle is new enough to carry it. Added
      // to `MechanismReport.loop` after this miner's first outing precisely so
      // that "the enumeration did not run" and "the loop never ran a full
      // slice" stop being the same reading. Older bundles have no such column
      // and `loopRows` says how many rows could answer.
      if (m.improveCalls !== null && m.improveCalls !== undefined) {
        a.loopRows++;
        a.improveCalls += m.improveCalls;
      }

      // The acute focus is null on a bot that has no focus layer, so the
      // DENOMINATOR is `focusDecisions` and not the decision count — a rate
      // over decisions the layer was not present for is not a rate.
      if (m.focusDecisions !== null && m.focusDecisions !== undefined) {
        a.focusN += m.focusDecisions;
        a.fired += m.focusFired ?? 0;
        a.focusPlies += m.focusPlies ?? 0;
        a.outsidePlies += m.outsidePlies ?? 0;
      }
    }
  }
}

const pct = (n, d) => (d === 0 ? '—' : ((100 * n) / d).toFixed(1) + '%');
const per = (n, d) => (d === 0 ? '—' : (n / d).toFixed(2));
console.log(`# did the depth layer run? ${files.length} replays`);
console.log('');
console.log(
  '| cell | budget | bot | decisions | unreadable | enumeration ran | joints/dec | improve/dec | scout plies/dec | threads/dec | deepest | focus decisions | focus FIRED |'
);
console.log('|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const [cell, c] of [...acc.entries()].sort()) {
  for (const [bot, a] of [...c.bots.entries()].sort()) {
    const read = a.n - a.unreadable;
    console.log(
      `| ${cell} | ${c.budget}ms | ${bot} | ${a.n} | ${a.unreadable} | **${pct(
        a.clusterRan,
        read
      )}** | ${per(a.joints, read)} | ${per(a.improveCalls, a.loopRows)} | ${per(
        a.plies,
        read
      )} | ${per(a.threads, read)} | ${a.deepestRows === 0 ? '—' : a.deepest} | ${a.focusN} | **${pct(
        a.fired,
        a.focusN
      )}** |`
    );
  }
}

// AN UNREADABLE ROW IS NOT A ZERO, and the exit code says so — a miner whose
// fields have drifted off the fold must not be quoted as a finding.
const anyUnreadable = [...acc.values()].some((c) =>
  [...c.bots.values()].some((a) => a.unreadable > 0)
);
if (anyUnreadable) {
  console.error(
    '\nREFUSED: some decision rows carry no `clusterJoints` key at all. Those rows are ' +
      'counted under `unreadable` and excluded from every rate above — they are NOT zeros. ' +
      'Check the fold in harness/lib/bots.ts against the bundle these replays were written by.'
  );
  process.exitCode = 3;
}
