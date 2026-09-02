#!/usr/bin/env node
/**
 * CPP v0 compiler — first conditional performance profiles from the replay
 * archive, per docs/design/time-cpp-spec.md.
 *
 * v0: ms-denominated rungs (provenance 'provisional, box-noise'), agreement
 * quality only (staged(q) vs staged(Q)), plus a Q-repeat A/A noise ceiling.
 * Profiles the search-arch default bot (lobster-territory on the b5 bundle,
 * cluster-lookahead @ 79b5f5e) on positions drawn from the rl corpus.
 *
 * Run FOREGROUND on an idle box. Sequential decides, one process.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SP = '/tmp/claude-0/-home-user/efbea15c-4c87-5ce1-959f-b7a3435c8e01/scratchpad';
const BUNDLE_LIB = path.join(SP, 'ppruns/b5/harness/build/lib/bots.js');
const { makeBot } = require(BUNDLE_LIB);

const RUNGS = (process.env.CPP_RUNGS ?? '125,250,500,1000,2000,4000')
  .split(',').map(Number); // geometric, ratio 2
const TOP = RUNGS[RUNGS.length - 1];
const TARGET_TURNS = [6, 18, 34, 52];
const N_TARGET = Number(process.env.CPP_N ?? 64); // per stratum
const N_REPEAT = Number(process.env.CPP_REPEAT ?? 16); // Q-repeat A/A ceiling
const BOT_NAME = 'lobster-territory';

const STRATA = [
  { key: 'snake6-3t-25x25', dir: path.join(SP, 'continuous/rl1/arms') },
  { key: 'snake5queen-3t-25x25', dir: path.join(SP, 'continuous/rl4/arms') },
];

function readReplay(file) {
  const raw = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const rows = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* torn tail ok */ }
  }
  return rows;
}

function movesKey(movesMap) {
  // Canonical string of the staged joint move.
  const entries = [...movesMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return JSON.stringify(entries.map(([id, m]) => [id, typeof m === 'object' ? JSON.stringify(m) : m]));
}

function hamming(a, b) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let diff = 0;
  for (const k of keys) {
    const va = a.get(k), vb = b.get(k);
    const sa = va === undefined ? null : JSON.stringify(va);
    const sb = vb === undefined ? null : JSON.stringify(vb);
    if (sa !== sb) diff++;
  }
  return { diff, of: keys.size };
}

function teamAliveOn(board, teamID) {
  return (board.snakes ?? []).some(
    (s) => s.teamID === teamID && s.health > 0 && (s.body?.length ?? 0) > 0,
  );
}

async function decideOnce(board, turn, teamID, rungMs) {
  const bot = makeBot(BOT_NAME, {});
  const t0 = Date.now();
  const out = await bot.decide(board, turn, teamID, t0 + rungMs);
  const t1 = Date.now();
  // Deliberately no bot.release(): release clears the global geometry cache
  // and we want cross-decide warmth to mimic production; engines are GC'd.
  const mech = out.telemetry.mechanism ?? null;
  return {
    moves: out.moves,
    wallMs: t1 - t0,
    firstStageMs: out.telemetry.firstStageMs,
    plans: out.telemetry.plansEvaluated,
    slices: out.telemetry.slices,
    scoutPlies: mech ? (mech.scoutPlies ?? null) : null,
    clusterJoints: mech ? (mech.clusterJoints ?? null) : null,
    error: out.telemetry.error,
  };
}

async function runStratum(stratum, log) {
  // One arm only: paired arms replay the same seeds/boards.
  const armDirs = fs.readdirSync(stratum.dir).filter((d) =>
    fs.statSync(path.join(stratum.dir, d)).isDirectory());
  const armDir = path.join(stratum.dir, armDirs.sort()[0]);
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.jsonl.gz')) files.push(p);
    }
  })(armDir);
  files.sort();
  log(`stratum ${stratum.key}: arm ${armDirs.sort()[0]}, ${files.length} games`);

  const samples = [];
  let repeats = 0;
  const repeatAgree = [];

  for (const f of files) {
    if (samples.length >= N_TARGET) break;
    const rows = readReplay(f);
    const header = rows.find((r) => r.kind === 'header');
    if (!header) continue;
    const seat = header.seats.find((s) => s.bot === BOT_NAME);
    if (!seat) continue;
    const teamID = seat.teamID;
    const byTurn = new Map(rows.filter((r) => r.kind === 'turn').map((r) => [r.turn, r]));

    for (const target of TARGET_TURNS) {
      if (samples.length >= N_TARGET) break;
      const row = byTurn.get(target);
      if (!row) continue;
      if (!teamAliveOn(row.board, teamID)) continue;

      const perRung = [];
      for (const rung of RUNGS) {
        perRung.push({ rung, ...(await decideOnce(row.board, row.turn, teamID, rung)) });
      }
      let rep = null;
      if (repeats < N_REPEAT) {
        rep = await decideOnce(row.board, row.turn, teamID, TOP);
        repeats++;
      }
      const top = perRung[perRung.length - 1];
      const topKey = movesKey(top.moves);
      const sample = {
        game: path.basename(f).replace('.jsonl.gz', ''),
        turn: row.turn,
        teamID,
        rungs: perRung.map((r) => {
          const h = hamming(r.moves, top.moves);
          return {
            rung: r.rung,
            agreeTop: movesKey(r.moves) === topKey,
            hammingDiff: h.diff,
            units: h.of,
            wallMs: r.wallMs,
            firstStageMs: r.firstStageMs,
            plans: r.plans,
            slices: r.slices,
            scoutPlies: r.scoutPlies,
            clusterJoints: r.clusterJoints,
            error: r.error,
          };
        }),
      };
      if (rep !== null) {
        const h = hamming(rep.moves, top.moves);
        sample.repeatTop = { agree: movesKey(rep.moves) === topKey, hammingDiff: h.diff, units: h.of };
        repeatAgree.push(sample.repeatTop);
      }
      samples.push(sample);
      const mem = Math.round(process.memoryUsage().heapUsed / 1e6);
      log(`  [${stratum.key}] n=${samples.length}/${N_TARGET} ${path.basename(f)}@t${row.turn} heap=${mem}MB ` +
        sample.rungs.map((r) => (r.agreeTop ? '=' : 'x')).join(''));
    }
  }
  return { samples, repeatAgree };
}

