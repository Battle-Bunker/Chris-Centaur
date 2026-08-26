/**
 * CALIBRATION, AS DATA.
 *
 * Every number here was paid for by a measurement somewhere, and every one of
 * them is a knob rather than a constant so the measurement can be repeated
 * against a different criterion profile. Nothing in this file is code; the
 * point is that a re-calibration is a diff to a table, not a diff to a fold.
 *
 * ── THE FOUR CALIBRATION FACTS ─────────────────────────────────────────────
 *
 * 1. THE CLIFF IS DENOMINATED IN THE MATERIAL IT LOSES. Survival carries the
 *    same weight as material, because any other setting makes two terms
 *    disagree about the same event — and with a large FIXED death scale,
 *    *dying is cheaper than being in danger*: a dead unit is simply absent from
 *    the next position and its cliff stops firing. That failure mode was
 *    measured, not theorised. Here the two are not even separate features: the
 *    engine's own subject-frame fold prices a contingent unit at the cliff
 *    inside the material interval, which is the same fact expressed so that
 *    they cannot drift apart.
 *
 * 2. TERMINAL CLAMPS ARE ORDERED, NOT ADDITIVE. A team whose last unit dies has
 *    lost, whatever happened to anyone else — so mutual annihilation is a LOSS,
 *    not a wash. Scoring the two clamps additively made them cancel, and the
 *    blunder attribution put the entire cost of every blunder on that one line:
 *    the evaluator was happily trading its own last unit for the opponent's.
 *    Fixing the ordering moved optimality 78.9% → 81.3% and blunders
 *    4.4% → 3.1% in one change.
 *
 * 3. DEAD IS A LATTICE BOTTOM, NEVER A SCALAR ON THE HEURISTIC SCALE. A large
 *    finite penalty inverts the cliff the moment another term outgrows it.
 *
 * 4. THE VOCABULARY IS CLASS-LEVEL, NOT KIND-LEVEL. Nothing here branches on
 *    "rook" or "knight"; features read properties the rules read — occupancy
 *    shape, whether staying is legal, what movement costs, whether the unit is
 *    royal. Kind-level specialisation lost its own agreement study; exactly
 *    three specialist items survived, and they are below, as data rows.
 */

/**
 * Default feature weights. Non-negative by contract — a penalty feature returns
 * negative numbers itself.
 *
 * `material` dominates by an order of magnitude because it is the only term
 * denominated in the thing the game is actually won with, and because the cliff
 * lives inside it. Everything else exists to order moves that material ties.
 */
export const DEFAULT_WEIGHTS: Readonly<Record<string, number>> = {
  /** Subject-frame material with the survival cliff already folded in. */
  material: 10,
  /**
   * Contested reach under the two-plane partition. ONE is the value the
   * measured head-to-head win was obtained at (paired, side-swapped, 22 seeds,
   * +1.59 [+1.00, +2.14] in paired score against the material-only profile),
   * and it sits an order of magnitude inside the cliff ceiling below.
   */
  reach: 1,
  /**
   * Per-unit room — the death predictor. Territory-count carries the food and
   * growth share of the deficit; this carries the ~20–24% that is deaths, and
   * a team partition structurally cannot see it. Three is a starting point
   * backed by the acceptance positions and by the cliff inequality, and NOT
   * (yet) by a head-to-head of its own: say so rather than implying otherwise.
   */
  room: 3,
  /** Health as a movement budget, not a clock. */
  healthEconomy: 0.5,
  /** The king-weight margin (specialist row 2). Deliberately small. */
  kingMargin: 0.25,
};

/**
 * THE CLIFF INEQUALITY — the one thing that turns "territory is a tie-breaker"
 * from a convention into a checked invariant.
 *
 *     w_feature × (observed range of the feature across candidates)
 *         <  10 × (lightest unit weight)
 *
 * The binding constraint is not the cliff itself: the cliff is preserved at any
 * weight, by construction. A contingent unit of ours has `worstAlive = false`,
 * so it is dropped from `lo` by the SAME predicate material uses — territory of
 * a unit that might die is zero in the floor, exactly as its material is. What
 * needs protecting is the TRADE: an ordering term must never outrank a
 * contingent death, and losing the lightest possible unit costs
 * `10 × weight`. Terminal outcomes need no protection at all, because DEAD is a
 * lattice bottom applied by replacement and never by addition.
 *
 * `src/tests/territory-acceptance.test.ts` measures the observed range on the
 * acceptance boards and asserts this for both territory features.
 */
export const CLIFF_MATERIAL_WEIGHT = 10;

