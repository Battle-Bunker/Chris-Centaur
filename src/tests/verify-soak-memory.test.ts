/**
 * V3 SOAK — MEMORY CHARACTERISATION.
 *
 * Two facts the 200-turn soak established, pinned here so they cannot drift
 * silently. Both are CHARACTERISATION tests: they record what the tree does
 * TODAY, including one thing it should not do.
 *
 * 1. SLAB DISCIPLINE (the build contract's B1 invariant) — HOLDS.
 *    `outstanding()` is 1 on a fresh substrate (the base state), returns to 1
 *    after a bounded resolution is released, and is 0 after `release()`.
 *
 * 2. CLOUD TIMELINE RETENTION — DOES NOT HOLD, and this test says so.
 *    `CloudSource.timelines` (src/partial-engine/cloud.ts) is a STRONG
 *    `Map<FrozenRecord, CloudTimeline>` with no eviction and no lifetime. The
 *    `CloudSource` hangs off the `PartialEngine`, which the module-scope
 *    geometry cache in src/lobster/substrate.ts keeps alive for a whole game,
 *    while every turn builds fresh `FrozenRecord`s. So the map grows once per
 *    held unit per turn, for the life of the game, and nothing ever removes an
 *    entry. Measured on the 200-turn soak: +30–35 MB of RETAINED heap per 100
 *    turns (survives two forced full GCs), 106σ–238σ above the residual noise;
 *    the legacy control over the same 200 turns is flat (−1.8 MB/100 turns,
 *    1.0σ).
 *
 *    The assertion below is deliberately written as "the leak is present".
 *    WHEN THE ENGINE IS FIXED UPSTREAM (a WeakMap, or a per-decision source),
 *    THIS TEST WILL FAIL — that failure is the signal to invert it.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import type { Candidate, JointPlan, UnitId } from '../lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';

// ------------------------------------------------------------------ fixture

const KINDS = ['rook', 'knight', 'bishop', 'queen', 'pawn'] as const;

const unit = (id: string, at: Coord, unitType: string, weight: number, teamID: string): Snake =>
  ({
    id,
    name: id,
    latency: '0',
    health: 100,
    body: [at],
    head: at,
    length: weight,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    unitType,
    teamID,
  }) as unknown as Snake;

function armies(size: number, ours: number, theirs: number, shift = 0): Board {
  const snakes: Snake[] = [];
  const place = (n: number, prefix: string, team: string, baseY: number, dir: 1 | -1): void => {
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / size);
      const kind = i === 0 ? 'king' : (KINDS[(i + row) % KINDS.length] as string);
      const weight = kind === 'king' ? 1 : kind === 'queen' ? 3 : kind === 'pawn' ? 1 : 2;
      // `shift` walks the whole army sideways so every turn is a NEW board
      // (fresh FrozenRecords) on the SAME geometry (same cached engine).
      const x = (i % size) === size - 1 ? i % size : ((i % size) + shift) % (size - 1);
      snakes.push(unit(`${prefix}${i}`, { x, y: baseY + dir * row }, kind, weight, team));
    }
  };
  place(ours, 'r', 'red', 0, 1);
  place(theirs, 'b', 'blue', size - 1, -1);
  return { width: size, height: size, food: [], hazards: [], snakes } as unknown as Board;
}

/**
 * Timelines the engine is retaining across every live cloud source.
 *
 * V3 read this off the engine's private `sources` map and summed each source's
 * `timelines`. The engine PUBLISHES the number now — `retainedTimelines`,
 * documented as "the number a memory test asserts a bound on" — because the
 * caches behind it grew a WeakMap half that a private-field reader would
 * miscount and an LRU half that a private-field reader would not know the
 * bound of. Reading the engine's own accessor is what keeps this test and the
 * thing it measures from drifting apart.
 */
function timelineCount(engine: unknown): number {
  return (engine as { retainedTimelines: number }).retainedTimelines;
}

