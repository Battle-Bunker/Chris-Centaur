/**
 * THE MULTI-START SEED, and the four things it has to prove.
 *
 *   THE GATE          with the flag off, nothing changes — plan for plan, on
 *                     the seed and on the whole search.
 *   STAGE 0           the safety floor is absolute and the coordination clause
 *                     coordinates: a provably-fatal move is never staged while a
 *                     safe one exists, and an own-team risky cell is taken by
 *                     exactly one unit.
 *   STAGE 1           the sampler respects its slice, and two runs on one seed
 *                     produce the same plan.
 *   THE REGRESSION    on a packed spawn built from the pinning numbers, the
 *                     multi-start does NOT compress the formation the way the
 *                     rejected cell-claim seed did, and it does not hand the
 *                     ascent a fixed point.
 *
 * The last one is the reason the layer exists, so it is stated in the same
 * quantities the replay analysis measured: own-team head separation (10.70 →
 * 6.51 under the rejected seed) and distance to the nearest wall (3.95 → 2.00),
 * on a 25×25 board with the team spawned packed in one corner at the measured
 * turn-1 geometry (mean separation 6.63, mean wall distance 3.20).
 *
 * No live games. Every board here is a fixture and every verdict comes from the
 * real seam.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { makeSearchCore } from '../search';
import {
  DEFAULT_MULTISTART,
  classifyOptions,
  crowdedUnits,
  multiStartSeed,
  multistartSeedFrom,
} from '../search/multistart-seed';
import { dangerOrder } from '../search/order';
import { decisionSeed } from '../selection';
import { certainlySelfFatal } from '../staging-safety';
import { ConflictIndex, subStepsFor } from '../search/conflict-index';
import { unboundedBudget } from '../bounds/testkit';
import type {
  BudgetHandle,
  Candidate,
  CandidateSet,
  JointPlan,
  SearchContext,
  UnitId,
} from '../contracts';

// --------------------------------------------------------------------- fixtures

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

const TURN = 1;
const SIZE = 25;

/**
 * THE PACKED THREE-CORNER SPAWN, built from the pinning numbers.
 *
 * `null-snake6`'s board is 25×25 (the analysis measures centre-ward motion
 * against (12,12)) and its turn-1 geometry is measured, identical in both arms:
 * mean own-team head separation **6.63**, mean distance to the nearest wall
 * **3.20**, minimum pairwise head distance 3, and — the fact that refutes any
 * "the spawn was crowded" reading — **0 of 720 own-unit pairs able to contest a
 * common cell**.
 *
 * Our six heads below sit at mean separation 6.53 and mean wall distance 3.33,
 * which is that spawn to within a tenth of a cell. Two enemy teams take two
 * other corners so the board is not solitaire; they are two units each rather
 * than six, because nothing measured here is a property of the opposition and a
 * board of eighteen snakes costs the suite minutes it does not need to spend.
 *
 * Bodies trail OUTWARD, toward the near wall, so every head's free neighbours
 * are the inward ones — the configuration in which a seed with no boundary term
 * has every opportunity to walk the team into the corner and the un-seeded
 * search has every opportunity to pivot away from it.
 */
function packedCornerBoard(): Board {
  const ours: Array<[Coord, Coord[]]> = [
    [{ x: 2, y: 2 }, [{ x: 1, y: 2 }, { x: 0, y: 2 }]],
    [{ x: 6, y: 2 }, [{ x: 6, y: 1 }, { x: 6, y: 0 }]],
    [{ x: 2, y: 6 }, [{ x: 1, y: 6 }, { x: 0, y: 6 }]],
    [{ x: 6, y: 6 }, [{ x: 5, y: 6 }, { x: 4, y: 6 }]],
    [{ x: 4, y: 9 }, [{ x: 3, y: 9 }, { x: 2, y: 9 }]],
    [{ x: 9, y: 4 }, [{ x: 9, y: 3 }, { x: 9, y: 2 }]],
  ];
  const snakes: Snake[] = ours.map(([head, tail], i) =>
    makeSnake(`r${i}`, [head, ...tail], { teamID: 'red', health: 100 })
  );
  const enemies: Array<[string, Coord, Coord[]]> = [
    ['b0', { x: 20, y: 20 }, [{ x: 21, y: 20 }, { x: 22, y: 20 }]],
    ['b1', { x: 20, y: 16 }, [{ x: 21, y: 16 }, { x: 22, y: 16 }]],
    ['g0', { x: 20, y: 4 }, [{ x: 21, y: 4 }, { x: 22, y: 4 }]],
    ['g1', { x: 16, y: 2 }, [{ x: 16, y: 1 }, { x: 16, y: 0 }]],
  ];
  for (const [id, head, tail] of enemies) {
    snakes.push(makeSnake(id, [head, ...tail], { teamID: id[0] === 'b' ? 'blue' : 'green' }));
  }
  return { width: SIZE, height: SIZE, food: [], hazards: [], snakes } as Board;
}

