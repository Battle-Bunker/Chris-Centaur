/**
 * VERIFIER V1 — the scripted operator against the REAL trio.
 *
 * Every test here drives `LobsterKernel` over `EngineSubstrate` +
 * `GrammarCandidateGenerator` + `materialEvaluator` + `makeSearchCore` — the
 * exact assembly `TeamDecisionEngine` builds — with a STEP CLOCK injected
 * through `KernelInput.now`: every clock read advances a fixed tick, so slice
 * counts, cache statistics and emission sequences are a deterministic function
 * of the search's own work and never of wall time.
 *
 * The operator is scripted off SLICE BOUNDARIES: the search core is wrapped and
 * one `improve()` call is one refinement slice (the real core exposes no lever
 * surface, so every slice is an improve). Firing from inside the wrapper is
 * what a real operator does — the event lands mid-slice.
 *
 * Tests marked `test.skip` are BUG REPROS: they assert the behaviour the design
 * documents, and they fail today. They are reported, never fixed here.
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
import type { Board as ApiBoard, Coord, Snake } from '../types/battlesnake';
import { LobsterKernel, type KernelOptions, type KernelReport } from '../lobster/kernel';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { materialEvaluator } from '../lobster/evaluate';
import { makeSearchCore } from '../lobster/search';

// ------------------------------------------------------------------- fixtures

/** Monotonic, deterministic, never wall clock: each read costs one tick. */
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

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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
  makeSnake(id, [at], { unitType, length: weight, teamID } as Partial<Snake>);

const boardOf = (snakes: Snake[], size: number): ApiBoard =>
  ({ width: size, height: size, food: [], hazards: [], snakes }) as ApiBoard;

const TURN = 9;

/** 7×7, two of ours (piece + piece), two held enemies. */
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

/** 9×9, a snake and two pieces of ours, three held enemies. */
const board9 = (): ApiBoard =>
  boardOf(
    [
      piece('k', { x: 1, y: 4 }, 'king', 1, 'red'),
      piece('n', { x: 2, y: 2 }, 'knight', 1, 'red'),
      makeSnake(
        's',
        [
          { x: 3, y: 6 },
          { x: 2, y: 6 },
        ],
        { teamID: 'red', orientation: { dx: 1, dy: 0 } } as Partial<Snake>
      ),
      piece('eK', { x: 7, y: 4 }, 'king', 1, 'blue'),
      piece('eR', { x: 7, y: 7 }, 'rook', 2, 'blue'),
      piece('eP', { x: 6, y: 1 }, 'pawn', 1, 'blue'),
    ],
    9
  );

/** A board where pinning the rook away from its one good square costs material. */
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

interface Script {
  readonly atSlice: number;
  readonly event: PinEvent;
}

interface Run {
  readonly report: KernelReport;
  readonly emissions: ReadonlyArray<EmitRecord>;
  /** The plan handed to `conform` on each call; index 0 is rung 0. */
  readonly conformSeeds: ReadonlyArray<JointPlan>;
  /** Emissions already delivered when each scripted event fired. */
  readonly firedAtEmission: ReadonlyArray<number>;
}

