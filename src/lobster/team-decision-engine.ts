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
import type { BotIdentity, BotSpec } from '../config/bot-identity';
import { botIdentityOf } from '../config/bot-identity';
import { behaviourId } from '../config/build-identity';
import type { BotBinding } from '../config/bot-binding';
import type {
  KernelLensPort,
  KernelOptionsDigest,
  LensDecision,
  LensDecisionPort,
  StoredAssumption,
  StoredPin,
} from '../lens/types';
import { unitKeyOf as wireKeyOf } from '../lens/kernel/keys';
import { defaultBotSpecFrom } from '../config/bot-binding';
import { moveIndexToDirection } from '../firebase/translate';
import { minWriteIntervalFromEnv } from '../wire/stage-throttle';
import { MAX_BATCH_DOCS } from '../wire/team-submitter';
import type {
  Assumption,
  Candidate,
  EmitRecord,
  Evaluator,
  JointPlan,
  KernelInput,
  Pin,
  PinEvent,
  PinSet,
  PlanScore,
  SearchContext,
  SearchCore,
  UnitId,
  Witness,
} from './contracts';
import { NO_ORDER_MOVE } from './contracts';
import { EngineSubstrate, makeSubstrate, releaseGeometriesFor } from './substrate';
import type { SubstrateUnit } from './substrate';
import { GrammarCandidateGenerator, knobsForSafety } from './candidates';
import type { CandidateKnobs } from './candidates';
import { boardBearsPiece, resolveStagingSafety, stagingSafety } from './staging-safety';
import type { ResolvedStagingSafety, StagingSafety } from './staging-safety';
import { BoundEvaluator, DEFAULT_PROFILE, defaultEvaluator, standingOf } from './evaluate';
import type { CriterionProfile } from './evaluate';
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
import { buildDecisionRows } from './telemetry';
import type { UnitDecisionRow } from './telemetry';

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
  /**
   * WHICH BOT THIS GAME PLAYS — the production binding site.
   *
   * Before this port existed there was none. The engine reached for its own
   * module-level default, so one PROCESS played one bot for every game and
   * every seat it held: selecting a validated member in production meant
   * editing that default and redeploying, two Centaur teams could not play
   * different bots at all, and an operator's dial excursion had nowhere to
   * persist and appeared in no row.
   *
   * A PORT AND NOT AN IMPORT, for the same reason `logDecision` is one: the
   * real source reads Postgres, and a decision layer that imported it would
   * put a database dependency inside every lobster test.
   *
   * OPTIONAL, WITH A REAL DEFAULT — unlike `logDecision`, which is required
   * because an unwired telemetry port is silence. The floor here is not
   * silence: absent this port the engine resolves the process-wide default
   * (`CENTAUR_BOT`, else the shipped bot), which is exactly the behaviour that
   * shipped. So a caller that says nothing gets the old behaviour AND a
   * correct stamp, rather than an unstamped decision.
   */
  botBinding?(gameId: string, centaurId: string): BotBinding;
  /**
   * THE LENS SINK, per decision [CHANGE 3].
   *
   * A PORT AND NOT AN IMPORT, for the third time and the same reason: the
   * frames are written to Postgres and broadcast on a websocket, and a
   * decision layer that imported either would put both inside every lobster
   * test. The port is asked once per decision and may say no — returning null
   * is what an unwatched game looks like, and an unwatched game must cost
   * exactly what it cost before the lens existed (05 §(d) gate 7(ii)).
   *
   * OPTIONAL, and its absence is not silence in the way `logDecision`'s would
   * be: nobody is looking. The frames a nobody would have read are not worth
   * the null checks it takes to build them.
   */
  lensSink?(gameId: string, turn: number, decision: LensDecision): LensDecisionPort | null;
  /** Wall clock (Date.now scale). Injectable for tests. */
  now?(): number;
  /** The kernel's monotonic clock. Injectable for tests. */
  monotonic?(): number;
  env?: NodeJS.ProcessEnv;
  log?(message: string): void;
}

