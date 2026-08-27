/**
 * RUNNING A JOB LIST — in this process, or across forked children.
 *
 * WHY FORKS AND NOT THREADS. A match is strictly sequential: seat 0 decides,
 * then seat 1, then the resolver runs. There is no parallelism to find INSIDE a
 * game, so the unit of parallelism is the whole game. Forks give each game its
 * own heap — which matters because the legacy path's `DecisionWorkerPool` is a
 * process-wide singleton and the lobster substrate keeps a module-level geometry
 * cache, so two games in one process share state that a sweep would rather keep
 * apart.
 *
 * THE POOL-SIZE TRAP. The legacy path spawns `max(2, cpus - 1)` worker THREADS
 * per process unless `DECISION_POOL_SIZE` says otherwise. On a 4-CPU box, three
 * forked children would each spawn 3 threads — 9 threads plus 3 mains on 4
 * cores, and every decision measured under contention that production never
 * has. `poolSizeFor` divides the box between the children instead, and the
 * value is passed down in the child's environment.
 */

import { fork, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeBot, shutdownDecisionPool, type Bot, type BotName } from './bots';
import { runMatch, type MatchOutcome } from './match';
import type { SweepJob } from './sweep';

export interface RunOptions {
  readonly sweepId: string;
  readonly replayDir: string;
  /** 1 = this process; >1 forks that many children. */
  readonly workers: number;
  /** Overrides the derived DECISION_POOL_SIZE. */
  readonly poolSize?: number;
  /**
   * Where the legacy path's per-snake decision telemetry goes.
   *
   * `recordDecisionTelemetry` (decision-telemetry.ts:32-42) writes to
   * `DECISION_TELEMETRY_FILE` when it is set and `console.log`s otherwise —
   * one line per snake per decision, which on a 300-game sweep buries the
   * progress output entirely. Pointing it at a file both quiets the sweep and
   * KEEPS the data, which is worth keeping: it is where `statesEvaluated` and
   * `deadlineHit` live, and it is the only direct evidence of how much search
   * the legacy path actually got done inside its budget.
   *
   * Defaults to `<replayDir>/legacy-decision-telemetry.jsonl`.
   */
  readonly telemetryFile?: string;
  readonly onDone?: (job: SweepJob, outcome: MatchOutcome) => void;
  readonly onError?: (job: SweepJob, error: string) => void;
}

function telemetryPathFor(opts: RunOptions): string {
  return opts.telemetryFile ?? path.join(opts.replayDir, 'legacy-decision-telemetry.jsonl');
}

/**
 * Decision-pool threads per child so the box is divided, not oversubscribed.
 * One child gets the production sizing; N children split the cores N ways, with
 * a floor of 1 (0 would mean inline evaluation, which is a different regime).
 */
export function poolSizeFor(workers: number): number {
  const cpus = os.cpus().length;
  if (workers <= 1) return Math.max(2, cpus - 1);
  return Math.max(1, Math.floor(cpus / workers));
}

/** Run every job in THIS process, sequentially. */
export async function runInline(jobs: ReadonlyArray<SweepJob>, opts: RunOptions): Promise<void> {
  fs.mkdirSync(opts.replayDir, { recursive: true });
  // Read at call time by `recordDecisionTelemetry`, so setting it here is
  // enough — no module has to be loaded in a particular order.
  process.env.DECISION_TELEMETRY_FILE = telemetryPathFor(opts);
  // Bots are rebuilt per game: a TeamDecisionEngine carries per-game ledger
  // state and the legacy engine's expensive part (the worker pool) is a
  // process-wide singleton that survives anyway.
  for (const job of jobs) {
    let bots: Bot[] | undefined;
    try {
      bots = job.bots.map((b) => makeBot(b as BotName));
      const outcome = await runMatch({
        config: job.config,
        bots: job.bots,
        sweepId: opts.sweepId,
        gameId: job.gameId,
        replayDir: opts.replayDir,
        made: bots,
      });
      opts.onDone?.(job, outcome);
    } catch (err) {
      opts.onError?.(job, String((err as Error)?.stack ?? err));
    } finally {
      if (bots) for (const b of bots) b.release();
    }
  }
  // The legacy pool is kept warm across games and shut down once, here.
  shutdownDecisionPool();
}