async function drive(options: {
  board: ApiBoard;
  ourTeam: string;
  budgetMs?: number;
  kernel?: Partial<KernelOptions>;
  initialPins?: ReadonlyArray<Pin>;
  script?: ReadonlyArray<Script>;
  /** Make tentative pins BINDING inside speculative contexts (a repair probe).
   * Redundant since the kernel does this itself (V1-BUG-4); kept so the
   * harness still expresses the distinction. */
  bindSpeculation?: boolean;
  /** Shift every score the EVALUATOR returns, by EPOCH. Used to force a
   * falling floor across epochs, which is the PRECONDITION of the
   * no-cross-epoch-leak test and not something a real search can be relied on
   * to produce. */
  floorShift?: (epoch: number) => number;
}): Promise<Run> {
  const clock = new StepClock();
  const sub = makeSubstrate({ board: options.board, turn: TURN, asTeam: options.ourTeam });
  const gen = new GrammarCandidateGenerator();
  const base = makeSearchCore();
  const emissions: EmitRecord[] = [];
  const conformSeeds: JointPlan[] = [];
  const firedAtEmission: number[] = [];
  let slice = 0;

  const kernel = new LobsterKernel({
    sliceMs: 2,
    reserveMs: 1,
    minWriteIntervalMs: 0,
    ...options.kernel,
  });

  const bind = (ctx: SearchContext): SearchContext =>
    options.bindSpeculation === true && ctx.pins.some((p) => p.tentative)
      ? { ...ctx, pins: ctx.pins.map((p) => ({ ...p, tentative: false })) }
      : ctx;

  const core: SearchCore = {
    improve: (ctx) => {
      const out = base.improve(bind(ctx));
      slice++;
      for (const s of options.script ?? []) {
        if (s.atSlice !== slice) continue;
        firedAtEmission.push(emissions.length);
        kernel.onPinEvent(s.event);
      }
      return out;
    },
    conform: (ctx, incumbent) => {
      conformSeeds.push(incumbent);
      return base.conform(bind(ctx), incumbent);
    },
  };

  // The shift is keyed on the EPOCH — one conform call per epoch — so every
  // branch priced inside one epoch is shifted by the same amount. A per-call
  // shift would make two branches of the same plan disagree and the bank would
  // (correctly) throw a bounds inversion.
  const evaluate =
    options.floorShift === undefined
      ? materialEvaluator
      : {
          scorePlan: (s2: never, plan: never, team: never) => {
            const b = materialEvaluator.scorePlan(s2, plan, team);
            const d = (options.floorShift as (epoch: number) => number)(conformSeeds.length);
            return { lo: b.lo + d, est: b.est + d, hi: b.hi + d };
          },
          evaluatePlan: (s2: never, plan: never, team: never) =>
            materialEvaluator.evaluatePlan(s2, plan, team),
        };

  try {
    for await (const rec of kernel.decide({
      sub,
      gen,
      evaluate: evaluate as typeof materialEvaluator,
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
  return { report: kernel.lastReport as KernelReport, emissions, conformSeeds, firedAtEmission };
}

afterEach(() => clearGeometryCache());

// ------------------------------------------------------- 1. OSCILLATION

describe('oscillation: pin A → unpin → pin B → back to A', () => {
  const cases: Array<{ name: string; board: () => ApiBoard; ours: string[] }> = [
    { name: '7x7 pieces', board: board7, ours: ['a', 'b'] },
    { name: '9x9 snake+pieces', board: board9, ours: ['k', 'n', 's'] },
  ];

  for (const c of cases) {
    for (const cadence of [1, 5]) {
      test(`${c.name} @ every ${cadence} slice(s): NO refinement slice runs between the event and the conforming re-stage`, async () => {
        const board = c.board();
        const [h] = handles(board, 'red', c.ours);
        expect(h).toBeDefined();
        const unit = h as Handle;
        const a = unit.dests[0] as number;
        const b = unit.dests[unit.dests.length - 1] as number;
        const evs: PinEvent[] = [
          { kind: 'pin', pin: { unitId: unit.unitId, to: a, tentative: false } },
          { kind: 'unpin', unitId: unit.unitId },
          { kind: 'pin', pin: { unitId: unit.unitId, to: b, tentative: false } },
          { kind: 'unpin', unitId: unit.unitId },
          { kind: 'pin', pin: { unitId: unit.unitId, to: a, tentative: false } },
        ];
        const script = evs.map((event, i) => ({ atSlice: (i + 1) * cadence, event }));
        const run = await drive({ board, ourTeam: 'red', script, budgetMs: 200 });

        // Every event opened an epoch, and every epoch re-staged immediately.
        expect(run.report.epochs).toBe(evs.length + 1);
        expect(run.report.conformance).toHaveLength(evs.length);
        for (const sample of run.report.conformance) {
          expect(sample.slicesBefore).toBe(0);
          expect(sample.conformCalls).toBe(1);
        }
        expect(run.report.stagedNothing).toBe(false);
      });
    }
  }

  test('returning to a pin context RESUMES it — three contexts, never recreated', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const a = unit.dests[0] as number;
    const b = unit.dests[unit.dests.length - 1] as number;
    const evs: PinEvent[] = [
      { kind: 'pin', pin: { unitId: unit.unitId, to: a, tentative: false } },
      { kind: 'unpin', unitId: unit.unitId },
      { kind: 'pin', pin: { unitId: unit.unitId, to: b, tentative: false } },
      { kind: 'unpin', unitId: unit.unitId },
      { kind: 'pin', pin: { unitId: unit.unitId, to: a, tentative: false } },
    ];
    const run = await drive({
      board,
      ourTeam: 'red',
      script: evs.map((event, i) => ({ atSlice: (i + 1) * 4, event })),
      budgetMs: 200,
    });

    // Exactly three distinct pin contexts exist: [], [a], [b].
    expect(run.report.cache.creates).toBe(3);
    expect(run.report.cache.evictions).toBe(0);
    expect(run.report.contexts.map((c) => c.key).sort()).toEqual(
      [`pin:[]`, `pin:[${unit.unitId}@${a}]`, `pin:[${unit.unitId}@${b}]`].sort()
    );
    // The return to A hit the cache AND restored an incumbent.
    expect(run.report.cache.hits).toBeGreaterThanOrEqual(2);
    expect(run.report.cache.resumes).toBeGreaterThanOrEqual(2);
    // Every context that ran a slice carries an incumbent and a cursor above 0.
    for (const ctx of run.report.contexts) {
      if (ctx.cursor > 0) expect(ctx.incumbentLo).not.toBeNull();
    }
  });

  test('pinning a unit to the square it is ALREADY staged on still opens an epoch and re-stages in 0 slices', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    // What is the unit staged on with no operator involved?
    const control = await drive({ board, ourTeam: 'red', budgetMs: 150 });
    const alreadyAt = (control.emissions[control.emissions.length - 1] as EmitRecord).plan.get(
      unit.unitId
    )?.to as number;
    clearGeometryCache();

    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 150,
      script: [
        {
          atSlice: 4,
          event: { kind: 'pin', pin: { unitId: unit.unitId, to: alreadyAt, tentative: false } },
        },
      ],
    });
    expect(run.report.epochs).toBe(2);
    expect(run.report.conformance).toHaveLength(1);
    expect(run.report.conformance[0]?.slicesBefore).toBe(0);
    for (const rec of run.emissions.filter((r) => r.epoch >= 1)) {
      expect(rec.plan.get(unit.unitId)?.to).toBe(alreadyAt);
    }
  });

  test('oscillation costs nothing in end-of-decision quality against a same-budget control', async () => {
    const board = boardCostly();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const a = unit.dests[0] as number;
    const b = unit.dests[unit.dests.length - 1] as number;
    const evs: PinEvent[] = [
      { kind: 'pin', pin: { unitId: unit.unitId, to: a, tentative: false } },
      { kind: 'unpin', unitId: unit.unitId },
      { kind: 'pin', pin: { unitId: unit.unitId, to: b, tentative: false } },
      { kind: 'unpin', unitId: unit.unitId },
      { kind: 'pin', pin: { unitId: unit.unitId, to: a, tentative: false } },
    ];
    const oscillated = await drive({
      board,
      ourTeam: 'red',
      script: evs.map((event, i) => ({ atSlice: (i + 1) * 3, event })),
      budgetMs: 200,
    });
    clearGeometryCache();
    const control = await drive({
      board,
      ourTeam: 'red',
      script: [{ atSlice: 1, event: evs[0] as PinEvent }],
      budgetMs: 200,
    });

    const last = (r: Run): EmitRecord => r.emissions[r.emissions.length - 1] as EmitRecord;
    expect(last(oscillated).plan.get(unit.unitId)?.to).toBe(a);
    expect(last(control).plan.get(unit.unitId)?.to).toBe(a);
    // Same final constraint, same total budget: the oscillated decision must
    // not end below the control's proved floor.
    expect(last(oscillated).lo).toBeGreaterThanOrEqual(last(control).lo);
  });
});

