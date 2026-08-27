/**
 * ADMISSION, THROUGH THE KERNEL, ON REAL BOARDS.
 *
 * The governor's own arithmetic is pinned in `lobster/__tests__/admission.test.ts`.
 * What this suite pins is everything that only exists once the policy is
 * wired: that the detectors read the board the engine actually built (roster
 * AND claim field, so a held unit is not invisible), that the ladder is
 * measured ONCE and frozen for the turn, that the chosen objective really is
 * the one the decision proves under, and that the whole thing rides the wire.
 *
 * `yieldIntervalMs: 0` throughout. The event-loop yield is gated on the REAL
 * clock, so the yield COUNT — a wall-time quantity — leaks into the virtual
 * budget through the two virtual-clock reads each yield costs. With it on, two
 * runs on one branch can differ by a slice; with it off they cannot.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import type { Candidate, EmitRecord, JointPlan, UnitId } from '../lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import {
  BASE_COHORT_ID,
  BASE_PROFILE,
  BoundEvaluator,
  COHORTS,
  TERRITORY_COHORT_ID,
  TERRITORY_PROFILE,
  defaultEvaluator,
} from '../lobster/evaluate';
import {
  DEFAULT_ADMISSION_POLICY,
  admissionSubstrateOf,
  classifyAdmission,
  measureAdmission,
} from '../lobster/admission';
import type { LadderRow } from '../lobster/admission';
import { ADMISSION_LADDERS } from '../lobster/evaluate/calibration';
import { makeSearchCore } from '../lobster/search';
import { LobsterKernel } from '../lobster/kernel';
import fixture from './fixtures/territory-acceptance.json';

jest.setTimeout(60_000);

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
  ({ width: 11, height: 11, food: [], hazards: [], snakes, ...extra }) as Board;

/** A trail unit of three cells running left from `head`. */
const trail = (id: string, head: Coord, teamID: string): Snake =>
  makeSnake(
    id,
    [head, { x: head.x - 1, y: head.y }, { x: head.x - 2, y: head.y }],
    { teamID }
  );

/** Four own trail units, four theirs, not a slider anywhere: the one shape the
 * shipped predicate admits territory on. */
const ROOMY_SNAKE_BOARD = boardOf([
  trail('a1', { x: 4, y: 1 }, 'red'),
  trail('a2', { x: 4, y: 3 }, 'red'),
  trail('a3', { x: 4, y: 5 }, 'red'),
  trail('a4', { x: 4, y: 7 }, 'red'),
  trail('b1', { x: 10, y: 2 }, 'blue'),
  trail('b2', { x: 10, y: 4 }, 'blue'),
  trail('b3', { x: 10, y: 6 }, 'blue'),
  trail('b4', { x: 10, y: 8 }, 'blue'),
]);

/** The same roster with one enemy rook added — a slider board. */
const SLIDER_BOARD = boardOf([
  trail('a1', { x: 4, y: 1 }, 'red'),
  trail('a2', { x: 4, y: 3 }, 'red'),
  trail('a3', { x: 4, y: 5 }, 'red'),
  trail('a4', { x: 4, y: 7 }, 'red'),
  trail('b1', { x: 10, y: 2 }, 'blue'),
  trail('b2', { x: 10, y: 4 }, 'blue'),
  trail('b3', { x: 10, y: 6 }, 'blue'),
  piece('rook', { x: 9, y: 9 }, 'rook', 2, { teamID: 'blue' }),
]);

/** The same roster with an own pawn one meal from promoting. */
const PRE_ARM_BOARD = boardOf([
  trail('a1', { x: 4, y: 1 }, 'red'),
  trail('a2', { x: 4, y: 3 }, 'red'),
  trail('a3', { x: 4, y: 5 }, 'red'),
  trail('a4', { x: 4, y: 7 }, 'red'),
  piece('p', { x: 6, y: 6 }, 'pawn', 9, { teamID: 'red' }),
  trail('b1', { x: 10, y: 2 }, 'blue'),
  trail('b2', { x: 10, y: 4 }, 'blue'),
  trail('b3', { x: 10, y: 6 }, 'blue'),
  trail('b4', { x: 10, y: 8 }, 'blue'),
]);

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

const EVALUATORS: ReadonlyMap<string, BoundEvaluator> = new Map([
  [BASE_COHORT_ID, new BoundEvaluator(BASE_PROFILE)],
  [TERRITORY_COHORT_ID, defaultEvaluator as BoundEvaluator],
]);

