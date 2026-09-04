/**
 * CANDIDATE ROWS FOR THE LIVE DECISION PANEL — one row per (game, unit,
 * turn), built ONCE, after the decision has already settled.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * `setBotRecommendation` re-publishes a snake's `TurnData` with the
 * candidates the team decision actually assessed, so the history/live board
 * (`board-renderer.js` `processMoveEvaluations`) can enumerate them —
 * direction-keyed for a snake, destination-keyed for a piece — and mark which
 * one is `isEvaluated`. That candidate enumeration is the live contract this
 * file exists to build.
 *
 * ── WHAT A ROW SAYS ────────────────────────────────────────────────────────
 *
 * Per unit, per candidate the generator actually assessed: the move as staged
 * on the wire, its destination cell, and the fold's own worst/likely/best
 * triple for it (`bounds`), when the row was explained within the telemetry
 * budget. `getWaypointBiasedMove` (`active-game-manager.ts`) reads `score`
 * and `bounds.lo` off these rows for its re-bias and its certain-death veto —
 * the one server-side reader past the live panel.
 *
 * ── THE COST RULE ──────────────────────────────────────────────────────────
 *
 * The decision's time budget is sacred, so nothing here runs inside it: this
 * is called after the kernel's final emission, and it is bounded twice — at
 * most `MAX_CANDIDATES_PER_UNIT` explained per unit and at most
 * `MAX_EXPLAINED_CANDIDATES` across the whole decision — by COUNT and not by
 * a clock, so what a row contains is reproducible rather than a function of
 * how loaded the box was. Past the budget a candidate still gets its
 * assessment row; it simply carries no evaluator reading.
 *
 * A candidate's evaluation is a COUNTERFACTUAL ON THE SETTLED PLAN: every
 * other unit keeps the move it was actually staged with, and this one takes
 * the candidate — so the numbers are comparable with the ones the decision
 * was made on (basis identity).
 */

import { toApiCoord } from '../firebase/translate';
import type { CentaurMove, Coord, GameState } from '../types/battlesnake';
import type { Bound, Candidate, Evaluator, JointPlan } from './contracts';
import { NO_ORDER_MOVE } from './contracts';
import type { AssessedCandidate, GrammarCandidateGenerator } from './candidates';
import type { EngineSubstrate, SubstrateUnit } from './substrate';

// --------------------------------------------------------------- row shapes

/**
 * One candidate row of a unit's re-published `moveEvaluations`.
 *
 * This is the EXISTING wire contract the live panel and `getWaypointBiasedMove`
 * read: `move` keys the candidate, `dest` places it on the board, `score` and
 * `bounds` are the fold's reading of it.
 */
export interface TelemetryEvaluation {
  /** A Direction for a snake, a full-board destination index for a piece:
   * byte-identical to what staging puts on the wire, because it is that value. */
  readonly move: CentaurMove;
  readonly score: number;
  readonly dest: Coord;
  /** The fold's own worst/likely/best triple for this candidate, or null when
   * this candidate went unexplained (past the telemetry budget, or the
   * evaluator exposes no explain surface). */
  readonly bounds: Bound | null;
}

/** Everything one row needs to reach `setBotRecommendation`. */
export interface UnitDecisionRow {
  readonly snakeId: string;
  readonly moveEvaluations: TelemetryEvaluation[];
  /** The offerable set, as strings — a snake's own move words, a piece's
   * destination ids. */
  readonly safeMoves: string[];
}

// ------------------------------------------------------------------- inputs

export interface TelemetryInput {
  readonly gameId: string;
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly gen: GrammarCandidateGenerator;
  readonly evaluate: Evaluator;
  /** The plan the last emission staged, or null if nothing was ever staged. */
  readonly finalPlan: JointPlan | null;
  readonly views: ReadonlyMap<string, GameState>;
  /** A staged candidate as the wire says it — the engine's own `moveOf`, passed
   * in rather than reimplemented, so a row can never disagree with the wire. */
  readonly moveOf: (unit: SubstrateUnit, candidate: Candidate) => CentaurMove | null;
  readonly maxCandidatesPerUnit?: number;
  readonly maxExplained?: number;
}

/**
 * Per unit. Six covers every snake (four directions) with room to spare and the
 * best of a slider's ray; a rook's thirteen destinations are not thirteen
 * interesting destinations, and the generator has already ordered them.
 */
export const MAX_CANDIDATES_PER_UNIT = 6;

/**
 * Across the whole decision. At the top of the throughput table (26 units) the
 * per-unit cap alone would authorise 156 evaluations after the deadline, on a
 * process whose NEXT turn may already be searching. This is the ceiling that
 * makes the cost independent of roster size.
 */
export const MAX_EXPLAINED_CANDIDATES = 96;

// ------------------------------------------------------------------- builder

