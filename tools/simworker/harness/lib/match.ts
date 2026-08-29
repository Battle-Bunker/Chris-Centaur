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
 *
 * ── HOW A GAME ENDS, AND WHAT DECIDES IT ───────────────────────────────────
 *
 * The authority is TacticToes' `TeamSnekProcessor.calculateWinners`
 * (`functions/src/gameprocessors/TeamSnekProcessor.ts`), and it takes four
 * branches in this order:
 *
 *   1. EVERY REMAINING TEAM DIED ON THE SAME TURN. The outcome is settled from
 *      the PREVIOUS COMMITTED TURN's board (`calculatePreviousTurnTeamOutcome`):
 *      the team alive there wins if it is the only one, otherwise the highest
 *      total weight on that board wins, and an exact tie there is a draw.
 *   2. EXACTLY ONE TEAM ALIVE — it wins outright, whatever its weight.
 *   3. TURN CAP with two or more teams alive — highest total alive weight wins,
 *      an exact tie is a draw among the tied top teams.
 *   4. Otherwise the game continues.
 *
 * Weight is occupied squares: a snake's length, a piece's stack size.
 *
 * ── THE METRIC THIS PROGRAM OPTIMIZES (owner, 2026-08-29) ──────────────────
 *
 * The branches above decide WHO WINS ONE GAME. They are not the objective. The
 * objective is a CROSS-GAME metric, and it is continuous:
 *
 *     sharePar = (this team's share of the total weight at game end) × (teams)
 *
 * Par is 1 — a team holding its fair share of the board scores exactly 1
 * whether the game had two teams or four, which is what makes the number
 * commensurate across cell shapes and poolable across a sweep. It is
 * CONTINUOUS IN THE WEIGHT MARGIN: a one-point lead and a thirty-point lead do
 * not pay the same, and a team that loses narrowly is not scored identically to
 * one that was wiped out. `placementsOf` computes it per team, and `pFirst`
 * (a winner-take-all reading of the same board) is deliberately NOT reported —
 * it is not the objective and a column for it invites optimising the wrong one.
 *
 * The end weight the share is computed from is the SAME weight the winner
 * branches read: the final board normally, and the previous committed turn's
 * board on a mutual wipe. One quantity, `adjudicatedMaterial`, feeds both.
 *
 * Branch 1 is the one this harness got wrong until 2026-08-29. Every eliminated
 * team carries zero material on the FINAL board, so a mutual wipe read off that
 * board is always a tie, and the "material breaks ties among teams that fell on
 * the same turn" rule below was vacuous exactly where it was supposed to bite.
 * `placementsOf` now takes the previous committed turn's standings and
 * adjudicates a mutual wipe on those, which is the game's own rule: a team ahead
 * on weight that trades its last units for its rival's last units WINS.
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
  /**
   * DEATHS BY CAUSE, attributed to the team that lost the unit.
   *
   * P7's verdict turned on exactly this row and nothing else could have
   * produced it: CENTAUR_CLUSTER_SEED passed its deterministic fatal-staging
   * gate (41 -> 0) and then lost snake6 1.00 -> 0.15 live, with EXHAUSTION
   * deaths x1.9. The probe scores positions; exhaustion is travel economy,
   * which is a property of a whole game and invisible to it.
   *
   * `teammate` is the one that needs a definition rather than a lookup: a unit
   * that died in a clash where some other participant was on its own team. The
   * engine does not label a death that way, and a fatal-staging gate that
   * cannot see it is a gate measuring the wrong thing.
   *
   * THE CATEGORIES OVERLAP, DELIBERATELY. The first five partition deaths by
   * CAUSE and sum to the team's total; `teammate` cuts the same deaths by WHO,
   * so a unit that walked into a teammate's body is counted once in
   * `deathsBodyBlock` and once in `deathsTeammate`. Adding all six together is
   * a mistake; reading them as two independent views of the same deaths is
   * what they are for.
   */
  deathsSelf: number;
  deathsWall: number;
  deathsExhaustion: number;
  deathsBodyBlock: number;
  deathsContest: number;
  deathsTeammate: number;
  /**
   * CL7's mechanism fold, LAST WRITE WINS across the game's decisions for the
   * flag stamp, and SUMMED for the counters. The stamp is a property of the
   * engine and does not vary within a game; the counters accumulate.
   * Null on any bundle built before the CL7 telemetry closure — and null, not
   * zero, because a counter a build never had did not read zero.
   */
  mechanism: {
    flags: Record<string, string | number | boolean>;
    wasmRuns: number | null;
    wasmRefused: number | null;
    clusterJoints: number | null;
    clusterEnumMs: number | null;
    selectionFar: number | null;
    selectionDraws: number | null;
    refineMovedLo: number | null;
    refineInverted: number | null;
    scoutThreads: number | null;
    scoutPlies: number | null;
    scoutRefusals: number | null;
    ceilingDecided: number | null;
  } | null;
  errors: string[];
}