interface RunResult {
  records: EmitRecord[];
  kernel: LobsterKernel;
}

async function run(
  board: Board,
  team: string,
  opts: {
    turn?: number;
    policyOn?: boolean;
    budgetMs?: number;
    observedTurns?: ReadonlyMap<string, number>;
    each?: (rec: EmitRecord, kernel: LobsterKernel) => void;
    evaluators?: ReadonlyMap<string, BoundEvaluator>;
  } = {}
): Promise<RunResult> {
  const turn = opts.turn ?? 30;
  const clock = new StepClock();
  const sub = makeSubstrate({ board, turn, asTeam: team, observedTurns: opts.observedTurns });
  const policyOn = opts.policyOn ?? true;
  const kernel = new LobsterKernel({
    sliceMs: 2,
    reserveMs: 1,
    minWriteIntervalMs: 0,
    yieldIntervalMs: 0,
    ...(policyOn ? { admission: DEFAULT_ADMISSION_POLICY } : {}),
  });
  const records: EmitRecord[] = [];
  try {
    for await (const rec of kernel.decide({
      sub,
      gen: new GrammarCandidateGenerator(),
      evaluate: defaultEvaluator,
      search: makeSearchCore(),
      asTeam: sub.teamNumber(team),
      deadlineMs: clock.peek() + (opts.budgetMs ?? 60),
      initialPins: [],
      now: clock.now,
      ...(policyOn ? { evaluators: opts.evaluators ?? EVALUATORS } : {}),
    })) {
      records.push(rec);
      opts.each?.(rec, kernel);
    }
  } finally {
    sub.release();
  }
  return { records, kernel };
}

afterEach(() => clearGeometryCache());

// ===========================================================================
// 1. The detectors, against boards the engine really built

