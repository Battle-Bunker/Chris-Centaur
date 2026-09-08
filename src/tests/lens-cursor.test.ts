/**
 * THE CURSOR STATE MACHINE — T1–T17 of 02 §1.3, minus the deleted T5.
 *
 * The machine is driven FROM THE FRAME, which is what makes it testable: given
 * a frame and a cursor, every transition is a pure function, and the display
 * contract is a property of that function rather than of the DOM.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is the lock staging a different
 * moveset than the one drawn. `Space` pins `P* = {u} ∪ {v : K(v) ≠ staged(v)}`
 * — exactly the set that makes `conform(ctx ⊕ P*, wirePlan)` stage `K`,
 * because conform splices pins and repairs legality without searching — so the
 * count is EXACT and is rendered before the press, with no `≤`. A `≤` in the
 * affordance is the bug; `minimalPinSet` is not built (04 §2.4).
 *
 * T5 (`\` cycle cluster) is absent on purpose: components of one graph
 * partition the vertex set, so a unit is in exactly one cluster and there is
 * nothing to cycle (04 §3 Q3).
 */

import { applyCursorEvent, cursorState, initialCursor, planLock, resolveCursor } from '../lens/view';
import type { CursorEvent, LensCursor, LensFrame, Moveset, UnitKey } from '../lens/types';
import { clusterView, cursor, lensAt, lensFrame, moveset, unitKeysOf, SINGLETONS } from './lens-fixtures';

const [U, V] = unitKeysOf(SINGLETONS) as [UnitKey, UnitKey];

/** A cluster of two, so the pin-count arithmetic has something to count. */
function pairFrame(over: Partial<LensFrame> = {}): LensFrame {
  const rows: ReadonlyArray<Moveset> = [
    moveset({ key: 'k1', rank: 1, lo: 12.4, est: 12.9, hi: 15.3, units: [U, V], staged: true }),
    moveset({ key: 'k2', rank: 2, lo: 11.7, est: 12.0, hi: 15.8, units: [U, V], tie: 1 }),
    moveset({ key: 'k3', rank: 3, lo: 11.1, est: 11.4, hi: 12.3, units: [U, V], tie: 2 }),
  ];
  return lensFrame({
    partition: [clusterView({ id: 0, members: [U, V] })],
    candidates: {
      [U]: [
        { key: 'u10', to: 10, path: [10], legal: true, conditionalBest: null, disposition: null },
        { key: 'u11', to: 11, path: [11], legal: true, conditionalBest: null, disposition: null },
      ],
      [V]: [
        { key: 'v11', to: 11, path: [11], legal: true, conditionalBest: null, disposition: null },
      ],
    },
    movesets: { [`0|${U}|10`]: rows, [`0|${U}|11`]: rows },
    staged: { [U]: { to: 10 }, [V]: { to: 11 } },
    ...over,
  });
}

function drive(frame: LensFrame, events: ReadonlyArray<CursorEvent>): LensCursor {
  return events.reduce<LensCursor>((c, e) => applyCursorEvent(c, frame, e), initialCursor());
}

describe('Law D — defaults cascade, choices pin', () => {
  it('T1 focus auto-advances past UNIT and never leaves the panel empty', () => {
    const frame = pairFrame();
    const after = drive(frame, [{ t: 'focus', unit: U }]);
    expect(cursorState(after)).toBe('MOVESET');
    expect(after.candidate).toBe(10); // the unit's incumbent
    expect(after.moveset).toBe('k1'); // rank 1 of the conditional
    expect(after.explicit).toEqual({ candidate: false, moveset: false, drill: false });
  });

  it('T3 choosing a candidate re-defaults the moveset and the drill', () => {
    const frame = pairFrame();
    const after = drive(frame, [
      { t: 'focus', unit: U },
      { t: 'moveset', key: 'k3' },
      { t: 'drill', unit: V },
      { t: 'candidate', to: 11 },
    ]);
    expect(after.candidate).toBe(11);
    expect(after.explicit.candidate).toBe(true);
    expect(after.moveset).toBe('k1');
    expect(after.explicit.moveset).toBe(false);
    expect(after.drill).toBeNull();
  });

  it('T6 choosing a moveset does NOT touch the candidate', () => {
    const frame = pairFrame();
    const after = drive(frame, [
      { t: 'focus', unit: U },
      { t: 'candidate', to: 11 },
      { t: 'moveset', key: 'k2' },
    ]);
    expect(after.candidate).toBe(11);
    expect(after.moveset).toBe('k2');
    expect(after.explicit.moveset).toBe(true);
    expect(after.drill).toBeNull();
  });

  it('T7 drill toggles, and T2 blur clears everything', () => {
    const frame = pairFrame();
    const drilled = drive(frame, [{ t: 'focus', unit: U }, { t: 'drill', unit: V }]);
    expect(cursorState(drilled)).toBe('BREAKDOWN');
    const closed = applyCursorEvent(drilled, frame, { t: 'drill', unit: V });
    expect(closed.drill).toBeNull();
    expect(cursorState(applyCursorEvent(closed, frame, { t: 'blur' }))).toBe('NONE');
  });

  it('leaves UNIT terminal for a unit with no candidates, with the reason', () => {
    const frame = pairFrame({
      candidates: { [U]: [] },
      partition: [clusterView({ id: 0, members: [V], boundedBy: [{ unit: U, to: 10, why: 'commit', by: 'ada' }] })],
    });
    const after = drive(frame, [{ t: 'focus', unit: U }]);
    expect(cursorState(after)).toBe('UNIT');
    expect(after.moveset).toBeNull();
  });
});

