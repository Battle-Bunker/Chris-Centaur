/**
 * THE INDEX-DRIVEN GREEDY PAIRWISE SEED, and the gate it has to pass.
 *
 * The gate is `r01-snakes6`. It is the named control where the fatal-staging
 * disease this program treats is ABSENT, its baseline score is 1.000, and
 * there is therefore no headroom up — only down. A previous subtract-only
 * guard took it from 1.000 to 0.500, and the diagnosis in the ledger's own
 * words was that the degenerate ordering *"was accidentally collision-free:
 * every snake staging `up` is parallel motion, and the guard breaks that
 * coherence without replacing it."*
 *
 * So this suite has two halves, and the second is the one that matters:
 *
 *   MECHANISM       each potential does the thing it claims, on a fixture
 *                   built for it and resolved through the real resolver.
 *   NO REGRESSION   a deterministic replay probe over snake-only boards of
 *                   that class: the seed's own fatal-staging rate with the
 *                   flag on must not exceed the rate with it off, and the
 *                   parallel-motion case must stay collision-free.
 *
 * No live games. Every board here is generated from a fixed seed and every
 * verdict comes from `withResolution`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Board, Coord, Snake } from '../../types/battlesnake';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { makeSearchCore } from '../search';
import {
  SeedWorkspace,
  clusterSeedFrom,
  greedySeed,
  pairPotential,
  sacrificeLegitimate,
  type SeedFacts,
} from '../search/cluster-seed';
import type { SubstrateUnit } from '../substrate';
import { ConflictIndex, subStepsFor } from '../search/conflict-index';
import { cmpLex, scalarOf } from '../../partial-engine/index';
import { unboundedBudget } from '../bounds/testkit';
import type {
  Candidate,
  CandidateSet,
  CellIndex,
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

const TURN = 30;

/**
 * One place in the generator's own ordering, as the seed prices it. Duplicated
 * here rather than exported: the constant is the seed's private calibration,
 * and what the suite asserts is a RELATION to it, not the number.
 */
const RANK_STEP_FOR_TEST = 0.05;

afterEach(() => clearGeometryCache());

interface SeedRun {
  readonly plan: JointPlan;
  readonly ourDead: ReadonlyArray<UnitId>;
  /** Of those, the ones another of OUR units was named alongside in the clash. */
  readonly teammateKills: number;
  readonly key: string;
  readonly sub: EngineSubstrate;
  close(): void;
}

/**
 * ONE RUNG-0 SEED, through the real seam.
 *
 * `conform` with an empty incumbent IS rung 0: it seeds, pays one price, and
 * returns the seed whatever that price said. The repair is held off
 * (`rungZeroRepair: false`) deliberately — this measures the SEED, not the
 * repair that runs after it, and a repair that cleaned up after a worse seed
 * would hide exactly the regression the gate exists to catch.
 */
function seedRun(board: Board, team: string, clusterSeed: boolean, guard = false): SeedRun {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: team });
  const asTeam = sub.teamNumber(team);
  // `guard: false` is the SHIPPED snake-only configuration — the staging guard
  // is off on a board with no piece, by the ledger's own ship condition, and
  // that is the configuration `r01-snakes6` ran under. `guard: true` is the
  // arm where the refusal is on, which is where it measured badly.
  const gen = new GrammarCandidateGenerator({
    pruneCertainSelfFatal: guard,
    pruneRoyalPath: guard,
  });
  const core = makeSearchCore({
    clusterSeed,
    seedDeconflict: !clusterSeed,
    rungZeroRepair: false,
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
    budget: unboundedBudget(),
  };
  const plan = core.conform(ctx, new Map());
  const ours = new Set<UnitId>(sub.commandable(asTeam));
  const { ourDead, teammateKills } = sub.withResolution(plan, asTeam, ({ resolution }) => {
    const dead = resolution.deaths.filter((d) => ours.has(d.unitId as UnitId));
    let mates = 0;
    for (const d of dead) {
      for (const clash of resolution.clashes) {
        if (!clash.victimIDs.includes(d.unitId)) continue;
        if (clash.playerIDs.some((id) => id !== d.unitId && ours.has(id as UnitId))) mates++;
        break;
      }
    }
    return { ourDead: dead.map((d) => d.unitId as UnitId), teammateKills: mates };
  });
  return {
    plan,
    ourDead,
    teammateKills,
    key: planCells(plan),
    sub,
    close: () => {
      core.release?.();
      sub.release();
    },
  };
}

// ---------------------------------------------------------------------------

