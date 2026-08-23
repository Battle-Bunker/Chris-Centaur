/**
 * One scripted match between two decision paths.
 *
 * Both engines are given the SAME production-shaped deadline (`budgetMs` of
 * wall clock), one after the other rather than concurrently: a turn therefore
 * costs 2x budget of real time, but each engine gets its whole budget on an
 * otherwise-quiet machine, which is the regime the flag decision is about. The
 * alternative — running them concurrently — would measure contention between
 * two bots that never share a process in production.
 *
 * The turn is then resolved by the vendored resolver with every unit's staged
 * move, plus the scripted neutral on 3-team boards. Nothing here decides a
 * rule.
 */

import type { Board, CentaurMove } from '../../src/types/battlesnake';
import type { Driver } from './drivers';
import { neutralMoves } from './neutral';
import {
  judgeLegality,
  resolveFullTurn,
  standings,
  teamAlive,
  unitsOf,
  type LegalityReport,
} from './sim';

export interface SideCounters {
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
  firstStageMs: number[];
  /** Kernel-only: bound violations and refusals, summed over the match. */
  boundViolations: number;
  leverOrderBindingFalse: number;
  /** Decisions that threw. Each one is a turn the engine spoke for nothing. */
  errors: string[];
}

export function emptyCounters(): SideCounters {
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
    firstStageMs: [],
    boundViolations: 0,
    leverOrderBindingFalse: 0,
    errors: [],
  };
}

export interface MatchResult {
  readonly seed: number;
  readonly scenario: string;
  readonly budgetMs: number;
  /** Which team id each driver played. */
  readonly lobsterTeam: string;
  readonly legacyTeam: string;
  readonly turns: number;
  /** +1 lobster win, -1 legacy win, 0 draw. */
  readonly outcome: 1 | 0 | -1;
  readonly reason: string;
  /** lobster material - legacy material at the final board. */
  readonly materialMargin: number;
  readonly lobsterUnits: number;
  readonly legacyUnits: number;
  readonly lobster: SideCounters;
  readonly legacy: SideCounters;
  /** Illegal-move detail, so a nonzero count is reproducible. */
  readonly illegalDetail: Array<{ side: string; turn: number; unit: string; type: string; cell: number }>;
  /** Boards on which a decision threw — verbatim, so the bug has a repro. */
  readonly failures: Array<{ side: string; turn: number; error: string; board: Board }>;
}

export interface MatchOptions {
  readonly board: Board;
  readonly seed: number;
  readonly scenario: string;
  readonly budgetMs: number;
  readonly maxTurns: number;
  readonly lobster: Driver;
  readonly legacy: Driver;
  readonly lobsterTeam: string;
  readonly legacyTeam: string;
  readonly neutralTeams: ReadonlyArray<string>;
  /** False when side B also speaks for pieces (evaluator-vs-evaluator mode). */
  readonly legacySpeaksForSnakesOnly?: boolean;
  readonly startTurn?: number;
  readonly onTurn?: (turn: number, board: Board) => void;
}

function absorb(c: SideCounters, out: { emissions: number; wallMs: number; overrunMs: number; firstStageMs: number | null; report: unknown; error: string | null }, legality: LegalityReport, budgetMs: number): void {
  c.decisions += 1;
  if (out.error !== null) c.errors.push(out.error);
  c.emissions += out.emissions;
  c.illegal += legality.illegal.length;
  c.nonGrammatical += legality.nonGrammatical.length;
  c.unstaged += legality.unstaged.length;
  if (out.emissions === 0) c.stagedNothing += 1;
  if (out.overrunMs > 0) {
    c.overruns += 1;
    c.worstOverrunMs = Math.max(c.worstOverrunMs, out.overrunMs);
  }
  c.totalWallMs += out.wallMs;
  c.worstWallMs = Math.max(c.worstWallMs, out.wallMs);
  if (out.firstStageMs !== null) c.firstStageMs.push(out.firstStageMs);
  const report = out.report as { boundViolations?: number; leverOrderBinding?: boolean; stagedNothing?: boolean } | null;
  if (report !== null && report !== undefined) {
    c.boundViolations += report.boundViolations ?? 0;
    if (report.leverOrderBinding === false) c.leverOrderBindingFalse += 1;
  }
  void budgetMs;
}

