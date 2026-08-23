/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/narrow.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// Near-before-far candidate narrowing — the primitive, not the policy.
// DESIGN.md §6.
//
// The engine says which of a unit's moves are worth spending a subtree on. It
// does NOT let that answer anywhere near a cloud: a narrowed list is an
// UNDER-approximation, the only one in the system, and a claim built from it
// would be unsound. `possible` always covers every legal move; this file only
// ever orders them.

import type { Board, Grid } from "./bitgrid.js";
import { bbTest } from "./bitgrid.js";
import type { Entanglement } from "./engine.js";
import type { CloudField } from "./field.js";
import type { Terrain, UnitKind } from "./grammar.js";
import { legalMoves } from "./grammar.js";

export interface CandidateMove {
  readonly dest: number;
  /** Chebyshev distance from `dest` to the nearest focus cell; 0 means it lands in it. */
  readonly distance: number;
}

const FAR = 0x3fff;

/**
 * Distance-to-focus over the whole board, kept in reusable storage. One
 * two-pass chamfer transform is exact for the Chebyshev metric and costs 2·B
 * word operations with no queue and no allocation.
 */
export class Narrower {
  readonly grid: Grid;
  private readonly dist: Int32Array;

  constructor(grid: Grid) {
    this.grid = grid;
    this.dist = new Int32Array(grid.cells);
  }

  /** Recompute the distance field from a focus set. Call once per narrowing decision. */
  focus(focus: Board): void {
    const { width, height, cells } = this.grid;
    const d = this.dist;
    for (let c = 0; c < cells; c++) d[c] = bbTest(focus, c) ? 0 : FAR;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = y * width + x;
        let best = d[c] as number;
        if (y > 0) {
          if (x > 0) best = Math.min(best, (d[c - width - 1] as number) + 1);
          best = Math.min(best, (d[c - width] as number) + 1);
          if (x < width - 1) best = Math.min(best, (d[c - width + 1] as number) + 1);
        }
        if (x > 0) best = Math.min(best, (d[c - 1] as number) + 1);
        d[c] = best;
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const c = y * width + x;
        let best = d[c] as number;
        if (y < height - 1) {
          if (x < width - 1) best = Math.min(best, (d[c + width + 1] as number) + 1);
          best = Math.min(best, (d[c + width] as number) + 1);
          if (x > 0) best = Math.min(best, (d[c + width - 1] as number) + 1);
        }
        if (x < width - 1) best = Math.min(best, (d[c + 1] as number) + 1);
        d[c] = best;
      }
    }
  }

  distanceAt(cell: number): number {
    return this.dist[cell] as number;
  }

  /**
   * A unit's legal moves, nearest to the focus first. Take the top *k* to cut the
   * branch factor: the moves that land far from anything the searcher cares about
   * are the ones whose subtrees are worth least.
   */
  rankMoves(terrain: Terrain, kind: UnitKind, origin: number): CandidateMove[] {
    const moves = legalMoves(terrain, kind, origin);
    const out: CandidateMove[] = moves.map((dest) => ({
      dest,
      distance: this.dist[dest] as number,
    }));
    out.sort((a, b) => a.distance - b.distance || a.dest - b.dest);
    return out;
  }

  /** The top *k* of the above — an UNDER-approximation, never a presence claim. */
  narrowTo(terrain: Terrain, kind: UnitKind, origin: number, k: number): CandidateMove[] {
    return this.rankMoves(terrain, kind, origin).slice(0, Math.max(0, k));
  }

  /**
   * Which frozen units are worth unfreezing first: those whose claim reaches
   * closest to the focus. Distance 0 means the searcher's own plan is standing
   * inside the claim already.
   */
  rankFrozen(field: CloudField): Array<{ unitId: number; slot: number; distance: number }> {
    const out: Array<{ unitId: number; slot: number; distance: number }> = [];
    for (const s of field.slots) {
      let best = FAR;
      for (let c = 0; c < this.grid.cells; c++) {
        if (!bbTest(s.cloud.possible, c)) continue;
        const d = this.dist[c] as number;
        if (d < best) {
          best = d;
          if (best === 0) break;
        }
      }
      out.push({ unitId: s.record.unitId, slot: s.slot, distance: best });
    }
    out.sort((a, b) => a.distance - b.distance || a.slot - b.slot);
    return out;
  }
}

/**
 * The earliest turn at which the ledger implicates a frozen unit. By the
 * conditional-soundness theorem (DESIGN.md §4.3 T2), every resolution strictly
 * before this is identical whether the unit was frozen or live — so a searcher
 * that wants to go back and simulate it rewinds exactly this far and no further.
 * `null` means it never mattered, and catching it up costs nothing.
 */
export function earliestEntangledTurn(
  ledger: Iterable<Entanglement>,
  field: CloudField,
  unitId: number,
): number | null {
  const slot = field.slotOf(unitId);
  if (slot === undefined) return null;
  const bit = 1 << slot.slot;
  let earliest: number | null = null;
  for (const e of ledger) {
    if ((e.frozen & bit) === 0) continue;
    if (earliest === null || e.turn < earliest) earliest = e.turn;
  }
  return earliest;
}

/** Every frozen unit the ledger implicates, as a slot mask. */
export function entangledSlots(ledger: Iterable<Entanglement>): number {
  let mask = 0;
  for (const e of ledger) mask |= e.frozen;
  return mask;
}
