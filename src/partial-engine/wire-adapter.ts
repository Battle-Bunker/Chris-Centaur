/**
 * The one translation between the wire's vocabulary and the possibility-cloud
 * engine's — and, in the other direction, back out to the vendored resolver's.
 *
 * THIS FILE IS OURS. Everything else in src/partial-engine/ is a byte-for-byte
 * copy (see VENDOR-MANIFEST.json and scripts/sync-partial-engine.js); this is
 * the adapter written here, because the two encodings it bridges belong to two
 * different repos and neither one is the place to put the bridge.
 *
 * ── The weight-stack encoding, which is the whole reason this file exists ──
 *
 * The wire stores a piece's WEIGHT AS THAT MANY COPIES OF ITS CELL. A weight-3
 * rook standing on cell 40 arrives as `occupancy: [40, 40, 40]`. That encoding
 * is uniform across the wire because it lets a trail unit and a piece share one
 * field: for a snake, `occupancy` really is a list of distinct cells, head
 * first, and its length really is its weight.
 *
 * `UnitSpec` does not accept that. It wants exactly one cell plus an explicit
 * `weight`, and `PartialEngine.create` throws on a repeated cell rather than
 * quietly treating the stack as a three-cell body — which is the right call,
 * because a three-cell body is a different unit with different collision
 * geometry.
 *
 * So the translation is conditional on ONE property: does the kind leave a
 * trail?
 *
 *   trail kind (snake):  cells = occupancy,        weight = occupancy.length
 *   piece kind (others): cells = [occupancy[0]],   weight = occupancy.length
 *
 * Getting this wrong is silent in the small: a weight-1 piece translates
 * identically under both branches, so a board of weight-1 pieces agrees
 * perfectly and a board with one grown rook diverges. That is exactly the bug
 * shape a differential catches late and a unit test catches now — hence
 * wire-adapter.test.ts.
 *
 * `leavesTrail` is imported from the vendored resolver rather than restated as
 * `kind === 0`, so the question "which kinds leave a trail" keeps exactly one
 * answer in this repo. If TacticToes ever grows a second trail kind, this
 * adapter follows it without an edit.
 */

import { leavesTrail } from '../engine-vendor/engine/moveGrammar';
import type { Orientation } from '../engine-vendor/engine/moveGrammar';
import type { UnitType } from '@shared/types/Game';
import { NO_ORDER } from './index';
import type { UnitSpec } from './index';

/**
 * The kind names the wire uses, indexed by the engine's `UnitKind`.
 * grammar.ts's registry order — the index IS the kind.
 */
export const WIRE_KIND_NAMES: readonly UnitType[] = [
  'snake',
  'knight',
  'king',
  'rook',
  'bishop',
  'queen',
  'pawn',
];

/** grammar.ts's orientation ordering: 0 up, 1 right, 2 down, 3 left. */
export const WIRE_ORIENTATIONS: readonly Orientation[] = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

/** The engine kind index for a wire unit type. Throws on an unknown type. */
export function kindOfWireType(type: UnitType): number {
  const kind = WIRE_KIND_NAMES.indexOf(type);
  if (kind < 0) throw new Error(`wire-adapter: unknown unit type ${JSON.stringify(type)}`);
  return kind;
}

/** The wire unit type for an engine kind index. Throws on an unknown kind. */
export function wireTypeOfKind(kind: number): UnitType {
  const name = WIRE_KIND_NAMES[kind];
  if (name === undefined) throw new Error(`wire-adapter: unknown unit kind ${kind}`);
  return name;
}

/**
 * The engine's orientation index for a wire orientation vector. Non-orthogonal
 * or zero vectors have no index; callers get -1 and decide (spawn default,
 * usually) rather than being handed a plausible wrong answer.
 */
export function orientationIndexOf(orientation: Orientation | undefined): number {
  if (orientation === undefined) return -1;
  return WIRE_ORIENTATIONS.findIndex(
    (o) => o.dx === Math.sign(orientation.dx) && o.dy === Math.sign(orientation.dy)
  );
}

/** One unit as the wire carries it — the fields the translation reads. */
export interface WireUnit {
  /** Stable identity. Kept as a string here; `toUnitSpec` takes the number. */
  readonly id: string;
  readonly type: UnitType;
  readonly teamID: string;
  /** Head first. For a piece this is `weight` copies of one cell. */
  readonly occupancy: readonly number[];
  readonly health: number;
  readonly tier?: number;
  readonly orientation?: Orientation;
}

/**
 * The weight a wire occupancy encodes: its length, for every kind. A trail
 * unit's weight is its body length; a piece's is its stack height.
 */
export function weightOfOccupancy(occupancy: readonly number[]): number {
  return occupancy.length;
}

/**
 * The engine `cells` a wire occupancy encodes — the actual weight-stack
 * collapse. A piece is flattened to its head; a trail unit is passed through.
 *
 * Throws when a piece's stack is not uniform, because that is not a stack: it
 * is either a trail kind mislabelled or a corrupt payload, and guessing which
 * would put a wrong board into the engine.
 */
