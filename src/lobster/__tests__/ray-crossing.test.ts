/**
 * THE RAY-CROSSING PRIMITIVE AND `sliderAttackVector`, ON HAND-BUILT BOARDS.
 *
 * Every board here is written out cell by cell so the expected answer can be
 * counted by hand. The primitive's whole claim is that it reports what is
 * actually on a ray, in order, priced by the engine's own sever rule — so the
 * test is exactly "walk a ray, check what it says is on it".
 *
 * The headline case is the gap the portfolio names: a queen aligned along a
 * twelve-cell enemy body against the same queen aligned along empty space. The
 * shipped `command` term scores those identically (it counts contested ground
 * and food and has no enemy-body term at all); this one must not.
 */

import { UnitKind } from '../../partial-engine/index';
import {
  anyBodyOnBoard,
  indexOccupancy,
  rayCrossings,
  tierAt,
} from '../evaluate/ray-crossing';
import type { RayBoard, RayUnit } from '../evaluate/ray-crossing';
import {
  SLIDER_ATTACK_VECTOR_ENTRY,
  compareSliderAttack,
  orderingScore,
  severExchangeRate,
  sliderAttackOptions,
  sliderAttackVector,
  sliderDestinations,
  threatScore,
} from '../evaluate/slider-attack-vector';

// A 16x16 full board: the perimeter is the wall, the interior is x,y in 1..14.
const W = 16;
const H = 16;
const at = (x: number, y: number): number => y * W + x;

/** A twelve-cell snake running down the file x = 5, head at the top. */
const BODY_12 = Array.from({ length: 12 }, (_, i) => at(5, 2 + i));

const enemySnake = (over: Partial<RayUnit> = {}): RayUnit => ({
  unitId: 'enemy-snake',
  team: 1,
  kind: UnitKind.Snake,
  occupancy: BODY_12,
  weight: BODY_12.length,
  tier: 0,
  health: 100,
  ...over,
});

const ourQueen = (over: Partial<RayUnit> = {}): RayUnit => ({
  unitId: 'our-queen',
  team: 0,
  kind: UnitKind.Queen,
  occupancy: [at(2, 5)],
  weight: 3,
  tier: 1,
  health: 100,
  ...over,
});

const boardOf = (units: RayUnit[], turn = 10): RayBoard => ({
  width: W,
  height: H,
  units,
  turn,
});

const eastRay = (walks: ReadonlyArray<{ dx: number; dy: number }>): number =>
  walks.findIndex((w) => w.dx === 1 && w.dy === 0);

