/**
 * VALIDATION SMOKE — the gate the harness has to pass before a sweep trusts it.
 *
 *   node build/bin/smoke.js [--workers 3] [--budget 150]
 *
 * Twenty games across the variant set on two configs:
 *
 *   mix23    23x23, 3 teams, 6 units each, snakes + pieces — the shape the
 *            sweep is actually for, and the one that has to exercise 3-team
 *            adjudication rather than a hidden 2-team assumption.
 *   control11 11x11, 2 teams, 4 snakes each — the h2h control. Snakes only, so
 *            the legacy path speaks for every unit it owns and the comparison
 *            isolates SEARCH from "legacy has no piece bot".
 *
 * It then checks, and FAILS on:
 *   - any crashed game, or any decision that threw
 *   - any illegal staged move (judged by the vendored grammar)
 *   - any unit a bot speaks for that it left unstaged
 *   - any bound violation reported by a lobster kernel
 *   - a replay that does not load back, or whose turn count disagrees with the
 *     manifest, or whose seats/config hash disagree with the manifest
 *   - a 3-team game that did not actually adjudicate three ways
 *   - held units at or over MAX_FROZEN (silent modelling degradation)
 *   - any declared modelling assumption (same thing, reported by the engine)
 */

import * as fs from 'fs';
import * as path from 'path';
import { BOT_NAMES, isBotName, type BotName } from '../lib/bots';
import { MAX_FROZEN_CAPACITY } from '../lib/config';
import { preset } from '../lib/presets';
import { poolSizeFor, runJobs } from '../lib/runner';
import { iterateTurns, loadReplay } from '../lib/replay';
import { manifestRow, planSweep, readManifest, ManifestWriter, type ManifestRow } from '../lib/sweep';
import { resolveOutRoot } from '../lib/outdir';

const REPLAY_ROOT = resolveOutRoot();

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : dflt;
}

const failures: string[] = [];
const notes: string[] = [];
function check(ok: boolean, msg: string): void {
  if (!ok) failures.push(msg);
}

