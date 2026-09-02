/**
 * The divergence ledger, translated from the engine's vocabulary to the
 * contract's.
 *
 * `settlePartial` reports one `Divergence` per point at which a concrete world
 * could disagree with the optimistic timeline, naming the unit whose outcome
 * could change (`unitId`) and the unit whose unknown disposition creates the
 * difference (`heldId`). The contract wants one `LedgerEntry` per implicated
 * UNKNOWN, tagged with the polarity that says WHICH endpoint is riding on it:
 *
 *   assumedPresent === false → the timeline read the cell as EMPTY. The held
 *     unit merely has to have moved there for this to bite, and it is what
 *     depressed `worst`. Polarity `if_present`.
 *
 *   assumedPresent === true → the timeline PLACED the held unit there on the
 *     neck argument, so it is `best` that is riding on the unit being where it
 *     was assumed. Polarity `if_absent`.
 *
 * Getting these two backwards is invisible in every aggregate (the counts are
 * identical) and wrong in exactly the place a human reads the ledger to decide
 * what to refine, so it is pinned by test.
 *
 * The slot-mask decode this file used to carry is gone with the arena: a
 * divergence names the unit by id, so the translation is a lookup.
 */

import type { CellIndex, LedgerEntry, SubStep, UnitId } from "../contracts";
import type { Divergence, PartialSettlement } from "../../engine-vendor/engine/settlePartial";
import type { EngineSubstrate } from "../substrate";
import { normalizeLedger } from "./score";

/** One divergence as the contract reads it. */
function entryOf(sub: EngineSubstrate, d: Divergence): LedgerEntry | null {
  const held = sub.unitOfWireId(d.heldId);
  if (held === undefined) return null;
  return {
    unitId: held.unitId,
    cell: d.cell as CellIndex,
    subStep: d.subStep as SubStep,
    polarity: d.assumedPresent ? "if_absent" : "if_present",
    note: `${d.kind} with live ${d.unitId}${d.couldBeat ? " (could beat it)" : ""}${
      d.narrowed ? " [narrowed]" : ""
    }`,
  };
}

/**
 * The contract-shaped ledger of one settlement. Deduplicated and canonically
 * ordered, because it becomes part of a bound's identity.
 */
export function ledgerOf(
  sub: EngineSubstrate,
  settlement: PartialSettlement
): ReadonlyArray<LedgerEntry> {
  if (settlement.ledger.length === 0) return [];
  const out: LedgerEntry[] = [];
  for (const d of settlement.ledger) {
    const entry = entryOf(sub, d);
    if (entry !== null) out.push(entry);
  }
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
 * reported a gap no divergence explains.
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
