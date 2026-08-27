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

/**
 * INTERNED NOTES.
 *
 * The note is a pure function of `(channel, liveId, couldBeat)` — three small
 * integers — and it is the same handful of sentences over and over: a decision
 * builds ~20 of them per resolution at thousands of resolutions a second, and
 * the measured cost of `ledgerOf` was 11 µs a branch of which the note strings
 * were 10. The obvious fix, a lazy `get note()`, was tried and MEASURED WORSE
 * (11 µs → 25): a getter puts the entry object into dictionary mode, and every
 * later read of every field pays for it. Interning instead keeps the entry a
 * plain shape and makes the string free after the first sighting.
 *
 * The map is unbounded in principle and tiny in practice: `channel` is a fixed
 * enum, `liveId` is a unit id, and there is one process-wide table rather than
 * one per decision, so a long-running server converges on a fixed working set.
 */
const NOTES = new Map<number, string>();

function makeNote(channel: number, liveId: number, couldBeat: boolean): string {
  const name = CHANNEL_NAMES[channel] ?? String(channel);
  return `${name} with live ${liveId}${couldBeat ? " (could beat it)" : ""}`;
}

function noteFor(channel: number, liveId: number, couldBeat: boolean): string {
  // The packed key is exact only inside these ranges. Anything outside them is
  // built uncached rather than risking two different notes on one key: an
  // interning table that can collide is a wrong ledger entry, which is worse
  // than a slow one.
  if (channel < 0 || channel > 0x3f || liveId < 0 || liveId > 0xffff || (liveId | 0) !== liveId) {
    return makeNote(channel, liveId, couldBeat);
  }
  const key = ((channel << 17) | (liveId << 1) | (couldBeat ? 1 : 0)) >>> 0;
  const hit = NOTES.get(key);
  if (hit !== undefined) return hit;
  const made = makeNote(channel, liveId, couldBeat);
  NOTES.set(key, made);
  return made;
}

function entriesOfOne(
  e: Entanglement,
  bySlot: ReadonlyMap<number, UnitId>,
  out: LedgerEntry[],
): void {
  const polarity: LedgerEntry["polarity"] = e.assumedPresent ? "if_absent" : "if_present";
  let mask = e.frozen >>> 0;
  if (mask === 0) return;
  const note = noteFor(e.channel, e.liveId, e.couldBeat);
  const cell = e.cell as CellIndex;
  const subStep = e.subStep as SubStep;
  while (mask !== 0) {
    const bit = 31 - Math.clz32(mask);
    mask &= ~(1 << bit);
    const unitId = bySlot.get(bit);
    if (unitId === undefined) continue;
    out.push({ unitId, cell, subStep, polarity, note });
  }
}

/**
 * The contract-shaped ledger of one resolution. Deduplicated and canonically
 * ordered, because it becomes part of a bound's identity.
 *
 * The slot→unit map is cached per CLOUD FIELD, which is what it is actually a
 * function of: `CloudField` is immutable and shared by pointer across every
 * sibling state of a search, so one map serves the thousands of resolutions a
 * decision runs against one hold configuration. Keying on the STATE would have
 * been wrong twice over — the handle's slab is returned to a pool on release,
 * and two states sharing a field would each rebuild the same answer.
 */
const BY_SLOT = new WeakMap<object, ReadonlyMap<number, UnitId>>();

/**
 * NOT CACHED PER RESOLUTION — a measured null result, kept as a note.
 *
 * The resolution memo serves the same `Resolution` object to every branch that
 * re-visits a plan, so caching the translation on it looked free. Measured on
 * 450 full B0–B3 prices it was worth nothing at all (14 814 ms without it,
 * 14 776 ms with — inside the noise) and cost 2.1 MB of weak-table growth per
 * 450 prices, because the memo keeps its resolutions ALIVE and the `WeakMap`
 * therefore grows to the memo's whole capacity instead of shedding entries.
 * The branch path re-prices distinct plans; it does not re-ask for the same
 * resolution's ledger.
 */
export function ledgerOf(resolution: Resolution): ReadonlyArray<LedgerEntry> {
  if (resolution.ledger.length === 0) return [];
  const field = resolution.state.field as unknown as object;
  let bySlot = BY_SLOT.get(field);
  if (bySlot === undefined) {
    bySlot = frozenUnitBySlot(resolution.state);
    BY_SLOT.set(field, bySlot);
  }
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
