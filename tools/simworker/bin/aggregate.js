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
  'illegal', 'errors',
  'plansEvaluated_RETIRED', 'boundsInversions_RETIRED',
];

/**
 * THE ARM AUDIT — the resolved flag stamp, per arm.
 *
 * Not a metric and not differenced: it is the answer to "was this actually the
 * treatment arm?". Every CL flag parses only `1|on|true` with no warning on a
 * typo, and several are overridable per engine, so the manifest's envAtRun
 * block (what was SET) and this (what the engine RESOLVED) can disagree — and
 * when they do, this one is the arm. Absent on bundles from before the CL7
 * telemetry closure.
 */
function flagStampOf(rows) {
  for (const r of rows) {
    for (const h of r.health ?? []) {
      if (h.mechanism && h.mechanism.flags) return h.mechanism.flags;
    }
  }
  return null;
}

// ------------------------------------------------------------- pairing

const report = { batch: path.basename(batchDir), base: baseName, generatedAt: new Date().toISOString(), sweeps: [] };
const problems = [];

const allSweepIds = new Set();
for (const { sweeps } of arms.values()) for (const id of sweeps.keys()) allSweepIds.add(id);

for (const sweepId of [...allSweepIds].sort()) {
  const present = armNames.filter((a) => arms.get(a).sweeps.has(sweepId));
  if (present.length < 2) {
    problems.push(`sweep ${sweepId}: only ${present.length} arm(s) ran it — not pairable, skipped`);
    continue;
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
  const baseRows = byArm.get(baseName) ?? byArm.get(present[0]);
  const common = [];
  let dropped = 0;
  for (const [gameId, br] of baseRows) {
    let ok = true;
    for (const a of present) {
      const r = byArm.get(a).get(gameId);
      if (r === undefined) { ok = false; break; }
      if (r.configHash !== br.configHash) {
        problems.push(`${sweepId}/${gameId}: configHash differs (${baseName}=${br.configHash} ${a}=${r.configHash})`);
        ok = false; break;
      }
      const sa = seatKey(r, a);
      const sb = seatKey(br, baseName);
      if (sa !== sb) {
        problems.push(`${sweepId}/${gameId}: seats differ (${baseName}=${sb} ${a}=${sa})` +
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

  // Subject bot: the one whose seat we read. Default is the first lobster in
  // the seat list, because that is the contender in every cell this kit ships.
  // The subject bot, per arm. `--subject-map` wins, then `--subject`, then the
  // first lobster in the seat list — which is the contender in every cell this
  // kit ships.
  const fallbackSubject = arg('subject', '')
    || (baseRows.get(common[0]).seats.map((s) => s.bot).find((b) => b.startsWith('lobster'))
        ?? baseRows.get(common[0]).seats[0].bot);
  const subjectFor = (armName) => SUBJECT_MAP.get(armName) ?? fallbackSubject;
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

    // Paired DELTAS against the base arm.
    for (const a of present) {
      if (a === baseName) continue;
      const perMetric = {};
      for (const k of METRIC_KEYS) {
        const blockMeans = [];
        for (const gids of blocks.values()) {
          const diffs = [];
          for (const g of gids) {
            const mb = metricsFor(byArm.get(baseName).get(g), subjectFor(baseName));
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
md.push(`Base arm: \`${baseName}\`. Generated ${report.generatedAt}.`);
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
md.push('**Read the arm audit first.** Every CL flag parses only `1`, `on` or `true`, with no');
md.push('warning on a typo, and several are overridable per engine — so an arm can carry the');
md.push('name of a treatment and have run the baseline. The flag-stamp table under each sweep');
md.push('is what the engine RESOLVED; the manifest\'s `envAtRun` is what was set. When they');
md.push('disagree, the stamp is the arm. And a mechanism counter that stayed at zero on the');
md.push('treatment arm means the arm never engaged, which is a different finding from a null.');
md.push('');

for (const s of report.sweeps) {
  md.push(`## ${s.sweepId}`);
  md.push('');
  md.push(`Subject: \`${s.subject}\` · arms: ${s.arms.join(', ')} · paired ${s.gamesPaired} games` +
          (s.gamesDropped > 0 ? ` · **DROPPED ${s.gamesDropped} unpaired**` : ''));
  md.push('');
  {
    const stamped = Object.entries(s.flagStamps ?? {}).filter(([, v]) => v !== null);
    if (stamped.length === 0) {
      md.push('*No flag stamp on this build — it predates the CL7 telemetry closure, so which');
      md.push('arm actually ran cannot be read off these rows. Check `envAtRun` in the manifest*');
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
    md.push(`| metric | ${s.arms.map((a) => `${a} (level)`).join(' | ')} | ${treatArms.map((a) => `Δ ${a}−${baseName} [95% CI]`).join(' | ')} |`);
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
