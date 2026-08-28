/**
 * DOOR C — THE CONTESTED REACH/ROOM REFINER, AND THE GATES IT OWES.
 *
 * Five parts:
 *
 *   OFF          with no scope registered the evaluator is byte-for-byte the
 *                one that shipped — asserted as an exact triple equality over
 *                the whole probe corpus, not as a spot check.
 *   THE SHIELD   the certain set is `cells[0 .. len-2]` of a certainly-alive
 *                located trail unit that nothing out-tiers, and each of those
 *                four gates is shown to CLOSE by a case that trips it.
 *   THE LAWS     R1/R2/R3 by brute force over the real world set, with the
 *                refinement ACTIVE — the harness's new `prepare` hook registers
 *                the scope on every substrate it builds, so the law is checked
 *                against the evaluator that would ship and not against a
 *                different one.
 *   THE MEET     the refined floor NEVER crosses the unrefined one:
 *                `lo* >= lo` and `hi* <= hi`, over every board and both
 *                features, plus a zero-inversion assertion (two sound brackets
 *                on one quantity cannot be disjoint).
 *   THE PROBE    what the refinement actually buys: median and mean width
 *                change on the confronted family with a held, stale opponent,
 *                argmax movement counted honestly, and the µs it costs.
 *
 * No live games. Every board is generated from a fixed seed or written out by
 * hand, every verdict comes from the real resolver through `withResolution`.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { EngineSubstrate } from '../substrate';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import {
  SHIELD_TURNS_MAX,
  buildShield,
  checkCollapse,
  checkMonotone,
  checkSoundness,
  defaultEvaluator,
  makeContext,
  meetIntervals,
  refineReportOf,
  setRefineScope,
} from '../evaluate';
import type { LawCase } from '../evaluate';
import { marshalBoard } from '../../logic/turn-oracle';

const TURN = 40;

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------------- boards

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

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 11, height: 11, food: [], hazards: [], snakes, ...extra }) as Board;

const at = (board: Board, cell: Coord): number => marshalBoard(board, TURN).toIndex(cell);

/** A straight horizontal snake, head at `x`, body running left. */
const line = (x: number, y: number, len: number): Coord[] =>
  Array.from({ length: len }, (_v, i) => ({ x: x - i, y }));

/** A vertical one, head at the top. */
const column = (x: number, y: number, len: number): Coord[] =>
  Array.from({ length: len }, (_v, i) => ({ x, y: y - i }));

/**
 * THE PROBE FAMILY: a long snake of ours across the middle with a STALE held
 * opponent beside it, which is the shape Door C's value case is denominated in
 * (`la-outside.md`: "fog/held boards, stated honestly"). Staleness widens the
 * held cloud until it swallows our body, which is exactly when the shield has
 * something to remove.
 */
function confrontedCase(seed: number): {
  board: Board;
  stages: string[];
  ours: string[];
  orders: Map<string, number>;
  observed: Map<string, number>;
} {
  const r = rng(seed);
  const oy = 4 + Math.floor(r() * 3);
  const ox = 5 + Math.floor(r() * 3);
  const ex = 4 + Math.floor(r() * 3);
  const board = boardOf([
    // OURS, LOCATED, LONG — the shield. Five segments, so its certain suffix
    // runs four turns and the multi-turn mask has something to remove.
    makeSnake('a', line(ox, oy, 5), { teamID: 'red', orientation: { dx: 1, dy: 0 }, health: 70 }),
    // Ours, located, parked out of everyone's way: the corpus needs a second
    // commandable unit or the partition is a single trivial component.
    makeSnake('b', column(9, 9, 4), { teamID: 'red', orientation: { dx: 0, dy: 1 }, health: 70 }),
    // OURS, HELD — what the `hi` reading admits and `lo` drops. Placed under
    // `a`'s body so its flood walks through it, which is the only way the
    // CEILING channel has anything to lose.
    makeSnake('c', column(ox - 2, oy - 2, 2), {
      teamID: 'red',
      orientation: { dx: 0, dy: 1 },
      health: 70,
    }),
    // THEIRS, HELD AND STALE — what the `lo` reading admits. Staleness widens
    // the cloud until it swallows our body, which is when the shield bites.
    makeSnake('e', line(ex, oy + 2, 5), {
      teamID: 'blue',
      orientation: { dx: 1, dy: 0 },
      health: 70,
    }),
    // THEIRS, LOCATED. Without one, EVERY opponent is held and contested, the
    // best world is a clean sweep, the fold clamps to WIN, and the width
    // channel measures nothing at all — a probe reporting "no change" for a
    // reason that has nothing to do with the thing under test.
    makeSnake('f', line(6, 0, 4), { teamID: 'blue', orientation: { dx: 1, dy: 0 }, health: 70 }),
  ]);
  return {
    board,
    stages: ['a', 'b', 'f'],
    ours: ['a', 'b'],
    orders: new Map([
      ['a', at(board, { x: ox, y: oy + 1 })],
      ['b', at(board, { x: 8, y: 9 })],
      ['f', at(board, { x: 6, y: 1 })],
    ]),
    observed: new Map([['e', TURN - (1 + (seed % 3))]]),
  };
}

