/**
 * THE TEAM DECISION ENGINE — one decision per TEAM per turn, producing a joint
 * staged set through the LOBSTER kernel, behind CENTAUR_ENGINE=lobster.
 *
 * WHAT IT TOUCHES, AND WHAT IT NEVER DOES. The engine consumes the wire
 * surface exactly as the wire layer documented it: per-unit
 * `setBotRecommendation(gameId, snakeId, move, turnData)` — so manual >
 * waypoint > bot precedence and the fatal-move consent gate run untouched in
 * the manager — plus `enableTeamStaging(gameId)` to route the manager's
 * staged set through the batched team submitter, and the transport's
 * `onPinEvent` stream into `kernel.onPinEvent`. It writes nothing to the wire
 * itself, never commits, never unpins, and stages only through the same door
 * every other recommendation uses.
 *
 * NUMBERING. Three unit vocabularies meet here and are never conflated: the
 * wire's snake ids (strings), the transport registry's per-game pin-event
 * numbers, and the substrate's per-board unit numbers. pins.ts owns the
 * translation; this file only routes.
 *
 * HELD CAPACITY (MAX_FROZEN). The cloud field carries at most 32 held units
 * and a 3-team board with nothing modelled exceeds it. The ruling (build
 * contract, B1 directive): never truncate — MODEL the nearest units by
 * arrival-grid distance until the held set fits, each modelling choice a
 * DECLARED `reference-action` assumption fixing the unit to its kind's own
 * default (`NO_ORDER_MOVE`). The assumptions ride every score's basis and
 * every emitted record, so a narrowed decision is never mistaken for an
 * unconditional one.
 *
 * CLOCKS. The wire's deadline arrives in local wall-clock terms (the
 * TurnDeadlineGuard's output); it crosses to the kernel's monotonic clock
 * exactly once, through `deadlineFromWallClock`. The measured slice cost of a
 * turn is carried into the next turn's kernel (`initialStepCostMs`) —
 * per-game state on this engine, never module scope.
 */

import type { Board as ApiBoard, CentaurMove, GameState } from '../types/battlesnake';
import type { TurnData } from '../server/active-game-manager';
import { moveIndexToDirection } from '../firebase/translate';
import { minWriteIntervalFromEnv } from '../wire/stage-throttle';
import { MAX_FROZEN, NEVER } from '../partial-engine/index';
import type {
  Assumption,
  Candidate,
  Evaluator,
  JointPlan,
  KernelInput,
  Pin,
  PinEvent,
  PlanScore,
  SearchContext,
  SearchCore,
  UnitId,
  Witness,
} from './contracts';
import { NO_ORDER_MOVE } from './contracts';
import { EngineSubstrate, makeSubstrate } from './substrate';
import type { SubstrateUnit } from './substrate';
import { GrammarCandidateGenerator } from './candidates';
import { materialEvaluator, standingOf } from './evaluate';
import { makeSearchCore } from './search';
import type { SearchTuning } from './search/core';
import {
  DEFAULT_KERNEL_OPTIONS,
  LobsterKernel,
  deadlineFromWallClock,
  defaultNow,
  type KernelOptions,
  type KernelReport,
} from './kernel';
import { TeamPinLedger, adviseFromReport, type TeamPinAdvice } from './pins';

// ------------------------------------------------------------------- ports

/** Everything the engine needs from the outside world, injectable for tests.
 * The manager half and the transport half are exactly the wire layer's
 * documented integration surface — nothing wider. */
export interface TeamDecisionPorts {
  setBotRecommendation(
    gameId: string,
    snakeId: string,
    move: CentaurMove,
    turnData: TurnData
  ): void;
  enableTeamStaging(gameId: string): void;
  /** Subscribe to a game's typed pin events; returns the unsubscriber. */
  onPinEvent(gameId: string, sink: (event: PinEvent) => void): () => void;
  /** The transport registry's reverse lookup for pin-event unit numbers. */
  pinSnakeIdOf(gameId: string, unitId: UnitId): string | null;
  /** Wall clock (Date.now scale). Injectable for tests. */
  now?(): number;
  /** The kernel's monotonic clock. Injectable for tests. */
  monotonic?(): number;
  env?: NodeJS.ProcessEnv;
  log?(message: string): void;
}

