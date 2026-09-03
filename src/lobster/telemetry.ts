/**
 * REPLAY TELEMETRY FOR THE TEAM DECISION — one row per (game, unit, turn),
 * built ONCE, after the decision has already settled.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The legacy per-snake path wrote a `decision_logs` row per snake per turn, and
 * the whole replay surface — the history viewer's candidate arrows, its
 * breakdown panel, the submitted-move and server-move back-fills — is built on
 * those rows. When the full pass flipped to the team engine that path stopped
 * running, and Postgres kept receiving the canonical board and the server's
 * resolved moves with NOTHING in between: not one candidate the decision
 * considered, not one number it considered it with, and no account of how the
 * staged move came to be the staged one. A replay that cannot say why is a
 * recording, not a log.
 *
 * ── WHAT A ROW SAYS ────────────────────────────────────────────────────────
 *
 * Per unit, per candidate the generator actually assessed: the move as staged
 * on the wire, its destination cell, the risk layer's verdict (tier, capture and
 * what the capture is worth, exhaustion, how many held claims the outcome rests
 * on), the generator's own ordering rank, and the evaluator's reading — score
 * bounds plus `value × weight = contribution` for every feature in the fold, so
 * a reader sees which term carried the verdict instead of being handed a total.
 *
 * Per unit, at the decision level: which move won, which came second, the margin
 * between them and the feature that accounts for most of it; the kernel's report
 * summary; the EMISSION JOURNAL (every interim write, the time it landed, and
 * what changed to justify it superseding the previous one); who was modelled,
 * who was held, the assumptions the whole decision rides on, and any operator
 * pins in force.
 *
 * ── THE COST RULE ──────────────────────────────────────────────────────────
 *
 * The decision's time budget is sacred, so nothing here runs inside it: this is
 * called after the kernel's final emission, and it is bounded twice — at most
 * `MAX_CANDIDATES_PER_UNIT` explained per unit and at most
 * `MAX_EXPLAINED_CANDIDATES` across the whole decision — by COUNT and not by a
 * clock, so what a row contains is reproducible rather than a function of how
 * loaded the box was. Past the budget a candidate still gets its assessment row;
 * it simply carries no evaluator reading, and the row counts how many were left
 * unexplained rather than going quiet about it.
 *
 * A candidate's evaluation is a COUNTERFACTUAL ON THE SETTLED PLAN: every other
 * unit keeps the move it was actually staged with, and this one takes the
 * candidate. That is the question a reader of a replay is asking — "what if it
 * had gone left instead?" — and it keeps the plan's domain, and therefore the
 * modelled set, exactly what the decision itself used, so the numbers are
 * comparable with the ones the decision was made on (basis identity).
 */

import type { BotIdentity } from '../config/bot-identity';
import { toApiCoord } from '../firebase/translate';
import type { CentaurMove, Coord, GameState } from '../types/battlesnake';
import type {
  Assumption,
  Bound,
  Candidate,
  EmitRecord,
  Evaluator,
  JointPlan,
  PinSet,
  UnitId,
} from './contracts';
import { NO_ORDER_MOVE } from './contracts';
import type { AssessedCandidate, GrammarCandidateGenerator } from './candidates';
import type { KernelReport } from './kernel';
import type { EngineSubstrate, SubstrateUnit } from './substrate';

// --------------------------------------------------------------- row shapes

/** One feature's line in a stored breakdown: what it read, what the profile
 * paid for it, and the product that actually entered the total. */
export interface TelemetryFeature {
  readonly key: string;
  readonly value: Bound;
  readonly weight: number;
  readonly contribution: Bound;
}

/**
 * One candidate row of `move_evaluations`.
 *
 * The first five fields are the EXISTING wire/DB contract the history viewer
 * and `/api/logs` read — `move` keys the candidate, `score` and `breakdown`
 * fill the panel, `dest` places it on the board. Everything after them is the
 * new detail, added ALONGSIDE rather than in place of it.
 */
