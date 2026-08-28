/**
 * WORKER PARALLELISM for the decision search.
 *
 * The whole subsystem in one paragraph: an engine owns a warm pool of worker
 * threads; each worker rebuilds the decision's board once per turn and prices
 * SPECULATIVE joint plans taken from the search's own sweep frontier; the only
 * thing that crosses back is entries for the main bank's evaluation memo. The
 * kernel's anytime slice loop stays on the main thread and remains the sole
 * stager; workers never stage, never own budget policy, and never publish a
 * bound. Because a memo value is a pure function of its key, the number of
 * workers changes wall time and nothing else — which is the property the
 * pool-0 and pool-N gates assert.
 *
 * Read `protocol.ts` for why a divergent worker is inert rather than wrong,
 * `partition.ts` for the cluster seam, and `pool.ts` for the lifecycle.
 */

export {
  autoPoolSize,
  auditFrom,
  MAX_POOL,
  parseWorkerSetting,
  resolveWorkerCount,
  WORKERS_AUDIT_ENV,
  WORKERS_ENV,
} from "./config"
export type { WorkerSetting } from "./config"

export { InlinePool, WorkerEvaluationPool, workerArgs } from "./pool"
export type { EvaluationPool, PoolStats, WorkerPoolOptions } from "./pool"

export { clusterPlanPartition, decodePlan, planBatchPartition, sweepFrontier } from "./partition"
export type { Frontier, PlanChunk, SampledOrder, WorkPartition } from "./partition"

export {
  catalogueDigest,
  Counter,
  decodeCandidate,
  decodeKeys,
  encodeCandidate,
  UNENCODABLE,
} from "./protocol"
export type {
  BoardSpec,
  EvaluatorSpec,
  FromWorker,
  Parcel,
  ParcelRefusal,
  ParcelResult,
  PlanBatchParcel,
  SessionSpec,
  ToWorker,
  WorkerReady,
} from "./protocol"

export { evaluatorSpecOf, makeEvaluationPool } from "./factory"
