'use strict';
/*
 * WHICH WAY IS GOOD? — per-metric polarity, as data.
 *
 * ── THE DEFECT THIS FILE CLOSES (`METRIC-POLARITY`) ────────────────────────
 *
 * `bin/ingest.js` used to decide a verdict by SIGN ALONE: a placement or
 * mechanism delta outside the null band scored `failed` when its mean was
 * negative and `supports-promotion` when it was positive. That is correct for
 * `score` and backwards for every cost-shaped counter in the corpus, and the
 * exhibit is this program's founding finding:
 *
 *   CENTAUR_CLUSTER_SEED failed live through EXHAUSTION DEATHS — +36 per 48
 *   games, on a metric the ledger declares `family: mechanism`. A positive
 *   delta on a status-moving family. Under sign-alone scoring that row reads
 *   `supports-promotion`: the machine would have scored the seed's collapse as
 *   evidence FOR promoting it.
 *
 * It was caught only because the flag was already `live-failed` and a different
 * rule — "a supporting cell does not overturn a live failure" — refused it. Had
 * the row arrived while the flag was still `probe-passed`, the ledger built to
 * prevent exactly this mistake would have made it.
 *
 * ── WHY A TABLE, AND WHY THREE VALUES ──────────────────────────────────────
 *
 * A table, because polarity is a property of the METRIC and not of the reading:
 * derived freshly at each call site it would be derived differently at each
 * call site. Data, so a new counter is a row here rather than a branch in the
 * scorer, and so `assertCovers` can prove at selftest time that no metric the
 * extractor emits and no gate any flag names is missing one.
 *
 * Three values, because two would force a lie:
 *
 *   higher-is-better  up is the good direction. `score`, `survived`.
 *   lower-is-better   down is the good direction. `deathsExhaustion`,
 *                     `worstWallMs`, `place`, `illegal`.
 *   contextual        THE DIRECTION IS NOT A VERDICT. Engagement counters
 *                     (`wasmRuns`: running is not helping), shape counters
 *                     (`turns`, `capRate`: a drift signal, not a win or a
 *                     loss), audit stamps (`workers`: which arm ran), and
 *                     genuinely two-sided quantities. A `contextual` metric
 *                     outside the null band is REAL and is recorded — it just
 *                     does not get scored into a direction, and the ingest
 *                     files it as `outside-null-unscored` rather than guessing.
 *
 * `contextual` is not a dumping ground for the undecided. It is a refusal, and
 * it is the same refusal the ledger already makes about families: a number that
 * moved is not the same thing as a number that moved the right way, and the
 * loop would rather say "I cannot score this" than score it backwards. Adding a
 * metric with a real direction to the wrong bucket costs a verdict; adding one
 * to `contextual` costs only a row that has to be read by a human.
 *
 * ── THE OVERRIDE ───────────────────────────────────────────────────────────
 *
 * A flag's own `promotionMetrics[].lowerIsBetter` / `.polarity` wins over this
 * table. The batch-1 fold declared `lowerIsBetter: true` on the affected gates
 * before any code read it, precisely so this fix would be a lookup rather than
 * a re-derivation; `polarityOf` honours it.
 */

const HIGHER = 'higher-is-better';
const LOWER = 'lower-is-better';
const CONTEXTUAL = 'contextual';

const POLARITIES = [HIGHER, LOWER, CONTEXTUAL];

/**
 * THE TABLE. Keys are metric names as the extractor emits them AND as flags
 * name them in `promotionMetrics` — the two vocabularies overlap but neither
 * contains the other, and a gate metric with no polarity is exactly as
 * dangerous as an extracted one.
 */
