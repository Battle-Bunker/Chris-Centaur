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
  ledger.flags.every((f) => f.status === 'promoted' || f.status === 'frozen' || f.nextExperiment),
  'every open flag names its next decisive experiment — promoted and frozen owe none'
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
  const r = L.applyMeasurement(l, 'CENTAUR_SCOUT', {
    batch: 'test-live',
    kind: 'live',
    cell: 'headline',
    metric: 'scoutThreads',
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
  const had = L.flagOf(before, 'TERRITORY_SLIDER_PROFILE').controlEvidence;
  ok(
    f.controlEvidence.inert.length === (had ? had.inert.length : 0) + 1 &&
      f.controlEvidence.violated.length === (had ? had.violated.length : 0),
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
  const scoutBefore = L.flagOf(l, 'CENTAUR_SCOUT').status;
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
  // THE ASSERTION IS "IT DID NOT MOVE", NOT "IT IS STILL probe-passed". The
  // starting status is read from the live ledger, which legitimately advances
  // as batches land — pinning the literal word made this gate fail every time
  // the record it checks did its job.
  ok(
    !r.changed && L.flagOf(l, 'CENTAUR_SCOUT').status === scoutBefore,
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
  // ORDER-INDEPENDENCE, and the first real ingest run is the exhibit. Appending
  // an adequately-powered per-cell row from the SAME batch after an
  // underpowered sweep-level one must not settle the null: the rule asks about
  // the batch, not about whichever row happened to be written last.
  {
    const l2 = clone();
    const f2 = L.flagOf(l2, 'CENTAUR_UNIT_FATALITY');
    const lastBatch = f2.measurements.filter((m) => m.kind === 'live' && m.family === 'placement').pop().batch;
    f2.measurements.push({
      batch: lastBatch,
      kind: 'live',
      cell: 'later-row::some-cell',
      metric: 'score',
      family: 'placement',
      verdict: 'null',
      value: 'appended after the underpowered row',
      nullVerified: true,
      armEngagementVerified: true,
      power: { blocksHad: 16, blocksNeeded: 3, underpowered: false, mdeTarget: 0.25 },
    });
    ok(
      L.nullIsUnresolved(f2),
      'and a later adequately-powered row from the SAME batch does not settle it — the rule is order-independent'
    );
    const f3 = L.flagOf(l2, 'CENTAUR_UNIT_FATALITY');
    for (const m of f3.measurements) {
      if (m.kind === 'live' && m.family === 'placement' && m.power) m.power.underpowered = false;
    }
    ok(!L.nullIsUnresolved(f3), 'but a batch whose every placement cell could resolve the effect does settle it');
  }
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

// EVERY CALL DECLARES ITS SUBJECT. The fixture seats two lobsters and rotates
// them, exactly as the real batches do, so the ingest refuses to guess which
// one is the contender. See extract.js subjectOf.
const FIXTURE_SUBJECT = {
  nullA: 'lobster-territory',
  nullB: 'lobster-territory',
  base: 'lobster-territory',
  treat: 'lobster-territory',
};
const nullPair = E.pairCells(arms.get('nullA'), arms.get('nullB'), { subjectMap: FIXTURE_SUBJECT });
ok(nullPair.paired === 36 && nullPair.problems.length === 0, 'the A/A pair pairs all 36 games cleanly');
ok(
  arms.get('nullA').meta.bundleStamp.sha === arms.get('nullB').meta.bundleStamp.sha,
  'the A/A arms are the same bundle'
);

const band = D.nullBand(nullPair, E.METRIC_KEYS);
const hyg = D.hygiene(arms);
const events = D.instrumentEvents({
  band,
  flips: D.flipRate(arms.get('nullA'), arms.get('nullB'), { subjectMap: FIXTURE_SUBJECT }),
  hygieneRows: hyg,
});
ok(
  events.some((e) => e.kind === 'cap-rate-asymmetry'),
  'the planted cap-rate doubling is raised as an instrument event (P5 in miniature)'
);
ok(
  hyg.every((r) => r.illegal === 0 && r.errors === 0),
  'integrity counters are zero across every arm'
);

const treatPair = E.pairCells(arms.get('base'), arms.get('treat'), { subjectMap: FIXTURE_SUBJECT });
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
      '--flag', 'CENTAUR_TERRITORY_REFINE',
      '--engagement', 'wasmRuns',
      '--subject-map', 'nullA=lobster-territory,nullB=lobster-territory,base=lobster-territory,treat=lobster-territory',
    ],
    { encoding: 'utf8' }
  );
  // Again the DESTINATION, not the transition: the flag's starting status is
  // whatever the live record currently says, and the claim under test is that
  // the planted failure is proposed — not that it is proposed from one
  // particular rung.
  ok(/-> live-failed/.test(out), 'the CLI ingest proposes the failure the fixture planted');
  ok(out.includes('does not move a status'), 'and refuses to let a non-status-moving family move it');
  ok(!fs.readFileSync(L.LEDGER_PATH, 'utf8').includes('selftest-fixture'), 'a dry read wrote nothing');
}

// -------------------------------- 2b. the two defects the FIRST REAL BATCH found
//
// Both were invisible against the synthetic fixture and fatal against
// `20260827-overnight`, for the same reason: the fixture runs its A/A null and
// its treatment under ONE sweepId and writes its rows in a fixed order, and a
// real batch does neither. Each assertion below reproduces the row that exposed
// its defect.

section('2b. WHAT THE FIRST REAL BATCH FOUND');

// --- SUBJECT-SEAT-NONDETERMINISM -------------------------------------------
//
// `subjectOf` read `rows[0].seats` and took the first `lobster*`. The manifest
// is written in COMPLETION order by a worker pool and the seats rotate, so the
// answer was a race. On 20260827-overnight it resolved differently in the two
// arms of P2, P4, P5 and P7's seed arm, silently comparing `lobster-territory`
// against `lobster-material` and reporting score -0.5938 / win -1.0000 on
// `null-snake6` -- a cell whose true delta is exactly zero.
{
  const seatRow = (bots) => ({
    sweepId: 's',
    gameId: 'g',
    cell: 'c',
    block: 'b',
    configHash: 'h',
    seats: bots.map((bot, seat) => ({ seat, bot })),
    results: [],
    health: [],
  });
  const rotated = [
    seatRow(['lobster-territory', 'lobster-material', 'reflex']),
    seatRow(['lobster-material', 'reflex', 'lobster-territory']),
    seatRow(['reflex', 'lobster-territory', 'lobster-material']),
  ];
  ok(
    E.subjectOf(rotated) === null,
    'an arm seating two candidate subjects resolves to null — the ingest does not guess which bot it is measuring'
  );
  ok(
    JSON.stringify(E.subjectCandidates(rotated)) === JSON.stringify(E.subjectCandidates([...rotated].reverse())),
    'and the candidate set is order-independent, because manifest.jsonl is written in completion order'
  );
  ok(
    E.subjectOf([seatRow(['lobster-territory', 'reflex'])]) === 'lobster-territory',
    'a single seated candidate still resolves without a declaration'
  );
  ok(E.subjectOf(rotated, 'lobster-material') === 'lobster-material', 'and a declared subject always wins');

  const undeclared = E.pairCells(arms.get('base'), arms.get('treat'));
  ok(undeclared.paired === 0, 'pairing WITHOUT a declared subject pairs nothing rather than guessing');
  ok(
    undeclared.problems.some((p) => p.includes('--subject-map') && p.includes('lobster-material')),
    'and says so loudly, naming both candidates and the flag that resolves it'
  );
}

// --- NULL-BAND-CELL-KEY ----------------------------------------------------
//
// The floor is a property of the CELL. Cell keys carry the sweepId, and the A/A
// runs under its own (`n0-aa-null`), so a whole-key lookup never matched on a
// real batch and the code fell back to the FIRST A/A cell's half-width for
// every cell in the batch -- lending `headline-mix-king`'s +/-0.0973 to
// `null-snake6` (true floor +/-0.0324) and to five cells with no floor at all.
{
  const os = require('os');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'learnloop-crosssweep-'));
  const copyArm = (from, to, sweepFrom, sweepTo, rewrite) => {
    const dst = path.join(scratch, 'arms', to, sweepTo);
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(
      path.join(fixtureDir, 'arms', from, 'arm.json'),
      path.join(scratch, 'arms', to, 'arm.json')
    );
    const rows = E.readRows(path.join(fixtureDir, 'arms', from, sweepFrom, 'manifest.jsonl'))
      .map((r) => ({ ...r, sweepId: sweepTo, ...(rewrite ? rewrite(r) : {}) }))
      .filter((r) => r !== null);
    fs.writeFileSync(path.join(dst, 'manifest.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  // The null runs on ONE cell, under its own sweepId, exactly as a real batch does.
  copyArm('nullA', 'nullA', 'f1-fixture', 'n0-aa-null');
  copyArm('nullB', 'nullB', 'f1-fixture', 'n0-aa-null');
  for (const a of ['nullA', 'nullB']) {
    const f = path.join(scratch, 'arms', a, 'n0-aa-null', 'manifest.jsonl');
    const kept = E.readRows(f).filter((r) => r.cell === 'headline-mix-king');
    fs.writeFileSync(f, kept.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  copyArm('base', 'base', 'f1-fixture', 'p9-treatment');
  copyArm('treat', 'treat', 'f1-fixture', 'p9-treatment');

  const out = execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'bin', 'ingest.js'),
      '--batch', scratch,
      '--batch-id', 'selftest-crosssweep',
      '--null', 'nullA,nullB',
      '--pair', 'base=treat',
      '--flag', 'CENTAUR_TERRITORY_REFINE',
      '--engagement', 'wasmRuns',
      '--subject-map', 'nullA=lobster-territory,nullB=lobster-territory,base=lobster-territory,treat=lobster-territory',
      '--out', path.join(scratch, 'report.json'),
    ],
    { encoding: 'utf8' }
  );
  const rep = JSON.parse(fs.readFileSync(path.join(scratch, 'report.json'), 'utf8'));
  const cells = rep.pairs[0].cells;
  const aaFloor = rep.null.band['n0-aa-null::headline-mix-king'].score.halfWidth;
  ok(
    cells['p9-treatment::headline-mix-king'].score.nullHalfWidth === aaFloor && aaFloor !== null,
    'the floor resolves ACROSS sweep ids — a null under n0-aa-null floors the same cell under p9-treatment'
  );
  ok(
    cells['p9-treatment::null-snake6'].score.nullHalfWidth === null &&
      cells['p9-treatment::null-snake6'].score.outsideNull === null,
    'and a treated cell the A/A never ran has NO floor — it never borrows the floor of another cell'
  );
  ok(
    out.includes('UNREADABLE'),
    'so the ledger records that row as UNREADABLE rather than as a null result'
  );
  ok(/-> live-failed/.test(out), 'while the floored cell still carries its verdict');
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ------------------------------ 2c. the two gaps the SECOND REAL BATCH found
//
// Neither is a wrong number. Both are a RIGHT number about the wrong thing —
// the ledger recording a column the program stopped optimizing, and the ledger
// accepting a witness that does not witness the treatment. They surfaced
// together on 20260831-batch2, which is the first batch whose bundles carry a
// per-seat resolved config stamp AND whose treatments are candidate knobs with
// no counters of their own.

section('2c. WHAT THE SECOND REAL BATCH FOUND');

// --- OBJECTIVE-NOT-EXTRACTED -----------------------------------------------
//
// Owner ruling 2026-08-29 made `sharePar` the objective and demoted `score` to
// a rank reading kept for continuity. `aggregate.js` and `verify-null.js` were
// changed that day; this extractor was not. So every ledger row written between
// the ruling and 20260831 — and every floor those rows were read against — was
// denominated in the column the ruling had just demoted.
{
  ok(E.METRIC_KEYS.includes('sharePar'), 'the extractor emits `sharePar` — THE OBJECTIVE, not only the rank readings');
  ok(
    E.METRIC_KEYS.indexOf('sharePar') < E.METRIC_KEYS.indexOf('score'),
    'and emits it FIRST, because when the two disagree it is the one being optimized'
  );
  ok(
    P.polarityOf('sharePar') === P.HIGHER,
    'and it carries a polarity — par is 1 and up is good, so it can be SCORED rather than filed unscored'
  );
  ok(
    P.missingFrom(E.METRIC_KEYS).length === 0,
    'and the polarity table is still TOTAL over everything the extractor emits'
  );

  // A stamped row is read, not recomputed.
  const stamped = {
    results: [
      { bot: 'x', score: 1, place: 1, finalMaterial: 30, finalUnits: 3, sharePar: 2.5, eliminatedOnTurn: null },
      { bot: 'y', score: 0, place: 2, finalMaterial: 10, finalUnits: 1, sharePar: 0.5, eliminatedOnTurn: null },
    ],
    health: [], turns: 5, terminal: 'cap',
  };
  ok(E.metricsFor(stamped, 'x').sharePar === 2.5, 'a harness-stamped `sharePar` is read as stamped');

  // An OLD manifest carries no `sharePar` and must be recovered from the end
  // weights it does carry, by the same formula the aggregator uses: share of
  // total adjudicated weight x teams. 30/(30+10) x 2 = 1.5.
  const old = {
    results: [
      { bot: 'x', score: 1, place: 1, finalMaterial: 30, finalUnits: 3, eliminatedOnTurn: null },
      { bot: 'y', score: 0, place: 2, finalMaterial: 10, finalUnits: 1, eliminatedOnTurn: null },
    ],
    health: [], turns: 5, terminal: 'cap',
  };
  ok(
    Math.abs(E.metricsFor(old, 'x').sharePar - 1.5) < 1e-9,
    'and a manifest predating the column recovers it from the end weights — the historical corpus stays readable'
  );
  const wipe = {
    results: [
      { bot: 'x', score: 0.5, place: 1, finalMaterial: 0, finalUnits: 0, eliminatedOnTurn: 9 },
      { bot: 'y', score: 0.5, place: 1, finalMaterial: 0, finalUnits: 0, eliminatedOnTurn: 9 },
    ],
    health: [], turns: 9, terminal: 'decisive',
  };
  ok(
    E.metricsFor(wipe, 'x').sharePar === 1,
    'a mutual final wipe falls back to par — the one game shape the recomputation cannot reach, and aggregate.js names those games'
  );
}

// --- ENGAGEMENT-FROM-CONFIG ------------------------------------------------
//
// The P5 rule says a live status needs the treatment arm's engagement SHOWN.
// It was written against mechanism counters, and a candidate knob has none:
// `CENTAUR_UNIT_FATALITY` changes which stagings a classifier rejects and
// publishes no counter of its own. The only counter available to name is one
// like `clusterJoints` that is equally nonzero on the BASE arm — so naming it
// satisfies the rule's letter while witnessing nothing about the treatment.
// The resolved per-seat config stamp is the witness that is actually specific
// to the arm, and it is strictly stronger.
{
  const os = require('os');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'learnloop-engcfg-'));
  const armWith = (name, unitFatality) => {
    const dir = path.join(scratch, 'arms', name, 'p-eng');
    fs.mkdirSync(dir, { recursive: true });
    const rows = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 0; r < 3; r++) {
        const bots = ['reflex', 'lobster-territory', 'lobster-material'];
        const seats = bots.map((_, i) => ({ seat: i, bot: bots[(i + r) % 3] }));
        rows.push({
          sweepId: 'p-eng', gameId: `c-s${s}-r${r}`, cell: 'c', block: `c#${s}`,
          configHash: 'h', seed: s, turns: 10, terminal: 'cap',
          seats,
          results: seats.map((x) => ({
            bot: x.bot, seat: x.seat, score: 0.5, place: 2, finalMaterial: 10,
            finalUnits: 1, sharePar: 1, eliminatedOnTurn: null,
          })),
          health: seats.map((x) => ({
            bot: x.bot, seat: x.seat, decisions: 5, illegal: 0, errors: 0,
            overruns: 0, unstaged: 0, stagedNothing: 0, assumptions: 0, ratchetRefusals: 0,
            worstWallMs: 10, plansEvaluated: 0, boundsInversions: 0,
            // The knob lands on ONE seat, which is the isolation property the
            // kit's own gate asserts. `clusterJoints` is nonzero on BOTH arms,
            // which is exactly why it is the wrong witness.
            mechanism: {
              flags: {
                name: x.bot,
                unitFatality: x.bot === 'lobster-territory' ? unitFatality : false,
              },
              clusterJoints: 1234,
            },
          })),
        });
      }
    }
    fs.writeFileSync(path.join(dir, 'manifest.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(
      path.join(scratch, 'arms', name, 'arm.json'),
      JSON.stringify({ arm: name, bundleStamp: { sha: 'same' }, envOverrides: {} }) + '\n'
    );
  };
  armWith('base', false);
  armWith('treat', true);
  armWith('sham', false); // an arm named as a treatment that resolved the DEFAULT

  const runIngest = (extra) =>
    execFileSync(
      process.execPath,
      [
        path.join(ROOT, 'bin', 'ingest.js'),
        '--batch', scratch, '--batch-id', 'selftest-engcfg',
        '--subject-map', 'base=lobster-territory,treat=lobster-territory,sham=lobster-territory',
        '--out', path.join(scratch, 'r.json'),
        ...extra,
      ],
      { encoding: 'utf8' }
    );

  runIngest(['--pair', 'base=treat', '--flag', 'CENTAUR_UNIT_FATALITY', '--engagement-config', 'unitFatality']);
  let rep = JSON.parse(fs.readFileSync(path.join(scratch, 'r.json'), 'utf8'));
  ok(
    rep.ledgerUpdates.length > 0 && rep.ledgerUpdates.every((u) => u.measurement.armEngagementVerified === true),
    'engagement is SHOWN from the resolved per-seat config stamp when the treatment has no counter of its own'
  );

  runIngest(['--pair', 'base=sham', '--flag', 'CENTAUR_UNIT_FATALITY', '--engagement-config', 'unitFatality']);
  rep = JSON.parse(fs.readFileSync(path.join(scratch, 'r.json'), 'utf8'));
  ok(
    rep.ledgerUpdates.length > 0 && rep.ledgerUpdates.every((u) => u.measurement.armEngagementVerified === false),
    'an arm that carries a treatment NAME but resolved the default is caught — false, not null: the silent A/A that voided P5'
  );

  runIngest(['--pair', 'base=treat', '--flag', 'CENTAUR_UNIT_FATALITY', '--engagement-config', 'noSuchField']);
  rep = JSON.parse(fs.readFileSync(path.join(scratch, 'r.json'), 'utf8'));
  ok(
    rep.ledgerUpdates.length > 0 && rep.ledgerUpdates.every((u) => u.measurement.armEngagementVerified === null),
    'a field absent from the stamp is CANNOT SAY (null), never a quiet yes — the tri-state the ledger rule is written against'
  );

  // TWO WITNESSES NEVER WEAKEN A CLAIM: with both named, a counter that says
  // yes cannot rescue a config stamp that says no.
  runIngest(['--pair', 'base=sham', '--flag', 'CENTAUR_UNIT_FATALITY',
    '--engagement', 'clusterJoints', '--engagement-config', 'unitFatality']);
  rep = JSON.parse(fs.readFileSync(path.join(scratch, 'r.json'), 'utf8'));
  ok(
    rep.ledgerUpdates.every((u) => u.measurement.armEngagementVerified === false),
    'and a nonzero shared counter does NOT rescue an arm whose config stamp says it never engaged'
  );
  fs.rmSync(scratch, { recursive: true, force: true });
}

