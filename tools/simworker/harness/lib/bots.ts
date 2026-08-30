/**
 * THE BOT VARIANTS — pluggable competitors, each driven exactly as production
 * drives the path it stands for.
 *
 *   lobster-territory  `TeamDecisionEngine.decideTurn` with the TERRITORY
 *                      profile — `defaultEvaluator`, which is what production
 *                      runs today (`evaluate/index.ts:156`). One JOINT decision
 *                      per team, pieces included.
 *   lobster-material   the same engine with `materialEvaluator`
 *                      (MATERIAL_ONLY_PROFILE) — the explicit fallback profile.
 *   legacy             `firebase-interface.ts`'s legacy branch, literally: one
 *                      INDEPENDENT anytime `DecisionEngine.decideIteratively`
 *                      per controlled alive SNAKE, all launched concurrently
 *                      over their own `withYou` views, forwarding only when the
 *                      move changes. PIECES GET NO BOT — that is the production
 *                      truth under the legacy flag, and reproducing it
 *                      faithfully is the point: a piece stages nothing and the
 *                      resolver holds it. The shared worker-thread pool is LIVE
 *                      (see `build.sh` on why the harness is compiled).
 *   reflex             the fast staging pass: `quickSafeMove` for snakes,
 *                      transcribed from `firebase-interface.ts:1570`, plus a
 *                      first-legal grammar move for pieces so the variant is a
 *                      baseline for a whole team rather than half of one.
 *   neutral            the scripted disturbance from `bench/prod/neutral.ts` —
 *                      not a competitor, but available as a control seat.
 *
 * Every variant answers the same `decide` and reports the same telemetry, so a
 * replay row means the same thing whichever bot produced it.
 *
 * ── CONTENDERS: THE NAMES ABOVE ARE BASES, NOT THE WHOLE VOCABULARY ────────
 *
 * The engine's feature flags were torn out on 2026-08-29 (owner's ruling: *"rip
 * out the entire feature flags system"*). An arm therefore cannot be "the same
 * bundle with a variable set" any more, and that is an improvement rather than
 * a loss: it never really was, because a process-wide variable moved every
 * lobster seat on the board at once and a paired experiment on it measured
 * nothing.
 *
 * An arm is a CONTENDER — a named `BotConfig` (`src/lobster/bot-config.ts`),
 * declared as data in the spec's `contenders` map and seated by name like any
 * built-in:
 *
 *     "contenders": {
 *       "refiner": { "base": "lobster-territory",
 *                    "bot": { "territoryRefine": true } }
 *     },
 *     "bots": ["refiner", "lobster-territory", "reflex"]
 *
 * `base` picks which of the variants above supplies the driving code (default
 * `lobster-territory`); `bot` is the `BotConfig` handed to its engine;
 * `evaluator` names an evaluator export in the bundle's own `lobster/evaluate`,
 * which is what `lobster-slider` and `lobster-slider-royal` are pre-declared
 * spellings of. A contender's NAME is what the manifest rows key on, which is
 * the property a verdict needs — it attaches to a fixed identity, not to
 * "whatever the environment was that night".
 *
 * A NON-LOBSTER BASE TAKES NO CONFIG. `legacy`, `reflex` and `neutral` are not
 * driven by `TeamDecisionOptions`, so a contender that names one of them and a
 * `bot` is refused rather than silently ignored.
 */

import type { Board, CentaurMove, Coord, Direction, GameState, Snake } from '../src/types/battlesnake';
import { DecisionEngine, type MoveDecision } from '../src/logic/decision-engine';
import { DecisionWorkerPool } from '../src/logic/decision-worker-pool';
import { DEFAULT_CONFIG } from '../src/config/game-config';
import { HEURISTIC_KEYS, type HeuristicWeights } from '../src/config/heuristics';
import { TeamDetector } from '../src/logic/team-detector';
import { isPieceUnit } from '../src/logic/piece-threats';
import { BoardGraph } from '../src/logic/board-graph';
import { MoveAnalyzer } from '../src/logic/move-analyzer';
import {
  TeamDecisionEngine,
  type TeamDecisionOptions,
  type TeamDecisionPorts,
} from '../src/lobster/team-decision-engine';
/**
 * A `BotConfig`, structurally — deliberately NOT imported from
 * `../src/lobster/bot-config`.
 *
 * This harness is built against ARBITRARY branches (build-bot.sh), and a bundle
 * from a branch that predates the flag teardown has no `bot-config` module at
 * all; even a type-only import would fail that whole harness build and take
 * every other bot down with it. The same reasoning as the slider profiles two
 * lines up, one level stricter because this one is a type.
 *
 * So the shape is open and the BUNDLE validates it: `resolveBotConfig` warns
 * and falls back on any field it does not recognise, which is the only place
 * that knows what the branch actually has. An old bundle handed a `bot` will
 * ignore it, and `checkBundleTakesBotConfig` below is how a spec finds that out
 * loudly instead of by measuring an A/A pair.
 */
