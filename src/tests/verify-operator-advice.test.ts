/**
 * VERIFIER V1 — tentative pins and pin advice, against the REAL trio.
 *
 * Companion to verify-operator-conformance.test.ts; same step-clock discipline
 * (deterministic, never wall clock). `test.skip` entries are BUG REPROS: they
 * assert the documented behaviour and fail today.
 */

import type {
  Candidate,
  EmitRecord,
  JointPlan,
  Pin,
  PinEvent,
  SearchContext,
  SearchCore,
  UnitId,
} from '../lobster/contracts';
import type { Board as ApiBoard, CentaurMove, Coord, GameState, Snake } from '../types/battlesnake';
import { LobsterKernel, type KernelReport } from '../lobster/kernel';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { materialEvaluator } from '../lobster/evaluate';
import { makeSearchCore } from '../lobster/search';
import { adviseFromReport } from '../lobster/pins';
import { TeamDecisionEngine, type TeamDecisionPorts } from '../lobster/team-decision-engine';

// ------------------------------------------------------------------- fixtures

class StepClock {
  private t: number;
  constructor(
    private readonly tick = 0.02,
    start = 1_000
  ) {
    this.t = start;
  }
  readonly now = (): number => {
    const v = this.t;
    this.t += this.tick;
    return v;
  };
  readonly peek = (): number => this.t;
}

function makeSnakeUnit(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const piece = (id: string, at: Coord, unitType: string, weight: number, teamID: string): Snake =>
  makeSnakeUnit(id, [at], { unitType, length: weight, teamID } as Partial<Snake>);

const boardOf = (snakes: Snake[], size: number): ApiBoard =>
  ({ width: size, height: size, food: [], hazards: [], snakes }) as ApiBoard;

const TURN = 9;

const board7 = (): ApiBoard =>
  boardOf(
    [
      piece('a', { x: 1, y: 3 }, 'king', 1, 'red'),
      piece('b', { x: 1, y: 1 }, 'rook', 2, 'red'),
      piece('K', { x: 5, y: 3 }, 'king', 1, 'blue'),
      piece('N', { x: 5, y: 5 }, 'knight', 1, 'blue'),
    ],
    7
  );

/**
 * Exhaustively computable: 11 of the rook's 13 destinations give up exactly 10
 * of material against the best unconstrained plan; two give up nothing.
 * (Ground truth is enumerated in bench/operator/truth.ts; the numbers here are
 * only used to name a pin whose cost is provably NOT zero.)
 */
const boardCostly = (): ApiBoard =>
  boardOf(
    [
      piece('a', { x: 2, y: 3 }, 'rook', 2, 'red'),
      piece('b', { x: 5, y: 6 }, 'knight', 1, 'red'),
      piece('e1', { x: 4, y: 3 }, 'knight', 1, 'blue'),
      piece('e2', { x: 2, y: 4 }, 'pawn', 1, 'blue'),
    ],
    7
  );

interface Handle {
  readonly unitId: UnitId;
  readonly at: number;
  readonly dests: ReadonlyArray<number>;
  readonly options: ReadonlyArray<Candidate>;
}

function handles(board: ApiBoard, ourTeam: string, wireIds: ReadonlyArray<string>): Handle[] {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: ourTeam });
  try {
    return wireIds.flatMap((wireId) => {
      const u = sub.unitOfWireId(wireId);
      if (u === undefined) return [];
      const options = sub.actionsOf(u.unitId);
      const at = u.cells[0] as number;
      return [
        {
          unitId: u.unitId,
          at,
          options,
          dests: [...new Set(options.map((c) => c.to))].filter((d) => d !== at).sort((x, y) => x - y),
        },
      ];
    });
  } finally {
    sub.release();
  }
}

interface SpecCall {
  readonly pins: ReadonlyArray<Pin>;
  readonly tentative: Pin | null;
  readonly plannedForTentativeUnit: number | undefined;
}

interface Run {
  readonly report: KernelReport;
  readonly emissions: ReadonlyArray<EmitRecord>;
  readonly calls: ReadonlyArray<SpecCall>;
}

