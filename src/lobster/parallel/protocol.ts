/**
 * THE MAIN↔WORKER PROTOCOL — what crosses the thread boundary, and why none of
 * it can change an answer.
 *
 * ── WHAT A WORKER IS ──────────────────────────────────────────────────────
 *
 * A PURE EVALUATOR. It never stages, never owns budget policy, never touches
 * the ratchet, never sees a pin, and its output is never published as a bound.
 * The only thing a worker produces is entries for the main bank's EVALUATION
 * MEMO (`bounds/evalmemo.ts`) — a cache whose value is a pure function of its
 * key. The kernel's anytime slice loop stays on the main thread and remains
 * the sole stager, exactly as before.
 *
 * ── WHY A WRONG WORKER CANNOT PUBLISH A WRONG NUMBER ──────────────────────
 *
 * The eval memo key is
 *
 *     `${evaluatorIdentity}|${basisKey}|${asTeam}` | viewKey | planKey
 *
 * and EVERY dimension along which a worker could disagree with the main thread
 * is *inside that key*:
 *
 *   · a different evaluator or criterion profile  → different evaluatorIdentity
 *   · a different basis (pins, references, posture) → different basisKey
 *   · a different frame                            → different asTeam
 *   · a different modelled set for the branch      → different viewKey
 *   · a different plan — including a MIS-DECODED one, because the codec's
 *     indices are resolved against the worker's own candidate lists — →
 *     different planKey (planKey is over (unitId, to, path), not over indices)
 *
 * So a worker that has drifted in any of those respects produces keys the main
 * thread never looks up. Its entries are INERT, not wrong. The catalogue
 * digest below is therefore a PERFORMANCE guard (it tells the pool to stop
 * wasting workers), never a soundness guard.
 *
 * The one residual dependency is that the worker's `EngineSubstrate`, built
 * from the same `BoardSpec`, resolves and scores identically to the main
 * thread's. That is a determinism property of `makeSubstrate` + the evaluator,
 * and it is what `parallel/determinism.test.ts` and the `CENTAUR_WORKERS_AUDIT`
 * mode exist to pin.
 *
 * ── TRANSPORT ─────────────────────────────────────────────────────────────
 *
 * Plans travel as a flat `Int32Array` of candidate indices — 4 bytes per
 * commandable unit, transferred, not cloned. Bounds come back as a transferred
 * `Float64Array` of (lo, est, hi) triples and telemetry as a transferred
 * `Int32Array`. The memo KEYS come back as one concatenated string cut by a
 * transferred length table — the one part of the transport that is a clone
 * rather than a transfer, and the one this build actually measured.
 */

import type { Board as ApiBoard } from "../../types/battlesnake"
import type { Assumption, Candidate, CandidateSet, UnitId } from "../contracts"
import type { CandidateKnobs } from "../candidates"
import type { BankConfig } from "../bounds"
import type { CriterionProfile } from "../evaluate"

// ------------------------------------------------------------------- codec

/**
 * A candidate index that no catalogue can produce, meaning "this plan is not
 * encodable" — a plan carrying a candidate that is in neither `candidates` nor
 * `prunedLedger` (a hand-built reference action, say). Such a plan is dropped
 * from the parcel rather than approximated: a speculative evaluation of the
 * WRONG plan is inert (its planKey differs) but it is also wasted, and the
 * honest thing is not to send it.
 */
export const UNENCODABLE = -1

/** `prunedLedger[j]` encodes as `PRUNED_BASE - j`, so -2 is the first. */
const PRUNED_BASE = -2

/** Index of `candidate` inside `set`, or `UNENCODABLE`. */
export function encodeCandidate(set: CandidateSet, candidate: Candidate): number {
  const list = set.candidates
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as Candidate
    if (c === candidate) return i
    if (c.to === candidate.to && samePath(c, candidate)) return i
  }
  const pruned = set.prunedLedger
  for (let j = 0; j < pruned.length; j++) {
    const c = (pruned[j] as { candidate: Candidate }).candidate
    if (c.to === candidate.to && samePath(c, candidate)) return PRUNED_BASE - j
  }
  return UNENCODABLE
}

/** The inverse, resolved against the DECODER's own catalogue. */
export function decodeCandidate(set: CandidateSet, code: number): Candidate | null {
  if (code >= 0) return (set.candidates[code] as Candidate | undefined) ?? null
  if (code === UNENCODABLE) return null
  const j = PRUNED_BASE - code
  return (set.prunedLedger[j] as { candidate: Candidate } | undefined)?.candidate ?? null
}

function samePath(a: Candidate, b: Candidate): boolean {
  if (a.path.length !== b.path.length) return false
  for (let i = 0; i < a.path.length; i++) if (a.path[i] !== b.path[i]) return false
  return true
}

