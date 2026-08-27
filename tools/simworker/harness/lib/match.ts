/**
 * ONE MATCH: N seats, N bots, one board, one replay.
 *
 * The loop is deliberately N-ARY. There is no "us and them" anywhere in it —
 * seats are an array, standings are a map, and adjudication is a sort. A 2-team
 * game is the N=2 case of the same code, which is what keeps a 3-team game from
 * quietly inheriting a two-team assumption. (The prior bench's `runMatch` took
 * `lobsterTeam` / `legacyTeam` / `neutralTeams` and could not have been
 * generalized without rewriting its adjudication, which is why this is a
 * rewrite rather than a parameterization.)
 *
 * TURN SHAPE. Every seat decides on the SAME board, one after another rather
 * than concurrently: a turn costs N x budget of real time, but each bot gets its
 * whole budget on an otherwise-quiet box, which is the regime production runs
 * in. Running them concurrently would measure contention between bots that
 * never share a process.
 *
 * Then: the vendored resolver adjudicates every unit's staged move at once
 * (`resolveFullTurn`), and the game-level layer runs (`stepWorld`) — spawning,
 * potion collection, effect expiry. Nothing here decides a rule.
 */

import type { Board, CentaurMove } from '../src/types/battlesnake';
import { TeamDetector } from '../src/logic/team-detector';
import { tierAtArrival } from '../src/logic/simulator';
import type { Bot, BotName, DecisionTelemetry } from './bots';
import { makeBot } from './bots';
import { buildGame } from './build-game';
import { boardHash, configHash, hazardRegimes, resolveHazardDamage, type MatchConfig } from './config';
import { streamRng } from './rng';
import { judgeLegality, livingTeams, resolveFullTurn, standings, teamAlive, unitsOf } from './sim';
import { emptyWorld, stepWorld } from './world';
import {
  REPLAY_FORMAT_VERSION,
  ReplayWriter,
  type ReplayResult,
  type ReplayStagedMove,
  type ReplayTurn,
} from './replay';
import type { TeamStandingRow } from './match-types';

export interface SeatCounters {
  decisions: number;
  emissions: number;
  illegal: number;
  nonGrammatical: number;
  unstaged: number;
  stagedNothing: number;
  overruns: number;
  worstOverrunMs: number;
  totalWallMs: number;
  worstWallMs: number;
  plansEvaluated: number;
  assumptions: number;
  boundViolations: number;
  /** Genuine unsoundness (`bounds-inversion`). Must be zero. */
  boundsInversions: number;
  /** `ratchet-floor` + `ratchet-gap` — refused slices, not broken bounds. */
  ratchetRefusals: number;
  errors: string[];
}

function emptyCounters(): SeatCounters {
  return {
    decisions: 0,
    emissions: 0,
    illegal: 0,
    nonGrammatical: 0,
    unstaged: 0,
    stagedNothing: 0,
    overruns: 0,
    worstOverrunMs: 0,
    totalWallMs: 0,
    worstWallMs: 0,
    plansEvaluated: 0,
    assumptions: 0,
    boundViolations: 0,
    boundsInversions: 0,
    ratchetRefusals: 0,
    errors: [],
  };
}

/** Why the match stopped. `cap` means nothing was decided — see `terminal`. */
export type EndKind = 'last-team-standing' | 'all-eliminated' | 'cap';

export interface MatchOutcome {
  readonly gameId: string;
  readonly sweepId: string;
  readonly configHash: string;
  readonly boardHash: string;
  readonly seed: number;
  readonly turns: number;
  readonly endKind: EndKind;
  /**
   * `decisive` when the game ENDED on its own (one team left, or all gone);
   * `cap` when it merely ran out of turns and was adjudicated on material.
   * A sweep cell where most games are `cap` is measuring a stall, not play.
   */
  readonly terminal: 'decisive' | 'cap';
  readonly reason: string;
  readonly seats: ReadonlyArray<{ seat: number; teamID: string; bot: BotName }>;
  readonly placements: ReplayResult['placements'];
  readonly counters: Record<string, SeatCounters>;
  readonly replayPath: string;
  readonly wallMs: number;
  /** Held units at the widest point — the MAX_FROZEN headroom check. */
  readonly worstHeldObserved: number;
  readonly maxFrozenCapacity: number;
}