export interface TelemetryEvaluation {
  /** A Direction for a snake, a full-board destination index for a piece:
   * byte-identical to what staging puts on the wire, because it is that value. */
  readonly move: CentaurMove;
  readonly score: number;
  readonly numStates: number;
  readonly dest: Coord;
  readonly breakdown: TelemetryBreakdown;
  /**
   * Which channel `score` reports. `lo` — the floor that adjudicates —
   * whenever the candidates' floors distinguish anything, `est` when they all
   * tie, which is what happens under a vacuous posture where every floor sits
   * on the death cliff by construction. Named on the row because a score whose
   * channel a reader has to guess is a score they cannot compare.
   */
  readonly scoreChannel: 'lo' | 'est';
  /** The full triple, or null when this candidate went unexplained. */
  readonly bounds: Bound | null;
  readonly features: ReadonlyArray<TelemetryFeature>;
  /** Position in the generator's own best-first ordering. */
  readonly rank: number;
  readonly tier: AssessedCandidate['tier'];
  readonly capture: AssessedCandidate['capture'];
  readonly captureValue: number;
  readonly energySpent: { readonly lo: number; readonly hi: number };
  readonly exhaustionFatal: AssessedCandidate['exhaustionFatal'];
  /** How many held units' claims this move's outcome rests on. */
  readonly contingencies: number;
  readonly chosen: boolean;
  /** True when the evaluator was never asked — past the explain budget, or it
   * exposes no explain surface. The assessment fields are still real. */
  readonly unexplained: boolean;
}

/**
 * The stored breakdown.
 *
 * `weights` and `weighted` keep the shape every existing reader keys on (the
 * history viewer's panel and `/api/logs` both reach for them), with the lobster
 * feature names as their keys and the unweighted readings sitting beside them
 * at the top level — the same arrangement the legacy rows used, in this
 * evaluator's vocabulary. `engine` is what tells a renderer which vocabulary it
 * is looking at, so a lobster row and a legacy row are never confused for one
 * another.
 */
export interface TelemetryBreakdown {
  readonly engine: 'lobster';
  readonly profile: string;
  readonly weights: Record<string, number>;
  readonly weighted: Record<string, number>;
  [feature: string]: unknown;
}

/** One interim write, as this unit saw it. */
export interface TelemetryEmission {
  readonly seq: number;
  /** Milliseconds from the decision's start, or null when the record carried no
   * measurement (a hand-built one). Null rather than a silent zero. */
  readonly elapsedMs: number | null;
  readonly move: CentaurMove | null;
  readonly dest: Coord | null;
  readonly lo: number;
  readonly est: number;
  readonly hi: number;
  readonly horizon: number;
  readonly epoch: number;
  readonly posture: EmitRecord['posture'];
  readonly crossfade: NonNullable<EmitRecord['crossfade']> | null;
  /** Did THIS unit's staged move change on this write? */
  readonly changed: boolean;
  /** Why this write superseded the previous one, read off the two records. */
  readonly reason: string;
}

/** The chosen move against its closest rival. */
export interface TelemetryContrast {
  readonly chosen: CentaurMove | null;
  readonly runnerUp: CentaurMove | null;
  readonly channel: 'lo' | 'est';
  readonly margin: number | null;
  /** The feature accounting for the largest share of the margin, or null when
   * neither side carried a breakdown. */
  readonly decidedBy: string | null;
  /** Per-feature `chosen − runnerUp` contribution, largest magnitude first. */
  readonly deltas: ReadonlyArray<{ readonly key: string; readonly delta: number }>;
  /**
   * False when some rival scored strictly better FOR THIS UNIT than the move
   * the decision staged. That is not a defect: the kernel maximises the JOINT
   * plan, so a unit is sometimes staged onto a concession that pays for a
   * teammate. The row says so rather than implying a per-unit argmax that was
   * never computed.
   */
  readonly chosenIsArgmax: boolean;
}

/** A named assumption with its wire identity resolved, so a stored row is
 * readable without the substrate that produced it. */
export interface TelemetryAssumption {
  readonly kind: Assumption['kind'];
  readonly unitId: number | null;
  readonly snakeId: string | null;
  readonly to: number | null;
  readonly note: string | null;
  readonly posture: string | null;
}

