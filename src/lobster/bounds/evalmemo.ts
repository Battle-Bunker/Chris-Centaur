/**
 * AN EVALUATION MEMO — the second half of "resolve once".
 *
 * `memo.ts` collapses the two engine resolutions a branch used to cost into
 * one. It does NOT collapse the evaluation: `BoundBank.priceBranch` calls
 * `evaluate.scorePlan` on every branch it prices, and the search re-prices the
 * same plan constantly — a sweep re-offers the incumbent's own option, a
 * restart lands back on a plan it already visited, and every slice re-prices
 * the seed. MEASURED on the 23x23 three-team board: a ten-second decision
 * performed 48 556 evaluations of 152 DISTINCT plans — 99.7% repeats, one plan
 * evaluated 1 547 times — and the evaluator is 45–64% of the decision's self
 * time. The resolution memo hid none of that: it made the repeat CHEAP to
 * resolve and left it full price to score.
 *
 * ── SOUNDNESS: WHAT A KEY HAS TO CARRY ────────────────────────────────────
 *
 * A resolution is EVALUATOR-INDEPENDENT — it is what the engine does to a
 * position — which is why `memo.ts` can key on `(view, asTeam, planKey)` and
 * be exact. An EVALUATION is not. It is a function of
 *
 *     (the resolved world, the evaluator and everything it reads)
 *
 * and the second half of that is real: two criterion profiles score the same
 * world differently, and so does the same profile at a different reach
 * horizon. Serving one profile's number to another is not a cache, it is a
 * wrong answer with a cache's latency. So the key is composed, explicitly, of
 *
 *   NAMESPACE, recomputed on every `price()` because any of it may move:
 *     · the evaluator's identity (see `evaluatorIdentity`) — which folds in
 *       the criterion profile and therefore the weights AND the horizon;
 *     · the decision BASIS, via `basisKeyOf` — the same canonical assumption
 *       key basis identity is already enforced with everywhere else;
 *     · `asTeam`, the frame the value is denominated in.
 *   ENTRY:
 *     · the VIEW — which units are modelled live rather than held. Two views
 *       resolve the same plan into two different worlds.
 *     · the PLAN, by `planKey`, which is path-sensitive (see plan.ts).
 *
 * Nothing about a hit is inferred. A key that cannot be built is not cached.
 *
 * ── BOUNDEDNESS AND LIFETIME ──────────────────────────────────────────────
 *
 * Same discipline as the resolution memo (memo.ts, "THE SLAB CONTRACT"): the
 * store is per DECISION CONTEXT, created and dropped with the bank, never
 * module scope — a module-scope cache on a per-decision quantity is the latch
 * bug class this build has a standing rule against. It is capacity-bounded and
 * evicts oldest-first.
 *
 * It holds NO SLABS. An entry is three numbers and a string, so this cache
 * cannot move `outstanding()` and cannot keep an arena slab alive; the slab
 * discipline stays entirely the resolution memo's. That is also why its
 * capacity can be generous where the resolution memo's must not be.
 *
 * ── WHY THIS IS ALSO THE PARALLELISM SEAM ─────────────────────────────────
 *
 * Because a key determines a value, an entry does not care WHICH THREAD
 * computed it. `import()` is how an evaluation worker (`lobster/parallel`)
 * hands one in, and every consequence of that is confined to wall time:
 *
 *   · a value is unchanged, so no published bound moves;
 *   · a hit that would have been a miss recomputes nothing, and a miss that
 *     an import turned into a hit computes the same number sooner;
 *   · an extra entry can EVICT one this thread would have hit, and the evicted
 *     key is then simply recomputed — to the same value.
 *
 * So the search's trajectory over a given amount of WORK is invariant under
 * how many workers are running, which is what the pool-0 / pool-N gates
 * assert. What the key cannot express is two substrates that are not the same
 * board; `audit` recomputes every imported entry on first read and throws on a
 * disagreement, which is the check for exactly that.
 */

import { objectIdentity } from "../contracts";
import type { Bound, Evaluator } from "../contracts";

export interface EvalMemoStats {
  readonly hits: number;
  readonly misses: number;
  readonly entries: number;
  readonly capacity: number;
  /** Entries handed in from somewhere else — an evaluation WORKER (see
   * `lobster/parallel`). Counted separately from `misses` because they are
   * work this thread did not do. */
  readonly imported: number;
  /** Imported entries that a later `score()` actually read. The prefetch's
   * hit rate, and the only honest measure of whether speculation is paying. */
  readonly importHits: number;
  /** Imported entries recomputed and CONFIRMED under audit mode. */
  readonly audited: number;
}

/** An evaluation that disagreed with the one the main thread computes. */
export class EvaluationDivergenceError extends Error {
  readonly code = "evaluation_divergence" as const;
  constructor(
    readonly key: string,
    readonly imported: Bound,
    readonly local: Bound,
  ) {
    super(
      `an imported evaluation disagrees with this thread's own for ${key}: ` +
        `imported (${imported.lo}, ${imported.est}, ${imported.hi}) vs local ` +
        `(${local.lo}, ${local.est}, ${local.hi}). The two substrates are not the ` +
        `same board — the memo key cannot express that, so audit mode is what ` +
        `catches it.`,
    );
    this.name = "EvaluationDivergenceError";
  }
}

/**
 * WHAT THIS EVALUATOR IS, for cache purposes.
 *
 * An evaluator may declare its own identity — a string, or a getter returning
 * one — and the built-in `BoundEvaluator` does, from its criterion profile, so
 * two profiles never share an entry even when one object is swapped for
 * another carrying the same profile. An evaluator that declares nothing gets
 * object identity, which is exact for anything constructed per profile and
 * merely pessimistic for anything else.
 *
 * Read FRESH on every `price()`, never cached on the bank: an evaluator whose
 * declared identity moves — a profile mutated in place, a cohort selection
 * changed between slices — must invalidate, and a captured identity is the
 * same defect class as a captured clock.
 */