describe('the flag', () => {
  test('is off unless something says on, and reads the same words the others do', () => {
    expect(clusterSeedFrom({})).toBe(false);
    expect(clusterSeedFrom({ CENTAUR_CLUSTER_SEED: '' })).toBe(false);
    expect(clusterSeedFrom({ CENTAUR_CLUSTER_SEED: 'off' })).toBe(false);
    expect(clusterSeedFrom({ CENTAUR_CLUSTER_SEED: 'nonsense' })).toBe(false);
    for (const on of ['1', 'on', 'true']) {
      expect(clusterSeedFrom({ CENTAUR_CLUSTER_SEED: on })).toBe(true);
    }
  });

  test('with it off the seed is the one that shipped, plan for plan', () => {
    // Byte-identity where the claim is inert: the branch is not taken, so the
    // de-confliction pass produces exactly what it always produced.
    const board = snakesBoard(7);
    const off = seedRun(board, 'red', false);
    const again = seedRun(board, 'red', false);
    expect(planCells(off.plan)).toEqual(planCells(again.plan));
    off.close();
    again.close();
  });
});

// ---------------------------------------------------------------------------

describe('the potentials, one fixture each', () => {
  test('MUTUAL ANNIHILATION: two same-weight allies do not both take one cell', () => {
    // Both heads one step from (4,4), same kind and weight, so the contest is
    // a tie and a tie leaves nobody standing. The shipped de-confliction also
    // separates them; what this asserts is that the graded form does not lose
    // the case the blunt one already had.
    const board = {
      width: 9,
      height: 9,
      food: [],
      hazards: [],
      snakes: [
        makeSnake('A', [{ x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }], { teamID: 'red' }),
        makeSnake('B', [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }], { teamID: 'red' }),
      ],
    } as Board;
    const run = seedRun(board, 'red', true);
    const dests = [...run.plan.values()].map((c) => c.to);
    expect(new Set(dests).size).toBe(dests.length);
    expect(run.ourDead).toEqual([]);
    run.close();
  });

  test('EDGE EXCHANGE: two allies do not swap through one edge', () => {
    // Head to head, one cell apart on the same row: the pair of steps that
    // exchanges them kills both, and no cell is shared, so a same-cell
    // predicate alone would miss it entirely.
    const board = {
      width: 9,
      height: 9,
      food: [],
      hazards: [],
      snakes: [
        makeSnake('A', [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }], { teamID: 'red' }),
        makeSnake('B', [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }], { teamID: 'red' }),
      ],
    } as Board;
    const run = seedRun(board, 'red', true);
    const a = run.sub.unitOfWireId('A') as NonNullable<ReturnType<typeof run.sub.unitOfWireId>>;
    const b = run.sub.unitOfWireId('B') as NonNullable<ReturnType<typeof run.sub.unitOfWireId>>;
    const ma = run.plan.get(a.unitId) as Candidate;
    const mb = run.plan.get(b.unitId) as Candidate;
    const swapped = ma.to === (b.cells[0] as number) && mb.to === (a.cells[0] as number);
    expect(swapped).toBe(false);
    expect(run.ourDead).toEqual([]);
    run.close();
  });

  test('FOLLOW THE TAIL: single file stays single file, and nobody dies', () => {
    // Three trail units nose to tail in one column, every one of them able to
    // advance into the cell the one ahead is leaving. This is the parallel
    // motion the previous guard destroyed, in its provable form: the tail pop
    // is unconditional and precedes the head landing, so the whole column
    // moves at once and touches nothing.
    const board = {
      width: 11,
      height: 11,
      food: [],
      hazards: [],
      snakes: [
        makeSnake('A', [{ x: 5, y: 7 }, { x: 5, y: 6 }, { x: 5, y: 5 }], { teamID: 'red' }),
        makeSnake('B', [{ x: 5, y: 4 }, { x: 5, y: 3 }, { x: 5, y: 2 }], { teamID: 'red' }),
        makeSnake('C', [{ x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }], { teamID: 'red' }),
      ],
    } as Board;
    const run = seedRun(board, 'red', true);
    expect(run.ourDead).toEqual([]);
    // And the F6 property itself, where it is a theorem rather than a rate:
    // single-file motion touches nothing, so no two of our staged claims meet
    // at one cell at one sub-step.
    expect(collisions(run.plan, run.sub.grid.cells)).toBe(0);
    run.close();
  });

  test('the seed hands every unit a move, and never the same cell twice, on a crowded board', () => {
    for (let seed = 0; seed < 24; seed++) {
      const board = snakesBoard(seed);
      const run = seedRun(board, 'red', true);
      const ours = run.sub.commandable(run.sub.teamNumber('red'));
      // THE JOINT-EMPTINESS GUARD, structurally: an argmax over a non-empty
      // list is non-empty, so there is no branch on which a unit gets nothing.
      expect([...run.plan.keys()].sort((a, b) => a - b)).toEqual(
        [...ours].sort((a, b) => a - b)
      );
      run.close();
    }
  });

  test('is deterministic: the same board and the same salt give the same plan', () => {
    const board = snakesBoard(11);
    const a = seedRun(board, 'red', true);
    const b = seedRun(board, 'red', true);
    expect(planCells(a.plan)).toEqual(planCells(b.plan));
    a.close();
    b.close();
  });
});

