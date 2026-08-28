'use strict';
/*
 * READ A RESULTS CHECKOUT — arms, games, mechanism rows.
 *
 * ── TWO LAYOUTS, ONE ROW SCHEMA ────────────────────────────────────────────
 *
 * The per-game row (`manifest.jsonl`) has been stable across this whole
 * program: `{sweepId, gameId, cell, block, seed, configHash, seats[], results[],
 * health[]}`. Two directory layouts wrap it.
 *
 *   BATCH   <batch>/arms/<arm>/<sweepId>/manifest.jsonl   — the sim kit's
 *           protocol, with `arm.json` carrying the bundle stamp and env.
 *   SWEEP   <dir>/manifest.jsonl                           — the flat layout
 *           the 2026-08 scratchpad sweeps wrote, one directory per arm-cell.
 *
 * Both are read here, because the historical corpus is the only data that
 * exists for several flags and refusing to read it would mean the loop starts
 * with nothing. A flat sweep directory has no `arm.json`, so it carries no
 * bundle stamp and no env capture — which the loader records as
 * `provenance: 'sweep-dir'`, and which the ledger writer refuses to treat as a
 * live paired verdict. Historical rows inform; they do not promote.
 *
 * ── WHAT COMES OUT ─────────────────────────────────────────────────────────
 *
 * `loadArms` returns a Map<armName, Arm>, where an Arm holds its metadata and
 * per-sweep row maps. `pairCells` does the integrity gate (same gameId must
 * mean the same board and the same seats) and produces per-cell paired block
 * means for every metric. Nothing here decides anything; the ledger does.
 */