export type BotConfig = Readonly<Record<string, unknown>>;
import { defaultEvaluator, materialEvaluator } from '../src/lobster/evaluate';
// The slider-repair profiles are resolved at RUNTIME, not imported by name.
// This harness is built against ARBITRARY branches (see build-bot.sh), and a
// branch that predates I2 — `claude/cluster-lookahead` is one — does not export
// `territorySliderEvaluator` at all. A static import would fail the whole
// harness build on that branch and take every other bot down with it. A
// namespace import plus a checked lookup keeps the build green everywhere and
// fails loudly, at bot-construction time, only for the arm that actually asked
// for a profile its bundle does not carry.
import * as evaluateNs from '../src/lobster/evaluate';
import { clearGeometryCache } from '../src/lobster/substrate';
import type { UnitId } from '../src/lobster/contracts';
import type { KernelReport } from '../src/lobster/kernel';
import { marshalBoard } from '../src/logic/turn-oracle';
import { planUnitAction } from '../src/engine-vendor/engine/moveGrammar';
import type { UnitType } from '../src/engine-vendor/shared/types/Game';
import { hash32 } from './rng';

export type BotName =
  | 'lobster-territory'
  | 'lobster-slider'
  | 'lobster-slider-royal'
  | 'lobster-material'
  | 'legacy'
  | 'reflex'
  | 'neutral';

export const BOT_NAMES: ReadonlyArray<BotName> = [
  'lobster-territory',
  'lobster-slider',
  'lobster-slider-royal',
  'lobster-material',
  'legacy',
  'reflex',
  'neutral',
];

/**
 * Look an evaluator up by export name in the bundle's own `lobster/evaluate`.
 *
 * Throws with the branch's actual export list rather than a `undefined is not a
 * constructor` three frames deeper, because the only way this fails is an arm
 * asking a bundle for a profile that branch does not have — which is a spec
 * error the operator must see by name.
 */
function evaluatorNamed(exportName: string): unknown {
  const found = (evaluateNs as unknown as Record<string, unknown>)[exportName];
  if (found === undefined) {
    const have = Object.keys(evaluateNs)
      .filter((k) => k.endsWith('Evaluator'))
      .join(', ');
    throw new Error(
      `this bundle's src/lobster/evaluate exports no "${exportName}" — the branch it was ` +
        `built from predates that profile. Evaluators it does export: ${have}. ` +
        `Drop the arm, or point it at a branch that carries the profile.`
    );
  }
  return found;
}

/**
 * A plan bound as it survives JSON.
 *
 * The evaluator's floor and ceiling are LATTICE ELEMENTS, not scalars: `DEAD`
 * is `-Infinity` (`partial-engine/bounds.ts:37`) and means "eliminated in the
 * worst world I can reach", `WIN` is `+Infinity` and means "every opponent
 * gone". `JSON.stringify` turns both into `null`, which would erase the single
 * most informative thing a bound can say and make it indistinguishable from a
 * missing measurement. They are encoded as their names instead.
 */
export type BoundValue = number | 'DEAD' | 'WIN' | 'NaN';

export function encodeBound(x: number): BoundValue {
  if (Number.isFinite(x)) return x;
  if (Number.isNaN(x)) return 'NaN';
  return x > 0 ? 'WIN' : 'DEAD';
}

/** The inverse, for miners: `DEAD`/`WIN` back to +/-Infinity. */
export function decodeBound(x: BoundValue): number {
  if (typeof x === 'number') return x;
  if (x === 'WIN') return Number.POSITIVE_INFINITY;
  if (x === 'DEAD') return Number.NEGATIVE_INFINITY;
  return Number.NaN;
}

