/**
 * The soak driver: turns of the REAL lobster path (TeamDecisionEngine →
 * per-unit setBotRecommendation → TeamBatchSubmitter → fake Firestore),
 * measured per turn.
 *
 * INSTRUMENTATION WITHOUT MODIFICATION. The engine builds and releases its own
 * substrate, so the only sanctioned way to see it is the one injection point
 * the integrator left open: `TeamDecisionOptions.evaluate`. Every evaluator
 * call is handed the memoised substrate proxy, which forwards `engine`,
 * `outstanding()`, `resolutions()` and the memo's own `stats` — so a wrapper
 * evaluator reads the arena watermark, the slab census and the memo size from
 * inside the decision without touching a line of `src/`.
 */

import type { Board, CentaurMove, GameState } from '../../src/types/battlesnake';
import type { Evaluator, PinEvent, Substrate, UnitId } from '../../src/lobster/contracts';
import type { KernelReport } from '../../src/lobster/kernel';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../../src/lobster/team-decision-engine';
import { TeamBatchSubmitter, type TeamStagedUnit } from '../../src/wire/team-submitter';
import { StageThrottle } from '../../src/wire/stage-throttle';
import { FakeFirestore, advanceBoard, makeTeamBoard, rng, sleep, viewFor } from './scenario';

// ------------------------------------------------------------- instrumented

export interface ProbeSample {
  arenaCapacity: number;
  memoResolutions: number;
  memoHits: number;
  maxOutstanding: number;
  minOutstanding: number;
  firstOutstanding: number;
  calls: number;
  engineIdentity: number;
  sub: { outstanding(): number; resolutions(): number } | null;
}

const ENGINE_IDS = new WeakMap<object, number>();
let ENGINE_SEQ = 0;
const engineId = (e: object): number => {
  let id = ENGINE_IDS.get(e);
  if (id === undefined) {
    id = ++ENGINE_SEQ;
    ENGINE_IDS.set(e, id);
  }
  return id;
};

export const newSample = (): ProbeSample => ({
  arenaCapacity: 0,
  memoResolutions: 0,
  memoHits: 0,
  maxOutstanding: 0,
  minOutstanding: Number.POSITIVE_INFINITY,
  firstOutstanding: -1,
  calls: 0,
  engineIdentity: 0,
  sub: null,
});

/** Wrap an evaluator so every call reports the substrate's live census. */
export function probingEvaluator(inner: Evaluator, sample: () => ProbeSample): Evaluator {
  const observe = (sub: Substrate): void => {
    const s = sample();
    s.calls++;
    const v = sub as unknown as {
      engine?: { capacity: number };
      outstanding?: () => number;
      stats?: { resolutions: number; hits: number };
    };
    if (v.engine !== undefined) {
      s.arenaCapacity = Math.max(s.arenaCapacity, v.engine.capacity);
      s.engineIdentity = engineId(v.engine as unknown as object);
    }
    if (typeof v.outstanding === 'function') {
      const out = v.outstanding();
      s.maxOutstanding = Math.max(s.maxOutstanding, out);
      s.minOutstanding = Math.min(s.minOutstanding, out);
      if (s.firstOutstanding < 0) s.firstOutstanding = out;
      s.sub = sub as unknown as { outstanding(): number; resolutions(): number };
    }
    if (v.stats !== undefined) {
      s.memoResolutions = Math.max(s.memoResolutions, v.stats.resolutions);
      s.memoHits = Math.max(s.memoHits, v.stats.hits);
    }
  };
  return {
    scorePlan: (sub, plan, asTeam) => {
      observe(sub);
      return inner.scorePlan(sub, plan, asTeam);
    },
    evaluatePlan: (sub, plan, asTeam) => {
      observe(sub);
      return inner.evaluatePlan(sub, plan, asTeam);
    },
  };
}

// ---------------------------------------------------------------- metrics