// -------------------------------------------------- 2. CROSS-EPOCH RATCHET

describe('constraint epochs never share a ratchet', () => {
  test('a pin that lowers the proved floor is STAGED, not refused', async () => {
    const board = boardCostly();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    // Every destination of this rook except one costs material; oscillate over
    // several of them so at least one epoch's floor falls below its predecessor.
    const script: Script[] = unit.dests.slice(0, 6).map((to, i) => ({
      atSlice: (i + 1) * 3,
      event: { kind: 'pin', pin: { unitId: unit.unitId, to, tentative: false } } as PinEvent,
    }));
    // THE PRECONDITION IS FORCED, NOT HOPED FOR. V1 relied on the real search
    // happening to find a worse floor after some pin; with the epoch re-stage
    // now splicing into the plan the WIRE holds instead of rebuilding from the
    // generator's first candidates (V1-BUG-1), it usually does not — the
    // conformed plan is a repair of a refined one. The floor is driven down
    // explicitly so the property under test is actually exercised.
    const run = await drive({
      board,
      ourTeam: 'red',
      script,
      budgetMs: 250,
      floorShift: (epoch) => -10 * epoch,
    });

    const firstOfEpoch = new Map<number, EmitRecord>();
    for (const rec of run.emissions) if (!firstOfEpoch.has(rec.epoch)) firstOfEpoch.set(rec.epoch, rec);
    const los = [...firstOfEpoch.entries()].sort((x, y) => x[0] - y[0]).map(([, r]) => r.lo);
    // The point of the test: at least one epoch opens BELOW its predecessor and
    // is staged anyway. A leaked ratchet would refuse it.
    expect(los.some((lo, i) => i > 0 && lo < (los[i - 1] as number))).toBe(true);
    expect(run.report.refusals['ratchet-floor']).toBe(0);
    expect(run.report.refusals['ratchet-gap']).toBe(0);
    expect(run.report.boundViolations).toBe(0);
    // One basis per (epoch, posture): no epoch owns two bases without a flip.
    const perEpoch = new Map<number, number>();
    for (const b of run.report.basisHistory) perEpoch.set(b.epoch, (perEpoch.get(b.epoch) ?? 0) + 1);
    const flips = run.report.postureFlips.length;
    expect([...perEpoch.values()].reduce((a, b) => a + b, 0)).toBe(run.report.epochs + flips);
    // Every epoch that emitted anything got its own conforming record.
    expect(run.report.conformance).toHaveLength(script.length);
  });

  test('EPOCH STORM: events arriving faster than slices starve neither re-staging nor the clock', async () => {
    const board = boardCostly();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const clock = new StepClock();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator();
    const base = makeSearchCore();
    const kernel = new LobsterKernel({ sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 });
    const STORM = 20;
    let conforms = 0;
    let improves = 0;
    const emissions: EmitRecord[] = [];
    const core: SearchCore = {
      improve: (ctx) => {
        improves++;
        return base.improve(ctx);
      },
      // Fire from INSIDE the conformance call: the kernel re-enters the epoch
      // branch with no refinement slice in between. This is the storm.
      conform: (ctx, incumbent) => {
        conforms++;
        if (conforms <= STORM) {
          kernel.onPinEvent({
            kind: 'pin',
            pin: {
              unitId: unit.unitId,
              to: unit.dests[conforms % unit.dests.length] as number,
              tentative: false,
            },
          });
        }
        return base.conform(ctx, incumbent);
      },
    };
    try {
      for await (const rec of kernel.decide({
        sub,
        gen,
        evaluate: materialEvaluator,
        search: core,
        asTeam: sub.teamNumber('red'),
        deadlineMs: clock.peek() + 300,
        initialPins: [],
        now: clock.now,
      })) {
        emissions.push(rec);
      }
    } finally {
      sub.release();
    }
    const report = kernel.lastReport as KernelReport;

    expect(report.epochs).toBe(STORM + 1);
    // Re-staging is never starved: every epoch produced a conforming record.
    expect(report.conformance).toHaveLength(STORM);
    expect(new Set(report.conformance.map((c) => c.slicesBefore))).toEqual(new Set([0]));
    expect(new Set(emissions.map((r) => r.epoch)).size).toBe(STORM + 1);
    // Refinement is not starved either: slices still ran between the epochs.
    expect(improves).toBeGreaterThan(0);
    // No cross-epoch ratchet leak, and the decision stayed inside its budget.
    expect(report.refusals['ratchet-floor']).toBe(0);
    expect(report.boundViolations).toBe(0);
    expect(report.overshootMs).toBe(0);
    expect(report.stagedNothing).toBe(false);
  });
});

