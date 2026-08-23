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
import { BoundsInversionError, DEAD as BOUNDS_DEAD, witnessKey } from '../lobster/bounds';
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

  test('conform is cheap: far fewer resolutions than improve on the same position', () => {
    const a = trio();
    let conformCost = 0;
    try {
      makeSearchCore().conform(a.ctx(), new Map());
      conformCost = a.sub.resolutions();
    } finally {
      a.close();
    }
    const b = trio();
    let improveCost = 0;
    try {
      makeSearchCore().improve(b.ctx());
      improveCost = b.sub.resolutions();
    } finally {
      b.close();
    }
    expect(conformCost).toBeGreaterThan(0);
    expect(improveCost).toBeGreaterThan(conformCost);
    expect(conformCost).toBeLessThanOrEqual(improveCost / 3);
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
    const t = trio();
    try {
      const out = makeSearchCore().improve(t.ctx());
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

// ------------------------------------------------------------ slab discipline

describe('slab discipline across the search (B1 integration invariant)', () => {
  test('outstanding() === 1 between decisions, 0 after release', () => {
    const t = trio();
    try {
      expect(t.sub.outstanding()).toBe(1);
      const core = makeSearchCore();
      core.improve(t.ctx());
      expect(t.sub.outstanding()).toBe(1);
      core.conform(t.ctx(), new Map());
      expect(t.sub.outstanding()).toBe(1);
      core.improve(t.ctx());
      expect(t.sub.outstanding()).toBe(1);
    } finally {
      t.close();
    }
    // After release the base state itself is returned.
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
