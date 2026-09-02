/**
 * THE THREE POTION TERMS, ON HAND-BUILT BOARDS.
 *
 * Every board is written out cell by cell and every reach map is a literal, so
 * the expected answer is countable by hand. The reach map is a literal ON
 * PURPOSE: these terms BORROW the arrival map rather than computing one, and a
 * test that stood a dilation up would be testing the dilation.
 *
 * The claims under test are the owner's attack semantics, which are the whole
 * reason the terms exist:
 *
 *   1. a body cut needs a STRICTLY HIGHER tier — no potion, no body channel;
 *   2. without one, a piece attacks only the HEAD of a lower-weight unit, and
 *      that channel prices without a tier and is never a reason to collect;
 *   3. the window is exactly three turns, and travel eats it through the
 *      movement rule rather than through a penalty anybody chose.
 */

import { UnitKind } from '../../partial-engine/index';
import type { RayBoard, RayUnit } from '../evaluate/ray-crossing';
import {
  ATTACK_WINDOW_ENTRY,
  POTION_WINDOW_TURNS,
  UNREACHABLE,
  attackWindow,
  reachFromEarliest,
  reachFromShells,
  teamAttackWindow,
} from '../evaluate/attack-window';
import {
  POTION_SEEK_ENTRY,
  bestPotionSeek,
  potionSeek,
  potionSeekNet,
  potionSeekRecommends,
  teamHasLiveWindow,
} from '../evaluate/potion-seek';
import {
  POTION_CONTROL_ENTRY,
  potionControl,
  potionControlSummary,
} from '../evaluate/potion-control';
import { severExchangeRate } from '../evaluate/slider-attack-vector';

// A 16x16 full board: the perimeter is the wall, the interior is x,y in 1..14.
const W = 16;
const H = 16;
const CELLS = W * H;
const at = (x: number, y: number): number => y * W + x;

const TURN = 10;

/** A ten-cell enemy snake running down the file x = 8, head at the top. */
const BODY_10 = Array.from({ length: 10 }, (_, i) => at(8, 3 + i));

const enemySnake = (over: Partial<RayUnit> = {}): RayUnit => ({
  unitId: 'enemy-snake',
  team: 1,
  kind: UnitKind.Snake,
  occupancy: BODY_10,
  weight: BODY_10.length,
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
  tier: 0,
  health: 100,
  ...over,
});

const ourSnake = (over: Partial<RayUnit> = {}): RayUnit => ({
  unitId: 'our-snake',
  team: 0,
  kind: UnitKind.Snake,
  occupancy: [at(2, 12), at(2, 13), at(2, 14)],
  weight: 3,
  tier: 0,
  health: 100,
  ...over,
});

const boardOf = (units: RayUnit[], turn = TURN): RayBoard => ({
  width: W,
  height: H,
  units,
  turn,
});

/**
 * A reach map as a literal: `{ unitId: { cell: absoluteTurn } }`. Everything
 * unnamed is unreachable, which is the honest default for a hand-built board.
 */
function reachOf(spec: Record<string, Record<number, number>>) {
  const grids = new Map<string, Int32Array>();
  for (const [unitId, cells] of Object.entries(spec)) {
    const g = new Int32Array(CELLS).fill(UNREACHABLE);
    for (const [cell, turn] of Object.entries(cells)) g[Number(cell)] = turn;
    grids.set(unitId, g);
  }
  return reachFromEarliest(grids);
}

// ---------------------------------------------------------------------------
// attackWindow
// ---------------------------------------------------------------------------

