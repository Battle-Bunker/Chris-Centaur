/**
 * THE TIER WINDOW, end to end.
 *
 * Three claims, each machine-checked:
 *
 *   THREADED     the two facts the wire carries about invulnerability — the
 *                expiry turn and the potion cells — reach the possibility
 *                cloud, with the inclusive/exclusive conversion applied exactly
 *                once and at the boundary the corpus says matters (a third of
 *                tier deaths happen on the LAST turn the attacker's buff is
 *                live, so an off-by-one here is not cosmetic).
 *   DEFENDED     a move into reach of something that beats the unit on tier
 *                alone is dropped when the unit has somewhere else to be, the
 *                ledger names it, and no combination of that filter with the
 *                king filter can hand the search an empty option set.
 *   FREE WHEN OFF  on a board with no live invulnerability effect every
 *                candidate grades `clear`, no tier prune fires, and the order
 *                is the one the file always produced.
 */

import { Board } from '../../types/battlesnake';
import { marshalBoard } from '../../logic/turn-oracle';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { EngineSubstrate } from '../substrate';
import { GrammarCandidateGenerator, PRUNE } from '../candidates';
import { exposureOf, gradePath, selfDebuffOf, selfDebuffRank } from '../tier-window';
import { makeSnake, piece, boardOf } from '../../tests/board-fixtures';
import { DEFAULT_WEIGHTS } from '../evaluate/calibration';
import { PERIL_WEIGHT } from '../evaluate/window';

// --------------------------------------------------------------------- fixtures

const TURN = 30;

const subFor = (board: Board, asTeam = 'A'): EngineSubstrate =>
  makeSubstrate({ board, turn: TURN, asTeam });

const unitNamed = (sub: EngineSubstrate, wireId: string) => {
  const u = sub.unitOfWireId(wireId);
  if (u === undefined) throw new Error(`no unit ${wireId}`);
  return u;
};

const claimNamed = (sub: EngineSubstrate, wireId: string) => {
  const claim = sub.claimsOf().find((c) => c.id === wireId);
  if (claim === undefined) throw new Error(`${wireId} is not a claim on this board`);
  return claim;
};

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------------- THREADED

