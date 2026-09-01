/**
 * THE RESIDUAL BANK BOUNDS INVERSION — reproduced from the batch-2 error
 * records, then pinned.
 *
 * Batch `20260831-batch2` recorded three decision errors across 2,472 games.
 * All three are the same thrown exception, all three on `snake5-queen`, and
 * all three are the bank's own assembly refusing a floor that sits a hair
 * ABOVE its ceiling:
 *
 *   arm / game                              turn  bounds                    relative
 *   nullA / snake5-queen-s54506-r1          105   [149.7698, 149.7502]      1.3e-4
 *   default / snake5-queen-s69705-r0         78   [ 60.0150,  60.0000]      2.5e-4
 *   sampled-cap / snake5-queen-s69711-r1    103   [251.3184, 251.2998]      7.4e-5
 *
 * The B0 floor and the B3 ceiling are reached by different accumulation paths
 * over the same quantity, so their rounding diverges; `snake5-queen` is the
 * board with ten times the arithmetic per cluster of any other and therefore
 * the deepest chains in the batch. Three to four orders of magnitude below the
 * quantities being compared is rounding, not a soundness violation — and the
 * bot FORFEITED the turn for it (`emissions: 0`, every telemetry field null).
 *
 * Two facts this file pins:
 *
 *  1. a sub-tolerance inversion is absorbed, not thrown, and the bracket that
 *     comes out still contains the truth (both endpoints weaken);
 *  2. a decision whose bank throws a GENUINE inversion at rung 0 — including
 *     through the self-harm repair, which is where the recorded escapes went —
 *     stages a legal plan anyway and RECORDS the refusal. The batch's own
 *     integrity finding was that `boundsInversions` read 0 on a game that
 *     threw, so "counted" is half the fix and this is the half with a test.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import type { JointPlan, UnitId } from '../lobster/contracts';
import { makeSubstrate, clearGeometryCache, type EngineSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { materialEvaluator } from '../lobster/evaluate';
import {
  BOUND_EPSILON,
  BOUND_RELATIVE_EPSILON,
  BoundsInversionError,
  makeScoreBounds,
  widthOf,
} from '../lobster/bounds';
import { makeSearchCore } from '../lobster/search';
import { LobsterKernel, deadlineFromWallClock } from '../lobster/kernel';

const TURN = 7;

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
  makeSnake(id, [at], { unitType, length: weight, teamID });

/** A queen board — the shape all three recorded errors landed on. */
const QUEEN_BOARD = (): Board =>
  ({
    width: 12,
    height: 12,
    food: [{ x: 6, y: 6 }],
    hazards: [],
    snakes: [
      piece('q', { x: 3, y: 3 }, 'queen', 3, 'red'),
      makeSnake('t', [
        { x: 5, y: 2 },
        { x: 5, y: 1 },
        { x: 5, y: 0 },
      ], { teamID: 'red' }),
      piece('K', { x: 9, y: 9 }, 'king', 1, 'blue'),
      makeSnake('u', [
        { x: 8, y: 4 },
        { x: 8, y: 3 },
      ], { teamID: 'blue' }),
    ],
  }) as Board;

afterEach(() => clearGeometryCache());

// ------------------------------------------------------- 1. the algebra

describe('the three recorded inversions are rounding, and are absorbed', () => {
  // Exactly as printed in the replays' error records.
  const RECORDED: ReadonlyArray<readonly [string, number, number]> = [
    ['nullA/snake5-queen-s54506-r1@105', 149.7698, 149.7502],
    ['default/snake5-queen-s69705-r0@78', 60.015, 60.0],
    ['sampled-cap/snake5-queen-s69711-r1@103', 251.3184, 251.2998],
  ];

  test.each(RECORDED)('%s no longer throws', (_name, worst, best) => {
    // The recorded pair carries a ledger, so the discharge rule does not
    // also fire on the gap this leaves.
    const ledger = [
      { unitId: 1, cell: 4, subStep: 1, polarity: 'if_present' as const, note: 'recorded' },
    ];
    const bounds = makeScoreBounds({ worst, best, ledger, note: 'bank floor=B0 ceiling=B3' });
    // No inversion survives into the published bracket…
    expect(widthOf(bounds)).toBeGreaterThanOrEqual(0);
    // …and neither endpoint is asserted more strongly than the evidence:
    // the floor may only fall and the ceiling may only rise.
    expect(bounds.worst).toBeLessThanOrEqual(worst);
    expect(bounds.best).toBeGreaterThanOrEqual(best);
    // The repair is confined to the disagreement itself.
    expect(worst - bounds.worst).toBeLessThanOrEqual(worst - best);
  });

  test('every recorded inversion is inside the tolerance, with headroom', () => {
    for (const [, worst, best] of RECORDED) {
      const relative = (worst - best) / Math.max(Math.abs(worst), Math.abs(best));
      expect(relative).toBeGreaterThan(0);
      expect(relative).toBeLessThan(BOUND_RELATIVE_EPSILON);
      // The worst recorded case still leaves an order of magnitude.
      expect(relative).toBeLessThan(BOUND_RELATIVE_EPSILON / 2);
    }
  });

  test('a genuine inversion above the tolerance still refuses', () => {
    // One material weight apart on a quantity of 150 is 0.7% — five times the
    // tolerance, and the bug class the refusal exists for.
    expect(() => makeScoreBounds({ worst: 150, best: 149 })).toThrow(BoundsInversionError);
    expect(() => makeScoreBounds({ worst: 5, best: -5 })).toThrow(BoundsInversionError);
    // And the tolerance does not scale away at zero: near the origin the
    // absolute floor is what binds, so a unit-sized inversion there refuses too.
    expect(() => makeScoreBounds({ worst: 1e-6, best: -1e-6 })).toThrow(BoundsInversionError);
  });

  test('the tolerance is relative, and it degrades to the absolute floor', () => {
    // A pair at 1e6 tolerates proportionally more drift than a pair at 1…
    expect(() =>
      makeScoreBounds({
        worst: 1e6,
        best: 1e6 - 1e6 * (BOUND_RELATIVE_EPSILON / 2),
        ledger: [{ unitId: 1, cell: 4, subStep: 1, polarity: 'if_present', note: 'x' }],
      }),
    ).not.toThrow();
    // …and at zero the relative term vanishes, leaving BOUND_EPSILON.
    expect(() => makeScoreBounds({ worst: BOUND_EPSILON / 2, best: 0 })).not.toThrow();
    expect(() => makeScoreBounds({ worst: BOUND_EPSILON * 100, best: 0 })).toThrow(
      BoundsInversionError,
    );
  });
});