/** The kernel's report, as much of it as a replay needs. */
export interface TelemetryKernel {
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly overshootMs: number;
  readonly slices: number;
  readonly idleSlices: number;
  readonly yields: number;
  readonly emits: number;
  readonly epochs: number;
  readonly abandoned: boolean;
  readonly stagedNothing: boolean;
  readonly refusals: Readonly<Record<string, number>>;
  readonly evaluateCalls: number;
  readonly improveCalls: number;
  readonly refineCalls: number;
  readonly conformCalls: number;
  readonly boundViolations: number;
  // `leverOrderBinding` is gone with the report field it copied (04 §5.2 #11):
  // `makeSearchCore` exposes no lever surface, so it was `false` on every row
  // this bot has ever written. A column that is structurally constant is not
  // telemetry, it is furniture.
  readonly crossfade: KernelReport['crossfade'];
}

/** The decision-level block stored alongside the per-candidate rows. */
export interface TelemetryDecision {
  readonly engine: string;
  readonly profile: string | null;
  /**
   * WHO PLAYED THIS TURN.
   *
   * `engine` and `profile` above are NAMES, and two runs of a deliberately
   * different bot share both of them: a weight moved, a candidate knob
   * flipped, a staging-safety level overridden — all of it lands under
   * `lobster` / `lobster-territory`. Every prior comparison of two arms rested
   * on those two names and therefore could not establish that both arms played
   * the bot their manifest named, which is the defect that invalidated the
   * measurements rather than merely weakening them.
   *
   * `botId` is the CONFIGURATION, hashed (`src/config/bot-identity.ts`), so
   * any knob change changes it and two processes holding one config agree on
   * it without coordinating. `behaviourId` is the BUILD that ran
   * (`src/config/build-identity.ts`), so the same config played by different
   * code is two rows a reader can separate.
   */
  readonly botId: string;
  readonly behaviourId: string;
  /** The BOARD turn. The row's `turn` COLUMN is this plus one — see
   * `UnitDecisionRow.turn`. Carried so a reader of the blob never has to undo
   * that offset by hand. */
  readonly boardTurn: number;
  readonly kernel: TelemetryKernel | null;
  readonly journal: ReadonlyArray<TelemetryEmission>;
  readonly contrast: TelemetryContrast;
  readonly modelled: ReadonlyArray<string>;
  readonly held: ReadonlyArray<string>;
  readonly assumptions: ReadonlyArray<TelemetryAssumption>;
  readonly pins: ReadonlyArray<{
    readonly snakeId: string | null;
    readonly unitId: number;
    readonly to: number;
    readonly dest: Coord | null;
    readonly tentative: boolean;
  }>;
  readonly committed: ReadonlyArray<string>;
  readonly candidates: {
    readonly assessed: number;
    readonly reported: number;
    readonly explained: number;
    /** Assessed moves the wire has no word for, so no row could key on them. */
    readonly unexpressible: number;
  };
  /** Set only when building this unit's row went wrong; the row still exists. */
  readonly error?: string;
}

/** Everything one row needs to reach `DecisionLogger.logDecision`. */
export interface UnitDecisionRow {
  readonly gameId: string;
  readonly snakeId: string;
  readonly snakeName: string;
  /**
   * DECISION-LOG DOMAIN: board turn + 1.
   *
   * Not a display choice. `recordSubmittedMove` and `recordServerMoves` both
   * back-fill by (game, snake, turn) with that same offset applied, so a row
   * written on the board turn would simply never be found again.
   */
  readonly turn: number;
  readonly position: Coord;
  readonly health: number;
  readonly safeMoves: string[];
  readonly botRecommendation: CentaurMove;
  readonly moveEvaluations: TelemetryEvaluation[];
  readonly decision: TelemetryDecision;
  readonly gameState: GameState;
}

/** The port the engine writes rows through — a function, so the lobster layer
 * never has to import the logger singleton to have somewhere to put a row. */
export type LogDecisionPort = (row: UnitDecisionRow) => void;

// ------------------------------------------------------------------- inputs