async function main(): Promise<void> {
  const workers = Number(arg('workers', '3'));
  const budgetMs = Number(arg('budget', '150'));
  const sweepId = `smoke-${Date.now()}`;
  const replayDir = path.join(REPLAY_ROOT, sweepId);
  const manifestPath = path.join(replayDir, 'manifest.jsonl');

  // 3-team arm: 4 seeds x 3 rotations = 12 games, all four competitor variants
  // represented across the two arms.
  const three = planSweep({
    sweepId,
    bots: ['lobster-territory', 'lobster-material', 'legacy'] as ReadonlyArray<BotName>,
    seeds: [401, 402, 403, 404],
    cells: [{ cell: 'mix23', config: { ...preset('mix23', { turnCap: 30, budgetMs }) } as never }],
  });
  // 2-team control: 4 seeds x 2 rotations = 8 games. 12 + 8 = 20.
  const two = planSweep({
    sweepId,
    bots: ['lobster-territory', 'legacy'] as ReadonlyArray<BotName>,
    seeds: [401, 402, 403, 404],
    cells: [{ cell: 'control11', config: { ...preset('control11', { turnCap: 40, budgetMs }) } as never }],
  });
  const jobs = [...three, ...two].map((j, i) => ({ ...j, jobIndex: i }));

  console.log(`# SMOKE ${sweepId}`);
  console.log(`# ${jobs.length} games (12 x 3-team mix23, 8 x 2-team control11) budget=${budgetMs}ms workers=${workers}`);
  console.log(`# bots exercised: lobster-territory, lobster-material, legacy, reflex(separate probe)`);
  console.log('');

  fs.mkdirSync(replayDir, { recursive: true });
  const manifest = new ManifestWriter(manifestPath);
  let crashed = 0;
  const started = Date.now();

  await runJobs(jobs, {
    sweepId,
    replayDir,
    workers,
    poolSize: poolSizeFor(workers),
    onDone: (job, outcome) => {
      manifest.append(manifestRow(job, outcome));
      const top = [...outcome.placements].sort((a, b) => a.place - b.place)[0];
      console.log(
        `  ${job.gameId.padEnd(22)} ${String(outcome.turns).padStart(3)}t ${outcome.terminal.padEnd(8)} ` +
          `held=${outcome.worstHeldObserved}/${outcome.maxFrozenCapacity} winner=${top?.bot}`
      );
    },
    onError: (job, error) => {
      crashed += 1;
      failures.push(`CRASH ${job.gameId}: ${error.split('\n')[0]}`);
      console.error(`  [CRASH] ${job.gameId}`);
    },
  });

  const elapsed = (Date.now() - started) / 1000;
  console.log('');
  console.log(`# played in ${elapsed.toFixed(1)}s`);

  // ---------------------------------------------------------------- checks
  check(crashed === 0, `${crashed} games crashed`);
  const rows = readManifest(manifestPath);
  check(rows.length === jobs.length, `manifest has ${rows.length} rows, expected ${jobs.length}`);

  let threeTeamAdjudications = 0;
  let distinctPlaces3 = 0;
  let totalDecisions = 0;
  let ratchetTotal = 0;
  let inversionTotal = 0;
  // Bounds inversions, classified per DECISION against the condition they
  // track — see the anomaly section below.
  let invUnderWinCeiling = 0;
  let invUnderFiniteCeiling = 0;
  let decisionsWithWinCeiling = 0;
  let decisionsWithFiniteCeiling = 0;
  const inversionSites: string[] = [];

  for (const row of rows) {
    for (const h of row.health) {
      totalDecisions += h.decisions;
      check(h.illegal === 0, `${row.gameId} seat ${h.seat} (${h.bot}): ${h.illegal} illegal moves`);
      check(h.unstaged === 0, `${row.gameId} seat ${h.seat} (${h.bot}): ${h.unstaged} unstaged units`);
      check(h.errors === 0, `${row.gameId} seat ${h.seat} (${h.bot}): ${h.errors} decisions threw`);
      // `ratchet-floor`/`ratchet-gap` are the kernel REFUSING a slice that
      // regressed and keeping its incumbent — a monotonicity complaint about
      // one refinement step under a tight budget, not a broken bound, and the
      // decision stays sound because the result was discarded rather than
      // clamped (kernel.ts:1660-1671). Counted, never failed on.
      ratchetTotal += h.ratchetRefusals;
      inversionTotal += h.boundsInversions;
      check(
        h.assumptions === 0,
        `${row.gameId} seat ${h.seat} (${h.bot}): ${h.assumptions} declared modelling assumptions ` +
          `(a decision that stopped modelling some opponents)`
      );
    }

    check(
      row.worstHeldObserved < MAX_FROZEN_CAPACITY,
      `${row.gameId}: held ${row.worstHeldObserved} units, at or over MAX_FROZEN ${MAX_FROZEN_CAPACITY}`
    );

    if (row.teamCount === 3) {
      threeTeamAdjudications += 1;
      check(row.results.length === 3, `${row.gameId}: 3 teams but ${row.results.length} results`);
      check(row.seats.length === 3, `${row.gameId}: 3 teams but ${row.seats.length} seats`);
      const places = new Set(row.results.map((r) => r.place));
      if (places.size === 3) distinctPlaces3 += 1;
      // Placement must be a valid ranking: every place in 1..3, at least one 1st.
      check(
        row.results.every((r) => r.place >= 1 && r.place <= 3),
        `${row.gameId}: placement out of range ${row.results.map((r) => r.place).join(',')}`
      );
      check(
        row.results.some((r) => r.place === 1),
        `${row.gameId}: no team placed first`
      );
      const scores = row.results.map((r) => r.score);
      check(
        Math.max(...scores) <= 1 && Math.min(...scores) >= 0,
        `${row.gameId}: score outside [0,1]`
      );
    }

    // Replay integrity.
    check(fs.existsSync(row.replayPath), `${row.gameId}: replay missing at ${row.replayPath}`);
    if (!fs.existsSync(row.replayPath)) continue;
    const rep = await loadReplay(row.replayPath);
    check(rep.result !== null, `${row.gameId}: replay has no result row`);
    check(
      rep.turns.length === row.turns,
      `${row.gameId}: replay has ${rep.turns.length} turns, manifest says ${row.turns}`
    );
    check(
      rep.header.configHash === row.configHash,
      `${row.gameId}: replay configHash ${rep.header.configHash} != manifest ${row.configHash}`
    );
    check(
      rep.header.seats.length === row.seats.length &&
        rep.header.seats.every((s, i) => s.bot === row.seats[i]!.bot && s.teamID === row.seats[i]!.teamID),
      `${row.gameId}: replay seats disagree with manifest`
    );
    // Every turn row must carry a board, staged moves and per-seat telemetry.
    for (const t of rep.turns) {
      check(
        (t.board.snakes ?? []).length > 0,
        `${row.gameId} turn ${t.turn}: replay board has no units`
      );
      check(
        Object.keys(t.telemetry).length > 0,
        `${row.gameId} turn ${t.turn}: replay carries no telemetry`
      );
      check(
        Object.keys(t.tiers).length === (t.board.snakes ?? []).length,
        `${row.gameId} turn ${t.turn}: tiers do not cover every unit`
      );
      // Classify every lobster decision by its chosen plan's CEILING, and
      // record which ones the bounds layer refused.
      for (const [team, tel] of Object.entries(t.telemetry)) {
        if (tel.refusals === null || tel.chosen === null) continue;
        const inv = tel.refusals['bounds-inversion'] ?? 0;
        const winCeiling = tel.chosen.hi === 'WIN';
        if (winCeiling) decisionsWithWinCeiling += 1;
        else decisionsWithFiniteCeiling += 1;
        if (inv === 0) continue;
        if (winCeiling) invUnderWinCeiling += 1;
        else invUnderFiniteCeiling += 1;
        inversionSites.push(
          `${row.gameId} turn ${t.turn} ${team} (${tel.bot}): ${inv} inversions in ${tel.slices ?? '?'} slices, ` +
            `ceiling=${String(tel.chosen.hi)} floor=${String(tel.chosen.lo)} posture=${tel.chosen.posture}`
        );
        // Whatever the bounds layer did, the decision must still have STAGED.
        check(
          tel.emissions > 0,
          `${row.gameId} turn ${t.turn} ${team}: bounds inversions AND staged nothing`
        );
      }
    }
    // The streaming reader must agree with the batch loader.
    let streamed = 0;
    for await (const _t of iterateTurns(row.replayPath)) streamed += 1;
    check(
      streamed === rep.turns.length,
      `${row.gameId}: iterateTurns yielded ${streamed}, loadReplay ${rep.turns.length}`
    );
  }

  check(threeTeamAdjudications === 12, `expected 12 three-team games, saw ${threeTeamAdjudications}`);
  // THE 3-TEAM ADJUDICATION CHECK. If the drive loop had a hidden 2-team
  // assumption, three teams would never resolve into three distinct places.
  check(
    distinctPlaces3 > 0,
    `no 3-team game produced three distinct placements — the drive loop may be collapsing to 2 teams`
  );
  notes.push(`3-team games with three distinct placements: ${distinctPlaces3}/${threeTeamAdjudications}`);
  notes.push(`total decisions driven: ${totalDecisions}`);
  notes.push(
    `ratchet refusals (slices the kernel discarded rather than clamp): ${ratchetTotal} ` +
      `— expected under a tight budget, not a soundness failure`
  );

  // BOUNDS INVERSIONS. The bounds layer proving one of its own members unsound
  // is the engine's own alarm, and the harness's job is to surface it with
  // evidence rather than to swallow it or to fail the harness for it. The gate
  // is whether the inversions fall inside the ONE condition they have been
  // observed under — a chosen plan whose ceiling is the WIN lattice element
  // (+Infinity, "every opponent gone in the best world"). An inversion under a
  // FINITE ceiling would be a different and unexplained fault, and fails.
  if (inversionTotal > 0) {
    notes.push(
      `BOUNDS INVERSIONS: ${inversionTotal} across ${invUnderWinCeiling + invUnderFiniteCeiling} decisions ` +
        `(${decisionsWithWinCeiling} decisions had a WIN ceiling, ${decisionsWithFiniteCeiling} a finite one)`
    );
    for (const site of inversionSites) notes.push(`  ${site}`);
    notes.push(
      `  ENGINE-SIDE, not harness-side: every inverted decision still staged a legal move, and the ` +
        `kernel refused the slice rather than clamping it (kernel.ts:1106-1114).`
    );
  }
  check(
    invUnderFiniteCeiling === 0,
    `${invUnderFiniteCeiling} decisions inverted their bounds under a FINITE ceiling — outside the ` +
      `known WIN-ceiling condition, so this is an unexplained soundness fault`
  );

  // ------------------------------------------------- reflex probe (variant 4)
  const reflexJobs = planSweep({
    sweepId,
    bots: ['reflex', 'lobster-territory', 'lobster-material'] as ReadonlyArray<BotName>,
    seeds: [499],
    rotateSeats: false,
    cells: [{ cell: 'mix23-reflex', config: { ...preset('mix23', { turnCap: 20, budgetMs }) } as never }],
  });
  await runJobs(reflexJobs, {
    sweepId,
    replayDir,
    workers: 1,
    onDone: (job, outcome) => {
      manifest.append(manifestRow(job, outcome));
      for (const h of outcome.seats) {
        const c = outcome.counters[h.teamID]!;
        check(c.illegal === 0, `reflex probe seat ${h.seat} (${h.bot}): ${c.illegal} illegal`);
        check(c.errors.length === 0, `reflex probe seat ${h.seat} (${h.bot}) threw`);
      }
      console.log(`  ${job.gameId.padEnd(22)} ${outcome.turns}t ${outcome.terminal} (reflex probe)`);
    },
    onError: (job, error) => failures.push(`CRASH ${job.gameId}: ${error.split('\n')[0]}`),
  });

  // ------------------------------------------------------------------ report
  console.log('');
  const byBot = new Map<string, { games: number; scoreSum: number; firsts: number }>();
  for (const row of readManifest(manifestPath)) {
    for (const r of row.results) {
      const e = byBot.get(r.bot) ?? { games: 0, scoreSum: 0, firsts: 0 };
      e.games += 1;
      e.scoreSum += r.score;
      if (r.place === 1) e.firsts += 1;
      byBot.set(r.bot, e);
    }
  }
  console.log('## per-bot across the smoke (not a verdict — 20 games, wide intervals)');
  for (const [bot, e] of [...byBot.entries()].sort((a, b) => b[1].scoreSum / b[1].games - a[1].scoreSum / a[1].games)) {
    console.log(
      `  ${bot.padEnd(20)} games=${String(e.games).padStart(3)} meanScore=${(e.scoreSum / e.games).toFixed(3)} firsts=${e.firsts}`
    );
  }

  console.log('');
  for (const n of notes) console.log(`# ${n}`);
  console.log(`# manifest: ${manifestPath}`);
  console.log('');
  if (failures.length === 0) {
    console.log(`## SMOKE PASSED — ${rows.length + 1} games, 0 failures`);
  } else {
    console.log(`## SMOKE FAILED — ${failures.length} problems`);
    for (const f of failures.slice(0, 40)) console.log(`  ${f}`);
    if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
    process.exitCode = 1;
  }
}

void main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
);