// ---------------------------------------------------------------------------

/**
 * THE POTENTIALS IN ISOLATION — the signs and the scale separation, on a
 * synthetic fact table so the enemy-claim bit and the doomed set can be moved
 * one at a time.
 */
describe('the sacrifice gate, and what it may not excuse', () => {
  interface Rig {
    facts: SeedFacts;
    index: ConflictIndex;
    a: SubstrateUnit;
    b: SubstrateUnit;
    close(): void;
    setEnemy(on: boolean): void;
  }

  /** Two of ours, `A` heavy and `B` light unless `equal`, plus a bystander. */
  const rig = (equal: boolean): Rig => {
    const board = {
      width: 9,
      height: 9,
      food: [],
      hazards: [],
      snakes: [
        makeSnake('A', [{ x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }], { teamID: 'red' }),
        makeSnake(
          'B',
          equal
            ? [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }]
            : [{ x: 5, y: 4 }, { x: 6, y: 4 }],
          { teamID: 'red' }
        ),
      ],
    } as Board;
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const a = sub.unitOfWireId('A') as SubstrateUnit;
    const b = sub.unitOfWireId('B') as SubstrateUnit;
    let enemy = false;
    const facts: SeedFacts = {
      cells: sub.grid.cells,
      units: new Map([
        [a.unitId, a],
        [b.unitId, b],
      ]),
      regicideTeams: new Set<number>(),
      enemyClaimAt: () => enemy,
      tailFreedAt: () => 0,
      bodyOwnerAt: () => -1,
      bodyIndexAt: () => -1,
    };
    const index = new ConflictIndex();
    index.begin(sub.grid.cells, 2);
    return {
      facts,
      index,
      a,
      b,
      setEnemy: (on: boolean) => {
        enemy = on;
      },
      close: () => sub.release(),
    };
  };

  /** `A` steps onto the cell `B` has already claimed. */
  const contest = (r: Rig): number => {
    const cell = 4 * 9 + 4;
    r.index.begin(r.facts.cells, 2);
    r.index.claim(r.b.unitId, r.b.cells[0] as CellIndex, [cell as CellIndex]);
    const candidate: Candidate = {
      unitId: r.a.unitId,
      from: r.a.cells[0] as CellIndex,
      to: cell as CellIndex,
      path: [cell as CellIndex],
    };
    return pairPotential(r.facts, r.index, r.a, candidate, new Set<UnitId>());
  };

  test('an enemy claim on the cell excuses a contest WE WIN — E1 and E3', () => {
    const r = rig(false);
    r.setEnemy(false);
    expect(contest(r)).toBeLessThan(0);
    r.setEnemy(true);
    expect(contest(r)).toBe(0);
    r.close();
  });

  test('an enemy claim does NOT excuse a mutual annihilation', () => {
    // The correction the replay probe forced. E1 is one ally dying so another
    // may hold a cell and E3 is our heavier unit being the unique strict max;
    // a tie is neither, and gating it on the same bit test put two mutual
    // annihilations per sixty boards back into the probe.
    const r = rig(true);
    expect(cmpLex(scalarOf(r.a.tier, r.a.weight), scalarOf(r.b.tier, r.b.weight))).toBe(0);
    const closed = contest(r);
    r.setEnemy(true);
    const open = contest(r);
    expect(closed).toBeLessThan(0);
    expect(open).toBe(closed);
    r.close();
  });

  test('a DOOMED ally zeroes the potential in every branch — E4', () => {
    for (const equal of [false, true]) {
      const r = rig(equal);
      const cell = 4 * 9 + 4;
      r.index.begin(r.facts.cells, 2);
      r.index.claim(r.b.unitId, r.b.cells[0] as CellIndex, [cell as CellIndex]);
      const candidate: Candidate = {
        unitId: r.a.unitId,
        from: r.a.cells[0] as CellIndex,
        to: cell as CellIndex,
        path: [cell as CellIndex],
      };
      expect(pairPotential(r.facts, r.index, r.a, candidate, new Set([r.b.unitId]))).toBe(0);
      r.close();
    }
  });

  test('our own LAST king is never a legitimate sacrifice', () => {
    const board = {
      width: 9,
      height: 9,
      food: [],
      hazards: [],
      snakes: [
        makeSnake('Q', [{ x: 4, y: 8 }], { teamID: 'red', unitType: 'queen', length: 4 }),
        makeSnake('K', [{ x: 4, y: 4 }], { teamID: 'red', unitType: 'king', length: 1 }),
        makeSnake('E', [{ x: 0, y: 0 }], { teamID: 'blue', unitType: 'knight', length: 2 }),
      ],
    } as Board;
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const q = sub.unitOfWireId('Q') as SubstrateUnit;
    const k = sub.unitOfWireId('K') as SubstrateUnit;
    const facts: SeedFacts = {
      cells: sub.grid.cells,
      units: new Map([
        [q.unitId, q],
        [k.unitId, k],
      ]),
      regicideTeams: sub.regicideTeamNumbers(),
      // Every exception armed at once, and none of them reaches the king.
      enemyClaimAt: () => true,
      tailFreedAt: () => 0,
      bodyOwnerAt: () => -1,
      bodyIndexAt: () => -1,
    };
    expect(facts.regicideTeams.has(q.team)).toBe(true);
    expect(sacrificeLegitimate(facts, k.cells[0] as CellIndex, q, k, false)).toBe(false);
    expect(sacrificeLegitimate(facts, k.cells[0] as CellIndex, q, k, true)).toBe(false);
    sub.release();
  });

  test('friendly fire is a TIE-BREAK: it never outranks one ordering place', () => {
    // Plan-local friendly-fire avoidance is policy, and policy settles what
    // the material terms cannot. The LIGHT unit stepping into the heavy one's
    // claim loses its own weight either way — the same weight a wall would
    // cost it — so nothing material tells the two apart and the choice was
    // being made by the salt. The margin must be smaller than one ordering
    // place, or it would promote an option the generator ranked below.
    const r = rig(false);
    const cell = 4 * 9 + 4;
    r.index.begin(r.facts.cells, 2);
    r.index.claim(r.a.unitId, r.a.cells[0] as CellIndex, [cell as CellIndex]);
    const light: Candidate = {
      unitId: r.b.unitId,
      from: r.b.cells[0] as CellIndex,
      to: cell as CellIndex,
      path: [cell as CellIndex],
    };
    expect(r.b.weight).toBeLessThan(r.a.weight);
    const friendly = pairPotential(r.facts, r.index, r.b, light, new Set<UnitId>());
    const own = -r.b.weight;
    expect(friendly).toBeLessThan(own);
    expect(Math.abs(friendly - own)).toBeLessThan(RANK_STEP_FOR_TEST);
    r.close();
  });
});