// ---------------------------------------- 2. the escape, and the counter

/**
 * An evaluator whose bounds are inverted by a WHOLE material weight — far
 * above any tolerance — so the bank genuinely refuses and the question is what
 * the decision does about it.
 */
const invertedEvaluator = {
  scorePlan: () => ({ lo: 10, est: 0, hi: -10 }),
  evaluatePlan: () => ({
    bound: { lo: 10, est: 0, hi: -10 },
    parts: {},
    exact: false,
    basis: [],
    ledgerSize: 0,
  }),
};

describe('a genuine inversion under the rung-0 self-harm repair is counted, not fatal', () => {
  let sub: EngineSubstrate;
  afterEach(() => sub.release());

  test('conform returns a complete legal plan and records the refusal', () => {
    sub = makeSubstrate({ board: QUEEN_BOARD(), turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator();
    // `rungZeroRepair` is what a PIECE board resolves to (`stagingSafety:
    // auto` -> `full`), and it is the path all three recorded escapes took:
    // the seed's own price is absorbed, and the repair that follows it prices
    // again — unguarded, until this fix.
    const core = makeSearchCore({ rungZeroRepair: true });
    const start = Date.now();
    const plan: JointPlan = core.conform(
      {
        sub,
        gen,
        evaluate: invertedEvaluator as never,
        asTeam: 0,
        pins: [],
        assumptions: [],
        incumbent: null,
        witnesses: [],
        budget: {
          remainingMs: () => Number.POSITIVE_INFINITY,
          elapsedMs: () => Date.now() - start,
          shouldStop: () => false,
          now: () => Date.now(),
        },
      },
      new Map(),
    );
    expect([...plan.keys()].sort((a, b) => a - b)).toEqual(
      [...sub.commandable(0)].sort((a: UnitId, b: UnitId) => a - b),
    );
    expect(core.drainRefusals?.().boundsInversions).toBeGreaterThan(0);
  });

  test('end to end: the turn is staged and the counter is non-zero', async () => {
    sub = makeSubstrate({ board: QUEEN_BOARD(), turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator();
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0, sliceMs: 5, reserveMs: 1 });
    let emits = 0;
    for await (const _ of kernel.decide({
      sub,
      gen,
      evaluate: invertedEvaluator as never,
      search: makeSearchCore({ rungZeroRepair: true }),
      asTeam: 0,
      deadlineMs: deadlineFromWallClock(Date.now() + 150),
      initialPins: [],
    })) {
      void _;
      emits++;
    }
    const report = kernel.lastReport;
    expect(emits).toBeGreaterThan(0);
    expect(report?.stagedNothing).toBe(false);
    // THE BATCH'S OWN INTEGRITY FINDING: a game that threw recorded 0 here.
    expect(report?.refusals['bounds-inversion']).toBeGreaterThan(0);
    expect(report?.boundViolations).toBeGreaterThan(0);
  }, 20_000);
});

// A control, so the two halves of the fix cannot be confused: a SOUND
// evaluator on the same board records nothing at all.
describe('the counter stays at zero when nothing inverts', () => {
  test('a sound bank on the queen board records no inversion', async () => {
    const sub2 = makeSubstrate({ board: QUEEN_BOARD(), turn: TURN, asTeam: 'red' });
    try {
      const kernel = new LobsterKernel({ minWriteIntervalMs: 0, sliceMs: 5, reserveMs: 1 });
      for await (const _ of kernel.decide({
        sub: sub2,
        gen: new GrammarCandidateGenerator(),
        evaluate: materialEvaluator,
        search: makeSearchCore({ rungZeroRepair: true }),
        asTeam: 0,
        deadlineMs: deadlineFromWallClock(Date.now() + 150),
        initialPins: [],
      })) {
        void _;
      }
      expect(kernel.lastReport?.refusals['bounds-inversion']).toBe(0);
      expect(kernel.lastReport?.boundViolations).toBe(0);
      expect(kernel.lastReport?.stagedNothing).toBe(false);
    } finally {
      sub2.release();
    }
  }, 20_000);
});
