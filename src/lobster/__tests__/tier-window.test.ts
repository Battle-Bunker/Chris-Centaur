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

import { Board, Coord, Snake } from '../../types/battlesnake';
import { marshalBoard } from '../../logic/turn-oracle';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import type { EngineSubstrate } from '../substrate';
import { GrammarCandidateGenerator, PRUNE } from '../candidates';
import { exposureOf, gradePath, heldTierAt, selfDebuffOf } from '../tier-window';
import { potionBoardEnabled, tierExpiryEnabled } from '../tier-truth';

// --------------------------------------------------------------------- fixtures

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const piece = (
  id: string,
  at: Coord,
  unitType: string,
  weight: number,
  extra: Partial<Snake> = {}
): Snake => makeSnake(id, [at], { unitType, length: weight, ...extra });

const boardOf = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({ width: 9, height: 9, food: [], hazards: [], snakes, ...extra }) as Board;

const TURN = 30;
const ARRIVAL = TURN + 1;

const subFor = (board: Board, asTeam = 'A'): EngineSubstrate =>
  makeSubstrate({ board, turn: TURN, asTeam });

const unitNamed = (sub: EngineSubstrate, wireId: string) => {
  const u = sub.unitOfWireId(wireId);
  if (u === undefined) throw new Error(`no unit ${wireId}`);
  return u;
};

const slotNamed = (sub: EngineSubstrate, wireId: string) => {
  const unit = unitNamed(sub, wireId);
  const slot = sub.claimField().slots.find((s) => s.record.unitId === unit.unitId);
  if (slot === undefined) throw new Error(`${wireId} is not a claim on this field`);
  return slot;
};

afterEach(() => clearGeometryCache());

// --------------------------------------------------------------------- THREADED

describe('the wire reaches the cloud', () => {
  it('is configured to feed both facts by default', () => {
    expect(tierExpiryEnabled()).toBe(true);
    expect(potionBoardEnabled()).toBe(true);
  });

  it('converts the wire expiry from inclusive to exclusive exactly once', () => {
    const board = boardOf([
      piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
      piece('B1', { x: 5, y: 5 }, 'rook', 3, {
        teamID: 'B',
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: 33,
      }),
      // No schedule on the wire at all: the cloud must not invent a horizon.
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
    // [wire expiry, tier the arrival turn is governed by, cloud ceiling at n=1]
    ['the window is still live on the arrival turn', 31, 1, 1],
    ['the window has one turn to run after the arrival turn', 32, 1, 1],
    ['the window lapsed before the arrival turn', 30, 0, 0],
  ])('%s', (_name, expiry, expectedTier, expectedCeiling) => {
    const board = boardOf([
      piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
      piece('B1', { x: 5, y: 5 }, 'rook', 3, {
        teamID: 'B',
        invulnerabilityLevel: 1,
        invulnerabilityExpiryTurn: expiry as number,
      }),
    ]);
    const sub = subFor(board);
    const slot = slotNamed(sub, 'B1');
    expect(slot.record.tier).toBe(expectedTier);
    expect(heldTierAt(slot.record, ARRIVAL)).toBe(expectedTier);
    expect(slot.bounds.tierMax).toBeGreaterThanOrEqual(expectedCeiling as number);
    sub.release();
  });

  it('lets a frozen buff LAPSE as the cloud dilates — the lie that used to be told', () => {
    const board = boardOf([
      piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
      piece('B1', { x: 5, y: 5 }, 'knight', 2, {
        teamID: 'B',
        invulnerabilityLevel: 2,
        invulnerabilityExpiryTurn: 32,
      }),
    ]);
    const sub = subFor(board);
    const unit = unitNamed(sub, 'B1');
    const start = sub.claimField();
    const early = start.slots.find((s) => s.record.unitId === unit.unitId);
    expect(early?.bounds.tierMax).toBeGreaterThanOrEqual(2);

    // Turn 36 is four turns past the last turn the effect governs. A cloud that
    // did not know about expiry reported +2 here forever; the territory fold
    // reads exactly this, one absolute turn at a time, across its whole shell
    // sweep.
    const late = start.advanceTo(TURN + 6).slots.find((s) => s.record.unitId === unit.unitId);
    expect(heldTierAt(unit, TURN + 6)).toBe(0);
    expect(late?.bounds.tierMax).toBeLessThan(early?.bounds.tierMax as number);
    sub.release();
  });

  it('feeds the potion board, so a reachable potion can move a frozen tier', () => {
    const near = { x: 5, y: 4 };
    const withPotion = boardOf(
      [
        piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
        piece('B1', { x: 5, y: 5 }, 'king', 1, { teamID: 'B' }),
      ],
      { invulnerabilityPotions: [near] }
    );
    const without = boardOf([
      piece('A1', { x: 1, y: 1 }, 'rook', 3, { teamID: 'A' }),
      piece('B1', { x: 5, y: 5 }, 'king', 1, { teamID: 'B' }),
    ]);

    const withSub = subFor(withPotion);
    const withoutSub = subFor(without);
    const a = slotNamed(withSub, 'B1').bounds;
    const b = slotNamed(withoutSub, 'B1').bounds;
    // The dead code, alive: `reachablePotions` is no longer identically zero,
    // so the interval opens instead of collapsing onto the observed tier.
    expect([a.tierMin, a.tierMax]).not.toEqual([b.tierMin, b.tierMax]);
    expect(a.tierMin).toBeLessThanOrEqual(b.tierMin);
    expect(a.tierMax).toBeGreaterThanOrEqual(b.tierMax);
    withSub.release();
    withoutSub.release();
  });

  it('reads a potion cell as a potion cell whatever the cloud is fed', () => {
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
      sub.actionsOf(rook.unitId).map((c) => gradePath(sub, exposure, rook.cells[0], c.path))
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
      expect(gradePath(sub, exposure, rook.cells[0], c.path)).not.toBe('decisive');
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
      set.candidates.some((c) => gradePath(sub, exposure, rook.cells[0], c.path) === 'decisive')
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

  it('charges a plain pickup nothing — the team ledger for one is not a loss', () => {
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
      'spend'
    );
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
        expect(gradePath(sub, exposure, unit.cells[0], c.path)).toBe('clear');
      }
    }
    sub.release();
  });
});