interface WorkerMsg {
  readonly type: 'done' | 'error' | 'ready';
  readonly jobIndex?: number;
  readonly outcome?: MatchOutcome;
  readonly error?: string;
}

/**
 * Fork `workers` children and hand each the next job as it frees up — a work
 * queue rather than a static split, so one slow game does not leave a core idle
 * while another child still has ten jobs queued.
 */
export async function runForked(jobs: ReadonlyArray<SweepJob>, opts: RunOptions): Promise<void> {
  const workerScript = path.join(__dirname, '..', 'bin', 'match-worker.js');
  const poolSize = opts.poolSize ?? poolSizeFor(opts.workers);
  fs.mkdirSync(opts.replayDir, { recursive: true });
  const telemetryFile = telemetryPathFor(opts);
  /** A child that dies is replaced, but not endlessly — a systematically fatal
   * job would otherwise spawn children forever. */
  const MAX_RESPAWNS = opts.workers * 4;

  let next = 0;
  let completed = 0;
  let respawns = 0;

  await new Promise<void>((resolve, reject) => {
    /** The job each live child is currently holding, so a death can report it. */
    const inFlight = new Map<ChildProcess, SweepJob>();
    const children = new Set<ChildProcess>();
    let finished = false;

    const settle = (): void => {
      if (finished) return;
      if (completed < jobs.length) return;
      finished = true;
      for (const c of children) {
        c.removeAllListeners('exit');
        c.kill();
      }
      resolve();
    };

    const pump = (child: ChildProcess): void => {
      if (finished) return;
      if (next >= jobs.length) {
        // Nothing left to hand out. This child is done; the sweep finishes
        // when the last outstanding job reports.
        settle();
        return;
      }
      const job = jobs[next++]!;
      inFlight.set(child, job);
      child.send({ type: 'job', job, sweepId: opts.sweepId, replayDir: opts.replayDir });
    };

    const spawn = (index: number): void => {
      const child = fork(workerScript, [], {
        env: {
          ...process.env,
          DECISION_POOL_SIZE: String(poolSize),
          DECISION_TELEMETRY_FILE: telemetryFile,
          SWEEP_WORKER_INDEX: String(index),
        },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      children.add(child);

      child.on('message', (raw: WorkerMsg) => {
        if (raw.type === 'ready') {
          pump(child);
          return;
        }
        const job = inFlight.get(child);
        inFlight.delete(child);
        if (job !== undefined) {
          completed += 1;
          if (raw.type === 'done' && raw.outcome !== undefined) opts.onDone?.(job, raw.outcome);
          else opts.onError?.(job, raw.error ?? 'unknown worker error');
        }
        pump(child);
      });

      child.on('error', (err) => {
        if (!finished) reject(err);
      });

      child.on('exit', (code, signal) => {
        if (finished) return;
        children.delete(child);
        // A child that dies mid-job strands that job. Charge it as failed and
        // replace the child: losing one game to a crash must not cost the
        // other 299, and must not hang the sweep waiting on a dead worker.
        const job = inFlight.get(child);
        inFlight.delete(child);
        if (job !== undefined) {
          completed += 1;
          opts.onError?.(job, `worker died (code=${code} signal=${signal}) during ${job.gameId}`);
        }
        if (next < jobs.length && respawns < MAX_RESPAWNS) {
          respawns += 1;
          spawn(index);
        } else {
          settle();
        }
      });
    };

    for (let i = 0; i < opts.workers; i++) spawn(i);
  });
}

export async function runJobs(jobs: ReadonlyArray<SweepJob>, opts: RunOptions): Promise<void> {
  if (opts.workers <= 1) return runInline(jobs, opts);
  return runForked(jobs, opts);
}