function aggregate(stratumKey, samples, repeatAgree) {
  const profile = RUNGS.map((rung, i) => {
    const rs = samples.map((s) => s.rungs[i]).filter((r) => !r.error);
    const n = rs.length;
    const agree = rs.filter((r) => r.agreeTop).length;
    const mean = (sel) => {
      const v = rs.map(sel).filter((x) => x !== null && x !== undefined && Number.isFinite(x));
      return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null;
    };
    const hamm = rs.reduce((a, r) => a + r.hammingDiff, 0) / Math.max(1, rs.reduce((a, r) => a + r.units, 0));
    return {
      rungMs: rung,
      n,
      prAgree: +(agree / Math.max(1, n)).toFixed(3),
      hammingRate: +hamm.toFixed(3),
      meanWallMs: mean((r) => r.wallMs),
      meanFirstStageMs: mean((r) => r.firstStageMs),
      meanPlans: mean((r) => r.plans),
      meanSlices: mean((r) => r.slices),
      meanScoutPlies: mean((r) => r.scoutPlies),
      meanClusterJoints: mean((r) => r.clusterJoints),
      errors: samples.map((s) => s.rungs[i]).filter((r) => r.error).length,
    };
  });
  const repN = repeatAgree.length;
  const repAgree = repeatAgree.filter((r) => r.agree).length;
  return {
    stratum: stratumKey,
    bot: BOT_NAME,
    profile,
    noiseCeiling: {
      note: 'A/A agreement of a repeated top-rung decision on the same position — the ceiling any rung can be read against under v0 wall-clock noise',
      n: repN,
      prAgree: repN ? +(repAgree / repN).toFixed(3) : null,
      hammingRate: repN
        ? +(repeatAgree.reduce((a, r) => a + r.hammingDiff, 0) /
            Math.max(1, repeatAgree.reduce((a, r) => a + r.units, 0))).toFixed(3)
        : null,
    },
    provenance: {
      clock: 'ms-v0 PROVISIONAL (wall-clock, box-noise; deterministic quanta rungs are v1)',
      quality: 'agreement-only (priced regret deferred to v1)',
      corpus: 'continuous/' + (stratumKey.startsWith('snake6') ? 'rl1' : 'rl4') + ' (one arm, paired seeds)',
      corpusPlayedAt: '2000ms budget, 3 teams, 25x25, turnCap 120, potions on 0.15',
      lineage: 'b5 = claude/cluster-lookahead @ 79b5f5e (toll fix; predates 47c983e loop telemetry)',
      rungs: RUNGS,
      targetTurns: TARGET_TURNS,
      engineWarmth: 'fresh engine per decide (no stepCost carry); geometry cache kept warm across decides',
      seedNote: 'facade mints matchSeed internally; wall-clock anytime loop is not run-reproducible — hence the noise ceiling',
      fitDate: new Date().toISOString(),
      class: 'inherited-unfitted -> first-fit',
    },
  };
}

(async () => {
  const outDir = path.join(SP, 'archx-time/cpp');
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(outDir, 'compile-v0.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const log = (m) => { console.log(m); logStream.write(m + '\n'); };
  log(`=== cpp-compile-v0 start ${new Date().toISOString()} rungs=${RUNGS} nTarget=${N_TARGET}`);

  const only = process.argv[2]; // optional stratum filter / 'smoke'
  for (const stratum of STRATA) {
    if (only && only !== 'smoke' && !stratum.key.startsWith(only)) continue;
    const t0 = Date.now();
    const { samples, repeatAgree } = await runStratum(stratum, log);
    const agg = aggregate(stratum.key, samples, repeatAgree);
    agg.provenance.compileWallMinutes = +((Date.now() - t0) / 60000).toFixed(1);
    const outFile = path.join(outDir, `${stratum.key}.json`);
    fs.writeFileSync(outFile, JSON.stringify(agg, null, 2));
    log(`wrote ${outFile}`);
    log(JSON.stringify(agg.profile, null, 1));
    log(`noiseCeiling: ${JSON.stringify(agg.noiseCeiling)}`);
  }
  log(`=== done ${new Date().toISOString()}`);
  logStream.end();
})().catch((e) => { console.error(e); process.exit(1); });