/** Sum two nullable counters, keeping null when NEITHER side has a number. */
function addNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
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
    deathsSelf: 0,
    deathsWall: 0,
    deathsExhaustion: 0,
    deathsBodyBlock: 0,
    deathsContest: 0,
    deathsTeammate: 0,
    mechanism: null,
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
 *   2. WEIGHT breaks ties among teams that fell on the same turn (and among
 *      the survivors at the cap).
 *
 * Ties share a placement, so three teams can all place 1st in a true draw, and
 * `score` normalizes placement to [0,1] — 1 for a clear first, 0 for a clear
 * last, 0.5 for everyone in a total draw — so a sweep can average it.
 *
 * ── WHICH BOARD RULE 2 READS ───────────────────────────────────────────────
 *
 * `previousStandings` is the standings after the SECOND-TO-LAST turn played —
 * the game's "previous committed turn". Pass it ONLY when the match ended with
 * every team eliminated; pass `null` everywhere else and every row's
 * `adjudicatedMaterial` is its final material, which is what rule 2 has always
 * used and leaves the scoring of every other end kind byte-identical.
 *
 * It has to be passed, because on a mutual wipe the final board is all zeroes:
 * every eliminated team carries no material, rule 2 could never separate them,
 * and the harness scored a shared first — a draw — where TacticToes
 * (`calculatePreviousTurnTeamOutcome`) awards the game to whoever led on weight
 * the turn before. Reading the previous board restores the game's rule in both
 * of its branches at once: a team that was the only one alive there necessarily
 * holds the most weight there (alive means at least one occupied square, dead
 * means none), so an argmax over the previous board's weights reproduces the
 * "only one alive there wins" branch without a second test.
 *
 * Teams eliminated on EARLIER turns keep their lower `survivedTo`, so they
 * still rank below the teams that made it to the wipe; their previous-turn
 * weight is zero anyway, which is exactly how the game scores them.
 */