describe('attackWindow — the body channel is tier-gated, absolutely', () => {
  const bodyCell = BODY_10[3] as number; // occupancy index 3 of a ten-cell body

  it('is empty at equal tier and non-empty at +1, on the same board', () => {
    const queen = ourQueen();
    const board = boardOf([queen, enemySnake()]);
    const reach = reachOf({ 'our-queen': { [bodyCell]: TURN + 1 } });

    const level = attackWindow(board, queen, { turn: TURN, tierDelta: 0, reach });
    const buffed = attackWindow(board, queen, { turn: TURN, tierDelta: 1, reach });

    expect(level.body.est).toBe(0);
    expect(level.body.hi).toBe(0);
    expect(level.bodyAt).toBeNull();
    // weight 10, occupancy index 3, arriving one turn out: hi = 10 - 3 = 7,
    // est = 10 - 3 - 1 = 6 by the body-shift rule.
    expect(buffed.body.hi).toBe(7);
    expect(buffed.body.est).toBe(6);
    expect(buffed.bodyAt).toBe(TURN + 1);
    expect(buffed.bodyVictim).toBe('enemy-snake');
  });

  it('stays empty at +1 when the owner is buffed too — strictly higher, or nothing', () => {
    const queen = ourQueen();
    const board = boardOf([queen, enemySnake({ tier: 1 })]);
    const reach = reachOf({ 'our-queen': { [bodyCell]: TURN + 1 } });
    expect(attackWindow(board, queen, { turn: TURN, tierDelta: 1, reach }).body.est).toBe(0);
    expect(attackWindow(board, queen, { turn: TURN, tierDelta: 2, reach }).body.est).toBe(6);
  });

  it('charges travel through the movement rule, not through a penalty', () => {
    const queen = ourQueen();
    const board = boardOf([queen, enemySnake()]);
    const near = attackWindow(board, queen, {
      turn: TURN,
      tierDelta: 1,
      reach: reachOf({ 'our-queen': { [bodyCell]: TURN + 1 } }),
    });
    const far = attackWindow(board, queen, {
      turn: TURN,
      tierDelta: 1,
      reach: reachOf({ 'our-queen': { [bodyCell]: TURN + 3 } }),
    });
    // Three turns out the same cell carries three fewer cells behind it.
    expect(near.body.est - far.body.est).toBe(2);
    // The optimistic endpoint does not decay: nothing moved, by assumption.
    expect(near.body.hi).toBe(far.body.hi);
  });

  it('refuses a cut outside the three-turn window', () => {
    const queen = ourQueen();
    const board = boardOf([queen, enemySnake()]);
    const reach = reachOf({ 'our-queen': { [bodyCell]: TURN + POTION_WINDOW_TURNS + 1 } });
    expect(attackWindow(board, queen, { turn: TURN, tierDelta: 1, reach }).body.est).toBe(0);
  });
});

describe('attackWindow — the head channel prices without a tier', () => {
  it('takes a lighter head at level tier and is untouched by tierDelta', () => {
    const queen = ourQueen({ weight: 8 });
    const enemy = enemySnake({ occupancy: [at(12, 5)], weight: 3 });
    const board = boardOf([queen, enemy]);
    const reach = reachOf({ 'our-queen': { [at(12, 5)]: TURN + 1 } });

    const level = attackWindow(board, queen, { turn: TURN, tierDelta: 0, reach });
    expect(level.head.est).toBe(3);
    expect(level.headVictim).toBe('enemy-snake');
    expect(level.body.est).toBe(0);

    // The head channel is judged at the unit's OWN tier, so a hypothetical
    // pickup does not change it. That is what makes it "no reason to collect".
    const buffed = attackWindow(board, queen, { turn: TURN, tierDelta: 1, reach });
    expect(buffed.head.est).toBe(level.head.est);
  });

  it('refuses a heavier head at level tier — weight decides only after tier', () => {
    const queen = ourQueen({ weight: 2 });
    const enemy = enemySnake({ occupancy: [at(12, 5)], weight: 9 });
    const board = boardOf([queen, enemy]);
    const reach = reachOf({ 'our-queen': { [at(12, 5)]: TURN + 1 } });
    expect(attackWindow(board, queen, { turn: TURN, reach }).head.est).toBe(0);
  });

  it('keeps heads out of the team total, which is the body channel only', () => {
    const queen = ourQueen({ weight: 8 });
    const head = enemySnake({ unitId: 'enemy-head', occupancy: [at(12, 5)], weight: 3 });
    const board = boardOf([queen, head]);
    const reach = reachOf({ 'our-queen': { [at(12, 5)]: TURN + 1 } });
    const team = teamAttackWindow(board, 0, { turn: TURN, tierDelta: 1, reach });
    expect(team.total.est).toBe(0);
    expect(team.armed).toBe(0);
    expect(team.per[0]?.head.est).toBe(3);
  });
});