/**
 * Build one row per unit this decision spoke for.
 *
 * Never throws. A unit whose row cannot be built gets a degraded (empty) row
 * instead — telemetry that can take a decision down with it is worse than no
 * telemetry.
 */
export function buildDecisionRows(input: TelemetryInput): UnitDecisionRow[] {
  const { sub, asTeam, views } = input;

  const width = sub.grid.width;
  const height = sub.grid.height;
  const cellCoord = (cell: number): Coord => toApiCoord(cell, width, height);

  let explained = 0;
  const rows: UnitDecisionRow[] = [];

  for (const wireId of views.keys()) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined || unit.team !== asTeam) continue;
    try {
      const budget = (input.maxExplained ?? MAX_EXPLAINED_CANDIDATES) - explained;
      const built = buildRow(input, unit, cellCoord, Math.max(0, budget));
      explained += built.explained;
      rows.push(built.row);
    } catch {
      // One unit's row failing must not cost the others theirs.
      rows.push({ snakeId: unit.wireId, moveEvaluations: [], safeMoves: [] });
    }
  }
  return rows;
}

function buildRow(
  input: TelemetryInput,
  unit: SubstrateUnit,
  cellCoord: (cell: number) => Coord,
  remainingExplain: number
): { row: UnitDecisionRow; explained: number } {
  const { sub, asTeam, gen, evaluate, finalPlan, moveOf } = input;
  const perUnit = input.maxCandidatesPerUnit ?? MAX_CANDIDATES_PER_UNIT;

  const assessed = gen.assess(sub, unit.unitId);
  const staged = finalPlan?.get(unit.unitId) ?? null;

  // WHICH CANDIDATES GET A ROW. The generator's order is best-first, so the
  // prefix is the interesting part; the STAGED move is added whatever its rank,
  // because a row whose chosen move is missing explains nothing at all.
  const picked: Array<{ assessed: AssessedCandidate }> = [];
  for (let rank = 0; rank < assessed.length && picked.length < perUnit; rank++) {
    picked.push({ assessed: assessed[rank] as AssessedCandidate });
  }
  if (staged !== null && !picked.some((p) => p.assessed.candidate.to === staged.to)) {
    const at = assessed.findIndex((a) => a.candidate.to === staged.to);
    if (at >= 0) picked.push({ assessed: assessed[at] as AssessedCandidate });
  }

  // THE COUNTERFACTUAL IS ONLY LEGITIMATE ON A PLAN THAT ALREADY NAMES THE
  // UNIT. Adding a unit the final plan omitted would move it out of the held set
  // and change the modelled set — a different decision, priced against a
  // different basis, reported as if it were this one.
  const canExplain =
    finalPlan !== null && finalPlan.has(unit.unitId) && evaluate.explainPlan !== undefined;

  let explainedHere = 0;
  const staging: Array<{ move: CentaurMove; dest: Coord; bounds: Bound | null }> = [];

  for (const { assessed: cand } of picked) {
    const move = moveOf(unit, cand.candidate);
    if (move === null) {
      // A move the wire has no word for cannot key a candidate row: the viewer
      // keys on `String(move)`, and a null would be read as a destination-keyed
      // row and flip a snake's whole candidate set to the wrong shape.
      continue;
    }
    const dest =
      cand.candidate.to === NO_ORDER_MOVE
        ? cellCoord(unit.cells[0] as number)
        : cellCoord(cand.candidate.to);

    let bounds: Bound | null = null;
    if (canExplain && explainedHere < remainingExplain) {
      const counterfactual = new Map(finalPlan as JointPlan);
      counterfactual.set(unit.unitId, cand.candidate);
      const explanation = (evaluate.explainPlan as NonNullable<Evaluator['explainPlan']>)(
        sub,
        counterfactual,
        asTeam
      );
      bounds = explanation.bound;
      explainedHere++;
    }

    staging.push({ move, dest, bounds });
  }

  // THE CHANNEL. Floors adjudicate, so `lo` is the reading a row reports —
  // unless every floor is the same number, which is what a vacuous posture
  // produces (every candidate on the death cliff) and what a decision with one
  // option produces. Then `lo` distinguishes nothing and `est`, which orders
  // among floor ties and never adjudicates, is the only honest column to show.
  const los = staging.map((s) => s.bounds?.lo).filter((v): v is number => v !== undefined);
  const channel: 'lo' | 'est' = los.length > 1 && los.some((v) => v !== los[0]) ? 'lo' : 'est';
  const readOf = (b: Bound | null): number | null =>
    b === null ? null : channel === 'lo' ? b.lo : b.est;

  const evaluations: TelemetryEvaluation[] = staging.map((s) => ({
    move: s.move,
    score: readOf(s.bounds) ?? 0,
    dest: s.dest,
    bounds: s.bounds,
  }));

  return {
    explained: explainedHere,
    row: {
      snakeId: unit.wireId,
      safeMoves: evaluations.map((e) => String(e.move)),
      moveEvaluations: evaluations,
    },
  };
}