/** Per-decision telemetry, uniform across variants. Lobster fills the rest. */
export interface DecisionTelemetry {
  /** Wall-clock ms the decision actually took. */
  readonly wallMs: number;
  /** Wall-clock ms past the deadline (0 when on time). */
  readonly overrunMs: number;
  /** Ms from decision start to the FIRST staged move. */
  readonly firstStageMs: number | null;
  /** Distinct recommendations that reached the manager surface. */
  readonly emissions: number;
  /** Plans the evaluator scored. Lobster only (`report.evaluateCalls`). */
  readonly plansEvaluated: number | null;
  /** Anytime refinement slices taken. Lobster only. */
  readonly slices: number | null;
  /** Floor / estimate / ceiling of the CHOSEN plan — the last journal record. */
  readonly chosen: {
    lo: BoundValue;
    est: BoundValue;
    hi: BoundValue;
    posture: string;
    horizon: number;
  } | null;
  /** Declared modelling narrowings. Non-empty means a degraded decision. */
  readonly assumptions: number;
  /**
   * `KernelReport.boundViolations` verbatim. NOT a single phenomenon — see
   * `boundsInversions` and `ratchetRefusals`, which split it.
   */
  readonly boundViolations: number | null;
  /**
   * The subset that is genuine UNSOUNDNESS: the bounds layer proved one of its
   * own members inconsistent (`BoundsInversionError`, refusal key
   * `bounds-inversion`). This must be zero, and the smoke fails on it.
   */
  readonly boundsInversions: number | null;
  /**
   * The rest: `ratchet-floor` and `ratchet-gap`. A search slice handed back a
   * weaker promise than the standing basis, so the kernel REFUSED that slice
   * and kept its incumbent (kernel.ts:1660-1671). It is a monotonicity
   * complaint about one refinement step, not a broken bound — the decision
   * stays sound because the result was discarded rather than clamped. Common
   * under a tight budget; worth reporting, wrong to fail on.
   */
  readonly ratchetRefusals: number | null;
  /** The full refusal histogram, for a miner that wants the detail. */
  readonly refusals: Readonly<Record<string, number>> | null;
  /**
   * CL7 — THE MECHANISM FOLD, and the arm audit.
   *
   * `TeamTurnResult.mechanism` reduced to scalars a manifest row can carry.
   * Null on any bundle built before the CL7 telemetry closure landed, which is
   * every batch up to and including 20260827 — and null, not zero, because a
   * counter a build never had is not a counter that read zero. The ingest
   * carries that distinction all the way through: it reports such a metric as
   * UNREADABLE rather than as a null result.
   *
   * `flags` is the RESOLVED ARM, which is the field that answers "was this
   * actually the treatment arm?". The spec records what was ASKED for; this is
   * what the engine resolved, and when they disagree this one is the arm.
   *
   * TWO SOURCES, ONE FIELD, and the name is kept for the manifest's sake. A
   * bundle built after the flag teardown of 2026-08-29 publishes
   * `mechanism.config` — the resolved `BotConfig` — and one from before it
   * publishes `mechanism.flags`. Both are folded here under `flags`, because a
   * batch-1 row and a batch-3 row have to sit in one manifest schema and
   * `aggregate.js` has to table them together. The KEYS say which shape a row
   * is: a post-teardown stamp carries `name`, and its arm is a bot rather than
   * an environment.
   *
   * `wasmRuns` is the specific gap that voided P5: the wasm arm is refused per
   * partition, silently, whenever an input is not resident in linear memory, so
   * an arm can be `on` and do nothing. A null placement from an arm that never
   * ran is a different finding from a null from an arm that ran and did not
   * help, and this is what tells them apart.
   */
  readonly mechanism: {
    readonly flags: Readonly<Record<string, string | number | boolean>>;
    readonly wasmRuns: number | null;
    readonly wasmRefused: number | null;
    readonly clusterJoints: number | null;
    readonly clusterEnumMs: number | null;
    readonly selectionFar: number | null;
    readonly selectionDraws: number | null;
    readonly refineMovedLo: number | null;
    readonly refineInverted: number | null;
    readonly scoutThreads: number | null;
    readonly scoutPlies: number | null;
    readonly scoutRefusals: number | null;
    readonly ceilingDecided: number | null;
  } | null;
  /** The decision threw. Production logs and moves on; so does this harness. */
  readonly error: string | null;
}

/**
 * Fold one decision's mechanism report into the scalars a manifest row holds.
 *
 * DEFENSIVE ON PURPOSE. The harness compiles against whatever bundle it was
 * built with, and a bundle from before the CL7 closure has no `mechanism` on
 * its result at all. `any` here is not laziness: this is a cross-version seam,
 * and the alternative — a type that asserts the field exists — would make the
 * kit refuse to build the older branches it exists to race.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function foldMechanism(m: any): DecisionTelemetry['mechanism'] {
  if (m === null || m === undefined) return null;
  const n = (x: unknown): number | null => (typeof x === 'number' ? x : null);
  const refusalCount = (r: unknown): number | null =>
    r === null || r === undefined || typeof r !== 'object'
      ? null
      : Object.values(r as Record<string, number>).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
  return {
    flags: { ...(m.config ?? m.flags ?? {}) },
    wasmRuns: n(m.wasm?.runs),
    wasmRefused: n(m.wasm?.refused),
    clusterJoints: n(m.cluster?.jointsEnumerated),
    clusterEnumMs: n(m.cluster?.enumMs),
    selectionFar: n(m.selection?.farAdmitted),
    selectionDraws: n(m.selection?.draws),
    refineMovedLo: n(m.refine?.movedLo),
    refineInverted: n(m.refine?.inverted),
    scoutThreads: n(m.scout?.threads),
    scoutPlies: n(m.scout?.plies),
    scoutRefusals: refusalCount(m.scout?.refusals),
    ceilingDecided: n(m.adjudication?.ceilingDecided),
  };
}

export interface DecisionOutcome {
  /** The staged set as the wire would carry it. */
  readonly moves: Map<string, CentaurMove>;
  readonly telemetry: DecisionTelemetry;
}

export interface Bot {
  /** A built-in (`BOT_NAMES`) or a contender key. This is what a manifest row
   * keys on, which is why two bots may never wear one name. */
  readonly name: string;
  /**
   * Which of our alive units this variant SPEAKS FOR. Legacy speaks for snakes
   * only; its pieces are not "unstaged bugs" but units the path never had a bot
   * for, so the match loop must not count them as such.
   */
  speaksFor(board: Board, teamID: string): string[];
  decide(board: Board, turn: number, teamID: string, deadlineMs: number, seed: number): Promise<DecisionOutcome>;
  release(): void;
}

function weightsOf(): HeuristicWeights {
  const w = {} as HeuristicWeights;
  for (const key of HEURISTIC_KEYS) w[key] = DEFAULT_CONFIG[key];
  return w;
}

