/**
 * INTEGRATION: the real trio — EngineSubstrate + GrammarCandidateGenerator +
 * BoundEvaluator under makeSearchCore and LobsterKernel, on real boards.
 *
 * Every builder shipped against stubs of its neighbours; these tests pin the
 * guarantees each stub ASSUMED, against the real implementations:
 *
 *  - the sentinels agree across modules (the no-order destination, DEAD);
 *  - conform(∅) is rung 0: a complete legal joint plan, cheaply;
 *  - improve honours pins, honours the clock, and RESUMES from the incumbent
 *    and witness set rather than restarting (B3's stubs could not catch a
 *    restarting core — this suite can);
 *  - the ledger under fog names the responsible held units;
 *  - lo ≤ est ≤ hi from the real evaluator, on every plan tried;
 *  - the resolution memo is warm between search calls and empty after
 *    release — a cold memo here presents as "the engine is slow";
 *  - the kernel threads witnesses back into the context, contains a bounds
 *    inversion, and refuses an unreachable pin on a named channel.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { makeSnake } from './board-fixtures';
import type {
  Assumption,
  BudgetHandle,
  Candidate,
  JointPlan,
  PlanScore,
  SearchContext,
  SearchCore,
  UnitId,
  Witness,
} from '../lobster/contracts';
import { NO_ORDER_MOVE } from '../lobster/contracts';
import {
  EngineSubstrate,
  OverlappingUnitsError,
  clearGeometryCache,
  makeSubstrate,
} from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { DEAD as EVALUATE_DEAD, materialEvaluator } from '../lobster/evaluate';
import { BoundBank, BoundsInversionError, DEAD as BOUNDS_DEAD, witnessKey } from '../lobster/bounds';
import type { BankResult } from '../lobster/bounds';
import { makeSearchCore } from '../lobster/search';
import { DEFAULT_DEAD_BELOW } from '../lobster/postures';
import { LobsterKernel, deadlineFromWallClock } from '../lobster/kernel';

// ------------------------------------------------------------------ fixtures

const piece = (
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 7, height: 7, food: [], hazards: [], snakes, ...extra }) as Board;

const TURN = 12;

/** Two of ours against two held enemies, close enough to entangle. */
const DUEL = (): Board =>
  boardOf([
    piece('r', { x: 1, y: 3 }, 'rook', 2, { teamID: 'red' }),
    piece('k', { x: 1, y: 1 }, 'king', 1, { teamID: 'red' }),
    piece('K', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
    piece('N', { x: 5, y: 5 }, 'knight', 1, { teamID: 'blue' }),
  ]);

/**
 * `n` of our kings on a 12×12 board with one enemy — the roster-scaling
 * fixture. Big enough that anything linear in the roster is unmistakable at
 * n = 12, small enough to stay deterministic and fast.
 */
const ROSTER = (n: number): Board => {
  const snakes: Snake[] = [];
  for (let i = 0; i < n; i++) {
    snakes.push(piece(`u${i}`, { x: 1 + (i % 5), y: 1 + Math.floor(i / 5) }, 'king', 1, {
      teamID: 'red',
    }));
  }
  snakes.push(piece('E', { x: 10, y: 10 }, 'king', 1, { teamID: 'blue' }));
  return boardOf(snakes, { width: 12, height: 12 });
};

function unbounded(): BudgetHandle {
  const start = Date.now();
  return {
    remainingMs: () => Number.POSITIVE_INFINITY,
    elapsedMs: () => Date.now() - start,
    shouldStop: () => false,
    now: () => Date.now(),
  };
}

function expired(): BudgetHandle {
  return { remainingMs: () => 0, elapsedMs: () => 0, shouldStop: () => true, now: () => 0 };
}

interface Trio {
  readonly sub: EngineSubstrate;
  readonly gen: GrammarCandidateGenerator;
  ctx(over?: Partial<SearchContext>): SearchContext;
  close(): void;
}

function trio(board: Board = DUEL()): Trio {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const gen = new GrammarCandidateGenerator();
  return {
    sub,
    gen,
    ctx: (over = {}) => ({
      sub,
      gen,
      evaluate: materialEvaluator,
      asTeam: 0,
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: unbounded(),
      ...over,
    }),
    close: () => sub.release(),
  };
}

const sameKeys = (a: JointPlan, b: JointPlan): boolean => {
  const key = (p: JointPlan): string =>
    [...p.values()].map((c) => `${c.unitId}>${c.to}#${c.path.join('.')}`).sort().join('|');
  return key(a) === key(b);
};

afterEach(() => clearGeometryCache());

// ---------------------------------------------------------------- sentinels

describe('one sentinel per concept, everywhere', () => {
  test('NO_ORDER_MOVE is not a cell, so it can never be mistaken for one', () => {
    // The engine has no no-order sentinel to agree with any more: a unit with
    // no staged move simply has no `stagedMove`, and settlement gives it the
    // kind's own default. So the contract's sentinel has one job left — to be
    // outside the board — and the substrate turns it into the absence the
    // engine wants.
    expect(NO_ORDER_MOVE).toBeLessThan(0);
  });

  test('DEAD agrees across evaluate, bounds, and the posture default', () => {
    expect(BOUNDS_DEAD).toBe(EVALUATE_DEAD);
    expect(DEFAULT_DEAD_BELOW).toBe(EVALUATE_DEAD);
    expect(EVALUATE_DEAD).toBe(Number.NEGATIVE_INFINITY);
  });
});

// -------------------------------------------------------- marshalling guard

describe('the marshalling disjointness guard (B2 finding, wire translation)', () => {
  test('two units on one turn-start cell refuse translation outright', () => {
    const overlapping = boardOf([
      piece('a', { x: 3, y: 3 }, 'king', 1, { teamID: 'red' }),
      piece('b', { x: 3, y: 3 }, 'knight', 1, { teamID: 'blue' }),
    ]);
    expect(() => makeSubstrate({ board: overlapping, turn: TURN, asTeam: 'red' })).toThrow(
      OverlappingUnitsError
    );
  });

  test('a weight stack is one unit and is NOT an overlap', () => {
    const sub = makeSubstrate({
      board: boardOf([piece('r', { x: 3, y: 3 }, 'rook', 5, { teamID: 'red' })]),
      turn: TURN,
      asTeam: 'red',
    });
    expect(sub.unitOfWireId('r')?.weight).toBe(5);
    sub.release();
  });
});

// ------------------------------------------------------------------ conform

describe('conform(ctx, ∅) is rung 0 against the real trio', () => {
  test('a complete legal joint plan for every commandable unit', () => {
    const t = trio();
    try {
      const core = makeSearchCore();
      const plan = core.conform(t.ctx(), new Map());
      const ours = t.sub.commandable(0);
      expect([...plan.keys()].sort((a, b) => a - b)).toEqual([...ours].sort((a, b) => a - b));
      for (const [unitId, candidate] of plan) {
        const set = t.gen.candidatesFor(t.sub, unitId);
        const offered = [...set.candidates, ...set.prunedLedger.map((e) => e.candidate)];
        expect(
          offered.some((c) => c.to === candidate.to && c.path.join('.') === candidate.path.join('.'))
        ).toBe(true);
      }
    } finally {
      t.close();
    }
  });

  test('conform is cheap: far fewer resolutions than improve, at 12 units', () => {
    // AT TWELVE UNITS, deliberately. The ratio this test asserts holds at any
    // roster size for the wrong reason if rung 0 is linear in the roster: two
    // units is small enough that `1 + |ours| × repairs` still looks cheap next
    // to six sweeps. A rung-0 regression has to show up as a FAILURE here, so
    // the roster is the one the production regime actually runs.
    const a = trio(ROSTER(12));
    let conformCost = 0;
    try {
      makeSearchCore().conform(a.ctx(), new Map());
      conformCost = a.sub.settlements();
    } finally {
      a.close();
    }
    const b = trio(ROSTER(12));
    let improveCost = 0;
    try {
      makeSearchCore().improve(b.ctx());
      improveCost = b.sub.settlements();
    } finally {
      b.close();
    }
    expect(conformCost).toBeGreaterThan(0);
    // Deterministic on this board (no clock in the loop): conform prices the
    // seed ONCE; improve pays for sweeps, repair and polish on top.
    expect(conformCost).toBeLessThan(improveCost * 0.1);
  });

  test('rung 0 costs a BOUNDED number of resolutions, not one per unit (V4 B2)', () => {
    // The contract the whole kernel is built on: "conform is cheap and never
    // searches — its cost tracks how much the pin disturbed, not the roster".
    // With an empty incumbent NOTHING is disturbed, so the cost must not grow
    // with the roster at all. The old rung 0 measured 7 / 19 / 37 resolutions
    // at these three sizes (≈ 3n + 1, exactly linear); it must now be flat.
    const costs = [2, 6, 12].map((n) => {
      const t = trio(ROSTER(n));
      try {
        const plan = makeSearchCore().conform(t.ctx(), new Map());
        // Still rung 0's contract: a complete legal plan for every unit.
        expect(plan.size).toBeGreaterThanOrEqual(t.sub.commandable(0).length);
        return t.sub.settlements();
      } finally {
        t.close();
      }
    });
    const [two, six, twelve] = costs as [number, number, number];
    expect(two).toBeGreaterThan(0);
    // Flat, not merely sub-linear: six times the roster may not cost six times
    // the resolutions, and the twelve-unit rung must stay inside the same
    // small constant the two-unit one paid.
    expect(twelve).toBeLessThanOrEqual(two * 2);
    expect(six).toBeLessThanOrEqual(two * 2);
    expect(twelve).toBeLessThan(12);
  });

  test('a pinned conform honours the pin exactly', () => {
    const t = trio();
    try {
      const rook = t.sub.unitOfWireId('r')?.unitId as UnitId;
      const target = t.gen.candidatesFor(t.sub, rook).candidates[1] as Candidate;
      const plan = makeSearchCore().conform(
        t.ctx({ pins: [{ unitId: rook, to: target.to, tentative: false }] }),
        new Map()
      );
      expect(plan.get(rook)?.to).toBe(target.to);
    } finally {
      t.close();
    }
  });
});

// ------------------------------------------------------------------ improve

describe('improve against the real trio', () => {
  test('returns pin-conforming plans with the pin on the basis', () => {
    const t = trio();
    try {
      const rook = t.sub.unitOfWireId('r')?.unitId as UnitId;
      const target = t.gen.candidatesFor(t.sub, rook).candidates[1] as Candidate;
      const out = makeSearchCore().improve(
        t.ctx({ pins: [{ unitId: rook, to: target.to, tentative: false }] })
      );
      expect(out.plan.get(rook)?.to).toBe(target.to);
      expect(out.bounds.assumptions).toContainEqual({
        kind: 'operator-pin',
        unitId: rook,
        to: target.to,
      });
    } finally {
      t.close();
    }
  });

  test('honours budget.shouldStop: a tripped clock costs less than an open one', () => {
    const open = trio();
    let openCost = 0;
    try {
      makeSearchCore().improve(open.ctx());
      openCost = open.sub.settlements();
    } finally {
      open.close();
    }
    const cut = trio();
    try {
      let asked = 0;
      const budget: BudgetHandle = {
        remainingMs: () => (asked > 3 ? 0 : 1),
        elapsedMs: () => asked,
        now: () => asked,
        shouldStop: () => {
          asked++;
          return asked > 3;
        },
      };
      const out = makeSearchCore().improve(cut.ctx({ budget }));
      // Cut short, it still holds a complete plan — and it spent real work
      // only until the clock tripped.
      expect(out.plan.size).toBe(cut.sub.commandable(0).length);
      expect(cut.sub.settlements()).toBeLessThan(openCost);
    } finally {
      cut.close();
    }
  });

  test('RESUMES from the incumbent: the restarting-core detector', () => {
    // 1. A full improve finds its plan.
    const first = trio();
    let settled: PlanScore;
    try {
      settled = makeSearchCore().improve(first.ctx());
    } finally {
      first.close();
    }

    // 2. With NO time at all and NO incumbent, the search can only price its
    //    naive seed (the generator's first candidates).
    const cold = trio();
    let coldPlan: JointPlan;
    try {
      coldPlan = makeSearchCore().improve(cold.ctx({ budget: expired() })).plan;
    } finally {
      cold.close();
    }

    // 3. With NO time at all but the settled incumbent, a RESUMING search
    //    returns the incumbent's plan; a restarting one would return the
    //    naive seed. The two differ on this board — that is the detector.
    expect(sameKeys(settled.plan, coldPlan)).toBe(false);
    const resumed = trio();
    try {
      const out = makeSearchCore().improve(
        resumed.ctx({ budget: expired(), incumbent: settled })
      );
      expect(sameKeys(out.plan, settled.plan)).toBe(true);
      expect(sameKeys(out.plan, coldPlan)).toBe(false);
    } finally {
      resumed.close();
    }
  });

  test('adopts the witnesses it is handed: the set only ever grows', () => {
    const t = trio();
    try {
      const enemyKing = t.sub.unitOfWireId('K')?.unitId as UnitId;
      const reply = t.sub.actionsOf(enemyKing)[0] as Candidate;
      const seeded: Witness = {
        replies: new Map([[enemyKing, reply]]),
        note: 'integration seed',
      };
      const out = makeSearchCore().improve(t.ctx({ witnesses: [seeded] }));
      expect(out.witnesses.map(witnessKey)).toContain(witnessKey(seeded));
    } finally {
      t.close();
    }
  });

  test('under fog, the ledger names the held units responsible', () => {
    // B0 only: with the default bank the B3 full product on this small board
    // legitimately DISCHARGES the fog (both enemies enumerated, nothing left
    // held), and a discharged ledger is rightly empty. Rung B0 keeps the
    // enemies held, which is the regime the naming requirement is about.
    const t = trio();
    try {
      const out = makeSearchCore({ bank: { b1: false, b2: false, b3: false } }).improve(t.ctx());
      const held = new Set(
        t.sub.unitIds().filter((id) => !t.sub.commandable(0).includes(id))
      );
      const named = out.bounds.ledger.map((e) => e.unitId).filter((id) => id >= 0);
      // On a contact board the bracket cannot be a point, and every entry
      // must name a HELD unit (or the evaluator residue, filtered above).
      expect(out.bounds.ledger.length).toBeGreaterThan(0);
      for (const id of named) expect(held.has(id)).toBe(true);
    } finally {
      t.close();
    }
  });

  test('lo ≤ est ≤ hi from the real evaluator on every plan tried', () => {
    const t = trio();
    try {
      for (const unitId of t.sub.commandable(0)) {
        for (const candidate of t.gen.candidatesFor(t.sub, unitId).candidates.slice(0, 6)) {
          const plan = new Map<UnitId, Candidate>();
          for (const other of t.sub.commandable(0)) {
            plan.set(
              other,
              other === unitId
                ? candidate
                : (t.gen.candidatesFor(t.sub, other).candidates[0] as Candidate)
            );
          }
          const bound = materialEvaluator.scorePlan(t.sub, plan, 0);
          expect(bound.lo).toBeLessThanOrEqual(bound.est + 1e-9);
          expect(bound.est).toBeLessThanOrEqual(bound.hi + 1e-9);
        }
      }
    } finally {
      t.close();
    }
  });
});

// ----------------------------------------------------- the bank's rungs

describe('withModelled on the real substrate lights the bank ladder (B2 open item 1)', () => {
  test('modelling is available, and the modelled floor is at least the held one', () => {
    const loose = trio();
    const tight = trio();
    try {
      const seed = new Map<UnitId, Candidate>();
      for (const unitId of loose.sub.commandable(0)) {
        seed.set(unitId, loose.gen.candidatesFor(loose.sub, unitId).candidates[0] as Candidate);
      }
      const priceWith = (t: Trio, cfg: Record<string, boolean>): BankResult => {
        const bank = new BoundBank({
          sub: t.sub,
          gen: t.gen,
          evaluate: materialEvaluator,
          asTeam: 0,
          budget: unbounded(),
          basis: [],
          config: cfg,
        });
        try {
          return bank.price(seed);
        } finally {
          bank.release();
        }
      };
      const b0 = priceWith(loose, { b1: false, b2: false, b3: false });
      const full = priceWith(tight, {});
      // The ladder is LIT: the real substrate models, so members beyond B0
      // exist and the floor can only rise while the ceiling can only fall.
      expect(b0.members.map((m) => m.rung)).toEqual(['B0']);
      expect(full.members.some((m) => m.rung !== 'B0')).toBe(true);
      expect(full.bounds.worst).toBeGreaterThanOrEqual(b0.bounds.worst);
      expect(full.bounds.best).toBeLessThanOrEqual(b0.bounds.best);
      // Both banks really settled something, on the same board.
      expect(loose.sub.settlements()).toBeGreaterThan(0);
      expect(tight.sub.settlements()).toBeGreaterThan(0);
    } finally {
      loose.close();
      tight.close();
    }
  });
});

// ------------------------------------------------------- the resolution memo

describe('the memo stays warm across search calls (B1 integration invariant)', () => {
  test('a warm session re-prices nothing: the second improve is far cheaper', () => {
    // The whole point of keeping the session: at 26 units one `price()` is
    // most of a slice, and the first one is always the seed the previous slice
    // already priced. There is no arena to leak any more, so the only thing
    // left to measure is the SETTLEMENT COUNT — which is what the budget is
    // denominated in and what a cold rebuild would double.
    const t = trio();
    try {
      const core = makeSearchCore();
      core.improve(t.ctx());
      const afterFirst = t.sub.settlements();
      const incumbent = core.improve(t.ctx());
      const afterSecond = t.sub.settlements();
      expect(incumbent.plan.size).toBeGreaterThan(0);
      // A cold rebuild would re-run every settlement the first call ran.
      expect(afterSecond - afterFirst).toBeLessThan(afterFirst / 2);
      core.release?.();
    } finally {
      t.close();
    }
  });

  test('release() closes the session and the substrate together', () => {
    const t = trio();
    const core = makeSearchCore();
    core.improve(t.ctx());
    core.release?.();
    t.close();
    // The substrate refuses further work rather than serving a stale cache.
    expect(() => t.sub.resolveBoundedFor(new Map(), 0)).toThrow(/after release/);
  });
});


// -------------------------------------------------------- kernel over the trio

const drain = async (stream: AsyncIterable<unknown>): Promise<number> => {
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _rec of stream) n++;
  return n;
};

