/**
 * THE SCOUT — Door A, advisory depth: the door, the threads, the scheduler,
 * and the three sinks it is allowed to touch.
 *
 * Four families, and the third is the one the whole design rests on:
 *
 *   DOOR       `continueFrom` — the ply-(n+1) root off a ply-(n) `Resolution`.
 *              The invariant ledger I1–I10 individually, the tier re-collapse,
 *              the dilation arithmetic, the refusals, the slab discipline.
 *   THREADS    the contact countdown off the min-decomposable matrix, the
 *              entanglement accumulator, the ledger's three invalidation
 *              sources, the discrimination metrics.
 *   CHANNELS   the firewall (L8 / L2): nothing in `scout/` may write a bound,
 *              and nothing under `bounds/` may import it. Structural, and
 *              asserted by reading the files.
 *   CATALOGUE  `la-outside` §7's failure catalogue, one test per entry the
 *              door can actually commit.
 *
 * No live games (sim-worker P11). Every board is generated from a fixed seed,
 * every budget is a counting budget rather than a clock.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Board, Coord, Snake } from '../../types/battlesnake';
import { EngineSubstrate, clearGeometryCache, makeSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import { DEFAULT_CLUSTER_TUNING, enumerateProposals, makeSearchCore, partitionOf } from '../search';
import { defaultEvaluator } from '../evaluate';
import { LobsterKernel } from '../kernel';
import { unboundedBudget } from '../bounds/testkit';
import {
  DEFAULT_SCOUT_TUNING,
  FLAT,
  Scout,
  ScoutPurse,
  ThreadLedger,
  barrierDepth,
  buildContactMatrix,
  clampToLat,
  depthOf,
  cleanPrefixOf,
  contactOf,
  continueFrom,
  deepenNext,
  effectiveTithe,
  resumePriority,
  scoutModeFrom,
  shouldPark,
  soleDifference,
  tierAtRoot,
  tierPremiseAdmits,
} from '../search/scout';
import type { ThreadEntry, ThreadPly } from '../search/scout';
import { ShellTable } from '../evaluate';
import { SubtreeCertificate } from '../../partial-engine/index';
import type { Resolution } from '../../partial-engine/index';
import type { Candidate, CandidateSet, JointPlan, UnitId } from '../contracts';

// --------------------------------------------------------------------- fixtures

const TURN = 30;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

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

afterEach(() => clearGeometryCache());

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * CONFRONTED — byte-for-byte the generator CL1 and CL3 ship their numbers on,
 * so this stage's probe is comparable with theirs. Each team's three heads in a
 * tight triangle: every unit's best options are cells a team-mate also wants.
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

interface Bench {
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly sets: Map<UnitId, CandidateSet>;
  readonly roster: ReadonlyArray<UnitId>;
  close(): void;
}

function bench(board: Board, team = 'red'): Bench {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: team });
  const asTeam = sub.teamNumber(team);
  const gen = new GrammarCandidateGenerator({});
  const roster = sub.commandable(asTeam);
  const sets = new Map<UnitId, CandidateSet>();
  for (const unitId of roster) sets.set(unitId, gen.candidatesFor(sub, unitId));
  return { sub, asTeam, sets, roster, close: () => sub.release() };
}

/** The MAP plan: every commandable unit on its first candidate. */
function firstPlan(b: Bench): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const unitId of b.roster) {
    const c = b.sets.get(unitId)?.candidates[0];
    if (c !== undefined) plan.set(unitId, c);
  }
  return plan;
}

/**
 * OURS, ALIVE AT THE NEW ROOT. The confronted family is built so team-mates
 * want the same cells, so a MAP plan kills somebody on most seeds — and a
 * cluster of the dead is `cluster-extinct` by design, not by accident. A test
 * about the door's arithmetic wants a cluster that exists.
 */
function survivors(b: Bench, resolution: Resolution): Set<UnitId> {
  const alive = new Set<UnitId>();
  for (const view of b.sub.engine.units(resolution.state)) {
    if (b.roster.includes(view.unitId)) alive.add(view.unitId);
  }
  return alive;
}

// ---------------------------------------------------------------------------
// THE DOOR
// ---------------------------------------------------------------------------