export interface TeamDecisionOptions {
  /** Evaluator for the decision. Defaults to the material profile — the
   * engine's own exact fold, the 1 ms reflex rung; the calibrated
   * reach/king-margin profile costs an arrival flood per unit per evaluation
   * and is a verification-wave decision, not a default. */
  readonly evaluate?: Evaluator;
  readonly search?: Partial<SearchTuning>;
  readonly kernel?: Partial<KernelOptions>;
  /** Horizon (turns) for the held-capacity arrival-distance ranking. */
  readonly arrivalHorizonTurns?: number;
  /** Advice threshold passed through to pins.adviseFromReport. */
  readonly adviceThreshold?: number;
}

export interface TeamTurnInput {
  readonly gameId: string;
  readonly turn: number;
  /** The canonical api-coordinate board (the manager's single truth). */
  readonly board: ApiBoard;
  /** Our team's id as the board's snakes carry it. */
  readonly ourTeamId: string;
  /** Our alive units with their per-snake views (TurnData needs one each). */
  readonly units: ReadonlyArray<{ readonly snakeId: string; readonly view: GameState }>;
  /** The decision deadline in LOCAL wall-clock ms — the TurnDeadlineGuard's
   * `effectiveDeadlineMs` output, already reserve- and skew-corrected. */
  readonly deadlineMs: number;
  /** unit wire id → absolute turn last observed (staleness source). */
  readonly observedTurns?: ReadonlyMap<string, number>;
}

export interface TeamTurnResult {
  readonly report: KernelReport | null;
  /** setBotRecommendation calls actually forwarded (changed moves only). */
  readonly forwarded: number;
  /** The declared modelling basis of the decision (held-capacity included). */
  readonly assumptions: ReadonlyArray<Assumption>;
  readonly advice: ReadonlyArray<TeamPinAdvice>;
  readonly emitted: number;
}

interface GameState_ {
  ledger: TeamPinLedger;
  unsubscribe: (() => void) | null;
  /** The previous turn's measured slice cost — KernelInput.initialStepCostMs. */
  stepCostMs: number | undefined;
  /** The live decision's event sink, when one is running. */
  live: {
    turn: number;
    kernel: LobsterKernel;
    sub: EngineSubstrate;
  } | null;
}

export type PinAdviceSink = (gameId: string, advice: ReadonlyArray<TeamPinAdvice>) => void;

// -------------------------------------------------------------------- engine

export class TeamDecisionEngine {
  private readonly games = new Map<string, GameState_>();
  private readonly adviceSinks = new Set<PinAdviceSink>();
  private readonly now: () => number;
  private readonly monotonic: () => number;
  private readonly env: NodeJS.ProcessEnv;
  private readonly log: (message: string) => void;

  constructor(
    private readonly ports: TeamDecisionPorts,
    private readonly options: TeamDecisionOptions = {}
  ) {
    this.now = ports.now ?? (() => Date.now());
    this.monotonic = ports.monotonic ?? defaultNow;
    this.env = ports.env ?? process.env;
    this.log = ports.log ?? ((m) => console.log(m));
  }

  /** Subscribe to pin advice; informational only, never applied. */
  onPinAdvice(sink: PinAdviceSink): () => void {
    this.adviceSinks.add(sink);
    return () => {
      this.adviceSinks.delete(sink);
    };
  }

