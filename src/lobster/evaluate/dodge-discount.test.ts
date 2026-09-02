/**
 * THE DODGE DISCOUNT, EXERCISED ON NATURAL BOARDS.
 *
 * The owner's numeric illustrations (2/3–1/3, 1/8) are INDICATIVE and are not
 * test targets — his own correction, relayed 2026-08-30. So no board here is
 * contrived to reproduce them. Every expected value below is derived from the
 * cover counts the board itself produces, and the counts are asserted first, so
 * a failure says which of the two moved: the board's geometry, or the
 * arithmetic over it.
 *
 * ONE BOARD carries most of the file. A 9×9 (perimeter included, interior 7×7)
 * with our king at (4,4) and an enemy queen at (4,2). The king's nine plausible
 * moves and the queen's eight rays are the natural counts; three rays reach us,
 * covering 3, 1 and 1 of them, and every number in tests 1–3 falls out of that
 * (3, 1, 1).
 */

import {
  NO_DISCOUNT,
  coverSetsFor,
  chainedDiscount,
  dodgeDiscount,
  dodgeTerrain,
  plausibleMoves,
} from './dodge-discount';
import type { DodgeDiscountOptions } from './dodge-discount';
import { NO_REACH } from './attack-window';
import type { ArrivalReach } from './attack-window';
import { indexOccupancy } from './ray-crossing';
import type { RayBoard, RayUnit } from './ray-crossing';
import { potionSeek, potionSeekNet } from './potion-seek';
import { UnitKind, legalMoves, makeGrid, makeTerrain } from '../../partial-engine/index';

// ---------------------------------------------------------------------------
// board fixtures
// ---------------------------------------------------------------------------

const W = 9;
const H = 9;
/** Full-board index from interior coordinates. x,y ∈ [1,7] are interior. */
const at = (x: number, y: number): number => y * W + x;

const piece = (
  unitId: string,
  team: number,
  kind: UnitKind,
  cell: number,
  weight = 3
): RayUnit => ({
  unitId,
  team,
  kind,
  occupancy: [cell],
  weight,
  tier: 0,
  health: 100,
});

const snake = (unitId: string, team: number, cells: ReadonlyArray<number>): RayUnit => ({
  unitId,
  team,
  kind: UnitKind.Snake,
  occupancy: cells,
  weight: cells.length,
  tier: 0,
  health: 100,
});

const boardOf = (units: ReadonlyArray<RayUnit>, turn = 0): RayBoard => ({
  width: W,
  height: H,
  units,
  turn,
});

/**
 * A reach map that admits every enemy at `turn + 1`. The gate is not what is
 * under test in most of this file — the cover counting is — and a permissive
 * gate keeps a gate bug from masquerading as a cover bug.
 */
const OPEN_REACH: ArrivalReach = { earliestAt: () => 1 };

/** The reference arithmetic, written out again from the cover counts alone. */
function referenceRisk(
  covers: ReadonlyArray<ReadonlyArray<number>>,
  n: number
): number[] {
  const s = covers.reduce((a, c) => a + c.length, 0);
  const d = new Array<number>(n).fill(0);
  if (s === 0) return d;
  for (const c of covers) {
    const w = c.length / s;
    for (const i of c) d[i] += w;
  }
  return d;
}

// The king-vs-queen board, and the pieces of it the tests name.
const KING = at(4, 4);
const QUEEN = at(4, 2);
const ourKing = (): RayUnit => piece('king', 0, UnitKind.King, KING);
const theirQueen = (): RayUnit => piece('queen', 1, UnitKind.Queen, QUEEN, 5);
const openBoard = (): RayBoard => boardOf([ourKing(), theirQueen()]);

const OPTS: DodgeDiscountOptions = { turn: 0, reach: OPEN_REACH };