describe('the wire reaches the claim, and the ENGINE does the lapsing', () => {
  it('converts the wire expiry from inclusive to exclusive exactly once', () => {
    const board = boardOf([
      piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
      piece('B1', { x: 5, y: 5 }, 'rook', 3, {
        teamID: 'B',
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: 33,
      }),
      // No schedule on the wire at all: nothing may invent a horizon.
      piece('B2', { x: 7, y: 7 }, 'rook', 3, { teamID: 'B' }),
    ]);
    const m = marshalBoard(board, TURN);
    const idx = (id: string) => m.units.findIndex((u) => u.id === id);
    expect(m.tierExpiry[idx('B1')]).toBe(34);
    expect(m.tierExpiry[idx('B2')]).toBeNull();
  });

  it('carries the potion cells across, in engine coordinates', () => {
    const board = boardOf([piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' })], {
      invulnerabilityPotions: [
        { x: 3, y: 3 },
        { x: 4, y: 4 },
      ],
    });
    const m = marshalBoard(board, TURN);
    expect(m.potions).toEqual([m.toIndex({ x: 3, y: 3 }), m.toIndex({ x: 4, y: 4 })]);
  });

  it.each([
    // [wire expiry, the tier that governs the arrival turn]
    ['the window is still live on the arrival turn', 31, 1],
    ['the window has one turn to run after the arrival turn', 32, 1],
    ['the window lapsed before the arrival turn', 30, 0],
  ])('%s', (_name, expiry, expectedTier) => {
    const board = boardOf([
      piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
      piece('B1', { x: 5, y: 5 }, 'rook', 3, {
        teamID: 'B',
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: expiry as number,
      }),
    ]);
    const sub = subFor(board);
    // THE ENGINE'S OWN LAPSE. `tierAtArrival` is the schedule advanced to the
    // turn being settled, computed inside the settlement that knows the turn —
    // and it agrees with the tier the wire hands the roster, which is the one
    // arithmetic this repo is allowed to do (once, in `marshalBoard`).
    const claim = claimNamed(sub, 'B1');
    expect(claim.tierAtArrival).toBe(expectedTier);
    expect(claim.tierMax).toBeGreaterThanOrEqual(expectedTier);
    expect(claim.tierMin).toBeLessThanOrEqual(expectedTier);
    sub.release();
  });

  /**
   * THE WIDENING SHIPS. The seam that used to hold it back
   * (`tier-truth.potionBoardEnabled`) had exactly one job — feed the claim
   * layer an EMPTY potion board so a reachable potion could not open a tier
   * interval — and there is nothing left for it to switch: a claim's interval
   * is computed inside the engine from `input.potions` and the pickup rule,
   * and there is no way to hand settlement a board it is not playing on.
   * So a potion in reach now moves the interval, which is what it always
   * meant, and this is the test that says so.
   */
  it('a potion in reach opens the tier interval; one out of reach does not', () => {
    const near = { x: 5, y: 4 };
    const far = { x: 1, y: 8 };
    const withNear = boardOf(
      [
        piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
        piece('B1', { x: 5, y: 5 }, 'king', 1, { teamID: 'B' }),
      ],
      { invulnerabilityPotions: [near] }
    );
    const withFar = boardOf(
      [
        piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
        piece('B1', { x: 5, y: 5 }, 'king', 1, { teamID: 'B' }),
      ],
      { invulnerabilityPotions: [far] }
    );
    const nearSub = makeSubstrate({
      board: withNear,
      turn: TURN,
      asTeam: 'A',
      // Two turns of unknown movement: a potion is collected on a turn and
      // governs the NEXT one, so a claim over one turn cannot yet have used it.
      observedTurns: new Map([['B1', TURN - 1]]),
    });
    const farSub = makeSubstrate({
      board: withFar,
      turn: TURN,
      asTeam: 'A',
      observedTurns: new Map([['B1', TURN - 1]]),
    });
    const near1 = claimNamed(nearSub, 'B1');
    const far1 = claimNamed(farSub, 'B1');
    expect(near1.tierMin).toBeLessThan(far1.tierMin);
    nearSub.release();
    farSub.release();
  });

  it('reads a potion cell as a potion cell, whatever the search models', () => {
    const board = boardOf([piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' })], {
      invulnerabilityPotions: [{ x: 4, y: 4 }],
    });
    const sub = subFor(board);
    const m = sub.marshalled;
    expect(sub.potionAt(m.toIndex({ x: 4, y: 4 }))).toBe(true);
    expect(sub.potionAt(m.toIndex({ x: 4, y: 5 }))).toBe(false);
    sub.release();
  });
});

// --------------------------------------------------------------------- DEFENDED

