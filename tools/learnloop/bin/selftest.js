#!/usr/bin/env node
'use strict';
/*
 * THE LEARNING LOOP'S OWN GATE.
 *
 *   node tools/learnloop/bin/selftest.js
 *
 * Plain node, no dependencies, no build step — the same discipline
 * `tools/simworker/bin/` runs on, because this has to be runnable from a fresh
 * clone on the owner's box before anything is installed.
 *
 * It exercises four things, in the order they can fail:
 *
 *   1. THE LEDGER'S OWN INVARIANTS — the schema, and the refusals. Each rule is
 *      asserted by trying to break it: a probe cannot write a live status, a
 *      null cannot undo a failure, an unengaged arm moves nothing, an
 *      underpowered placement cell moves nothing, a frozen cell needs a
 *      mechanism claim.
 *   2. THE INGEST AGAINST THE SYNTHETIC FIXTURE, whose answers are planted and
 *      therefore known.
 *   3. THE INGEST AGAINST THE HISTORICAL CORPUS, when it is present. The
 *      2026-08 sweeps use the same per-game row schema in a different directory
 *      layout, and reading them is the only evidence that the loader's two
 *      layouts really are one reader. Skipped, loudly, when the corpus is not
 *      on this machine.
 *   4. THE BATCH GENERATOR — every spec builds, the A/A null is present and
 *      sized like the treatment cells, and the exploration slice is scheduled.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HERE = process.cwd();

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, what) {
  if (cond) {
    pass++;
    console.log(`  ok   ${what}`);
  } else {
    fail++;
    failures.push(what);
    console.log(`  FAIL ${what}`);
  }
}

function throws(fn, what) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(threw, what);
}

function section(s) {
  console.log('');
  console.log(s);
}

// ------------------------------------------------------- 1. ledger invariants

section('1. THE LEDGER');

const L = require('../lib/ledger');
const ledger = L.load();
ok(true, `promotion-ledger.json loads and validates (${ledger.flags.length} flags)`);

for (const f of ledger.flags) {
  ok(
    Array.isArray(f.promotionMetrics) && f.promotionMetrics.length > 0,
    `${f.flag}: names its promotion metrics`
  );
}
ok(
  ledger.flags.every((f) => f.status === 'promoted' || f.nextExperiment),
  'every unpromoted flag names its next decisive experiment'
);

/** A working copy, so the assertions below cannot touch the real ledger. */
const clone = () => JSON.parse(JSON.stringify(ledger));

{
  const l = clone();
  const f = L.flagOf(l, 'CENTAUR_EDGE_EV');
  f.status = 'dark';
  const r = L.applyMeasurement(l, 'CENTAUR_EDGE_EV', {
    batch: 'test-probe',
    kind: 'probe',
    cell: 'fixture',
    metric: 'mealsEaten',
    family: 'mechanism',
    verdict: 'passed',
    nullVerified: false,
  });
  ok(r.after === 'probe-passed', 'a probe raises dark -> probe-passed');

  const r2 = L.applyMeasurement(l, 'CENTAUR_EDGE_EV', {
    batch: 'test-probe-2',
    kind: 'probe',
    cell: 'fixture',
    metric: 'mealsEaten',
    family: 'mechanism',
    verdict: 'passed',
    nullVerified: false,
  });
  ok(
    r2.after === 'probe-passed' && !r2.changed,
    'a probe CANNOT write a live status — the CENTAUR_CLUSTER_SEED rule'
  );
}

{
  const l = clone();
  const r = L.applyMeasurement(l, 'CENTAUR_SCOUT', {
    batch: 'test-live',
    kind: 'live',
    cell: 'headline',
    metric: 'scoutPlies',
    family: 'mechanism',
    verdict: 'supports-promotion',
    nullVerified: false,
  });
  ok(!r.changed, 'a live measurement with no verified null moves nothing');
}

