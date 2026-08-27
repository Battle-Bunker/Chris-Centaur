/**
 * THE WARM WORKER POOL — owned by the team-decision engine's lifecycle.
 *
 * Spawned once at engine construction, reused across every decision of every
 * game that engine plays, shut down once. NEVER per decision: the prototype
 * measured 236–512 ms to spawn a pool and 33–132 ms per worker to build its
 * substrate, against a 150 ms decision, and a worker is ~2× slower than a warm
 * one until its own JIT catches up (0.58× at four workers on a first run). A
 * pool that is not warm is a tax, not an optimisation.
 *
 * ── WHAT THE POOL OWNS AND WHAT IT DOES NOT ───────────────────────────────
 *
 * It owns worker lifetime, the board push, session registration, in-flight
 * accounting and the fold buffer. It does NOT own: what a parcel contains
 * (`partition.ts`), what a worker does with one (`worker-entry.ts`), when one
 * is affordable (the search, from the slice budget the kernel handed it), or
 * what happens to the answer (`BoundBank.importEvaluations`). It never looks
 * inside a parcel, which is what lets the cluster-lookahead program add a
 * second parcel kind without touching this file.
 *
 * ── THE FOLD IS AT A SLICE BOUNDARY, AND THAT IS NOT A DETAIL ─────────────
 *
 * A slice is synchronous JavaScript; no worker message can be delivered while
 * one runs. Results therefore land on the event loop during the kernel's own
 * `yieldToEventLoop` between slices, and `drain()` is called at the top of the
 * next `improve()`. A parcel fired in slice N is folded before slice N+1 — or,
 * if it is late, before slice N+2 — and either way it is folded as CACHED
 * EVALUATIONS, which is what makes lateness a wall-clock event rather than an
 * answer-changing one.
 *
 * ── DEGRADATION ───────────────────────────────────────────────────────────
 *
 * Every failure mode ends at the same place: stop dispatching, keep searching.
 * A worker that dies, an evaluator the pool cannot rebuild, a candidate
 * catalogue that does not match, a board that will not serialise — all of them
 * leave the search running exactly the single-threaded path it ran before,
 * because the only thing the pool ever contributes is cache entries.
 */

import { Worker } from "worker_threads"
import type { TransferListItem } from "worker_threads"
import { existsSync } from "fs"
import { join } from "path"
import type { Bound } from "../contracts"
import type { EvalMemoStats } from "../bounds"
import {
  decodeKeys,
  type BoardSpec,
  type FromWorker,
  type Parcel,
  type ParcelResult,
  type SessionSpec,
  type ToWorker,
} from "./protocol"
import { Counter, EPOCH_SLOTS } from "./protocol"

export interface PoolStats {
  readonly size: number
  readonly boards: number
  readonly sessions: number
  readonly parcelsDispatched: number
  readonly parcelsReturned: number
  readonly parcelsRefused: number
  /** Parcels a worker stopped early because its board stopped being live —
   * the counter that says the shared epoch table is doing its job. */
  readonly parcelsAbandoned: number
  readonly plansPriced: number
  readonly entriesReturned: number
  readonly entriesTruncated: number
  /** Entries a main-thread bank actually TOOK — returned entries minus the
   * ones it had already computed for itself. */
  readonly entriesImported: number
  /**
   * Imported entries a main-thread bank later READ.
   *
   * THE ONLY HONEST MEASURE OF WHETHER SPECULATION IS PAYING. A worker that
   * prices plans the search never reaches produces entries that are perfectly
   * correct, perfectly useless, and invisible in every other counter here.
   */
  readonly entriesUsed: number
  readonly workerBusyMs: number
  /** Wall time this thread spent decoding and importing results. The honest
   * cost of parallelism on the critical path. */
  readonly foldMs: number
  readonly workerSetupMs: number
  readonly degraded: string | null
}

/**
 * What the search talks to. `InlinePool` is the size-0 implementation and is
 * the whole of "degrade gracefully to inline execution": it never dispatches,
 * never folds, and the search therefore runs the path it ran before this
 * subsystem existed.
 */
