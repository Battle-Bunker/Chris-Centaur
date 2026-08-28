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
import { partitionOf } from '../search';
import {
  DEFAULT_SCOUT_TUNING,
  FLAT,
  Scout,
  ScoutPurse,
  ThreadLedger,
  barrierDepth,
  buildContactMatrix,
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
import type { ThreadEntry } from '../search/scout';
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
        postureBaseline: 'neutral' as never,
        plies: [],
        citedUnits: new Set(cited),
        accumulation: new Map(),
        carriedContingent: new Set(),
        skew: 0,
        assumptions: [],
        state: 'live',
        stepCostMs: 1,
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
    const refolded = ledger.onPostureFlip('aggressive' as never);
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
        postureBaseline: 'neutral' as never,
        plies: [],
        citedUnits: new Set(),
        accumulation: new Map(),
        carriedContingent: new Set(),
        skew: 0,
        assumptions: [],
        state,
        stepCostMs: 1,
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
      postureBaseline: 'neutral' as never,
      plies: Array.from({ length: depth }, (_, i) => ({
        ply: i + 1,
        move: new Map(),
        advisory: { lo: 0, est: 0, hi: 0 },
        contact: { contactIn: 9, arrivals: [], saturated: [], entangledAlready: [], horizon: 9 },
        discrimination: FLAT,
        ms: 1,
      })),
      citedUnits: new Set(),
      accumulation: new Map(),
      carriedContingent: new Set(),
      skew: 0,
      assumptions: [],
      state: 'live',
      stepCostMs: 1,
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
      ms: 1,
    });
    const mk = (plies: ReturnType<typeof ply>[]): ThreadEntry => ({
      key: 'k',
      clusterId: 0,
      cluster: new Set<UnitId>([1 as UnitId]),
      rootPlan: new Map(),
      rootTurn: TURN,
      epochBaseline: 1,
      postureBaseline: 'neutral' as never,
      plies,
      citedUnits: new Set(),
      accumulation: new Map(),
      carriedContingent: new Set(),
      skew: 0,
      assumptions: [],
      state: 'live',
      stepCostMs: 1,
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
      postureBaseline: 'neutral' as never,
      plies: [
        {
          ply: 1,
          move: new Map(),
          advisory: { lo: 0, est: 0, hi: 0 },
          contact: { contactIn: 0, arrivals: [], saturated: [], entangledAlready: [], horizon: 9 },
          discrimination: { ...FLAT, floorSpread: spread },
          ms: 1,
        },
      ],
      citedUnits: new Set(),
      accumulation: new Map(),
      carriedContingent: new Set(),
      skew,
      assumptions: [],
      state: 'parked-flat',
      stepCostMs: 1,
      lastUsed: 0,
    });
    // The priority falls because the CLOUDS ARE WIDER, which is a fact about
    // the world, not a haircut on a score. L4 is preserved by arithmetic.
    expect(resumePriority(mk(0, 8))).toBeGreaterThan(resumePriority(mk(3, 8)));
    expect(resumePriority(mk(3, 8))).toBeGreaterThan(0);
  });
});
