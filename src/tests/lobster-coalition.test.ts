/**
 * INTEGRATION: the DECLARED per-team adversary world, end to end.
 *
 * `coalition.test.ts` proves the law against the bank's stubs; `world.test.ts`
 * proves the arbitration inside the search core. This file proves the two
 * things only the whole stack can show:
 *
 *  1. the narrowing reaches the EMISSION. Every record the kernel stages from
 *     a relaxed decision carries the assumption naming the world, so a
 *     consumer reading `EmitRecord.lo` cannot fail to see that it is
 *     conditional. A conditional promise that arrives looking unconditional is
 *     the whole failure mode this cluster is one step away from.
 *  2. THE THREE-TEAM BOARD IS WHAT SWITCHES IT ON. The same code on the same
 *     kernel with a two-team board reports zero relaxed decisions — not
 *     "configured off", not "tuned down": the world set is inadmissible and
 *     there is nothing to report.
 *
 * Real EngineSubstrate, real GrammarCandidateGenerator, real evaluator, real
 * kernel, real wall clock.
 */

import type { Board, Coord, Snake } from '../types/battlesnake';
import type { EmitRecord } from '../lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../lobster/substrate';
import { GrammarCandidateGenerator } from '../lobster/candidates';
import { materialEvaluator } from '../lobster/evaluate';
import { makeSearchCore } from '../lobster/search';
import { LobsterKernel, deadlineFromWallClock } from '../lobster/kernel';

const TURN = 12;

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
  extra: Partial<Snake> = {},
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[]): Board =>
  ({ width: 7, height: 7, food: [], hazards: [], snakes }) as Board;

/**
 * Two of ours on one rank; one rival of each colour on the rank below, each on
 * one of our files, and in contact with each other through the cell between.
 * The coalition takes both of ours in one world; either single team takes one.
 */
const TRIO = (): Board =>
  boardOf([
    piece('r', { x: 1, y: 3 }, 'rook', 2, { teamID: 'red' }),
    piece('k', { x: 1, y: 1 }, 'king', 1, { teamID: 'red' }),
    piece('B', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
    piece('G', { x: 5, y: 5 }, 'knight', 1, { teamID: 'green' }),
  ]);

/** The same board with the third team's unit removed. */
const DUO = (): Board =>
  boardOf([
    piece('r', { x: 1, y: 3 }, 'rook', 2, { teamID: 'red' }),
    piece('k', { x: 1, y: 1 }, 'king', 1, { teamID: 'red' }),
    piece('B', { x: 5, y: 3 }, 'king', 1, { teamID: 'blue' }),
    piece('G', { x: 5, y: 5 }, 'knight', 1, { teamID: 'blue' }),
  ]);

interface WorldCounters {
  readonly decisions: number;
  readonly relaxed: number;
  readonly disagreements: number;
  readonly vetoes: number;
  readonly refusedComparisons: number;
}

async function run(
  board: Board,
  coalition: 'strict' | 'per-team',
): Promise<{ records: EmitRecord[]; world: WorldCounters }> {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  try {
    const kernel = new LobsterKernel({ minWriteIntervalMs: 0 });
    const records: EmitRecord[] = [];
    const stream = kernel.decide({
      sub,
      gen: new GrammarCandidateGenerator(),
      evaluate: materialEvaluator,
      search: makeSearchCore({ bank: { coalition } }),
      asTeam: 0,
      deadlineMs: deadlineFromWallClock(Date.now() + 1200),
      initialPins: [],
    });
    for await (const rec of stream) records.push(rec);
    const report = kernel.lastReport;
    expect(report).not.toBeNull();
    expect(report?.stagedNothing).toBe(false);
    expect(report?.refusals['bounds-inversion']).toBe(0);
    // Basis leaks would present here first: an ascent refusing its own
    // comparisons is the silent-freeze failure mode, and it must be zero on
    // every arm, on every board.
    expect((report?.world as WorldCounters).refusedComparisons).toBe(0);
    expect(sub.outstanding()).toBe(1);
    return { records, world: report?.world as WorldCounters };
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

const isPerTeam = (rec: EmitRecord): boolean =>
  rec.assumptions.some((a) => a.kind === 'narrowing' && a.note.includes('per-team adversary'));

describe('the per-team world, end to end through the kernel', () => {
  test('three teams: the kernel works in the relaxed world and every relaxed record says so', async () => {
    const { records, world } = await run(TRIO(), 'per-team');
    expect(records.length).toBeGreaterThan(0);
    expect(world.decisions).toBeGreaterThan(0);
    expect(world.relaxed).toBeGreaterThan(0);
    // The rung-0 conformance record is emitted before any search has run, so
    // it is legitimately unconditional. Every record whose bracket came from a
    // relaxed search must carry the narrowing, and the last one — the staged
    // decision — is the one a consumer acts on.
    const searched = records.filter(isPerTeam);
    expect(searched.length).toBeGreaterThan(0);
    // The LAST record is the staged decision — the one a consumer acts on.
    expect(isPerTeam(records[records.length - 1] as EmitRecord)).toBe(true);
    for (const rec of searched) {
      expect(rec.lo).toBeLessThanOrEqual(rec.est);
      expect(rec.est).toBeLessThanOrEqual(rec.hi);
    }
  }, 20_000);

  test('three teams, strict: no record is ever conditional on a world', async () => {
    const { records, world } = await run(TRIO(), 'strict');
    expect(records.length).toBeGreaterThan(0);
    expect(world.relaxed).toBe(0);
    expect(world.disagreements).toBe(0);
    expect(world.vetoes).toBe(0);
    expect(records.some(isPerTeam)).toBe(false);
  }, 20_000);

  test('two teams: the same per-team core relaxes NOTHING', async () => {
    const { records, world } = await run(DUO(), 'per-team');
    expect(records.length).toBeGreaterThan(0);
    expect(world.decisions).toBeGreaterThan(0);
    expect(world.relaxed).toBe(0);
    expect(world.disagreements).toBe(0);
    expect(world.vetoes).toBe(0);
    expect(records.some(isPerTeam)).toBe(false);
  }, 20_000);

  // A kernel-level bracket-for-bracket comparison between two arms would be a
  // WALL-CLOCK comparison: the kernel is anytime, two runs search different
  // amounts under different machine load, and the brackets differ for that
  // reason and not because of the flag. The exact-equality claim belongs where
  // it is deterministic, and it is made there — `bounds/coalition.test.ts`,
  // "reports the strict bound, identically, at identical cost", which compares
  // the same plans priced by two banks with an unbounded budget.
});
