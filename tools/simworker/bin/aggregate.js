#!/usr/bin/env node
/*
 * PAIRED AGGREGATION — turn two arms' manifests into a defensible table.
 *
 *   node tools/simworker/bin/aggregate.js --batch <batch-dir> [--base <arm>]
 *        [--subject <bot>] [--out <file.json>] [--md <file.md>]
 *
 * Reads every arm under <batch-dir>/arms/*, pairs them game for game, and
 * reports paired deltas with intervals computed over BLOCKS.
 *
 * ── THE STATISTICAL UNIT IS THE BLOCK, NOT THE GAME ────────────────────────
 *
 * Board geometry is not symmetric. On a three-team board the anchors are three
 * corners: two seats share a column, two share a row, and one pair sits on the
 * long diagonal. A bot measured only in seat 0 is measured on one geometry.
 *
 * So a seed contributes a BLOCK of N games — one per cyclic seat rotation —
 * which puts every bot in every seat once AND gives every unordered pair of
 * bots every seat-pair once. Seat advantage and adjacency advantage both cancel
 * INSIDE a block and not inside a single game. Treating games as independent
 * would divide the standard error by roughly sqrt(N) for free and manufacture
 * significance out of seat geometry. Every interval below is therefore over
 * block means, and `n` is the number of SEEDS.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 *
 * It will not compare arms whose games are not the same games. Before any
 * statistic it checks, game for game, that the configHash and the seat
 * assignment match across arms, and it drops — loudly — any gameId that is not
 * present in every arm. A pairing that is not exact is not a pairing.
 *
 * ── THE OBJECTIVE IS `sharePar`, NOT A PLACEMENT ───────────────────────────
 *
 * Owner ruling, 2026-08-29. The cross-game metric this program optimizes is
 *
 *     sharePar = (team's share of total weight owned at game end) × (teams)
 *
 * Par is 1. A team holding its fair share of the board scores exactly 1
 * whether the cell had two teams or four, which is what makes the column
 * COMMENSURATE ACROSS TEAM COUNTS and poolable across a sweep, and it is
 * CONTINUOUS IN THE WEIGHT MARGIN — a one-point lead and a thirty-point lead
 * are different numbers, and a narrow loss is not scored like a wipe-out.
 *
 * `score`, the harness's normalized placement, is none of those things. It is a
 * rank, it steps at rank boundaries, it pays a clean 2nd of 3 half a point on a
 * scale a 2-team cell does not share, and it is blind to margin. It stays —
 * every prior finding in this program is denominated in it, and it is the more
 * sensitive instrument for a small ordering change — but it is NOT the
 * objective. When `sharePar` and `score` disagree, `sharePar` is the one the
 * program is optimizing.
 *
 * `win` (P(first)) is likewise a rank reading and likewise not the objective.
 * It is kept because existing analyses and ledger rows resolve it; do not
 * promote it to a headline.
 *
 * ── RETIRED COUNTERS ───────────────────────────────────────────────────────
 *
 * `plansEvaluated` and `boundsInversions` are reported but marked RETIRED. At
 * short budgets both are dominated by how much CPU the process happened to get,
 * so a difference in them between two arms is a difference in machine weather
 * unless the budget is long and the box is otherwise idle. They are kept
 * because they diagnose a broken arm; they are not evidence for a verdict.
 * See context/METHODOLOGY.md §5.
 *
 * ── IT DOES NOT GUESS WHICH BOT IT IS MEASURING ────────────────────────────
 *
 * Two defects fixed 20260831, both found by the batch-2 ingest and both
 * reproduced here as regressions in `bin/selftest.js` §3-§4.
 *
 * A. THE SUBJECT SEAT, AND THE SIGN INVERSION. The old fallback read
 *    `seats` off ONE game — the first gameId of the base arm — and took the
 *    first `lobster*` in it. `manifest.jsonl` is written in COMPLETION order
 *    by a worker pool and the harness rotates seats between games, so that is
 *    a race, and on a spec seating two lobster contenders it can land on the
 *    UNTREATED one. On batch 2's P7F it did: the treatment reaches
 *    `lobster-territory` only, the fallback chose `lobster-material`, and
 *    because these boards are near zero-sum the untreated seat reported
 *    sharePar **+0.4588** on `headline-mix-king` where the treated bot took
 *    **−0.4588**. Same magnitude, OPPOSITE SIGN, no error, no warning.
 *    A silent wrong answer of that size is worse than no answer.
 *
 *    So the subject is now DERIVED or DECLARED, never guessed:
 *      1. `--subject-map <arm>=<bot>` if it names the arm, else `--subject`;
 *      2. else, if the sweep seats exactly one candidate contender, that one;
 *      3. else, if exactly one candidate seat's RESOLVED STAMP differs between
 *         the arms, that seat is the treated one — derived from the data, and
 *         printed so the reader can check it;
 *      4. else it REFUSES, names the candidates and prints the spelling that
 *         fixes it. A whole-bundle pair treats both seats, so which one is
 *         read is a real analysis choice and the operator makes it.
 *
 * B. A BASE ARM THAT NEVER RAN THIS SWEEP. `--base` names ONE arm for the
 *    whole batch, but a batch holds several sweeps and no arm is in all of
 *    them — N0 in particular floors every board and shares no arm with any
 *    treatment. The integrity gate already fell back to `present[0]`; the
 *    delta loop did not, and `byArm.get(baseName)` was undefined:
 *    `TypeError: Cannot read properties of undefined (reading 'get')` at what
 *    was line 531. The base is now resolved PER SWEEP, reported per sweep, and
 *    the markdown labels each delta column with the base it was actually taken
 *    against rather than with the one the command line asked for.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ------------------------------------------------------------- statistics

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const round = (x, d = 4) => (x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

/** Two-sided 95% t multipliers, df = n-1. Beyond 30, 1.96 is close enough. */
const T95 = {
  2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306,
  10: 2.262, 11: 2.228, 12: 2.201, 13: 2.179, 14: 2.160, 15: 2.145, 16: 2.131,
  17: 2.120, 18: 2.110, 19: 2.101, 20: 2.093, 21: 2.086, 22: 2.080, 23: 2.074,
  24: 2.069, 25: 2.064, 26: 2.060, 27: 2.056, 28: 2.052, 29: 2.048, 30: 2.045,
};

