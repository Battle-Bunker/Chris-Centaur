/**
 * THE CONFLICT INDEX — every claim our own team makes this turn, keyed by
 * `(cell, subStep)`, in the shape the engine itself uses.
 *
 *   BUILD THE INDEX. DO NOT ENUMERATE THE PAIRS.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * The candidate layer is PER UNIT. It cannot see a team-mate, so two of our
 * units whose best options name the same cell both get it, and every consumer
 * downstream — the seed, the sweep, the pair repair — discovers the accident
 * only by paying for a resolution that contains it. `selfInflictedPairs` reads
 * a RESOLUTION: it costs a bounded resolve to learn a pair is broken, and only
 * if the accident happened in the world that was priced. Its own fallback
 * branch says what that misses: *"MISSES mutual annihilations, where nobody is
 * left standing — a real loss of coverage, not a free substitution."*
 *
 * A mutual annihilation is two of our claims meeting at one `(cell, subStep)`
 * with a comparator tie. That is a fact about the staged cells and the frozen
 * strengths, and it is knowable before the first price.
 *
 * ── WHY IT IS AN INDEX AND NOT A PAIR TABLE ────────────────────────────────
 *
 * The naive shape is `|O|² × cap² × |path|²` and was measured at 8–150 µs per
 * decision — 0.3 to 0.75 of a whole `scorePlan`, on a board whose median
 * decision manages five scored plans. One pass writing every claim into a
 * `(cell, subStep) → claimants` chain is 0.12–0.94 µs, after which every
 * conflict is read off in `O(number of actual conflicts)`. Any predicate that
 * cannot be phrased as an index read does not belong here.
 *
 * The layout is the engine's own (`indexBoard`: `occHead`/`occNext`,
 * generation-stamped flat typed arrays) and the stamp discipline is W2's
 * (`scratch.ts`), so a rebuild is one integer increment rather than a clear.
 * That matters because the index is rebuilt per sweep step, not per decision.
 *
 * ── WHAT `(cell, subStep)` BUYS, AND WHY THE SUB-STEP IS NOT OPTIONAL ───────
 *
 * Movers advance one cell per sub-step and EVERY ray cell is adjudicated, not
 * just the destination. A destination-only predicate reports roughly 1.89×
 * (2.22× against sliders) more interaction than a path-aware one. Worse, it
 * over-fires in the excluding direction on the one case that is not a conflict
 * at all: two units crossing the same cell at DIFFERENT sub-steps never meet.
 * Keying the slot on the sub-step makes that case structurally invisible
 * instead of a special case somebody has to remember.
 *
 * Sub-step numbering here is the engine's: a mover's head is at `path[s-1]`
 * after `s` advances, so `path[i]` is claimed at sub-step `i + 1`. Sub-step 0
 * is turn start and is never indexed — no two of our units share a head cell
 * at turn start, so the slot could hold nothing.
 *
 * ── RESTERS ARE INCUMBENTS ─────────────────────────────────────────────────
 *
 * `indexBoard` registers every living unit at its head cell *"whether it
 * advanced or stood still"*, and a cell contest is a strict maximum over the
 * WHOLE pile, not a comparison against the newest arrival. So a unit that has
 * come to rest is a standing participant at every LATER sub-step too, and the
 * index writes it into every one of them. That is what makes "one rests, the
 * other's ray crosses later" a conflict and "both cross, at different
 * sub-steps" not one, with no case analysis at the read site.
 *
 * ── WHAT THIS FILE DOES NOT KNOW ───────────────────────────────────────────
 *
 * Nothing about strength, teams, death, or value. It records who claims what
 * and when. Whether a claim pair is a tie, a kill, a legitimate sacrifice or a
 * free follow is read off the substrate by the caller, because those are rules
 * and this is a data structure. It also carries no BODY channel: a living
 * body is adjudicated by tier alone where a claim contest is adjudicated by
 * (tier, weight), and folding two different comparators into one index is
 * exactly the mistake that produced a shipped bug once already.
 */

import { StampedInt32 } from '../scratch';
import type { CellIndex, UnitId } from '../contracts';

/** The absent claim. Chains terminate on it and lookups return it. */
export const NO_CLAIM = -1;

/** Set on a claim the unit is still standing on at this sub-step. */
const F_RESTING = 1;

/**
 * A hard ceiling on indexed sub-steps.
 *
 * The real bound is the longest enumerated path on the board; a slider ray of
 * 11 has been observed, and a 23×23 board admits 21. This is not a truncation
 * of anything the caller asked for — `begin` takes the sub-step count it will
 * actually use — it is a guard so that a caller computing the bound wrongly
 * allocates a bounded amount of memory instead of an unbounded one.
 */
