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
 * What pays instead is the frontier of the NEXT slice. `SearchCore.improve`
 * dispatches at the END of a slice, from the incumbent that slice settled on:
 * `sweep` starts from that plan next time, and the plans one move away from it
 * are exactly what it perturbs. Those are unpriced (the sweep priced variations
 * of the intermediate plans it passed through, not of the one it stopped on),
 * and the workers get a whole slice boundary of head start on them.
 *
 * Measured, because the difference is not subtle. Dispatched at the START of a
 * slice on the bench board at a one-second budget: 423 entries imported, ZERO
 * ever read — the coordinator swept the whole frontier before any message could
 * be delivered.
 */

import type { Candidate, CandidateSet, JointPlan, UnitId } from "../contracts"
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
  /**
   * CL3 — THE CLUSTER JOINTS THIS SESSION HAS ENUMERATED AND NOT YET PRICED.
   *
   * Composed k-best joints from the cluster partition, in the order the
   * coordinator will offer them, with the prefix it has ALREADY priced removed.
   * That prefix removal is the whole reason this is a list of leftovers rather
   * than the whole set: W1 measured 3,344 speculative entries offered and ZERO
   * new, because a pure evaluator can only predict the incumbent's one-move
   * neighbourhood and coordinate ascent has already priced it. These plans are
   * two-move-and-deeper by construction — the exact thing a 1-opt hill climb
   * structurally cannot reach — and the coordinator has not got to them.
   *
   * Absent or empty ⇒ the shipped plan-batch cut. Nothing else in the subsystem
   * changes: the parcel is still `plan-batch` codes, the transport is
   * unchanged, and the fold asserts nothing about provenance.
   */
  readonly proposals?: ReadonlyArray<JointPlan>
  /**
   * CL4 — THE SAMPLED SEQUENCE THE NEXT SLICE WILL ACTUALLY SWEEP.
   *
   * Absent (the default, and the whole of the flag-off path) the frontier is
   * re-derived here from `dangerOrder` + `topCandidates`, exactly as the sweep
   * would walk it. Present, it IS what the sweep will walk: the coordinator's
   * seeded sampler produced it before this parcel was cut, and the next slice
   * will reproduce it from the same seed and the same draw index.
   *
   * That is contract rule 20's clause about workers, met structurally: *"the
   * dispatch sequence is decided on the coordinator before any worker runs and
   * is a pure function of (seed, board, epoch, slice) — never of worker
   * timing."* A speculation cut from a DIFFERENT order than the sweep will use
   * is not a speculation, it is a second search — and W1 already measured what
   * that is worth (3,344 entries offered, 0 read).
   */
  readonly order?: SampledOrder
}

/**
 * The sampled sweep sequence, as the partition is allowed to see it: a unit
 * order and, per unit, the options that unit will actually be tried on. Both
 * are already capped by the coordinator, so a partition never widens what the
 * search would try.
 */