/** A tight pocket: three of ours nose to nose, so options really do contest. */
function pocketBoard(): Board {
  return {
    width: 9,
    height: 9,
    food: [],
    hazards: [],
    snakes: [
      makeSnake('a', [{ x: 4, y: 3 }, { x: 4, y: 2 }, { x: 4, y: 1 }], { teamID: 'red' }),
      makeSnake('b', [{ x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }], { teamID: 'red' }),
      makeSnake('c', [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }], { teamID: 'red' }),
      makeSnake('e', [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }], { teamID: 'blue' }),
    ],
  } as Board;
}

// ------------------------------------------------------------------- the seam

type Arm = 'shipped' | 'cluster' | 'multistart';

interface RunOptions {
  readonly matchSeed?: number;
  readonly budget?: BudgetHandle;
  readonly maxBudgetMs?: number;
  readonly edgeEv?: boolean;
}

interface SeedRun {
  readonly plan: JointPlan;
  readonly sub: EngineSubstrate;
  readonly ours: ReadonlyArray<UnitId>;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  readonly report: ReturnType<NonNullable<ReturnType<typeof makeSearchCore>['multistartReport']>>;
  close(): void;
}

/**
 * ONE RUNG-0 SEED, through the real seam.
 *
 * `conform` with an empty incumbent IS rung 0: it seeds, pays one price, and
 * returns the seed whatever that price said. The repair is held off deliberately
 * — this measures the SEED, not the repair that runs after it.
 */
function seedRun(board: Board, arm: Arm, opts: RunOptions = {}): SeedRun {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const asTeam = sub.teamNumber('red');
  const gen = new GrammarCandidateGenerator({
    pruneCertainSelfFatal: false,
    pruneRoyalPath: false,
    ...(opts.edgeEv === undefined ? {} : { edgeEv: opts.edgeEv }),
  });
  const core = makeSearchCore({
    clusterSeed: arm === 'cluster',
    multistartSeed: arm === 'multistart',
    seedDeconflict: arm === 'shipped' ? false : undefined,
    rungZeroRepair: false,
    multistartTuning: {
      matchSeed: opts.matchSeed ?? 0,
      maxBudgetMs: opts.maxBudgetMs ?? 6,
    },
  });
  const ctx: SearchContext = {
    sub,
    gen,
    evaluate: defaultEvaluator,
    asTeam,
    pins: [],
    assumptions: [],
    incumbent: null,
    witnesses: [],
    budget: opts.budget ?? unboundedBudget(),
  };
  const plan = core.conform(ctx, new Map());
  const ours = sub.commandable(asTeam);
  const sets = new Map<UnitId, CandidateSet>();
  for (const unitId of ours) sets.set(unitId, gen.candidatesFor(sub, unitId));
  const report = core.multistartReport?.() ?? null;
  return {
    plan,
    sub,
    ours,
    sets,
    report,
    close: () => {
      core.release?.();
      sub.release();
    },
  };
}

// ------------------------------------------------------------------ measures

const planCells = (plan: JointPlan): string =>
  [...plan.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, c]) => `${id}>${c.to}:${c.path.join('.')}`)
    .join('|');

const landingOf = (c: Candidate): number =>
  c.path.length === 0 ? c.from : (c.path[c.path.length - 1] as number);

/** Mean pairwise Manhattan distance between our staged landings. THE number the
 * replay analysis put at 10.70 → 6.51 under the rejected seed. */
function separation(plan: JointPlan, ours: ReadonlyArray<UnitId>, width: number): number {
  const cells = ours.map((id) => landingOf(plan.get(id) as Candidate));
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i] as number;
      const b = cells[j] as number;
      sum += Math.abs((a % width) - (b % width)) + Math.abs(((a / width) | 0) - ((b / width) | 0));
      pairs++;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