/**
 * A digest of one side's candidate catalogue.
 *
 * Two independent FNV-1a streams over `unitId>to#path` for every offered
 * candidate of every roster unit, in roster order. A mismatch says the two
 * sides would decode the same index to different moves, so every parcel would
 * come back inert; the pool stops dispatching for that session rather than
 * burning workers on entries nobody can look up.
 */
export function catalogueDigest(
  roster: ReadonlyArray<UnitId>,
  sets: ReadonlyMap<UnitId, CandidateSet>,
): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
      h2 = Math.imul(h2 + c + 1, 0x85ebca6b) >>> 0
    }
  }
  for (const unitId of roster) {
    const set = sets.get(unitId)
    mix(`#${unitId}/${set === undefined ? "-" : set.candidates.length}:`)
    if (set === undefined) continue
    for (const c of set.candidates) mix(`${c.unitId}>${c.to}#${c.path.join(".")};`)
  }
  return `${h1.toString(16)}${h2.toString(16)}`
}

// ------------------------------------------------------------------ messages

/**
 * Everything a worker needs to rebuild the DECISION'S SUBSTRATE. Pushed once
 * per board — a worker builds its `EngineSubstrate` once and reuses it for
 * every parcel of that board, which is the whole point of the board-push
 * overlap (the prototype measured 33–132 ms per per-worker substrate build).
 *
 * Every field is a structured-clone-safe mirror of `SubstrateOptions`. `epoch`
 * is monotone per pool: a parcel naming an older epoch is stale by
 * construction and is dropped without being priced.
 */
export interface BoardSpec {
  readonly epoch: number
  readonly gameId: string
  readonly turn: number
  readonly board: ApiBoard
  readonly asTeamId: string
  readonly modeled: ReadonlyArray<string>
  /** `SubstrateOptions.observedTurns` as entries — Maps clone, but entries are
   * cheaper and make the message shape inspectable in a test. */
  readonly observedTurns: ReadonlyArray<readonly [string, number]>
}

/**
 * How a worker rebuilds ITS evaluator.
 *
 * `profile` is the only supported form and it is checked, not assumed: the
 * pool accepts a `BoundEvaluator` running the module's own `FEATURES` list and
 * refuses anything else, because a custom feature list would score differently
 * under an IDENTICAL `evaluationIdentity` — the one divergence the key cannot
 * catch. An unsupported evaluator degrades the pool to inline, loudly.
 */
export type EvaluatorSpec =
  | { readonly kind: "profile"; readonly profile: CriterionProfile }
  | { readonly kind: "unsupported"; readonly why: string }

/**
 * One decision context (one BASIS) as a worker sees it. Opened when the search
 * opens its own session for that basis; a worker keeps a small LRU of them,
 * sized like the search's own `sessionCacheSize`.
 */
export interface SessionSpec {
  readonly sessionId: number
  readonly boardEpoch: number
  readonly asTeam: number
  /** Fully resolved on the main thread — staging-safety knobs already folded
   * in — so a worker never resolves the level for itself. */
  readonly knobs: CandidateKnobs
  readonly evaluator: EvaluatorSpec
  readonly basis: ReadonlyArray<Assumption>
  readonly bankConfig: Partial<BankConfig>
  /** The commandable roster in the search's own canonical (ascending) order.
   * Plan codes are positional against THIS. */
  readonly roster: ReadonlyArray<UnitId>
  readonly catalogueDigest: string
}

/**
 * A UNIT OF SPECULATIVE WORK — the seam the cluster-lookahead program will
 * extend.
 *
 * Today there is exactly one kind: `plan-batch`, a contiguous slice of the
 * search's own sweep frontier. The cluster program's parcel ("evaluate every
 * local joint sub-plan of THIS cluster of interacting units") is a second case
 * of this union and a second `case` in the worker's dispatch — it changes
 * neither the transport, the pool, the session lifecycle, the fold, nor the
 * determinism argument, because all of those are stated over `ParcelResult`
 * (a bag of memo entries) rather than over what produced it.
 */
export type Parcel = PlanBatchParcel

/**
 * A witness as it crosses the boundary: the double oracle's memory, in plain
 * data.
 *
 * WHY THIS IS ON THE PARCEL AND NOT THE SESSION, and why it goes one way only.
 * The bank's B2 rung prices every plan against every banked witness, so a
 * witness admitted at slice k makes a FRESH branch of every plan re-priced
 * after it — and on the measured boards that is where essentially all of the
 * remaining fresh evaluator work is (0.9-5.6% of branch evaluations are fresh;
 * the rest the evaluation memo already serves). A worker that does not know the
 * coordinator's witnesses computes a different B2 set and its answers are
 * correct, complete and never asked for.
 *
 * It travels DOWN only. A worker's own witnesses are never adopted by the main
 * bank: they would change WHICH branches it prices, and the answer would then
 * depend on how many workers were running. Speculation may fill a cache; it may
 * not join the search.
 */