{
  const l = clone();
  const r = L.applyMeasurement(l, 'CENTAUR_SCOUT', {
    batch: 'test-live',
    kind: 'live',
    cell: 'headline',
    metric: 'scoutPlies',
    family: 'mechanism',
    verdict: 'supports-promotion',
    nullVerified: true,
    armEngagementVerified: false,
  });
  ok(!r.changed, 'a live measurement on an UNENGAGED arm moves nothing — the P5 rule');
}

{
  const l = clone();
  const r = L.applyMeasurement(l, 'CENTAUR_SCOUT', {
    batch: 'test-live',
    kind: 'live',
    cell: 'headline',
    metric: 'score',
    family: 'placement',
    verdict: 'supports-promotion',
    nullVerified: true,
    armEngagementVerified: true,
    power: { blocksHad: 8, blocksNeeded: 58, mdeTarget: 0.25, underpowered: true },
  });
  ok(!r.changed, 'an underpowered PLACEMENT cell moves nothing (8 blocks against 58)');
}

{
  const l = clone();
  const r = L.applyMeasurement(l, 'CENTAUR_CLUSTER_SEED', {
    batch: 'test-live',
    kind: 'live',
    cell: 'headline',
    metric: 'score',
    family: 'placement',
    verdict: 'null',
    nullVerified: true,
    armEngagementVerified: true,
  });
  ok(
    r.after === 'live-failed',
    'a NULL row does not rehabilitate a live-failed flag'
  );
  const r2 = L.applyMeasurement(l, 'CENTAUR_CLUSTER_SEED', {
    batch: 'test-live-2',
    kind: 'live',
    cell: 'headline',
    metric: 'score',
    family: 'placement',
    verdict: 'supports-promotion',
    nullVerified: true,
    armEngagementVerified: true,
  });
  ok(r2.after === 'live-failed', 'nor does a single supporting cell');
}

{
  const l = clone();
  const f = L.flagOf(l, 'CENTAUR_EDGE_EV');
  f.status = 'frozen';
  f.reopenOn = 'a mechanism claim about contested eats';
  const r = L.applyMeasurement(l, 'CENTAUR_EDGE_EV', {
    batch: 'test',
    kind: 'live',
    cell: 'headline',
    metric: 'mealsEaten',
    family: 'mechanism',
    verdict: 'supports-promotion',
    nullVerified: true,
    armEngagementVerified: true,
  });
  ok(!r.changed && f.status === 'frozen', 'a frozen cell is not moved by a measurement');
  throws(() => L.reopen(l, 'CENTAUR_EDGE_EV', 'p<0.05'), 'a p-value cannot re-open a frozen cell');
  L.reopen(
    l,
    'CENTAUR_EDGE_EV',
    'the EV reads survivalPrior, which is 1 unless unitFatality is on — so the fatal term was never live in the frozen measurement'
  );
  ok(f.status === 'dark', 'a MECHANISM CLAIM re-opens it');
}

{
  const l = clone();
  L.flagOf(l, 'CENTAUR_STAGING_SAFETY').promotedBy = undefined;
  throws(() => L.validate(l), 'a promoted flag with no promotedBy fails validation');
}

{
  const l = clone();
  const r = L.applyMeasurement(l, 'CENTAUR_WASM', {
    batch: 'test-live',
    kind: 'live',
    cell: 'headline',
    metric: 'wasmRuns',
    family: 'engagement',
    verdict: 'supports-promotion',
    nullVerified: true,
    armEngagementVerified: true,
  });
  ok(!r.changed, 'an ENGAGEMENT row moves nothing — running is not helping');
}

// ---------------------------------------------------- 2. the synthetic batch

section('2. THE SYNTHETIC MINI-BATCH');

const fixtureDir = path.join(ROOT, 'fixtures', 'mini-batch');
ok(fs.existsSync(fixtureDir), 'the committed fixture is present');

