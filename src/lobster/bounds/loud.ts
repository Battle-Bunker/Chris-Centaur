/**
 * THE LOUD PRODUCT `Q` — an instrument, and deliberately nothing else.
 *
 * `08-DEPTH-VERDICT` §1.3 (Finding D-1) says the reply product `P` is
 * simultaneously the cost of a chained ply and the INVERSE of its value: below
 * `productCap` B3 has already enumerated the whole cross-product and closed the
 * bracket, above it the bracket is open and a chained ply costs tens of
 * decision budgets. So any affordable deep member has to be selected by a
 * quantity that is not `P`, and §3.3/§4.2 name the candidate:
 *
 *     one held enemy's option is LOUD iff its path meets the staged plan's
 *     footprint in sub-step time, and  Q = Π over gated enemies of |loud(e)|.
 *
 * That is the entanglement relation the gate already computes per UNIT
 * (`bank.ts` `gateOnEntanglement`, `footprintOf`), moved to the OPTION. An
 * option that never touches our footprint cannot capture, cannot contest,
 * cannot sever and cannot move either endpoint of the bracket.
 *
 * WHAT THIS FILE IS ALLOWED TO DO. Count. `Q` is a SUM to compute — it walks
 * option lists the B3 preamble has already built and paths those options
 * already carry — and it settles nothing, evaluates nothing and reads no
 * clock. It therefore cannot move a decision, and under the runner's node
 * clock (`nodes x NODE_COST + reads x READ_COST`) it cannot move a counter
 * either: both of that clock's terms are evaluator calls and `now()` reads,
 * and this makes neither. That is the whole reason step 1 of §5 can be merged
 * on a gate that says "byte-identical" and mean it.
 *
 * WHY THE OBSERVER IS A MODULE-LEVEL LATCH. The reading is taken deep inside a
 * bank that lives one decision and is owned by a search session the runner
 * never sees. The alternative to a latch is threading a sink through
 * `BankInput`, `SearchContext` and `KernelInput` for a counter — the seam a
 * measurement is supposed to avoid buying. `observeLoud` returns its own
 * uninstaller, the previous observer is restored rather than dropped, and with
 * nobody watching the cost is one null check per priced plan.
 */

import type { Candidate, JointPlan, SubStep, UnitId } from "../contracts";
import { footprintOf } from "./plan";

/** One gated enemy's option list, counted. */
export interface LoudUnitCount {
  readonly unitId: UnitId;
  /** Every option the adversary sweep would enumerate — the `P` factor. */
  readonly options: number;
  /** Those whose path meets the staged footprint in sub-step time. */
  readonly loud: number;
}

/**
 * ONE OCCASION: the B3 preamble of one priced plan, with both products.
 *
 * `product` is `P` exactly as `bank.ts` already computes it, carried beside `Q`
 * so the two distributions are read off ONE population rather than two runs —
 * which is the only way Finding D-1's anti-correlation can be checked rather
 * than assumed.
 */
export interface LoudReading {
  readonly units: ReadonlyArray<LoudUnitCount>;
  /** `Π |loud(e)|`. Zero ⇒ some gated enemy has no loud option at all: nothing
   *  it can play touches us, and a ceiling ply would have nothing to enumerate. */
  readonly q: number;
  /** `Π |options(e)|` — the existing reply product. */
  readonly product: number;
  /**
   * Whether B3 ACTUALLY FIRED on this occasion — the gate covers everything,
   * every list is complete, and `product <= productCap`. This is the D-1 axis:
   * `true` is an occasion where the ply-1 bracket is already closed and depth
   * has nothing to buy; `false` is one where it is genuinely open.
   */
  readonly b3: boolean;
  /**
   * `coversEverything` — the gate reached EVERY held unit. Carried separately
   * because it is the term of `b3` that a product bucket cannot stand in for:
   * an occasion under `productCap` is not an occasion B3 closed unless the
   * gate also covered the held set, and one of those two is measured while
   * the other has been inferred.
   */
  readonly covers: boolean;
}

/** A cell of the staged footprint and the sub-step window it is held over. */
type Window = { readonly from: SubStep; readonly to: SubStep };

/**
 * The staged footprint, indexed by cell. Built from `footprintOf` rather than
 * from a rule of this file's own: a loud test that disagreed with the gate's
 * own geometry would be measuring a different relation than the one §4.2
 * proposes to enumerate.
 */
