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
import { DEFAULT_WEIGHTS } from '../evaluate/calibration';
import { makeContext } from '../evaluate/features';
import { PERIL_WEIGHT, perilRead } from '../evaluate/window';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { EngineSubstrate } from '../substrate';
import { GrammarCandidateGenerator, PRUNE } from '../candidates';
import { exposureOf, gradePath, selfDebuffOf, selfDebuffRank } from '../tier-window';
import { makeSnake, piece, boardOf } from '../../tests/board-fixtures';

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

// ------------------------------------- THE GATED-ESCAPE SHAPE'S TWO BOUNDARIES

/**
 * `docs/design/potion-shape.md` §3, "the prediction, per class, falsifiable",
 * last bullet — the two board-level predictions, and the cheapest thing in the
 * whole study to check:
 *
 *   * `potions` seed 6 turn 39: red-C plays `(2,5)` or `(1,6)`, not `(5,8)`;
 *   * `potions` seed 4 turn 36: red-C plays `(4,5)`, not `(0,7)`.
 *
 * Both are decided by ONE number: how much the peril half's charge moves
 * between two of red-C's own candidates, against the margin the rest of the
 * fold separates them by. The charge on a collecting plan is
 *
 *     w_potion × PERIL_WEIGHT × peril / |ours|
 *
 * — `ourUnitTerm`'s mean over our live units, with the collector's reading the
 * only nonzero one when no ally's contest flips — and it is ZERO on a plan that
 * collects nothing. The margins below are read off the runner's own transcript
 * at the turn the decision opened, in the arm this rule is measured against.
 *
 * These tests are the predictions and nothing else. If the shape does not move
 * the two boards, they fail, and `docs/design/potions.md` gets a fifth section.
 */
