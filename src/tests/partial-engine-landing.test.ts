// THE LANDING IS THE REST OF THE TURN — the risk layer's dual of the
// maybe-durable rule, and the arena's issue #1.
//
// `assessPath` walks a path one cell per sub-step and asks, at each, "could
// something be here at the instant I arrive?". That is the right question for a
// cell the mover passes THROUGH and the wrong one for the cell it stops on:
// standing on a cell at sub-step 1 means standing on it at 2, 3 and 4 as well,
// so a frozen unit whose earliest arrival is later still contests it.
//
// Read as safety, arriving early was a false PROOF: `survival: 'yes'` with an
// empty ledger, which the engine's discharge theorem says means no held unit
// could have changed the outcome — while the real resolver killed the mover.
// The arena measured it at 2 of 1,663 moves rated 'yes' under random play, and
// noted the rate a real bot sees is worse, because a bot that filters on 'yes'
// plays precisely the cells where this misfires.
//
// It is ported here because the centaur is exactly that bot: it will filter on
// 'yes', and a false proof is the one failure mode its whole bound algebra is
// built to not have.
//
// Ported from packages/engine/src/partial-landing.test.ts.

import {
  PartialEngine,
  RiskAssessor,
  UnitKind,
  WHOLE_TURN,
  makeGrid,
  makeTerrain,
  newBoard,
  orientationOf,
  profileOf,
  scalarOf,
  vectorOf,
} from '../partial-engine/index';
import type { StateHandle } from '../partial-engine/index';

const W = 11;
const GRID = makeGrid(W, W);
const TERRAIN = makeTerrain(GRID, [], []);

const assessorFor = (state: StateHandle, turn: number): RiskAssessor =>
  new RiskAssessor({
    field: state.field.advanceTo(turn + 1),
    startField: state.field.advanceTo(turn),
    terrain: TERRAIN,
    hazardDamage: 100,
    maxHealth: 100,
    food: null,
  });

/** The arena's exact repro board: a knight landing under a held rook's later reach. */
function reproBoard(): { engine: PartialEngine; state: StateHandle } {
  const engine = new PartialEngine(
    TERRAIN,
    { food: newBoard(GRID), potions: newBoard(GRID) },
    { maxUnits: 8, hazardDamage: 100, maxHealth: 100, pawnPromotionWeight: 6 },
  );
  const created = engine.create(
    [
      { unitId: 0, kind: UnitKind.Knight, team: 0, cells: [63], health: 100, weight: 1 },
      { unitId: 1, kind: UnitKind.Rook, team: 1, cells: [30], health: 100, weight: 2 },
    ],
    [],
    [],
    7,
  );
  return { engine, state: engine.holdMany(created, [1]) };
}

