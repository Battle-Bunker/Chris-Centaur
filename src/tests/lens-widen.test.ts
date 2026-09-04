/**
 * THE REACTIVE CASE — a peer widens the cluster mid-inspection.
 *
 * The owner's scenario, written out: Ada is inspecting α = {C, Q, s1}; Ben
 * presses `U` on R, releasing his pin; R returns to bot control; the partition
 * recomputes and α widens to {C, Q, s1, R}. The conditional lists Ada is
 * reading are now over a smaller problem than the one the bot is solving.
 *
 * THE POLICY: additive uncertainty is STAGED; subtractive certainty is
 * APPLIED. A widen holds behind a banner with a deadline-scaled timer,
 * suspended while the drill panel is open and queued behind an in-flight lock;
 * a narrow applies at once with a footer note and no banner.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is auto-accept firing under a
 * reader's eyes — the specific failure the whole policy exists to prevent. And
 * on a widen the old table is NEVER BLANKED: an epoch change is the worst
 * possible moment to take the display away from an operator who is deciding
 * whether to lock. It is struck through, headed `stale @ seq n`, and
 * superseded when the new rank 1 lands.
 */

import {
  applyCursorEvent,
  initialCursor,
  reactiveNotice,
  renderFrame,
  resolveCursor,
  rowTrails,
} from '../lens/view';
import type { LensCursor, LensFrame, Moveset, UnitKey, WidenNotice } from '../lens/types';
import {
  anchorEvent,
  clusterView,
  lensAt,
  lensFrame,
  moveset,
  operatorActor,
  turnEvent,
  unitKeysOf,
  SINGLETONS,
} from './lens-fixtures';

const LensPanel = require('../web/lens-panel.js');

const [C, Q, S1] = unitKeysOf(SINGLETONS) as [UnitKey, UnitKey, UnitKey];
const R = 'A-R';

const TURN_EXPIRY = 1_700_000_000_500;

function rowsOver(units: ReadonlyArray<UnitKey>, keys: ReadonlyArray<string>): ReadonlyArray<Moveset> {
  return keys.map((key, i) =>
    moveset({ key, rank: i + 1, lo: 12.4 - i, est: 12.9 - i, hi: 15.3 - i, units, staged: i === 0 })
  );
}

/** α = {C, Q, s1}, three rows, Ada sitting on rank 2. */
function narrowFrame(over: Partial<LensFrame> = {}): LensFrame {
  return lensFrame({
    at: lensAt({ seq: 14, tWall: TURN_EXPIRY - 20_000 }),
    partition: [
      clusterView({
        id: 0,
        generation: 3,
        members: [C, Q, S1],
        boundedBy: [{ unit: R, to: 30, why: 'pin', by: 'ben' }],
      }),
    ],
    movesets: { [`0|${C}|10`]: rowsOver([C, Q, S1], ['a1', 'a2', 'a3']) },
    ...over,
  });
}

/** α′ = {C, Q, s1, R}, one generation on, after Ben's unpin. */
function widenedFrame(over: Partial<LensFrame> = {}): LensFrame {
  return lensFrame({
    at: lensAt({ seq: 15, tWall: TURN_EXPIRY - 20_000 }),
    partition: [clusterView({ id: 0, generation: 4, members: [C, Q, S1, R], lineage: [0] })],
    movesets: { [`0|${C}|10`]: rowsOver([C, Q, S1, R], ['b1', 'b2', 'b3']) },
    ...over,
  });
}

function inspecting(frame: LensFrame, moveset_ = 'a2'): LensCursor {
  return [
    { t: 'focus' as const, unit: C },
    { t: 'moveset' as const, key: moveset_ },
  ].reduce<LensCursor>((c, e) => applyCursorEvent(c, frame, e), initialCursor());
}

function widen(prev: LensFrame, next: LensFrame): WidenNotice {
  const notice = reactiveNotice(prev, next);
  expect(notice).not.toBeNull();
  return notice as WidenNotice;
}