export const MAX_SUB_STEPS = 64;

/**
 * The sub-step at which a candidate's path enters `path[i]`. One place, so the
 * off-by-one lives once: `path[0]` is entered by the first advance, which is
 * sub-step 1.
 */
export const subStepOf = (pathIndex: number): number => pathIndex + 1;

/**
 * How many sub-steps a set of paths needs. The longest path decides, and a
 * plan of holders still needs one: a holder is an incumbent at sub-step 1.
 */
export function subStepsFor(paths: Iterable<ReadonlyArray<CellIndex>>): number {
  let longest = 1;
  for (const path of paths) if (path.length > longest) longest = path.length;
  return Math.min(longest, MAX_SUB_STEPS - 1) + 1;
}

export class ConflictIndex {
  /** slot → first claim id, with W2's O(1) clear. */
  private slots: StampedInt32;
  private capSlots: number;

  // The claim columns. Parallel arrays, grown together.
  private nextIn: Int32Array;
  private unitIn: Int32Array;
  private fromIn: Int32Array;
  private cellIn: Int32Array;
  private stepIn: Int32Array;
  private flagIn: Uint8Array;

  private n = 0;
  private cells = 0;
  private steps = 0;
  private open = false;

  /** Claims written since the last `begin()`. Telemetry, and a bench's units. */
  get size(): number {
    return this.n;
  }

  /** Sub-steps this generation indexes: valid sub-steps are `1 .. subSteps-1`. */
  get subSteps(): number {
    return this.steps;
  }

  constructor(cells = 0, subSteps = 2, claimCapacity = 64) {
    this.capSlots = Math.max(1, cells * subSteps);
    this.slots = new StampedInt32(this.capSlots);
    const cap = Math.max(8, claimCapacity);
    this.nextIn = new Int32Array(cap);
    this.unitIn = new Int32Array(cap);
    this.fromIn = new Int32Array(cap);
    this.cellIn = new Int32Array(cap);
    this.stepIn = new Int32Array(cap);
    this.flagIn = new Uint8Array(cap);
  }

  /**
   * Start a generation. O(1) unless the board or the sub-step bound grew.
   *
   * `subSteps` is the EXCLUSIVE bound: pass `subStepsFor(...)`. Everything
   * written before this call is gone, which is the whole point — the index is
   * rebuilt per sweep step and a rebuild must not cost a clear.
   */
  begin(cells: number, subSteps: number): void {
    if (!Number.isInteger(cells) || cells <= 0) {
      throw new RangeError(`conflict index needs a positive cell count, got ${cells}`);
    }
    if (!Number.isInteger(subSteps) || subSteps < 2 || subSteps > MAX_SUB_STEPS) {
      throw new RangeError(
        `conflict index needs 2..${MAX_SUB_STEPS} sub-steps, got ${subSteps} — ` +
          'use subStepsFor() on the paths being indexed',
      );
    }
    const need = cells * subSteps;
    if (need > this.capSlots) {
      // A grown stamp array is all-zero, and generation 0 is never live, so it
      // reads as empty without a fill. Sizing up rather than exactly means a
      // board that oscillates between two shapes allocates once.
      this.capSlots = need * 2;
      this.slots = new StampedInt32(this.capSlots);
    }
    this.cells = cells;
    this.steps = subSteps;
    this.n = 0;
    this.open = true;
    this.slots.begin();
  }

  /**
   * Record one unit's whole claim: every cell its head passes through at the
   * sub-step it passes through it, then the cell it comes to rest on for every
   * sub-step after that.
   *
   * A holder (`path` empty) claims `from` from sub-step 1 onward. That is not
   * a special case bolted on: a holder is a standing participant in a contest
   * exactly as an arrival is, and the engine registers it the same way.
   *
   * Returns the number of slots written, which is what a bench measures.
   */
  claim(unitId: UnitId, from: CellIndex, path: ReadonlyArray<CellIndex>): number {
    if (!this.open) throw new Error('conflict index: claim() before begin()');
    const last = Math.min(path.length, this.steps - 1);
    let written = 0;
    let prev = from as number;
    for (let i = 0; i < last; i++) {
      const cell = path[i] as number;
      this.write(unitId as number, prev, cell, subStepOf(i), false);
      prev = cell;
      written++;
    }
    // Where the unit ends up: the last path cell it actually reaches, or its
    // own square when it did not move.
    const rest = last === 0 ? (from as number) : (path[last - 1] as number);
    const restOrigin = last === 0 ? (from as number) : (path[last - 2] as number | undefined) ?? (from as number);
    for (let s = last + 1; s < this.steps; s++) {
      this.write(unitId as number, restOrigin, rest, s, true);
      written++;
    }
    return written;
  }