describe('hover never commits the cursor (T4)', () => {
  it('leaves every level unchanged', () => {
    const frame = pairFrame();
    const before = drive(frame, [{ t: 'focus', unit: U }]);
    const after = applyCursorEvent(before, frame, { t: 'candidate.hover', to: 11 });
    expect(after).toEqual(before);
  });
});

describe('re-resolution by identity (§1.5)', () => {
  it('keeps the selected row through an emission that re-ranks the list', () => {
    const before = pairFrame();
    const cursorAt3 = drive(before, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k3' }]);
    const reranked = pairFrame({
      movesets: {
        [`0|${U}|10`]: [
          moveset({ key: 'k3', rank: 1, lo: 13.0, units: [U, V] }),
          moveset({ key: 'k1', rank: 2, lo: 12.4, units: [U, V], staged: true }),
          moveset({ key: 'k2', rank: 3, lo: 11.7, units: [U, V] }),
        ],
      },
    });
    const after = resolveCursor(cursorAt3, before, reranked);
    expect(after.moveset).toBe('k3');
    expect(after.explicit.moveset).toBe(true);
  });

  it('falls to the incumbent, badged, when the chosen candidate goes illegal', () => {
    const before = pairFrame();
    const chosen = drive(before, [{ t: 'focus', unit: U }, { t: 'candidate', to: 11 }]);
    const narrowed = pairFrame({
      candidates: {
        [U]: [{ key: 'u10', to: 10, path: [10], legal: true, conditionalBest: null, disposition: null }],
        [V]: [{ key: 'v11', to: 11, path: [11], legal: true, conditionalBest: null, disposition: null }],
      },
    });
    const after = resolveCursor(chosen, before, narrowed);
    expect(after.candidate).toBe(10);
    expect(after.explicit.candidate).toBe(false);
  });

  it('closes the drill when its member leaves the cluster', () => {
    const before = pairFrame();
    const drilled = drive(before, [{ t: 'focus', unit: U }, { t: 'drill', unit: V }]);
    const narrowed = pairFrame({
      partition: [clusterView({ id: 0, members: [U], boundedBy: [{ unit: V, to: 11, why: 'pin', by: 'ben' }] })],
    });
    expect(resolveCursor(drilled, before, narrowed).drill).toBeNull();
  });

  it('T17 a turn boundary clears the board-specific levels and KEEPS focus', () => {
    const frame = pairFrame();
    const before = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k2' }]);
    const after = applyCursorEvent(before, frame, { t: 'turn-boundary', turn: 2 });
    expect(after.unit).toBe(U);
    expect(after.candidate).toBeNull();
    expect(after.moveset).toBeNull();
    expect(after.drill).toBeNull();
  });
});

describe('determinations are legal iff at.isHead (T9, T13, T14)', () => {
  it('plans a lock at the live head', () => {
    const frame = pairFrame();
    const at3 = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k1' }]);
    expect(planLock(frame, at3).count).toBeGreaterThan(0);
  });

  it('refuses a lock while scrubbing, and `now` restores it', () => {
    const scrubbed = pairFrame({ at: lensAt({ mode: 'live-scrub', isHead: false, seq: 2 }) });
    const at1 = drive(scrubbed, [{ t: 'focus', unit: U }]);
    expect(() => planLock(scrubbed, at1)).toThrow();
    const returned = applyCursorEvent(at1, scrubbed, { t: 'now' });
    expect(planLock(pairFrame(), returned).count).toBeGreaterThan(0);
  });

  it('refuses a lock in replay', () => {
    const replay = pairFrame({ at: lensAt({ mode: 'replay', isHead: false }) });
    const at1 = drive(replay, [{ t: 'focus', unit: U }]);
    expect(() => planLock(replay, at1)).toThrow();
  });
});

describe('the pin set is exact, and the count is |P*| with no ≤', () => {
  it('rank 1 pins exactly {u} — today’s Space, and the common case', () => {
    const frame = pairFrame();
    const at1 = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k1' }]);
    const plan = planLock(frame, at1);
    expect(plan.pins.map((p) => p.unit)).toEqual([U]);
    expect(plan.count).toBe(1);
    expect(plan.members).toBe(2);
  });

  it('pins every member whose assignment differs from the staged plan', () => {
    // k2 moves BOTH members off their staged cells, so P* = {U, V}.
    const rows: ReadonlyArray<Moveset> = [
      moveset({ key: 'k1', rank: 1, lo: 12.4, units: [U, V], staged: true }),
      { ...moveset({ key: 'k2', rank: 2, lo: 11.7, units: [U, V] }),
        moves: [
          { unit: U, to: 11, path: [11] },
          { unit: V, to: 12, path: [12] },
        ] },
    ];
    const frame = pairFrame({ movesets: { [`0|${U}|10`]: rows } });
    const at2 = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k2' }]);
    const plan = planLock(frame, at2);
    expect(new Set(plan.pins.map((p) => p.unit))).toEqual(new Set([U, V]));
    expect(plan.count).toBe(2);
    // The exactness claim: not an upper bound, and never rendered with a `≤`.
    expect(plan.count).toBe(plan.pins.length);
  });

  it('records `expected` so the divergence check has something to compare', () => {
    const frame = pairFrame();
    const at2 = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k2' }]);
    const plan = planLock(frame, at2);
    expect(plan.expected.length).toBe(2);
    expect(plan.emissionSeq).toBe(frame.at.seq);
  });

  it('names the units another operator owns rather than issuing across owners', () => {
    const frame = pairFrame({
      units: [
        { unit: U, kind: 'snake', letter: 'A', weight: 1, health: 100, orientation: { dx: 0, dy: 1 }, fixity: 'free', owner: null, operator: null },
        { unit: V, kind: 'snake', letter: 'B', weight: 1, health: 100, orientation: { dx: 0, dy: 1 }, fixity: 'free', owner: 'ben', operator: 'ben' },
      ],
      movesets: {
        [`0|${U}|10`]: [
          moveset({ key: 'k1', rank: 1, lo: 12.4, units: [U, V], staged: true }),
          { ...moveset({ key: 'k2', rank: 2, lo: 11.7, units: [U, V] }),
            moves: [
              { unit: U, to: 11, path: [11] },
              { unit: V, to: 12, path: [12] },
            ] },
        ],
      },
    });
    const at2 = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k2' }]);
    expect(planLock(frame, at2).blockedBy).toEqual([{ unit: V, owner: 'ben' }]);
  });
});

describe('the remaining transitions (T8, T10, T11, T12)', () => {
  it('T8 foil cycles off → peek → latched and touches nothing else', () => {
    const frame = pairFrame();
    const base = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k2' }]);
    const peek = applyCursorEvent(base, frame, { t: 'foil', mode: 'peek' });
    expect(peek.foil).toBe('peek');
    expect(peek.moveset).toBe(base.moveset);
    expect(peek.candidate).toBe(base.candidate);
    const latched = applyCursorEvent(peek, frame, { t: 'foil', mode: 'latched' });
    expect(latched.foil).toBe('latched');
  });

  it('T10 Shift+Space pins EVERY member, unconditionally', () => {
    const frame = pairFrame();
    const at1 = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k1' }]);
    const shifted = applyCursorEvent(at1, frame, { t: 'lock.moveset' });
    const plan = planLock(frame, shifted);
    expect(new Set(plan.pins.map((p) => p.unit))).toEqual(new Set([U, V]));
    expect(plan.count).toBe(plan.members);
  });

  it('T11 release clears only the pin, and re-defaults below the unit', () => {
    const frame = pairFrame();
    const base = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k3' }]);
    const released = applyCursorEvent(base, frame, { t: 'release', unit: V });
    expect(released.unit).toBe(U);
    expect(released.explicit.moveset).toBe(false);
  });

  it('T12 clear kills every command on the unit and re-defaults everything below', () => {
    const frame = pairFrame();
    const base = drive(frame, [{ t: 'focus', unit: U }, { t: 'moveset', key: 'k3' }, { t: 'drill', unit: V }]);
    const cleared = applyCursorEvent(base, frame, { t: 'clear', unit: U });
    expect(cleared.unit).toBe(U);
    expect(cleared.moveset).toBe('k1');
    expect(cleared.drill).toBeNull();
    expect(cleared.explicit).toEqual({ candidate: false, moveset: false, drill: false });
  });
});

describe('T5 is deleted — a unit belongs to exactly one cluster', () => {
  it('has no cluster level on the cursor at all', () => {
    expect(Object.keys(cursor())).not.toContain('cluster');
  });

  it('finds each member in exactly one cluster of the frame', () => {
    const frame = pairFrame();
    for (const unit of [U, V]) {
      expect(frame.partition.filter((c) => c.members.includes(unit))).toHaveLength(1);
    }
  });
});