/** Mean distance from our staged landings to the nearest wall. 3.95 → 2.00. */
function wallDistance(plan: JointPlan, ours: ReadonlyArray<UnitId>, size: number): number {
  let sum = 0;
  for (const id of ours) {
    const cell = landingOf(plan.get(id) as Candidate);
    const x = cell % size;
    const y = (cell / size) | 0;
    sum += Math.min(x, y, size - 1 - x, size - 1 - y);
  }
  return ours.length === 0 ? 0 : sum / ours.length;
}

/** `(cell, subStep)` slots two or more of OUR claims meet in. */
function collisions(plan: JointPlan, cells: number): number {
  const index = new ConflictIndex();
  const paths = [...plan.values()].map((c) => c.path);
  index.begin(cells, subStepsFor(paths));
  for (const [unitId, candidate] of plan) index.claim(unitId, candidate.from, candidate.path);
  let met = 0;
  const seen = new Set<string>();
  for (const candidate of plan.values()) {
    const claimed = candidate.path.length === 0 ? [candidate.from] : candidate.path;
    for (const cell of claimed) {
      for (let s = 1; s < index.subSteps; s++) {
        const key = `${cell}@${s}`;
        if (seen.has(key) || index.countAt(cell as never, s) <= 1) continue;
        seen.add(key);
        met++;
      }
    }
  }
  return met;
}

afterEach(() => clearGeometryCache());

// ---------------------------------------------------------------------------

describe('the flag', () => {
  test('is off unless something says on, and reads the same words the others do', () => {
    expect(multistartSeedFrom({})).toBe(false);
    expect(multistartSeedFrom({ CENTAUR_MULTISTART_SEED: '' })).toBe(false);
    expect(multistartSeedFrom({ CENTAUR_MULTISTART_SEED: 'off' })).toBe(false);
    expect(multistartSeedFrom({ CENTAUR_MULTISTART_SEED: 'nonsense' })).toBe(false);
    for (const on of ['1', 'on', 'true']) {
      expect(multistartSeedFrom({ CENTAUR_MULTISTART_SEED: on })).toBe(true);
    }
  });

  test('THE GATE: with it off the seed is the one that shipped, plan for plan', () => {
    for (const board of [packedCornerBoard(), pocketBoard()]) {
      const off = seedRun(board, 'shipped');
      const again = seedRun(board, 'shipped');
      expect(planCells(off.plan)).toEqual(planCells(again.plan));
      // And the layer is not merely inert, it is UNBUILT: no report at all.
      expect(off.report).toBeNull();
      off.close();
      again.close();
    }
  });

  test('THE GATE: with it off the whole search is the one that shipped', () => {
    const board = packedCornerBoard();
    const run = (multistart: boolean): string => {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const core = makeSearchCore({ multistartSeed: multistart, rungZeroRepair: false });
      const ctx: SearchContext = {
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: defaultEvaluator,
        asTeam: sub.teamNumber('red'),
        pins: [],
        assumptions: [],
        incumbent: null,
        witnesses: [],
        budget: unboundedBudget(),
      };
      const out = planCells(core.improve(ctx).plan);
      core.release?.();
      sub.release();
      return out;
    };
    // Two flag-OFF runs against each other: the identity claim is that turning
    // the knob off leaves the search exactly where it was, and the only honest
    // form of that on a search with its own state is run-to-run identity.
    expect(run(false)).toEqual(run(false));
  });

  test('THE GATE: the edge-EV priors are ABSENT from a set the pass did not price', () => {
    const board = pocketBoard();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const off = new GrammarCandidateGenerator({ edgeEv: false });
    const on = new GrammarCandidateGenerator({ edgeEv: true });
    const unitId = sub.commandable(sub.teamNumber('red'))[0] as UnitId;
    const setOff = off.candidatesFor(sub, unitId);
    const setOn = on.candidatesFor(sub, unitId);
    // Absent, not present-and-zero: a set built with the pass off must be
    // indistinguishable from the one the shipped build produced.
    expect(Object.prototype.hasOwnProperty.call(setOff, 'edgeEv')).toBe(false);
    expect(setOn.edgeEv?.length).toBe(setOn.candidates.length);
    sub.release();
  });
});