/**
 * Mean of block means with a t-based 95% interval.
 *
 * Returns a null interval rather than a zero-width one when there is a single
 * block. An interval that cannot be computed is not an interval of width zero,
 * and rendering it as `[x, x]` is how a one-seed pilot ends up quoted as a
 * result.
 */
function blockCI(blockMeans) {
  const n = blockMeans.length;
  if (n === 0) return { mean: null, lo: null, hi: null, n: 0, sd: null };
  const m = mean(blockMeans);
  if (n === 1) return { mean: round(m), lo: null, hi: null, n: 1, sd: null };
  const varr = blockMeans.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(varr);
  const t = T95[Math.min(n, 30)] ?? 1.96;
  const half = (t * sd) / Math.sqrt(n);
  return { mean: round(m), lo: round(m - half), hi: round(m + half), n, sd: round(sd) };
}

/** Paired bootstrap over BLOCKS. Deterministic seed so a rerun agrees. */
function bootstrapCI(blockMeans, iterations = 10_000, seed = 0x5eed) {
  const n = blockMeans.length;
  if (n < 2) return { lo: null, hi: null };
  let s = seed >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x1_0000_0000; };
  const draws = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    let acc = 0;
    for (let j = 0; j < n; j++) acc += blockMeans[Math.floor(rnd() * n)];
    draws[i] = acc / n;
  }
  const sorted = Array.from(draws).sort((a, b) => a - b);
  return { lo: round(sorted[Math.floor(0.025 * iterations)]), hi: round(sorted[Math.floor(0.975 * iterations)]) };
}

// ------------------------------------------------------------------- args

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const flag = (n) => process.argv.includes(`--${n}`);

const batchDir = path.resolve(arg('batch', ''));
if (arg('batch', '') === '') {
  console.error('usage: aggregate.js --batch <batch-dir> [--base <arm>] [--subject <bot>]');
  console.error('                    [--subject-map <arm>=<bot>,<arm>=<bot>] [--out f.json] [--md f.md]');
  process.exit(1);
}

/*
 * DECLARED SUBJECT SUBSTITUTION.
 *
 * Most pairs differ by BUILD or by ENV, and every seat holds the same bot name
 * in both arms. One family does not: a profile that exists only behind
 * `TeamDecisionOptions.evaluate` — I2's slider is the live example — has no env
 * flag and no config field, so the only way to run it is to seat a different
 * BOT NAME in the subject seat. The two arms then legitimately differ in their
 * seat lists, and the strict integrity gate below would reject the pair.
 *
 * `--subject-map base=lobster-territory,treat=lobster-slider` declares that
 * substitution. The gate then compares seat lists with each arm's own subject
 * name rewritten to a common token, so EVERY OTHER SEAT must still match
 * exactly — the field is still held fixed, and a second, undeclared difference
 * still fails.
 *
 * It has to be declared rather than inferred. Inferring "these two bots are the
 * same seat" from position alone would silently pair a cell whose field had
 * drifted, which is the exact failure the gate exists to catch.
 */
const SUBJECT_MAP = new Map();
for (const pair of (arg('subject-map', '') || '').split(',').filter(Boolean)) {
  const j = pair.indexOf('=');
  if (j <= 0) { console.error(`--subject-map entry "${pair}" is not <arm>=<bot>`); process.exit(1); }
  SUBJECT_MAP.set(pair.slice(0, j), pair.slice(j + 1));
}
const SUBJECT_TOKEN = '<SUBJECT>';
const seatKey = (row, armName) => {
  const subj = SUBJECT_MAP.get(armName);
  return row.seats.map((s) => `${s.seat}:${s.bot === subj ? SUBJECT_TOKEN : s.bot}`).join(',');
};

// ------------------------------------------------------------------- load

const armsRoot = path.join(batchDir, 'arms');
if (!fs.existsSync(armsRoot)) {
  console.error(`no arms directory at ${armsRoot} — is that a batch made by run-pair.js?`);
  process.exit(1);
}

/** Every arm dir holds one dir per sweepId; a batch may hold several sweeps. */
function loadArms() {
  const arms = new Map();
  for (const armName of fs.readdirSync(armsRoot).sort()) {
    const armDir = path.join(armsRoot, armName);
    if (!fs.statSync(armDir).isDirectory()) continue;
    const sweeps = new Map();
    for (const sweepId of fs.readdirSync(armDir)) {
      const mp = path.join(armDir, sweepId, 'manifest.jsonl');
      if (!fs.existsSync(mp)) continue;
      const rows = fs.readFileSync(mp, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      sweeps.set(sweepId, rows);
    }
    if (sweeps.size === 0) continue;
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(armDir, 'arm.json'), 'utf8')); } catch { /* unstamped */ }
    arms.set(armName, { sweeps, meta });
  }
  return arms;
}