describe('a widen is staged, never applied under the reader', () => {
  it('names the gained member and the operator who caused it', () => {
    const notice = widen(narrowFrame(), widenedFrame());
    expect(notice.gained).toEqual([R]);
    expect(notice.by).toBe('ben');
    expect(notice.fromGeneration).toBe(3);
    expect(notice.toGeneration).toBe(4);
  });

  /**
   * 10 §4 O6. `boundedBy[].by` is the PARTITION's field, and the kernel that
   * mints it does not know operators — every producer fills it null, so the
   * banner read `released A-R` with no author at all, on the owner's headline
   * reactive case. The FOLD knows, once a `pin` row exists to fold: the
   * author is on the unit's row in the frame the unit was still bound in.
   */
  it('takes the author off the fold when the partition carries none', () => {
    const anonymous = narrowFrame({
      partition: [
        clusterView({
          id: 0,
          generation: 3,
          members: [C, Q, S1],
          boundedBy: [{ unit: R, to: 30, why: 'pin', by: null }],
        }),
      ],
    });
    const prev = {
      ...anonymous,
      units: [
        ...anonymous.units,
        {
          unit: R as UnitKey,
          kind: 'snake',
          letter: 'R',
          weight: 3,
          health: 99,
          orientation: { dx: 0, dy: 1 },
          fixity: 'pinned' as const,
          owner: 'u9',
          operator: 'Ben',
        },
      ],
    };
    expect(widen(prev, widenedFrame()).by).toBe('Ben');
    // And with neither, it stays honestly anonymous rather than inventing one.
    expect(widen(anonymous, widenedFrame()).by).toBeNull();
  });

  /**
   * 10 §4 O6's last null, and the walk is what found it. The fold DELETES a
   * unit's fixity on `unpin`, and the partition recompute that produces the
   * widen lands seqs later — so by the time there is a widen to attribute, the
   * row the author stood on is already free and anonymous, and the banner read
   * `released red-A, red-C` with no operator even after the `pin` rows existed.
   * The turn's own rows still say who, and that is a read of a recorded event.
   */
  it('attributes a release the ROW has already forgotten, from the turn\'s rows', () => {
    const released = narrowFrame({
      // Ben's pin and his release are both in the turn's ledger; the partition
      // has not caught up, and red-R's row is free again and unowned.
      events: [
        anchorEvent(),
        turnEvent({
          kind: 'pin',
          seq: 12,
          unit: R as UnitKey,
          actor: operatorActor('Ben'),
          payload: { unit: R, to: 30, tentative: false },
        }),
        turnEvent({
          kind: 'unpin',
          seq: 13,
          unit: R as UnitKey,
          actor: operatorActor('Ben'),
          payload: { unit: R, to: -1, tentative: false },
        }),
      ],
      partition: [
        clusterView({
          id: 0,
          generation: 3,
          members: [C, Q, S1],
          boundedBy: [{ unit: R, to: 30, why: 'pin', by: null }],
        }),
      ],
    });
    expect(released.units.every((u) => u.owner === null)).toBe(true);
    expect(widen(released, widenedFrame()).by).toBe('Ben');
    expect(LensPanel.bannerHTML(widen(released, widenedFrame()), 4_000)).toContain('Ben released');
  });

  /** A look is not a determination, and does not get the credit for one. */
  it('does not attribute a release to a TENTATIVE pin', () => {
    const looked = narrowFrame({
      events: [
        anchorEvent(),
        turnEvent({
          kind: 'pin',
          seq: 12,
          unit: R as UnitKey,
          actor: operatorActor('Ben'),
          payload: { unit: R, to: 30, tentative: true },
        }),
      ],
      partition: [
        clusterView({
          id: 0,
          generation: 3,
          members: [C, Q, S1],
          boundedBy: [{ unit: R, to: 30, why: 'pin', by: null }],
        }),
      ],
    });
    expect(widen(looked, widenedFrame()).by).toBeNull();
  });

  it('leaves everything under the cursor exactly where it was', () => {
    const prev = narrowFrame();
    const before = inspecting(prev);
    const notice = widen(prev, widenedFrame());
    expect(notice.suspended).toBe(false);
    // Before accept, the cursor is untouched: the old list is still the list.
    expect(resolveCursor(before, prev, prev)).toEqual(before);
  });

  /**
   * 10 §4 O8. The `stale @ seq n` flag rode the movesets panel's HEAD, which a
   * cluster with no retained rows never draws — it draws its empty state
   * instead. So a held widen over such a cluster put the banner up, froze the
   * rail, and said nothing about the numbers under it answering the previous
   * question. The banner is up in exactly the cases the hold applies to, so
   * the flag belongs on the banner: one place, all of them.
   */
  it('says the rail is stale on the banner, where every held case can see it', () => {
    const notice = widen(narrowFrame(), widenedFrame());
    const banner = LensPanel.bannerHTML(notice, 4_000);
    expect(banner).toContain('stale @ seq 14');
    expect(notice.staleAtSeq).toBe(14);
  });

  /**
   * THE FALSIFIER FOR O8, written as the case that used to fail: the cluster
   * retains no rows for this candidate, so the movesets panel draws its empty
   * state and no head — and the head is where the old flag lived. The body
   * says nothing about staleness in this case and cannot; the banner over it
   * must, or a held widen is a frozen rail with no reason on screen.
   */
  it('still flags staleness when the list under the banner is EMPTY', () => {
    const bare = narrowFrame({ movesets: {} });
    const body = LensPanel.railHTML(renderFrame(bare, inspecting(bare), []));
    // The panel drew its empty state, so there is no head to hang a flag on.
    expect(body).toContain('lens-empty');
    expect(body).not.toContain('lens-stale-flag');

    // The banner is up regardless, and it carries the seq the rail went stale.
    const banner = LensPanel.bannerHTML(widen(bare, widenedFrame()), 4_000);
    expect(banner).toContain('lens-stale-flag');
    expect(banner).toContain('stale @ seq 14');
  });

  it('marks the old list stale at the seq it went stale, and does NOT blank it', () => {
    const prev = narrowFrame();
    const notice = widen(prev, widenedFrame());
    expect(notice.staleAtSeq).toBe(prev.at.seq);
    expect(prev.movesets[`0|${C}|10`]).toHaveLength(3);
  });

  it('scales the auto-accept timer as min(6s, 0.25 × time to expiry)', () => {
    const near = widen(
      narrowFrame({ at: lensAt({ seq: 14, tWall: TURN_EXPIRY - 8_000 }) }),
      widenedFrame({ at: lensAt({ seq: 15, tWall: TURN_EXPIRY - 8_000 }) })
    );
    expect(near.autoAcceptMs).toBe(2_000);

    const far = widen(
      narrowFrame({ at: lensAt({ seq: 14, tWall: TURN_EXPIRY - 60_000 }) }),
      widenedFrame({ at: lensAt({ seq: 15, tWall: TURN_EXPIRY - 60_000 }) })
    );
    expect(far.autoAcceptMs).toBe(6_000);
  });

  /**
   * A ZERO-SECOND COUNTDOWN IS NOT A COUNTDOWN. A widen is staged behind one
   * gesture (§1.6) and the banner IS the gesture; a 0 ms timer auto-accepts on
   * the next macrotask, so the list is swapped out from under a reader with no
   * gesture at all. Past the deadline is exactly when that matters most.
   */
  it('floors the auto-accept timer so the banner is always readable', () => {
    const past = widen(
      narrowFrame({ at: lensAt({ seq: 14, tWall: TURN_EXPIRY + 5_000 }) }),
      widenedFrame({ at: lensAt({ seq: 15, tWall: TURN_EXPIRY + 5_000 }) })
    );
    expect(past.autoAcceptMs).toBe(1_500);
  });

  it('SUSPENDS the timer while the drill panel is open', () => {
    const prev = narrowFrame();
    const drilled = applyCursorEvent(inspecting(prev), prev, { t: 'drill', unit: Q });
    expect(drilled.drill).toBe(Q);
    const notice = reactiveNotice(prev, widenedFrame()) as WidenNotice;
    expect(notice.suspended).toBe(true);
  });

  it('queues behind an in-flight lock and says so', () => {
    const prev = narrowFrame();
    const locking = applyCursorEvent(inspecting(prev), prev, { t: 'lock' });
    expect(locking).toBeDefined();
    const notice = reactiveNotice(prev, widenedFrame()) as WidenNotice;
    expect(notice.queuedBehindLock).toBe(true);
  });
});