/**
 * How many turns ahead the reach flood runs. Shells are keyed by ABSOLUTE
 * turn, so a unit held since turn 7 and read at turn 10 gets its three turns of
 * head start as a SEED rather than as an inexpressible negative delay. That
 * seeding is also what fixes the knight's shape: membership saturates and stops
 * discriminating, but the arrival gradient survives saturation.
 */
export const REACH_HORIZON_TURNS = 4;

/**
 * THE THREE SPECIALIST FACTS, imported as data rows rather than as code paths.
 * The rest of the kind catalog lost its own agreement study and is excluded.
 */
export interface SpecialistFact {
  readonly id: string;
  readonly claim: string;
  /** Where it enters the system. Never a branch on a kind name. */
  readonly carriedBy: string;
}

export const SPECIALIST_FACTS: ReadonlyArray<SpecialistFact> = [
  {
    id: 'fatal-but-winning-trade',
    claim:
      'A weight-1 unit stepping onto the last enemy king at equal tier kills both — and ' +
      'ends their team. Every value-symmetric evaluator refuses it: one death each reads ' +
      'as neutral and the survival term then vetoes it. Getting it right needs to know ' +
      'that one of those two deaths ends a team.',
    carriedBy:
      'the ORDERED terminal clamps: our own elimination is checked first, so a trade that ' +
      'ends their team while ours still stands is a win, and a mutual one is a loss',
  },
  {
    id: 'king-weight-margin',
    claim:
      'A king should eat. Under these rules a king does not have to be outweighed to ' +
      'die — an equal-tier tie kills everyone — so the only protections are ' +
      'unreachability, out-weighing everything that reaches you, and tier. Weight is the ' +
      'one of those three the king can buy.',
    carriedBy: 'the kingMargin feature: king weight minus the heaviest same-tier reacher',
  },
  {
    id: 'escort-ray-shadowing',
    claim:
      'The only protection geometry these rules admit. An ally standing IN an enemy ' +
      "slider's line truncates it, because occupancy never clears mid-turn under frozen " +
      'state. Standing NEXT to the king does nothing: there is no recapture, so a defended ' +
      'square is not a protected one. This is the opposite of the chess intuition.',
    carriedBy: 'a candidate ORDERING hint in ../candidates.ts — never a bound',
  },
];

/**
 * The harness-criterion profile. Regret is only meaningful against what the bot
 * actually maximises, so the profile is pluggable and the evaluation harness is
 * expected to pass the same one the search used.
 */
export interface CriterionProfile {
  readonly name: string;
  readonly weights: Readonly<Record<string, number>>;
  readonly reachHorizonTurns: number;
  /**
   * Whether `kingMargin` counts OUR OWN units among the things that can stand
   * on our king's square next turn. These rules have no friendly-fire
   * exemption, so the honest answer is yes; left undefined the profile defers
   * to `CENTAUR_ROYAL_MARGIN`, which defaults to the behaviour that shipped.
   */
  readonly royalReachers?: boolean;
}

/**
 * THE PRODUCTION PROFILE. Territory-carrying, because the deficit against the
 * legacy path was measured to be in the OBJECTIVE and not in the search: a
 * material-only maximin is blind to food more than one move away and to a unit
 * suffocating five turns before it dies, and it plays positionally passive over
 * thirty turns as a result.
 *
 * No food weight on territory: measured worthless at the sound floor, because a
 * floor concedes every cell an optimistic enemy could beat you to and food is
 * precisely what both sides run at (the floor owned 0.08 food cells per board
 * and conceded 0.62; the argmax moved in 1 of 48 samples). The food race is
 * bought INDIRECTLY, through the ordering.
 *
 * No horizon discounting: Kendall τ 0.96–1.00 against the undiscounted argmin.
 * It is a re-parameterisation of the same ordering, not information.
 */
export const TERRITORY_PROFILE: CriterionProfile = {
  name: 'lobster-territory',
  weights: DEFAULT_WEIGHTS,
  reachHorizonTurns: REACH_HORIZON_TURNS,
};

export const DEFAULT_PROFILE: CriterionProfile = TERRITORY_PROFILE;

/** Material only — the profile a differential or a 1 ms reflex rung wants, and
 * the explicit fallback if the territory profile ever has to be backed out. */
export const MATERIAL_ONLY_PROFILE: CriterionProfile = {
  name: 'material-only',
  weights: { material: 10, reach: 0, room: 0, healthEconomy: 0, kingMargin: 0 },
  reachHorizonTurns: 0,
};
