#!/usr/bin/env node
'use strict';
/*
 * INGEST ONE BATCH — validate its null, extract its metrics, update the ledger,
 * and emit the drift tables.
 *
 *   node tools/learnloop/bin/ingest.js --batch <results/<batch>> \
 *        --null nullA,nullB --pair base=treat --flag CENTAUR_WASM [--write]
 *
 *   --engagement <counter>        engagement witnessed by a mechanism counter
 *   --engagement-config <field>   engagement witnessed by the RESOLVED per-seat
 *                                 config stamp — the only witness a candidate
 *                                 knob with no counter of its own has
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
const MDE = Number(arg('mde', '0.25'));
/*
 * `--opposite-branch`: THE TREATMENT ARM CARRIES THE FLAG TURNED OFF.
 *
 * True for an exploration slice and false for everything else. See the note at
 * the verdict, and `armRole` on every measurement this writes — a row that does
 * not say which arm the flag was on cannot be re-scored later by anyone.
 */
const OPPOSITE_BRANCH = flag('opposite-branch');

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

/**
 * THE FLOOR IS A PROPERTY OF THE CELL, NOT OF THE SWEEP.
 *
 * Cell keys are `<sweepId>::<cell>`, and the A/A null runs under its OWN
 * sweepId (`n0-aa-null`), so a whole-key lookup against the null band never
 * matches for any real batch -- only for a fixture where the null and the
 * treatment share one sweepId. The first version fell back to
 * `band[Object.keys(band)[0]]` when the lookup missed, which silently lent the
 * FIRST A/A cell's half-width to every cell in the batch. On 20260827-overnight
 * that lent `headline-mix-king`'s +/-0.0973 to `null-snake6` (true floor
 * +/-0.0324, three times tighter) and to `snake5-queen`, `snake5-knight`,
 * `snake5-pawn`, `hazard-mix-king` and the three potion cells, which have NO
 * measured floor at all -- laundering the ledger's own `unreadable, not null`
 * rule into a readable verdict on eight cells out of ten.
 *
 * So: match on the CELL NAME, and refuse to substitute another cell's floor.
 * A cell the A/A never ran has no floor, `nullHalfWidth` is null, and the
 * ledger records the row as `unreadable`. That is the honest answer and it is
 * the one `AA-FLOOR-COVERAGE` exists to make expensive.
 */
const cellNameOf = (k) => (k.includes('::') ? k.slice(k.indexOf('::') + 2) : k);
const bandByCell = {};
for (const [k, row] of Object.entries(report.null.band)) bandByCell[cellNameOf(k)] = row;
function bandForCell(cellKey) {
  return bandByCell[cellNameOf(cellKey)] ?? null;
}

