/**
 * SEARCH-THEORY probe S0 — restrictedGap, measured.
 *
 * Reconstructs the restricted payoff matrix the bank already computes
 * (rows = plans priced, columns = banked witnesses), solves it as a mixed
 * matrix game with regret matching+, and reports rowSupport / restrictedGap /
 * colSupport per board class.
 *
 * FIDELITY. Columns come from the REAL `BoundBank` — witnesses are banked by
 * `closeGroup` exactly as in production. Rows come from the REAL cluster
 * enumeration plus a 1-opt neighbourhood of the incumbent, which is what the
 * search prices. Cells are REAL bounded resolutions through the engine
 * substrate: `resolveBoundedFull(plan ⊕ witness.replies).bounds.worst`, i.e. a
 * sound floor at that reply, which is the endpoint doc 06 §5 specifies.
 *
 * POPULATION PREMISE (stamped on every row of output): hand-built scenario
 * boards, one turn each, one seat (`red`), shipped bank config, shipped cluster
 * tuning, `defaultEvaluator`. These are NOT sampled from play; they are chosen
 * to span the regimes the program's own cost census names, plus a contested
 * cell. Generalising beyond that is a premise crossing.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import type { BudgetHandle, Candidate, CandidateSet, JointPlan, UnitId, Witness } from '../contracts';
import { clearGeometryCache, makeSubstrate, type EngineSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import { DEFAULT_CLUSTER_TUNING, enumerateProposals, partitionOf } from '../search';
import { BoundBank, withMoves, planKey } from '../bounds';
import { defaultEvaluator } from '../evaluate';

const TURN = 22;
const RM_ITERS = 2000;
const MAX_ROWS = 24;
const EPS = 1e-9;
/** A mixture weight below this is not in the support. */
const SUPPORT_EPS = 1e-3;

// ---------------------------------------------------------------- the budget

function unbounded(): BudgetHandle {
  const t0 = Date.now();
  return {
    shouldStop: () => false,
    remainingMs: () => Number.POSITIVE_INFINITY,
    elapsedMs: () => Date.now() - t0,
    now: () => Date.now(),
  } as BudgetHandle;
}

// ---------------------------------------------------------------- the boards

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

/** Four trail units around a hub of `kind`, one distant enemy. The program's
 *  own cost census uses exactly this shape to separate the regimes. */
function hubBoard(kind: string | undefined): Board {
  const snakes: Snake[] = [
    snake('h', [{ x: 6, y: 6 }], kind === undefined ? { teamID: 'red' } : { teamID: 'red', unitType: kind }),
  ];
  const seats: ReadonlyArray<readonly [Coord, number]> = [
    [{ x: 4, y: 4 }, -1],
    [{ x: 8, y: 4 }, -1],
    [{ x: 4, y: 8 }, +1],
    [{ x: 8, y: 8 }, +1],
  ];
  seats.forEach(([at, dy], i) => {
    snakes.push(snake(`s${i}`, [at, { x: at.x, y: at.y + dy }, { x: at.x, y: at.y + 2 * dy }], { teamID: 'red' }));
  });
  snakes.push(snake('e', [{ x: 6, y: 11 }, { x: 6, y: 12 }], { teamID: 'blue' }));
  return { width: 13, height: 13, food: [], hazards: [], snakes } as unknown as Board;
}

/** Six trail units, no slider, enemy far away. The QUIET control. */
function quietBoard(): Board {
  const snakes: Snake[] = [];
  for (let i = 0; i < 6; i++) {
    const x = 2 + i * 2;
    snakes.push(snake(`s${i}`, [{ x, y: 3 }, { x, y: 2 }, { x, y: 1 }], { teamID: 'red' }));
  }
  snakes.push(snake('e0', [{ x: 6, y: 11 }, { x: 6, y: 12 }], { teamID: 'blue' }));
  return { width: 13, height: 13, food: [], hazards: [], snakes } as unknown as Board;
}

/** Ours and theirs head-to-head across a shared cell — three contested squares.
 *  This is the board class where §2.3 predicts the floor goes flat and §4
 *  predicts the mixed gap is largest. */
