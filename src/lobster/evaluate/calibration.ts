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

// TYPE-ONLY, and it only ever runs one way: `contracts.ts` knows nothing about
// this file. The cohort registry lives here because a cohort IS a calibration
// row — the objective and the numbers that define it are one thing — and the
// id's type lives in `contracts` because the `Assumption` union needs it.
import type { AdmissionConditions, Assumption, CohortId, CohortLadder } from '../contracts';

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
  /**
   * The piece-command term — OFF here, and off is the honest default: it is
   * the slider repair, and it has its own profile so the two can be measured
   * against each other. See `TERRITORY_SLIDER_PROFILE`.
   */
  command: 0,
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
 * EVERY FEATURE KEY THE LIBRARY DEFINES, in the fold's summation order.
 *
 * It lives here, as data, rather than being read off `FEATURES` — `features.ts`
 * imports this file, so the dependency only runs one way. A test pins the two
 * lists equal so they cannot drift.
 */
export const ALL_FEATURE_KEYS: ReadonlyArray<string> = [
  'material',
  'reach',
  'room',
  'healthEconomy',
  'kingMargin',
  // The slider repair's gradient. It joins the list because the list is
  // FEATURES' own fold order and a test pins the two equal — not because every
  // profile scores it. `TERRITORY_PROFILE` invokes it and weights it ZERO, so
  // it is computed and folded as an exact zero; `commandFeature` returns
  // `point(0)` in one branch when the profile carries no `command` knobs, so
  // the compute the invoked gate now admits costs a null check. The profile
  // that actually pays for it is `TERRITORY_SLIDER_PROFILE`.
  'command',
];

/** The invoked set of a profile that computes everything. */
export const ALL_FEATURES: ReadonlySet<string> = new Set(ALL_FEATURE_KEYS);

/**
 * The harness-criterion profile. Regret is only meaningful against what the bot
 * actually maximises, so the profile is pluggable and the evaluation harness is
 * expected to pass the same one the search used.
 *
 * ── WHY `invoked` IS NOT `weights[k] !== 0` ────────────────────────────────
 *
 * A zero weight is a SCORING switch: the fold skips the addition and pays the
 * evaluation anyway — `ctx.shells()`, `ctx.partition()`, the whole two-plane
 * sweep. `invoked` is the COMPUTE switch: a key outside it is never handed to
 * `evaluateFeature` at all and writes no `parts` entry, so an evaluator that
 * does not want territory does not pay for territory. The two are independent
 * on purpose — a feature may be invoked and weighted zero (measure it without
 * scoring it), and it is a contradiction to weight a key that is not invoked,
 * which `assertProfileCoherent` refuses.
 *
 * `reachHorizonTurns` is now ONLY the reach flood's depth. It used to double as
 * the off-switch for the three shell-reading features — that is what made
 * `MATERIAL_ONLY_PROFILE` accidentally cheap — and it cannot express per-feature
 * choice ("reach off, room on" is inexpressible in one shared knob). Profiles
 * that still set it to 0 keep exactly their old numbers; the guards inside
 * `reachFeature`/`roomFeature`/`kingMarginFeature` stay for that compatibility
 * and are documented there as horizon semantics, not as gating.
 */
export interface CriterionProfile {
  readonly name: string;
  readonly weights: Readonly<Record<string, number>>;
  /** The COMPUTE gate: keys outside this set are never evaluated. */
  readonly invoked: ReadonlySet<string>;
  /** The reach flood's depth. No longer a gate. */
  readonly reachHorizonTurns: number;
  /**
   * Whether `kingMargin` counts OUR OWN units among the things that can stand
   * on our king's square next turn. These rules have no friendly-fire
   * exemption, so the honest answer is yes; left undefined the profile defers
   * to `CENTAUR_ROYAL_MARGIN`, which defaults to the behaviour that shipped.
   */
  readonly royalReachers?: boolean;
  /**
   * The piece-command term's two multipliers, or `undefined` to leave the
   * feature switched off (its evaluation then costs one branch). See
   * `commandFeature` for what the two count.
   */
  readonly command?: CommandKnobs;
  /**
   * Fraction of a kind's max health below which the movement budget starts to
   * bind, for kinds that may DECLINE to spend it (`stayLegal`). `undefined`
   * keeps the linear reading for every kind — today's behaviour.
   */
  readonly healthReserveRatio?: number;
}

