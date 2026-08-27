/**
 * THE DIFFERENTIAL GATE, in the suite.
 *
 * Every kernel that moved into WebAssembly has a JS twin that stayed, and this
 * runs BOTH over the same replayed positions and asserts they agree EXACTLY —
 * every integer bit-equal, and `balance` compared as its raw IEEE bits rather
 * than to a tolerance. There is no tolerance to justify: the kernels are
 * integer end to end, and `balance` is `(ours − theirs) / open` computed by the
 * same JS expression in both arms from integers the two arms must already agree
 * on. If the counts agree, the double is identical by construction; comparing
 * its bits is how that stays true rather than being assumed.
 *
 * ── HOW THE ARMS ARE BUILT ─────────────────────────────────────────────────
 *
 * Two SUBSTRATES over the same board, with `pinWasmMode` set differently. That
 * is the real production seam — `TeamDecisionEngine` pins exactly this way —
 * and it means the arms differ only in which buffers the workspace slabs are
 * views onto, not in which code is loaded.
 *
 * ── THE SMALL VERSION OF A BIG THING ───────────────────────────────────────
 *
 * `scratchpad/w3bench/` runs 2 200 positions across five board classes and ten
 * seeds and a parts-level probe on top; this is the version that belongs in
 * every run, so a kernel edit that breaks agreement is caught by `npm test`
 * rather than by somebody remembering to re-run a bench. It deliberately keeps
 * the shapes that make the two planes disagree in interesting ways: a mixed
 * board (both planes live), a three-team board (the per-team `seen`/`multi`
 * split), a tiered board (the rank cutover), a hazard board (walls
 * inside the domain), and a trails-only board (plane 2 never runs at all).
 */

import { Board, Coord, Snake } from '../../types/battlesnake';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import { NO_ORDER_MOVE, clearGeometryCache, makeSubstrate } from '../substrate';
import { ADMISSION, makeContext, partitionOf, workspaceFor } from '../evaluate/index';
import { DEFAULT_PROFILE } from '../evaluate/calibration';
import { pinWasmMode } from './policy';

const TURN = 40;

function snake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
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
): Snake => snake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 11, height: 11, food: [], hazards: [], snakes, ...extra }) as Board;

const trail = (id: string, x: number, y: number, team: string, len = 3): Snake =>
  snake(
    id,
    Array.from({ length: len }, (_, i) => ({ x: x + i, y })),
    { teamID: team }
  );

/** The five shapes, chosen for the branches they light up. */
const BOARDS: ReadonlyArray<{ name: string; board: () => Board }> = [
  {
    name: 'mixed (both planes)',
    board: () =>
      boardOf([
        trail('a1', 1, 1, 'red'),
        piece('aR', { x: 3, y: 7 }, 'rook', 2, { teamID: 'red' }),
        trail('b1', 7, 8, 'blue'),
        piece('bQ', { x: 7, y: 2 }, 'queen', 3, { teamID: 'blue' }),
        piece('bK', { x: 10, y: 0 }, 'king', 3, { teamID: 'blue' }),
      ]),
  },
  {
    name: 'three teams',
    board: () =>
      boardOf([
        trail('a1', 0, 0, 'red'),
        trail('a2', 0, 4, 'red'),
        trail('b1', 6, 9, 'blue'),
        piece('bB', { x: 5, y: 5 }, 'bishop', 2, { teamID: 'blue' }),
        trail('c1', 8, 2, 'green'),
        piece('cN', { x: 2, y: 8 }, 'knight', 2, { teamID: 'green' }),
      ]),
  },
  {
    name: 'live tiers (the rank cutover)',
    board: () =>
      boardOf([
        trail('a1', 1, 5, 'red'),
        piece('aP', { x: 4, y: 4 }, 'pawn', 1, {
          teamID: 'red',
          invulnerabilityLevel: 2,
          invulnerabilityExpiryTurn: TURN + 2,
        }),
        trail('b1', 8, 6, 'blue'),
        piece('bQ', { x: 6, y: 6 }, 'queen', 3, {
          teamID: 'blue',
          invulnerabilityLevel: 1,
          invulnerabilityExpiryTurn: TURN + 4,
        }),
      ]),
  },
  {
    name: 'hazards',
    board: () =>
      boardOf(
        [
          trail('a1', 2, 2, 'red'),
          piece('aR', { x: 6, y: 3 }, 'rook', 2, { teamID: 'red' }),
          trail('b1', 7, 7, 'blue'),
          piece('bK', { x: 9, y: 9 }, 'king', 3, { teamID: 'blue' }),
        ],
        { hazards: Array.from({ length: 12 }, (_, i) => ({ x: 5, y: i % 11 })) }
      ),
  },
  {
    name: 'trails only (plane 2 never runs)',
    board: () => boardOf([trail('a1', 1, 1, 'red'), trail('b1', 7, 7, 'blue')]),
  },
];

function defaultPlan(sub: ReturnType<typeof makeSubstrate>): Map<UnitId, Candidate> {
  const plan = new Map<UnitId, Candidate>();
  for (const u of sub.roster()) {
    plan.set(u.unitId, { unitId: u.unitId, from: -1, to: NO_ORDER_MOVE, path: [] });
  }
  return plan;
}

