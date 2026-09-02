/**
 * The weight-stack translation, tested at the point where it is silent.
 *
 * The wire stores a piece's weight as that many copies of its cell; the
 * possibility-cloud engine wants one cell plus an explicit `weight`. The
 * dangerous property of that difference is that it DISAPPEARS at weight 1:
 * `[40]` translates identically whether you treat it as a stack or as a body,
 * so a board of ungrown pieces agrees perfectly and the first grown rook
 * diverges. Every test here that matters is therefore a weight > 1 test.
 *
 * The 2000-board differential exercises this adapter in both directions on
 * every board (1362 of them carry a weight-stacked piece), which is the bulk
 * proof. These are the directed ones: the boundaries, the refusals, and the
 * round trip.
 */

import { leavesTrail } from '../engine-vendor/engine/moveGrammar';
import { makeGrid, makeTerrain, newBoard, NO_ORDER, PartialEngine } from '../partial-engine/index';
import {
  WIRE_KIND_NAMES,
  WIRE_ORIENTATIONS,
  cellsOfOccupancy,
  kindOfWireType,
  occupancyOfCells,
  orientationIndexOf,
  ordersForSlots,
  toUnitSpec,
  toUnitSpecs,
  weightOfOccupancy,
  wireTypeOfKind,
} from '../partial-engine/wire-adapter';

const W = 9;
const GRID = makeGrid(W, W);
const at = (x: number, y: number): number => y * W + x;

describe('the kind vocabulary maps both ways', () => {
  test('every wire type has a kind, and every kind its type', () => {
    WIRE_KIND_NAMES.forEach((name, kind) => {
      expect(kindOfWireType(name)).toBe(kind);
      expect(wireTypeOfKind(kind)).toBe(name);
    });
  });

  test('the index order is the engine grammar registry order', () => {
    // Not cosmetic: the engine's UnitKind IS an index into its profile
    // registry, so a reordering here silently turns every rook into a king.
    expect([...WIRE_KIND_NAMES]).toEqual([
      'snake',
      'knight',
      'king',
      'rook',
      'bishop',
      'queen',
      'pawn',
    ]);
  });

  test('an unknown type or kind is refused, not guessed', () => {
    expect(() => kindOfWireType('dragon' as never)).toThrow(/unknown unit type/);
    expect(() => wireTypeOfKind(7)).toThrow(/unknown unit kind/);
    expect(() => wireTypeOfKind(-1)).toThrow(/unknown unit kind/);
  });

  test('exactly one shipped kind leaves a trail, and it is kind 0', () => {
    // The conditional the whole adapter turns on, read from the vendored
    // resolver rather than restated. If TacticToes ever grows a second trail
    // kind this test moves, and the adapter does not have to.
    const trailKinds = WIRE_KIND_NAMES.filter((name) => leavesTrail(name));
    expect(trailKinds).toEqual(['snake']);
    expect(kindOfWireType('snake')).toBe(0);
  });
});

describe('the weight-stack collapse', () => {
  test('a piece is `weight` copies of one cell, collapsed to that cell', () => {
    const stack = [at(4, 4), at(4, 4), at(4, 4)];
    expect(cellsOfOccupancy('rook', stack)).toEqual([at(4, 4)]);
    expect(weightOfOccupancy(stack)).toBe(3);
  });

  test('a trail unit is a real body, passed through', () => {
    const body = [at(4, 4), at(4, 5), at(4, 6)];
    expect(cellsOfOccupancy('snake', body)).toEqual(body);
    expect(weightOfOccupancy(body)).toBe(3);
  });

  test('at weight 1 the two branches agree — which is why this needs testing at all', () => {
    for (const type of WIRE_KIND_NAMES) {
      expect(cellsOfOccupancy(type, [at(2, 2)])).toEqual([at(2, 2)]);
      expect(weightOfOccupancy([at(2, 2)])).toBe(1);
    }
  });

  test('a non-uniform piece occupancy is refused', () => {
    // Not a stack and not a body: either the type is wrong or the payload is
    // corrupt. Guessing which would put a wrong board into the engine, and a
    // wrong board resolves perfectly happily.
    expect(() => cellsOfOccupancy('rook', [at(4, 4), at(4, 5)])).toThrow(/not a weight stack/);
  });

  test('an empty occupancy is refused', () => {
    expect(() => cellsOfOccupancy('rook', [])).toThrow(/empty occupancy/);
    expect(() => cellsOfOccupancy('snake', [])).toThrow(/empty occupancy/);
  });

  test('the collapse round-trips through occupancyOfCells', () => {
    for (const type of WIRE_KIND_NAMES) {
      for (const weight of [1, 2, 5]) {
        const occupancy = leavesTrail(type)
          ? Array.from({ length: weight }, (_, i) => at(3, 3 + i))
          : new Array<number>(weight).fill(at(3, 3));
        const cells = cellsOfOccupancy(type, occupancy);
        expect(occupancyOfCells(type, cells, weightOfOccupancy(occupancy))).toEqual([...occupancy]);
      }
    }
  });

  test('rebuilding a piece occupancy below weight 1 is refused', () => {
    expect(() => occupancyOfCells('rook', [at(1, 1)], 0)).toThrow(/below 1/);
    expect(() => occupancyOfCells('rook', [], 3)).toThrow(/no cells/);
  });
});