// ---------------------------------------------------------------------------

/**
 * THE SHIP CRITERION.
 *
 * A deterministic replay probe over two families of snake-only `r01-snakes6`-
 * class boards — six trail units, two teams of three, 11×11, folded bodies —
 * seeded at rung 0 with the flag off and on, each plan resolved through the
 * real resolver, our own casualties counted.
 *
 *   SCATTERED   units placed anywhere. The family where the dominant hazard is
 *               a unit's OWN body, not a team-mate's.
 *   CONFRONTED  each team's three heads in a tight triangle, so every unit's
 *               best options are cells a team-mate also wants. The family the
 *               pair terms exist for.
 *
 * Both are run in both knob arms: the staging guard OFF, which is the shipped
 * snake-only configuration and the one `r01-snakes6` ran under, and ON, which
 * is the configuration where the refusal measured badly.
 *
 * The criterion is NO REGRESSION, not a lift — this board class is the control
 * where the disease is absent. The numbers are printed either way, because a
 * gate that only reports pass/fail tells the next bisect nothing.
 */
describe('the ship criterion: r01-snakes6-class boards', () => {
  const BOARDS = 60;

  interface Tally {
    dead: number;
    mates: number;
    /** `(cell, subStep)` slots two of our own claims met in. */
    met: number;
    /** Of those, the ones the comparator ties — where NOBODY survives. */
    ties: number;
    differed: number;
  }

  const sweep = (
    make: (seed: number) => Board,
    guard: boolean,
  ): { off: Tally; on: Tally } => {
    const off: Tally = { dead: 0, mates: 0, met: 0, ties: 0, differed: 0 };
    const on: Tally = { dead: 0, mates: 0, met: 0, ties: 0, differed: 0 };
    for (let seed = 0; seed < BOARDS; seed++) {
      const board = make(seed);
      const a = seedRun(board, 'red', false, guard);
      const b = seedRun(board, 'red', true, guard);
      off.dead += a.ourDead.length;
      on.dead += b.ourDead.length;
      off.mates += a.teammateKills;
      on.mates += b.teammateKills;
      if (a.key !== b.key) on.differed++;
      off.met += collisions(a.plan, a.sub.grid.cells);
      on.met += collisions(b.plan, b.sub.grid.cells);
      off.ties += annihilations(a.plan, a.sub);
      on.ties += annihilations(b.plan, b.sub);
      a.close();
      b.close();
    }
    return { off, on };
  };

  const families: ReadonlyArray<{ name: string; make: (seed: number) => Board }> = [
    { name: 'scattered', make: scatteredBoard },
    { name: 'confronted', make: snakesBoard },
  ];

  for (const family of families) {
    for (const guard of [false, true]) {
      test(`${family.name} boards, staging guard ${guard ? 'on' : 'off'}: no regression`, () => {
        const { off, on } = sweep(family.make, guard);
        console.log(
          `  ${family.name} guard=${guard} x${BOARDS}: ` +
            `fatal off=${off.dead} on=${on.dead} | ` +
            `teammate-caused off=${off.mates} on=${on.mates} | ` +
            `claim collisions off=${off.met} on=${on.met} | ` +
            `mutual annihilations off=${off.ties} on=${on.ties} | ` +
            `plans differ on ${on.differed}/${BOARDS}`
        );
        expect(on.dead).toBeLessThanOrEqual(off.dead);
        expect(on.mates).toBeLessThanOrEqual(off.mates);
        // THE PARALLEL-MOTION HALF, stated where it means something.
        //
        // `met` is NOT the criterion, and the numbers above are why: the pass
        // being replaced is a hard veto on any shared cell, so it scores zero
        // collisions by construction — including on the boards where scoring
        // zero costs it a unit. What a graded layer owes is not "never share a
        // cell" but "never share one for NOTHING", and sharing a cell for
        // nothing is exactly the comparator tie: no unique strict maximum, so
        // every standing participant dies and no cell is taken.
        //
        // With the full option set available (the guard off, which is the
        // shipped snake-only configuration) the seed stages none at all. With
        // the guard on, options have already been refused and a unit can be
        // left holding only tying ones — so there the criterion is the rate.
        if (guard) expect(on.ties).toBeLessThanOrEqual(off.ties);
        else expect(on.ties).toBe(0);
      });
    }
  }

  test('the probe is not vacuous: the two arms really do stage different plans', () => {
    // A gate both arms pass because nothing changed is a gate that proves
    // nothing. The confronted family is where the pair terms fire, so that is
    // where the difference has to show.
    let differed = 0;
    for (let seed = 0; seed < BOARDS; seed++) {
      const board = snakesBoard(seed);
      const a = seedRun(board, 'red', false);
      const b = seedRun(board, 'red', true);
      if (a.key !== b.key) differed++;
      a.close();
      b.close();
    }
    expect(differed).toBeGreaterThan(BOARDS / 4);
  });
});