// --- EXPLORATION-SLICE-INVERTED ---------------------------------------------
//
// Every other pair in the program is `<flag off>=<flag on>`. THE EXPLORATION
// SLICE IS THE ONE THAT IS NOT: it exists to keep running the OPPOSITE branch
// of an already-promoted default, so its treatment arm has the flag OFF and its
// deltas point the other way by construction. Scored without knowing that, the
// loop reads the slice backwards — and on 20260831-batch2 it did, calling X9's
// `deathsSelf +0.5 [+0.1938, +0.8062]` on the GUARD-OFF arm a failure of the
// guard. That row is the clearest evidence in the batch that the guard works.
{
  const mk = (mean) => ({
    batch: 'selftest-slice', kind: 'live', cell: 'c', metric: 'deathsSelf', family: 'mechanism',
    nullVerified: true, armEngagementVerified: true, nullBandHalfWidth: 0.1,
    power: { blocksHad: 8, blocksNeeded: 4, underpowered: false, mdeTarget: 0.25 },
    value: `${mean}`,
  });
  // The metric's own polarity is unchanged: deathsSelf is lower-is-better.
  ok(P.polarityOf('deathsSelf') === P.LOWER, 'deathsSelf is lower-is-better, and that does not change');
  // Scored as an ordinary treatment, a POSITIVE deathsSelf delta is a failure.
  ok(
    P.scoreVerdict({ mean: 0.5, outsideNull: true, metric: 'deathsSelf' }) === 'failed',
    'on an ordinary pair, more self-kills on the treatment arm is a FAILURE'
  );
  // Scored from the flag's side — which is what --opposite-branch does — the
  // same number is support: the arm that killed itself more is the arm with the
  // guard turned OFF.
  ok(
    P.scoreVerdict({ mean: -0.5, outsideNull: true, metric: 'deathsSelf' }) === 'supports-promotion',
    'on an exploration slice the SAME number SUPPORTS the flag — the arm that died more had it off'
  );

  // --- PROMOTED-DEMOTED-BY-NULL --------------------------------------------
  //
  // A promoted default accumulates null rows BY DESIGN, because the slice is
  // required to run against it forever. Demoting on them makes keeping the
  // slice worse than dropping it — the CONTROL-CELLS-DEMOTE lesson, at the top
  // of the ladder instead of the bottom.
  const led = L.load(L.LEDGER_PATH);
  const promotedFlag = led.flags.find((f) => f.status === 'promoted');
  ok(promotedFlag !== undefined, 'the ledger carries at least one promoted default to test against');
  if (promotedFlag) {
    const name = promotedFlag.flag;
    L.applyMeasurement(led, name, { ...mk(0), verdict: 'null', cell: 'slice-null-1' });
    ok(L.flagOf(led, name).status === 'promoted', 'a NULL row does not unship a promoted default');
    L.applyMeasurement(led, name, { ...mk(-0.5), verdict: 'supports-promotion', cell: 'slice-sup' });
    ok(
      L.flagOf(led, name).status === 'promoted',
      'and a SUPPORTING row does not knock it down a rung to `supported` either'
    );
    L.applyMeasurement(led, name, { ...mk(0.5), verdict: 'failed', cell: 'slice-fail' });
    ok(
      L.flagOf(led, name).status === 'live-failed',
      'but a demonstrated cost that cleared its own floor STILL revises it — a promotion is not a one-way door'
    );
  }
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
    "including the two batch-1 missed: the slider's only win cell and P10/P11's hazard board"
  );
  ok(
    specOf('n0-aa-null').seeds.length === specOf('p7f-unit_fatality').seeds.length,
    'and it is still sized like the treatment cells'
  );

  // ── CROSS-BRANCH ARMS (the branching paradigm, owner ruling 20260830) ────
  //
  // An architecture change is validated as a batch arm built from ITS OWN REF.
  // The one thing an operator cannot reconstruct from prose is which ref each
  // arm is built from, so an experiment that declares `armRefs` must print the
  // build-bot.sh line for every arm — and must NOT print a bot config against a
  // pre-teardown bundle, which checkContenders would refuse.
  {
    const ledger = L.load(L.LEDGER_PATH);
    const roles = ledger.branchRoles ?? {};
    const withRefs = ledger.flags.filter((f) => (f.nextExperiment ?? {}).armRefs);
    ok(withRefs.length > 0, 'at least one experiment is specified as a cross-branch pair');
    for (const f of withRefs) {
      const x = f.nextExperiment;
      const sweepId = `${x.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${f.flag
        .toLowerCase()
        .replace(/^centaur_/, '')}`;
      const text = specOf(sweepId)._comment.join('\n');
      for (const [arm, key] of Object.entries(x.armRefs)) {
        const role = roles[key];
        ok(role !== undefined && !!role.ref, `${x.id}: arm "${arm}" names a real branch role`);
        ok(
          text.includes(`build-bot.sh ${role.ref} `),
          `${x.id}: the spec prints the build-bot.sh line for "${arm}" (${role.ref})`
        );
        ok(
          text.includes(`--arm '${arm}=<bundle-${role.bundleName}>'`),
          `${x.id}: and the --arm line naming that arm's own bundle`
        );
      }
      const refs = Object.values(x.armRefs).map((k) => (roles[k] ?? {}).ref);
      ok(new Set(refs).size === refs.length, `${x.id}: the arms are built from DIFFERENT refs`);
      ok(
        Object.values(x.armConfigs ?? {}).every((c) => c === null),
        `${x.id}: no bot config on either arm — a pre-teardown bundle would refuse one`
      );
    }
  }

  // ── AND THE A/A NULL PAIRS LIKE WITH LIKE ────────────────────────────────
  //
  // verify-null.js asserts an identical bundle SHA in both arms, so a batch
  // that races branches must SAY which bundle its null is two copies of. A null
  // spec that named `<bundle>` in a cross-branch batch is an instruction to
  // guess, and the guess that pairs a baseline build against a feature build
  // makes the floor read as a treatment.
  {
    const ledger = L.load(L.LEDGER_PATH);
    const aa = (ledger.branchRoles ?? {}).aaNull;
    ok(aa !== undefined && !!aa.use, 'the ledger names which branch the A/A null is built from');
    const role = ledger.branchRoles[aa.use];
    const text = specOf('n0-aa-null')._comment.join('\n');
    ok(
      text.includes(`--arm nullA=<bundle-${role.bundleName}> --arm nullB=<bundle-${role.bundleName}>`),
      'and the null spec seats that ONE bundle twice, not two different builds'
    );
    ok(text.includes(`build-bot.sh ${role.ref} `), 'and prints the ref it is built from');
    ok(text.includes('no floor of its own'), 'and names the arm this choice leaves unfloored');
  }

  // ── THE HUMAN VIEW IS CURRENT, AND ITS OWNER-FACING NAME RESOLVES ────────
  //
  // The page's filename still says "promotion"; its content must not. The alias
  // is a pointer rather than a rename because the path is named from the kit
  // branch, the batch README, the coordination notes and the ledger's own
  // `closedIn` strings — a broken link is worse for a reader than an old name.
  {
    // A STALE PAGE IS A FAILED ASSERTION, NOT A CRASHED GATE. `--check` exits
    // nonzero, and letting `execFileSync` throw took the whole selftest down
    // with a hex dump instead of a one-line reason — which is how a gate that
    // is meant to be run after every ledger edit becomes a gate nobody runs
    // during one.
    let staleErr = null;
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'bin', 'render-status.js'), '--check'], { stdio: 'pipe' });
    } catch (e) {
      staleErr = String(e.stderr ?? e.message ?? '').trim() || 'render-status --check exited nonzero';
    }
    ok(
      staleErr === null,
      `PROMOTION-STATUS.md is rendered from the ledger and is not stale${staleErr ? ` — ${staleErr}` : ''}`
    );
    const view = fs.readFileSync(path.join(ROOT, 'PROMOTION-STATUS.md'), 'utf8');
    ok(view.startsWith('# Validation status'), 'and it is titled in the owner-facing vocabulary');
    // The BADGES are the page's own voice; the schema words appear only inside
    // backticks (the translation table) or inside a quoted owner ruling.
    const badges = view
      .split('\n')
      .filter((l) => l.startsWith('### `CENTAUR_') || l.startsWith('### `gainOrdering') || l.startsWith('### `TERRITORY_'));
    ok(badges.length === 14, 'every candidate has a heading with a badge');
    ok(
      badges.every((l) => !/— dark$/.test(l) && !/— PROMOTED$/.test(l)),
      'and no badge is written in the banned vocabulary'
    );
    ok(
      view.includes('— merged, not selected') || !view.includes('"dark"'),
      'the merged-not-selected badge is the replacement actually rendered'
    );
    const aliasPath = path.join(ROOT, 'VALIDATION-STATUS.md');
    ok(fs.existsSync(aliasPath), 'VALIDATION-STATUS.md exists so the owner-facing name resolves');
    ok(
      fs.readFileSync(aliasPath, 'utf8').includes('PROMOTION-STATUS.md'),
      'and it points at the real page rather than duplicating it'
    );
  }
  fs.rmSync(outDir, { recursive: true, force: true });
}
{
  // ── the potion default, and the guard that keeps one name on one board ────
  const C = require('../lib/cells');
  ok(C.POTION_DEFAULT === 'on', 'potions are ON by default — the board real games are played on');
  ok(
    C.cell('brand-new-mix-king', { roster: 'mix-king' }).config.potions.enabled === true,
    'a new cell with no marker in its name is generated potions-on'
  );
  ok(
    C.cell('nopotion-mix-king', { roster: 'mix-king' }).config.potions.enabled === false,
    'a `nopotion-` name is the explicit off-control, and needs no argument to be one'
  );
  ok(
    C.cell('headline-mix-king', { roster: 'mix-king' }).config.potions.enabled === false,
    'a legacy name keeps the board its ledger rows were measured on'
  );
  throws(
    () => C.cell('headline-mix-king', { roster: 'mix-king', potions: 'on' }),
    'and re-pointing a legacy name at a different board throws rather than rewriting its history'
  );
  throws(
    () => C.cell('potion-mix-king', { roster: 'mix-king', potions: 'off' }),
    'a cell name that disagrees with its board throws — rename the cell instead'
  );
  for (const name of C.LEGACY_POTIONS_OFF) {
    ok(
      C.cell(name, { roster: 'mix-king' }).config.potions.enabled === false,
      `${name}: pinned potions-off, so its ledger rows stay true`
    );
  }
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