export interface RunMatchOptions {
  readonly config: MatchConfig;
  /** One bot name per seat, in `config.teams` order. */
  readonly bots: ReadonlyArray<BotName>;
  readonly sweepId: string;
  readonly gameId: string;
  readonly replayDir: string;
  /** Pre-made bots, for a runner that reuses them across games in a process. */
  readonly made?: ReadonlyArray<Bot>;
  readonly onTurn?: (turn: number, board: Board) => void;
}

/**
 * Placement scoring for N teams.
 *
 *   1. SURVIVAL ORDER first — a team that outlived another placed above it,
 *      whatever the material said. Teams still standing at the cap all share
 *      the "never eliminated" rank.
 *   2. MATERIAL breaks ties among teams that fell on the same turn (and among
 *      the survivors at the cap).
 *
 * Ties share a placement, so three teams can all place 1st in a true draw, and
 * `score` normalizes placement to [0,1] — 1 for a clear first, 0 for a clear
 * last, 0.5 for everyone in a total draw — so a sweep can average it.
 */
export function placementsOf(
  seats: ReadonlyArray<{ seat: number; teamID: string; bot: BotName }>,
  eliminatedOnTurn: ReadonlyMap<string, number>,
  finalStandings: ReadonlyArray<TeamStandingRow>
): ReplayResult['placements'] {
  const byTeam = new Map(finalStandings.map((r) => [r.teamID, r]));
  const rows = seats.map((s) => {
    const st = byTeam.get(s.teamID);
    return {
      seat: s.seat,
      teamID: s.teamID,
      bot: s.bot,
      // Never eliminated ranks above every elimination turn.
      survivedTo: eliminatedOnTurn.get(s.teamID) ?? Number.POSITIVE_INFINITY,
      eliminatedOnTurn: eliminatedOnTurn.get(s.teamID) ?? null,
      finalUnits: st?.units ?? 0,
      finalMaterial: st?.material ?? 0,
    };
  });

  const better = (a: typeof rows[number], b: typeof rows[number]): number =>
    b.survivedTo - a.survivedTo || b.finalMaterial - a.finalMaterial;
  const sorted = [...rows].sort(better);

  const place = new Map<string, number>();
  let currentPlace = 1;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    if (i > 0 && better(sorted[i - 1]!, row) !== 0) currentPlace = i + 1;
    place.set(row.teamID, currentPlace);
  }

  const n = seats.length;
  return rows.map((r) => {
    const p = place.get(r.teamID) ?? n;
    return {
      teamID: r.teamID,
      seat: r.seat,
      bot: r.bot,
      place: p,
      eliminatedOnTurn: r.eliminatedOnTurn,
      finalUnits: r.finalUnits,
      finalMaterial: r.finalMaterial,
      score: n === 1 ? 1 : (n - p) / (n - 1),
    };
  });
}

