/**
 * A resolution memo in front of a `Substrate`.
 *
 * The bank needs two things from every branch it prices: the `Bound` the
 * evaluator computes, and the `Resolution` whose entanglement ledger explains
 * the gap. `contracts.ts` gives it two separate calls — `Evaluator.scorePlan`
 * resolves internally, `Substrate.resolveBoundedFor` resolves again — so a
 * naive bank pays TWO engine resolutions per branch, and resolutions are the
 * only currency the whole system is budgeted in.
 *
 * Wrapping the substrate collapses them: the evaluator's call is served from
 * the same entry the bank's call filled. Keyed on the plan's path-sensitive
 * key plus the scoring team, so it is exact rather than approximate.
 *
 * It is a PROXY, not a subclass, and that is deliberate. A substrate is
 * allowed to carry capabilities beyond the pinned interface — `withModelled`
 * today, `commandable` tomorrow, whatever the integrator lands next — and a
 * hand-written wrapper hides every one it was not told about. Feature
 * detection downstream would then answer questions about the WRAPPER instead
 * of about the substrate, which is a silent capability regression: the bank
 * would quietly drop to B0 and still report a sound (but far looser) floor.
 * The proxy forwards everything it does not itself override.
 *
 * The cache is per DECISION CONTEXT, created and dropped with the bank, never
 * module scope. (Module-scope caches on a per-decision quantity are the latch
 * bug class this build has a standing rule against.)
 */

import type { JointPlan, Substrate } from "../contracts";
import type { Resolution } from "../../partial-engine/index";
import { planKey } from "./plan";
import { isModelling } from "./substrate-ext";

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

function wrap(inner: Substrate, capacity: number, counters: Counters): MemoizedSubstrate {
  const cache = new Map<string, Resolution>();

  const resolveBoundedFor = (plan: JointPlan, asTeam: number): Resolution => {
    const key = `${asTeam}#${planKey(plan)}`;
    const hit = cache.get(key);
    if (hit !== undefined) {
      counters.hits++;
      return hit;
    }
    counters.misses++;
    const value = inner.resolveBoundedFor(plan, asTeam);
    if (cache.size >= capacity) {
      // Cheapest sound eviction: drop the oldest insertion. Map preserves
      // insertion order, so this is one iterator step.
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
    return value;
  };

  const release = (): void => {
    cache.clear();
    inner.release();
  };

  const resetStats = (): void => {
    counters.misses = 0;
    counters.hits = 0;
  };

  const withModelled = isModelling(inner)
    ? (modelled: ReadonlyArray<number>): Substrate =>
        // Children share the parent's counters, so the budget sees ONE number
        // for the whole decision rather than one per hold configuration.
        wrap(inner.withModelled(modelled), capacity, counters)
    : undefined;

  return new Proxy(inner, {
    get(target, prop, receiver): unknown {
      switch (prop) {
        case "resolveBoundedFor":
          return resolveBoundedFor;
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
  return wrap(sub, capacity, { misses: 0, hits: 0 });
}