const arms = loadArms();
if (arms.size < 2) {
  console.error(`found ${arms.size} arm(s) with manifests under ${armsRoot}; paired aggregation needs 2 or more.`);
  process.exit(1);
}

const armNames = [...arms.keys()];
const baseName = arg('base', armNames[0]);
if (!arms.has(baseName)) {
  console.error(`--base "${baseName}" is not one of: ${armNames.join(', ')}`);
  process.exit(1);
}

// --------------------------------------------------------------- metrics

/*
 * ── SCORING AN OLD BATCH UNDER THE OBJECTIVE ───────────────────────────────
 *
 * A manifest written before 2026-08-29 carries no `sharePar` and no
 * `adjudicatedMaterial`. It DOES carry every team's `finalMaterial`, and on
 * every end kind but one that IS the weight the share is taken over — the
 * winner branches read the final board too. So the objective is recoverable
 * for an old batch rather than lost, and this recomputes it here from exactly
 * the quantity the harness would have used.
 *
 * The one exception is a MUTUAL FINAL WIPE, where TacticToes adjudicates on
 * the previous committed turn and every team's `finalMaterial` is the zero a
 * dead team carries. The fallback scores those games a flat draw at par, which
 * is wrong, and the previous turn's weights are not in the manifest to fix it
 * with. So they are NAMED — `mutualWipeGapOf` below lists them per arm as an
 * integrity problem — rather than silently absorbed into a mean. They are the
 * only rows the fallback gets wrong; the rest of the batch is exact.
 *
 * (Naming beats dropping the column. Batch 20260827-overnight holds 3 such
 * games in 2,592, all in P7, and backfilling them from the replays moves no
 * cell's delta past the third decimal. Refusing to score the batch at all
 * would have lost 2,589 correct rows to protect 3.)
 */
const adjudicatedOf = (r) =>
  r.adjudicatedMaterial === undefined || r.adjudicatedMaterial === null
    ? r.finalMaterial
    : r.adjudicatedMaterial;

/** The objective, recomputed from a row. Same formula as `placementsOf`. */
function shareParOf(row, res) {
  const teams = row.results.length;
  if (teams === 0) return null;
  const total = row.results.reduce((a, r) => a + adjudicatedOf(r), 0);
  return total > 0 ? (teams * adjudicatedOf(res)) / total : 1;
}

/** Games whose sharePar the fallback above gets wrong, and only those. */
function mutualWipeGapOf(rows) {
  return rows
    .filter((r) => r.endKind === 'all-eliminated')
    .filter((r) => r.results.every((x) => x.sharePar === undefined || x.sharePar === null))
    .filter((r) => r.results.every((x) => x.adjudicatedMaterial === undefined || x.adjudicatedMaterial === null))
    .map((r) => r.gameId);
}

/**
 * Per-game metrics for ONE bot's seat.
 *
 * `sharePar` is THE OBJECTIVE (see the header) and the row to read first. The
 * rank readings sit beside it. The rest are MECHANISM: they describe what the
 * engine did, not who won, and they move first and move cleaner.
 */