const ledger = L.load(arg('ledger', L.LEDGER_PATH));
const flagName = arg('flag', '');
const kind = arg('kind', batchDir ? 'live' : 'historical');
const engagementArg = arg('engagement', '');
// `--engagement-config <field>`: engagement witnessed by the RESOLVED per-seat
// config stamp rather than by a counter. For a candidate knob with no counter
// of its own, this is the only honest witness there is. See engagementFromConfig.
const engagementConfigArg = arg('engagement-config', '');

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
      const band = bandForCell(cellKey);
      const floor = band && band[metric] ? band[metric].halfWidth : null;
      row[metric] = {
        ...ci,
        nullHalfWidth: floor,
        /*
         * OUTSIDE THE FLOOR — and the test is on the WHOLE INTERVAL, not on
         * the point estimate.
         *
         * Three tests were available and two of them are too loose:
         *
         *   1. `excludes zero`             — ignores the floor entirely. This
         *      is the one an A/A pairing on a provably inert path passed with
         *      d P(first) +0.167 [0.056, 0.306].
         *   2. `|mean| > halfWidth`        — compares a POINT ESTIMATE against
         *      the band. What it says is "my best guess is bigger than noise",
         *      which is not the same claim as "the data are incompatible with
         *      noise", and it is satisfied by an interval that lies almost
         *      entirely inside the band.
         *   3. `lo > halfWidth || hi < -halfWidth`  — the whole interval clear
         *      of the band. THE ONE USED HERE.
         *
         * Test 2 is what this line did until 20260831, and the batch that
         * caught it is the reason to be precise: on 20260831-batch2,
         * CENTAUR_UNIT_FATALITY's `null-snake6` sharePar is
         * +0.1542 [+0.0249, +0.2835] against a floor of +/-0.1172. Its mean
         * clears the band, so test 2 scored it `supports-promotion` and the
         * machine moved the flag live-null -> supported — on the ALL-SNAKE
         * inert roster, for a classifier whose question is about boards that
         * field pieces. Its interval overlaps the band across most of its
         * length: the data are entirely compatible with a true effect of 0.03,
         * which is nothing. The batch's own write-up had already declined to
         * claim it, under precisely this stricter test, and named it so nobody
         * would rediscover it and read it as a win. The ledger should not need
         * a human to decline on its behalf.
         *
         * `meanOutsideNull` keeps test 2's answer, because it is the reading
         * every row written before this date was scored by and a record that
         * silently re-scores its own history is not a record.
         */
        outsideNull:
          floor === null
            ? null
            : ci.lo !== null && ci.hi !== null && (ci.lo > floor || ci.hi < -floor),
        meanOutsideNull: floor === null ? null : ci.mean !== null && Math.abs(ci.mean) > floor,
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

  // ENGAGEMENT, FROM WHICHEVER WITNESS THE TREATMENT ACTUALLY HAS.
  // A counter when the layer publishes one; the resolved per-seat config stamp
  // when it does not (see engagementFromConfig). When both are named, BOTH must
  // say yes — two witnesses never weaken a claim.
  const byCounter = engagementFor(treat, engagementArg);
  const byConfig = engagementFromConfig(base, treat, engagementConfigArg, subjectMap);
  const engaged =
    engagementArg && engagementConfigArg
      ? byCounter === true && byConfig === true
        ? true
        : byCounter === false || byConfig === false
          ? false
          : null
      : engagementConfigArg
        ? byConfig
        : byCounter;

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
      // THE MDE IS A PROGRAM DEFAULT, NOT THE FLAG'S QUESTION, and the row says
      // so. `--mde` overrides it. A power verdict is only as meaningful as the
      // effect size it was computed against, and "adequately powered" with no
      // MDE beside it is not a statement. See MDE-HARDCODED.
      const power = L.powerRow({ blocksHad: r.n, blockSd: r.sd, mde: MDE });
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
      /*
       * WHICH ARM IS THE FLAG ON? — `--opposite-branch` (`EXPLORATION-SLICE-
       * INVERTED`).
       *
       * Every other pair in this program is `--pair <flag off>=<flag on>`, so a
       * delta in the metric's good direction is evidence FOR the flag. THE
       * EXPLORATION SLICE IS THE ONE THAT IS NOT. Its whole purpose is to keep
       * running the OPPOSITE branch of an already-promoted default, so its
       * treatment arm carries the flag TURNED OFF and its delta points the
       * other way by construction.
       *
       * Scored without knowing that, the loop reads the slice exactly
       * backwards. On 20260831-batch2 it did: X9 ran `default` against
       * `staging-off` and measured `deathsSelf` +0.5 [+0.1938, +0.8062] on
       * `headline-mix-king` — the guard-OFF arm killing itself half a unit more
       * per game, which is the clearest evidence in the batch that the guard
       * WORKS. `deathsSelf` is lower-is-better and the delta is positive, so
       * the scorer called it `failed` and moved CENTAUR_STAGING_SAFETY from
       * `promoted` to `live-failed` — demoting a shipped guard on the strength
       * of it doing its job.
       *
       * This is METRIC-POLARITY's mistake one level up: polarity fixed "which
       * way is good for this METRIC", and this fixes "which way is good for
       * this ARM". The ledger's own README says the exploration slice is never
       * dropped for space, because today's policy selects tomorrow's corpus;
       * a loop that mis-scores the slice makes keeping it worse than dropping
       * it.
       *
       * The measured value is recorded as measured — the sign in `value` is the
       * sign in the data — and only the VERDICT is taken from the flag's point
       * of view.
       */
      const verdict = !readable
        ? 'unreadable'
        : P.scoreVerdict({
            mean: OPPOSITE_BRANCH ? -r.mean : r.mean,
            outsideNull: r.outsideNull,
            metric,
            gate,
          });
      const m = {
        batch: batchId,
        kind: controlCell(cellKey) ? 'control' : kind,
        cell: cellKey,
        metric,
        family,
        verdict: controlCell(cellKey) ? (r.outsideNull === true ? 'control-violated' : 'inert') : verdict,
        polarity,
        // WHICH ARM CARRIED THE FLAG. `treatment` is the normal pair
        // (<flag off>=<flag on>); `opposite-branch` is the exploration slice,
        // whose treatment arm has the flag OFF and whose deltas therefore point
        // the other way by construction. Recorded on the row so a later reader
        // — or a re-score — never has to infer it from the arm's name.
        armRole: OPPOSITE_BRANCH ? 'opposite-branch' : 'treatment',
        value: `${r.mean} [${r.lo}, ${r.hi}] over ${r.n} blocks; null half-width ${r.nullHalfWidth}`,
        nullVerified: readable,
        nullBandHalfWidth: r.nullHalfWidth,
        armEngagementVerified: engaged,
        power,
        powerNote:
          `power computed against MDE ${MDE} (the ingest's default unless --mde was given) using ` +
          "this cell's OWN measured block SD, not the program's pooled-stratum prior. Adequately " +
          'powered for 0.25 is not adequately powered for the two or three points a cost question ' +
          'is usually about.',
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

/**
 * ENGAGEMENT FROM THE RESOLVED CONFIG STAMP — `--engagement-config <field>`.
 *
 * A COUNTER IS NOT ALWAYS THE RIGHT WITNESS, AND SOMETIMES IT IS THE WRONG ONE.
 * `--engagement <metric>` asks "did some mechanism counter move on the
 * treatment arm", which is the right question for a layer that has its own
 * counter (`wasmRuns`, `refineMovedLo`, `selectionFar`). It is the WRONG
 * question for a config-selected candidate knob that has none:
 * `CENTAUR_UNIT_FATALITY` changes which stagings a classifier rejects and
 * publishes no counter of its own, so the only counter available to name is one
 * like `clusterJoints` that is equally nonzero on the BASE arm. Naming that
 * would let an arm that never engaged write a live status while appearing to
 * satisfy the P5 rule — the rule defeated by the shape of its own evidence.
 *
 * Since the 2026-08-29 teardown an arm is a bundle plus a named `BotConfig`,
 * and every post-teardown bundle stamps what each SEAT actually RESOLVED on
 * `health[].mechanism.config` (or `.flags` on the transitional shape). That
 * stamp is the direct witness: it says the treated seat resolved the field to
 * the value the arm asked for, and the base seat did not. It is strictly
 * stronger than a shared counter, because it is specific to the treatment.
 *
 * Returns the tri-state the ledger's rule is written against:
 *   true   the field is stamped on both arms' subject seats and DIFFERS.
 *   false  it is stamped on both and is the SAME — the arm did not engage.
 *          (This is the silent-A/A that voided P5, caught rather than assumed.)
 *   null   CANNOT SAY — no stamp on one side, or the field is absent from it.
 */
function engagementFromConfig(base, treat, field, subjectMap) {
  if (!field) return null;
  const stampOf = (arm) => {
    const subj = subjectMap[arm.name] ?? null;
    for (const rows of arm.sweeps.values()) {
      for (const r of rows) {
        for (const h of r.health ?? []) {
          if (subj !== null && h.bot !== subj) continue;
          const m = h.mechanism;
          const cfg = m && (m.config ?? m.flags);
          if (cfg && cfg[field] !== undefined) return cfg[field];
        }
      }
    }
    return undefined;
  };
  const a = stampOf(base);
  const b = stampOf(treat);
  if (a === undefined || b === undefined) return null;
  return JSON.stringify(a) !== JSON.stringify(b);
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