/** What a piece's next-turn command set is counted for, and for whom. */
export interface CommandKnobs {
  /** Multiplier on contested ground: cells a trail unit also reaches. */
  readonly ground: number;
  /** Multiplier on food cells inside the command set. */
  readonly food: number;
  /**
   * Whether a ROYAL unit earns command. Off — and the honest account of why is
   * that the ARGUMENT survived and the MEASUREMENT did not settle it.
   *
   * The argument: a king's only protections under these rules are
   * unreachability, out-weighing everything that reaches it, and tier
   * (`SPECIALIST_FACTS` king-weight-margin). A term that pays a unit for the
   * ground it can act on pays it, in exactly those units, for giving up the
   * first of the three — and a king's death is TERMINAL, a lattice element and
   * not something a positional term may trade against.
   *
   * The measurement, and it is a negative one. `TERRITORY_SLIDER_ROYAL_PROFILE`
   * lifts this flag; run as a third concurrent arm on `s3-mix23-base` at 150 ms
   * over 16 seed blocks a side, it moves the king's stay share by
   * +2.2 points [-4.0, +8.3], its deaths by 0.00 per block [-0.375, +0.375],
   * and placement by +0.052 [-0.104, +0.188] — i.e. the flag is close to inert
   * and what signal there is points the other way. The king's real activation
   * under this profile comes from `healthReserveRatio`, which applies to every
   * stay-legal kind: its stay share falls 80.4% -> 59.3% with THIS flag already
   * off.
   *
   * An earlier, louder reading (stay 90.8% -> 80.8%, deaths 17 -> 24) came from
   * a run whose two arms were sequential on a machine carrying six other
   * sweeps, and it did not survive a paired-concurrent rerun. It is recorded
   * here because it is what the flag was originally set on.
   *
   * So: off, on the argument, with the ablation arm kept so the next person can
   * settle it at a block count that resolves 0.05.
   */
  readonly royal: boolean;
}

/**
 * A profile that scores a key it never computes is asking for a number that
 * does not exist. Checked at construction rather than discovered as a silently
 * missing addend.
 */