export interface TelemetryInput {
  readonly gameId: string;
  /** BOARD turn. The row's `turn` column is derived from it here, once. */
  readonly turn: number;
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly gen: GrammarCandidateGenerator;
  readonly evaluate: Evaluator;
  readonly report: KernelReport | null;
  /** The plan the last emission staged, or null if nothing was ever staged. */
  readonly finalPlan: JointPlan | null;
  readonly views: ReadonlyMap<string, GameState>;
  /** The move actually forwarded per wire id, so a row's `bot_recommendation`
   * is what the manager was told rather than a re-derivation of it. */
  readonly forwarded: ReadonlyMap<string, CentaurMove>;
  readonly assumptions: ReadonlyArray<Assumption>;
  /** Wire ids the capacity walk chose to model (declared reference actions). */
  readonly modelled: ReadonlyArray<string>;
  readonly pins: PinSet;
  readonly engineName: string;
  /** The bot this decision was made by — stamped verbatim on every row. */
  readonly bot: BotIdentity;
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

/** Cap on the stored assumption list: a held-capacity walk on a crowded board
 * declares one per modelled unit, and a replay needs the shape, not all of it. */
const MAX_ASSUMPTIONS = 64;

// ------------------------------------------------------------------- builder

/**
 * Build one row per unit this decision spoke for.
 *
 * Never throws. A unit whose row cannot be built gets a degraded row carrying
 * the error instead — telemetry that can take a decision down with it is worse
 * than no telemetry, and a silently missing row is exactly the hole this file
 * exists to close.
 */
export function buildDecisionRows(input: TelemetryInput): UnitDecisionRow[] {
  const { sub, asTeam, evaluate, report, views } = input;
  const explainBudget = input.maxExplained ?? MAX_EXPLAINED_CANDIDATES;

  const width = sub.grid.width;
  const height = sub.grid.height;
  const cellCoord = (cell: number): Coord => toApiCoord(cell, width, height);
  const snakeIdOf = (unitId: UnitId): string | null => sub.unitOf(unitId)?.wireId ?? null;

  // Decision-wide facts, computed ONCE and shared by every row: they describe
  // the DECISION and not the unit, so re-deriving them per unit would be the
  // same work multiplied by the roster.
  const kernel = report === null ? null : summarizeKernel(report);
  const assumptions = describeAssumptions(input.assumptions, report, snakeIdOf);
  const held = heldWireIds(sub, asTeam, input.modelled);
  const pins = input.pins.map((p) => ({
    snakeId: snakeIdOf(p.unitId),
    unitId: p.unitId,
    to: p.to,
    dest: p.to === NO_ORDER_MOVE ? null : cellCoord(p.to),
    tentative: p.tentative,
  }));
  const committed = (report?.committedUnits ?? [])
    .map((u) => snakeIdOf(u))
    .filter((id): id is string => id !== null);
  const journal = report?.journal ?? [];
  const reasons = supersessionReasons(journal);
  const profile = profileNameOf(evaluate);

  const shared: SharedDecision = {
    kernel,
    assumptions,
    held,
    pins,
    committed,
    journal,
    reasons,
    profile,
    cellCoord,
  };

  let explained = 0;
  const rows: UnitDecisionRow[] = [];

  for (const [wireId, view] of views) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined || unit.team !== asTeam) continue;
    const forwardedMove = input.forwarded.get(wireId) ?? null;
    try {
      const built = buildRow(
        input,
        shared,
        unit,
        view,
        forwardedMove,
        Math.max(0, explainBudget - explained)
      );
      explained += built.explained;
      rows.push(built.row);
    } catch (err) {
      // One unit's row failing must not cost the others theirs.
      rows.push(degradedRow(input, shared, unit, view, forwardedMove, err));
    }
  }
  return rows;
}

/** The half of a row that is the same for every unit in one decision. */
interface SharedDecision {
  readonly kernel: TelemetryKernel | null;
  readonly assumptions: ReadonlyArray<TelemetryAssumption>;
  readonly held: ReadonlyArray<string>;
  readonly pins: TelemetryDecision['pins'];
  readonly committed: ReadonlyArray<string>;
  readonly journal: ReadonlyArray<EmitRecord>;
  readonly reasons: ReadonlyArray<string>;
  readonly profile: string | null;
  readonly cellCoord: (cell: number) => Coord;
}

