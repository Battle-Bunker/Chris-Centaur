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

/**
 * One divergence as the contract reads it.
 *
 * `d.heldId` IS a held unit — the engine's contract says "always one of
 * `input.held`, so a caller can partition the worlds by its options" — so this
 * lookup resolves for every entry and `residueOf` below is a real work list of
 * enemies rather than a list that silently lost the entries whose root was a
 * modelled unit. The chain the uncertainty travelled along is what makes the
 * two readable apart: `d.unitId` is the unit whose outcome could change, and
 * `d.via` names the modelled units between the held root and it. Empty means
 * the held unit acts on `d.unitId` directly; a non-empty route is an indirect
 * consequence and reads differently to a human deciding what to refine.
 */
function entryOf(sub: EngineSubstrate, d: Divergence): LedgerEntry | null {
  const held = sub.unitOfWireId(d.heldId);
  if (held === undefined) return null;
  const route = d.via.length === 0 ? "" : ` via ${d.via.join(">")}`;
  return {
    unitId: held.unitId,
    cell: d.cell as CellIndex,
    subStep: d.subStep as SubStep,
    polarity: d.assumedPresent ? "if_absent" : "if_present",
    note: `${d.kind} with live ${d.unitId}${route}${d.couldBeat ? " (could beat it)" : ""}${
      d.narrowed ? " [narrowed]" : ""
    }`,
  };
}

/**
 * The contract-shaped ledger of one settlement. Deduplicated and canonically
 * ordered, because it becomes part of a bound's identity.
 */
const EMPTY_LEDGER: ReadonlyArray<LedgerEntry> = [];

/**
 * ONE TRANSLATION PER SETTLEMENT.
 *
 * The translation reads the settlement's divergences and the family's wire-id
 * index and nothing else — not the plan, not the team, not which units a view
 * holds live (a modelled sibling shares `byWireId` with its parent). So it is
 * a pure function of the settlement object, and the bank asks for it once per
 * hold configuration it prices the same plan under. Cached in a `WeakMap` from
 * the settlement, which is also what makes the `normalizeLedger` behind it a
 * lookup rather than a dedup-and-sort on every branch.
 */
const translated = new WeakMap<PartialSettlement, ReadonlyArray<LedgerEntry>>();

export function ledgerOf(
  sub: EngineSubstrate,
  settlement: PartialSettlement
): ReadonlyArray<LedgerEntry> {
  if (settlement.ledger.length === 0) return EMPTY_LEDGER;
  const hit = translated.get(settlement);
  if (hit !== undefined) return hit;
  const out: LedgerEntry[] = [];
  for (const d of settlement.ledger) {
    const entry = entryOf(sub, d);
    if (entry !== null) out.push(entry);
  }
  const made = normalizeLedger(out);
  translated.set(settlement, made);
  return made;
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