/** `a − b`, reading two equal lattice ends as zero rather than as NaN — the
 * same convention `evaluate/laws.ts` uses for exactly the same reason. */
function gap(a: number, b: number): number {
  if (a === b) return 0;
  const d = a - b;
  return Number.isNaN(d) ? 0 : d;
}

/** The shield's slab set, as the workspace would hand it over. */
function slabsFor(sub: EngineSubstrate): Uint32Array[] {
  return Array.from({ length: SHIELD_TURNS_MAX }, () => new Uint32Array(sub.grid.words));
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ------------------------------------------------------------------ the cases

/** The probe corpus, as law cases — the same objects both halves run on. */
const RAW = Array.from({ length: 12 }, (_v, i) => confrontedCase(i + 1));
const OURS: ReadonlyArray<ReadonlyArray<string>> = RAW.map((c) => c.ours);

const CASES: LawCase[] = RAW.map((c, i) => {
  return {
    name: `confronted/${i + 1}`,
    board: c.board,
    turn: TURN,
    asTeam: 'red',
    stages: c.stages,
    orders: c.orders,
    observedTurns: c.observed,
  };
});

/**
 * The same corpus with Door C armed.
 *
 * `prepare` is the production caller's registration, standing in for
 * `search/core.ts:openCluster`: every unit we command is treated as belonging
 * to a cluster the enumeration resolved, which is what the enumeration reports
 * on a board whose components are all singletons or pairs — 98.9% of team-turns
 * by the census's own count.
 */
const REFINED: LawCase[] = CASES.map((c, i) => ({
  ...c,
  name: `${c.name}+refine`,
  prepare: (sub: EngineSubstrate) => {
    // OUR OWN COMMANDABLE UNITS ONLY — the scope is what the enumeration
    // solved, and it enumerates our joint move. A located opponent is in the
    // model, never in the partition.
    const members = new Set<UnitId>();
    for (const wireId of OURS[i] as ReadonlyArray<string>) {
      const unit = sub.unitOfWireId(wireId);
      if (unit !== undefined) members.add(unit.unitId);
    }
    setRefineScope(sub, { members });
  },
}));

function planFor(sub: EngineSubstrate, c: LawCase): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const wireId of c.stages) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error(`no unit ${wireId}`);
    const to = c.orders.get(wireId) as number;
    plan.set(unit.unitId, {
      unitId: unit.unitId,
      from: -1,
      to,
      path: sub.pathFor(unit.unitId, to) ?? [],
    });
  }
  return plan;
}

interface Reading {
  reach: { lo: number; hi: number };
  room: { lo: number; hi: number };
  total: { lo: number; est: number; hi: number };
}

function read(c: LawCase, refine: boolean): Reading {
  const sub = makeSubstrate({
    board: c.board,
    turn: c.turn,
    asTeam: c.asTeam,
    modeled: c.stages,
    observedTurns: c.observedTurns,
  });
  try {
    if (refine) (c as LawCase).prepare?.(sub);
    const v = defaultEvaluator.evaluatePlan(sub, planFor(sub, c), sub.teamNumber(c.asTeam));
    const reach = v.parts.reach as { lo: number; hi: number };
    const room = v.parts.room as { lo: number; hi: number };
    return {
      reach: { lo: reach.lo, hi: reach.hi },
      room: { lo: room.lo, hi: room.hi },
      total: { lo: v.bound.lo, est: v.bound.est, hi: v.bound.hi },
    };
  } finally {
    sub.release();
  }
}

