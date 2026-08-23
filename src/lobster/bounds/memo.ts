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
 * THE SLAB CONTRACT, MEMOIZED. A cached resolution's slab stays BORROWED for
 * as long as the entry lives, because a later hit may hand it to an evaluator
 * that reads live unit views off it. The memo therefore owns the release:
 * an evicted entry's slab goes back at once, and `release()` returns every
 * cached slab — WITHOUT releasing the inner substrate, which the memo borrows
 * and never owns (a modelled sibling wrapped by `withModelled` releases
 * itself; a released sibling's release is a no-op by the sibling contract).
 * The bank calls `release()` when it closes, so `outstanding()` returns to
 * its between-decisions baseline the moment a search call ends.
 *
 * ONE BUDGET, NOT ONE PER VIEW. `capacity` is a SLAB budget, and slabs come
 * from one arena: a memo whose children each kept their own capacity-sized
 * cache had a real ceiling of `capacity × views`, which measured 9754
 * outstanding slabs at 26 units against a nominal 4096 — 27 MB of ArrayBuffer
 * per engine, over the process cap once a few geometries are live. The store
 * below is SHARED down the whole family: every view writes into it, eviction
 * is global and oldest-first, and each entry remembers which substrate owes
 * its slab back. `stats.slabs` and `stats.peakSlabs` are what a soak reads.
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
  /** Cached resolutions holding a slab RIGHT NOW, across every view. */
  readonly slabs: number;
  /** The high-water mark of the above, for the soak. */
  readonly peakSlabs: number;
  /** The shared ceiling `slabs` is held under. */
  readonly capacity: number;
}

export interface MemoizedSubstrate extends Substrate {
  readonly stats: MemoStats;
  resetStats(): void;
}

interface Entry {
  readonly resolution: BoundedResolution;
  /** Who to hand the slab back to. A sibling's slabs are the sibling's. */
  readonly owner: Substrate;
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
      const evicted = store.entries.get(oldest.value);
      store.entries.delete(oldest.value);
      // Cheapest sound eviction: drop the oldest insertion and return its slab
      // at once, to whichever view actually borrowed it.
      if (evicted !== undefined) evicted.owner.releaseResolution(evicted.resolution.resolution);
    }
  };

  const resolveBoundedFor = (plan: JointPlan, asTeam: number): BoundedResolution => {
    const key = `${prefix}${asTeam}#${planKey(plan)}`;
    const hit = store.entries.get(key);
    if (hit !== undefined) {
      store.hits++;
      return hit.resolution;
    }
    store.misses++;
    const value = inner.resolveBoundedFor(plan, asTeam);
    store.entries.set(key, { resolution: value, owner: inner });
    evict();
    if (store.entries.size > store.peak) store.peak = store.entries.size;
    return value;
  };

  // The evaluator's door, served from the same cache — and NEVER releasing,
  // because the memo owns the cached slab for the entry's whole life.
  const withResolution = <T>(
    plan: JointPlan,
    asTeam: number,
    fn: (r: BoundedResolution) => T,
  ): T => fn(resolveBoundedFor(plan, asTeam));

  // A caller that releases a resolution the memo still caches would free a
  // slab a later hit hands back out. Releases are deferred to eviction and to
  // release(); a resolution the memo has never seen is passed through.
  const releaseResolution = (resolution: BoundedResolution["resolution"]): void => {
    for (const entry of store.entries.values()) {
      if (entry.resolution.resolution === resolution) return;
    }
    inner.releaseResolution(resolution);
  };

  const release = (): void => {
    for (const [key, entry] of [...store.entries]) {
      if (!key.startsWith(prefix)) continue;
      store.entries.delete(key);
      entry.owner.releaseResolution(entry.resolution.resolution);
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
          // Children share the parent's counters AND its slab budget, so the
          // budget sees ONE number for the whole decision rather than one per
          // hold configuration. The child wrap OWNS its sibling: releasing the
          // view releases the sibling.
          wrap(inner.withModelled(modelled), store, ++store.nextView, true)
      : undefined;

  return new Proxy(inner, {
    get(target, prop, receiver): unknown {
      switch (prop) {
        case "resolveBoundedFor":
          return resolveBoundedFor;
        case "withResolution":
          return withResolution;
        case "releaseResolution":
          return releaseResolution;
        case "release":
          return release;
        case "resetStats":
          return resetStats;
        case "stats":
          return {
            resolutions: store.misses,
            hits: store.hits,
            slabs: store.entries.size,
            peakSlabs: store.peak,
            capacity: store.capacity,
          } satisfies MemoStats;
        case "withModelled":
          return withModelled;
        default: {
          const value = Reflect.get(target, prop, receiver);
          // Bind so a forwarded method still sees the real substrate as
          // `this` — a proxy receiver would miss its private fields.
          return typeof value === "function" ? (value as (...a: never[]) => unknown).bind(target) : value;
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