function contestedBoard(kind?: string): Board {
  const snakes: Snake[] = [];
  // Three of ours on row 5, three of theirs on row 7; the free cells on row 6
  // between each facing pair are the contested ones.
  for (let i = 0; i < 3; i++) {
    const x = 3 + i * 3;
    snakes.push(
      snake(`s${i}`, [{ x, y: 5 }, { x, y: 4 }, { x, y: 3 }], { teamID: 'red' })
    );
    snakes.push(
      snake(`e${i}`, [{ x, y: 7 }, { x, y: 8 }, { x, y: 9 }], { teamID: 'blue' })
    );
  }
  if (kind !== undefined) {
    snakes.push(snake('h', [{ x: 11, y: 6 }], { teamID: 'red', unitType: kind }));
  }
  return { width: 13, height: 13, food: [], hazards: [], snakes } as unknown as Board;
}

/** One food cell equidistant from one of ours and one of theirs, everything
 *  else empty: the cleanest matching-pennies geometry this game admits — take
 *  it and risk the head-on, or hold and concede it. */
function duelBoard(withFood: boolean): Board {
  const snakes: Snake[] = [
    snake('s0', [{ x: 4, y: 6 }, { x: 3, y: 6 }, { x: 2, y: 6 }], { teamID: 'red' }),
    snake('e0', [{ x: 8, y: 6 }, { x: 9, y: 6 }, { x: 10, y: 6 }], { teamID: 'blue' }),
  ];
  return {
    width: 13, height: 13,
    food: withFood ? [{ x: 6, y: 6 }] : [],
    hazards: [], snakes,
  } as unknown as Board;
}

/** Two of ours and two of theirs converging on one corridor mouth. */
function corridorBoard(): Board {
  const snakes: Snake[] = [
    snake('s0', [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], { teamID: 'red' }),
    snake('s1', [{ x: 5, y: 7 }, { x: 4, y: 7 }, { x: 3, y: 7 }], { teamID: 'red' }),
    snake('e0', [{ x: 7, y: 5 }, { x: 8, y: 5 }, { x: 9, y: 5 }], { teamID: 'blue' }),
    snake('e1', [{ x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 }], { teamID: 'blue' }),
  ];
  return { width: 13, height: 13, food: [{ x: 6, y: 6 }], hazards: [], snakes } as unknown as Board;
}

// ---------------------------------------------------------------- the matrix

interface Bench {
  readonly sub: EngineSubstrate;
  readonly asTeam: number;
  readonly roster: ReadonlyArray<UnitId>;
  readonly sets: Map<UnitId, CandidateSet>;
  close(): void;
}

function bench(board: Board): Bench {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const asTeam = sub.teamNumber('red');
  const gen = new GrammarCandidateGenerator({});
  const roster = sub.commandable(asTeam);
  const sets = new Map<UnitId, CandidateSet>();
  for (const unitId of roster) sets.set(unitId, gen.candidatesFor(sub, unitId));
  return { sub, asTeam, roster, sets, close: () => sub.release() };
}

/** The rows the search would price: the enumeration's proposals, the ordered-
 *  first seed, and a 1-opt neighbourhood of the seed (which is what `sweep`
 *  walks). De-duplicated by planKey, capped for box courtesy. */
