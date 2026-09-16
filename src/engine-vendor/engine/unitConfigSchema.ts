/*
 * VENDORED from Battle-Bunker/TacticToes — do not edit.
 * Source: functions/src/gameprocessors/engine/unitConfigSchema.ts
 * This is a byte-for-byte copy of the single encoding of the game rules.
 * Edits here are overwritten and fail the vendor-sync spec: change the
 * rules in TacticToes, then run `npm run sync-engine`.
 * END VENDORED HEADER
 */

/**
 * THE schema of the per-unit-type configuration group.
 *
 * Three numbers are configured per unit kind — what a meal is worth to it, how
 * much energy it can hold, and the weight it spawns at — and this file is the
 * ONE statement of what they are called, what they mean, what they default to
 * and what range they may take. Nothing restates any of it:
 *
 *   - the engine (`unitConfig.ts`, next door) takes its defaults from here and
 *     indexes the group by kind;
 *   - the lobby generates its controls from here — one per field per kind, with
 *     these labels, bounds and help text — and validates a patch against these
 *     bounds before it writes;
 *   - `firestore.rules` does not hand-restate the bounds either: the
 *     `isValidUnitTypeConfig`/`isValidUnitConfig` block is GENERATED from this
 *     file by `scripts/gen-firestore-rules.mjs`, and a test fails if the
 *     committed rules block differs from what this file generates.
 *
 * There are no cross-field constraints here because the game has none: a meal
 * may be worth more energy than a kind can hold, and that simply means "a meal
 * fills the tank" (the engine clamps the addition at the maximum). Anything
 * that couples two of these fields is a bug, not a rule.
 *
 * It lives in engine/ because that is where the numbers the game is played with
 * live and what gets vendored (see VENDOR.md); the lobby reads it through
 * `frontend/src/utils/unitConfig.ts`, the same door it reads the engine's
 * defaults through.
 *
 * Runtime-dependency-free on purpose: data and `import type` only, so a plain
 * Node script (the rules generator, the rules test) can load this very file
 * rather than a copy of its numbers.
 */

import type { UnitConfig, UnitType } from "@shared/types/Game"

/** Every unit kind there is, in lobby order. */
export const UNIT_TYPES: UnitType[] = [
  "snake",
  "pawn",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
]

/** A default that may differ per kind. */
export type PerUnitTypeDefault = { [K in UnitType]: number }

export interface UnitConfigFieldSchema {
  /** The field's key in a `UnitTypeConfig` group, on the wire and everywhere. */
  key: "foodEnergy" | "maxEnergy" | "startingWeight"
  /** The lobby's control label. */
  label: string
  /** Inclusive integer bounds. The rules enforce exactly these. */
  min: number
  max: number
  /** The shipped value for each kind when the group does not state the field. */
  defaults: PerUnitTypeDefault
  /** One line under the lobby's control, given that kind's default. */
  help: (defaultValue: number) => string
  /** What the engine does with it. Documentation, not behaviour. */
  semantics: string
}

const uniform = (value: number): PerUnitTypeDefault => ({
  snake: value,
  pawn: value,
  knight: value,
  bishop: value,
  rook: value,
  queen: value,
  king: value,
})

/**
 * The three fields, in the order the lobby shows them. The field list IS the
 * group: adding a fourth number to a unit's configuration means adding an entry
 * here, regenerating the rules block and shipping — no other file learns a new
 * key by hand.
 */
export const UNIT_CONFIG_FIELDS: UnitConfigFieldSchema[] = [
  {
    key: "foodEnergy",
    label: "Food energy",
    // A meal is measured against a tank and a tank tops out at 1000, so a meal
    // shares the tank's band. It may exceed a particular kind's max: that means
    // "one meal fills it".
    min: 1,
    max: 1000,
    defaults: uniform(100),
    help: (d) => `Default ${d}; a meal adds this much energy`,
    semantics:
      "Energy one food replenishes for this kind. The engine adds it to the eater and clamps at maxEnergy; reaching the max is what grows the unit by one weight.",
  },
  {
    key: "maxEnergy",
    label: "Max energy",
    min: 1,
    max: 1000,
    defaults: uniform(100),
    help: (d) => `Default ${d}; a full tank grows`,
    semantics:
      "Energy this kind can hold. Energy is clamped to it, and filling it grows the unit by one weight.",
  },
  {
    key: "startingWeight",
    label: "Starting weight",
    // An opening occupancy, not an energy: bounded far below the energy scale.
    min: 1,
    max: 20,
    defaults: {
      // The shipped board, written down as the table it always was: a snake
      // spawns as a stacked triple, every chess piece as the square it stands on.
      snake: 3,
      pawn: 1,
      knight: 1,
      bishop: 1,
      rook: 1,
      queen: 1,
      king: 1,
    },
    help: (d) => `Default ${d}`,
    semantics:
      "Weight (occupancy length) a unit of this kind is created with at game start, by board placement.",
  },
]

/** The schema of one field, by key. */
export const unitConfigField = (
  key: UnitConfigFieldSchema["key"],
): UnitConfigFieldSchema => {
  const field = UNIT_CONFIG_FIELDS.find((f) => f.key === key)
  if (!field) throw new Error(`Unknown unit configuration field: ${key}`)
  return field
}

/**
 * Whether a proposed value is one this field accepts: an integer within the
 * field's inclusive bounds. The lobby asks this before writing and the
 * generated rules enforce the identical predicate, so a value the lobby sends
 * is a value the rules take.
 */
export const isValidUnitConfigValue = (
  field: UnitConfigFieldSchema,
  value: number,
): boolean =>
  Number.isInteger(value) && value >= field.min && value <= field.max

/** Why a value was refused, in the words the lobby shows next to the control. */
export const unitConfigValueError = (
  field: UnitConfigFieldSchema,
  value: number,
): string | undefined =>
  isValidUnitConfigValue(field, value)
    ? undefined
    : `${field.label} must be a whole number from ${field.min} to ${field.max}`

/**
 * THE patch a lobby edit sends: the whole `unitConfig` map as it should be
 * after setting ONE field of ONE kind.
 *
 * `current` is what the document states (defaults are NOT materialised into
 * it), and the patch keeps it that way: only the edited field is set, so a
 * field the document never stated stays absent and keeps taking its default.
 * Editing one number therefore cannot silently pin six others — which is what
 * "typing in Max energy also filled in Food energy" was.
 *
 * Both the lobby and the rules test build their writes with this function, so
 * the test exercises the bytes the lobby actually sends.
 */
export const unitConfigPatch = (
  current: UnitConfig,
  type: UnitType,
  key: UnitConfigFieldSchema["key"],
  value: number,
): UnitConfig => ({
  ...current,
  [type]: { ...current[type], [key]: value },
})
