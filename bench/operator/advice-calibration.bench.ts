/**
 * SCENARIO 3 — PIN ADVICE CALIBRATION against exhaustive ground truth.
 *
 * For every legal destination of one of our units on a board small enough to
 * enumerate completely:
 *
 *   trueCost = max_P trueWorst(P)  −  max_{P : P[u]=to} trueWorst(P)
 *
 * (both maxima over EVERY joint plan, each priced by exhaustive enumeration of
 * every enemy reply with nothing held — the testkit's `trueWorstCase` idiom).
 *
 * Against it: `PinAdvice.costLo/costHi` as `pins.adviseFromReport` produces it
 * from a real decision that hovered that destination. SOUNDNESS is
 * `costLo ≤ trueCost ≤ costHi`; tightness is `costHi − costLo`.
 *
 * The run is done TWICE:
 *   AS SHIPPED — the speculative context exactly as the kernel builds it;
 *   REPAIRED   — the same run with one wrapper that makes the tentative pin
 *                BINDING inside the speculative context (i.e. what the design
 *                says the speculative search is), so the report can separate
 *                "the advice arithmetic is wrong" from "the advice plumbing is".
 */

import type { JointPlan, Pin, SearchContext, UnitId } from '../../src/lobster/contracts';
import { LobsterKernel } from '../../src/lobster/kernel';
import { makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { makeSearchCore } from '../../src/lobster/search';
import { adviseFromReport, type TeamPinAdvice } from '../../src/lobster/pins';
import {
  StepClock,
  boardOf,
  clearGeometryCache,
  makeSnake,
  mean,
  piece,
  quantile,
  round,
} from './harness';
import { bestUnder, groundTruth, type TruthTable } from './truth';

afterEach(() => clearGeometryCache());

const TURN = 9;

const BOARDS = [
  {
    // Chosen by scan.bench.ts: 11 of the rook's 13 destinations cost exactly
    // 10, two cost 0 — a graded, non-degenerate pin-cost structure.
    name: 'C1 rook(2,2)+knight(5,6) vs knight(4,2)+pawn(2,4)',
    board: boardOf(
      [
        piece('a', { x: 2, y: 2 }, 'rook', 2, { teamID: 'red' }),
        piece('b', { x: 5, y: 6 }, 'knight', 1, { teamID: 'red' }),
        piece('e1', { x: 4, y: 2 }, 'knight', 1, { teamID: 'blue' }),
        piece('e2', { x: 2, y: 4 }, 'pawn', 1, { teamID: 'blue' }),
      ],
      7
    ),
  },
  {
    name: 'C2 rook(2,3)+knight(5,6) vs knight(4,3)+pawn(2,4)',
    board: boardOf(
      [
        piece('a', { x: 2, y: 3 }, 'rook', 2, { teamID: 'red' }),
        piece('b', { x: 5, y: 6 }, 'knight', 1, { teamID: 'red' }),
        piece('e1', { x: 4, y: 3 }, 'knight', 1, { teamID: 'blue' }),
        piece('e2', { x: 2, y: 4 }, 'pawn', 1, { teamID: 'blue' }),
      ],
      7
    ),
  },
  {
    name: 'C3 rook(2,4)+knight(5,6) vs knight(4,2)+pawn(2,5)',
    board: boardOf(
      [
        piece('a', { x: 2, y: 4 }, 'rook', 2, { teamID: 'red' }),
        piece('b', { x: 5, y: 6 }, 'knight', 1, { teamID: 'red' }),
        piece('e1', { x: 4, y: 2 }, 'knight', 1, { teamID: 'blue' }),
        piece('e2', { x: 2, y: 5 }, 'pawn', 1, { teamID: 'blue' }),
      ],
      7
    ),
  },
  {
    name: 'T1 rook+knight vs 2 held pawns (7x7)',
    board: boardOf(
      [
        piece('a', { x: 2, y: 2 }, 'rook', 2, { teamID: 'red' }),
        piece('b', { x: 4, y: 6 }, 'knight', 1, { teamID: 'red' }),
        piece('e1', { x: 3, y: 3 }, 'pawn', 1, { teamID: 'blue' }),
        piece('e2', { x: 3, y: 5 }, 'pawn', 1, { teamID: 'blue' }),
      ],
      7
    ),
  },
  {
    name: 'T2 knight+bishop vs 2 held pawns (7x7)',
    board: boardOf(
      [
        piece('a', { x: 2, y: 2 }, 'knight', 1, { teamID: 'red' }),
        piece('b', { x: 1, y: 4 }, 'bishop', 2, { teamID: 'red' }),
        piece('e1', { x: 3, y: 3 }, 'pawn', 1, { teamID: 'blue' }),
        piece('e2', { x: 4, y: 4 }, 'pawn', 1, { teamID: 'blue' }),
      ],
      7
    ),
  },
  {
    name: 'T3 snake+bishop vs held knight+pawn (7x7)',
    board: boardOf(
      [
        makeSnake(
          's',
          [
            { x: 2, y: 3 },
            { x: 1, y: 3 },
          ],
          { teamID: 'red', orientation: { dx: 1, dy: 0 } }
        ),
        piece('b', { x: 1, y: 1 }, 'bishop', 2, { teamID: 'red' }),
        piece('e1', { x: 4, y: 3 }, 'knight', 1, { teamID: 'blue' }),
        piece('e2', { x: 3, y: 5 }, 'pawn', 1, { teamID: 'blue' }),
      ],
      7
    ),
  },
];

/** Make the tentative pin BINDING inside speculative contexts — the repair. */
function withBindingSpeculation(core: ReturnType<typeof makeSearchCore>) {
  const bind = (ctx: SearchContext): SearchContext =>
    ctx.pins.some((p) => p.tentative)
      ? { ...ctx, pins: ctx.pins.map((p) => ({ ...p, tentative: false })) }
      : ctx;
  return {
    improve: (ctx: SearchContext) => core.improve(bind(ctx)),
    conform: (ctx: SearchContext, incumbent: JointPlan) => core.conform(bind(ctx), incumbent),
  };
}

async function adviseFor(
  board: (typeof BOARDS)[number]['board'],
  pin: Pin,
  repaired: boolean,
  budgetMs = 200
): Promise<{ advice: TeamPinAdvice | null; specCursor: number; specLo: number; specHi: number; stagedLo: number; stagedHi: number }> {
  const clock = new StepClock(0.02);
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const gen = new GrammarCandidateGenerator();
  const base = makeSearchCore();
  const core = repaired ? withBindingSpeculation(base) : base;
  const kernel = new LobsterKernel({ sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 });
  try {
    for await (const _rec of kernel.decide({
      sub,
      gen,
      evaluate: materialEvaluator,
      search: core,
      asTeam: sub.teamNumber('red'),
      deadlineMs: clock.peek() + budgetMs,
      initialPins: [pin],
      now: clock.now,
    })) {
      void _rec;
    }
  } finally {
    sub.release();
  }
  const report = kernel.lastReport;
  if (report === null) {
    return { advice: null, specCursor: 0, specLo: NaN, specHi: NaN, stagedLo: NaN, stagedHi: NaN };
  }
  const advice = adviseFromReport({ report, tentative: [pin], witnesses: [], threshold: -Infinity });
  const spec = report.speculative.find((s) => s.key.includes(`${pin.unitId}@${pin.to}?`));
  const staged = report.journal[report.journal.length - 1];
  return {
    advice: advice[0] ?? null,
    specCursor: spec?.cursor ?? 0,
    specLo: spec?.lo ?? NaN,
    specHi: spec?.hi ?? NaN,
    stagedLo: staged?.lo ?? NaN,
    stagedHi: staged?.hi ?? NaN,
  };
}

interface Row {
  board: string;
  mode: 'as-shipped' | 'repaired';
  unitId: UnitId;
  to: number;
  trueCost: number;
  costLo: number;
  costHi: number;
  width: number;
  confidence: number;
  brackets: boolean;
  specCursor: number;
  specLo: number;
  specHi: number;
  stagedLo: number;
  stagedHi: number;
}

test('ADVICE CALIBRATION vs exhaustive truth', async () => {
  const rows: Row[] = [];
  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 3: PIN ADVICE CALIBRATION ===');
  for (const b of BOARDS) {
    let table: TruthTable;
    try {
      table = groundTruth({
        board: b.board,
        turn: TURN,
        ourTeam: 'red',
        maxPlans: 4000,
        maxReplies: 400,
      });
    } catch (err) {
      console.log(`${b.name}: ground truth refused — ${String(err)}`);
      continue;
    }
    clearGeometryCache();
    const unconstrained = bestUnder(table);
    const probes: Array<{ unitId: UnitId; to: number }> = [];
    for (const unitId of table.ourIds) {
      for (const to of [...new Set((table.optionsOf.get(unitId) ?? []).map((c) => c.to))].sort(
        (x, y) => x - y
      )) {
        probes.push({ unitId, to });
      }
    }
    console.log(
      `${b.name}: plans=${table.plans.length} replies=${table.replySpace} resolutions=${table.resolutions} ` +
        `bestUnconstrained=${round(unconstrained.value, 1)} pinsProbed=${probes.length} over units ${JSON.stringify(table.ourIds)}`
    );

    for (const { unitId, to } of probes) {
      const conforming = bestUnder(table, { unitId, to });
      if (conforming.plan === null) continue;
      const trueCost = unconstrained.value - conforming.value;
      const pin: Pin = { unitId, to, tentative: true };
      for (const mode of ['as-shipped', 'repaired'] as const) {
        const got = await adviseFor(b.board, pin, mode === 'repaired');
        clearGeometryCache();
        const a = got.advice;
        const costLo = a?.costLo ?? NaN;
        const costHi = a?.costHi ?? NaN;
        rows.push({
          board: b.name,
          mode,
          unitId,
          to,
          trueCost,
          costLo,
          costHi,
          width: costHi - costLo,
          confidence: a?.confidence ?? NaN,
          brackets: costLo <= trueCost && trueCost <= costHi,
          specCursor: got.specCursor,
          specLo: got.specLo,
          specHi: got.specHi,
          stagedLo: got.stagedLo,
          stagedHi: got.stagedHi,
        });
      }
    }
  }

  console.log(
    '\nboard                                mode        unit  to   trueCost  costLo  costHi  width  conf   brackets  spec[lo,hi]@cur  staged[lo,hi]'
  );
  for (const r of rows) {
    console.log(
      `${r.board.slice(0, 34).padEnd(35)} ${r.mode.padEnd(11)} ${String(r.unitId).padStart(4)} ` +
        `${String(r.to).padStart(3)} ${String(round(r.trueCost, 1)).padStart(9)} ` +
        `${String(round(r.costLo, 1)).padStart(7)} ${String(round(r.costHi, 1)).padStart(7)} ` +
        `${String(round(r.width, 1)).padStart(6)} ${String(round(r.confidence, 2)).padStart(5)} ` +
        `${String(r.brackets).padStart(9)}  ${`[${round(r.specLo, 1)},${round(r.specHi, 1)}]@${r.specCursor}`.padStart(16)} ` +
        `${`[${round(r.stagedLo, 1)},${round(r.stagedHi, 1)}]`}`
    );
  }

  console.log('\n--- aggregate ---');
  for (const mode of ['as-shipped', 'repaired'] as const) {
    const rs = rows.filter((r) => r.mode === mode);
    const finite = rs.filter((r) => Number.isFinite(r.trueCost));
    const nonzero = finite.filter((r) => r.trueCost > 0);
    const widths = rs.filter((r) => Number.isFinite(r.width)).map((r) => r.width);
    console.log(
      `${mode}: n=${rs.length} bracketed=${rs.filter((r) => r.brackets).length}/${rs.length} ` +
        `(finite-truth ${finite.filter((r) => r.brackets).length}/${finite.length}, ` +
        `truth>0 ${nonzero.filter((r) => r.brackets).length}/${nonzero.length}) ` +
        `meanWidth=${round(mean(widths), 2)} maxWidth=${round(Math.max(...widths), 2)} ` +
        `zeroCostAdvice=${rs.filter((r) => r.costLo === 0 && r.costHi === 0).length}/${rs.length}`
    );
    const byConf = new Map<number, number[]>();
    for (const r of rs) {
      if (!Number.isFinite(r.width)) continue;
      const key = round(r.confidence, 2);
      byConf.set(key, [...(byConf.get(key) ?? []), r.width]);
    }
    console.log(
      `   width by confidence: ${[...byConf.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([c, ws]) => `conf=${c}: n=${ws.length} meanWidth=${round(mean(ws), 2)}`)
        .join(' | ')}`
    );
  }
  /* eslint-enable no-console */
  expect(rows.length).toBeGreaterThan(0);
}, 1800000);

/**
 * CONFIDENCE vs TIGHTNESS. `PinAdvice.confidence = min(1, cursor/8)`, where
 * `cursor` is the number of slices the speculative context has been given. The
 * question the mandate asks is whether it correlates with how tight the
 * interval is. Vary the budget so the cursor lands below, at and above the
 * saturation point.
 */
test('CONFIDENCE vs interval width', async () => {
  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 3b: CONFIDENCE CALIBRATION ===');
  const board = BOARDS[0] as (typeof BOARDS)[number];
  const table = groundTruth({
    board: board.board,
    turn: TURN,
    ourTeam: 'red',
    maxPlans: 4000,
    maxReplies: 400,
  });
  clearGeometryCache();
  const base = bestUnder(table).value;
  const unitId = table.ourIds[0] as UnitId;
  const dests = [...new Set((table.optionsOf.get(unitId) ?? []).map((c) => c.to))].sort(
    (x, y) => x - y
  );
  const rows: Array<{
    budget: number;
    to: number;
    cursor: number;
    conf: number;
    width: number;
    trueCost: number;
    brackets: boolean;
  }> = [];
  for (const budget of [12, 20, 40, 80, 200]) {
    for (const to of dests) {
      const trueCost = base - bestUnder(table, { unitId, to }).value;
      const got = await adviseFor(board.board, { unitId, to, tentative: true }, true, budget);
      clearGeometryCache();
      const a = got.advice;
      if (a === null) continue;
      rows.push({
        budget,
        to,
        cursor: got.specCursor,
        conf: a.confidence,
        width: a.costHi - a.costLo,
        trueCost,
        brackets: a.costLo <= trueCost && trueCost <= a.costHi,
      });
    }
  }
  const byBudget = new Map<number, typeof rows>();
  for (const r of rows) byBudget.set(r.budget, [...(byBudget.get(r.budget) ?? []), r]);
  console.log('budget  n   cursor(min/med/max)  meanConf  meanWidth  bracketed');
  for (const [budget, rs] of [...byBudget.entries()].sort((x, y) => x[0] - y[0])) {
    const cursors = rs.map((r) => r.cursor);
    console.log(
      `${String(budget).padStart(6)} ${String(rs.length).padStart(3)}  ` +
        `${`${Math.min(...cursors)}/${quantile(cursors, 0.5)}/${Math.max(...cursors)}`.padStart(19)}  ` +
        `${String(round(mean(rs.map((r) => r.conf)), 3)).padStart(8)}  ` +
        `${String(round(mean(rs.map((r) => r.width)), 3)).padStart(9)}  ` +
        `${rs.filter((r) => r.brackets).length}/${rs.length}`
    );
  }
  const byConf = new Map<number, number[]>();
  for (const r of rows) byConf.set(round(r.conf, 3), [...(byConf.get(round(r.conf, 3)) ?? []), r.width]);
  console.log(
    `width by confidence: ${[...byConf.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([c, ws]) => `conf=${c}: n=${ws.length} meanWidth=${round(mean(ws), 2)}`)
      .join(' | ')}`
  );
  /* eslint-enable no-console */
  expect(rows.length).toBeGreaterThan(0);
}, 1800000);