describe('the kernel over the real trio (wall clock, structural assertions)', () => {
  test('stages a conforming set within a real budget, and the slabs come home', async () => {
    const t = trio();
    try {
      const kernel = new LobsterKernel({ minWriteIntervalMs: 0 });
      const rook = t.sub.unitOfWireId('r')?.unitId as UnitId;
      const target = t.gen.candidatesFor(t.sub, rook).candidates[1] as Candidate;
      const emitted = await drain(
        kernel.decide({
          sub: t.sub,
          gen: t.gen,
          evaluate: materialEvaluator,
          search: makeSearchCore(),
          asTeam: 0,
          deadlineMs: deadlineFromWallClock(Date.now() + 250),
          initialPins: [{ unitId: rook, to: target.to, tentative: false }],
        })
      );
      const report = kernel.lastReport;
      expect(emitted).toBeGreaterThan(0);
      expect(report?.stagedNothing).toBe(false);
      for (const rec of report?.journal ?? []) {
        expect(rec.plan.get(rook)?.to).toBe(target.to);
      }
      expect(report?.refusals['pin-unreachable']).toBe(0);
    } finally {
      t.close();
    }
  }, 20_000);

  test('an UNREACHABLE pin is refused on its own channel; the unit keeps its choice', async () => {
    const t = trio();
    try {
      const rook = t.sub.unitOfWireId('r')?.unitId as UnitId;
      // A cell no rook line reaches: one knight-step off its rank and file.
      const reachable = new Set(t.sub.actionsOf(rook).map((c) => c.to));
      const impossible = t.sub.unitIds().length + 999_999;
      expect(reachable.has(impossible)).toBe(false);
      expect(t.sub.pathOf(rook, impossible)).toBeNull();
      const kernel = new LobsterKernel({ minWriteIntervalMs: 0 });
      await drain(
        kernel.decide({
          sub: t.sub,
          gen: t.gen,
          evaluate: materialEvaluator,
          search: makeSearchCore(),
          asTeam: 0,
          deadlineMs: deadlineFromWallClock(Date.now() + 200),
          initialPins: [{ unitId: rook, to: impossible, tentative: false }],
        })
      );
      const report = kernel.lastReport;
      expect(report?.stagedNothing).toBe(false);
      expect(report?.refusals['pin-unreachable']).toBe(1);
      const last = report?.journal[report.journal.length - 1];
      // The unit kept a REAL choice of its own…
      expect(reachable.has(last?.plan.get(rook)?.to as number)).toBe(true);
      // …and the record says, in the assumption channel, why the pin is not
      // an operator-pin claim it would be contradicting.
      expect(
        last?.assumptions.some(
          (a: Assumption) => a.kind === 'narrowing' && a.unitId === rook && /unreachable/.test(a.note)
        )
      ).toBe(true);
      expect(
        last?.assumptions.some((a: Assumption) => a.kind === 'operator-pin' && a.unitId === rook)
      ).toBe(false);
    } finally {
      t.close();
    }
  }, 20_000);

  test('contains a BoundsInversionError: refused, counted, decision alive', async () => {
    const t = trio();
    try {
      const real = makeSearchCore();
      let calls = 0;
      const trapped: SearchCore = {
        improve: (ctx) => {
          calls++;
          if (calls === 2) {
            throw new BoundsInversionError(5, -5, 'integration: deliberately unsound member');
          }
          return real.improve(ctx);
        },
        conform: (ctx, incumbent) => real.conform(ctx, incumbent),
      };
      const kernel = new LobsterKernel({ minWriteIntervalMs: 0 });
      await drain(
        kernel.decide({
          sub: t.sub,
          gen: t.gen,
          evaluate: materialEvaluator,
          search: trapped,
          asTeam: 0,
          deadlineMs: deadlineFromWallClock(Date.now() + 250),
          initialPins: [],
        })
      );
      const report = kernel.lastReport;
      expect(calls).toBeGreaterThanOrEqual(3); // the decision SURVIVED the throw
      expect(report?.refusals['bounds-inversion']).toBe(1);
      expect(report?.boundViolations).toBeGreaterThanOrEqual(1);
      expect(report?.stagedNothing).toBe(false);
    } finally {
      t.close();
    }
  }, 20_000);
});