export interface EvaluationPool {
  readonly size: number
  /** True while the pool will still accept a dispatch. */
  readonly live: boolean
  /**
   * Push a board and get back the EPOCH the workers will hold it under.
   *
   * Called before the main thread builds its own substrate, so the workers'
   * 33–132 ms build overlaps with the coordinator's own.
   *
   * Several boards are live at once ON PURPOSE. A turn resolves the instant
   * every alive player commits, so turn N+1's decision starts before turn N's
   * ends (`TeamDecisionEngine.live` is turn-keyed for exactly this reason), and
   * one process plays several games at a time. A pool that held ONE board would
   * have each of those decisions evict the others' substrates and pay the
   * rebuild again — so workers keep a small LRU and the epoch is what tells
   * them which board a parcel is about.
   */
  pushBoard(spec: Omit<BoardSpec, "epoch">): number
  /** A session id no other live decision is using. */
  nextSessionId(): number
  /** Register one basis. Idempotent per `sessionId`. */
  openSession(spec: SessionSpec): void
  /** Hand a parcel to a free worker. False when none is free or the pool has
   * degraded — the caller then simply does not speculate. */
  dispatch(parcel: Parcel): boolean
  /** How many workers are idle right now. */
  readonly freeSlots: number
  /** Results that have ARRIVED for this session, in canonical (seq, workerId)
   * order. Empties this session's share of the buffer. */
  drain(sessionId: number): ReadonlyArray<readonly [string, Bound]>
  /** This decision is over: drop its board and everything keyed to it. */
  releaseBoard(epoch: number): void
  /**
   * A session closed: fold its evaluation-memo counters into the pool's, so
   * "how much did the workers actually save" is answerable without reaching
   * inside a bank that no longer exists.
   */
  noteSession(stats: EvalMemoStats): void
  readonly stats: PoolStats
  shutdown(): Promise<void>
}

// ------------------------------------------------------------------- inline

const ZERO_STATS: PoolStats = {
  size: 0,
  boards: 0,
  sessions: 0,
  parcelsDispatched: 0,
  parcelsReturned: 0,
  parcelsRefused: 0,
  parcelsAbandoned: 0,
  plansPriced: 0,
  entriesReturned: 0,
  entriesTruncated: 0,
  entriesImported: 0,
  entriesUsed: 0,
  workerBusyMs: 0,
  foldMs: 0,
  workerSetupMs: 0,
  degraded: null,
}

/** Pool size 0: the single-threaded path, with the plumbing present and inert. */
export class InlinePool implements EvaluationPool {
  readonly size = 0
  readonly live = false
  readonly freeSlots = 0
  private epoch = 0
  private session = 0
  pushBoard(): number {
    return ++this.epoch
  }
  nextSessionId(): number {
    return ++this.session
  }
  openSession(): void {
    /* nothing to open */
  }
  dispatch(): boolean {
    return false
  }
  drain(): ReadonlyArray<readonly [string, Bound]> {
    return []
  }
  releaseBoard(): void {
    /* nothing to release */
  }
  noteSession(): void {
    /* nothing to count */
  }
  get stats(): PoolStats {
    return ZERO_STATS
  }
  async shutdown(): Promise<void> {
    /* nothing to stop */
  }
}

// ------------------------------------------------------------------- workers

interface Slot {
  readonly id: number
  readonly worker: Worker
  busy: boolean
  alive: boolean
}

export interface WorkerPoolOptions {
  readonly size: number
  readonly log?: (message: string) => void
  /** Environment SNAPSHOT handed to every worker. `tier-truth.ts` resolves its
   * flag at module scope, so this is applied inside the worker before any
   * lobster module loads. A later change to `process.env` is not propagated —
   * documented, because the alternative is a pool whose workers disagree with
   * the coordinator about the rules. */
  readonly env?: NodeJS.ProcessEnv
}

export class WorkerEvaluationPool implements EvaluationPool {
  readonly size: number
  private readonly slots: Slot[] = []
  private readonly log: (message: string) => void
  private epoch = 0
  private session = 0
  /** Live board epochs, oldest first. Bounded: see `MAX_BOARDS`. */
  private boards: number[] = []
  /** The same list, in memory every worker can read between plans. See
   * `EPOCH_SLOTS` for why this is the one thing that is shared. */
  private readonly liveEpochs: Int32Array
  /** sessionId → the board epoch it was opened against. */
  private readonly openSessions = new Map<number, number>()
  private degraded: string | null = null
  private stopped = false
  /** Arrived results, not yet folded. Ordered on drain, never on arrival. */
  private inbox: ParcelResult[] = []
  private counters = {
    boards: 0,
    sessions: 0,
    dispatched: 0,
    returned: 0,
    refused: 0,
    abandoned: 0,
    plansPriced: 0,
    entries: 0,
    truncated: 0,
    busyMs: 0,
    foldMs: 0,
    setupMs: 0,
    imported: 0,
    used: 0,
  }

