/**
 * HOW MANY EVALUATION WORKERS a team-decision engine owns — `BotConfig.workers`.
 *
 *   "off"            → no pool at all: today's single-threaded path, bit for
 *                      bit, with none of the plumbing constructed. THE SHIPPED
 *                      DEFAULT, and see below for why it is not "auto".
 *   "auto" / "on"    → `min(cores - 1, 3)`.
 *   N                → exactly N, clamped to [0, 8].
 *
 * DEPLOYMENT CONFIG, NOT STRATEGY, and that is why it survived the flag
 * teardown as a config field rather than as a deleted switch. It changes how
 * fast the same decision is reached and never which decision that is (the
 * pool-0 bit-identity gate and the pool-N determinism gate are the same
 * statement — see below), so it is judged by BENCHMARKS on branches, which is
 * the mandate's disposition for every perf question. `CENTAUR_WORKERS` and
 * `CENTAUR_WORKERS_AUDIT` are gone; a bot names its worker count as data.
 *
 * `off` and `0` are the same NUMBER and deliberately different WORDS: `off`
 * says "do not build a pool", `0` says "build the plumbing and never dispatch".
 * They run the same code path in the search — a pool of size zero never
 * dispatches and never folds — which is what makes the pool-0 bit-identity
 * gate and the pool-N determinism gate the same statement.
 *
 * ── WHY THE DEFAULT IS OFF, AGAINST THE INTENT THIS WAS BUILT TO ──────────
 *
 * This subsystem was commissioned DEFAULT ON, on the strength of a prototype
 * that measured 1.45-1.72x at two workers. That measurement is real and it
 * reproduces: pricing 1 500 INDEPENDENT plans in parallel really is that much
 * faster. What it does not model is that the production search never has 1 500
 * independent plans to price.
 *
 * Measured on this tree (see `perf-w1-report.md`), on replayed decisions at
 * 150 ms and 1 s:
 *
 *   · 94-99% of branch evaluations are already served by the P0 EVALUATION
 *     MEMO. Only 0.9-5.6% are fresh work, and that is the entire ceiling on
 *     what any evaluator-offload can save.
 *   · Of the entries the workers computed and sent back, 0-1.3% were new to
 *     the coordinator — 3 344 offered / 0 new on one board, 4 748 / 64 on
 *     another. The coordinate-ascent sweep, once converged, has by
 *     construction already priced the whole one-move neighbourhood of its
 *     incumbent, which is exactly what a speculative evaluator would predict.
 *   · The cost is not zero: at two and three workers the coordinator measured
 *     0.77-0.83x on a four-core box, entirely from contention.
 *
 * So the DEFAULT IS OFF — the benchmark-winning setting, which is the whole
 * disposition a perf variant gets. The machinery ships whole and REACHABLE FROM
 * DATA rather than from an environment variable: every gate that guards it
 * passes at pool 1, 2 and 3, and a bench that wants to re-open the question
 * hands one seat a `BotConfig` with `workers: "auto"` instead of exporting
 * something.
 *
 * WHY THE POOL WAS KEPT AT ALL, decided and recorded during the teardown. The
 * measurement is a rejection of the PREMISE (perf-w1-report §8: the prototype
 * parallelised evaluator work P0's evaluation memo had already removed; 94-99%
 * of branch evaluations are memo hits; 3 344 entries offered, 0 new), and a
 * rejected premise would ordinarily mean deleted code. Two things stop that
 * here. First, this is DEPLOYMENT config and not a strategy entry — it cannot
 * change a bound, so it is not a dark strategy path accumulating in the search.
 * Second, the report's own cluster-partition seam (§7) is one function
 * (`WorkPartition`) and the rest of the subsystem — spawn/reuse/shutdown, the
 * board push, epoch keying, the fold — is provenance-agnostic and already
 * gated. What that seam needs before it can pay is the interaction graph and
 * two-move-and-deeper sub-plans, i.e. the depth work; the pool is the thing
 * that would consume it, not the thing that is waiting on itself.
 *
 * Per ENGINE, not per process: the thing that has to be measurable is one SEAT
 * against unchanged opponents, and a process-wide setting moves every lobster
 * seat on the board at once.
 */

import { cpus } from "os"

/** The most workers this build will ever spawn from one engine. */
export const MAX_POOL = 8

/** `off`, or a worker count. `"auto"` is resolved against the box. */
export type WorkerSetting = "off" | "auto" | number

/**
 * The default: one worker per spare core, never more than three.
 *
 * Three because the prototype measured turnover at four on a four-core box —
 * 1.45–1.72× at two workers, 1.42–1.43× at three, and 0.95–1.50× at four with
 * transport cost jumping 0.4 ms → 2.4–4.2 ms as the coordinator lost its own
 * core. `cores - 1` leaves the main thread — which still owns every engine
 * resolution, the whole slice loop, and the wire — a core of its own.
 */
export function autoPoolSize(cores = cpus().length): number {
  if (!Number.isFinite(cores) || cores <= 1) return 0
  return Math.max(0, Math.min(cores - 1, 3))
}

/**
 * Normalise a config value. Junk is refused loudly and treated as `off` — the
 * safe side is the one that changes nothing.
 *
 * Still text-tolerant because a `BotConfig` arrives as JSON from a contender
 * file, where `"auto"` and `3` are both natural ways to write this.
 */
export function parseWorkerSetting(
  raw: string | number | undefined,
  warn?: (message: string) => void,
): WorkerSetting {
  const text = String(raw ?? "").trim().toLowerCase()
  if (text === "") return "off"
  if (text === "auto" || text === "on") return "auto"
  if (text === "off" || text === "no" || text === "false" || text === "default") return "off"
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0 || n > MAX_POOL) {
    warn?.(
      `[lobster/parallel] workers=${String(raw)} is not "off", "auto" or an ` +
        `integer 0..${MAX_POOL} — using off`,
    )
    return "off"
  }
  return n
}

/** The resolved worker count for one engine. `off` resolves to 0 as well; the
 * caller keeps the two apart by asking `parseWorkerSetting` itself. */
export function resolveWorkerCount(
  setting: WorkerSetting,
  cores = cpus().length,
): number {
  if (setting === "off") return 0
  if (setting === "auto") return autoPoolSize(cores)
  return Math.max(0, Math.min(MAX_POOL, setting))
}

/**
 * AUDIT MODE. Every evaluation a worker supplies is recomputed on the main
 * thread the first time it is read, and a disagreement THROWS.
 *
 * This is the only check that can catch the one divergence the memo key cannot
 * express — two substrates built from the same `BoardSpec` that do not resolve
 * or score identically. It roughly doubles the evaluator's work, so it is a
 * test and soak instrument, never a production default: `BotConfig.workersAudit`
 * is false, and the suites that need it pass true.
 */
export const DEFAULT_WORKERS: WorkerSetting = "off"
export const DEFAULT_WORKERS_AUDIT = false
