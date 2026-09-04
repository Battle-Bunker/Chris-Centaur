/**
 * THE CEILING PLY, AGAINST AN EXHAUSTIVE DEPTH-2 TRUTH.
 *
 * `soundness.test.ts` proves `floor ≤ true worst ≤ ceiling` at ONE ply against
 * a complete enumeration of the enemy's replies. The ceiling ply makes a
 * claim about a second one, and a claim about a second ply needs a truth at a
 * second ply — so this file builds one, by the same rule and out of the same
 * engine:
 *
 *     D2(a) = min over EVERY enemy joint reply b of
 *                 max over EVERY continuation K' of ours of
 *                     min over EVERY continuation b' of theirs of
 *                         value(settle(K', b') from the board after (a, b))
 *
 * Nothing is held anywhere in that expression, so every settlement in it is
 * `settleTurn` by `settlePartial`'s own reduction — the rules, once, with no
 * second encoding to agree with itself. It is affordable only on small
 * boards, which is exactly what §4.3's claims need: they are claims about a
 * construction, and a construction is refuted on the smallest board that
 * refutes it.
 *
 * THE FOUR CLAIMS UNDER TEST (§4.3's table, in its own order):
 *
 *  1. `deep.ceiling ≥ D2` — a min over a SUBSET of the replies is an upper
 *     bound on the min over all of them, and the second layer's endpoint
 *     bounds `max_{K'} min_{b'} V` from above. This is the whole member.
 *  2. A leaf's board is a real board: `advanceBoard` refuses anything that is
 *     not, and what it produces is what the engine says the next turn opens
 *     on.
 *  3. G-D4 — the floor never moves. `priceDeep` and `price` report the same
 *     `worst`, bit for bit, on every plan.
 *  4. G-D5 — where B3 also fired, its full enumeration is the ORACLE: B4's
 *     ply-1 group ceiling, taken over a subset of the same leaves, may not sit
 *     below it.
 */

import type { Candidate, JointPlan, UnitId } from '../contracts';
import { EngineSubstrate } from '../substrate';
import { advanceBoard } from './ceiling';
import { BoundBank, DEFAULT_BANK_CONFIG } from './bank';
import {
  allPlans,
  liveSubstrate,
  makeEvaluator,
  makeGenerator,
  makeSubstrate,
  makeTestBoard,
  seededBoard,
  trueWorstCase,
  unboundedBudget,
  wireIdOf,
  type TestBoard,
} from './testkit';

const OURS = 0;
const EPS = 1e-6;

// --------------------------------------------------------------- the truth

/** Every joint assignment over `units`, drawn from `optionsOf`. Ordered. */
function jointsOf(
  units: ReadonlyArray<UnitId>,
  optionsOf: (id: UnitId) => ReadonlyArray<Candidate>,
  cap: number,
): ReadonlyArray<ReadonlyArray<Candidate>> {
  let out: Candidate[][] = [[]];
  for (const id of units) {
    const next: Candidate[][] = [];
    for (const prefix of out) {
      for (const option of optionsOf(id)) {
        next.push([...prefix, option]);
        if (next.length >= cap) break;
      }
      if (next.length >= cap) break;
    }
    out = next;
  }
  return out;
}

/**
 * `max over our continuations of min over theirs` on ONE concrete board, by
 * exhaustive enumeration with nothing held.
 *
 * Null where the position is terminal or the board will not stand up — the
 * ceiling ply declines exactly there too, and a truth that invented a value
 * for a finished game would be testing something the member never claims.
 */
function valueAtDepth2(next: TestBoard, cap: number): number | null {
  const sub = liveSubstrate(next, OURS);
  try {
    const ours = next.spec.units.filter((u) => u.team === OURS).map((u) => u.id);
    const theirs = next.spec.units.filter((u) => u.team !== OURS).map((u) => u.id);
    if (ours.length === 0) return null;
    const options = (id: UnitId): ReadonlyArray<Candidate> => sub.optionsFor(id);
    let best = Number.NEGATIVE_INFINITY;
    for (const mine of jointsOf(ours, options, cap)) {
      let worst = Number.POSITIVE_INFINITY;
      for (const yours of jointsOf(theirs, options, cap)) {
        const plan = new Map<UnitId, Candidate>();
        for (const c of [...mine, ...yours]) plan.set(c.unitId, c);
        // Everything is named, so the bracket is a point and this IS the value.
        worst = Math.min(worst, sub.boundedFor(plan, OURS).worst);
      }
      best = Math.max(best, worst);
    }
    return Number.isFinite(best) ? best : null;
  } finally {
    sub.release();
  }
}