describe("a mover's landing is met against the WHOLE remaining turn", () => {
  test("the arena's repro: arriving before the maybe's earliest sub-step is not safety", () => {
    const { engine, state } = reproBoard();
    const ra = assessorFor(state, 9);

    // The premise the old reading rested on, still true: the rook cannot be at
    // cell 72 at sub-step 1, and can from sub-step 2.
    expect(ra.entriesAt(72, 1)).toHaveLength(0);
    expect(ra.entriesAt(72, 2)).toHaveLength(1);
    expect(ra.entriesAt(72, WHOLE_TURN)).toHaveLength(1);

    const v = ra.assessPath({
      unitId: 0,
      kind: UnitKind.Knight,
      strength: scalarOf(0, 1),
      health: 100,
      origin: 63,
      path: [72],
    });
    // The knight lands at sub-step 1 and STANDS there while the rook rides in.
    expect(v.survival).toBe("maybe");
    expect(v.deathCells).toContain(72);
    // And the ledger names it: an empty ledger here was a false proof.
    expect(v.ledger.length).toBeGreaterThan(0);
    expect(v.ledger.some((e) => e.cell === 72 && e.unitId === 1)).toBe(true);
    engine.release(state);
  });

  test("the control still reads the same: arriving late was always handled", () => {
    const { engine, state } = reproBoard();
    const v = assessorFor(state, 9).assessPath({
      unitId: 0,
      kind: UnitKind.Rook,
      strength: scalarOf(0, 1),
      health: 100,
      origin: 70,
      path: [71, 72],
    });
    expect(v.survival).toBe("maybe");
    expect(v.ledger.length).toBeGreaterThan(0);
    engine.release(state);
  });

  test("a landing verdict is never better than standing there for the whole turn", () => {
    // The property behind the fix, stated directly: whatever assessPath says
    // about the cell a mover comes to rest on, survivesStandingAt may not be
    // worse — a path that ends somewhere IS standing there.
    const { engine, state } = reproBoard();
    const ra = assessorFor(state, 9);
    const rank = { no: 0, maybe: 1, yes: 2 } as const;
    for (const cell of [72, 74, 41, 52, 63]) {
      const path = assessorFor(state, 9).assessPath({
        unitId: 0,
        kind: UnitKind.Knight,
        strength: scalarOf(0, 1),
        health: 100,
        origin: 63,
        path: [cell],
      });
      const standing = ra.survivesStandingAt(scalarOf(0, 1), cell);
      // Jest takes no per-assertion message, so the label rides in the value.
      expect([
        `cell ${cell}`,
        rank[path.survival] <= rank[standing.survival],
      ]).toEqual([`cell ${cell}`, true]);
    }
    engine.release(state);
  });

  test("a cell merely PASSED THROUGH keeps the point reading", () => {
    // The fix must not turn every ray cell into a whole-turn question: a mover
    // that keeps going is not standing anywhere, and pricing transit as though
    // it were would make long rays uniformly unusable.
    const { engine, state } = reproBoard();
    const ra = assessorFor(state, 9);
    const v = ra.assessPath({
      unitId: 0,
      kind: UnitKind.Rook,
      strength: scalarOf(0, 1),
      health: 100,
      origin: 66,
      path: [67, 68, 69],
    });
    // Cell 67 is transit, and its own verdict is the sub-step-1 reading.
    const transit = v.perCell[0];
    const point = ra.encounterAt(scalarOf(0, 1), 67, 1, "yes", 0);
    expect(transit?.survival).toBe(point.survival);
    engine.release(state);
  });
});

describe("the RiskAssessor validates the two fields it is given", () => {
  test("refuses the same field for both — the mistake that reads as safety", () => {
    const { engine, state } = reproBoard();
    const field = state.field.advanceTo(10);
    expect(
      () =>
        new RiskAssessor({
          field,
          startField: field,
          terrain: TERRAIN,
          hazardDamage: 100,
          maxHealth: 100,
          food: null,
        }),
    ).toThrow(/POST-MOVE/);
    engine.release(state);
  });

  test("accepts the documented pairing", () => {
    const { engine, state } = reproBoard();
    expect(() => assessorFor(state, 9)).not.toThrow();
    engine.release(state);
  });
});

describe("orientation crosses the wire boundary through a named projection", () => {
  test("round-trips the four orthogonals", () => {
    for (const o of [0, 1, 2, 3]) {
      const v = vectorOf(o);
      expect(orientationOf(v.dx, v.dy)).toBe(o);
    }
  });

  test("projects a diagonal onto the nearest orthogonal, ties to the horizontal", () => {
    // TacticToes gives kings, queens and bishops an 8-way facing; there is no
    // index for it here. The projection is lossy and named, rather than lossy
    // and written out by hand in every consumer.
    expect(orientationOf(1, 1)).toBe(1);
    expect(orientationOf(-1, -1)).toBe(3);
    expect(orientationOf(1, 2)).toBe(2);
    expect(orientationOf(-1, 2)).toBe(2);
    expect(orientationOf(0, 0)).toBe(0);
  });

  test("no kind whose facing could be diagonal reads orientation for legality", () => {
    // The reason the projection is harmless TODAY, pinned so that making a
    // diagonal-facing kind `oriented` fails here rather than in a game.
    const diagonalFacing = [UnitKind.King, UnitKind.Queen, UnitKind.Bishop];
    for (const kind of diagonalFacing) {
      expect([profileOf(kind).name, profileOf(kind).oriented]).toEqual([
        profileOf(kind).name,
        false,
      ]);
    }
  });
});