// Regenerate into a scratch directory and compare: the fixture must be a pure
// function of its generator, or "known answers" is not a property it has.
const regen = fs.mkdtempSync(path.join(require('os').tmpdir(), 'learnloop-fixture-'));
execFileSync(process.execPath, [path.join(ROOT, 'fixtures', 'make-fixture.js'), '--out', regen], {
  stdio: 'pipe',
});
{
  const a = fs.readFileSync(path.join(fixtureDir, 'arms', 'treat', 'f1-fixture', 'manifest.jsonl'), 'utf8');
  const b = fs.readFileSync(path.join(regen, 'arms', 'treat', 'f1-fixture', 'manifest.jsonl'), 'utf8');
  ok(a === b, 'the committed fixture is byte-identical to a fresh generation');
}
fs.rmSync(regen, { recursive: true, force: true });

const E = require('../lib/extract');
const D = require('../lib/drift');
const arms = E.loadArms(fixtureDir);
ok(arms.size === 4, 'four arms load');

const nullPair = E.pairCells(arms.get('nullA'), arms.get('nullB'));
ok(nullPair.paired === 36 && nullPair.problems.length === 0, 'the A/A pair pairs all 36 games cleanly');
ok(
  arms.get('nullA').meta.bundleStamp.sha === arms.get('nullB').meta.bundleStamp.sha,
  'the A/A arms are the same bundle'
);

const band = D.nullBand(nullPair, E.METRIC_KEYS);
const hyg = D.hygiene(arms);
const events = D.instrumentEvents({ band, flips: D.flipRate(arms.get('nullA'), arms.get('nullB')), hygieneRows: hyg });
ok(
  events.some((e) => e.kind === 'cap-rate-asymmetry'),
  'the planted cap-rate doubling is raised as an instrument event (P5 in miniature)'
);
ok(
  hyg.every((r) => r.illegal === 0 && r.errors === 0),
  'integrity counters are zero across every arm'
);

const treatPair = E.pairCells(arms.get('base'), arms.get('treat'));
ok(treatPair.paired === 36, 'the treatment pair pairs all 36 games');

function blockMean(cellKey, metric) {
  const byBlock = treatPair.cells.get(cellKey);
  const { blockCI, mean } = require('../lib/stats');
  const xs = [...byBlock.values()].map((a) => (a[metric] ? mean(a[metric]) : null)).filter((x) => x !== null);
  return blockCI(xs);
}
{
  const wasm = blockMean('f1-fixture::headline-mix-king', 'wasmRuns');
  ok(wasm.mean === 812, 'the engagement counter is extracted from the mechanism block (wasmRuns 0 -> 812)');
  const headline = blockMean('f1-fixture::headline-mix-king', 'score');
  const snake = blockMean('f1-fixture::null-snake6', 'score');
  const floorH = band['f1-fixture::headline-mix-king'].score.halfWidth;
  const floorS = band['f1-fixture::null-snake6'].score.halfWidth;
  ok(Math.abs(headline.mean) > floorH, 'the planted headline placement effect lands OUTSIDE the null floor');
  ok(Math.abs(snake.mean) < floorS, 'the planted snake6 effect lands INSIDE it, as designed');
}

// The absent-counter rule: a metric no row carries must come out as null, not 0.
{
  const m = E.metricsFor(
    { results: [{ bot: 'x', score: 1, place: 1, finalMaterial: 0, finalUnits: 0, eliminatedOnTurn: null }], health: [{ bot: 'x', decisions: 1 }], turns: 1, terminal: 'cap' },
    'x'
  );
  ok(m.wasmRuns === null, 'a mechanism counter no build emitted reads as null, never as zero');
}

// End-to-end through the CLI, which is how a human runs it.
{
  const out = execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'bin', 'ingest.js'),
      '--batch', fixtureDir,
      '--batch-id', 'selftest-fixture',
      '--null', 'nullA,nullB',
      '--pair', 'base=treat',
      '--flag', 'CENTAUR_WASM',
      '--engagement', 'wasmRuns',
    ],
    { encoding: 'utf8' }
  );
  ok(out.includes('probe-passed -> live-failed'), 'the CLI ingest proposes the failure the fixture planted');
  ok(out.includes('does not move a status'), 'and refuses to let a non-status-moving family move it');
  ok(!fs.readFileSync(L.LEDGER_PATH, 'utf8').includes('selftest-fixture'), 'a dry read wrote nothing');
}

