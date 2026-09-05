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
import { claimsAfter, marshalBoard } from '../../logic/turn-oracle';
import { type ArrivalField, arrivalField, beatenAt } from '../evaluate/contest';
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

// -------------------------------------------------- THE PER-PLAN PERIL BOUND

/**
 * `potions` SEED 4, TURN 36 — the board three attempts at the potion member's
 * peril half have now been sized against, and the fixture that says why the
 * third one fails too.
 *
 *     T 36 red-C knight hp98 (2,6)->(0,7)
 *          top3: (4,5)=-342.30 (0,7)=-342.34 (1,4)=-342.99
 *     POTION x1  tier up: red-A, red-B  tier down: red-C
 *          [red-C hp97 enemyTier+0 caught@1 EXPOSED arrival=safe ground1=1/5]
 *
 * `(0,7)` and `(4,5)` are BOTH potion cells, so the top two candidates are two
 * collecting plans that leave the collector in different places; `(1,4)` is the
 * one line that collects nothing, and it is 0.65 away.
 *
 * `docs/design/BEHAVIOUR-AUDIT-2.md` §P2 measured why no scaling of the peril
 * can order those two: `perilOf` reads the collector's ground from the cell it
 * STANDS on, so the charge is a constant across every plan in which red-C
 * collects, and a constant cancels. The repair that section names as the only
 * one left — read the ground from the cell the PLAN leaves it on, and from the
 * ground reachable from there — is what this fixture prices, and the four
 * numbers below are the whole of why it is not the repair either.
 *
 * Nothing here imports the member. The reading is the engine's own claims and
 * `contest.ts`'s own arrival field, so these numbers are facts about the board
 * and survive whatever the fold does or does not ship.
 */
describe('potions seed 4 turn 36: the collector\'s ground, read two ways', () => {
  const SEED4_T36_TURN = 36;

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
      }
    );

  /** The window's enemy arrival fields, exactly as `window.ts::windowRead`
   *  builds them: one per horizon, the best enemy claim at every cell. */
  const enemyHorizons = (m: ReturnType<typeof marshalBoard>, window: number): ArrivalField[] => {
    const fields: ArrivalField[] = [];
    for (let k = 1; k <= window; k++) {
      const arrivals = [];
      for (const claim of claimsAfter(m, k)) {
        const unit = m.units.find((u) => u.id === claim.id);
        if (unit === undefined || unit.teamID === 'red') continue;
        arrivals.push({ cells: claim.everPossible, tier: claim.tierAtArrival, weight: claim.weightMax });
      }
      fields.push(arrivalField(m.fullWidth * m.fullHeight, arrivals));
    }
    return fields;
  };

  /** `peril` as the member computes it: the beaten SHARE per horizon, weighted
   *  `W − k + 1`. The only free variable is which ground is handed in. */
  const perilOver = (
    rows: ReadonlyArray<ReadonlyArray<number>>,
    fields: ReadonlyArray<ArrivalField>,
    window: number
  ): number => {
    let num = 0;
    let den = 0;
    for (let k = 1; k <= window; k++) {
      const cells = rows[k - 1];
      const field = fields[k - 1];
      if (cells === undefined || field === undefined || cells.length === 0) continue;
      let beaten = 0;
      // red-C's DEBUFFED tier is −1 and its weight is 5: what settlement leaves
      // it on once the pickup lands.
      for (const cell of cells) if (beatenAt(field, -1, 5, cell)) beaten++;
      const w = window - k + 1;
      num += (w * beaten) / cells.length;
      den += w;
    }
    return den > 0 ? num / den : 0;
  };

  /** Where red-C could be `k` turns after the plan leaves it on `cell`. */
  const groundFrom = (
    m: ReturnType<typeof marshalBoard>,
    cell: number,
    window: number
  ): number[][] => {
    const moved = {
      ...m,
      units: m.units.map((u) => (u.id === 'red-C' ? { ...u, occupancy: [cell] } : u)),
    };
    const rows: number[][] = [[cell]];
    for (let j = 1; j <= window - 1; j++) {
      rows.push([...(claimsAfter(moved, j).find((c) => c.id === 'red-C')?.everPossible ?? [])]);
    }
    return rows;
  };

  it('reads the turn-start ground at 3/9, 34/34, 73/73 — the saturation D4 named', () => {
    const board = seed4Turn36();
    const m = marshalBoard(board, SEED4_T36_TURN);
    const fields = enemyHorizons(m, 3);
    const rows: number[][] = [];
    for (let k = 1; k <= 3; k++) {
      rows.push([...(claimsAfter(m, k).find((c) => c.id === 'red-C')?.everPossible ?? [])]);
    }
    expect(rows.map((r) => r.length)).toEqual([9, 34, 73]);
    const beaten = rows.map((r, i) => r.filter((c) => beatenAt(fields[i] as ArrivalField, -1, 5, c)).length);
    expect(beaten).toEqual([3, 34, 73]);
    // (3·(3/9) + 2·1 + 1·1) / 6 — half of it the constant tail.
    expect(perilOver(rows, fields, 3)).toBeCloseTo(2 / 3, 6);
  });

  it('prices BOTH collecting plans and the non-collecting one at the same 0.5 when the ground is read from the plan', () => {
    const board = seed4Turn36();
    const m = marshalBoard(board, SEED4_T36_TURN);
    const fields = enemyHorizons(m, 3);
    const at = (x: number, y: number): number => m.toIndex({ x, y });
    // (0,7) and (4,5) are both potion cells: two COLLECTING plans that leave
    // the collector in different places. (1,4) collects nothing.
    expect(m.potions).toContain(at(0, 7));
    expect(m.potions).toContain(at(4, 5));
    expect(m.potions).not.toContain(at(1, 4));

    const played = groundFrom(m, at(0, 7), 3);
    const other = groundFrom(m, at(4, 5), 3);
    const clean = groundFrom(m, at(1, 4), 3);

    // HORIZON 1 IS ONE CELL — the cell the plan chose — and none of the three
    // is beaten there. HORIZONS 2 AND 3 ARE STILL SATURATED, on grounds of
    // three different sizes.
    expect(played.map((r) => r.length)).toEqual([1, 5, 21]);
    expect(other.map((r) => r.length)).toEqual([1, 9, 41]);
    expect(clean.map((r) => r.length)).toEqual([1, 7, 29]);
    for (const rows of [played, other, clean]) {
      const beaten = rows.map((r, i) => r.filter((c) => beatenAt(fields[i] as ArrivalField, -1, 5, c)).length);
      expect(beaten).toEqual([0, rows[1]?.length, rows[2]?.length]);
    }

    // THE REFUTATION, as one number three times. Conditioning the ground on the
    // plan collapses the one discriminating horizon to a BOOLEAN on a single
    // cell; where that boolean is false — 30 of the corpus's 35 pickups — every
    // arrival cell reads `(3·0 + 2 + 1)/6`, so the per-plan peril is the same
    // constant it replaced, only 0.167 LOWER. It cannot order red-C's two
    // collecting plans against each other, and being cheaper it moves the
    // collecting lines TOWARD the pickup rather than away from it.
    expect(perilOver(played, fields, 3)).toBeCloseTo(0.5, 6);
    expect(perilOver(other, fields, 3)).toBeCloseTo(0.5, 6);
    expect(perilOver(clean, fields, 3)).toBeCloseTo(0.5, 6);
    expect(perilOver(played, fields, 3)).toBeLessThan(perilOver([[at(2, 6)]], fields, 1) + 2 / 3);
  });
});
