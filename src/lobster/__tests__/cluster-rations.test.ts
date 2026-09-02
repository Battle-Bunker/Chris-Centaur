/**
 * THE TWO ENUMERATION RATIONS, AND THE ROWS THAT MAKE THEM READABLE.
 *
 * Batch `20260831-batch2` priced the enumeration per decision over 2,472 games
 * and found two cost regimes that want opposite remedies:
 *
 *     board             roster              ms/decision  joints  ms/joint
 *     null-snake6       6 snakes                   18.3    41.0      0.45
 *     snake5-knight     5 snakes + KNIGHT          18.0    42.5      0.42
 *     snake5-queen      5 snakes + QUEEN          223.8    52.9      4.23
 *     headline-mix-king mixed + king              474.5  2471.1      0.19
 *
 * A knight costs nothing, so the axis is REACH and not piece-presence; a queen
 * costs twelve times a knight on 1.25× the clusters, so its cost is BIGGER
 * clusters rather than more of them (the SLIDER regime, which wants a size
 * ration); and the mix-king boards are 47× the clusters at a twentieth of the
 * cost each (the CROWD regime, which wants a count ration).
 *
 * Four things are asserted here, and the last two are the ones a future sweep
 * depends on:
 *
 *  1. THE COST ESTIMATE TRACKS REACH. A queen board's worst cluster is an order
 *     of magnitude more arithmetic than a snake board's, on comparable rosters.
 *  2. BOTH RATIONS ENGAGE, and degrade to COARSER PRICING rather than to
 *     nothing: every proposal is still a complete legal plan over the roster.
 *  3. THE DEFAULTS ARE CEILINGS. At the shipped settings neither ration fires
 *     on any board this program measures, so the shipped bot decides exactly
 *     what it decided before — which is what makes them safe to ship at all.
 *  4. THE ROWS ARE PUBLISHED. `cells`, `worstClusterCells`, `rungRation` and
 *     `clustersRationed` come out of the enumeration, so the next sweep reads
 *     per-cluster cost off a mechanism row instead of off a stopwatch.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import type { Candidate, CandidateSet, JointPlan, UnitId } from '../contracts';
import { clearGeometryCache, makeSubstrate, type EngineSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import {
  DEFAULT_CLUSTER_TUNING,
  enumerateProposals,
  partitionOf,
  type ClusterTuning,
  type Partition,
} from '../search';
import { botConfigFromJson, resolveBotConfig } from '../bot-config';

const TURN = 22;

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

/** Five of ours around a hub of `kind`, on a board wide enough for a ray. */
function hubBoard(kind: string | undefined): Board {
  const snakes: Snake[] = [
    makeSnake('h', [{ x: 6, y: 6 }], kind === undefined ? { teamID: 'red' } : { teamID: 'red', unitType: kind }),
  ];
  // Four trail units around the hub, each body pointing AWAY from it: an
  // overlapping turn-start cell is not a reachable board and the substrate
  // refuses one outright.
  const seats: ReadonlyArray<readonly [Coord, number]> = [
    [{ x: 4, y: 4 }, -1],
    [{ x: 8, y: 4 }, -1],
    [{ x: 4, y: 8 }, +1],
    [{ x: 8, y: 8 }, +1],
  ];
  seats.forEach(([at, dy], i) => {
    snakes.push(
      makeSnake(
        `s${i}`,
        [at, { x: at.x, y: at.y + dy }, { x: at.x, y: at.y + 2 * dy }],
        { teamID: 'red' }
      )
    );
  });
  snakes.push(makeSnake('e', [{ x: 6, y: 11 }, { x: 6, y: 12 }], { teamID: 'blue' }));
  return { width: 13, height: 13, food: [], hazards: [], snakes } as unknown as Board;
}

interface Bench {
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly sets: Map<UnitId, CandidateSet>;
  readonly roster: ReadonlyArray<UnitId>;
  readonly partition: Partition;
  close(): void;
}

function bench(board: Board): Bench {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const asTeam = sub.teamNumber('red');
  const gen = new GrammarCandidateGenerator({});
  const roster = sub.commandable(asTeam);
  const sets = new Map<UnitId, CandidateSet>();
  for (const unitId of roster) sets.set(unitId, gen.candidatesFor(sub, unitId));
  const partition = partitionOf({ sub, roster, fixed: new Set<UnitId>() });
  return { sub, asTeam, sets, roster, partition, close: () => sub.release() };
}

const run = (b: Bench, over: Partial<ClusterTuning> = {}, shouldStop?: () => boolean) =>
  enumerateProposals({
    sub: b.sub,
    partition: b.partition,
    roster: b.roster,
    sets: b.sets,
    fixed: new Map<UnitId, Candidate>(),
    doomed: new Set<UnitId>(),
    asTeam: b.asTeam,
    tuning: { ...DEFAULT_CLUSTER_TUNING, ...over },
    salt: 0x5eed,
    ...(shouldStop === undefined ? {} : { shouldStop }),
  });

