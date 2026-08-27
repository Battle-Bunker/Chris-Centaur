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
 */

import { objectIdentity } from "../contracts";
import type { Bound, Evaluator } from "../contracts";

export interface EvalMemoStats {
  readonly hits: number;
  readonly misses: number;
  readonly entries: number;
  readonly capacity: number;
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

  constructor(private readonly capacity: number) {}

  get stats(): EvalMemoStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      capacity: this.capacity,
    };
  }

  /**
   * The memoised evaluation. `compute` runs exactly once per distinct key
   * while the entry lives; an evicted key simply pays again.
   */
  score(key: string, compute: () => Bound): Bound {
    if (this.capacity <= 0) return compute();
    const hit = this.entries.get(key);
    if (hit !== undefined) {
      this.hits++;
      return hit;
    }
    this.misses++;
    const made = compute();
    this.entries.set(key, made);
    // Oldest-first, one line, no LRU bookkeeping: the access pattern here is a
    // search re-visiting recent plans, and promoting on read costs more than
    // the occasional early eviction it would save.
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return made;
  }

  /** Per-decision lifetime: the bank calls this when it closes. */
  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
