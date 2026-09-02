/**
 * MARSHALLING READS TIER OFF THE SCHEDULE, NOT OFF THE WIRE'S COLLAPSE.
 *
 * The wire carries two fields per unit — an AGGREGATE `invulnerabilityLevel`
 * and a single `invulnerabilityExpiryTurn`, which `translate.ts` sets to the
 * EARLIEST expiry among that unit's effects. That pair cannot express a unit
 * holding two effects that lapse on different turns, and the failure is not
 * benign: a +1 buff and a -1 debuff sum to level 0 with the debuff's earliest
 * expiry, so once the debuff has lapsed the unit reads as tier 0 while it is
 * genuinely at tier 1. Tier is the FIRST key `strictMaximum` orders a contest
 * on, so a level read low is the sharpest error available.
 *
 * `marshalBoard` computes the tier from `Board.activeEffects` instead, under
 * settlement's own rule: an effect due at turn E still decides every contest
 * resolved during turn E, so it governs the arrival turn exactly when
 * `expiryTurn >= arrivalTurn`.
 *
 * The other half of the claim is that NOTHING ELSE MOVES. On a board with at
 * most one effect per unit the two readings agree by construction, and the
 * cases below pin that for every shape a fixture can take: no schedule at all,
 * an empty schedule, one live effect, one lapsed effect, and a level the
 * schedule does not account for.
 */

import { marshalBoard } from '../logic/turn-oracle';
import { Board, Coord, Snake } from '../types/battlesnake';
import type { ActiveEffect } from '@shared/types/Game';

const TURN = 10;
const ARRIVAL = TURN + 1;

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
    squad: 'A',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

const board = (snakes: Snake[], extra: Partial<Board> = {}): Board =>
  ({
    width: 11,
    height: 11,
    food: [],
    hazards: [],
    snakes,
    ...extra,
  } as Board);

const effect = (
  playerID: string,
  level: number,
  expiryTurn: number,
  type: ActiveEffect['type']
): ActiveEffect => ({ playerID, type, level, expiryTurn, sourcePlayerID: 'src' });

const buff = (playerID: string, expiryTurn: number): ActiveEffect =>
  effect(playerID, 1, expiryTurn, 'invulnerability_buff');
const debuff = (playerID: string, expiryTurn: number): ActiveEffect =>
  effect(playerID, -1, expiryTurn, 'invulnerability_debuff');

/** The tier `marshalBoard` hands the engine for one wire id. */
const tierOf = (b: Board, id: string): number =>
  marshalBoard(b, TURN).units.find((u) => u.id === id)?.tier ?? NaN;

const unit = (extra: Partial<Snake> = {}): Snake =>
  makeSnake('u', [{ x: 5, y: 5 }, { x: 5, y: 6 }], extra);

describe('a unit holding two effects with different expiries', () => {
  /**
   * The wire's collapse of this unit: level 1 + (-1) = 0, earliest expiry the
   * debuff's. Both halves of the collapsed pair point at tier 0, and both are
   * wrong the moment the debuff has lapsed.
   */
  const buffAndDebuff = (buffExpiry: number, debuffExpiry: number): Board =>
    board([unit({ invulnerabilityLevel: 0, invulnerabilityExpiryTurn: Math.min(buffExpiry, debuffExpiry) })], {
      activeEffects: [buff('u', buffExpiry), debuff('u', debuffExpiry)],
    });

  test('the lapsed half is dropped and the live half still governs', () => {
    // Debuff gone before the arrival turn, buff good for another ten.
    expect(tierOf(buffAndDebuff(ARRIVAL + 10, TURN), 'u')).toBe(1);
  });

  test('while both are live they cancel, as the aggregate said all along', () => {
    expect(tierOf(buffAndDebuff(ARRIVAL + 10, ARRIVAL + 3), 'u')).toBe(0);
  });

  test('the debuff outliving the buff reads NEGATIVE, which the collapse cannot say', () => {
    // A negative tier is a real state — `turnEngine` tracks a
    // `vulnerableCollided` set for exactly it — and the collapsed pair floors
    // it at 0.
    expect(tierOf(buffAndDebuff(TURN, ARRIVAL + 3), 'u')).toBe(-1);
  });

  test('two buffs of different lengths do not both lapse with the shorter one', () => {
    const b = board([unit({ invulnerabilityLevel: 2, invulnerabilityExpiryTurn: TURN })], {
      activeEffects: [buff('u', TURN), buff('u', ARRIVAL + 5)],
    });
    expect(tierOf(b, 'u')).toBe(1);
  });

  test('the schedule handed to settlement is exactly the effects counted into the tier', () => {
    const b = buffAndDebuff(ARRIVAL + 10, TURN);
    const m = marshalBoard(b, TURN);
    // Tier 1 from one surviving buff, and one surviving buff in the schedule:
    // settlement gives back exactly what marshalling put in.
    expect(m.effects.map((e) => e.level)).toEqual([1]);
    expect(m.units[0]?.tier).toBe(1);
  });
});

