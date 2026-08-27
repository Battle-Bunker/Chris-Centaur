/**
 * BUILDING A POOL, and refusing to build one when a worker could not be made
 * to agree with this thread.
 *
 * The refusal that matters is the EVALUATOR. Every other way the two sides can
 * disagree shows up inside the evaluation memo key and makes the worker's
 * entries inert (see `protocol.ts`); a custom FEATURE LIST does not, because
 * `BoundEvaluator.evaluationIdentity` is derived from the criterion profile
 * alone. Two evaluators with the same profile and different features would
 * therefore share a namespace and disagree about the value — the one shape of
 * divergence that could publish a wrong number. So the pool accepts exactly
 * one thing: a `BoundEvaluator` whose `features` array IS the module's own
 * `FEATURES`. Anything else degrades to inline, by name, in the log.
 */

import type { Evaluator } from "../contracts"
import { BoundEvaluator, FEATURES } from "../evaluate"
import { InlinePool, WorkerEvaluationPool, type EvaluationPool } from "./pool"
import { parseWorkerSetting, resolveWorkerCount, WORKERS_ENV } from "./config"
import type { EvaluatorSpec } from "./protocol"

/** How (or whether) a worker can rebuild this evaluator. */
export function evaluatorSpecOf(evaluate: Evaluator): EvaluatorSpec {
  if (!(evaluate instanceof BoundEvaluator)) {
    return {
      kind: "unsupported",
      why: "not a BoundEvaluator — a worker has no way to rebuild it",
    }
  }
  if (evaluate.features !== FEATURES) {
    return {
      kind: "unsupported",
      why:
        "a BoundEvaluator with a custom feature list: its evaluationIdentity is " +
        "derived from the profile alone, so a worker running the shipped features " +
        "would share a memo namespace with it and disagree about the value",
    }
  }
  return { kind: "profile", profile: evaluate.profile }
}

export interface PoolFactoryOptions {
  /** `TeamDecisionOptions.workers`, when the caller named one. */
  readonly setting?: string | number
  readonly env?: NodeJS.ProcessEnv
  readonly log?: (message: string) => void
  /** Overridable for the tests that have to assert the auto sizing. */
  readonly cores?: number
}

/**
 * The engine's pool. `off` builds nothing at all; every other setting builds a
 * pool of the resolved size, and size 0 is `InlinePool` — the single-threaded
 * path with the plumbing present and inert.
 */
export function makeEvaluationPool(options: PoolFactoryOptions = {}): EvaluationPool {
  const env = options.env ?? process.env
  const log = options.log ?? ((m: string) => console.log(m))
  const raw = options.setting ?? env[WORKERS_ENV]
  const setting = parseWorkerSetting(raw === undefined ? undefined : String(raw), log)
  if (setting === "off") return new InlinePool()
  const size = resolveWorkerCount(setting, options.cores)
  if (size <= 0) return new InlinePool()
  return new WorkerEvaluationPool({ size, log, env })
}