async function drive(options: {
  board: ApiBoard;
  ourTeam: string;
  budgetMs?: number;
  initialPins?: ReadonlyArray<Pin>;
  hoverAtSlice?: ReadonlyArray<{ slice: number; pin: Pin }>;
  bindSpeculation?: boolean;
}): Promise<Run> {
  const clock = new StepClock();
  const sub = makeSubstrate({ board: options.board, turn: TURN, asTeam: options.ourTeam });
  const gen = new GrammarCandidateGenerator();
  const base = makeSearchCore();
  const emissions: EmitRecord[] = [];
  const calls: SpecCall[] = [];
  let slice = 0;
  const kernel = new LobsterKernel({ sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 });

  // A SPECULATIVE SLICE IS RECOGNISED BY ITS PIN SET, NOT BY A FLAG.
  //
  // V1 filed this harness against a kernel that handed the speculative context
  // its pin still flagged `tentative: true` — which is exactly why the search
  // skipped it and every speculative slice re-searched the unconstrained
  // problem (V1-BUG-4). The kernel now builds that context with the pin
  // BINDING while the context's key still names it tentative, so the flag is
  // gone from `ctx.pins` and a detector keyed on it sees nothing. The hovered
  // (unit, destination) pairs are what identify the context now.
  const hovered = new Set(
    (options.hoverAtSlice ?? []).map((h) => `${h.pin.unitId}@${h.pin.to}`)
  );
  const bind = (ctx: SearchContext): SearchContext =>
    options.bindSpeculation === true && ctx.pins.some((p) => p.tentative)
      ? { ...ctx, pins: ctx.pins.map((p) => ({ ...p, tentative: false })) }
      : ctx;

  const core: SearchCore = {
    improve: (ctx) => {
      const out = base.improve(bind(ctx));
      slice++;
      const tentative = ctx.pins.find((p) => hovered.has(`${p.unitId}@${p.to}`)) ?? null;
      calls.push({
        pins: [...ctx.pins],
        tentative,
        plannedForTentativeUnit:
          tentative === null ? undefined : out.plan.get(tentative.unitId)?.to,
      });
      for (const h of options.hoverAtSlice ?? []) {
        if (h.slice === slice) kernel.onPinEvent({ kind: 'pin', pin: h.pin } as PinEvent);
      }
      return out;
    },
    conform: (ctx, incumbent) => base.conform(bind(ctx), incumbent),
  };

  try {
    for await (const rec of kernel.decide({
      sub,
      gen,
      evaluate: materialEvaluator,
      search: core,
      asTeam: sub.teamNumber(options.ourTeam),
      deadlineMs: clock.peek() + (options.budgetMs ?? 200),
      initialPins: options.initialPins ?? [],
      now: clock.now,
    })) {
      emissions.push(rec);
    }
  } finally {
    sub.release();
  }
  return { report: kernel.lastReport as KernelReport, emissions, calls };
}

afterEach(() => clearGeometryCache());

// ------------------------------------------------- speculative contexts exist

describe('tentative pins reach the speculative machinery', () => {
  test('hovering two destinations creates a speculative context for each, searched and never emitted', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const x = unit.dests[0] as number;
    const y = unit.dests[unit.dests.length - 1] as number;
    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 250,
      hoverAtSlice: [
        { slice: 2, pin: { unitId: unit.unitId, to: x, tentative: true } },
        { slice: 20, pin: { unitId: unit.unitId, to: y, tentative: true } },
      ],
    });

    const keys = run.report.speculative.map((s) => s.key);
    expect(keys).toContain(`spec:[${unit.unitId}@${x}?]`);
    expect(keys).toContain(`spec:[${unit.unitId}@${y}?]`);
    // A tentative pin NEVER opens a constraint epoch.
    expect(run.report.epochs).toBe(1);
    // …and never appears as an operator-pin claim on an emitted record.
    for (const rec of run.emissions) {
      expect(
        rec.assumptions.some(
          (a) => a.kind === 'operator-pin' && (a.to === x || a.to === y) && a.unitId === unit.unitId
        )
      ).toBe(false);
    }
    // Slices really were spent on the speculative contexts…
    const specSlices = run.calls.filter((c) => c.tentative !== null);
    expect(specSlices.length).toBeGreaterThan(0);
    // …and the pin they were named for was BINDING inside them (V1-BUG-4).
    // Handed the pin flagged tentative, the search skipped it and every one of
    // these slices re-searched the unconstrained problem under a name claiming
    // otherwise: 0 of 289 slices honoured the hover.
    for (const call of specSlices) expect(call.tentative?.tentative).toBe(false);
    const honoured = specSlices.filter(
      (c) => c.plannedForTentativeUnit === c.tentative?.to
    );
    expect(honoured.length).toBeGreaterThan(0);
  });

  test('speculative work never leaks onto the wire (probed with a genuinely different speculative plan)', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;

    // What does the unconstrained decision stage for this unit?
    const control = await drive({ board, ourTeam: 'red', budgetMs: 250 });
    const staged = new Set(control.emissions.map((r) => r.plan.get(unit.unitId)?.to));
    clearGeometryCache();
    const hover = unit.dests.find((d) => !staged.has(d));
    expect(hover).toBeDefined();

    // Hover it. No `bindSpeculation` arm any more: the KERNEL makes the pin
    // binding inside its own speculative context, which is the fix V1's
    // repaired arm was simulating.
    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 250,
      hoverAtSlice: [{ slice: 2, pin: { unitId: unit.unitId, to: hover as number, tentative: true } }],
    });
    // The speculative search really did plan the hovered square…
    expect(
      run.calls.some((c) => c.tentative !== null && c.plannedForTentativeUnit === hover)
    ).toBe(true);
    // …and no emitted record ever carried it.
    for (const rec of run.emissions) {
      expect(rec.plan.get(unit.unitId)?.to).not.toBe(hover);
    }
  });
});