describe('the prior support — legal moves minus the rules-certain fatal ones', () => {
  test('a trail unit\'s legal wall move is a suicide, and is not an escape', () => {
    // `legalMoves` emits perimeter cells for a trail unit (`mayEnterWall`) and
    // entering one kills it, so counting it would inflate n and shrink the risk.
    const u = snake('s', 0, [at(1, 3), at(1, 4), at(1, 5)]);
    const board = boardOf([u]);
    const terrain = makeTerrain(makeGrid(W, H), [], []);
    const legal = legalMoves(terrain, UnitKind.Snake, at(1, 3));
    expect(legal).toContain(at(0, 3));
    expect(plausibleMoves(board, u, { turn: 0 })).not.toContain(at(0, 3));
  });

  test('an occupied cell is fatal for a −1 unit and is not an escape', () => {
    const u = snake('s', 0, [at(4, 4), at(4, 5)]);
    const ally = piece('ally', 0, UnitKind.King, at(3, 4));
    const enemy = piece('foe', 1, UnitKind.King, at(5, 4));
    const board = boardOf([u, ally, enemy]);
    const m = plausibleMoves(board, u, { turn: 0 });
    // Its own body counts too: a mover dies on a body cell unless its tier is
    // strictly higher, and at −1 it never is.
    expect(m).not.toContain(at(3, 4));
    expect(m).not.toContain(at(5, 4));
    expect(m).not.toContain(at(4, 5));
    expect(m).toEqual([at(4, 3)]);
  });

  test('a hazard cell is an escape only because the engine\'s generator cannot see it', () => {
    // `legalMoves` tests `standableFor`, which is terrain-minus-WALL: the
    // hazard board is never consulted. So the exclusion has to be explicit,
    // and a caller that does not pass its hazards gets the optimistic count —
    // which is the term's single largest source of optimism, stated rather
    // than hidden.
    const u = ourKing();
    const board = boardOf([u]);
    const hazard = at(4, 3);
    expect(plausibleMoves(board, u, { turn: 0 })).toContain(hazard);
    expect(
      plausibleMoves(board, u, { turn: 0, hazardCells: [hazard] })
    ).not.toContain(hazard);
  });

  test('a borrowed terrain is the same terrain, and is the same answer', () => {
    // `makeTerrain` walks every cell of the board to stamp the perimeter, so a
    // caller pricing several units on one board builds it once. Borrowing it
    // must not be able to change a number — only the bill.
    const board = openBoard();
    const hazards = [at(4, 3), at(5, 5)];
    const built = dodgeDiscount(board, ourKing(), { ...OPTS, hazardCells: hazards });
    const borrowed = dodgeDiscount(board, ourKing(), {
      ...OPTS,
      terrain: dodgeTerrain(board, [], hazards),
    });
    expect(borrowed).toEqual(built);
  });

  test('an injected move set replaces the local generator entirely', () => {
    // The production wiring: the safety floor's own surviving candidates are
    // "the moves we would actually consider", and passing them makes the
    // prior's support the floor's support by construction. Nothing is
    // re-filtered — including cells the local generator would have refused.
    const u = ourKing();
    const board = boardOf([u, theirQueen()]);
    const injected = [at(4, 3), at(0, 0)];
    expect(plausibleMoves(board, u, { turn: 0, moves: injected })).toBe(injected);
    expect(dodgeDiscount(board, u, { ...OPTS, moves: injected }).moves).toBe(injected);
  });

  test('an oriented kind refuses rather than inventing a move set', () => {
    const pawn = piece('p', 0, UnitKind.Pawn, at(4, 4));
    const v = dodgeDiscount(boardOf([pawn, theirQueen()]), pawn, OPTS);
    expect(v.refusal).toBe('oriented-unit');
    expect(v.applicable).toBe(false);
    expect(v.discount).toEqual(NO_DISCOUNT);
  });
});

