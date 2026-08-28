#!/usr/bin/env node
'use strict';
/*
 * INGEST ONE BATCH — validate its null, extract its metrics, update the ledger,
 * and emit the drift tables.
 *
 *   node tools/learnloop/bin/ingest.js --batch <results/<batch>> \
 *        --null nullA,nullB --pair base=treat --flag CENTAUR_WASM [--write]
 *
 *   node tools/learnloop/bin/ingest.js --sweep-arm base=<dir> \
 *        --sweep-arm treat=<dir> --pair base=treat --flag X --kind historical
 *
 * ── THE ORDER IS THE METHOD ────────────────────────────────────────────────
 *
 * 1. THE NULL FIRST, ALWAYS. Before any treatment number is computed, the
 *    batch's A/A pairing is checked — same bundle, same env, same games, same
 *    seats — and its noise floor measured. A treatment delta read against no
 *    null is unreadable at any size, and the program has repeatedly measured
 *    that this floor is NOT small (an A/A pairing on a provably inert path
 *    produced d P(first) +0.167 [0.056, 0.306]).
 *
 * 2. THEN THE INSTRUMENT. Null-band widths, paired flip rates, per-arm overrun
 *    and cap rates, integrity counters. A widening band or a rising flip rate
 *    is a FLAGGED INSTRUMENT EVENT and it makes every treatment verdict in the
 *    batch provisional — that signal arrives long before any outcome effect is
 *    measurable, which is the whole reason to look at it first.
 *
 * 3. THEN THE TREATMENT, with the power arithmetic attached. A placement
 *    verdict from a cell with fewer blocks than its own dispersion demands is
 *    recorded and refused: the loop does not learn placement from cells that
 *    cannot teach it.
 *
 * 4. AND ONLY THEN THE LEDGER, and only with `--write`. The default is a dry
 *    read that prints exactly what it would do.
 *
 * ── WHAT IT REFUSES ────────────────────────────────────────────────────────
 *
 *   - a pairing whose games are not the same games (configHash or seats differ)
 *   - a treatment verdict from a batch whose A/A null failed its own checks
 *   - a live status from a measurement whose treatment arm cannot be shown to
 *     have engaged (the P5 rule; see the ledger's armEngagementRule)
 *   - a placement status change from an underpowered cell
 */

const fs = require('fs');
const path = require('path');
const L = require('../lib/ledger');
const E = require('../lib/extract');
const D = require('../lib/drift');
const P = require('../lib/polarity');
const { blockCI, mean, round } = require('../lib/stats');

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
function args(name) {
  const out = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]);
  }
  return out;
}
const flag = (n) => process.argv.includes(`--${n}`);

const batchDir = arg('batch', '') ? path.resolve(arg('batch', '')) : null;
const batchId = arg('batch-id', batchDir ? path.basename(batchDir) : 'unnamed');
const WRITE = flag('write');

const sweepArms = {};
for (const s of args('sweep-arm')) {
  const j = s.indexOf('=');
  if (j <= 0) fail(`--sweep-arm "${s}" is not <name>=<dir>`);
  sweepArms[s.slice(0, j)] = s.slice(j + 1);
}

function fail(msg) {
  console.error(`ingest: ${msg}`);
  process.exit(2);
}

if (batchDir === null && Object.keys(sweepArms).length === 0) {
  fail('need --batch <dir> or at least one --sweep-arm <name>=<dir>');
}

const arms = E.loadArms(batchDir ?? '/nonexistent', sweepArms, arg('sweep-key', 'sweep'));
if (arms.size === 0) fail('no arms found');

const subjectMap = {};
for (const s of args('subject-map')) {
  for (const pair of s.split(',').filter(Boolean)) {
    const j = pair.indexOf('=');
    if (j <= 0) fail(`--subject-map entry "${pair}" is not <arm>=<bot>`);
    subjectMap[pair.slice(0, j)] = pair.slice(j + 1);
  }
}

