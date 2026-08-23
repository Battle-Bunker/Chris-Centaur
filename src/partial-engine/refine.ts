/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/refine.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// Refinement typing and shared identity — deliberation delta §5.
//
// Three refinements exist, and their TYPES carry the soundness facts a
// searcher needs:
//
//   narrow / deepen → Tightened            (contraction-only; bounds keep)
//   catchUp         → Tightened | Invalidated{fromTurn}
//
// CATCH-UP IS NOT MONOTONE: learning a held unit's real move replays history
// and a replay discontinuity REWRITES branches — so its result type carries
// the turn from which every bound at or below must be discarded. An
// invalidation is an explicit confidence REGRESSION in any anytime report,
// never silent. Every refinement is ATOMIC: it returns a whole new value or
// throws; a bound is defined or absent, never a placeholder.

import type { CloudSource } from "./cloud.js";
import type { Entanglement } from "./engine.js";
import type { CloudField } from "./field.js";
import { earliestEntangledTurn } from "./narrow.js";
import type { ContingencyEntry } from "./risk.js";

export type RefineResult =
  | { readonly kind: "tightened" }
  | { readonly kind: "invalidated"; readonly fromTurn: number };

/**
 * Narrow a frozen unit's first held move — a Tightened refinement by
 * construction: `CloudField.withNarrowed` refuses any widening, so bounds
 * computed before the narrowing remain true bounds after it (they are merely
 * looser than they need to be). Atomic: the new field exists whole or the
 * call throws.
 */
export function narrowUnit(
  field: CloudField,
  source: CloudSource,
  unitId: number,
  destinations: ReadonlyArray<number>,
): { readonly result: RefineResult; readonly field: CloudField } {
  const next = field.withNarrowed(source, unitId, destinations);
  return { result: { kind: "tightened" }, field: next };
}

/**
 * Classify a catch-up BEFORE paying for it. When the ledger never names the
 * unit, T2 (conditional soundness) says every resolution so far is
 * bit-identical whether it was frozen or live — the catch-up is a free
 * Tightened (unfreeze in place, no replay). Otherwise it is an
 * Invalidated{fromTurn}: the searcher discards bounds at or below `fromTurn`
 * (keyed on earliestEntangledTurn) and the anytime surface reports an
 * explicit regression.
 */
export function classifyCatchUp(
  ledger: Iterable<Entanglement>,
  field: CloudField,
  unitId: number,
): RefineResult {
  const from = earliestEntangledTurn(ledger, field, unitId);
  return from === null ? { kind: "tightened" } : { kind: "invalidated", fromTurn: from };
}

/**
 * conflictingEntries: ledger entries citing the SAME unit at the SAME turn
 * are mutually exclusive — one unit, one role, one place per turn — so a
 * consumer summing their risks double-counts. The cheap de-correlation
 * (delta §5): grouped, so a consumer can take each group's max rather than
 * its sum.
 */
