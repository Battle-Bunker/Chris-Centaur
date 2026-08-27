/**
 * NAMED CONFIGS — the shapes the sweep starts from.
 *
 * A sweep agent names one of these and overrides the axes it is sweeping,
 * rather than assembling a whole config from scratch each time. Two of them are
 * load-bearing beyond convenience:
 *
 *   `control11`  reproduces the `snakes11` row of the existing h2h ladder
 *                (bench/prod/boards.ts): 11x11, two teams, three snakes each,
 *                4 food, no hazards, anchored placement, material spawn
 *                weights. It is the config the smoke test checks a known
 *                result against, so it must not drift.
 *   `mix23`      the 23x23 3-team snakes+pieces board the throughput numbers
 *                are quoted on.
 */

import { normalizeConfig, type MatchConfig, type MatchConfigInput } from './config';

export const PRESETS: Readonly<Record<string, MatchConfigInput>> = {
  /** The h2h control: 11x11, 2 teams, snakes only. Matches bench `snakes11`. */
  control11: {
    name: 'control11',
    size: 11,
    teams: ['red', 'blue'],
    roster: ['snake', 'snake', 'snake', 'snake'],
    food: { initial: 4 },
    turnCap: 40,
  },

  /** 11x11, 2 teams, the common mid-game mixed roster. Matches bench `mid11`. */
  mid11: {
    name: 'mid11',
    size: 11,
    teams: ['red', 'blue'],
    roster: ['king', 'queen', 'rook', 'knight', 'snake', 'snake'],
    food: { initial: 4 },
    turnCap: 40,
  },

  /** The throughput board: 23x23, 3 teams, 6 units each, snakes + pieces. */
  mix23: {
    name: 'mix23',
    size: 23,
    teams: ['red', 'blue', 'green'],
    roster: ['king', 'queen', 'rook', 'knight', 'snake', 'snake'],
    food: { initial: 6, spawnRate: 0.5 },
    turnCap: 60,
  },

  /** 3 teams at the widest supported roster — the MAX_FROZEN headroom probe. */
  wide23: {
    name: 'wide23',
    size: 23,
    teams: ['red', 'blue', 'green'],
    roster: ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn', 'snake', 'snake'],
    food: { initial: 8, spawnRate: 0.75 },
    turnCap: 60,
  },

  /** Hazards as an attrition cost rather than a wall. */
  haz17: {
    name: 'haz17',
    size: 17,
    teams: ['red', 'blue'],
    roster: ['king', 'rook', 'knight', 'snake', 'snake'],
    food: { initial: 5, spawnRate: 0.5 },
    hazards: { layout: 'random', count: 24, damageRatio: 0.4 },
    turnCap: 60,
  },

  /** Fertile ground live: food only lands on the blobs after turn 1. */
  fertile17: {
    name: 'fertile17',
    size: 17,
    teams: ['red', 'blue'],
    roster: ['king', 'rook', 'snake', 'snake', 'snake'],
    food: { initial: 5, spawnRate: 1.0, restrictToFertile: true },
    fertile: { enabled: true, density: 25, clustering: 14 },
    turnCap: 60,
  },

  /**
   * Potions live. Exercises the resolver's tier path — NOT the clouds', which
   * hard-wire an empty potion board (`substrate.ts:378`).
   *
   * NO KING, deliberately. A potion arm has to survive long enough for a unit
   * to walk onto a potion, take the debuff, and have it priced in a contest
   * three turns later. With a king in the roster the game is one regicide away
   * from over: the first version of this preset ended on turn 2 with zero
   * pickups, which exercised nothing. Attrition rosters last.
   *
   * Potions are also seeded thickly (5 on the board, 0.8/turn) so a pickup is
   * likely inside a short cap rather than a coin flip.
   */
  potion15: {
    name: 'potion15',
    size: 15,
    teams: ['red', 'blue'],
    roster: ['rook', 'knight', 'snake', 'snake'],
    food: { initial: 4, spawnRate: 0.5 },
    potions: { enabled: true, spawnRate: 0.8, initial: 5, effectTurns: 3 },
    turnCap: 60,
  },
};

export function preset(name: string, overrides: Partial<MatchConfigInput> = {}): MatchConfig {
  const base = PRESETS[name];
  if (base === undefined) {
    throw new Error(`unknown preset "${name}"; known: ${Object.keys(PRESETS).join(', ')}`);
  }
  return normalizeConfig({
    ...base,
    ...overrides,
    food: { ...(base.food ?? {}), ...(overrides.food ?? {}) },
    fertile: { ...(base.fertile ?? {}), ...(overrides.fertile ?? {}) },
    hazards: { ...(base.hazards ?? {}), ...(overrides.hazards ?? {}) },
    potions: { ...(base.potions ?? {}), ...(overrides.potions ?? {}) },
    maxHealth: { ...(base.maxHealth ?? {}), ...(overrides.maxHealth ?? {}) },
  } as MatchConfigInput);
}

export const PRESET_NAMES = Object.keys(PRESETS);
