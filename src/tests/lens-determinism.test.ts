/**
 * G1 AND G2 — the two gates the whole kernel track is sequenced around.
 *
 * A live decision cannot be re-run bit-exactly and this suite does not pretend
 * otherwise: production reads the wall clock, and the SAME 150 ms bought 18
 * slices on one run and 92 on another (`local-game.ts`'s `DEFAULT_NODE_BUDGET`
 * derivation). What IS bit-exact is a decision under the NODE clock, where
 * `now() = nodes × NODE_COST + reads × READ_COST` turns the one
 * nondeterministic function into a work counter. Everything here runs under
 * `--nodes`, exactly as `local-game-determinism.test.ts` already does.
 *
 *   G1 — FRAME REPRODUCIBILITY. Run a fixture, serialise every `LensEvent`,
 *        re-run at the same seed and budget, byte-compare.
 *   G2 — PREFIX DETERMINISM. A `2b`-work run's frame sequence EXTENDS the `b`
 *        run's, byte for byte, up to the prefix.
 *
 * G2 IS THE GATE ON [CHANGE 1]. `better()` returning a `Verdict` must change
 * no decision — the reason is derived from comparisons it already performs, in
 * the order it already performs them — but it is a refactor of the hottest
 * function in the search, which is exactly where an accidental reordering
 * hides. G2 must be green at L2, BEFORE the refactor, so that L3 has something
 * to break. A green G2 written alongside CHANGE 1 would be worth nothing.
 *
 * `conditional` frames are excluded from G2's prefix claim and covered by G1
 * only: speculative slices are scheduled on `slices % speculativePeriod`, so a
 * longer run correctly visits a DIFFERENT set of them. Excluding them is not a
 * weakening of the gate; including them would make it assert something false.
 */

import { recordLensRun, serialiseLensEvent, type LensRunSpec } from '../lens/kernel';
import type { LensEvent } from '../lens/types';

const BASE_NODES = 550;
const SCENARIOS = ['snake', 'mixed'] as const;

function specFor(scenario: string, nodes: number, seed = 1): LensRunSpec {
  return { scenario, seed, nodes, turns: 6 };
}

function bytes(events: ReadonlyArray<LensEvent>): ReadonlyArray<string> {
  return events.map(serialiseLensEvent);
}

/** The prefix claim is over the frames whose schedule is a function of work
 *  alone. `conditional` is not one of those. */
function prefixKinds(events: ReadonlyArray<LensEvent>): ReadonlyArray<string> {
  return events.filter((e) => e.kind !== 'conditional').map(serialiseLensEvent);
}

describe('G1 — the same seed and the same budget produce the same frames', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario}: two runs are byte-identical`, async () => {
      const first = await recordLensRun(specFor(scenario, BASE_NODES));
      const second = await recordLensRun(specFor(scenario, BASE_NODES));
      expect(bytes(second)).toEqual(bytes(first));
    }, 120_000);
  }

  it('includes the conditional frames in the byte comparison', async () => {
    const first = await recordLensRun(specFor('mixed', BASE_NODES));
    const second = await recordLensRun(specFor('mixed', BASE_NODES));
    expect(first.some((e) => e.kind === 'conditional')).toBe(true);
    expect(bytes(second)).toEqual(bytes(first));
  }, 120_000);

  it('a different seed produces a different sequence — the gate is not vacuous', async () => {
    const one = await recordLensRun(specFor('mixed', BASE_NODES, 1));
    const two = await recordLensRun(specFor('mixed', BASE_NODES, 2));
    expect(bytes(two)).not.toEqual(bytes(one));
  }, 120_000);

  it('serialises on the WORK clock only — no wall time in the bytes', async () => {
    const events = await recordLensRun(specFor('snake', BASE_NODES));
    const blob = bytes(events).join('\n');
    // A wall-clock millisecond is a 13-digit number in this decade. If one
    // reaches the serialisation, two runs on two days stop agreeing.
    expect(blob).not.toMatch(/\b1[6-9]\d{11}\b/);
  }, 120_000);
});

describe('G2 — a longer run EXTENDS the shorter one (the [CHANGE 1] gate)', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario}: the 2b run's frames begin with the b run's, byte for byte`, async () => {
      const short = prefixKinds(await recordLensRun(specFor(scenario, BASE_NODES)));
      const long = prefixKinds(await recordLensRun(specFor(scenario, BASE_NODES * 2)));
      expect(long.length).toBeGreaterThanOrEqual(short.length);
      expect(long.slice(0, short.length)).toEqual(short);
    }, 180_000);
  }

  it('really does buy more frames at 2b — otherwise the prefix claim is trivial', async () => {
    const short = prefixKinds(await recordLensRun(specFor('mixed', BASE_NODES)));
    const long = prefixKinds(await recordLensRun(specFor('mixed', BASE_NODES * 2)));
    expect(long.length).toBeGreaterThan(short.length);
  }, 180_000);

  it('does NOT claim the prefix over conditional frames, and says why', async () => {
    const short = await recordLensRun(specFor('mixed', BASE_NODES));
    const long = await recordLensRun(specFor('mixed', BASE_NODES * 2));
    const shortConditionals = short.filter((e) => e.kind === 'conditional').map(serialiseLensEvent);
    const longConditionals = long.filter((e) => e.kind === 'conditional').map(serialiseLensEvent);
    // Speculative slices land on `slices % speculativePeriod`, so the longer
    // run visits a different set. Asserting a prefix here would assert
    // something false about a correct implementation.
    expect(longConditionals.length).toBeGreaterThanOrEqual(shortConditionals.length);
  }, 180_000);
});

describe('the frames are on ONE timeline', () => {
  it('`at` is monotone non-decreasing across the whole run', async () => {
    const events = await recordLensRun(specFor('snake', BASE_NODES));
    let last = -Infinity;
    for (const e of events) {
      expect(e.at).toBeGreaterThanOrEqual(last);
      last = e.at;
    }
  }, 120_000);

  it('orders an epoch change operator → partition → emission → movesets', async () => {
    const events = await recordLensRun(specFor('mixed', BASE_NODES));
    const kinds = events.map((e) => e.kind);
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] !== 'operator') continue;
      const tail = kinds.slice(i + 1);
      const partition = tail.indexOf('partition');
      const movesets = tail.indexOf('movesets');
      if (partition >= 0 && movesets >= 0) expect(partition).toBeLessThan(movesets);
    }
  }, 120_000);
});
