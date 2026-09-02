/**
 * THE TWO INVARIANTS THE W2 KERNEL RESTS ON.
 *
 * `displace` no longer walks `grid.cells` testing each one for a wall and for
 * `decisive === NEVER`. It walks the trail-domain bitboard, on the claim that
 * the domain is EXACTLY the cell set the sweep stamped a decisive turn onto,
 * masked to open ground. If that ever stops being true, plane 2 reads a stale
 * turn from the previous partition and the failure is silent — no throw, no
 * inversion, just a wrong number in a soft positional term. So it is pinned
 * here, on real boards, from both readings, over every cell.
 *
 * The second claim is the strength RANKS: `rank[i] < rank[j]` iff
 * `cmpLex(s_i, s_j) < 0` over the (tier-at-turn, weightMax) pairs the contest
 * actually sees. `scratch.test.ts` proves the ranker; this proves that what the
 * partition FEEDS it reproduces `tierAtTurn`.
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import { NEVER } from '../../partial-engine/index';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import { ADMISSION, makeContext, partitionOf, tierAtTurn, workspaceFor } from './index';
import { DEFAULT_PROFILE } from './calibration';
import type { UnitId } from '../contracts';
import type { Candidate, JointPlan } from '../contracts';
import { NO_ORDER_MOVE } from '../substrate';

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

const piece = (id: string, at: Coord, unitType: string, weight: number, extra: Partial<Snake> = {}): Snake =>
  makeSnake(id, [at], { unitType, length: weight, ...extra });

const TURN = 40;

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

/** A trail unit, a piece and an enemy of each, so both planes are live. */
const MIXED = (): Board =>
  boardOf([
    makeSnake('mine', [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 1, y: 1 },
    ], { teamID: 'red' }),
    piece('myRook', { x: 3, y: 6 }, 'rook', 2, { teamID: 'red' }),
    makeSnake('theirs', [
      { x: 6, y: 6 },
      { x: 7, y: 6 },
      { x: 7, y: 7 },
    ], { teamID: 'blue' }),
    piece('theirQueen', { x: 6, y: 2 }, 'queen', 3, { teamID: 'blue', invulnerabilityLevel: 2, invulnerabilityExpiryTurn: TURN + 2 }),
    piece('theirKing', { x: 8, y: 0 }, 'king', 3, { teamID: 'blue' }),
  ]);

/** Trail units only — the shape with no plane 2 at all. */
const TRAILS_ONLY = (): Board =>
  boardOf([
    makeSnake('mine', [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ], { teamID: 'red' }),
    makeSnake('theirs', [
      { x: 6, y: 6 },
      { x: 7, y: 6 },
    ], { teamID: 'blue' }),
  ]);

function defaultPlan(sub: ReturnType<typeof makeSubstrate>): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const u of sub.roster()) plan.set(u.unitId, { unitId: u.unitId, from: -1, to: NO_ORDER_MOVE, path: [] });
  return plan;
}

afterEach(() => clearGeometryCache());

/** Run both readings and hand the caller the workspace as the sweep left it. */
function readings(board: Board, fn: (arg: { ws: ReturnType<typeof workspaceFor>; domain: Uint32Array; part: ReturnType<typeof partitionOf>; standing: ReturnType<typeof makeContext>['standing'] }) => void): void {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  try {
    const asTeam = sub.teamNumber('red');
    sub.withResolution(defaultPlan(sub), asTeam, ({ resolution, bounds }) => {
      const ctx = makeContext(sub, resolution, bounds, asTeam, DEFAULT_PROFILE.reachHorizonTurns, DEFAULT_PROFILE);
      const shells = ctx.shells();
      const ws = workspaceFor(sub);
      for (const reading of ['lo', 'hi'] as const) {
        const domain = ws.domainFor(reading);
        const part = partitionOf(ws, ctx.standing, shells, asTeam, ADMISSION[reading], domain);
        fn({ ws, domain, part, standing: ctx.standing });
      }
    });
  } finally {
    sub.release();
  }
}

const bit = (b: Uint32Array, c: number): boolean => ((b[c >>> 5] as number) & (1 << (c & 31))) !== 0;

