/**
 * THE SWEEP CLI — the entry point a stage-1 sweep agent calls.
 *
 *   node build/bin/run-sweep.js --spec /path/to/spec.json [--workers 3] [--dry]
 *
 * The spec is JSON:
 *
 *   {
 *     "sweepId": "food-cadence-01",
 *     "bots": ["lobster-territory", "lobster-material", "reflex"],
 *     "seeds": [101, 102, 103, 104],
 *     "rotateSeats": true,
 *     "cells": [
 *       { "cell": "food-0.25", "config": { "preset": "mix23", "food": { "spawnRate": 0.25 } } },
 *       { "cell": "food-1.00", "config": { "preset": "mix23", "food": { "spawnRate": 1.00 } } }
 *     ]
 *   }
 *
 * A cell's `config` is either a full config object or `{ "preset": "<name>",
 * ...overrides }`. `seed` is supplied by the sweep and must not appear in a
 * cell.
 *
 * OUTPUT, under <replays>/<sweepId>/:
 *   manifest.jsonl   one row per game — everything aggregation needs
 *   <gameId>.jsonl.gz  one replay per game
 *   spec.json        the spec as run, and the resolved plan summary
 *
 * `--dry` plans and prints the job list without playing anything, so a sweep
 * can be counted and costed first.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BOT_NAMES, isBotName, type BotName } from '../lib/bots';
import { normalizeConfig, type MatchConfigInput } from '../lib/config';
import { describeConfig } from '../lib/match';
import { preset, PRESET_NAMES } from '../lib/presets';
import { poolSizeFor, runJobs } from '../lib/runner';
import { ManifestWriter, manifestRow, planSweep, readManifest, type SweepJob, type SweepSpec } from '../lib/sweep';
import { resolveOutRoot } from '../lib/outdir';

const REPLAY_ROOT = resolveOutRoot();

interface CellSpec {
  readonly cell: string;
  readonly config: Record<string, unknown> & { preset?: string };
}

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : dflt;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/**
 * The `bundle.json` build-bot.sh wrote next to this build, or null.
 *
 * `__dirname` is `<bundle>/harness/build/bin`, so the stamp is four levels up.
 * Null is not an error here — someone may be running the harness out of a
 * hand-made tree — but an arm whose manifest carries `bundle: null` cannot have
 * its git SHA quoted in a findings table, and the batch manifest says so.
 */