describe('tier-safe staging', () => {
  /**
   * The exemplar shape from the corpus, in miniature: a heavy unit that WINS on
   * weight walks into a light one that is buffed, and dies on tier alone. The
   * rook at (2,2) weighs 5; the enemy knight at (4,3) weighs 2 and carries +1.
   * A knight from (4,3) reaches (2,2)'s neighbourhood; the rook has a whole
   * board of squares it does not.
   */
  const decisiveBoard = (): Board =>
    boardOf([
      piece('A1', { x: 2, y: 2 }, 'rook', 5, { teamID: 'A' }),
      piece('B1', { x: 4, y: 3 }, 'knight', 2, {
        teamID: 'B',
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: 34,
      }),
    ]);

  it('sees the enemy as a DECISIVE threat — one it beats on weight and loses to on tier', () => {
    const sub = subFor(decisiveBoard());
    const rook = unitNamed(sub, 'A1');
    const exposure = exposureOf(sub, rook);
    expect(exposure.ownTier).toBe(0);
    expect(exposure.threats).toHaveLength(1);
    expect(exposure.threats[0]?.tier).toBe(1);
    expect(exposure.threats[0]?.decisive).toBe(true);
    sub.release();
  });

  it('grades the squares that knight can reach as decisive, and the rest clear', () => {
    const sub = subFor(decisiveBoard());
    const rook = unitNamed(sub, 'A1');
    const exposure = exposureOf(sub, rook);
    const grades = new Set(
      sub.actionsOf(rook.unitId).map((c) => gradePath(exposure, rook.cells[0], c.path))
    );
    expect(grades.has('decisive')).toBe(true);
    expect(grades.has('clear')).toBe(true);
    sub.release();
  });

  it('drops the decisive moves and says so in the ledger', () => {
    const sub = subFor(decisiveBoard());
    const rook = unitNamed(sub, 'A1');
    const gen = new GrammarCandidateGenerator();
    const set = gen.candidatesFor(sub, rook.unitId);
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(set.prunedLedger.some((p) => p.prune === PRUNE.tierDecisive)).toBe(true);

    const exposure = exposureOf(sub, rook);
    for (const c of set.candidates) {
      expect(gradePath(exposure, rook.cells[0], c.path)).not.toBe('decisive');
    }
    sub.release();
  });

  it('keeps the decisive moves when the knob is off — the filter is the only difference', () => {
    const sub = subFor(decisiveBoard());
    const rook = unitNamed(sub, 'A1');
    const off = new GrammarCandidateGenerator({ tierSafeStaging: false });
    const set = off.candidatesFor(sub, rook.unitId);
    expect(set.prunedLedger.some((p) => p.prune === PRUNE.tierDecisive)).toBe(false);
    const exposure = exposureOf(sub, rook);
    expect(
      set.candidates.some((c) => gradePath(exposure, rook.cells[0], c.path) === 'decisive')
    ).toBe(true);
    sub.release();
  });

  it('never empties the option set, even when EVERY square is decisive', () => {
    // A king boxed into a corner by a buffed queen that rakes the whole board.
    const board = boardOf([
      piece('A1', { x: 1, y: 1 }, 'king', 1, { teamID: 'A' }),
      piece('B1', { x: 4, y: 4 }, 'queen', 1, {
        teamID: 'B',
        invulnerabilityLevel: 3,
        invulnerabilityExpiryTurn: 40,
      }),
    ]);
    const sub = subFor(board);
    const king = unitNamed(sub, 'A1');
    const gen = new GrammarCandidateGenerator();
    const set = gen.candidatesFor(sub, king.unitId);
    expect(set.candidates.length).toBeGreaterThan(0);
    sub.release();
  });
});

// ----------------------------------------------------------------- SELF-DEBUFF