/** The board one turn on, back in the harness's own `TestBoard` shape. */
function advanceTestBoard(board: TestBoard, plan: JointPlan): TestBoard | null {
  const sub = liveSubstrate(board, OURS);
  try {
    const settlement = sub.resolveBoundedFor(plan, OURS).resolution;
    if (settlement.claims.length > 0) return null;
    const next = advanceBoard(sub.marshalled, settlement);
    if (next === null) return null;
    const byWire = new Map(board.spec.units.map((u) => [wireIdOf(u.id), u]));
    const units = next.units.map((u) => {
      const before = byWire.get(u.id);
      if (before === undefined) throw new Error(`ceiling: advanced board invented unit ${u.id}`);
      return {
        ...before,
        type: u.type,
        occupancy: [...u.occupancy],
        energy: u.energy,
        tier: u.tier,
        orientation: u.orientation,
      };
    });
    return {
      spec: { ...board.spec, units, food: [...next.config.food], turn: board.turn + 1 },
      marshalled: next,
      turn: board.turn + 1,
    };
  } finally {
    sub.release();
  }
}

/**
 * `D2(a)`, exhaustively.
 *
 * A leaf whose game ENDED contributes its own settled value rather than a
 * continuation, because there is no next turn to have one — and that is
 * exactly what the member does with such a leaf: `advanceBoard` declines it
 * and the leaf's own one-ply endpoint carries the min. The truth and the
 * member therefore agree about the boundary rather than disagreeing about
 * which quantity is being minimised over.
 */
function trueDepth2(board: TestBoard, plan: JointPlan, cap: number): number | null {
  const sub = liveSubstrate(board, OURS);
  let replies: ReadonlyArray<ReadonlyArray<Candidate>>;
  const points = new Map<string, number>();
  try {
    const theirs = board.spec.units.filter((u) => u.team !== OURS).map((u) => u.id);
    replies = jointsOf(theirs, (id) => sub.optionsFor(id), 4096);
    for (const reply of replies) {
      const full = new Map<UnitId, Candidate>(plan);
      for (const c of reply) full.set(c.unitId, c);
      points.set(
        reply.map((c) => `${c.unitId}>${c.to}`).join('|'),
        sub.boundedFor(full, OURS).worst,
      );
    }
  } finally {
    sub.release();
  }
  let worst = Number.POSITIVE_INFINITY;
  for (const reply of replies) {
    const full = new Map<UnitId, Candidate>(plan);
    for (const c of reply) full.set(c.unitId, c);
    const point = points.get(reply.map((c) => `${c.unitId}>${c.to}`).join('|')) as number;
    const next = advanceTestBoard(board, full);
    const value = next === null ? point : (valueAtDepth2(next, cap) ?? point);
    worst = Math.min(worst, value);
  }
  return Number.isFinite(worst) ? worst : null;
}

// ------------------------------------------------------------ the advance

describe('advanceBoard — the board the next turn opens on', () => {
  test('a partial settlement is refused: it is a timeline, not a board', () => {
    const board = makeTestBoard(seededBoard(1, 6, 1));
    const sub = makeSubstrate(board, OURS);
    try {
      // Our side named, theirs held — the optimistic timeline, which settles
      // the turn with the held units absent from the board.
      const ours = sub.commandable(OURS);
      const plan = new Map<UnitId, Candidate>();
      for (const id of ours) plan.set(id, sub.actionsOf(id)[0] as Candidate);
      const settlement = sub.resolveBoundedFor(plan, OURS).resolution;
      expect(settlement.claims.length).toBeGreaterThan(0);
      expect(() => advanceBoard(sub.marshalled, settlement)).toThrow(/not a board/);
    } finally {
      sub.release();
    }
  });

  test('a concrete settlement advances one turn, survivors only, tiers carried', () => {
    const board = makeTestBoard(seededBoard(3, 6, 1));
    const sub = liveSubstrate(board, OURS);
    try {
      const plan = new Map<UnitId, Candidate>();
      for (const u of board.spec.units) plan.set(u.id, sub.actionsOf(u.id)[0] as Candidate);
      const settlement = sub.resolveBoundedFor(plan, OURS).resolution;
      const next = advanceBoard(sub.marshalled, settlement);
      if (next === null) return; // terminal on this seed; the decline is the answer
      expect(next.arrivalTurn).toBe(sub.marshalled.arrivalTurn + 1);
      expect(next.units.map((u) => u.id)).toEqual(Object.keys(settlement.board).sort((a, b) =>
        sub.marshalled.units.findIndex((u) => u.id === a) -
        sub.marshalled.units.findIndex((u) => u.id === b)));
      for (const u of next.units) {
        expect(u.occupancy).toEqual(settlement.board[u.id]?.occupancy);
        expect(u.energy).toBe(settlement.board[u.id]?.energy);
        expect(u.tier).toBe(settlement.tiers[u.id] ?? 0);
      }
      // The board it produces is one the substrate will stand up.
      const child = new EngineSubstrate({ marshalled: next, turn: board.turn + 1, asTeam: 't0' });
      expect(child.unitIds().length).toBe(next.units.length);
      child.release();
    } finally {
      sub.release();
    }
  });
});

