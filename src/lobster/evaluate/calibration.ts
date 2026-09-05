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
  energyEconomy: 0.5,
  /** The king-weight margin (specialist row 2). Deliberately small. */
  kingMargin: 0.25,
  /**
   * The piece-command term — SEATED. See THE SLIDER REPAIR below for the
   * measurement, and `docs/BASIC-INTELLIGENCE.md` for why it was promoted from
   * an unseated arm to the production default: with it at zero, every option a
   * piece has scores identically, and a pawn spends the game rotating on the
   * spot because the tie-break is all that is left to decide anything.
   */
  command: 2,
  /**
   * The food gradient. Four, because the term's whole range is [0, 1] by
   * construction — so 4 x 1 still sits well inside the cliff ceiling of
   * `10 x lightest unit weight` and can never buy a unit's life — while the
   * per-STEP signal it has to beat is the spread of `reach` and `room` across
   * one unit's own options, which is around a tenth. See `./food.ts`.
   */
  food: 4,
  /**
   * Momentum: the anti-dither term. One, on the same argument — a whole unit
   * reversing costs `1 / |ours|`, which breaks a tie and cannot reach anything
   * real. See `./momentum.ts`.
   */
  momentum: 1,
  /**
   * Contest avoidance. THREE, and the number is a gate rather than a taste:
   * the term's range is [-1, 0] by construction, so `3 x 1` sits well inside
   * the cliff ceiling of `10 x lightest unit weight` and can never buy a
   * unit's life; it clears `momentum` (1) and the spread of `reach` and `room`
   * across one unit's own options (about a tenth) so it decides among moves
   * those terms tie; and it sits UNDER `food` (4), whose pull reaches 1 for a
   * starving unit — so a hungry unit still takes a contested meal and a
   * healthy one declines it. See `./contest.ts`.
   */
  contest: 3,
  /**
   * Tier value. TWO, and the placement between `momentum` and `contest` is the
   * whole calibration:
   *
   * · the term's range is [-1, 1] by construction (one unit's edge is at most
   *   1, divided by our unit count), so `2 x 1` sits an order of magnitude
   *   inside the cliff ceiling of `10 x lightest unit weight` and can never
   *   buy a unit's life;
   * · it clears `momentum` (1) and the spread of `reach` and `room` across one
   *   unit's own options (about a tenth), so it decides among moves those
   *   terms tie — which is the point, since acquiring a window is otherwise
   *   invisible to every term in the fold;
   * · it sits UNDER `contest` (3), which prices the arrival-turn verdict this
   *   one only explains. Above it, a unit would walk into a square it loses in
   *   order to be holding a buff there, which inverts the term's own reason
   *   for existing;
   * · and under `food` (4), for the reason `contest` is: a hungry unit eats
   *   rather than chasing a potion.
   *
   * Identically zero on a board with no live effect and no live potion, so
   * every measurement taken on the potion-free scenarios is unaffected by it.
   * See `./tier.ts`.
   */
  tier: 2,
  /**
   * The energy price. EIGHT, and the number is set by the term it has to
   * clear rather than by taste: a hold pays `momentum`'s idleness charge
   * (`1 x 0.5`), both terms divide by the same `|ours|` so the division
   * cancels, and a hold therefore beats a move exactly when
   * `w x cost > 0.5` — at eight, when the move burns more than a sixteenth of
   * the unit's runway at full price. The canonical case (a slider at 60
   * health, no meal inside its runway, a seven-cell slide against a hold)
   * prices at 0.074 and clears it; nothing much smaller does. The term's range
   * is [-1, 0] by construction, so `8 x 1` still sits under the cliff ceiling
   * of `10 x lightest unit weight` and can never buy a unit's life. See
   * `./energy.ts`.
   */
  energy: 8,
  /**
   * The pickup trade. TWO, matching `tier`, and for the same reasons plus one
   * of its own:
   *
   * · the term's range is [−2, 1] by construction — the collector's peril is a
   *   share in [0, 1] scaled by `PERIL_WEIGHT`, each ally's profit is a share
   *   in [0, 1], and the whole sum is divided by our unit count — so `2 × 2`
   *   sits well inside the cliff ceiling of `10 × lightest unit weight` and can
   *   never buy or sell a unit's life;
   * · it must be able to OUTWEIGH `tier` on the same pickup, or the fold could
   *   never decline one: `tier` prices the +1 an ally gains at its own cell and
   *   nothing else about the trade, and at equal weight a term whose peril half
   *   reaches 2 covers a `tier` credit that reaches 1;
   * · and it sits under `contest` (3) and `food` (4) like everything else that
   *   orders moves: a unit does not walk into a lost square, or past a meal it
   *   needs, to arrange a window for somebody else.
   *
   * Identically zero on a board with potions off or none standing, and zero
   * again on any plan that collects nothing — so it is dark on every scenario
   * but `potions`. See `./potion.ts`.
   */
  potion: 2,
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
 * SURVIVAL DEGREE κ — the ONE knob of `docs/design/DEEP-DEATHS.md` §6.
 *
 * `ADMISSION.lo` (`evaluate/features.ts`) admits one of our units to the floor
 * with a BOOLEAN, and `DEEP-DEATHS` §5.3 measured what that costs: two plans
 * that put a unit on two different cells of the same contested fan give the
 * same `worstAlive`, so `material.lo` — the one term carrying the death cliff —
 * is the SAME NUMBER for both (identical on 24 of the 29 decisions that killed
 * at 4×), `better()` falls through it, and a margin of food decides which of
 * the two dies.
 *
 * κ grades that admission in the `lo` reading only. An admitted unit of ours
 * enters the material floor at survival weight
 *
 *     w = 1 − κ · c / R      c ≤ R,  w ∈ [1 − κ, 1]
 *
 * where R is the enemy replies the resolver enumerated on this board and `c`
 * how many of them beat that unit where the plan stages it, so `material`
 * charges `(1 − w)` of its weight against the plan that walks into the fan.
 *
 * ZERO IS THE SHIPPED VALUE and zero is byte-identical to the boolean: `w = 1`
 * for every admitted unit, and the grading code is not reached at all. The
 * knob is read off the profile (and so folds into `evaluationIdentity`,
 * which is what keeps two doses out of each other's evaluation memo);
 * `CENTAUR_SURVIVAL_DEGREE` seeds it once at module load so a sweep arm is a
 * run of the same build rather than a rebuild.
 *
 * See §10 of `docs/design/DEEP-DEATHS.md` for the per-κ measurement and for
 * which dose, if any, this constant is allowed to carry.
 */
export const SURVIVAL_DEGREE: number = readSurvivalDegree();

function readSurvivalDegree(): number {
  const raw = process.env.CENTAUR_SURVIVAL_DEGREE;
  if (raw === undefined || raw === '') return 0;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(
      `CENTAUR_SURVIVAL_DEGREE=${raw} is not a survival degree — κ is a fraction ` +
        'of one unit of material and must sit in [0, 1]'
    );
  }
  return v;
}

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
  readonly energyReserveRatio?: number;
  /**
   * `survivalDegree` κ ∈ [0, 1] — see `SURVIVAL_DEGREE` above. `undefined` is
   * κ = 0, the boolean admission that shipped, and a profile that never heard
   * of the knob therefore reads exactly as it did.
   */
  readonly survivalDegree?: number;
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
   * The measurement, and it is a negative one. `ROYAL_COMMAND_PROFILE`
   * lifts this flag; run as a third concurrent arm on `s3-mix23-base` at 150 ms
   * over 16 seed blocks a side, it moves the king's stay share by
   * +2.2 points [-4.0, +8.3], its deaths by 0.00 per block [-0.375, +0.375],
   * and placement by +0.052 [-0.104, +0.188] — i.e. the flag is close to inert
   * and what signal there is points the other way. The king's real activation
   * under this profile comes from `energyReserveRatio`, which applies to every
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
 * ── THE SLIDER REPAIR ──────────────────────────────────────────────────────
 *
 * The territory profile beats material on every board with no slider on it and
 * loses on every board with one, at every budget from 150 ms to 1500 ms. The
 * budget ladder ruled search starvation out; these two numbers say what is left,
 * measured over 1 610 (position, piece) samples on the ladder's own replays,
 * sweeping ONE piece across its own legal options with the joint context fixed:
 *
 *   the weighted spread of `reach` over a slider's own options   0.0000–0.0076
 *   the weighted spread of `energyEconomy` over the same options 0.2300–0.3700
 *
 * Inside the material-tie class — which is exactly the class `est` orders — the
 * median spread of `reach` is ZERO for the rook, the knight, the king and the
 * pawn and ONE BOARD CELL for the queen, while `energyEconomy` spreads
 * 0.030–0.045. Read directly off the partition: `ours` and `theirs` do not move
 * by a single cell across all 71 of a queen's legal actions.
 *
 * The cause is structural rather than a tuning miss. Plane 2 credits a piece
 * where `arrival_p(c) ≤ D(c)`, and a slider's arrival is ≤ 2 turns to nearly
 * every cell FROM ANYWHERE — so the displacement set is saturated and carries
 * no gradient in the slider's own position. `room` is plane 1 only, so it is
 * identically zero for a piece. That leaves `energyEconomy` as the ONLY term
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
 *   2. `energyReserveRatio` — health is a movement budget for a kind that may
 *      decline to spend it, and a budget's marginal value rises as it runs out.
 *      A linear `health/max` prices the 98th health point exactly like the 2nd,
 *      which is what turned a survival term into a travel tax. Below the
 *      reserve the term is sharper than it was; above it, flat.
 *
 * Both are gated on class properties the rules already carry (`leavesTrail`,
 * `stayLegal`), so a board with no piece on it scores exactly as it did
 * before either knob existed — asserted, not asserted-by-comment, in
 * `src/tests/territory-slider.test.ts`.
 */
