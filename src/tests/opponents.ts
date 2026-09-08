/**
 * THE OPPONENT BENCH — five ways to play that are NOT this bot.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Every measurement in this repo before it was taken against a mirror: both
 * sides folded `DEFAULT_WEIGHTS`, so "the bot got better" meant "the bot got
 * better at the one opponent that shares all of its blind spots". The single
 * exception, `--opponent=material-only`, is a profile built for a different
 * purpose (the 1 ms reflex rung and the back-out path) that happens to be
 * non-mirror, and it is degenerate in a specific way: it names ZERO for every
 * ordering term, so among material ties it is the search's tie-break and
 * nothing else. Beating it says the fold does something. It does not say the
 * fold does the RIGHT thing, because a bot that is blind to food, to room and
 * to contest cannot punish a mistake about any of the three.
 *
 * So: a bench. Each entry below is a WEIGHT TABLE over the same twelve
 * features the production evaluator folds — same search, same generator, same
 * substrate, same rules — because that is the cheapest way to get a genuinely
 * different playing style without writing a second bot to maintain. One entry
 * (`random-legal`) cannot be a weight table at all and is a policy switch; see
 * `RANDOM_LEGAL` below for what it is and where it may be applied.
 *
 * ── THE RULE THESE TABLES ARE READ UNDER ───────────────────────────────────
 *
 * NOTHING HERE IS A CANDIDATE FOR THE DEFAULT. `calibration.ts` records a
 * reason for every number in `DEFAULT_WEIGHTS`, and several of the tables below
 * BREAK a recorded inequality on purpose — that is what makes them different
 * players rather than a re-run of `docs/design/WEIGHT-SWEEP.md`, which swept
 * one knob at a time inside the admissible region and kept nothing. Each table
 * says which inequality it breaks and why the break is the point.
 *
 * Two checks every table here does still pass, and they are not optional:
 *
 *  1. `checkWeights` — the table names exactly the twelve folded features and
 *     no others, and the command knobs are finite and non-negative. This is
 *     the check `parseBotSpec` runs, so every entry below is a binding
 *     production would accept; `resolveOpponent` goes through that same seam.
 *
 *  2. THE CLIFF INEQUALITY, `w_feature × (range of the feature) < 10 × 1`
 *     (`calibration.ts`, `CLIFF_MATERIAL_WEIGHT`). An ordering term that
 *     outranks the lightest unit's life is not an aggressive opponent, it is a
 *     broken evaluator: it would trade a unit for a tie-break and the games
 *     would measure the bug. Every weight below is chosen against the term's
 *     own constructed range — `[0,1]` for `food`, `[-1,0]` for `contest` and
 *     `energy`, `[-1,1]` for `tier`, `[-2,1]` for `potion`, `≤1` for `command`
 *     (it is clamped), and `≤2` for the two territory terms on the acceptance
 *     boards (`src/tests/territory-acceptance.test.ts`). The per-table note
 *     gives the binding one.
 *
 * ── WHAT IS HELD FIXED ─────────────────────────────────────────────────────
 *
 * `reachHorizonTurns`, `command` and `energyReserveRatio` are the PRODUCTION
 * values on all five, deliberately. The bench is a sweep over the weight table
 * and nothing else, so a difference between two arms is a difference in what
 * the opponent VALUES and never a difference in how much of the board it can
 * see or how the command term is scaled. `material-only`, which is not from
 * this file, is the one entry that also drops the horizon (to 0) — it is in the
 * catalog for its own reasons and is listed here only for contrast.
 */

import { COMMAND_KNOBS, HEALTH_RESERVE_RATIO, REACH_HORIZON_TURNS } from '../lobster/evaluate';
import type { CriterionProfile } from '../lobster/evaluate';
import type { BotSpec } from '../config/bot-identity';

/**
 * Everything a bench table shares with production: how far the reach flood
 * runs, how the command term is scaled, and where the movement budget starts
 * to bind. Spread into each profile so a table below is a table and nothing
 * else — see "WHAT IS HELD FIXED" above.
 */
const BENCH_FIXTURE = {
  reachHorizonTurns: REACH_HORIZON_TURNS,
  command: COMMAND_KNOBS,
  energyReserveRatio: HEALTH_RESERVE_RATIO,
} as const;