// ------------------------------------------------- 3. the historical corpus

section('3. THE HISTORICAL CORPUS');

const CORPUS = process.env.LEARNLOOP_CORPUS ?? path.join(HERE, '..', 'sweeps', 'replays');
const histBase = path.join(CORPUS, 'i1v2-base-150-mix23');
const histTreat = path.join(CORPUS, 'i1v2-mine-150-mix23');
if (!fs.existsSync(histBase) || !fs.existsSync(histTreat)) {
  console.log(`  SKIP historical corpus not on this machine (looked in ${CORPUS});`);
  console.log('       set LEARNLOOP_CORPUS to the sweeps/replays directory to run it.');
} else {
  const h = E.loadArms('/nonexistent', { base: histBase, treat: histTreat }, 'sweep');
  ok(h.size === 2, 'the flat historical layout loads as two arms');
  ok(h.get('base').provenance === 'sweep-dir', 'and is labelled sweep-dir, so it can never promote');
  const paired = E.pairCells(h.get('base'), h.get('treat'), {
    subjectMap: { base: 'lobster-territory', treat: 'lobster-territory-i1' },
  });
  ok(paired.paired > 0 && paired.problems.length === 0, `${paired.paired} historical games pair cleanly`);
  const undeclared = E.pairCells(h.get('base'), h.get('treat'));
  ok(
    undeclared.paired === 0 && undeclared.problems.length > 0,
    'an UNDECLARED subject substitution is refused, not silently paired'
  );
}

// -------------------------------------------------- 4. the batch generator

section('4. THE BATCH GENERATOR');

{
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'make-promotion-batch.js'), '--dry'], {
    encoding: 'utf8',
  });
  ok(out.includes('--dry: nothing written'), '--dry builds and validates every spec');
  ok(out.includes('N0'), 'the mandatory A/A null is scheduled');
  ok(out.includes('exploration-slice'), 'the exploration slice is scheduled');
  ok(out.includes('NOT SCHEDULED'), 'a blocked experiment is named and not run');
}
{
  const C = require('../lib/cells');
  const s = C.spec('t', [], [C.cell('x', { roster: 'mix-king' })], C.FIELD, 16);
  ok(s.seeds.length === 16 && new Set(s.seeds).size === 16, 'seeds are 16 distinct values');
  const s8 = C.spec('t', [], [C.cell('x', { roster: 'mix-king' })], C.FIELD, 8);
  ok(
    s8.seeds.every((x, i) => x === s.seeds[i]),
    'an 8-block run NESTS inside the 16-block run — adding blocks is a stronger statement, not a different experiment'
  );
}
{
  // The vocabulary must agree with the committed simworker library wherever
  // that library is present (it is, on sim/worker-kit; it is not on the
  // engine branch, and the check skips rather than inventing a disagreement).
  const lib = path.join(HERE, 'tools', 'simworker', 'specs', 'p1-substrate-headline.json');
  if (!fs.existsSync(lib)) {
    console.log('  SKIP tools/simworker/specs not on this branch — vocabulary cross-check not run.');
  } else {
    const C = require('../lib/cells');
    const committed = JSON.parse(fs.readFileSync(lib, 'utf8'));
    const built = C.spec('p1-substrate-headline', [], [], C.FIELD, 16);
    ok(
      JSON.stringify(built.seeds) === JSON.stringify(committed.seeds),
      'the shared vocabulary reproduces the committed library seed sequence'
    );
    const cell = C.cell('headline-mix-king', { roster: 'mix-king' });
    const same = committed.cells.find((c) => c.cell === 'headline-mix-king');
    ok(JSON.stringify(cell) === JSON.stringify(same), 'and the committed cell config, byte for byte');
  }
}

// ------------------------------------------------------------------ verdict

console.log('');
console.log(`${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