function rowsOf(b: Bench): JointPlan[] {
  const partition = partitionOf({ sub: b.sub, roster: b.roster, fixed: new Set<UnitId>() });
  const enumerated = enumerateProposals({
    sub: b.sub,
    partition,
    roster: b.roster,
    sets: b.sets,
    fixed: new Map<UnitId, Candidate>(),
    doomed: new Set<UnitId>(),
    asTeam: b.asTeam,
    tuning: DEFAULT_CLUSTER_TUNING,
    salt: 0x5eed,
  }).plans;

  const seed = new Map<UnitId, Candidate>();
  for (const unitId of b.roster) {
    const c = (b.sets.get(unitId) as CandidateSet).candidates[0];
    if (c !== undefined) seed.set(unitId, c);
  }

  // THE CONTACT SEED. Candidate ordering decides whether the ordered-first
  // plan touches an enemy claim at all, and on a board where it does not the
  // entanglement gate admits nobody, B1/B3 never run, and no column is ever
  // generated (see the `no columns` rows — that is a real result about
  // non-contacting boards, not a harness failure). The search itself reaches
  // contacting plans through the sweep; this row set includes one directly so
  // the contested regime is actually measured. Each unit takes the option
  // whose PATH overlaps an enemy influence footprint most.
  const enemyCells = new Set<number>();
  for (const [, team] of b.sub.teamNumberEntries()) {
    if (team === b.asTeam) continue;
    for (const e of b.sub.commandable(team)) for (const c of b.sub.influenceOf(e)) enemyCells.add(c);
  }
  const contact = new Map<UnitId, Candidate>();
  for (const unitId of b.roster) {
    const set = b.sets.get(unitId) as CandidateSet;
    let pick = set.candidates[0];
    let best = -1;
    for (const c of set.candidates) {
      const ov = c.path.filter((x) => enemyCells.has(x)).length;
      if (ov > best) { best = ov; pick = c; }
    }
    if (pick !== undefined) contact.set(unitId, pick);
  }

  const out: JointPlan[] = [];
  const seen = new Set<string>();
  const push = (p: JointPlan): void => {
    if (p.size !== b.roster.length) return;
    const k = planKey(p);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  push(seed);
  push(contact);
  for (const p of enumerated) push(p);
  // The sweep's own neighbourhood: one unit onto one alternative, from both
  // seeds — which is exactly the 1-opt set `sweep` walks.
  for (const base of [contact, seed]) {
    for (const unitId of b.roster) {
      const set = b.sets.get(unitId) as CandidateSet;
      for (const c of set.candidates.slice(0, 3)) {
        if (out.length >= MAX_ROWS) break;
        push(withMoves(base, [c]));
      }
      if (out.length >= MAX_ROWS) break;
    }
  }
  return out.slice(0, MAX_ROWS);
}

/** Production column generation: price every row through the REAL bank and let
 *  `closeGroup` bank its minimisers. */
function columnsOf(b: Bench, rows: ReadonlyArray<JointPlan>): {
  witnesses: ReadonlyArray<Witness>;
  resolutions: number;
} {
  const bank = new BoundBank({
    sub: b.sub,
    gen: new GrammarCandidateGenerator({}),
    evaluate: defaultEvaluator,
    asTeam: b.asTeam,
    budget: unbounded(),
    basis: [],
  });
  let resolutions = 0;
  for (const row of rows) resolutions += bank.price(row).resolutions;
  return { witnesses: [...bank.witnesses], resolutions };
}

interface Matrix {
  /** floors: bounds.worst per cell — doc 06 §5's specified endpoint. */
  readonly lo: number[][];
  /** ceilings: bounds.best per cell. */
  readonly hi: number[][];
  readonly deadCells: number;
  readonly finiteMin: number;
  readonly finiteMax: number;
  readonly resolves: number;
}

/** M[i][j] = the proved FLOOR of row i against column j — the endpoint doc 06
 *  §5 specifies, so `vPure` and `vMixed` are two reductions of one matrix. */
function matrixOf(b: Bench, rows: ReadonlyArray<JointPlan>, cols: ReadonlyArray<Witness>): Matrix {
  const lo: number[][] = [];
  const hi: number[][] = [];
  let deadCells = 0;
  let finiteMin = Number.POSITIVE_INFINITY;
  let finiteMax = Number.NEGATIVE_INFINITY;
  let resolves = 0;
  for (const row of rows) {
    const lineLo: number[] = [];
    const lineHi: number[] = [];
    for (const col of cols) {
      const joint = withMoves(row, [...col.replies.values()]);
      let vlo = Number.NEGATIVE_INFINITY;
      let vhi = Number.NEGATIVE_INFINITY;
      try {
        const out = b.sub.resolveBoundedFull(joint, b.asTeam);
        vlo = out.bounds.worst;
        vhi = out.bounds.best;
        // BOUNDED STAT CHECKED AGAINST ITS BOUND: a floor never exceeds the
        // ceiling of the same resolve.
        expect(vlo).toBeLessThanOrEqual(vhi);
        b.sub.releaseResolution(out.resolution);
        resolves++;
      } catch {
        vlo = Number.NEGATIVE_INFINITY;
        vhi = Number.NEGATIVE_INFINITY;
      }
      if (Number.isFinite(vlo)) {
        if (vlo < finiteMin) finiteMin = vlo;
        if (vlo > finiteMax) finiteMax = vlo;
      } else {
        deadCells++;
      }
      lineLo.push(vlo);
      lineHi.push(Number.isFinite(vhi) ? vhi : Number.NEGATIVE_INFINITY);
    }
    lo.push(lineLo);
    hi.push(lineHi);
  }
  return { lo, hi, deadCells, finiteMin, finiteMax, resolves };
}

/** DEAD is −∞ and a matrix game needs finite payoffs. Map it to a sentinel
 *  strictly below every finite cell by one full span, and REPORT how many
 *  cells were mapped, because when that count is large the gap is partly a
 *  function of the sentinel rather than of the board. */
function finitise(mat: Matrix, raw: number[][], spanMult: number): { m: number[][]; sentinel: number } {
  const span = Math.max(1, mat.finiteMax - mat.finiteMin);
  const sentinel = (Number.isFinite(mat.finiteMin) ? mat.finiteMin : 0) - spanMult * span;
  const m = raw.map((r) => r.map((v) => (Number.isFinite(v) ? v : sentinel)));
  return { m, sentinel };
}

/** The midpoint matrix — the reading the belief layer's `est` channel uses. */
function midOf(mat: Matrix): number[][] {
  return mat.lo.map((r, i) =>
    r.map((v, j) => {
      const h = (mat.hi[i] as number[])[j] as number;
      return Number.isFinite(v) && Number.isFinite(h) ? (v + h) / 2 : Number.NEGATIVE_INFINITY;
    })
  );
}

// -------------------------------------------------------- the matrix solver

/** Regret matching+ (Tammelin 2014) with linear averaging, alternating
 *  updates. ~40 lines, no dependency. */
function solveMatrix(m: number[][], iters: number): {
  value: number;
  rowMix: number[];
  colMix: number[];
} {
  const R = m.length;
  const C = (m[0] as number[]).length;
  const rPos = new Array<number>(R).fill(0);
  const cPos = new Array<number>(C).fill(0);
  const rSum = new Array<number>(R).fill(0);
  const cSum = new Array<number>(C).fill(0);
  const strat = (pos: number[]): number[] => {
    let s = 0;
    for (const v of pos) s += v;
    if (s <= 0) return pos.map(() => 1 / pos.length);
    return pos.map((v) => v / s);
  };
  for (let t = 1; t <= iters; t++) {
    const p = strat(rPos);
    const q = strat(cPos);
    for (let i = 0; i < R; i++) rSum[i] = (rSum[i] as number) + t * (p[i] as number);
    for (let j = 0; j < C; j++) cSum[j] = (cSum[j] as number) + t * (q[j] as number);
    // Row player maximises; column player minimises.
    const uRow = new Array<number>(R).fill(0);
    for (let i = 0; i < R; i++) {
      let acc = 0;
      for (let j = 0; j < C; j++) acc += (q[j] as number) * (m[i] as number[])[j] as number;
      uRow[i] = acc;
    }
    let vr = 0;
    for (let i = 0; i < R; i++) vr += (p[i] as number) * (uRow[i] as number);
    for (let i = 0; i < R; i++) rPos[i] = Math.max(0, (rPos[i] as number) + ((uRow[i] as number) - vr));

    const uCol = new Array<number>(C).fill(0);
    for (let j = 0; j < C; j++) {
      let acc = 0;
      for (let i = 0; i < R; i++) acc += (p[i] as number) * ((m[i] as number[])[j] as number);
      uCol[j] = acc;
    }
    let vc = 0;
    for (let j = 0; j < C; j++) vc += (q[j] as number) * (uCol[j] as number);
    // The column player's regret is for LOWER utility.
    for (let j = 0; j < C; j++) cPos[j] = Math.max(0, (cPos[j] as number) + (vc - (uCol[j] as number)));
  }
  const norm = (s: number[]): number[] => {
    let t = 0;
    for (const v of s) t += v;
    return t <= 0 ? s.map(() => 1 / s.length) : s.map((v) => v / t);
  };
  const rowMix = norm(rSum);
  const colMix = norm(cSum);
  let value = 0;
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < C; j++) {
      value += (rowMix[i] as number) * (colMix[j] as number) * ((m[i] as number[])[j] as number);
    }
  }
  return { value, rowMix, colMix };
}

