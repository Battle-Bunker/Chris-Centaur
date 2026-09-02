// SUB-STEP ADJUDICATION, against THIS REPO's vendored resolver.
//
// Every expectation in this file is DERIVED, not asserted from intuition: each
// case is run through src/engine-vendor/ first — the same TypeScript module
// the bot adjudicates with — and the possibility-cloud engine is required to
// agree with it outcome for outcome. Where a case exists to pin one specific
// reading of the rules, the reading is also spelled out in a comment, but the
// resolver is what fails the test.
//
// These are the directed companions to the 2000-board differential: the random
// boards prove agreement in bulk, and these prove agreement at the exact
// readings that were hard to get right — the ones a random draw hits twice in
// two thousand tries, if at all.
//
// The boundary these cases jointly pin is the one the rules draw around the
// persistent pile:
//
//   an owner that dies in the SAME sub-step as an arrival on its body does not
//   block that arrival (it is not a LIVING owner, and the pile rule is scoped
//   to a LATER sub-step) —
//   but from the next sub-step on, that cell's pile fights, and a still-LIVING
//   participant of it can be killed there, whole, wherever its head is.
//
// Ported from packages/engine/src/partial-adjudication.test.ts.

import { makeGrid, makeTerrain, newBoard, PartialEngine } from '../partial-engine/index';
import type { OracleCase } from './partial-engine-oracle';
import { engineOutcome, oracleOutcome, outcomeDiff, perimeter } from './partial-engine-oracle';

const W = 9;
const GRID = makeGrid(W, W);
const at = (x: number, y: number): number => y * W + x;
const UP = 0;
const DOWN = 2;
const LEFT = 3;
const SNAKE = 0;
const KNIGHT = 1;
const KING = 2;
const ROOK = 3;
const BISHOP = 4;

const engineFor = (tc: OracleCase): PartialEngine =>
  new PartialEngine(
    makeTerrain(GRID, perimeter(tc.width, tc.height), tc.hazards),
    { food: newBoard(GRID), potions: newBoard(GRID) },
    {
      maxUnits: 8,
      maxTrail: 16,
      hazardDamage: tc.hazardDamage,
      maxHealth: tc.maxHealth,
    },
  );

/** Run both resolvers and require total agreement; hand back the truth. */
function agreed(tc: OracleCase): ReturnType<typeof oracleOutcome> {
  const truth = oracleOutcome(tc);
  const mine = engineOutcome(engineFor(tc), tc);
  // Jest has no per-assertion message argument, so the label rides in the
  // compared value: a failure prints the diff beside the name of the thing
  // that disagreed.
  expect(['engine vs vendored resolver', outcomeDiff(truth, mine)]).toEqual([
    'engine vs vendored resolver',
    [],
  ]);
  expect([...mine.deaths.entries()].sort()).toEqual([...truth.deaths.entries()].sort());
  expect(mine.clashes).toEqual(truth.clashes);
  expect([...mine.severedCells.entries()].sort()).toEqual(
    [...truth.severedCells.entries()].sort(),
  );
  return truth;
}

const board = (
  units: OracleCase["units"],
  orders: Array<[number, number]> = [],
  extra: Partial<OracleCase> = {},
): OracleCase => ({
  width: W,
  height: W,
  units,
  food: [],
  hazards: [],
  hazardDamage: 100,
  maxHealth: 100,
  orders: new Map(orders),
  ...extra,
});

const snake = (
  unitId: number,
  cells: number[],
  orientation: number,
  over: Partial<OracleCase["units"][number]> = {},
): OracleCase["units"][number] => ({
  unitId,
  kind: SNAKE,
  team: unitId,
  cells,
  weight: cells.length,
  health: 40,
  tier: 0,
  orientation,
  ...over,
});

const piece = (
  unitId: number,
  kind: number,
  cell: number,
  over: Partial<OracleCase["units"][number]> = {},
): OracleCase["units"][number] => ({
  unitId,
  kind,
  team: unitId,
  cells: [cell],
  weight: 1,
  health: 40,
  tier: 0,
  orientation: UP,
  ...over,
});