describe('on accept, the selection re-resolves against the old members', () => {
  it('matches the old assignment restricted to the members present in both', () => {
    const prev = narrowFrame();
    const before = inspecting(prev, 'a2');
    const next = widenedFrame({
      movesets: {
        [`0|${C}|10`]: [
          moveset({ key: 'b1', rank: 1, lo: 13.0, units: [C, Q, S1, R], staged: true }),
          // b2 carries a2's assignment for {C, Q, s1}, plus R's new move.
          moveset({ key: 'b2', rank: 2, lo: 12.1, units: [C, Q, S1, R] }),
        ],
      },
    });
    const after = resolveCursor(before, prev, next);
    expect(after.moveset).toBe('b2');
    const trail = rowTrails(prev, next, after).find((t) => t.moveset === 'b2');
    expect(trail?.wasRank).toBe(2);
    expect(trail?.displaced).toBe(false);
  });

  it('falls to rank 1 with a DISPLACED badge when no new row contains it', () => {
    const prev = narrowFrame();
    const before = inspecting(prev, 'a3');
    const next = widenedFrame({
      movesets: {
        [`0|${C}|10`]: [moveset({ key: 'b1', rank: 1, lo: 13.0, units: [C, Q, S1, R], staged: true })],
      },
    });
    const after = resolveCursor(before, prev, next);
    expect(after.moveset).toBe('b1');
    const trail = rowTrails(prev, next, after).find((t) => t.displaced);
    expect(trail).toBeDefined();
    expect(trail?.moveset).toBe('b1');
  });
});

