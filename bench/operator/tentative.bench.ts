/**
 * SCENARIO 2 — TENTATIVE PINS (hover).
 *
 * Hover between two destinations for one unit while the search runs, and ask
 * the three questions the design promises answers to:
 *   a. do speculative contexts get SEARCHED for both hovers (report.speculative
 *      populated for both)?
 *   b. is the advice available BEFORE the operator commits?
 *   c. does speculative work ever leak into an emission?
 *
 * And the one question that decides whether (a) means anything: does the
 * speculative search actually HONOUR the tentative pin it is named after?
 */

import type { JointPlan, PinEvent, SearchContext, UnitId } from '../../src/lobster/contracts';
import { LobsterKernel } from '../../src/lobster/kernel';
import { makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { makeSearchCore } from '../../src/lobster/search';
import { adviseFromReport } from '../../src/lobster/pins';
import { StepClock, boardCases, clearGeometryCache, probeUnits, round, tacticalCases } from './harness';

afterEach(() => clearGeometryCache());

interface SpecObservation {
  readonly slice: number;
  readonly pins: string;
  readonly speculativePin: { unitId: UnitId; to: number } | null;
  readonly planned: number | undefined;
  readonly honoured: boolean | null;
}

test('TENTATIVE PINS: are speculative contexts really constrained?', async () => {
  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 2: TENTATIVE PINS ===');
  for (const bc of [...boardCases(), ...tacticalCases()]) {
    const turn = 9;
    const units = probeUnits(bc.board, turn, bc.ourTeam, bc.ours);
    const target = [...units.values()].find(
      (u) => new Set(u.options.map((c) => c.to)).size >= 3
    );
    if (target === undefined) continue;
    const dests = [...new Set(target.options.map((c) => c.to))]
      .filter((d) => d !== target.at)
      .sort((x, y) => x - y);
    const hoverX = dests[0] as number;
    const hoverY = dests[dests.length - 1] as number;

    const clock = new StepClock(0.02);
    const sub = makeSubstrate({ board: bc.board, turn, asTeam: bc.ourTeam });
    const gen = new GrammarCandidateGenerator();
    const core = makeSearchCore();
    const observations: SpecObservation[] = [];
    let slice = 0;
    const emissions: JointPlan[] = [];

    const kernel = new LobsterKernel({
      sliceMs: 2,
      reserveMs: 1,
      minWriteIntervalMs: 0,
      speculativePeriod: 4,
    });

    const wrapped = {
      improve: (ctx: SearchContext) => {
        const out = core.improve(ctx);
        slice++;
        const spec = ctx.pins.find((p) => p.tentative) ?? null;
        observations.push({
          slice,
          pins: ctx.pins.map((p) => `${p.unitId}@${p.to}${p.tentative ? '?' : ''}`).join(','),
          speculativePin: spec === null ? null : { unitId: spec.unitId, to: spec.to },
          planned: out.plan.get(spec?.unitId ?? target.unitId)?.to,
          honoured: spec === null ? null : out.plan.get(spec.unitId)?.to === spec.to,
        });
        // Hover X after slice 2, hover Y after slice 6 — both mid-decision.
        if (slice === 2) {
          kernel.onPinEvent({
            kind: 'pin',
            pin: { unitId: target.unitId, to: hoverX, tentative: true },
          } as PinEvent);
        }
        if (slice === 6) {
          kernel.onPinEvent({
            kind: 'pin',
            pin: { unitId: target.unitId, to: hoverY, tentative: true },
          } as PinEvent);
        }
        return out;
      },
      conform: (ctx: SearchContext, incumbent: JointPlan) => core.conform(ctx, incumbent),
    };

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
        emissions.push(rec.plan);
      }
    } finally {
      sub.release();
    }

    const report = kernel.lastReport;
    if (report === null) continue;
    const specObs = observations.filter((o) => o.speculativePin !== null);
    const honoured = specObs.filter((o) => o.honoured === true).length;
    const specKeys = report.speculative.map((s) => s.key);
    const advice = adviseFromReport({
      report,
      tentative: [
        { unitId: target.unitId, to: hoverX, tentative: true },
        { unitId: target.unitId, to: hoverY, tentative: true },
      ],
      witnesses: [],
      threshold: 0,
    });
    // Leak check: did any EMITTED plan put the hovered unit on a hover square
    // that the committed context never chose?
    const emittedTos = new Set(emissions.map((p) => p.get(target.unitId)?.to));

    console.log(
      `${bc.name}: unit=${target.unitId} hoverX=${hoverX} hoverY=${hoverY} ` +
        `slices=${report.slices} speculativeSlices=${specObs.length} ` +
        `honouredTheTentativePin=${honoured}/${specObs.length}`
    );
    console.log(
      `    report.speculative=${JSON.stringify(
        report.speculative.map((s) => ({ key: s.key, lo: round(s.lo, 1), hi: round(s.hi, 1), cursor: s.cursor }))
      )}`
    );
    console.log(
      `    bothHoversPresent=${specKeys.some((k) => k.includes(`@${hoverX}?`)) && specKeys.some((k) => k.includes(`@${hoverY}?`))} ` +
        `advice=${JSON.stringify(advice.map((a) => ({ to: a.pin.to, costLo: round(a.costLo, 1), costHi: round(a.costHi, 1), conf: round(a.confidence, 2) })))}`
    );
    console.log(
      `    emittedDestinationsForUnit=${JSON.stringify([...emittedTos])} ` +
        `speculativePlannedDestinations=${JSON.stringify([...new Set(specObs.map((o) => o.planned))])}`
    );
    console.log(
      `    firstFourSpeculativeObservations=${JSON.stringify(specObs.slice(0, 4))}`
    );
  }
  /* eslint-enable no-console */
  expect(true).toBe(true);
}, 900000);