function metricsFor(row, subjectBot) {
  const res = row.results.find((r) => r.bot === subjectBot);
  const h = row.health.find((x) => x.bot === subjectBot);
  if (res === undefined) return null;
  const decisions = h ? h.decisions : 0;
  const per = (x) => (decisions > 0 ? x / decisions : null);
  return {
    // --- outcome ---------------------------------------------------------
    // `sharePar` is THE OBJECTIVE (see the header). `score`, `win` and `place`
    // are rank readings kept for continuity with every earlier finding.
    //
    // The harness stamps `sharePar` on every row it writes. On a manifest from
    // before 2026-08-29 it is recomputed from the per-team end weights the row
    // does carry — see the note above `adjudicatedOf`, and the integrity
    // problem that names the mutual wipes that recomputation cannot reach.
    sharePar: res.sharePar ?? shareParOf(row, res),
    score: res.score,
    win: res.place === 1 ? 1 : 0,
    place: res.place,
    finalMaterial: res.finalMaterial,
    finalUnits: res.finalUnits,
    survived: res.eliminatedOnTurn === null ? 1 : 0,
    // --- game shape ----------------------------------------------------
    turns: row.turns,
    decisive: row.terminal === 'decisive' ? 1 : 0,
    // --- mechanism (primary; see METHODOLOGY §3) ------------------------
    decisions,
    worstWallMs: h ? h.worstWallMs : null,
    overrunRate: h ? per(h.overruns) : null,
    unstagedRate: h ? per(h.unstaged) : null,
    stagedNothingRate: h ? per(h.stagedNothing) : null,
    assumptionRate: h ? per(h.assumptions) : null,
    ratchetRate: h ? per(h.ratchetRefusals) : null,
    // --- deaths by cause (CL7) ------------------------------------------
    // P7's verdict lives here and nowhere else: CENTAUR_CLUSTER_SEED passed a
    // deterministic fatal-staging gate and lost snake6 1.00 -> 0.15 live with
    // EXHAUSTION deaths x1.9. A gate that cannot see travel economy is a gate
    // measuring the wrong thing.
    deathsSelf: h ? h.deathsSelf ?? null : null,
    deathsWall: h ? h.deathsWall ?? null : null,
    deathsExhaustion: h ? h.deathsExhaustion ?? null : null,
    deathsBodyBlock: h ? h.deathsBodyBlock ?? null : null,
    deathsContest: h ? h.deathsContest ?? null : null,
    deathsTeammate: h ? h.deathsTeammate ?? null : null,
    // --- mechanism, engine-side (CL7) -----------------------------------
    // Null on every bundle built before the CL7 telemetry closure, and null
    // rather than zero on purpose: a counter a build never had did not read
    // zero. `wasmRuns` is the ENGAGEMENT row — the wasm arm is refused per
    // partition, silently, so an arm can be `on` and do nothing, and P5's null
    // could equally have meant it never ran.
    wasmRuns: h && h.mechanism ? h.mechanism.wasmRuns : null,
    wasmRefused: h && h.mechanism ? h.mechanism.wasmRefused : null,
    clusterJoints: h && h.mechanism ? h.mechanism.clusterJoints : null,
    clusterEnumMs: h && h.mechanism ? h.mechanism.clusterEnumMs : null,
    selectionFar: h && h.mechanism ? h.mechanism.selectionFar : null,
    selectionDraws: h && h.mechanism ? h.mechanism.selectionDraws : null,
    refineMovedLo: h && h.mechanism ? h.mechanism.refineMovedLo : null,
    refineInverted: h && h.mechanism ? h.mechanism.refineInverted : null,
    scoutThreads: h && h.mechanism ? h.mechanism.scoutThreads : null,
    scoutPlies: h && h.mechanism ? h.mechanism.scoutPlies : null,
    scoutRefusals: h && h.mechanism ? h.mechanism.scoutRefusals : null,
    ceilingDecided: h && h.mechanism ? h.mechanism.ceilingDecided : null,
    // THE REST OF THE ADJUDICATION LADDER. `est` is the ONLY channel an
    // advisory lineup has, and it is the fifth rung: a comparison the witness
    // veto, an incomparable basis, the depth rung or the floor already
    // settled never looks at it. Without these four beside `estDecided` a
    // null from a slate arm cannot be told from a slate the comparator never
    // consulted.
    estDecided: h && h.mechanism ? h.mechanism.estDecided ?? null : null,
    floorDecided: h && h.mechanism ? h.mechanism.floorDecided ?? null : null,
    depthDecided: h && h.mechanism ? h.mechanism.depthDecided ?? null : null,
    tieKeyDecided: h && h.mechanism ? h.mechanism.tieKeyDecided ?? null : null,
    vetoed: h && h.mechanism ? h.mechanism.vetoed ?? null : null,
    refused: h && h.mechanism ? h.mechanism.refused ?? null : null,
    // THE ADVISORY LINEUP'S OWN ROWS — engagement and truncation, which are
    // the two ways a lineup fails to matter and have different repairs.
    advisoryEvaluations: h && h.mechanism ? h.mechanism.advisoryEvaluations ?? null : null,
    advisoryEngaged: h && h.mechanism ? h.mechanism.advisoryEngaged ?? null : null,
    advisoryClamped: h && h.mechanism ? h.mechanism.advisoryClamped ?? null : null,
    advisoryMeanAsked: h && h.mechanism ? h.mechanism.advisoryMeanAsked ?? null : null,
    advisoryMeanApplied: h && h.mechanism ? h.mechanism.advisoryMeanApplied ?? null : null,
    advisoryMeanWidth: h && h.mechanism ? h.mechanism.advisoryMeanWidth ?? null : null,
    // --- integrity (must be zero) --------------------------------------
    illegal: h ? h.illegal : null,
    errors: h ? h.errors : null,
    // --- RETIRED: budget-noise dominated at short budgets ---------------
    plansEvaluated_RETIRED: h ? h.plansEvaluated : null,
    boundsInversions_RETIRED: h ? h.boundsInversions : null,
  };
}

const METRIC_KEYS = [
  'sharePar', 'score', 'win', 'place', 'finalMaterial', 'finalUnits', 'survived',
  'turns', 'decisive',
  'decisions', 'worstWallMs', 'overrunRate', 'unstagedRate', 'stagedNothingRate',
  'assumptionRate', 'ratchetRate',
  'deathsSelf', 'deathsWall', 'deathsExhaustion', 'deathsBodyBlock',
  'deathsContest', 'deathsTeammate',
  'wasmRuns', 'wasmRefused', 'clusterJoints', 'clusterEnumMs',
  'selectionFar', 'selectionDraws', 'refineMovedLo', 'refineInverted',
  'scoutThreads', 'scoutPlies', 'scoutRefusals', 'ceilingDecided',
  'estDecided', 'floorDecided', 'depthDecided', 'tieKeyDecided', 'vetoed', 'refused',
  'advisoryEvaluations', 'advisoryEngaged', 'advisoryClamped',
  'advisoryMeanAsked', 'advisoryMeanApplied', 'advisoryMeanWidth',
  'illegal', 'errors',
  'plansEvaluated_RETIRED', 'boundsInversions_RETIRED',
];

/**
 * THE ARM AUDIT — the resolved BOT, per arm.
 *
 * Not a metric and not differenced: it is the answer to "was this actually the
 * treatment arm?". The spec says what was ASKED for; this is what the engine
 * RESOLVED, and when they disagree this one is the arm.
 *
 * TWO SHAPES, ON PURPOSE. A bundle built after the flag teardown of 2026-08-29
 * carries `mechanism.config` — the resolved `BotConfig`, plus the five
 * search-layer flags that had not been torn out yet. A bundle from before it
 * carries `mechanism.flags`, the old resolved-flag stamp. Both are read,
 * because batch 1's arms are the older shape and their rows still have to
 * aggregate. Absent on bundles from before the CL7 telemetry closure, which is
 * a third state and reported as one.
 */
