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
}

export interface MemoizedSubstrate extends Substrate {
  readonly stats: MemoStats;
  resetStats(): void;
}

interface Counters {
  misses: number;
  hits: number;
}

function wrap(
  inner: Substrate,
  capacity: number,
  counters: Counters,
  /** Whether release() also releases `inner`. False for the decision's own
   * substrate (borrowed); true for a modelled sibling this memo created. */
  ownsInner: boolean,
): MemoizedSubstrate {
  const cache = new Map<string, BoundedResolution>();

  const resolveBoundedFor = (plan: JointPlan, asTeam: number): BoundedResolution => {
    const key = `${asTeam}#${planKey(plan)}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      counters.hits++;
      return hit;
    }
    counters.misses++;
    const value = inner.resolveBoundedFor(plan, asTeam);
    if (cache.size >= capacity) {
      // Cheapest sound eviction: drop the oldest insertion (Map preserves
      // insertion order) and return its slab at once.
      const oldest = cache.keys().next();
      if (!oldest.done) {
        const evicted = cache.get(oldest.value);
        cache.delete(oldest.value);
        if (evicted !== undefined) inner.releaseResolution(evicted.resolution);
      }
    }
    cache.set(key, value);
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
    for (const entry of cache.values()) {
      if (entry.resolution === resolution) return;
    }
    inner.releaseResolution(resolution);
  };

  const release = (): void => {
    for (const entry of cache.values()) inner.releaseResolution(entry.resolution);
    cache.clear();
    // The decision's own substrate is BORROWED, never owned: the decision that
    // built it releases it, and this memo returns only what it cached. A
    // modelled sibling created by `withModelled` below IS owned, and its own
    // release is required by the sibling contract to be parent-safe.
    if (ownsInner) inner.release();
  };

  const resetStats = (): void => {
    counters.misses = 0;
    counters.hits = 0;
  };

  // Feature-detected so a substrate WITHOUT modelling (the bank's B0-only
  // degradation arm) stays visibly without it through the wrapper — a memo
  // that invented the method would be a silent capability LIE, the exact
  // inverse of the regression the proxy design exists to prevent.
  const withModelled =
    typeof inner.withModelled === "function"
      ? (modelled: ReadonlyArray<number>): Substrate =>
          // Children share the parent's counters, so the budget sees ONE
          // number for the whole decision rather than one per hold
          // configuration. The child wrap OWNS its sibling: releasing the
          // view releases the sibling.
          wrap(inner.withModelled(modelled), capacity, counters, true)
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
          return { resolutions: counters.misses, hits: counters.hits } satisfies MemoStats;
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
  return wrap(sub, capacity, { misses: 0, hits: 0 }, false);
}