// --------------------------------------------------------------------- helpers

/** The staged cells, as a stable string — a plan's identity for comparison. */
const planCells = (plan: JointPlan): string =>
  [...plan.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, c]) => `${id}>${c.to}:${c.path.join('.')}`)
    .join('|');

/**
 * How many `(cell, subStep)` slots two or more of our own claims meet in —
 * computed with the index itself, so the property is checked against the same
 * structure the seed reasons with rather than against a second reading of it.
 */
function collisions(plan: JointPlan, cells: number): number {
  const index = new ConflictIndex();
  const paths = [...plan.values()].map((c) => c.path);
  index.begin(cells, subStepsFor(paths));
  for (const [unitId, candidate] of plan) index.claim(unitId, candidate.from, candidate.path);
  let met = 0;
  const seen = new Set<string>();
  for (const candidate of plan.values()) {
    const claimed = candidate.path.length === 0 ? [candidate.from] : candidate.path;
    for (let i = 0; i < claimed.length; i++) {
      const cell = claimed[i] as number;
      for (let s = 1; s < index.subSteps; s++) {
        const key = `${cell}@${s}`;
        if (seen.has(key)) continue;
        if (index.countAt(cell as never, s) > 1) {
          seen.add(key);
          met++;
        }
      }
    }
  }
  return met;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/**
 * Same-cell claims by two of ours that the comparator TIES — the mutual
 * annihilations `order.ts`'s own fallback comment names as the coverage hole
 * the resolution-derived pair source misses. Nobody survives one, nothing is
 * taken, and both corpses land where the two units wanted to be.
 */
function annihilations(plan: JointPlan, sub: EngineSubstrate): number {
  const entries = [...plan.entries()];
  let ties = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [ida, ca] = entries[i] as [UnitId, Candidate];
      const [idb, cb] = entries[j] as [UnitId, Candidate];
      const a = sub.unitOf(ida);
      const b = sub.unitOf(idb);
      if (a === undefined || b === undefined) continue;
      const sameCell = ca.to === cb.to;
      const swapped = ca.to === (b.cells[0] as number) && cb.to === (a.cells[0] as number);
      if (!sameCell && !swapped) continue;
      if (cmpLex(scalarOf(a.tier, a.weight), scalarOf(b.tier, b.weight)) === 0) ties++;
    }
  }
  return ties;
}

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * An `r01-snakes6`-class board: six trail units, two teams of three, folded
 * bodies, crowded enough that a unit really can be sealed in. Deterministic in
 * `seed`, and the same board for both arms of the probe.
 */
