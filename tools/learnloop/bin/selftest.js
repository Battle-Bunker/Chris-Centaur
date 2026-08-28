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

// -------------------------------------------------- ENGAGEMENT-TRISTATE
//
// The rule is "engagement not SHOWN moves nothing", and the vocabulary has
// three values, not two. `null` is CANNOT SAY — the common case for every
// bundle predating the CL7 mechanism report — and it used to sail through.

{
  const engagement = (v) => {
    const l = clone();
    const m = {
      batch: `test-eng-${String(v)}`,
      kind: 'live',
      cell: 'headline',
      metric: 'score',
      family: 'placement',
      verdict: 'supports-promotion',
      nullVerified: true,
    };
    if (v !== undefined) m.armEngagementVerified = v;
    return L.applyMeasurement(l, 'CENTAUR_SCOUT', m);
  };
  ok(!engagement(null).changed, 'engagement `null` (CANNOT SAY) moves nothing — the tri-state rule');
  ok(!engagement(undefined).changed, 'and an absent engagement field moves nothing either');
  ok(!engagement(false).changed, 'a counter read as ZERO still moves nothing');
  ok(engagement(true).changed, 'only engagement SHOWN lets a row through');
  ok(
    engagement(null).notes.join(' ').includes('cannot say is not the same as said yes'),
    'and the refusal says which of the three values it refused on'
  );
}

// ------------------------------------------------ CONTROL-CELLS-DEMOTE
//
// TERRITORY_SLIDER_PROFILE's inert control sat at EXACTLY 0 against a measured
// +/-0.0324 floor — the strongest row in the ledger — and demoted the flag it
// was vouching for. The better the control, the harder it demoted.

{
  const sliderControl = (over) => ({
    batch: 'test-control',
    cell: 'p3-slider-2000::null-snake6 (INERT CONTROL)',
    metric: 'score',
    value: 'exactly 0 against a measured +/-0.0324 floor',
    nullVerified: true,
    armEngagementVerified: true,
    ...over,
  });

  const before = clone();
  ok(L.flagOf(before, 'TERRITORY_SLIDER_PROFILE').status === 'supported', 'the slider starts supported');

  // The defect, kept as an assertion: filed as what it literally is — a
  // placement cell that showed nothing — a perfect control still demotes. The
  // fix is the KIND, not a loosening of the null rule.
  const asPlacement = clone();
  L.applyMeasurement(
    asPlacement,
    'TERRITORY_SLIDER_PROFILE',
    sliderControl({ kind: 'live', family: 'placement', verdict: 'null' })
  );
  ok(
    L.flagOf(asPlacement, 'TERRITORY_SLIDER_PROFILE').status === 'live-null',
    'filed as a placement null, a perfect control DOES demote — the defect, still reachable'
  );

  const asControl = clone();
  const r = L.applyMeasurement(
    asControl,
    'TERRITORY_SLIDER_PROFILE',
    sliderControl({ kind: 'control', family: 'placement', verdict: 'inert' })
  );
  const f = L.flagOf(asControl, 'TERRITORY_SLIDER_PROFILE');
  ok(f.status === 'supported', "the slider's exactly-0 control no longer demotes the flag it vouches for");
  ok(!r.changed && r.before === 'supported', 'a control enters no effect channel, in either direction');
  ok(
    f.controlEvidence.inert.length === 1 && f.controlEvidence.violated.length === 0,
    'and is recorded as instrument evidence instead'
  );

  // A control that MOVES is an instrument failure, and must not read as a win.
  const violated = clone();
  const rv = L.applyMeasurement(
    violated,
    'TERRITORY_SLIDER_PROFILE',
    sliderControl({ kind: 'control', family: 'placement', verdict: 'control-violated' })
  );
  ok(
    !rv.changed && L.flagOf(violated, 'TERRITORY_SLIDER_PROFILE').controlEvidence.violated.length === 1,
    'a control that MOVED is recorded as an instrument failure and still writes no verdict'
  );
  ok(
    rv.notes.join(' ').includes('CONTROL VIOLATED'),
    'and it says so loudly — every treatment row beside it is provisional'
  );
  throws(
    () => L.applyMeasurement(clone(), 'CENTAUR_SCOUT', { batch: 'b', kind: 'nonsense', cell: 'c', metric: 'score' }),
    'an unknown measurement kind is still refused'
  );
}

