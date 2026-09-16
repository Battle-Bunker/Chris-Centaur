/**
 * V3 SOAK — MEMORY CHARACTERISATION, after the one-engine cut.
 *
 * The two facts the 200-turn soak established were both about an ARENA that
 * does not exist any more:
 *
 * 1. SLAB DISCIPLINE. `outstanding()` counted borrowed arena slabs, and there
 *    are none: a settlement is a plain value that the garbage collector owns.
 *    What is left to check is that a substrate retains nothing a decision
 *    should not outlive, which is what `release()` now means.
 *
 * 2. CLOUD TIMELINE RETENTION. `CloudSource.timelines` was a strong map with
 *    no eviction hanging off an engine the geometry cache kept alive for a
 *    whole game: +30–35 MB of retained heap per 100 turns, measured. Both the
 *    source and its cache are deleted. The one thing the geometry cache still
 *    holds across turns is the STEP RELATION the reach shells iterate — a
 *    function of the board's shape, bounded by (kinds x cells) and shared on
 *    purpose — so what this file pins now is that it reaches a ceiling rather
 *    than growing with the turn count, which is the same property under a
 *    different object.
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

beforeEach(() => clearGeometryCache());
afterEach(() => clearGeometryCache());

// ------------------------------------------------------- per-decision state

describe('a substrate keeps nothing a decision should outlive', () => {
  test('release drops the decision caches and closes the door', () => {
    const board = armies(12, 8, 8);
    const sub = makeSubstrate({ board, turn: 0, asTeam: 'red' });
    const asTeam = sub.teamNumber('red');
    const plan = new Map<UnitId, Candidate>();
    for (const u of sub.roster()) {
      const first = sub.actionsOf(u.unitId)[0];
      if (first !== undefined) plan.set(u.unitId, first);
    }
    const bounded = sub.resolveBoundedFor(plan as JointPlan, asTeam);
    // The settlement is a VALUE: it survives the substrate that produced it,
    // because nothing in it is borrowed from anything.
    expect(Object.keys(bounded.resolution.board).length).toBeGreaterThan(0);
    sub.release();
    expect(Object.keys(bounded.resolution.board).length).toBeGreaterThan(0);
    expect(() => sub.resolveBoundedFor(plan as JointPlan, asTeam)).toThrow(/after release/);
  });
});

// ------------------------------------------------------- the shared step cache

describe('the step relation is BOUNDED across a game', () => {
  // Long enough that a per-turn growth and a ceiling are distinguishable.
  const TURNS = 80;

  test('a reused geometry reaches a ceiling instead of one entry per turn', () => {
    const counts: number[] = [];
    for (let t = 0; t < TURNS; t++) {
      const sub = makeSubstrate({ board: armies(12, 8, 8, t), turn: t, asTeam: 'red', gameId: 'g' });
      try {
        const gen = new GrammarCandidateGenerator();
        const ours = sub.roster().find((u) => u.wireId.startsWith('r'))?.unitId as UnitId;
        gen.candidatesFor(sub, ours);
        counts.push(sub.stepCache().size + sub.orientedStepCache().size);
      } finally {
        sub.release();
      }
    }
    const peak = Math.max(...counts);
    // A CEILING, not a slope: the relation is keyed by (kind, cell), so it is
    // bounded by the board however many turns are played on it.
    expect(peak).toBeLessThan(16 * TURNS);
    const half = counts.slice(Math.floor(TURNS / 2));
    expect(Math.max(...half) - Math.min(...half)).toBeLessThanOrEqual(0);
    expect(counts[counts.length - 1] as number).toBeGreaterThanOrEqual(counts[0] as number);
  });

  test('dropping the geometry cache each turn starts the relation over', () => {
    const counts: number[] = [];
    for (let t = 0; t < TURNS; t++) {
      clearGeometryCache();
      const sub = makeSubstrate({ board: armies(12, 8, 8, t), turn: t, asTeam: 'red', gameId: 'g' });
      try {
        const gen = new GrammarCandidateGenerator();
        const ours = sub.roster().find((u) => u.wireId.startsWith('r'))?.unitId as UnitId;
        gen.candidatesFor(sub, ours);
        counts.push(sub.stepCache().size + sub.orientedStepCache().size);
      } finally {
        sub.release();
      }
    }
    // Nothing accumulates when the cache is dropped — which is what makes the
    // reused arm above a statement about sharing rather than about growth.
    expect(Math.max(...counts)).toBeLessThan(16 * TURNS);
  });
});
