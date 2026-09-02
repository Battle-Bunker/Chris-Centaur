/**
 * THE BOARD GENERATOR the differential suites share.
 *
 * `buildCase` is lifted VERBATIM out of partial-engine-differential.test.ts,
 * draw for draw, so seeds 1..2000 still produce exactly the boards the
 * standing differential has been agreeing on — the counters that test asserts
 * (914 boards with a death, 23 with a sever, 20 mutual annihilations, 1362
 * weight-stacked pieces, 1192 typed events) are the reproducibility check.
 * A generator that lives in the one test file it started in is a generator the
 * next suite copies; a copy is a second encoding of the FIXTURE, which is the
 * same failure mode one level down.
 *
 * `buildPotionCase` layers settlement's inputs on top of a base board — potion
 * cells, pre-existing invulnerability effects, a turn number and a window —
 * from a SEPARATELY SEEDED stream, so adding it cannot perturb a single draw
 * of the base set. It maintains the invariant a real game maintains and
 * settlement itself does not check: A UNIT'S TIER IS THE SUM OF ITS ACTIVE
 * EFFECTS' LEVELS. That is what makes settlement's `tiers` output checkable
 * against its `effects` output at all (see partial-engine-oracle.ts's
 * `settlementDiff`), because the two are otherwise a single encoding with
 * nothing to differ from.
 */

import type { ActiveEffect } from '@shared/types/Game';
import { wireIdOf } from './partial-engine-oracle';
import type { OracleCase } from './partial-engine-oracle';

export const W = 9;
export const HAZARD_DAMAGE = 100;
export const MAX_HEALTH = 100;
const KINDS = [0, 1, 2, 3, 4, 5, 6];
const ORTHO = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A crowded 9x9: short trails, mixed pieces, a fifth of them a tier up, and
 * staged destinations that are only sometimes legal — because falling back to
 * the kind's own default identically is part of the agreement too.
 */
export function buildCase(seed: number): OracleCase {
  const rnd = mulberry32(seed);
  const interior: number[] = [];
  for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) interior.push(y * W + x);
  const used = new Set<number>();
  const take = (): number => {
    for (let i = 0; i < 300; i++) {
      const c = interior[(rnd() * interior.length) | 0] as number;
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
    return -1;
  };

  const units: OracleCase['units'] = [];
  const n = 2 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    // Half trail units on purpose: a SEVER needs a strictly-higher-tier unit
    // to arrive on somebody's body, and a uniform kind draw almost never
    // produces one — 800 boards of it produced none at all.
    const kind = rnd() < 0.5 ? 0 : (KINDS[(rnd() * KINDS.length) | 0] as number);
    const head = take();
    if (head < 0) continue;
    const cells = [head];
    if (kind === 0) {
      const len = 2 + ((rnd() * 3) | 0);
      for (let j = 1; j < len; j++) {
        const prev = cells[j - 1] as number;
        const px = prev % W;
        const py = (prev / W) | 0;
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const d = ORTHO[(rnd() * 4) | 0] as readonly [number, number];
          const nx = px + d[0];
          const ny = py + d[1];
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= W - 1) continue;
          const c = ny * W + nx;
          if (used.has(c) || cells.includes(c)) continue;
          used.add(c);
          cells.push(c);
          placed = true;
        }
        if (!placed) break;
      }
    }
    const weight = kind === 0 ? cells.length : 1 + ((rnd() * 3) | 0);
    let orientation = (rnd() * 4) | 0;
    if (kind === 0 && cells.length >= 2) {
      // For a trail unit orientation IS head-minus-neck, physically.
      const hx = (cells[0] as number) % W;
      const hy = ((cells[0] as number) / W) | 0;
      const nx = (cells[1] as number) % W;
      const ny = ((cells[1] as number) / W) | 0;
      const dx = Math.sign(hx - nx);
      const dy = Math.sign(hy - ny);
      const found = ORTHO.findIndex((o) => o[0] === dx && o[1] === dy);
      orientation = found < 0 ? 0 : found;
    }
    units.push({
      unitId: i,
      kind,
      team: i % 2,
      cells,
      weight,
      health: 20 + ((rnd() * 80) | 0),
      tier: rnd() < 0.3 ? 1 : 0,
      orientation,
    });
  }

  const food: number[] = [];
  for (let i = 0; i < 2; i++) {
    if (rnd() < 0.6) {
      const c = take();
      if (c >= 0) food.push(c);
    }
  }
  const hazards: number[] = [];
  for (let i = 0; i < 2; i++) {
    if (rnd() < 0.3) {
      const c = take();
      if (c >= 0) hazards.push(c);
    }
  }

  const orders = new Map<number, number>();
  const pick = mulberry32(seed * 7919 + 3);
  for (const u of units) {
    if (pick() < 0.2) continue; // nothing staged: the kind's own default
    const cx = ((u.cells[0] as number) % W) + ((pick() * 5) | 0) - 2;
    const cy = (((u.cells[0] as number) / W) | 0) + ((pick() * 5) | 0) - 2;
    if (cx < 0 || cy < 0 || cx >= W || cy >= W) continue;
    orders.set(u.unitId, cy * W + cx);
  }
  return {
    width: W,
    height: W,
    units,
    food,
    hazards,
    hazardDamage: HAZARD_DAMAGE,
    maxHealth: MAX_HEALTH,
    orders,
    turn: 0,
    effects: [],
    potions: [],
    potionsEnabled: false,
    potionWindowTurns: 3,
  };
}