export function conflictingEntries(
  entries: ReadonlyArray<ContingencyEntry & { readonly turn?: number }>,
): ReadonlyArray<ReadonlyArray<ContingencyEntry>> {
  const groups = new Map<string, ContingencyEntry[]>();
  for (const e of entries) {
    const key = `${e.unitId}:${e.turn ?? 0}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, [e]);
    else g.push(e);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// ---------------------------------------------------------------------------
// Refinement cost — denominated in declared-burn units (resolutions)
// ---------------------------------------------------------------------------

export type RefinementOp =
  | { readonly op: "narrow"; readonly unitId: number }
  | { readonly op: "simulate"; readonly unitId: number; readonly options: number }
  | { readonly op: "catchUp"; readonly unitId: number; readonly depth: number };

/**
 * What a refinement costs, DENOMINATED IN RESOLUTION-EQUIVALENTS across every
 * lever, so value-per-cost ratios are comparable between lever types
 * (orchestration demand — a budget spent on narrowing and a budget spent on
 * catch-up must be the same currency):
 *   narrow          → 1 (one field recompute ≈ one resolution);
 *   simulate        → |M| subtrees, one resolution-equivalent per option;
 *   catchUp(u, k)   → the replay depth from earliestEntangledTurn, one per
 *                     replayed turn — ZERO when the ledger never names the
 *                     unit (T2's payoff).
 */
export function refinementCost(
  op: RefinementOp,
  ledger: Iterable<Entanglement>,
  field: CloudField,
  currentTurn: number,
): number {
  switch (op.op) {
    case "narrow":
      return 1;
    case "simulate":
      return Math.max(1, op.options);
    case "catchUp": {
      const from = earliestEntangledTurn(ledger, field, op.unitId);
      if (from === null) return 0;
      return Math.max(0, currentTurn - from);
    }
  }
}

/**
 * A PER-SUBTREE discharge certificate. The per-resolution discharge theorem
 * (empty ledger ∧ empty assumptions ⇒ exact) lifts to a subtree by
 * accumulation: fold every resolution's ledger in as the subtree is walked,
 * merge children on backup, and the certificate answers, PER UNIT, whether
 * the whole subtree ever touched it and from which turn a catch-up must
 * rewind. A unit the certificate never names is held free-and-exact BY PROOF
 * across the entire subtree — the orchestration loop's distant-unit gate.
 */
export class SubtreeCertificate {
  private earliestByUnit = new Map<number, number>();
  private entries = 0;

  /** Fold one resolution's ledger in. Slot→unit mapping comes from its field. */
  addResolution(ledger: Iterable<Entanglement>, field: CloudField): void {
    for (const e of ledger) {
      this.entries++;
      for (const slot of field.slots) {
        if ((e.frozen & (1 << slot.slot)) === 0) continue;
        const id = slot.record.unitId;
        const prior = this.earliestByUnit.get(id);
        if (prior === undefined || e.turn < prior) this.earliestByUnit.set(id, e.turn);
      }
    }
  }

  /** Merge a child subtree's certificate (backup). */
  merge(child: SubtreeCertificate): void {
    this.entries += child.entries;
    for (const [id, turn] of child.earliestByUnit) {
      const prior = this.earliestByUnit.get(id);
      if (prior === undefined || turn < prior) this.earliestByUnit.set(id, turn);
    }
  }

  /** Whole-subtree exactness: no entry anywhere, and no assumptions. */
  isExact(assumptions: ReadonlyArray<number>): boolean {
    return this.entries === 0 && assumptions.length === 0;
  }

  /** Is this unit provably irrelevant to the whole subtree? */
  exactFor(unitId: number): boolean {
    return !this.earliestByUnit.has(unitId);
  }

  /** How far a catch-up of this unit must rewind, over the whole subtree. */
  earliestEntangledTurn(unitId: number): number | null {
    return this.earliestByUnit.get(unitId) ?? null;
  }

  get entryCount(): number {
    return this.entries;
  }
}

/**
 * THE RESIDUE: what stands between a subtree's answer and exactness — the
 * undischarged ledger mass and the standing assumptions, in one consumer-
 * computable value (Bot B: the discharge theorem must be checkable by the
 * consumer, not recited by the engine).
 */
export function residue(
  cert: SubtreeCertificate,
  assumptions: ReadonlyArray<number>,
): {
  readonly exact: boolean;
  readonly ledgerEntries: number;
  readonly assumptions: ReadonlyArray<number>;
} {
  return {
    exact: cert.isExact(assumptions),
    ledgerEntries: cert.entryCount,
    assumptions: [...assumptions].sort((a, b) => a - b),
  };
}

/**
 * dependentsOf: the branches sharing one unit's interned claim. Registered by
 * the searcher as it forks; refining the unit once tightens every dependent —
 * O(1) in the branch count, because the claim is shared by pointer and the
 * version bump (CloudSource.claimVersion) is the only write.
 */
export class DependencyIndex {
  private readonly dependents = new Map<number, Set<string>>();

  register(unitId: number, branchKey: string): void {
    const s = this.dependents.get(unitId);
    if (s === undefined) this.dependents.set(unitId, new Set([branchKey]));
    else s.add(branchKey);
  }

  unregister(unitId: number, branchKey: string): void {
    this.dependents.get(unitId)?.delete(branchKey);
  }

  dependentsOf(unitId: number): ReadonlyArray<string> {
    return [...(this.dependents.get(unitId) ?? [])].sort();
  }
}