function viewFor(board: Board, snake: Snake, turn: number): GameState {
  return {
    game: {
      id: 'sweep',
      ruleset: { name: 'tactictoes', version: 'sweep', settings: {} },
      map: 'standard',
      timeout: 10_000,
      source: 'sweep',
    },
    turn,
    board,
    you: { ...snake, head: { ...snake.head }, body: snake.body.map((c) => ({ ...c })) },
  } as GameState;
}

function aliveOf(board: Board, teamID: string): Snake[] {
  return (board.snakes ?? []).filter(
    (s) => TeamDetector.getTeamKey(s) === teamID && s.health > 0 && s.body.length > 0
  );
}

const IDLE: DecisionOutcome = {
  moves: new Map(),
  telemetry: {
    wallMs: 0,
    overrunMs: 0,
    firstStageMs: null,
    emissions: 0,
    plansEvaluated: null,
    slices: null,
    chosen: null,
    assumptions: 0,
    boundViolations: null,
    boundsInversions: null,
    ratchetRefusals: null,
    mechanism: null,
    refusals: null,
    error: null,
  },
};

// ------------------------------------------------------------------- lobster

function lobsterBot(name: string, options: TeamDecisionOptions): Bot {
  let started = 0;
  let firstStageMs: number | null = null;
  let emissions = 0;
  const moves = new Map<string, CentaurMove>();
  let registry: string[] = [];

  const ports: TeamDecisionPorts = {
    setBotRecommendation: (_gameId, snakeId, move) => {
      emissions++;
      const at = Date.now() - started;
      if (firstStageMs === null) firstStageMs = at;
      moves.set(snakeId, move);
    },
    enableTeamStaging: () => undefined,
    onPinEvent: () => () => undefined,
    pinSnakeIdOf: (_gameId, unitId: UnitId) => registry[unitId] ?? null,
    log: () => undefined,
  };
  const engine = new TeamDecisionEngine(ports, options);

  return {
    name,
    speaksFor: (board, teamID) => aliveOf(board, teamID).map((s) => s.id),
    release: () => {
      engine.release('sweep');
      clearGeometryCache();
    },
    async decide(board, turn, teamID, deadlineMs): Promise<DecisionOutcome> {
      started = Date.now();
      firstStageMs = null;
      emissions = 0;
      moves.clear();
      const alive = aliveOf(board, teamID);
      registry = alive.map((s) => s.id);
      if (alive.length === 0) return IDLE;

      // Production contains a thrown team decision with a `.catch` that logs
      // and moves on (firebase-interface.ts's lobster branch), so the harness
      // does the same — and counts it, because a decision that throws stages
      // nothing for the units the fast pass did not already cover.
      let error: string | null = null;
      let report: KernelReport | null = null;
      let assumptions = 0;
      let mechanism: DecisionTelemetry['mechanism'] = null;
      try {
        const result = await engine.decideTurn({
          gameId: 'sweep',
          turn,
          board,
          ourTeamId: teamID,
          units: alive.map((s) => ({ snakeId: s.id, view: viewFor(board, s, turn) })),
          deadlineMs,
        });
        report = result.report;
        assumptions = result.assumptions.length;
        // Cross-version seam: absent on any bundle from before the CL7
        // telemetry closure, and absent must stay absent.
        mechanism = foldMechanism((result as { mechanism?: unknown }).mechanism);
      } catch (err) {
        const e = err as { name?: string; message?: string; code?: string };
        error = `${e.name ?? 'Error'}: ${e.message ?? String(err)}${e.code ? ` [${e.code}]` : ''}`;
      }

      const last = report?.journal?.[report.journal.length - 1] ?? null;
      return {
        moves: new Map(moves),
        telemetry: {
          wallMs: Date.now() - started,
          overrunMs: Math.max(0, Date.now() - deadlineMs),
          firstStageMs,
          emissions,
          plansEvaluated: report?.evaluateCalls ?? null,
          slices: report?.slices ?? null,
          chosen:
            last === null
              ? null
              : {
                  lo: encodeBound(last.lo),
                  est: encodeBound(last.est),
                  hi: encodeBound(last.hi),
                  posture: String(last.posture),
                  horizon: last.horizon,
                },
          assumptions,
          boundViolations: report?.boundViolations ?? null,
          boundsInversions: report === null ? null : (report.refusals['bounds-inversion'] ?? 0),
          ratchetRefusals:
            report === null
              ? null
              : (report.refusals['ratchet-floor'] ?? 0) + (report.refusals['ratchet-gap'] ?? 0),
          refusals: report === null ? null : { ...report.refusals },
          mechanism,
          error,
        },
      };
    },
  };
}

// -------------------------------------------------------------------- legacy

/**
 * `firebase-interface.ts`'s legacy branch. One independent anytime decision per
 * controlled alive SNAKE, launched concurrently, each over its own `withYou`
 * view with the shared deadline, forwarding a recommendation only when the move
 * actually changes.
 *
 * The one deviation from `VoronoiStrategy`: the config comes from
 * DEFAULT_CONFIG rather than the Firestore-backed ConfigStore, and the decision
 * logger is not attached. Both are exactly what the strategy falls back to with
 * an empty store, and neither touches move selection.
 */
