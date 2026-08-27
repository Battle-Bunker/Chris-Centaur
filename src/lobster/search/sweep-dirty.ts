/**
 * THE SWEEP DIRTY SET — coordinate ascent, told which coordinates changed.
 *
 *   At a one-second budget the search spends 96–99% of its branch evaluations
 *   re-pricing plans it has already evaluated.
 *
 * That is W1's largest single finding and it is not about threads: 8,881 prices
 * producing 1,311 fresh evaluations against 143,637 cache hits. The evaluation
 * memo makes each hit cheap, but a `price()` is not free even when every branch
 * hits — it still walks the gate, rebuilds every branch's `JointPlan`, computes
 * a `planKey` per branch, runs `ledgerOf`/`normalizeLedger` and assembles
 * `ScoreBounds`. W1's own recommendation, ranked above any further parallelism
 * work: *"Once `improve` has converged, restarts failed and polish returned
 * unchanged, the next slice repeats all of it and reaches the same place."*
 *
 * ── WHY THIS IS THE FACTOR-GRAPH LENS AND NOT AN OPTIMISATION ──────────────
 *
 * "Coordinate ascent becomes message passing" is precisely this rule. A
 * coordinate needs re-examination exactly when a message reaching it has
 * changed — that is, when its own assignment or a NEIGHBOUR's assignment moved
 * since it was last examined. Everything else is a recomputation of a fixed
 * point. The neighbourhood is the interaction graph the cluster partition
 * already built, with the fiat intact: a slider is adjacent to everything, so a
 * slider that moves dirties the whole board.
 *
 * ── WHAT MAKES IT SAFE ─────────────────────────────────────────────────────
 *
 * A skipped unit is a unit whose alternatives were all priced and all refused
 * by `better()`, under a state that has not changed since. Two things can make
 * that stale and BOTH clear the whole set:
 *
 *  · **A NEW WITNESS.** A witness admitted this slice makes a fresh B2 branch of
 *    every plan priced after it, so a previously-refused trial can become an
 *    improvement. Cleared on any change to the witness count.
 *  · **A TRUNCATED PASS.** A sweep the budget cut short did not price a unit's
 *    alternatives at all; marking it clean would be recording an answer nobody
 *    computed. Only a unit whose loop ran to completion is ever marked.
 *
 * What this does NOT model is the bank's B-LEVEL: the same plan priced under a
 * starved budget yields B0 and under a fresh slice yields B3, and a trial
 * refused at B0 might be accepted at B3. Skipping it is a loss of search
 * quality — never of soundness, because acceptance is still `better()` on the
 * proved floor, and the incumbent itself is re-priced at the top of every
 * `improve`. It is measured rather than assumed, and it is behind the same flag
 * as everything else in this stage.
 */

import type { Candidate, JointPlan, UnitId } from '../contracts';
import type { Partition } from './cluster-partition';

export interface DirtyStats {
  /** Unit-sweeps skipped because the neighbourhood had not moved. */
  readonly skipped: number;
  /** Unit-sweeps actually run. */
  readonly swept: number;
}

export class SweepDirty {
  /** unit → the units whose assignment can change this unit's answer, itself first. */
  private readonly neighbourhood = new Map<UnitId, ReadonlyArray<UnitId>>();
  /** unit → the assignment of its neighbourhood when it was last swept clean. */
  private readonly snapshot = new Map<UnitId, ReadonlyArray<Candidate | undefined>>();
  private witnesses = -1;
  private skippedCount = 0;
  private sweptCount = 0;

  /**
   * The neighbourhood is fixed for a session: it is a property of the board's
   * interaction graph, not of any plan. Built once, from the partition.
   */
  constructor(partition: Partition, sweepable: ReadonlyArray<UnitId>) {
    for (const unitId of sweepable) {
      const near: UnitId[] = [unitId];
      for (const other of sweepable) {
        if (other === unitId) continue;
        if (partition.adjacent(unitId, other)) near.push(other);
      }
      this.neighbourhood.set(unitId, near);
    }
  }

  get stats(): DirtyStats {
    return { skipped: this.skippedCount, swept: this.sweptCount };
  }

  /**
   * A new witness invalidates every clean mark. Called once per `improve`,
   * before the first sweep.
   */
  noteWitnesses(count: number): void {
    if (count === this.witnesses) return;
    this.witnesses = count;
    this.snapshot.clear();
  }

  /** Everything is dirty again. The caller's escape hatch. */
  invalidate(): void {
    this.snapshot.clear();
  }

  /**
   * Does this unit's neighbourhood need re-pricing?
   *
   * A unit with no recorded neighbourhood (not sweepable when the set was
   * built — a pin that has since been released) is always dirty: fail toward
   * doing the work.
   */
  isDirty(unitId: UnitId, plan: JointPlan): boolean {
    const near = this.neighbourhood.get(unitId);
    const was = this.snapshot.get(unitId);
    if (near === undefined || was === undefined) return true;
    for (let i = 0; i < near.length; i++) {
      // Object identity, and it is exact: candidates are the session's own,
      // built once per basis, and `withMove` carries the same objects through
      // every plan the search holds.
      if (plan.get(near[i] as UnitId) !== was[i]) return true;
    }
    return false;
  }

  /**
   * Record that this unit's whole alternative list was priced against this
   * plan and none of it improved. ONLY for a loop that ran to completion.
   */
  markClean(unitId: UnitId, plan: JointPlan): void {
    const near = this.neighbourhood.get(unitId);
    if (near === undefined) return;
    this.snapshot.set(
      unitId,
      near.map((id) => plan.get(id)),
    );
  }

  countSkipped(): void {
    this.skippedCount++;
  }

  countSwept(): void {
    this.sweptCount++;
  }
}