function windowsOf(plan: JointPlan): Map<number, Window[]> {
  const out = new Map<number, Window[]>();
  for (const span of footprintOf(plan)) {
    const at = out.get(span.cell);
    const window = { from: span.fromSubStep, to: span.toSubStep };
    if (at === undefined) out.set(span.cell, [window]);
    else at.push(window);
  }
  return out;
}

/**
 * Is this option loud against that footprint?
 *
 * The option's own occupancy is taken through `footprintOf` as well, over a
 * one-entry plan, so a path-less candidate (a stay, a rotate) is gated on
 * `from` exactly as the unit-level gate gates it, and a resting cell keeps its
 * window open to the end of the turn. The scratch map is reused across the
 * options of one list: this runs per priced plan and an allocation per option
 * would be the only cost worth naming.
 */
function isLoud(candidate: Candidate, footprint: Map<number, Window[]>, scratch: Map<UnitId, Candidate>): boolean {
  scratch.clear();
  scratch.set(candidate.unitId, candidate);
  for (const span of footprintOf(scratch)) {
    const windows = footprint.get(span.cell);
    if (windows === undefined) continue;
    for (const w of windows) {
      // Two closed sub-step intervals meet. `Number.MAX_SAFE_INTEGER` is the
      // conservative reading of a resting cell, so this errs LOUD, which is
      // the side that over-counts `Q` rather than under-counting it.
      if (span.fromSubStep <= w.to && w.from <= span.toSubStep) return true;
    }
  }
  return false;
}

/** One gated enemy's option list, PARTITIONED — the counts with the options
 *  still attached, because the ceiling ply enumerates what step 1 counted. */
export interface LoudUnitList extends LoudUnitCount {
  /** The options whose path meets the staged footprint. */
  readonly loudOptions: ReadonlyArray<Candidate>;
}

/**
 * The partition itself: per gated enemy, the loud options and their count.
 *
 * ONE RELATION, TWO READERS. `loudReadingOf` counts this and reports it as an
 * instrument; `bank.ts`'s B4 enumerates it. They must be the same partition or
 * the measurement that licensed the member is a measurement of something else,
 * so there is one function and the counter is derived from it.
 */
export function loudListsOf(
  plan: JointPlan,
  lists: ReadonlyArray<{ readonly id: UnitId; readonly options: ReadonlyArray<Candidate> }>,
): ReadonlyArray<LoudUnitList> {
  const footprint = windowsOf(plan);
  const scratch = new Map<UnitId, Candidate>();
  const out: LoudUnitList[] = [];
  for (const list of lists) {
    const loud: Candidate[] = [];
    for (const option of list.options) if (isLoud(option, footprint, scratch)) loud.push(option);
    out.push({ unitId: list.id, options: list.options.length, loud: loud.length, loudOptions: loud });
  }
  return out;
}

/**
 * The reading, and the one place the observer is told about it.
 *
 * `lists` is the B3 preamble's own array — the gated enemies and the option
 * lists it already built — so nothing here generates a candidate.
 */
export function loudReadingOf(
  plan: JointPlan,
  lists: ReadonlyArray<{ readonly id: UnitId; readonly options: ReadonlyArray<Candidate> }>,
  product: number,
  b3: boolean,
  covers: boolean,
  partition?: ReadonlyArray<LoudUnitList>,
): LoudReading {
  const walked = partition ?? loudListsOf(plan, lists);
  const units: LoudUnitCount[] = [];
  let q = 1;
  for (const list of walked) {
    units.push({ unitId: list.unitId, options: list.options, loud: list.loud });
    q *= list.loud;
  }
  const reading: LoudReading = { units, q: lists.length === 0 ? 0 : q, product, b3, covers };
  observer?.(reading);
  return reading;
}

/** The installed observer, or null. Null ⇒ this file costs one null check. */
let observer: ((reading: LoudReading) => void) | null = null;

/**
 * Watch every occasion until the returned function is called.
 *
 * The previous observer is restored rather than cleared, so a nested measured
 * run (the recorded-decision harness inside a game the runner is already
 * counting) cannot silently steal the outer one's readings.
 */
export function observeLoud(fn: (reading: LoudReading) => void): () => void {
  const previous = observer;
  observer = fn;
  return () => {
    observer = previous;
  };
}