describe('the rule, against the board\'s own counts', () => {
  test('the cover sets are what the rays actually cross', () => {
    const board = openBoard();
    const u = ourKing();
    const moves = plausibleMoves(board, u, { turn: 0 });
    // The king holds (stayLegal) and steps eight ways; nothing is occupied,
    // walled or hazardous, so n = 9.
    expect(moves).toHaveLength(9);
    const walkBoard: RayBoard = { ...board, units: [theirQueen()] };
    const covers = coverSetsFor(
      walkBoard,
      theirQueen(),
      moves,
      indexOccupancy(walkBoard, 0)
    );
    // Three of the queen's eight rays reach us: the file below her covers
    // (4,3), (4,4) and (4,5); the two forward diagonals cover one cell each.
    expect(covers.map((c) => c.length)).toEqual([3, 1, 1]);
  });

  test('w(r) = |C(r)|/S and d(m) = Σ_{r ∋ m} w(r), against those counts', () => {
    const board = openBoard();
    const u = ourKing();
    const v = dodgeDiscount(board, u, OPTS);
    expect(v.applicable).toBe(true);
    expect(v.attackers).toEqual(['queen']);

    const walkBoard: RayBoard = { ...board, units: [theirQueen()] };
    const covers = coverSetsFor(
      walkBoard,
      theirQueen(),
      v.moves,
      indexOccupancy(walkBoard, 0)
    );
    const expected = referenceRisk(covers, v.branching);
    for (let i = 0; i < v.branching; i++) {
      expect(v.perMove[i]).toBeCloseTo(expected[i] as number, 12);
    }

    // And the same numbers written out from S = 3 + 1 + 1 = 5, so the test
    // fails on an arithmetic change and not only on a board change.
    const idx = (cell: number): number => v.moves.indexOf(cell);
    expect(v.perMove[idx(at(4, 3))]).toBeCloseTo(3 / 5, 12);
    expect(v.perMove[idx(at(4, 4))]).toBeCloseTo(3 / 5, 12);
    expect(v.perMove[idx(at(4, 5))]).toBeCloseTo(3 / 5, 12);
    expect(v.perMove[idx(at(5, 3))]).toBeCloseTo(1 / 5, 12);
    expect(v.perMove[idx(at(3, 3))]).toBeCloseTo(1 / 5, 12);
    expect(v.perMove[idx(at(3, 4))]).toBe(0);
    expect(v.perMove[idx(at(5, 4))]).toBe(0);
    // mean = (3·(3/5) + 2·(1/5)) / 9
    expect(v.discount.mean).toBeCloseTo(11 / 45, 12);
    expect(v.discount.best).toBe(0);
    expect(v.discount.worst).toBeCloseTo(3 / 5, 12);
  });

  test('a cover move that hits strictly more of our options carries strictly more mass', () => {
    const board = openBoard();
    const moves = plausibleMoves(board, ourKing(), { turn: 0 });
    const walkBoard: RayBoard = { ...board, units: [theirQueen()] };
    const covers = coverSetsFor(
      walkBoard,
      theirQueen(),
      moves,
      indexOccupancy(walkBoard, 0)
    );
    const s = covers.reduce((a, c) => a + c.length, 0);
    const sorted = [...covers].sort((a, b) => b.length - a.length);
    const big = sorted[0] as ReadonlyArray<number>;
    const small = sorted[sorted.length - 1] as ReadonlyArray<number>;
    expect(big.length).toBeGreaterThan(small.length);
    expect(big.length / s).toBeGreaterThan(small.length / s);
  });

  test('a move only one cover move touches costs exactly that move\'s mass', () => {
    // Property (b) of the ruling, read off this board: (5,3) lies on the
    // queen's forward diagonal and on nothing else, so choosing it costs
    // w(that ray) = 1/5 and not the 3/5 the file below her carries.
    const board = openBoard();
    const v = dodgeDiscount(board, ourKing(), OPTS);
    const walkBoard: RayBoard = { ...board, units: [theirQueen()] };
    const covers = coverSetsFor(
      walkBoard,
      theirQueen(),
      v.moves,
      indexOccupancy(walkBoard, 0)
    );
    const i = v.moves.indexOf(at(5, 3));
    const touching = covers.filter((c) => c.includes(i));
    expect(touching).toHaveLength(1);
    const s = covers.reduce((a, c) => a + c.length, 0);
    expect(v.perMove[i]).toBeCloseTo((touching[0] as ReadonlyArray<number>).length / s, 12);
  });
});