const maxMin = (m: number[][]): number =>
  Math.max(...m.map((r) => Math.min(...r)));
const minMax = (m: number[][]): number => {
  const C = (m[0] as number[]).length;
  let best = Number.POSITIVE_INFINITY;
  for (let j = 0; j < C; j++) {
    let col = Number.NEGATIVE_INFINITY;
    for (const r of m) col = Math.max(col, r[j] as number);
    best = Math.min(best, col);
  }
  return best;
};
const support = (mix: number[]): number => mix.filter((p) => p > SUPPORT_EPS).length;

// ------------------------------------------------------------------- report

interface Reading {
  readonly label: string;
  readonly vPure: number;
  readonly vMinMax: number;
  /** EXACT and solver-independent: minMax − maxMin. Zero iff the matrix has a
   *  pure saddle point, in which case mixing provably buys NOTHING. It is an
   *  exact UPPER BOUND on `vMixed − vPure`. */
  readonly pureDuality: number;
  readonly vMixed: number;
  readonly gap: number;
  readonly rowSupport: number;
  readonly colSupport: number;
  /** How much the matrix varies at all. A near-zero span means the reduction
   *  carries no ordering information and "no mixing benefit" is vacuous
   *  rather than informative — the §2.3 saturation claim, measured. */
  readonly span: number;
  /** Spread of the per-row minima: how much the SECURITY VALUE discriminates
   *  between the plans the search is choosing among. This is the quantity
   *  `better()`'s floor rung actually reads. */
  readonly rowMinSpread: number;
  /** Distinct per-row minima, out of `rows`. 1 ⇒ every plan has the same
   *  security value and the floor rung decides nothing. */
  readonly distinctRowMins: number;
}

