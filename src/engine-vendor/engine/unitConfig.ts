/*
 * VENDORED from Battle-Bunker/TacticToes — do not edit.
 * Source: functions/src/gameprocessors/engine/unitConfig.ts
 * This is a byte-for-byte copy of the single encoding of the game rules.
 * Edits here are overwritten and fail the vendor-sync spec: change the
 * rules in TacticToes, then run `npm run sync-engine`.
 * END VENDORED HEADER
 */

import { UnitConfig, UnitMaxEnergy, UnitType, UnitTypeConfig } from "@shared/types/Game"
import { UNIT_TYPES, unitConfigField } from "./unitConfigSchema"
import type { UnitConfigFieldSchema } from "./unitConfigSchema"

/**
 * The per-unit-type configuration group, and the ONE place a game document of
 * any age is read for it.
 *
 * Three numbers are configured per kind — what a meal is worth to it, how much
 * energy it can hold, and the weight it spawns at — and they are read here and
 * nowhere else: the engine's food phase, its max-energy clamp and the board
 * placement that creates a unit all index this by kind rather than branching
 * on it, and the lobby edits the very same shape.
 *
 * Older documents carry the two settings this group replaced — a per-type
 * `maxEnergyPerUnit` map and a single global `foodEnergy`. They are mapped
 * here, ON READ, into the one shape; nothing writes them any more.
 *
 * The defaults and the bounds are NOT restated here: they come from the one
 * schema, `engine/unitConfigSchema.ts`, which the lobby's controls and the
 * generated Firestore rules block are also built from. What lives here is the
 * indexing by kind and the reader — the engine-facing half. A caller outside
 * the engine (board placement, the lobby) reads the same function; there is no
 * second table of defaults anywhere.
 */

/**
 * Every unit kind there is, in lobby order, and the three fields a kind is
 * configured with — both from the ONE schema (`engine/unitConfigSchema.ts`).
 * The numbers below are read out of it; none of them is restated here.
 */
export { UNIT_TYPES }

const defaultOf = (key: UnitConfigFieldSchema["key"], type: UnitType): number =>
  unitConfigField(key).defaults[type]

/** Energy a kind holds when its group names no maximum. */
export const DEFAULT_MAX_ENERGY = defaultOf("maxEnergy", "snake")

/**
 * Energy one food replenishes when a group names no amount — the same number
 * as the default maximum, so an unconfigured game plays the rule food has
 * always played: one meal, a full tank, one weight.
 */
export const DEFAULT_FOOD_ENERGY = defaultOf("foodEnergy", "snake")

/**
 * The weight a kind spawns at when its group names none: a snake spawns as a
 * stacked triple, every chess piece as the single square it stands on.
 */
export const DEFAULT_STARTING_WEIGHT: { [K in UnitType]: number } =
  unitConfigField("startingWeight").defaults

/** One kind's configuration with every default filled in. */
export interface ResolvedUnitTypeConfig {
  /** Energy one food replenishes for this kind. */
  foodEnergy: number
  /** Energy this kind can hold; a meal is clamped to it, and filling it grows. */
  maxEnergy: number
  /** Weight (occupancy length) this kind is created with at game start. */
  startingWeight: number
}

/**
 * The configuration of ONE kind, defaults applied. Every rule that reads any
 * of the three asks this, indexed by the kind it already has in hand.
 */
export const unitTypeConfig = (
  config: UnitConfig | undefined,
  type: UnitType,
): ResolvedUnitTypeConfig => {
  const group = config?.[type]
  return {
    foodEnergy: group?.foodEnergy ?? DEFAULT_FOOD_ENERGY,
    maxEnergy: group?.maxEnergy ?? DEFAULT_MAX_ENERGY,
    startingWeight: group?.startingWeight ?? DEFAULT_STARTING_WEIGHT[type],
  }
}

/** The same group for every kind — what a setting that used to be global means. */
export const everyUnitType = (group: UnitTypeConfig): UnitConfig => {
  const out: UnitConfig = {}
  UNIT_TYPES.forEach((type) => {
    out[type] = { ...group }
  })
  return out
}

/** The fields of a game document this module reads — new shape and old. */
export interface UnitConfigSource {
  unitConfig?: UnitConfig
  /** @deprecated Read-only legacy: folded into `unitConfig` here, never written. */
  maxEnergyPerUnit?: UnitMaxEnergy
  /** @deprecated Read-only legacy: folded into `unitConfig` here, never written. */
  foodEnergy?: number
}

/**
 * The one reader. A setup written before the group existed carries
 * `maxEnergyPerUnit` and a global `foodEnergy`; a setup written after carries
 * `unitConfig`. Both come out of here as one `UnitConfig`, the group's own
 * fields winning field by field where a document somehow holds both.
 *
 * Only fields the document actually states are returned, so an absent setting
 * is still absent afterwards and takes the default at the point of use.
 */
export const unitConfigOf = (setup: UnitConfigSource | undefined): UnitConfig => {
  const out: UnitConfig = {}
  UNIT_TYPES.forEach((type) => {
    const group = setup?.unitConfig?.[type]
    const foodEnergy = group?.foodEnergy ?? setup?.foodEnergy
    const maxEnergy = group?.maxEnergy ?? setup?.maxEnergyPerUnit?.[type]
    const startingWeight = group?.startingWeight
    const resolved: UnitTypeConfig = {}
    if (foodEnergy !== undefined) resolved.foodEnergy = foodEnergy
    if (maxEnergy !== undefined) resolved.maxEnergy = maxEnergy
    if (startingWeight !== undefined) resolved.startingWeight = startingWeight
    if (Object.keys(resolved).length > 0) out[type] = resolved
  })
  return out
}