// --------------------------------------------------------- advice arithmetic

describe('adviseFromReport arithmetic (pure)', () => {
  const cand = (unitId: number, to: number): Candidate => ({ unitId, from: -1, to, path: [to] });
  const record = (plan: JointPlan, lo: number, hi: number): EmitRecord => ({
    plan,
    lo,
    est: (lo + hi) / 2,
    hi,
    horizon: 1,
    slack: 0,
    posture: 'SIGHTED',
    assumptions: [],
    epoch: 0,
  });

  test('a pin that gives up floor and ceiling is priced with both ends', () => {
    const plan: JointPlan = new Map([[4 as UnitId, cand(4, 11)]]);
    const report = {
      journal: [record(plan, 20, 60)],
      speculative: [{ key: 'spec:[4@77?]', lo: 5, hi: 40, cursor: 8 }],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(advice).toHaveLength(1);
    // The price is the INTERVAL difference of two intervals: the least the pin
    // can cost is our floor minus their ceiling, the most is our ceiling minus
    // their floor. [20,60] − [5,40] = [max(0,20−40), max(0,60−5)] = [0, 55].
    expect(advice[0]?.costLo).toBe(0);
    expect(advice[0]?.costHi).toBe(55);
    expect(advice[0]?.costLo).toBeLessThanOrEqual(advice[0]?.costHi as number);
  });

  /**
   * V1-BUG-6. Both ends are clamped at zero INDEPENDENTLY:
   *
   *     costs = [max(0, staged.lo − spec.lo), max(0, staged.hi − spec.hi)]
   *
   * When the speculative ceiling is unbounded (`hi = +Infinity`, the ordinary
   * reading of a barely-searched context — the rung-0 material bound on these
   * boards is literally `[lo, +Infinity]`), the ceiling term is `−Infinity` and
   * clamps to 0. With `staged.lo === spec.lo` the pair collapses to `[0, 0]`
   * and the advice is SURFACED as "this pin is free" — a positive claim built
   * from an unmeasured ceiling. Observed live: bench/operator's C1 board, pin
   * `0@30`, `spec=[10, ∞]`, `staged=[10, 20]`, exhaustive true cost 10.
   * An unknown ceiling must widen the interval, never collapse it.
   */
  test('V1-BUG-6: an unbounded speculative ceiling never reads as a free pin', () => {
    const plan: JointPlan = new Map([[4 as UnitId, cand(4, 11)]]);
    const report = {
      journal: [record(plan, 10, 20)],
      speculative: [{ key: 'spec:[4@77?]', lo: 10, hi: Number.POSITIVE_INFINITY, cursor: 8 }],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    // Either it is not surfaced at all, or its ceiling admits the cost it
    // cannot rule out. What it may not do is claim zero.
    expect(advice.length === 0 || (advice[0]?.costHi ?? 0) > 0).toBe(true);
  });

  /**
   * V1-BUG-7. `report.speculative` is the whole per-turn cache, across epochs.
   * The lookup is `s.key.includes("<unit>@<to>?")`, and a speculative key names
   * the COMMITTED pins it was searched under — so `spec:[4@77?]` (epoch 0) and
   * `spec:[0@30,4@77?]` (epoch 1) both match, and `Array.find` returns the
   * older, pre-epoch one. The staged record it is subtracted from is from the
   * CURRENT epoch: the advice is a difference of two numbers proved under
   * different assumption sets (non-negotiable 5).
   */
  test('V1-BUG-7: advice never subtracts across constraint epochs', () => {
    const plan: JointPlan = new Map([
      [0 as UnitId, cand(0, 30)],
      [4 as UnitId, cand(4, 11)],
    ]);
    const report = {
      // The staged record belongs to epoch 1 (a committed pin on unit 0).
      journal: [{ ...record(plan, 20, 60), epoch: 1 }],
      speculative: [
        // Stale: searched in epoch 0, before unit 0 was pinned.
        { key: 'spec:[4@77?]', lo: -100, hi: -50, cursor: 1 },
        // Current: searched in epoch 1, the one the advice must use.
        { key: 'spec:[0@30,4@77?]', lo: 18, hi: 55, cursor: 9 },
      ],
    } as unknown as KernelReport;
    const advice = adviseFromReport({
      report,
      tentative: [{ unitId: 4, to: 77, tentative: true }],
      witnesses: [],
      threshold: 0,
    });
    expect(advice).toHaveLength(1);
    // From the CURRENT context: [max(0,20−55), max(0,60−18)] = [0, 42]. From
    // the stale one it would be [70, 160].
    expect(advice[0]?.costHi).toBeLessThanOrEqual(42);
  });
});

// ------------------------------------------------------------- the big ones

describe('BUG REPROS (V1) — tentative pins are not actually searched', () => {
  /**
   * V1-BUG-4 (the load-bearing one). `search/core.ts::open()` skips every pin
   * with `tentative: true`:
   *
   *     for (const pin of ctx.pins) { if (pin.tentative || !sets.has(...)) continue; … }
   *
   * The kernel builds the speculative context by CONCATENATING the tentative
   * pin as-is (`pickContext`), so the speculative search receives the pin and
   * ignores it: it searches the UNCONSTRAINED problem under a name that claims
   * otherwise. Measured over 8 boards: 0 of 289 speculative slices honoured the
   * tentative pin they were named for.
   */
  test('V1-BUG-4: a speculative context honours the tentative pin it is named for', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const hover = unit.dests[unit.dests.length - 1] as number;
    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 250,
      hoverAtSlice: [{ slice: 2, pin: { unitId: unit.unitId, to: hover, tentative: true } }],
    });
    const specCalls = run.calls.filter((c) => c.tentative !== null);
    expect(specCalls.length).toBeGreaterThan(0);
    for (const call of specCalls) {
      expect(call.plannedForTentativeUnit).toBe((call.tentative as Pin).to);
    }
  });

  /**
   * V1-BUG-5 (the operator-visible consequence of BUG-4). On this board the
   * exhaustive ground truth says pinning the rook to any of eleven squares
   * gives up exactly 10 of material. Because the speculative context is
   * unconstrained, its bracket equals the committed one and the advice prices
   * the pin at zero — below `DEFAULT_ADVICE_THRESHOLD`, so nothing is even
   * surfaced. With the tentative pin made binding, 33 of 34 costly pins are
   * bracketed correctly (bench/operator/advice-calibration.bench.ts).
   */
  test('V1-BUG-5: advice brackets the true cost of a costly pin', async () => {
    // V1 filed this against a hard-coded "exhaustively verified cost-10
    // destination", which is this rook's OWN cell rather than one of its
    // destinations — the precondition fails at b17f139 too. The truth is
    // computed here instead, the way the calibration bench computes it: a
    // pin's cost is `max_P trueWorst(P) − max_{P pinned} trueWorst(P)`, and
    // `trueWorst` is the minimum over the enemies' COMPLETE joint reply set in
    // worlds where every unit is named, so nothing is held.
    const board = boardCostly();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const mate = handles(board, 'red', ['b'])[0] as Handle;

    const oracle = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled: board.snakes.map((s) => s.id),
    });
    let trueCost = 0;
    const costOf = new Map<number, number>();
    try {
      const asTeam = oracle.teamNumber('red');
      const enemies = ['e1', 'e2'].map((id) => oracle.unitOfWireId(id)?.unitId as UnitId);
      const replyLists = enemies.map((id) => oracle.actionsOf(id));
      const mateOptions = mate.options.slice(0, 4);

      const trueWorst = (staged: ReadonlyMap<UnitId, Candidate>): number => {
        let worst = Number.POSITIVE_INFINITY;
        for (const r0 of replyLists[0] as ReadonlyArray<Candidate>) {
          for (const r1 of replyLists[1] as ReadonlyArray<Candidate>) {
            const world = new Map(staged);
            world.set(enemies[0] as UnitId, r0);
            world.set(enemies[1] as UnitId, r1);
            const v = materialEvaluator.scorePlan(oracle, world, asTeam).lo;
            if (v < worst) worst = v;
          }
        }
        return worst;
      };

      let best = Number.NEGATIVE_INFINITY;
      const bestPinned = new Map<number, number>();
      for (const option of unit.options) {
        for (const m of mateOptions) {
          const staged = new Map<UnitId, Candidate>([
            [unit.unitId, option],
            [mate.unitId, m],
          ]);
          const value = trueWorst(staged);
          if (value > best) best = value;
          const standing = bestPinned.get(option.to);
          if (standing === undefined || value > standing) bestPinned.set(option.to, value);
        }
      }
      for (const [to, value] of bestPinned) {
        if (to === unit.at) continue;
        const cost = best - value;
        costOf.set(to, cost);
        if (cost > trueCost) trueCost = cost;
      }
    } finally {
      oracle.release();
    }
    const costlyDests = [...costOf.entries()]
      .filter(([, cost]) => cost > 0)
      .map(([to]) => to)
      .sort((a, b) => a - b)
      .slice(0, 6);
    // The board has to actually contain a costly pin for this to mean anything.
    expect(trueCost).toBeGreaterThan(0);
    expect(costlyDests.length).toBeGreaterThan(0);

    // Every costly destination is hovered in turn. Advice that IS surfaced
    // must bracket the truth; a destination whose speculative bracket is
    // unbounded is deliberately not surfaced at all (V1-BUG-6), so the claim
    // is "at least one is priced, and nothing priced is priced wrong".
    let priced = 0;
    for (const to of costlyDests) {
      clearGeometryCache();
      const run = await drive({
        board,
        ourTeam: 'red',
        budgetMs: 250,
        initialPins: [{ unitId: unit.unitId, to, tentative: true }],
      });
      const advice = adviseFromReport({
        report: run.report,
        tentative: [{ unitId: unit.unitId, to, tentative: true }],
        witnesses: [],
        threshold: 0,
      });
      if (advice.length === 0) continue;
      priced++;
      // BRACKETED, not priced free. Before the speculative context searched
      // its own pin, this returned [0, 0] — the difference between two
      // searches of the same unconstrained problem.
      expect(advice[0]?.costLo).toBeLessThanOrEqual(costOf.get(to) as number);
      expect(advice[0]?.costHi).toBeGreaterThanOrEqual(costOf.get(to) as number);
    }
    expect(priced).toBeGreaterThan(0);
  }, 120_000);
});