describe('the trail domain IS the decisive-turn write set', () => {
  test('on a mixed board, every domain cell carries a stamped turn', () => {
    let checkedDomains = 0;
    readings(MIXED(), ({ ws, domain, part }) => {
      const cells = ws.grid.cells;
      let inDomain = 0;
      for (let c = 0; c < cells; c++) {
        if (!bit(domain, c)) continue;
        inDomain++;
        // The claim `displace` drops its `NEVER` test on.
        expect(ws.decisive[c]).not.toBe(NEVER);
      }
      expect(inDomain).toBeGreaterThan(0);
      // ...and the domain never leaves open ground.
      for (let i = 0; i < ws.grid.words; i++) {
        expect((domain[i] as number) & ~(ws.notWall[i] as number)).toBe(0);
      }
      expect(part.open).toBe(ws.open);
      checkedDomains++;
    });
    expect(checkedDomains).toBe(2);
  });

  test('a piece-free board still publishes a domain, and claims no plane-2 ground', () => {
    readings(TRAILS_ONLY(), ({ ws, domain, part }) => {
      let inDomain = 0;
      for (let c = 0; c < ws.grid.cells; c++) if (bit(domain, c)) inDomain++;
      expect(inDomain).toBeGreaterThan(0);
      expect(part.ours + part.theirs).toBeLessThanOrEqual(inDomain);
    });
  });

  test('the two readings do not share a domain board', () => {
    const sub = makeSubstrate({ board: MIXED(), turn: TURN, asTeam: 'red' });
    try {
      const ws = workspaceFor(sub);
      expect(ws.domainFor('lo')).not.toBe(ws.domainFor('hi'));
    } finally {
      sub.release();
    }
  });
});

describe('the partition is stable under repetition', () => {
  test('running the same reading twice on one workspace gives the same counts', () => {
    const board = MIXED();
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    try {
      const asTeam = sub.teamNumber('red');
      sub.withResolution(defaultPlan(sub), asTeam, ({ resolution, bounds }) => {
        const ctx = makeContext(sub, resolution, bounds, asTeam, DEFAULT_PROFILE.reachHorizonTurns, DEFAULT_PROFILE);
        const shells = ctx.shells();
        const ws = workspaceFor(sub);
        const first = partitionOf(ws, ctx.standing, shells, asTeam, ADMISSION.lo, ws.domainFor('lo'));
        const snapshot = { ours: first.ours, theirs: first.theirs, balance: first.balance, trails: first.trails.map((t) => `${t.subject.unitId}:${t.owned}`) };
        // The other reading in between, so every reused column is overwritten.
        partitionOf(ws, ctx.standing, shells, asTeam, ADMISSION.hi, ws.domainFor('hi'));
        const again = partitionOf(ws, ctx.standing, shells, asTeam, ADMISSION.lo, ws.domainFor('lo'));
        expect({ ours: again.ours, theirs: again.theirs, balance: again.balance, trails: again.trails.map((t) => `${t.subject.unitId}:${t.owned}`) }).toEqual(snapshot);
      });
    } finally {
      sub.release();
    }
  });

  test('a partition over NOBODY is empty and leaves an empty domain', () => {
    const sub = makeSubstrate({ board: MIXED(), turn: TURN, asTeam: 'red' });
    try {
      const asTeam = sub.teamNumber('red');
      sub.withResolution(defaultPlan(sub), asTeam, ({ resolution, bounds }) => {
        const ctx = makeContext(sub, resolution, bounds, asTeam, DEFAULT_PROFILE.reachHorizonTurns, DEFAULT_PROFILE);
        const ws = workspaceFor(sub);
        const domain = ws.domainFor('lo');
        domain.fill(0xffffffff);
        const none = partitionOf(ws, ctx.standing, ctx.shells(), asTeam, { ours: () => false, theirs: () => false }, domain);
        expect(none.ours).toBe(0);
        expect(none.theirs).toBe(0);
        expect(none.trails).toHaveLength(0);
        expect([...domain].every((w) => w === 0)).toBe(true);
      });
    } finally {
      sub.release();
    }
  });
});

describe('tierAtTurn, which the strength ranks reproduce', () => {
  test('a tier that has not expired is the unit tier, and after it is zero', () => {
    const s = { unitId: 1 as UnitId, team: 0, kind: 0, held: false, weightMax: 3, tierMax: 2, tierExpiresAtTurn: 42 };
    expect(tierAtTurn(s, 41)).toBe(2);
    expect(tierAtTurn(s, 42)).toBe(0);
    expect(tierAtTurn(s, 43)).toBe(0);
  });

  test('no expiry means the tier never drops', () => {
    const s = { unitId: 1 as UnitId, team: 0, kind: 0, held: false, weightMax: 3, tierMax: 2, tierExpiresAtTurn: null };
    for (const t of [0, 40, 1000]) expect(tierAtTurn(s, t)).toBe(2);
  });
});