// ---------------------------------------------------------------------------
// (a) the reported repro, and (b) its mirror orderings
// ---------------------------------------------------------------------------

describe("an owner that dies THIS sub-step does not block an arrival on its body", () => {
  test("owner dies to the WALL — the reported 2-in-2000 case", () => {
    // u0's head walks into the perimeter (a legal, fatal trail move) at the
    // same sub-step u1 steps onto one of u0's body cells. The wall tier runs
    // before the body tier, so by the time the body tier looks at the board u0
    // is not a living owner: u1 lives, and nothing has died on that cell yet
    // for a pile to hold.
    const tc = board([
      snake(0, [at(7, 1), at(7, 2), at(6, 2), at(5, 2)], UP),
      snake(1, [at(6, 3), at(6, 4)], UP, { health: 39 }),
    ]);
    const truth = agreed(tc);
    expect([...truth.deaths.keys()]).toEqual([0]);
    expect(truth.deaths.get(0)?.cause).toBe("wall");
    expect(truth.survivors.get(1)?.cells[0]).toBe(at(6, 2));
  });

  test("owner dies to a SELF-collision in the same sub-step", () => {
    // u0 steps onto its own body: three cells long, so the neck it lands on is
    // not the tail that pops, and it dies there at the self tier — again
    // before the body tier. u1's arrival on the rest of that body is untouched.
    const tc = board([
      snake(0, [at(3, 3), at(3, 4), at(4, 4)], UP),
      snake(1, [at(5, 4), at(5, 5)], UP),
    ], [[0, at(3, 4)]]);
    const truth = agreed(tc);
    expect(truth.deaths.get(0)?.cause).toBe("self");
    expect(truth.survivors.has(1)).toBe(true);
  });

  test("owner dies losing an EDGE exchange in the same sub-step", () => {
    // u0 and u2 swap cells; u0 is lighter and is squashed back onto its own
    // neck, dead at the edge tier. u1 walks onto a cell that WAS u0's body and
    // is not blocked by it.
    const tc = board([
      snake(0, [at(3, 3), at(3, 4), at(4, 4)], UP, { weight: 3 }),
      snake(1, [at(5, 5), at(5, 6)], UP),
      snake(2, [at(3, 2), at(2, 2), at(1, 2), at(1, 3)], DOWN, { weight: 4 }),
    ]);
    const truth = agreed(tc);
    expect(truth.deaths.get(0)?.cause).toBe("edge");
    expect(truth.survivors.has(1)).toBe(true);
  });

  test("but an owner condemned by the BODY TIER ITSELF still blocks: necks kill both ways", () => {
    // The other side of the same snapshot. Two trail units step onto each
    // other's necks — not onto each other's heads, which the edge tier would
    // take first — in one sub-step. Each was alive when the body tier began,
    // so each blocks the other and both die, in either roster order.
    const tc = board([
      snake(0, [at(2, 4), at(2, 5), at(2, 6)], UP),
      snake(1, [at(3, 5), at(3, 4), at(3, 3)], DOWN),
    ], [
      [0, at(3, 4)],
      [1, at(2, 5)],
    ]);
    const truth = agreed(tc);
    expect([...truth.deaths.keys()].sort()).toEqual([0, 1]);
    expect(truth.deaths.get(0)?.cause).toBe("bodyBlock");
    expect(truth.deaths.get(1)?.cause).toBe("bodyBlock");
    // Mutual annihilation: neither record may name a survivor that did not
    // outlive it — this is the gap that made pair-repair by cell miss them.
    for (const clash of truth.clashes) expect(clash.survivorID).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (c) + (d) the contrast: a pile formed EARLIER does fight, at frozen weight
// ---------------------------------------------------------------------------

describe("a pile formed at an earlier sub-step fights on", () => {
  test("the wrestling rule kills a LIVE owner at its own wrestled body cell", () => {
    // The FIX 3 case. a1's body keeps (2,2); b2 dies on it at sub-step 1, so
    // (2,2) becomes durable and a1 is one of its participants. a2's bishop
    // arrives there at sub-step 3 with a strictly higher tier: it is the
    // unique strict maximum of the WHOLE pile, so it capture-stops — and a1,
    // a losing live participant, dies there whole, at a cell that is not its
    // head.
    const tc = board(
      [
        snake(0, [at(1, 2), at(2, 2), at(3, 2)], LEFT),
        piece(1, KING, at(1, 3), { weight: 1 }),
        piece(2, BISHOP, at(5, 5), { tier: 1, weight: 1 }),
      ],
      [
        [0, at(1, 1)],
        [1, at(2, 2)],
        [2, at(2, 2)],
      ],
    );
    const truth = agreed(tc);
    expect([...truth.deaths.keys()].sort()).toEqual([0, 1]);
    expect(truth.deaths.get(1)).toEqual({ cell: at(2, 2), subStep: 1, cause: "bodyBlock" });
    expect(truth.deaths.get(0)).toEqual({ cell: at(2, 2), subStep: 3, cause: "contest" });
    // It really did move: it dies at (2,2) while standing at (1,1).
    expect([...truth.survivors.keys()]).toEqual([2]);
  });

  test("a whole dead trail stays durable through the rest of the collision phase", () => {
    // The trail unit dies at sub-step 1 on a heavier king it walked into. Its
    // material does not leave the board: the rook riding down the same row
    // reaches a cell the corpse still holds two sub-steps later, joins that
    // cell's pile, and loses to it on frozen weight.
    const tc = board(
      [
        snake(0, [at(4, 4), at(5, 4), at(6, 4)], LEFT, { weight: 3 }),
        piece(1, KING, at(3, 4), { weight: 5 }),
        piece(2, ROOK, at(8, 4), { weight: 1 }),
      ],
      [
        [0, at(3, 4)],
        [2, at(4, 4)],
      ],
    );
    const truth = agreed(tc);
    expect(truth.deaths.get(0)).toEqual({ cell: at(3, 4), subStep: 1, cause: "contest" });
    expect(truth.deaths.get(2)?.cause).toBe("contest");
    expect(truth.deaths.get(2)?.subStep).toBeGreaterThan(1);
    expect([...truth.survivors.keys()]).toEqual([1]);
  });

  test("a pile fights at FROZEN weight, not at what the survivor grew to", () => {
    const tc = board(
      [
        snake(0, [at(4, 4), at(4, 5), at(4, 6)], UP, { weight: 3 }),
        piece(1, KNIGHT, at(3, 6), { weight: 5 }),
        piece(2, ROOK, at(8, 5), { weight: 4 }),
      ],
      [
        [1, at(4, 5)],
        [2, at(4, 5)],
      ],
      { food: [at(4, 3)] },
    );
    agreed(tc);
  });
});

// ---------------------------------------------------------------------------
// same-sub-step ordering: an edge winner is an ordinary arrival everywhere else
// ---------------------------------------------------------------------------

describe("an edge winner is adjudicated like any other arrival", () => {
  test("it contests the cell it took against a third unit arriving there", () => {
    const tc = board(
      [
        piece(0, KING, at(4, 4), { weight: 4 }),
        piece(1, KING, at(4, 5), { weight: 2 }),
        piece(2, KNIGHT, at(3, 3), { weight: 5 }),
      ],
      [
        [0, at(4, 5)],
        [1, at(4, 4)],
        [2, at(4, 5)],
      ],
    );
    agreed(tc);
  });

  test("it is not counted twice in its own contest", () => {
    // Equal weights: if the winner were both an arrival and an incumbent at
    // the cell it took, it would tie with itself and die on its own capture.
    const tc = board(
      [
        piece(0, KING, at(4, 4), { weight: 3 }),
        piece(1, KING, at(4, 5), { weight: 2 }),
      ],
      [
        [0, at(4, 5)],
        [1, at(4, 4)],
      ],
    );
    const truth = agreed(tc);
    expect([...truth.survivors.keys()]).toEqual([0]);
  });
});