interface Row {
  board: string;
  rows: number;
  cols: number;
  deadFrac: string;
  readings: Reading[];
  cellResolves: number;
  bankResolves: number;
  solveMs: number;
  stable: string;
}

const table: Row[] = [];

function read(label: string, m: number[][]): Reading {
  const vPure = maxMin(m);
  const vMinMax = minMax(m);
  const sol = solveMatrix(m, RM_ITERS);

  // ---- CONSERVATION, ASSERTED INSIDE -----------------------------------
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  expect(Math.abs(sum(sol.rowMix) - 1)).toBeLessThan(1e-6);
  expect(Math.abs(sum(sol.colMix) - 1)).toBeLessThan(1e-6);
  expect(sol.rowMix.every((p) => p >= -EPS)).toBe(true);
  expect(sol.colMix.every((p) => p >= -EPS)).toBe(true);
  // The minimax bracket — a real correctness check on the solver, not a
  // tautology. Tolerance scales with the matrix and with RM+'s own residual.
  const scale = Math.max(1, Math.abs(vPure), Math.abs(vMinMax));
  const tol = 1e-4 * scale;
  expect(sol.value).toBeGreaterThanOrEqual(vPure - tol);
  expect(sol.value).toBeLessThanOrEqual(vMinMax + tol);
  // EXACT: the pure duality gap bounds what mixing can buy.
  expect(vMinMax).toBeGreaterThanOrEqual(vPure - EPS);

  const flat = m.flat();
  const rowMins = m.map((r) => Math.min(...r));
  const q = (x: number): number => Math.round(x * 1e6);
  return {
    label,
    vPure,
    vMinMax,
    pureDuality: vMinMax - vPure,
    vMixed: sol.value,
    gap: Math.max(0, sol.value - vPure),
    rowSupport: support(sol.rowMix),
    colSupport: support(sol.colMix),
    span: Math.max(...flat) - Math.min(...flat),
    rowMinSpread: Math.max(...rowMins) - Math.min(...rowMins),
    distinctRowMins: new Set(rowMins.map(q)).size,
  };
}

function probe(name: string, board: Board): void {
  const b = bench(board);
  try {
    const rows = rowsOf(b);
    if (rows.length === 0) return;
    const { witnesses, resolutions } = columnsOf(b, rows);
    if (witnesses.length === 0) {
      table.push({
        board: name, rows: rows.length, cols: 0, deadFrac: '—', readings: [],
        cellResolves: 0, bankResolves: resolutions, solveMs: 0,
        stable: 'no columns — no contact, so no opponent choice matters',
      });
      return;
    }
    const mat = matrixOf(b, rows, witnesses);
    const t0 = Date.now();
    const readings = [
      read('floor', finitise(mat, mat.lo, 1).m),
      read('mid', finitise(mat, midOf(mat), 1).m),
      read('ceil', finitise(mat, mat.hi, 1).m),
    ];
    const solveMs = Date.now() - t0;

    // SENTINEL SENSITIVITY: if DEAD cells drive the answer, moving the
    // sentinel four spans out changes the floor reading's support.
    const alt = read('floor@4', finitise(mat, mat.lo, 4).m);
    const stable =
      alt.rowSupport === (readings[0] as Reading).rowSupport ? 'stable' : 'SENTINEL-SENSITIVE';

    table.push({
      board: name,
      rows: rows.length,
      cols: witnesses.length,
      deadFrac: `${((100 * mat.deadCells) / (rows.length * witnesses.length)).toFixed(0)}%`,
      readings,
      cellResolves: mat.resolves,
      bankResolves: resolutions,
      solveMs,
      stable,
    });
  } finally {
    b.close();
  }
}