/**
 * CONTEST-SEEKING, TERRITORY-HEAVY. It wants the ground an enemy also wants,
 * and it does not price the arrival-turn verdict for wanting it.
 *
 * `contest` at ZERO is the whole profile: the term's only job in
 * `DEFAULT_WEIGHTS` is to make a healthy unit decline a square it would lose
 * on arrival, so removing it produces a player that walks at enemies. `reach`
 * (4) and `command` (5) are then the terms that decide, so it walks at them
 * along the widest front it has, and `energy` (1) is cheap enough that it will
 * pay the travel to get there. `room` (1) is deliberately DOWN: per-unit
 * escape space is the death predictor, and an aggressor that kept it would
 * only be the default with extra steps.
 *
 * Recorded inequalities: none broken. `contest < food` (3 < 3 is not the
 * relation; 0 < 3 is) still holds, trivially, and the ordering
 * `momentum < tier < contest < food` is broken only in that `contest` has left
 * the ordering entirely. Cliff: the binding term is `reach`, 4 × 2 = 8 < 10.
 */
export const AGGRESSIVE_PROFILE: CriterionProfile = {
  name: 'aggressive',
  weights: {
    material: 10,
    reach: 4,
    room: 1,
    energyEconomy: 0.25,
    kingMargin: 0,
    command: 5,
    food: 3,
    momentum: 1,
    contest: 0,
    tier: 2,
    energy: 1,
    potion: 2,
  },
  ...BENCH_FIXTURE,
};

/**
 * ROOM AND REACH FIRST, AND IT WILL NOT FIGHT FOR THEM. The land-grabber: it
 * maximises the ground it holds and the space each unit can still move in,
 * and it declines any square whose arrival it loses rather than contest it.
 *
 * `room` at 4.5 is the `room×1.5` arm of `docs/design/WEIGHT-SWEEP.md` — the
 * only arm in that sweep that held `mixed` deaths at the baseline — and `reach`
 * at 4 is four times production's. Against those two, `food` at 1 is a
 * rounding error: this player eats what it walks over and never crosses the
 * board for a meal. That is the interesting failure mode to put the default in
 * front of, because it is the one player on the bench that competes for the
 * SAME resource the default's territory terms are built to take.
 *
 * Recorded inequality BROKEN, on purpose: `contest` (4) is no longer under
 * `food` (1). `calibration.ts` sets `contest` under `food` so "a hungry unit
 * still takes a contested meal and a healthy one declines it"; here even a
 * starving unit declines it, which is exactly what "contest-averse" means and
 * is why this is an opponent-only table. Cliff: binding term is `room`,
 * 4.5 × 2 = 9 < 10.
 */
export const TERRITORIAL_PROFILE: CriterionProfile = {
  name: 'territorial',
  weights: {
    material: 10,
    reach: 4,
    room: 4.5,
    energyEconomy: 0.5,
    kingMargin: 0.25,
    command: 3,
    food: 1,
    momentum: 1,
    contest: 4,
    tier: 2,
    energy: 8,
    potion: 2,
  },
  ...BENCH_FIXTURE,
};

/**
 * THE SURVIVOR. Contest and room high, food near zero, health expensive: it
 * plays not to die and accepts that it will not grow.
 *
 * It is the bench's control on the owner's own rule — "deaths are the
 * currency, meals and territory are what may be spent" — taken to its limit.
 * If the default cannot out-live a player whose whole table is caution, the
 * default's caution is not doing what its comments claim; if the default
 * out-SCORES it while dying more, that is the trade the rule says to refuse,
 * made visible.
 *
 * Recorded inequality BROKEN, on purpose and harder than `territorial` breaks
 * it: `contest` (6) over `food` (0.25) means a unit at 1 health declines a
 * contested meal and starves instead. `energyEconomy` (2) and `energy` (8)
 * then make it hoard health it has no plan to spend. Cliff: binding term is
 * `contest`, 6 × 1 = 6 < 10 — and note that this is the term nearest the
 * ceiling on the whole bench, which is the reason it is 6 and not 9.
 */
export const CAUTIOUS_PROFILE: CriterionProfile = {
  name: 'cautious',
  weights: {
    material: 10,
    reach: 1,
    room: 4.5,
    energyEconomy: 2,
    kingMargin: 1,
    command: 1,
    food: 0.25,
    momentum: 1,
    contest: 6,
    tier: 1,
    energy: 8,
    potion: 0.5,
  },
  ...BENCH_FIXTURE,
};

