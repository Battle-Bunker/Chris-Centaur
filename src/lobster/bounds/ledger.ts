/**
 * The entanglement ledger, translated from the engine's vocabulary to the
 * contract's.
 *
 * The engine reports one `Entanglement` per (turn, sub-step, cell, live unit,
 * channel) with a mask of the frozen units implicated. The contract wants one
 * `LedgerEntry` per implicated HELD UNIT, tagged with the polarity that says
 * WHICH endpoint the unknown moved:
 *
 *   assumedPresent === false → the optimistic timeline read the cell as EMPTY.
 *     The held unit merely has to have moved there for this to bite, and it is
 *     what depressed `worst`. Polarity `if_present`.
 *
 *   assumedPresent === true → the optimistic timeline PLACED the held unit
 *     there on the neck argument, so it is `best` that is riding on the unit
 *     being where it was assumed. Polarity `if_absent`.
 *
 * Getting these two backwards is invisible in every aggregate (the counts are
 * identical) and wrong in exactly the place a human reads the ledger to decide
 * what to refine, so it is pinned by test.
 */

import type { CellIndex, LedgerEntry, SubStep, UnitId } from "../contracts";
import type { Entanglement, Resolution, StateHandle } from "../../partial-engine/index";
import { CHANNEL_NAMES } from "../../partial-engine/index";
import { normalizeLedger } from "./score";

/** Held unit ids, by the field-slot bit the engine's masks are indexed on. */
export function frozenUnitBySlot(state: StateHandle): ReadonlyMap<number, UnitId> {
  const out = new Map<number, UnitId>();
  for (const slot of state.field.slots) out.set(slot.slot, slot.record.unitId);
  return out;
}

/** Every unit currently held in this state — the residue B0 prices by claim. */
export function heldUnitsOf(state: StateHandle): ReadonlyArray<UnitId> {
  return state.field.slots.map((s) => s.record.unitId);
}

/** Held units on a given team. */
export function heldUnitsOfTeam(state: StateHandle, team: number): ReadonlyArray<UnitId> {
  return state.field.slots.filter((s) => s.record.team === team).map((s) => s.record.unitId);
}

/** The team a held unit belongs to, or null when it is not held here. */
export function teamOfHeld(state: StateHandle, unitId: UnitId): number | null {
  return state.field.slots.find((s) => s.record.unitId === unitId)?.record.team ?? null;
}

function entriesOfOne(
  e: Entanglement,
  bySlot: ReadonlyMap<number, UnitId>,
  out: LedgerEntry[],
): void {
  const polarity: LedgerEntry["polarity"] = e.assumedPresent ? "if_absent" : "if_present";
  const channel = CHANNEL_NAMES[e.channel] ?? String(e.channel);
  let mask = e.frozen >>> 0;
  while (mask !== 0) {
    const bit = 31 - Math.clz32(mask);
    mask &= ~(1 << bit);
    const unitId = bySlot.get(bit);
    if (unitId === undefined) continue;
    out.push({
      unitId,
      cell: e.cell as CellIndex,
      subStep: e.subStep as SubStep,
      polarity,
      note: `${channel} with live ${e.liveId}${e.couldBeat ? " (could beat it)" : ""}`,
    });
  }
}

/**
 * The contract-shaped ledger of one resolution. Deduplicated and canonically
 * ordered, because it becomes part of a bound's identity.
 */
export function ledgerOf(resolution: Resolution): ReadonlyArray<LedgerEntry> {
  if (resolution.ledger.length === 0) return [];
  const bySlot = frozenUnitBySlot(resolution.state);
  const out: LedgerEntry[] = [];
  for (const e of resolution.ledger) entriesOfOne(e, bySlot, out);
  return normalizeLedger(out);
}

/**
 * The held units a ledger actually names — the refinement work list, in the
 * order the ledger weighted them. This is what entanglement gating turns into
 * a decision about WHO to enumerate.
 */
export function residueOf(ledger: ReadonlyArray<LedgerEntry>): ReadonlyArray<UnitId> {
  const weight = new Map<UnitId, number>();
  for (const e of ledger) weight.set(e.unitId, (weight.get(e.unitId) ?? 0) + 1);
  return [...weight.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map((e) => e[0]);
}

/**
 * The one ledger entry that is NOT about a held unit: the evaluator itself
 * reported a gap no entanglement explains.
 *
 * This exists so the discharge theorem stays an "iff". An empty ledger with a
 * non-empty gap would mean "nothing left to learn, and yet we do not know",
 * which is the shape of a laundered narrowing. Naming the residue keeps the
 * bound honest and gives the orchestrator something to attribute.
 */
export const EVALUATOR_RESIDUE_UNIT = -1 as UnitId;

export function evaluatorResidueEntry(note: string): LedgerEntry {
  return {
    unitId: EVALUATOR_RESIDUE_UNIT,
    cell: -1 as CellIndex,
    subStep: -1 as SubStep,
    polarity: "if_present",
    note,
  };
}