export interface TeamDecisionOptions {
  /**
   * Evaluator for the decision. Defaults to the TERRITORY profile, and that
   * default is a measured verdict rather than a preference.
   *
   * It used to default to material-only, because the reach-carrying profile
   * lost to it at a one-second budget: it cost an arrival flood per unit per
   * evaluation, and the flood dragged an eager whole-board Dijkstra behind it
   * that nothing read. All three prerequisites that verdict named are met now:
   *   1. per-decision interning of the flood — MET. `evaluate/shells.ts` keeps
   *      the dilation shells in a table scoped to the decision and sized to its
   *      own working set, and reads them without `arrival()`, so a miss costs a
   *      dilation instead of a Dijkstra (24 µs against 431 µs at 26 units).
   *   2. per-kind maxHealth reaching the engine instead of being flattened to
   *      the maximum — MET. The flatten inflated OUR earliest-arrival flood
   *      and the reach feature reads that on its LO side, so a floor above the
   *      truth. `EngineConfig.maxHealthPerKind` carries the table now.
   *   3. a re-run of the production-regime bench — MET, and it is what moved
   *      this default. See `src/config/centaur-engine.ts` for the numbers.
   *
   * `materialEvaluator` remains exported as the explicit fallback profile: a
   * caller that wants the 1 ms reflex reading asks for it by name.
   */
  readonly evaluate?: Evaluator;
  /**
   * Candidate-layer knobs. Defaults are `DEFAULT_KNOBS`, which is what every
   * shipped profile runs; a caller overrides one to run a controlled arm
   * against it, which is the only reason the seam exists — production takes
   * the defaults. The layer's prunes are declared and its orderings are not
   * bounds, so this is a legitimate per-profile seam and not a back door into
   * adjudication.
   */
  readonly candidates?: CandidateKnobs;
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
  /**
   * How much of the staging-safety layer this ENGINE runs, overriding
   * `CENTAUR_STAGING_SAFETY` for this instance only.
   *
   * Per-engine and not per-process because the thing it must be possible to
   * measure is one SEAT against unchanged opponents: a process-wide flag moves
   * every lobster seat on the board at once, and a paired experiment on it
   * measures nothing.
   */
  readonly stagingSafety?: StagingSafety;
}

/**
 * The kernel's options as PLAIN VALUES — every number, string and boolean it
 * was configured with, and nothing else. The two function-valued options (the
 * crossfade certificate and the wire's chunk partition) are bound to one
 * decision's substrate and cannot be stored, re-read or compared; a digest
 * that carried "[Function]" for them would be a field that looks like a fact
 * and is not one.
 */