/**
 * SCATTERED: six trail units placed anywhere on the board, folded bodies,
 * crowded enough that a unit really can seal itself in. The family where the
 * dominant hazard is a unit's OWN body rather than a team-mate's.
 */
function scatteredBoard(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  for (let i = 0; i < 6 && snakes.length < 6; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      const x = 1 + Math.floor(r() * (size - 2));
      const y = 1 + Math.floor(r() * (size - 2));
      if (used.has(`${x},${y}`)) continue;
      const body: Coord[] = [];
      const claimed: string[] = [];
      const push = (cx: number, cy: number): boolean => {
        if (!take(cx, cy)) return false;
        body.push({ x: cx, y: cy });
        claimed.push(`${cx},${cy}`);
        return true;
      };
      if (!push(x, y)) continue;
      const len = 3 + Math.floor(r() * 3);
      let d = Math.floor(r() * 4);
      for (let j = 1; j < len; j++) {
        if (r() < 0.4) d = (d + (r() < 0.5 ? 1 : 3)) % 4;
        const prev = body[body.length - 1] as Coord;
        const step = DIRS[d] as readonly [number, number];
        if (!push(prev.x + step[0], prev.y + step[1])) break;
      }
      if (body.length < 3) {
        for (const key of claimed) used.delete(key);
        continue;
      }
      snakes.push(
        makeSnake(`u${i}`, body, {
          teamID: i % 2 === 0 ? 'red' : 'blue',
          health: 30 + Math.floor(r() * 60),
        })
      );
      placed = true;
    }
  }
  return { width: size, height: size, food: [], hazards: [], snakes } as Board;
}

/**
 * CONFRONTED: each team's three heads in a tight triangle, so every unit's
 * best options are cells a team-mate also wants and its neighbours' bodies are
 * within one step. The family the pair terms exist for.
 */
function snakesBoard(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  const anchors: Array<[number, number, string]> = [];
  const rx = 2 + Math.floor(r() * 3);
  const ry = 2 + Math.floor(r() * 6);
  anchors.push([rx, ry, 'red'], [rx + 2, ry, 'red'], [rx + 1, ry + 1, 'red']);
  const bx = 6 + Math.floor(r() * 2);
  const by = 2 + Math.floor(r() * 6);
  anchors.push([bx, by, 'blue'], [bx + 2, by, 'blue'], [bx + 1, by + 1, 'blue']);
  for (let i = 0; i < anchors.length; i++) {
    const [hx, hy, team] = anchors[i] as [number, number, string];
    const body: Coord[] = [];
    if (!take(hx, hy)) continue;
    body.push({ x: hx, y: hy });
    const len = 3 + Math.floor(r() * 3);
    let d = Math.floor(r() * 4);
    for (let j = 1; j < len; j++) {
      if (r() < 0.4) d = (d + (r() < 0.5 ? 1 : 3)) % 4;
      const prev = body[body.length - 1] as Coord;
      let stepped = false;
      for (let k = 0; k < 4 && !stepped; k++) {
        const dd = DIRS[(d + k) % 4] as readonly [number, number];
        if (take(prev.x + dd[0], prev.y + dd[1])) {
          body.push({ x: prev.x + dd[0], y: prev.y + dd[1] });
          d = (d + k) % 4;
          stepped = true;
        }
      }
      if (!stepped) break;
    }
    if (body.length < 2) continue;
    snakes.push(makeSnake(`u${i}`, body, { teamID: team, health: 40 + Math.floor(r() * 50) }));
  }
  return { width: size, height: size, food: [], hazards: [], snakes } as Board;
}

// ---------------------------------------------------------------------------

