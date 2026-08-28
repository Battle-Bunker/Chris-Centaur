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
 * The other two exist so an arm can be attributed. Read once, at module load,
 * because a setting that changes mid-game would put two incomparable bases in
 * one bound bank.
 *
 * ── STAGE 3 SHIP SUBSET (integ/round-a) ────────────────────────────────────
 *
 * THE DEFAULT IS `expiry`, NOT `full`. I4's branch shipped `full`; the ledger's
 * Stage 2.5 verdict ships only half of it:
 *
 *   "ship the EXPIRY threading + the tier-defense layer ... HOLD the potion-
 *    board widening: causes an 858-inversion interaction storm (class: B0
 *    floor > B1 ceiling), gated on a NEW UPSTREAM ENGINE DEMAND"
 *
 * That upstream demand is now met — `engine/fix5` landed the tierMax fix — but
 * the widening's RE-MEASURE has not been run, and the fix5 report says so in
 * as many words: "I4 storm NOT re-measured ... report says what to rebase+run."
 * A widening whose interaction storm was never re-priced does not ship on the
 * strength of the fix that was supposed to enable it. So the widening stays
 * dark and `CENTAUR_TIER_TRUTH=full` is the arm that re-measures it.
 *
 * NOTE FOR THAT ARM: fix5 also changed the widening's TIMING. `couldCollectPotion`
 * is now gated `n >= 2` (the commit-time lag, cloud.ts) rather than firing at
 * the turn-start field, and own reach only LOWERS own tier — the ally ceiling
 * moved to `field.ts::build`. The storm must be re-measured against THAT
 * arithmetic; the old numbers describe code that no longer exists.
 *
 * The EXPIRY half is unaffected by any of this and ships: it is a NARROWING,
 * it needs no potion board, and it is what stops a three-turn buff being
 * priced as a permanent one.
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
 *
 * Defaults to `expiry` — the Stage 3 ship subset. See the header.
 */
export const TIER_TRUTH: TierTruth =
  PARSE[String(process.env.CENTAUR_TIER_TRUTH ?? '').trim()] ?? 'expiry';

/** Does the search get the real expiry turn, or the old permanent-tier lie? */
export function tierExpiryEnabled(mode: TierTruth = TIER_TRUTH): boolean {
  return mode !== 'off';
}

/** Does the cloud premise get the real potion board? */
export function potionBoardEnabled(mode: TierTruth = TIER_TRUTH): boolean {
  return mode === 'full';
}

/**
 * The SECOND seam, and it is a different question from the first.
 *
 * Feeding the cloud the truth about tier changes what the search BELIEVES;
 * the tier-window filter in `candidates.ts` changes what it is allowed to
 * CONSIDER. One is a correction, the other is a policy, and an arm that moves
 * both at once can only report their sum. Default on; `off` gives the
 * corrected-beliefs-only arm.
 */
export const TIER_DEFENSE: boolean =
  String(process.env.CENTAUR_TIER_DEFENSE ?? '').trim().toLowerCase() !== 'off';
