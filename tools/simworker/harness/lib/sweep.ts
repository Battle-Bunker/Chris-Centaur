/**
 * SWEEP ORCHESTRATION — job planning, seat rotation, and the manifest.
 *
 * A sweep is a list of JOBS. One job is one game: a config (which already
 * carries its seed), a bot per seat, and the ids the replay will be filed
 * under. Planning is pure and deterministic, so a sweep can be planned, counted
 * and costed before a single game runs, and re-planning the same spec yields
 * the same job list in the same order.
 *
 * SEAT ROTATION. Board geometry is not symmetric — on a 3-team board the three
 * anchors are a corner, the opposite corner and a third corner, so two seats
 * share a column and two share a row while the remaining pair sits on the long
 * diagonal. A bot that only ever occupied seat 0 would be measured on one
 * geometry. Each seed block therefore plays N games, CYCLICALLY ROTATING the
 * bots through the seats:
 *
 *     [A B C]   [C A B]   [B C A]
 *
 * which puts every bot in every seat exactly once and — the part a plain
 * "rotate the bots" argument misses — also gives every unordered PAIR of bots
 * every seat-pair exactly once. So neither seat advantage nor adjacency
 * advantage survives the block, and the block, not the game, is the unit a
 * stage-2 aggregation should resample.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BotName } from './bots';
import { configHash, normalizeConfig, type MatchConfig, type MatchConfigInput } from './config';
import { describeConfig, type MatchOutcome } from './match';

export interface SweepJob {
  readonly jobIndex: number;
  readonly gameId: string;
  readonly config: MatchConfig;
  readonly bots: ReadonlyArray<BotName>;
  /** Which cyclic rotation of the bot list this game is. */
  readonly rotation: number;
  /** The seed block this game belongs to — the unit of resampling. */
  readonly block: string;
  /** The named cell of the sweep this game belongs to. */
  readonly cell: string;
}

export interface SweepSpec {
  readonly sweepId: string;
  /** One entry per sweep CELL: a named config shape. Seeds are added per cell. */
  readonly cells: ReadonlyArray<{ readonly cell: string; readonly config: MatchConfigInput }>;
  /** The bots to seat, in the order rotation 0 seats them. */
  readonly bots: ReadonlyArray<BotName>;
  readonly seeds: ReadonlyArray<number>;
  /** Play every cyclic rotation (default) or only rotation 0. */
  readonly rotateSeats?: boolean;
}

/** Cyclic rotations of `xs`: rotation r puts xs[(i - r + n) % n] in seat i. */
export function rotations<T>(xs: ReadonlyArray<T>): T[][] {
  const n = xs.length;
  const out: T[][] = [];
  for (let r = 0; r < n; r++) {
    out.push(Array.from({ length: n }, (_, i) => xs[(i - r + n) % n] as T));
  }
  return out;
}

export function planSweep(spec: SweepSpec): SweepJob[] {
  const jobs: SweepJob[] = [];
  const rotate = spec.rotateSeats !== false;

  for (const { cell, config: input } of spec.cells) {
    for (const seed of spec.seeds) {
      const config = normalizeConfig({ ...input, seed } as MatchConfigInput);
      if (config.teams.length !== spec.bots.length) {
        throw new Error(
          `cell "${cell}" has ${config.teams.length} teams but the sweep seats ${spec.bots.length} bots`
        );
      }
      const block = `${cell}#${seed}`;
      const seatings = rotate ? rotations(spec.bots) : [[...spec.bots]];
      seatings.forEach((bots, rotation) => {
        jobs.push({
          jobIndex: jobs.length,
          gameId: `${cell}-s${seed}-r${rotation}`,
          config,
          bots,
          rotation,
          block,
          cell,
        });
      });
    }
  }
  return jobs;
}

// ------------------------------------------------------------------ manifest

/**
 * One manifest row per game.
 *
 * The manifest exists so aggregation NEVER has to re-parse a replay. Everything
 * a stage-2 roll-up needs to group, filter and score is here; the replay is for
 * the questions the manifest cannot answer.
 */