describe('rayCrossings — the ordered walk', () => {
  it('separates a queen on a twelve-cell body from the same queen on empty space', () => {
    const queen = ourQueen();
    const loaded = rayCrossings(boardOf([queen, enemySnake()]), queen);
    const empty = rayCrossings(boardOf([queen]), queen);

    const severWeight = (walks: typeof loaded): number =>
      walks.reduce(
        (s, w) => s + (w.terminal.verdict === 'sever' ? w.terminal.enemyWeightRemoved : 0),
        0
      );
    const killWeight = (walks: typeof loaded): number =>
      walks.reduce(
        (s, w) => s + (w.terminal.verdict === 'kill' ? w.terminal.enemyWeightRemoved : 0),
        0
      );

    // Three of the eight rays reach the body: east at occupancy index 3 (cut 9),
    // down-right at index 6 (cut 6), and up-right onto the HEAD, which is a
    // contest and not a cut.
    expect(severWeight(loaded)).toBe(9 + 6);
    expect(killWeight(loaded)).toBe(12);
    expect(severWeight(empty)).toBe(0);
    expect(killWeight(empty)).toBe(0);
    // And the empty board's rays all end at the wall with nothing on them.
    expect(empty.every((w) => w.terminal.verdict === 'wall')).toBe(true);
  });

  it('prices the cut at the crossing index, not at the head or the tail', () => {
    const queen = ourQueen();
    const snake = enemySnake();
    const board = boardOf([queen, snake]);
    const east = rayCrossings(board, queen)[eastRay(rayCrossings(board, queen))];
    expect(east.terminal.verdict).toBe('sever');
    expect(east.terminal.cell).toBe(at(5, 5));
    expect(east.terminal.occupants[0]?.occIndex).toBe(3);
    expect(east.terminal.enemyWeightRemoved).toBe(12 - 3);

    // The same snake met one row further down cuts one cell less.
    const lower = ourQueen({ occupancy: [at(2, 6)] });
    const lowerBoard = boardOf([lower, snake]);
    const lowerWalks = rayCrossings(lowerBoard, lower);
    const lowerEast = lowerWalks[eastRay(lowerWalks)];
    expect(lowerEast.terminal.occupants[0]?.occIndex).toBe(4);
    expect(lowerEast.terminal.enemyWeightRemoved).toBe(12 - 4);

    // Meeting the tail cell cuts exactly one.
    const tailward = ourQueen({ occupancy: [at(2, 13)] });
    const tailBoard = boardOf([tailward, snake]);
    const tailWalks = rayCrossings(tailBoard, tailward);
    const tailEast = tailWalks[eastRay(tailWalks)];
    expect(tailEast.terminal.occupants[0]?.occIndex).toBe(11);
    expect(tailEast.terminal.enemyWeightRemoved).toBe(1);
  });

  it('dies on a body it does not outrank, and severs one it does', () => {
    const snake = enemySnake();
    const flat = ourQueen({ tier: 0 });
    const flatWalks = rayCrossings(boardOf([flat, snake]), flat);
    const flatEast = flatWalks[eastRay(flatWalks)];
    expect(flatEast.terminal.verdict).toBe('die');
    expect(flatEast.terminal.enemyWeightRemoved).toBe(0);
    expect(flatEast.terminal.ownWeightRisked).toBe(3);

    // Equal tier is still death: the rule is STRICTLY higher.
    const matched = ourQueen({ tier: 1 });
    const matchedWalks = rayCrossings(boardOf([matched, enemySnake({ tier: 1 })]), matched);
    expect(matchedWalks[eastRay(matchedWalks)].terminal.verdict).toBe('die');
  });

  it('stops at the first thing on the ray, whatever is behind it', () => {
    // A rook, so the only ray that can reach the body is the east one and the
    // claim "nothing behind the blocker is on offer" is exact.
    const queen = ourQueen({ kind: UnitKind.Rook });
    const blocker: RayUnit = {
      unitId: 'enemy-rook',
      team: 1,
      kind: UnitKind.Rook,
      occupancy: [at(3, 5)],
      weight: 20,
      tier: 0,
      health: 100,
    };
    const walks = rayCrossings(boardOf([queen, blocker, enemySnake()]), queen);
    const east = walks[eastRay(walks)];
    // Tier ranks strictly before weight, so a tier-1 queen of weight 3 takes a
    // tier-0 rook of weight 20 — and stops there, so the sever behind it is not
    // on offer this turn.
    expect(east.terminal.verdict).toBe('kill');
    expect(east.terminal.cell).toBe(at(3, 5));
    expect(east.terminal.enemyWeightRemoved).toBe(20);
    expect(walks.reduce((s, w) => s + (w.terminal.verdict === 'sever' ? 1 : 0), 0)).toBe(0);
  });

  it('reads a contest by tier first and weight second, and calls a draw a tie', () => {
    const queen = ourQueen({ tier: 0, weight: 5 });
    const heavier: RayUnit = {
      unitId: 'enemy-bishop',
      team: 1,
      kind: UnitKind.Bishop,
      occupancy: [at(4, 5)],
      weight: 9,
      tier: 0,
      health: 100,
    };
    const lose = rayCrossings(boardOf([queen, heavier]), queen);
    expect(lose[eastRay(lose)].terminal.verdict).toBe('die');

    const level = rayCrossings(
      boardOf([queen, { ...heavier, weight: 5 }]),
      queen
    );
    expect(level[eastRay(level)].terminal.verdict).toBe('tie');
    expect(level[eastRay(level)].terminal.ownWeightRisked).toBe(5);
  });

  it('reports a friendly cut on our own side of the ledger', () => {
    const queen = ourQueen();
    const walks = rayCrossings(
      boardOf([queen, enemySnake({ unitId: 'ally-snake', team: 0 })]),
      queen
    );
    const east = walks[eastRay(walks)];
    expect(east.terminal.verdict).toBe('sever');
    expect(east.terminal.enemyWeightRemoved).toBe(0);
    expect(east.terminal.allyWeightRemoved).toBe(9);
  });

  it('marks a crossing the health budget cannot pay for', () => {
    const queen = ourQueen({ health: 3 });
    const walks = rayCrossings(boardOf([queen, enemySnake()]), queen);
    // Health 3 buys two cells and still leaves the unit alive; the crossing is
    // three cells out, so it is a real fact about the ray and not a move.
    expect(walks[eastRay(walks)].terminal.step).toBe(3);
    expect(walks[eastRay(walks)].terminal.withinHealth).toBe(false);
    const healthy = ourQueen({ health: 100 });
    const ok = rayCrossings(boardOf([healthy, enemySnake()]), healthy);
    expect(ok[eastRay(ok)].terminal.withinHealth).toBe(true);
  });

  it('gives a stepper no rays at all, which is the gate for free', () => {
    const snake = enemySnake({ unitId: 'ours', team: 0 });
    expect(rayCrossings(boardOf([snake]), snake)).toEqual([]);
    const knight: RayUnit = {
      unitId: 'our-knight',
      team: 0,
      kind: UnitKind.Knight,
      occupancy: [at(2, 5)],
      weight: 2,
      tier: 0,
      health: 100,
    };
    expect(rayCrossings(boardOf([knight]), knight)).toEqual([]);
  });

  it('walks from a counterfactual origin without moving the unit', () => {
    const queen = ourQueen();
    const board = boardOf([queen, enemySnake()]);
    // From (2,13) the east ray meets the tail; the unit itself has not moved.
    const walks = rayCrossings(board, queen, { origin: at(2, 13) });
    expect(walks[eastRay(walks)].terminal.enemyWeightRemoved).toBe(1);
    expect(queen.occupancy[0]).toBe(at(2, 5));
  });

  it('is deterministic and allocation-order independent', () => {
    const queen = ourQueen();
    const a = rayCrossings(boardOf([queen, enemySnake()]), queen);
    const b = rayCrossings(boardOf([enemySnake(), queen]), queen);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gates on there being any body to cut', () => {
    expect(anyBodyOnBoard(boardOf([ourQueen()]))).toBe(false);
    expect(anyBodyOnBoard(boardOf([ourQueen(), enemySnake()]))).toBe(true);
  });

  it('reads tier timing off the inclusive expiry the wire carries', () => {
    const buffed = ourQueen({ tier: 1, tierExpiresAtTurn: 12 });
    expect(tierAt(buffed, 12)).toBe(1);
    expect(tierAt(buffed, 13)).toBe(0);
    const index = indexOccupancy(boardOf([buffed, enemySnake()]), 13);
    expect(index.get(at(2, 5))?.[0]?.tier).toBe(0);
  });
});