/**
 * THE SEED'S OWN BUDGET.
 *
 * The design was costed at 0.66–2.64 µs per decision against a ≈200 µs
 * `scorePlan` and a median decision that manages five of them. What is timed
 * here is the greedy pass on a WARM substrate — the claim field is cached
 * after the first read, exactly as it is on the second and later slices of a
 * real decision. The ceiling is set against the in-harness number (ts-jest
 * runs this class of code ~6× slower than a compiled standalone, measured on
 * the index in its own suite) with room for a loaded box.
 */
describe('the seed stays inside its budget', () => {
  test('a six-unit snake-only decision seeds in microseconds', () => {
    // Six of ours on one board — the roster shape the cost was quoted at.
    const bench = {
      width: 11,
      height: 11,
      food: [],
      hazards: [],
      snakes: [0, 1, 2, 3, 4, 5].map((i) =>
        makeSnake(
          `b${i}`,
          [
            { x: 1 + i, y: 2 },
            { x: 1 + i, y: 3 },
            { x: 1 + i, y: 4 },
          ],
          { teamID: 'red' }
        )
      ),
    } as Board;
    const sub = makeSubstrate({ board: bench, turn: TURN, asTeam: 'red' });
    const asTeam = sub.teamNumber('red');
    const gen = new GrammarCandidateGenerator({
      pruneCertainSelfFatal: false,
      pruneRoyalPath: false,
    });
    const ours = [...sub.commandable(asTeam)];
    const sets = new Map<UnitId, CandidateSet>();
    for (const id of ours) sets.set(id, gen.candidatesFor(sub, id));
    const workspace = new SeedWorkspace();
    const empty: JointPlan = new Map();
    const doomed = new Set<UnitId>();
    const once = (): void => {
      greedySeed({
        sub,
        workspace,
        roster: ours,
        order: ours,
        sets,
        fixed: empty,
        doomed,
        cap: 8,
        salt: 0x5eed,
      });
    };
    for (let i = 0; i < 500; i++) once();
    let best = Infinity;
    for (let round = 0; round < 3; round++) {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 1500; i++) once();
      const us = Number(process.hrtime.bigint() - t0) / 1000 / 1500;
      if (us < best) best = us;
    }
    console.log(`  greedy seed, ${ours.length} units: ${best.toFixed(3)} µs`);
    expect(ours.length).toBe(6);
    expect(best).toBeLessThan(60);
    sub.release();
  });
});

// ---------------------------------------------------------------------------

/**
 * THE PLACEMENT LAWS THIS LAYER HAS TO KEEP.
 *
 * The seed reads enemy geometry and it writes a number that steers which plan
 * the search starts from. Both of those are exactly the shapes the contract
 * fences, so both are checked rather than argued.
 */