// ---------------------------------------------- deterministic kernel seams

// Scripted, fake-clock arm for the seams that need exact call-order
// assertions rather than wall-clock structure.
import { FakeClock, ScriptedSearchCore, collect, plan, witness } from './lobster-harness';
import type { ScriptStep } from './lobster-harness';
import { StubGenerator, StubSubstrate, StubEvaluator } from './lobster-harness';

const step = (s: Omit<ScriptStep, 'costMs'> & { costMs?: number }): ScriptStep => ({
  costMs: 1,
  ...s,
});

describe('the kernel threads witnesses back into the context (B2 open item 7)', () => {
  test('a witness returned by improve N is in the context of improve N+1', async () => {
    const clock = new FakeClock();
    const w1 = witness('found at call 1', [[9, 3]]);
    const w2 = witness('found at call 2', [[9, 4]]);
    const core = new ScriptedSearchCore(clock, [
      step({ plan: plan([1, 4]), worst: 10, best: 90, costMs: 1, witnesses: [w1] }),
      step({ plan: plan([1, 4]), worst: 20, best: 80, costMs: 1, witnesses: [w1, w2] }),
      step({ plan: plan([1, 4]), worst: 30, best: 70, costMs: 1, witnesses: [w1, w2] }),
    ]);
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0 });
    await collect(
      kernel.decide({
        sub: new StubSubstrate(),
        gen: new StubGenerator(),
        evaluate: new StubEvaluator(() => ({ lo: 0, est: 0, hi: 0 })),
        search: core,
        asTeam: 0,
        deadlineMs: clock.now() + 10,
        initialPins: [],
        now: clock.now,
        initialStepCostMs: 1,
      })
    );
    expect(core.improveLog.length).toBeGreaterThanOrEqual(3);
    // Call 1 starts with nothing; every later call carries the accumulated set.
    expect(core.improveLog[0]?.witnesses).toBe(0);
    expect(core.improveLog[1]?.witnesses).toBe(1);
    expect(core.improveLog[2]?.witnesses).toBe(2);
  });
});

