/**
 * CENTAUR_WORKERS — how many evaluation workers a team-decision engine owns.
 *
 *   unset / "auto"   → `min(cores - 1, 3)`, the shipped default. ON.
 *   "off" / "0"      → no pool at all: today's single-threaded path, bit for
 *                      bit, with none of the plumbing constructed.
 *   "N"              → exactly N, clamped to [0, 8].
 *
 * `off` and `0` are the same NUMBER and deliberately different WORDS: `off`
 * says "do not build a pool", `0` says "build the plumbing and never dispatch".
 * They run the same code path in the search — a pool of size zero never
 * dispatches and never folds — which is what makes the pool-0 bit-identity
 * gate and the pool-N determinism gate the same statement.
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

/** Parse the flag's raw text. Junk is refused loudly and treated as `auto`. */
export function parseWorkerSetting(
  raw: string | undefined,
  warn?: (message: string) => void,
): WorkerSetting {
  const text = String(raw ?? "").trim().toLowerCase()
  if (text === "") return "auto"
  if (text === "auto" || text === "on" || text === "default") return "auto"
  if (text === "off" || text === "no" || text === "false") return "off"
  const n = Number(text)
  if (!Number.isInteger(n) || n < 0 || n > MAX_POOL) {
    warn?.(
      `[lobster/parallel] ${WORKERS_ENV}=${String(raw)} is not "off", "auto" or an ` +
        `integer 0..${MAX_POOL} — using auto`,
    )
    return "auto"
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
