/**
 * THE POTION-TIER CEILING, pinned in THIS repo — the downstream half of the
 * upstream `partial-tier.test.ts`.
 *
 * The claim layer's tier interval used to be `max(0, tier) + min(turnsHeld,
 * |reachable potions|)`, which contradicts the potion rules three ways at once
 * (the collector takes the DEBUFF and its team-mates the buff; the effect is
 * applied at commit, so it governs nothing until the turn after it is taken;
 * one effect per family, so three potions are worth exactly one). The upstream
 * fix derives the interval from the rules instead and moves the ceiling to
 * `field.ts`, where the team-mates are.
 *
 * WHY IT IS PINNED HERE TOO, given the vendor-drift gate already proves the
 * copy is byte-identical: the CONSUMER of this arithmetic is in this repo.
 * `substrate.ts` builds the cloud premise, and the tier-window work that feeds
 * it a real potion board reads these numbers directly. A ceiling of 3 on a
 * board with three potions is a strength no unit in this game can hold, and
 * every mover's contest mask reads it as unbeatable — which is the precondition
 * for the bound-bank inversion storm the i4 arm measured when it first fed the
 * potion board through. This file is what makes that precondition's absence a
 * test in the repo that has to live with it.
 */

import {
  BUFF_LEVEL,
  bbSet,
  CloudSource,
  CloudTimeline,
  DEBUFF_LEVEL,
  makeGrid,
  makeTerrain,
  newBoard,
  UnitKind,
} from '../partial-engine/index';
import { emptyField } from '../partial-engine/field';
import type { CloudPremise, FrozenRecord } from '../partial-engine/index';

const W = 9;
const GRID = makeGrid(W, W);
const TERRAIN = makeTerrain(GRID, [], []);
const at = (x: number, y: number): number => y * W + x;

function boardOf(cells: readonly number[]): Uint32Array {
  const b = newBoard(GRID);
  for (const c of cells) bbSet(b, c);
  return b;
}

function premise(potions: readonly number[]): CloudPremise {
  return {
    terrain: TERRAIN,
    food: newBoard(GRID),
    potions: boardOf(potions),
    promotionWeight: 10,
    hazardDamage: 15,
    maxHealth: 100,
  };
}

const record = (over: Partial<FrozenRecord> & Pick<FrozenRecord, 'unitId'>): FrozenRecord => ({
  kind: UnitKind.King,
  team: 0,
  occupancy: [at(4, 4)],
  heldAtTurn: 0,
  narrowedTo: null,
  health: 70,
  tier: 0,
  weight: 1,
  orientation: 1,
  ...over,
});

describe('a held claim cannot buff itself', () => {
  const king = record({ unitId: 1 });

  test('reachable potions no longer inflate the claim’s own ceiling', () => {
    const t = new CloudTimeline(king, premise([at(4, 3), at(5, 4), at(3, 4)]));
    // Three reachable potions used to read as tier 3. The game's own level is
    // a trit, and a collector's is the NEGATIVE end of it.
    expect(t.at(3).bounds.tierMax).toBe(0);
    expect(t.at(3).bounds.tierMin).toBe(DEBUFF_LEVEL);
  });

  test('and cannot debuff itself in the turn the risk layer asks about', () => {
    // The risk layer reads claims at turnsHeld 1: a potion taken on the move
    // being resolved is applied at that turn's commit and governs nothing in
    // the contest being asked about.
    const one = new CloudTimeline(king, premise([at(4, 3)])).at(1).bounds;
    expect([one.tierMin, one.tierMax]).toEqual([0, 0]);
  });

  test('a potion-free board is the game with no potion code at all', () => {
    const dry = new CloudTimeline(king, premise([])).at(3).bounds;
    expect([dry.tierMin, dry.tierMax]).toEqual([0, 0]);
  });
});

describe('the ceiling a TEAM-MATE’s potion raises', () => {
  // Only `collector` can reach the potion, so only `mate` can be buffed by it.
  const collector = record({ unitId: 1, team: 0, occupancy: [at(1, 1)] });
  const mate = record({ unitId: 2, team: 0, occupancy: [at(7, 7)] });
  const enemy = record({ unitId: 3, team: 1, occupancy: [at(7, 1)] });
  const POTION = [at(1, 2)];

  function fieldAt(turn: number, potions: readonly number[]) {
    const source = new CloudSource(premise(potions));
    return emptyField(GRID, 0).withHeldMany(source, [collector, mate, enemy], turn);
  }

  test('the team-mate’s ceiling rises; the collector’s and the enemy’s do not', () => {
    const f = fieldAt(2, POTION);
    expect(f.slots[1]?.bounds.tierMax).toBe(BUFF_LEVEL);
    // The collector takes the debuff, so reaching the potion cannot lift it —
    // and no other team-mate of its can reach one.
    expect(f.slots[0]?.bounds.tierMax).toBe(0);
    expect(f.slots[0]?.bounds.tierMin).toBe(DEBUFF_LEVEL);
    // Another team's potion is not this unit's business.
    expect(f.slots[2]?.bounds.tierMax).toBe(0);
  });

  test('at one turn held nothing has landed yet, so no ceiling moves', () => {
    // The commit-time lag, read through the field. turnsHeld 1 is what the
    // risk layer sees on every claim, and there the potion board must move no
    // tier at all — the collector has arrived, the rebuild has not committed.
    const f = fieldAt(1, POTION);
    for (const s of f.slots) {
      expect([s.slot, s.bounds.tierMin, s.bounds.tierMax]).toEqual([s.slot, 0, 0]);
    }
  });

  test('with no potion anywhere the field widens nothing', () => {
    const f = fieldAt(3, []);
    for (const s of f.slots) {
      expect([s.slot, s.bounds.tierMin, s.bounds.tierMax]).toEqual([s.slot, 0, 0]);
    }
  });
});
