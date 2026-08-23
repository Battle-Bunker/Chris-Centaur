// The additive surface consumers asked for, and the invariants that make each
// of them worth having: a refusal instead of a silent default, an observation
// turn that is not always "now", and the one re-export that was being reached
// around.
//
// This is the surface the centaur's substrate layer is built on, so it is
// pinned HERE as well as upstream: strict resolve is how a staged set refuses
// to silently default an unsimulated unit, and hold/holdMany's heldAtTurn is
// how a held unit stays exactly one turn behind instead of guessing.
//
// Ported from packages/engine/src/partial-api.test.ts.

import { makeGrid, makeTerrain, newBoard } from '../partial-engine/index';
import type { StateHandle, UnitSpec } from '../partial-engine/index';
import {
  NO_ORDER,
  PartialEngine,
  UnnamedUnitError,
  headSubStepLBOf,
} from '../partial-engine/index';

const W = 11;
const GRID = makeGrid(W, W);
const at = (x: number, y: number): number => y * W + x;

const makeEngine = (): PartialEngine =>
  new PartialEngine(
    makeTerrain(GRID, [], []),
    { food: newBoard(GRID), potions: newBoard(GRID) },
    { maxUnits: 8, maxTrail: 12, hazardDamage: 15, maxHealth: 100 },
  );

const two = (): UnitSpec[] => [
  { unitId: 1, kind: 0, team: 0, cells: [at(3, 3), at(3, 4), at(3, 5)], health: 50, weight: 3 },
  { unitId: 2, kind: 4, team: 1, cells: [at(8, 8)], health: 50, weight: 1 },
];

describe("strict resolve", () => {
  test("still applies the KIND's default for an explicit NO_ORDER", () => {
    const engine = makeEngine();
    const state = engine.create(two());
    const orders = [NO_ORDER, NO_ORDER, NO_ORDER, NO_ORDER, NO_ORDER, NO_ORDER, NO_ORDER, NO_ORDER];
    const r = engine.resolve(state, orders, { strict: true });
    // The trail unit took its momentum step: a default is a rule, not silence.
    expect(engine.unitAt(r.state, 0)?.cells[0]).toBe(at(3, 2));
  });

  test("refuses a live unit the caller never named", () => {
    const engine = makeEngine();
    const state = engine.create(two());
    // Slot 1 has no entry at all — not NO_ORDER, nothing.
    const orders = [NO_ORDER];
    expect(() => engine.resolve(state, orders, { strict: true })).toThrow(UnnamedUnitError);
    try {
      engine.resolve(engine.fork(state), orders, { strict: true });
    } catch (e) {
      expect((e as UnnamedUnitError).unitId).toBe(2);
      expect((e as UnnamedUnitError).slot).toBe(1);
      expect((e as UnnamedUnitError).code).toBe("unnamed_unit");
    }
  });

  test("defaults silently without the flag — the behaviour every caller has today", () => {
    const engine = makeEngine();
    const state = engine.create(two());
    expect(() => engine.resolve(state, [NO_ORDER])).not.toThrow();
  });

  test("says nothing about FROZEN units, which have no slot to name", () => {
    const engine = makeEngine();
    let state: StateHandle = engine.create(two());
    state = engine.hold(state, 1);
    expect(() => engine.resolve(state, [NO_ORDER], { strict: true })).not.toThrow();
  });
});

describe("hold at an observation turn", () => {
  test("defaults to now, and a wider claim follows from an older observation", () => {
    const engine = makeEngine();
    const base = engine.create(two());

    let fresh = engine.fork(base);
    fresh = engine.resolve(fresh, [NO_ORDER, NO_ORDER]).state;
    fresh = engine.resolve(fresh, [NO_ORDER, NO_ORDER]).state;
    const now = fresh.turn;
    const heldNow = engine.hold(fresh, 1);
    expect(heldNow.field.slotOf(2)?.record.heldAtTurn).toBe(now);

    let stale = engine.fork(base);
    stale = engine.resolve(stale, [NO_ORDER, NO_ORDER]).state;
    stale = engine.resolve(stale, [NO_ORDER, NO_ORDER]).state;
    const heldEarlier = engine.hold(stale, 1, null, now - 2);
    expect(heldEarlier.field.slotOf(2)?.record.heldAtTurn).toBe(now - 2);

    // Two turns older is two turns of dilation more: the cloud can only widen,
    // which is the only direction a claim is allowed to be wrong in.
    const a = heldNow.field.advanceTo(now + 1).slotOf(2);
    const b = heldEarlier.field.advanceTo(now + 1).slotOf(2);
    expect(b?.cloud.turnsHeld).toBe((a?.cloud.turnsHeld as number) + 2);
    expect(b?.cloud.possibleCount).toBeGreaterThan(a?.cloud.possibleCount as number);
  });

  test("holdMany takes the same override", () => {
    const engine = makeEngine();
    let state: StateHandle = engine.create(two());
    state = engine.resolve(state, [NO_ORDER, NO_ORDER]).state;
    const held = engine.holdMany(state, [0, 1], state.turn - 1);
    for (const slot of held.field.slots) {
      expect(slot.record.heldAtTurn).toBe(state.turn - 1);
    }
  });

  test("refuses an observation from the future", () => {
    const engine = makeEngine();
    const state = engine.create(two());
    expect(() => engine.hold(state, 1, null, state.turn + 1)).toThrow(/cannot be fresher/);
    expect(() => engine.holdMany(engine.fork(state), [1], state.turn + 3)).toThrow(
      /cannot be fresher/,
    );
  });

  test("the staleness convention: turnsHeld is one AHEAD of consumer staleness", () => {
    // A unit observed on the turn being resolved has consumer staleness 0 and
    // is adjudicated against turnsHeld 1, because the field a resolution reads
    // is the post-advance one. Pinned here so a consumer that compensates for
    // its own staleness does not compensate twice.
    const engine = makeEngine();
    const state = engine.hold(engine.create(two()), 1);
    expect(state.field.slotOf(2)?.cloud.turnsHeld).toBe(0);
    expect(state.field.advanceTo(state.turn + 1).slotOf(2)?.cloud.turnsHeld).toBe(1);
  });
});

describe("the partial surface", () => {
  test("re-exports headSubStepLBOf, so nobody has to import ./cloud.js", () => {
    const engine = makeEngine();
    const state = engine.hold(engine.create(two()), 1);
    const slot = state.field.advanceTo(state.turn + 1).slotOf(2);
    expect(typeof headSubStepLBOf).toBe("function");
    // Per-cell earliest arriving sub-step. The bishop can still be standing
    // where it was (staying is legal), and it can never be one square up.
    const lb = headSubStepLBOf(slot?.cloud as never, GRID);
    expect(lb.length).toBe(GRID.cells);
    expect(lb[at(8, 8)]).toBe(1);
    expect(lb[at(8, 7)]).toBe(0);
  });
});