describe('branching and monotonicity', () => {
  /** The same king and queen, with some of the king's free space taken by us. */
  const boxedBy = (cells: ReadonlyArray<number>): RayBoard =>
    boardOf([
      ourKing(),
      theirQueen(),
      ...cells.map((c, i) => piece(`ally${i}`, 0, UnitKind.King, c)),
    ]);

  // The four squares our own pieces stand on below are exactly the ones NO
  // queen ray reaches, so the cover sets are identical on both boards and the
  // only thing that differs is our branching.
  const FREE = [at(3, 4), at(5, 4), at(3, 5), at(5, 5)];

  test('the higher-branching board discounts strictly harder', () => {
    const open = dodgeDiscount(openBoard(), ourKing(), OPTS);
    const boxed = dodgeDiscount(boxedBy(FREE), ourKing(), OPTS);
    expect(open.branching).toBe(9);
    expect(boxed.branching).toBe(5);
    expect(open.discount.mean).toBeLessThan(boxed.discount.mean);
    // Same S, same masses; only n moved. 11/5 spread over 9 against over 5.
    expect(open.discount.mean).toBeCloseTo(11 / 45, 12);
    expect(boxed.discount.mean).toBeCloseTo(11 / 25, 12);
  });

  test('an extra escape no enemy move covers never raises the risk', () => {
    const before = dodgeDiscount(boxedBy(FREE), ourKing(), OPTS);
    const after = dodgeDiscount(boxedBy(FREE.slice(0, 3)), ourKing(), OPTS);
    expect(after.branching).toBe(before.branching + 1);
    expect(after.discount.mean).toBeLessThan(before.discount.mean);
    // Every move that already existed keeps exactly the risk it had.
    for (let i = 0; i < before.moves.length; i++) {
      const j = after.moves.indexOf(before.moves[i] as number);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(after.perMove[j]).toBeCloseTo(before.perMove[i] as number, 12);
    }
    // And the new square is genuinely free.
    expect(after.perMove[after.moves.indexOf(at(5, 5))]).toBe(0);
  });

  test('an extra escape that IS covered raises the mean, and that is not a bug', () => {
    // Documented in the design as a property to pin rather than patch: under a
    // uniform prior, adding an option that walks into an existing sweep raises
    // that sweep's attractiveness and a player picking uniformly does worse.
    // Injected support isolates it — the board, and therefore every cover set,
    // is untouched between the two readings.
    const board = openBoard();
    const base = [at(4, 4), at(3, 4), at(5, 4)];
    const withCovered = dodgeDiscount(board, ourKing(), {
      ...OPTS,
      moves: [...base, at(4, 5)],
    });
    const withUncovered = dodgeDiscount(board, ourKing(), {
      ...OPTS,
      moves: [...base, at(3, 5)],
    });
    const plain = dodgeDiscount(board, ourKing(), { ...OPTS, moves: base });
    // (4,4) alone lies under the queen's file here, so S = 1 and mean = 1/3.
    expect(plain.discount.mean).toBeCloseTo(1 / 3, 12);
    // (4,5) is on that same file: the ray now covers two of three, S = 2.
    expect(withCovered.discount.mean).toBeCloseTo(2 / 4, 12);
    expect(withCovered.discount.mean).toBeGreaterThan(plain.discount.mean);
    // (3,5) is on none of her rays: same S, one more square to hide on.
    expect(withUncovered.discount.mean).toBeCloseTo(1 / 4, 12);
    expect(withUncovered.discount.mean).toBeLessThan(plain.discount.mean);
  });
});

describe('the [0,1] invariants', () => {
  test('a square every enemy reply covers scores exactly 1', () => {
    // A snake with one way out, and the queen's file is on it. The discount
    // cannot talk a unit out of a square it cannot survive.
    const u = snake('s', 0, [at(4, 4), at(4, 5), at(4, 6)]);
    const board = boardOf([
      u,
      theirQueen(),
      piece('a1', 0, UnitKind.King, at(3, 4)),
      piece('a2', 0, UnitKind.King, at(5, 4)),
    ]);
    const v = dodgeDiscount(board, u, OPTS);
    expect(v.moves).toEqual([at(4, 3)]);
    expect(v.perMove).toEqual([1]);
    expect(v.discount).toEqual({ best: 1, mean: 1, worst: 1 });
  });

  test('S = 0 is zero risk, not a refusal — a gated attacker that covers nothing', () => {
    // The knight is admitted by the gate and walked; none of its eight jumps
    // lands on any of our nine squares, so it contributes a factor of 1 and
    // the model says what it means: nothing here can touch us this turn.
    const u = ourKing();
    const knight = piece('n', 1, UnitKind.Knight, at(1, 1));
    const v = dodgeDiscount(boardOf([u, knight]), u, OPTS);
    expect(v.applicable).toBe(true);
    expect(v.refusal).toBeNull();
    expect(v.attackers).toEqual(['n']);
    expect(v.perMove.every((d) => d === 0)).toBe(true);
    expect(v.discount).toEqual({ best: 0, mean: 0, worst: 0 });
  });

  test('an empty gate refuses instead, because an absent map is not a safe board', () => {
    const u = ourKing();
    const v = dodgeDiscount(boardOf([u, theirQueen()]), u, { turn: 0, reach: NO_REACH });
    expect(v.applicable).toBe(false);
    expect(v.refusal).toBe('unreachable');
    expect(v.discount).toEqual(NO_DISCOUNT);
  });

  test('best ≤ mean ≤ worst, and all three stay inside [0,1]', () => {
    const boards: ReadonlyArray<[string, RayBoard, RayUnit]> = [
      ['open', openBoard(), ourKing()],
      [
        'two attackers',
        boardOf([ourKing(), theirQueen(), piece('k', 1, UnitKind.King, at(6, 4))]),
        ourKing(),
      ],
      ['knight only', boardOf([ourKing(), piece('n', 1, UnitKind.Knight, at(1, 1))]), ourKing()],
    ];
    for (const [name, board, unit] of boards) {
      const d = dodgeDiscount(board, unit, OPTS).discount;
      expect(`${name}:${d.best <= d.mean && d.mean <= d.worst}`).toBe(`${name}:true`);
      expect(d.best).toBeGreaterThanOrEqual(0);
      expect(d.worst).toBeLessThanOrEqual(1);
    }
  });
});