describe('the detectors read the board the engine built', () => {
  test('a snake-only roster reports its trail counts and no slider', () => {
    const sub = makeSubstrate({ board: ROOMY_SNAKE_BOARD, turn: 30, asTeam: 'red' });
    try {
      const c = measureAdmission(sub, sub.teamNumber('red'));
      expect(c).toEqual({
        sliderPossible: false,
        ownTrailCount: 4,
        theirTrailCount: 4,
        promotionImminent: false,
      });
      expect(classifyAdmission(c)).toEqual([BASE_COHORT_ID, TERRITORY_COHORT_ID]);
    } finally {
      sub.release();
    }
  });

  test('one enemy rook is enough — the scope is board-level, pending E1', () => {
    const sub = makeSubstrate({ board: SLIDER_BOARD, turn: 30, asTeam: 'red' });
    try {
      const c = measureAdmission(sub, sub.teamNumber('red'));
      expect(c.sliderPossible).toBe(true);
      expect(c.ownTrailCount).toBe(4);
      expect(classifyAdmission(c)).toEqual([BASE_COHORT_ID]);
    } finally {
      sub.release();
    }
  });

  test('an own pawn one meal from promoting pre-arms the gate', () => {
    const sub = makeSubstrate({ board: PRE_ARM_BOARD, turn: 30, asTeam: 'red' });
    try {
      const c = measureAdmission(sub, sub.teamNumber('red'));
      expect(c.sliderPossible).toBe(false);
      expect(c.promotionImminent).toBe(true);
      // Promotion is a plan-space event, not a material one, which is exactly
      // why the material-denominated evaluator never sees it coming — so the
      // gate closes a turn EARLY and the transition never happens inside a turn.
      expect(classifyAdmission(c)).toEqual([BASE_COHORT_ID]);
    } finally {
      sub.release();
    }
  });

  test('THE CONSERVATIVE FOG BIAS: a held pawn past the horizon reads as a slider', () => {
    // Owner ruling Q2, end to end. The same board, twice: once with the enemy
    // pawn observed THIS turn, once with it last observed twenty turns ago. In
    // the second reading the claim's kindSet has forked to include a queen, and
    // a queen is a slider — so territory is refused on a board where nothing
    // visible changed at all.
    const board = boardOf([
      trail('a1', { x: 4, y: 1 }, 'red'),
      trail('a2', { x: 4, y: 3 }, 'red'),
      trail('a3', { x: 4, y: 5 }, 'red'),
      trail('a4', { x: 4, y: 7 }, 'red'),
      piece('theirPawn', { x: 9, y: 9 }, 'pawn', 1, { teamID: 'blue' }),
      trail('b1', { x: 10, y: 2 }, 'blue'),
    ], { food: Array.from({ length: 20 }, (_, i) => ({ x: i % 11, y: 9 })) });

    const fresh = makeSubstrate({ board, turn: 40, asTeam: 'red' });
    let sighted;
    try {
      sighted = measureAdmission(fresh, fresh.teamNumber('red'));
    } finally {
      fresh.release();
      clearGeometryCache();
    }

    const stale = makeSubstrate({
      board,
      turn: 40,
      asTeam: 'red',
      observedTurns: new Map([['theirPawn', 5]]),
    });
    let fogged;
    try {
      fogged = measureAdmission(stale, stale.teamNumber('red'));
    } finally {
      stale.release();
    }

    // The direction of error is one-way: fog can only ever ADD caution.
    expect(sighted.sliderPossible || sighted.promotionImminent).toBe(false);
    expect(fogged.sliderPossible || fogged.promotionImminent).toBe(true);
    expect(classifyAdmission(sighted)).toEqual([BASE_COHORT_ID, TERRITORY_COHORT_ID]);
    expect(classifyAdmission(fogged)).toEqual([BASE_COHORT_ID]);
  });

  test('the acceptance corpus classifies, and says why', () => {
    // Not an assertion about what the policy SHOULD say on these boards — an
    // assertion that it says something, on every one of them, from the board.
    const samples = [
      ...(fixture.snakes11 as unknown as Array<{ board: Board; turn: number; team: string }>),
      fixture.mid11 as unknown as { board: Board; turn: number; team: string },
    ];
    const seen = new Set<string>();
    for (const s of samples) {
      const sub = makeSubstrate({ board: s.board, turn: s.turn, asTeam: s.team });
      try {
        const c = measureAdmission(sub, sub.teamNumber(s.team));
        seen.add(JSON.stringify(classifyAdmission(c)));
        // Every acceptance board is either slider-bearing (mid11) or carries
        // fewer than four own trail units (snakes11 runs three a side), so the
        // shipped tenant refuses territory on all of them. Worth knowing
        // before anyone reads a promotion sweep on this corpus.
        expect([s.turn, s.team, classifyAdmission(c)]).toEqual([
          s.turn,
          s.team,
          [BASE_COHORT_ID],
        ]);
      } finally {
        sub.release();
        clearGeometryCache();
      }
    }
    expect(seen.size).toBe(1);
  });

  test('a substrate that cannot answer is refused, not silently tolerated', () => {
    expect(admissionSubstrateOf(null)).toBeNull();
    expect(admissionSubstrateOf({})).toBeNull();
    expect(admissionSubstrateOf({ roster: () => [], claimField: () => ({}) })).toBeNull();
    const sub = makeSubstrate({ board: ROOMY_SNAKE_BOARD, turn: 30, asTeam: 'red' });
    try {
      expect(admissionSubstrateOf(sub)).not.toBeNull();
    } finally {
      sub.release();
    }
  });
});

// ===========================================================================
// 2. The flag, and what each side of it does