export function placementsOf(
  seats: ReadonlyArray<{ seat: number; teamID: string; bot: BotName }>,
  eliminatedOnTurn: ReadonlyMap<string, number>,
  finalStandings: ReadonlyArray<TeamStandingRow>,
  previousStandings: ReadonlyArray<TeamStandingRow> | null = null
): ReplayResult['placements'] {
  const byTeam = new Map(finalStandings.map((r) => [r.teamID, r]));
  const byTeamPrev =
    previousStandings === null ? null : new Map(previousStandings.map((r) => [r.teamID, r]));
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
      // The weight this placement was actually decided on. Equal to
      // `finalMaterial` unless the game ended in a mutual wipe.
      adjudicatedMaterial:
        byTeamPrev === null ? st?.material ?? 0 : byTeamPrev.get(s.teamID)?.material ?? 0,
    };
  });

  const better = (a: typeof rows[number], b: typeof rows[number]): number =>
    b.survivedTo - a.survivedTo || b.adjudicatedMaterial - a.adjudicatedMaterial;
  const sorted = [...rows].sort(better);

  const place = new Map<string, number>();
  let currentPlace = 1;
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    if (i > 0 && better(sorted[i - 1]!, row) !== 0) currentPlace = i + 1;
    place.set(row.teamID, currentPlace);
  }

  const n = seats.length;

  /*
   * THE SHARE METRIC — par 1, commensurate across team counts, continuous.
   *
   *     sharePar = n × (this team's end weight) / (total end weight)
   *
   * The weight is `adjudicatedMaterial`, so this is read off the same board the
   * winner branches are: the final one normally, the previous committed turn's
   * on a mutual wipe. A team on exactly its fair share scores 1; a team holding
   * everything scores n; a team wiped out scores 0. Nothing here is a
   * placement, and nothing here rounds: the whole point of the metric is that
   * it moves with the weight margin instead of stepping at a rank boundary.
   *
   * A board with NO WEIGHT ANYWHERE is the one degenerate case — a mutual wipe
   * on the very first turn, on a previous board that was already empty. Every
   * team then holds an equal (empty) share, so every team scores par. Dividing
   * by zero and calling the result 0 would score an exact draw as a total loss
   * for everyone.
   */
  const totalWeight = rows.reduce((a, r) => a + r.adjudicatedMaterial, 0);

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
      adjudicatedMaterial: r.adjudicatedMaterial,
      sharePar: totalWeight > 0 ? (n * r.adjudicatedMaterial) / totalWeight : 1,
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

  /*
   * THE PREVIOUS COMMITTED TURN, carried one step behind the latest one.
   *
   * A mutual wipe is adjudicated on the board as it stood BEFORE the turn that
   * emptied it, so the standings of the second-to-last turn played have to
   * survive that turn. Both are seeded with the starting board: a wipe on turn
   * 1 is then read off the board the game started from, which is the turn
   * TacticToes has committed at that point.
   */
  let previousRows: TeamStandingRow[] = standingRows(board, seats);
  let latestRows: TeamStandingRow[] = previousRows;

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
      const mech = out.telemetry.mechanism;
      if (mech !== null && mech !== undefined) {
        const prev = c.mechanism;
        c.mechanism =
          prev === null
            ? { ...mech, flags: { ...mech.flags } }
            : {
                // The stamp is a property of the engine, not of the decision:
                // last write wins, and they must all agree.
                flags: { ...mech.flags },
                wasmRuns: addNullable(prev.wasmRuns, mech.wasmRuns),
                wasmRefused: addNullable(prev.wasmRefused, mech.wasmRefused),
                clusterJoints: addNullable(prev.clusterJoints, mech.clusterJoints),
                clusterEnumMs: addNullable(prev.clusterEnumMs, mech.clusterEnumMs),
                selectionFar: addNullable(prev.selectionFar, mech.selectionFar),
                selectionDraws: addNullable(prev.selectionDraws, mech.selectionDraws),
                refineMovedLo: addNullable(prev.refineMovedLo, mech.refineMovedLo),
                refineInverted: addNullable(prev.refineInverted, mech.refineInverted),
                scoutThreads: addNullable(prev.scoutThreads, mech.scoutThreads),
                scoutPlies: addNullable(prev.scoutPlies, mech.scoutPlies),
                scoutRefusals: addNullable(prev.scoutRefusals, mech.scoutRefusals),
                ceilingDecided: addNullable(prev.ceilingDecided, mech.ceilingDecided),
              };
      }
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

    // --- deaths by cause, attributed to the team that lost the unit --------
    //
    // Read off the resolver's own event block, not inferred from the board
    // diff: the engine names what killed each unit, and a miner that
    // reconstructs it from before/after states will get the multi-unit cells
    // wrong. `teamOf` is built from the PRE-resolution board above, which is
    // the only board on which a dead unit still has a team.
    for (const [unitID, death] of Object.entries(outcome.events.deaths)) {
      const team = teamOf.get(unitID);
      if (team === undefined) continue;
      const dc = counters[team];
      if (dc === undefined) continue;
      switch (death.cause) {
        case 'self':
          dc.deathsSelf += 1;
          break;
        case 'wall':
          dc.deathsWall += 1;
          break;
        case 'exhaustion':
        case 'hazard':
          dc.deathsExhaustion += 1;
          break;
        case 'bodyBlock':
          dc.deathsBodyBlock += 1;
          break;
        case 'contest':
        case 'edge':
          dc.deathsContest += 1;
          break;
        default:
          break;
      }
    }
    // TEAMMATE-CAUSED: a unit that died in a clash where another participant
    // was on its own team. Counted per victim, once, across every clash record
    // it appears in — a unit can only die once, and a single collision that
    // spans two cells emits one record per cell.
    {
      const chargedTeammate = new Set<string>();
      for (const clash of outcome.events.clashes) {
        for (const victim of clash.victimIDs) {
          if (chargedTeammate.has(victim)) continue;
          const vTeam = teamOf.get(victim);
          if (vTeam === undefined) continue;
          const withTeammate = clash.playerIDs.some(
            (other) => other !== victim && teamOf.get(other) === vTeam
          );
          if (!withTeammate) continue;
          chargedTeammate.add(victim);
          const tc = counters[vTeam];
          if (tc !== undefined) tc.deathsTeammate += 1;
        }
      }
    }

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
    previousRows = latestRows;
    latestRows = rows;
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
  // Only a mutual wipe is adjudicated on the previous committed turn; every
  // other end kind reads the final board, exactly as before.
  const placements = placementsOf(
    seats,
    eliminatedOnTurn,
    finalRows,
    endKind === 'all-eliminated' ? previousRows : null
  );
  const terminal: 'decisive' | 'cap' = endKind === 'cap' ? 'cap' : 'decisive';
  if (endKind === 'cap') {
    const top = [...placements].sort((a, b) => a.place - b.place)[0];
    reason = `turn cap (${config.turnCap}); adjudicated on material, leader ${top?.teamID} (${top?.finalMaterial})`;
  } else if (endKind === 'all-eliminated') {
    const first = placements.filter((p) => p.place === 1);
    const weight = first[0]?.adjudicatedMaterial ?? 0;
    reason =
      first.length === 1
        ? `every team eliminated on turn ${played}; adjudicated on the previous turn's weight, ` +
          `leader ${first[0]!.teamID} (${weight})`
        : `every team eliminated on turn ${played}; previous turn's weight tied at ${weight} — ` +
          `draw between ${first.map((p) => p.teamID).join(', ')}`;
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