describe('sliderAttackVector — the term over an action set', () => {
  it('resolves a destination staged BEYOND the body as the sever at the body', () => {
    const queen = ourQueen();
    const board = boardOf([queen, enemySnake()]);
    const v = sliderAttackVector(board, queen, at(9, 5));
    expect(v.landing).toBe(at(5, 5));
    expect(v.steps).toBe(3);
    expect(v.realized.verdict).toBe('sever');
    expect(v.realized.severed).toBe(9);
  });

  it('scores an empty line at nothing and the loaded line at the cut', () => {
    const queen = ourQueen();
    const loaded = boardOf([queen, enemySnake()]);
    const empty = boardOf([queen]);
    expect(sliderAttackVector(loaded, queen, at(5, 5)).realized.severed).toBe(9);
    expect(sliderAttackVector(empty, queen, at(5, 5)).realized.severed).toBe(0);
  });

  it('ranks the severing destination top of the whole action set', () => {
    const queen = ourQueen();
    const board = boardOf([queen, enemySnake()]);
    const rate = severExchangeRate(board, 0);
    const options = sliderAttackOptions(board, queen);
    const best = options.reduce((a, b) => (compareSliderAttack(b, a, rate) > 0 ? b : a));
    expect(best.realized.verdict).toBe('sever');
    expect(best.landing).toBe(at(5, 5));

    // Staying cuts nothing, so the sound half scores it at zero. It is NOT
    // scored at zero overall — a queen sitting on three loaded lines is
    // threatening plenty — and that is exactly why the ladder is sound-first:
    // summed, the standing threat would outbid the executed cut here.
    const stay = options.find((o) => o.dest === at(2, 5)) as (typeof options)[number];
    expect(orderingScore(stay, rate)).toBe(0);
    expect(threatScore(stay, rate)).toBeGreaterThan(orderingScore(best, rate));
    expect(compareSliderAttack(best, stay, rate)).toBeGreaterThan(0);
  });

  it('offers the whole grammar line, occupancy not considered', () => {
    const queen = ourQueen();
    const dests = sliderDestinations(boardOf([queen, enemySnake()]), queen);
    // Stay, plus the eight rays out to the interior edge.
    expect(dests).toContain(at(2, 5));
    expect(dests).toContain(at(14, 5)); // straight through the body
    expect(dests).toContain(at(5, 5));
    expect(new Set(dests).size).toBe(dests.length);
  });

  it('prices the threat one turn out by the movement rule, not by a coefficient', () => {
    // A rook, so exactly one ray reaches the body and the arithmetic is visible.
    const rook = ourQueen({ kind: UnitKind.Rook, occupancy: [at(2, 8)] });
    // From (2,8) the east ray meets the body at (5,8) = occupancy index 6.
    const stay = sliderAttackVector(boardOf([rook, enemySnake()]), rook, at(2, 8));
    expect(stay.threat.hi).toBe(12 - 6);
    // Tomorrow the body has shifted one place along and the tail has popped.
    expect(stay.threat.est).toBe(12 - 6 - 1);
    // The pessimistic reading is the term admitting it cannot see the future.
    expect(stay.threat.lo).toBe(0);
  });

  it('lets the tail threat expire to nothing, because the tail pops', () => {
    const rook = ourQueen({ kind: UnitKind.Rook, occupancy: [at(2, 13)] });
    const stay = sliderAttackVector(boardOf([rook, enemySnake()]), rook, at(2, 13));
    expect(stay.threat.hi).toBe(1);
    expect(stay.threat.est).toBe(0);
  });

  it('drops the threat when the buff that makes it possible has expired', () => {
    const rook = ourQueen({
      kind: UnitKind.Rook,
      occupancy: [at(2, 8)],
      tier: 1,
      tierExpiresAtTurn: 10,
    });
    const v = sliderAttackVector(boardOf([rook, enemySnake()], 10), rook, at(2, 8));
    // The realized channel is resolved at turn 10, where the buff still holds;
    // the threat is resolved at 11, where it does not.
    expect(v.threat.hi).toBe(0);
    const held = { ...rook, tierExpiresAtTurn: 11 };
    const stillBuffed = sliderAttackVector(
      boardOf([held, enemySnake()], 10),
      held,
      at(2, 8)
    );
    expect(stillBuffed.threat.hi).toBe(6);
  });

  it('does not re-sell the cells the move already cut', () => {
    const rook = ourQueen({ kind: UnitKind.Rook });
    const board = boardOf([rook, enemySnake()]);
    const v = sliderAttackVector(board, rook, at(5, 5));
    expect(v.realized.severed).toBe(9);
    // Standing on the cut cell, the north ray now meets a THREE-cell stub at
    // index 2, so tomorrow's cut there is one cell and the day-after nothing.
    expect(v.threat.hi).toBe(1);
    expect(v.threat.est).toBe(0);
  });

  it('charges a move that walks us into a death, and threatens nothing after', () => {
    const queen = ourQueen({ tier: 0 });
    const v = sliderAttackVector(boardOf([queen, enemySnake()]), queen, at(9, 5));
    expect(v.realized.verdict).toBe('die');
    expect(v.realized.oursLost).toBe(3);
    expect(v.threat).toEqual({ lo: 0, est: 0, hi: 0 });
    expect(orderingScore(v, 1)).toBe(-3);
  });

  it('reads the exchange rate off the board and never fits it', () => {
    const ours: RayUnit = { ...ourQueen(), weight: 10 };
    const theirs: RayUnit = { ...enemySnake(), weight: 10 };
    expect(severExchangeRate(boardOf([ours, theirs]), 0)).toBeCloseTo(1);
    const ahead: RayUnit = { ...theirs, weight: 30 };
    // Holding a quarter of the board, growth is worth three times removal.
    expect(severExchangeRate(boardOf([ours, ahead]), 0)).toBeCloseTo(1 / 3);
  });

  it('publishes the candidate as data, dark, at weight zero', () => {
    expect(SLIDER_ATTACK_VECTOR_ENTRY.id).toBe('eval/slider-attack-vector@1');
    expect(SLIDER_ATTACK_VECTOR_ENTRY.slot).toBe(3);
    expect(SLIDER_ATTACK_VECTOR_ENTRY.params.weight).toBe(0);
    expect(SLIDER_ATTACK_VECTOR_ENTRY.knob.defaultMultiplier).toBe(0);
    // Both channels are advisory AT THE DECISION — see the entry's own note and
    // the retrodiction that forced the correction.
    expect(SLIDER_ATTACK_VECTOR_ENTRY.soundness.realized).toBe('advisory');
    expect(SLIDER_ATTACK_VECTOR_ENTRY.soundness.threat).toBe('advisory');
    expect(SLIDER_ATTACK_VECTOR_ENTRY.soundnessNote).toMatch(/RESOLVED board/);
  });
});