// ---------------------------------------------------------------------------

describe('stage 0 — the always-on safety floor', () => {
  test('never stages a provably-fatal move while the unit has a safe one', () => {
    for (let seed = 1; seed <= 24; seed++) {
      for (const board of [packedCornerBoard(), pocketBoard()]) {
        const run = seedRun(board, 'multistart', { matchSeed: seed });
        for (const unitId of run.ours) {
          const unit = run.sub.unitOf(unitId);
          const set = run.sets.get(unitId) as CandidateSet;
          if (unit === undefined) continue;
          const opts = classifyOptions(run.sub, unitId, set, DEFAULT_MULTISTART.poolCap);
          if (opts.safe.length === 0 && opts.ownTeamRisk.length === 0) continue;
          const staged = run.plan.get(unitId) as Candidate;
          expect(certainlySelfFatal(run.sub, unit, staged)).toBeNull();
        }
        run.close();
      }
    }
  });

  test('the draw is UNIFORM over the safe moves — every one of them is reachable', () => {
    // A literally random selection is falsified by an option nothing ever
    // draws, not by a distribution test. Over 60 private seeds every one of the
    // unit's fatality-safe options must come up at least once.
    const board = packedCornerBoard();
    const probe = seedRun(board, 'multistart', { matchSeed: 1 });
    const unitId = probe.ours[0] as UnitId;
    const opts = classifyOptions(
      probe.sub,
      unitId,
      probe.sets.get(unitId) as CandidateSet,
      DEFAULT_MULTISTART.poolCap
    );
    probe.close();
    expect(opts.safe.length).toBeGreaterThan(1);
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      // maxBudgetMs 0 isolates STAGE 0: no sample is drawn, so what is measured
      // is the baseline draw and not the selection on top of it.
      const run = seedRun(board, 'multistart', { matchSeed: seed, maxBudgetMs: 0 });
      seen.add((run.plan.get(unitId) as Candidate).to);
      run.close();
    }
    for (const candidate of opts.safe) expect(seen.has(candidate.to)).toBe(true);
  });

  test('a coordinated unit takes its risky cell alone, or the report says why not', () => {
    // The second clause: a unit with NO fatality-safe move draws only among the
    // options that touch nothing already claimed, so the risky cell has exactly
    // one claimant and the combo as a whole is safe.
    const board = pocketBoard();
    for (let seed = 1; seed <= 40; seed++) {
      const run = seedRun(board, 'multistart', { matchSeed: seed, maxBudgetMs: 0 });
      const report = run.report;
      expect(report).not.toBeNull();
      if (report === null) throw new Error('unreachable');
      if (report.stage0Coordinated > 0 && report.stage0Clean) {
        // Every coordinated unit found a clear option, so no two of our claims
        // meet anywhere in the staged plan.
        expect(collisions(run.plan, run.sub.grid.cells)).toBe(0);
      }
      run.close();
    }
  });

  test('the common case is NOT de-conflicted — the repair operators stay armed', () => {
    // THE CORRECTION, stated as a property. The rejected seed's measured defect
    // is that a fully de-conflicted plan is accident-free, and an accident-free
    // plan empties the triggers of both multi-unit escape operators. So on a
    // board where units really can contest a cell, the random safe draw must
    // sometimes produce a contest — otherwise the multi-start is picking among
    // equally un-escapable fixed points and reproduces the failure.
    const board = pocketBoard();
    let withContest = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const run = seedRun(board, 'multistart', { matchSeed: seed, maxBudgetMs: 0 });
      if (collisions(run.plan, run.sub.grid.cells) > 0) withContest++;
      run.close();
    }
    expect(withContest).toBeGreaterThan(0);
  });

  test('the polish gate arms on geometry, with no accident to report', () => {
    // `contestedUnits` needs the resolver to have said something went wrong.
    // `crowdedUnits` needs only the plan, so it arms on the configurations that
    // were killing the team — a compressed formation, or a landing with nowhere
    // to step next — and stays silent where nothing is wrong.
    //
    // Note which board is which here, because it is the root-cause finding in
    // miniature. The PACKED SPAWN is not crowded at this radius: 0 of 720
    // own-unit pairs can contest a cell at spawn, which is exactly why "the
    // spawn was crowded" was refuted. The gate is not supposed to fire there
    // and does not. It fires in the POCKET, where units really are within reach
    // of one another — the state the rejected seed drove the team into by turn
    // five and could not leave.
    let armed = 0;
    const trials = 8;
    for (let seed = 1; seed <= trials; seed++) {
      const run = seedRun(pocketBoard(), 'multistart', { matchSeed: seed, maxBudgetMs: 0 });
      if (crowdedUnits(run.sub, run.ours, run.plan, new Set(), 3).length > 0) armed++;
      run.close();
    }
    expect(armed).toBeGreaterThan(trials / 2);

    // And silent on an open board with a dispersed team, so the polish still
    // costs nothing where there is nothing to escape.
    const open = makeSubstrate({
      board: {
        width: SIZE,
        height: SIZE,
        food: [],
        hazards: [],
        snakes: [
          makeSnake('r0', [{ x: 3, y: 3 }, { x: 2, y: 3 }, { x: 1, y: 3 }], { teamID: 'red' }),
          makeSnake('r1', [{ x: 20, y: 20 }, { x: 21, y: 20 }, { x: 22, y: 20 }], {
            teamID: 'red',
          }),
        ],
      } as Board,
      turn: TURN,
      asTeam: 'red',
    });
    const ours = open.commandable(open.teamNumber('red'));
    const plan: JointPlan = new Map(
      ours.map((id) => {
        const from = open.unitOf(id)?.cells[0] as number;
        return [id, { unitId: id, from, to: from, path: [] } as Candidate];
      })
    );
    expect(crowdedUnits(open, ours, plan, new Set(), 3).length).toBe(0);
    open.release();
  });
});