export interface SampledOrder {
  readonly units: ReadonlyArray<UnitId>
  candidatesFor(unitId: UnitId): ReadonlyArray<Candidate>
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
 * `headroom` is how many of the leading plans to leave alone — how much of the
 * next slice's frontier the coordinator is assumed to reach before a worker can
 * answer. Zero in the shipped tuning, because the end-of-slice dispatch already
 * gives the workers a slice boundary of head start; it is a knob so a bench can
 * ask the opposite question.
 */
export function planBatchPartition(headroom: number, maxPerChunk: number): WorkPartition {
  return {
    name: "plan-batch",
    partition(frontier: Frontier, slots: number): ReadonlyArray<PlanChunk> {
      if (slots <= 0) return []
      const width = frontier.roster.length
      if (width === 0) return []
      const plans = sweepFrontier(frontier)
      const tail = plans.slice(Math.max(0, headroom))
      if (tail.length === 0) return []
      // A CHUNK IS SIZED BY LATENCY, NOT BY FAIRNESS. Cutting the frontier
      // evenly across the free workers is the obvious partition and it is the
      // wrong one: a parcel is only worth anything if it comes back before the
      // slice that needs it, and at production roster sizes one price is
      // several milliseconds against a slice of a few tens. An even cut on a
      // wide frontier gives every worker a parcel that lands after the turn is
      // over. So the cut is capped, and what does not fit is simply not sent —
      // the next slice re-derives the frontier from wherever the search has
      // got to, which is a better question than the leftovers of this one.
      const per = Math.max(1, Math.min(maxPerChunk, Math.ceil(tail.length / slots)))
      const out: PlanChunk[] = []
      for (let from = 0; from < tail.length && out.length < slots; from += per) {
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
 * THE CLUSTER CUT — composed joint sub-plans, and the plan-batch cut behind it.
 *
 * ── WHY THIS IS THE ONE THAT CAN PAY ───────────────────────────────────────
 *
 * W1's own warning to this program, verbatim: *"Whatever a cluster partition
 * speculates on has to be work the coordinator has not already done, and on
 * this search that rules out anything derivable from the incumbent's one-move
 * neighbourhood."* The measured consequence was 3,344 entries offered, 0 new,
 * `entriesUsed = 0` on every row, and a monotone 1.00× → 0.59× regression with
 * worker count. Not a transport problem — a TARGET problem.
 *
 * A composed cluster joint differs from the incumbent in every unit of a
 * cluster at once. The sweep reaches it only after `maxSweeps` passes and a
 * `jointPolish` that the census says the budget usually never reaches, and the
 * two-move-and-deeper structure is exactly what makes it (a) worth a price and
 * (b) not already in the memo.
 *
 * ── WHAT DOES *NOT* MOVE TO A WORKER ───────────────────────────────────────
 *
 * The ENUMERATION. It costs µs on the surrogate; §7.3's work-unit sizing rule
 * says a dispatched unit must amortise its transport at ~100×, and transport is
 * 0.4–4.2 ms. Shipping a µs job across a ms wire is how a pool loses to a
 * single thread. The coordinator enumerates; the workers PRICE, which is the
 * ~18 ms half. That division is why this is a `WorkPartition` over the existing
 * `plan-batch` parcel rather than a second `Parcel` case.
 *
 * `headroom` is how many proposals the coordinator is assumed to reach itself
 * before a worker can answer. The proposals list handed in has already had the
 * priced prefix removed, so this is headroom on top of that.
 */
export function clusterPlanPartition(
  headroom: number,
  maxPerChunk: number,
  fallback: WorkPartition,
  minHamming = 2,
): WorkPartition {
  return {
    name: "cluster",
    partition(frontier: Frontier, slots: number): ReadonlyArray<PlanChunk> {
      if (slots <= 0) return []
      const width = frontier.roster.length
      if (width === 0) return []
      const proposals = frontier.proposals ?? []
      // SEND ONLY WHAT THE COORDINATOR WOULD ASK FOR. The offer loop drops a
      // proposal within `minHamming` of the incumbent — the sweep reaches it
      // anyway — so dispatching one burns a worker on an entry nobody will
      // look up. Applied here as well as there because a parcel that comes
      // back for a plan the coordinator never prices is `entriesUsed = 0`,
      // which is precisely the number W1 could not move.
      const worth = proposals.filter(
        (plan) => distance(plan, frontier.incumbent.plan, minHamming) >= minHamming,
      )
      const codes = encodeProposals(frontier, worth.slice(Math.max(0, headroom)))
      if (codes.length === 0) return fallback.partition(frontier, slots)
      const per = Math.max(1, Math.min(maxPerChunk, Math.ceil(codes.length / slots)))
      const out: PlanChunk[] = []
      for (let from = 0; from < codes.length && out.length < slots; from += per) {
        const take = codes.slice(from, Math.min(codes.length, from + per))
        const flat = new Int32Array(take.length * width)
        for (let i = 0; i < take.length; i++) flat.set(take[i] as Int32Array, i * width)
        out.push({ codes: flat, count: take.length })
      }
      // A short proposal list leaves free workers. Fill them from the sweep
      // frontier — the shipped cut, which is worth little but is not worth
      // nothing, and an idle worker is worth exactly nothing.
      if (out.length < slots) {
        for (const chunk of fallback.partition(frontier, slots - out.length)) out.push(chunk)
      }
      return out
    },
  }
}

/** How many units two plans disagree on, stopping once `enough` is reached. */
function distance(a: JointPlan, b: JointPlan, enough: number): number {
  let n = 0
  for (const [unitId, candidate] of a) {
    const other = b.get(unitId)
    if (other === candidate) continue
    if (
      other !== undefined &&
      other.to === candidate.to &&
      other.path.length === candidate.path.length &&
      other.path.every((cell, i) => cell === candidate.path[i])
    ) {
      continue
    }
    if (++n >= enough) return n
  }
  return n
}

/**
 * Proposals as candidate-index vectors over the roster's own order.
 *
 * A proposal naming a candidate the worker's catalogue cannot decode is
 * DROPPED, exactly as the sweep frontier drops one: sending a plan that is not
 * the plan burns a worker on entries nobody can look up.
 */
function encodeProposals(
  frontier: Frontier,
  proposals: ReadonlyArray<JointPlan>,
): ReadonlyArray<Int32Array> {
  const { roster, sets } = frontier
  const out: Int32Array[] = []
  for (const plan of proposals) {
    const codes = new Int32Array(roster.length)
    let ok = true
    for (let i = 0; i < roster.length; i++) {
      const unitId = roster[i] as UnitId
      const set = sets.get(unitId)
      const chosen = plan.get(unitId)
      if (set === undefined || chosen === undefined) {
        ok = false
        break
      }
      const code = encodeCandidate(set, chosen)
      if (code === UNENCODABLE) {
        ok = false
        break
      }
      codes[i] = code
    }
    if (ok) out.push(codes)
  }
  return out
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
  const order = frontier.order
  for (const unitId of order?.units ?? dangerOrder(roster, incumbent.worstResolution, pinned)) {
    const slot = roster.indexOf(unitId)
    if (slot < 0) continue
    const set = sets.get(unitId)
    if (set === undefined) continue
    const current = base[slot] as number
    for (const candidate of order?.candidatesFor(unitId) ??
      topCandidates(set.candidates, candidateCap)) {
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