/** Every proposal is a complete legal plan over the whole roster (L22). */
function assertWholePlans(plans: ReadonlyArray<JointPlan>, b: Bench): void {
  for (const plan of plans) {
    expect(plan.size).toBe(b.roster.length);
    for (const unitId of b.roster) {
      const chosen = plan.get(unitId) as Candidate;
      expect(chosen).toBeDefined();
      const set = b.sets.get(unitId) as CandidateSet;
      expect(
        set.candidates.includes(chosen) || set.prunedLedger.some((e) => e.candidate === chosen)
      ).toBe(true);
    }
  }
}

afterEach(() => clearGeometryCache());

// ------------------------------------------------------- 1. the cost estimate

describe('the per-cluster cost is published, and it is the number the rations read', () => {
  test('the rows exist, and they price the arithmetic the partition actually asks for', () => {
    const queen = bench(hubBoard('queen'));
    const plain = bench(hubBoard(undefined));
    try {
      const q = run(queen).stats;
      const p = run(plain).stats;

      // The SLIDER board pays for conditioning terms the pieceless board does
      // not have: the hub is an outer coordinate, every cluster is solved
      // against it both ways, and every one of those cells walks the ray. The
      // pieceless board's partition is singletons with no slider, which is
      // exactly zero pair arithmetic — and the row says so rather than
      // reporting a small number nobody can interpret.
      expect(q.cells).toBeGreaterThan(0);
      expect(q.worstClusterCells).toBeGreaterThan(0);
      expect(p.cells).toBe(0);

      // The total is the sum over clusters and branches; the worst is one
      // cluster's share. That relation is what separates the SLIDER regime
      // (few clusters, one of them enormous) from the CROWD regime (thousands
      // of cheap ones) on two rows instead of on a stopwatch.
      expect(q.cells).toBeGreaterThanOrEqual(q.worstClusterCells);
    } finally {
      queen.close();
      plain.close();
    }
  });

  test('a component too big for the exact ceiling shows up on the cost row AND the rung', () => {
    // The knight hub is not a slider, so it stays inside the component: one
    // five-variable cluster, above `maxJointsPerCluster`, priced on the cost
    // row and resolved on the fallback ladder. The two agree, which is what
    // makes the cost row usable as a predictor rather than as decoration.
    const b = bench(hubBoard('knight'));
    try {
      const out = run(b);
      expect(out.stats.maxComponent).toBeGreaterThan(1);
      expect(out.stats.worstClusterCells).toBeGreaterThan(0);
      expect(out.stats.rungThreshold + out.stats.rungIcm).toBeGreaterThan(0);
    } finally {
      b.close();
    }
  });
});

// ------------------------------------------------------------ 2. engagement

describe('the SIZE ration engages, and degrades to coarser pricing', () => {
  test('a ration below the board’s own worst cluster shrinks it and says so', () => {
    const b = bench(hubBoard('queen'));
    try {
      const free = run(b, { maxClusterCells: 0 });
      expect(free.stats.rungRation).toBe(0);
      // Set the ration under what this board's worst cluster wants.
      const cap = Math.max(1, Math.floor(free.stats.worstClusterCells / 4));
      const rationed = run(b, { maxClusterCells: cap });

      expect(rationed.stats.rungRation).toBeGreaterThan(0);
      // COARSER, NOT ABSENT: the pass still produces whole legal plans.
      expect(rationed.plans.length).toBeGreaterThan(0);
      assertWholePlans(rationed.plans, b);
      // And it bought strictly less arithmetic than the unrationed pass.
      expect(rationed.stats.worstClusterCells).toBeLessThan(free.stats.worstClusterCells);
    } finally {
      b.close();
    }
  });

  test('a ration nothing can satisfy takes the design’s declared floor, not a refusal', () => {
    const b = bench(hubBoard('queen'));
    try {
      // 1 claim slot is below any real cluster, so every cluster reaches the
      // domain floor and still does not fit: rung 5, ICM on the surrogate.
      const starved = run(b, { maxClusterCells: 1 });
      expect(starved.stats.rungRation).toBeGreaterThan(0);
      expect(starved.stats.rungIcm).toBeGreaterThan(0);
      expect(starved.plans.length).toBeGreaterThan(0);
      assertWholePlans(starved.plans, b);
    } finally {
      b.close();
    }
  });

  test('the ration never shrinks a unit below its floor', () => {
    const b = bench(hubBoard('queen'));
    try {
      // Rationing is a MAX-side restriction on our own search order, so it may
      // narrow what the generator ranges over and may never empty it: a plan
      // that named no candidate for a unit is not a plan.
      for (const cells of [1, 4, 40, 400]) {
        const out = run(b, { maxClusterCells: cells });
        expect(out.plans.length).toBeGreaterThan(0);
        assertWholePlans(out.plans, b);
      }
    } finally {
      b.close();
    }
  });
});