function legacyBot(): Bot {
  const engine = new DecisionEngine({
    timeoutMs: DEFAULT_CONFIG.timeoutMs,
    nearbyDistance: DEFAULT_CONFIG.nearbyDistance,
    weights: weightsOf(),
  });
  const detector = new TeamDetector();

  return {
    name: 'legacy',
    // Snakes only — the production truth under the legacy flag (`views` holds
    // snake units alone). A piece is not an unstaged bug here.
    speaksFor: (board, teamID) => aliveOf(board, teamID).filter((s) => !isPieceUnit(s)).map((s) => s.id),
    release: () => undefined,
    async decide(board, turn, teamID, deadlineMs): Promise<DecisionOutcome> {
      const started = Date.now();
      const alive = aliveOf(board, teamID);
      const ourSnakes = alive.filter((s) => !isPieceUnit(s));
      if (ourSnakes.length === 0) return IDLE;

      const teams = detector.detectTeams(board.snakes ?? []);
      const ourTeam = teams.find((t) => t.snakes.some((s) => TeamDetector.getTeamKey(s) === teamID));
      const teamSnakeIds = new Set<string>(
        ourTeam ? ourTeam.snakes.map((s) => s.id) : alive.map((s) => s.id)
      );

      const moves = new Map<string, CentaurMove>();
      let emissions = 0;
      let firstStageMs: number | null = null;

      await Promise.all(
        ourSnakes.map(async (snake) => {
          const view = viewFor(board, snake, turn);
          let last: Direction | null = null;
          const forward = (move: Direction): void => {
            if (move === last) return;
            last = move;
            emissions++;
            const at = Date.now() - started;
            if (firstStageMs === null) firstStageMs = at;
            moves.set(snake.id, move);
          };
          try {
            const decision = await engine.decideIteratively(view, teamSnakeIds, {
              waypoint: null,
              deadlineMs,
              onUpdate: (partial: MoveDecision) => forward(partial.move),
            });
            forward(decision.move);
          } catch {
            // Production's own fallback: log and stage 'up'.
            forward('up');
          }
        })
      );

      return {
        moves,
        telemetry: {
          wallMs: Date.now() - started,
          overrunMs: Math.max(0, Date.now() - deadlineMs),
          firstStageMs,
          emissions,
          plansEvaluated: null,
          slices: null,
          chosen: null,
          assumptions: 0,
          boundViolations: null,
          boundsInversions: null,
          ratchetRefusals: null,
          mechanism: null,
          refusals: null,
          error: null,
        },
      };
    },
  };
}

// -------------------------------------------------------------------- reflex

/**
 * The fast staging pass as a whole-team bot.
 *
 * SNAKES take `quickSafeMove`, transcribed from `firebase-interface.ts:1570`:
 * prefer continuing straight when that is safe, else the analyzer's first safe
 * move, else a risky one. PIECES — which production's fast pass does not speak
 * for at all — take the first legal grammar move toward an empty cell, so that
 * "reflex" names a baseline for a whole roster instead of half of one. That
 * addition is the harness's, and it is the only place a reflex bot departs from
 * the production fast pass.
 */
function reflexBot(): Bot {
  const analyzer = new MoveAnalyzer();

  return {
    name: 'reflex',
    speaksFor: (board, teamID) => aliveOf(board, teamID).map((s) => s.id),
    release: () => undefined,
    async decide(board, turn, teamID, _deadlineMs, seed): Promise<DecisionOutcome> {
      const started = Date.now();
      const alive = aliveOf(board, teamID);
      if (alive.length === 0) return IDLE;

      const moves = new Map<string, CentaurMove>();
      let firstStageMs: number | null = null;
      let error: string | null = null;

      const pieces = alive.filter((s) => isPieceUnit(s));
      for (const snake of alive) {
        if (isPieceUnit(snake)) continue;
        try {
          const move = quickSafeMove(viewFor(board, snake, turn));
          if (move !== null) {
            if (firstStageMs === null) firstStageMs = Date.now() - started;
            moves.set(snake.id, move);
          }
        } catch (err) {
          error = String((err as Error)?.message ?? err);
        }
      }

      if (pieces.length > 0) {
        try {
          for (const [id, cell] of firstLegalPieceMoves(board, turn, pieces, seed)) {
            if (firstStageMs === null) firstStageMs = Date.now() - started;
            moves.set(id, cell);
          }
        } catch (err) {
          error = String((err as Error)?.message ?? err);
        }
      }

      return {
        moves,
        telemetry: {
          wallMs: Date.now() - started,
          overrunMs: 0,
          firstStageMs,
          emissions: moves.size,
          plansEvaluated: null,
          slices: null,
          chosen: null,
          assumptions: 0,
          boundViolations: null,
          boundsInversions: null,
          ratchetRefusals: null,
          mechanism: null,
          refusals: null,
          error,
        },
      };
    },
  };
}