export interface TurnMetrics {
  game: string;
  turn: number;
  latencyMs: number;
  budgetMs: number;
  elapsedMs: number;
  firstEmitMs: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  /** heapUsed after two forced full GCs: the RETAINED set, not the garbage. */
  retainedHeap: number;
  arenaCapacity: number;
  engineIdentity: number;
  memoResolutions: number;
  memoHits: number;
  maxOutstanding: number;
  minOutstanding: number;
  firstOutstanding: number;
  /** The decision's substrate AFTER decideTurn returned. Contract: 0. */
  outstandingAfterRelease: number;
  evaluatorCalls: number;
  emits: number;
  slices: number;
  improveCalls: number;
  conformCalls: number;
  evaluateCalls: number;
  meanSliceCostMs: number;
  finalStepCostMs: number;
  epochs: number;
  conformanceLatencyMs: number;
  conformanceSlicesBefore: number;
  overshootMs: number;
  contexts: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEvictions: number;
  cacheInvalidations: number;
  journalLen: number;
  stagedNothing: number;
  boundViolations: number;
  xfBlocked: number;
  xfCertified: number;
  xfUncertified: number;
  xfIndependent: number;
  refCrossfade: number;
  refRate: number;
  refWorth: number;
  refNonconforming: number;
  refPinUnreachable: number;
  writes: number;
  docs: number;
  chunksMax: number;
  /** Writes/docs that had actually landed by the time decideTurn RETURNED. */
  writesDuringDecision: number;
  docsDuringDecision: number;
  /** Docs that landed only AFTER finalFlush's promise had already resolved. */
  docsAfterFinalFlush: number;
  wastedDocs: number;
  forwarded: number;
}

export interface GameOptions {
  readonly gameId: string;
  readonly size: number;
  readonly ours: number;
  readonly theirs: number;
  readonly budgetMs: number;
  readonly seed?: number;
  readonly minWriteIntervalMs?: number;
  readonly kernelMinWriteIntervalMs?: number;
  readonly churnFood?: boolean;
  readonly pinRate?: number;
  /** Simulated commit round trip per chunk. */
  readonly commitLatencyMs?: number;
  /** Read-back ack delivered as a macrotask after this delay (real listener). */
  readonly ackDelayMs?: number;
  /** endTime = decision start + budgetMs + this. Default 40 (a reserve). */
  readonly endTimeOffsetMs?: number;
  /** Resolve the turn early (all opponents committed) after this many ms. */
  readonly earlyResolveMs?: number;
  /** Sample the retained (post-GC) heap every N turns. */
  readonly retainEvery?: number;
  /** Extra kernel options, merged LAST — including an injected teammateFloor. */
  readonly kernelOverrides?: Record<string, unknown>;
}

/**
 * One scripted game, steppable a turn at a time so several can be interleaved
 * in one process exactly as a production server multiplexes matches.
 */
export class SoakGame {
  board: Board;
  readonly fake: FakeFirestore;
  readonly submitter: TeamBatchSubmitter;
  readonly engine: TeamDecisionEngine;
  readonly metrics: TurnMetrics[] = [];
  /** Every turn's raw kernel report, for probes that need the journal. */
  readonly reports: Array<KernelReport | null> = [];
  /** Fired synchronously from inside the FIRST emission of each turn — the
   * only place a callback can run mid-decision (see the eventloop scenario). */
  onFirstEmission: ((game: SoakGame, snakeId: string, move: unknown) => void) | null = null;
  readonly violations: string[] = [];
  readonly ourIds: string[];
  private readonly r: () => number;
  private sample = newSample();
  private desired = new Map<string, TeamStagedUnit>();
  private inflight: Array<Promise<unknown>> = [];
  private firstEmitAt = -1;
  private currentTurn = 0;
  private pinSink: ((ev: PinEvent) => void) | null = null;

  constructor(readonly opts: GameOptions) {
    this.r = rng(opts.seed ?? 42);
    this.board = makeTeamBoard({
      size: opts.size,
      ours: opts.ours,
      theirs: opts.theirs,
      seed: opts.seed,
    });
    this.ourIds = this.board.snakes.filter((s) => s.teamID === 'red').map((s) => s.id);
    this.fake = new FakeFirestore(() => this.board, {
      commitLatencyMs: opts.commitLatencyMs,
      ...(opts.ackDelayMs !== undefined ? { ackDelayMs: opts.ackDelayMs } : {}),
    });
    this.submitter = new TeamBatchSubmitter(this.fake, {
      throttle: new StageThrottle({ minWriteIntervalMs: opts.minWriteIntervalMs ?? 1000 }),
      log: () => undefined,
    });
    const ports: TeamDecisionPorts = {
      setBotRecommendation: (_g, snakeId, move) => {
        const first = this.firstEmitAt < 0;
        if (first) this.firstEmitAt = Date.now();
        this.desired.set(snakeId, { snakeId, move, source: 'bot' });
        this.inflight.push(
          this.submitter
            .submitTeamSet(opts.gameId, this.currentTurn, Array.from(this.desired.values()))
            .catch(() => undefined)
        );
        if (first) this.onFirstEmission?.(this, snakeId, move);
      },
      enableTeamStaging: () => undefined,
      onPinEvent: (_g, sink) => {
        this.pinSink = sink;
        return () => {
          this.pinSink = null;
        };
      },
      pinSnakeIdOf: (_g, unitId) => this.ourIds[unitId] ?? null,
      log: () => undefined,
    };
    this.engine = new TeamDecisionEngine(ports, {
      evaluate: probingEvaluator(materialEvaluator, () => this.sample),
      kernel: {
        reserveMs: 25,
        sliceMs: 15,
        ...(opts.kernelMinWriteIntervalMs !== undefined
          ? { minWriteIntervalMs: opts.kernelMinWriteIntervalMs }
          : {}),
        ...((opts.kernelOverrides ?? {}) as object),
      },
    });
  }