function buildRow(
  input: TelemetryInput,
  shared: SharedDecision,
  unit: SubstrateUnit,
  view: GameState,
  forwardedMove: CentaurMove | null,
  remainingExplain: number
): { row: UnitDecisionRow; explained: number } {
  const { sub, asTeam, gen, evaluate, finalPlan, moveOf } = input;
  const perUnit = input.maxCandidatesPerUnit ?? MAX_CANDIDATES_PER_UNIT;
  const cellCoord = shared.cellCoord;

  const assessed = gen.assess(sub, unit.unitId);
  const staged = finalPlan?.get(unit.unitId) ?? null;

  // WHICH CANDIDATES GET A ROW. The generator's order is best-first, so the
  // prefix is the interesting part; the STAGED move is added whatever its rank,
  // because a row whose chosen move is missing explains nothing at all.
  const picked: Array<{ rank: number; assessed: AssessedCandidate }> = [];
  for (let rank = 0; rank < assessed.length && picked.length < perUnit; rank++) {
    picked.push({ rank, assessed: assessed[rank] as AssessedCandidate });
  }
  if (staged !== null && !picked.some((p) => p.assessed.candidate.to === staged.to)) {
    const at = assessed.findIndex((a) => a.candidate.to === staged.to);
    if (at >= 0) picked.push({ rank: at, assessed: assessed[at] as AssessedCandidate });
  }

  // THE COUNTERFACTUAL IS ONLY LEGITIMATE ON A PLAN THAT ALREADY NAMES THE
  // UNIT. Adding a unit the final plan omitted would move it out of the held set
  // and change the modelled set — a different decision, priced against a
  // different basis, reported as if it were this one.
  const canExplain =
    finalPlan !== null && finalPlan.has(unit.unitId) && evaluate.explainPlan !== undefined;

  let explainedHere = 0;
  let unexpressible = 0;
  const staging: Array<{
    move: CentaurMove;
    dest: Coord;
    entry: AssessedCandidate;
    rank: number;
    bounds: Bound | null;
    features: TelemetryFeature[];
    profile: string | null;
    chosen: boolean;
  }> = [];

  for (const { rank, assessed: cand } of picked) {
    const move = moveOf(unit, cand.candidate);
    if (move === null) {
      // A move the wire has no word for cannot key a candidate row: the viewer
      // keys on `String(move)`, and a null would be read as a destination-keyed
      // row and flip a snake's whole candidate set to the wrong shape. Counted
      // instead of quietly dropped.
      unexpressible++;
      continue;
    }
    const dest =
      cand.candidate.to === NO_ORDER_MOVE
        ? cellCoord(unit.cells[0] as number)
        : cellCoord(cand.candidate.to);

    let bounds: Bound | null = null;
    let features: TelemetryFeature[] = [];
    let profile: string | null = null;
    if (canExplain && explainedHere < remainingExplain) {
      const counterfactual = new Map(finalPlan as JointPlan);
      counterfactual.set(unit.unitId, cand.candidate);
      const explanation = (evaluate.explainPlan as NonNullable<Evaluator['explainPlan']>)(
        sub,
        counterfactual,
        asTeam
      );
      bounds = explanation.bound;
      profile = explanation.profile;
      features = explanation.features.map((f) => ({
        key: f.key,
        value: f.value,
        weight: f.weight,
        contribution: f.contribution,
      }));
      explainedHere++;
    }

    staging.push({
      move,
      dest,
      entry: cand,
      rank,
      bounds,
      features,
      profile,
      chosen: staged !== null && cand.candidate.to === staged.to,
    });
  }

  // THE CHANNEL. Floors adjudicate, so `lo` is the reading a row reports —
  // unless every floor is the same number, which is what a vacuous posture
  // produces (every candidate on the death cliff) and what a decision with one
  // option produces. Then `lo` distinguishes nothing and `est`, which orders
  // among floor ties and never adjudicates, is the only honest column to show.
  const los = staging.map((s) => s.bounds?.lo).filter((v): v is number => v !== undefined);
  const channel: 'lo' | 'est' =
    los.length > 1 && los.some((v) => v !== los[0]) ? 'lo' : 'est';
  const readOf = (b: Bound | null): number | null =>
    b === null ? null : channel === 'lo' ? b.lo : b.est;

  const evaluations: TelemetryEvaluation[] = staging.map((s) => {
    const read = readOf(s.bounds);
    return {
      move: s.move,
      score: read ?? 0,
      numStates: 0,
      dest: s.dest,
      breakdown: breakdownOf(s.features, s.profile ?? shared.profile, channel),
      scoreChannel: channel,
      bounds: s.bounds,
      features: s.features,
      rank: s.rank,
      tier: s.entry.tier,
      capture: s.entry.capture,
      captureValue: s.entry.captureValue,
      energySpent: { lo: s.entry.energySpent.lo, hi: s.entry.energySpent.hi },
      exhaustionFatal: s.entry.exhaustionFatal,
      contingencies: s.entry.contingencies,
      chosen: s.chosen,
      unexplained: s.bounds === null,
    };
  });

  const contrast = contrastOf(evaluations, channel);
  const botRecommendation =
    forwardedMove ?? evaluations.find((e) => e.chosen)?.move ?? evaluations[0]?.move ?? 'up';

  const decision: TelemetryDecision = {
    engine: input.engineName,
    profile: shared.profile,
    botId: input.bot.botId,
    behaviourId: input.bot.behaviourId,
    boardTurn: input.turn,
    kernel: shared.kernel,
    journal: journalFor(shared, unit, input, cellCoord),
    contrast,
    modelled: [...input.modelled],
    held: shared.held,
    assumptions: shared.assumptions,
    pins: shared.pins,
    committed: shared.committed,
    candidates: {
      assessed: assessed.length,
      reported: evaluations.length,
      explained: explainedHere,
      unexpressible,
    },
  };

  return {
    explained: explainedHere,
    row: {
      gameId: input.gameId,
      snakeId: unit.wireId,
      snakeName: view.you?.name ?? unit.wireId,
      turn: input.turn + 1,
      position: view.you?.head ?? cellCoord(unit.cells[0] as number),
      health: view.you?.health ?? unit.energy,
      // `safe_moves` is the offerable set. For a snake those are directions,
      // exactly as before; for a piece they are its destination ids as strings,
      // which is what the column (text[]) can hold and what the viewer's
      // destination-keyed path ignores in favour of the rows themselves.
      safeMoves: evaluations.map((e) => String(e.move)),
      botRecommendation,
      moveEvaluations: evaluations,
      decision,
      gameState: view,
    },
  };
}

