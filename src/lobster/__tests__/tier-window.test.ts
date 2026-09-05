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
import { PERIL_WEIGHT, perilOverHorizons } from '../evaluate/window';

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

// --------------------------------------------------- THE SHARE, AND ITS SHAPE

/**
 * P2 (`docs/design/BEHAVIOUR-AUDIT-2.md`). The peril half reads the FRACTION of
 * the collector's own ground an enemy beats, so a wide collector dilutes
 * identical danger; `PERIL_CONCAVITY = γ` shapes that fraction and nothing
 * else. These cases pin the reproduction the audit is built on and the one
 * property that separates this rule from the refuted D4.
 */
describe("the collector's exposure is a SHARE of its ground, and γ shapes it", () => {
  /**
   * `potions` seed 4, turn 36, red-C — the knight at (2,6) that plays the
   * potion cell (0,7) over (4,5) on a margin of 0.04. Its ground, per horizon,
   * exactly as the runner reads it at that decision: nine cells with three
   * beaten at k = 1, and a tail that is fully beaten because by the second turn
   * every unit on an 11x11 board can meet every other.
   */
  const RED_C_TURN_36: ReadonlyArray<readonly [number, number]> = [
    [3, 9],
    [34, 34],
    [73, 73],
  ];
  const WINDOW = 3;

  /** The margin the runner printed: (4,5) = -342.30 against (0,7) = -342.34. */
  const MARGIN = 0.04;

  /**
   * What one point of peril is worth to the fold at that decision: the `potion`
   * weight (2) times `PERIL_WEIGHT` (2), charged to the collector alone and
   * divided by our unit count — red-A, red-B and red-C are all alive on turn 36.
   */
  const OUR_UNITS = 3;
  const perilToScore = (peril: number): number =>
    (DEFAULT_WEIGHTS.potion as number) * PERIL_WEIGHT * (peril / OUR_UNITS);

  /**
   * Today's term, written out rather than recomputed: `γ = 1` is
   * `Σ_k (W − k + 1)·beaten_k / Σ_k (W − k + 1)` over the same three horizons.
   */
  const AT_GAMMA_ONE = (3 * (3 / 9) + 2 * 1 + 1 * 1) / 6;

  it('reads two thirds at γ = 1, of which half is the saturated tail', () => {
    expect(AT_GAMMA_ONE).toBeCloseTo(2 / 3, 12);
    // The tail alone: 0.5 of the reading, a constant, and D4's whole finding.
    expect((2 * 1 + 1 * 1) / 6).toBeCloseTo(0.5, 12);
  });

  it('prices red-C above the 0.04 margin the pickup was actually taken on', () => {
    const shaped = perilOverHorizons(RED_C_TURN_36, WINDOW);
    expect(shaped).toBeGreaterThan(AT_GAMMA_ONE);
    const rise = perilToScore(shaped) - perilToScore(AT_GAMMA_ONE);
    // The whole point of the knob: the extra charge has to clear the margin the
    // trace records, or red-C plays the potion cell again.
    expect(rise).toBeGreaterThan(MARGIN);
    // At the shipped γ = 1/2 the number is 0.163 — four times the margin, and
    // still an order inside the cliff, since `shaped` cannot leave [0, 1].
    expect(rise).toBeCloseTo(0.1627, 3);
    expect(shaped).toBeLessThanOrEqual(1);
  });

  it('raises the price of every pickup and cuts none — the opposite of D4', () => {
    // `share^γ >= share` for every share in [0, 1] at γ <= 1, so no ground
    // anywhere reads cheaper than it did. D4 moved mass off a saturated tail
    // and cut every price; this moves nothing between horizons.
    for (let beaten = 0; beaten <= 25; beaten++) {
      const one = beaten / 25;
      const shaped = perilOverHorizons([[beaten, 25]], WINDOW);
      expect(shaped).toBeGreaterThanOrEqual(one - 1e-12);
    }
  });

  it('leaves a fully beaten ground exactly where it was, at every horizon', () => {
    // The counter in §P2: a saturated tail reads 1^γ = 1 and is untouched.
    expect(perilOverHorizons([[9, 9], [34, 34], [73, 73]], WINDOW)).toBeCloseTo(1, 12);
    expect(perilOverHorizons([[0, 9], [0, 34], [0, 73]], WINDOW)).toBeCloseTo(0, 12);
  });

  it('stops a wide collector diluting three beaten cells into nothing', () => {
    // The mechanic itself: three beaten cells under a knight's nine and under a
    // queen's twenty-five. At γ = 1 the queen reads a third of what the knight
    // does at identical danger; at γ = 1/2 the gap closes by construction.
    const knight = perilOverHorizons([[3, 9]], WINDOW);
    const queen = perilOverHorizons([[3, 25]], WINDOW);
    expect(3 / 25 / (3 / 9)).toBeCloseTo(0.36, 6);
    expect(queen / knight).toBeGreaterThan(0.36);
  });

  it('a horizon the collector has no claim at carries no weight', () => {
    // `[0, 0]` is "no claim", not "nothing beats it": it must not pull the
    // reading toward zero the way a genuinely clear horizon does.
    expect(perilOverHorizons([[3, 9], [0, 0], [0, 0]], WINDOW)).toBeCloseTo(
      perilOverHorizons([[3, 9]], WINDOW),
      12
    );
  });
});