const report = {
  batch: batchId,
  generatedAt: new Date().toISOString(),
  arms: [...arms.keys()],
  provenance: {},
  null: null,
  drift: null,
  pairs: [],
  ledgerUpdates: [],
};

for (const [name, a] of arms) {
  report.provenance[name] = {
    kind: a.provenance,
    bundleSha: a.meta && a.meta.bundleStamp ? a.meta.bundleStamp.sha : null,
    env: a.meta ? a.meta.envOverrides ?? null : null,
  };
}

// ---------------------------------------------------------------- 1. the null

const nullSpec = arg('null', '');
let nullOk = false;
let nullBand = {};
if (nullSpec) {
  const [na, nb] = nullSpec.split(',');
  const A = arms.get(na);
  const B = arms.get(nb);
  if (!A || !B) fail(`--null names arms that are not here: ${nullSpec}`);
  const checks = [];
  const shaA = A.meta && A.meta.bundleStamp ? A.meta.bundleStamp.sha : null;
  const shaB = B.meta && B.meta.bundleStamp ? B.meta.bundleStamp.sha : null;
  checks.push({
    ok: shaA !== null && shaA === shaB,
    what: `same bundle sha (${shaA ?? 'none'} / ${shaB ?? 'none'})`,
  });
  checks.push({
    ok: JSON.stringify((A.meta && A.meta.envOverrides) || {}) === JSON.stringify((B.meta && B.meta.envOverrides) || {}),
    what: 'same env overrides',
  });
  const paired = E.pairCells(A, B, { subjectMap });
  checks.push({ ok: paired.problems.length === 0, what: `${paired.paired} games paired, ${paired.problems.length} problems` });
  // EVERY metric, not only the outcome three. A mechanism delta needs its own
  // A/A floor as much as a placement delta does — more, in fact, since the
  // mechanism rows are what the loop actually refits on.
  nullBand = D.nullBand(paired, E.METRIC_KEYS);
  nullOk = checks.every((c) => c.ok);
  report.null = { arms: [na, nb], checks, band: nullBand, flips: D.flipRate(A, B, { subjectMap }) };
  nullOk = nullOk && paired.paired > 0;
} else {
  report.null = {
    arms: null,
    checks: [{ ok: false, what: 'NO A/A NULL NAMED — every effect size in this batch is unsupported' }],
    band: {},
    flips: {},
  };
}

// -------------------------------------------------------- 2. the instrument

const hygieneRows = D.hygiene(arms);
const previous = readPrevious(arg('previous', ''));
const events = D.instrumentEvents({
  band: report.null.band,
  flips: report.null.flips,
  hygieneRows,
  previous,
});
report.drift = { band: report.null.band, flips: report.null.flips, hygiene: hygieneRows, events };

function readPrevious(p) {
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(path.resolve(p), 'utf8')).drift ?? null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------- 3. the treatment

const ledger = L.load(arg('ledger', L.LEDGER_PATH));
const flagName = arg('flag', '');
const kind = arg('kind', batchDir ? 'live' : 'historical');
const engagementArg = arg('engagement', '');