/** The row a unit gets when building its real one threw. Everything the
 * back-fills key on is present, so the turn is still addressable. */
function degradedRow(
  input: TelemetryInput,
  shared: SharedDecision,
  unit: SubstrateUnit,
  view: GameState,
  forwardedMove: CentaurMove | null,
  err: unknown
): UnitDecisionRow {
  const message = err instanceof Error ? err.message : String(err);
  return {
    gameId: input.gameId,
    snakeId: unit.wireId,
    snakeName: view.you?.name ?? unit.wireId,
    turn: input.turn + 1,
    position: view.you?.head ?? { x: 0, y: 0 },
    health: view.you?.health ?? unit.energy,
    safeMoves: [],
    botRecommendation: forwardedMove ?? 'up',
    moveEvaluations: [],
    decision: {
      engine: input.engineName,
      profile: shared.profile,
      botId: input.bot.botId,
      behaviourId: input.bot.behaviourId,
      boardTurn: input.turn,
      kernel: shared.kernel,
      journal: [],
      contrast: EMPTY_CONTRAST,
      modelled: [...input.modelled],
      held: shared.held,
      assumptions: shared.assumptions,
      pins: shared.pins,
      committed: shared.committed,
      candidates: { assessed: 0, reported: 0, explained: 0, unexpressible: 0 },
      error: message,
    },
    gameState: view,
  };
}

// ------------------------------------------------------------------- pieces

/**
 * The breakdown, in the shape the existing readers key on.
 *
 * `weights[key]` and `weighted[key + 'Score']` mirror the legacy arrangement
 * exactly — that pairing is the DB/UI contract — and the unweighted reading
 * sits at the top level under the feature's own name, which is where the legacy
 * rows put their stats. A renderer that knows the lobster vocabulary reads
 * `engine` and iterates the weights; one that does not still finds both tables
 * present and well-formed.
 */