describe('pin-context cache tier 2 is DEFERRED: absent transfer repeats work, never transfers', () => {
  test('a new pin context is a cold miss with no incumbent — never a resumed one', async () => {
    // The deferral's safety statement, as a test: with only tier 3 present, a
    // context the kernel has never priced starts from NOTHING (a miss and a
    // create; incumbent null until its own first slice) even when every
    // footprint involved is disjoint and a tier-2 transfer WOULD have been
    // legal. Work repeated, never a wrong answer.
    const clock = new FakeClock();
    const core = new ScriptedSearchCore(clock, [
      step({ plan: plan([1, 4]), worst: 10, best: 90, costMs: 1 }),
      step({ plan: plan([1, 4]), worst: 20, best: 80, costMs: 1 }),
    ]);
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0 });
    let pinned = false;
    await collect(
      kernel.decide({
        sub: new StubSubstrate(),
        gen: new StubGenerator(),
        evaluate: new StubEvaluator(() => ({ lo: 0, est: 0, hi: 0 })),
        search: core,
        asTeam: 0,
        deadlineMs: clock.now() + 10,
        initialPins: [],
        now: clock.now,
        initialStepCostMs: 1,
      }),
      () => {
        if (!pinned) {
          pinned = true;
          kernel.onPinEvent({ kind: 'pin', pin: { unitId: 2, to: 77, tentative: false } });
        }
      }
    );
    const report = kernel.lastReport;
    const fresh = report?.contexts.find((c) => c.key === 'pin:[2@77]');
    expect(fresh).toBeDefined();
    expect(report?.cache.misses).toBeGreaterThanOrEqual(2); // base + the new context
    // The new context resumed nothing it had not earned: its first conform saw
    // a null incumbent (the resume flag on retarget() was false).
    const resumes = report?.conformance.filter((c) => c.resumedFromCache) ?? [];
    expect(resumes).toHaveLength(0);
  });
});

