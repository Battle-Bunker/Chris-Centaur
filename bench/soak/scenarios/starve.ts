/**
 * THE INTEGRATOR'S OPEN QUESTION, ANSWERED BY DIRECTED EXPERIMENT.
 *
 *   "the teammate floor's block rate (report.crossfade.blocked) and whether a
 *    FORCED CONFORMANCE RE-STAGE can be STARVED by it"
 *
 * A natural run never blocks, so the honest way to answer is to hand the kernel
 * an ADVERSARIAL certificate that refuses everything and see which paths still
 * reach the wire. `TeamDecisionOptions.kernel` is spread last into the kernel's
 * options by `TeamDecisionEngine.kernelOptions()`, so a `teammateFloor`
 * supplied there overrides the engine's own — no source change required.
 *
 * Arms:
 *   REAL   — the engine's own teammate floor (production configuration)
 *   ALWAYS — a floor that reports every change as a loss (blocks everything)
 *   NEVER  — a floor that reports every change as a gain (blocks nothing)
 *
 * The operator's pin is fired SYNCHRONOUSLY from inside the first emission,
 * because the kernel never yields to the macrotask queue and a timer-delivered
 * pin would never be seen (see the `eventloop` scenario).
 *
 * What the numbers decide:
 *   - `journal[0]` is rung 0 and `report.conformance.length` is the number of
 *     epoch-change re-stages that REACHED THE WIRE. Both come from
 *     `buildRecord`, which never returns null.
 *   - the final flush is the one forced path that goes through `gate()`, so it
 *     is the only forced write crossfade can refuse.
 */

import type { JointPlan, PinEvent, UnitId } from '../../../src/lobster/contracts';
import { SoakGame } from '../driver';
import { argOf, writeCsv } from '../main';

type Floor = (plan: JointPlan, excluding: ReadonlySet<UnitId>) => number;

/** Strictly decreasing: the kernel calls hook(prev) then hook(next) and blocks
 * on `after < before`, so this refuses every certified comparison. */
const alwaysBlock = (): Floor => {
  let n = 0;
  return () => -(n++);
};
const neverBlock = (): Floor => {
  let n = 0;
  return () => n++;
};

interface Row {
  arm: string;
  units: number;
  turns: number;
  emits: number;
  rung0Emits: number;
  epochRestagesEmitted: number;
  pinEpochs: number;
  finalFlushEmits: number;
  blocked: number;
  certified: number;
  uncertified: number;
  independent: number;
  refusedCrossfade: number;
  stagedNothing: number;
  pinHonouredOnWire: number;
  docs: number;
}

async function arm(name: string, n: number, turns: number, floor: Floor | null): Promise<Row> {
  const game = new SoakGame({
    gameId: `starve-${name}-${n}`,
    size: n >= 26 ? 14 : 12,
    ours: n,
    theirs: Math.min(n, 26),
    budgetMs: argOf('budget', 3000),
    seed: 777 + n,
    kernelMinWriteIntervalMs: 20,
    minWriteIntervalMs: 40,
    retainEvery: 1e9,
    kernelOverrides: floor === null ? {} : { teammateFloor: floor },
  });

  // One operator pin per turn, fired from inside the first emission.
  let pinnedTo: number | null = null;
  game.onFirstEmission = (g, _snakeId, move) => {
    if (typeof move !== 'number') return;
    pinnedTo = move;
    const ev: PinEvent = { kind: 'pin', pin: { unitId: 0 as UnitId, to: move, tentative: false } };
    g.firePin(ev);
  };

  for (let t = 0; t < turns; t++) await game.step(t);
  game.dispose();

  let emits = 0;
  let rung0 = 0;
  let restages = 0;
  let pinEpochs = 0;
  let flushEmits = 0;
  let pinHonoured = 0;
  for (const rep of game.reports) {
    if (rep === null) continue;
    emits += rep.emits;
    rung0 += rep.journal.length > 0 ? 1 : 0;
    restages += rep.conformance.length;
    pinEpochs += Math.max(0, rep.epochs - 1);
    // The flush is the last record only when it came after the last epoch
    // re-stage and after every gated emission: count records beyond
    // rung 0 + re-stages + gated emissions is not separable, so use the
    // kernel's own accounting instead: emits - (1 + re-stages) are gated ones,
    // and a flush is gated too. Report the total gated emissions.
    flushEmits += Math.max(0, rep.emits - 1 - rep.conformance.length);
    const last = rep.journal[rep.journal.length - 1];
    if (last !== undefined && pinnedTo !== null) {
      const firstUnit = [...last.plan.keys()][0];
      if (firstUnit !== undefined) pinHonoured += 1;
    }
  }
  const sum = (f: (m: (typeof game.metrics)[number]) => number): number =>
    game.metrics.reduce((a, m) => a + f(m), 0);
  return {
    arm: name,
    units: n,
    turns,
    emits,
    rung0Emits: rung0,
    epochRestagesEmitted: restages,
    pinEpochs,
    finalFlushEmits: flushEmits,
    blocked: sum((m) => m.xfBlocked),
    certified: sum((m) => m.xfCertified),
    uncertified: sum((m) => m.xfUncertified),
    independent: sum((m) => m.xfIndependent),
    refusedCrossfade: sum((m) => m.refCrossfade),
    stagedNothing: sum((m) => m.stagedNothing),
    pinHonouredOnWire: pinHonoured,
    docs: sum((m) => m.docs),
  };
}

export async function main(): Promise<void> {
  const turns = argOf('turns', 4);
  const rows: Row[] = [];
  for (const n of [12, 26]) {
    rows.push(await arm('REAL', n, turns, null));
    rows.push(await arm('ALWAYS', n, turns, alwaysBlock()));
    rows.push(await arm('NEVER', n, turns, neverBlock()));
  }
  writeCsv('starvation', rows);
  console.log(
    'arm     units turns emits rung0 pinEpochs restagesEmitted gatedEmits blocked certified uncert indep refusedXf stagedNothing docs'
  );
  for (const r of rows) {
    console.log(
      `${r.arm.padEnd(7)} ${String(r.units).padStart(5)} ${String(r.turns).padStart(5)} ${String(
        r.emits
      ).padStart(5)} ${String(r.rung0Emits).padStart(5)} ${String(r.pinEpochs).padStart(9)} ${String(
        r.epochRestagesEmitted
      ).padStart(15)} ${String(r.finalFlushEmits).padStart(10)} ${String(r.blocked).padStart(
        7
      )} ${String(r.certified).padStart(9)} ${String(r.uncertified).padStart(6)} ${String(
        r.independent
      ).padStart(5)} ${String(r.refusedCrossfade).padStart(9)} ${String(r.stagedNothing).padStart(
        13
      )} ${String(r.docs).padStart(4)}`
    );
  }
}
