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
import { MAX_BATCH_DOCS } from '../wire/team-submitter';
import { MAX_FROZEN, NEVER } from '../partial-engine/index';
import type {
  Assumption,
  Candidate,
  EmitRecord,
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
import { EngineSubstrate, makeSubstrate, releaseGeometriesFor } from './substrate';
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
  /**
   * Subscribe to a game's typed pin events; returns the unsubscriber.
   *
   * The sink's second argument is the TURN the wire emitted the event for. It
   * is what lets an event that landed in the turn-boundary gap reach the
   * decision it belongs to instead of being wiped by the next `beginTurn`
   * (V4 B5). A transport that cannot say passes nothing, and the event is
   * treated as belonging to whatever turn the ledger is on — the old
   * behaviour, kept so a narrower transport still works.
   */
  onPinEvent(gameId: string, sink: (event: PinEvent, turn?: number) => void): () => void;
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
  /**
   * Evaluator for the decision. Defaults to the MATERIAL profile — the
   * engine's own exact fold — and that default is now a measured verdict, not
   * a placeholder: on the production regime the calibrated reach/king-margin
   * profile lost material at a one-second budget and overran at ten, because
   * it costs an arrival flood per unit PER EVALUATION.
   *
   * Adopting it has three prerequisites, and none of them is a tuning knob:
   *   1. per-decision caching of the arrival flood (it is recomputed from
   *      scratch for every plan the search prices today);
   *   2. per-kind maxHealth reaching the engine instead of being flattened to
   *      the maximum — the flatten inflates OUR earliest-arrival flood, and
   *      the reach feature reads that on its LO side, which is a floor above
   *      the truth (the tripwire in the trio suite fails the moment reach is
   *      switched on while the flatten stands);
   *   3. a re-run of the production-regime bench, because (1) changes the
   *      cost that made the verdict.
   */
  readonly evaluate?: Evaluator;
  readonly search?: Partial<SearchTuning>;
  /** How the decision's SearchCore is assembled from the tuning. Defaults to
   * the production `makeSearchCore`. The one composition seam the engine
   * exposes: a profile that wants a different core, or a harness that wants to
   * script one, replaces this rather than reaching inside. */
  readonly makeCore?: (tuning: Partial<SearchTuning>) => SearchCore;
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

/**
 * The engine's own refusal channels — the things that go wrong BETWEEN the
 * kernel and the wire, where the kernel's counters cannot see them. Every one
 * of them used to be a silent skip (V4 B5/B6/R5); none of them is now.
 *
 *   unit-lookup-miss    a wire unit the substrate does not carry, so the
 *                       modelling choice that named it cannot be declared as a
 *                       reference action. The unit stays HELD (looser, sound)
 *                       and the record carries a named narrowing.
 *   unexpressible-move  a staged destination the wire's vocabulary cannot say
 *                       (a snake destination that is not a direction). The
 *                       unit is not forwarded, so the manager's own ladder
 *                       decides it — a DEFAULT, and a default is a narrowing.
 *   pin-event-late      an operator event for a turn already resolved. It
 *                       cannot be honoured and it is not silently dropped.
 */
export type TeamRefusal = 'unit-lookup-miss' | 'unexpressible-move' | 'pin-event-late';

export interface TeamTurnResult {
  readonly report: KernelReport | null;
  /** setBotRecommendation calls actually forwarded (changed moves only). */
  readonly forwarded: number;
  /** The declared modelling basis of the decision (held-capacity included),
   * plus every narrowing the forwarding path had to declare. */
  readonly assumptions: ReadonlyArray<Assumption>;
  readonly advice: ReadonlyArray<TeamPinAdvice>;
  readonly emitted: number;
  /** Counted degradations. Zero on every healthy decision. */
  readonly refusals: Readonly<Record<TeamRefusal, number>>;
}

interface GameState_ {
  ledger: TeamPinLedger;
  unsubscribe: (() => void) | null;
  /** The previous turn's measured slice cost — KernelInput.initialStepCostMs. */
  stepCostMs: number | undefined;
  /** The turn `stepCostMs` was measured on. A decision that finishes LATE must
   * not overwrite a newer turn's measurement with its own. */
  stepCostTurn: number;
  /**
   * The newest turn this game has been handed. A live decision for an OLDER
   * turn is working on a board the server has already resolved (T1 fact 5 —
   * a turn ends the instant every alive player commits), so it abandons at its
   * next slice boundary rather than spending the budget and the wire on a dead
   * turn.
   */
  latestTurn: number;
  /** Ledger drops already reported on a TeamTurnResult. Drops happen between
   * decisions as often as during one, so they are attributed to the next
   * decision to finish rather than lost. */
  dropsReported: number;
  /**
   * The live decision's kernel and substrate, KEYED BY TURN.
   *
   * A turn resolves the instant every alive player commits, so turn N+1's
   * snapshot can land — and its decision can start — long before turn N's
   * decision reaches its own deadline. Two decisions therefore overlap by
   * design, and the handle must say which one it belongs to: an unkeyed
   * `live = null` in the older decision's `finally` tears down the NEWER
   * decision's pin routing, and every pin, unpin and commit for the live turn
   * is then folded into the ledger and never reaches the kernel — no epoch, no
   * conformance re-stage, no counter (V4 B1). Humans always win, so this
   * handle is turn-keyed and only its own turn may clear it.
   */
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
    // The game's engines (slab arenas and cloud-source caches) have no future.
    // Without this the geometry cache is a process-lifetime hold on every
    // board the centaur ever played.
    releaseGeometriesFor(gameId);
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
    const refusals: Record<TeamRefusal, number> = {
      'unit-lookup-miss': 0,
      'unexpressible-move': 0,
      'pin-event-late': 0,
    };
    // Consume the turn-boundary buffer FOR THIS TURN before the ledger table
    // is read: pins that landed between the snapshot and this call belong to
    // this decision, not to nobody (V4 B5).
    // A newer turn arriving IS the abandonment signal for every older live
    // decision: nothing else in the pipeline knows a turn resolved early.
    game.latestTurn = Math.max(game.latestTurn, input.turn);
    const buffered = game.ledger.bufferedFor(input.turn);
    /** Narrowings the capacity walk had to declare before the basis is built. */
    const assumptionsFor: Assumption[] = [];
    game.ledger.beginTurn(input.turn);
    this.ports.enableTeamStaging(input.gameId);

    // --- capacity: who must be modelled for the held set to fit -----------
    //
    // A modelling choice the decision's own substrate cannot NAME is a
    // degradation, not a cast (V4 R5). `unitId: sub.unitOfWireId(id)?.unitId
    // as UnitId` used to carry `undefined` through into a reference-action,
    // into the plan, and out the far side as an UnknownUnitError inside
    // resolveBounded — a whole turn lost to a lookup miss. Here the miss is
    // counted, the choice is REPLACED from the ranked remainder so the held
    // set still fits, and the substrate is rebuilt around the corrected set.
    // One retry: a second miss declares its narrowing and leaves the unit
    // held, which is looser and sound.
    const capacity = this.planCapacity(input);
    let chosen: string[] = [...capacity.wireIds];
    let sub = this.substrateFor(input, chosen);
    const missed: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const gone = chosen.filter((wireId) => sub.unitOfWireId(wireId) === undefined);
      if (gone.length === 0) break;
      refusals['unit-lookup-miss'] += gone.length;
      missed.push(...gone);
      const keep = chosen.filter((wireId) => !gone.includes(wireId));
      const replacements: string[] = [];
      for (const wireId of capacity.ranked) {
        if (replacements.length >= gone.length) break;
        if (keep.includes(wireId) || missed.includes(wireId)) continue;
        if (sub.unitOfWireId(wireId) === undefined) continue;
        replacements.push(wireId);
      }
      this.log(
        `[team-engine] ${input.gameId} turn ${input.turn}: modelling choice(s) ` +
          `${gone.join(', ')} have no substrate unit — replaced with ` +
          `${replacements.join(', ') || '(nothing available)'} and declared`
      );
      sub.release();
      chosen = [...keep, ...replacements];
      sub = this.substrateFor(input, chosen);
    }
    for (const wireId of missed) {
      assumptionsFor.push({
        kind: 'narrowing',
        unitId: -1,
        note: `held-capacity: wire unit ${wireId} is not on this board — left HELD, not referenced`,
      });
    }
    const asTeam = sub.teamNumber(input.ourTeamId);
    const assumptions: Assumption[] = [...assumptionsFor];
    for (const wireId of chosen) {
      const unit = sub.unitOfWireId(wireId);
      if (unit === undefined) continue; // already counted and declared above
      assumptions.push({ kind: 'reference-action', unitId: unit.unitId, to: NO_ORDER_MOVE });
    }

    const gen = new GrammarCandidateGenerator();
    const evaluate = this.options.evaluate ?? materialEvaluator;
    const witnesses: Witness[] = [];
    const buildCore = this.options.makeCore ?? makeSearchCore;
    const search = tapWitnesses(buildCore(this.options.search ?? {}), witnesses);

    const kernel = new LobsterKernel({
      // The tier-2 crossfade certificate, bound to this decision's substrate.
      teammateFloor: (plan, excluding) => this.teammateFloor(sub, asTeam, plan, excluding),
      // Tier 3: the WIRE's own chunk partition, so the gate can price the torn
      // interleavings the transport can actually produce.
      crossfadeGroups: (plan) => this.crossfadeGroups(sub, asTeam, plan),
      ...this.kernelOptions(),
    });

    // Live pin routing: wire event -> ledger -> substrate numbering -> kernel.
    if (game.unsubscribe === null) {
      game.unsubscribe = this.ports.onPinEvent(input.gameId, (ev, turn) =>
        this.onWirePin(input.gameId, ev, turn)
      );
    }
    // TURN-KEYED (V4 B1). A decision that started earlier must never take this
    // handle away from a later one, and only the owner clears it below.
    if (game.live === null || game.live.turn <= input.turn) {
      game.live = { turn: input.turn, kernel, sub };
    }
    // The turn-boundary buffer is already folded into the ledger (beginTurn
    // replayed it), so its pins and unpins arrive below as `initialPins`. A
    // COMMIT carries something the pin set cannot: the unit is frozen for the
    // turn, and only the kernel's own committedUnits gate can refuse a later
    // change to it. The two humans-always-win gates must agree, so a buffered
    // commit is handed to the kernel as an event.
    const live = game.live;
    if (live !== null && live.turn === input.turn) {
      for (const ev of buffered) {
        if (ev.kind === 'commit') this.routeToKernel(input.gameId, game, live, ev);
      }
    }

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
      abandoned: () => game.latestTurn > input.turn,
    };

    const views = new Map(input.units.map((u) => [u.snakeId, u.view]));
    const lastForwarded = new Map<string, CentaurMove>();
    let lastAdvice = '';
    let forwarded = 0;
    let emitted = 0;
    try {
      for await (const rec of kernel.decide(kin)) {
        emitted++;
        forwarded += this.forwardPlan(
          input,
          sub,
          asTeam,
          rec.plan,
          views,
          lastForwarded,
          kernel,
          refusals
        );
        // ADVICE WHILE THE OPERATOR IS STILL HOVERING. Computed from the
        // record just emitted and the speculative contexts as they stand,
        // rather than from `lastReport` — which does not exist until the
        // decision has ended, i.e. until the turn is about to resolve and the
        // hover is over. Deduplicated, so an unchanged price is not re-sent.
        lastAdvice = this.publishAdvice(input.gameId, game, sub, kernel, rec, lastAdvice);
      }
    } finally {
      // ONLY THIS TURN'S HANDLE. An overlapping newer decision owns `live`
      // now, and nulling it here would silently kill its pin routing for the
      // rest of the turn (V4 B1).
      if (game.live !== null && game.live.turn === input.turn) game.live = null;
      const report = kernel.lastReport;
      // Same guard on the carried slice cost: a decision that finishes late
      // must not overwrite a newer turn's measurement with its own.
      if (report !== null && game.stepCostTurn <= input.turn) {
        game.stepCostMs = report.finalStepCostMs;
        game.stepCostTurn = input.turn;
      }
      sub.release();
    }
    refusals['pin-event-late'] += game.ledger.droppedEvents - game.dropsReported;
    game.dropsReported = game.ledger.droppedEvents;

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
    if (advice.length > 0 && adviceSignature(advice) !== lastAdvice) {
      this.emitAdvice(input.gameId, advice);
    }
    return { report, forwarded, assumptions, advice, emitted, refusals };
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
      // A single rook has thirteen destinations, and an operator sweeping a
      // unit around visits each of them: at the search-loop default of 8 a
      // cyclic access pattern is LRU's worst case and the tier-3 cache
      // degrades to a 100% miss rate (measured: 41 misses, 33 evictions, 0
      // resumes). Sized to the operator's vocabulary, not the loop's.
      pinCacheCapacity: 32,
      ...this.options.kernel,
    };
  }

  // ---------------------------------------------------------------- internals

  private gameFor(gameId: string): GameState_ {
    let game = this.games.get(gameId);
    if (!game) {
      game = {
        ledger: new TeamPinLedger(),
        unsubscribe: null,
        stepCostMs: undefined,
        stepCostTurn: -1,
        latestTurn: -1,
        dropsReported: 0,
        live: null,
      };
      this.games.set(gameId, game);
    }
    return game;
  }

  /**
   * Wire event → ledger → substrate numbering → the kernel of the decision the
   * event is FOR.
   *
   * Two turn checks, and neither is cosmetic. The ledger's own check parks an
   * event for a turn not yet begun (the turn-boundary gap) and counts one for
   * a turn already resolved. The live-handle check refuses to hand an event to
   * a decision about a different turn: the pin is a constraint on turn N's
   * board, and turn N+1's kernel would honour it against the wrong position.
   */
  private onWirePin(gameId: string, ev: PinEvent, turn?: number): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const before = game.ledger.droppedEvents;
    const admitted = game.ledger.apply(
      ev,
      (unitId) => this.ports.pinSnakeIdOf(gameId, unitId),
      turn
    );
    if (game.ledger.droppedEvents !== before) {
      this.log(
        `[team-engine] ${gameId}: operator event for turn ${String(turn)} arrived after that ` +
          `turn resolved — not applied (${game.ledger.droppedEvents} total this game)`
      );
      return;
    }
    // ONLY WHAT THE LEDGER ADMITS REACHES THE KERNEL (V1-OBS-2). The ledger
    // owns the precedence rules — a committed unit is frozen, a hover never
    // weakens a binding pin — and forwarding an event it just refused made
    // those rules govern its own table and nothing else: a hover on a
    // committed unit still opened a speculative context and burned slices on a
    // unit that cannot move.
    if (admitted === null) return;
    const live = game.live;
    if (live === null) return;
    if (turn !== undefined && turn !== live.turn) return; // parked, or past
    this.routeToKernel(gameId, game, live, ev);
  }

  private routeToKernel(
    gameId: string,
    game: GameState_,
    live: NonNullable<GameState_['live']>,
    ev: PinEvent
  ): void {
    const translated = game.ledger.translate(
      ev,
      (unitId) => this.ports.pinSnakeIdOf(gameId, unitId),
      live.sub
    );
    if (translated !== null) live.kernel.onPinEvent(translated);
  }

  /** Price the hovered pins against the record just emitted, and surface any
   * advice that has changed. Returns the new signature. */
  private publishAdvice(
    gameId: string,
    game: GameState_,
    sub: EngineSubstrate,
    kernel: LobsterKernel,
    rec: EmitRecord,
    previous: string
  ): string {
    if (this.adviceSinks.size === 0) return previous;
    const tentative = this.tentativePins(game, sub);
    if (tentative.length === 0) return previous;
    const live = kernel.unconstrainedNow();
    const advice = adviseFromReport({
      report: {
        journal: [rec],
        speculative: kernel.speculativeNow(),
        contexts: [],
        activeContextKey: live?.key ?? '',
      } as unknown as KernelReport,
      unconstrained:
        live === null
          ? null
          : {
              speculative: false,
              key: live.key,
              incumbentLo: live.lo,
              incumbentHi: live.hi,
              posture: live.posture,
              epoch: live.epoch,
            },
      tentative,
      witnesses: [],
      threshold: this.options.adviceThreshold,
      snakeIdOf: (unitId) => sub.unitOf(unitId)?.wireId ?? null,
    });
    if (advice.length === 0) return previous;
    const signature = adviceSignature(advice);
    if (signature === previous) return previous;
    this.emitAdvice(gameId, advice);
    return signature;
  }

  private emitAdvice(gameId: string, advice: ReadonlyArray<TeamPinAdvice>): void {
    for (const sink of [...this.adviceSinks]) {
      try {
        sink(gameId, advice);
      } catch (err) {
        this.log(`[team-engine] pin-advice sink threw: ${String(err)}`);
      }
    }
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
  private substrateFor(input: TeamTurnInput, modelled: ReadonlyArray<string>): EngineSubstrate {
    return makeSubstrate({
      gameId: input.gameId,
      board: input.board,
      turn: input.turn,
      asTeam: input.ourTeamId,
      observedTurns: input.observedTurns,
      // The claim view holds everyone we neither command nor reference; the
      // referenced units are modelled, so they must not be claims either.
      modeled: [...input.units.map((u) => u.snakeId), ...modelled],
    });
  }

  private planCapacity(input: TeamTurnInput): {
    wireIds: ReadonlyArray<string>;
    /** The whole arrival-ranked candidate list, nearest first — the pool a
     * replacement is drawn from when a choice cannot be named. */
    ranked: ReadonlyArray<string>;
  } {
    const ourIds = new Set(input.units.map((u) => u.snakeId));
    const others = (input.board.snakes ?? []).filter(
      (s) => !ourIds.has(s.id) && s.health > 0 && s.body.length > 0
    );
    const overflow = others.length - MAX_FROZEN;
    if (overflow <= 0) return { wireIds: [], ranked: [] };

    const allIds = (input.board.snakes ?? []).map((s) => s.id);
    const probe = makeSubstrate({
      gameId: input.gameId,
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
      const order = ranked.map(([wireId]) => wireId);
      const chosen = order.slice(0, overflow);
      this.log(
        `[team-engine] ${input.gameId} turn ${input.turn}: ${others.length} uncontrolled units ` +
          `exceed the held capacity of ${MAX_FROZEN} — modelling the ${chosen.length} nearest ` +
          `at their defaults (declared): ${chosen.join(', ')}`
      );
      return { wireIds: chosen, ranked: order };
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

  /**
   * The wire's chunk partition of THIS plan, in substrate numbering — the
   * crossfade gate's tier 3.
   *
   * It mirrors the team submitter's own cut exactly: the roster is sorted by
   * WIRE id and sliced into groups of `MAX_BATCH_DOCS`, which is what makes a
   * unit's group the same on every revision of the turn and the torn state a
   * union of whole groups from two adjacent revisions. The submitter also
   * drops committed and unencodable units before cutting; this partition does
   * not know about those, so a group here can be a superset of the group the
   * transport wrote — which widens the set of interleavings priced, never
   * narrows it.
   */
  private crossfadeGroups(
    sub: EngineSubstrate,
    asTeam: number,
    plan: JointPlan
  ): ReadonlyArray<ReadonlyArray<UnitId>> {
    const roster: Array<{ wireId: string; unitId: UnitId }> = [];
    for (const [unitId] of plan) {
      const unit = sub.unitOf(unitId);
      if (unit === undefined || unit.team !== asTeam) continue;
      roster.push({ wireId: unit.wireId, unitId });
    }
    roster.sort((a, b) => (a.wireId < b.wireId ? -1 : a.wireId > b.wireId ? 1 : 0));
    const groups: UnitId[][] = [];
    for (let i = 0; i < roster.length; i += MAX_BATCH_DOCS) {
      groups.push(roster.slice(i, i + MAX_BATCH_DOCS).map((r) => r.unitId));
    }
    return groups;
  }

  /** Forward one emitted plan through the per-unit manager surface. */
  private forwardPlan(
    input: TeamTurnInput,
    sub: EngineSubstrate,
    asTeam: number,
    plan: JointPlan,
    views: ReadonlyMap<string, GameState>,
    lastForwarded: Map<string, CentaurMove>,
    kernel: LobsterKernel,
    refusals: Record<TeamRefusal, number>
  ): number {
    let forwarded = 0;
    for (const [unitId, candidate] of plan) {
      const unit = sub.unitOf(unitId);
      if (unit === undefined || unit.team !== asTeam) continue; // references etc.
      const view = views.get(unit.wireId);
      if (view === undefined) continue; // not a unit this decision speaks for
      const move = this.moveOf(sub, unit, candidate);
      if (move === null) {
        if (candidate.to === NO_ORDER_MOVE) continue; // the kind's own default: stated, not defaulted
        // A STAGED MOVE THE WIRE CANNOT SAY (V4 B6). Skipping it silently
        // hands the unit to the manager's own ladder — a default, and a
        // default is a narrowing that must be named (non-negotiable 4). Count
        // it and declare it, exactly as the kernel declares a pin whose
        // destination the grammar cannot reach: the pin/plan stands, the
        // record says the unit is not speaking for it.
        refusals['unexpressible-move']++;
        kernel.declare({
          kind: 'narrowing',
          unitId,
          note:
            `staged-move-unexpressible@${candidate.to}: the wire has no word for this ` +
            `destination — not forwarded, the manager's own ladder decides the unit`,
        });
        continue;
      }
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
      // Counted and DECLARED by the caller — see forwardPlan. This log is the
      // operator-facing half of the same fact.
      this.log(
        `[team-engine] cannot express staged cell ${candidate.to} for snake ${unit.wireId} as a direction — not forwarded`
      );
    }
    return direction;
  }
}

/** What an advice set says, for dedup. Two sets with the same signature say
 * the same thing and the second one is noise. */
function adviceSignature(advice: ReadonlyArray<TeamPinAdvice>): string {
  return advice
    .map((a) => `${a.pin.unitId}@${a.pin.to}:${a.costLo}/${a.costHi}:${a.degraded ? 'd' : ''}`)
    .sort()
    .join('|');
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
  if (core.drainRefusals !== undefined) {
    wrapped.drainRefusals = core.drainRefusals.bind(core);
  }
  if (core.release !== undefined) {
    wrapped.release = core.release.bind(core);
  }
  if (core.refinementView !== undefined) {
    wrapped.refinementView = core.refinementView.bind(core);
  }
  if (core.refine !== undefined) {
    const refine = core.refine.bind(core);
    wrapped.refine = (ctx, lever) => absorb(refine(ctx, lever));
  }
  return wrapped;
}