  constructor(options: WorkerPoolOptions) {
    this.size = Math.max(0, options.size)
    this.log = options.log ?? ((m) => console.log(m))
    this.liveEpochs = new Int32Array(new SharedArrayBuffer(EPOCH_SLOTS * 4))
    const env = { ...(options.env ?? process.env) }
    for (let id = 0; id < this.size; id++) {
      const slot = this.spawn(id, env)
      if (slot === null) {
        this.degrade(`could not spawn worker ${id}`)
        break
      }
      this.slots.push(slot)
    }
  }

  get live(): boolean {
    return !this.stopped && this.degraded === null && this.slots.some((s) => s.alive)
  }

  get freeSlots(): number {
    if (!this.live) return 0
    let n = 0
    for (const slot of this.slots) if (slot.alive && !slot.busy) n++
    return n
  }

  nextSessionId(): number {
    return ++this.session
  }

  /**
   * THE BOARD PUSH — fire and forget.
   *
   * The workers build their substrates while this thread goes on to build its
   * own and to walk the held-capacity ranking. The 33–132 ms they each spend is
   * hidden behind work the coordinator had to do anyway, which is the whole of
   * "board-push overlap".
   */
  pushBoard(spec: Omit<BoardSpec, "epoch">): number {
    const epoch = ++this.epoch
    if (!this.live) return epoch
    const full: BoardSpec = { ...spec, epoch }
    this.boards.push(epoch)
    this.counters.boards++
    for (const slot of this.slots) {
      if (!slot.alive) continue
      // A worker mid-parcel finishes it and answers for whichever board that
      // parcel named; marking the slot free here would double-book it, so busy
      // stays busy until its own message lands.
      this.send(slot, { kind: "board", spec: full })
    }
    while (this.boards.length > MAX_BOARDS) {
      const oldest = this.boards.shift()
      if (oldest === undefined) break
      this.forget(oldest)
    }
    this.publishEpochs()
    return epoch
  }

  noteSession(stats: EvalMemoStats): void {
    this.counters.imported += stats.imported
    this.counters.used += stats.importHits
  }

  releaseBoard(epoch: number): void {
    const at = this.boards.indexOf(epoch)
    if (at < 0) return
    this.boards.splice(at, 1)
    // FIRST the shared table, so a worker mid-parcel abandons it on its very
    // next plan; the `drop-board` message that follows only frees the
    // substrate, and it will not be read until the parcel has stopped anyway.
    this.publishEpochs()
    this.forget(epoch)
  }

  /** Publish the live epochs where a busy worker can see them. */
  private publishEpochs(): void {
    for (let i = 0; i < EPOCH_SLOTS; i++) {
      Atomics.store(this.liveEpochs, i, this.boards[i] ?? 0)
    }
  }

  openSession(spec: SessionSpec): void {
    if (!this.live) return
    if (!this.boards.includes(spec.boardEpoch)) return
    if (this.openSessions.has(spec.sessionId)) return
    this.openSessions.set(spec.sessionId, spec.boardEpoch)
    this.counters.sessions++
    for (const slot of this.slots) {
      if (slot.alive) this.send(slot, { kind: "session", spec })
    }
  }

  dispatch(parcel: Parcel): boolean {
    if (!this.live) return false
    if (this.openSessions.get(parcel.sessionId) !== parcel.boardEpoch) return false
    const slot = this.slots.find((s) => s.alive && !s.busy)
    if (slot === undefined) return false
    slot.busy = true
    this.counters.dispatched++
    try {
      slot.worker.postMessage({ kind: "parcel", parcel }, [
        parcel.codes.buffer as TransferListItem,
      ])
    } catch (err) {
      slot.busy = false
      this.degrade(`postMessage failed: ${String((err as Error)?.message ?? err)}`)
      return false
    }
    return true
  }