export function evaluatorIdentity(evaluate: Evaluator): string {
  const declared = (evaluate as { readonly evaluationIdentity?: unknown }).evaluationIdentity;
  if (typeof declared === "string") return `id:${declared}`;
  if (typeof declared === "function") {
    const value: unknown = (declared as () => unknown).call(evaluate);
    if (typeof value === "string") return `id:${value}`;
  }
  return `obj:${objectIdentity(evaluate as object)}`;
}

/**
 * EVERYTHING THAT MUST INVALIDATE WHOLESALE, as one string.
 *
 * A separate, named function because it is the soundness boundary of this
 * whole file and it has to be testable on its own: two evaluations may share a
 * cache entry only if they agree here. Three things do it —
 *
 *   · the evaluator, and therefore its criterion profile, weights and horizon;
 *   · the BASIS, as `basisKeyOf` canonicalises it — the same assumption key
 *     basis identity is enforced with everywhere else in this layer, so a
 *     posture flip or a new operator pin re-namespaces rather than reuses;
 *   · `asTeam`, the frame the value is denominated in.
 *
 * The caller computes this ONCE per `price()` and the per-branch key appends
 * only what varies branch to branch (view, plan).
 */
export function evalNamespace(
  evaluate: Evaluator,
  basisKey: string,
  asTeam: number,
): string {
  return `${evaluatorIdentity(evaluate)}|${basisKey}|${asTeam}`;
}

/**
 * The cache itself. `namespace` is everything that must invalidate wholesale
 * (evaluator, basis, frame); `entry` is what varies branch to branch.
 */
export class EvaluationMemo {
  private readonly entries = new Map<string, Bound>();
  private hits = 0;
  private misses = 0;
  private importedCount = 0;
  private importHitCount = 0;
  private auditedCount = 0;
  /**
   * Keys written by `import`, kept ONLY while auditing. Off the audit path this
   * set is never populated, so the ordinary regime pays one `null` check on a
   * hit and nothing else.
   */
  private importedKeys: Set<string> | null = null;
  /** Keys inserted since `startRecording()`. Null when nobody is recording —
   * which is every main-thread bank. A worker turns it on to learn what its
   * own pricing produced, since that delta IS the parcel result. */
  private recorded: string[] | null = null;

  constructor(
    private readonly capacity: number,
    private readonly audit = false,
  ) {
    if (audit) this.importedKeys = new Set();
  }

  get stats(): EvalMemoStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      capacity: this.capacity,
      imported: this.importedCount,
      importHits: this.importHitCount,
      audited: this.auditedCount,
    };
  }

  /**
   * The memoised evaluation. `compute` runs exactly once per distinct key
   * while the entry lives; an evicted key simply pays again.
   *
   * AN IMPORTED ENTRY IS INDISTINGUISHABLE FROM A LOCAL ONE, and that is the
   * whole determinism argument: the value is a pure function of the key, so
   * whether this thread or a worker computed it changes wall time and nothing
   * else. Under audit the imported value is recomputed once and compared, which
   * is the only way to catch two substrates that are not the same board.
   */
  score(key: string, compute: () => Bound): Bound {
    if (this.capacity <= 0) return compute();
    const hit = this.entries.get(key);
    if (hit !== undefined) {
      this.hits++;
      if (this.importedKeys !== null && this.importedKeys.delete(key)) {
        this.importHitCount++;
        const local = compute();
        if (local.lo !== hit.lo || local.est !== hit.est || local.hi !== hit.hi) {
          throw new EvaluationDivergenceError(key, hit, local);
        }
        this.auditedCount++;
      }
      return hit;
    }
    this.misses++;
    const made = compute();
    this.remember(key, made);
    return made;
  }

  /**
   * Take an evaluation somebody else computed for this exact key.
   *
   * Refuses to overwrite: an entry already here was either computed by this
   * thread or imported earlier, and in both cases it is the same value, so a
   * write would be pure churn. Returns whether the entry was new.
   */
  import(key: string, bound: Bound): boolean {
    if (this.capacity <= 0) return false;
    if (this.entries.has(key)) return false;
    this.importedCount++;
    this.importedKeys?.add(key);
    this.remember(key, bound);
    return true;
  }

  /** Whether an entry — local or imported — is already held. */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  private remember(key: string, bound: Bound): void {
    this.entries.set(key, bound);
    this.recorded?.push(key);
    // Oldest-first, one line, no LRU bookkeeping: the access pattern here is a
    // search re-visiting recent plans, and promoting on read costs more than
    // the occasional early eviction it would save.
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.importedKeys?.delete(oldest.value);
    }
  }

  /** Start collecting the keys this memo fills. A worker's whole output. */
  startRecording(): void {
    if (this.recorded === null) this.recorded = [];
  }

  /** The keys filled since the last take, with their values. Empties the log. */
  takeRecording(): ReadonlyArray<readonly [string, Bound]> {
    const keys = this.recorded;
    if (keys === null) return [];
    this.recorded = [];
    const out: Array<readonly [string, Bound]> = [];
    for (const key of keys) {
      const bound = this.entries.get(key);
      // An entry evicted before it was drained is not sent: half an answer is
      // not a cheaper answer, and the consumer would simply miss on it.
      if (bound !== undefined) out.push([key, bound]);
    }
    return out;
  }

  /** Per-decision lifetime: the bank calls this when it closes. */
  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.importedCount = 0;
    this.importHitCount = 0;
    this.auditedCount = 0;
    this.importedKeys?.clear();
    if (this.recorded !== null) this.recorded = [];
  }
}