describe('at most one effect per unit, nothing changes', () => {
  test('no schedule at all keeps the wire reading verbatim', () => {
    const live = board([unit({ invulnerabilityLevel: 1, invulnerabilityExpiryTurn: ARRIVAL })]);
    const lapsed = board([unit({ invulnerabilityLevel: 1, invulnerabilityExpiryTurn: TURN })]);
    const noExpiry = board([unit({ invulnerabilityLevel: 1 })]);
    expect(tierOf(live, 'u')).toBe(1);
    expect(tierOf(lapsed, 'u')).toBe(0);
    // `tierAtArrival` defaults a missing expiry to the CURRENT turn, so a level
    // with no horizon does not govern the arrival turn. Unchanged.
    expect(tierOf(noExpiry, 'u')).toBe(0);
  });

  test('an empty schedule and no level is tier 0', () => {
    expect(tierOf(board([unit()], { activeEffects: [] }), 'u')).toBe(0);
  });

  test('one effect, live and lapsed, reads as it always did', () => {
    const live = board([unit({ invulnerabilityLevel: 1, invulnerabilityExpiryTurn: ARRIVAL })], {
      activeEffects: [buff('u', ARRIVAL)],
    });
    const lapsed = board([unit({ invulnerabilityLevel: 1, invulnerabilityExpiryTurn: TURN })], {
      activeEffects: [buff('u', TURN)],
    });
    expect(tierOf(live, 'u')).toBe(1);
    expect(tierOf(lapsed, 'u')).toBe(0);
  });

  test('a level the schedule does not account for survives on the wire rule', () => {
    // A fixture that states a level and lists no effect for it. The residual
    // keeps it, gated by the wire's own expiry, so such a board marshals
    // exactly as it did before the schedule was read at all.
    const stated = board([unit({ invulnerabilityLevel: 2, invulnerabilityExpiryTurn: ARRIVAL })], {
      activeEffects: [],
    });
    const statedLapsed = board([unit({ invulnerabilityLevel: 2, invulnerabilityExpiryTurn: TURN })], {
      activeEffects: [],
    });
    expect(tierOf(stated, 'u')).toBe(2);
    expect(tierOf(statedLapsed, 'u')).toBe(0);
  });

  test("another unit's effects never leak into ours", () => {
    const us = makeSnake('us', [{ x: 5, y: 5 }, { x: 5, y: 6 }]);
    const them = makeSnake('them', [{ x: 1, y: 1 }, { x: 1, y: 2 }], {
      invulnerabilityLevel: 1,
      invulnerabilityExpiryTurn: ARRIVAL + 3,
    });
    const b = board([us, them], { activeEffects: [buff('them', ARRIVAL + 3)] });
    expect(tierOf(b, 'us')).toBe(0);
    expect(tierOf(b, 'them')).toBe(1);
  });
});