describe('the collector pays, and it is the collector that has to know', () => {
  const kingBoard = (): Board =>
    boardOf(
      [
        piece('A1', { x: 3, y: 3 }, 'king', 1, { teamID: 'A' }),
        piece('B1', { x: 7, y: 7 }, 'rook', 3, { teamID: 'B' }),
      ],
      { invulnerabilityPotions: [{ x: 3, y: 4 }] }
    );

  it('prices a king landing on a potion as a self-inflicted debuff', () => {
    const sub = subFor(kingBoard());
    const king = unitNamed(sub, 'A1');
    const exposure = exposureOf(sub, king);
    const potion = sub.marshalled.toIndex({ x: 3, y: 4 });
    expect(selfDebuffOf(sub, king, exposure, [potion])).toBe('king');
    expect(selfDebuffOf(sub, king, exposure, [sub.marshalled.toIndex({ x: 2, y: 3 })])).toBe('none');
    sub.release();
  });

  it('keeps the king off the potion when it has anywhere else to stand', () => {
    const sub = subFor(kingBoard());
    const king = unitNamed(sub, 'A1');
    const potion = sub.marshalled.toIndex({ x: 3, y: 4 });
    const set = new GrammarCandidateGenerator().candidatesFor(sub, king.unitId);
    expect(set.candidates.length).toBeGreaterThan(0);
    expect(set.candidates.some((c) => c.to === potion)).toBe(false);
    expect(set.prunedLedger.some((p) => p.prune === PRUNE.kingTierUnsafe)).toBe(true);
    sub.release();
  });

  it('calls a pickup by an already-buffed unit WASTE — a teammate paid for that +1', () => {
    const board = boardOf(
      [
        piece('A1', { x: 3, y: 3 }, 'rook', 3, {
          teamID: 'A',
          invulnerabilityLevel: 1,
          invulnerabilityExpiryTurn: 34,
        }),
        piece('B1', { x: 8, y: 8 }, 'rook', 3, { teamID: 'B' }),
      ],
      { invulnerabilityPotions: [{ x: 3, y: 4 }] }
    );
    const sub = subFor(board);
    const rook = unitNamed(sub, 'A1');
    const exposure = exposureOf(sub, rook);
    expect(selfDebuffOf(sub, rook, exposure, [sub.marshalled.toIndex({ x: 3, y: 4 })])).toBe(
      'waste'
    );
    sub.release();
  });

  it('charges a plain pickup nothing — the team ledger for a TEAM is not a loss', () => {
    const board = boardOf(
      [
        piece('A1', { x: 3, y: 3 }, 'rook', 3, { teamID: 'A' }),
        piece('A2', { x: 6, y: 6 }, 'rook', 3, { teamID: 'A' }),
        piece('B1', { x: 8, y: 8 }, 'rook', 3, { teamID: 'B' }),
      ],
      { invulnerabilityPotions: [{ x: 3, y: 4 }] }
    );
    const sub = subFor(board);
    const rook = unitNamed(sub, 'A1');
    const exposure = exposureOf(sub, rook);
    expect(selfDebuffOf(sub, rook, exposure, [sub.marshalled.toIndex({ x: 3, y: 4 })])).toBe(
      'spend'
    );
    // The half that makes `spend` free is real and settlement writes it: A2's
    // tier is strictly above where it stood.
    const after = sub.tiersAfterPickupBy(rook.unitId);
    const ally = unitNamed(sub, 'A2');
    expect(after.get(ally.unitId)).toBeGreaterThan(ally.tier);
    expect(after.get(rook.unitId)).toBeLessThan(rook.tier);
    sub.release();
  });

  // THE CORRECTED CASE. `spend` ranks zero because a pickup buys one window of
  // loss and roughly three ally windows of gain. With no living ally there is
  // no gain — the credit half of the argument is simply absent — and the old
  // reading, which wrote the ally half off as unmodelled, could not tell the
  // two boards apart. Settlement can: the same probe that pays A2 above pays
  // nobody here.
  it('charges a pickup with NO living ally — the credit half of `spend` is missing', () => {
    const board = boardOf(
      [
        piece('A1', { x: 3, y: 3 }, 'rook', 3, { teamID: 'A' }),
        piece('B1', { x: 8, y: 8 }, 'rook', 3, { teamID: 'B' }),
      ],
      { invulnerabilityPotions: [{ x: 3, y: 4 }] }
    );
    const sub = subFor(board);
    const rook = unitNamed(sub, 'A1');
    const exposure = exposureOf(sub, rook);
    expect(selfDebuffOf(sub, rook, exposure, [sub.marshalled.toIndex({ x: 3, y: 4 })])).toBe(
      'solo'
    );
    expect(selfDebuffRank('solo')).toBeGreaterThan(selfDebuffRank('spend'));

    // Nobody but the collector moves, and the collector moves DOWN.
    const after = sub.tiersAfterPickupBy(rook.unitId);
    expect(after.get(rook.unitId)).toBeLessThan(rook.tier);
    const enemy = unitNamed(sub, 'B1');
    expect(after.get(enemy.unitId)).toBe(enemy.tier);
    sub.release();
  });
});

// -------------------------------------------------------------- FREE WHEN OFF