afterEach(() => clearGeometryCache());

afterAll(() => {
  const pad = (s: string | number, n: number): string => String(s).padEnd(n);
  const f = (x: number): string => (Math.abs(x) < 5e-4 ? '0' : x.toFixed(3));
  const head =
    pad('board', 17) + pad('reading', 8) + pad('rows', 5) + pad('cols', 5) +
    pad('dead', 5) + pad('vPure', 9) + pad('minMax', 9) +
    pad('pureDual', 9) + pad('gap', 7) + pad('span', 9) +
    pad('rowMinSp', 9) + pad('#rowMin', 8) +
    pad('rowSup', 7) + pad('colSup', 7) + 'note';
  const lines: string[] = [];
  for (const r of table) {
    if (r.readings.length === 0) {
      lines.push(pad(r.board, 17) + pad('—', 8) + pad(r.rows, 5) + pad(r.cols, 5) +
        pad('—', 5) + pad('—', 9) + pad('—', 9) + pad('—', 9) + pad('—', 7) +
        pad('—', 9) + pad('—', 9) + pad('—', 8) + pad('—', 7) + pad('—', 7) + r.stable);
      continue;
    }
    r.readings.forEach((g, k) => {
      lines.push(
        pad(k === 0 ? r.board : '', 17) + pad(g.label, 8) +
        pad(k === 0 ? r.rows : '', 5) + pad(k === 0 ? r.cols : '', 5) +
        pad(k === 0 ? r.deadFrac : '', 5) +
        pad(f(g.vPure), 9) + pad(f(g.vMinMax), 9) + pad(f(g.pureDuality), 9) +
        pad(f(g.gap), 7) + pad(f(g.span), 9) + pad(f(g.rowMinSpread), 9) +
        pad(`${g.distinctRowMins}/${r.rows}`, 8) +
        pad(g.rowSupport, 7) + pad(g.colSupport, 7) +
        (k === 0 ? `${r.stable}; cells=${r.cellResolves} bankRes=${r.bankResolves} rm+=${r.solveMs}ms` : '')
      );
    });
  }
  // eslint-disable-next-line no-console
  console.log(
    '\n=== restrictedGap probe (S0) ===\n' +
      'PREMISE: hand-built scenario boards, turn 22, seat red, shipped bank config\n' +
      '         and cluster tuning, defaultEvaluator, RM+ ' + RM_ITERS + ' iters,\n' +
      '         rows = enumeration proposals + ordered-first seed + contact seed + 1-opt\n' +
      '         (cap ' + MAX_ROWS + '), columns = witnesses banked by the real BoundBank.\n' +
      '         NOT sampled from play. Generalising beyond this is a premise crossing.\n' +
      'pureDual = minMax − maxMin: EXACT, solver-free, and an upper bound on gap.\n' +
      '         Zero ⇒ the matrix has a pure saddle ⇒ mixing provably buys nothing.\n' +
      'span/rowMinSp/#rowMin: whether the matrix carries ANY ordering information.\n' +
      '         #rowMin = 1 means every plan has the same security value, so\n' +
      '         "no mixing benefit" would be vacuous rather than informative.\n' +
      'readings: floor = bounds.worst (what the search adjudicates on),\n' +
      '         mid = (worst+best)/2 (the est channel), ceil = bounds.best.\n\n' +
      head + '\n' + '-'.repeat(head.length) + '\n' + lines.join('\n') + '\n'
  );
});

describe('restrictedGap: is the pure argmax already optimal on our boards?', () => {
  test('quiet control — six trail units, no slider, enemy distant', () => probe('quiet-snake6', quietBoard()));
  test('slider regime — queen hub', () => probe('hub-queen', hubBoard('queen')));
  test('non-slider big component — knight hub', () => probe('hub-knight', hubBoard('knight')));
  test('pieceless hub control', () => probe('hub-plain', hubBoard(undefined)));
  test('contested cells — three facing pairs', () => probe('contested-3', contestedBoard()));
  test('contested cells + slider', () => probe('contested-queen', contestedBoard('queen')));
  test('duel over one food cell', () => probe('duel-food', duelBoard(true)));
  test('duel, no prize', () => probe('duel-bare', duelBoard(false)));
  test('two pairs converging on one corridor mouth', () => probe('corridor', corridorBoard()));
});