export function assertProfileCoherent(p: CriterionProfile): CriterionProfile {
  for (const [key, w] of Object.entries(p.weights)) {
    if (w !== 0 && !p.invoked.has(key)) {
      throw new Error(
        `profile ${p.name} weights ${key} at ${w} but does not invoke it: ` +
          'a weighted key must be computed'
      );
    }
  }
  return p;
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
export const TERRITORY_PROFILE: CriterionProfile = assertProfileCoherent({
  name: 'lobster-territory',
  weights: DEFAULT_WEIGHTS,
  invoked: ALL_FEATURES,
  reachHorizonTurns: REACH_HORIZON_TURNS,
});

export const DEFAULT_PROFILE: CriterionProfile = TERRITORY_PROFILE;

/**
 * ── THE SLIDER REPAIR ──────────────────────────────────────────────────────
 *
 * The territory profile beats material on every board with no slider on it and
 * loses on every board with one, at every budget from 150 ms to 1500 ms. The
 * budget ladder ruled search starvation out; these two numbers say what is left,
 * measured over 1 610 (position, piece) samples on the ladder's own replays,
 * sweeping ONE piece across its own legal options with the joint context fixed:
 *
 *   the weighted spread of `reach` over a slider's own options   0.0000–0.0076
 *   the weighted spread of `healthEconomy` over the same options 0.2300–0.3700
 *
 * Inside the material-tie class — which is exactly the class `est` orders — the
 * median spread of `reach` is ZERO for the rook, the knight, the king and the
 * pawn and ONE BOARD CELL for the queen, while `healthEconomy` spreads
 * 0.030–0.045. Read directly off the partition: `ours` and `theirs` do not move
 * by a single cell across all 71 of a queen's legal actions.
 *
 * The cause is structural rather than a tuning miss. Plane 2 credits a piece
 * where `arrival_p(c) ≤ D(c)`, and a slider's arrival is ≤ 2 turns to nearly
 * every cell FROM ANYWHERE — so the displacement set is saturated and carries
 * no gradient in the slider's own position. `room` is plane 1 only, so it is
 * identically zero for a piece. That leaves `healthEconomy` as the ONLY term
 * with dynamic range over a slider's move, and it is a linear travel tax: the
 * territory profile's est-argmax is the shortest-travel option among material
 * ties in 73–96% of positions. The evaluator is not indifferent to slider
 * activity. It is against it.
 *
 * So the repair is two changes, and neither one touches a board with no piece
 * on it:
 *
 *   1. `command` — the gradient plane 2 structurally cannot carry. A piece is
 *      worth the CONTESTED ground it can act on next turn plus the food it can
 *      take, which is position-dependent where arrival-by-D is not.
 *   2. `healthReserveRatio` — health is a movement budget for a kind that may
 *      decline to spend it, and a budget's marginal value rises as it runs out.
 *      A linear `health/max` prices the 98th health point exactly like the 2nd,
 *      which is what turned a survival term into a travel tax. Below the
 *      reserve the term is sharper than it was; above it, flat.
 *
 * Both are gated on class properties the rules already carry (`leavesTrail`,
 * `stayLegal`), so on an all-snake board this profile is bit-identical to
 * `TERRITORY_PROFILE` — asserted, not asserted-by-comment, in
 * `src/tests/territory-slider.test.ts`.
 */
export const COMMAND_KNOBS: CommandKnobs = { ground: 1, food: 20, royal: false };

/**
 * Half a kind's maximum. A piece at or above it has a movement budget that does
 * not bind — nothing it can do this turn brings it near exhaustion — and below
 * it the term slides to zero twice as fast as the linear reading did.
 */
export const HEALTH_RESERVE_RATIO = 0.5;

export const TERRITORY_SLIDER_PROFILE: CriterionProfile = assertProfileCoherent({
  name: 'lobster-territory-x',
  weights: { ...DEFAULT_WEIGHTS, command: 2 },
  // MERGE NOTE (arch/s3). The repair landed on a tree that had no compute gate,
  // where every profile computed every feature. On this tree `invoked` is the
  // compute switch (S0a), so the repair has to NAME the set it computes or
  // `assertProfileCoherent` refuses it for weighting `command` at 2 without
  // invoking it. It computes everything the territory profile computes plus
  // `command` — which is `ALL_FEATURES` — so this is the same objective the
  // sweep raced, said in the vocabulary this tree uses.
  invoked: ALL_FEATURES,
  reachHorizonTurns: REACH_HORIZON_TURNS,
  command: COMMAND_KNOBS,
  healthReserveRatio: HEALTH_RESERVE_RATIO,
});

/**
 * THE ABLATION ARM. Identical to the repair except that a royal unit earns
 * command too. It exists so `CommandKnobs.royal` is a measured ruling rather
 * than an argued one — the king is the one piece whose activity trades against
 * a terminal, and a knob that is off on reasoning alone is a knob nobody has
 * checked. Not a production profile.
 */
export const TERRITORY_SLIDER_ROYAL_PROFILE: CriterionProfile = assertProfileCoherent({
  ...TERRITORY_SLIDER_PROFILE,
  name: 'lobster-territory-a',
  command: { ...COMMAND_KNOBS, royal: true },
});

/**
 * Material only — the profile a differential or a 1 ms reflex rung wants, and
 * the explicit fallback if the territory profile ever has to be backed out.
 *
 * `invoked` names what this profile ALREADY computed before the gate existed,
 * so the numbers are unchanged: `reachHorizonTurns: 0` short-circuited `reach`,
 * `room` and `kingMargin` to a point at zero, while `healthEconomy` — which has
 * no horizon guard — was evaluated in full and then dropped by its zero weight.
 * The gate now says that in one place instead of two, and `reachHorizonTurns`
 * is kept at 0 only so the profile is bit-identical under BOTH mechanisms.
 *
 * MERGE NOTE (arch/s3): `command` joins the weight vector at zero, from the
 * slider repair's side of the merge, and stays OUT of `invoked` — the same
 * treatment `reach`/`room`/`kingMargin` already get here. `commandFeature`
 * would return `point(0)` anyway (`horizonTurns <= 0`), so the profile is
 * bit-identical under both mechanisms with the key present or absent.
 */
export const MATERIAL_ONLY_PROFILE: CriterionProfile = assertProfileCoherent({
  name: 'material-only',
  weights: { material: 10, reach: 0, room: 0, healthEconomy: 0, kingMargin: 0, command: 0 },
  invoked: new Set(['material', 'healthEconomy']),
  reachHorizonTurns: 0,
});

/**
 * THE BASE COHORT'S PROFILE — everything except the territory bundle.
 *
 * ── WHY IT IS NOT `DEFAULT_WEIGHTS` ────────────────────────────────────────
 *
 * The architecture sketch gave this row `weights: DEFAULT_WEIGHTS` with
 * `invoked: {material, healthEconomy, kingMargin}`. That row cannot be
 * constructed: `DEFAULT_WEIGHTS` weights `reach` at 1 and `room` at 3, and
 * `assertProfileCoherent` THROWS on a profile that scores a key it never
 * computes. So the row carries its own weight vector, holding exactly the
 * three keys it invokes.
 *
 * ── WHY THE THREE SHARED WEIGHTS ARE THE SAME NUMBERS ──────────────────────
 *
 * They are `DEFAULT_WEIGHTS`' own values, unchanged, because base is not a
 * different calibration — it is the territory objective with the two territory
 * features removed. Re-tuning `material`, `healthEconomy` or `kingMargin` here
 * would make base a third bot nobody has raced, would break the arithmetic
 * that lets one ladder's rungs be talked about together at all, and would put
 * two numbers denominated differently in front of the same stager. The one
 * thing this row is allowed to differ in is WHICH features exist.
 *
 * ── WHAT IT COSTS, STATED HONESTLY ─────────────────────────────────────────
 *
 * This cohort SKIPS THE PARTITION, not the shells. `kingMarginFeature` reads
 * `ctx.shells()` directly to ask what reaches the king's square, so on a board
 * where the subject has a live king the base cohort still pays the full
 * dilation-shell build; what it does not pay is the two-plane partition and
 * the reach flood's per-unit sweep, which is where the territory bundle's cost
 * actually is. On a kingless board `kingMarginFeature` returns early and the
 * shells are never touched. Anyone quoting "base ≈ material + shells only"
 * should quote it that way and not as "shells-free".
 *
 * `reachHorizonTurns` stays at the production depth and is NOT zeroed:
 * `kingMarginFeature` carries the same legacy `horizonTurns <= 0` guard the
 * two territory features do, so zeroing it here would silently delete the one
 * specialist fact this cohort exists to keep.
 */
export const BASE_PROFILE: CriterionProfile = assertProfileCoherent({
  name: 'lobster-base',
  weights: { material: 10, healthEconomy: 0.5, kingMargin: 0.25 },
  invoked: new Set(['material', 'healthEconomy', 'kingMargin']),
  reachHorizonTurns: REACH_HORIZON_TURNS,
});

// ------------------------------------------------------------ the cohort table

/**
 * THE COHORT REGISTRY — objectives as data rows, exactly as the profiles are.
 *
 * A cohort is a named objective: one `CriterionProfile`, and therefore one
 * invoked feature set, one weight vector, one flood depth. Its `id` is what
 * rides on every bound proved under it (`Assumption` kind `"cohort"`), what a
 * refit corpus groups on, and what an operator reads six months later — so it
 * is stable, it is short, and it is never derived from the profile's `name`.
 *
 * ── THE TABLE IS A CATALOGUE, NOT A POLICY ─────────────────────────────────
 *
 * Stage 1 shipped one row because there was nothing to choose with. Stage 2
 * adds `base` beside `territory`, and the two rows are listed in ASCENDING
 * COST — which is also ladder order, cheapest and always-admitted first.
 *
 * Registering a row is not admitting it. Nothing in this system picks a cohort
 * except the admission policy, and that policy ships OFF: with it off the
 * decision opens under `DEFAULT_COHORT_ID` and no board can move it, exactly
 * as before. The flag gates the POLICY and never the table, deliberately — a
 * flag that made the table one row long would mean the shipping build never
 * ran `base` through the per-cohort law harness, and the first thing a
 * default-on flip would do is put an objective no gate had ever checked in
 * front of the stager.
 *
 * The `territory` id is not a placeholder: the default profile IS the
 * territory profile, so naming the shipped objective after what it actually
 * computes meant Stage 2 could add `base` beside it and rename nothing, and no
 * historical corpus carries an id retired for having been a placeholder.
 *
 * ADDING A ROW: add it here, give it a profile that `assertProfileCoherent`
 * accepts, add the ladder rows that can admit it, and the per-cohort law
 * harness and the per-cohort summed cliff assertion pick it up. Nothing else
 * in the system learns a new name (anti-spaghetti rule 12).
 */
export interface CohortRow {
  /** Stable, corpus-visible identity. Never re-used for a different objective. */
  readonly id: CohortId;
  readonly profile: CriterionProfile;
}

/**
 * The invoked keys of a profile, sorted — the `features` list an `Assumption`
 * carries. Sorted so the list is a canonical account of the objective and not
 * an artefact of `Set` insertion order.
 */
export function invokedFeaturesOf(p: CriterionProfile): ReadonlyArray<string> {
  return [...p.invoked].sort();
}

/** The always-admitted floor of every ladder. Adjudicates; never gated off. */
export const BASE_COHORT_ID: CohortId = 'base';

/** The territory-carrying objective — the production default. */
export const TERRITORY_COHORT_ID: CohortId = 'territory';

export const COHORTS: ReadonlyArray<CohortRow> = [
  { id: BASE_COHORT_ID, profile: BASE_PROFILE },
  { id: TERRITORY_COHORT_ID, profile: TERRITORY_PROFILE },
];

/**
 * The cohort a decision opens under when its caller names none AND no policy
 * chooses one. It is `territory` and not `base` because that is what shipped:
 * turning the policy off must leave the decision exactly where it was.
 */
export const DEFAULT_COHORT_ID: CohortId = TERRITORY_COHORT_ID;

/**
 * THE REGISTRY LOOKUP, AND WHY IT TAKES THE REGISTRY.
 *
 * `COHORTS` is the production table and the default everywhere. The table is a
 * PARAMETER rather than an ambient global because the alternative — a
 * module-scope registry a caller can add rows to — is the arena latch this
 * codebase has been bitten by before: one decision's registration would be
 * every concurrent decision's, and a per-game cohort policy (the shape Stage 2
 * needs, since a process-wide flag measures nothing) would be inexpressible.
 * The kernel holds its registry as an option, a test passes its own, and
 * nothing mutates a shared table.
 *
 * A call site that builds its own profile instead of naming a row has left the
 * table behind, and the table is where the measurement that paid for each row
 * lives.
 */
export function cohortRowIn(
  rows: ReadonlyArray<CohortRow>,
  id: CohortId
): CohortRow | undefined {
  return rows.find((c) => c.id === id);
}

/**
 * The registry is asked to name itself. Throws rather than returning a
 * fallback: a bound stamped with an objective nobody can look up is worse than
 * a decision that refuses to start, because it is indistinguishable from a
 * sound one until someone tries to compare it.
 */
export function requireCohortRowIn(rows: ReadonlyArray<CohortRow>, id: CohortId): CohortRow {
  const row = cohortRowIn(rows, id);
  if (row === undefined) {
    throw new Error(
      `unknown cohort ${JSON.stringify(id)}: registered cohorts are ` +
        (rows.length === 0 ? '(none)' : rows.map((c) => c.id).join(', '))
    );
  }
  return row;
}

/**
 * The `Assumption` a cohort rides as. ONE constructor, so no call site ever
 * assembles the variant by hand and no two of them can disagree about what
 * `features` means: it is the INVOKED set — what was actually computed — and
 * not the weighted set, which is a different and weaker claim, and was the
 * wrong one everywhere before the S0a compute gate existed.
 */
export function cohortAssumptionOf(row: CohortRow): Assumption {
  return { kind: 'cohort', id: row.id, features: invokedFeaturesOf(row.profile) };
}

// --------------------------------------------------------- the predicate table

/**
 * THE ADMISSION PREDICATE, AS DATA.
 *
 * One row per rule, in precedence order, each carrying the measurement that
 * paid for it. `admission.ts` walks this table and returns the first matching
 * row's ladder; it holds no rule of its own. Re-tuning the policy is a diff to
 * this table and to its tests (anti-spaghetti rule 12), and the corpus can be
 * re-analysed against a table row because the row is a value with a name.
 *
 * The predicate takes `AdmissionConditions` — measured board facts, no clock,
 * no budget. The type is imported TYPE-ONLY from `contracts`, so this file is
 * still pure data with no runtime edge to anything.
 */
export interface LadderRow {
  /** Short, stable, corpus-visible. Names the rule, not the outcome. */
  readonly id: string;
  /** Matches on measured board facts alone. Pure and total. */
  readonly when: (c: AdmissionConditions) => boolean;
  /** The rungs admitted when it matches, cheapest first. Never empty. */
  readonly ladder: CohortLadder;
  /** What paid for the row. A row without one is a guess wearing a table's clothes. */
  readonly evidence: string;
}

/**
 * WHERE THE TRAIL THRESHOLD COMES FROM.
 *
 * 37.3% of territory's own team-turns carry ZERO live trail units of its own,
 * and in those turns the `room` feature's own-side sum is empty by
 * construction and `reach` degenerates to the tie-dominated all-pieces reading.
 * The composite gate `ownTrail ≥ T ∧ ¬slider` was measured over 1,070 games /
 * 64,397 turns at three thresholds; T = 4 leaves the gate ON for 22.4% of
 * territory's decisions and flips mid-game in ~3% of its team-games — 0.101
 * flips per 100 team-turns, which is why no hysteresis is needed and why the
 * dwell guard below has nothing to suppress at this tenant's settings.
 */
export const OWN_TRAIL_ADMISSION_THRESHOLD = 4;

export const ADMISSION_LADDERS: ReadonlyArray<LadderRow> = [
  {
    id: 'slider-or-pre-arm',
    // THE PRE-ARM IS THE SECOND DISJUNCT, and it is not a separate rule: A3's
    // recommendation is to treat `promotionImminent` AS slider presence, so
    // that the one transition that actually happens in this corpus — a pawn
    // promoting to a queen — occurs BETWEEN turns, one turn early, and never
    // inside one. Promotion is a plan-space event (a promoted queen multiplies
    // the joint plan space ~13×), which is exactly why the material-
    // denominated evaluator never sees it coming.
    when: (c) => c.sliderPossible || c.promotionImminent,
    ladder: [BASE_COHORT_ID],
    evidence:
      '940 games: the OFF arm is lobster-material, raced 707 times in slider worlds ' +
      '(paired score -0.347) and 233 times slider-free (+0.275). Board-level slider ' +
      'presence flipped 0 times in 767 slider-roster games; the only way one appears ' +
      'is promotion (10 promotions / 1,070 games, all in slider-free rosters).',
  },
  {
    id: 'thin-trail-roster',
    when: (c) => c.ownTrailCount < OWN_TRAIL_ADMISSION_THRESHOLD,
    ladder: [BASE_COHORT_ID],
    evidence:
      "territory's own live trail count over 63,379 team-turns: 0 -> 37.3%, 1 -> 20.8%, " +
      '2 -> 11.0%, 3 -> 4.8%, then 4+ -> 26.1%. Below the threshold room sums over an ' +
      'empty own side and reach degenerates to the tie-dominated all-pieces reading.',
  },
  {
    id: 'default-admit-territory',
    when: () => true,
    ladder: [BASE_COHORT_ID, TERRITORY_COHORT_ID],
    evidence:
      'the shipped default: TERRITORY_PROFILE is what the 2026-08-26 flag gate measured ' +
      '(snake-only pooled, 32 seeds, paired score +0.81 [+0.44, +1.19]).',
  },
];
