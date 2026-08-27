/**
 * CENTAUR_WORKERS — how many evaluation workers a team-decision engine owns.
 *
 *   unset / "off"    → no pool at all: today's single-threaded path, bit for
 *                      bit, with none of the plumbing constructed. THE SHIPPED
 *                      DEFAULT, and see below for why it is not "auto".
 *   "auto" / "on"    → `min(cores - 1, 3)`.
 *   "N"              → exactly N, clamped to [0, 8].
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
 * So the flag ships OFF, the machinery ships whole and gated, and the report
 * names the two things that would make it pay. Turning it on is this one
 * word, and every gate that guards it already passes at pool 1, 2 and 3.
 *
 * Read per ENGINE, not per process: the thing that has to be measurable is one
 * SEAT against unchanged opponents, and a process-wide flag moves every lobster
 * seat on the board at once. `TeamDecisionOptions.workers` overrides the
 * environment for one engine, exactly as `stagingSafety` does.
 */

import { cpus } from "os"

export const WORKERS_ENV = "CENTAUR_WORKERS"
export const WORKERS_AUDIT_ENV = "CENTAUR_WORKERS_AUDIT"

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

/** Parse the flag's raw text. Junk is refused loudly and treated as `off` —
 * the safe side is the one that changes nothing. */
export function parseWorkerSetting(
  raw: string | undefined,
  warn?: (message: string) => void,
): WorkerSetting {
  const text = String(raw ?? "").trim().toLowerCase()
  if (text === "") return "off"
  if (text === "auto" || text === "on") return "auto"
  if (text === "off" || text === "no" || text === "false" || text === "default") return "off"
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0 || n > MAX_POOL) {
    warn?.(
      `[lobster/parallel] ${WORKERS_ENV}=${String(raw)} is not "off", "auto" or an ` +
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
 * test and soak instrument, never a production default.
 */
export function auditFrom(env: NodeJS.ProcessEnv): boolean {
  const raw = String(env[WORKERS_AUDIT_ENV] ?? "").trim().toLowerCase()
  return raw !== "" && raw !== "0" && raw !== "off" && raw !== "false"
}