  /**
   * Fold what has arrived FOR THIS SESSION — in CANONICAL ORDER, not arrival
   * order.
   *
   * Sorting by (seq, workerId) costs nothing at these sizes and buys something
   * worth having: the memo's insertion order, and therefore which entry its
   * oldest-first eviction drops, stops depending on which worker happened to
   * answer first. The published numbers do not depend on any of that either way
   * — a value is a pure function of its key — but a subsystem whose OBSERVABLE
   * state is arrival-ordered is a subsystem nobody can write a stable test for.
   */
  drain(sessionId: number): ReadonlyArray<readonly [string, Bound]> {
    if (this.inbox.length === 0) return []
    const t0 = Date.now()
    const mine: ParcelResult[] = []
    const rest: ParcelResult[] = []
    for (const result of this.inbox) {
      if (result.sessionId === sessionId) mine.push(result)
      else rest.push(result)
    }
    this.inbox = rest
    if (mine.length === 0) return []
    mine.sort((a, b) => a.seq - b.seq || a.workerId - b.workerId)
    const out: Array<readonly [string, Bound]> = []
    for (const result of mine) {
      let i = 0
      for (const key of decodeKeys(result.keys, result.keyLengths)) {
        out.push([
          key,
          {
            lo: result.bounds[i * 3] as number,
            est: result.bounds[i * 3 + 1] as number,
            hi: result.bounds[i * 3 + 2] as number,
          },
        ])
        i++
      }
    }
    this.counters.foldMs += Date.now() - t0
    return out
  }

  get stats(): PoolStats {
    return {
      size: this.size,
      boards: this.counters.boards,
      sessions: this.counters.sessions,
      parcelsDispatched: this.counters.dispatched,
      parcelsReturned: this.counters.returned,
      parcelsRefused: this.counters.refused,
      parcelsAbandoned: this.counters.abandoned,
      plansPriced: this.counters.plansPriced,
      entriesReturned: this.counters.entries,
      entriesTruncated: this.counters.truncated,
      entriesImported: this.counters.imported,
      entriesUsed: this.counters.used,
      workerBusyMs: this.counters.busyMs,
      foldMs: this.counters.foldMs,
      workerSetupMs: this.counters.setupMs,
      degraded: this.degraded,
    }
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.inbox = []
    this.boards = []
    this.publishEpochs()
    this.openSessions.clear()
    await Promise.all(
      this.slots.map(async (slot) => {
        if (!slot.alive) return
        slot.alive = false
        try {
          slot.worker.postMessage({ kind: "stop" })
        } catch {
          /* already gone */
        }
        await slot.worker.terminate()
      }),
    )
    this.slots.length = 0
  }

  // ------------------------------------------------------------- internals

  /** Drop a board and everything keyed to it, here and on every worker. */
  private forget(epoch: number): void {
    for (const [sessionId, e] of [...this.openSessions]) {
      if (e === epoch) this.openSessions.delete(sessionId)
    }
    this.inbox = this.inbox.filter((r) => r.boardEpoch !== epoch)
    for (const slot of this.slots) {
      if (slot.alive) this.send(slot, { kind: "drop-board", epoch })
    }
  }

  private spawn(id: number, env: NodeJS.ProcessEnv): Slot | null {
    try {
      const worker = new Worker(
        ...workerArgs({ workerId: id, env, liveEpochs: this.liveEpochs.buffer }),
      )
      // An unref'd worker never holds the process open — a pool the caller
      // forgot to shut down must not turn a CLI into a hang.
      worker.unref()
      const slot: Slot = { id, worker, busy: false, alive: true }
      worker.on("message", (message: FromWorker) => this.receive(slot, message))
      worker.on("error", (err: Error) => {
        slot.alive = false
        slot.busy = false
        this.log(`[lobster/parallel] worker ${id} died: ${err.message}`)
        if (!this.slots.some((s) => s.alive)) this.degrade("every worker died")
      })
      worker.on("exit", () => {
        slot.alive = false
        slot.busy = false
      })
      return slot
    } catch (err) {
      this.log(`[lobster/parallel] worker ${id} would not spawn: ${String(err)}`)
      return null
    }
  }

