/**
 * The seams the centaur is going to be built on, pinned HERE so that a
 * re-vendoring which quietly changes one of them fails in this repo rather
 * than in a game.
 *
 * The other ported suites cover the engine's behaviour. This one covers its
 * REACHABILITY: every entry point the substrate layer names is imported from
 * `src/partial-engine/index`, called, and shown to do the thing the substrate
 * is going to rely on. A vendored dependency's public surface is a contract
 * whether or not anybody writes it down, and the cheapest time to discover
 * that `resolveBounded` moved is now.
 *
 * Two of these seams have no coverage upstream at the level a consumer needs:
 *   - resolveBounded's pessimism scope, which is the whole reason the
 *     substrate calls it instead of evolveJoint;
 *   - teamArrivalInto / ArrivalGrid, which is how a team's reach becomes a
 *     grid the search can order candidates against.
 *
 * The resolveBounded case is ported from packages/engine/src/partial-risk.test.ts.
 */

import {
  bbSet,
  makeGrid,
  makeTerrain,
  newBoard,
  NEVER,
  NO_ORDER,
  PartialEngine,
  RiskAssessor,
  UnitKind,
  meetingTime,
  resolveBounded,
  scalarOf,
  teamArrivalInto,
} from '../partial-engine/index';
import type { Mover, StateHandle, UnitSpec } from '../partial-engine/index';

const W = 11;
const GRID = makeGrid(W, W);
const at = (x: number, y: number): number => y * W + x;
const TERRAIN = makeTerrain(GRID, [], []);

function heldState(
  units: UnitSpec[],
  holdSlots: number[],
  food: number[] = []
): { engine: PartialEngine; state: StateHandle } {
  const foodB = newBoard(GRID);
  for (const c of food) bbSet(foodB, c);
  const engine = new PartialEngine(TERRAIN, { food: foodB, potions: newBoard(GRID) });
  let state = engine.create(units, food, [], 0);
  state = engine.holdMany(state, holdSlots);
  return { engine, state };
}

describe('resolveBounded: the substrate\'s single entry point', () => {
  test('the pessimism scope is per consumer, not global', () => {
    // A subject king far from danger; an ENEMY king walking into a frozen
    // queen's cloud — contingent. In the SUBJECT's frame the enemy's
    // contingency must price the enemy ALIVE in `worst` (the subject's worst
    // world is the enemy surviving) and DEAD in `best`.
    //
    // This asymmetry is exactly why the substrate calls resolveBounded rather
    // than reading a resolution directly: a single "pessimistic" reading that
    // killed every contingent unit would hand the subject a free win.
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.King, team: 0, cells: [at(1, 9)], health: 10, weight: 2 },
      { unitId: 2, kind: UnitKind.King, team: 1, cells: [at(5, 6)], health: 10, weight: 4 },
      { unitId: 7, kind: UnitKind.Queen, team: 2, cells: [at(5, 4)], health: 30, weight: 9 },
    ];
    const { engine, state } = heldState(units, [2]);
    const { bounds, perTeam, resolution } = resolveBounded(
      engine,
      state,
      new Map([
        [1, at(1, 8)],
        [2, at(5, 5)], // steps INTO the queen's cloud: contingent
      ]),
      0
    );
    const enemyContingent = resolution.fates.find((f) => f.unitId === 2);
    expect(enemyContingent?.fate).toBe(2); // Fate.Contingent
    const enemyTeam = perTeam.get(1);
    // Subject frame: enemy worst-frame = alive at full weight; best-frame = the cliff.
    expect(enemyTeam?.worst).toBe(4);
    expect(enemyTeam?.best).toBe(0);
    expect(bounds.worst).toBeLessThan(bounds.best);
    expect(bounds.assumptions).toEqual([]);
  });

  test('it reports the Resolution the adjudication tests compare against', () => {
    // The same object shape the differential checks coordinate by coordinate,
    // reachable from the bounded call — so the substrate never needs a second
    // resolve to find out what actually happened.
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.King, team: 0, cells: [at(1, 9)], health: 10, weight: 2 },
      { unitId: 2, kind: UnitKind.King, team: 1, cells: [at(8, 2)], health: 10, weight: 4 },
    ];
    const { engine, state } = heldState(units, []);
    const { resolution } = resolveBounded(
      engine,
      state,
      new Map([
        [1, at(1, 8)],
        [2, NO_ORDER],
      ]),
      0
    );
    expect(Array.isArray(resolution.clashes)).toBe(true);
    expect(Array.isArray(resolution.deaths)).toBe(true);
    expect(resolution.severedCells instanceof Map).toBe(true);
    // Nobody met anybody: an empty entanglement ledger is a PROOF the answer
    // did not depend on a held unit, which is the property the bound algebra
    // discharges against.
    expect(resolution.ledger).toEqual([]);
  });

  test('a basis with no assumptions is what an exact answer looks like', () => {
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.King, team: 0, cells: [at(1, 9)], health: 10, weight: 2 },
      { unitId: 2, kind: UnitKind.King, team: 1, cells: [at(8, 2)], health: 10, weight: 4 },
    ];
    const { engine, state } = heldState(units, []);
    const { bounds } = resolveBounded(
      engine,
      state,
      new Map([
        [1, at(1, 8)],
        [2, NO_ORDER],
      ]),
      0
    );
    // Nothing frozen, nothing contingent: worst and best coincide. Scores from
    // different assumption sets are never comparable, so "no assumptions" is
    // the only basis that composes freely.
    expect(bounds.assumptions).toEqual([]);
    expect(bounds.worst).toBe(bounds.best);
  });

  test('a partial assignment is REFUSED, never quietly defaulted', () => {
    // The rule the whole staged-set discipline rests on: a unit the caller did
    // not speak for is an error, not an implied default. NO_ORDER is how you
    // ask for the kind's own default, and it is a different statement from
    // saying nothing — one is a decision, the other is an omission.
    //
    // Downstream: every team-level assignment must name EVERY live unit,
    // including the ones it is choosing not to move.
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.King, team: 0, cells: [at(1, 9)], health: 10, weight: 2 },
      { unitId: 2, kind: UnitKind.King, team: 1, cells: [at(8, 2)], health: 10, weight: 4 },
    ];
    const { engine, state } = heldState(units, []);
    expect(() => resolveBounded(engine, state, new Map([[1, at(1, 8)]]), 0)).toThrow(
      /refuses a partial assignment/
    );
    // And naming it with NO_ORDER is accepted.
    expect(() =>
      resolveBounded(
        engine,
        state,
        new Map([
          [1, at(1, 8)],
          [2, NO_ORDER],
        ]),
        0
      )
    ).not.toThrow();
  });
});