/**
 * Every plan that moves ONE unit to one of its legal destinations, plus the
 * all-hold plan. Enough distinct positions per board to exercise the kernels on
 * genuinely different shells, without a search.
 */
function plansFor(sub: ReturnType<typeof makeSubstrate>, cap: number): JointPlan[] {
  const out: JointPlan[] = [defaultPlan(sub)];
  for (const u of sub.roster()) {
    for (const action of sub.actionsOf(u.unitId)) {
      const plan = defaultPlan(sub);
      plan.set(u.unitId, action);
      out.push(plan);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

const dv = new DataView(new ArrayBuffer(8));
/** Exact bits, so no ulp of `balance` can hide behind a printed value. */
function bits(x: number): string {
  dv.setFloat64(0, x);
  return dv.getBigUint64(0).toString(16);
}

interface Row {
  readonly ours: number;
  readonly theirs: number;
  readonly open: number;
  readonly balance: string;
  readonly trails: string;
  readonly domain: string;
}

function readingsFor(
  board: Board,
  mode: 'off' | 'on',
  cap: number,
  /**
   * Force the kernels to decline, as the arena being full would. The JS twins
   * then run over slabs that are still VIEWS ONTO LINEAR MEMORY, which is the
   * degradation path in full: it is not exercised by `mode: 'off'`, because
   * that arm's slabs are ordinary heap arrays.
   */
  starve = false
): { rows: Row[]; runs: number; refused: number } {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  pinWasmMode(sub, mode);
  const rows: Row[] = [];
  try {
    const asTeam = sub.teamNumber('red');
    const ws = workspaceFor(sub);
    if (starve) {
      const decline = function (this: typeof ws): boolean {
        return false;
      };
      Object.defineProperty(ws, 'wasmDisplace', { value: decline, writable: true });
      Object.defineProperty(ws, 'wasmSweepPrepare', { value: decline, writable: true });
    }
    for (const plan of plansFor(sub, cap)) {
      sub.withResolution(plan, asTeam, ({ resolution, bounds }) => {
        const ctx = makeContext(
          sub,
          resolution,
          bounds,
          asTeam,
          DEFAULT_PROFILE.reachHorizonTurns,
          DEFAULT_PROFILE
        );
        const shells = ctx.shells();
        for (const reading of ['lo', 'hi'] as const) {
          const p = partitionOf(ws, ctx.standing, shells, asTeam, ADMISSION[reading], ws.domainFor(reading));
          rows.push({
            ours: p.ours,
            theirs: p.theirs,
            open: p.open,
            balance: bits(p.balance),
            trails: p.trails.map((t) => `${t.subject.unitId}:${t.mine ? 1 : 0}:${t.owned}`).join(','),
            domain: Array.from(p.domain).join(','),
          });
        }
      });
    }
    return { rows, runs: ws.wasmRuns + ws.wasmSweepRuns, refused: ws.wasmRefused + ws.wasmSweepRefused };
  } finally {
    sub.release();
  }
}

afterEach(() => clearGeometryCache());

describe('CENTAUR_WASM on agrees with CENTAUR_WASM off, exactly', () => {
  for (const { name, board } of BOARDS) {
    it(`${name}`, () => {
      const off = readingsFor(board(), 'off', 24);
      const on = readingsFor(board(), 'on', 24);
      expect(off.rows.length).toBeGreaterThan(4);
      expect(on.rows).toEqual(off.rows);
      // The flag being off must cost nothing and run nothing.
      expect(off.runs).toBe(0);
    });
  }

  it('actually runs the kernels — an agreement between two JS paths is no gate', () => {
    // The wasm arm declines silently whenever an input is not resident, so
    // "agrees" is worthless without "ran". This is the assertion that a
    // refactor which quietly disables the arm has to break.
    const on = readingsFor(BOARDS[0]?.board() as Board, 'on', 24);
    expect(on.runs).toBeGreaterThan(0);
    expect(on.refused).toBe(0);
  });

  it('a kernel that declines degrades to the same answer, not to a wrong one', () => {
    // The whole safety argument is that a refused allocation costs throughput
    // and nothing else. That claim has three arms, not two, and this is the
    // third: an arena that exists but cannot serve, so the JS kernels run over
    // slabs that ARE in linear memory. If a JS loop and a wasm loop ever read
    // that memory differently, this is where it shows.
    for (const { board } of BOARDS) {
      const off = readingsFor(board(), 'off', 16);
      const starved = readingsFor(board(), 'on', 16, true);
      expect(starved.rows).toEqual(off.rows);
      expect(starved.runs).toBe(0);
    }
  });

  it('a workspace with no arena is the JS path, and still correct', () => {
    // `off` is what every existing test in the suite runs, so this is really an
    // assertion that the two arms cover the same code with the flag flipped.
    const off = readingsFor(BOARDS[1]?.board() as Board, 'off', 12);
    expect(off.runs).toBe(0);
    expect(off.rows.length).toBeGreaterThan(0);
  });
});