/** Transcribed from `firebase-interface.ts:1570` — a ~1ms safe move. */
export function quickSafeMove(view: GameState): Direction | null {
  const graph = new BoardGraph(view);
  const analysis = new MoveAnalyzer().analyzeMoves(view.you, view, graph);
  const head = view.you.head;
  const neck = view.you.body[1];
  let straight: Direction | null = null;
  if (neck && (neck.x !== head.x || neck.y !== head.y)) {
    if (head.x > neck.x) straight = 'right';
    else if (head.x < neck.x) straight = 'left';
    else if (head.y > neck.y) straight = 'up';
    else straight = 'down';
  }
  if (straight && analysis.safe.includes(straight)) return straight;
  return analysis.safe[0] ?? analysis.risky[0] ?? null;
}

/**
 * A first-legal move per piece, preferring an empty cell, tie-broken by a
 * stable hash so the variant is a pure function of (board, turn, seed).
 * Legality comes from the vendored grammar — no rule is re-implemented.
 */
function firstLegalPieceMoves(
  board: Board,
  turn: number,
  pieces: ReadonlyArray<Snake>,
  seed: number
): Map<string, number> {
  const marshalled = marshalBoard(board, turn);
  const pawnTargets = new Set<number>(marshalled.config.food);
  for (const u of marshalled.units) for (const c of u.occupancy) pawnTargets.add(c);
  const anyCells = new Set<number>();
  for (const u of marshalled.units) for (const c of u.occupancy) anyCells.add(c);

  const byId = new Map(marshalled.units.map((u) => [u.id, u]));
  const W = marshalled.fullWidth;
  const H = marshalled.fullHeight;
  const out = new Map<string, number>();

  for (const piece of pieces) {
    const unit = byId.get(piece.id);
    if (unit === undefined) continue;
    const origin = unit.occupancy[0] as number;
    const legal: number[] = [];
    for (let cell = 0; cell < W * H; cell++) {
      if (cell === origin) continue;
      const action = planUnitAction(
        unit.type as UnitType,
        origin,
        cell,
        W,
        H,
        unit.orientation,
        pawnTargets
      );
      if (action === null || action.kind !== 'move') continue;
      legal.push(cell);
    }
    const empty = legal.filter((c) => !anyCells.has(c));
    const options = empty.length > 0 ? empty : legal;
    if (options.length === 0) continue;
    let best = options[0] as number;
    let bestKey = Number.POSITIVE_INFINITY;
    for (const cell of options) {
      const key = hash32(`${seed}:${turn}:${piece.id}:${cell}`);
      if (key < bestKey) {
        bestKey = key;
        best = cell;
      }
    }
    out.set(piece.id, best);
  }
  return out;
}

// ------------------------------------------------------------------- neutral

/**
 * The scripted disturbance from `bench/prod/neutral.ts`: step toward the
 * nearest enemy king (else the nearest enemy unit), never onto a cell one of
 * its own units occupies, ties broken by a stable hash. A pure function of
 * (board, turn, seed), so the same position always draws the same reply
 * whichever engine produced that position.
 */
function neutralBot(): Bot {
  return {
    name: 'neutral',
    speaksFor: (board, teamID) => aliveOf(board, teamID).map((s) => s.id),
    release: () => undefined,
    async decide(board, turn, teamID, _deadlineMs, seed): Promise<DecisionOutcome> {
      const started = Date.now();
      const moves = neutralMoves(board, turn, teamID, seed);
      return {
        moves,
        telemetry: {
          wallMs: Date.now() - started,
          overrunMs: 0,
          firstStageMs: moves.size > 0 ? Date.now() - started : null,
          emissions: moves.size,
          plansEvaluated: null,
          slices: null,
          chosen: null,
          assumptions: 0,
          boundViolations: null,
          boundsInversions: null,
          ratchetRefusals: null,
          mechanism: null,
          refusals: null,
          error: null,
        },
      };
    },
  };
}

export function neutralMoves(
  board: Board,
  turn: number,
  teamID: string,
  seed: number
): Map<string, CentaurMove> {
  const marshalled = marshalBoard(board, turn);
  const pawnTargets = new Set<number>(marshalled.config.food);
  for (const u of marshalled.units) for (const c of u.occupancy) pawnTargets.add(c);

  const ownCells = new Set<number>();
  const anyCells = new Set<number>();
  for (const u of marshalled.units) {
    for (const c of u.occupancy) anyCells.add(c);
    if (u.teamID !== teamID) continue;
    for (const c of u.occupancy) ownCells.add(c);
  }
  const enemies = marshalled.units.filter((u) => u.teamID !== teamID);
  const kings = enemies.filter((u) => u.isKing === true);
  const targets = (kings.length > 0 ? kings : enemies).map((u) => u.occupancy[0] as number);

  const W = marshalled.fullWidth;
  const H = marshalled.fullHeight;
  const dist = (a: number, b: number): number =>
    Math.abs((a % W) - (b % W)) + Math.abs(Math.floor(a / W) - Math.floor(b / W));

  const out = new Map<string, CentaurMove>();
  const byId = new Map((board.snakes ?? []).map((s) => [s.id, s]));

  for (const unit of marshalled.units) {
    if (unit.teamID !== teamID) continue;
    const origin = unit.occupancy[0] as number;
    const legal: number[] = [];
    for (let cell = 0; cell < W * H; cell++) {
      if (cell === origin) continue;
      const action = planUnitAction(unit.type as UnitType, origin, cell, W, H, unit.orientation, pawnTargets);
      if (action === null || action.kind !== 'move') continue;
      legal.push(cell);
    }
    const empty = legal.filter((c) => !anyCells.has(c));
    const notOurs = legal.filter((c) => !ownCells.has(c));
    const options = empty.length > 0 ? empty : notOurs.length > 0 ? notOurs : legal;
    if (options.length === 0) continue;
    let best = options[0] as number;
    let bestKey = Number.POSITIVE_INFINITY;
    for (const cell of options) {
      let d = Number.POSITIVE_INFINITY;
      for (const t of targets) d = Math.min(d, dist(cell, t));
      const tie = hash32(`${seed}:${turn}:${unit.id}:${cell}`) / 4294967296;
      const key = d + tie * 0.5;
      if (key < bestKey) {
        bestKey = key;
        best = cell;
      }
    }
    const snake = byId.get(unit.id) as Snake;
    if (unit.type === 'snake') {
      const from: Coord = marshalled.toCell(origin);
      const to: Coord = marshalled.toCell(best);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'up' : dy === -1 ? 'down' : null;
      if (dir !== null) out.set(snake.id, dir);
    } else {
      out.set(snake.id, best);
    }
  }
  return out;
}