describe('the COUNT ration engages, and leaves the tail at the seed', () => {
  test('capping the count stops clusters being solved and counts the ones it stopped', () => {
    // The slider board, because it is the one with more than one cluster AND
    // non-zero arithmetic to take away — on a pieceless singleton partition
    // there is nothing for a count ration to save.
    const b = bench(hubBoard('queen'));
    try {
      const free = run(b, { maxClustersSolved: 0 });
      expect(free.stats.clustersRationed).toBe(0);
      expect(free.stats.clusters).toBeGreaterThan(1);

      const capped = run(b, { maxClustersSolved: 1 });
      expect(capped.stats.clustersRationed).toBeGreaterThan(0);
      // Fewer clusters solved means strictly less enumeration bought.
      expect(capped.stats.cells).toBeLessThan(free.stats.cells);
      expect(capped.plans.length).toBeGreaterThan(0);
      assertWholePlans(capped.plans, b);
    } finally {
      b.close();
    }
  });
});

describe('the deadline is what makes the pass interruptible', () => {
  test('a deadline that has already fired leaves every cluster at the seed', () => {
    const b = bench(hubBoard(undefined));
    try {
      const out = run(b, {}, () => true);
      // Nothing was solved, everything was rationed, and a whole legal plan
      // still came out — which is the property the first-plan fix rests on:
      // the enumeration may be cut at any point and the decision survives.
      expect(out.stats.clustersRationed).toBeGreaterThan(0);
      expect(out.stats.cells).toBe(0);
      expect(out.plans.length).toBeGreaterThan(0);
      assertWholePlans(out.plans, b);
    } finally {
      b.close();
    }
  });

  test('a deadline that never fires changes nothing at all', () => {
    const b = bench(hubBoard('queen'));
    try {
      const withHandle = run(b, {}, () => false);
      const without = run(b);
      expect(withHandle.stats).toEqual(without.stats);
      expect(withHandle.plans.length).toBe(without.plans.length);
    } finally {
      b.close();
    }
  });
});

// --------------------------------------------------- 3. the defaults are ceilings

describe('the shipped rations are ceilings, not routine narrowings', () => {
  test('neither ration fires at the default on any of these boards', () => {
    for (const kind of ['queen', 'rook', 'knight', undefined]) {
      const b = bench(hubBoard(kind));
      try {
        const out = run(b);
        expect(out.stats.rungRation).toBe(0);
        expect(out.stats.clustersRationed).toBe(0);
        // The measured headroom, stated: the shipped ceiling sits well above
        // what any of these boards asks for.
        expect(out.stats.worstClusterCells).toBeLessThan(DEFAULT_CLUSTER_TUNING.maxClusterCells);
        expect(out.stats.clusters).toBeLessThan(DEFAULT_CLUSTER_TUNING.maxClustersSolved);
      } finally {
        b.close();
      }
    }
  });

  test('lifting both rations produces the identical enumeration', () => {
    // If the default were narrowing anything, this would differ — so this is
    // the assertion that makes "the shipped bot decides what it decided
    // before" a checked claim rather than a hope.
    for (const kind of ['queen', 'knight', undefined]) {
      const b = bench(hubBoard(kind));
      try {
        const shipped = run(b);
        const lifted = run(b, { maxClusterCells: 0, maxClustersSolved: 0 });
        expect(shipped.stats).toEqual(lifted.stats);
        expect(shipped.plans.map((p) => [...p.keys()])).toEqual(
          lifted.plans.map((p) => [...p.keys()])
        );
      } finally {
        b.close();
      }
    }
  });
});

// ------------------------------------------------------ 4. the config surface

describe('both rations are selectable configuration', () => {
  test('a bot names them and the resolved config carries them', () => {
    const bot = botConfigFromJson({
      name: 'rationed',
      search: { maxClusterCells: 500, maxClustersSolved: 4 },
    });
    expect(bot.search.maxClusterCells).toBe(500);
    expect(bot.search.maxClustersSolved).toBe(4);
    // Zero is a REAL setting — "lift the ration" — and must survive resolution.
    const lifted = botConfigFromJson({ name: 'unrationed', search: { maxClusterCells: 0 } });
    expect(lifted.search.maxClusterCells).toBe(0);
  });

  test('the shipped bot names neither, and inherits the ceiling', () => {
    const shipped = resolveBotConfig({});
    expect(shipped.search.maxClusterCells).toBeUndefined();
    expect(shipped.search.maxClustersSolved).toBeUndefined();
  });

  test('a ration that is not a count is refused rather than silently defaulted', () => {
    // A typo that resolved to "no ration" would be an arm wearing the
    // default's behaviour under its own name.
    expect(() => botConfigFromJson({ search: { maxClusterCells: -1 } })).toThrow(
      /non-negative integer/
    );
    expect(() => botConfigFromJson({ search: { maxClusterCells: 1.5 } })).toThrow(
      /non-negative integer/
    );
    expect(() => botConfigFromJson({ search: { maxClustersSolved: 'lots' } })).toThrow(
      /non-negative integer/
    );
    expect(() => botConfigFromJson({ search: { maxClusterCell: 10 } })).toThrow(/unknown bot config/);
  });
});