  private receive(slot: Slot, message: FromWorker): void {
    switch (message.kind) {
      case "ready":
        this.counters.setupMs = Math.max(this.counters.setupMs, Math.round(message.setupMs))
        return
      case "parcel-refusal":
        slot.busy = false
        this.counters.refused++
        // A catalogue mismatch means every future parcel of this session is
        // inert. It is the one refusal that is a statement about the POOL
        // rather than about one parcel, so it degrades rather than being
        // counted and forgotten.
        if (message.reason === "catalogue-mismatch") {
          this.degrade(`catalogue mismatch on worker ${message.workerId}: ${message.detail}`)
        } else if (message.reason === "threw") {
          this.log(
            `[lobster/parallel] worker ${message.workerId} threw pricing a speculative ` +
              `plan (the search is unaffected): ${message.detail}`,
          )
        }
        return
      case "parcel-result":
        slot.busy = false
        this.counters.returned++
        this.counters.plansPriced += message.counters[Counter.PlansPriced] as number
        this.counters.entries += message.keyLengths.length
        this.counters.truncated += message.counters[Counter.Truncated] as number
        this.counters.busyMs += message.counters[Counter.BusyMs] as number
        if ((message.counters[Counter.Abandoned] as number) !== 0) this.counters.abandoned++
        if (this.boards.includes(message.boardEpoch) && message.keyLengths.length > 0) {
          this.inbox.push(message)
          // A decision that ended without draining must not grow the inbox for
          // the life of the process. The cap is generous — a decision drains
          // every slice — and dropping the OLDEST is dropping the staleest.
          while (this.inbox.length > MAX_INBOX) this.inbox.shift()
        }
        return
      default:
        return
    }
  }

  private send(slot: Slot, message: ToWorker): void {
    try {
      slot.worker.postMessage(message)
    } catch (err) {
      this.degrade(`postMessage failed: ${String((err as Error)?.message ?? err)}`)
    }
  }

  private degrade(why: string): void {
    if (this.degraded !== null) return
    this.degraded = why
    this.inbox = []
    this.log(
      `[lobster/parallel] pool degraded to inline execution (${why}). The search is ` +
        `unaffected: a worker only ever supplies cached evaluations.`,
    )
  }
}

/**
 * How many boards a worker holds at once.
 *
 * Two overlapping turns of one game plus a second game is the shape this is
 * sized for. Each board is a whole `EngineSubstrate` — its own slab arena and
 * cloud-source cache — so this is a memory ceiling as much as a hit rate, and
 * exceeding it costs a rebuild rather than an answer.
 */
const MAX_BOARDS = 4

/** Results held for a session that never drained them. */
const MAX_INBOX = 64

/**
 * How to load the worker entry from wherever this module is running.
 *
 * PRODUCTION is `tsc` output: `dist/lobster/parallel/worker-entry.js` sits next
 * to this file's own output, and that is the whole of it.
 *
 * UNDER TEST it is ts-jest or ts-node, where only the `.ts` exists — so the
 * worker is booted from a short eval that registers the transpiler and requires
 * the source. That bootstrap also has to re-create ONE thing jest does for the
 * main thread and cannot do for a worker: `jest.config.js`'s
 * `'^(\\.{1,2}/.*)\\.js$'` mapper. `src/partial-engine/**` is vendored from an
 * ESM package, so its internal imports carry the `.js` extension ESM requires
 * (`./bitgrid.js` for `bitgrid.ts`); tsc resolves that natively and Node's CJS
 * resolver does not. Dropping the extension on a miss hands the request back to
 * the normal search, which finds the `.ts` — and a real `.js` still wins first,
 * because the fallback only runs after the original request has failed.
 *
 * Both forms hand the worker the same `workerData`; nothing downstream knows
 * which one it came from.
 */
export function workerArgs(
  workerData: unknown,
): [string | URL, { workerData: unknown; eval?: boolean }] {
  const compiled = join(__dirname, "worker-entry.js")
  if (existsSync(compiled)) return [compiled, { workerData }]
  const source = join(__dirname, "worker-entry.ts")
  const bootstrap = [
    `const Module = require("module");`,
    `const resolve = Module._resolveFilename;`,
    `Module._resolveFilename = function (request, ...rest) {`,
    `  try { return resolve.call(this, request, ...rest); } catch (err) {`,
    `    if (/^[.][.]?[/]/.test(request) && request.endsWith(".js")) {`,
    `      return resolve.call(this, request.slice(0, -3), ...rest);`,
    `    }`,
    `    throw err;`,
    `  }`,
    `};`,
    `require(${JSON.stringify(require.resolve("ts-node"))}).register({ transpileOnly: true });`,
    `require(${JSON.stringify(source)});`,
  ].join("\n")
  return [bootstrap, { workerData, eval: true }]
}