describe('ArrivalGrid: a team\'s reach as a grid the search can order against', () => {
  test('teamArrivalInto folds one team\'s frozen units into earliest/minCost', () => {
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.Rook, team: 0, cells: [at(2, 2)], health: 30, weight: 3 },
      { unitId: 2, kind: UnitKind.Rook, team: 1, cells: [at(8, 8)], health: 30, weight: 3 },
    ];
    const { engine, state } = heldState(units, [0, 1]);
    const field = state.field.advanceTo(state.turn + 1);

    const earliest = new Int32Array(GRID.cells);
    const minCost = new Int32Array(GRID.cells);
    const contributed = teamArrivalInto(field, 0, state.turn + 1, earliest, minCost);

    expect(contributed).toBe(1); // exactly team 0's one frozen unit
    // Its own cell is reachable at the horizon; the far corner is not, in one turn.
    expect(earliest[at(2, 2)]).toBeLessThan(NEVER);
    expect(earliest[at(8, 8)]).toBe(0x7fffffff);
    // A rook's file and rank are reachable; a diagonal is not.
    expect(earliest[at(2, 7)]).toBeLessThan(NEVER);
    expect(earliest[at(3, 3)]).toBe(0x7fffffff);
    engine.release(state);
  });

  test('a team with nothing frozen contributes nothing and leaves the grid empty', () => {
    // The vacuity case a consumer must distinguish from "reaches nowhere":
    // both look like an all-NEVER grid, and only the count tells them apart.
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.Rook, team: 0, cells: [at(2, 2)], health: 30, weight: 3 },
    ];
    const { engine, state } = heldState(units, [0]);
    const field = state.field.advanceTo(state.turn + 1);
    const earliest = new Int32Array(GRID.cells);
    const minCost = new Int32Array(GRID.cells);
    expect(teamArrivalInto(field, 5, state.turn + 1, earliest, minCost)).toBe(0);
    expect(earliest[at(2, 2)]).toBe(0x7fffffff);
    engine.release(state);
  });

  test('meetingTime prices entanglement as a MEETING, not a distance', () => {
    // Two frozen rooks on the same rank meet sooner than their cell-distance
    // suggests; the number the catch-up scheduler rewinds to is this one.
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.Rook, team: 0, cells: [at(1, 5)], health: 30, weight: 3 },
      { unitId: 2, kind: UnitKind.Rook, team: 1, cells: [at(9, 5)], health: 30, weight: 3 },
    ];
    const { engine, state } = heldState(units, [0, 1]);
    const field = state.field.advanceTo(state.turn + 1);
    const a = field.bySlot(0)?.timeline.arrival(state.turn + 1);
    const b = field.bySlot(1)?.timeline.arrival(state.turn + 1);
    const meet = meetingTime(a as never, b as never);
    expect(meet).not.toBeNull();
    expect(meet?.turn).toBeLessThanOrEqual(state.turn + 1);
    engine.release(state);
  });
});

describe('the RiskAssessor seam the pin advisor will call', () => {
  test('a mover far from every claim discharges its whole ledger', () => {
    // The discharge theorem in one assertion: survival 'yes' WITH an empty
    // ledger means no held unit could have changed the outcome. The landing
    // suite pins the case where that reading was false; this pins that it is
    // still available when it is true, because an advisor that can never
    // prove safety is an advisor nobody reads.
    const units: UnitSpec[] = [
      { unitId: 1, kind: UnitKind.King, team: 1, cells: [at(2, 2)], health: 10 },
      { unitId: 7, kind: UnitKind.Queen, team: 0, cells: [at(5, 5)], health: 30, weight: 3 },
    ];
    const { engine, state } = heldState(units, [1]);
    const assessor = new RiskAssessor({
      field: state.field.advanceTo(state.turn + 1),
      startField: state.field,
      terrain: TERRAIN,
      hazardDamage: 15,
      maxHealth: 20,
      food: null,
    });
    const far: Mover = {
      unitId: 1,
      kind: UnitKind.King,
      strength: scalarOf(0, 2),
      health: 10,
      path: [at(1, 2)],
      origin: at(1, 3),
    };
    const v = assessor.assessPath(far);
    expect(v.survival).toBe('yes');
    expect(v.ledger.length).toBe(0);
    expect(v.completesPath).toBe('yes');
    engine.release(state);
  });
});