for (const p of args('pair')) {
  const j = p.indexOf('=');
  if (j <= 0) fail(`--pair "${p}" is not <base>=<treat>`);
  const baseName = p.slice(0, j);
  const treatName = p.slice(j + 1);
  const base = arms.get(baseName);
  const treat = arms.get(treatName);
  if (!base || !treat) fail(`--pair names arms that are not here: ${p}`);

  const paired = E.pairCells(base, treat, { subjectMap });
  const cells = {};
  for (const [cellKey, byBlock] of paired.cells) {
    const row = {};
    for (const metric of E.METRIC_KEYS) {
      const blockMeans = [...byBlock.values()]
        .map((acc) => (acc[metric] ? mean(acc[metric]) : null))
        .filter((x) => x !== null);
      if (blockMeans.length === 0) continue;
      const ci = blockCI(blockMeans);
      const band = report.null.band[cellKey] ?? report.null.band[Object.keys(report.null.band)[0]] ?? null;
      const floor = band && band[metric] ? band[metric].halfWidth : null;
      row[metric] = {
        ...ci,
        nullHalfWidth: floor,
        // OUTSIDE THE FLOOR is the readable test, and it is stricter than
        // "excludes zero": a delta whose interval excludes zero but whose
        // magnitude sits inside the batch's own A/A half-width is inside the
        // machine's mood.
        outsideNull: floor === null ? null : ci.mean !== null && Math.abs(ci.mean) > floor,
        retired: E.RETIRED_KEYS.includes(metric),
      };
    }
    cells[cellKey] = row;
  }
  report.pairs.push({
    base: baseName,
    treat: treatName,
    paired: paired.paired,
    dropped: paired.dropped,
    problems: paired.problems.slice(0, 20),
    cells,
  });

  // ----------------------------------------------------------- 4. the ledger
  if (!flagName) continue;
  const f = L.flagOf(ledger, flagName);
  if (f === null) fail(`--flag ${flagName} is not in the ledger`);

  const engaged = engagementFor(treat, engagementArg);

  // WHICH CELLS ARE CONTROLS? A control cell is one the DESIGN requires to
  // read zero: a provably-inert path included to prove the instrument reports
  // zero when zero is the truth. Declared on the flag as `controlCells`, or on
  // the command line as `--control <cell>` (repeatable). Its rows are filed as
  // `kind: 'control'`, which strengthens the instrument and never touches the
  // effect channel — the `CONTROL-CELLS-DEMOTE` fix; see lib/ledger.js.
  const controls = new Set([...args('control'), ...(f.controlCells ?? [])]);
  const controlCell = (k) => [...controls].some((c) => k === c || k.endsWith(`::${c}`));

  for (const [cellKey, row] of Object.entries(cells)) {
    for (const [metric, r] of Object.entries(row)) {
      if (r.retired) continue;
      const gate = (f.promotionMetrics ?? []).find((g) => g.name === metric);
      if (gate === undefined) continue; // not one of this flag's gate metrics
      const family = gate.family;
      const power = L.powerRow({ blocksHad: r.n, blockSd: r.sd, mde: 0.25 });
      // A METRIC WITH NO FLOOR OF ITS OWN IS UNREADABLE, not null. If the A/A
      // cell never carried this counter — an older bundle, a cell where the
      // layer cannot act — there is nothing to read its delta against, and
      // calling that "no effect" would launder an absent instrument into a
      // finding. Recorded with nullVerified false, which the ledger treats as
      // "moves nothing".
      const readable = nullOk && r.nullHalfWidth !== null;
      // POLARITY, NOT SIGN. A delta outside the floor is scored by the
      // metric's own good direction — `score` up, `deathsExhaustion` down —
      // and a metric whose direction is not a verdict is recorded unscored
      // rather than guessed at. See lib/polarity.js for why this is the most
      // expensive one-line bug this loop has had.
      const polarity = P.polarityOf(metric, gate);
      const verdict = !readable
        ? 'unreadable'
        : P.scoreVerdict({ mean: r.mean, outsideNull: r.outsideNull, metric, gate });
      const m = {
        batch: batchId,
        kind: controlCell(cellKey) ? 'control' : kind,
        cell: cellKey,
        metric,
        family,
        verdict: controlCell(cellKey) ? (r.outsideNull === true ? 'control-violated' : 'inert') : verdict,
        polarity,
        value: `${r.mean} [${r.lo}, ${r.hi}] over ${r.n} blocks; null half-width ${r.nullHalfWidth}`,
        nullVerified: readable,
        nullBandHalfWidth: r.nullHalfWidth,
        armEngagementVerified: engaged,
        power,
      };
      const res = L.applyMeasurement(ledger, flagName, m);
      report.ledgerUpdates.push({ flag: flagName, measurement: m, ...res });
    }
  }
}

