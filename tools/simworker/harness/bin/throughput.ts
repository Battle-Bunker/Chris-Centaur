/**
 * THROUGHPUT — games/hour at a real budget, single process and forked.
 *
 *   node build/bin/throughput.js [--games 6] [--workers 1,2,3] [--cap 60]
 *                                [--budget 150] [--preset mix23]
 *                                [--bots lobster-territory,lobster-material,reflex]
 *
 * The number a sweep planner actually needs is games/hour for the WHOLE box,
 * not per worker, so that is what the table reports. Each arm plays the same
 * job list from the same seeds, so the arms differ only in how the work was
 * spread.
 *
 * Replays are written under a `throughput-<n>w` sweep id and kept, like every
 * other replay — a throughput run is still real games and a miner may want them.
 */

import * as os from 'os';
import * as path from 'path';
import { isBotName, type BotName } from '../lib/bots';
import { preset } from '../lib/presets';
import { poolSizeFor, runJobs } from '../lib/runner';
import { planSweep, type SweepJob } from '../lib/sweep';
import { resolveOutRoot } from '../lib/outdir';

const REPLAY_ROOT = resolveOutRoot();

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : dflt;
}

interface Arm {
  readonly workers: number;
  readonly poolSize: number;
  readonly games: number;
  readonly failed: number;
  readonly elapsedS: number;
  readonly gamesPerHour: number;
  readonly meanTurns: number;
  readonly meanGameS: number;
  readonly decisions: number;
  readonly msPerDecision: number;
  readonly turns: number;
  /**
   * Decisions per hour for the whole box.
   *
   * THE HONEST PARALLEL-EFFICIENCY NUMBER. games/hour is what a sweep planner
   * budgets with, but it is not a clean speedup measure here: the bots are
   * ANYTIME, so under different CPU contention they search different amounts,
   * choose different moves, and the games end at different lengths. Arms are
   * therefore not replaying the same games even from the same seeds. Decisions
   * (and turns) per hour normalize that away — a decision costs one budget
   * whatever the game does around it.
   */
  readonly decisionsPerHour: number;
  readonly turnsPerHour: number;
}

async function main(): Promise<void> {
  const games = Number(arg('games', '6'));
  const workerArms = arg('workers', '1,2,3').split(',').map(Number);
  const cap = Number(arg('cap', '60'));
  const budgetMs = Number(arg('budget', '150'));
  const presetName = arg('preset', 'mix23');
  const bots = arg('bots', 'lobster-territory,lobster-material,reflex').split(',');
  for (const b of bots) if (!isBotName(b)) throw new Error(`unknown bot "${b}"`);

  const config = preset(presetName, { turnCap: cap, budgetMs });
  const seeds = Array.from({ length: games }, (_, i) => 1000 + i);

  console.log(`# THROUGHPUT  ${config.size}x${config.size} ${config.teams.length} teams ` +
    `${Array.isArray(config.roster) ? config.roster.length : '?'} units/team`);
  console.log(`# budget=${budgetMs}ms turnCap=${cap} bots=${bots.join(',')}`);
  console.log(`# node=${process.version} cpus=${os.cpus().length} loadavg=${os.loadavg().map((l) => l.toFixed(2)).join(' ')}`);
  console.log(`# ${games} games per arm, rotateSeats off (throughput, not fairness)`);
  console.log('');

  const arms: Arm[] = [];

  for (const workers of workerArms) {
    const sweepId = `throughput-${workers}w`;
    const jobs: SweepJob[] = planSweep({
      sweepId,
      bots: bots as ReadonlyArray<BotName>,
      seeds,
      rotateSeats: false,
      cells: [{ cell: presetName, config: { ...config } as never }],
    });
    const replayDir = path.join(REPLAY_ROOT, `${sweepId}-${Date.now()}`);
    const poolSize = poolSizeFor(workers);

    let done = 0;
    let failed = 0;
    let turns = 0;
    let decisions = 0;
    let decisionMs = 0;
    let gameMs = 0;

    const started = Date.now();
    await runJobs(jobs, {
      sweepId,
      replayDir,
      workers,
      poolSize,
      onDone: (_job, outcome) => {
        done += 1;
        turns += outcome.turns;
        gameMs += outcome.wallMs;
        for (const c of Object.values(outcome.counters)) {
          decisions += c.decisions;
          decisionMs += c.totalWallMs;
        }
      },
      onError: (job, err) => {
        failed += 1;
        console.error(`  [FAIL] ${job.gameId}: ${err.split('\n')[0]}`);
      },
    });
    const elapsedS = (Date.now() - started) / 1000;

    const arm: Arm = {
      workers,
      poolSize,
      games: done,
      failed,
      elapsedS,
      gamesPerHour: (done / elapsedS) * 3600,
      meanTurns: done === 0 ? 0 : turns / done,
      meanGameS: done === 0 ? 0 : gameMs / done / 1000,
      decisions,
      msPerDecision: decisions === 0 ? 0 : decisionMs / decisions,
      turns,
      decisionsPerHour: (decisions / elapsedS) * 3600,
      turnsPerHour: (turns / elapsedS) * 3600,
    };
    arms.push(arm);
    console.log(
      `workers=${arm.workers} pool=${arm.poolSize}  ${arm.games} games in ${arm.elapsedS.toFixed(1)}s  ` +
        `=> ${arm.gamesPerHour.toFixed(0)} games/hour  ` +
        `(mean ${arm.meanTurns.toFixed(1)} turns, ${arm.meanGameS.toFixed(1)}s/game wall, ` +
        `${arm.msPerDecision.toFixed(0)}ms/decision, ${arm.failed} failed)`
    );
  }

  console.log('');
  console.log('## games/hour for the whole box (what a sweep budgets with)');
  const base = arms[0]?.gamesPerHour ?? 1;
  for (const a of arms) {
    console.log(
      `  ${String(a.workers).padStart(2)} worker(s): ${a.gamesPerHour.toFixed(0).padStart(6)} games/h` +
        `   speedup ${(a.gamesPerHour / base).toFixed(2)}x   (mean ${a.meanTurns.toFixed(1)} turns/game)`
    );
  }
  console.log('');
  console.log('## decisions/hour (parallel efficiency, normalized for game length)');
  const dbase = arms[0]?.decisionsPerHour ?? 1;
  for (const a of arms) {
    console.log(
      `  ${String(a.workers).padStart(2)} worker(s): ${a.decisionsPerHour.toFixed(0).padStart(6)} dec/h` +
        `   speedup ${(a.decisionsPerHour / dbase).toFixed(2)}x`
    );
  }
  console.log('');
  console.log(JSON.stringify({ arms, cap, budgetMs, preset: presetName, bots }));
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
);