  private write(unitId: number, from: number, cell: number, step: number, resting: boolean): void {
    if (this.n >= this.nextIn.length) this.grow();
    const id = this.n++;
    const slot = cell * this.steps + step;
    this.nextIn[id] = this.slots.get(slot, NO_CLAIM);
    this.unitIn[id] = unitId;
    this.fromIn[id] = from;
    this.cellIn[id] = cell;
    this.stepIn[id] = step;
    this.flagIn[id] = resting ? F_RESTING : 0;
    this.slots.set(slot, id);
  }

  private grow(): void {
    const cap = this.nextIn.length * 2;
    const copy = <T extends Int32Array | Uint8Array>(src: T, made: T): T => {
      made.set(src);
      return made;
    };
    this.nextIn = copy(this.nextIn, new Int32Array(cap));
    this.unitIn = copy(this.unitIn, new Int32Array(cap));
    this.fromIn = copy(this.fromIn, new Int32Array(cap));
    this.cellIn = copy(this.cellIn, new Int32Array(cap));
    this.stepIn = copy(this.stepIn, new Int32Array(cap));
    this.flagIn = copy(this.flagIn, new Uint8Array(cap));
  }

  // ------------------------------------------------------------------ reads

  /**
   * The most recently written claim on `(cell, subStep)`, or `NO_CLAIM`.
   * Walk the rest with `next`. Out-of-range sub-steps report empty rather than
   * throwing: a caller asking about sub-step 9 of a two-sub-step decision is
   * asking a question whose answer really is "nobody".
   */
  firstAt(cell: CellIndex, subStep: number): number {
    if (subStep < 1 || subStep >= this.steps) return NO_CLAIM;
    const c = cell as number;
    if (c < 0 || c >= this.cells) return NO_CLAIM;
    return this.slots.get(c * this.steps + subStep, NO_CLAIM);
  }

  next(claim: number): number {
    return claim < 0 || claim >= this.n ? NO_CLAIM : (this.nextIn[claim] as number);
  }

  unitAt(claim: number): UnitId {
    return this.unitIn[claim] as UnitId;
  }

  /** The cell this claim's head came FROM at this sub-step. */
  fromAt(claim: number): CellIndex {
    return this.fromIn[claim] as CellIndex;
  }

  cellAt(claim: number): CellIndex {
    return this.cellIn[claim] as CellIndex;
  }

  stepAt(claim: number): number {
    return this.stepIn[claim] as number;
  }

  /** Is the claimant standing here rather than passing through? */
  restingAt(claim: number): boolean {
    return ((this.flagIn[claim] as number) & F_RESTING) !== 0;
  }

  /** How many units claim `(cell, subStep)`. `>= 3` is the k-way pile. */
  countAt(cell: CellIndex, subStep: number): number {
    let n = 0;
    for (let c = this.firstAt(cell, subStep); c !== NO_CLAIM; c = this.next(c)) n++;
    return n;
  }

  /** The first claim on `(cell, subStep)` that is not `unitId`'s own. */
  otherAt(cell: CellIndex, subStep: number, unitId: UnitId): number {
    for (let c = this.firstAt(cell, subStep); c !== NO_CLAIM; c = this.next(c)) {
      if ((this.unitIn[c] as number) !== (unitId as number)) return c;
    }
    return NO_CLAIM;
  }

  /**
   * THE EDGE EXCHANGE, read off the same index.
   *
   * A unit stepping `from → to` at sub-step `s` exchanges edges with any unit
   * whose head arrives at `from` at the same sub-step having come from `to`.
   * Two heads crossing one edge in opposite directions in one sub-step is
   * adjudicated before walls, arrivals and bodies, and on a comparator tie
   * NEITHER crosses and BOTH die — so this is the one pair fact in the
   * catalogue that is exactly decidable and costs nothing extra to key: the
   * `from` column the arrival already carries is the whole predicate.
   *
   * A resting claimant is not an exchange partner (it crossed no edge), and
   * neither is the unit itself.
   */
  swapPartnerAt(from: CellIndex, to: CellIndex, subStep: number, unitId: UnitId): number {
    for (let c = this.firstAt(from, subStep); c !== NO_CLAIM; c = this.next(c)) {
      if ((this.unitIn[c] as number) === (unitId as number)) continue;
      if ((this.flagIn[c] as number) & F_RESTING) continue;
      if ((this.fromIn[c] as number) === (to as number)) return c;
    }
    return NO_CLAIM;
  }
}
