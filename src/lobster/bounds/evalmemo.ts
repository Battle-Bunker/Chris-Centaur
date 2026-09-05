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
  /**
   * THE STORE, IN TWO LEVELS RATHER THAN ONE — the same key set, the same
   * order, one flattened string fewer per branch.
   *
   * The key was one string, `namespaceToken | view | planKey`, concatenated
   * fresh on every branch and hashed from scratch on every lookup: 3.0% of the
   * kernel's decision time in `priceBranch` building it and another 3.0% here
   * hashing it, on `mixed 60 1 --nodes`. The two halves move at completely
   * different rates — the (namespace, view) half is FIXED for a whole reply
   * sweep, and the plan half is a string the plan already carries — so the
   * store splits on exactly that seam: one bucket per (namespace, view),
   * looked up with a string object that is the same one for the whole sweep,
   * and one entry per plan inside it, looked up with the plan's own cached
   * key. V8 caches a string's hash on the string OBJECT, so both halves are
   * hashed once each instead of once per branch.
   *
   * THE SPLIT IS A BIJECTION ON THE OLD KEY, which is the only thing that
   * makes it legal: a namespace token is `n<digits>` and a view key is digits
   * and commas, so `outer` never contains the seam ambiguously and (outer,
   * inner) recovers the flat key exactly. The key SET is therefore identical,
   * and `order` below replays the flat map's insertion order — misses in the
   * order they happened, which is what oldest-first eviction consumed — so the
   * hit/miss sequence is unchanged. That sequence IS the node clock in the
   * deterministic runner (a miss calls the metered evaluator), so nothing less
   * than a bijection would do.
   */
  private readonly buckets = new Map<string, Map<string, Bound>>();
  /** Every live key in MISS order — the flat map's insertion order — as two
   *  parallel arrays with a head index, so eviction is O(1) and allocates
   *  nothing. */
  private readonly orderOuter: string[] = [];
  private readonly orderInner: string[] = [];
  private head = 0;
  private live = 0;
  /** The bucket a flat `score(key)` lands in. `\u0000` cannot begin a
   *  namespace token, so it can never collide with a split key. */
  private static readonly FLAT = "\u0000flat";
  /**
   * NAMESPACE → SHORT TOKEN, for this decision only.
   *
   * `evalNamespace` is a long string — the evaluator's structural identity
   * carries the whole criterion profile — and it was prepended to EVERY
   * per-branch key, so each of the 152 208 lookups a 20-turn `mixed` run makes
   * built and hashed a few hundred characters of a constant. The token is a
   * BIJECTION on the namespace, so the key set, the hit/miss sequence and the
   * oldest-first eviction order are all exactly what they were — the clock the
   * deterministic runner counts is a function of that sequence, so nothing
   * less than a bijection would do. Per instance, cleared with the memo:
   * a module-scope table on a per-decision quantity is the latch bug class.
   */
  private readonly namespaces = new Map<string, string>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly capacity: number) {}

  get stats(): EvalMemoStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.live,
      capacity: this.capacity,
    };
  }

  /** This decision's short stand-in for one `evalNamespace` string. */
  namespaceToken(namespace: string): string {
    const hit = this.namespaces.get(namespace);
    if (hit !== undefined) return hit;
    const token = `n${this.namespaces.size}`;
    this.namespaces.set(namespace, token);
    return token;
  }

  /**
   * The memoised evaluation. `compute` runs exactly once per distinct key
   * while the entry lives; an evicted key simply pays again.
   */
  score(key: string, compute: () => Bound): Bound {
    return this.lookup(EvaluationMemo.FLAT, key, compute);
  }

  /**
   * The same memo, asked with the key already split at its own seam:
   * `scope` is `namespaceToken | view` — fixed for a whole reply sweep — and
   * `plan` is the plan's `planKey`. Exactly `score(`${scope}|${plan}`)`.
   */
  scoreIn(scope: string, plan: string, compute: () => Bound): Bound {
    return this.lookup(scope, plan, compute);
  }

  private lookup(outer: string, inner: string, compute: () => Bound): Bound {
    if (this.capacity <= 0) return compute();
    const bucket = this.buckets.get(outer);
    if (bucket !== undefined) {
      const hit = bucket.get(inner);
      if (hit !== undefined) {
        this.hits++;
        return hit;
      }
    }
    this.misses++;
    const made = compute();
    let into = bucket;
    if (into === undefined) {
      into = new Map<string, Bound>();
      this.buckets.set(outer, into);
    }
    into.set(inner, made);
    this.orderOuter.push(outer);
    this.orderInner.push(inner);
    this.live++;
    // Oldest-first, no LRU bookkeeping: the access pattern here is a search
    // re-visiting recent plans, and promoting on read costs more than the
    // occasional early eviction it would save. The entry just inserted is the
    // newest, so it can never be the one this loop takes.
    while (this.live > this.capacity) {
      const outerOld = this.orderOuter[this.head] as string;
      const innerOld = this.orderInner[this.head] as string;
      this.head++;
      const from = this.buckets.get(outerOld);
      if (from !== undefined) {
        from.delete(innerOld);
        if (from.size === 0) this.buckets.delete(outerOld);
      }
      this.live--;
    }
    // The consumed prefix of the queue is dropped in one go rather than by a
    // shift per eviction, and only once it is the majority of the array.
    if (this.head > 1024 && this.head * 2 > this.orderOuter.length) {
      this.orderOuter.splice(0, this.head);
      this.orderInner.splice(0, this.head);
      this.head = 0;
    }
    return made;
  }

  /** Per-decision lifetime: the bank calls this when it closes. */
  clear(): void {
    this.buckets.clear();
    this.orderOuter.length = 0;
    this.orderInner.length = 0;
    this.head = 0;
    this.live = 0;
    this.namespaces.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
