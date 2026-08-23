/**
 * Cost side of the operator lane:
 *
 *  A. REAL conformance latency (wall clock, `performance.now`) — the number an
 *     operator actually waits between acting and seeing the wire agree.
 *  B. The price of the cold conform: `conform(ctx, incumbent)` vs
 *     `conform(ctx, ∅)`, in engine resolutions and in milliseconds. This is
 *     what V1-BUG-1 costs on every operator event.
 *  C. Pin-context cache CAPACITY under an oscillation across many destinations
 *     (default `pinCacheCapacity: 8` vs one rook's 13 options).
 *  D. A live demonstration that `report.speculative` mixes epochs, which is
 *     what `adviseFromReport`'s `key.includes(...)` lookup then subtracts
 *     across (V1-BUG-7).
 */

import type { JointPlan, Pin, PinEvent, SearchContext, SearchCore, UnitId } from '../../src/lobster/contracts';
import { LobsterKernel, type KernelReport } from '../../src/lobster/kernel';
import { makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { makeSearchCore } from '../../src/lobster/search';
import {
  boardCases,
  boardOf,
  clearGeometryCache,
  mean,
  piece,
  probeUnits,
  quantile,
  round,
  StepClock,
  tacticalCases,
} from './harness';

afterEach(() => clearGeometryCache());

const TURN = 9;
const nowWall = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const costly = boardOf(
  [
    piece('a', { x: 2, y: 3 }, 'rook', 2, { teamID: 'red' }),
    piece('b', { x: 5, y: 6 }, 'knight', 1, { teamID: 'red' }),
    piece('e1', { x: 4, y: 3 }, 'knight', 1, { teamID: 'blue' }),
    piece('e2', { x: 2, y: 4 }, 'pawn', 1, { teamID: 'blue' }),
  ],
  7
);

test('A. real conformance latency (wall clock)', async () => {
  /* eslint-disable no-console */
  console.log('\n=== A. CONFORMANCE LATENCY, REAL CLOCK ===');
  console.log('board                  events  kernelLatencyMs p50/p95/max  operatorLatencyMs p50/p95/max  slicesBefore');
  for (const bc of [...boardCases(), ...tacticalCases()]) {
    const units = probeUnits(bc.board, TURN, bc.ourTeam, bc.ours);
    const u = [...units.values()][0];
    if (u === undefined) continue;
    const dests = [...new Set(u.options.map((c) => c.to))].filter((d) => d !== u.at);
    const sub = makeSubstrate({ board: bc.board, turn: TURN, asTeam: bc.ourTeam });
    const gen = new GrammarCandidateGenerator();
    const base = makeSearchCore();
    const kernel = new LobsterKernel({ sliceMs: 5, reserveMs: 2, minWriteIntervalMs: 0 });
    const firedAt: number[] = [];
    const operatorLatency: number[] = [];
    let slice = 0;
    const EVENTS = 12;
    const core: SearchCore = {
      improve: (ctx) => {
        const out = base.improve(ctx);
        slice++;
        if (slice % 4 === 0 && firedAt.length < EVENTS) {
          firedAt.push(nowWall());
          kernel.onPinEvent({
            kind: 'pin',
            pin: {
              unitId: u.unitId,
              to: dests[firedAt.length % dests.length] as number,
              tentative: false,
            },
          } as PinEvent);
        }
        return out;
      },
      conform: (ctx, incumbent) => base.conform(ctx, incumbent),
    };
    let pendingFire = 0;
    try {
      for await (const rec of kernel.decide({
        sub,
        gen,
        evaluate: materialEvaluator,
        search: core,
        asTeam: sub.teamNumber(bc.ourTeam),
        deadlineMs: nowWall() + 400,
        initialPins: [],
        now: nowWall,
      })) {
        if (rec.epoch > pendingFire && pendingFire < firedAt.length) {
          operatorLatency.push(nowWall() - (firedAt[pendingFire] as number));
          pendingFire++;
        }
      }
    } finally {
      sub.release();
    }
    clearGeometryCache();
    const report = kernel.lastReport as KernelReport;
    const k = report.conformance.map((c) => c.latencyMs);
    console.log(
      `${bc.name.padEnd(22)} ${String(report.conformance.length).padStart(6)}  ` +
        `${`${round(quantile(k, 0.5), 3)}/${round(quantile(k, 0.95), 3)}/${round(Math.max(...k), 3)}`.padStart(27)}  ` +
        `${`${round(quantile(operatorLatency, 0.5), 3)}/${round(quantile(operatorLatency, 0.95), 3)}/${round(Math.max(...operatorLatency), 3)}`.padStart(28)}  ` +
        `${JSON.stringify([...new Set(report.conformance.map((c) => c.slicesBefore))])}`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);

test('B. the price of the cold conform (V1-BUG-1)', () => {
  /* eslint-disable no-console */
  console.log('\n=== B. conform(incumbent) vs conform(EMPTY) ===');
  console.log('board                  units  warmRes  coldRes  warmMs  coldMs  coldPlan==warmPlan');
  for (const bc of [...boardCases(), ...tacticalCases()]) {
    const sub = makeSubstrate({ board: bc.board, turn: TURN, asTeam: bc.ourTeam });
    try {
      const gen = new GrammarCandidateGenerator();
      const asTeam = sub.teamNumber(bc.ourTeam);
      const core = makeSearchCore();
      const budget = () => ({
        now: () => nowWall(),
        remainingMs: () => 1e9,
        elapsedMs: () => 0,
        shouldStop: () => false,
      });
      const units = probeUnits(bc.board, TURN, bc.ourTeam, bc.ours);
      const u = [...units.values()][0];
      const pins: Pin[] =
        u === undefined
          ? []
          : [
              {
                unitId: u.unitId,
                to: [...new Set(u.options.map((c) => c.to))].filter((d) => d !== u.at)[0] as number,
                tentative: false,
              },
            ];
      const ctx = (): SearchContext => ({
        sub,
        gen,
        evaluate: materialEvaluator,
        asTeam,
        pins,
        assumptions: [],
        incumbent: null,
        witnesses: [],
        budget: budget(),
      });
      // The incumbent the decision would have been holding.
      const incumbent = core.improve({ ...ctx(), pins: [] }).plan;

      const r0 = sub.resolutions();
      const t0 = nowWall();
      const warm = core.conform(ctx(), incumbent);
      const t1 = nowWall();
      const warmRes = sub.resolutions() - r0;

      const r1 = sub.resolutions();
      const t2 = nowWall();
      const cold = core.conform(ctx(), new Map() as JointPlan);
      const t3 = nowWall();
      const coldRes = sub.resolutions() - r1;

      const same =
        [...warm].map(([k, c]) => `${k}>${c.to}`).sort().join(',') ===
        [...cold].map(([k, c]) => `${k}>${c.to}`).sort().join(',');
      console.log(
        `${bc.name.padEnd(22)} ${String(bc.ours.length).padStart(5)} ${String(warmRes).padStart(8)} ` +
          `${String(coldRes).padStart(8)} ${String(round(t1 - t0, 2)).padStart(7)} ` +
          `${String(round(t3 - t2, 2)).padStart(7)} ${String(same).padStart(19)}`
      );
    } finally {
      sub.release();
      clearGeometryCache();
    }
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);

test('C. pin-context cache capacity under a wide oscillation', async () => {
  /* eslint-disable no-console */
  console.log('\n=== C. CACHE CAPACITY ===');
  console.log('capacity  distinctPins  hits  misses  resumes  evictions  creates  resumeRate');
  const units = probeUnits(costly, TURN, 'red', ['a', 'b']);
  const u = [...units.values()][0] as NonNullable<ReturnType<typeof probeUnits>['get']> extends never
    ? never
    : { unitId: UnitId; at: number; options: ReadonlyArray<{ to: number }> };
  const dests = [...new Set(u.options.map((c) => c.to))].filter((d) => d !== u.at);
  for (const capacity of [8, 16, 32]) {
    const clock = new StepClock(0.02);
    const sub = makeSubstrate({ board: costly, turn: TURN, asTeam: 'red' });
    const gen = new GrammarCandidateGenerator();
    const base = makeSearchCore();
    const kernel = new LobsterKernel({
      sliceMs: 2,
      reserveMs: 1,
      minWriteIntervalMs: 0,
      pinCacheCapacity: capacity,
    });
    let slice = 0;
    let fired = 0;
    const core: SearchCore = {
      improve: (ctx) => {
        const out = base.improve(ctx);
        slice++;
        if (slice % 2 === 0 && fired < 40) {
          kernel.onPinEvent({
            kind: 'pin',
            pin: { unitId: u.unitId, to: dests[fired % dests.length] as number, tentative: false },
          } as PinEvent);
          fired++;
        }
        return out;
      },
      conform: (ctx, incumbent) => base.conform(ctx, incumbent),
    };
    try {
      for await (const _rec of kernel.decide({
        sub,
        gen,
        evaluate: materialEvaluator,
        search: core,
        asTeam: sub.teamNumber('red'),
        deadlineMs: clock.peek() + 400,
        initialPins: [],
        now: clock.now,
      })) {
        void _rec;
      }
    } finally {
      sub.release();
    }
    clearGeometryCache();
    const c = (kernel.lastReport as KernelReport).cache;
    console.log(
      `${String(capacity).padStart(8)} ${String(dests.length).padStart(13)} ${String(c.hits).padStart(5)} ` +
        `${String(c.misses).padStart(7)} ${String(c.resumes).padStart(8)} ${String(c.evictions).padStart(10)} ` +
        `${String(c.creates).padStart(8)} ${String(round(c.resumes / Math.max(1, c.hits + c.misses), 3)).padStart(10)}`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);

test('D. report.speculative mixes epochs (V1-BUG-7, live)', async () => {
  /* eslint-disable no-console */
  console.log('\n=== D. SPECULATIVE ENTRIES ACROSS EPOCHS ===');
  const units = probeUnits(costly, TURN, 'red', ['a', 'b']);
  const rook = [...units.values()][0] as { unitId: UnitId; at: number; options: ReadonlyArray<{ to: number }> };
  const knight = [...units.values()][1] as { unitId: UnitId; at: number; options: ReadonlyArray<{ to: number }> };
  const hover = [...new Set(knight.options.map((c) => c.to))].filter((d) => d !== knight.at)[0] as number;
  const commitTo = [...new Set(rook.options.map((c) => c.to))].filter((d) => d !== rook.at)[0] as number;

  const clock = new StepClock(0.02);
  const sub = makeSubstrate({ board: costly, turn: TURN, asTeam: 'red' });
  const gen = new GrammarCandidateGenerator();
  const base = makeSearchCore();
  const kernel = new LobsterKernel({ sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 });
  let slice = 0;
  const core: SearchCore = {
    improve: (ctx) => {
      const out = base.improve(ctx);
      slice++;
      // Hover the knight first…
      if (slice === 1) {
        kernel.onPinEvent({ kind: 'pin', pin: { unitId: knight.unitId, to: hover, tentative: true } });
      }
      // …then a BINDING pin on the rook opens a new epoch while the hover stands.
      if (slice === 20) {
        kernel.onPinEvent({
          kind: 'pin',
          pin: { unitId: rook.unitId, to: commitTo, tentative: false },
        });
      }
      return out;
    },
    conform: (ctx, incumbent) => base.conform(ctx, incumbent),
  };
  try {
    for await (const _rec of kernel.decide({
      sub,
      gen,
      evaluate: materialEvaluator,
      search: core,
      asTeam: sub.teamNumber('red'),
      deadlineMs: clock.peek() + 400,
      initialPins: [],
      now: clock.now,
    })) {
      void _rec;
    }
  } finally {
    sub.release();
  }
  const report = kernel.lastReport as KernelReport;
  const marker = `${knight.unitId}@${hover}?`;
  const matching = report.speculative.filter((s) => s.key.includes(marker));
  console.log(
    `epochs=${report.epochs} speculativeEntries=${JSON.stringify(
      report.speculative.map((s) => ({ key: s.key, lo: round(s.lo, 1), hi: round(s.hi, 1), cursor: s.cursor }))
    )}`
  );
  console.log(
    `entries matching the advice lookup "${marker}": ${matching.length} ` +
      `— adviseFromReport takes the FIRST (${matching[0]?.key}), whose epoch baseline is ` +
      `${report.contexts.find((c) => c.key === matching[0]?.key)?.epochBaseline}; ` +
      `the staged record it is subtracted from is epoch ${report.journal[report.journal.length - 1]?.epoch}`
  );
  console.log(
    `contexts=${JSON.stringify(
      report.contexts.map((c) => ({ key: c.key, epochBaseline: c.epochBaseline, cursor: c.cursor }))
    )}`
  );
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);