const METRIC_POLARITY = {
  // ── outcome ────────────────────────────────────────────────────────────
  score: HIGHER,
  win: HIGHER,
  place: LOWER, // place 1 is first. Improving means going DOWN.
  finalMaterial: HIGHER,
  finalUnits: HIGHER,
  survived: HIGHER,

  // ── game shape. A shape change with null placement is a finding to
  //    investigate, not a win or a loss — see the ledger's `shape` family. ──
  turns: CONTEXTUAL,
  decisive: CONTEXTUAL,
  capped: CONTEXTUAL,
  capRate: CONTEXTUAL,

  // ── mechanism: costs and faults. Down is good, always. ─────────────────
  worstWallMs: LOWER,
  clusterEnumMs: LOWER,
  overrunRate: LOWER,
  unstagedRate: LOWER,
  stagedNothingRate: LOWER,
  assumptionRate: LOWER,
  ratchetRate: LOWER,
  scoutRefusals: LOWER,
  wasmRefused: LOWER,

  // ── deaths by cause. THE CHANNEL THAT FAILED CENTAUR_CLUSTER_SEED. ─────
  deathsSelf: LOWER,
  deathsTeammate: LOWER,
  deathsWall: LOWER,
  deathsExhaustion: LOWER,
  fatalStagings: LOWER,
  teammateKills: LOWER,

  // ── soundness. A law the layer owes; nonzero is a failure at any n. ────
  refineInverted: LOWER,
  boundsInversions: LOWER,
  boundsInversions_RETIRED: LOWER,
  inversionStorm: LOWER,
  illegal: LOWER,
  errors: LOWER,

  // ── engagement. DID THE ARM RUN. Running is not helping, so the
  //    direction of an engagement counter is never a verdict. ────────────
  wasmRuns: CONTEXTUAL,
  clusterJoints: CONTEXTUAL,
  selectionDraws: CONTEXTUAL,
  selectionFar: CONTEXTUAL,
  refineMovedLo: CONTEXTUAL,
  scoutPlies: CONTEXTUAL,
  scoutThreads: CONTEXTUAL,
  postContactPlies: CONTEXTUAL,
  ceilingDecided: CONTEXTUAL,
  proposalsPriced: CONTEXTUAL,
  decisions: CONTEXTUAL,
  admissionRate: CONTEXTUAL,

  // ── eats. More staged uncontested meals is the mechanism's whole claim. ─
  mealsEaten: HIGHER,
  uncontestedMealsStaged: HIGHER,
  throughput: HIGHER,

  // ── bound floors. A floor that rose is a tighter bound OR a more timid
  //    one depending on which side of the emission it is read from; the
  //    ledger has never settled it, so it is not scored. ─────────────────
  rungZeroFloor: CONTEXTUAL,
  finalFloor: CONTEXTUAL,

  // ── RETIRED: budget-noise dominated, never a verdict on a live arm. ────
  plansEvaluated: CONTEXTUAL,
  plansEvaluated_RETIRED: CONTEXTUAL,

  // ── audit stamps: which arm actually ran. A magnitude here is an
  //    identifier, not a measurement. ─────────────────────────────────────
  matchSeed: CONTEXTUAL,
  workers: CONTEXTUAL,
  tierTruth: CONTEXTUAL,
  stagingSafety: CONTEXTUAL,
  gainOrdering: CONTEXTUAL,
};

/**
 * The polarity to score `metric` by, honouring a flag gate's own declaration.
 *
 * `gate` is the flag's `promotionMetrics` entry. It may carry either
 * `polarity: 'lower-is-better'` or the older boolean `lowerIsBetter: true`
 * that the batch-1 fold wrote before anything read it. Both win over the table,
 * because a flag knows its own gate better than a shared vocabulary does.
 *
 * An UNKNOWN metric is `contextual`, never a guess. The selftest asserts the
 * table is total over the corpus, so `contextual`-by-omission is a
 * belt-and-braces default rather than the normal path.
 */
function polarityOf(metric, gate = null) {
  if (gate) {
    if (POLARITIES.includes(gate.polarity)) return gate.polarity;
    if (gate.lowerIsBetter === true) return LOWER;
    if (gate.lowerIsBetter === false) return HIGHER;
  }
  return METRIC_POLARITY[metric] ?? CONTEXTUAL;
}

/** Does a delta of `mean` on this polarity favour the treatment? */
function favours(mean, polarity) {
  if (typeof mean !== 'number' || polarity === CONTEXTUAL) return null;
  return polarity === LOWER ? mean < 0 : mean > 0;
}

/**
 * SCORE ONE READABLE DELTA. The whole of the polarity fix, in one place, so
 * the ingest and the selftest cannot disagree about what a number means.
 *
 *   `null`                   inside the batch's own A/A floor.
 *   `supports-promotion`     outside it, in the metric's good direction.
 *   `failed`                 outside it, in the metric's bad direction.
 *   `outside-null-unscored`  outside it, on a metric whose direction is not a
 *                            verdict. Recorded, and it moves nothing — see
 *                            applyMeasurement.
 */
function scoreVerdict({ mean, outsideNull, metric, gate = null }) {
  if (outsideNull !== true) return 'null';
  const polarity = polarityOf(metric, gate);
  const good = favours(mean, polarity);
  if (good === null) return 'outside-null-unscored';
  return good ? 'supports-promotion' : 'failed';
}

/**
 * Assert the table is TOTAL over a set of metric names, and return the ones it
 * misses. The selftest runs this over `extract.METRIC_KEYS` and over every
 * gate metric every flag names: a counter that reaches the scorer with no
 * declared polarity is the defect this file exists to close, reopening itself.
 */
function missingFrom(names) {
  return [...new Set(names)].filter((n) => METRIC_POLARITY[n] === undefined).sort();
}

module.exports = {
  HIGHER,
  LOWER,
  CONTEXTUAL,
  POLARITIES,
  METRIC_POLARITY,
  polarityOf,
  favours,
  scoreVerdict,
  missingFrom,
};
