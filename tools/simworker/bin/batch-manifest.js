#!/usr/bin/env node
/*
 * BUILD THE BATCH MANIFEST — the self-describing header the cloud session mines.
 *
 *   node tools/simworker/bin/batch-manifest.js --batch <batch-dir> [--prune]
 *
 * Walks a batch directory, assembles `manifest.json`, and reports the batch's
 * size against the commit cap.
 *
 * ── WHY THE MANIFEST IS THE DELIVERABLE ────────────────────────────────────
 *
 * A results branch is read months later by a session that was not there. Every
 * question it will ask — which build was this, what did the box look like, how
 * loaded was it, which arm was the treatment, how many blocks — has to be
 * answerable from the committed files alone. A batch that needs its author
 * present to be interpreted is a batch that will be thrown away.
 *
 * So: git SHAs of every bot build, the resolved cell configs, arms and their
 * env, seeds, host and CPU, the loadavg trace across the run, and the schema
 * version of this file itself.
 *
 * ── SIZE ───────────────────────────────────────────────────────────────────
 *
 * Replays are gzipped JSONL and a 2000 ms, 25x25, 3x6 game is a big one. The
 * protocol caps a committed batch at ~200 MB. Over that, `--prune` keeps a
 * DOCUMENTED SAMPLE of replays and drops the rest — the manifest records
 * exactly which gameIds kept their replay and which did not, so nobody later
 * mistakes a pruned batch for a corrupt one. The per-game summary rows in
 * `manifest.jsonl` are NEVER pruned: they are small, and they carry placement,
 * health counters and shape facts, which is most of what an aggregation reads.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA_VERSION = 1;
const SIZE_CAP_BYTES = 200 * 1024 * 1024;

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const flag = (n) => process.argv.includes(`--${n}`);

const batchDir = path.resolve(arg('batch', ''));
if (arg('batch', '') === '') {
  console.error('usage: batch-manifest.js --batch <batch-dir> [--prune] [--keep-per-cell N]');
  process.exit(1);
}
const keepPerCell = Number(arg('keep-per-cell', '6'));

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// ------------------------------------------------------------------ gather

const armsRoot = path.join(batchDir, 'arms');
const arms = [];
if (fs.existsSync(armsRoot)) {
  for (const name of fs.readdirSync(armsRoot).sort()) {
    const dir = path.join(armsRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const meta = readJson(path.join(dir, 'arm.json'));
    const sweeps = [];
    for (const sweepId of fs.readdirSync(dir).sort()) {
      const sdir = path.join(dir, sweepId);
      if (!fs.existsSync(path.join(sdir, 'manifest.jsonl'))) continue;
      const rows = fs.readFileSync(path.join(sdir, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      const spec = readJson(path.join(sdir, 'spec.json'));
      const cells = new Map();
      for (const r of rows) {
        if (!cells.has(r.cell)) {
          cells.set(r.cell, {
            cell: r.cell, games: 0, blocks: new Set(), seeds: new Set(),
            shape: {
              size: r.size, teams: r.teamCount, unitsPerTeam: r.unitsPerTeam,
              budgetMs: r.budgetMs, turnCap: r.turnCap, foodSpawnRate: r.foodSpawnRate,
              hazardLayout: r.hazardLayout, hazardDamage: r.hazardDamage,
              potions: r.potions, fertile: r.fertile,
            },
            configHash: r.configHash,
            capTerminal: 0,
            integrity: { illegal: 0, errors: 0, unstaged: 0 },
          });
        }
        const c = cells.get(r.cell);
        c.games++; c.blocks.add(r.block); c.seeds.add(r.seed);
        if (r.terminal === 'cap') c.capTerminal++;
        for (const h of r.health) {
          c.integrity.illegal += h.illegal; c.integrity.errors += h.errors; c.integrity.unstaged += h.unstaged;
        }
      }
      sweeps.push({
        sweepId,
        games: rows.length,
        bots: spec && spec.resolved ? spec.resolved.bots : null,
        seeds: spec && spec.resolved ? spec.resolved.seeds : null,
        rotateSeats: spec && spec.resolved ? spec.resolved.rotateSeats !== false : null,
        resumedAt: spec ? spec.resumedAt || [] : [],
        hostAtRun: spec ? spec.host || null : null,
        // THE ARM, AS THE SWEEP RESOLVED IT. `contendersAtRun` is the load-
        // bearing one now: it is the bot each seat actually played, read off
        // the spec the sweep wrote for itself. `envAtRun` is kept because an
        // arm can still carry process environment, and because a batch-1
        // manifest has one and nothing else.
        contendersAtRun: spec && spec.resolved ? spec.resolved.contenders || null : null,
        envAtRun: spec ? spec.env || null : null,
        cells: [...cells.values()].map((c) => ({
          ...c, blocks: c.blocks.size, seeds: [...c.seeds].sort((a, b) => a - b),
          capRate: Number((c.capTerminal / c.games).toFixed(3)),
        })),
      });
    }
    arms.push({
      arm: name,
      bundle: meta ? meta.bundle : null,
      // The SHA is the load-bearing field. A branch name is not provenance.
      gitSha: meta && meta.bundleStamp ? meta.bundleStamp.sha : null,
      gitRef: meta && meta.bundleStamp ? meta.bundleStamp.ref : null,
      gitSubject: meta && meta.bundleStamp ? meta.bundleStamp.subject : null,
      builtAt: meta && meta.bundleStamp ? meta.bundleStamp.builtAt : null,
      buildNode: meta && meta.bundleStamp ? meta.bundleStamp.node : null,
      tscErrors: meta && meta.bundleStamp ? meta.bundleStamp.tscErrors : null,
      harnessCommit: meta && meta.bundleStamp ? meta.bundleStamp.harnessCommit : null,
      botConfig: meta ? meta.botConfig || null : null,
      // The RESOLVED seat -> config map (20260830 and later). Null on an older
      // record, which is not the same as "configured nothing".
      seatConfigs: meta ? meta.seatConfigs || null : null,
      legacyEnv: meta ? meta.legacyEnv === true : false,
      envOverrides: meta ? meta.envOverrides : null,
      workers: meta ? meta.workers : null,
      sweeps,
    });
  }
}

const pairs = [];
const pairsDir = path.join(batchDir, 'pairs');
if (fs.existsSync(pairsDir)) {
  for (const f of fs.readdirSync(pairsDir).sort()) {
    if (f.endsWith('.json')) pairs.push(readJson(path.join(pairsDir, f)));
  }
}

// -------------------------------------------------------------------- size

const files = fs.existsSync(batchDir) ? walk(batchDir) : [];
const replayFiles = files.filter((f) => f.endsWith('.jsonl.gz'));
const totalBytes = files.reduce((a, f) => a + fs.statSync(f).size, 0);
const replayBytes = replayFiles.reduce((a, f) => a + fs.statSync(f).size, 0);

// ------------------------------------------------------------------- prune

let pruned = { applied: false, keptPerCell: keepPerCell, kept: [], dropped: [] };
if (flag('prune')) {
  // Keep the first `keepPerCell` games of each (arm, sweep, cell) BY gameId
  // order — deterministic, so both arms of a pair keep the SAME boards and the
  // sample stays paired. A sample that is paired is still usable for the
  // offline board-level probes; a sample drawn independently per arm is not.
  const keep = new Set();
  for (const a of arms) {
    for (const s of a.sweeps) {
      const dir = path.join(armsRoot, a.arm, s.sweepId);
      const rows = fs.readFileSync(path.join(dir, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
      const byCell = new Map();
      for (const r of rows) {
        if (!byCell.has(r.cell)) byCell.set(r.cell, []);
        byCell.get(r.cell).push(r.gameId);
      }
      for (const ids of byCell.values()) for (const id of ids.sort().slice(0, keepPerCell)) keep.add(id);
    }
  }
  for (const f of replayFiles) {
    const gameId = path.basename(f).replace(/\.jsonl\.gz$/, '');
    if (keep.has(gameId)) pruned.kept.push(gameId);
    else { fs.unlinkSync(f); pruned.dropped.push(gameId); }
  }
  pruned.applied = true;
  pruned.kept.sort(); pruned.dropped.sort();
}

const filesAfter = fs.existsSync(batchDir) ? walk(batchDir) : [];
const bytesAfter = filesAfter.reduce((a, f) => a + fs.statSync(f).size, 0);

// ---------------------------------------------------------------- manifest

function gitInfo() {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim();
    return {
      kitRepo: top,
      kitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: top, encoding: 'utf8' }).trim(),
      kitBranch: execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: top, encoding: 'utf8' }).trim(),
      kitDirty: execFileSync('git', ['status', '--porcelain'], { cwd: top, encoding: 'utf8' }).trim().length > 0,
    };
  } catch { return null; }
}

const manifest = {
  schemaVersion: SCHEMA_VERSION,
  batchId: path.basename(batchDir),
  generatedAt: new Date().toISOString(),
  kit: gitInfo(),
  host: {
    hostname: os.hostname(), platform: os.platform(), release: os.release(), arch: os.arch(),
    cpus: os.cpus().length, cpuModel: (os.cpus()[0] || {}).model || null,
    totalmemGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    node: process.version,
    loadavgNow: os.loadavg(),
  },
  arms,
  pairs,
  size: {
    totalBytesBefore: totalBytes,
    replayBytesBefore: replayBytes,
    totalBytesAfter: bytesAfter,
    capBytes: SIZE_CAP_BYTES,
    overCap: bytesAfter > SIZE_CAP_BYTES,
    fileCount: filesAfter.length,
    replayCount: filesAfter.filter((f) => f.endsWith('.jsonl.gz')).length,
  },
  replaySampling: pruned,
};

fs.writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

// ------------------------------------------------------------------ report

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
console.log(`batch      ${manifest.batchId}`);
console.log(`host       ${manifest.host.hostname} ${manifest.host.platform} cpus=${manifest.host.cpus} mem=${manifest.host.totalmemGb}G node=${manifest.host.node}`);
console.log(`cpu        ${manifest.host.cpuModel}`);
console.log('');
for (const a of arms) {
  const games = a.sweeps.reduce((n, s) => n + s.games, 0);
  console.log(`arm ${a.arm.padEnd(14)} ${a.gitSha ? a.gitSha.slice(0, 12) : 'NO-SHA'} ${(a.gitRef || '?').padEnd(40)} ${games} games`);
  // Print the seat a config landed on, never the config alone: an arm's
  // identity is which bot was configured as much as how.
  if (a.seatConfigs && Object.keys(a.seatConfigs).length) {
    for (const [seat, cfg] of Object.entries(a.seatConfigs)) {
      console.log(`    ${''.padEnd(14)} bot@${seat} ${JSON.stringify(cfg)}`);
    }
  } else if (a.botConfig) {
    console.log(`    ${''.padEnd(14)} bot ${JSON.stringify(a.botConfig)} (unresolved — pre-20260830 record)`);
  }
  if (a.envOverrides && Object.keys(a.envOverrides).length) {
    console.log(`    ${''.padEnd(14)} env ${Object.entries(a.envOverrides).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
  if (a.legacyEnv) {
    console.log(`    ${''.padEnd(14)} WARNING: run with --legacy-env. Deleted CENTAUR_* flags were passed`);
    console.log(`    ${''.padEnd(14)}          through. Only a PRE-teardown bundle reads them; against a`);
    console.log(`    ${''.padEnd(14)}          current one this arm is the shipped bot under another name.`);
  }
  if (!a.gitSha) {
    console.log(`    ${''.padEnd(14)} WARNING: no bundle stamp — this arm's provenance is unrecorded and its`);
    console.log(`    ${''.padEnd(14)}          numbers cannot be quoted with a SHA. Rebuild via build-bot.sh.`);
  }
  for (const s of a.sweeps) {
    for (const c of s.cells) {
      const bad = c.integrity.illegal + c.integrity.errors;
      console.log(`      ${s.sweepId}/${c.cell}: ${c.games} games, ${c.blocks} blocks, cap-rate ${c.capRate}` +
                  (bad > 0 ? `  *** ${bad} INTEGRITY EVENTS (illegal/errors) — this cell is not usable ***` : ''));
      if (c.capRate > 0.5) console.log('        NOTE: majority cap-terminal — measuring a stall, not play.');
    }
    if (s.resumedAt && s.resumedAt.length > 0) {
      console.log(`      ${s.sweepId}: RESUMED ${s.resumedAt.length}x — this sweep straddles more than one load regime; say so in findings.md`);
    }
  }
}
console.log('');
console.log(`size       ${mb(bytesAfter)} in ${manifest.size.fileCount} files (${manifest.size.replayCount} replays)`);
if (pruned.applied) console.log(`prune      kept ${pruned.kept.length} replays, dropped ${pruned.dropped.length} (was ${mb(totalBytes)})`);
if (manifest.size.overCap) {
  console.log('');
  console.log(`*** OVER THE ${mb(SIZE_CAP_BYTES)} COMMIT CAP ***`);
  console.log('Rerun with --prune to keep a documented paired sample of replays and drop the');
  console.log('rest. The per-game summary rows in manifest.jsonl survive pruning untouched, so');
  console.log('every aggregation this kit performs still works on a pruned batch.');
}
console.log('');
console.log(`manifest -> ${path.join(batchDir, 'manifest.json')}`);