// ------------------------------- the PRODUCTION pairing under the bound laws

describe('EngineSubstrate + BoundEvaluator bracket the exhaustive truth', () => {
  /**
   * The 120-configuration bank harness proves the bounds layer sound against
   * `testkit.makeSubstrate` + `testkit.makeEvaluator`, and the trio suite
   * checks the production pairing only for the ORDERING invariant lo ≤ est ≤
   * hi. Neither puts the pairing production actually runs — the real
   * EngineSubstrate under the real BoundEvaluator — under `floor ≤ SV ≤
   * ceiling`. This does, exhaustively, on a board small enough to enumerate.
   *
   * Ground truth is the security value by definition: the MINIMUM over every
   * complete enemy reply of the value of a world in which every unit is named,
   * so nothing is held and the evaluator's bracket collapses.
   */
  const SMALL = (): Board =>
    boardOf([
      piece('u1', { x: 2, y: 3 }, 'king', 1, { teamID: 'red' }),
      piece('u2', { x: 2, y: 5 }, 'king', 1, { teamID: 'red' }),
      piece('E', { x: 4, y: 4 }, 'king', 1, { teamID: 'blue' }),
    ]);

  test('floor ≤ exhaustive security value ≤ ceiling, on every staged set', () => {
    const board = SMALL();
    // The ORACLE substrate: everything modelled, so a fully-named plan is a
    // determinate world and the evaluator's interval collapses onto it.
    const oracle = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      modeled: board.snakes.map((s) => s.id),
    });
    // The PRODUCTION substrate: only our team modelled, the enemy held — the
    // configuration a real decision runs in.
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator();
    const bank = new BoundBank({
      sub,
      gen,
      evaluate: materialEvaluator,
      asTeam: 0,
      budget: unbounded(),
      basis: [],
    });
    try {
      const ours = sub.commandable(0);
      expect(ours).toHaveLength(2);
      const enemy = oracle.unitOfWireId('E')?.unitId as UnitId;
      const replies = oracle.actionsOf(enemy);
      expect(replies.length).toBeGreaterThan(1);

      const optionsPerUnit = ours.map((unitId) =>
        gen.candidatesFor(sub, unitId).candidates.slice(0, 3)
      );
      let checked = 0;
      let exactWorlds = 0;
      for (const a of optionsPerUnit[0] as ReadonlyArray<Candidate>) {
        for (const b of optionsPerUnit[1] as ReadonlyArray<Candidate>) {
          const staged: JointPlan = new Map([
            [a.unitId, a],
            [b.unitId, b],
          ]);

          // SV(staged) = min over the enemy's COMPLETE reply set.
          let sv = Number.POSITIVE_INFINITY;
          for (const reply of replies) {
            const world = new Map(staged);
            world.set(enemy, reply);
            const bound = materialEvaluator.scorePlan(oracle, world, 0);
            // Nothing is held, so the world is determinate: the bracket has
            // collapsed and there is a single value to minimise over.
            expect(bound.lo).toBe(bound.hi);
            exactWorlds++;
            if (bound.lo < sv) sv = bound.lo;
          }

          const priced = bank.price(staged);
          expect(priced.bounds.worst).toBeLessThanOrEqual(sv);
          expect(sv).toBeLessThanOrEqual(priced.bounds.best);
          checked++;
        }
      }
      expect(checked).toBe(9);
      expect(exactWorlds).toBe(checked * replies.length);
    } finally {
      bank.release();
      sub.release();
      oracle.release();
    }
  }, 60_000);
});