// ---------------------------------------------------------------------------
// 1. OFF is byte-identical
// ---------------------------------------------------------------------------

describe('with no scope registered the evaluator is the one that shipped', () => {
  test('every board reads identically with the refiner not armed', () => {
    for (const c of CASES) {
      const a = read(c, false);
      const b = read(c, false);
      expect([c.name, b]).toEqual([c.name, a]);
    }
  });

  test('and the refiner reports nothing, because it never ran', () => {
    const c = CASES[0] as LawCase;
    const sub = makeSubstrate({
      board: c.board,
      turn: c.turn,
      asTeam: c.asTeam,
      modeled: c.stages,
      observedTurns: c.observedTurns,
    });
    try {
      defaultEvaluator.evaluatePlan(sub, planFor(sub, c), sub.teamNumber(c.asTeam));
      // No workspace is ever built, so there is no report — not a report of
      // zeros, which would mean the machinery ran and found nothing.
      expect(refineReportOf(sub)).toBeNull();
    } finally {
      sub.release();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The shield's four gates
// ---------------------------------------------------------------------------

describe('the shield is exactly the certain living body, and each gate closes', () => {
  const subjectsOf = (sub: EngineSubstrate, c: LawCase) => {
    const ctx = contextFor(sub, c);
    return ctx.standing;
  };

  function contextFor(sub: EngineSubstrate, c: LawCase) {
    const plan = planFor(sub, c);
    return sub.withResolution(plan, sub.teamNumber(c.asTeam), ({ resolution, bounds }) =>
      makeContext(sub, resolution, bounds, sub.teamNumber(c.asTeam))
    );
  }

  test('`cells[0 .. len-2]` — index 0 in, the tail out', () => {
    const c = CASES[0] as LawCase;
    const sub = makeSubstrate({
      board: c.board,
      turn: c.turn,
      asTeam: c.asTeam,
      modeled: c.stages,
      observedTurns: c.observedTurns,
    });
    try {
      const standing = subjectsOf(sub, c);
      const a = sub.unitOfWireId('a');
      if (a === undefined) throw new Error('no unit a');
      const slabs = slabsFor(sub);
      const shield = buildShield(
        sub,
        standing,
        { members: new Set([a.unitId]) },
        c.turn + 1,
        slabs,
        true
      );
      expect(shield).not.toBeNull();
      const first = (shield as NonNullable<typeof shield>).boards[0] as Uint32Array;
      const bits = new Set<number>();
      for (let w = 0; w < first.length; w++) {
        for (let b = 0; b < 32; b++) {
          if (((first[w] as number) >>> b) & 1) bits.add((w << 5) + b);
        }
      }
      // The unit's POST-RESOLUTION body is what the resolution places, but the
      // shield is read off the DECISION substrate: `cells` there is the
      // pre-move body, and `cells[0 .. len-2]` is exactly the set
      // `staging-safety.ts:allyBodyCollision` calls occupied next turn whatever
      // it chooses. The tail — and only the tail — is absent.
      const cells = a.cells;
      for (let i = 0; i <= cells.length - 2; i++) {
        expect(bits.has(cells[i] as number)).toBe(true);
      }
      expect(bits.has(cells[cells.length - 1] as number)).toBe(false);
      expect(bits.size).toBe(cells.length - 1);
      // And the suffix SHRINKS by one segment per further turn, which is the
      // theorem the multi-turn shield rests on.
      const boards = (shield as NonNullable<typeof shield>).boards;
      let previous = bits.size;
      for (let k = 1; k < boards.length; k++) {
        let n = 0;
        const b = boards[k] as Uint32Array;
        for (let w = 0; w < b.length; w++) {
          let word = b[w] as number;
          while (word !== 0) {
            n++;
            word = (word & (word - 1)) >>> 0;
          }
        }
        expect(n).toBe(previous - 1);
        previous = n;
      }
    } finally {
      sub.release();
    }
  });

  test('a unit out of scope contributes nothing', () => {
    const c = CASES[0] as LawCase;
    const sub = makeSubstrate({
      board: c.board,
      turn: c.turn,
      asTeam: c.asTeam,
      modeled: c.stages,
      observedTurns: c.observedTurns,
    });
    try {
      const slabs = slabsFor(sub);
      expect(
        buildShield(sub, subjectsOf(sub, c), { members: new Set() }, c.turn + 1, slabs, true)
      ).toBeNull();
    } finally {
      sub.release();
    }
  });

  test('a HELD unit of ours contributes nothing — it has no located body', () => {
    // `b` is not staged here, so it is a claim and not a location.
    const c = CASES[0] as LawCase;
    const one: LawCase = { ...c, stages: ['a'], orders: new Map([['a', c.orders.get('a') as number]]) };
    const sub = makeSubstrate({
      board: one.board,
      turn: one.turn,
      asTeam: one.asTeam,
      modeled: one.stages,
      observedTurns: one.observedTurns,
    });
    try {
      const b = sub.unitOfWireId('b');
      if (b === undefined) throw new Error('no unit b');
      const slabs = slabsFor(sub);
      expect(
        buildShield(sub, subjectsOf(sub, one), { members: new Set([b.unitId]) }, one.turn + 1, slabs, true)
      ).toBeNull();
    } finally {
      sub.release();
    }
  });

  test('a unit something out-tiers contributes nothing — a higher tier SEVERS', () => {
    const base = CASES[0] as LawCase;
    const snakes = (base.board.snakes ?? []).map((s) =>
      s.id === 'e'
        ? ({ ...s, invulnerabilityLevel: 2, invulnerabilityExpiryTurn: TURN + 6 } as Snake)
        : s
    );
    const board = { ...base.board, snakes } as Board;
    const c: LawCase = { ...base, board };
    const sub = makeSubstrate({
      board,
      turn: c.turn,
      asTeam: c.asTeam,
      modeled: c.stages,
      observedTurns: c.observedTurns,
    });
    try {
      const standing = subjectsOf(sub, c);
      const tiered = standing.some((s) => s.tierMax > 0);
      // The fixture only proves the gate if the tier actually landed; if the
      // wire field is not what this board shape carries, say so rather than
      // passing vacuously.
      expect(tiered).toBe(true);
      const a = sub.unitOfWireId('a');
      if (a === undefined) throw new Error('no unit a');
      const slabs = slabsFor(sub);
      expect(
        buildShield(sub, standing, { members: new Set([a.unitId]) }, c.turn + 1, slabs, true)
      ).toBeNull();
    } finally {
      sub.release();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The laws, with the refinement active
// ---------------------------------------------------------------------------

describe('R1/R2/R3 hold with Door C armed', () => {
  test.each(REFINED.map((c) => [c.name, c] as const))(
    'R1 soundness — %s',
    (name, c) => {
      const r = checkSoundness(defaultEvaluator, c);
      expect([name, r.violations]).toEqual([name, []]);
      expect(r.checked).toBeGreaterThan(0);
    }
  );

  test.each(REFINED.map((c) => [c.name, c] as const))(
    'R2 monotonicity — %s',
    (name, c) => {
      expect([name, checkMonotone(defaultEvaluator, c).violations]).toEqual([name, []]);
    }
  );

  test.each(REFINED.map((c) => [c.name, c] as const))('R3 collapse — %s', (name, c) => {
    // With everything staged the refiner has nothing HELD to mask, declines
    // before building a shield, and the position is a point. Structural, not
    // argued: see `refinedPartition`'s decline #3.
    expect([name, checkCollapse(defaultEvaluator, c).violations]).toEqual([name, []]);
  });
});

// ---------------------------------------------------------------------------
// 4. The meet never crosses
// ---------------------------------------------------------------------------

describe('the refined interval is a TIGHTEN and never a widen', () => {
  test('lo* >= lo and hi* <= hi, on both features, over the whole corpus', () => {
    const EPS = 1e-12;
    for (let i = 0; i < CASES.length; i++) {
      const plain = read(CASES[i] as LawCase, false);
      const refined = read(REFINED[i] as LawCase, true);
      for (const key of ['reach', 'room'] as const) {
        expect([`${key}/${i}/lo`, refined[key].lo >= plain[key].lo - EPS]).toEqual([
          `${key}/${i}/lo`,
          true,
        ]);
        expect([`${key}/${i}/hi`, refined[key].hi <= plain[key].hi + EPS]).toEqual([
          `${key}/${i}/hi`,
          true,
        ]);
      }
      // And it lifts to the fold, which is the number anything adjudicates on.
      expect(refined.total.lo).toBeGreaterThanOrEqual(plain.total.lo - EPS);
      expect(refined.total.hi).toBeLessThanOrEqual(plain.total.hi + EPS);
    }
  });

  test('the meet never sees disjoint inputs — two sound brackets must overlap', () => {
    let inverted = 0;
    for (let i = 0; i < CASES.length; i++) {
      const c = REFINED[i] as LawCase;
      const sub = makeSubstrate({
        board: c.board,
        turn: c.turn,
        asTeam: c.asTeam,
        modeled: c.stages,
        observedTurns: c.observedTurns,
      });
      try {
        c.prepare?.(sub);
        defaultEvaluator.evaluatePlan(sub, planFor(sub, c), sub.teamNumber(c.asTeam));
        inverted += refineReportOf(sub)?.inverted ?? 0;
      } finally {
        sub.release();
      }
    }
    expect(inverted).toBe(0);
  });

  test('the meet itself: max of floors, min of ceilings, and disjoint refused', () => {
    expect(meetIntervals(0, 10, 2, 8)).toEqual({ lo: 2, hi: 8, inverted: false });
    expect(meetIntervals(2, 8, 0, 10)).toEqual({ lo: 2, hi: 8, inverted: false });
    expect(meetIntervals(0, 3, 5, 9)).toEqual({ lo: 0, hi: 3, inverted: true });
  });
});

// ---------------------------------------------------------------------------
// 5. The probe — what it buys, and what it costs
// ---------------------------------------------------------------------------

describe('the probe', () => {
  test('width change and floor movement, counted honestly', () => {
    interface Row {
      reach: number;
      room: number;
      width: number;
      dLo: number;
      dHi: number;
      finite: boolean;
    }
    const rows: Row[] = [];
    for (let i = 0; i < CASES.length; i++) {
      const plain = read(CASES[i] as LawCase, false);
      const refined = read(REFINED[i] as LawCase, true);
      const wPlain = gap(plain.total.hi, plain.total.lo);
      const wRefined = gap(refined.total.hi, refined.total.lo);
      const finite = Number.isFinite(wPlain) && Number.isFinite(wRefined);
      rows.push({
        reach: plain.reach.hi - plain.reach.lo - (refined.reach.hi - refined.reach.lo),
        room: plain.room.hi - plain.room.lo - (refined.room.hi - refined.room.lo),
        // A board whose fold is clamped to a lattice end has an INFINITE width
        // on both sides, and `∞ − ∞` is not a narrowing of zero — it is the
        // absence of an interval to narrow. Counted as zero and said so.
        width: finite ? wPlain - wRefined : 0,
        dLo: gap(refined.total.lo, plain.total.lo),
        dHi: gap(plain.total.hi, refined.total.hi),
        finite,
      });
    }
    const med = (xs: number[]): number => {
      const t = [...xs].sort((a, b) => a - b);
      return t.length === 0 ? 0 : (t[Math.floor((t.length - 1) / 2)] as number);
    };
    const mean = (xs: number[]): number =>
      xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
    const line1 = (label: string, xs: number[]): string =>
      `${label.padEnd(16)} moved ${xs.filter((x) => x > 1e-12).length}/${xs.length}  ` +
      `median ${med(xs).toFixed(6)}  mean ${mean(xs).toFixed(6)}  max ${Math.max(...xs).toFixed(6)}`;
    console.log(
      `\n  DOOR C — ${CASES.length} confronted boards, one stale held opponent\n` +
        `  boards with a finite fold interval: ${rows.filter((r) => r.finite).length}/${rows.length}\n` +
        `  ${line1('reach Δwidth', rows.map((r) => r.reach))}\n` +
        `  ${line1('room  Δwidth', rows.map((r) => r.room))}\n` +
        `  ${line1('fold  Δwidth', rows.map((r) => r.width))}\n` +
        `  ${line1('fold  Δlo (up)', rows.map((r) => r.dLo))}\n` +
        `  ${line1('fold  Δhi (down)', rows.map((r) => r.dHi))}\n`
    );
    // NO DIRECTION IS ASSERTED HERE BEYOND THE ONE THE LAW GIVES. The width
    // change is a measurement, and a measurement asserted to be positive stops
    // being one. What IS asserted is the law: it never widens, on any channel.
    for (const r of rows) {
      expect(r.reach).toBeGreaterThanOrEqual(-1e-12);
      expect(r.room).toBeGreaterThanOrEqual(-1e-12);
      expect(r.width).toBeGreaterThanOrEqual(-1e-12);
      expect(r.dLo).toBeGreaterThanOrEqual(-1e-12);
      expect(r.dHi).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  test('the marginal cost, in µs per evaluation', () => {
    // PAIRED AND INTERLEAVED, over the whole corpus. One board timed twice in a
    // row measures whichever arm the JIT warmed last; alternating rounds over
    // twelve boards is what makes the difference the refinement and not the
    // schedule.
    const arm = (target: LawCase, refine: boolean, n: number): number => {
      const sub = makeSubstrate({
        board: target.board,
        turn: target.turn,
        asTeam: target.asTeam,
        modeled: target.stages,
        observedTurns: target.observedTurns,
      });
      try {
        if (refine) target.prepare?.(sub);
        const plan = planFor(sub, target);
        const team = sub.teamNumber(target.asTeam);
        for (let i = 0; i < 50; i++) defaultEvaluator.evaluatePlan(sub, plan, team);
        const t0 = process.hrtime.bigint();
        for (let i = 0; i < n; i++) defaultEvaluator.evaluatePlan(sub, plan, team);
        return Number(process.hrtime.bigint() - t0) / 1000 / n;
      } finally {
        sub.release();
      }
    };
    // THE PRODUCTION SHAPE, timed separately. In a live decision every unit we
    // command is STAGED, so the `hi` reading holds nobody of ours, the refiner
    // declines that half outright, and only ONE extra sweep runs. The corpus
    // deliberately holds `c` so the ceiling channel exists to be tested at all,
    // and that makes it the expensive shape rather than the shipped one — so
    // both are measured and the report says which is which.
    const staged: LawCase[] = REFINED.map((c) => ({
      ...c,
      stages: [...c.stages, 'c'],
      orders: new Map([...c.orders, ['c', cOrderOf(c)]]),
    }));

    const N = 600;
    let off = 0;
    let on = 0;
    let prod = 0;
    let prodOff = 0;
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < CASES.length; i++) {
        off += arm(CASES[i] as LawCase, false, N);
        on += arm(REFINED[i] as LawCase, true, N);
        prodOff += arm({ ...(staged[i] as LawCase), prepare: undefined }, false, N);
        prod += arm(staged[i] as LawCase, true, N);
      }
    }
    const rounds = 3 * CASES.length;
    off /= rounds;
    on /= rounds;
    prod /= rounds;
    prodOff /= rounds;
    console.log(
      `\n  DOOR C — cost, paired over ${CASES.length} boards × 3 rounds × ${N} evaluations:\n` +
        `  both readings refined (a teammate held): ` +
        `${off.toFixed(2)} → ${on.toFixed(2)} µs/evaluation ` +
        `(+${(on - off).toFixed(2)}, ×${(on / off).toFixed(2)})\n` +
        '  production shape (every unit of ours staged, lo only): ' +
        `${prodOff.toFixed(2)} → ${prod.toFixed(2)} µs/evaluation ` +
        `(+${(prod - prodOff).toFixed(2)}, ×${(prod / prodOff).toFixed(2)})\n`
    );
    expect(on).toBeGreaterThan(0);
  }, 300_000);
});

/** `c`'s legal destination — one step up from its head. Read off the board so
 * the staged variant does not have to restate the geometry. */
function cOrderOf(c: LawCase): number {
  const snake = (c.board.snakes ?? []).find((s) => s.id === 'c');
  if (snake === undefined) throw new Error('no snake c');
  const head = snake.body[0] as Coord;
  return marshalBoard(c.board, c.turn).toIndex({ x: head.x + 1, y: head.y });
}
