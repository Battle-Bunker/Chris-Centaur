/**
 * HOW THE SEARCH'S WORK IS CUT INTO PARCELS — the seam, not the policy.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM THE POOL ─────────────────────────
 *
 * Today the only thing a worker is given is a BATCH OF JOINT PLANS taken from
 * the coordinate ascent's own sweep frontier. The cluster-lookahead program
 * wants a different cut: a CLUSTER of interacting units, whose local joint
 * sub-plans the worker enumerates for itself instead of being handed one by
 * one. Those are two `WorkPartition`s over the same `Frontier`, and swapping
 * them changes nothing else in this subsystem:
 *
 *   · the POOL owns spawn/reuse/shutdown, the board push and the in-flight
 *     accounting, and never looks inside a parcel;
 *   · the TRANSPORT is stated over `Parcel` (a discriminated union — the
 *     cluster parcel is a second case) and `ParcelResult` (a bag of evaluation
 *     memo entries — the same shape whatever produced it);
 *   · the FOLD imports memo entries and asserts nothing about their provenance,
 *     so the determinism argument in `bounds/evalmemo.ts` covers a cluster
 *     parcel exactly as it covers a plan batch;
 *   · the WORKER dispatches on `parcel.kind`, so a new kind is a new `case` and
 *     a new local enumerator, not a new protocol.
 *
 * The one thing that would have to move is the frontier itself: a cluster
 * partition needs the interaction graph (`mtl/census-interaction-graph.md`
 * JOB 2) rather than the danger order, so `Frontier` carries the SESSION and
 * the incumbent's own resolution and lets a partition ask its own questions of
 * them. That is why `Frontier` is a bundle of search state rather than a
 * pre-flattened list of plans.
 *
 * ── WHY THE CUT IS "THE TAIL", AND WHAT THAT BUYS ─────────────────────────
 *
 * A slice is SYNCHRONOUS JavaScript. No worker message can be received while
 * one is running — the event loop is not reached until the kernel's own
 * `yieldToEventLoop` between slices. So a parcel dispatched during slice N is
 * folded at the start of slice N+1, never inside slice N, and speculating on
 * work the current slice is about to do itself is speculating on a race the
 * worker cannot win.
 *
 * What pays instead is the TAIL: the main thread sweeps the frontier in danger
 * order from the front and gets through some prefix of it before its slice
 * ends; the workers take contiguous chunks of what is left, and slice N+1 finds
 * them already evaluated. With W workers the frontier is cut into W+1 chunks,
 * the main thread implicitly owning chunk 0 by simply doing what it always did.
 */

import type { Candidate, CandidateSet, UnitId } from "../contracts"
import type { BankResult } from "../bounds"
import { dangerOrder, topCandidates } from "../search/order"
import { encodeCandidate, UNENCODABLE } from "./protocol"

/**
 * The search state a partition is allowed to look at.
 *
 * Deliberately the SESSION's own view of the world — the roster, the candidate
 * sets, the pinned set, and the priced incumbent whose resolution names who is
 * in danger. A cluster partition needs precisely these plus an interaction
 * graph built over them; a plan-batch partition needs the first four.
 */
export interface Frontier {
  readonly roster: ReadonlyArray<UnitId>
  readonly sets: ReadonlyMap<UnitId, CandidateSet>
  readonly pinned: ReadonlySet<UnitId>
  /** The incumbent as the search has just priced it: its plan is what a trial
   * perturbs, and its `worstResolution` is what danger order reads. */
  readonly incumbent: BankResult
  /** `SearchTuning.candidateCap` — how wide the real sweep goes per unit, so a
   * speculation never offers the search options the search would not try. */
  readonly candidateCap: number
}

/** One worker's share, in the coordinator's own vocabulary. */
export interface PlanChunk {
  /** Plans as candidate-index vectors, `roster.length` codes each. */
  readonly codes: Int32Array
  readonly count: number
}

/**
 * The seam. A partition turns search state into per-slot work.
 *
 * `slots` is how many workers are free RIGHT NOW, which is the only thing the
 * pool tells a partition: a partition never decides how much parallelism there
 * is, and never decides what a slice is worth.
 */