beforeEach(() => clearGeometryCache());
afterEach(() => clearGeometryCache());

// ----------------------------------------------------------- slab discipline

describe('slab discipline holds across a decision', () => {
  test('outstanding() is 1 on a fresh substrate, 1 after a released resolution, 0 after release', () => {
    const board = armies(12, 8, 8);
    const sub = makeSubstrate({ board, turn: 0, asTeam: 'red' });
    try {
      expect(sub.outstanding()).toBe(1);
      const asTeam = sub.teamNumber('red');
      const plan = new Map<UnitId, Candidate>();
      for (const u of sub.roster()) {
        const options = sub.actionsOf(u.unitId);
        const first = options[0];
        if (first !== undefined) plan.set(u.unitId, first);
      }
      const bounded = sub.resolveBoundedFor(plan as JointPlan, asTeam);
      expect(sub.outstanding()).toBeGreaterThan(1);
      sub.releaseResolution(bounded.resolution);
      expect(sub.outstanding()).toBe(1);
    } finally {
      sub.release();
    }
    expect(sub.outstanding()).toBe(0);
  });
});

// -------------------------------------------------------- cloud-timeline leak

// INVERTED. V3 filed this as a REPRO with a "when the engine stops retaining
// these, invert the assertion" banner. The engine bounds both caches now — a
// source cache keyed on the item premise, and a per-source timeline cache — so
// a reused engine reaches a ceiling instead of climbing forever.
describe('cloud timelines are BOUNDED on a reused engine', () => {
  // Long enough to pass the per-source LRU bound (128 timelines) several
  // times over: a bounded cache and an unbounded one are indistinguishable
  // until the bound is reached.
  const TURNS = 80;

  test('a cached engine reaches a ceiling instead of one timeline per turn', () => {
    let engine: unknown = null;
    const counts: number[] = [];
    for (let t = 0; t < TURNS; t++) {
      const sub = makeSubstrate({ board: armies(12, 8, 8, t), turn: t, asTeam: 'red' });
      try {
        // The same cached PartialEngine every turn — the geometry (size, walls,
        // hazards, food) never changes, only the pieces' cells do.
        if (engine === null) engine = sub.engine;
        expect(sub.engine).toBe(engine);
        const gen = new GrammarCandidateGenerator();
        const ours = sub.roster().find((u) => u.wireId.startsWith('r'))?.unitId as UnitId;
        gen.candidatesFor(sub, ours); // builds the turn's claim view
        counts.push(timelineCount(sub.engine));
      } finally {
        sub.release();
      }
    }
    const first = counts[0] as number;
    const last = counts[counts.length - 1] as number;
    const peak = Math.max(...counts);
    // A CEILING, not a slope. The old engine added one timeline per held unit
    // per turn for the life of the game — 16 a turn on this board, forever.
    expect(peak).toBeLessThan(16 * TURNS);
    // The second half of the run adds nothing: the cache has settled.
    const half = counts.slice(Math.floor(TURNS / 2));
    expect(Math.max(...half) - Math.min(...half)).toBeLessThanOrEqual(0);
    expect(last).toBeGreaterThanOrEqual(first);
  });

  test('dropping the geometry cache each turn is no longer the difference', () => {
    const counts: number[] = [];
    for (let t = 0; t < TURNS; t++) {
      clearGeometryCache();
      const sub = makeSubstrate({ board: armies(12, 8, 8, t), turn: t, asTeam: 'red' });
      try {
        const gen = new GrammarCandidateGenerator();
        const ours = sub.roster().find((u) => u.wireId.startsWith('r'))?.unitId as UnitId;
        gen.candidatesFor(sub, ours);
        counts.push(timelineCount(sub.engine));
      } finally {
        sub.release();
      }
    }
    // It never accumulated in this arm and it does not now — what changed is
    // that the REUSED arm above matches it.
    expect(new Set(counts).size).toBe(1);
  });
});