  /** Game over / unwatched: drop state and the event subscription. */
  release(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) return;
    game.unsubscribe?.();
    this.games.delete(gameId);
  }

  /**
   * ONE DECISION PER TEAM PER TURN. Builds the substrate from the canonical
   * turn state (the deciding team is engine team 0 by construction), assembles
   * generator + evaluator + search + kernel, drains the kernel's emissions
   * into per-unit setBotRecommendation calls, and returns the report.
   *
   * Not awaited by the transport: the decision runs to its own deadline while
   * the turn pipeline moves on, exactly like the legacy fan-out.
   */
  async decideTurn(input: TeamTurnInput): Promise<TeamTurnResult> {
    const game = this.gameFor(input.gameId);
    game.ledger.beginTurn(input.turn);
    this.ports.enableTeamStaging(input.gameId);

    // --- capacity: who must be modelled for the held set to fit -----------
    const capacity = this.planCapacity(input);
    const sub = makeSubstrate({
      board: input.board,
      turn: input.turn,
      asTeam: input.ourTeamId,
      observedTurns: input.observedTurns,
      // The claim view holds everyone we neither command nor reference; the
      // referenced units are modelled, so they must not be claims either.
      modeled: [...input.units.map((u) => u.snakeId), ...capacity.wireIds],
    });
    const asTeam = sub.teamNumber(input.ourTeamId);
    const assumptions: Assumption[] = capacity.wireIds.map((wireId) => ({
      kind: 'reference-action',
      unitId: sub.unitOfWireId(wireId)?.unitId as UnitId,
      to: NO_ORDER_MOVE,
    }));

    const gen = new GrammarCandidateGenerator();
    const evaluate = this.options.evaluate ?? materialEvaluator;
    const witnesses: Witness[] = [];
    const search = tapWitnesses(makeSearchCore(this.options.search), witnesses);

    const kernel = new LobsterKernel({
      // The tier-2 crossfade certificate, bound to this decision's substrate.
      teammateFloor: (plan, excluding) => this.teammateFloor(sub, asTeam, plan, excluding),
      ...this.kernelOptions(),
    });

    // Live pin routing: wire event -> ledger -> substrate numbering -> kernel.
    if (game.unsubscribe === null) {
      game.unsubscribe = this.ports.onPinEvent(input.gameId, (ev) => this.onWirePin(input.gameId, ev));
    }
    game.live = { turn: input.turn, kernel, sub };

    const initialPins = game.ledger.pinsFor(sub);
    const kin: KernelInput = {
      sub,
      gen,
      evaluate,
      search,
      asTeam,
      deadlineMs: deadlineFromWallClock(input.deadlineMs, this.monotonic, this.now),
      initialPins,
      assumptions,
      now: this.monotonic,
      initialStepCostMs: game.stepCostMs,
    };

    const views = new Map(input.units.map((u) => [u.snakeId, u.view]));
    const lastForwarded = new Map<string, CentaurMove>();
    let forwarded = 0;
    let emitted = 0;
    try {
      for await (const rec of kernel.decide(kin)) {
        emitted++;
        forwarded += this.forwardPlan(input, sub, asTeam, rec.plan, views, lastForwarded);
      }
    } finally {
      game.live = null;
      const report = kernel.lastReport;
      if (report !== null) game.stepCostMs = report.finalStepCostMs;
      sub.release();
    }

    const report = kernel.lastReport;
    const advice =
      report === null
        ? []
        : adviseFromReport({
            report,
            tentative: this.tentativePins(game, sub),
            witnesses,
            threshold: this.options.adviceThreshold,
            snakeIdOf: (unitId) => sub.unitOf(unitId)?.wireId ?? null,
          });
    if (advice.length > 0) {
      for (const sink of [...this.adviceSinks]) {
        try {
          sink(input.gameId, advice);
        } catch (err) {
          this.log(`[team-engine] pin-advice sink threw: ${String(err)}`);
        }
      }
    }
    return { report, forwarded, assumptions, advice, emitted };
  }

  /**
   * The kernel options this engine runs with — public so the wire-policy
   * derivation is pinnable by test rather than implied:
   *
   *  - `minWriteIntervalMs` is THE WIRE'S rate policy, not the search loop's:
   *    it follows the StageThrottle policy (1000 ms default, the
   *    CENTAUR_STAGE_MIN_WRITE_MS override, junk refused) so the kernel never
   *    offers the throttle a write it would have to swallow;
   *  - `crossfade: "teammate"`, because the wire is NOT joint-atomic for
   *    teams over ten units (chunking) — the per-decision teammateFloor hook
   *    is bound at decide time.
   */
  kernelOptions(): KernelOptions {
    return {
      ...DEFAULT_KERNEL_OPTIONS,
      minWriteIntervalMs: minWriteIntervalFromEnv(this.env, this.log),
      crossfade: 'teammate',
      reserveMs: 40,
      sliceMs: 25,
      ...this.options.kernel,
    };
  }

  // ---------------------------------------------------------------- internals

  private gameFor(gameId: string): GameState_ {
    let game = this.games.get(gameId);
    if (!game) {
      game = { ledger: new TeamPinLedger(), unsubscribe: null, stepCostMs: undefined, live: null };
      this.games.set(gameId, game);
    }
    return game;
  }

  private onWirePin(gameId: string, ev: PinEvent): void {
    const game = this.games.get(gameId);
    if (!game) return;
    game.ledger.apply(ev, (unitId) => this.ports.pinSnakeIdOf(gameId, unitId));
    const live = game.live;
    if (live === null) return;
    const translated = game.ledger.translate(
      ev,
      (unitId) => this.ports.pinSnakeIdOf(gameId, unitId),
      live.sub
    );
    if (translated !== null) live.kernel.onPinEvent(translated);
  }

  private tentativePins(game: GameState_, sub: EngineSubstrate): Pin[] {
    return game.ledger.pinsFor(sub).filter((p) => p.tentative);
  }

  /**
   * HELD CAPACITY: which uncontrolled units must be modelled (fixed to their
   * defaults) for the rest to fit the cloud field. Ranked by ARRIVAL-GRID
   * distance — the engine's own earliest-arrival flood from each candidate
   * unit to our units' cells — nearest first, exactly as many as overflow.
   *
   * Computed on a probe substrate whose claim view is empty (everything
   * modelled), so the ranking itself can never trip the capacity it exists
   * to respect. The probe is released before the real substrate is built.
   */
  private planCapacity(input: TeamTurnInput): { wireIds: ReadonlyArray<string> } {
    const ourIds = new Set(input.units.map((u) => u.snakeId));
    const others = (input.board.snakes ?? []).filter(
      (s) => !ourIds.has(s.id) && s.health > 0 && s.body.length > 0
    );
    const overflow = others.length - MAX_FROZEN;
    if (overflow <= 0) return { wireIds: [] };

    const allIds = (input.board.snakes ?? []).map((s) => s.id);
    const probe = makeSubstrate({
      board: input.board,
      turn: input.turn,
      asTeam: input.ourTeamId,
      modeled: allIds,
    });
    try {
      const engine = probe.engine;
      const horizon = input.turn + (this.options.arrivalHorizonTurns ?? 8);
      const ourCells: number[] = [];
      for (const u of probe.roster()) {
        if (ourIds.has(u.wireId)) ourCells.push(u.cells[0] as number);
      }
      const distance = new Map<string, number>();
      const candidates = probe.roster().filter((u) => !ourIds.has(u.wireId));
      for (let i = 0; i < candidates.length; i += MAX_FROZEN) {
        const group = candidates.slice(i, i + MAX_FROZEN);
        const fork = engine.fork(probe.state);
        try {
          const slots = group
            .map((u) => engine.slotOfUnit(fork, u.unitId))
            .filter((slot) => slot >= 0);
          const held = engine.holdMany(fork, slots, input.turn);
          for (const slot of held.field.slots) {
            const wireId = probe.unitOf(slot.record.unitId)?.wireId;
            if (wireId === undefined) continue;
            const earliest = slot.timeline.arrival(horizon).earliest;
            let d = NEVER;
            for (const cell of ourCells) {
              const at = earliest[cell] as number;
              if (at >= 0 && at < d) d = at;
            }
            distance.set(wireId, d);
          }
        } finally {
          engine.release(fork);
        }
      }
      const ranked = [...distance.entries()].sort(
        (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
      );
      const chosen = ranked.slice(0, overflow).map(([wireId]) => wireId);
      this.log(
        `[team-engine] ${input.gameId} turn ${input.turn}: ${others.length} uncontrolled units ` +
          `exceed the held capacity of ${MAX_FROZEN} — modelling the ${chosen.length} nearest ` +
          `at their defaults (declared): ${chosen.join(', ')}`
      );
      return { wireIds: chosen };
    } finally {
      probe.release();
    }
  }

  /**
   * The crossfade certificate's tier-2 floor: the material floor of the
   * TEAMMATES NOT IN THE DELTA under a plan, through the real evaluator's own
   * standing fold (single pipeline — one resolution, the same widened
   * held-survival reading the evaluator uses). The changed units are excluded
   * because the torn-write window holds THEIR old moves; the certificate is
   * about what the interleaving can cost everyone else.
   */
  private teammateFloor(
    sub: EngineSubstrate,
    asTeam: number,
    plan: JointPlan,
    excluding: ReadonlySet<UnitId>
  ): number {
    return sub.withResolution(plan, asTeam, ({ resolution, touched }) => {
      let worst = 0;
      for (const s of standingOf(sub, resolution, asTeam, touched)) {
        if (s.team === asTeam) {
          if (excluding.has(s.unitId)) continue;
          if (s.worstAlive) worst += Math.max(0, s.weightMin - s.partialLossMax);
        } else if (s.worstAlive) {
          worst -= s.weightMax;
        }
      }
      return worst;
    });
  }

  /** Forward one emitted plan through the per-unit manager surface. */
  private forwardPlan(
    input: TeamTurnInput,
    sub: EngineSubstrate,
    asTeam: number,
    plan: JointPlan,
    views: ReadonlyMap<string, GameState>,
    lastForwarded: Map<string, CentaurMove>
  ): number {
    let forwarded = 0;
    for (const [unitId, candidate] of plan) {
      const unit = sub.unitOf(unitId);
      if (unit === undefined || unit.team !== asTeam) continue; // references etc.
      const view = views.get(unit.wireId);
      if (view === undefined) continue; // not a unit this decision speaks for
      const move = this.moveOf(sub, unit, candidate);
      if (move === null) continue;
      if (lastForwarded.get(unit.wireId) === move) continue;
      lastForwarded.set(unit.wireId, move);
      this.ports.setBotRecommendation(input.gameId, unit.wireId, move, {
        gameState: view,
        moveEvaluations: [],
        territoryCells: {},
        safeMoves: [],
        botRecommendation: move,
        timestamp: this.now(),
      });
      forwarded++;
    }
    return forwarded;
  }

  /**
   * A staged candidate as the wire speaks it: a snake stages a Direction; a
   * piece stages the FULL-board destination index — which is the substrate's
   * own cell index, because the engine's marshalling re-adds the same
   * perimeter the wire's indices include (one index space, by construction).
   */
  private moveOf(sub: EngineSubstrate, unit: SubstrateUnit, candidate: Candidate): CentaurMove | null {
    if (unit.type !== 'snake') {
      if (candidate.to === NO_ORDER_MOVE) return unit.cells[0] as number; // stay
      return candidate.to;
    }
    if (candidate.to === NO_ORDER_MOVE) return null; // a snake's default is the server's, not ours to restate
    const direction = moveIndexToDirection(unit.cells[0] as number, candidate.to, sub.grid.width);
    if (direction === null) {
      this.log(
        `[team-engine] cannot express staged cell ${candidate.to} for snake ${unit.wireId} as a direction — not forwarded`
      );
    }
    return direction;
  }
}

// ---------------------------------------------------------------- witnesses

/** Wrap a SearchCore so every returned witness set is captured for the
 * advice layer. Transparent otherwise; the optional refiner surface is
 * forwarded when the core carries it. */
function tapWitnesses(core: SearchCore, into: Witness[]): SearchCore {
  const absorb = (score: PlanScore): PlanScore => {
    for (const w of score.witnesses) {
      if (!into.includes(w)) into.push(w);
    }
    return score;
  };
  const wrapped: SearchCore = {
    improve: (ctx: SearchContext) => absorb(core.improve(ctx)),
    conform: (ctx: SearchContext, incumbent: JointPlan) => core.conform(ctx, incumbent),
  };
  if (core.refinementView !== undefined) {
    wrapped.refinementView = core.refinementView.bind(core);
  }
  if (core.refine !== undefined) {
    const refine = core.refine.bind(core);
    wrapped.refine = (ctx, lever) => absorb(refine(ctx, lever));
  }
  return wrapped;
}