// -------------------------------------------------- 3. ADVERSARIAL PINS

describe('adversarial operator patterns', () => {
  test('an UNREACHABLE pin: refused on its own channel, once; the unit keeps its choice; the pin is never dropped', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const legal = new Set(unit.options.map((c) => c.to));
    let illegal = -1;
    for (let cell = 0; cell < 81; cell++) {
      if (!legal.has(cell) && cell !== unit.at) {
        illegal = cell;
        break;
      }
    }
    expect(illegal).toBeGreaterThanOrEqual(0);
    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 200,
      script: [
        {
          atSlice: 3,
          event: { kind: 'pin', pin: { unitId: unit.unitId, to: illegal, tentative: false } },
        },
      ],
    });

    expect(run.report.refusals['pin-unreachable']).toBe(1);
    expect(run.report.refusals.nonconforming).toBe(0);
    const after = run.emissions.filter((r) => r.epoch >= 1);
    expect(after.length).toBeGreaterThan(0);
    for (const rec of after) {
      // The pin STANDS — every record says so, by name.
      expect(
        rec.assumptions.filter(
          (a) =>
            a.kind === 'narrowing' &&
            a.unitId === unit.unitId &&
            a.note === `operator-pin-unreachable@${illegal}: unit keeps its own choice`
        )
      ).toHaveLength(1);
      // …and the unit keeps a destination of its own grammar.
      const to = rec.plan.get(unit.unitId)?.to as number;
      expect(legal.has(to)).toBe(true);
      expect(to).not.toBe(illegal);
    }
    expect(run.report.stagedNothing).toBe(false);
  });

  test('COMMIT is permanent: later pins, unpins and hovers on that unit change nothing', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const committed = unit.dests[0] as number;
    const other = unit.dests[unit.dests.length - 1] as number;
    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 250,
      script: [
        {
          atSlice: 2,
          event: { kind: 'pin', pin: { unitId: unit.unitId, to: committed, tentative: false } },
        },
        { atSlice: 4, event: { kind: 'commit', unitId: unit.unitId } },
        {
          atSlice: 6,
          event: { kind: 'pin', pin: { unitId: unit.unitId, to: other, tentative: false } },
        },
        { atSlice: 8, event: { kind: 'unpin', unitId: unit.unitId } },
      ],
    });

    // Two epochs opened (the pin, the commit); the contradiction and the unpin
    // opened none.
    expect(run.report.epochs).toBe(3);
    expect(run.report.conformance).toHaveLength(2);
    for (const rec of run.emissions.filter((r) => r.epoch >= 2)) {
      expect(rec.plan.get(unit.unitId)?.to).toBe(committed);
      expect(
        rec.assumptions.some(
          (a) => a.kind === 'operator-pin' && a.unitId === unit.unitId && a.to === committed
        )
      ).toBe(true);
    }
  });

  test('EVERY unit pinned: the search has nothing to do and the kernel still stages, without spinning', async () => {
    const board = board9();
    const hs = handles(board, 'red', ['k', 'n', 's']);
    expect(hs).toHaveLength(3);
    const pins: Pin[] = hs.map((u) => ({ unitId: u.unitId, to: u.dests[0] as number, tentative: false }));
    const run = await drive({ board, ourTeam: 'red', initialPins: pins, budgetMs: 200 });

    expect(run.report.stagedNothing).toBe(false);
    expect(run.report.epochs).toBe(1);
    expect(run.report.overshootMs).toBe(0);
    expect(run.report.elapsedMs).toBeLessThanOrEqual(run.report.budgetMs);
    for (const rec of run.emissions) {
      for (const pin of pins) expect(rec.plan.get(pin.unitId)?.to).toBe(pin.to);
    }
    // It does not spin: the loop's counted rail is never the reason it stopped.
    expect(run.report.slices).toBeLessThan(1_000_000);
    expect(run.report.refusals.nonconforming).toBe(0);
  });
});

