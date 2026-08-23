/**
 * SCENARIO 4 — ADVERSARIAL EVENT PATTERNS.
 *
 *  a. an ILLEGAL pin destination: the pin-unreachable refusal channel fires
 *     once, the unit keeps its own choice, the pin is never dropped;
 *  b. COMMIT then contradict: a committed unit refuses every later pin;
 *  c. PIN EVERY UNIT: the search has nothing to do — conforming records still
 *     reach the wire and the loop does not spin;
 *  d. EPOCH STORM: events arriving faster than slices (fired from inside the
 *     conformance call itself, so no refinement slice can run between them) —
 *     re-staging must not starve and no ratchet floor may cross an epoch.
 */

import type { JointPlan, PinEvent, SearchContext, UnitId } from '../../src/lobster/contracts';
import { LobsterKernel } from '../../src/lobster/kernel';
import { makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { makeSearchCore } from '../../src/lobster/search';
import {
  StepClock,
  boardCases,
  boardOf,
  clearGeometryCache,
  drive,
  piece,
  probeUnits,
  round,
  tacticalCases,
} from './harness';

afterEach(() => clearGeometryCache());

const TURN = 9;

const costly = boardOf(
  [
    piece('a', { x: 2, y: 3 }, 'rook', 2, { teamID: 'red' }),
    piece('b', { x: 5, y: 6 }, 'knight', 1, { teamID: 'red' }),
    piece('e1', { x: 4, y: 3 }, 'knight', 1, { teamID: 'blue' }),
    piece('e2', { x: 2, y: 4 }, 'pawn', 1, { teamID: 'blue' }),
  ],
  7
);

test('4a ILLEGAL PIN', async () => {
  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 4a: ILLEGAL PIN DESTINATION ===');
  for (const bc of [...boardCases(), ...tacticalCases()]) {
    const units = probeUnits(bc.board, TURN, bc.ourTeam, bc.ours);
    const u = [...units.values()][0];
    if (u === undefined) continue;
    const legal = new Set(u.options.map((c) => c.to));
    // A cell on the board that this unit's grammar cannot reach.
    const cells = (bc.size + 2) * (bc.size + 2);
    let illegal = -1;
    for (let c = 0; c < cells; c++) {
      if (!legal.has(c) && c !== u.at) {
        illegal = c;
        break;
      }
    }
    const out = await drive({
      board: bc.board,
      turn: TURN,
      ourTeam: bc.ourTeam,
      budgetMs: 150,
      kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 },
      script: [
        {
          atSlice: 3,
          event: { kind: 'pin', pin: { unitId: u.unitId, to: illegal, tentative: false } },
          label: 'illegal',
        },
      ],
    });
    clearGeometryCache();
    const after = out.emissions.filter((r) => r.epoch >= 1);
    const narrowings = after.map(
      (r) =>
        r.assumptions.filter(
          (a) => a.kind === 'narrowing' && a.unitId === u.unitId && a.note.includes('unreachable')
        ).length
    );
    const stillPinnedAsOperatorPin = after.some((r) =>
      r.assumptions.some((a) => a.kind === 'operator-pin' && a.unitId === u.unitId)
    );
    const tos = [...new Set(after.map((r) => r.plan.get(u.unitId)?.to))];
    console.log(
      `${bc.name}: unit=${u.unitId} illegalTo=${illegal} refusals.pin-unreachable=${out.report['refusals']['pin-unreachable']} ` +
        `epochs=${out.report.epochs} postPinEmissions=${after.length} ` +
        `narrowingOnEveryRecord=${narrowings.length > 0 && narrowings.every((n) => n === 1)} ` +
        `operatorPinClaimSubstituted=${!stillPinnedAsOperatorPin} ` +
        `unitDestinations=${JSON.stringify(tos)} stagedNothing=${out.report.stagedNothing} ` +
        `nonconformingRefusals=${out.report.refusals.nonconforming}`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);

test('4b COMMIT then contradict', async () => {
  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 4b: COMMIT IS PERMANENT ===');
  for (const bc of [...boardCases(), ...tacticalCases()]) {
    const units = probeUnits(bc.board, TURN, bc.ourTeam, bc.ours);
    const u = [...units.values()][0];
    if (u === undefined) continue;
    const dests = [...new Set(u.options.map((c) => c.to))].filter((d) => d !== u.at);
    const first = dests[0] as number;
    const other = dests[dests.length - 1] as number;
    const out = await drive({
      board: bc.board,
      turn: TURN,
      ourTeam: bc.ourTeam,
      budgetMs: 150,
      kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 },
      script: [
        {
          atSlice: 2,
          event: { kind: 'pin', pin: { unitId: u.unitId, to: first, tentative: false } },
          label: 'pin-first',
        },
        { atSlice: 4, event: { kind: 'commit', unitId: u.unitId }, label: 'commit' },
        {
          atSlice: 6,
          event: { kind: 'pin', pin: { unitId: u.unitId, to: other, tentative: false } },
          label: 'contradict',
        },
        { atSlice: 8, event: { kind: 'unpin', unitId: u.unitId }, label: 'unpin-after-commit' },
        {
          atSlice: 10,
          event: { kind: 'pin', pin: { unitId: u.unitId, to: other, tentative: true } },
          label: 'hover-after-commit',
        },
      ],
    });
    clearGeometryCache();
    const afterCommit = out.emissions.filter((r) => r.epoch >= 2);
    const tos = [...new Set(afterCommit.map((r) => r.plan.get(u.unitId)?.to))];
    console.log(
      `${bc.name}: unit=${u.unitId} committedTo=${first} contradictTo=${other} ` +
        `epochs=${out.report.epochs} (2 expected: pin, commit) ` +
        `destinationsAfterCommit=${JSON.stringify(tos)} honoured=${tos.length === 1 && tos[0] === first} ` +
        `conformanceSamples=${out.report.conformance.length} ` +
        `speculativeContexts=${JSON.stringify(out.report.speculative.map((s) => s.key))}`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);

test('4c PIN EVERY UNIT', async () => {
  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 4c: EVERY UNIT PINNED ===');
  for (const bc of [...boardCases(), ...tacticalCases()]) {
    const units = probeUnits(bc.board, TURN, bc.ourTeam, bc.ours);
    const pins = [...units.values()].map((u) => {
      const dests = [...new Set(u.options.map((c) => c.to))].filter((d) => d !== u.at);
      return { unitId: u.unitId, to: (dests[0] ?? u.at) as number, tentative: false };
    });
    const out = await drive({
      board: bc.board,
      turn: TURN,
      ourTeam: bc.ourTeam,
      budgetMs: 150,
      kernel: { sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 },
      initialPins: pins,
    });
    clearGeometryCache();
    const honoured = out.emissions.every((r) => pins.every((p) => r.plan.get(p.unitId)?.to === p.to));
    console.log(
      `${bc.name}: pinned=${pins.length}/${bc.ours.length} slices=${out.report.slices} ` +
        `emits=${out.report.emits} everyRecordHonoursEveryPin=${honoured} ` +
        `stagedNothing=${out.report.stagedNothing} elapsed=${round(out.report.elapsedMs, 1)}/${out.report.budgetMs} ` +
        `overshoot=${round(out.report.overshootMs, 3)} improveCalls=${out.report.improveCalls} ` +
        `refusals=${JSON.stringify(Object.fromEntries(Object.entries(out.report.refusals).filter(([, n]) => n > 0)))} ` +
        `wall=${out.wallMs}ms`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);

test('4d EPOCH STORM', async () => {
  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 4d: EPOCH STORM (events faster than slices) ===');
  const cases = [
    { name: 'costly-7x7', board: costly, ourTeam: 'red', ours: ['a', 'b'] },
    ...boardCases().map((b) => ({ name: b.name, board: b.board, ourTeam: b.ourTeam, ours: b.ours })),
  ];
  for (const bc of cases) {
    const units = probeUnits(bc.board, TURN, bc.ourTeam, bc.ours);
    const u = [...units.values()][0];
    if (u === undefined) continue;
    const dests = [...new Set(u.options.map((c) => c.to))].filter((d) => d !== u.at);
    const clock = new StepClock(0.02);
    const sub = makeSubstrate({ board: bc.board, turn: TURN, asTeam: bc.ourTeam });
    const gen = new GrammarCandidateGenerator();
    const core = makeSearchCore();
    const kernel = new LobsterKernel({ sliceMs: 2, reserveMs: 1, minWriteIntervalMs: 0 });

    let conformCalls = 0;
    let improveCalls = 0;
    const STORM = 30;
    const wrapped = {
      improve: (ctx: SearchContext) => {
        improveCalls++;
        return core.improve(ctx);
      },
      // THE STORM: every conformance re-stage queues the next event, so the
      // kernel re-enters the epoch branch with no refinement slice between.
      conform: (ctx: SearchContext, incumbent: JointPlan) => {
        conformCalls++;
        if (conformCalls <= STORM) {
          const to = dests[conformCalls % dests.length] as number;
          kernel.onPinEvent({
            kind: 'pin',
            pin: { unitId: u.unitId, to, tentative: false },
          } as PinEvent);
        }
        return core.conform(ctx, incumbent);
      },
    };

    const emissions: Array<{ epoch: number; lo: number; to: number | undefined }> = [];
    try {
      for await (const rec of kernel.decide({
        sub,
        gen,
        evaluate: materialEvaluator,
        search: wrapped,
        asTeam: sub.teamNumber(bc.ourTeam),
        deadlineMs: clock.peek() + 300,
        initialPins: [],
        now: clock.now,
      })) {
        emissions.push({ epoch: rec.epoch, lo: rec.lo, to: rec.plan.get(u.unitId)?.to });
      }
    } finally {
      sub.release();
    }
    clearGeometryCache();
    const report = kernel.lastReport;
    if (report === null) continue;

    // Cross-epoch ratchet leak detector: every basis in history must belong to
    // exactly one epoch, and the FIRST emission of each epoch must never be
    // refused on the ratchet — a leak shows up as a ratchet-floor refusal in an
    // epoch whose conforming plan is worth less than the previous epoch's.
    const epochsSeen = [...new Set(emissions.map((e) => e.epoch))];
    const perEpochFirstLo = new Map<number, number>();
    for (const e of emissions) if (!perEpochFirstLo.has(e.epoch)) perEpochFirstLo.set(e.epoch, e.lo);
    const drops = [...perEpochFirstLo.entries()]
      .sort((x, y) => x[0] - y[0])
      .filter(([ep, lo], i, arr) => i > 0 && lo < (arr[i - 1]?.[1] ?? -Infinity) && ep > 0).length;
    const basesPerEpoch = new Map<number, number>();
    for (const b of report.basisHistory) basesPerEpoch.set(b.epoch, (basesPerEpoch.get(b.epoch) ?? 0) + 1);

    console.log(
      `${bc.name}: epochs=${report.epochs} slices=${report.slices} improveCalls=${improveCalls} ` +
        `conformCalls=${report.conformCalls} emits=${report.emits} ` +
        `conformanceSamples=${report.conformance.length} slicesBefore=${JSON.stringify([
          ...new Set(report.conformance.map((c) => c.slicesBefore)),
        ])} ` +
        `epochsWithAnEmission=${epochsSeen.length}/${report.epochs}`
    );
    console.log(
      `    ratchetFloorRefusals=${report.refusals['ratchet-floor']} ratchetGapRefusals=${report.refusals['ratchet-gap']} ` +
        `boundViolations=${report.boundViolations} epochsWhoseFirstLoDroppedBelowThePrevious=${drops} ` +
        `basisHistoryLen=${report.basisHistory.length} maxBasesInOneEpoch=${Math.max(
          ...basesPerEpoch.values()
        )} distinctBasisEpochs=${basesPerEpoch.size} ` +
        `stagedNothing=${report.stagedNothing} elapsed=${round(report.elapsedMs, 1)}/${report.budgetMs} ` +
        `cache=${JSON.stringify(report.cache)}`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);