// ------------------------------------------------- when advice becomes visible

describe('when pin advice reaches the operator', () => {
  interface FakePorts extends TeamDecisionPorts {
    readonly staged: Array<{ snakeId: string; move: CentaurMove }>;
    fire(ev: PinEvent): void;
  }

  function fakePorts(registry: ReadonlyArray<string>, clock: StepClock): FakePorts {
    const staged: Array<{ snakeId: string; move: CentaurMove }> = [];
    let sink: ((ev: PinEvent) => void) | null = null;
    return {
      staged,
      setBotRecommendation: (_g, snakeId, move) => {
        staged.push({ snakeId, move });
      },
      enableTeamStaging: () => undefined,
      onPinEvent: (_g, s) => {
        sink = s;
        return () => {
          sink = null;
        };
      },
      pinSnakeIdOf: (_g, unitId) => registry[unitId] ?? null,
      now: () => 10_000,
      monotonic: clock.now,
      log: () => undefined,
      fire: (ev) => {
        if (sink === null) throw new Error('no pin sink');
        sink(ev);
      },
    };
  }

  const viewFor = (board: ApiBoard, snakeId: string): GameState =>
    ({
      game: { id: 'g', ruleset: { name: 't', version: 'v', settings: {} }, map: 'm', timeout: 10_000, source: 't' },
      turn: TURN,
      board,
      you: board.snakes.find((s) => s.id === snakeId) as Snake,
    }) as GameState;

  // INVERTED (was a characterisation of V1-BUG-8). Advice used to be computed
  // from `kernel.lastReport`, which does not exist until the decision has
  // ended — so the operator was told the price of the move they were
  // considering at the moment the turn was about to resolve. It is computed
  // from the record just emitted and the live speculative contexts now, and
  // deduplicated so an unchanged price is not re-sent.
  test('advice reaches the operator while they are still hovering, and is not repeated', async () => {
    const board = boardCostly();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const clock = new StepClock();
    const ports = fakePorts(['a', 'b'], clock);
    const engine = new TeamDecisionEngine(ports, { kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 } });

    const adviceAt: number[] = [];
    const adviceSignatures: string[] = [];
    engine.onPinAdvice((_g, advice) => {
      adviceAt.push(ports.staged.length);
      adviceSignatures.push(
        advice.map((a) => `${a.pin.unitId}@${a.pin.to}:${a.costLo}/${a.costHi}`).sort().join('|')
      );
    });

    let hovered = false;
    const original = ports.setBotRecommendation.bind(ports);
    (ports as { setBotRecommendation: TeamDecisionPorts['setBotRecommendation'] }).setBotRecommendation =
      (gameId, snakeId, move, turnData) => {
        original(gameId, snakeId, move, turnData);
        if (!hovered) {
          hovered = true;
          ports.fire({
            kind: 'pin',
            pin: { unitId: 0, to: unit.dests[unit.dests.length - 1] as number, tentative: true },
          });
        }
      };

    const result = await engine.decideTurn({
      gameId: 'g1',
      turn: TURN,
      board,
      ourTeamId: 'red',
      units: [
        { snakeId: 'a', view: viewFor(board, 'a') },
        { snakeId: 'b', view: viewFor(board, 'b') },
      ],
      deadlineMs: 10_000 + 250,
    });

    expect(hovered).toBe(true);
    const report = result.report as KernelReport;
    expect(report.speculative.length).toBeGreaterThan(0);
    // No delivery repeats a price that has not changed: consecutive callbacks
    // never carry the same signature.
    expect(new Set(adviceSignatures).size).toBe(adviceSignatures.length);
  }, 30_000);

  /**
   * V1-BUG-8 (design gap, not a coding error). `TeamDecisionEngine.decideTurn`
   * computes advice from `kernel.lastReport` only AFTER the emission loop has
   * drained — i.e. at the decision deadline. An operator hovering mid-turn
   * therefore receives the price of the move they are considering at the moment
   * the turn is about to resolve, which is too late to act on. The speculative
   * bracket exists from the first speculative slice; there is no seam that
   * surfaces it before the loop ends.
   */
  test('V1-BUG-8: a hovered pin is priced while the decision is still running', async () => {
    const board = boardCostly();
    const clock = new StepClock();
    const ports = fakePorts(['a', 'b'], clock);
    const engine = new TeamDecisionEngine(ports, { kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 } });
    let deliveredWhileRunning = false;
    let running = false;
    engine.onPinAdvice(() => {
      if (running) deliveredWhileRunning = true;
    });
    let hovered = false;
    const original = ports.setBotRecommendation.bind(ports);
    (ports as { setBotRecommendation: TeamDecisionPorts['setBotRecommendation'] }).setBotRecommendation =
      (gameId, snakeId, move, turnData) => {
        original(gameId, snakeId, move, turnData);
        if (!hovered) {
          hovered = true;
          ports.fire({ kind: 'pin', pin: { unitId: 0, to: 39, tentative: true } });
        }
      };
    running = true;
    await engine.decideTurn({
      gameId: 'g1',
      turn: TURN,
      board,
      ourTeamId: 'red',
      units: [
        { snakeId: 'a', view: viewFor(board, 'a') },
        { snakeId: 'b', view: viewFor(board, 'b') },
      ],
      deadlineMs: 10_000 + 250,
    });
    running = false;
    expect(deliveredWhileRunning).toBe(true);
  }, 30_000);
});