// ------------------------------------------------------------ BUG REPROS

describe('BUG REPROS (V1) — asserted behaviour is the documented one; these fail today', () => {
  /**
   * V1-BUG-1. `drive()` calls `conformNow(run, run.basis.stagedPlan ?? EMPTY)`
   * AFTER `applyPinEvents` has already replaced the basis with a fresh one
   * (`newBasis` sets `stagedPlan: null`). So every epoch's conformance re-stage
   * is seeded from the EMPTY plan: `conform` re-picks `candidates[0]` for every
   * unit, treats every unit as disturbed, and the incumbent the decision has
   * been refining is thrown away at each operator event.
   */
  test('V1-BUG-1: an epoch re-stage is seeded from the plan the wire holds, not from nothing', async () => {
    const board = board7();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 200,
      script: [
        {
          atSlice: 5,
          event: {
            kind: 'pin',
            pin: { unitId: unit.unitId, to: unit.dests[0] as number, tentative: false },
          },
        },
      ],
    });
    // conformSeeds[0] is rung 0 and is legitimately empty; the epoch re-stage
    // must be handed the staged plan.
    expect(run.conformSeeds).toHaveLength(2);
    expect((run.conformSeeds[1] as JointPlan).size).toBeGreaterThan(0);
  });

  /**
   * V1-BUG-2. `search/basis.ts::basisOf` turns EVERY non-tentative pin in
   * `ctx.pins` into an `operator-pin` assumption, including one the kernel has
   * already refused as unreachable. The kernel then appends
   * `score.bounds.assumptions` to the record, so a record can carry BOTH
   * `narrowing: operator-pin-unreachable@X` and `operator-pin @X` for the same
   * unit — a provenance contradiction: the plan does not honour that pin.
   */
  test('V1-BUG-2: a record never claims an operator-pin it could not honour', async () => {
    const board = boardCostly();
    const [h] = handles(board, 'red', ['a', 'b']);
    const unit = h as Handle;
    const legal = new Set(unit.options.map((c) => c.to));
    let illegal = -1;
    for (let cell = 0; cell < 81; cell++) {
      if (!legal.has(cell) && cell !== unit.at) {
        illegal = cell;
        break;
      }
    }
    const run = await drive({
      board,
      ourTeam: 'red',
      budgetMs: 250,
      script: [
        {
          atSlice: 3,
          event: { kind: 'pin', pin: { unitId: unit.unitId, to: illegal, tentative: false } },
        },
      ],
    });
    for (const rec of run.emissions.filter((r) => r.epoch >= 1)) {
      expect(
        rec.assumptions.some(
          (a) => a.kind === 'operator-pin' && a.unitId === unit.unitId && a.to === illegal
        )
      ).toBe(false);
    }
  });

  /**
   * V1-BUG-3. Pin events are queued and applied at the top of the NEXT loop
   * iteration, but the iteration that queued them still runs its emit gates
   * (step 6) before yielding to that top. So one record decided under the OLD
   * constraint set can reach the wire AFTER the operator has acted — the wire
   * holds a set that contradicts the operator for exactly one write.
   */
  test('V1-BUG-3: no record decided before an operator event reaches the wire after it', async () => {
    const board = boardOf(
      [
        makeSnake(
          's1',
          [
            { x: 2, y: 4 },
            { x: 2, y: 5 },
            { x: 2, y: 6 },
          ],
          { teamID: 'red', orientation: { dx: 0, dy: -1 } } as Partial<Snake>
        ),
        piece('r1', { x: 3, y: 2 }, 'rook', 2, 'red'),
        makeSnake(
          'e1',
          [
            { x: 6, y: 3 },
            { x: 6, y: 2 },
          ],
          { teamID: 'blue', orientation: { dx: 0, dy: 1 } } as Partial<Snake>
        ),
        piece('eK', { x: 6, y: 6 }, 'king', 1, 'blue'),
        piece('eB', { x: 5, y: 1 }, 'bishop', 2, 'blue'),
      ],
      8
    );
    const [h] = handles(board, 'red', ['s1', 'r1']);
    const unit = h as Handle;
    const to = unit.dests[0] as number;
    const script: Script[] = [];
    for (let i = 0; i < 12; i++) {
      script.push({
        atSlice: i * 3 + 1,
        event:
          i % 2 === 0
            ? { kind: 'pin', pin: { unitId: unit.unitId, to, tentative: false } }
            : { kind: 'unpin', unitId: unit.unitId },
      });
    }
    const run = await drive({ board, ourTeam: 'red', script, budgetMs: 250 });
    // For each PIN event, the very next record on the wire must already honour it.
    for (let i = 0; i < run.firedAtEmission.length; i++) {
      const ev = script[i]?.event as PinEvent;
      if (ev.kind !== 'pin') continue;
      const next = run.emissions[run.firedAtEmission[i] as number];
      if (next === undefined) continue;
      expect(next.plan.get(unit.unitId)?.to).toBe(ev.pin.to);
    }
  });
});
