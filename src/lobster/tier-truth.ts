/**
 * WHAT THE SEARCH KNOWS ABOUT TIER — the whole truth, and no switch.
 *
 * Two facts about invulnerability ride the wire on every turn and neither one
 * used to reach the possibility-cloud layer:
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
 * Both are now fed, unconditionally. They used to sit behind
 * `CENTAUR_TIER_TRUTH`, whose three levels (`off` / `expiry` / `full`) let a
 * measurement arm feed one, both or neither. The flag is gone with the rest of
 * the flag system, and the value it is gone AT is `full`.
 *
 * ── WHY `full` AND NOT THE `expiry` THAT SHIPPED ───────────────────────────
 *
 * The flag shipped at `expiry` on a Stage 2.5 verdict that HELD the potion
 * board: the widening was said to cause an "858-inversion interaction storm
 * (class: B0 floor > B1 ceiling)" and to be gated on an upstream engine demand.
 * That demand was met by `engine/fix5`, which ALSO changed the widening's
 * arithmetic — `couldCollectPotion` is now gated `n >= 2` (the commit-time lag,
 * cloud.ts) instead of firing at the turn-start field, and own reach only
 * LOWERS own tier, with the ally ceiling moved to `field.ts::build`. The storm
 * numbers describe code that no longer exists, and the re-measure was never
 * run. So the choice could not be made on the old measurement either way.
 *
 * It is made on two facts that ARE current, and they point the same way.
 *
 * ONE — AT THE DEPTH PRODUCTION ACTUALLY RUNS, `full` IS A MEASURED NO-OP.
 * `n = 1` is the only reading a ply-1 decision consults, and a potion taken on
 * the move being resolved is applied at THAT turn's commit, so it governs
 * nothing in the contest being asked about. Measured over 160 replays of the
 * full trio on 40 potion-bearing piece boards at two budgets, `full` moved the
 * argmax on 0 of them and the published bracket on 0 of them, while
 * `couldCollectPotion` fired on 36 of the 40 once the field was dilated
 * (`__tests__/tier-window.test.ts`, "cannot move the turn-start field"). The
 * belief changes; the ply-1 decision does not. So this default costs today's
 * bot nothing, and the byte-identity gate says so rather than assuming it.
 *
 * TWO — AT DEPTH >= 2, `expiry` IS THE UNSOUND ONE. An empty potion board is
 * not a missing refinement, it is a FALSE PREMISE: the cloud's tier-ceiling
 * arithmetic concludes that no held unit can raise its tier, on a board where
 * the potions to raise it are sitting there and reachable. A ceiling derived
 * from that is too tight, and a too-tight ceiling is a claim of impossibility
 * that the rules do not support — exactly the class of error the floor/ceiling
 * laws exist to forbid. It cannot bite at `n = 1` (see above), which is why it
 * was survivable to ship; it bites the moment anything reads `n >= 2`, which
 * is the depth work now starting.
 *
 * A default that is free today and sound tomorrow beats one that is free today
 * and wrong tomorrow. The choice is recorded here rather than left to a switch
 * so that the depth work inherits a premise it can trust.
 *
 * ── THE SECOND SEAM, AND WHY IT IS NOT A SWITCH EITHER ─────────────────────
 *
 * Feeding the cloud the truth about tier changes what the search BELIEVES; the
 * tier-window filter in `candidates.ts` changes what it is allowed to CONSIDER.
 * One is a correction, the other is a policy, and `CENTAUR_TIER_DEFENSE` let an
 * arm separate them. The policy ships ON and has since Stage 3; it is now a
 * plain `DEFAULT_KNOBS` default (`tierSafeStaging`, `selfDebuffOrdering`) like
 * every other candidate-layer policy, which a `BotConfig` overrides by naming
 * the knob. The seam survives; the environment variable does not.
 *
 * ── WHERE THIS IS GOING ────────────────────────────────────────────────────
 *
 * The core redesign (§1.4) sentences potion-tier modelling to socket-3 entries
 * carrying their own records. Until an entry exists to carry it, the truth the
 * substrate feeds the cloud is a kernel premise and not a strategy: it decides
 * what is TRUE about the board, not what is worth doing about it, and by the
 * seam rule ("if it can change a sound bound, it is kernel") it could not be a
 * slot entry in any case.
 */

/** What the substrate feeds the cloud layer about tier.
 *
 * Retained as a type because the scout's door still names it and because a
 * later socket-3 entry will carry it as a param. There is one shipped value. */
export type TierTruth = 'off' | 'expiry' | 'full';

/**
 * THE PREMISE, and it is a constant. `full` feeds real expiry AND the real
 * potion board — see the header for why that is both free at ply 1 and the only
 * sound reading past it.
 */
export const TIER_TRUTH: TierTruth = 'full';

/** Does the search get the real expiry turn, or the old permanent-tier lie? */
export function tierExpiryEnabled(mode: TierTruth = TIER_TRUTH): boolean {
  return mode !== 'off';
}

/** Does the cloud premise get the real potion board? */
export function potionBoardEnabled(mode: TierTruth = TIER_TRUTH): boolean {
  return mode === 'full';
}