function breakdownOf(
  features: ReadonlyArray<TelemetryFeature>,
  profile: string | null,
  channel: 'lo' | 'est'
): TelemetryBreakdown {
  const weights: Record<string, number> = {};
  const weighted: Record<string, number> = {};
  const out: TelemetryBreakdown = {
    engine: 'lobster',
    profile: profile ?? 'unknown',
    weights,
    weighted,
  };
  for (const f of features) {
    weights[f.key] = f.weight;
    weighted[`${f.key}Score`] = finite(channel === 'lo' ? f.contribution.lo : f.contribution.est);
    (out as Record<string, unknown>)[f.key] = finite(
      channel === 'lo' ? f.value.lo : f.value.est
    );
  }
  return out;
}

/**
 * The lattice ends are ±Infinity, and `JSON.stringify` turns those into `null`
 * — a breakdown whose cells silently become null is a breakdown a viewer
 * renders as zero. Clamp to the largest finite double instead, so a terminal
 * reading stays visibly enormous rather than vanishing.
 */
function finite(v: number): number {
  if (Number.isFinite(v)) return v;
  if (Number.isNaN(v)) return 0;
  return v > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
}

const EMPTY_CONTRAST: TelemetryContrast = {
  chosen: null,
  runnerUp: null,
  channel: 'est',
  margin: null,
  decidedBy: null,
  deltas: [],
  chosenIsArgmax: true,
};

/**
 * THE FOIL. Not "the chosen move's score" but "the chosen move against the one
 * that came closest, and the term that separates them" — which is the only form
 * of a score a human can actually check.
 */
export function contrastOf(
  evaluations: ReadonlyArray<TelemetryEvaluation>,
  channel: 'lo' | 'est'
): TelemetryContrast {
  const chosen = evaluations.find((e) => e.chosen) ?? null;
  if (chosen === null) return { ...EMPTY_CONTRAST, channel };

  const rivals = evaluations.filter((e) => e !== chosen && !e.unexplained);
  if (chosen.unexplained || rivals.length === 0) {
    return {
      chosen: chosen.move,
      runnerUp: null,
      channel,
      margin: null,
      decidedBy: null,
      deltas: [],
      chosenIsArgmax: true,
    };
  }

  let runnerUp = rivals[0] as TelemetryEvaluation;
  for (const r of rivals) if (r.score > runnerUp.score) runnerUp = r;

  const byKey = new Map(runnerUp.features.map((f) => [f.key, f]));
  const deltas: Array<{ key: string; delta: number }> = [];
  for (const f of chosen.features) {
    const other = byKey.get(f.key);
    if (other === undefined) continue;
    const mine = channel === 'lo' ? f.contribution.lo : f.contribution.est;
    const theirs = channel === 'lo' ? other.contribution.lo : other.contribution.est;
    const delta = finite(mine) - finite(theirs);
    if (delta !== 0) deltas.push({ key: f.key, delta });
  }
  deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    chosen: chosen.move,
    runnerUp: runnerUp.move,
    channel,
    margin: chosen.score - runnerUp.score,
    decidedBy: deltas[0]?.key ?? null,
    deltas,
    chosenIsArgmax: chosen.score >= runnerUp.score,
  };
}

/** This unit's row of the emission journal. */
function journalFor(
  shared: SharedDecision,
  unit: SubstrateUnit,
  input: TelemetryInput,
  cellCoord: (cell: number) => Coord
): TelemetryEmission[] {
  const out: TelemetryEmission[] = [];
  let previous: number | null = null;
  shared.journal.forEach((rec, seq) => {
    const cand = rec.plan.get(unit.unitId) ?? null;
    const move = cand === null ? null : input.moveOf(unit, cand);
    const to = cand?.to ?? null;
    out.push({
      seq,
      elapsedMs: rec.elapsedMs ?? null,
      move,
      dest: to === null || to === NO_ORDER_MOVE ? null : cellCoord(to),
      lo: finite(rec.lo),
      est: finite(rec.est),
      hi: finite(rec.hi),
      horizon: rec.horizon,
      epoch: rec.epoch,
      posture: rec.posture,
      crossfade: rec.crossfade ?? null,
      changed: previous !== to,
      reason: shared.reasons[seq] ?? 'unrecorded',
    });
    previous = to;
  });
  return out;
}