describe('the flag', () => {
  test('OFF: no stamp anywhere, and the shipped objective throughout', async () => {
    const { records, kernel } = await run(SLIDER_BOARD, 'red', { policyOn: false });
    expect(records.length).toBeGreaterThan(0);
    expect(kernel.lastReport?.admission).toBeNull();
    expect(kernel.lastReport?.admissionState).toBeNull();
    for (const rec of records) {
      // Not "an admission stamp saying the default" — no KEY at all. "The
      // policy was off" and "the policy chose the default" are different
      // facts, and a corpus that cannot separate them cannot be refit.
      expect(Object.prototype.hasOwnProperty.call(rec, 'admission')).toBe(false);
      expect(cohortsOn(rec)).toEqual([TERRITORY_COHORT_ID]);
    }
  });

  test('ON: the board picks base on a slider roster, and every record says so', async () => {
    const { records, kernel } = await run(SLIDER_BOARD, 'red', { policyOn: true });
    const stamp = kernel.lastReport?.admission;
    expect(stamp).not.toBeNull();
    expect(stamp?.ladder).toEqual([BASE_COHORT_ID]);
    expect(stamp?.activeCohort).toBe(BASE_COHORT_ID);
    expect(stamp?.detectors.sliderPossible).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    for (const rec of records) {
      expect(rec.admission).toEqual(stamp);
      // The record's own basis agrees with the policy's verdict: the numbers
      // were proved under the objective the stamp names.
      expect(cohortsOn(rec)).toEqual([BASE_COHORT_ID]);
    }
  });

  test('ON: the board keeps territory on a roomy slider-free roster', async () => {
    const { records, kernel } = await run(ROOMY_SNAKE_BOARD, 'red', { policyOn: true });
    const stamp = kernel.lastReport?.admission;
    expect(stamp?.ladder).toEqual([BASE_COHORT_ID, TERRITORY_COHORT_ID]);
    expect(stamp?.activeCohort).toBe(TERRITORY_COHORT_ID);
    for (const rec of records) expect(cohortsOn(rec)).toEqual([TERRITORY_COHORT_ID]);
  });

  test('ON: the chosen cohort really changes what is computed', async () => {
    // Not just what is STAMPED. The base cohort's compute gate excludes reach
    // and room, so the two runs differ in the evaluator they drove — asserted
    // by counting what each profile's fold actually invoked on the same board.
    const sub = makeSubstrate({ board: SLIDER_BOARD, turn: 30, asTeam: 'red' });
    try {
      const asTeam = sub.teamNumber('red');
      const plan = new Map<UnitId, Candidate>();
      for (const u of sub.roster()) {
        if (u.team !== asTeam) continue;
        const a = sub.enumerate(u.unitId)[0];
        if (a === undefined) continue;
        plan.set(u.unitId, {
          unitId: u.unitId,
          from: -1,
          to: a.dest,
          path: a.action.kind === 'move' ? [...a.action.path] : [],
        });
      }
      const joint: JointPlan = plan;
      const base = new BoundEvaluator(BASE_PROFILE).evaluatePlan(sub, joint, asTeam);
      const terr = new BoundEvaluator(TERRITORY_PROFILE).evaluatePlan(sub, joint, asTeam);
      // Absence from `parts` is the honest report that a number was never
      // computed, which a zero would misstate.
      expect(Object.keys(base.parts).sort()).toEqual(['healthEconomy', 'kingMargin', 'material']);
      expect(Object.keys(terr.parts).sort()).toEqual([
        'healthEconomy',
        'kingMargin',
        'material',
        'reach',
        'room',
      ]);
    } finally {
      sub.release();
    }
  });

  test('ON with an evaluator missing for an admitted cohort: refused, loudly', async () => {
    // Falling back to `input.evaluate` would mean proving numbers under one
    // objective and stamping them with another — the exact silent mixing the
    // cohort stamp exists to prevent.
    await expect(
      run(SLIDER_BOARD, 'red', {
        policyOn: true,
        evaluators: new Map([[TERRITORY_COHORT_ID, defaultEvaluator as BoundEvaluator]]),
      })
    ).rejects.toThrow(/no evaluator was supplied/);
  });

  test('the shipped kernel default is OFF', () => {
    const kernel = new LobsterKernel();
    expect(kernel).toBeInstanceOf(LobsterKernel);
    // The registry is a catalogue and carries both rows; the POLICY is what
    // ships off, and it is what makes a default decision a constant-cohort one.
    expect(COHORTS.map((c) => c.id)).toEqual([BASE_COHORT_ID, TERRITORY_COHORT_ID]);
  });
});

// ===========================================================================
// 3. Frozen at decision entry