const fs = require('fs');
const path = require('path');

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readRows(p) {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Load one arm from a kit-layout arm directory. */
function loadBatchArm(armDir, name) {
  const sweeps = new Map();
  for (const sweepId of fs.readdirSync(armDir).sort()) {
    const mp = path.join(armDir, sweepId, 'manifest.jsonl');
    if (!fs.existsSync(mp)) continue;
    sweeps.set(sweepId, readRows(mp));
  }
  if (sweeps.size === 0) return null;
  return { name, dir: armDir, meta: readJson(path.join(armDir, 'arm.json')), sweeps, provenance: 'batch' };
}

/**
 * Load one arm from a flat sweep directory (the historical layout).
 *
 * EVERY ROW COLLAPSES UNDER ONE KEY, and the key is the caller's, not the
 * row's. In the batch layout the sweepId names the EXPERIMENT and is shared
 * across arms; in the flat layout it names the DIRECTORY, so `i1v2-base-150-
 * mix23` and `i1v2-mine-150-mix23` are the two arms of one experiment carrying
 * two different sweepIds. Pairing on the row's own id would find no sweep
 * present in both arms and silently report nothing pairable, which is exactly
 * what it did the first time this was pointed at the historical corpus.
 */
function loadSweepArm(dir, name, sweepKey = 'sweep') {
  const rows = readRows(path.join(dir, 'manifest.jsonl'));
  if (rows.length === 0) return null;
  const sweeps = new Map([[sweepKey, rows]]);
  return { name, dir, meta: null, sweeps, provenance: 'sweep-dir', sweepIdOfRows: rows[0].sweepId ?? null };
}

/**
 * Every arm under `<batch>/arms/*`, plus any explicitly named flat sweep
 * directories (`extra` maps armName -> dir).
 */
function loadArms(batchDir, extra = {}, sweepKey = 'sweep') {
  const arms = new Map();
  const armsRoot = path.join(batchDir, 'arms');
  if (fs.existsSync(armsRoot)) {
    for (const name of fs.readdirSync(armsRoot).sort()) {
      const dir = path.join(armsRoot, name);
      if (!fs.statSync(dir).isDirectory()) continue;
      const arm = loadBatchArm(dir, name);
      if (arm !== null) arms.set(name, arm);
    }
  }
  for (const [name, dir] of Object.entries(extra)) {
    const arm = loadSweepArm(path.resolve(dir), name, sweepKey);
    if (arm !== null) arms.set(name, arm);
  }
  return arms;
}

/**
 * PER-GAME METRICS FOR ONE SEAT.
 *
 * `score` is the primary OUTCOME metric and the one with the worst resolution.
 * Everything below the divider is MECHANISM: it describes what the engine did
 * rather than who won, and A3 §4.2's whole argument is that those move at
 * n≈8 blocks while placement needs 60–1000 games a cell.
 *
 * `mechanism` rows are read when the harness emitted them (CL7's
 * `TeamTurnResult.mechanism`, folded per game by the harness). They are ABSENT
 * on every batch run before that landed — including 20260827 — and absent is
 * carried through as null rather than zero, because a zero would read as "the
 * arm was measured and did nothing".
 */
function metricsFor(row, subjectBot) {
  const res = (row.results ?? []).find((r) => r.bot === subjectBot);
  if (res === undefined) return null;
  const h = (row.health ?? []).find((x) => x.bot === subjectBot);
  const decisions = h ? h.decisions : 0;
  const per = (x) => (decisions > 0 && typeof x === 'number' ? x / decisions : null);
  const mech = h && h.mechanism ? h.mechanism : null;
  return {
    // --- outcome -------------------------------------------------------
    score: res.score,
    win: res.place === 1 ? 1 : 0,
    place: res.place,
    finalMaterial: res.finalMaterial,
    finalUnits: res.finalUnits,
    survived: res.eliminatedOnTurn === null ? 1 : 0,
    // --- game shape ----------------------------------------------------
    turns: row.turns,
    decisive: row.terminal === 'decisive' ? 1 : 0,
    capped: row.terminal === 'cap' ? 1 : 0,
    // --- mechanism (harness-side) --------------------------------------
    decisions,
    worstWallMs: h ? h.worstWallMs : null,
    overrunRate: h ? per(h.overruns) : null,
    unstagedRate: h ? per(h.unstaged) : null,
    stagedNothingRate: h ? per(h.stagedNothing) : null,
    assumptionRate: h ? per(h.assumptions) : null,
    ratchetRate: h ? per(h.ratchetRefusals) : null,
    // --- deaths by cause, mined from the replay's events block ----------
    // P7's verdict turned on exactly this: CENTAUR_CLUSTER_SEED passed its
    // deterministic fatal-staging gate and collapsed live through EXHAUSTION,
    // a travel-economy channel the probe never measured.
    deathsSelf: h && typeof h.deathsSelf === 'number' ? h.deathsSelf : null,
    deathsTeammate: h && typeof h.deathsTeammate === 'number' ? h.deathsTeammate : null,
    deathsWall: h && typeof h.deathsWall === 'number' ? h.deathsWall : null,
    deathsExhaustion: h && typeof h.deathsExhaustion === 'number' ? h.deathsExhaustion : null,
    // --- mechanism (engine-side, CL7) ----------------------------------
    wasmRuns: mech ? mech.wasmRuns : null,
    wasmRefused: mech ? mech.wasmRefused : null,
    clusterJoints: mech ? mech.clusterJoints : null,
    clusterEnumMs: mech ? mech.clusterEnumMs : null,
    selectionFar: mech ? mech.selectionFar : null,
    selectionDraws: mech ? mech.selectionDraws : null,
    refineMovedLo: mech ? mech.refineMovedLo : null,
    refineInverted: mech ? mech.refineInverted : null,
    scoutPlies: mech ? mech.scoutPlies : null,
    scoutThreads: mech ? mech.scoutThreads : null,
    ceilingDecided: mech ? mech.ceilingDecided : null,
    // --- integrity (must be zero) --------------------------------------
    illegal: h ? h.illegal : null,
    errors: h ? h.errors : null,
    // --- RETIRED: budget-noise dominated, and NEVER a verdict on a live
    // arm. Kept because they diagnose a broken arm. See METHODOLOGY §5 and
    // the CL7 ledger's `retiredCounters` note.
    plansEvaluated_RETIRED: h ? h.plansEvaluated : null,
    boundsInversions_RETIRED: h ? h.boundsInversions : null,
  };
}

const METRIC_KEYS = Object.keys(
  metricsFor(
    { results: [{ bot: 'x', score: 0, place: 1, finalMaterial: 0, finalUnits: 0, eliminatedOnTurn: null }], health: [], turns: 0, terminal: 'cap' },
    'x'
  )
);

/** Metrics that must never be read as a verdict on a live arm. */
const RETIRED_KEYS = ['plansEvaluated_RETIRED', 'boundsInversions_RETIRED'];

/** The subject seat: the contender, which in every cell this program runs is
 * the first lobster in the seat list unless a caller names one. */
function subjectOf(rows, named) {
  if (named) return named;
  const first = rows[0];
  if (first === undefined) return null;
  const bots = first.seats.map((s) => s.bot);
  return bots.find((b) => b.startsWith('lobster')) ?? bots[0];
}

/**
 * PAIR TWO ARMS AND RETURN PER-CELL BLOCK MEANS OF EVERY METRIC'S DELTA.
 *
 * The integrity gate first: the same gameId must mean the same board
 * (`configHash`) and the same seats in both arms, or the pairing is a fiction
 * and the game is dropped LOUDLY. `subjectMap` declares a legitimate
 * substitution (a profile with no env flag is run by seating a different bot
 * name); every other seat must still match exactly.
 */
function pairCells(base, treat, { subjectMap = {}, subject = null } = {}) {
  const SUBJ = '<SUBJECT>';
  const seatKey = (row, armName) => {
    const s = subjectMap[armName];
    return row.seats.map((x) => `${x.seat}:${x.bot === s ? SUBJ : x.bot}`).join(',');
  };

  const problems = [];
  const cells = new Map(); // cellKey -> { block -> { metric -> [diffs] } }
  let paired = 0;
  let dropped = 0;

  const sweepIds = new Set([...base.sweeps.keys(), ...treat.sweeps.keys()]);
  for (const sweepId of [...sweepIds].sort()) {
    const a = base.sweeps.get(sweepId);
    const b = treat.sweeps.get(sweepId);
    if (!a || !b) {
      problems.push(`sweep ${sweepId}: present in only one arm — not pairable`);
      continue;
    }
    const byId = new Map(b.map((r) => [r.gameId, r]));
    const subjA = subjectMap[base.name] ?? subjectOf(a, subject);
    const subjB = subjectMap[treat.name] ?? subjectOf(b, subject);
    for (const ra of a) {
      const rb = byId.get(ra.gameId);
      if (rb === undefined) {
        dropped++;
        continue;
      }
      if (ra.configHash !== rb.configHash) {
        problems.push(`${sweepId}/${ra.gameId}: configHash ${ra.configHash} vs ${rb.configHash}`);
        dropped++;
        continue;
      }
      if (seatKey(ra, base.name) !== seatKey(rb, treat.name)) {
        problems.push(`${sweepId}/${ra.gameId}: seat assignment differs`);
        dropped++;
        continue;
      }
      const ma = metricsFor(ra, subjA);
      const mb = metricsFor(rb, subjB);
      if (ma === null || mb === null) {
        problems.push(`${sweepId}/${ra.gameId}: subject seat absent in one arm`);
        dropped++;
        continue;
      }
      paired++;
      const key = `${sweepId}::${ra.cell}`;
      if (!cells.has(key)) cells.set(key, new Map());
      const byBlock = cells.get(key);
      const blockId = String(ra.block);
      if (!byBlock.has(blockId)) byBlock.set(blockId, {});
      const acc = byBlock.get(blockId);
      for (const k of METRIC_KEYS) {
        const va = ma[k];
        const vb = mb[k];
        // A metric absent in EITHER arm contributes nothing. Substituting zero
        // would turn "this build had no such counter" into "the treatment
        // changed it by exactly its own value".
        if (typeof va !== 'number' || typeof vb !== 'number') continue;
        if (!acc[k]) acc[k] = [];
        acc[k].push(vb - va);
      }
    }
    for (const r of b) if (!a.some((x) => x.gameId === r.gameId)) dropped++;
  }
  return { cells, problems, paired, dropped };
}

module.exports = {
  loadArms,
  loadBatchArm,
  loadSweepArm,
  metricsFor,
  pairCells,
  readJson,
  readRows,
  subjectOf,
  METRIC_KEYS,
  RETIRED_KEYS,
};