export function cellsOfOccupancy(type: UnitType, occupancy: readonly number[]): number[] {
  if (occupancy.length === 0) {
    throw new Error(`wire-adapter: empty occupancy for ${type}`);
  }
  if (leavesTrail(type)) return [...occupancy];
  const head = occupancy[0] as number;
  for (const cell of occupancy) {
    if (cell !== head) {
      throw new Error(
        `wire-adapter: ${type} occupancy [${occupancy.join(',')}] is not a weight stack — ` +
          'a piece occupies one cell repeated `weight` times. A non-uniform occupancy ' +
          'means the type is wrong or the payload is corrupt.'
      );
    }
  }
  return [head];
}

/** Options for a translation that the wire payload itself does not carry. */
export interface ToUnitSpecOptions {
  /** Engine-side numeric id. Defaults to parsing digits out of `unit.id`. */
  readonly unitId?: number;
  /** Engine-side numeric team. Defaults to parsing digits out of `teamID`. */
  readonly team?: number;
  /** Facing to use when the wire carries none or a non-orthogonal one. */
  readonly defaultOrientation?: number;
  /** Turn at which the tier effect expires. See UnitSpec.tierExpiresAtTurn. */
  readonly tierExpiresAtTurn?: number | null;
}

/** Digits out of an id like "u00007" or "team-3"; NaN when there are none. */
function numericPartOf(id: string): number {
  const digits = id.match(/\d+/);
  return digits === null ? Number.NaN : Number.parseInt(digits[0], 10);
}

/**
 * One wire unit as a `UnitSpec`. This is the function every downstream
 * consumer should call — not a hand-rolled object literal, because the
 * hand-rolled one is where the weight encoding gets dropped.
 */
export function toUnitSpec(unit: WireUnit, options: ToUnitSpecOptions = {}): UnitSpec {
  const unitId = options.unitId ?? numericPartOf(unit.id);
  if (!Number.isFinite(unitId)) {
    throw new Error(
      `wire-adapter: cannot derive a numeric unitId from ${JSON.stringify(unit.id)} — ` +
        'pass options.unitId.'
    );
  }
  const team = options.team ?? numericPartOf(unit.teamID);
  if (!Number.isFinite(team)) {
    throw new Error(
      `wire-adapter: cannot derive a numeric team from ${JSON.stringify(unit.teamID)} — ` +
        'pass options.team.'
    );
  }
  const facing = orientationIndexOf(unit.orientation);
  return {
    unitId,
    kind: kindOfWireType(unit.type),
    team,
    cells: cellsOfOccupancy(unit.type, unit.occupancy),
    weight: weightOfOccupancy(unit.occupancy),
    health: unit.health,
    tier: unit.tier ?? 0,
    tierExpiresAtTurn: options.tierExpiresAtTurn ?? null,
    orientation: facing < 0 ? (options.defaultOrientation ?? 0) : facing,
  };
}

/** A roster in one call, preserving order — the order IS the engine's slots. */
export function toUnitSpecs(
  units: readonly WireUnit[],
  optionsFor: (unit: WireUnit, index: number) => ToUnitSpecOptions = () => ({})
): UnitSpec[] {
  return units.map((unit, index) => toUnitSpec(unit, optionsFor(unit, index)));
}

/**
 * The inverse: an engine `cells`+`weight` back to a wire occupancy. Needed
 * whenever a simulated board is handed to the vendored resolver — which is
 * exactly what the in-situ differential does, and what any consumer comparing
 * a projected turn against the rules will do too.
 */
export function occupancyOfCells(
  type: UnitType,
  cells: readonly number[],
  weight: number
): number[] {
  if (cells.length === 0) throw new Error(`wire-adapter: no cells for ${type}`);
  if (leavesTrail(type)) return [...cells];
  if (weight < 1) throw new Error(`wire-adapter: ${type} weight ${weight} is below 1`);
  return new Array<number>(weight).fill(cells[0] as number);
}

/**
 * Staged destinations as `PartialEngine.resolve` wants them: one entry per
 * engine SLOT, `NO_ORDER` where nothing is staged. Slots are positional, so
 * this takes the same ordered roster the specs were built from.
 *
 * A missing order is not the same as a staged no-op: `NO_ORDER` means "fall
 * back to the kind's own default action", which is a rule, not a guess.
 */
export function ordersForSlots(
  specs: readonly UnitSpec[],
  maxUnits: number,
  stagedByUnitId: ReadonlyMap<number, number>
): number[] {
  const orders = new Array<number>(maxUnits).fill(NO_ORDER);
  specs.forEach((spec, slot) => {
    if (slot >= maxUnits) {
      throw new Error(
        `wire-adapter: ${specs.length} units exceeds the engine's maxUnits ${maxUnits}`
      );
    }
    orders[slot] = stagedByUnitId.get(spec.unitId) ?? NO_ORDER;
  });
  return orders;
}
