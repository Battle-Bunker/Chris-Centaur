/**
 * WHAT THE SEARCH IS ALLOWED TO KNOW ABOUT TIER — a measurement seam.
 *
 * Two facts about invulnerability ride the wire on every turn and neither one
 * reached the possibility-cloud layer:
 *
 *   1. `Snake.invulnerabilityExpiryTurn` — a tier is a WINDOW, not a property.
 *      `substrate.ts` used to hard-wire `tierExpiresAtTurn: null` on every
 *      record it built, so a three-turn accidental buff was priced by the
 *      search as a permanent one, in both directions: an enemy's transient
 *      +1 never lapsed, and our own transient −1 never lifted.
 *   2. `Board.invulnerabilityPotions` — the item that MOVES a tier. The
 *      substrate built the cloud premise's potion board literally empty, so
 *      `CloudSource.boundsAt`'s tier-ceiling arithmetic (cloud.ts:770-790) ran
 *      on an identically-zero `reachablePotions` and collapsed to
 *      `[min(0,tier), max(0,tier)]`. The machinery was present, correct and
 *      unreachable.
 *
 * Feeding the two is not one change with one sign. Expiry is a NARROWING — a
 * lapsed window shrinks a tier interval toward zero. The potion board is a
 * WIDENING — a reachable potion raises a ceiling and drops a floor below zero.
 * A single on/off switch measures their sum and can only report the sum, so
 * the seam names them separately.
 *
 * `full` is the default and the intended production setting; the other two
 * exist so an arm can be attributed. Read once, at module load, because a
 * setting that changes mid-game would put two incomparable bases in one
 * bound bank.
 */

/** What the substrate feeds the cloud layer about tier. */
export type TierTruth = 'off' | 'expiry' | 'full';

const PARSE: Record<string, TierTruth> = {
  off: 'off',
  expiry: 'expiry',
  full: 'full',
};

/**
 * `off` reproduces the pre-change behaviour exactly (null expiry, empty potion
 * board); `expiry` feeds real expiry only; `full` feeds both.
 */
export const TIER_TRUTH: TierTruth = PARSE[String(process.env.CENTAUR_TIER_TRUTH ?? '').trim()] ?? 'full';

/** Does the search get the real expiry turn, or the old permanent-tier lie? */
export function tierExpiryEnabled(mode: TierTruth = TIER_TRUTH): boolean {
  return mode !== 'off';
}

/** Does the cloud premise get the real potion board? */
export function potionBoardEnabled(mode: TierTruth = TIER_TRUTH): boolean {
  return mode === 'full';
}