function flagStampOf(rows) {
  for (const r of rows) {
    for (const h of r.health ?? []) {
      const stamp = (h.mechanism && (h.mechanism.config || h.mechanism.flags)) || null;
      if (stamp === null) continue;
      // THE SLATE IS PART OF THE ARM. It is stamped beside the config rather
      // than inside it, so a reader of the audit table would otherwise see a
      // `potion-aware` arm and a `legacy` arm as the same bot.
      const slate = h.mechanism.slate;
      return typeof slate === 'string' ? { ...stamp, slate } : stamp;
    }
  }
  return null;
}

/** The resolved stamp PER SEAT — `bot -> config`, first row that carries one. */
function stampsByBot(rows) {
  const out = {};
  for (const r of rows) {
    for (const h of r.health ?? []) {
      if (out[h.bot] !== undefined) continue;
      const m = h.mechanism;
      if (m && (m.config || m.flags)) out[h.bot] = m.config ?? m.flags;
    }
  }
  return out;
}

// ------------------------------------------------- the subject seat, derived

/**
 * THE CANDIDATE SUBJECTS SEATED IN A SWEEP, over EVERY row of EVERY arm.
 *
 * Deliberately not `rows[0].seats`: the manifest is written in completion
 * order by a pool of workers and the harness rotates seats between games, so
 * the first row is a race and the two arms of one pair routinely begin with
 * different bots in seat 0. See defect A in the header.
 */
function subjectCandidatesOf(rowsLists) {
  const bots = new Set();
  for (const rows of rowsLists) for (const r of rows) for (const s of r.seats ?? []) bots.add(s.bot);
  const all = [...bots].sort();
  const lobsters = all.filter((b) => b.startsWith('lobster'));
  return lobsters.length > 0 ? lobsters : all;
}

/**
 * WHICH CANDIDATE SEAT DID THE TREATMENT ACTUALLY REACH?
 *
 * Read off the engines' own resolved stamps rather than off the spec: for each
 * candidate seat, compare its stamp across the arms. A config arm changes
 * exactly one seat, and that seat is the subject — derived from the data, not
 * assumed from a name. Returns null when zero or more than one seat differs,
 * which is the honest answer for a WHOLE-BUNDLE pair: there both seats carry a
 * different build, both are legitimately readable, and choosing between them is
 * an analysis decision the operator has to make and record.
 */
function treatedSeatFrom(stampsPerArm, candidates) {
  const differing = [];
  for (const c of candidates) {
    const seen = stampsPerArm.map((s) => s[c]).filter((x) => x !== undefined);
    if (seen.length < 2) continue; // not stamped on both sides — cannot say
    const keys = new Set(seen.flatMap((v) => Object.keys(v)));
    let differs = false;
    for (const k of keys) {
      if (k === 'name') continue; // the contender's own label, not a setting
      if (new Set(seen.map((v) => JSON.stringify(v[k] ?? null))).size > 1) differs = true;
    }
    if (differs) differing.push(c);
  }
  return differing.length === 1 ? differing[0] : null;
}

// ------------------------------------------------------------- pairing

const report = { batch: path.basename(batchDir), base: baseName, generatedAt: new Date().toISOString(), sweeps: [] };
const problems = [];

const allSweepIds = new Set();
for (const { sweeps } of arms.values()) for (const id of sweeps.keys()) allSweepIds.add(id);

/*
 * PRE-PASS: the subject seat and the base arm, PER SWEEP, resolved before a
 * single statistic is computed — because the failure mode both of these guard
 * is a silent wrong number, and a wrong number that took ten minutes to
 * produce is no better than one that took none. If any sweep cannot resolve
 * its subject, the whole run refuses and prints every unresolved sweep at
 * once, so the operator fixes them in one edit rather than one per run.
 */
const resolution = new Map(); // sweepId -> { base, subjectFor, subjectHow, candidates }
const refusals = [];
for (const sweepId of [...allSweepIds].sort()) {
  const present = armNames.filter((a) => arms.get(a).sweeps.has(sweepId));
  if (present.length < 2) continue;
  // DEFECT B. `--base` names one arm for the batch; a batch holds several
  // sweeps and no arm is in all of them. Resolve the base PER SWEEP.
  const base = present.includes(baseName) ? baseName : present[0];
  const rowsOf = (a) => arms.get(a).sweeps.get(sweepId);
  const candidates = subjectCandidatesOf(present.map(rowsOf));
  const declaredFor = (a) => SUBJECT_MAP.get(a) ?? (arg('subject', '') || null);
  let derived = null;
  let how = null;
  if (candidates.length === 1) {
    derived = candidates[0];
    how = `the only contender seated in this sweep`;
  } else {
    derived = treatedSeatFrom(present.map((a) => stampsByBot(rowsOf(a))), candidates);
    if (derived !== null) how = `the one candidate seat whose RESOLVED STAMP differs between arms`;
  }
  const subjectFor = (a) => declaredFor(a) ?? derived;
  if (present.some((a) => subjectFor(a) === null)) {
    refusals.push(
      `sweep ${sweepId}: seats ${candidates.length} candidate contenders and NO ONE of them is ` +
        `the treated seat — no candidate's resolved stamp differs between these arms, so they ` +
        `differ by BUILD and every candidate seat is equally treated. Which one is read is an ` +
        `analysis choice, not a fact in the data. Pick one and say so:\n` +
        candidates.map((c) => `           --subject ${c}`).join('\n') +
        `\n       or, if the arms deliberately seat different subject bots,\n` +
        `           --subject-map ${present.map((a) => `${a}=<bot>`).join(',')}`
    );
    continue;
  }
  if (declaredFor(present[0]) !== null) how = 'DECLARED on the command line';
  resolution.set(sweepId, { base, subjectFor, subjectHow: how, candidates });
}