  /** The live pin sink, for probes that deliver an event mid-decision. */
  firePin(event: PinEvent): void {
    this.pinSink?.(event);
  }

  get stagedNow(): ReadonlyMap<string, TeamStagedUnit> {
    return this.desired;
  }

  async step(turn: number): Promise<TurnMetrics> {
    const { opts } = this;
    this.currentTurn = turn;
    this.desired = new Map();
    this.inflight = [];
    this.sample = newSample();
    this.firstEmitAt = -1;

    if (opts.churnFood) {
      const taken = new Set(this.board.snakes.map((s) => `${s.body[0]?.x},${s.body[0]?.y}`));
      const f = { x: turn % this.board.width, y: (turn * 7) % this.board.height };
      this.board = {
        ...this.board,
        food: taken.has(`${f.x},${f.y}`) ? [] : [f],
      } as Board;
    }

    const units = this.ourIds
      .filter((id) => this.board.snakes.some((s) => s.id === id))
      .map((id) => ({ snakeId: id, view: viewFor(this.board, id, turn) as GameState }));

    const t0 = Date.now();
    this.fake.endTimeMs = t0 + opts.budgetMs + (opts.endTimeOffsetMs ?? 40);
    if ((opts.pinRate ?? 0) > 0 && this.r() < (opts.pinRate as number)) this.armPin(units.length, opts.budgetMs);

    const result = await this.engine.decideTurn({
      gameId: opts.gameId,
      turn,
      board: this.board,
      ourTeamId: 'red',
      units,
      deadlineMs: t0 + opts.budgetMs,
    });
    const latencyMs = Date.now() - t0;
    const landedDuring = this.fake.writes.filter(
      (w) => w.turn === turn && w.gameId === opts.gameId
    );
    const writesDuringDecision = landedDuring.length;
    const docsDuringDecision = landedDuring.reduce((a, w) => a + w.docs.length, 0);

    await Promise.all(this.inflight);
    await this.submitter.finalFlush(opts.gameId, turn);
    // DRAIN. A flush that lands while another is in flight is re-queued with a
    // bare `void this.flush(...)`, so `finalFlush`'s promise can resolve while
    // the last write is still on its way. Pump the macrotask queue until the
    // wire goes quiet, and count what arrived after the caller was told it was
    // done.
    const atFinalFlush = this.fake.writes.length;
    for (let i = 0; i < 40; i++) {
      const n = this.fake.writes.length;
      await sleep((opts.commitLatencyMs ?? 0) + (opts.ackDelayMs ?? 0) + 2);
      if (this.fake.writes.length === n) break;
    }
    const docsAfterFinalFlush = this.fake.writes
      .slice(atFinalFlush)
      .filter((w) => w.turn === turn && w.gameId === opts.gameId)
      .reduce((a, w) => a + w.docs.length, 0);

    const report = result.report as KernelReport | null;
    const mem = process.memoryUsage();
    // The retained set: two full GCs, then heapUsed. A leak survives this; the
    // per-turn garbage a 300 ms decision produces does not.
    let retained = -1;
    if (typeof globalThis.gc === 'function' && turn % (opts.retainEvery ?? 5) === 0) {
      globalThis.gc();
      globalThis.gc();
      retained = process.memoryUsage().heapUsed;
    }
    const turnWrites = this.fake.writes.filter((w) => w.turn === turn && w.gameId === opts.gameId);
    const s = this.sample;
    const m: TurnMetrics = {
      game: opts.gameId,
      turn,
      latencyMs,
      budgetMs: opts.budgetMs,
      elapsedMs: report?.elapsedMs ?? 0,
      firstEmitMs: this.firstEmitAt < 0 ? -1 : this.firstEmitAt - t0,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
      retainedHeap: retained,
      arenaCapacity: s.arenaCapacity,
      engineIdentity: s.engineIdentity,
      memoResolutions: s.memoResolutions,
      memoHits: s.memoHits,
      maxOutstanding: s.maxOutstanding,
      minOutstanding: Number.isFinite(s.minOutstanding) ? s.minOutstanding : -1,
      firstOutstanding: s.firstOutstanding,
      outstandingAfterRelease: s.sub === null ? -1 : s.sub.outstanding(),
      evaluatorCalls: s.calls,
      emits: report?.emits ?? 0,
      slices: report?.slices ?? 0,
      improveCalls: report?.improveCalls ?? 0,
      conformCalls: report?.conformCalls ?? 0,
      evaluateCalls: report?.evaluateCalls ?? 0,
      meanSliceCostMs: report?.meanSliceCostMs ?? 0,
      finalStepCostMs: report?.finalStepCostMs ?? 0,
      epochs: report?.epochs ?? 0,
      conformanceLatencyMs: report?.conformance[0]?.latencyMs ?? -1,
      conformanceSlicesBefore: report?.conformance[0]?.slicesBefore ?? -1,
      overshootMs: report?.overshootMs ?? 0,
      contexts: report?.contexts.length ?? 0,
      cacheHits: report?.cache.hits ?? 0,
      cacheMisses: report?.cache.misses ?? 0,
      cacheEvictions: report?.cache.evictions ?? 0,
      cacheInvalidations: report?.cache.invalidations ?? 0,
      journalLen: report?.journal.length ?? 0,
      stagedNothing: report?.stagedNothing === true ? 1 : 0,
      boundViolations: report?.boundViolations ?? 0,
      xfBlocked: report?.crossfade.blocked ?? 0,
      xfCertified: report?.crossfade.certified ?? 0,
      xfUncertified: report?.crossfade.uncertified ?? 0,
      xfIndependent: report?.crossfade.independent ?? 0,
      refCrossfade: report?.refusals.crossfade ?? 0,
      refRate: report?.refusals.rate ?? 0,
      refWorth: report?.refusals.worth ?? 0,
      refNonconforming: report?.refusals.nonconforming ?? 0,
      refPinUnreachable: report?.refusals['pin-unreachable'] ?? 0,
      writes: turnWrites.length,
      docs: turnWrites.reduce((a, w) => a + w.docs.length, 0),
      chunksMax: turnWrites.reduce((a, w) => Math.max(a, w.docs.length), 0),
      writesDuringDecision,
      docsDuringDecision,
      docsAfterFinalFlush,
      wastedDocs: turnWrites.filter((w) => w.commitAt > this.fake.endTimeMs).reduce((a, w) => a + w.docs.length, 0),
      forwarded: result.forwarded,
    };

    if (m.stagedNothing === 1) this.violations.push(`${opts.gameId} t${turn}: stagedNothing`);
    if (m.boundViolations > 0)
      this.violations.push(`${opts.gameId} t${turn}: ${m.boundViolations} bound violations`);
    if (m.chunksMax > 10) this.violations.push(`${opts.gameId} t${turn}: chunk of ${m.chunksMax} docs`);
    if (m.outstandingAfterRelease > 0)
      this.violations.push(
        `${opts.gameId} t${turn}: SLAB LEAK — outstanding()=${m.outstandingAfterRelease} after release (contract: 0)`
      );
    for (const w of turnWrites) {
      const seen = new Set<string>();
      for (const d of w.docs) {
        if (seen.has(d.playerID))
          this.violations.push(`${opts.gameId} t${turn}: two docs for ${d.playerID} in one batch`);
        seen.add(d.playerID);
      }
    }

    this.metrics.push(m);
    this.reports.push(report);

    const staged = new Map<string, CentaurMove>();
    for (const [id, u] of this.desired) staged.set(id, u.move);
    this.board = advanceBoard(this.board, staged, turn, this.r);
    return m;
  }

  private armPin(unitCount: number, budgetMs: number): void {
    const target = Math.floor(this.r() * unitCount);
    const h = globalThis.setTimeout(
      () => {
        const sink = this.pinSink;
        if (sink === null) return;
        const staged = this.desired.get(this.ourIds[target] ?? '');
        if (staged === undefined || typeof staged.move !== 'number') return;
        sink({ kind: 'pin', pin: { unitId: target as UnitId, to: staged.move, tentative: false } });
      },
      Math.max(5, Math.min(60, budgetMs / 4))
    );
    (h as unknown as { unref?: () => void }).unref?.();
  }

  dispose(): void {
    this.engine.release(this.opts.gameId);
    this.submitter.abandon(this.opts.gameId);
  }
}