describe('multiple attackers', () => {
  const enemyKing = (): RayUnit => piece('eking', 1, UnitKind.King, at(6, 4));
  const twoAttackers = (): RayBoard => boardOf([ourKing(), theirQueen(), enemyKing()]);

  const soloRisk = (attacker: RayUnit, moves: ReadonlyArray<number>): number[] => {
    const walkBoard: RayBoard = { ...twoAttackers(), units: [theirQueen(), enemyKing()] };
    return referenceRisk(
      coverSetsFor(walkBoard, attacker, moves, indexOccupancy(walkBoard, 0)),
      moves.length
    );
  };

  test('the combined risk never falls below the worst single attacker', () => {
    const v = dodgeDiscount(twoAttackers(), ourKing(), OPTS);
    expect(v.attackers).toEqual(['queen', 'eking']);
    const a = soloRisk(theirQueen(), v.moves);
    const b = soloRisk(enemyKing(), v.moves);
    let sawStrict = false;
    for (let i = 0; i < v.moves.length; i++) {
      const floor = Math.max(a[i] as number, b[i] as number);
      expect(v.perMove[i]).toBeGreaterThanOrEqual(floor - 1e-12);
      expect(v.perMove[i]).toBeLessThanOrEqual(1);
      // Independent survival: 1 − Π(1 − d_a).
      expect(v.perMove[i]).toBeCloseTo(
        1 - (1 - (a[i] as number)) * (1 - (b[i] as number)),
        12
      );
      if ((v.perMove[i] as number) > floor + 1e-12) sawStrict = true;
    }
    // The board is not degenerate: somewhere the two attackers actually stack.
    expect(sawStrict).toBe(true);
  });

  test('adding an attacker never makes the board look safer', () => {
    const one = dodgeDiscount(openBoard(), ourKing(), OPTS);
    const two = dodgeDiscount(twoAttackers(), ourKing(), OPTS);
    expect(two.discount.mean).toBeGreaterThan(one.discount.mean);
  });
});

describe('the window chain', () => {
  test('the default window keeps the undiscounted worst case', () => {
    // d₁ is computed; d_t = 1 for t ≥ 2, because past the first step the
    // model cannot generate the unit's move set. So the product is 1.
    expect(chainedDiscount([0.25], 3)).toBe(1);
    expect(chainedDiscount([0.25], 1)).toBeCloseTo(0.25, 12);
    expect(chainedDiscount([0.5, 0.5], 2)).toBeCloseTo(0.75, 12);
    expect(chainedDiscount([], 3)).toBe(1);
  });
});