if (refusals.length > 0) {
  console.error('aggregate.js REFUSES TO GUESS WHICH BOT IT IS MEASURING.');
  console.error('');
  console.error('The subject seat is the contender whose rows become the numbers. Choosing it by');
  console.error('reading one game\'s seat list is a lottery — the manifest is in completion order and');
  console.error('the seats rotate — and on a near-zero-sum board picking the UNTREATED lobster');
  console.error('returns the treatment\'s effect with the SIGN REVERSED and no warning. That is what');
  console.error('happened on 20260831-batch2 P7F: +0.4588 reported where the truth was -0.4588.');
  console.error('');
  for (const r of refusals) console.error(`  ${r}`);
  console.error('');
  process.exit(3);
}

for (const sweepId of [...allSweepIds].sort()) {
  const present = armNames.filter((a) => arms.get(a).sweeps.has(sweepId));
  if (present.length < 2) {
    problems.push(`sweep ${sweepId}: only ${present.length} arm(s) ran it — not pairable, skipped`);
    continue;
  }
  const { base: sweepBase, subjectFor, subjectHow } = resolution.get(sweepId);
  if (sweepBase !== baseName) {
    problems.push(
      `sweep ${sweepId}: the requested base arm "${baseName}" did not run it, so deltas here are ` +
        `taken against "${sweepBase}" instead. Every column below says which base it used.`
    );
  }

  const byArm = new Map(present.map((a) => [a, new Map(arms.get(a).sweeps.get(sweepId).map((r) => [r.gameId, r]))]));

  // THE sharePar GAP on an OLD BATCH — the one game shape the fallback cannot
  // score. Named per arm rather than dropped: every other row in the same cell
  // is exact, and dropping the cell would lose all of them to protect a few.
  const wipeGap = new Map();
  for (const a of present) {
    const g = mutualWipeGapOf(arms.get(a).sweeps.get(sweepId) ?? []);
    if (g.length > 0) wipeGap.set(a, g);
  }
  for (const [a, g] of wipeGap) {
    problems.push(
      `sweep ${sweepId}, arm ${a}: ${g.length} game(s) ended in a MUTUAL WIPE on a manifest ` +
      `predating sharePar, so the objective falls back to the final board — which is all ` +
      `zeroes there, and reads as a flat draw at par where the game awards the game on the ` +
      `PREVIOUS turn's weights. Not reconstructible from the manifest (the replays carry it); ` +
      `every other row in this sweep is exact. ` +
      `First few: ${g.slice(0, 5).join(', ')}${g.length > 5 ? ', …' : ''}`
    );
  }

  // INTEGRITY GATE. Same gameId must mean the same board and the same seats in
  // every arm, or the pairing is a fiction.
  const baseRows = byArm.get(sweepBase);
  const common = [];
  let dropped = 0;
  for (const [gameId, br] of baseRows) {
    let ok = true;
    for (const a of present) {
      const r = byArm.get(a).get(gameId);
      if (r === undefined) { ok = false; break; }
      if (r.configHash !== br.configHash) {
        problems.push(`${sweepId}/${gameId}: configHash differs (${sweepBase}=${br.configHash} ${a}=${r.configHash})`);
        ok = false; break;
      }
      const sa = seatKey(r, a);
      const sb = seatKey(br, sweepBase);
      if (sa !== sb) {
        problems.push(`${sweepId}/${gameId}: seats differ (${sweepBase}=${sb} ${a}=${sa})` +
          (SUBJECT_MAP.size === 0 ? ' — if the arms deliberately seat different subject bots, declare it with --subject-map' : ''));
        ok = false; break;
      }
    }
    if (ok) common.push(gameId); else dropped++;
  }
  for (const a of present) {
    for (const gameId of byArm.get(a).keys()) if (!baseRows.has(gameId)) dropped++;
  }

  if (common.length === 0) {
    problems.push(`sweep ${sweepId}: no gameId is present and consistent across all arms — nothing to pair`);
    continue;
  }

  // THE SUBJECT SEAT — declared or derived in the pre-pass above, never
  // guessed from one game's seat list. `subjectHow` says which, and it is
  // printed beside the numbers so a reader can check the choice rather than
  // inherit it.
  const subject = present.map((a) => `${a}:${subjectFor(a)}`).join(' ');

  const cells = new Map();
  for (const gameId of common) {
    const cell = baseRows.get(gameId).cell;
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(gameId);
  }

  const sweepOut = {
    sweepId,
    subject,
    // HOW the subject was chosen, and WHICH arm the deltas are against. Both
    // are recorded rather than assumed, because both were silent defaults that
    // produced silent wrong numbers before 20260831 (see the header).
    subjectHow,
    base: sweepBase,
    arms: present,
    gamesPaired: common.length,
    gamesDropped: dropped,
    // THE ARM AUDIT. What each arm's engine actually resolved, as opposed to
    // what its environment was set to. Null on bundles from before the CL7
    // telemetry closure — which is every batch through 20260827.
    flagStamps: Object.fromEntries(
      present.map((a) => [a, flagStampOf(arms.get(a).sweeps.get(sweepId) ?? [])])
    ),
    // Games whose sharePar this manifest cannot support: a mutual wipe on a
    // batch predating the column. Empty on anything run after 2026-08-29.
    shareParGapUnscoreable: Object.fromEntries([...wipeGap]),
    cells: [],
  };

  for (const [cell, gameIds] of [...cells].sort()) {
    const blocks = new Map();
    for (const gid of gameIds) {
      const b = baseRows.get(gid).block;
      if (!blocks.has(b)) blocks.set(b, []);
      blocks.get(b).push(gid);
    }

    const cellOut = {
      cell,
      games: gameIds.length,
      blocks: blocks.size,
      shape: (() => {
        const r = baseRows.get(gameIds[0]);
        return {
          size: r.size, teams: r.teamCount, unitsPerTeam: r.unitsPerTeam,
          budgetMs: r.budgetMs, turnCap: r.turnCap,
          food: r.foodSpawnRate, hazards: r.hazardLayout, potions: r.potions, fertile: r.fertile,
        };
      })(),
      levels: {},
      deltas: {},
      capRate: {},
    };

    // Per-arm LEVELS (mean over block means) — what each arm actually did.
    for (const a of present) {
      const perMetric = {};
      for (const k of METRIC_KEYS) {
        const blockMeans = [];
        for (const gids of blocks.values()) {
          const vals = gids.map((g) => {
            const m = metricsFor(byArm.get(a).get(g), subjectFor(a));
            return m ? m[k] : null;
          }).filter((v) => v !== null && v !== undefined);
          if (vals.length > 0) blockMeans.push(mean(vals));
        }
        perMetric[k] = blockCI(blockMeans);
      }
      cellOut.levels[a] = perMetric;
      const capped = gameIds.filter((g) => byArm.get(a).get(g).terminal === 'cap').length;
      cellOut.capRate[a] = round(capped / gameIds.length, 3);
    }

    // Paired DELTAS against THIS SWEEP's base arm (defect B: `--base` names an
    // arm for the batch, and no arm is in every sweep).
    for (const a of present) {
      if (a === sweepBase) continue;
      const perMetric = {};
      for (const k of METRIC_KEYS) {
        const blockMeans = [];
        for (const gids of blocks.values()) {
          const diffs = [];
          for (const g of gids) {
            const mb = metricsFor(byArm.get(sweepBase).get(g), subjectFor(sweepBase));
            const ma = metricsFor(byArm.get(a).get(g), subjectFor(a));
            if (mb && ma && mb[k] !== null && ma[k] !== null) diffs.push(ma[k] - mb[k]);
          }
          if (diffs.length > 0) blockMeans.push(mean(diffs));
        }
        const ci = blockCI(blockMeans);
        const boot = bootstrapCI(blockMeans);
        perMetric[k] = { ...ci, bootLo: boot.lo, bootHi: boot.hi, excludesZero: ci.lo !== null && (ci.lo > 0 || ci.hi < 0) };
      }
      cellOut.deltas[a] = perMetric;
    }

    sweepOut.cells.push(cellOut);
  }

  report.sweeps.push(sweepOut);
}