// ----------------------------------------------------- METRIC-POLARITY
//
// The ingest used to score by SIGN ALONE. The exhibit is this program's
// founding finding: CENTAUR_CLUSTER_SEED failed live through an exhaustion-death
// INCREASE of +36 per 48 games, on a metric declared `family: mechanism`.

section('1b. METRIC POLARITY');

const P = require('../lib/polarity');

{
  const seedGate = { name: 'deathsExhaustion', family: 'mechanism', lowerIsBetter: true };
  const founding = { mean: 36, outsideNull: true, metric: 'deathsExhaustion', gate: seedGate };

  ok(P.polarityOf('deathsExhaustion') === P.LOWER, 'deathsExhaustion is declared lower-is-better');
  ok(
    P.scoreVerdict(founding) === 'failed',
    "the seed's founding failure (+36 exhaustion deaths) scores AGAINST promotion"
  );
  // The bug, stated as the thing that is no longer true.
  ok(
    P.scoreVerdict({ ...founding, gate: null }) === 'failed',
    'and scores against it from the shared table alone, with no gate declaration'
  );
  ok(
    P.scoreVerdict({ mean: -6, outsideNull: true, metric: 'deathsExhaustion' }) === 'supports-promotion',
    'while deaths FALLING 39 -> 33 no longer reads as a failure (CENTAUR_UNIT_FATALITY)'
  );
  ok(
    P.scoreVerdict({ mean: -0.229, outsideNull: true, metric: 'place' }) === 'supports-promotion',
    'and `place` improving by -0.229 reads as a win, because place 1 is first (the slider)'
  );
  ok(P.scoreVerdict({ mean: 0.115, outsideNull: true, metric: 'score' }) === 'supports-promotion', 'score up is a win');
  ok(P.scoreVerdict({ mean: -0.594, outsideNull: true, metric: 'win' }) === 'failed', 'win rate down is a failure');
  ok(
    P.scoreVerdict({ mean: 5.125, outsideNull: true, metric: 'worstWallMs' }) === 'failed',
    'and +5.125 ms of worst-case wall time is a cost, not a win (CENTAUR_COHORT_POLICY)'
  );
  ok(
    P.scoreVerdict({ mean: 36, outsideNull: false, metric: 'deathsExhaustion' }) === 'null',
    'inside the floor, nothing is scored at all — polarity never overrides the null band'
  );
  ok(
    P.scoreVerdict({ mean: 21.44, outsideNull: true, metric: 'turns' }) === 'outside-null-unscored',
    'a CONTEXTUAL metric outside the floor is recorded unscored, never guessed (P5 `turns`)'
  );
  ok(
    P.polarityOf('score', { name: 'score', lowerIsBetter: true }) === P.LOWER &&
      P.polarityOf('deathsExhaustion', { name: 'deathsExhaustion', polarity: P.HIGHER }) === P.HIGHER,
    "a gate's own declaration wins over the shared table"
  );
}

{
  // The table must be TOTAL over the corpus, or the defect reopens quietly on
  // the next counter somebody adds.
  const Ex = require('../lib/extract');
  ok(P.missingFrom(Ex.METRIC_KEYS).length === 0, 'every metric the extractor emits has a declared polarity');
  const gates = ledger.flags.flatMap((f) => (f.promotionMetrics ?? []).map((g) => g.name));
  const gaps = P.missingFrom(gates);
  ok(gaps.length === 0, `every gate metric any flag names has one too${gaps.length ? ` (missing: ${gaps.join(', ')})` : ''}`);
}