export interface WitnessWire {
  readonly note: string
  readonly replies: ReadonlyArray<Candidate>
}

export interface PlanBatchParcel {
  readonly kind: "plan-batch"
  readonly sessionId: number
  readonly boardEpoch: number
  /** Monotone per session; the fold orders results by it. */
  readonly seq: number
  /** How long the worker may spend on this parcel before returning what it
   * has. Set by the MAIN thread, which is the only place budget policy lives. */
  readonly budgetMs: number
  readonly count: number
  /** `count * roster.length` candidate indices, transferred. */
  readonly codes: Int32Array
  /** The coordinator's witness set at dispatch. See `WitnessWire`. */
  readonly witnesses: ReadonlyArray<WitnessWire>
}

/**
 * THE LIVE-EPOCH TABLE — the one thing that is SHARED rather than sent.
 *
 * A worker prices plans in a synchronous loop, so no message can reach it
 * while a parcel is running: a `drop-board` posted the instant a turn ends
 * sits in the queue until the parcel it would have cancelled has finished.
 * Measured, and it is not a rounding error — on the 13x13 bench board at a
 * 150 ms budget the workers spent 3.0 s of CPU across 12 decisions whose
 * combined wall time was 1.3 s, all of it on turns that had already resolved,
 * all of it stealing cores from the coordinator. Three workers came out at
 * 0.88x for exactly that reason.
 *
 * So the live board epochs live in a `SharedArrayBuffer` the coordinator
 * writes and every worker reads with `Atomics.load` between plans. It is the
 * only shared memory in the subsystem and it carries no game state — just
 * "which turns still exist" — which is why it can be read without a lock and
 * acted on without a protocol.
 */
export const EPOCH_SLOTS = 8

/**
 * Telemetry slots inside `ParcelResult.counters`.
 *
 * A plain frozen record rather than a `const enum`: the worker entry is loaded
 * by two different toolchains (tsc's CommonJS output in production, ts-jest's
 * per-file transpile under test) and a `const enum` is the one construct whose
 * meaning differs between them.
 */
export const Counter = {
  /** Plans the worker actually priced before its budget ran out. */
  PlansPriced: 0,
  /** Engine resolutions the worker's own memo could not serve. */
  Resolutions: 1,
  /** Entries dropped because the parcel's entry cap was reached. */
  Truncated: 2,
  /** Whole milliseconds the worker was busy on this parcel. */
  BusyMs: 3,
  /** 1 when the worker stopped because its board stopped being live. */
  Abandoned: 4,
  Size: 5,
} as const

export interface ParcelResult {
  readonly kind: "parcel-result"
  readonly workerId: number
  readonly sessionId: number
  readonly boardEpoch: number
  readonly seq: number
  /**
   * Evaluation-memo keys, CONCATENATED — not joined on a separator.
   *
   * A separator would have to be a character no key can contain, and one half
   * of a key is `structuralIdentity(profile)`, which carries a caller-supplied
   * profile NAME. Rather than assert something about a string this layer does
   * not own, the lengths ride alongside in `keyLengths` and the blob is cut by
   * arithmetic. Unambiguous for every possible profile name, and it keeps the
   * whole key set to ONE structured clone instead of thousands.
   */
  readonly keys: string
  /** Character length of each key, in order. Transferred. */
  readonly keyLengths: Int32Array
  /** Three floats — lo, est, hi — per key, in the same order. */
  readonly bounds: Float64Array
  readonly counters: Int32Array
}

/** Cut a `ParcelResult`'s key blob back into keys. */
export function* decodeKeys(
  keys: string,
  keyLengths: Int32Array,
): Generator<string, void, undefined> {
  let at = 0
  for (let i = 0; i < keyLengths.length; i++) {
    const n = keyLengths[i] as number
    yield keys.slice(at, at + n)
    at += n
  }
}

/** A worker reporting that it cannot serve this session at all. */
export interface ParcelRefusal {
  readonly kind: "parcel-refusal"
  readonly workerId: number
  readonly sessionId: number
  readonly seq: number
  readonly reason: "catalogue-mismatch" | "stale-board" | "no-session" | "threw"
  readonly detail: string
}

export interface WorkerReady {
  readonly kind: "ready"
  readonly workerId: number
  /** Milliseconds the worker spent building its substrate for the last board.
   * The cost the board-push overlap exists to hide. */
  readonly setupMs: number
  readonly boardEpoch: number
}

export type ToWorker =
  | { readonly kind: "board"; readonly spec: BoardSpec }
  | { readonly kind: "drop-board"; readonly epoch: number }
  | { readonly kind: "session"; readonly spec: SessionSpec }
  | { readonly kind: "parcel"; readonly parcel: Parcel }
  | { readonly kind: "stop" }

export type FromWorker = WorkerReady | ParcelResult | ParcelRefusal
