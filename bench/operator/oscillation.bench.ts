/**
 * SCENARIO 1 — OSCILLATION.
 *
 * pin A → unpin → pin B → unpin → pin A, at three cadences (every slice, every
 * 5, every 20), on 7×7 … 11×11 boards with snakes, pieces and held enemies.
 *
 * Measured per event:
 *   - conformance latency, in refinement slices (the load-bearing number: it
 *     must be 0) and in kernel-clock ms;
 *   - the operator-observed latency: emissions between the fire and the first
 *     emission that honours the new constraint;
 *   - the pin-context cache: hits / misses / resumes / creates / evictions,
 *     and whether the return to A resumed rather than recreated;
 *   - the seed handed to `conform` on each epoch (the incumbent the kernel
 *     believes it is repairing);
 *   - end-of-decision quality (final emitted `lo`) against a no-oscillation
 *     control on the SAME total budget and the SAME final pin.
 */

import type { Pin, PinEvent, UnitId } from '../../src/lobster/contracts';
import {
  boardCases,
  clearGeometryCache,
  drive,
  mean,
  probeUnits,
  quantile,
  round,
  tacticalCases,
  type BoardCase,
  type ScriptedEvent,
} from './harness';

afterEach(() => clearGeometryCache());

const BUDGET_MS = 400;
const SLICE_MS = 2;
const CADENCES = [1, 5, 20];

interface OscRow {
  board: string;
  cadence: number;
  events: number;
  epochs: number;
  conformanceSamples: number;
  slicesBefore: number[];
  latencyMs: number[];
  conformCalls: number[];
  resumes: boolean[];
  emissionLag: number[];
  cache: Record<string, number>;
  contexts: string[];
  finalLo: number;
  controlLo: number;
  slices: number;
  controlSlices: number;
  emits: number;
  refusals: Record<string, number>;
  coldConformSeeds: number;
  epochConforms: number;
  basisFloors: Array<{ epoch: number; floorLo: number; emits: number }>;
}

/** Two distinct legal destinations for one of our units, plus the unit id. */
function twoPins(bc: BoardCase, turn: number): { unitId: UnitId; a: number; b: number } | null {
  const units = probeUnits(bc.board, turn, bc.ourTeam, bc.ours);
  for (const wireId of bc.ours) {
    const u = units.get(wireId);
    if (u === undefined) continue;
    const dests = [...new Set(u.options.map((c) => c.to))].filter((d) => d !== u.at).sort((x, y) => x - y);
    if (dests.length >= 2) {
      return { unitId: u.unitId, a: dests[0] as number, b: dests[dests.length - 1] as number };
    }
  }
  return null;
}

function cycle(unitId: UnitId, a: number, b: number): PinEvent[] {
  const pin = (to: number): PinEvent => ({
    kind: 'pin',
    pin: { unitId, to, tentative: false } as Pin,
  });
  const unpin: PinEvent = { kind: 'unpin', unitId };
  // pin A → unpin → pin B → unpin → back to A
  return [pin(a), unpin, pin(b), unpin, pin(a)];
}

async function measure(bc: BoardCase, cadence: number): Promise<OscRow | null> {
  const turn = 9;
  const pins = twoPins(bc, turn);
  if (pins === null) return null;

  // How many slices does a quiet run of this budget get? Script the whole
  // oscillation into the first 60% of them so the final basis has room.
  const quiet = await drive({
    board: bc.board,
    turn,
    ourTeam: bc.ourTeam,
    budgetMs: BUDGET_MS,
    kernel: { sliceMs: SLICE_MS, reserveMs: 1, minWriteIntervalMs: 0 },
  });
  clearGeometryCache();
  const room = Math.floor(quiet.report.slices * 0.6);
  const evs = cycle(pins.unitId, pins.a, pins.b);
  const script: ScriptedEvent[] = [];
  let i = 0;
  while (true) {
    const at = (i + 1) * cadence;
    if (at > room) break;
    const ev = evs[i % evs.length] as PinEvent;
    script.push({ atSlice: at, event: ev, label: labelOf(ev) });
    i++;
    if (i >= 40) break;
  }
  // End on "pin A" so the control is comparable.
  while (script.length > 0 && labelOf((script[script.length - 1] as ScriptedEvent).event) !== `pin@${pins.a}`) {
    script.pop();
  }
  if (script.length === 0) return null;

  const osc = await drive({
    board: bc.board,
    turn,
    ourTeam: bc.ourTeam,
    budgetMs: BUDGET_MS,
    kernel: { sliceMs: SLICE_MS, reserveMs: 1, minWriteIntervalMs: 0 },
    script,
  });
  clearGeometryCache();

  // CONTROL: the same final constraint, arriving once, same total budget.
  const control = await drive({
    board: bc.board,
    turn,
    ourTeam: bc.ourTeam,
    budgetMs: BUDGET_MS,
    kernel: { sliceMs: SLICE_MS, reserveMs: 1, minWriteIntervalMs: 0 },
    script: [
      {
        atSlice: 1,
        event: { kind: 'pin', pin: { unitId: pins.unitId, to: pins.a, tentative: false } },
        label: `pin@${pins.a}`,
      },
    ],
  });
  clearGeometryCache();

  // Operator-observed lag: emissions between the fire and the first emission
  // that honours the constraint the event established.
  const emissionLag: number[] = [];
  for (let k = 0; k < osc.fired.length; k++) {
    const f = osc.fired[k] as (typeof osc.fired)[number];
    const ev = script[k]?.event as PinEvent;
    const wanted = ev.kind === 'pin' ? ev.pin.to : null;
    let lag = -1;
    for (let e = f.emissionsAtFire; e < osc.emissions.length; e++) {
      const rec = osc.emissions[e];
      if (rec === undefined) break;
      const to = rec.plan.get(pins.unitId)?.to;
      if (wanted === null || to === wanted) {
        lag = e - f.emissionsAtFire;
        break;
      }
    }
    emissionLag.push(lag);
  }

  const conformance = osc.report.conformance;
  // conform seeds: index 0 is rung 0; the rest are the epoch re-stages.
  const epochSeeds = osc.conformSeeds.slice(1);
  return {
    board: bc.name,
    cadence,
    events: script.length,
    epochs: osc.report.epochs,
    conformanceSamples: conformance.length,
    slicesBefore: conformance.map((c) => c.slicesBefore),
    latencyMs: conformance.map((c) => round(c.latencyMs, 4)),
    conformCalls: conformance.map((c) => c.conformCalls),
    resumes: conformance.map((c) => c.resumedFromCache),
    emissionLag,
    cache: { ...osc.report.cache },
    contexts: osc.report.contexts.map((c) => `${c.key}#c${c.cursor}@e${c.epochBaseline}`),
    finalLo: osc.emissions[osc.emissions.length - 1]?.lo ?? NaN,
    controlLo: control.emissions[control.emissions.length - 1]?.lo ?? NaN,
    slices: osc.report.slices,
    controlSlices: control.report.slices,
    emits: osc.report.emits,
    refusals: Object.fromEntries(Object.entries(osc.report.refusals).filter(([, n]) => n > 0)),
    coldConformSeeds: epochSeeds.filter((s) => s.size === 0).length,
    epochConforms: epochSeeds.length,
    basisFloors: osc.report.basisHistory.map((b) => ({
      epoch: b.epoch,
      floorLo: b.floorLo,
      emits: b.emits,
    })),
  };
}