/**
 * FOOD FIRST AND FOOD ONLY. Every other ordering term is set below the noise
 * so the food gradient decides every move that material ties.
 *
 * `food` at 9 against `contest` at 0.5 inverts the whole point of the
 * production `contest` weight: this player takes a contested meal at full
 * health, from a heavier enemy, on the turn it arrives. It is the fastest
 * grower on the bench and it should also be the fastest dier — which makes it
 * the arm that says whether the default's food term is a gradient (a
 * tie-break among safe moves) or a pull (a reason to enter an unsafe one).
 *
 * Recorded inequalities: `contest < food` HOLDS in the letter (0.5 < 9) and is
 * inverted in the spirit — the recorded reason for the relation is that a
 * healthy unit should decline a contested meal, and at this ratio no unit ever
 * does. `energy` (0.5) also drops below `momentum`'s idleness charge, so the
 * hold-versus-move inequality `w × cost > 0.5` recorded on the `energy` weight
 * is unreachable and this player never holds to save health. Cliff: binding
 * term is `food`, 9 × 1 = 9 < 10.
 */
export const GLUTTON_PROFILE: CriterionProfile = {
  name: 'glutton',
  weights: {
    material: 10,
    reach: 0.5,
    room: 0.5,
    energyEconomy: 0.25,
    kingMargin: 0,
    command: 1,
    food: 9,
    momentum: 0.5,
    contest: 0.5,
    tier: 0.5,
    energy: 0.5,
    potion: 0.5,
  },
  ...BENCH_FIXTURE,
};

/**
 * THE FLOOR OF COMPETENCE — and the one bench entry that is NOT a weight
 * table, because no weight table can express it.
 *
 * Uniform over the legal action set, per unit, per turn, from the runner's own
 * seeded generator. Not "a profile with all weights zero": a table of zeros
 * still runs the search, and the search still returns the generator's ordered
 * first offer, which is a systematic policy (`seedKept` is 100% and the play
 * is whatever `candidates.ts` happens to order first) and not a random one.
 * The only way to get uniform play is to not consult the evaluator at all, so
 * this is a POLICY and it is applied in the opponent's decision path only —
 * `runGame` routes a non-decider team to it and the decider never sees it.
 * Nothing in the default's path branches on it.
 *
 * WHAT IT IS FOR. Every other arm on the bench is a competent player with an
 * opinion, so a loss to one is ambiguous between "our weights are wrong" and
 * "their weights are better here". This one has no opinion. A board class
 * where the default's margin over `random-legal` is small is a board class
 * where the default's *search* is not buying much, whatever the weights say,
 * and that is a different defect with a different repair. It is the floor
 * every other number on the bench should be read against.
 *
 * WHAT IT IS NOT. It is not a uniform draw over JOINT plans: each unit draws
 * independently from its own legal action set, so a team of three draws from
 * the product and never coordinates. Coordinated random play is a different
 * (and much more expensive) object, and this bench does not need it — the
 * point of the floor is that it has no plan at all.
 */
export const RANDOM_LEGAL = 'random-legal';

/** The one policy name the bench carries. See `RANDOM_LEGAL`. */
export type OpponentPolicy = typeof RANDOM_LEGAL;

/**
 * THE BENCH, as bot specs — the shape `parseBotSpec` returns and
 * `BUILTIN_BOTS` holds, so `resolveOpponent` can look a name up in the union
 * of the two catalogs and validate the hit through the one existing seam.
 *
 * These are NOT added to `BUILTIN_BOTS`. That catalog is the set of bots a
 * STORED BINDING may name, i.e. the set a live production game can be made to
 * play, and none of these is a bot anybody should be able to bind a real game
 * to by typing its name into `config_store`. They exist to be played AGAINST,
 * in the local runner, and the split is the difference.
 */
export const OPPONENT_BOTS: Readonly<Record<string, BotSpec>> = {
  aggressive: { name: 'aggressive', engine: 'lobster', profile: AGGRESSIVE_PROFILE },
  territorial: { name: 'territorial', engine: 'lobster', profile: TERRITORIAL_PROFILE },
  cautious: { name: 'cautious', engine: 'lobster', profile: CAUTIOUS_PROFILE },
  glutton: { name: 'glutton', engine: 'lobster', profile: GLUTTON_PROFILE },
};

/** Every name `--opponent` accepts from this file, policies included. */
export const OPPONENT_NAMES: ReadonlyArray<string> = [
  ...Object.keys(OPPONENT_BOTS),
  RANDOM_LEGAL,
];