/** Interior cells nothing on the board already claims. */
export function freeCellsOf(tc: OracleCase): number[] {
  const taken = new Set<number>([...tc.food, ...tc.hazards, ...(tc.potions ?? [])]);
  for (const u of tc.units) for (const c of u.cells) taken.add(c);
  const out: number[] = [];
  for (let y = 1; y < tc.height - 1; y++) {
    for (let x = 1; x < tc.width - 1; x++) {
      const c = y * tc.width + x;
      if (!taken.has(c)) out.push(c);
    }
  }
  return out;
}

/**
 * The same board, with settlement's inputs on it: a turn number, potion cells
 * (some of them exactly where a unit is staged to arrive, so collections
 * actually happen), a pickup window, and pre-existing buffs and debuffs whose
 * levels ADD UP to the tier each unit is adjudicated at.
 *
 * Expiry turns are drawn at or after `turn` — an effect due at turn E still
 * decides every collision resolved during turn E, and one due earlier would
 * have been swept at the end of the turn that expired it, so a board carrying
 * one is a board the game cannot produce.
 */
export function buildPotionCase(seed: number): OracleCase {
  const tc = buildCase(seed);
  const rnd = mulberry32(seed * 2654435761 + 17);
  const turn = 10 + ((rnd() * 5) | 0);
  tc.turn = turn;
  tc.potionsEnabled = rnd() < 0.9;
  tc.potionWindowTurns = [1, 3, 3, 8][(rnd() * 4) | 0] as number;

  // Potions: on staged destinations first (a pickup needs an ARRIVAL, and a
  // uniformly random cell is almost never one), then a couple at random.
  const potions: number[] = [];
  const free = new Set(freeCellsOf(tc));
  const staged = [...tc.orders.values()].filter((c) => free.has(c));
  for (const cell of staged) {
    if (rnd() < 0.55 && !potions.includes(cell)) potions.push(cell);
  }
  for (let i = 0; i < 2; i++) {
    if (rnd() < 0.4) {
      const pool = [...free].filter((c) => !potions.includes(c));
      const c = pool[(rnd() * pool.length) | 0];
      if (c !== undefined) potions.push(c);
    }
  }
  tc.potions = potions;

  // Effects, and the tier they add up to. A debuff is what a collector wears;
  // a buff is what its allies wear — and only a unit at a NEGATIVE tier can be
  // "vulnerable" enough to trigger the ally-buff cancel, so the mix has to
  // reach below zero or that rule is never exercised.
  const effects: ActiveEffect[] = [];
  for (const u of tc.units) {
    let level = 0;
    const count = rnd() < 0.45 ? (rnd() < 0.25 ? 2 : 1) : 0;
    for (let i = 0; i < count; i++) {
      const debuff = rnd() < 0.5;
      const lvl = debuff ? -1 : 1;
      const source = tc.units[(rnd() * tc.units.length) | 0] as OracleCase['units'][number];
      effects.push({
        playerID: wireIdOf(u.unitId),
        type: debuff ? 'invulnerability_debuff' : 'invulnerability_buff',
        level: lvl,
        expiryTurn: turn + ((rnd() * 3) | 0),
        sourcePlayerID: wireIdOf(source.unitId),
      });
      level += lvl;
    }
    u.tier = level;
  }
  tc.effects = effects;
  return tc;
}