describe('a narrow applies immediately, with a footer note and no banner', () => {
  it('is a NarrowNote naming what left and why', () => {
    const notice = reactiveNotice(widenedFrame(), narrowFrame());
    expect(notice).not.toBeNull();
    expect(notice).toEqual({ cluster: 0, lost: [R], why: 'pin', by: 'ben' });
    // A narrow has no timer at all: there is nothing to hold behind a gesture.
    expect(notice).not.toHaveProperty('autoAcceptMs');
  });

  it('returns null when nothing about the partition moved', () => {
    expect(reactiveNotice(narrowFrame(), narrowFrame())).toBeNull();
  });
});

describe('Law E — rows from two generations are never in one list', () => {
  it('never mixes generations in a rendered list', () => {
    const prev = narrowFrame();
    const next = widenedFrame();
    const oldRows = prev.movesets[`0|${C}|10`] as ReadonlyArray<Moveset>;
    const newRows = next.movesets[`0|${C}|10`] as ReadonlyArray<Moveset>;
    expect(new Set(oldRows.map((r) => r.generation)).size).toBe(1);
    expect(new Set(newRows.map((r) => r.generation)).size).toBe(1);
    const trails = rowTrails(prev, next, inspecting(prev));
    for (const trail of trails) {
      expect(newRows.some((r) => r.key === trail.moveset)).toBe(true);
      expect(oldRows.some((r) => r.key === trail.moveset)).toBe(false);
    }
  });

  it('decays a trail after two emissions', () => {
    const prev = narrowFrame();
    const next = widenedFrame();
    const trails = rowTrails(prev, next, inspecting(prev));
    expect(trails.every((t) => t.emissionsAgo <= 2)).toBe(true);
  });
});