describe('a board with no live tier pays nothing', () => {
  it('grades every candidate clear and fires no tier prune', () => {
    const board = boardOf([
      piece('A1', { x: 2, y: 2 }, 'queen', 4, { teamID: 'A' }),
      piece('A2', { x: 2, y: 6 }, 'rook', 3, { teamID: 'A' }),
      piece('B1', { x: 6, y: 2 }, 'queen', 4, { teamID: 'B' }),
      makeSnake('B2', [
        { x: 6, y: 6 },
        { x: 6, y: 7 },
        { x: 6, y: 8 },
      ], { teamID: 'B' }),
    ]);
    const sub = subFor(board);
    const gen = new GrammarCandidateGenerator();
    for (const unit of sub.roster()) {
      if (unit.teamId !== 'A') continue;
      const exposure = exposureOf(sub, unit);
      expect(exposure.threats).toHaveLength(0);
      const set = gen.candidatesFor(sub, unit.unitId);
      expect(set.prunedLedger.some((p) => p.prune === PRUNE.tierDecisive)).toBe(false);
      expect(set.prunedLedger.some((p) => p.prune === PRUNE.kingTierUnsafe)).toBe(false);
      for (const c of set.candidates) {
        expect(gradePath(exposure, unit.cells[0], c.path)).toBe('clear');
      }
    }
    sub.release();
  });
});

// -------------------------------------- THE SHARE, AND WHY SHAPING IT CANNOT WORK

/**
 * P2 (`docs/design/BEHAVIOUR-AUDIT-2.md`), REFUTED, kept as a number.
 *
 * The peril half reads the FRACTION of the collector's own ground an enemy
 * beats, so three beaten cells read 0.375 under a knight's nine and 0.12 under
 * a queen's twenty-five: a wide collector dilutes identical danger. The audit's
 * rule was one knob, `PERIL_CONCAVITY = γ`, shaping that per-horizon share
 * (`(beaten / cells) ** γ`), swept at 1/2 and 1/3 and reverted — see
 * `docs/design/potions.md` "P2" for the two arms and the mechanism.
 *
 * These cases carry the arithmetic that says WHY, off the reproduction itself,
 * so the next attempt does not re-derive it: the charge is real and clears the
 * margin the audit named, and it still cannot re-sort the decision, because
 * the peril is read from where the collector STANDS and is therefore the same
 * constant on every plan in which it collects.
 */