export interface WorkPartition {
  readonly name: string
  partition(frontier: Frontier, slots: number): ReadonlyArray<PlanChunk>
}

/**
 * THE SHIPPED PARTITION: the sweep frontier, minus the prefix this slice will
 * cover itself, cut into contiguous chunks.
 *
 * The frontier is enumerated in exactly the order `SearchCore.sweep` walks it —
 * `dangerOrder` over the roster, then `topCandidates(set, candidateCap)` per
 * unit, skipping the incumbent's own choice — so every plan a worker prices is
 * a plan the search would price, in the order it would reach them. Speculation
 * that invents plans the search never tries is not speculation, it is a second
 * search, and a second search is exactly what a pure evaluator must not be.
 *
 * `headroom` is how many of the leading plans to leave alone: the main thread
 * is about to price them itself and would beat any worker to them. It is set
 * by the caller from what a slice has actually been MEASURED to get through,
 * never guessed here.
 */
export function planBatchPartition(headroom: number): WorkPartition {
  return {
    name: "plan-batch",
    partition(frontier: Frontier, slots: number): ReadonlyArray<PlanChunk> {
      if (slots <= 0) return []
      const width = frontier.roster.length
      if (width === 0) return []
      const plans = sweepFrontier(frontier)
      const tail = plans.slice(Math.max(0, headroom))
      if (tail.length === 0) return []
      const per = Math.ceil(tail.length / slots)
      const out: PlanChunk[] = []
      for (let from = 0; from < tail.length; from += per) {
        const take = tail.slice(from, Math.min(tail.length, from + per))
        const codes = new Int32Array(take.length * width)
        for (let i = 0; i < take.length; i++) codes.set(take[i] as Int32Array, i * width)
        out.push({ codes, count: take.length })
      }
      return out
    },
  }
}

/**
 * The plans `sweep` would try from this incumbent, encoded, in its own order.
 *
 * A plan that cannot be encoded — a unit sitting on a candidate that is in
 * neither its offered list nor its pruned ledger — is DROPPED rather than
 * approximated. It is the incumbent's own choice for some unit, so the miss
 * costs one speculation, and sending a plan that is not the plan would burn a
 * worker on entries nobody can look up.
 */
export function sweepFrontier(frontier: Frontier): ReadonlyArray<Int32Array> {
  const { roster, sets, pinned, incumbent, candidateCap } = frontier
  const width = roster.length
  const base = new Int32Array(width)
  for (let i = 0; i < width; i++) {
    const unitId = roster[i] as UnitId
    const set = sets.get(unitId)
    const chosen = incumbent.plan.get(unitId)
    base[i] = set === undefined || chosen === undefined ? UNENCODABLE : encodeCandidate(set, chosen)
  }
  for (let i = 0; i < width; i++) if (base[i] === UNENCODABLE) return []

  const out: Int32Array[] = []
  for (const unitId of dangerOrder(roster, incumbent.worstResolution, pinned)) {
    const slot = roster.indexOf(unitId)
    if (slot < 0) continue
    const set = sets.get(unitId)
    if (set === undefined) continue
    const current = base[slot] as number
    for (const candidate of topCandidates(set.candidates, candidateCap)) {
      const code = encodeCandidate(set, candidate)
      if (code === UNENCODABLE || code === current) continue
      const plan = Int32Array.from(base)
      plan[slot] = code
      out.push(plan)
    }
  }
  return out
}

/** Decode one plan back into a `JointPlan` over the decoder's own catalogue. */
export function decodePlan(
  roster: ReadonlyArray<UnitId>,
  sets: ReadonlyMap<UnitId, CandidateSet>,
  codes: Int32Array,
  at: number,
  decode: (set: CandidateSet, code: number) => Candidate | null,
): Map<UnitId, Candidate> | null {
  const plan = new Map<UnitId, Candidate>()
  for (let i = 0; i < roster.length; i++) {
    const unitId = roster[i] as UnitId
    const set = sets.get(unitId)
    if (set === undefined) return null
    const candidate = decode(set, codes[at + i] as number)
    if (candidate === null) return null
    plan.set(unitId, candidate)
  }
  return plan
}