describe('the placement laws', () => {
  test('L16: friendly fire is POLICY — the seed writes no ledger entry, anywhere', () => {
    // The grep half of the law, on the module itself. A pair veto has no home
    // in `prunedLedger` — its completeness invariant is per unit and cannot
    // express one — and plan-local friendly fire must not be there in any case,
    // because the next sweep may move the team-mate.
    const source = readFileSync(
      join(__dirname, '..', 'search', 'cluster-seed.ts'),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Nothing is WRITTEN to a ledger: no push, no assignment, no literal.
    expect(code).not.toMatch(/prunedLedger\s*\.\s*push/);
    expect(code).not.toMatch(/prunedLedger\s*[:=][^:=]/);
    expect(code).not.toMatch(/\bPRUNE\b/);
    expect(code).not.toMatch(/declareTruncatedFloor|withNarrowing/);
    // The one mention that survives is the READ the shipped seed also makes:
    // a unit whose whole option set was refused still has to be handed
    // something, and the ledger is where that something is.
    const mentions = code.split('\n').filter((l) => l.includes('prunedLedger'));
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toContain('candidates[0]');
  });

  test('L16: the behavioural half — no candidate set differs with the seed on', () => {
    // The generator runs before the seed and the seed never touches what it
    // produced, so every unit's option set and ledger are identical in both
    // arms. This is what "ordering carries no soundness weight" cashes out to.
    const board = snakesBoard(5);
    const shape = (clusterSeed: boolean): string => {
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const gen = new GrammarCandidateGenerator({
        pruneCertainSelfFatal: false,
        pruneRoyalPath: false,
      });
      const core = makeSearchCore({ clusterSeed, seedDeconflict: !clusterSeed });
      const ctx: SearchContext = {
        sub,
        gen,
        evaluate: defaultEvaluator,
        asTeam: sub.teamNumber('red'),
        pins: [],
        assumptions: [],
        incumbent: null,
        witnesses: [],
        budget: unboundedBudget(),
      };
      core.conform(ctx, new Map());
      const out = [...sub.commandable(sub.teamNumber('red'))]
        .map((id) => {
          const set = gen.candidatesFor(sub, id);
          return `${id}:${set.legalCount}:${set.candidates.map((c) => c.to).join(',')}` +
            `:${set.prunedLedger.map((e) => `${e.candidate.to}/${e.prune}`).join(',')}`;
        })
        .join('|');
      core.release?.();
      sub.release();
      return out;
    };
    expect(shape(true)).toEqual(shape(false));
  });

  test('every staged move is a member of the unit\'s own candidate set', () => {
    // The seed CHOOSES; it does not invent. A plan naming a move no generator
    // offered is a plan the bank would refuse to corroborate.
    for (let seed = 0; seed < 20; seed++) {
      const board = snakesBoard(seed);
      const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
      const gen = new GrammarCandidateGenerator({
        pruneCertainSelfFatal: false,
        pruneRoyalPath: false,
      });
      const core = makeSearchCore({ clusterSeed: true, seedDeconflict: false });
      const ctx: SearchContext = {
        sub,
        gen,
        evaluate: defaultEvaluator,
        asTeam: sub.teamNumber('red'),
        pins: [],
        assumptions: [],
        incumbent: null,
        witnesses: [],
        budget: unboundedBudget(),
      };
      const plan = core.conform(ctx, new Map());
      for (const [unitId, candidate] of plan) {
        const set = gen.candidatesFor(sub, unitId);
        const offered = set.candidates.some(
          (c) => c.to === candidate.to && c.path.join('.') === candidate.path.join('.')
        );
        expect([seed, unitId, offered]).toEqual([seed, unitId, true]);
      }
      core.release?.();
      sub.release();
    }
  });

  test('rule 21: enemy geometry may only WITHHOLD a penalty, never add attraction', () => {
    // The one enemy-derived input this layer has is "does a held claim reach
    // this cell", and it is used to decide whether a team-mate kill is a
    // sacrifice worth making. That is the sanctioned polarity and only just:
    // it must express itself as "do not penalise", never as "prefer". So the
    // pair sum is bounded ABOVE by what it would be with no enemy on the
    // board, and above by zero in every branch that involves one.
    const board = {
      width: 9,
      height: 9,
      food: [],
      hazards: [],
      snakes: [
        makeSnake('A', [{ x: 3, y: 4 }, { x: 2, y: 4 }, { x: 1, y: 4 }], { teamID: 'red' }),
        makeSnake('B', [{ x: 5, y: 4 }, { x: 6, y: 4 }], { teamID: 'red' }),
      ],
    } as Board;
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const a = sub.unitOfWireId('A') as SubstrateUnit;
    const b = sub.unitOfWireId('B') as SubstrateUnit;
    const cell = 4 * 9 + 4;
    const index = new ConflictIndex();
    const candidate: Candidate = {
      unitId: a.unitId,
      from: a.cells[0] as CellIndex,
      to: cell as CellIndex,
      path: [cell as CellIndex],
    };
    const withEnemy = (enemy: boolean): number => {
      const facts: SeedFacts = {
        cells: sub.grid.cells,
        units: new Map([
          [a.unitId, a],
          [b.unitId, b],
        ]),
        regicideTeams: new Set<number>(),
        enemyClaimAt: () => enemy,
        tailFreedAt: () => 0,
        bodyOwnerAt: () => -1,
        bodyIndexAt: () => -1,
      };
      index.begin(sub.grid.cells, 2);
      index.claim(b.unitId, b.cells[0] as CellIndex, [cell as CellIndex]);
      return pairPotential(facts, index, a, candidate, new Set<UnitId>());
    };
    const quiet = withEnemy(false);
    const contested = withEnemy(true);
    expect(quiet).toBeLessThan(0);
    // Enemy geometry moved it TOWARD zero, and stopped there.
    expect(contested).toBeGreaterThan(quiet);
    expect(contested).toBeLessThanOrEqual(0);
    sub.release();
  });

  test('rule 21: the one POSITIVE term is sourced from our own team, not the enemy', () => {
    // Follow-the-tail is the only term that raises a score, and its input is a
    // team-mate's own trail — nothing an opponent does can produce it. Stated
    // as a test so a later term cannot be added on the other polarity by
    // accident.
    const source = readFileSync(
      join(__dirname, '..', 'search', 'cluster-seed.ts'),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // `enemyClaimAt` appears exactly where the gate reads it and in the fact
    // table that builds it — never in an arithmetic expression that adds.
    for (const line of code.split('\n')) {
      if (!line.includes('enemyClaimAt')) continue;
      expect(line).not.toMatch(/\+=|total\s*\+/);
    }
    expect(code).toContain('EPS_FOLLOW');
    expect(code).toMatch(/total \+= EPS_FOLLOW/);
  });
});