export async function runMatch(opts: RunMatchOptions): Promise<MatchOutcome> {
  const { config } = opts;
  if (opts.bots.length !== config.teams.length) {
    throw new Error(
      `runMatch needs one bot per team: ${config.teams.length} teams (${config.teams.join(',')}) ` +
        `but ${opts.bots.length} bots (${opts.bots.join(',')})`
    );
  }

  const seats = config.teams.map((teamID, seat) => ({ seat, teamID, bot: opts.bots[seat]! }));
  const bots = opts.made ?? seats.map((s) => makeBot(s.bot));
  const ownsBots = opts.made === undefined;

  const built = buildGame(config);
  let board = built.board;
  const world = emptyWorld();
  const itemRng = streamRng(config.seed, 'turn-items');

  const counters: Record<string, SeatCounters> = {};
  for (const s of seats) counters[s.teamID] = emptyCounters();

  const eliminatedOnTurn = new Map<string, number>();
  const materialTrajectory: Record<string, number[]> = {};
  const unitTrajectory: Record<string, number[]> = {};
  for (const s of seats) {
    materialTrajectory[s.teamID] = [];
    unitTrajectory[s.teamID] = [];
  }
  const errors: Array<{ seat: number; turn: number; error: string }> = [];

  const replayPath = `${opts.replayDir}/${opts.gameId}.jsonl.gz`;
  const writer = new ReplayWriter(replayPath);
  const startedWall = Date.now();

  writer.write({
    kind: 'header',
    version: REPLAY_FORMAT_VERSION,
    sweepId: opts.sweepId,
    gameId: opts.gameId,
    configHash: configHash(config),
    boardHash: boardHash(config),
    config,
    seats,
    startedAt: new Date().toISOString(),
    node: process.version,
    harness: 'sweeps/harness@1',
  });

  let turn = 1;
  let played = 0;
  let endKind: EndKind = 'cap';
  let reason = `turn cap (${config.turnCap})`;
  let worstHeldObserved = 0;

  for (let t = 0; t < config.turnCap; t++) {
    const alive = seats.filter((s) => teamAlive(board, s.teamID));
    if (alive.length <= 1) {
      endKind = alive.length === 0 ? 'all-eliminated' : 'last-team-standing';
      reason =
        alive.length === 0
          ? 'every team eliminated'
          : `last team standing: ${alive[0]!.teamID} (${alive[0]!.bot})`;
      break;
    }

    // --- every seat decides, in seat order, on the same board ---------------
    const staged = new Map<string, CentaurMove>();
    const stagedBy = new Map<string, { seat: number; bot: BotName; spoken: boolean }>();
    const telemetry: ReplayTurn['telemetry'] = {};

    const totalUnitsNow = (board.snakes ?? []).filter((s) => s.health > 0 && s.body.length > 0).length;

    for (const seat of seats) {
      const bot = bots[seat.seat]!;
      if (!teamAlive(board, seat.teamID)) continue;

      // The held set this decision faces: every living unit that is not ours.
      // Recording the observed worst is the MAX_FROZEN headroom check —
      // `validateConfig` refuses a config that could exceed it, and this proves
      // the running game stayed inside.
      const ours = unitsOf(board, seat.teamID).length;
      worstHeldObserved = Math.max(worstHeldObserved, totalUnitsNow - ours);

      const spoken = new Set(bot.speaksFor(board, seat.teamID));
      const out = await bot.decide(
        board,
        turn,
        seat.teamID,
        Date.now() + config.budgetMs,
        config.seed
      );

      const legality = judgeLegality(board, turn, [...spoken], out.moves);
      const c = counters[seat.teamID]!;
      c.decisions += 1;
      c.emissions += out.telemetry.emissions;
      c.illegal += legality.illegal.length;
      c.nonGrammatical += legality.nonGrammatical.length;
      c.unstaged += legality.unstaged.length;
      if (out.telemetry.emissions === 0) c.stagedNothing += 1;
      if (out.telemetry.overrunMs > 0) {
        c.overruns += 1;
        c.worstOverrunMs = Math.max(c.worstOverrunMs, out.telemetry.overrunMs);
      }
      c.totalWallMs += out.telemetry.wallMs;
      c.worstWallMs = Math.max(c.worstWallMs, out.telemetry.wallMs);
      c.plansEvaluated += out.telemetry.plansEvaluated ?? 0;
      c.assumptions += out.telemetry.assumptions;
      c.boundViolations += out.telemetry.boundViolations ?? 0;
      c.boundsInversions += out.telemetry.boundsInversions ?? 0;
      c.ratchetRefusals += out.telemetry.ratchetRefusals ?? 0;
      if (out.telemetry.error !== null) {
        c.errors.push(out.telemetry.error);
        errors.push({ seat: seat.seat, turn, error: out.telemetry.error });
      }

      for (const [id, mv] of out.moves) {
        staged.set(id, mv);
        stagedBy.set(id, { seat: seat.seat, bot: seat.bot, spoken: spoken.has(id) });
      }
      // Units this bot owns but does not speak for (legacy's pieces) are marked
      // so a miner can tell "no bot for it" from "its bot stayed silent".
      for (const u of unitsOf(board, seat.teamID)) {
        if (!stagedBy.has(u.id)) {
          stagedBy.set(u.id, { seat: seat.seat, bot: seat.bot, spoken: spoken.has(u.id) });
        }
      }

      telemetry[seat.teamID] = { ...out.telemetry, seat: seat.seat, bot: seat.bot };
    }

    // --- the turn resolves -------------------------------------------------
    const tiers: Record<string, number> = {};
    for (const s of board.snakes ?? []) {
      if (s.health <= 0 || s.body.length === 0) continue;
      tiers[s.id] = tierAtArrival(s, turn);
    }
    const teamOf = new Map(
      (board.snakes ?? []).map((s) => [s.id, TeamDetector.getTeamKey(s)] as const)
    );
    const preBoard = board;
    const aliveBefore = new Set(livingTeams(board));

    const outcome = resolveFullTurn(board, turn, staged);
    board = outcome.board;

    const worldStep = stepWorld(
      board,
      world,
      config,
      turn,
      itemRng,
      outcome.events.vulnerableCollided,
      teamOf
    );

    for (const teamID of aliveBefore) {
      if (!teamAlive(board, teamID) && !eliminatedOnTurn.has(teamID)) {
        eliminatedOnTurn.set(teamID, turn);
      }
    }

    const rows = standingRows(board, seats);
    for (const s of seats) {
      const row = rows.find((r) => r.teamID === s.teamID)!;
      materialTrajectory[s.teamID]!.push(row.material);
      unitTrajectory[s.teamID]!.push(row.units);
    }

    const stagedRow: Record<string, ReplayStagedMove> = {};
    for (const [id, meta] of stagedBy) {
      const mv = staged.get(id);
      stagedRow[id] = {
        move: mv === undefined ? '' : (mv as string | number),
        seat: meta.seat,
        bot: meta.bot,
        spoken: meta.spoken,
      };
    }

    writer.write({
      kind: 'turn',
      turn,
      board: preBoard,
      tiers,
      staged: stagedRow,
      telemetry,
      events: outcome.events,
      world: {
        foodSpawned: worldStep.foodSpawned,
        potionsSpawned: worldStep.potionsSpawned,
        potionsCollected: worldStep.potionsCollected,
        effectsExpired: worldStep.effectsExpired,
      },
      standings: rows,
    });

    turn += 1;
    played += 1;
    opts.onTurn?.(turn, board);
  }

  const finalRows = standingRows(board, seats);
  const placements = placementsOf(seats, eliminatedOnTurn, finalRows);
  const terminal: 'decisive' | 'cap' = endKind === 'cap' ? 'cap' : 'decisive';
  if (endKind === 'cap') {
    const top = [...placements].sort((a, b) => a.place - b.place)[0];
    reason = `turn cap (${config.turnCap}); adjudicated on material, leader ${top?.teamID} (${top?.finalMaterial})`;
  }

  const wallMs = Date.now() - startedWall;
  writer.write({
    kind: 'result',
    turns: played,
    reason,
    placements,
    materialTrajectory,
    unitTrajectory,
    wallMs,
    finishedAt: new Date().toISOString(),
    errors,
  });
  await writer.close();

  if (ownsBots) for (const b of bots) b.release();

  return {
    gameId: opts.gameId,
    sweepId: opts.sweepId,
    configHash: configHash(config),
    boardHash: boardHash(config),
    seed: config.seed,
    turns: played,
    endKind,
    terminal,
    reason,
    seats,
    placements,
    counters,
    replayPath,
    wallMs,
    worstHeldObserved,
    maxFrozenCapacity: 32,
  };
}

function standingRows(
  board: Board,
  seats: ReadonlyArray<{ seat: number; teamID: string }>
): TeamStandingRow[] {
  const live = standings(board);
  return seats.map((s) => {
    const row = live.find((r) => r.teamID === s.teamID);
    return {
      teamID: s.teamID,
      seat: s.seat,
      units: row?.units ?? 0,
      material: row?.material ?? 0,
      health: row?.health ?? 0,
      hasKing: row?.hasKing ?? false,
      alive: (row?.units ?? 0) > 0,
    };
  });
}

/** The resolved facts a replay header and a manifest row both want. */
export function describeConfig(config: MatchConfig): {
  hazardDamage: number;
  hazardRef: string;
  hazardRegimes: ReturnType<typeof hazardRegimes>;
} {
  const { damage, ref } = resolveHazardDamage(config);
  return { hazardDamage: damage, hazardRef: ref, hazardRegimes: hazardRegimes(config) };
}

export type { DecisionTelemetry };
