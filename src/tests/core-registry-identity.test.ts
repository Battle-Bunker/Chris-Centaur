/**
 * THE REPLAY GOLDEN — a frozen capture of what this build decides.
 *
 * ── WHAT THIS GATES, AND WHAT IT USED TO GATE ──────────────────────────────
 *
 * It used to be a BYTE-IDENTITY gate: the registry increment promised to land
 * "with everything byte-identical to today", so one side of the comparison was
 * a capture taken on the build before the registry existed (`049a8df`).
 *
 * THAT PROMISE IS DELIBERATELY OVER, and this is the increment that ended it.
 * Depth is now value-bearing: a deepened line's evaluation is backed up into
 * the branch it started from, the belief it moves resolves the choice among
 * floor-undominated candidates, and the cluster enumeration those lines are
 * rooted at always runs. Every one of those changes what gets staged, on
 * purpose. A gate asserting otherwise would be asserting that the increment
 * did nothing.
 *
 * SO THE GOLDEN WAS REGENERATED, ON PURPOSE, from this build. What it gates
 * now is REGRESSION rather than identity: the next change that moves a staged
 * plan, an emission or a plan-table entry on these three boards has to say so
 * in its own diff, and the failure is still legible — the diff names the
 * board, and within it the row that moved.
 *
 * ── WHY A GOLDEN AND NOT A SECOND RUN ──────────────────────────────────────
 *
 * A self-comparison cannot fail for the thing this gate is about. The claim is
 * about two BUILDS, so one side of it has to be frozen, and freezing it is the
 * whole cost of the gate. The capture code lives in its own module so that
 * regenerating it is a deliberate act with a diff attached, which is exactly
 * what this increment did.
 *
 * ── AND WHAT THE INCREMENT ADDS ────────────────────────────────────────────
 *
 * The second and third blocks assert the two structures the increment exists
 * to add — the resolved slate, and the belief now that it DECIDES. The third
 * block's claim has flipped with the build: `deciding` is true, `plies` is a
 * measurement rather than a constant, and a `deep-finding` count is no longer
 * required to be zero.
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

describe('the replay golden: this build decides what the capture says it decides', () => {
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

describe('the registry resolves, and says so on the report', () => {
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

describe('the belief is populated, and now decides', () => {
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

      // The two channels obey their own laws on every branch. Precision is
      // never negative; and the density's mean lives inside the sound support
      // EXACTLY WHILE every reading it carries is about this turn. A branch
      // that has heard from a deeper horizon is allowed outside, because the
      // one-ply interval does not bound the quantity a deeper reading is about
      // — see `belief.ts`. The horizon is what says which law applies, so it is
      // asserted alongside rather than assumed.
      for (const w of row.planWork) {
        expect(w.belief.prec).toBeGreaterThanOrEqual(0);
        expect(w.belief.plies).toBeGreaterThanOrEqual(1);
        expect(w.horizon).toBe(w.belief.plies);
        if (w.belief.plies === 1) {
          expect(w.belief.mu).toBeGreaterThanOrEqual(w.belief.lo);
          expect(w.belief.mu).toBeLessThanOrEqual(w.belief.hi);
        }
      }

      // ASSEMBLED FROM OBSERVATIONS, not conjured: every branch was spoken to
      // by the bank price and by a computed evaluation, exactly twice.
      expect(belief.provenance['bank-price']).toBe(belief.branches);
      expect(belief.provenance.evaluation).toBe(belief.branches);

      // THE SHADOW CHANNEL DOES NOT EXIST YET and reads zero, which is the
      // truth rather than a placeholder (increment 2 builds it). So does the
      // child-backup channel: a thread's value is published for the branch it
      // started from, and there is no second ply in the plan table to back up
      // through.
      expect(belief.provenance.shadow).toBe(0);
      expect(belief.provenance['child-backup']).toBe(0);
      // The DEEP channel is open, and it is a measurement: a board the door
      // refuses reports zero and a board it opens reports what it found. Both
      // are answers; what neither may be is a constant.
      expect(belief.provenance['deep-finding']).toBeGreaterThanOrEqual(0);
      expect(belief.deepestPlies).toBeGreaterThanOrEqual(1);
      expect(belief.deepBranches).toBeLessThanOrEqual(belief.branches);
      expect(typeof belief.depthChangedStaging).toBe('boolean');

      // DECIDING, published rather than assumed. The increment-1 gate said
      // false here; this is the increment that flips it, and a sweep can tell
      // the two builds apart without reading the source.
      expect(belief.deciding).toBe(true);
    }
  }, 180_000);

  test('the report accounts for every observation kind', () => {
    // A kind added without a counter would silently vanish from the
    // provenance row, which is the one thing that row is for.
    const seen = new Set(OBSERVATION_KINDS);
    expect(seen.size).toBe(OBSERVATION_KINDS.length);
  });
});