/**
 * WHY EACH WRITE REPLACED THE ONE BEFORE IT, read off the two records rather
 * than asserted. Ordered by what actually governs the ratchet: an epoch change
 * and a posture flip build a new basis (nothing is compared across them), so
 * they are the reason whenever they happen; otherwise the floor, then the
 * ceiling, then the horizon, then the estimate, in the order the gate reads
 * them. `re-stage` means nothing measurable moved — which is itself worth
 * seeing in a journal.
 */
export function supersessionReasons(
  journal: ReadonlyArray<EmitRecord>
): string[] {
  return journal.map((rec, i) => {
    if (i === 0) return 'first staged set';
    const prev = journal[i - 1] as EmitRecord;
    if (rec.epoch !== prev.epoch) {
      return `epoch ${prev.epoch} -> ${rec.epoch} (operator event; conforming re-stage)`;
    }
    if (rec.posture !== prev.posture) return `posture ${prev.posture} -> ${rec.posture}`;
    if (rec.lo > prev.lo) return `floor +${(rec.lo - prev.lo).toFixed(3)}`;
    if (rec.hi < prev.hi) return `ceiling -${(prev.hi - rec.hi).toFixed(3)}`;
    if (rec.horizon > prev.horizon) return `horizon ${prev.horizon} -> ${rec.horizon}`;
    if (rec.est !== prev.est) {
      const d = rec.est - prev.est;
      return `estimate ${d >= 0 ? '+' : ''}${d.toFixed(3)}`;
    }
    return 're-stage (no measured change)';
  });
}

function summarizeKernel(report: KernelReport): TelemetryKernel {
  return {
    elapsedMs: report.elapsedMs,
    budgetMs: report.budgetMs,
    overshootMs: report.overshootMs,
    slices: report.slices,
    idleSlices: report.idleSlices,
    yields: report.yields,
    emits: report.emits,
    epochs: report.epochs,
    abandoned: report.abandoned,
    stagedNothing: report.stagedNothing,
    refusals: { ...report.refusals },
    evaluateCalls: report.evaluateCalls,
    improveCalls: report.improveCalls,
    refineCalls: report.refineCalls,
    conformCalls: report.conformCalls,
    boundViolations: report.boundViolations,
    crossfade: { ...report.crossfade },
  };
}

/**
 * The decision's declared basis: the assumptions the ENGINE built it with, plus
 * the ones the kernel added while draining it (a pin it could not reach, a
 * narrowing the forwarding path had to declare). De-duplicated, because the two
 * sources overlap by design — the engine's set is threaded into every record.
 */
function describeAssumptions(
  engineAssumptions: ReadonlyArray<Assumption>,
  report: KernelReport | null,
  snakeIdOf: (unitId: UnitId) => string | null
): TelemetryAssumption[] {
  const last = report?.journal[report.journal.length - 1];
  const all: Assumption[] = [...engineAssumptions, ...(last?.assumptions ?? [])];
  const seen = new Set<string>();
  const out: TelemetryAssumption[] = [];
  for (const a of all) {
    if (out.length >= MAX_ASSUMPTIONS) break;
    const key = JSON.stringify(a);
    if (seen.has(key)) continue;
    seen.add(key);
    const unitId = 'unitId' in a ? a.unitId : null;
    out.push({
      kind: a.kind,
      unitId,
      snakeId: unitId === null || unitId < 0 ? null : snakeIdOf(unitId),
      to: 'to' in a ? a.to : null,
      note: 'note' in a ? a.note : null,
      posture: 'posture' in a ? a.posture : null,
    });
  }
  return out;
}

/** Every unit this decision did NOT command and did not model: the held set,
 * whose unmade choices are exactly what the bounds are wide about. */
function heldWireIds(
  sub: EngineSubstrate,
  asTeam: number,
  modelled: ReadonlyArray<string>
): string[] {
  const modelledSet = new Set(modelled);
  const out: string[] = [];
  for (const unit of sub.roster()) {
    if (unit.team === asTeam) continue;
    if (modelledSet.has(unit.wireId)) continue;
    out.push(unit.wireId);
  }
  return out;
}

/** The criterion profile's name, when the evaluator will say. An evaluator with
 * no explain surface has no profile to name, and the row says null rather than
 * inventing one. */
function profileNameOf(evaluate: Evaluator): string | null {
  const named = evaluate as { profile?: { name?: unknown } };
  const name = named.profile?.name;
  return typeof name === 'string' ? name : null;
}
