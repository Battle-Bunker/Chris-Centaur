/**
 * INTEGRATION: the real trio — EngineSubstrate + GrammarCandidateGenerator +
 * BoundEvaluator under makeSearchCore and LobsterKernel, on real boards.
 *
 * Every builder shipped against stubs of its neighbours; these tests pin the
 * guarantees each stub ASSUMED, against the real implementations:
 *
 *  - the sentinels agree across modules (NO_ORDER, DEAD);
 *  - conform(∅) is rung 0: a complete legal joint plan, cheaply;
 *  - improve honours pins, honours the clock, and RESUMES from the incumbent
 *    and witness set rather than restarting (B3's stubs could not catch a
 *    restarting core — this suite can);
 *  - the ledger under fog names the responsible held units;
 *  - lo ≤ est ≤ hi from the real evaluator, on every plan tried;
 *  - the slab discipline holds: outstanding() === 1 between search calls and
 *    0 after release — a leak here presents as "the engine is slow";
 *  - the kernel threads witnesses back into the context, contains a bounds
 *    inversion, and refuses an unreachable pin on a named channel.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import { DEAD as ENGINE_DEAD, NO_ORDER } from '../partial-engine/index';
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
  test('NO_ORDER_MOVE is the engine NO_ORDER', () => {
    expect(NO_ORDER_MOVE).toBe(NO_ORDER);
  });

  test('DEAD agrees across engine, evaluate, bounds, and the posture default', () => {
    expect(EVALUATE_DEAD).toBe(ENGINE_DEAD);
    expect(BOUNDS_DEAD).toBe(ENGINE_DEAD);
    expect(DEFAULT_DEAD_BELOW).toBe(EVALUATE_DEAD);
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
      conformCost = a.sub.resolutions();
    } finally {
      a.close();
    }
    const b = trio(ROSTER(12));
    let improveCost = 0;
    try {
      makeSearchCore().improve(b.ctx());
      improveCost = b.sub.resolutions();
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
        return t.sub.resolutions();
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
      openCost = open.sub.resolutions();
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
      expect(cut.sub.resolutions()).toBeLessThan(openCost);
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
      // Slabs come home from both banks.
      expect(loose.sub.outstanding()).toBe(1);
      expect(tight.sub.outstanding()).toBe(1);
    } finally {
      loose.close();
      tight.close();
    }
  });
});

// ------------------------------------------------------------ slab discipline

describe('slab discipline across the search (B1 integration invariant)', () => {
  test('the memo holds slabs BETWEEN calls, and release() hands every one back', () => {
    // THE INVARIANT MOVED, DELIBERATELY. It used to be `outstanding() === 1
    // between search calls`, which held because every `improve` built a bank
    // and dropped it — and dropping it is what made the anytime loop idle at
    // production team sizes: each slice re-generated the grammar, started from
    // a cold memo, and spent its first `price()` on the seed the previous
    // slice had already priced. The core keeps its session alive between calls
    // now, so between calls the count is `1 + what the memo caches`, bounded
    // by the memo's capacity; `release()` is where it comes back to 1, and the
    // substrate's own `release()` takes the base state with it.
    const t = trio();
    const CAP = 256;
    try {
      expect(t.sub.outstanding()).toBe(1);
      const core = makeSearchCore({ bank: { memoCapacity: CAP } });
      core.improve(t.ctx());
      const held = t.sub.outstanding();
      expect(held).toBeGreaterThan(1); // the memo really is warm
      expect(held).toBeLessThanOrEqual(1 + CAP);
      core.conform(t.ctx(), new Map());
      expect(t.sub.outstanding()).toBeLessThanOrEqual(1 + CAP);
      core.improve(t.ctx());
      expect(t.sub.outstanding()).toBeLessThanOrEqual(1 + CAP);
      // Closing the session returns every cached slab, and only those.
      core.release?.();
      expect(t.sub.outstanding()).toBe(1);
    } finally {
      t.close();
    }
    // After release the base state itself is returned.
  });

  test('a warm session re-prices nothing: the second improve is far cheaper', () => {
    // The whole point of keeping the session: at 26 units one `price()` is
    // most of a slice, and the first price of every slice used to be the seed
    // the previous slice had just priced.
    const t = trio(ROSTER(6));
    try {
      const core = makeSearchCore();
      core.improve(t.ctx());
      const afterFirst = t.sub.resolutions();
      const incumbent = core.improve(t.ctx());
      const afterSecond = t.sub.resolutions();
      expect(incumbent.plan.size).toBeGreaterThan(0);
      // A cold rebuild would re-run every resolution the first call ran.
      expect(afterSecond - afterFirst).toBeLessThan(afterFirst / 2);
      core.release?.();
    } finally {
      t.close();
    }
  });

  test('release() returns the base state too', () => {
    const t = trio();
    t.close();
    expect(t.sub.outstanding()).toBe(0);
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
      expect(t.sub.outstanding()).toBe(1);
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

// ------------------------------------------- the reach-profile gate (V4 S1)

describe('S1 TRIPWIRE: per-kind maxHealth is flattened, so reach may not lead', () => {
  /**
   * NOT A FIX — a gate, deliberately loud.
   *
   * `EngineSubstrate` collapses a board's per-kind `maxHealthPerUnit` map to
   * ONE ceiling, the maximum, because the engine carries one. Inflating an
   * ENEMY's ceiling grows its cloud, which is safe. Inflating OUR OWN inflates
   * our earliest-arrival flood — and `reachFeature`'s LO reading counts our
   * located units' territory, so a bigger-than-true territory inside `lo` puts
   * the published floor above the truth. Unsound, in the one direction
   * everything here exists to forbid.
   *
   * It is invisible to the soundness harness by construction: `checkSoundness`
   * brackets the partial evaluation against completion worlds computed by the
   * SAME engine under the SAME flattened premise, and a premise error common
   * to both sides cannot show up as a violation.
   *
   * It costs nothing today because the production evaluator reads reach at
   * horizon 0. This test fails the moment that stops being true while the
   * flattening is still here.
   */
  test('the production evaluator does not read reach while the flatten stands', () => {
    const board = boardOf([
      piece('p', { x: 2, y: 2 }, 'pawn', 1, { teamID: 'red' }),
      piece('K', { x: 5, y: 5 }, 'king', 1, { teamID: 'blue' }),
    ]);
    // A real server-configured per-kind map (firebase/translate.ts writes it).
    (board as { maxHealthPerUnit?: Record<string, number> }).maxHealthPerUnit = { pawn: 30 };
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const engineCeiling = sub.engine.config.maxHealth;
      const configured = Object.values({ pawn: 30 });
      const diverges = configured.some((v) => v !== engineCeiling);
      // Today: the pawn's real ceiling is 30, the engine carries 100.
      expect(diverges).toBe(true);

      // THE GATE. While the premise is flattened, the profile the team engine
      // ships with may not read reach at all. Adopting the calibrated
      // reach/king profile means removing the flatten FIRST (an upstream
      // engine amendment: per-kind maxHealth), not afterwards.
      expect(materialEvaluator.profile.reachHorizonTurns).toBe(0);
      expect(materialEvaluator.profile.weights.reach).toBe(0);
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
