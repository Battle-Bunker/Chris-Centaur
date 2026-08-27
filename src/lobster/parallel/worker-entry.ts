/**
 * ONE EVALUATION WORKER — a pure evaluator, and nothing else.
 *
 * It owns its own `EngineSubstrate` (its own slab arena, its own cloud-source
 * cache, its own geometry), its own generator and its own `BoundBank`, all
 * built from the `BoardSpec` and `SessionSpec` the coordinator pushed. Nothing
 * is shared with the main thread and nothing needs to be: per-worker state is
 * exactly what makes candidate evaluation embarrassingly parallel.
 *
 * WHAT IT RETURNS is the delta of its own EVALUATION MEMO — (key, lo, est, hi)
 * for every branch evaluation its pricing produced. Not a bound, not a plan,
 * not a witness, not a ledger, not a staged set. See `protocol.ts` for why that
 * makes a divergent worker inert rather than wrong.
 *
 * WHAT IT NEVER DOES: stage, hold budget policy (its per-parcel deadline is set
 * by the main thread and it stops when the main thread's number says so), read
 * `CENTAUR_STAGING_SAFETY` (the resolved knobs arrive on the session spec),
 * publish a witness, or touch a pin.
 *
 * ENV. `process.env` is a snapshot taken when the pool spawned, applied here
 * BEFORE the lobster modules load, because `tier-truth.ts` resolves its flag at
 * module scope. A mid-process env change is therefore NOT seen by a live pool;
 * that is documented behaviour and the reason the flags this layer cares about
 * ride on the specs instead wherever they can.
 */

import { parentPort, workerData } from "worker_threads"
import type { TransferListItem } from "worker_threads"

// The env snapshot must land before ANY lobster module loads, which is why the
// lobster modules below arrive through `require` rather than `import`: TypeScript
// hoists every `import` to the top of the emitted file, and a hoisted one would
// have `tier-truth.ts` resolve its flag against the WRONG environment. The
// `import`s that remain are type-only (erased) or `worker_threads` itself.
interface Boot {
  readonly workerId: number
  readonly env: Record<string, string | undefined>
}