report.problems = problems;

// ------------------------------------------------------------------ output

const outJson = arg('out', path.join(batchDir, 'analysis.json'));
fs.writeFileSync(outJson, JSON.stringify(report, null, 1) + '\n');

// Markdown table
const md = [];
md.push(`# Paired aggregation — ${report.batch}`);
md.push('');
md.push(`Base arm requested: \`${baseName}\`. Generated ${report.generatedAt}.`);
md.push('');
md.push('Each sweep names the base it was **actually** taken against and how its **subject seat**');
md.push('was chosen. Neither is a default any more: a batch-level base arm is absent from some of');
md.push('its own sweeps, and a subject seat read off one game\'s seat list is a race that can');
md.push('return a treatment\'s effect with the sign reversed. See the header of `aggregate.js`.');
md.push('');
md.push('Intervals are 95% t over BLOCK means; `n` is the number of seeds. A delta whose');
md.push('interval includes zero is a NULL RESULT and must be written up as one.');
md.push('');
md.push('**Placement resolution.** At 16 blocks the normalized placement score resolves to');
md.push('roughly ±0.10. A |delta score| under that is not a small effect, it is no effect');
md.push('this design can see — read the mechanism rows instead.');
md.push('');
md.push('**`sharePar` IS THE OBJECTIVE.** Share of the total weight owned at game end, times');
md.push('the number of teams. Par is 1, so the column means the same thing on a 2-team cell and');
md.push('a 3-team one, and it moves CONTINUOUSLY with the weight margin. `score` is a rank: it');
md.push('steps at rank boundaries, is blind to margin, and its 0.5 on a 3-team cell has no');
md.push('counterpart on a 2-team one. Both are reported, because every earlier finding in this');
md.push('program is denominated in `score` — but when they disagree, `sharePar` is the one being');
md.push('optimized. `win` (P(first)) is a rank reading too; it is kept for continuity and is not');
md.push('a headline. On a batch run before 2026-08-29 the harness stamped no `sharePar`, so it is');
md.push('recomputed here from the per-team end weights those manifests do carry — exact on every');
md.push('end kind except a mutual final wipe, and the Integrity problems section names each of');
md.push('those games individually rather than letting it disappear into a mean.');
md.push('');
md.push('**The `sharePar` floor is not the `score` floor.** They are different units and do not');
md.push('convert. Measured on the 20260827 A/A null at 16 blocks, `sharePar` resolves to ±0.53');
md.push('on `headline-mix-king` and ±0.15 on `null-snake6`, against ±0.097 and ±0.032 for');
md.push('`score` — about 1.6-1.8x noisier once the two ranges are put on the same footing, so');
md.push('roughly 3x the blocks buy the same power. Read a sharePar delta against a sharePar');
md.push('floor from `verify-null.js`, never against a rank floor.');
md.push('');
md.push('**Read the arm audit first.** An arm can carry the name of a treatment and have run');
md.push('the baseline. The stamp table under each sweep is what the engine RESOLVED; the');
md.push('manifest\'s `contendersAtRun` (or, on a pre-teardown bundle, `envAtRun`) is what was');
md.push('asked for. When they disagree, the stamp is the arm. And a mechanism counter that');
md.push('stayed at zero on the treatment arm means the arm never engaged, which is a');
md.push('different finding from a null.');
md.push('');
md.push('Arms are CONFIGURED BOTS as of 2026-08-29: the engine\'s feature flags were removed,');
md.push('so a contender is a named `BotConfig` in the spec rather than an environment');
md.push('variable. Batch-1 rows predate that and carry the old flag stamp; both shapes are');
md.push('read here, and a stamp\'s own keys say which one a row is.');
md.push('');