describe("the collector's exposure is a SHARE of its ground (P2, refuted)", () => {
  /**
   * `potions` seed 4, turn 36, red-C — the knight at (2,6) that plays the
   * potion cell (0,7). Its ground, per horizon, exactly as the runner reads it
   * at that decision: nine cells with three beaten at k = 1, and a tail that is
   * fully beaten because by the second turn every unit on an 11x11 board can
   * meet every other.
   */
  const RED_C_TURN_36: ReadonlyArray<readonly [number, number]> = [
    [3, 9],
    [34, 34],
    [73, 73],
  ];
  const WINDOW = 3;

  /** `Σ_k (W − k + 1)·(beaten_k / cells_k)^γ / Σ_k (W − k + 1)`, γ = 1 shipped. */
  const perilAt = (γ: number): number => {
    let num = 0;
    let den = 0;
    for (let k = 1; k <= RED_C_TURN_36.length; k++) {
      const [beaten, cells] = RED_C_TURN_36[k - 1] as readonly [number, number];
      const w = WINDOW - k + 1;
      num += w * (beaten / cells) ** γ;
      den += w;
    }
    return num / den;
  };

  /**
   * What one point of peril is worth to the fold at that decision: the `potion`
   * weight (2) times `PERIL_WEIGHT` (2), charged to the collector alone and
   * divided by our unit count — red-A, red-B and red-C are all alive on turn 36.
   */
  const OUR_UNITS = 3;
  const asScore = (peril: number): number =>
    (DEFAULT_WEIGHTS.potion as number) * PERIL_WEIGHT * (peril / OUR_UNITS);

  it('reads two thirds at the shipped γ = 1, of which half is the saturated tail', () => {
    expect(perilAt(1)).toBeCloseTo(2 / 3, 12);
    // D4's finding, still standing: the tail alone is 0.5 of the reading and a
    // constant, so the one horizon that discriminates is halved before it meets
    // `PERIL_WEIGHT`.
    expect((2 * 1 + 1 * 1) / 6).toBeCloseTo(0.5, 12);
  });

  it('γ = 1/2 does clear the 0.04 the audit named — the rule is not too small', () => {
    const rise = asScore(perilAt(1 / 2)) - asScore(perilAt(1));
    // 0.163: four times the margin between red-C's top two candidates
    // ((4,5) = -342.30 against (0,7) = -342.34 in the runner's transcript).
    expect(rise).toBeCloseTo(0.1627, 3);
    expect(rise).toBeGreaterThan(0.04);
  });

  it('and cannot re-sort that decision, because the charge is common to both sides', () => {
    // THE REFUTATION, as arithmetic. `perilOf` reads the ground from where the
    // collector STANDS as the turn opens, not from the cell the plan sends it
    // to — deliberately, so the peril half is memoisable per collector rather
    // than per plan. So the charge is IDENTICAL on every joint plan in which
    // red-C collects, and it cancels in the comparison that picks the move. In
    // the γ = 1/2 arm every red candidate at turn 36 moved by the same −0.16
    // and red-C played (0,7) again on the same 0.03 margin; on three of the
    // eight seeds not one move changed anywhere in sixty turns.
    const rise = asScore(perilAt(1 / 2)) - asScore(perilAt(1));
    // The only line the knob can move the pickup against is the one candidate
    // whose best joint plan collects NOTHING — (1,4) = -342.99, which is this
    // far behind, sixteen times the margin the audit measured the rule against.
    const GAP_TO_THE_NON_PICKUP_LINE = 342.99 - 342.34;
    expect(GAP_TO_THE_NON_PICKUP_LINE).toBeGreaterThan(rise);
    // γ = 1/3 does not close it either, and it cost deaths: 21 → 30.
    expect(GAP_TO_THE_NON_PICKUP_LINE).toBeGreaterThan(
      asScore(perilAt(1 / 3)) - asScore(perilAt(1))
    );
  });

  it('shapes the level far more than the spread, which is D4 with the sign flipped', () => {
    // The audit's claim is that γ < 1 WIDENS the reading. It does not: `s^γ`
    // maps [0, 1] onto [0, 1], so the peril's range over a saturated tail is
    // [0.5, 1] at every γ. Measured over seed 4's own 42 distinct horizon-1
    // grounds, the shares run [0, 0.571] with a median of 0.226 — so what the
    // knob actually buys is a level shift at the median that is LARGER than the
    // extra spread it opens at the observed ceiling.
    const MEDIAN_SHARE = 0.226;
    const OBSERVED_CEILING = 0.571;
    const levelShift = 0.5 * (MEDIAN_SHARE ** (1 / 2) - MEDIAN_SHARE);
    const extraSpread = 0.5 * (OBSERVED_CEILING ** (1 / 2) - OBSERVED_CEILING) - levelShift;
    expect(levelShift).toBeGreaterThan(extraSpread);
    // D4 cut the level and admitted 24 more marginal pickups; this raises it and
    // refuses 4 (γ = 1/2) or 11 (γ = 1/3) of them. Neither re-sorts: the
    // reckless share moves 71.4% → 71.0% → 66.7% while the count falls 35 → 24.
  });

  it('leaves a fully beaten ground exactly where it was, at every γ', () => {
    // The counter §P2 raised against itself, and it is correct: a saturated
    // horizon reads 1^γ = 1 and is untouched, so no γ reaches the tail at all.
    for (const γ of [1, 1 / 2, 1 / 3]) expect(1 ** γ).toBe(1);
  });
});