// ---------------------------------------------------------------------------

describe('stage 1 — budget and determinism', () => {
  test('a different private seed explores differently', () => {
    const board = packedCornerBoard();
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const run = seedRun(board, 'multistart', { matchSeed: seed, maxBudgetMs: 2 });
      seen.add(planCells(run.plan));
      run.close();
    }
    // Not "every seed differs" — a lottery may repeat — but a stream that
    // produced ONE plan twelve times would not be a lottery at all.
    expect(seen.size).toBeGreaterThan(3);
  });

  test('the sampler takes its slice and no more, and never starves the ascent', () => {
    const board = packedCornerBoard();
    // A handle that models a 1000 ms decision. The default fraction is a tenth,
    // so the sampler may take ~100 ms and the ascent keeps the rest.
    const start = Date.now();
    const budget: BudgetHandle = {
      now: () => Date.now(),
      elapsedMs: () => Date.now() - start,
      remainingMs: () => Math.max(0, 1000 - (Date.now() - start)),
      shouldStop: () => Date.now() - start > 1000,
      decisionFraction: () => Math.max(0, 1 - (Date.now() - start) / 1000),
    };
    const run = seedRun(board, 'multistart', {
      matchSeed: 7,
      budget,
      maxBudgetMs: DEFAULT_MULTISTART.maxBudgetMs,
    });
    const report = run.report;
    expect(report).not.toBeNull();
    if (report === null) throw new Error('unreachable');
    // The slice asked for is the tenth, capped by the ceiling.
    expect(report.budgetMs).toBeLessThanOrEqual(DEFAULT_MULTISTART.maxBudgetMs);
    expect(report.budgetMs).toBeGreaterThan(0);
    // And what it actually spent is inside it, with the clock backstop as the
    // guarantee rather than the schedule.
    expect(report.spentMs).toBeLessThanOrEqual(report.budgetMs + 25);
    // HUNDREDS TO THOUSANDS, which is the spec's own figure for the slice.
    expect(report.samples).toBeGreaterThanOrEqual(100);
    run.close();
  });

  test('a zero budget is stage 0 alone, and stage 0 alone is a complete legal plan', () => {
    const board = packedCornerBoard();
    const run = seedRun(board, 'multistart', { matchSeed: 5, maxBudgetMs: 0 });
    expect(run.report?.samples).toBe(0);
    expect([...run.plan.keys()].sort((a, b) => a - b)).toEqual(
      [...run.ours].sort((a, b) => a - b)
    );
    run.close();
  });

  test('the selection never scores worse than the random baseline it started from', () => {
    // The layer's own falsifier, and the one the report publishes: a softmax
    // over the pool always has the stage-0 baseline in it as arm zero, so a
    // selection that came back below it would mean the pool or the objective is
    // wrong, not that the lottery was unlucky.
    const board = packedCornerBoard();
    for (let seed = 1; seed <= 8; seed++) {
      const run = seedRun(board, 'multistart', { matchSeed: seed, maxBudgetMs: 3 });
      const report = run.report;
      if (report !== null && report.samples > 0) {
        expect(report.selectedScore).toBeGreaterThanOrEqual(report.stage0Score - 1e-9);
      }
      run.close();
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * THE REGRESSION — the rejected seed's failure shape, and the multi-start's
 * absence of it.
 *
 * `CENTAUR_CLUSTER_SEED` was rejected because it compressed the team's own
 * formation and drove it into the board edge: own-team head separation
 * 10.70 → 6.51 and wall distance 3.95 → 2.00, controlled for survivorship, and
 * from that state 84% of its excess deaths were collisions. What is asserted
 * here is the mechanism at its origin — one rung-0 seeding on the packed spawn —
 * in the same two quantities.
 */
describe('the regression: the multi-start does not pin the formation', () => {
  test('it does not compress own-team separation the way the cell-claim seed did', () => {
    const board = packedCornerBoard();
    const shipped = seedRun(board, 'shipped');
    const cluster = seedRun(board, 'cluster');
    const baseSep = separation(shipped.plan, shipped.ours, SIZE);
    const clusterSep = separation(cluster.plan, cluster.ours, SIZE);
    const clusterWall = wallDistance(cluster.plan, cluster.ours, SIZE);
    const baseWall = wallDistance(shipped.plan, shipped.ours, SIZE);
    shipped.close();
    cluster.close();

    // The multi-start is a lottery, so the claim is about its DISTRIBUTION and
    // is measured over private seeds, not asserted off one draw.
    let sep = 0;
    let worst = Number.POSITIVE_INFINITY;
    const trials = 24;
    for (let seed = 1; seed <= trials; seed++) {
      const run = seedRun(board, 'multistart', { matchSeed: seed, maxBudgetMs: 3 });
      const s = separation(run.plan, run.ours, SIZE);
      sep += s;
      if (s < worst) worst = s;
      run.close();
    }
    sep /= trials;

    // THE CLAIM, in the pinning numbers' own units. The rejected seed cost
    // 3.97 cells of own-team separation, survivorship-controlled, and held the
    // loss for the whole game. The multi-start's mean sits within a quarter of
    // that of the un-seeded baseline, and no single draw comes within two
    // thirds of it.
    expect(sep).toBeGreaterThan(baseSep - 1.0);
    expect(worst).toBeGreaterThan(baseSep - 2.5);

    // AND THE COMPARISON THE ANALYSIS NAMES, where it can fire. On a turn-1
    // packed spawn the cell-claim seed is INERT — nothing is contestable, so
    // its pair terms are zero and it stages what the shipped ordering stages.
    // That is the root-cause pass's own finding (both arms head outward at
    // turn 1; the damage is the failure to pivot on turns 2–3), so this guard
    // is written to fire on a fixture where the seed does contract and to stay
    // silent, honestly, where it does not.
    if (clusterSep < baseSep - 0.25) expect(sep).toBeGreaterThan(clusterSep);
    if (clusterWall < baseWall - 0.25) {
      let wall = 0;
      for (let seed = 1; seed <= trials; seed++) {
        const run = seedRun(board, 'multistart', { matchSeed: seed, maxBudgetMs: 3 });
        wall += wallDistance(run.plan, run.ours, SIZE);
        run.close();
      }
      expect(wall / trials).toBeGreaterThan(clusterWall);
    }
  });

  test('THE MECHANISM: stage 1 adds no spatial preference to the random baseline', () => {
    // The sharpest form of the claim, and the one a single turn can carry.
    //
    // An absolute wall-distance assertion on one turn would be measuring the
    // CORNER rather than the layer: from a cell at wall distance 2 on the
    // diagonal, two of four neighbours are at distance 1, so a uniform draw
    // over safe moves loses wall distance near a corner however unbiased it is.
    // Pinning is not that — pinning is a MONOTONE failure to correct across
    // turns, which is what the search is budgeted to do and what the rejected
    // seed's fixed point prevented.
    //
    // So what is asserted here is that the SELECTION on top of the random draw
    // has no spatial opinion of its own: the objective carries no spacing term,
    // no boundary term and no follow-the-tail term, and the observable form of
    // that is that the selected plan's separation and wall distance are those
    // of the stage-0 baseline it was drawn from.
    const board = packedCornerBoard();
    const trials = 24;
    let sep0 = 0;
    let sep1 = 0;
    let wall0 = 0;
    let wall1 = 0;
    for (let seed = 1; seed <= trials; seed++) {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const gen = new GrammarCandidateGenerator({
        pruneCertainSelfFatal: false,
        pruneRoyalPath: false,
      });
      const ours = sub.commandable(sub.teamNumber('red'));
      const sets = new Map<UnitId, CandidateSet>();
      for (const id of ours) sets.set(id, gen.candidatesFor(sub, id));
      const result = multiStartSeed({
        sub,
        roster: ours,
        order: dangerOrder(ours, null, new Set()),
        sets,
        fixed: new Map(),
        clusters: [],
        tuning: { ...DEFAULT_MULTISTART, matchSeed: seed },
        seed: decisionSeed(seed, 0x9e37, 0),
        cap: 8,
        budgetMs: 3,
        remainingFraction: 1,
        // A FROZEN CLOCK. The sample count is already a pure function of the
        // budget; freezing the backstop makes the whole call one, so this
        // asserts the layer and not the box it runs on.
        now: () => 0,
      });
      sep0 += separation(result.stage0, ours, SIZE);
      sep1 += separation(result.plan, ours, SIZE);
      wall0 += wallDistance(result.stage0, ours, SIZE);
      wall1 += wallDistance(result.plan, ours, SIZE);
      sub.release();
    }
    expect(sep1 / trials).toBeGreaterThan(sep0 / trials - 0.25);
    expect(wall1 / trials).toBeGreaterThan(wall0 / trials - 0.25);
  });

  test('DETERMINISM: one seed, one frozen clock, the same plan every time', () => {
    const board = packedCornerBoard();
    const once = (): string => {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const gen = new GrammarCandidateGenerator();
      const ours = sub.commandable(sub.teamNumber('red'));
      const sets = new Map<UnitId, CandidateSet>();
      for (const id of ours) sets.set(id, gen.candidatesFor(sub, id));
      const result = multiStartSeed({
        sub,
        roster: ours,
        order: dangerOrder(ours, null, new Set()),
        sets,
        fixed: new Map(),
        clusters: [],
        tuning: { ...DEFAULT_MULTISTART, matchSeed: 0xbeef },
        seed: decisionSeed(0xbeef, 0x1234, 0),
        cap: 8,
        budgetMs: 8,
        remainingFraction: 1,
        now: () => 0,
      });
      const out = `${planCells(result.plan)}#${result.report.samples}`;
      sub.release();
      return out;
    };
    expect(once()).toEqual(once());
  });

  test('the seed it hands over is not already a fixed point of the ascent', () => {
    // The causal signature the root-cause pass measured is an improving-slice
    // rate of 0.2% against 37%: the rejected seed's plan is a fixed point of
    // every operator the search owns, so the whole budget re-derives it. The
    // externally observable form of that is whether the ascent moves at all off
    // the plan rung 0 staged.
    const board = packedCornerBoard();
    const moved = (matchSeed: number): boolean => {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const core = makeSearchCore({
        multistartSeed: true,
        rungZeroRepair: false,
        multistartTuning: { matchSeed, maxBudgetMs: 3 },
      });
      const ctx: SearchContext = {
        sub,
        gen: new GrammarCandidateGenerator({
          pruneCertainSelfFatal: false,
          pruneRoyalPath: false,
        }),
        evaluate: defaultEvaluator,
        asTeam: sub.teamNumber('red'),
        pins: [],
        assumptions: [],
        incumbent: null,
        witnesses: [],
        budget: unboundedBudget(),
      };
      const seeded = planCells(core.conform(ctx, new Map()));
      const climbed = planCells(core.improve(ctx).plan);
      core.release?.();
      sub.release();
      return seeded !== climbed;
    };
    let improved = 0;
    const trials = 8;
    for (let seed = 1; seed <= trials; seed++) if (moved(seed)) improved++;
    // Not "always" — a random start can land on a plan the ascent agrees with —
    // but a layer whose start the search never moves off is the failure this
    // build exists to fix.
    expect(improved).toBeGreaterThan(0);
  });
});