describe('potion-shape: the two board-level predictions', () => {
  /** What the fold charges a plan whose peril reads `peril`, in fold units. */
  const chargeOf = (peril: number, ours: number): number =>
    ((DEFAULT_WEIGHTS['potion'] as number) * PERIL_WEIGHT * peril) / ours;

  /**
   * The peril half alone, for `red-C` staged onto `to`, measured through the
   * member's own `perilRead` rather than through a second copy of its
   * arithmetic.
   */
  const perilAt = (board: Board, turn: number, to: { x: number; y: number }): number => {
    const sub = makeSubstrate({ board, turn, asTeam: 'red', modeled: ['red-C'] });
    try {
      const redC = unitNamed(sub, 'red-C').unitId;
      const cell = marshalBoard(board, turn).toIndex(to);
      const team = sub.teamNumber('red');
      let peril = NaN;
      sub.withResolution(
        new Map([[redC, { unitId: redC, from: -1, to: cell, path: sub.pathFor(redC, cell) ?? [] }]]),
        team,
        ({ resolution, bounds }) => {
          const ctx = makeContext(sub, resolution, bounds, team, 0);
          const standing = ctx.standing.find((s) => s.unitId === redC);
          if (standing === undefined) throw new Error('red-C is not standing');
          peril = perilRead(ctx, standing);
        }
      );
      return peril;
    } finally {
      sub.release();
    }
  };

  /**
   * `potions` SEED 6, TURN 39 — D4's own reproduction, and the board on which
   * the fold has to order TWO COLLECTING PLANS:
   *
   *     T 39 red-C knight hp91 (3,7)->(5,8)
   *          top3: (5,8)=-403.05 (2,5)=-403.08 (1,6)=-403.39
   *     POTION x1  tier up: red-A  tier down: red-C
   *
   * `(5,8)` and `(2,5)` are both potion cells; `(1,6)` collects nothing. red is
   * down to two living units, so `|ours| = 2`.
   */
  describe('seed 6 turn 39: red-C plays (2,5) or (1,6), not (5,8)', () => {
    const TURN_39 = 39;
    /** (5,8) over (2,5) in the shipped arm. */
    const MARGIN_25 = 403.08 - 403.05;
    /** (5,8) over (1,6) in the shipped arm. */
    const MARGIN_16 = 403.39 - 403.05;

    const seed6Turn39 = (): Board =>
      boardOf(
        [
          makeSnake(
            'red-A',
            [
              { x: 10, y: 9 },
              { x: 9, y: 9 },
              { x: 9, y: 10 },
            ],
            { teamID: 'red', health: 99, orientation: { dx: 1, dy: 0 }, unitType: 'snake' }
          ),
          piece('red-C', { x: 3, y: 7 }, 'knight', 5, {
            teamID: 'red',
            health: 91,
            orientation: { dx: 2, dy: 1 },
          }),
          makeSnake(
            'blue-A',
            [
              { x: 3, y: 8 },
              { x: 2, y: 8 },
              { x: 2, y: 9 },
              { x: 3, y: 9 },
              { x: 4, y: 9 },
              { x: 4, y: 10 },
              { x: 5, y: 10 },
            ],
            { teamID: 'blue', health: 90, orientation: { dx: 1, dy: 0 }, unitType: 'snake' }
          ),
          piece('blue-B', { x: 10, y: 4 }, 'queen', 29, {
            teamID: 'blue',
            health: 100,
            orientation: { dx: 1, dy: 0 },
          }),
          piece('green-B', { x: 4, y: 3 }, 'knight', 11, {
            teamID: 'green',
            health: 95,
            orientation: { dx: 1, dy: 2 },
          }),
        ],
        {
          width: 11,
          height: 11,
          food: [
            { x: 8, y: 0 },
            { x: 6, y: 0 },
            { x: 9, y: 4 },
            { x: 7, y: 0 },
            { x: 2, y: 7 },
          ],
          invulnerabilityPotions: [
            { x: 5, y: 2 },
            { x: 2, y: 5 },
            { x: 5, y: 8 },
            { x: 4, y: 8 },
          ],
          invulnerabilityPotionsEnabled: true,
          invulnerabilityPotionWindowTurns: 3,
        } as Partial<Board>
      );

    it('prices the two collecting plans apart by more than the 0.03 the fold separates them by', () => {
      const board = seed6Turn39();
      const m = marshalBoard(board, TURN_39);
      // BOTH are potion cells: this is the pair a per-plan reading exists for.
      expect(m.potions).toContain(m.toIndex({ x: 5, y: 8 }));
      expect(m.potions).toContain(m.toIndex({ x: 2, y: 5 }));

      const played = chargeOf(perilAt(board, TURN_39, { x: 5, y: 8 }), 2);
      const other = chargeOf(perilAt(board, TURN_39, { x: 2, y: 5 }), 2);
      expect(played - other).toBeGreaterThan(MARGIN_25);
    });

    it('puts the collecting line below the non-collecting one, which is 0.34 away', () => {
      const board = seed6Turn39();
      const m = marshalBoard(board, TURN_39);
      // (1,6) collects nothing, so the member is identically zero on it.
      expect(m.potions).not.toContain(m.toIndex({ x: 1, y: 6 }));

      const played = chargeOf(perilAt(board, TURN_39, { x: 5, y: 8 }), 2);
      expect(played).toBeGreaterThan(MARGIN_16);
    });
  });

  /**
   * `potions` SEED 4, TURN 36 — P2's and P3's reproduction:
   *
   *     T 36 red-C knight hp98 (2,6)->(0,7)
   *          top3: (4,5)=-342.30 (0,7)=-342.34 (1,4)=-342.99
   *
   * `(0,7)` and `(4,5)` are both potion cells at a 0.04 margin, and red has
   * three living units. P2 measured the charge as IDENTICAL on the two and P3
   * measured it identical again for a different reason; the prediction is that
   * this shape finally tells them apart, by more than the margin.
   */
  describe('seed 4 turn 36: red-C plays (4,5), not (0,7)', () => {
    const TURN_36 = 36;
    /** (4,5) over (0,7) in the shipped arm — the two lines that both collect. */
    const MARGIN_45 = 342.34 - 342.3;

    const seed4Turn36 = (): Board =>
      boardOf(
        [
          makeSnake(
            'red-A',
            [
              { x: 3, y: 1 },
              { x: 2, y: 1 },
              { x: 2, y: 2 },
              { x: 3, y: 2 },
            ],
            { teamID: 'red', unitType: 'snake', health: 85, orientation: { dx: 1, dy: 0 } }
          ),
          piece('red-B', { x: 10, y: 10 }, 'pawn', 3, {
            teamID: 'red',
            health: 95,
            orientation: { dx: 0, dy: -1 },
          }),
          piece('red-C', { x: 2, y: 6 }, 'knight', 5, {
            teamID: 'red',
            health: 98,
            orientation: { dx: -1, dy: 2 },
          }),
          makeSnake(
            'blue-A',
            [
              { x: 4, y: 8 },
              { x: 4, y: 7 },
              { x: 4, y: 7 },
            ],
            { teamID: 'blue', unitType: 'snake', health: 100, orientation: { dx: 0, dy: -1 } }
          ),
          piece('blue-B', { x: 3, y: 9 }, 'queen', 24, {
            teamID: 'blue',
            health: 97,
            orientation: { dx: 1, dy: 0 },
          }),
          piece('blue-C', { x: 5, y: 8 }, 'pawn', 3, {
            teamID: 'blue',
            health: 94,
            orientation: { dx: 0, dy: -1 },
          }),
          makeSnake(
            'green-A',
            [
              { x: 9, y: 1 },
              { x: 10, y: 1 },
              { x: 10, y: 2 },
              { x: 10, y: 3 },
              { x: 9, y: 3 },
              { x: 9, y: 2 },
              { x: 8, y: 2 },
            ],
            { teamID: 'green', unitType: 'snake', health: 92, orientation: { dx: -1, dy: 0 } }
          ),
          piece('green-B', { x: 8, y: 4 }, 'knight', 9, {
            teamID: 'green',
            health: 100,
            orientation: { dx: 2, dy: 1 },
          }),
        ],
        {
          width: 11,
          height: 11,
          food: [
            { x: 9, y: 5 },
            { x: 6, y: 6 },
            { x: 4, y: 3 },
            { x: 3, y: 0 },
            { x: 8, y: 0 },
          ],
          hazards: [],
          hazardDamage: 100,
          pawnPromotionWeight: 10,
          invulnerabilityPotions: [
            { x: 2, y: 5 },
            { x: 4, y: 5 },
            { x: 9, y: 10 },
            { x: 0, y: 7 },
          ],
          invulnerabilityPotionsEnabled: true,
          invulnerabilityPotionWindowTurns: 3,
          activeEffects: [],
        } as Partial<Board>
      );

    it('charges (0,7) more than (4,5) by more than the 0.04 the fold separates them by', () => {
      const board = seed4Turn36();
      const m = marshalBoard(board, TURN_36);
      expect(m.potions).toContain(m.toIndex({ x: 0, y: 7 }));
      expect(m.potions).toContain(m.toIndex({ x: 4, y: 5 }));

      const played = chargeOf(perilAt(board, TURN_36, { x: 0, y: 7 }), 3);
      const other = chargeOf(perilAt(board, TURN_36, { x: 4, y: 5 }), 3);
      expect(played - other).toBeGreaterThan(MARGIN_45);
    });
  });
});