export const COMMAND_KNOBS: CommandKnobs = { ground: 1, food: 20, royal: false };

/**
 * THERE IS NO `mobility` KNOB, AND THE ABSENCE IS A MEASUREMENT — BEHAVIOUR-AUDIT
 * D2. A third addend paying the command set's own cardinality `|F_u|` was built
 * exactly as D2's rule states it, swept at 0.25, 0.5 and 1 over `mixed` seeds 1-6
 * and `potions` seeds 1-3, and taken at no dose. It does what it was built to do —
 * the parked share falls at every dose and `longestPark` roughly halves — and it
 * pays for it in the one currency the owner's rule will not spend: `mixed`
 * bodyBlock deaths of PIECES go 0 -> 1 -> 3 -> 3 with the dose while the snakes'
 * own body deaths stay flat, because the cardinality is intersected with nothing
 * and so knows nothing about what is standing on the cells it counts. See D2's
 * STATUS section for the dose table; do not re-derive it from the prediction.
 *
 * THE MASKED INDICATOR FORM WAS THEN BUILT AND REFUSED TOO — BEHAVIOUR-AUDIT-2
 * P1. `m_u ∈ {0, 1}`, read from `queries.legalActions` so it is masked by the
 * perimeter, by occupancy and by the pawn-target set, at `mobility = 1`. It
 * answers D2's mechanism completely — `mixed` piece `bodyBlock`+`self` deaths
 * FELL 1 -> 0 and `potions` 2 -> 1, `snakes`/`sparse`/`sparse-lean` were
 * byte-identical, the law sweep's `command.hi` class fell 600 -> 558, and the
 * parking it was built for collapsed (`potions` longestPark 44 -> 7,
 * `immobileUnitTurns` 197 -> 83) — and it is refused for a DIFFERENT reason:
 * every death it adds is a `contest`. An unparked pawn spends its turns in the
 * open, `contest` prices an enemy ARRIVAL and not the standing exposure of a
 * piece that now crosses the board instead of hugging a wall, and `mixed`
 * deaths went 6 -> 7 on seeds 1-3 and 8 -> 9 on seeds 4-6, all of them
 * `contest`. P1's own counter predicted exactly that and said to refuse it.
 * See BEHAVIOUR-AUDIT-2.md P1's STATUS for the table.
 */