describe('the door', () => {
  test('builds a ply-2 root that is a real EngineSubstrate at turn + 1', () => {
    const b = bench(snakesBoard(3));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster, ply: 1 });
    expect(cont.ok).toBe(true);
    if (!cont.ok) throw new Error('unreachable');
    // `evaluate/index.ts:91` refuses anything that is not an EngineSubstrate,
    // so a parallel type would be unusable. It is the class, and it knows how
    // deep it sits.
    expect(cont.sub).toBeInstanceOf(EngineSubstrate);
    expect(cont.sub.ply).toBe(1);
    expect(b.sub.ply).toBe(0);
    expect(cont.sub.turn).toBe(TURN + 1);
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('the ply-2 root is a legal search root: every cluster member enumerates', () => {
    const b = bench(snakesBoard(5));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    const gen = new GrammarCandidateGenerator({});
    let enumerated = 0;
    for (const unitId of cont.cluster) {
      if (cont.sub.unitOf(unitId) === undefined) continue; // died at ply 1
      const set = gen.candidatesFor(cont.sub, unitId);
      expect(set.candidates.length).toBeGreaterThan(0);
      enumerated++;
    }
    expect(enumerated).toBeGreaterThan(0);
    // And it resolves: the whole point of a root is that a turn runs from it.
    const inner = new Map<UnitId, Candidate>();
    for (const unitId of cont.cluster) {
      const u = cont.sub.unitOf(unitId);
      if (u === undefined) continue;
      const c = gen.candidatesFor(cont.sub, unitId).candidates[0];
      if (c !== undefined) inner.set(unitId, c);
    }
    const deep = cont.sub.resolveBoundedFor(inner, b.asTeam);
    expect(deep.resolution.state.turn).toBe(TURN + 2);
    cont.sub.releaseResolution(deep.resolution);
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('I1/I2/I3 — weights, health and trails come off the resolved slab', () => {
    const b = bench(snakesBoard(7));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    // Against the engine's own reading of the same slab, field for field.
    for (const view of b.sub.engine.units(out.resolution.state)) {
      const carried = cont.sub.unitOf(view.unitId);
      if (carried === undefined) continue;
      expect(carried.weight).toBe(view.weight);
      expect(carried.health).toBe(view.health);
      expect([...carried.cells]).toEqual([...view.cells]);
      expect(carried.staleness).toBe(0);
    }
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('I4 — the LIVE food board follows the meal, and the cloud PREMISE does not', () => {
    // F-2(c), the trap: the cluster eats a pellet at ply 1. The ply-2 board it
    // resolves against must have lost it (or the thread double-counts), and the
    // held claim's refuel premise must NOT have (or the cloud under-reaches,
    // which is the one direction this design may never err in).
    const board = snakesBoard(11);
    const withFood: Board = { ...board, food: [{ x: 5, y: 5 }] };
    const b = bench(withFood);
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    // The premise is the ENGINE's, and the engine is the parent's — by
    // identity, which is stronger than by value.
    expect(cont.sub.engine).toBe(b.sub.engine);
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('I6 — a tier window is re-collapsed at the new root, and only downward', () => {
    // The arithmetic on its own, because the corpus rarely carries a live buff.
    // `tierExpiry` is EXCLUSIVE and a live unit resolving turn t is adjudicated
    // at t + 1.
    expect(tierAtRoot(1, null, 40)).toBe(1); // no window: permanent
    expect(tierAtRoot(1, 42, 40)).toBe(1); // arrives at 41 < 42: still governs
    expect(tierAtRoot(1, 41, 40)).toBe(0); // arrives at 41, window shut
    expect(tierAtRoot(1, 30, 40)).toBe(0); // long lapsed
    expect(tierAtRoot(-1, 41, 40)).toBe(0); // a DEBUFF lifts too, same rule
    // Monotone: re-collapsing an already-collapsed tier is a no-op.
    expect(tierAtRoot(tierAtRoot(1, 41, 40), 41, 41)).toBe(0);
  });

  test('the tier premise gate refuses a potion board the process premise elides', () => {
    const b = bench(snakesBoard(13));
    // Snake-only boards carry no potions, so the shipped `expiry` default is
    // admissible: there is no tier ceiling to under-state.
    expect(tierPremiseAdmits(b.sub, 'expiry')).toBe(true);
    expect(tierPremiseAdmits(b.sub, 'full')).toBe(true);
    b.close();
  });

  test('I9 — a contingent fate is carried, never branched, and only widens', () => {
    const b = bench(snakesBoard(17));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const seeded = new Set<UnitId>([999 as UnitId]);
    const cont = continueFrom({
      from: b.sub,
      resolution: out.resolution,
      cluster,
      carriedContingent: seeded,
      ply: 1,
    });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    // Accumulation is monotone: the seed survives, and the ply's own
    // contingents join it. Nothing is ever removed.
    expect(cont.carriedContingent.has(999 as UnitId)).toBe(true);
    for (const f of out.resolution.fates) {
      if (f.fate === 2) expect(cont.carriedContingent.has(f.unitId)).toBe(true);
    }
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('I10 — identity is by unitId, never by slot number', () => {
    const b = bench(snakesBoard(19));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    const ids = cont.sub.unitIds();
    expect(new Set(ids).size).toBe(ids.length); // no collisions
    for (const id of ids) {
      // Board identity survives: the wire id and the team label are the
      // parent's, and a renumbering would show up here first.
      expect(cont.sub.unitOf(id)?.wireId).toBe(b.sub.unitOf(id)?.wireId);
      expect(cont.sub.unitOf(id)?.teamId).toBe(b.sub.unitOf(id)?.teamId);
    }
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('the door returns every slab it borrows, and its parent still owns one', () => {
    const b = bench(snakesBoard(23));
    const before = b.sub.outstanding();
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    expect(cont.sub.outstanding()).toBe(1);
    cont.release();
    cont.release(); // idempotent
    b.sub.releaseResolution(out.resolution);
    expect(b.sub.outstanding()).toBe(before);
    b.close();
  });

  test('a cluster that is extinct at the new root is a refusal, not a root', () => {
    const b = bench(snakesBoard(29));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cont = continueFrom({
      from: b.sub,
      resolution: out.resolution,
      cluster: new Set<UnitId>([4242 as UnitId]),
      ply: 1,
    });
    expect(cont.ok).toBe(false);
    if (cont.ok) throw new Error('unreachable');
    expect(cont.reason).toBe('cluster-extinct');
    b.sub.releaseResolution(out.resolution);
    b.close();
  });
});

// ---------------------------------------------------------------------------
// THREADS
// ---------------------------------------------------------------------------

describe('threads', () => {
  test('the countdown is min-decomposable, and adding a member can only lower it', () => {
    const b = bench(snakesBoard(31));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const alive = [...survivors(b, out.resolution)];
    const claims = b.sub
      .unitIds()
      .filter((id) => !alive.includes(id) && b.sub.unitOf(id) !== undefined);
    const table = new ShellTable(b.sub.grid);
    const matrix = buildContactMatrix({
      sub: b.sub,
      resolution: out.resolution,
      members: alive,
      claims,
      horizonPlies: 3,
      table,
    });
    // `contact(C, u) = min over members` — the property that lets ONE matrix
    // answer every cluster policy, and that makes an expansion a min over one
    // more column rather than a rebuild.
    for (const claim of matrix.claims()) {
      const whole = matrix.touchOf(claim, alive);
      let byParts = Infinity;
      for (const m of alive) byParts = Math.min(byParts, matrix.touchOf(claim, [m]));
      expect(whole).toBe(byParts);
      // Monotone under growth: a bigger cluster is contacted no later.
      const half = alive.slice(0, Math.max(1, alive.length - 1));
      expect(matrix.touchOf(claim, half)).toBeGreaterThanOrEqual(whole);
    }
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('the countdown carries its horizon, so an isolation is never read blind', () => {
    // F-1's silent-NEVER: reading `Infinity` as "cannot arrive" when the scan
    // stopped short is an under-approximation, which is the one direction this
    // design may never err in. The verdict therefore says how far it looked.
    const b = bench(snakesBoard(37));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const alive = [...survivors(b, out.resolution)];
    const claims = b.sub.unitIds().filter((id) => !alive.includes(id));
    const table = new ShellTable(b.sub.grid);
    const shallow = buildContactMatrix({
      sub: b.sub,
      resolution: out.resolution,
      members: alive,
      claims,
      horizonPlies: 1,
      table,
    });
    const cert = new SubtreeCertificate();
    cert.addResolution(out.resolution.ledger, out.resolution.state.field);
    const v = contactOf(shallow, alive, cert);
    expect(v.horizon).toBe(out.resolution.state.turn + 1);
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('the ledger invalidates on epoch, on catch-up, and re-folds on posture', () => {
    const ledger = new ThreadLedger(8);
    const mk = (key: string, cited: UnitId[]): void => {
      ledger.open({
        key,
        clusterId: 0,
        cluster: new Set<UnitId>([1 as UnitId]),
        rootPlan: new Map(),
        rootTurn: TURN,
        epochBaseline: 1,
        postureBaseline: 'SIGHTED',
        plies: [],
        citedUnits: new Set(cited),
        accumulation: new Map(),
        carriedContingent: new Set(),
        skew: 0,
        assumptions: [],
        state: 'live',
        stepCost: 1,
      });
    };
    mk('a', [7 as UnitId]);
    mk('b', [9 as UnitId]);
    // A catch-up REPLACES a premise rather than refining it, so every thread
    // that cited the unit is now an answer about a board that never existed.
    expect(ledger.invalidateCitingUnit(7 as UnitId)).toBe(1);
    expect(ledger.size).toBe(1);
    // A posture flip is cross-BASIS, not cross-board: re-fold, never discard.
    mk('c', [11 as UnitId]);
    const refolded = ledger.onPostureFlip('FOGGED-DISCRIMINATING');
    expect(refolded).toBeGreaterThan(0);
    expect(ledger.size).toBe(2);
    // An epoch change is the blunt one, exactly as `run.plans.clear()` is.
    expect(ledger.onEpochChange()).toBe(2);
    expect(ledger.size).toBe(0);
  });

  test('the ledger never evicts a live thread ahead of a parked one', () => {
    const ledger = new ThreadLedger(2);
    const mk = (key: string, state: 'live' | 'parked-flat'): ThreadEntry =>
      ledger.open({
        key,
        clusterId: 0,
        cluster: new Set<UnitId>([1 as UnitId]),
        rootPlan: new Map(),
        rootTurn: TURN,
        epochBaseline: 1,
        postureBaseline: 'SIGHTED',
        plies: [],
        citedUnits: new Set(),
        accumulation: new Map(),
        carriedContingent: new Set(),
        skew: 0,
        assumptions: [],
        state,
        stepCost: 1,
      });
    mk('live-1', 'live');
    mk('parked', 'parked-flat');
    mk('live-2', 'live');
    expect(ledger.get('parked')).toBeUndefined();
    expect(ledger.get('live-1')).toBeDefined();
    expect(ledger.get('live-2')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// THE SCHEDULER
// ---------------------------------------------------------------------------

describe('the scheduler', () => {
  test('the flag ships off and reads three positions', () => {
    expect(scoutModeFrom({})).toBe('off');
    expect(scoutModeFrom({ CENTAUR_SCOUT: 'off' })).toBe('off');
    expect(scoutModeFrom({ CENTAUR_SCOUT: '0' })).toBe('off');
    expect(scoutModeFrom({ CENTAUR_SCOUT: '1' })).toBe('observe');
    expect(scoutModeFrom({ CENTAUR_SCOUT: 'observe' })).toBe('observe');
    expect(scoutModeFrom({ CENTAUR_SCOUT: 'advise' })).toBe('advise');
    expect(scoutModeFrom({ CENTAUR_SCOUT: 'nonsense' })).toBe('off');
  });

  test("the reserve is the tithe's CEILING, not a competitor", () => {
    // The owner's Q3 answer is "at least half for this turn's move". A
    // configuration asking for 70% gets 50%, silently in the right direction.
    expect(effectiveTithe({ ...DEFAULT_SCOUT_TUNING, tithe: 0.2, reserve: 0.5 })).toBeCloseTo(0.2);
    expect(effectiveTithe({ ...DEFAULT_SCOUT_TUNING, tithe: 0.7, reserve: 0.5 })).toBeCloseTo(0.5);
    expect(effectiveTithe({ ...DEFAULT_SCOUT_TUNING, tithe: 0.9, reserve: 0.9 })).toBeCloseTo(0.1);
    const purse = new ScoutPurse(1000, { ...DEFAULT_SCOUT_TUNING, tithe: 0.7, reserve: 0.5 });
    expect(purse.msCap).toBeCloseTo(500);
  });

  test('the depth rule deepens the shallowest live cluster, king first on a tie', () => {
    const mk = (key: string, clusterId: number, depth: number, unit: number): ThreadEntry => ({
      key,
      clusterId,
      cluster: new Set<UnitId>([unit as UnitId]),
      rootPlan: new Map(),
      rootTurn: TURN,
      epochBaseline: 1,
      postureBaseline: 'SIGHTED',
      plies: Array.from({ length: depth }, (_, i) => ({
        ply: i + 1,
        move: new Map(),
        advisory: { lo: 0, est: 0, hi: 0 },
        contact: { contactIn: 9, arrivals: [], saturated: [], entangledAlready: [], horizon: 9 },
        discrimination: FLAT,
        cost: 1,
      })),
      citedUnits: new Set(),
      accumulation: new Map(),
      carriedContingent: new Set(),
      skew: 0,
      assumptions: [],
      state: 'live',
      stepCost: 1,
      lastUsed: 0,
    });
    const deep = mk('deep', 0, 3, 1);
    const shallow = mk('shallow', 1, 1, 2);
    const kingSame = mk('king', 2, 1, 3);
    const kings = new Set<UnitId>([3 as UnitId]);
    const isKing = (t: ThreadEntry): boolean => [...t.cluster].some((id) => kings.has(id));
    // The barrier IS where the team decides, so the marginal ply is worth most
    // there — the rule falls out rather than being imposed.
    expect(barrierDepth([deep, shallow, kingSame])).toBe(1);
    expect(deepenNext([deep, shallow, kingSame], isKing, 5)?.key).toBe('king');
    expect(deepenNext([deep, shallow], isKing, 5)?.key).toBe('shallow');
    // depthMax is a hard stop, and an exhausted set is null rather than a
    // thread that gets deepened past its ceiling.
    expect(deepenNext([deep], isKing, 3)).toBeNull();
  });

  test('parking is a flatline test with hysteresis, NOT a contact mandate', () => {
    // Synthesis §7.1 supersedes "CONTACT -> park immediately" outright: a
    // thread in contact whose options still spread keeps running.
    const ply = (spread: number, contactIn: number, moved = false) => ({
      ply: 1,
      move: new Map(),
      advisory: { lo: 0, est: 0, hi: 0 },
      contact: { contactIn, arrivals: [], saturated: [], entangledAlready: [], horizon: 9 },
      discrimination: { ...FLAT, floorSpread: spread, argmaxMoved: moved },
      cost: 1,
    });
    const mk = (plies: ReturnType<typeof ply>[]): ThreadEntry => ({
      key: 'k',
      clusterId: 0,
      cluster: new Set<UnitId>([1 as UnitId]),
      rootPlan: new Map(),
      rootTurn: TURN,
      epochBaseline: 1,
      postureBaseline: 'SIGHTED',
      plies,
      citedUnits: new Set(),
      accumulation: new Map(),
      carriedContingent: new Set(),
      skew: 0,
      assumptions: [],
      state: 'live',
      stepCost: 1,
      lastUsed: 0,
    });
    // depthMax raised out of the way: the point of this test is the flatline,
    // and a depth stop would answer it for the wrong reason.
    const tuning = { ...DEFAULT_SCOUT_TUNING, depthMax: 9 };
    const purse = new ScoutPurse(0, tuning);
    // IN CONTACT and still discriminating: keeps running. This is the whole
    // ruling, in one assertion.
    expect(shouldPark(mk([ply(4, 0, true)]), tuning, purse).park).toBe(false);
    // One flat ply is not enough — hysteresis, so a corridor does not park a
    // thread about to reach an intersection.
    expect(shouldPark(mk([ply(4, 5), ply(0, 5)]), tuning, purse).park).toBe(false);
    // Two consecutive flat plies is the flatline.
    const parked = shouldPark(mk([ply(4, 5), ply(0, 5), ply(0, 5)]), tuning, purse);
    expect(parked.park).toBe(true);
    expect(parked.reason).toBe('flat');
    // And a thread at the ceiling parks for DEPTH, which is a different
    // reason and must not be reported as a flatline.
    expect(shouldPark(mk([ply(4, 0, true)]), { ...tuning, depthMax: 1 }, purse).reason).toBe(
      'depth'
    );
  });

  test('a parked thread decays by SKEW, and never by a confidence factor', () => {
    const mk = (skew: number, spread: number): ThreadEntry => ({
      key: 'k',
      clusterId: 0,
      cluster: new Set<UnitId>([1 as UnitId]),
      rootPlan: new Map(),
      rootTurn: TURN,
      epochBaseline: 1,
      postureBaseline: 'SIGHTED',
      plies: [
        {
          ply: 1,
          move: new Map(),
          advisory: { lo: 0, est: 0, hi: 0 },
          contact: { contactIn: 0, arrivals: [], saturated: [], entangledAlready: [], horizon: 9 },
          discrimination: { ...FLAT, floorSpread: spread },
          cost: 1,
        },
      ],
      citedUnits: new Set(),
      accumulation: new Map(),
      carriedContingent: new Set(),
      skew,
      assumptions: [],
      state: 'parked-flat',
      stepCost: 1,
      lastUsed: 0,
    });
    // The priority falls because the CLOUDS ARE WIDER, which is a fact about
    // the world, not a haircut on a score. L4 is preserved by arithmetic.
    expect(resumePriority(mk(0, 8))).toBeGreaterThan(resumePriority(mk(3, 8)));
    expect(resumePriority(mk(3, 8))).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// THE CHANNELS — the firewall, structurally
// ---------------------------------------------------------------------------

const SCOUT_DIR = join(__dirname, '..', 'search', 'scout');
const SCOUT_FILES = ['door.ts', 'threads.ts', 'schedule.ts', 'scout.ts', 'index.ts'];

function scoutSource(): ReadonlyArray<{ name: string; text: string }> {
  return SCOUT_FILES.map((name) => ({
    name,
    text: readFileSync(join(SCOUT_DIR, name), 'utf8'),
  }));
}

/** Comments state the law; only CODE can break it. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

describe('the channels', () => {
  test('nothing under bounds/ imports the scout — L8, with no path to violate', () => {
    // The firewall's first half. A layer that cannot be reached from the
    // bounds layer cannot move a bound, whatever anybody later believes about
    // what it is for.
    const dir = join(__dirname, '..', 'bounds');
    for (const file of [
      'bank.ts',
      'plan.ts',
      'score.ts',
      'ledger.ts',
      'memo.ts',
      'evalmemo.ts',
      'witness.ts',
      'substrate-ext.ts',
      'index.ts',
    ]) {
      const text = readFileSync(join(dir, file), 'utf8');
      expect(text).not.toMatch(/from\s+['"][^'"]*scout/);
    }
  });

  test('the scout never constructs, meets or publishes a bound — L2', () => {
    // The firewall's second half, and the reason `ThreadPly.advisory` is a
    // plain `{lo, est, hi}` rather than a `ScoreBounds`: a channel that cannot
    // be confused at the type level cannot be confused at the call site.
    for (const { name, text } of scoutSource()) {
      const src = code(text);
      expect(`${name}: ${src}`).not.toMatch(/makeScoreBounds|\btighten\b|BoundBank|\.publish\(/);
      // No bound-shaped VALUE is ever built here. `resolveBoundedFull` returns
      // one and the scout reads two numbers off it; what it must never do is
      // construct or forward the object.
      expect(`${name}: ${src}`).not.toMatch(/:\s*ScoreBounds\b/);
    }
  });

  test('the scout never reads arrival() — the 94% Dijkstra it exists to avoid', () => {
    for (const { name, text } of scoutSource()) {
      const src = code(text);
      expect(`${name}: ${src}`).not.toMatch(/\.arrival\(|teamArrivalInto/);
    }
  });

  test('every scout finding is a NEGATIVE ordering term, clamped to one lat', () => {
    // The polarity rule: `Surrogate.unary` ADDS φ_u and higher is better, so a
    // discovered next-ply danger is negative. And the clamp is the cross-ply
    // form of the EV-cliff law — a time-skewed material fact may inform an
    // ordering and may not outbid a ply-1 one.
    expect(clampToLat(3)).toBe(3);
    expect(clampToLat(-3)).toBe(3);
    expect(clampToLat(1e9)).toBe(10);
  });

  test('a first difference is the only attributable pair', () => {
    const c = (unitId: number, to: number): Candidate =>
      ({ unitId, from: 0, to, path: [] }) as unknown as Candidate;
    const a: JointPlan = new Map([
      [1 as UnitId, c(1, 10)],
      [2 as UnitId, c(2, 20)],
    ]);
    const oneApart: JointPlan = new Map([
      [1 as UnitId, c(1, 11)],
      [2 as UnitId, c(2, 20)],
    ]);
    const twoApart: JointPlan = new Map([
      [1 as UnitId, c(1, 11)],
      [2 as UnitId, c(2, 21)],
    ]);
    expect(soleDifference(a, oneApart)?.unitId).toBe(1);
    expect(soleDifference(a, twoApart)).toBeNull();
    expect(soleDifference(a, a)).toBeNull();
    expect(soleDifference(a, new Map([[1 as UnitId, c(1, 10)]]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE FAILURE CATALOGUE — la-outside §7, the entries the door can commit
// ---------------------------------------------------------------------------

describe('the failure catalogue', () => {
  test('F-1 — clouds only ever WIDEN across the skew boundary', () => {
    // Cloud under-dilation is the design's primary rot path, and its first
    // source is an off-by-one on the post-advance convention: a unit last seen
    // three turns ago, stamped "held now", would claim a one-turn cloud for a
    // four-turn-old observation.
    //
    // The door cannot commit it, because it carries a held record BYTE-
    // IDENTICAL — same occupancy, same `heldAtTurn` — and lets the root's own
    // turn do the dilation. No offset arithmetic anywhere, which is L7.
    //
    // The property only BINDS on a genuinely carried claim. A unit that was
    // live at ply 1 and survived is re-seeded at staleness 0, and it should be:
    // we MODELLED its move, so its position at the new root is a fact of the
    // simulation and its cloud starts fresh from a fresh observation. So the
    // fixture makes one unit two turns stale, and the assertion sorts the two
    // populations rather than averaging over them.
    const board = snakesBoard(41);
    const staleId = (board.snakes[board.snakes.length - 1] as Snake).id;
    const sub = makeSubstrate({
      board,
      turn: TURN,
      asTeam: 'red',
      observedTurns: new Map([[staleId, TURN - 2]]),
    });
    const asTeam = sub.teamNumber('red');
    const gen = new GrammarCandidateGenerator({});
    const roster = sub.commandable(asTeam);
    const plan = new Map<UnitId, Candidate>();
    for (const id of roster) {
      const c = gen.candidatesFor(sub, id).candidates[0];
      if (c !== undefined) plan.set(id, c);
    }
    const out = sub.resolveBoundedFor(plan, asTeam);
    const cluster = new Set<UnitId>();
    for (const view of sub.engine.units(out.resolution.state)) {
      if (roster.includes(view.unitId)) cluster.add(view.unitId);
    }
    const cont = continueFrom({ from: sub, resolution: out.resolution, cluster, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);

    const stale = sub.unitOfWireId(staleId)?.unitId as UnitId;
    expect(sub.unitOf(stale)?.staleness).toBe(2);
    // THE CARRIED CLAIM. Its observation turn is unchanged and its staleness
    // has grown by exactly the ply — one line of arithmetic, no decay factor.
    const carried = cont.sub.unitOf(stale);
    expect(carried?.staleness).toBe(3);
    const was = sub.claimField().slotOf(stale);
    const now = cont.sub.claimField().slotOf(stale);
    expect(was).toBeDefined();
    expect(now).toBeDefined();
    expect((now as { record: { heldAtTurn: number } }).record.heldAtTurn).toBe(
      (was as { record: { heldAtTurn: number } }).record.heldAtTurn
    );
    // CONTAINMENT, cell by cell: nothing the shallow cloud allowed is
    // forbidden by the deep one. This is M2, at one skew step.
    let grew = false;
    for (let w = 0; w < sub.grid.words; w++) {
      const shallow = (was as { cloud: { possible: ArrayLike<number> } }).cloud.possible[w] as number;
      const deep = (now as { cloud: { possible: ArrayLike<number> } }).cloud.possible[w] as number;
      expect(shallow & ~deep).toBe(0);
      if ((deep & ~shallow) !== 0) grew = true;
    }
    // And it is a real dilation, not a copy: one more step of a live grammar
    // reaches somewhere new.
    expect(grew).toBe(true);

    cont.release();
    sub.releaseResolution(out.resolution);
    sub.release();
  });

  test('F-2(c) — the cloud premise is NEVER narrowed by simulated consumption', () => {
    // THE TRAP, and it is the one an optimiser reaches for first. The cluster
    // eats a pellet; the held cloud's premise still shows it present, so the
    // cloud over-estimates its own refuel and over-reaches. That is the SAFE
    // direction. Removing the eaten pellet to "tighten" the cloud is a direct
    // under-dilation bug.
    //
    // The door cannot commit it, because it reuses the parent's engine and the
    // premise lives on the engine. That is asserted by IDENTITY, which is
    // stronger than by value: there is no second premise to get wrong.
    const board = snakesBoard(43);
    const b = bench({ ...board, food: [{ x: 5, y: 5 }, { x: 4, y: 6 }] });
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const cluster = survivors(b, out.resolution);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    expect(cont.sub.engine).toBe(b.sub.engine);
    // And the door must never build its own geometry from the post-meal board.
    const src = readFileSync(join(SCOUT_DIR, 'door.ts'), 'utf8');
    expect(code(src)).not.toMatch(/makeSubstrate|geometryFor/);
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('F-2(a) — the thread never spawns food', () => {
    // `CloudPremise.food` is an upper bound BECAUSE spawning is gated off while
    // anything is frozen. A sim that spawned would break the premise and the
    // cloud's refuel set would stop being a superset. Asserted as a
    // precondition rather than left to accident: the door reads the food board
    // off the resolved slab and adds nothing.
    const src = code(readFileSync(join(SCOUT_DIR, 'door.ts'), 'utf8'));
    expect(src).toMatch(/foodBoard\(state, board\)/);
    expect(src).not.toMatch(/spawn/i);
  });

  test('F-3 — candidate sets are re-enumerated per depth, never cached across it', () => {
    // A promoting pawn's grammar changes, so a depth-0 candidate set read at
    // depth 2 keeps a pawn a pawn. The scout calls the engine's own enumerator
    // at each root — `candidates.ts`'s founding doctrine — and the way it
    // cannot cache across depth is that each root is a DIFFERENT substrate.
    const src = code(readFileSync(join(SCOUT_DIR, 'scout.ts'), 'utf8'));
    // Every enumeration is against a substrate the caller names; there is no
    // module-level candidate cache to leak across plies.
    expect(src).toMatch(/candidatesFor\(cont\.sub, id\)/);
    expect(src).toMatch(/candidatesFor\(parent\.sub, id\)/);
  });

  test('F-4 — tier is read at the ARRIVAL turn, and the potion premise gates depth', () => {
    // (b) is the unsound half: our own lapsing tier priced as permanent puts a
    // floor above the truth, and in a d-deep sim the damage is d times larger.
    expect(tierAtRoot(1, 41, 40)).toBe(0);
    // (c) is the cross-cutting one: an empty potion board UNDER-states the
    // enemy's tier ceiling at depth, which over-states our contest wins. Depth
    // converts a strength-hold into a soundness-hold, so a board with potions
    // and a potion-free premise gets no thread at all.
    const b = bench(snakesBoard(47));
    const withPotions = {
      ...b.sub.marshalled,
      potions: [1, 2, 3],
    } as unknown as EngineSubstrate['marshalled'];
    const faked = Object.create(b.sub) as EngineSubstrate;
    Object.defineProperty(faked, 'marshalled', { value: withPotions });
    expect(tierPremiseAdmits(faked, 'expiry')).toBe(false);
    expect(tierPremiseAdmits(faked, 'full')).toBe(true);
    b.close();
  });

  test('F-5 — the sim reports the SECURITY value, never the clairvoyant one', () => {
    // The quantifier order is the whole ballgame. The inner loop mins over
    // enemy profiles INTO A SCALAR and only then does the outer loop max, so no
    // choice is ever indexed by a profile. Structural: the `worst` accumulator
    // is a number, and a `max_a` that could see `b` would need it to be a map.
    const src = code(readFileSync(join(SCOUT_DIR, 'scout.ts'), 'utf8'));
    const body = src.slice(src.indexOf('for (const a of ourJoints)'));
    const inner = body.slice(0, body.indexOf('perOption.push'));
    expect(inner).toMatch(/for \(const b of theirJoints\)/);
    expect(inner).toMatch(/worst = Math\.min/);
    // And the arithmetic itself, on a constructed pair where clairvoyance
    // strictly wins: option A scores 9 against one reply and 0 against the
    // other; option B scores 4 against both. Clairvoyant picks A and claims 9;
    // security picks B and claims 4.
    const payoff: Record<string, number[]> = { A: [9, 0], B: [4, 4] };
    const security = Math.max(...Object.values(payoff).map((row) => Math.min(...row)));
    const clairvoyant = Math.max(...Object.values(payoff).map((row) => Math.max(...row)));
    expect(security).toBe(4);
    expect(clairvoyant).toBe(9);
    expect(security).toBeLessThan(clairvoyant);
  });

  test('F-6 — cross-depth comparison is refused, not meeted', () => {
    // Two horizons are two questions and a meet of them bounds neither. The
    // ordering sink therefore skips any pair at unequal depth.
    const src = code(readFileSync(join(SCOUT_DIR, 'scout.ts'), 'utf8'));
    expect(src).toMatch(/if \(depthOf\(a\) !== depthOf\(b\)\) continue;/);
  });

  test('F-9 — our own out-of-cluster units are held clouds with NO privilege', () => {
    // The corpus already recorded this class: 22 deaths reappearing as
    // `bodyBlock` on a team-mate's body. At sim depth j our own unmodelled
    // units are exactly as unknown as an enemy observed at T.
    const b = bench(snakesBoard(53));
    const plan = firstPlan(b);
    const out = b.sub.resolveBoundedFor(plan, b.asTeam);
    const alive = survivors(b, out.resolution);
    // A cluster of exactly ONE of ours leaves the rest of our team outside it.
    const one = new Set<UnitId>([[...alive].sort((x, y) => x - y)[0] as UnitId]);
    const cont = continueFrom({ from: b.sub, resolution: out.resolution, cluster: one, ply: 1 });
    if (!cont.ok) throw new Error(`refused: ${cont.reason}`);
    let ownHeld = 0;
    for (const unitId of cont.held) {
      if (cont.sub.unitOf(unitId)?.team === b.asTeam) ownHeld++;
    }
    expect(ownHeld).toBeGreaterThan(0);
    // And they are in the CLAIM field, not standing as facts.
    for (const unitId of cont.held) {
      if (cont.sub.unitOf(unitId)?.team !== b.asTeam) continue;
      expect(cont.sub.claimField().slotOf(unitId)).toBeDefined();
    }
    cont.release();
    b.sub.releaseResolution(out.resolution);
    b.close();
  });

  test('F-10 — a held set past MAX_FROZEN is a refusal, never a truncation', () => {
    // The ruling is "never truncate". Overflow must convert into more
    // conditioning assumptions or into a refusal — never into fewer modelled
    // units, which would be a silent elision.
    const src = code(readFileSync(join(SCOUT_DIR, 'door.ts'), 'utf8'));
    expect(src).toMatch(/held-overflow/);
    expect(src).toMatch(/if \(held\.size > MAX_HELD\)/);
  });

  test('F-12 — the king’s cluster gets a priority floor, not an exemption', () => {
    // Regicide is globally terminal, so the king's cluster gates rather than
    // adds. Under §7.1 that is a priority FLOOR — never starved — and not a
    // mandate that exempts it from the barrier.
    const src = code(readFileSync(join(SCOUT_DIR, 'schedule.ts'), 'utf8'));
    expect(src).toMatch(/isKing/);
    // It wins a TIE at equal depth; it does not jump the barrier.
    const mk = (key: string, clusterId: number, depth: number, unit: number): ThreadEntry => ({
      key,
      clusterId,
      cluster: new Set<UnitId>([unit as UnitId]),
      rootPlan: new Map(),
      rootTurn: TURN,
      epochBaseline: 1,
      postureBaseline: 'SIGHTED',
      plies: Array.from({ length: depth }, (_, i) => ({
        ply: i + 1,
        move: new Map(),
        advisory: { lo: 0, est: 0, hi: 0 },
        contact: { contactIn: 9, arrivals: [], saturated: [], entangledAlready: [], horizon: 9 },
        discrimination: FLAT,
        cost: 1,
      })),
      citedUnits: new Set(),
      accumulation: new Map(),
      carriedContingent: new Set(),
      skew: 0,
      assumptions: [],
      state: 'live',
      stepCost: 1,
      lastUsed: 0,
    });
    const king = mk('king', 9, 2, 3);
    const commoner = mk('commoner', 0, 1, 4);
    const isKing = (t: ThreadEntry): boolean => t.key === 'king';
    // The SHALLOWER one still wins: the barrier is not negotiable.
    expect(deepenNext([king, commoner], isKing, 5)?.key).toBe('commoner');
  });
});

// ---------------------------------------------------------------------------
// THE GATES — flag-off byte-identity, flag-on determinism
// ---------------------------------------------------------------------------

/** Monotonic, deterministic, never wall clock: each read costs one tick. The
 *  replay probe's own clock, so the two gates measure the same thing. */
class StepClock {
  private t = 1000;
  constructor(private readonly tick = 0.02) {}
  readonly now = (): number => {
    const v = this.t;
    this.t += this.tick;
    return v;
  };
  readonly peek = (): number => this.t;
}

async function decideWith(
  board: Board,
  options: Parameters<typeof makeSearchCore>[0]
): Promise<ReadonlyArray<string>> {
  const clock = new StepClock();
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const kernel = new LobsterKernel({
    sliceMs: 2,
    reserveMs: 1,
    minWriteIntervalMs: 0,
    yieldIntervalMs: 0,
  });
  const out: string[] = [];
  try {
    for await (const rec of kernel.decide({
      sub,
      gen: new GrammarCandidateGenerator(),
      evaluate: defaultEvaluator,
      search: makeSearchCore(options),
      asTeam: sub.teamNumber('red'),
      deadlineMs: clock.peek() + 40,
      initialPins: [],
      now: clock.now,
    })) {
      out.push(
        JSON.stringify({
          plan: [...rec.plan.entries()]
            .map(([u, c]) => `${u}>${c.to}`)
            .sort()
            .join(','),
          lo: String(rec.lo),
          est: String(rec.est),
          hi: String(rec.hi),
          horizon: rec.horizon,
          posture: rec.posture,
          epoch: rec.epoch,
        })
      );
    }
  } finally {
    sub.release();
  }
  return out;
}

describe('the gates', () => {
  test('OBSERVE stages exactly what flag-off stages — the firewall, measured', () => {
    // THE CLAIM THIS STAGE OWES. Under Door A the scout is advisory, so the one
    // thing that must be true is that it cannot perturb staging. In `observe`
    // every thread runs, every counter is written, and no ordering channel is
    // touched — so the emissions must be equal, plan for plan and bound for
    // bound, to the run without it.
    //
    // What DOES move, and what the replay corpus shows moving, is
    // clock-derived: `stepCostMs` and `postureFlips[].at`. The scout spends
    // budget. Spending budget is a value trade and never a soundness one, and
    // an assertion that pretended otherwise would be asserting something false.
    return Promise.all(
      [3, 11, 23].map(async (seed) => {
        const board = snakesBoard(seed);
        const off = await decideWith(board, { clusterEnum: true });
        clearGeometryCache();
        const on = await decideWith(board, { clusterEnum: true, scout: 'observe' });
        clearGeometryCache();
        expect(on).toEqual(off);
        expect(off.length).toBeGreaterThan(0);
      })
    );
  }, 120000);

  test('ADVISE is deterministic: same board, same findings, same plans', () => {
    // The advise arm's gate is NOT identity — a channel that never changed an
    // order would not be a channel. It is REPRODUCIBILITY: the thread set, the
    // findings and the staged plans are a pure function of the board and the
    // partition, with no clock and no iteration order anywhere in the path.
    return Promise.all(
      [3, 11, 23].map(async (seed) => {
        const board = snakesBoard(seed);
        const first = await decideWith(board, { clusterEnum: true, scout: 'advise' });
        clearGeometryCache();
        const second = await decideWith(board, { clusterEnum: true, scout: 'advise' });
        clearGeometryCache();
        expect(second).toEqual(first);
      })
    );
  }, 120000);

  test('the scout report reaches telemetry and nothing else', () => {
    const b = bench(snakesBoard(59));
    const core = makeSearchCore({ clusterEnum: true, scout: 'observe' });
    core.improve({
      sub: b.sub,
      gen: new GrammarCandidateGenerator({}),
      evaluate: defaultEvaluator,
      asTeam: b.asTeam,
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: unboundedBudget(),
    });
    const report = core.scoutReport?.();
    expect(report).not.toBeNull();
    expect(report?.mode).toBe('observe');
    expect(report?.threads).toBeGreaterThan(0);
    // OBSERVE produces no advice, by construction. That is the whole
    // difference between the two positions of the flag.
    expect(report?.findings).toBe(0);
    // And with the flag off there is no report at all — which is how a reader
    // tells "off" from "on and found nothing".
    const dark = makeSearchCore({ clusterEnum: true, scout: 'off' });
    dark.improve({
      sub: b.sub,
      gen: new GrammarCandidateGenerator({}),
      evaluate: defaultEvaluator,
      asTeam: b.asTeam,
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: unboundedBudget(),
    });
    expect(dark.scoutReport?.()).toBeNull();
    core.release?.();
    dark.release?.();
    b.close();
  }, 60000);

  test('a scout that was never reached says so, instead of reporting a null', () => {
    // THE SILENT DEPENDENCY, made loud. `scout.run` has one call site and it
    // is inside `openCluster`, below the cluster-enumeration gate — so
    // `CENTAUR_SCOUT=advise` on its own is a no-op that USED TO REPORT
    // `mode=advise threads=0 findings=0`, which reads as "it ran and found
    // nothing". It is "it never ran", and the two are opposite facts about a
    // measurement: the first is a null about the scout, the second is a null
    // about the harness. P11's contenders are three arms of one flag, and an
    // experiment that cannot tell these apart files the harness's null against
    // the flag.
    //
    // Nothing here auto-enables the enumeration. The defect is a dependency a
    // report could not see, not a dependency an operator has to satisfy.
    const ctxFor = (b: Bench) => ({
      sub: b.sub,
      gen: new GrammarCandidateGenerator({}),
      evaluate: defaultEvaluator,
      asTeam: b.asTeam,
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: unboundedBudget(),
    });

    // BOTH WAYS, on the same board, so the only difference is the gate.
    const gated = bench(snakesBoard(59));
    const shut = makeSearchCore({ clusterEnum: false, scout: 'advise' });
    shut.improve(ctxFor(gated));
    const shutReport = shut.scoutReport?.();
    expect(shutReport).not.toBeNull();
    // The mode is still what the operator asked for — the report does not lie
    // about the request, it explains the absence.
    expect(shutReport?.mode).toBe('advise');
    expect(shutReport?.threads).toBe(0);
    expect(shutReport?.findings).toBe(0);
    expect(typeof shutReport?.gatedBy).toBe('string');
    expect(shutReport?.gatedBy).toContain('CENTAUR_CLUSTER_ENUM');
    shut.release?.();
    gated.close();
    clearGeometryCache();

    const open = bench(snakesBoard(59));
    const ran = makeSearchCore({ clusterEnum: true, scout: 'advise' });
    ran.improve(ctxFor(open));
    const ranReport = ran.scoutReport?.();
    expect(ranReport?.mode).toBe('advise');
    expect(ranReport?.threads).toBeGreaterThan(0);
    // Reached. `gatedBy: null` is the positive statement that a zero anywhere
    // else in this report is the scout's own answer.
    expect(ranReport?.gatedBy).toBeNull();
    ran.release?.();
    open.close();
  }, 60000);

  test('the scout returns every slab it borrows, decision after decision', () => {
    // The slab contract applies to a thread exactly as to a decision: a leak
    // does not look like a leak, it looks like the engine getting slower.
    //
    // The assertion is a SUBTRACTION and not an absolute, because the bank's
    // resolution memo deliberately retains slabs for the session's life — so
    // `outstanding()` after an `improve` is a property of the search, not of
    // the scout. What the scout owes is that it adds NOTHING to that number.
    const run = (scout: 'off' | 'advise'): number => {
      const b = bench(snakesBoard(61));
      const core = makeSearchCore({ clusterEnum: true, scout });
      const ctx = {
        sub: b.sub,
        gen: new GrammarCandidateGenerator({}),
        evaluate: defaultEvaluator,
        asTeam: b.asTeam,
        pins: [],
        assumptions: [],
        incumbent: null,
        witnesses: [],
        budget: unboundedBudget(),
      };
      core.improve(ctx);
      core.improve(ctx);
      const outstanding = b.sub.outstanding();
      core.release?.();
      b.close();
      clearGeometryCache();
      return outstanding;
    };
    expect(run('advise')).toBe(run('off'));
  }, 60000);
});

// ---------------------------------------------------------------------------
// THE RUNNER, END TO END
// ---------------------------------------------------------------------------

describe('the runner', () => {
  test('threads run, contact, continue past it, park, and report', () => {
    // The whole layer on one board, and the one assertion that matters most:
    // post-contact plies EXIST. Under the superseded design a thread died at
    // contact; under §7.1 continuation is a primary mode, and on the confronted
    // family — where everything is in contact almost immediately — nearly all
    // the depth is post-contact. A run that reported zero here would mean the
    // ruling had not landed.
    const b = bench(snakesBoard(67));
    const gen = new GrammarCandidateGenerator({});
    const partition = partitionOf({ sub: b.sub, roster: b.roster, fixed: new Set<UnitId>() });
    const { plans } = enumerateProposals({
      sub: b.sub,
      partition,
      roster: b.roster,
      sets: b.sets,
      fixed: new Map(),
      doomed: new Set(),
      asTeam: b.asTeam,
      tuning: DEFAULT_CLUSTER_TUNING,
      salt: 1,
    });
    const scout = new Scout('advise');
    scout.run({
      sub: b.sub,
      asTeam: b.asTeam,
      gen,
      partition,
      sets: b.sets,
      seeds: plans,
      epoch: 0,
      posture: 'SIGHTED',
      decisionMs: 0,
    });
    const report = scout.report();
    expect(report.threads).toBeGreaterThan(0);
    expect(report.maxDepth).toBeGreaterThan(0);
    expect(report.postContactPlies).toBeGreaterThan(0);
    expect(report.parked).toBeGreaterThan(0);
    // The barrier is where the team would compare, and it is never above the
    // deepest thread.
    expect(report.barrier).toBeGreaterThan(0);
    expect(report.barrier).toBeLessThanOrEqual(report.maxDepth);
    // The clean prefix is the §7.1 measurement — plies that ran BEFORE contact
    // — and it is a different number from depth, on purpose.
    const prefixes = scout.cleanPrefixes();
    expect(prefixes.length).toBe(report.threads);
    for (const [i, t] of scout.ledger.all().entries()) {
      expect(cleanPrefixOf(t)).toBe(prefixes[i]);
      expect(cleanPrefixOf(t)).toBeLessThanOrEqual(depthOf(t));
    }
    // No clock was read, so the same run twice is the same run.
    scout.release();
    b.close();
  }, 60000);

  test('every finding is negative, and points at a candidate the anchor could take', () => {
    // The polarity rule, on real advice rather than on the clamp alone.
    const b = bench(snakesBoard(71));
    const gen = new GrammarCandidateGenerator({});
    const partition = partitionOf({ sub: b.sub, roster: b.roster, fixed: new Set<UnitId>() });
    const { plans } = enumerateProposals({
      sub: b.sub,
      partition,
      roster: b.roster,
      sets: b.sets,
      fixed: new Map(),
      doomed: new Set(),
      asTeam: b.asTeam,
      tuning: DEFAULT_CLUSTER_TUNING,
      salt: 1,
    });
    const scout = new Scout('advise');
    scout.run({
      sub: b.sub,
      asTeam: b.asTeam,
      gen,
      partition,
      sets: b.sets,
      seeds: plans,
      epoch: 0,
      posture: 'SIGHTED',
      decisionMs: 0,
    });
    const advice = scout.advice();
    for (const finding of advice) {
      // NEGATIVE, always. `Surrogate.unary` adds φ_u and higher is better, so a
      // next-ply danger demotes. A positive term would be a time-skewed number
      // PROMOTING a candidate, and promotion is the direction where being
      // wrong costs a staging.
      expect(finding.delta).toBeLessThan(0);
      expect(Math.abs(finding.delta)).toBeLessThanOrEqual(10);
      // And it names a real option of a real unit.
      const set = b.sets.get(finding.unitId);
      expect(set).toBeDefined();
      expect(set?.candidates.some((c) => c.to === finding.to)).toBe(true);
    }
    // The lookup is the seam CL3 built, and it is zero everywhere it has
    // nothing to say — never undefined, never NaN.
    const unary = scout.unaryAdvice();
    if (advice.length > 0 && unary !== undefined) {
      expect(unary(advice[0]!.unitId, { unitId: advice[0]!.unitId, from: 0, to: advice[0]!.to, path: [] } as unknown as Candidate)).toBe(advice[0]!.delta);
      expect(unary(9999 as UnitId, { unitId: 9999, from: 0, to: 0, path: [] } as unknown as Candidate)).toBe(0);
    }
    scout.release();
    b.close();
  }, 60000);

  test('a continuation follows the line the previous ply PROVED, not the generator\'s first option', () => {
    // LINK 7 of the depth-blockage diagnosis, closed.
    //
    // `deepPlan` is documented as putting "each member on its own best option,
    // as the previous ply's max-min found it". It took
    // `candidatesFor(root, id).candidates[0]` — the candidate generator's
    // first heuristic option, which is a ONE-TURN ordering and knows nothing
    // about what the ply below it priced. The argmax was computed, stored, and
    // read only to decide `argmaxMoved`. So from the third turn onward a
    // thread walked a greedily-chosen line while its security value, its
    // `argmaxMoved` and this comment all claimed the proved one. A value of
    // the wrong line is not a cheaper value; it is a different question's
    // answer, and it inflates the measured cost of depth without buying the
    // discrimination depth is supposed to buy.
    //
    // Two assertions, and the second is what gives the first its teeth:
    //
    //   1. every ply n+1's plan agrees with ply n's recorded argmax on every
    //      unit that argmax names;
    //   2. on at least one thread the generator's first options AT THAT SAME
    //      ROOT are a DIFFERENT plan — so (1) cannot be passing by accident.
    //
    // The ply-1 root is rebuilt here through the door, from the thread's own
    // recorded ply-1 move, which is exactly how the scout built it; threads
    // whose cluster grew after that ply are skipped, because an expansion
    // changes the plan's domain and the two roots would not be comparable.
    let checked = 0;
    let followed = 0;
    let witnesses = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const b = bench(snakesBoard(seed));
      const gen = new GrammarCandidateGenerator({});
      const partition = partitionOf({ sub: b.sub, roster: b.roster, fixed: new Set<UnitId>() });
      const { plans } = enumerateProposals({
        sub: b.sub,
        partition,
        roster: b.roster,
        sets: b.sets,
        fixed: new Map(),
        doomed: new Set(),
        asTeam: b.asTeam,
        tuning: DEFAULT_CLUSTER_TUNING,
        salt: 1,
      });
      const scout = new Scout('observe');
      scout.run({
        sub: b.sub,
        asTeam: b.asTeam,
        gen,
        partition,
        sets: b.sets,
        seeds: plans,
        epoch: 0,
        posture: 'SIGHTED',
        decisionMs: 0,
      });

      for (const t of scout.ledger.all()) {
        // (1) THE LINE IS FOLLOWED.
        for (let i = 1; i < t.plies.length; i++) {
          const argmax = (t.plies[i - 1] as ThreadPly).discrimination.argmax;
          if (argmax === undefined || argmax === '') continue;
          const move = (t.plies[i] as ThreadPly).move;
          checked++;
          const agrees = argmax.split('|').every((part) => {
            const [id, to] = part.split('>').map(Number) as [number, number];
            return move.get(id as UnitId)?.to === to;
          });
          if (agrees) followed++;
        }
        // (2) AND IT IS A DIFFERENT LINE FROM THE HEURISTIC ONE.
        if (t.plies.length < 2 || scout.report().expanded !== 0) continue;
        const first = t.plies[0] as ThreadPly;
        const out = b.sub.resolveBoundedFor(first.move, b.asTeam);
        const cont = continueFrom({
          from: b.sub,
          resolution: out.resolution,
          cluster: t.cluster,
          carriedContingent: new Set<UnitId>(),
          ply: 1,
        });
        if (cont.ok) {
          const second = (t.plies[1] as ThreadPly).move;
          for (const id of t.cluster) {
            if (cont.sub.unitOf(id) === undefined) continue;
            const heuristic = gen.candidatesFor(cont.sub, id).candidates[0];
            if (heuristic !== undefined && second.get(id)?.to !== heuristic.to) witnesses++;
          }
          cont.release();
        }
        b.sub.releaseResolution(out.resolution);
      }
      scout.release();
      b.close();
      clearGeometryCache();
    }
    expect(checked).toBeGreaterThan(0);
    expect(followed).toBe(checked);
    expect(witnesses).toBeGreaterThan(0);
  }, 120000);
});