function labelOf(ev: PinEvent): string {
  return ev.kind === 'pin' ? `pin@${ev.pin.to}` : ev.kind;
}

test('OSCILLATION grid', async () => {
  const rows: OscRow[] = [];
  for (const bc of [...boardCases(), ...tacticalCases()]) {
    for (const cadence of CADENCES) {
      const row = await measure(bc, cadence);
      if (row !== null) rows.push(row);
    }
  }

  /* eslint-disable no-console */
  console.log('\n=== SCENARIO 1: OSCILLATION ===');
  console.log(
    'board                cad  ev  epochs  slicesBefore(max)  latencyMs(med/max)  resumes  emissionLag(max)  cache h/m/r/c/e   finalLo  ctrlLo  slices  emits'
  );
  for (const r of rows) {
    const c = r.cache;
    console.log(
      `${r.board.padEnd(20)} ${String(r.cadence).padStart(3)} ${String(r.events).padStart(3)} ` +
        `${String(r.epochs).padStart(7)} ${String(Math.max(0, ...r.slicesBefore)).padStart(18)} ` +
        `${`${round(quantile(r.latencyMs, 0.5), 4)}/${round(Math.max(...r.latencyMs), 4)}`.padStart(19)} ` +
        `${String(r.resumes.filter(Boolean).length).padStart(8)} ` +
        `${String(Math.max(...r.emissionLag)).padStart(17)} ` +
        `${`${c.hits}/${c.misses}/${c.resumes}/${c.creates}/${c.evictions}`.padStart(16)} ` +
        `${String(round(r.finalLo, 1)).padStart(8)} ${String(round(r.controlLo, 1)).padStart(7)} ` +
        `${String(r.slices).padStart(7)} ${String(r.emits).padStart(6)}`
    );
  }

  console.log('\n--- per-row detail ---');
  for (const r of rows) {
    console.log(
      `${r.board} cad=${r.cadence}: events=${r.events} conformanceSamples=${r.conformanceSamples} ` +
        `slicesBefore=${JSON.stringify(r.slicesBefore)} conformCalls=${JSON.stringify(r.conformCalls)} ` +
        `resumed=${JSON.stringify(r.resumes)} emissionLag=${JSON.stringify(r.emissionLag)}`
    );
    console.log(
      `    contexts=${JSON.stringify(r.contexts)} refusals=${JSON.stringify(r.refusals)} ` +
        `coldConformSeeds=${r.coldConformSeeds}/${r.epochConforms} ` +
        `basisFloors=${JSON.stringify(r.basisFloors.map((b) => [b.epoch, b.floorLo === -Infinity ? '-inf' : round(b.floorLo, 1), b.emits]))}`
    );
  }

  const allSlicesBefore = rows.flatMap((r) => r.slicesBefore);
  const cost = rows.map((r) => r.controlLo - r.finalLo);
  console.log('\n--- aggregate ---');
  console.log(
    `conformance samples=${allSlicesBefore.length} slicesBefore: max=${Math.max(...allSlicesBefore)} ` +
      `mean=${round(mean(allSlicesBefore), 4)} nonzero=${allSlicesBefore.filter((x) => x !== 0).length}`
  );
  console.log(
    `oscillation cost in final lo (control − oscillated): ` +
      `${cost.map((x) => round(x, 1)).join(' ')} | worst=${round(Math.max(...cost), 1)} mean=${round(mean(cost), 3)}`
  );
  console.log(
    `cold conform seeds (epoch re-stage handed an EMPTY incumbent): ` +
      `${rows.reduce((n, r) => n + r.coldConformSeeds, 0)}/${rows.reduce((n, r) => n + r.epochConforms, 0)}`
  );
  /* eslint-enable no-console */

  expect(rows.length).toBeGreaterThan(0);
}, 900000);