/**
 * DID THE TREATMENT ARM ENGAGE?
 *
 * `--engagement <metric>` names the mechanism counter that must be nonzero on
 * the treatment arm — `wasmRuns` for CENTAUR_WASM, `clusterJoints` for the
 * enumeration, `selectionDraws` for the lottery. Without it the answer is
 * `null`, which the ledger treats as "not shown" rather than as "shown false":
 * an old batch that predates the mechanism report is not lying, it simply
 * cannot say. `false` is reserved for a counter that was READ and was zero.
 */
function engagementFor(treat, metric) {
  if (!metric) return null;
  let total = 0;
  let seen = false;
  for (const rows of treat.sweeps.values()) {
    for (const r of rows) {
      for (const h of r.health ?? []) {
        const mech = h.mechanism;
        if (mech && typeof mech[metric] === 'number') {
          seen = true;
          total += mech[metric];
        }
      }
    }
  }
  if (!seen) return null;
  return total > 0;
}

// ------------------------------------------------------------------- output

const outFile = arg('out', '');
if (outFile) {
  fs.writeFileSync(path.resolve(outFile), JSON.stringify(report, null, 2) + '\n');
}

console.log(`BATCH ${batchId} — arms: ${report.arms.join(', ')}`);
console.log('');
console.log('1. THE NULL');
for (const c of report.null.checks) console.log(`   ${c.ok ? 'OK  ' : 'FAIL'} ${c.what}`);
const FLOOR_SUMMARY = ['score', 'win', 'turns'];
for (const [cellKey, row] of Object.entries(report.null.band)) {
  for (const [metric, r] of Object.entries(row)) {
    if (r.halfWidth === null || !FLOOR_SUMMARY.includes(metric)) continue;
    console.log(
      `   floor ${cellKey} ${metric}: +/-${r.halfWidth} (${r.blocks} blocks)` +
        (r.excludesZero ? '   <-- THE NULL ITSELF EXCLUDES ZERO' : '')
    );
  }
}
console.log('');
console.log('2. INSTRUMENT');
for (const r of report.drift.hygiene) {
  console.log(
    `   ${r.arm}/${r.cell}: cap ${r.capRate} overrun ${r.overrunRate} unstaged ${r.unstagedRate} ` +
      `illegal ${r.illegal} errors ${r.errors}`
  );
}
if (report.drift.events.length === 0) {
  console.log('   no instrument events.');
} else {
  for (const e of report.drift.events) {
    console.log(`   ** ${e.kind} ${e.cell}${e.arm ? ` [${e.arm}]` : ''}`);
    console.log(`      ${e.detail}`);
  }
}
console.log('');
console.log('3. TREATMENT');
for (const p of report.pairs) {
  console.log(`   ${p.base} -> ${p.treat}: ${p.paired} paired, ${p.dropped} dropped`);
  for (const pr of p.problems) console.log(`     ! ${pr}`);
  for (const [cellKey, row] of Object.entries(p.cells)) {
    for (const [metric, r] of Object.entries(row)) {
      if (r.mean === null) continue;
      if (r.retired && r.mean === 0) continue;
      const mark = r.retired ? ' [RETIRED — no verdict on a live arm]' : r.outsideNull ? '  <-- OUTSIDE THE NULL' : '';
      console.log(
        `     ${cellKey} ${metric}: ${r.mean >= 0 ? '+' : ''}${r.mean} [${r.lo}, ${r.hi}] n=${r.n}${mark}`
      );
    }
  }
}
console.log('');
console.log('4. LEDGER');
if (report.ledgerUpdates.length === 0) {
  console.log('   no flag named (--flag), or no gate metric matched. Nothing proposed.');
} else {
  for (const u of report.ledgerUpdates) for (const n of u.notes) console.log(`   ${n}`);
}

if (WRITE) {
  L.save(ledger, arg('ledger', L.LEDGER_PATH));
  console.log('');
  console.log(`   WROTE ${arg('ledger', L.LEDGER_PATH)}`);
} else {
  console.log('');
  console.log('   (dry read — pass --write to update the ledger)');
}