for (const s of report.sweeps) {
  md.push(`## ${s.sweepId}`);
  md.push('');
  md.push(`Subject: \`${s.subject}\` · arms: ${s.arms.join(', ')} · paired ${s.gamesPaired} games` +
          (s.gamesDropped > 0 ? ` · **DROPPED ${s.gamesDropped} unpaired**` : ''));
  md.push('');
  md.push(`Base for these deltas: \`${s.base}\`` +
          (s.base !== baseName ? ` — **not the requested \`${baseName}\`, which did not run this sweep**` : '') +
          `. Subject seat chosen by: ${s.subjectHow}.`);
  md.push('');
  {
    const stamped = Object.entries(s.flagStamps ?? {}).filter(([, v]) => v !== null);
    if (stamped.length === 0) {
      md.push('*No arm stamp on this build — it predates the CL7 telemetry closure, so which');
      md.push('arm actually ran cannot be read off these rows. Check `contendersAtRun` (or,');
      md.push('on an older bundle, `envAtRun`) in the manifest*');
      md.push('*and treat any null here as engagement-unverified.*');
      md.push('');
    } else {
      const keys = [...new Set(stamped.flatMap(([, v]) => Object.keys(v)))].sort();
      md.push('**Arm audit** — the flags each engine RESOLVED:');
      md.push('');
      md.push(`| flag | ${stamped.map(([a]) => a).join(' | ')} |`);
      md.push(`|---|${stamped.map(() => '---').join('|')}|`);
      for (const k of keys) {
        const vals = stamped.map(([, v]) => String(v[k] ?? '—'));
        // Only rows that DIFFER between arms are interesting; a table of
        // identical rows buries the one line that matters.
        if (new Set(vals).size === 1) continue;
        md.push(`| \`${k}\` | ${vals.join(' | ')} |`);
      }
      md.push('');
    }
  }
  for (const c of s.cells) {
    md.push(`### cell \`${c.cell}\` — ${c.shape.size}x${c.shape.size}, ${c.shape.teams} teams x ${c.shape.unitsPerTeam}, ` +
            `${c.shape.budgetMs}ms, cap ${c.shape.turnCap}, food ${c.shape.food}, hazards ${c.shape.hazards}, potions ${c.shape.potions}`);
    md.push('');
    md.push(`${c.games} games in ${c.blocks} blocks. cap-terminal rate: ` +
            Object.entries(c.capRate).map(([a, r]) => `${a} ${r}`).join(', '));
    if (Object.values(c.capRate).some((r) => r > 0.5)) {
      md.push('');
      md.push('> **More than half of these games hit the turn cap.** A cell that mostly ends by');
      md.push('> running out of turns is measuring a stall, not play. Treat its placement rows as');
      md.push('> uninterpretable and raise the cap or shorten the board before rerunning.');
    }
    md.push('');
    const treatArms = Object.keys(c.deltas);
    md.push(`| metric | ${s.arms.map((a) => `${a} (level)`).join(' | ')} | ${treatArms.map((a) => `Δ ${a}−${s.base} [95% CI]`).join(' | ')} |`);
    md.push(`|---|${s.arms.map(() => '---').join('|')}|${treatArms.map(() => '---').join('|')}|`);
    for (const k of METRIC_KEYS) {
      const levels = s.arms.map((a) => fmt(c.levels[a][k]));
      const deltas = treatArms.map((a) => fmtDelta(c.deltas[a][k]));
      const label = k.endsWith('_RETIRED') ? `~~${k.replace('_RETIRED', '')}~~ (retired)` : k;
      md.push(`| ${label} | ${levels.join(' | ')} | ${deltas.join(' | ')} |`);
    }
    md.push('');
  }
}

if (problems.length > 0) {
  md.push('## Integrity problems');
  md.push('');
  md.push('These are not cosmetic. Each one is a game that could not be paired, which means');
  md.push('the table above is computed over fewer games than the batch played.');
  md.push('');
  for (const p of problems.slice(0, 50)) md.push(`- ${p}`);
  if (problems.length > 50) md.push(`- ...and ${problems.length - 50} more (see analysis.json)`);
  md.push('');
}

function fmt(ci) {
  if (!ci || ci.mean === null) return '—';
  return ci.lo === null ? `${ci.mean}` : `${ci.mean} [${ci.lo}, ${ci.hi}] n=${ci.n}`;
}
function fmtDelta(d) {
  if (!d || d.mean === null) return '—';
  if (d.lo === null) return `${d.mean} (n=1, no interval)`;
  return `**${d.mean}** [${d.lo}, ${d.hi}]${d.excludesZero ? ' ✱' : ''}`;
}

const outMd = arg('md', path.join(batchDir, 'analysis.md'));
fs.writeFileSync(outMd, md.join('\n') + '\n');

console.log(md.join('\n'));
console.log('');
console.log(`# json -> ${outJson}`);
console.log(`# md   -> ${outMd}`);
if (problems.length > 0) console.log(`# ${problems.length} integrity problem(s) — see the section above`);
