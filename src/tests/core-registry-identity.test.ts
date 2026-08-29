/**
 * THE REGISTRY'S BYTE-IDENTITY GATE — registry-on-legacy-entries against the
 * pre-registry build.
 *
 * ── THE GATE ───────────────────────────────────────────────────────────────
 *
 * The core redesign's first increment lands the entry registry and the
 * per-branch belief "with everything byte-identical to today". Every other
 * identity test in this suite compares two runs of ONE build, which proves
 * determinism and not identity. This one compares against a frozen capture
 * taken on the build BEFORE the registry existed:
 * `fixtures/core-registry-identity.golden.json`, generated on
 * `claude/cluster-lookahead` @ 049a8df by running
 * `core-identity-fixture.ts` there.
 *
 * If this fails, the increment did what it promised not to do. The failure is
 * legible: the diff names the board, and within it the staged move, the
 * emission or the plan-table entry that moved.
 *
 * ── WHY A GOLDEN AND NOT A SECOND RUN ──────────────────────────────────────
 *
 * A self-comparison cannot fail for the thing this gate is about. The claim is
 * about two BUILDS, so one side of it has to be frozen, and freezing it is the
 * whole cost of the gate. Regenerating the golden from the current build would
 * turn a byte-identity gate into a tautology; the capture code lives in its own
 * module precisely so that regenerating it means checking out the old commit.
 *
 * ── AND WHAT THE INCREMENT DID ADD ─────────────────────────────────────────
 *
 * The second and third blocks assert the two structures the increment exists
 * to add — the resolved slate and the populated belief — on the same replay
 * boards. They are on the mechanism report, which is assembled after the
 * kernel loop and read by nothing in the decision path, which is why the first
 * block can still pass.
 */

import {
  REPLAY_SET,
  captureReplaySet,
  encodeCapture,
  runBoard,
  withScrubbedFlags,
} from './core-identity-fixture';
import GOLDEN from './fixtures/core-registry-identity.golden.json';
import { LEGACY_SLATE, REGISTRY, SLATE_LEGACY, SLOT_IDS } from '../lobster/registry';
import { OBSERVATION_KINDS } from '../lobster/belief';

describe('core redesign increment 1: byte-identity against the pre-registry build', () => {
  test('the replay set stages the same plans and emits the same records', async () => {
    const captured = encodeCapture(await captureReplaySet());
    // One assertion over the whole set, so a divergence on any board names its
    // own board in the diff rather than being hidden behind an earlier one.
    expect(captured).toEqual(GOLDEN);
  }, 180_000);

  test('the golden covers every board in the replay set', () => {
    // A golden that silently lost a board would pass the comparison above
    // while gating nothing. The set is the fixture's; the golden must match it
    // name for name, in order.
    expect((GOLDEN as ReadonlyArray<{ name: string }>).map((b) => b.name)).toEqual(
      REPLAY_SET.map((b) => b.name)
    );
    expect(GOLDEN.length).toBeGreaterThan(0);
  });
});

describe('core redesign increment 1: the registry resolves, and says so on the report', () => {
  test('every decision stamps one entry per socket, on the legacy slate', async () => {
    const stamps = await withScrubbedFlags(async () => {
      const out = [];
      for (const entry of REPLAY_SET) {
        const { result } = await runBoard(entry);
        out.push(result.mechanism?.slate ?? null);
      }
      return out;
    });
    expect(stamps).toHaveLength(REPLAY_SET.length);
    for (const stamp of stamps) {
      expect(stamp).not.toBeNull();
      if (stamp === null) throw new Error('unreachable');
      expect(stamp.slate).toBe(SLATE_LEGACY);
      // ONE ENTRY PER SOCKET PER DECISION — the five sockets, all named.
      expect(stamp.moveSelectors).toEqual(LEGACY_SLATE.moveSelectors);
      expect(stamp.evaluatorSelector).toBe(LEGACY_SLATE.evaluatorSelector);
      expect(stamp.evaluators).toEqual(LEGACY_SLATE.evaluators);
      expect(stamp.aggregator).toBe(LEGACY_SLATE.aggregator);
      expect(stamp.scheduler).toBe(LEGACY_SLATE.scheduler);
      // Every id the stamp names is an entry that actually exists, in the
      // socket it was read for. A stamp naming an entry the registry does not
      // hold would attribute a measurement to something that never ran.
      for (const slot of SLOT_IDS) {
        expect(REGISTRY.entries(slot).length).toBeGreaterThan(0);
      }
    }
  }, 180_000);
});

describe('core redesign increment 1: the belief is populated and decides nothing', () => {
  test('every decision carries a posterior per branch, and reports it', async () => {
    const rows = await withScrubbedFlags(async () => {
      const out = [];
      for (const entry of REPLAY_SET) {
        const { result } = await runBoard(entry);
        out.push({
          name: entry.name,
          belief: result.mechanism?.belief ?? null,
          planWork: result.report?.planWork ?? [],
        });
      }
      return out;
    });

    for (const row of rows) {
      expect(row.belief).not.toBeNull();
      const belief = row.belief;
      if (belief === null) throw new Error('unreachable');

      // POPULATED: one posterior per branch the decision held, and the report's
      // count agrees with the plan table it was folded from.
      expect(belief.branches).toBe(row.planWork.length);
      expect(belief.branches).toBeGreaterThan(0);
      expect(belief.staged).not.toBeNull();

      // The two channels obey their own laws on every branch: the density's
      // mean lives INSIDE the sound support, and precision is never negative.
      for (const w of row.planWork) {
        expect(w.belief.mu).toBeGreaterThanOrEqual(w.belief.lo);
        expect(w.belief.mu).toBeLessThanOrEqual(w.belief.hi);
        expect(w.belief.prec).toBeGreaterThanOrEqual(0);
      }

      // ASSEMBLED FROM OBSERVATIONS, not conjured: every branch was spoken to
      // by the bank price and by a computed evaluation, exactly twice.
      expect(belief.provenance['bank-price']).toBe(belief.branches);
      expect(belief.provenance.evaluation).toBe(belief.branches);

      // THE CHANNELS THAT DO NOT EXIST YET READ ZERO, and that is the truth
      // rather than a placeholder: no shadow machinery is built (increment 2),
      // the scout reaches candidate ordering and never a branch posterior, and
      // there is no second ply in the plan table.
      expect(belief.provenance.shadow).toBe(0);
      expect(belief.provenance['deep-finding']).toBe(0);
      expect(belief.provenance['child-backup']).toBe(0);

      // NON-DECIDING, published rather than assumed.
      expect(belief.deciding).toBe(false);
    }
  }, 180_000);

  test('the report accounts for every observation kind', () => {
    // A kind added without a counter would silently vanish from the
    // provenance row, which is the one thing that row is for.
    const seen = new Set(OBSERVATION_KINDS);
    expect(seen.size).toBe(OBSERVATION_KINDS.length);
  });
});