export interface ManifestRow {
  readonly sweepId: string;
  readonly gameId: string;
  readonly cell: string;
  readonly block: string;
  readonly rotation: number;
  readonly configHash: string;
  readonly seed: number;
  readonly configName: string | null;
  /** Resolved shape facts, so a roll-up can bucket without loading the config. */
  readonly size: number;
  readonly teamCount: number;
  readonly unitsPerTeam: number;
  readonly budgetMs: number;
  readonly turnCap: number;
  readonly hazardDamage: number;
  readonly hazardLayout: string;
  readonly foodSpawnRate: number;
  readonly fertile: boolean;
  readonly potions: boolean;
  /** seat -> {teamID, bot}. */
  readonly seats: ReadonlyArray<{ seat: number; teamID: string; bot: BotName }>;
  readonly turns: number;
  readonly endKind: string;
  /** 'decisive' or 'cap' — whether the game ended or merely ran out. */
  readonly terminal: 'decisive' | 'cap';
  readonly reason: string;
  /** Per bot: placement, normalized score, final material. Keyed by SEAT. */
  readonly results: ReadonlyArray<{
    seat: number;
    bot: BotName;
    teamID: string;
    place: number;
    score: number;
    finalUnits: number;
    finalMaterial: number;
    /**
     * The weight the placement was decided on — `finalMaterial` except on a
     * mutual wipe, which TacticToes and this harness both settle from the
     * PREVIOUS committed turn's board. Absent on manifests written before
     * 2026-08-29.
     */
    adjudicatedMaterial?: number;
    /**
     * THE OBJECTIVE: share of total end weight × team count, par 1. Continuous
     * in the weight margin and commensurate across team counts. Absent on
     * manifests written before 2026-08-29.
     */
    sharePar?: number;
    eliminatedOnTurn: number | null;
  }>;
  /** Per seat health counters — a nonzero illegal/error count invalidates a row. */
  readonly health: ReadonlyArray<{
    seat: number;
    bot: BotName;
    decisions: number;
    illegal: number;
    unstaged: number;
    stagedNothing: number;
    overruns: number;
    worstOverrunMs: number;
    worstWallMs: number;
    plansEvaluated: number;
    assumptions: number;
    boundViolations: number;
    boundsInversions: number;
    ratchetRefusals: number;
    /** Deaths by cause, attributed to the team that lost the unit. P7's
     * verdict — exhaustion x1.9 under CENTAUR_CLUSTER_SEED — is this row. */
    deathsSelf: number;
    deathsWall: number;
    deathsExhaustion: number;
    deathsBodyBlock: number;
    deathsContest: number;
    deathsTeammate: number;
    /** CL7's mechanism fold, including the RESOLVED flag stamp. Null on any
     * bundle built before that landed — null and not zero, because a counter a
     * build never had did not read zero, and the ingest reports the difference
     * as UNREADABLE rather than as a null result. */
    mechanism: MatchOutcome['counters'][string]['mechanism'];
    errors: number;
  }>;
  readonly worstHeldObserved: number;
  readonly maxFrozenCapacity: number;
  readonly replayPath: string;
  readonly wallMs: number;
  readonly finishedAt: string;
}

export function manifestRow(job: SweepJob, outcome: MatchOutcome): ManifestRow {
  const { config } = job;
  const roster = Array.isArray(config.roster)
    ? (config.roster as ReadonlyArray<string>).length
    : Object.values(config.roster as Record<string, ReadonlyArray<string>>)[0]?.length ?? 0;
  const desc = describeConfig(config);

  return {
    sweepId: outcome.sweepId,
    gameId: outcome.gameId,
    cell: job.cell,
    block: job.block,
    rotation: job.rotation,
    configHash: configHash(config),
    seed: config.seed,
    configName: config.name ?? null,
    size: config.size,
    teamCount: config.teams.length,
    unitsPerTeam: roster,
    budgetMs: config.budgetMs,
    turnCap: config.turnCap,
    hazardDamage: desc.hazardDamage,
    hazardLayout: config.hazards.layout,
    foodSpawnRate: config.food.spawnRate,
    fertile: config.fertile.enabled,
    potions: config.potions.enabled,
    seats: outcome.seats,
    turns: outcome.turns,
    endKind: outcome.endKind,
    terminal: outcome.terminal,
    reason: outcome.reason,
    results: outcome.placements.map((p) => ({
      seat: p.seat,
      bot: p.bot,
      teamID: p.teamID,
      place: p.place,
      score: p.score,
      finalUnits: p.finalUnits,
      finalMaterial: p.finalMaterial,
      adjudicatedMaterial: p.adjudicatedMaterial,
      sharePar: p.sharePar,
      eliminatedOnTurn: p.eliminatedOnTurn,
    })),
    health: outcome.seats.map((s) => {
      const c = outcome.counters[s.teamID]!;
      return {
        seat: s.seat,
        bot: s.bot,
        decisions: c.decisions,
        illegal: c.illegal,
        unstaged: c.unstaged,
        stagedNothing: c.stagedNothing,
        overruns: c.overruns,
        worstOverrunMs: c.worstOverrunMs,
        worstWallMs: c.worstWallMs,
        plansEvaluated: c.plansEvaluated,
        assumptions: c.assumptions,
        boundViolations: c.boundViolations,
        boundsInversions: c.boundsInversions,
        ratchetRefusals: c.ratchetRefusals,
        deathsSelf: c.deathsSelf,
        deathsWall: c.deathsWall,
        deathsExhaustion: c.deathsExhaustion,
        deathsBodyBlock: c.deathsBodyBlock,
        deathsContest: c.deathsContest,
        deathsTeammate: c.deathsTeammate,
        mechanism: c.mechanism,
        errors: c.errors.length,
      };
    }),
    worstHeldObserved: outcome.worstHeldObserved,
    maxFrozenCapacity: outcome.maxFrozenCapacity,
    replayPath: outcome.replayPath,
    wallMs: outcome.wallMs,
    finishedAt: new Date().toISOString(),
  };
}

/**
 * Append-only manifest writer. One process owns the file — in a forked sweep
 * that is the PARENT, which is why children return outcomes over IPC rather
 * than writing rows themselves. Each row is one `appendFileSync` of a single
 * line, which is atomic enough for a single writer and leaves the file readable
 * while the sweep is still running.
 */
export class ManifestWriter {
  constructor(readonly filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  append(row: ManifestRow): void {
    fs.appendFileSync(this.filePath, `${JSON.stringify(row)}\n`);
  }
}

export function readManifest(filePath: string): ManifestRow[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as ManifestRow);
}
