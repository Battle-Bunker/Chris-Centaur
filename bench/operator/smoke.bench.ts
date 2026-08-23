/** Plumbing check: the rig drives the real trio and reports. */
import { boardCases, clearGeometryCache, drive, probeUnits, round } from './harness';

afterEach(() => clearGeometryCache());

test('rig smoke', async () => {
  for (const bc of boardCases()) {
    const units = probeUnits(bc.board, 9, bc.ourTeam, bc.ours);
    const out = await drive({
      board: bc.board,
      turn: 9,
      ourTeam: bc.ourTeam,
      budgetMs: 200,
    });
    const last = out.emissions[out.emissions.length - 1];
    const refusals = Object.entries(out.report.refusals).filter(([, n]) => n > 0);
    // eslint-disable-next-line no-console
    console.log(
      `${bc.name}: units=${[...units.values()].map((u) => `${u.wireId}#${u.unitId}(${u.options.length})`).join(' ')} ` +
        `slices=${out.report.slices} emits=${out.report.emits} ` +
        `bounds=${out.emissions.map((e) => `[${round(e.lo, 1)},${round(e.hi, 1)}]`).join(' ')} ` +
        `refusals=${JSON.stringify(Object.fromEntries(refusals))} ` +
        `posture=${last?.posture} wall=${out.wallMs}ms`
    );
    expect(out.report.stagedNothing).toBe(false);
  }
}, 600000);