{
  // THE COUNTERFACTUAL THE LEDGER WAS BUILT TO PREVENT. Had the exhaustion row
  // arrived while CENTAUR_CLUSTER_SEED was still probe-passed, sign-alone
  // scoring would have written `supported`. It must write live-failed.
  const l = clone();
  const f = L.flagOf(l, 'CENTAUR_CLUSTER_SEED');
  f.status = 'probe-passed';
  const gate = (f.promotionMetrics ?? []).find((g) => g.name === 'deathsExhaustion');
  const r = L.applyMeasurement(l, 'CENTAUR_CLUSTER_SEED', {
    batch: 'test-polarity',
    kind: 'live',
    cell: 'p7-cl1-gates::null-snake6',
    metric: 'deathsExhaustion',
    family: 'mechanism',
    verdict: P.scoreVerdict({ mean: 36, outsideNull: true, metric: 'deathsExhaustion', gate }),
    nullVerified: true,
    armEngagementVerified: true,
  });
  ok(
    r.after === 'live-failed',
    'END TO END: the founding failure moves a probe-passed flag to live-failed, not to supported'
  );
}

{
  // An unscorable row is not a null row, and must not be laundered into one.
  const l = clone();
  const r = L.applyMeasurement(l, 'CENTAUR_SCOUT', {
    batch: 'test-unscored',
    kind: 'live',
    cell: 'headline',
    metric: 'scoutPlies',
    family: 'mechanism',
    value: '+21.44 [+0.47, +42.41]',
    verdict: 'outside-null-unscored',
    nullVerified: true,
    armEngagementVerified: true,
  });
  ok(
    !r.changed && L.flagOf(l, 'CENTAUR_SCOUT').status === 'probe-passed',
    'an outside-the-floor row with no good direction moves nothing and is not filed as a null'
  );
}

// ------------------------------------------------- LIVE-NULL-IS-TERMINAL

{
  const l = clone();
  const names = L.undecided(l).map((f) => f.flag);
  ok(
    names.includes('CENTAUR_UNIT_FATALITY'),
    'a live-null flag whose placement row is UNDERPOWERED is undecided — P7F can be scheduled'
  );
  const settled = clone();
  for (const m of L.flagOf(settled, 'CENTAUR_UNIT_FATALITY').measurements) {
    if (m.family === 'placement' && m.power) m.power.underpowered = false;
  }
  ok(
    !L.undecided(settled).map((f) => f.flag).includes('CENTAUR_UNIT_FATALITY'),
    'and one whose null came from a cell that COULD have seen the effect is settled'
  );
  ok(
    !L.undecided(l).map((f) => f.flag).includes('CENTAUR_STAGING_SAFETY'),
    'a promoted flag is still not undecided'
  );
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
  ok(
    out.includes('P7F'),
    'the live-null flag\'s named experiment is scheduled — a null is not automatically an answer'
  );
}

// ------------------------------------------------------ AA-FLOOR-COVERAGE
//
// The A/A null used to be hard-coded to headline-mix-king + null-snake6 whatever
// the treatments ran on, so batch 1 floored two of eight cells and the other six
// produced rows that were, by the ledger's own rule, UNREADABLE.

{
  const outDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'learnloop-batch-'));
  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'make-promotion-batch.js'), '--out', outDir], {
    stdio: 'pipe',
  });
  const specOf = (id) => JSON.parse(fs.readFileSync(path.join(outDir, `${id}.json`), 'utf8'));
  const base = (c) => String(c.cell).split('@')[0];
  const floored = new Set(specOf('n0-aa-null').cells.map(base));
  const treated = new Set(
    fs
      .readdirSync(outDir)
      .filter((n) => n.endsWith('.json') && n !== 'n0-aa-null.json' && n !== 'P-LIST.json')
      .flatMap((n) => JSON.parse(fs.readFileSync(path.join(outDir, n), 'utf8')).cells.map(base))
  );
  const uncovered = [...treated].filter((c) => !floored.has(c));
  ok(uncovered.length === 0, `the A/A null floors every cell the batch treats${uncovered.length ? ` (missing ${uncovered.join(', ')})` : ''}`);
  ok(
    floored.has('snake5-queen') && floored.has('hazard-mix-king'),
    "including the two batch-1 missed: the slider's only win cell and P5R's hazard board"
  );
  ok(
    specOf('n0-aa-null').seeds.length === specOf('p5r-wasm').seeds.length,
    'and it is still sized like the treatment cells'
  );
  fs.rmSync(outDir, { recursive: true, force: true });
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