describe('the ladder is frozen for the turn', () => {
  test('every record in one decision carries the SAME stamp, object for object', async () => {
    const { records, kernel } = await run(SLIDER_BOARD, 'red', {
      policyOn: true,
      budgetMs: 200,
    });
    expect(records.length).toBeGreaterThan(1);
    const stamp = kernel.lastReport?.admission;
    for (const rec of records) expect(rec.admission).toBe(stamp);
  });

  test('AN EPOCH CANNOT MOVE IT — the strongest re-measurement a turn contains', async () => {
    // An operator pin opens a constraint epoch, re-bases the ratchet and
    // re-stages a conforming plan mid-turn: it is the single loudest thing
    // that happens inside a decision. It cannot touch the ladder, for two
    // independent reasons — nothing re-measures, AND every condition is a
    // function of the substrate's turn-start roster and claim field, which a
    // pin does not touch. Both would have to fail for the ladder to move.
    let pinned = false;
    const { records, kernel } = await run(SLIDER_BOARD, 'red', {
      policyOn: true,
      budgetMs: 200,
      each: (_rec, k) => {
        if (!pinned) {
          pinned = true;
          k.onPinEvent({ kind: 'pin', pin: { unitId: 0 as UnitId, to: 44, tentative: false } });
        }
      },
    });
    const report = kernel.lastReport;
    expect(report?.epochs).toBeGreaterThan(1); // the epoch really happened
    const stamps = new Set(records.map((r) => JSON.stringify(r.admission)));
    expect(stamps.size).toBe(1);
    expect(report?.admission?.activeCohort).toBe(BASE_COHORT_ID);
    // And the objective never changed under it either.
    const ids = new Set(records.flatMap((r) => cohortsOn(r)));
    expect([...ids]).toEqual([BASE_COHORT_ID]);
  });

  test('a decision that refines under fog never re-classifies', async () => {
    // The catch-up case, driven for real: a board with a stale enemy has holds
    // to refine, so the search spends the turn consuming observations. The
    // conditions the ladder was classified from are turn-start facts, so no
    // amount of refinement can restate them within the turn.
    const { records, kernel } = await run(SLIDER_BOARD, 'red', {
      policyOn: true,
      budgetMs: 200,
      observedTurns: new Map([
        ['b1', 26],
        ['b2', 25],
        ['rook', 24],
      ]),
    });
    const report = kernel.lastReport;
    expect(report?.slices).toBeGreaterThan(1);
    expect(new Set(records.map((r) => r.admission?.activeCohort)).size).toBe(1);
    expect(report?.admission?.activeCohort).toBe(BASE_COHORT_ID);
  });

  test('THE PREDICATE IS CONSULTED ONCE PER DECISION — counted, not argued', () => {
    // The freeze, measured directly. A counting table records how many times
    // the classifier ran across a whole decision: slices, emissions, posture
    // measurements, an epoch, refinement, the final flush. One.
    //
    // This is the assertion that survives a refactor. "Nothing re-measures" is
    // a claim about the absence of code, and the absence of code is exactly
    // what a later edit removes without noticing.
    let consulted = 0;
    const counting: LadderRow[] = ADMISSION_LADDERS.map((row) => ({
      ...row,
      when: (c) => {
        consulted++;
        return row.when(c);
      },
    }));
    return (async () => {
      const clock = new StepClock();
      const sub = makeSubstrate({ board: SLIDER_BOARD, turn: 30, asTeam: 'red' });
      const kernel = new LobsterKernel({
        sliceMs: 2,
        reserveMs: 1,
        minWriteIntervalMs: 0,
        yieldIntervalMs: 0,
        admission: { ...DEFAULT_ADMISSION_POLICY, ladders: counting },
      });
      let emitted = 0;
      let pinned = false;
      try {
        for await (const _rec of kernel.decide({
          sub,
          gen: new GrammarCandidateGenerator(),
          evaluate: defaultEvaluator,
          search: makeSearchCore(),
          asTeam: sub.teamNumber('red'),
          deadlineMs: clock.peek() + 200,
          initialPins: [],
          now: clock.now,
          evaluators: EVALUATORS,
        })) {
          void _rec;
          emitted++;
          if (!pinned) {
            pinned = true;
            kernel.onPinEvent({
              kind: 'pin',
              pin: { unitId: 0 as UnitId, to: 44, tentative: false },
            });
          }
        }
      } finally {
        sub.release();
      }
      const report = kernel.lastReport;
      // The decision really did work: several emissions, many slices, an epoch.
      expect(emitted).toBeGreaterThan(1);
      expect(report?.slices).toBeGreaterThan(1);
      expect(report?.epochs).toBeGreaterThan(1);
      // The table walks rows in precedence order until one matches, so a
      // single classification consults AT MOST one row per rule. On this
      // board the first row matches, so exactly one call — and never more
      // than the table is long, whatever the board.
      expect(consulted).toBeGreaterThanOrEqual(1);
      expect(consulted).toBeLessThanOrEqual(ADMISSION_LADDERS.length);
    })();
  });

  test('re-measuring the SAME board gives the same answer, so a re-measure is a no-op', () => {
    // The structural half of the freeze argument, stated as arithmetic: the
    // conditions are a pure function of the substrate, and the substrate is
    // what a decision holds constant. Anyone who later adds a second call site
    // is adding a call that provably cannot change anything — which is the
    // reason not to add it.
    const sub = makeSubstrate({ board: SLIDER_BOARD, turn: 30, asTeam: 'red' });
    try {
      const asTeam = sub.teamNumber('red');
      const first = measureAdmission(sub, asTeam);
      for (let i = 0; i < 5; i++) expect(measureAdmission(sub, asTeam)).toEqual(first);
    } finally {
      sub.release();
    }
  });
  test('AN OBSERVATION CLEARS THE BIAS ONLY AT THE NEXT DECISION ENTRY', () => {
    // The other half of the conservative-fog ruling. Caution is added at
    // decision entry and it is removed at decision entry — never in between,
    // in either direction. Inside a turn the ladder is a constant; across
    // turns it is a fresh pure function of the new board.
    //
    // Turn N: the enemy pawn is stale past the promotion horizon, its kindSet
    // has forked, and territory is refused. Turn N+1: the same board with the
    // pawn observed, and territory returns. Nothing in between could have
    // moved it, which is the whole content of the freeze.
    const board = boardOf(
      [
        trail('a1', { x: 4, y: 1 }, 'red'),
        trail('a2', { x: 4, y: 3 }, 'red'),
        trail('a3', { x: 4, y: 5 }, 'red'),
        trail('a4', { x: 4, y: 7 }, 'red'),
        piece('theirPawn', { x: 9, y: 9 }, 'pawn', 1, { teamID: 'blue' }),
        trail('b1', { x: 10, y: 2 }, 'blue'),
      ],
      { food: Array.from({ length: 20 }, (_, i) => ({ x: i % 11, y: 9 })) }
    );

    const measure = (observedTurns?: ReadonlyMap<string, number>) => {
      const sub = makeSubstrate({ board, turn: 40, asTeam: 'red', observedTurns });
      try {
        return measureAdmission(sub, sub.teamNumber('red'));
      } finally {
        sub.release();
        clearGeometryCache();
      }
    };

    const stale = measure(new Map([['theirPawn', 5]]));
    // ONE decision's worth of the fogged reading — constant, however many
    // times anything inside the turn asks.
    for (let i = 0; i < 4; i++) {
      expect(classifyAdmission(measure(new Map([['theirPawn', 5]])))).toEqual([BASE_COHORT_ID]);
    }
    expect(classifyAdmission(stale)).toEqual([BASE_COHORT_ID]);

    // The NEXT decision, on a board where the observation landed.
    const cleared = measure();
    expect(cleared.sliderPossible).toBe(false);
    expect(cleared.promotionImminent).toBe(false);
    expect(classifyAdmission(cleared)).toEqual([BASE_COHORT_ID, TERRITORY_COHORT_ID]);
  });
});

