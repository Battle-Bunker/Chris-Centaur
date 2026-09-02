/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/checks.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// Proof obligations as functions over an IMPLEMENTATION, not inline
// assertions (cand-h's discipline). Each checker returns a violation string or
// null, so the same checker runs against the real engine — which must come
// back clean — and against a deliberately broken one, which must not. A test
// that only ever runs against the code it is testing cannot demonstrate that
// it would have caught anything; partial-mutation.test.ts is the
// demonstration.
//
// Not exported from the package index: this is harness machinery.

import type { Board } from "./bitgrid.js";
import { bbCells, bbTest } from "./bitgrid.js";
import type { Trit } from "./risk.js";

// ---------------------------------------------------------------------------
// C1 — Containment (T1): the truth never escapes the claim.
// ---------------------------------------------------------------------------

/** The claim surface a containment check needs: cell membership per turn. */
export interface ClaimImpl {
  /** Might ANY part of the unit stand at `cell`, `n` turns after the freeze? */
  readonly possibleAt: (n: number, cell: number) => boolean;
  /** Might its ARRIVING front (head / stack) stand there at exactly `n`? */
  readonly headPossibleAt: (n: number, cell: number) => boolean;
  /** Is the unit certainly gone by `n`? */
  readonly certainlyGoneAt: (n: number) => boolean;
}

export interface WalkerTurn {
  /** Every cell the unit occupies at this turn (post-resolution). */
  readonly cells: ReadonlyArray<number>;
  /** Its standing cell (head / stack). */
  readonly head: number;
  readonly alive: boolean;
}

export function checkContainment(claim: ClaimImpl, walk: ReadonlyArray<WalkerTurn>): string | null {
  for (let n = 0; n < walk.length; n++) {
    const t = walk[n] as WalkerTurn;
    if (!t.alive) break;
    if (claim.certainlyGoneAt(n)) {
      return `turn ${n}: the claim says certainly gone, but the walker is alive`;
    }
    for (const c of t.cells) {
      if (!claim.possibleAt(n, c)) {
        return `turn ${n}: walker occupies cell ${c}, OUTSIDE the possible claim`;
      }
    }
    if (!claim.headPossibleAt(n, t.head)) {
      return `turn ${n}: walker stands at ${t.head}, outside the head claim`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// C2 — Certainty is a floor (certain-conditional-on-alive).
// ---------------------------------------------------------------------------

export function checkCertainFloor(
  certainAt: (n: number) => ReadonlyArray<number>,
  walk: ReadonlyArray<WalkerTurn>,
): string | null {
  for (let n = 0; n < walk.length; n++) {
    const t = walk[n] as WalkerTurn;
    if (!t.alive) break; // certain is CONDITIONAL ON ALIVE
    const occupied = new Set(t.cells);
    for (const c of certainAt(n)) {
      if (!occupied.has(c)) {
        return `turn ${n}: cell ${c} is claimed CERTAIN but the (alive, unsevered) walker does not occupy it`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// C3 — Completeness (the dual): no silent misses. Any true meeting between a
// modelled unit's traversal and the frozen unit's true occupancy must surface
// — as a ledger entry naming that unit, or as certain material the rules
// already adjudicate.
// ---------------------------------------------------------------------------

export function checkCompleteness(args: {
  readonly traversal: ReadonlyArray<number>;
  readonly frozenTruth: ReadonlySet<number>;
  readonly reportedCells: ReadonlySet<number>;
  readonly certainMaterial: ReadonlySet<number>;
}): string | null {
  for (const c of args.traversal) {
    if (!args.frozenTruth.has(c)) continue;
    if (args.reportedCells.has(c) || args.certainMaterial.has(c)) continue;
    return `SILENT MISS: traversal really met the frozen unit at cell ${c}, and nothing surfaced it`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// C4 — Tightness: "everything is maybe" is sound and vacuous, and rejected.
// ---------------------------------------------------------------------------

export interface VerdictImpl {
  /** Presence verdict for the unit at (cell, n). */
  readonly presenceAt: (n: number, cell: number) => Trit;
}

export function checkTightness(
  verdicts: VerdictImpl,
  freshRecordCells: ReadonlyArray<number>,
  unreachableCell: number,
): string | null {
  // At the freeze turn the record cells are the unit's known occupancy…
  for (const c of freshRecordCells) {
    if (verdicts.presenceAt(0, c) === "no") {
      return `tightness: record cell ${c} answers "no" at the freeze turn`;
    }
    if (verdicts.presenceAt(0, c) === "maybe") {
      return `tightness: record cell ${c} answers "maybe" at the freeze turn — the freeze-turn position is a FACT`;
    }
  }
  // …and a cell it cannot have reached must answer a hard NO, not maybe.
  if (verdicts.presenceAt(0, unreachableCell) !== "no") {
    return `tightness: unreachable cell ${unreachableCell} does not answer "no" at the freeze turn`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// C5 — The role MEET: a head∧body cell's encounter verdict is never better
// for the mover than the body-only verdict (delta §2; two candidates got this
// wrong with if/else priority).
// ---------------------------------------------------------------------------

const rank: Record<Trit, number> = { no: 0, maybe: 1, yes: 2 };

export function checkRoleMeet(args: {
  /** Mover survival where the cell carries head AND body roles. */
  readonly headAndBody: Trit;
  /** Mover survival where the cell carries the body role only. */
  readonly bodyOnly: Trit;
}): string | null {
  if (rank[args.headAndBody] > rank[args.bodyOnly]) {
    return `role meet violated: head∧body survival "${args.headAndBody}" is BETTER than body-only "${args.bodyOnly}" — an if/else role priority, not a meet`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// C6 — Discharge (T2): a divergence from ground truth implies a non-empty
// ledger; empty ledger AND empty assumptions ⇒ exact (delta §4, strengthened).
// ---------------------------------------------------------------------------

export function checkDischarge(args: {
  readonly ledgerEmpty: boolean;
  readonly assumptionsEmpty: boolean;
  readonly diverged: boolean;
}): string | null {
  if (args.ledgerEmpty && args.assumptionsEmpty && args.diverged) {
    return "discharge violated: the partial answer diverged from ground truth with an empty ledger and no assumptions";
  }
  return null;
}

// ---------------------------------------------------------------------------
// C7 — Saturation guardrail: on a zero lo-spread, ordering falls to the
// gradient, NEVER to hi (delta §6).
// ---------------------------------------------------------------------------

export function checkSaturationOrdering(args: {
  readonly loSpreadZero: boolean;
  /** The candidate the ordering chose. */
  readonly chosen: { readonly id: number; readonly gradient: number; readonly hi: number };
  readonly candidates: ReadonlyArray<{
    readonly id: number;
    readonly gradient: number;
    readonly hi: number;
  }>;
}): string | null {
  if (!args.loSpreadZero) return null;
  const bestGradient = Math.min(...args.candidates.map((c) => c.gradient));
  if (args.chosen.gradient !== bestGradient) {
    const byHi = [...args.candidates].sort((a, b) => b.hi - a.hi)[0];
    const suffix =
      byHi !== undefined && byHi.id === args.chosen.id
        ? " — it picked the best-hi candidate: a hi tie-break, which silently flips worst-case search into best-case"
        : "";
    return `saturation ordering violated: chose id ${args.chosen.id} (gradient ${args.chosen.gradient}) over gradient ${bestGradient}${suffix}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers for building checker inputs from boards
// ---------------------------------------------------------------------------

export function cellsOfBoard(b: Board, words: number): number[] {
  return bbCells(b, words);
}

export function boardHas(b: Board, cell: number): boolean {
  return bbTest(b, cell);
}