// ----------------------------------------------------------------- contenders

/**
 * A CONTENDER, as it appears in a spec. Plain JSON, validated on the way in.
 *
 * `bot` is the engine's own `BotConfig` and is passed through unread: the
 * bundle validates it (`resolveBotConfig` warns and falls back on anything it
 * does not recognise), because the bundle is the only thing that knows which
 * fields its branch has.
 */
export interface ContenderSpec {
  /** Which built-in supplies the driving code. Default `lobster-territory`. */
  readonly base?: BotName;
  /** The `BotConfig` handed to the engine. Lobster bases only. */
  readonly bot?: BotConfig;
  /** An evaluator export name in the bundle's own `lobster/evaluate`. */
  readonly evaluator?: string;
}

export type ContenderMap = Readonly<Record<string, ContenderSpec>>;

const LOBSTER_BASES: ReadonlyArray<BotName> = [
  'lobster-territory',
  'lobster-slider',
  'lobster-slider-royal',
  'lobster-material',
];

/**
 * Validate a contender map without building anything.
 *
 * Called by `run-sweep` before a single game runs, because the one thing worse
 * than a spec that fails is a spec that fails on game 340 of 480.
 */
export function checkContenders(contenders: ContenderMap): void {
  let needsBotConfig = false;
  for (const [name, spec] of Object.entries(contenders)) {
    if (spec.bot !== undefined) needsBotConfig = true;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      throw new Error(`contender name "${name}" must be alphanumeric/dash/underscore`);
    }
    const base = spec.base ?? 'lobster-territory';
    // A contender MAY wear a built-in's name, on one condition: it must declare
    // that same built-in as its base, so the name still means "this bot,
    // configured" and cannot come to mean two different bots inside one run.
    //
    // It is not a loophole, it is the common case. `run-pair.js --arm
    // name=<bundle>,bot=<...>` configures whatever lobster contender the SHARED
    // spec already seats, and the seat has to keep its name or the two arms'
    // manifest rows stop pairing without a --subject-map. Same seat, same name,
    // two configurations — which is exactly the comparison the flags could
    // never express per seat.
    if (isBotName(name) && base !== name) {
      throw new Error(
        `contender "${name}" shadows the built-in bot of that name but declares base ` +
          `"${base}". A manifest row keys on the name, so two different bots may never ` +
          `wear one. Rename the contender, or set its base to "${name}".`
      );
    }
    if (!isBotName(base)) {
      throw new Error(`contender "${name}": unknown base "${base}"; known: ${BOT_NAMES.join(', ')}`);
    }
    if (spec.bot !== undefined && !LOBSTER_BASES.includes(base)) {
      throw new Error(
        `contender "${name}": base "${base}" is not driven by TeamDecisionOptions, so a ` +
          `"bot" config would be silently ignored. Drop it, or pick a lobster base.`
      );
    }
    if (spec.evaluator !== undefined && !LOBSTER_BASES.includes(base)) {
      throw new Error(
        `contender "${name}": base "${base}" has no evaluator seam, so "evaluator" would ` +
          `be silently ignored.`
      );
    }
  }
  if (needsBotConfig) requireBundleTakesBotConfig();
}

/**
 * REFUSE A SPEC THIS BUNDLE CANNOT ACTUALLY RUN.
 *
 * A bundle built from a branch older than the flag teardown has no
 * `lobster/bot-config`, and `TeamDecisionOptions` has no `bot` field — so it
 * would accept the option object, ignore the config, and play the default bot
 * under the contender's name. That is an A/A pair wearing a treatment's name,
 * which is the exact failure this whole program has been bitten by twice
 * (CENTAUR_WASM, and every mistyped `1|on|true` flag before it).
 *
 * The require is guarded because a missing module here is a legitimate,
 * expected state — an old bundle — and not a harness bug.
 */
