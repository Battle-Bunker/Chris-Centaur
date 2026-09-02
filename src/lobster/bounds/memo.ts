/**
 * A resolution memo in front of a `Substrate`.
 *
 * The bank needs two things from every branch it prices: the `Bound` the
 * evaluator computes, and the `BoundedResolution` whose entanglement ledger
 * explains the gap. The evaluator resolves internally (through
 * `withResolution`) and the bank resolves again (`resolveBoundedFor`) — so a
 * naive bank pays TWO engine resolutions per branch, and resolutions are the
 * only currency the whole system is budgeted in.
 *
 * Wrapping the substrate collapses them: BOTH doors — `resolveBoundedFor` and
 * `withResolution` — are served from one cache keyed on the plan's
 * path-sensitive key plus the scoring team, so the evaluator's internal
 * resolve is a hit on the entry the bank's call filled.
 *
 * NOTHING IS BORROWED ANY MORE. A settlement is a plain value — settlement
 * allocates per call and owns no arena — so an entry is dropped by forgetting
 * it, and eviction has nothing to hand back. What survives is the BUDGET: the
 * cache is bounded because a decision at 26 units prices tens of thousands of
 * plans and a settlement is not small.
 *
 * ONE BUDGET, NOT ONE PER VIEW. A memo whose children each kept their own
 * capacity-sized cache had a real ceiling of `capacity × views`, which
 * measured 9754 retained resolutions at 26 units against a nominal 4096. The
 * store below is SHARED down the whole family: every view writes into it and
 * eviction is global and oldest-first. `stats.retained` and `stats.peak` are
 * what a soak reads.
 *
 * It is a PROXY, not a subclass, and that is deliberate. A substrate is
 * allowed to carry capabilities beyond the pinned interface, and a
 * hand-written wrapper hides every one it was not told about. Feature
 * detection downstream would then answer questions about the WRAPPER instead
 * of about the substrate — a silent capability regression. The proxy forwards
 * everything it does not itself override.
 *
 * The cache is per DECISION CONTEXT, created and dropped with the bank, never
 * module scope. (Module-scope caches on a per-decision quantity are the latch
 * bug class this build has a standing rule against.)
 */

import type { BoundedResolution, JointPlan, Substrate } from "../contracts";
import { planKey } from "./plan";

export interface MemoStats {
  /** Real engine resolutions — the number the budget is denominated in. */
  readonly resolutions: number;
  readonly hits: number;
  /** Resolutions retained RIGHT NOW, across every view. */
  readonly retained: number;
  /** The high-water mark of the above, for the soak. */
  readonly peak: number;
  /** The shared ceiling `retained` is held under. */
  readonly capacity: number;
}

export interface MemoizedSubstrate extends Substrate {
  readonly stats: MemoStats;
  resetStats(): void;
}

interface Entry {
  readonly resolution: BoundedResolution;
}

/** The family's shared cache: one budget, one eviction order. */
interface Store {
  readonly capacity: number;
  /** Insertion-ordered, which is the eviction order. */
  readonly entries: Map<string, Entry>;
  misses: number;
  hits: number;
  peak: number;
  nextView: number;
}