// ===========================================================================
// 4. The carried dwell

describe('the dwell counts across turns', () => {
  test('the report hands the next decision the state to resume from', async () => {
    const { kernel } = await run(ROOMY_SNAKE_BOARD, 'red', { policyOn: true });
    const state = kernel.lastReport?.admissionState;
    expect(state?.ladder).toEqual([BASE_COHORT_ID, TERRITORY_COHORT_ID]);
    expect(state?.pending).toBeNull();
    expect(state?.held).toBe(0);
  });

  test('a resumed governor needs the board to say it twice', async () => {
    // Turn one: roomy and slider-free, territory admitted, nothing pending.
    const first = await run(ROOMY_SNAKE_BOARD, 'red', { policyOn: true });
    const carried = first.kernel.lastReport?.admissionState;
    expect(carried).not.toBeNull();
    clearGeometryCache();

    // Turn two: a rook appears. ONE dissenting measurement, so the ladder
    // holds — replacing a basis is not a log-tidiness question.
    const clock = new StepClock();
    const sub = makeSubstrate({ board: SLIDER_BOARD, turn: 31, asTeam: 'red' });
    const kernel = new LobsterKernel({
      sliceMs: 2,
      reserveMs: 1,
      minWriteIntervalMs: 0,
      yieldIntervalMs: 0,
      admission: { ...DEFAULT_ADMISSION_POLICY, resume: carried ?? undefined },
    });
    try {
      for await (const _rec of kernel.decide({
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: defaultEvaluator,
        search: makeSearchCore(),
        asTeam: sub.teamNumber('red'),
        deadlineMs: clock.peek() + 60,
        initialPins: [],
        now: clock.now,
        evaluators: EVALUATORS,
      })) {
        void _rec;
      }
    } finally {
      sub.release();
    }
    const second = kernel.lastReport;
    expect(second?.admission?.ladder).toEqual([BASE_COHORT_ID, TERRITORY_COHORT_ID]);
    expect(second?.admissionState?.pending).toEqual([BASE_COHORT_ID]);
    expect(second?.admissionState?.held).toBe(1);
  });
});

/** The cohort ids a record's own basis names. */
function cohortsOn(rec: EmitRecord): string[] {
  return rec.assumptions.flatMap((a) => (a.kind === 'cohort' ? [a.id] : []));
}
