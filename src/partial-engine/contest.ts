/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/contest.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// THE ONE COMPARATOR. Collision adjudication is a lexicographic contest on
// (frozen tier, frozen weight) with at-most-one-unique-strict-maximum
// survival. The resolver's contests, the risk layer's endpoint evaluation and
// exact mode's witness worlds all call these functions — never a restatement —
// which is what the deliberation delta means by "reuse the resolver's own
// beats/uniqueStrictMax; never restate the contest" (§3).
//
// SCALAR-ONLY TYPES (delta §3): `Scalar` is branded so that an interval
// endpoint cannot be fed to the contest by accident — a corner of a
// tier×weight box may be a world nobody inhabits. The risk layer's endpoint
// evaluation constructs its corners through `cornerForEndpointEvaluation`,
// whose name says exactly what the value is licensed for.

declare const SCALAR: unique symbol;

/** One unit's frozen strength in ONE world. Never a box, never a corner. */
export interface Scalar {
  readonly tier: number;
  readonly weight: number;
  readonly [SCALAR]?: true;
}

/** Wrap a concrete unit's frozen strength. The only public constructor. */
export const scalarOf = (tier: number, weight: number): Scalar => ({ tier, weight });

/**
 * A box corner, FOR ENDPOINT EVALUATION ONLY. The lex contest is antitone, so
 * a box attains its lex-min/max at two corners; evaluating the contest at
 * those corners is exact ON THE BOX. The corner itself may correspond to no
 * world — do not let it escape into any concrete adjudication.
 */
export const cornerForEndpointEvaluation = (tier: number, weight: number): Scalar => ({
  tier,
  weight,
});

/** Lexicographic (tier, weight): −1 a<b, 0 tie, +1 a>b. */
export function cmpLex(a: Scalar, b: Scalar): number {
  if (a.tier !== b.tier) return a.tier < b.tier ? -1 : 1;
  if (a.weight !== b.weight) return a.weight < b.weight ? -1 : 1;
  return 0;
}

/** Strictly beats — the survival condition against ONE opponent. */
export const beats = (a: Scalar, b: Scalar): boolean => cmpLex(a, b) > 0;

/**
 * The unique strict maximum of a contest, or null when a tie leaves nobody
 * standing. This is the whole of the game's cell-contest rule.
 */
export function uniqueStrictMax<T>(participants: ReadonlyArray<T>, of: (t: T) => Scalar): T | null {
  let best: T | null = null;
  let bestS: Scalar | null = null;
  let tied = false;
  for (const p of participants) {
    const s = of(p);
    if (bestS === null || cmpLex(s, bestS) > 0) {
      best = p;
      bestS = s;
      tied = false;
    } else if (cmpLex(s, bestS) === 0) {
      tied = true;
    }
  }
  return tied ? null : best;
}