function digestOf(options: KernelOptions): KernelOptionsDigest {
  const out: Record<string, number | string | boolean> = {};
  for (const [key, value] of Object.entries(options)) {
    const t = typeof value;
    if (t === 'number' || t === 'string' || t === 'boolean') {
      out[key] = value as number | string | boolean;
    }
  }
  return out;
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
  /** One evaluator per bound profile. Keyed on the profile OBJECT: a store
   * refresh rebuilds its parsed profiles, and a weak key lets the evaluators
   * they superseded go with them. */
  private readonly evaluators = new WeakMap<CriterionProfile, Evaluator>();
  private envSpec: BotSpec | null = null;
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

    // THE SHIP CONDITION, applied here because here is where the board is
    // known. `auto` — the default — is `full` on a piece-bearing board and
    // `off` on a snake-only one, which is the ledger's I1 verdict exactly:
    // ship the guard for PIECE boards, do not ship it unconditionally. Every
    // consumer below reads the RESOLVED level, so the candidate knobs and the
    // search tuning cannot disagree about which board this is.
    // THE BINDING SITE. Which bot plays this game, resolved per (game,
    // centaur) rather than per PROCESS — see `TeamDecisionPorts.botBinding`
    // for what that used to cost. Resolved once per decision and threaded
    // through the three places it can matter: the staging-safety level, the
    // candidate knobs, and the evaluator.
    const binding = this.bindingFor(input);
    const safety = resolveStagingSafety(
      this.options.stagingSafety ?? binding.spec.stagingSafety ?? stagingSafety(),
      boardBearsPiece(sub)
    );
    // INTEGRATION NOTE (integ/round-a): the staging-safety level supplies the
    // BASE knobs and the caller's explicit `candidates` override them. Both
    // seams' own docstrings ask for exactly this precedence — I1's says the
    // flag's knobs are "overridden by anything the caller passes explicitly",
    // and I3/I6's says an arm overrides one knob to run a controlled arm. Taking
    // either side alone would have broken the other: `knobsForSafety(safety)`
    // by itself silently drops every per-arm knob (gainOrdering, the terrain
    // pair, the tier knobs), and `this.options.candidates` by itself makes the
    // stagingSafety option inert.
    //
    // The BOUND bot's knobs sit between the two: the safety level supplies the
    // base, the bot supplies the operator's persisted excursion, and an
    // explicit option still wins over both (a controlled arm assembled in
    // process must not be silently re-tuned by a stored row).
    const knobs: CandidateKnobs = {
      ...knobsForSafety(safety),
      ...(binding.spec.candidates ?? {}),
      ...(this.options.candidates ?? {}),
    };
    const gen = new GrammarCandidateGenerator(knobs);
    const evaluate = this.options.evaluate ?? this.evaluatorFor(binding.spec.profile);
    // The stamp describes what RAN, not what was asked for: the profile the
    // evaluator actually folds, the knobs the generator actually got, and the
    // RESOLVED safety level. A stamp taken off the binding alone would be
    // wrong for exactly the runs that most need it — the ones with an override.
    const bot = this.stampFor(binding, evaluate, safety);
    const witnesses: Witness[] = [];
    const buildCore = this.options.makeCore ?? makeSearchCore;
    const search = tapWitnesses(
      buildCore({
        rungZeroRepair: safety === 'full',
        seedDeconflict: safety !== 'off',
        ...(this.options.search ?? {}),
      }),
      witnesses
    );

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
    // Asked ONCE per decision, and asked with the BASIS: everything the
    // decision knows about itself that a re-run would need, declared at the
    // moment it was built rather than reconstructed later by the module that
    // stores it. A port that says null leaves `KernelInput.lens` undefined,
    // which is the state the cost gate measures.
    const lens =
      this.ports.lensSink?.(input.gameId, input.turn, {
        input: {
          asTeam,
          seed: this.options.search?.seed ?? 0,
          assumptions: assumptions.map((a) => this.storedAssumption(sub, a)),
          initialPins: initialPins.map(
            (p): StoredPin => ({ unit: wireKeyOf(sub, p.unitId), to: p.to })
          ),
          modelled: chosen,
          botId: bot.botId,
          behaviourId: bot.behaviourId,
          // NO NODE BUDGET IN PRODUCTION. A live decision stops on the wall
          // clock, and a re-run under the node clock picks its own budget —
          // saying 0 says that, where any other number would be a budget
          // nobody ran.
          nodeBudget: 0,
          liveBudgetMs: Math.max(0, input.deadlineMs - this.now()),
          kernelOptions: digestOf(this.kernelOptions()),
        },
        engine: 'lobster',
        // The profile's NAME, which is what a reader can compare. The
        // evaluator carries the profile itself — name, weights and horizons —
        // and the weights are already inside `botId`'s digest, so putting the
        // object here would store the same fact twice in two shapes.
        profile: (evaluate as { profile?: CriterionProfile }).profile?.name ?? '',
        unitKeyOf: (unitId) => sub.unitOf(unitId as UnitId)?.wireId ?? null,
      }) ?? null;
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
      ...(lens === null ? {} : { lens: lens.frame }),
    };

    const views = new Map(input.units.map((u) => [u.snakeId, u.view]));
    const lastForwarded = new Map<string, CentaurMove>();
    let lastAdvice = '';
    let forwarded = 0;
    let emitted = 0;
    /** The plan the last emission staged — the one the telemetry rows explain
     * candidates against. Null when the decision never staged anything. */
    let finalPlan: JointPlan | null = null;
    try {
      for await (const rec of kernel.decide(kin)) {
        emitted++;
        finalPlan = rec.plan;
        forwarded += this.forwardPlan(
          input,
          sub,
          asTeam,
          rec.plan,
          views,
          lastForwarded,
          kernel,
          refusals,
          bot
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
      // THE LENS CLOSES IN THE FINALLY AND BEFORE THE RELEASE.
      //
      // In the `finally` because the two paths that most need explaining are
      // the ones that do not reach the end of the loop: a decision ABANDONED
      // because the turn resolved early, and one that threw. Both are turns a
      // replay would otherwise have nothing at all to say about, and a record
      // closed only on the happy path would leave exactly those holes.
      // `emitted === 0` is `stagedNothing` — an outcome a reader must never
      // have to infer from an absence, because an absence is also what a lost
      // log looks like.
      //
      // Before `sub.release()` because the candidate republish below reads the
      // substrate; after it there is nothing left to read. Its own try/catch,
      // because a decision must never be able to fail on account of its own
      // record.
      try {
        lens?.end({
          abandoned: game.latestTurn > input.turn,
          stagedNothing: emitted === 0,
          counters: {
            emissions: emitted,
            forwarded,
            slices: report?.slices ?? 0,
            ...refusals,
          },
        });
      } catch (err) {
        this.log(
          `[team-engine] ${input.gameId} turn ${input.turn}: lens close threw — ` +
            `${err instanceof Error ? err.message : String(err)}`
        );
      }
      this.emitTelemetry({
        input,
        sub,
        asTeam,
        gen,
        evaluate,
        report,
        finalPlan,
        views,
        lastForwarded,
        assumptions,
        modelled: chosen,
        pins: initialPins,
        bot,
      });
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

  // ------------------------------------------------------------ the bot

  /**
   * WHICH BOT PLAYS THIS GAME.
   *
   * The port when one is wired; otherwise the process-wide default, which is
   * `CENTAUR_BOT` or the shipped bot and is exactly the behaviour that ran
   * before a binding site existed. The fallback deliberately reads only the
   * environment: a decision layer that reached for the store itself would put
   * a database on the critical path of every turn.
   */
  private bindingFor(input: TeamTurnInput): BotBinding {
    const port = this.ports.botBinding;
    if (port !== undefined) {
      try {
        return port(input.gameId, input.ourTeamId);
      } catch (err) {
        // A binding source that throws must not take the turn down with it.
        // The decision falls back to the default and SAYS so — a silent
        // fallback is a game played by a bot nobody selected.
        this.log(
          `[team-engine] ${input.gameId} turn ${input.turn}: bot binding lookup threw — ` +
            `playing the process default (${err instanceof Error ? err.message : String(err)})`
        );
      }
    }
    const spec = this.defaultSpec();
    return { identity: botIdentityOf(spec, behaviourId()), spec, source: 'env-default', key: null };
  }

  /** The env-level default, derived once: `defaultBotSpecFrom` logs on a bad
   * flag value and a per-turn re-derivation would log once per turn. */
  private defaultSpec(): BotSpec {
    if (this.envSpec === null) {
      this.envSpec = {
        ...defaultBotSpecFrom(this.env, this.log),
        stagingSafety: this.options.stagingSafety ?? stagingSafety(),
      };
    }
    return this.envSpec;
  }

  /**
   * The evaluator for a profile, built once per profile.
   *
   * `BoundEvaluator`'s constructor runs `checkWeights`, so a profile that
   * would silently fold a term nobody chose fails HERE — at the seam that
   * bound it, naming the key — rather than scoring a game.
   *
   * The shipped profile short-circuits to the module singleton on purpose:
   * with no binding in the store this returns the very object the engine used
   * before a binding site existed, so introducing one cannot move a decision.
   */
  private evaluatorFor(profile: CriterionProfile): Evaluator {
    if (profile === DEFAULT_PROFILE) return defaultEvaluator;
    const hit = this.evaluators.get(profile);
    if (hit !== undefined) return hit;
    const made = new BoundEvaluator(profile);
    this.evaluators.set(profile, made);
    return made;
  }

  /**
   * THE STAMP: the bot as it actually ran, not as it was requested.
   *
   * Three things can differ from the binding, and all three change moves, so
   * all three are read back off what was assembled rather than off the
   * request: the profile the evaluator folds (an explicit `options.evaluate`
   * replaces the bound one outright), the configured candidate knobs, and the
   * configured staging-safety level.
   *
   * `safety` — the BOARD-resolved level — is not folded in, for the reason
   * `BotRegistry.normalise` gives: it is a consequence of the board rather
   * than a choice in the configuration, and one bot must not become two
   * because it moved from a piece board to a snake-only one.
   */
  private stampFor(
    binding: BotBinding,
    evaluate: Evaluator,
    _safety: ResolvedStagingSafety
  ): BotIdentity {
    const configured = {
      ...(binding.spec.candidates ?? {}),
      ...(this.options.candidates ?? {}),
    };
    const spec: BotSpec = {
      name: binding.spec.name,
      engine: binding.spec.engine,
      profile: (evaluate as { profile?: CriterionProfile }).profile ?? binding.spec.profile,
      candidates: Object.keys(configured).length === 0 ? undefined : configured,
      stagingSafety: this.options.stagingSafety ?? binding.spec.stagingSafety,
    };
    return botIdentityOf(spec, binding.identity.behaviourId);
  }

  /**
   * THE RUNNING DECISION'S INSPECTION PORT for one game, or null when nothing
   * is running there.
   *
   * The port reads the LIVE kernel — `lastReport` only exists once a decision
   * has ended, which is when the turn is about to resolve and the operator has
   * stopped looking. Null is not a switch: it is the state "no decision is
   * answering questions right now", and the wire turns it into a typed
   * refusal rather than a silence.
   */
  lensPortFor(gameId: string): KernelLensPort | null {
    const live = this.games.get(gameId)?.live ?? null;
    return live === null ? null : live.kernel.lensPort();
  }

  /**
   * An assumption in the WIRE's numbering. The stored basis must be readable
   * one turn later, and a substrate unit number is not — it is private to the
   * decision that minted it (04 §2.2). A unit the substrate cannot name is
   * carried as `#<id>`, which is visibly not a wire id.
   */
  private storedAssumption(sub: EngineSubstrate, a: Assumption): StoredAssumption {
    if (a.kind === 'posture') return { kind: 'posture', posture: a.posture };
    if (a.kind === 'narrowing') {
      return { kind: 'narrowing', unit: wireKeyOf(sub, a.unitId), note: a.note };
    }
    return { kind: a.kind, unit: wireKeyOf(sub, a.unitId), to: a.to };
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

  /**
   * WHO MUST BE MODELLED FOR THE HELD SET TO FIT — which is now nobody.
   *
   * The engine used to carry claims in a fixed field of 32 slots, so a board
   * with more uncontrolled units than that forced the decision to MODEL the
   * nearest of them at their defaults and declare the narrowing. Claims are
   * keyed by unit id now and there is no field and no capacity: every
   * uncontrolled unit carries its own claim however many there are, so the
   * whole overflow path — the arrival-ranked probe that chose whom to model,
   * and the declared narrowing that paid for it — has no subject left.
   *
   * The seam stays as one function returning nothing so the caller's
   * replacement-and-declaration machinery keeps its shape for the one case it
   * still handles: a modelling choice that names a unit the substrate does not
   * have.
   */
  private planCapacity(_input: TeamTurnInput): {
    wireIds: ReadonlyArray<string>;
    ranked: ReadonlyArray<string>;
  } {
    return { wireIds: [], ranked: [] };
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
    return sub.withResolution(plan, asTeam, ({ resolution }) => {
      let worst = 0;
      for (const s of standingOf(sub, resolution, asTeam)) {
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
    refusals: Record<TeamRefusal, number>,
    bot: BotIdentity
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
        botRecommendation: move,
        timestamp: this.now(),
        bot,
      });
      forwarded++;
    }
    return forwarded;
  }

  /**
   * BUILD AND SHIP THE REPLAY ROWS, then re-publish the final turn data with
   * the evaluations attached.
   *
   * TWO CONSUMERS, ONE COMPUTATION. The database row and the live UI want the
   * same per-candidate list, so it is built once here and handed to both.
   *
   * WHY THE RE-PUBLISH IS SNAKES ONLY. `setBotRecommendation` rebuilds a
   * PIECE's `moveEvaluations` from the manager's own piece candidates before it
   * broadcasts — those rows carry the stay/rotate discriminant the client
   * labels candidates and routes arrow keys with, which this layer has no way
   * to reproduce. Overwriting them with lobster rows would trade a richer live
   * panel for a poorer one; the piece's lobster detail goes to the DATABASE,
   * where nothing was being written at all. Snakes have no such rebuild, so
   * their rows go straight through to the client (websocket-server forwards
   * `turnData.moveEvaluations` as it stands).
   *
   * Never throws. Telemetry that can take a decision down with it is worse
   * than no telemetry.
   */
  private emitTelemetry(args: {
    input: TeamTurnInput;
    sub: EngineSubstrate;
    asTeam: number;
    gen: GrammarCandidateGenerator;
    evaluate: Evaluator;
    report: KernelReport | null;
    finalPlan: JointPlan | null;
    views: ReadonlyMap<string, GameState>;
    lastForwarded: ReadonlyMap<string, CentaurMove>;
    assumptions: ReadonlyArray<Assumption>;
    modelled: ReadonlyArray<string>;
    pins: PinSet;
    bot: BotIdentity;
  }): void {
    const { input, sub, asTeam, gen, evaluate, finalPlan, views, lastForwarded } = args;
    let rows: UnitDecisionRow[];
    try {
      rows = buildDecisionRows({
        gameId: input.gameId,
        sub,
        asTeam,
        gen,
        evaluate,
        finalPlan,
        views,
        moveOf: (unit, candidate) => this.moveOf(sub, unit, candidate),
      });
    } catch (err) {
      this.log(
        `[team-engine] ${input.gameId} turn ${input.turn}: decision telemetry failed — ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    for (const row of rows) {
      const unit = sub.unitOfWireId(row.snakeId);
      const move = lastForwarded.get(row.snakeId);
      if (unit === undefined || unit.type !== 'snake' || move === undefined) continue;
      const view = views.get(row.snakeId);
      if (view === undefined) continue;
      try {
        this.ports.setBotRecommendation(input.gameId, row.snakeId, move, {
          gameState: view,
          moveEvaluations: row.moveEvaluations,
          territoryCells: {},
          botRecommendation: move,
          timestamp: this.now(),
          bot: args.bot,
        });
      } catch (err) {
        this.log(
          `[team-engine] ${input.gameId} turn ${input.turn}: final turn-data publish threw ` +
            `for ${row.snakeId} — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
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