describe('orientation crosses the boundary as an index', () => {
  test('the four orthogonals round-trip', () => {
    WIRE_ORIENTATIONS.forEach((vector, index) => {
      expect(orientationIndexOf(vector)).toBe(index);
    });
  });

  test('a magnitude is normalised to its sign', () => {
    // A wire orientation is a direction, not a distance; a {dx:0,dy:-3} is up.
    expect(orientationIndexOf({ dx: 0, dy: -3 })).toBe(0);
    expect(orientationIndexOf({ dx: 2, dy: 0 })).toBe(1);
  });

  test('a diagonal or absent facing has no index, and says so', () => {
    // -1 rather than a plausible wrong answer: kings, queens and bishops have
    // an 8-way facing on the wire and no index here, so the caller decides
    // (with defaultOrientation) instead of being handed a silent 0.
    expect(orientationIndexOf({ dx: 1, dy: 1 })).toBe(-1);
    expect(orientationIndexOf(undefined)).toBe(-1);
    expect(orientationIndexOf({ dx: 0, dy: 0 })).toBe(-1);
  });
});

describe('a wire unit becomes a UnitSpec', () => {
  const rook = {
    id: 'u00007',
    type: 'rook' as const,
    teamID: '1',
    occupancy: [at(4, 4), at(4, 4), at(4, 4)],
    health: 55,
    tier: 1,
    orientation: { dx: 1, dy: 0 },
  };

  test('the whole translation, on a grown piece', () => {
    expect(toUnitSpec(rook)).toEqual({
      unitId: 7,
      kind: 3,
      team: 1,
      cells: [at(4, 4)],
      weight: 3,
      health: 55,
      tier: 1,
      tierExpiresAtTurn: null,
      orientation: 1,
    });
  });

  test('ids are read out of the wire string, and can be overridden', () => {
    expect(toUnitSpec(rook).unitId).toBe(7);
    expect(toUnitSpec({ ...rook, id: 'player-42' }).unitId).toBe(42);
    expect(toUnitSpec(rook, { unitId: 99, team: 5 })).toMatchObject({ unitId: 99, team: 5 });
  });

  test('an id with no number in it is refused rather than becoming NaN', () => {
    // A NaN unitId would flow all the way into the engine's slot table and
    // fail somewhere unrecognisable.
    expect(() => toUnitSpec({ ...rook, id: 'alice' })).toThrow(/numeric unitId/);
    expect(() => toUnitSpec({ ...rook, teamID: 'red' })).toThrow(/numeric team/);
    expect(() => toUnitSpec({ ...rook, id: 'alice' }, { unitId: 1 })).not.toThrow();
  });

  test('a diagonal facing falls back to the callers default', () => {
    const bishop = { ...rook, type: 'bishop' as const, orientation: { dx: 1, dy: 1 } };
    expect(toUnitSpec(bishop).orientation).toBe(0);
    expect(toUnitSpec(bishop, { defaultOrientation: 2 }).orientation).toBe(2);
  });

  test('tier defaults to 0 and the expiry to none', () => {
    const untiered = {
      id: rook.id,
      type: rook.type,
      teamID: rook.teamID,
      occupancy: rook.occupancy,
      health: rook.health,
      orientation: rook.orientation,
    };
    expect(toUnitSpec(untiered)).toMatchObject({ tier: 0, tierExpiresAtTurn: null });
    expect(toUnitSpec(rook, { tierExpiresAtTurn: 12 }).tierExpiresAtTurn).toBe(12);
  });

  test('a roster keeps its order, because the order is the engine slots', () => {
    const specs = toUnitSpecs([
      { ...rook, id: 'u00002' },
      { ...rook, id: 'u00001' },
    ]);
    expect(specs.map((s) => s.unitId)).toEqual([2, 1]);
  });
});