describe('attackWindow — the exact half, and the borrowed half', () => {
  it('reports a cut executable this turn from the ordered ray walk alone', () => {
    // The queen sits on the rank the body crosses, with a clear line east.
    const queen = ourQueen({ occupancy: [at(2, 6)] });
    const board = boardOf([queen, enemySnake()]);
    // No reach map at all: the exact half must still fire.
    const buffed = attackWindow(board, queen, { turn: TURN, tierDelta: 1 });
    // Body cell (8,6) is occupancy index 3 of ten: 7 cells go.
    expect(buffed.executableNow).toBe(7);
    expect(buffed.body.est).toBe(0);
    const level = attackWindow(board, queen, { turn: TURN, tierDelta: 0 });
    expect(level.executableNow).toBe(0);
  });

  it('reads UnitShells structurally, so the production path passes its own', () => {
    const grid = new Int32Array(CELLS).fill(UNREACHABLE);
    grid[at(8, 6)] = TURN + 2;
    const reach = reachFromShells(new Map([['our-queen', { earliest: () => grid }]]));
    expect(reach.earliestAt('our-queen', at(8, 6))).toBe(TURN + 2);
    expect(reach.earliestAt('our-queen', at(1, 1))).toBe(UNREACHABLE);
    expect(reach.earliestAt('nobody', at(8, 6))).toBe(UNREACHABLE);
  });

  it('flags a cut an enemy of equal tier can also reach as contested', () => {
    const queen = ourQueen();
    const rival = enemySnake({
      unitId: 'enemy-rook',
      kind: UnitKind.Rook,
      occupancy: [at(14, 14)],
      weight: 4,
      tier: 1,
    });
    const board = boardOf([queen, enemySnake(), rival]);
    const cell = BODY_10[3] as number;
    const quiet = attackWindow(board, queen, {
      turn: TURN,
      tierDelta: 1,
      reach: reachOf({ 'our-queen': { [cell]: TURN + 1 } }),
    });
    expect(quiet.contested).toBe(false);
    const busy = attackWindow(board, queen, {
      turn: TURN,
      tierDelta: 1,
      reach: reachOf({ 'our-queen': { [cell]: TURN + 1 }, 'enemy-rook': { [cell]: TURN + 2 } }),
    });
    expect(busy.contested).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// potionSeek
// ---------------------------------------------------------------------------

describe('potionSeek — the collector pays and the allies collect', () => {
  const POTION = at(3, 12);
  const bodyCell = BODY_10[3] as number;

  const setup = (over: { potionAt?: number; enemyReachesPotion?: number } = {}) => {
    const queen = ourQueen();
    const snake = ourSnake();
    const enemy = enemySnake();
    const board = boardOf([queen, snake, enemy]);
    const spec: Record<string, Record<number, number>> = {
      'our-snake': { [POTION]: over.potionAt ?? TURN + 1 },
      'our-queen': { [bodyCell]: TURN + 2 },
    };
    if (over.enemyReachesPotion !== undefined) {
      spec['enemy-snake'] = { [POTION]: over.enemyReachesPotion };
    }
    return { board, queen, snake, enemy, reach: reachOf(spec) };
  };

  it('prices the ally window and excludes the collector from it', () => {
    const { board, snake, reach } = setup();
    const v = potionSeek(board, snake, POTION, { turn: TURN, reach });
    expect(v.reachable).toBe(true);
    expect(v.travelTurns).toBe(1);
    expect(v.collectAtTurn).toBe(TURN + 1);
    // Window is the three turns after the collection, inclusive.
    expect(v.windowFrom).toBe(TURN + 2);
    expect(v.windowTo).toBe(TURN + 4);
    // The queen arrives on the body at TURN+2, two turns from now: 10 - 3 - 2.
    expect(v.gain.est).toBe(5);
    expect(v.armedAllies).toBe(1);
    expect(v.bestAllyId).toBe('our-queen');
  });

  it('is zero when the ally cannot land inside the window', () => {
    const queen = ourQueen();
    const snake = ourSnake();
    const board = boardOf([queen, snake, enemySnake()]);
    // The queen reaches the body only at TURN+1 — BEFORE the window opens.
    const reach = reachOf({
      'our-snake': { [POTION]: TURN + 1 },
      'our-queen': { [bodyCell]: TURN + 1 },
    });
    const v = potionSeek(board, snake, POTION, { turn: TURN, reach });
    expect(v.gain.est).toBe(0);
    expect(potionSeekRecommends(v, 1)).toBe(false);
  });

  it('charges the collector its whole weight when an enemy can reach it', () => {
    const safe = setup();
    const risky = setup({ enemyReachesPotion: TURN + 3 });
    const a = potionSeek(safe.board, safe.snake, POTION, { turn: TURN, reach: safe.reach });
    const b = potionSeek(risky.board, risky.snake, POTION, { turn: TURN, reach: risky.reach });
    expect(a.exposure.contested).toBe(false);
    expect(a.exposure.weightAtRisk).toBe(0);
    expect(b.exposure.contested).toBe(true);
    expect(b.exposure.weightAtRisk).toBe(3);
    // The engine cancels the team's buffs when a vulnerable unit collides, so
    // the window is at risk too — not merely the collector.
    expect(b.exposure.windowAtRisk).toBe(b.gain.est);
    expect(potionSeekNet(b, 1, { worstCase: true })).toBeLessThan(
      potionSeekNet(b, 1)
    );
  });

  it('brackets the exposure: none ≥ near ≥ window, and near is the tighter read', () => {
    // The enemy can be on the potion cell only LATE in the window — after the
    // collector has moved on, which is exactly where the loose reading claims
    // knowledge it does not have.
    const queen = ourQueen();
    const snake = ourSnake();
    const board = boardOf([queen, snake, enemySnake()]);
    const reach = reachOf({
      'our-snake': { [POTION]: TURN + 1 },
      'our-queen': { [bodyCell]: TURN + 2 },
      'enemy-snake': { [POTION]: TURN + 4 },
    });
    const v = potionSeek(board, snake, POTION, { turn: TURN, reach });
    expect(v.exposure.contested).toBe(true);
    expect(v.exposure.contestedNear).toBe(false);
    expect(v.exposure.weightAtRisk).toBe(3);
    expect(v.exposure.weightAtRiskNear).toBe(0);

    const none = potionSeekNet(v, 1, { exposure: 'none' });
    const near = potionSeekNet(v, 1, { exposure: 'near' });
    const window = potionSeekNet(v, 1, { exposure: 'window' });
    expect(none).toBeGreaterThanOrEqual(near);
    expect(near).toBeGreaterThanOrEqual(window);
    expect(none - window).toBe(3);
    // The default is the worst case, which is what the ruling asked for.
    expect(potionSeekNet(v, 1)).toBe(window);
  });

  it('declines to price a potion further away than the window is long', () => {
    const { board, snake, reach } = setup({ potionAt: TURN + 9 });
    const v = potionSeek(board, snake, POTION, { turn: TURN, reach });
    expect(v.reachable).toBe(false);
    expect(potionSeekNet(v, 1)).toBe(0);
    expect(potionSeekRecommends(v, 1)).toBe(false);
  });

  it('folds enemy weight at the share-metric rate and our own at one', () => {
    const { board, snake, reach } = setup({ enemyReachesPotion: TURN + 3 });
    const v = potionSeek(board, snake, POTION, { turn: TURN, reach });
    const rate = severExchangeRate(board, 0);
    expect(potionSeekNet(v, rate)).toBeCloseTo(rate * v.gain.est - 3, 10);
  });

  it('picks the collector with nothing to attack over the one with a line', () => {
    // Both our units can reach the potion; only the queen has a cut. Sending
    // the queen would spend the very unit the window is for.
    const queen = ourQueen();
    const snake = ourSnake();
    const board = boardOf([queen, snake, enemySnake()]);
    const reach = reachOf({
      'our-snake': { [POTION]: TURN + 1 },
      'our-queen': { [POTION]: TURN + 1, [bodyCell]: TURN + 2 },
    });
    const best = bestPotionSeek(board, 0, [POTION], 1, { turn: TURN, reach });
    expect(best?.value.collectorId).toBe('our-snake');
  });

  it('sees a live window without reading the board twice', () => {
    const board = boardOf([ourQueen({ tier: 1, tierExpiresAtTurn: TURN + 1 }), ourSnake()]);
    expect(teamHasLiveWindow(board, 0, TURN)).toBe(true);
    expect(teamHasLiveWindow(board, 0, TURN + 2)).toBe(false);
    expect(teamHasLiveWindow(board, 1, TURN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// potionControl
// ---------------------------------------------------------------------------

describe('potionControl — whose ground the potion is standing on', () => {
  const POTION = at(7, 7);

  const threeSided = () => {
    const queen = ourQueen();
    const snake = ourSnake();
    const enemy = enemySnake();
    return { board: boardOf([queen, snake, enemy]), queen, snake, enemy };
  };

  it('gives the potion to whoever arrives strictly first, and a tie to nobody', () => {
    const { board } = threeSided();
    const ours = potionControl(board, 0, POTION, {
      turn: TURN,
      reach: reachOf({ 'our-snake': { [POTION]: TURN + 1 }, 'enemy-snake': { [POTION]: TURN + 3 } }),
    });
    expect(ours.owner).toBe('ours');
    expect(ours.margin).toBe(2);

    const theirs = potionControl(board, 0, POTION, {
      turn: TURN,
      reach: reachOf({ 'our-snake': { [POTION]: TURN + 3 }, 'enemy-snake': { [POTION]: TURN + 1 } }),
    });
    expect(theirs.owner).toBe('theirs');
    expect(theirs.margin).toBe(-2);

    const tied = potionControl(board, 0, POTION, {
      turn: TURN,
      reach: reachOf({ 'our-snake': { [POTION]: TURN + 2 }, 'enemy-snake': { [POTION]: TURN + 2 } }),
    });
    expect(tied.owner).toBe('contested');
    expect(tied.option.est).toBe(0);
    expect(tied.threat.est).toBe(0);
  });

  it('counts a potion nobody reaches for nobody', () => {
    const { board } = threeSided();
    const c = potionControl(board, 0, POTION, { turn: TURN, reach: reachOf({}) });
    expect(c.owner).toBe('nobody');
    expect(c.option.est).toBe(0);
    expect(c.threat.est).toBe(0);
  });

  it('banks option value on a potion we hold and threat value on one they hold', () => {
    const bodyCell = BODY_10[3] as number;
    const { board } = threeSided();
    const held = potionControl(board, 0, POTION, {
      turn: TURN,
      reach: reachOf({
        'our-snake': { [POTION]: TURN + 1 },
        'our-queen': { [bodyCell]: TURN + 2 },
        'enemy-snake': { [POTION]: TURN + 3 },
      }),
    });
    expect(held.owner).toBe('ours');
    expect(held.option.est).toBeGreaterThan(0);
    expect(held.threat.est).toBe(0);
  });

  it('prices their window against our bodies as threat, and says how much is ours', () => {
    // Their rook can reach our snake's body; they get the potion first. The
    // cut is aimed near the HEAD end — a cut at the tail two turns out is
    // worth nothing, because by then the tail has popped.
    const long = ourSnake({
      occupancy: Array.from({ length: 6 }, (_, i) => at(2, 9 + i)),
      weight: 6,
    });
    const ourBody = long.occupancy[1] as number;
    const rook: RayUnit = {
      unitId: 'enemy-rook',
      team: 1,
      kind: UnitKind.Rook,
      occupancy: [at(13, 13)],
      weight: 4,
      tier: 0,
      health: 100,
    };
    const board = boardOf([ourQueen(), long, enemySnake(), rook]);
    const c = potionControl(board, 0, POTION, {
      turn: TURN,
      reach: reachOf({
        'enemy-snake': { [POTION]: TURN + 1 },
        'enemy-rook': { [ourBody]: TURN + 2 },
        'our-snake': { [POTION]: TURN + 3 },
      }),
    });
    expect(c.owner).toBe('theirs');
    expect(c.threat.est).toBeGreaterThan(0);
    expect(c.threatAgainstUs).toBe(c.threat.est);
    expect(c.option.est).toBe(0);
  });

  it('summarises a board of potions into a balance and a net weight', () => {
    const { board } = threeSided();
    const A = at(4, 4);
    const B = at(11, 11);
    const s = potionControlSummary(board, 0, [A, B], {
      turn: TURN,
      reach: reachOf({
        'our-snake': { [A]: TURN + 1, [B]: TURN + 3 },
        'enemy-snake': { [A]: TURN + 3, [B]: TURN + 1 },
      }),
    });
    expect(s.ours).toBe(1);
    expect(s.theirs).toBe(1);
    expect(s.balance).toBe(0);
    expect(s.net).toBe(s.optionTotal - s.threatTotal);
  });

  it('is exactly zero with no potion standing — the gate is total', () => {
    const { board } = threeSided();
    const s = potionControlSummary(board, 0, [], { turn: TURN, reach: reachOf({}) });
    expect(s.balance).toBe(0);
    expect(s.net).toBe(0);
    expect(s.potions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// the entries
// ---------------------------------------------------------------------------

describe('the candidates are data, and nothing consumes them', () => {
  it('declares three evaluator entries at weight zero', () => {
    for (const e of [ATTACK_WINDOW_ENTRY, POTION_SEEK_ENTRY, POTION_CONTROL_ENTRY]) {
      expect(e.slot).toBe('evaluator');
      expect(e.soundness).toBe('advisory');
      expect(e.record.status).toBe('candidate');
      expect((e.params as { weight: number }).weight).toBe(0);
      // Slot prefix, name, version. The version is NOT pinned to 1: the
      // identity law requires a params change to mint a new one, so a test
      // that forbade @2 would forbid the law being obeyed. `potion-seek` is
      // at @2 because its `exposure` param now names the dodge discount.
      expect(e.id).toMatch(/^eval\/[a-z-]+@\d+$/);
    }
    expect(POTION_SEEK_ENTRY.id).toBe('eval/potion-seek@2');
  });

  it('is not in the shipped registry — a candidate is configured in, never flagged on', () => {
    // A require rather than an import: the registry pulls the whole search in,
    // and this file must not acquire that dependency at module scope.

    const { LEGACY_ENTRIES } = require('../registry') as {
      LEGACY_ENTRIES: ReadonlyArray<{ id: string }>;
    };
    const ids = new Set(LEGACY_ENTRIES.map((e) => e.id));
    expect(ids.has(ATTACK_WINDOW_ENTRY.id)).toBe(false);
    expect(ids.has(POTION_SEEK_ENTRY.id)).toBe(false);
    expect(ids.has(POTION_CONTROL_ENTRY.id)).toBe(false);
  });
});