/**
 * Half a kind's maximum. A piece at or above it has a movement budget that does
 * not bind — nothing it can do this turn brings it near exhaustion — and below
 * it the term slides to zero twice as fast as the linear reading did.
 */
export const HEALTH_RESERVE_RATIO = 0.5;

/**
 * THE PRODUCTION PROFILE. Territory-carrying, because the deficit against the
 * legacy path was measured to be in the OBJECTIVE and not in the search: a
 * material-only maximin is blind to food more than one move away and to a unit
 * suffocating five turns before it dies, and it plays positionally passive over
 * thirty turns as a result.
 *
 * No food weight ON TERRITORY, and that measurement stands: a floor concedes
 * every cell an optimistic enemy could beat you to, and food is precisely what
 * both sides run at, so a territory reading of food collapses (the floor owned
 * 0.08 food cells per board and conceded 0.62; the argmax moved in 1 of 48
 * samples). What did NOT follow, and was wrongly concluded, is that food needs
 * no term at all. `food` (`./food.ts`) is not a territory reading and does not
 * ask who wins the race — it is a distance gradient over our own units' own
 * positions, and it is what a horizon-1 search cannot discover for itself. See
 * `docs/BASIC-INTELLIGENCE.md` for the traces that made the case.
 *
 * No horizon discounting: Kendall τ 0.96–1.00 against the undiscounted argmin.
 * It is a re-parameterisation of the same ordering, not information.
 */