export async function runMatch(opts: MatchOptions): Promise<MatchResult> {
  let board = opts.board;
  let turn = opts.startTurn ?? 1;
  const lob = emptyCounters();
  const leg = emptyCounters();
  const illegalDetail: MatchResult['illegalDetail'] = [];
  const failures: MatchResult['failures'] = [];
  let reason = 'turn cap';
  let played = 0;

  for (let t = 0; t < opts.maxTurns; t++) {
    const lobAlive = teamAlive(board, opts.lobsterTeam);
    const legAlive = teamAlive(board, opts.legacyTeam);
    if (!lobAlive || !legAlive) {
      reason = !lobAlive && !legAlive ? 'both eliminated' : !lobAlive ? 'lobster eliminated' : 'legacy eliminated';
      break;
    }

    const staged = new Map<string, CentaurMove>();

    // --- LOBSTER's turn ---------------------------------------------------
    const lobIds = unitsOf(board, opts.lobsterTeam).map((s) => s.id);
    const lobOut = await opts.lobster.decide(board, turn, opts.lobsterTeam, Date.now() + opts.budgetMs);
    const lobLegal = judgeLegality(board, turn, lobIds, lobOut.moves);
    absorb(lob, lobOut, lobLegal, opts.budgetMs);
    for (const bad of lobLegal.illegal) {
      illegalDetail.push({ side: 'lobster', turn, ...bad });
    }
    if (lobOut.error !== null) {
      failures.push({ side: 'lobster', turn, error: lobOut.error, board: JSON.parse(JSON.stringify(board)) as Board });
    }
    for (const [id, mv] of lobOut.moves) staged.set(id, mv);

    // --- LEGACY's turn ----------------------------------------------------
    const legIds = unitsOf(board, opts.legacyTeam).map((s) => s.id);
    const legOut = await opts.legacy.decide(board, turn, opts.legacyTeam, Date.now() + opts.budgetMs);
    // Legacy speaks for SNAKES only, by production design. Its pieces are not
    // "unstaged bugs" — they are units the legacy path never had a bot for, so
    // they are excluded from the unstaged count and named separately.
    const legSnakeIds =
      opts.legacySpeaksForSnakesOnly === false
        ? legIds
        : unitsOf(board, opts.legacyTeam)
            .filter((s) => (s.unitType ?? 'snake') === 'snake')
            .map((s) => s.id);
    const legLegal = judgeLegality(board, turn, legSnakeIds, legOut.moves);
    absorb(leg, legOut, legLegal, opts.budgetMs);
    for (const bad of legLegal.illegal) {
      illegalDetail.push({ side: 'legacy', turn, ...bad });
    }
    if (legOut.error !== null) {
      failures.push({ side: 'legacy', turn, error: legOut.error, board: JSON.parse(JSON.stringify(board)) as Board });
    }
    for (const [id, mv] of legOut.moves) staged.set(id, mv);

    // --- the neutral third team ------------------------------------------
    for (const nt of opts.neutralTeams) {
      if (!teamAlive(board, nt)) continue;
      for (const [id, mv] of neutralMoves(board, turn, nt, opts.seed)) staged.set(id, mv);
    }

    const outcome = resolveFullTurn(board, turn, staged);
    board = outcome.board;
    turn += 1;
    played += 1;
    opts.onTurn?.(turn, board);
  }

  const rows = standings(board);
  const lobRow = rows.find((r) => r.teamID === opts.lobsterTeam);
  const legRow = rows.find((r) => r.teamID === opts.legacyTeam);
  const lobMat = lobRow?.material ?? 0;
  const legMat = legRow?.material ?? 0;
  const lobUnits = lobRow?.units ?? 0;
  const legUnits = legRow?.units ?? 0;

  let result: 1 | 0 | -1 = 0;
  if (lobUnits > 0 && legUnits === 0) result = 1;
  else if (legUnits > 0 && lobUnits === 0) result = -1;
  else if (lobUnits > 0 && legUnits > 0) {
    // Both standing at the cap: the material margin decides, ties are draws.
    result = lobMat > legMat ? 1 : lobMat < legMat ? -1 : 0;
    reason = `turn cap (material ${lobMat} vs ${legMat})`;
  }

  return {
    seed: opts.seed,
    scenario: opts.scenario,
    budgetMs: opts.budgetMs,
    lobsterTeam: opts.lobsterTeam,
    legacyTeam: opts.legacyTeam,
    turns: played,
    outcome: result,
    reason,
    materialMargin: lobMat - legMat,
    lobsterUnits: lobUnits,
    legacyUnits: legUnits,
    lobster: lob,
    legacy: leg,
    illegalDetail,
    failures,
  };
}