describe('staged orders become slot-indexed', () => {
  const specs = toUnitSpecs([
    { id: 'u00005', type: 'rook', teamID: '0', occupancy: [at(1, 1)], health: 10 },
    { id: 'u00009', type: 'king', teamID: '1', occupancy: [at(7, 7)], health: 10 },
  ]);

  test('a staged cell lands in the unit\'s slot and nothing else moves', () => {
    const orders = ordersForSlots(specs, 4, new Map([[9, at(7, 6)]]));
    expect(orders).toEqual([NO_ORDER, at(7, 6), NO_ORDER, NO_ORDER]);
  });

  test('an unstaged unit gets NO_ORDER, which is a rule and not a guess', () => {
    // NO_ORDER means "apply the kind's own default action" — a trail unit
    // still takes its momentum step. It is not "stand still".
    expect(ordersForSlots(specs, 2, new Map())).toEqual([NO_ORDER, NO_ORDER]);
  });

  test('more units than the engine has slots is refused', () => {
    expect(() => ordersForSlots(specs, 1, new Map())).toThrow(/exceeds the engine's maxUnits/);
  });
});

describe('the translation is the one the engine actually accepts', () => {
  // The end-to-end claim: a spec built by this adapter goes into a real engine
  // and comes back out with the weight the wire encoded. Building the spec by
  // hand — cells: occupancy — is exactly the mistake this guards, and the
  // engine rejects it, which is the assertion at the bottom.
  const engineFor = (): PartialEngine =>
    new PartialEngine(
      makeTerrain(GRID, [], []),
      { food: newBoard(GRID), potions: newBoard(GRID) },
      { maxUnits: 4, maxTrail: 8, hazardDamage: 100, maxHealth: 100 }
    );

  test('a weight-3 rook arrives as one cell carrying weight 3', () => {
    const engine = engineFor();
    const spec = toUnitSpec({
      id: 'u00001',
      type: 'rook',
      teamID: '0',
      occupancy: [at(4, 4), at(4, 4), at(4, 4)],
      health: 70,
      orientation: { dx: 1, dy: 0 },
    });
    const state = engine.create([spec], [], [], 0);
    const view = engine.unitAt(state, 0);
    expect(view?.cells).toEqual([at(4, 4)]);
    expect(view?.weight).toBe(3);
    expect(view?.health).toBe(70);
    engine.release(state);
  });

  test('a weight-3 trail unit arrives as three cells carrying weight 3', () => {
    const engine = engineFor();
    const spec = toUnitSpec({
      id: 'u00001',
      type: 'snake',
      teamID: '0',
      occupancy: [at(4, 4), at(4, 5), at(4, 6)],
      health: 70,
      orientation: { dx: 0, dy: -1 },
    });
    const state = engine.create([spec], [], [], 0);
    const view = engine.unitAt(state, 0);
    expect(view?.cells).toEqual([at(4, 4), at(4, 5), at(4, 6)]);
    expect(view?.weight).toBe(3);
    engine.release(state);
  });

  test('the hand-rolled mistake is what the engine refuses', () => {
    // Feeding the wire's occupancy straight in as `cells` — the thing every
    // consumer will be tempted to do — is a repeated cell, and `create`
    // throws rather than reading it as a three-cell body.
    const engine = engineFor();
    expect(() =>
      engine.create(
        [
          {
            unitId: 1,
            kind: 3,
            team: 0,
            cells: [at(4, 4), at(4, 4), at(4, 4)],
            health: 70,
            weight: 3,
            orientation: 1,
          },
        ],
        [],
        [],
        0
      )
    ).toThrow();
  });
});