export const TERRITORY_PROFILE: CriterionProfile = {
  name: 'lobster-territory',
  weights: DEFAULT_WEIGHTS,
  reachHorizonTurns: REACH_HORIZON_TURNS,
  // THE SLIDER REPAIR, SEATED. It used to live in a profile of its own so the
  // two could be measured against each other; the measurement is above, and
  // watching one game settled the rest — with `command` at zero every option a
  // piece has scores identically, so the tie-break decides and a pawn spends
  // the game turning on the spot (docs/BASIC-INTELLIGENCE.md). Both knobs are
  // gated on class properties the rules already carry, so a board with no piece
  // on it is unaffected by either.
  command: COMMAND_KNOBS,
  energyReserveRatio: HEALTH_RESERVE_RATIO,
  // THE GRADED ADMISSION, at its shipped dose. See `SURVIVAL_DEGREE`.
  survivalDegree: SURVIVAL_DEGREE,
};

export const DEFAULT_PROFILE: CriterionProfile = TERRITORY_PROFILE;

/**
 * THE ABLATION ARM. Identical to the production profile except that a royal
 * unit earns command too. It exists so `CommandKnobs.royal` is a measured
 * ruling rather than an argued one — the king is the one piece whose activity
 * trades against a terminal, and a knob that is off on reasoning alone is a
 * knob nobody has checked. Not a production profile.
 */
export const ROYAL_COMMAND_PROFILE: CriterionProfile = {
  ...TERRITORY_PROFILE,
  name: 'lobster-territory-a',
  command: { ...COMMAND_KNOBS, royal: true },
};

/** Material only — the profile a differential or a 1 ms reflex rung wants, and
 * the explicit fallback if the territory profile ever has to be backed out. */
export const MATERIAL_ONLY_PROFILE: CriterionProfile = {
  name: 'material-only',
  weights: {
    material: 10,
    reach: 0,
    room: 0,
    energyEconomy: 0,
    kingMargin: 0,
    command: 0,
    food: 0,
    momentum: 0,
    contest: 0,
    tier: 0,
    energy: 0,
    potion: 0,
  },
  reachHorizonTurns: 0,
};