describe('determinism', () => {
  test('the same board twice produces the same value', () => {
    const first = dodgeDiscount(
      boardOf([ourKing(), theirQueen(), piece('k', 1, UnitKind.King, at(6, 4))]),
      ourKing(),
      OPTS
    );
    const second = dodgeDiscount(
      boardOf([ourKing(), theirQueen(), piece('k', 1, UnitKind.King, at(6, 4))]),
      ourKing(),
      OPTS
    );
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

// ---------------------------------------------------------------------------
// the wiring
// ---------------------------------------------------------------------------

describe('the potion-seek wiring', () => {
  // A collector one step from the potion, an ally, and an enemy queen that can
  // be on the potion cell inside the near span — so `contestedNear` is true and
  // the discount is computed. This is the only path on which it runs at all.
  const POTION = at(4, 4);
  const collector = (): RayUnit => piece('collector', 0, UnitKind.King, at(4, 5), 4);
  const ally = (): RayUnit => piece('ally', 0, UnitKind.Rook, at(2, 6), 3);
  const enemySnake = (): RayUnit =>
    snake('esnake', 1, [at(6, 6), at(6, 5), at(6, 4), at(6, 3)]);

  const wiringBoard = (): RayBoard =>
    boardOf([collector(), ally(), theirQueen(), enemySnake()]);

  /** Collector arrives next turn; the queen can be on the potion cell then. */
  const reach: ArrivalReach = OPEN_REACH;

  test('absent the option, nothing changes — the pre-change exposure, field for field', () => {
    const board = wiringBoard();
    const v = potionSeek(board, collector(), POTION, { turn: 0, reach });
    expect(v.reachable).toBe(true);
    expect(v.collectAtTurn).toBe(1);
    expect(v.travelTurns).toBe(1);
    expect(v.exposure.contestedNear).toBe(true);
    // The pre-change arithmetic, written out: the collector's WHOLE weight on
    // the near endpoint, the whole weight on the window endpoint, and the
    // discount field inert.
    expect(v.exposure).toEqual({
      weightAtRisk: 4,
      contested: true,
      weightAtRiskNear: 4,
      contestedNear: true,
      nearDiscount: NO_DISCOUNT,
      windowAtRisk: v.gain.est,
      debuffUntilTurn: 4,
    });
    // And the fold that reads it is unchanged: near cost is the raw weight.
    expect(potionSeekNet(v, 2, { exposure: 'near' })).toBeCloseTo(
      2 * v.gain.est - 4,
      12
    );
  });

  test('with the option, only the near endpoint moves', () => {
    const board = wiringBoard();
    const off = potionSeek(board, collector(), POTION, { turn: 0, reach });
    const on = potionSeek(board, collector(), POTION, {
      turn: 0,
      reach,
      dodge: {},
    });
    expect(on.exposure.nearDiscount.mean).toBeGreaterThan(0);
    expect(on.exposure.nearDiscount.mean).toBeLessThan(1);
    expect(on.exposure.weightAtRiskNear).toBeCloseTo(
      4 * on.exposure.nearDiscount.mean,
      12
    );
    expect(on.exposure.weightAtRiskNear).toBeLessThan(off.exposure.weightAtRiskNear);
    // The window endpoint, the booleans and the gain are untouched: the
    // bracket keeps its shape and only the endpoint inside it is graded.
    expect(on.exposure.weightAtRisk).toBe(off.exposure.weightAtRisk);
    expect(on.exposure.contested).toBe(off.exposure.contested);
    expect(on.exposure.contestedNear).toBe(off.exposure.contestedNear);
    expect(on.exposure.windowAtRisk).toBe(off.exposure.windowAtRisk);
    expect(on.gain).toEqual(off.gain);
    expect(on.armedAllies).toBe(off.armedAllies);
  });

  test('the discount is computed from the potion cell, not the collector\'s square', () => {
    // `origin: potionCell` is the point of the wiring: the collector's square
    // after the collection is the one square over the whole window the model
    // actually knows.
    const board = wiringBoard();
    const on = potionSeek(board, collector(), POTION, { turn: 0, reach, dodge: {} });
    const direct = dodgeDiscount(board, collector(), {
      turn: 1,
      reach,
      origin: POTION,
    });
    expect(on.exposure.nearDiscount).toEqual(direct.discount);
  });

  test('hazards passed through the option make the collector less brave', () => {
    const board = wiringBoard();
    const bare = potionSeek(board, collector(), POTION, { turn: 0, reach, dodge: {} });
    const withHazards = potionSeek(board, collector(), POTION, {
      turn: 0,
      reach,
      dodge: { hazardCells: [at(3, 3), at(3, 4), at(3, 5)] },
    });
    expect(withHazards.exposure.nearDiscount.mean).toBeGreaterThan(
      bare.exposure.nearDiscount.mean
    );
  });

  test('an unreachable potion carries the inert discount too', () => {
    const board = wiringBoard();
    const v = potionSeek(board, collector(), POTION, {
      turn: 0,
      reach: NO_REACH,
      dodge: {},
    });
    expect(v.reachable).toBe(false);
    expect(v.exposure.nearDiscount).toEqual(NO_DISCOUNT);
  });
});