// ------------------------------- per-kind max ENERGY, threaded (V4 S1 retired)

describe('a board that configures per-kind ceilings is settled against them', () => {
  const withCeilings = (pawnMax: number): Board => {
    const board = boardOf([
      piece('p', { x: 1, y: 3 }, 'pawn', 1, { teamID: 'red' }),
      piece('K', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
    ]);
    (board as { maxHealthPerUnit?: Record<string, number> }).maxHealthPerUnit = {
      pawn: pawnMax,
      king: 100,
    };
    return board;
  };

  test('the substrate is handed the table, not its maximum', () => {
    // It used to be flattened to the maximum of the configured values, which
    // kept ceilings sound and LOST FLOORS: our own low-maximum units were
    // credited with a refuel budget, and so a reach, they do not have.
    const sub = makeSubstrate({ board: withCeilings(30), turn: TURN, asTeam: 'red' });
    try {
      expect(sub.maxEnergyOf('pawn')).toBe(30);
      expect(sub.maxEnergyOf('king')).toBe(100);
      expect(sub.maxEnergyOf('queen')).toBe(sub.defaultMaxEnergy);
    } finally {
      sub.release();
    }
  });

  test('a flat board reads flat — nothing changes where nothing was configured', () => {
    const sub = makeSubstrate({
      board: boardOf([
        piece('p', { x: 1, y: 3 }, 'pawn', 1, { teamID: 'red' }),
        piece('K', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
      ]),
      turn: TURN,
      asTeam: 'red',
    });
    try {
      expect(sub.maxEnergyOf('pawn')).toBe(100);
      expect(sub.defaultMaxEnergy).toBe(100);
    } finally {
      sub.release();
    }
  });
});


// ------------------------------------------- rung 0 survives an unsound bank

describe('a bank that proves itself unsound at rung 0 does not take the turn down', () => {
  test('V2-BUG-2: the seed is staged anyway, and the refusal is counted', async () => {
    // The integrator's ruling was that rung 0 should be deliberately unguarded
    // — "a broken bank at rung 0 must be loud". The evidence reversed it: a
    // BoundsInversionError escaping conform() aborted the whole team decision
    // and left every alive unit unstaged, on 5 of 300 measured decisions,
    // against a contract gate that requires zero. The plan's legality does not
    // come from the price: the candidate layer's ordered-first option for
    // every unit is legal by construction. So the seed goes on the wire and
    // the loud signal is the counter.
    const t = trio();
    const inverted = {
      scorePlan: () => ({ lo: 10, est: 0, hi: -10 }),
      evaluatePlan: () => ({
        bound: { lo: 10, est: 0, hi: -10 },
        parts: {},
        exact: false,
        basis: [],
        ledgerSize: 0,
      }),
    };
    try {
      const core = makeSearchCore();
      // The bank refuses to build bounds it can prove unsound…
      const plan = core.conform(t.ctx({ evaluate: inverted as never }), new Map());
      // …and conform still returns a complete legal plan for every unit.
      expect([...plan.keys()].sort((a, b) => a - b)).toEqual(
        [...t.sub.commandable(0)].sort((a, b) => a - b)
      );
      // The refusal is on the record, not swallowed.
      expect(core.drainRefusals?.().boundsInversions).toBeGreaterThan(0);

      // End to end: the kernel counts it and still stages.
      const kernel = new LobsterKernel({ minWriteIntervalMs: 0, sliceMs: 5, reserveMs: 1 });
      const out = await drain(
        kernel.decide({
          sub: t.sub,
          gen: t.gen,
          evaluate: inverted as never,
          search: makeSearchCore(),
          asTeam: 0,
          deadlineMs: deadlineFromWallClock(Date.now() + 120),
          initialPins: [],
        })
      );
      const report = kernel.lastReport as NonNullable<typeof kernel.lastReport>;
      expect(out).toBeGreaterThan(0);
      expect(report.stagedNothing).toBe(false);
      expect(report.refusals['bounds-inversion']).toBeGreaterThan(0);
      expect(report.boundViolations).toBeGreaterThan(0);
    } finally {
      t.close();
    }
  }, 30_000);
});