function requireBundleTakesBotConfig(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../src/lobster/bot-config') as Record<string, unknown>;
    if (typeof mod.resolveBotConfig === 'function') return;
  } catch {
    /* falls through to the throw */
  }
  throw new Error(
    'this spec declares a contender with a "bot" config, but the bundle it is running ' +
      'against has no src/lobster/bot-config — it predates the flag teardown of 2026-08-29. ' +
      'It would ignore the config and play the DEFAULT bot under the contender\'s name, ' +
      'which is an A/A pair wearing a treatment\'s name. Rebuild the arm from a branch that ' +
      'carries bot-config, or express the arm as a different bundle.'
  );
}

// ------------------------------------------------------------------ registry

/**
 * Build a bot by name. A name is either a built-in or a key of `contenders`.
 *
 * The contender map is threaded from the spec rather than read from a module
 * global so that two arms in one process (which the smoke runner does) cannot
 * see each other's definitions.
 */
export function makeBot(name: string, contenders: ContenderMap = {}): Bot {
  const contender = contenders[name];
  if (contender !== undefined) {
    const base = contender.base ?? 'lobster-territory';
    // Cast rather than annotated: `bot` is a field an OLD bundle's
    // `TeamDecisionOptions` does not declare, and this file has to compile
    // against those too. `checkContenders` has already refused the case where
    // that would silently matter.
    const options = {
      evaluate:
        contender.evaluator === undefined
          ? baseEvaluatorOf(base)
          : (evaluatorNamed(contender.evaluator) as TeamDecisionOptions['evaluate']),
      ...(contender.bot === undefined ? {} : { bot: { name, ...contender.bot } }),
    } as TeamDecisionOptions;
    return lobsterBot(name, options);
  }
  return makeBaseBot(name as BotName);
}

/** The evaluator a built-in lobster base runs, by name. */
function baseEvaluatorOf(base: BotName): TeamDecisionOptions['evaluate'] {
  switch (base) {
    case 'lobster-slider':
      return evaluatorNamed('territorySliderEvaluator') as TeamDecisionOptions['evaluate'];
    case 'lobster-slider-royal':
      return evaluatorNamed('territorySliderRoyalEvaluator') as TeamDecisionOptions['evaluate'];
    case 'lobster-material':
      return materialEvaluator;
    default:
      return defaultEvaluator;
  }
}

function makeBaseBot(name: BotName): Bot {
  switch (name) {
    case 'lobster-territory':
      // The shipped default. Naming the evaluator explicitly rather than
      // relying on the engine default keeps a replay honest if that default
      // ever moves again.
      return lobsterBot('lobster-territory', { evaluate: defaultEvaluator });
    case 'lobster-slider':
      // I2's TERRITORY_SLIDER_PROFILE — territory plus the two terms the budget
      // ladder's replays say are missing (`command` and the movement budget),
      // both gated on class properties so a board with no piece on it scores
      // IDENTICALLY to `lobster-territory`. That identity is what makes a
      // snake-only cell a provably-inert NULL for this arm — see
      // src/tests/territory-slider.test.ts, and context/METHODOLOGY.md §3.
      //
      // Nothing in production selects this profile: `TeamDecisionOptions.evaluate`
      // is the ONLY seam, which is why the arm exists here and nowhere else.
      // A spec can also reach it as `{"evaluator": "territorySliderEvaluator"}`
      // on a contender, which is the same seam named as data.
      return lobsterBot('lobster-slider', {
        evaluate: evaluatorNamed('territorySliderEvaluator') as TeamDecisionOptions['evaluate'],
      });
    case 'lobster-slider-royal':
      // The ablation: the repair with the royal exclusion lifted. Only
      // meaningful on a cell that fields a king.
      return lobsterBot('lobster-slider-royal', {
        evaluate: evaluatorNamed('territorySliderRoyalEvaluator') as TeamDecisionOptions['evaluate'],
      });
    case 'lobster-material':
      return lobsterBot('lobster-material', { evaluate: materialEvaluator });
    case 'legacy':
      return legacyBot();
    case 'reflex':
      return reflexBot();
    case 'neutral':
      return neutralBot();
    default:
      throw new Error(
        `unknown bot "${String(name)}"; known built-ins: ${BOT_NAMES.join(', ')}. ` +
          `A name that is not one of those must be declared in the spec's "contenders".`
      );
  }
}

export function isBotName(s: string): s is BotName {
  return (BOT_NAMES as ReadonlyArray<string>).includes(s);
}

/**
 * Terminate the shared decision worker pool.
 *
 * MUST be called before a process that has run the legacy bot tries to exit.
 * `DecisionWorkerPool` spawns `worker_threads` and calls `unref()` on them, but
 * an unref'd worker still holds the loop while it has queued work or an open
 * message port, and in practice a process that has run one legacy decision
 * never exits on its own — measured: a match that finished in 3.3s sat for two
 * minutes afterwards until it was killed. Production has the same requirement
 * and meets it with `shutdownSharedIfRunning` on idle entry and at graceful
 * shutdown; this is the harness's copy of that call.
 *
 * It is deliberately NOT part of `Bot.release()`. The pool is a process-wide
 * singleton and costs ~800ms to spawn, so a worker process that plays many
 * games should keep it warm and shut it down once, at the end — which is what
 * the runner and `match-worker` do.
 */
export function shutdownDecisionPool(): void {
  DecisionWorkerPool.shutdownSharedIfRunning();
}