const boot = workerData as Boot
if (boot !== null && boot !== undefined && boot.env !== undefined) {
  for (const [key, value] of Object.entries(boot.env)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const { makeSubstrate, releaseGeometriesFor } =
  require("../substrate") as typeof import("../substrate")
const { GrammarCandidateGenerator } =
  require("../candidates") as typeof import("../candidates")
const { BoundEvaluator } = require("../evaluate") as typeof import("../evaluate")
const { BoundBank } = require("../bounds") as typeof import("../bounds")
const { referenceActionsFrom } = require("../search/basis") as typeof import("../search/basis")
const { decodeCandidate, catalogueDigest } =
  require("./protocol") as typeof import("./protocol")
const { decodePlan } = require("./partition") as typeof import("./partition")

import type { Bound, BudgetHandle, CandidateSet, UnitId } from "../contracts"
import type { EngineSubstrate } from "../substrate"
import type { BoundBank as Bank } from "../bounds"
import type {
  BoardSpec,
  FromWorker,
  Parcel,
  SessionSpec,
  ToWorker,
} from "./protocol"
import { Counter } from "./protocol"

const now = (): number => Number(process.hrtime.bigint()) / 1e6

interface Board {
  readonly spec: BoardSpec
  readonly sub: EngineSubstrate
  readonly setupMs: number
}

interface Session {
  readonly spec: SessionSpec
  readonly bank: Bank
  readonly sets: ReadonlyMap<UnitId, CandidateSet>
  /** False when this worker's candidate catalogue does not match the
   * coordinator's, so every entry it produced would be inert. */
  readonly usable: boolean
}

/**
 * The boards this worker holds, keyed by epoch, oldest first.
 *
 * More than one because decisions overlap: turn N+1's search starts before
 * turn N's ends, and one process plays several games. The coordinator's
 * `MAX_BOARDS` is the real cap; this map only ever shrinks on its instruction,
 * so the two sides cannot disagree about which board an epoch names.
 */
const boards = new Map<number, Board>()
const sessions = new Map<number, Session>()
/** Mirrors `SearchTuning.sessionCacheSize`'s intent: a committed context and
 * its speculative companion, per live board. */
const MAX_SESSIONS = 8

function post(message: FromWorker, transfer: ArrayBufferLike[]): void {
  parentPort?.postMessage(message, transfer as unknown as readonly TransferListItem[])
}

function closeSession(sessionId: number): void {
  const s = sessions.get(sessionId)
  if (s === undefined) return
  sessions.delete(sessionId)
  s.bank.release()
}

function dropBoard(epoch: number): void {
  const held = boards.get(epoch)
  if (held === undefined) return
  for (const [sessionId, s] of [...sessions]) {
    if (s.spec.boardEpoch === epoch) closeSession(sessionId)
  }
  boards.delete(epoch)
  held.sub.release()
  // The whole game's geometry (engine + arena + cloud-source cache) is a
  // process-lifetime hold otherwise, and a worker plays every board its
  // coordinator ever sees.
  releaseGeometriesFor(held.spec.gameId)
}

function dropEverything(): void {
  for (const epoch of [...boards.keys()]) dropBoard(epoch)
}

function openBoard(spec: BoardSpec): void {
  const t0 = now()
  const sub = makeSubstrate({
    gameId: spec.gameId,
    board: spec.board,
    turn: spec.turn,
    asTeam: spec.asTeamId,
    modeled: spec.modeled,
    ...(spec.observedTurns.length > 0
      ? { observedTurns: new Map(spec.observedTurns) }
      : {}),
  })
  const setupMs = now() - t0
  boards.set(spec.epoch, { spec, sub, setupMs })
  post({ kind: "ready", workerId: boot.workerId, setupMs, boardEpoch: spec.epoch }, [])
}

/** A budget that expires at an absolute local time. The DEADLINE is the main
 * thread's number; this only reads a clock against it. */
function until(endMs: number): BudgetHandle {
  const start = now()
  return {
    now,
    elapsedMs: () => now() - start,
    remainingMs: () => Math.max(0, endMs - now()),
    shouldStop: () => now() >= endMs,
  }
}

function openSession(spec: SessionSpec): void {
  const held = boards.get(spec.boardEpoch)
  if (held === undefined) return
  closeSession(spec.sessionId)
  const sub = held.sub
  const gen = new GrammarCandidateGenerator(spec.knobs)
  const sets = new Map<UnitId, CandidateSet>()
  for (const unitId of spec.roster) sets.set(unitId, gen.candidatesFor(sub, unitId))
  const usable = catalogueDigest(spec.roster, sets) === spec.catalogueDigest
  if (spec.evaluator.kind !== "profile") return
  const evaluate = new BoundEvaluator(spec.evaluator.profile)
  const references = referenceActionsFrom(sub, gen, spec.basis, sets)
  const bank = new BoundBank({
    sub,
    gen,
    evaluate,
    asTeam: spec.asTeam,
    // Replaced per parcel: a bank that outlives a slice must never keep a
    // captured clock, and this one outlives every parcel it serves.
    budget: until(0),
    basis: spec.basis,
    referenceActions: references,
    config: spec.bankConfig,
  })
  bank.recordEvaluations()
  sessions.set(spec.sessionId, { spec, bank, sets, usable })
  while (sessions.size > MAX_SESSIONS) {
    const oldest = sessions.keys().next()
    if (oldest.done) break
    closeSession(oldest.value)
  }
}

/** Entries a single parcel may return. Past this the answer is bigger than the
 * work it saves, and the excess is counted rather than silently dropped. */
const MAX_ENTRIES = 8192

function runParcel(parcel: Parcel): void {
  const session = sessions.get(parcel.sessionId)
  const workerId = boot.workerId
  if (!boards.has(parcel.boardEpoch)) {
    post(
      {
        kind: "parcel-refusal",
        workerId,
        sessionId: parcel.sessionId,
        seq: parcel.seq,
        reason: "stale-board",
        detail:
          `parcel is for board epoch ${parcel.boardEpoch}; this worker holds ` +
          `[${[...boards.keys()].join(", ")}]`,
      },
      [],
    )
    return
  }
  if (session === undefined) {
    post(
      { kind: "parcel-refusal", workerId, sessionId: parcel.sessionId, seq: parcel.seq, reason: "no-session", detail: "" },
      [],
    )
    return
  }
  if (!session.usable) {
    post(
      {
        kind: "parcel-refusal",
        workerId,
        sessionId: parcel.sessionId,
        seq: parcel.seq,
        reason: "catalogue-mismatch",
        detail: "this worker's candidate lists differ from the coordinator's",
      },
      [],
    )
    return
  }

  const t0 = now()
  const deadline = t0 + Math.max(0, parcel.budgetMs)
  session.bank.adoptBudget(until(deadline))
  // Drop anything left over from a parcel that was cut short: what a parcel
  // returns is what THAT parcel computed.
  session.bank.takeRecordedEvaluations()

  const roster = session.spec.roster
  const width = roster.length
  let priced = 0
  let resolutions = 0
  for (let j = 0; j < parcel.count; j++) {
    if (now() >= deadline) break
    const plan = decodePlan(roster, session.sets, parcel.codes, j * width, decodeCandidate)
    if (plan === null) continue
    try {
      resolutions += session.bank.price(plan).resolutions
    } catch (err) {
      // A worker that throws must not take the pool down, and must not be
      // silent about it either. Whatever it had computed before the throw is
      // still valid — every entry is a completed evaluation of a named world.
      post(
        {
          kind: "parcel-refusal",
          workerId,
          sessionId: parcel.sessionId,
          seq: parcel.seq,
          reason: "threw",
          detail: String((err as Error)?.message ?? err),
        },
        [],
      )
      break
    }
    priced++
  }

  const recorded = session.bank.takeRecordedEvaluations()
  const n = Math.min(recorded.length, MAX_ENTRIES)
  const keyLengths = new Int32Array(n)
  const bounds = new Float64Array(n * 3)
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    const [key, bound] = recorded[i] as readonly [string, Bound]
    parts.push(key)
    keyLengths[i] = key.length
    bounds[i * 3] = bound.lo
    bounds[i * 3 + 1] = bound.est
    bounds[i * 3 + 2] = bound.hi
  }
  const counters = new Int32Array(Counter.Size)
  counters[Counter.PlansPriced] = priced
  counters[Counter.Resolutions] = resolutions
  counters[Counter.Truncated] = recorded.length - n
  counters[Counter.BusyMs] = Math.round(now() - t0)
  post(
    {
      kind: "parcel-result",
      workerId,
      sessionId: parcel.sessionId,
      boardEpoch: parcel.boardEpoch,
      seq: parcel.seq,
      keys: parts.join(""),
      keyLengths,
      bounds,
      counters,
    },
    [keyLengths.buffer, bounds.buffer, counters.buffer],
  )
}

parentPort?.on("message", (message: ToWorker) => {
  switch (message.kind) {
    case "board":
      openBoard(message.spec)
      return
    case "drop-board":
      dropBoard(message.epoch)
      return
    case "session":
      openSession(message.spec)
      return
    case "parcel":
      runParcel(message.parcel)
      return
    case "stop":
      dropEverything()
      parentPort?.close()
      return
    default:
      return
  }
})