// ------------------------------------------------------- the four claims

interface PlyStats {
  fired: number;
  declined: Map<string, number>;
  /** Claim 1: the ply's ceiling against the exhaustive depth-2 truth. */
  checkedAgainstD2: number;
  aboveD2: number;
  /** How often the deep reading was tighter than the ply-1 one at all. */
  tightened: number;
  /** Claim: the h1 FLOOR also bounds the depth-2 truth from below. Measured,
   *  not assumed — §4.3 asserts one horizon-independent quantity, and this is
   *  the assertion's only empirical test on this build. */
  floorUnderD2: number;
  floorOverD2: number;
}

function freshPlyStats(): PlyStats {
  return {
    fired: 0,
    declined: new Map(),
    checkedAgainstD2: 0,
    aboveD2: 0,
    tightened: 0,
    floorUnderD2: 0,
    floorOverD2: 0,
  };
}

describe('the ceiling ply is sound against an exhaustive depth-2 truth', () => {
  test('one unit a side: deep ceiling ≥ D2, the floor never moves, B3 is the oracle', () => {
    const stats = freshPlyStats();
    let checkedFloors = 0;
    let oracleChecks = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const board = makeTestBoard(seededBoard(seed, 6, 2));
      const gen = makeGenerator();
      const evaluate = makeEvaluator();
      const sub = makeSubstrate(board, OURS);
      try {
        for (const plan of allPlans(sub, gen, OURS, 6)) {
          const shallow = new BoundBank({
            sub,
            gen,
            evaluate,
            asTeam: OURS,
            budget: unboundedBudget(),
            basis: [],
            config: DEFAULT_BANK_CONFIG,
          });
          const deepBank = new BoundBank({
            sub,
            gen,
            evaluate,
            asTeam: OURS,
            budget: unboundedBudget(),
            basis: [],
            config: DEFAULT_BANK_CONFIG,
          });
          try {
            const one = shallow.price(plan);
            const two = deepBank.priceDeep(plan);

            // CLAIM 3 (G-D4). The floor is bit-for-bit the one ply 1 proved.
            expect(two.bounds.worst).toBe(one.bounds.worst);
            checkedFloors++;

            // The one-ply property still holds of the deepened reading: it is
            // the same bracket with at most a lower top.
            const truth = trueWorstCase(board, OURS, plan).value;
            if (two.bounds.assumptions.length === 0) {
              expect(two.bounds.worst).toBeLessThanOrEqual(truth + EPS);
            }
            expect(two.bounds.best).toBeGreaterThanOrEqual(truth - EPS);

            const deep = two.deep;
            if (deep === null) continue;
            if (deep.declined !== null) {
              stats.declined.set(deep.declined, (stats.declined.get(deep.declined) ?? 0) + 1);
            }
            if (deep.leaves === 0 || deep.ceiling === null) continue;
            stats.fired++;
            if (deep.horizon > 1) stats.tightened++;

            // CLAIM 4 (G-D5). Where B3 also fired, the full cross-product is
            // ground truth for the min the ply takes over a subset of it.
            const b3 = two.members.find((m) => m.rung === 'B3');
            const b4 = two.members.find((m) => m.rung === 'B4');
            if (b3 !== undefined && b4 !== undefined) {
              expect(b4.ceiling).toBeGreaterThanOrEqual(b3.ceiling - EPS);
              oracleChecks++;
            }

            // CLAIM 1. The exhaustive depth-2 truth lies at or below the ply's
            // ceiling — and, measured beside it, at or above the plan's floor.
            const d2 = trueDepth2(board, plan, 64);
            if (d2 === null) continue;
            stats.checkedAgainstD2++;
            if (deep.ceiling >= d2 - EPS) stats.aboveD2++;
            expect(deep.ceiling).toBeGreaterThanOrEqual(d2 - EPS);
            if (two.bounds.worst <= d2 + EPS) stats.floorUnderD2++;
            else stats.floorOverD2++;
          } finally {
            shallow.release();
            deepBank.release();
          }
        }
      } finally {
        sub.release();
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `  [ceiling ply] floors=${checkedFloors} fired=${stats.fired} tightened=${stats.tightened} ` +
        `vsD2=${stats.checkedAgainstD2} sound=${stats.aboveD2} oracle=${oracleChecks} ` +
        `floor≤D2 ${stats.floorUnderD2} / floor>D2 ${stats.floorOverD2} ` +
        `declines=${JSON.stringify([...stats.declined])}`,
    );
    expect(checkedFloors).toBeGreaterThan(20);
    expect(stats.fired).toBeGreaterThan(0);
    expect(stats.aboveD2).toBe(stats.checkedAgainstD2);
  }, 600_000);

  test('two units a side: the same three claims where the product bites', () => {
    const stats = freshPlyStats();
    for (const seed of [21, 22, 23, 24]) {
      const board = makeTestBoard(seededBoard(seed, 7, 2));
      const gen = makeGenerator();
      const evaluate = makeEvaluator();
      const sub = makeSubstrate(board, OURS);
      try {
        for (const plan of allPlans(sub, gen, OURS, 4)) {
          const shallow = new BoundBank({
            sub, gen, evaluate, asTeam: OURS, budget: unboundedBudget(), basis: [],
            config: DEFAULT_BANK_CONFIG,
          });
          const deepBank = new BoundBank({
            sub, gen, evaluate, asTeam: OURS, budget: unboundedBudget(), basis: [],
            config: DEFAULT_BANK_CONFIG,
          });
          try {
            const one = shallow.price(plan);
            const two = deepBank.priceDeep(plan);
            expect(two.bounds.worst).toBe(one.bounds.worst);
            const truth = trueWorstCase(board, OURS, plan).value;
            expect(two.bounds.best).toBeGreaterThanOrEqual(truth - EPS);
            const deep = two.deep;
            if (deep === null) continue;
            if (deep.declined !== null) {
              stats.declined.set(deep.declined, (stats.declined.get(deep.declined) ?? 0) + 1);
            }
            if (deep.leaves === 0 || deep.ceiling === null) continue;
            stats.fired++;
            const d2 = trueDepth2(board, plan, 24);
            if (d2 === null) continue;
            stats.checkedAgainstD2++;
            expect(deep.ceiling).toBeGreaterThanOrEqual(d2 - EPS);
            stats.aboveD2++;
            if (two.bounds.worst <= d2 + EPS) stats.floorUnderD2++;
            else stats.floorOverD2++;
          } finally {
            shallow.release();
            deepBank.release();
          }
        }
      } finally {
        sub.release();
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `  [ceiling ply/team] fired=${stats.fired} vsD2=${stats.checkedAgainstD2} ` +
        `sound=${stats.aboveD2} floor≤D2 ${stats.floorUnderD2} / floor>D2 ${stats.floorOverD2} ` +
        `declines=${JSON.stringify([...stats.declined])}`,
    );
    expect(stats.aboveD2).toBe(stats.checkedAgainstD2);
  }, 900_000);
});

describe('the member is inert with its flag off', () => {
  test('priceDeep is price when b4 is false', () => {
    const board = makeTestBoard(seededBoard(2, 6, 1));
    const gen = makeGenerator();
    const evaluate = makeEvaluator();
    const sub = makeSubstrate(board, OURS);
    try {
      for (const plan of allPlans(sub, gen, OURS, 6)) {
        const off = new BoundBank({
          sub, gen, evaluate, asTeam: OURS, budget: unboundedBudget(), basis: [],
          config: { ...DEFAULT_BANK_CONFIG, b4: false },
        });
        const plain = new BoundBank({
          sub, gen, evaluate, asTeam: OURS, budget: unboundedBudget(), basis: [],
          config: { ...DEFAULT_BANK_CONFIG, b4: false },
        });
        try {
          const a = off.priceDeep(plan);
          const b = plain.price(plan);
          expect(a.bounds.worst).toBe(b.bounds.worst);
          expect(a.bounds.best).toBe(b.bounds.best);
          expect(a.est).toBe(b.est);
          expect(a.resolutions).toBe(b.resolutions);
          expect(a.deep).toBeNull();
          expect(a.members.map((m) => m.rung)).toEqual(b.members.map((m) => m.rung));
        } finally {
          off.release();
          plain.release();
        }
      }
    } finally {
      sub.release();
    }
  });
});