function wrap(
  inner: Substrate,
  store: Store,
  /** Namespaces this view's keys inside the shared store. */
  viewId: number,
  /** Whether release() also releases `inner`. False for the decision's own
   * substrate (borrowed); true for a modelled sibling this memo created. */
  ownsInner: boolean,
): MemoizedSubstrate {
  const prefix = `v${viewId}#`;

  const evict = (): void => {
    while (store.entries.size > store.capacity) {
      const oldest = store.entries.keys().next();
      if (oldest.done) return;
      store.entries.delete(oldest.value);
    }
  };

  /**
   * THIS VIEW'S COMPOSITE KEY, PER PLAN OBJECT.
   *
   * Every branch asks this door twice with the SAME plan object — once from
   * `priceBranch` for the bounded resolve, and once from the evaluator's
   * `withResolution` below it — and both calls rebuilt a ~120-character key by
   * concatenating the view prefix, the frame and the plan key. The `WeakMap`
   * is per view (it is a closure field, and the prefix is fixed for the life
   * of the closure), so the string it holds is exactly the key that view would
   * have built, and the frame is checked because the same plan is priced from
   * more than one frame in the harness.
   */
  const composed = new WeakMap<object, { team: number; key: string }>();

  const keyFor = (plan: JointPlan, asTeam: number): string => {
    const hit = composed.get(plan as object);
    if (hit !== undefined && hit.team === asTeam) return hit.key;
    const made = `${prefix}${asTeam}#${planKey(plan)}`;
    composed.set(plan as object, { team: asTeam, key: made });
    return made;
  };

  const resolveBoundedFor = (plan: JointPlan, asTeam: number): BoundedResolution => {
    const key = keyFor(plan, asTeam);
    const hit = store.entries.get(key);
    if (hit !== undefined) {
      store.hits++;
      return hit.resolution;
    }
    store.misses++;
    const value = inner.resolveBoundedFor(plan, asTeam);
    store.entries.set(key, { resolution: value });
    evict();
    if (store.entries.size > store.peak) store.peak = store.entries.size;
    return value;
  };

  // The evaluator's door, served from the same cache.
  const withResolution = <T>(
    plan: JointPlan,
    asTeam: number,
    fn: (r: BoundedResolution) => T,
  ): T => fn(resolveBoundedFor(plan, asTeam));

  const release = (): void => {
    for (const key of [...store.entries.keys()]) {
      if (!key.startsWith(prefix)) continue;
      store.entries.delete(key);
    }
    // The decision's own substrate is BORROWED, never owned: the decision that
    // built it releases it, and this memo returns only what it cached. A
    // modelled sibling created by `withModelled` below IS owned, and its own
    // release is required by the sibling contract to be parent-safe.
    if (ownsInner) inner.release();
  };

  const resetStats = (): void => {
    store.misses = 0;
    store.hits = 0;
    store.peak = store.entries.size;
  };

  // Feature-detected so a substrate WITHOUT modelling (the bank's B0-only
  // degradation arm) stays visibly without it through the wrapper — a memo
  // that invented the method would be a silent capability LIE, the exact
  // inverse of the regression the proxy design exists to prevent.
  const withModelled =
    typeof inner.withModelled === "function"
      ? (modelled: ReadonlyArray<number>): Substrate =>
          // Children share the parent's counters AND its budget, so the
          // budget sees ONE number for the whole decision rather than one per
          // hold configuration. The child wrap OWNS its sibling: releasing the
          // view releases the sibling.
          wrap(inner.withModelled(modelled), store, ++store.nextView, true)
      : undefined;

  /**
   * FORWARDED METHODS, BOUND ONCE.
   *
   * The `get` trap below runs on EVERY property access the evaluator, the
   * bank and the search make through the wrapper — measured at 2.9% of total
   * self time on `mixed 20 1 --nodes`, and the `.bind()` in the default arm
   * allocated a fresh function object on every one of them, which is pure
   * garbage on the hottest path in the system. A method is a prototype
   * function and the bind target is the one `inner` this closure captured, so
   * the bound wrapper is a constant: build it once, keep it here.
   *
   * ONLY functions are cached. Data properties (`released`, and anything a
   * substrate exposes as a field) still go through `Reflect.get` on every
   * read, because their VALUES move and a cached one would be a stale answer.
   */
  const forwarded = new Map<PropertyKey, (...a: never[]) => unknown>();

  return new Proxy(inner, {
    get(target, prop, receiver): unknown {
      switch (prop) {
        case "resolveBoundedFor":
          return resolveBoundedFor;
        case "withResolution":
          return withResolution;
        case "release":
          return release;
        case "resetStats":
          return resetStats;
        case "stats":
          return {
            resolutions: store.misses,
            hits: store.hits,
            retained: store.entries.size,
            peak: store.peak,
            capacity: store.capacity,
          } satisfies MemoStats;
        case "withModelled":
          return withModelled;
        default: {
          const bound = forwarded.get(prop);
          if (bound !== undefined) return bound;
          const value = Reflect.get(target, prop, receiver);
          // Bind so a forwarded method still sees the real substrate as
          // `this` — a proxy receiver would miss its private fields.
          if (typeof value !== "function") return value;
          const made = (value as (...a: never[]) => unknown).bind(target);
          forwarded.set(prop, made);
          return made;
        }
      }
    },
    has(target, prop): boolean {
      if (prop === "stats" || prop === "resetStats") return true;
      if (prop === "withModelled") return withModelled !== undefined;
      return Reflect.has(target, prop);
    },
  }) as unknown as MemoizedSubstrate;
}

/** Wrap a substrate so a plan is resolved at most once per scoring team. */
export function memoizeSubstrate(sub: Substrate, capacity = 4096): MemoizedSubstrate {
  return wrap(
    sub,
    { capacity, entries: new Map(), misses: 0, hits: 0, peak: 0, nextView: 0 },
    0,
    false,
  );
}
