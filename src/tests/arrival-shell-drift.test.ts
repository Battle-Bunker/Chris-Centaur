/**
 * The arrival drift differential, in the ordinary suite.
 *
 * The SAME block also runs inside partial-engine-vendor-sync.test.ts, so a
 * re-vendored engine cannot land without it. Here it runs on every `npm test`,
 * so a change on the lobster side of the copy fails at the point it is made.
 *
 * This file additionally pins the WIRING, because the wiring is the whole
 * mechanism and a helper nobody calls is worse than no helper at all.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describeArrivalShellDifferential } from './arrival-shell-differential';

describeArrivalShellDifferential('standalone');

describe('the drift differential is wired into the vendor gate', () => {
  const gate = readFileSync(
    join(__dirname, 'partial-engine-vendor-sync.test.ts'),
    'utf8'
  );

  test('the vendor drift gate runs this differential', () => {
    // If somebody deletes the call, the differential stops being a gate and
    // becomes a unit test — which is exactly the failure this pins.
    expect(gate).toContain("from './arrival-shell-differential'");
    expect(gate).toContain('describeArrivalShellDifferential(');
  });

  test('the gate says why, so the next reader does not unwire it as noise', () => {
    expect(gate).toContain('shells.ts');
  });
});