function readBundleStamp(): unknown {
  const p = path.resolve(__dirname, '..', '..', '..', 'bundle.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The engine-selecting environment, verbatim.
 *
 * These are the flags that change what the bot IS. Recording the whole
 * environment would leak the operator's machine into a committed artifact;
 * recording none of them makes two arms of a flag experiment indistinguishable
 * in the record, which is worse. So: exactly the engine flags, present or
 * absent, with absent written as `null` rather than dropped — "the flag was
 * unset" and "nobody looked" must not render the same.
 */
const ENGINE_ENV_KEYS = [
  'CENTAUR_ENGINE',
  'CENTAUR_STAGING_SAFETY',
  'CENTAUR_TIER_TRUTH',
  'CENTAUR_TIER_DEFENSE',
  'CENTAUR_ROYAL_MARGIN',
  'CENTAUR_WASM',
  'CENTAUR_WORKERS',
  'CENTAUR_WORKERS_AUDIT',
  'CENTAUR_COHORT_POLICY',
  'CENTAUR_CLUSTER_SEED',
  'CENTAUR_UNIT_FATALITY',
] as const;

function capturedEnv(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of ENGINE_ENV_KEYS) out[k] = process.env[k] ?? null;
  return out;
}

/** A cell's config: a preset plus overrides, or a literal config object. */
function resolveCell(spec: CellSpec): MatchConfigInput {
  const { preset: presetName, ...rest } = spec.config;
  if (presetName === undefined) return rest as unknown as MatchConfigInput;
  if (!PRESET_NAMES.includes(presetName)) {
    throw new Error(`cell "${spec.cell}" names unknown preset "${presetName}"; known: ${PRESET_NAMES.join(', ')}`);
  }
  // Round-trip through `preset` so overrides merge per-group rather than
  // clobbering a whole group (setting food.spawnRate must not drop food.initial).
  return preset(presetName, rest as Partial<MatchConfigInput>) as unknown as MatchConfigInput;
}

async function main(): Promise<void> {
  const specPath = arg('spec', '');
  if (specPath === '') throw new Error('--spec <file.json> is required');
  const raw = JSON.parse(fs.readFileSync(specPath, 'utf8')) as SweepSpec & { cells: CellSpec[] };

  const bots = raw.bots ?? [];
  for (const b of bots) {
    if (!isBotName(b)) throw new Error(`unknown bot "${b}"; known: ${BOT_NAMES.join(', ')}`);
  }
  if (bots.length === 0) throw new Error('spec.bots must name at least one bot');
  if (!Array.isArray(raw.seeds) || raw.seeds.length === 0) {
    throw new Error('spec.seeds must be a non-empty array of integers');
  }

  const spec: SweepSpec = {
    sweepId: raw.sweepId,
    bots: bots as ReadonlyArray<BotName>,
    seeds: raw.seeds,
    rotateSeats: raw.rotateSeats,
    cells: raw.cells.map((c) => ({ cell: c.cell, config: resolveCell(c) })),
  };

  const jobs = planSweep(spec);
  const replayDir = path.join(REPLAY_ROOT, spec.sweepId);
  const manifestPath = path.join(replayDir, 'manifest.jsonl');
  const workers = Number(arg('workers', '1'));
  const poolSize = Number(arg('poolSize', String(poolSizeFor(workers))));

  console.log(`# sweep ${spec.sweepId}`);
  console.log(`# ${spec.cells.length} cells x ${spec.seeds.length} seeds x ${spec.rotateSeats === false ? 1 : bots.length} rotations = ${jobs.length} games`);
  console.log(`# bots: ${bots.join(', ')}`);
  console.log(`# workers=${workers} DECISION_POOL_SIZE=${poolSize} cpus=${os.cpus().length} node=${process.version}`);
  console.log(`# replays -> ${replayDir}`);

  // Cell summaries: the resolved facts, so a misconfigured cell is visible
  // before hundreds of games are spent on it.
  for (const { cell, config } of spec.cells) {
    const c = normalizeConfig({ ...config, seed: spec.seeds[0]! } as MatchConfigInput);
    const d = describeConfig(c);
    const regimes = Object.entries(d.hazardRegimes)
      .map(([k, v]) => `${k}:${v.regime}(${v.doses}d)`)
      .join(' ');
    console.log(
      `#   ${cell}: ${c.size}x${c.size} ${c.teams.length}t budget=${c.budgetMs}ms cap=${c.turnCap} ` +
        `food=${c.food.initial}+${c.food.spawnRate}/t hazards=${c.hazards.layout}@${d.hazardDamage} ` +
        `fertile=${c.fertile.enabled} potions=${c.potions.enabled}${regimes ? ` [${regimes}]` : ''}`
    );
  }

  if (flag('dry')) {
    for (const j of jobs) console.log(`  ${j.gameId}  seats=${j.bots.join(',')}  block=${j.block}`);
    console.log(`# dry run: ${jobs.length} games planned, nothing played`);
    return;
  }

  fs.mkdirSync(replayDir, { recursive: true });

  /*
   * RESUME. `ManifestWriter.append` is an `appendFileSync` per finished game, so
   * a batch killed at 3am — a laptop that slept, a WSL VM the host suspended, an
   * OOM — leaves every completed game on disk and intact. `--resume` reads those
   * back and plays only what is missing.
   *
   * Resume is BY gameId, and a gameId encodes cell + seed + rotation, so a
   * resumed run cannot silently replay a game under a different board or a
   * different seat assignment. It CAN, though, play the remainder under a
   * different machine load than the first part ran under, which is exactly the
   * budget-noise hazard METHODOLOGY.md §4 is about: the resumption is stamped
   * into the sweep's `spec.json` as a `resumedAt` record so an aggregation can
   * see that a cell straddles two load regimes, and findings.md must say so.
   *
   * A PAIRED arm must be resumed TOGETHER WITH ITS PARTNER or not at all —
   * resuming one arm alone re-runs its remainder against a load its partner
   * never saw, and the pair stops being a pair. run-pair.js resumes both.
   */
  const resume = flag('resume');
  const alreadyDone = new Set(resume ? readManifest(manifestPath).map((r) => r.gameId) : []);
  const pending = jobs.filter((j) => !alreadyDone.has(j.gameId));
  if (resume) {
    console.log(`# resume: ${alreadyDone.size} games already in the manifest, ${pending.length} to play`);
    if (pending.length === 0) {
      console.log('# nothing to do — this sweep is already complete');
      return;
    }
  }

  const specPathOut = path.join(replayDir, 'spec.json');
  const priorSpec = fs.existsSync(specPathOut)
    ? (JSON.parse(fs.readFileSync(specPathOut, 'utf8')) as Record<string, unknown>)
    : {};
  const resumedAt = Array.isArray(priorSpec.resumedAt) ? (priorSpec.resumedAt as unknown[]) : [];
  if (resume && alreadyDone.size > 0) {
    resumedAt.push({ at: new Date().toISOString(), had: alreadyDone.size, playing: pending.length, loadavg: os.loadavg() });
  }
  fs.writeFileSync(
    specPathOut,
    JSON.stringify(
      {
        spec: raw,
        resolved: spec,
        games: jobs.length,
        workers,
        poolSize,
        // Provenance: which BUILD produced these games. An arm is a (bundle,
        // env) pair, and a manifest that does not say which bundle it came from
        // cannot be paired against anything with a straight face.
        bundle: readBundleStamp(),
        env: capturedEnv(),
        host: {
          node: process.version,
          platform: process.platform,
          cpus: os.cpus().length,
          totalmemGb: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
          loadavgAtStart: os.loadavg(),
        },
        startedAt: new Date().toISOString(),
        resumedAt,
      },
      null,
      1
    )
  );

  const manifest = new ManifestWriter(manifestPath);
  const started = Date.now();
  let done = alreadyDone.size;
  let failed = 0;

  await runJobs(pending, {
    sweepId: spec.sweepId,
    replayDir,
    workers,
    poolSize,
    onDone: (job: SweepJob, outcome) => {
      manifest.append(manifestRow(job, outcome));
      done += 1;
      const rate = (done / ((Date.now() - started) / 3_600_000)).toFixed(0);
      const top = [...outcome.placements].sort((a, b) => a.place - b.place)[0];
      console.log(
        `[${done}/${jobs.length}] ${job.gameId} ${outcome.turns}t ${outcome.terminal} ` +
          `winner=${top?.bot ?? '-'} (${top?.teamID ?? '-'}) ${(outcome.wallMs / 1000).toFixed(1)}s ~${rate} games/h`
      );
    },
    onError: (job, error) => {
      failed += 1;
      console.error(`[FAIL] ${job.gameId}: ${error.split('\n')[0]}`);
    },
  });

  const elapsed = (Date.now() - started) / 1000;
  // Rate is over the games THIS invocation played, never over the resumed
  // total: a resumed run that inherits 200 games and plays 4 did not just do
  // 204 games in ninety seconds, and a throughput figure that says so would be
  // quoted at face value later.
  const playedNow = done - alreadyDone.size;
  console.log('');
  console.log(`# ${playedNow} games in ${elapsed.toFixed(1)}s (${failed} failed)${alreadyDone.size > 0 ? `, ${alreadyDone.size} resumed` : ''}`);
  console.log(`# ${((playedNow / elapsed) * 3600).toFixed(0)} games/hour at ${workers} worker(s)`);
  console.log(`# loadavg at end: ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  console.log(`# manifest: ${manifestPath}`);
  if (done < jobs.length) {
    console.log(`# INCOMPLETE: ${jobs.length - done} of ${jobs.length} games never finished — rerun with --resume`);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
);
