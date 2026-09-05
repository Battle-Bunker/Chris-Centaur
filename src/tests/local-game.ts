/**
 * THE LOCAL GAME RUNNER — watch the bot play, one line per unit per turn.
 *
 * Everything the repo had before this was RELATIVE: arm A against arm B, scored
 * on a paired margin. That measures which of two bots is better and says nothing
 * at all about whether either of them is sane. This runs the SHIPPED decision
 * path — the same substrate, generator, evaluator, search core and kernel
 * `team-decision-engine.ts` assembles, minus the wire — over the vendored rules,
 * and prints what every unit actually did, so a human can read thirty turns and
 * see whether a snake walks to the food.
 *
 * It is a tool, not a test: nothing here asserts. The gates that DO assert live
 * in `basic-intelligence.test.ts`, and they read the same counters this
 * produces.
 */

import { writeFileSync } from 'fs';
import type { Board, Coord, Snake } from '../types/battlesnake';
import { toApiCoord, apiCoordToIndex } from '../firebase/translate';
import { marshalBoard, claimsAfter } from '../logic/turn-oracle';
import { settleTurn, DEFAULT_POTION_WINDOW_TURNS } from '../engine-vendor/engine/settleTurn';
import { ORTHOGONALS, leavesTrail } from '../engine-vendor/engine/moveGrammar';
import type { Orientation } from '../engine-vendor/engine/moveGrammar';
import { legalActions, legalTargets } from '../engine-vendor/engine/queries';
import type { BoardShape } from '../engine-vendor/engine/queries';
import type { UnitType } from '../engine-vendor/shared/types/Game';
import {
  beatenAt,
  contestField,
  frozenTier,
  standingField,
  winsContest,
} from '../lobster/evaluate/contest';
import { NO_SPAWN } from '../engine-vendor/engine/spawn';
import type { ResolveUnit } from '../engine-vendor/engine/resolveTurn';
import { aggregateExpiryTurn } from '../firebase/translate';
import { EngineSubstrate, makeSubstrate, clearGeometryCache } from '../lobster/substrate';
import { rigFor } from '../lobster/candidates';
import { defaultEvaluator, BoundEvaluator } from '../lobster/evaluate';
import type { Evaluator, JointPlan, Candidate, UnitId, KernelInput } from '../lobster/contracts';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../lobster/kernel';
import { BoundBank, basisKeyOf, withMove } from '../lobster/bounds';
import { observeLoud, type LoudReading } from '../lobster/bounds';
import { mulberry32 } from '../lobster/bounds/testkit';
import { DEFAULT_PAWN_PROMOTION_WEIGHT } from '../logic/staging-legality';
import type { LensSink } from '../lens/types';
// THE OPPONENT PROFILE — `--opponent=<name>`. Selected and validated through
// the exact seam production uses to bind a bot to a game (`bot-binding.ts`'s
// catalog and `parseBotSpec`), never a second lookup invented for this
// runner: the catalog IS the set of profiles that exist
// (`calibration.ts`'s `DEFAULT_WEIGHTS`/`TERRITORY_PROFILE`, its royal-command
// ablation, and `MATERIAL_ONLY_PROFILE`), and `parseBotSpec` is what already
// runs a stored binding through `checkWeights` before a live game plays it.
import { BUILTIN_BOTS, parseBotSpec } from '../config/bot-binding';

// ---------------------------------------------------------------------------
// Board construction
// ---------------------------------------------------------------------------

export interface UnitSpec {
  readonly kind: string; // 'snake' | 'pawn' | 'knight' | 'queen' | ...
  readonly x: number;
  readonly y: number;
  /** Snake: body length (grown straight behind the head). Piece: weight. */
  readonly size?: number;
  readonly health?: number;
}

export interface TeamSpec {
  readonly id: string;
  readonly units: ReadonlyArray<UnitSpec>;
}

export interface GameSpec {
  readonly width: number;
  readonly height: number;
  readonly teams: ReadonlyArray<TeamSpec>;
  readonly food: ReadonlyArray<Coord>;
  /** Food kept on the board: a meal eaten is replaced next turn. */
  readonly foodTarget?: number;
  readonly maxTurns?: number;
  readonly budgetMs?: number;
  /**
   * THE DETERMINISTIC BUDGET. Set, and every decision is bounded by a fixed
   * count of kernel work units instead of a wall-clock deadline — see
   * `DecisionClock`. `budgetMs` is then ignored and the run is reproducible.
   */
  readonly nodeBudget?: number;
  readonly seed?: number;
  /** Potions on the board at turn 1. Implies the potion rules are live. */
  readonly potions?: ReadonlyArray<Coord>;
  /** Potion cells kept standing: one collected is replaced on a later turn. */
  readonly potionTarget?: number;
  /** Turns between potion respawns, once the board is below `potionTarget`. */
  readonly potionRespawnTurns?: number;
  /** How long a pickup's debuff and its allies' buffs last. */
  readonly potionWindowTurns?: number;
  /**
   * ENERGY ONE MEAL RESTORES — `GameSetup.foodEnergy`, straight through to
   * `resolveTurn`. Absent means the engine's own `DEFAULT_FOOD_ENERGY` (100),
   * which equals `defaultMaxEnergy`, so every meal fills and every meal grows:
   * the old rule, and the reason no scenario in this file has ever exercised
   * fill-to-grow (`docs/design/BEHAVIOUR-AUDIT.md`, "the gap the corpus cannot
   * close"). Set it BELOW a kind's max and a unit needs several meals to fill,
   * and grows only on the one that tops it off.
   */
  readonly foodEnergy?: number;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const isPiece = (kind: string): boolean => kind !== 'snake';

// ---------------------------------------------------------------------------
// THE DECISION CLOCK — what makes the deterministic mode deterministic
// ---------------------------------------------------------------------------

/**
 * WHY THIS EXISTS. The runner is budgeted in milliseconds, so at the standard
 * 150 ms it is not reproducible at a fixed seed: the same build played the
 * `mixed` board for 1501 unit-turns on one run and 1329 on the next, and the
 * worst single decision swung by 2x. Every counter this file produces is a
 * function of how much search the box happened to afford, so an A/B on a
 * weight change measures the machine's load and not the change. Drop the
 * budget to 20 ms and it IS reproducible — because the decision is then the
 * generator's seed plan ~98% of the time, which measures nothing either.
 *
 * The fix is not a smaller clock, it is a DIFFERENT clock. The kernel already
 * injects `now` (`KernelInput.now`, "tests pass a fake clock so the anytime
 * suite is deterministic") and everything downstream of it — the slice budget,
 * `shouldStop`, the affordability guard, the adaptive slice length — reads
 * that one function and nothing else. So the deterministic mode hands the
 * kernel a clock whose unit is WORK rather than time:
 *
 *   now() = nodes x NODE_COST + reads x READ_COST
 *
 * `nodes` counts evaluator calls that actually reached the evaluator (the
 * bank's eval memo serves the other 99%, and a memo hit is not work). `reads`
 * counts calls to `now()` itself — one per `budget.shouldStop()`, which is one
 * per inner search-loop iteration. Nodes are the coarse, meaningful unit;
 * reads are what keeps the clock STRICTLY MONOTONE, so a stretch of search
 * that prices nothing new still ends, the kernel's stall rail never trips, and
 * no loop can spin forever.
 *
 * Both terms are pure functions of the program's own execution, so two runs of
 * the same build at the same seed take byte-identical decisions.
 */
const NODE_COST = 1;
/**
 * A hundredth of a node, and NOT a rounding term.
 *
 * `reads` is what keeps the clock strictly monotone — a stretch of search that
 * prices nothing new still ends, the kernel's stall rail never trips, and no
 * loop can spin forever. But it is also the honest second half of the work:
 * the bank's eval memo serves most of the prices it is asked for (its own
 * docstring measured 99.7% repeats on a bigger board), so a budget spent on
 * fresh evaluations alone is not the decision the ms mode takes. Measured over
 * 150 ms decisions on `mixed`, a decision spends ~470 nodes against ~11 000
 * reads; at 1/100 the two terms are ~470 and ~110, which is the ratio the ms
 * mode actually runs at.
 */
const READ_COST = 0.01;

const monotonic = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

/**
 * The clock one decision runs on, and the instrument that counts its work.
 *
 * In `ms` mode `now()` is the real monotonic clock and the counters are pure
 * instrumentation — they are how the default node budget below was chosen. In
 * `nodes` mode `now()` is the work clock and the counters ARE the clock.
 */
export class DecisionClock {
  nodes = 0;
  reads = 0;
  constructor(readonly virtual: boolean) {}
  readonly now = (): number => {
    this.reads++;
    return this.virtual ? this.nodes * NODE_COST + this.reads * READ_COST : monotonic();
  };
  /** Work in the clock's own unit, whichever clock this is. */
  work(): number {
    return this.nodes * NODE_COST + this.reads * READ_COST;
  }
}

/**
 * THE LOUD-PRODUCT HISTOGRAM — step 1 of `08-DEPTH-VERDICT` §5, and the whole
 * of it.
 *
 * ONE OCCASION IS ONE B3 PREAMBLE: one priced plan on which the bank had a
 * non-empty entanglement gate and built its option lists. That is the
 * population a ceiling ply would be selected from, and it is the same
 * population the reply product `P` is read on, so the two distributions here
 * are a CROSS-TAB of one sample rather than two runs laid beside each other.
 *
 * `b3` splits it on Finding D-1's own axis. `open` counts the occasions where
 * B3 DECLINED — the bracket is genuinely open and a deep member would have
 * something to remove — and it is the `open` row, not the total, that decides
 * whether §4.4's cost claim survives: a `Q` small enough to enumerate is only
 * worth having where ply 1 did not already close the question.
 *
 * Nothing here is charged to the decision clock, because nothing here calls
 * the evaluator or reads `now()`.
 */
export interface LoudHistogram {
  /** B3 preambles seen. */
  occasions: number;
  /** Occasions where B3 ACTUALLY FIRED — the ply-1 bracket is closed there. */
  b3Fired: number;
  /** Occasions where the gate reached every held unit. `b3Fired`'s hard term. */
  covered: number;

  // ---- `Q`, the loud product. Disjoint buckets; the boundaries are §4.4's own
  // `LOUD_CAP` candidates, so the cost table can be read straight off the row.
  /** `Q === 0`: some gated enemy has no loud option — nothing it can play
   *  touches our footprint, so a ceiling ply has nothing to enumerate. */
  quiet: number;
  q1to6: number;
  q7to12: number;
  q13to24: number;
  q25to512: number;
  qOver512: number;

  // ---- `P`, the reply product, in 08 §1.3's own classes, on the SAME
  // occasions — which is what makes the two distributions a cross-tab.
  pTo24: number;
  pTo512: number;
  pTo4096: number;
  pOver4096: number;

  /** THE §4.4 TEST, in one number: `Q <= 12` where `P > productCap`, i.e. an
   *  affordable ceiling ply on an occasion the full product could not close. */
  qUnder12WhereOpen: number;
  /** The denominator of the line above. */
  pOver512: number;

  /** `Σ Q` and `Σ P` — means without a second pass. */
  qTotal: number;
  pTotal: number;
}

export function emptyLoudHistogram(): LoudHistogram {
  return {
    occasions: 0,
    b3Fired: 0,
    covered: 0,
    quiet: 0,
    q1to6: 0,
    q7to12: 0,
    q13to24: 0,
    q25to512: 0,
    qOver512: 0,
    pTo24: 0,
    pTo512: 0,
    pTo4096: 0,
    pOver4096: 0,
    qUnder12WhereOpen: 0,
    pOver512: 0,
    qTotal: 0,
    pTotal: 0,
  };
}

/** The `Q` bucket, named once so nothing can bucket it a second way. */
function loudBucket(q: number): keyof LoudHistogram {
  if (q === 0) return 'quiet';
  if (q <= 6) return 'q1to6';
  if (q <= 12) return 'q7to12';
  if (q <= 24) return 'q13to24';
  if (q <= 512) return 'q25to512';
  return 'qOver512';
}

/** The `P` class, in 08 §1.3's own boundaries. */
function productBucket(p: number): keyof LoudHistogram {
  if (p <= 24) return 'pTo24';
  if (p <= 512) return 'pTo512';
  if (p <= 4096) return 'pTo4096';
  return 'pOver4096';
}

export function countLoud(into: LoudHistogram, reading: LoudReading): void {
  into.occasions++;
  if (reading.b3) into.b3Fired++;
  if (reading.covers) into.covered++;
  into[loudBucket(reading.q)]++;
  into[productBucket(reading.product)]++;
  into.qTotal += reading.q;
  into.pTotal += reading.product;
  if (reading.product > 512) {
    into.pOver512++;
    if (reading.q <= 12) into.qUnder12WhereOpen++;
  }
}

export function addLoud(into: LoudHistogram, from: LoudHistogram): void {
  for (const k of Object.keys(from) as Array<keyof LoudHistogram>) into[k] += from[k];
}

/**
 * The shipped evaluator, with every call that reaches it charged to the clock.
 *
 * Wrapping is the whole mechanism: the kernel threads `KernelInput.evaluate`
 * into every SearchContext and the bank prices every branch through it, so one
 * wrapper meters the decision without a line of engine code changing.
 */
export function meteredEvaluator(inner: Evaluator, clock: DecisionClock): Evaluator {
  const wrapper: Evaluator = {
    scorePlan: (sub, plan, asTeam) => {
      clock.nodes++;
      return inner.scorePlan(sub, plan, asTeam);
    },
    evaluatePlan: (sub, plan, asTeam) => {
      clock.nodes++;
      return inner.evaluatePlan(sub, plan, asTeam);
    },
  };
  if (inner.explainPlan !== undefined) {
    wrapper.explainPlan = (sub, plan, asTeam) => {
      clock.nodes++;
      return (inner.explainPlan as NonNullable<Evaluator['explainPlan']>)(sub, plan, asTeam);
    };
  }
  // The eval memo namespaces its entries on the evaluator's declared identity
  // (`evaluatorIdentity`), which folds in the criterion profile, the weights
  // and the horizon. A wrapper that dropped it would be namespaced on object
  // identity instead — harmless, since a bank lives one decision, but it would
  // make the metered runner and the unmetered one two different cache
  // populations for no reason. It is forwarded, so they are one.
  const declared = (inner as { readonly evaluationIdentity?: unknown }).evaluationIdentity;
  if (declared !== undefined) {
    (wrapper as { evaluationIdentity?: unknown }).evaluationIdentity =
      typeof declared === 'function' ? (declared as () => unknown).call(inner) : declared;
  }
  return wrapper;
}

/** A decision's stop condition: a wall-clock budget, or a count of work. */
export type DecisionBudget =
  | { readonly kind: 'ms'; readonly ms: number }
  | { readonly kind: 'nodes'; readonly nodes: number };

/**
 * THE DEFAULT NODE BUDGET, and how it was picked.
 *
 * Measured with the `ms` mode's own instrument — the same clock, reporting
 * rather than deciding — on `mixed`, seeds 1-3, 20 turns, 150 ms, 60 team
 * decisions a seed, four runs:
 *
 *     nodes per decision    362 450 450 454 461 471 471 479 530 537 540 551
 *     reads per decision    5.3k .. 13.5k
 *     slices per decision   18 .. 92
 *     work units (the clock's own sum)   414 566 573 596 596 603 628 648 662
 *
 * The slice count is not a budget anybody could set: a slice ends when
 * `improve()` returns, so the SAME 150 ms bought 18 slices on one run of seed 1
 * and 92 on a run of seed 2. The work sum is the stable one, median 596.
 *
 * The default is 550 rather than 596 because fresh evaluation SATURATES: at
 * 550 a deterministic decision spends 405-413 nodes, 10.6k reads and 45-50
 * slices, all inside the ms mode's own spread; at 600 it spends 410-427 nodes
 * — 2% more — and 15k reads, because past that point the marginal unit buys
 * re-pricing of plans the bank has already priced and nothing else.
 */
export const DEFAULT_NODE_BUDGET = 550;

/**
 * The slice length, as a fraction of the budget.
 *
 * The ms mode runs `sliceMs: 25` against a 150 ms budget and `maxSliceFraction`
 * 0.1, so its cap resolves to the slice floor and every slice is exactly a
 * sixth of the budget. Holding the same fraction keeps the anytime SHAPE — how
 * many slices a decision gets, and therefore how often the emit gates run —
 * the same in both modes.
 */
const DETERMINISTIC_SLICE_FRACTION = 1 / 6;

function makeUnit(
  id: string,
  teamId: string,
  letter: string,
  spec: UnitSpec,
  centre: Coord
): Snake {
  const size = spec.size ?? (isPiece(spec.kind) ? 1 : 3);
  const head: Coord = { x: spec.x, y: spec.y };
  const body: Coord[] = isPiece(spec.kind)
    ? [head]
    : Array.from({ length: size }, (_, i) => ({ x: spec.x, y: spec.y - i }));
  // Facing the board centre at spawn, in the wire's full-board convention (dy
  // grows DOWNWARD, so api dy is negated), and projected onto ONE ORTHOGONAL.
  // The projection is the rules': `spawnOrientationCandidates` picks from the
  // kind's legal orientations, and a diagonal is not one of them for anything
  // but a bishop — a pawn handed { dx: -1, dy: 1 } has a DIAGONAL forward step
  // and two diagonal side squares, which is not a pawn at all.
  const ax = centre.x - spec.x;
  const ay = -(centre.y - spec.y);
  const dx = Math.abs(ax) >= Math.abs(ay) ? Math.sign(ax) : 0;
  const dy = Math.abs(ax) >= Math.abs(ay) ? 0 : Math.sign(ay);
  return {
    id,
    name: `${teamId} ${letter}`,
    latency: '0',
    health: spec.health ?? 100,
    body,
    head,
    length: size,
    shout: '',
    squad: teamId,
    customizations: { color: '#888888', head: 'default', tail: 'default' },
    letter,
    teamID: teamId,
    teamName: teamId,
    unitType: spec.kind,
    maxHealth: 100,
    orientation: dx === 0 && dy === 0 ? { dx: 0, dy: 1 } : { dx, dy },
  };
}

export function buildBoard(spec: GameSpec): Board {
  const centre: Coord = { x: (spec.width - 1) / 2, y: (spec.height - 1) / 2 };
  const snakes: Snake[] = [];
  for (const team of spec.teams) {
    team.units.forEach((u, i) => {
      snakes.push(makeUnit(`${team.id}-${LETTERS[i]}`, team.id, LETTERS[i] as string, u, centre));
    });
  }
  return {
    width: spec.width,
    height: spec.height,
    food: spec.food.map((f) => ({ ...f })),
    hazards: [],
    hazardDamage: 100,
    pawnPromotionWeight: DEFAULT_PAWN_PROMOTION_WEIGHT,
    maxHealthPerUnit: {},
    snakes,
    // ONE MEAL'S WORTH OF ENERGY, and absent unless the spec names it: a board
    // that states nothing is the input `marshalBoard` has always been handed,
    // and `resolveTurn` then reads `DEFAULT_FOOD_ENERGY`. Stating it is what
    // makes fill-to-grow visible (`--food-energy`).
    ...(spec.foodEnergy === undefined ? {} : { foodEnergy: spec.foodEnergy }),
    // A POTION-FREE BOARD CARRIES NO POTION FIELDS AT ALL, not empty ones.
    // `marshalBoard` reads "potions enabled" off the board's own contents when
    // the flag is absent, and `Simulator` decides whether a unit's expiry turn
    // may be written from whether the board carried a SCHEDULE — so a board
    // that states nothing and a board that states nothing-yet are two
    // different inputs. Spreading the whole group in only when the spec names
    // potions is what keeps the three potion-free scenarios byte-identical
    // across the settleTurn switch.
    ...(spec.potions === undefined
      ? {}
      : {
          invulnerabilityPotions: spec.potions.map((c) => ({ ...c })),
          invulnerabilityPotionsEnabled: true,
          invulnerabilityPotionWindowTurns:
            spec.potionWindowTurns ?? DEFAULT_POTION_WINDOW_TURNS,
          activeEffects: [],
        }),
  };
}

// ---------------------------------------------------------------------------
// One team's decision — the shipped path, minus the wire
// ---------------------------------------------------------------------------

export interface CandidateTrace {
  readonly to: Coord;
  readonly est: number;
  readonly lo: number;
  /** The BANK's proved floor — the number `SearchCore.better` actually reads. */
  readonly floor: number;
  /** The basis key that floor is priced under. Two different keys are not
   * comparable at all, and `better` keeps the incumbent when they differ. */
  readonly basis: string;
  /** The generator did not offer this option to the search at all. */
  readonly pruned: boolean;
}

export interface UnitTrace {
  readonly wireId: string;
  readonly letter: string;
  readonly kind: string;
  readonly health: number;
  readonly from: Coord;
  readonly to: Coord;
  /** The chosen move's rank among candidates, ordered by evaluated `est`. */
  readonly top: ReadonlyArray<CandidateTrace>;
  /** The chosen move is the generator's FIRST candidate — the search's seed. */
  readonly seeded: boolean;
  readonly reversed: boolean;
}

// ---------------------------------------------------------------------------
// THE CONTEST-STANDING INSTRUMENT (docs/design/contest-gap.md §2.3)
// ---------------------------------------------------------------------------

/**
 * ONE UNIT-TURN, READ THE WAY THE DIAGNOSIS READ IT.
 *
 * `contest-gap.md` §2.3 buckets every decider unit-turn by two facts — whether
 * the unit's own cell is beaten in `contestField`, and whether `contest` varies
 * across the unit's OFFERED options — and finds 67–73 % of all contest deaths
 * in the one bucket where both are true and the member therefore expresses no
 * preference at all. That bucket is what a repair has to shrink, so it has to
 * be counted rather than argued, and this is the counter.
 *
 * IT IS NOT FREE, and that is why it is gated on `CENTAUR_CONTEST_DIAG=1`.
 * Unlike `enemyOccupiedEntriesAt` it cannot be answered off the board: whether
 * `contest` is flat is a fact about the FOLD, so it takes one evaluation per
 * offered option per unit. Every one of those calls is made with the UNMETERED
 * evaluator, after `kernel.decide` has returned and the plan is fixed — the
 * same seam `traceFor`'s pricing already uses — so it cannot move a node
 * counter or change a decision. With the flag absent nothing here runs and the
 * runner is byte-identical to what it was.
 *
 * Only OFFERED options count, exactly as the diagnosis counts them: a staged
 * square the generator never offered is not a choice the member could have
 * made.
 */
export interface ContestStandingRead {
  readonly wireId: string;
  /** The unit's own turn-start head cell is beaten in `contestField`. */
  readonly originBeaten: boolean;
  /** How many options the generator offered. One is the diagnosis's class C. */
  readonly options: number;
  /** `contest` is EXACTLY constant across every offered option. */
  readonly flat: boolean;
  /**
   * The same over every LEGAL action the enumerator admits, offered or pruned.
   * Kept because `contest-gap.md` §2.3's own figure (`mixed` 1-6, 140 flat
   * unit-turns) reconciles against this reading and not against the offered
   * one, and a bucket measured two different ways is two different buckets.
   */
  readonly flatAll: boolean;
  /** No offered option's staged cell is in any enemy's one-step arrival set. */
  readonly fieldSilent: boolean;
  /** Every offered option's staged cell is beaten. */
  readonly allBeaten: boolean;
  /** The fold's `lo` AND `est` are equal on every offered option. */
  readonly tied: boolean;
  /** Some offered option is beaten and some is not — the arrival charge itself
   *  discriminates, whatever the bracket then does with it. */
  readonly arrivalVaries: boolean;
  /**
   * The STANDING charge varies across the offered options: `beatenAt(field⁺)`
   * at the staged cell is not the same on all of them. This is the σ addend's
   * own discrimination, measured on the head before σ exists — §3's "95 of 205".
   */
  readonly standingVaries: boolean;
}

/** The cell this plan's staged action leaves the unit standing on. A rotate has
 *  an empty path and a `to` that only encodes the turn (`contracts.ts`), so the
 *  cell held is the origin; everything else ends at the end of its own ray. */
function stagedCellOf(option: Candidate, origin: number): number {
  const path = option.path;
  return path.length === 0 ? origin : (path[path.length - 1] as number);
}

function contestStandingRead(
  sub: EngineSubstrate,
  evaluate: Evaluator,
  plan: JointPlan,
  asTeam: number,
  unitId: UnitId,
  offer: ReadonlyArray<Candidate>
): ContestStandingRead | null {
  const unit = sub.unitOf(unitId);
  if (unit === undefined || offer.length === 0) return null;
  const offered = new Set(offer.map((c) => c.to));
  const origin = unit.cells[0] as number;
  const arrivals = contestField(sub, asTeam);
  const standings = standingField(sub, asTeam);
  const tier = frozenTier(unit.tier, unit.tierExpiresAtTurn, sub.turn);
  let reached = false;
  let beatenAll = true;
  let beatenAny = false;
  let standingFirst: boolean | null = null;
  let standingVaries = false;
  let contestFirst: string | null = null;
  let contestFirstAll: string | null = null;
  let flat = true;
  let flatAll = true;
  let tieFirst: string | null = null;
  let tied = true;
  // The same cap `traceFor` prices under, so the two readings of one unit-turn
  // never disagree about which options they saw.
  for (const option of sub.actionsOf(unitId).slice(0, 24)) {
    const mine = offered.has(option.to);
    const cell = stagedCellOf(option, origin);
    const standing = beatenAt(standings, tier, unit.weight, cell);
    const beaten = beatenAt(arrivals, tier, unit.weight, cell);
    if (mine) {
      if (arrivals.reached[cell] === 1) reached = true;
      if (beaten) beatenAny = true;
      else beatenAll = false;
      if (standingFirst === null) standingFirst = standing;
      else if (standing !== standingFirst) standingVaries = true;
    }
    const trial = new Map(plan);
    trial.set(unitId, option);
    let value;
    try {
      value = evaluate.evaluatePlan(sub, trial, asTeam);
    } catch {
      continue;
    }
    const contest = value.parts['contest'];
    const key =
      contest === undefined ? 'none' : `${contest.lo}|${contest.est}|${contest.hi}`;
    if (contestFirstAll === null) contestFirstAll = key;
    else if (key !== contestFirstAll) flatAll = false;
    if (!mine) continue;
    if (contestFirst === null) contestFirst = key;
    else if (key !== contestFirst) flat = false;
    const tieKey = `${value.bound.lo}|${value.bound.est}`;
    if (tieFirst === null) tieFirst = tieKey;
    else if (tieKey !== tieFirst) tied = false;
  }
  return {
    wireId: unit.wireId,
    originBeaten: beatenAt(arrivals, tier, unit.weight, origin),
    options: offer.length,
    flat,
    flatAll,
    fieldSilent: !reached,
    allBeaten: beatenAll,
    tied,
    arrivalVaries: beatenAny && !beatenAll,
    standingVaries,
  };
}

/** `CENTAUR_CONTEST_DIAG=1` turns the read above on. Read once: an env lookup
 *  per unit per turn is a syscall-shaped thing in the middle of a runner. */
const CONTEST_DIAG = process.env['CENTAUR_CONTEST_DIAG'] === '1';

export interface TeamDecision {
  /** wireId -> the DESTINATION cell staged, exactly what the wire carries. */
  readonly staged: Map<string, number>;
  readonly traces: UnitTrace[];
  /** One row per unit this decision staged, or empty without the diag flag. */
  readonly standings: ContestStandingRead[];
  readonly horizon: number;
  /** Evaluator calls that reached the evaluator — the work clock's coarse unit. */
  readonly nodes: number;
  /** Kernel refinement slices this decision completed. */
  readonly slices: number;
  /** Clock reads: one per `shouldStop`, i.e. per inner search-loop iteration. */
  readonly reads: number;
  /** The loud product, over this decision's own B3 preambles (08 §5 step 1).
   *  Measured, never acted on: the decision above is byte-identical with it. */
  readonly loud: LoudHistogram;
}

export async function decideTeam(
  board: Board,
  turn: number,
  teamId: string,
  budget: DecisionBudget,
  evaluate: Evaluator = defaultEvaluator,
  /** Score every option of every unit. Exact, and slow: it prices each option
   * through a bound bank of its own. Off for the multi-seed counters, on when
   * a human is going to read the trace. */
  scores = true,
  /**
   * THE LENS, WATCHING — `KernelInput.lens` [CHANGE 3].
   *
   * Optional, and its absence is the state the cost gate measures: without it
   * the decision is byte-identical to what it was before the lens existed. It
   * is here rather than in a second runner because the O1 measurement and the
   * determinism check are both claims about THIS decision — the one the
   * deterministic runner makes — and a second assembly could only prove
   * something about itself.
   *
   * The sink translates the substrate's unit numbers at the boundary, so what
   * arrives is already in the wire's vocabulary; `sub` rides along because the
   * caller's writer needs the same translation for `EmitRecord.plan`.
   */
  lens?: { sink: LensSink; attach?: (sub: EngineSubstrate) => void }
): Promise<TeamDecision> {
  const ourIds = (board.snakes ?? [])
    .filter((s) => s.teamID === teamId && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  const staged = new Map<string, number>();
  const traces: UnitTrace[] = [];
  const standings: ContestStandingRead[] = [];
  const clock = new DecisionClock(budget.kind === 'nodes');
  if (ourIds.length === 0) {
    return {
      staged,
      traces,
      standings,
      horizon: 0,
      nodes: 0,
      slices: 0,
      reads: 0,
      loud: emptyLoudHistogram(),
    };
  }

  const sub = makeSubstrate({ gameId: 'local', board, turn, asTeam: teamId, modeled: ourIds });
  const loud = emptyLoudHistogram();
  try {
    const asTeam = sub.teamNumber(teamId);
    const { gen, search } = rigFor(sub);
    // The kernel options `TeamDecisionEngine.kernelOptions()` ships, so the
    // deadline behaviour a game measures is production's. `minWriteIntervalMs`
    // is the WIRE's rate policy and there is no wire here, so it is the one
    // value that differs: throttling emissions would only hide the last record.
    //
    // The deterministic mode differs in three more, and each is the same value
    // read on the work clock rather than a policy change:
    //   · `reserveMs: 0` — the reserve buys wall time for the final flush to
    //     reach the wire, and there is no wire and no wall clock. The flush is
    //     unconditional and costs its own nodes, so the budget is what the
    //     search actually gets, which is what makes it comparable to the
    //     measured node count of a 150 ms decision.
    //   · `sliceMs` at a sixth of the budget, which is what the ms mode's 25 ms
    //     slice is against 150 ms.
    //   · `yieldIntervalMs: 0` — the ONLY remaining real-clock read in the
    //     decision path is the kernel's yield gate, which is deliberately
    //     wall-gated ("what it is rationing is real event-loop starvation").
    //     Nothing else shares this process, nothing delivers an operator pin,
    //     and a yield taken on a wall schedule is a nondeterministic number of
    //     macrotasks in the middle of a decision. Off, the decision is
    //     synchronous and no clock but the work clock is consulted at all.
    const kernel = new LobsterKernel(
      budget.kind === 'ms'
        ? {
            ...DEFAULT_KERNEL_OPTIONS,
            crossfade: 'teammate',
            reserveMs: 40,
            sliceMs: 25,
            pinCacheCapacity: 32,
            minWriteIntervalMs: 0,
          }
        : {
            ...DEFAULT_KERNEL_OPTIONS,
            crossfade: 'teammate',
            reserveMs: 0,
            sliceMs: budget.nodes * DETERMINISTIC_SLICE_FRACTION,
            pinCacheCapacity: 32,
            minWriteIntervalMs: 0,
            yieldIntervalMs: 0,
          }
    );
    const kin: KernelInput = {
      sub,
      gen,
      // Metered in BOTH modes: in `nodes` mode the count IS the clock, and in
      // `ms` mode it is the instrument that says how much work a wall-clock
      // budget bought — which is how `DEFAULT_NODE_BUDGET` was chosen.
      evaluate: meteredEvaluator(evaluate, clock),
      search,
      asTeam,
      deadlineMs: clock.now() + (budget.kind === 'ms' ? budget.ms : budget.nodes),
      initialPins: [],
      assumptions: [],
      now: clock.now,
      ...(lens === undefined ? {} : { lens: lens.sink }),
    };
    lens?.attach?.(sub);
    let plan: JointPlan | null = null;
    let horizon = 0;
    // AROUND THE DECISION AND NOTHING ELSE. The trace pricing below runs its
    // own banks at an unbounded budget, after the decision is over; counting
    // its preambles would put a telemetry population into a measurement of
    // what the SEARCH saw.
    const stopWatching = observeLoud((reading) => countLoud(loud, reading));
    try {
      for await (const rec of kernel.decide(kin)) {
        plan = rec.plan;
        horizon = rec.horizon;
      }
    } finally {
      stopWatching();
    }
    const stats = (): { nodes: number; slices: number; reads: number; loud: LoudHistogram } => ({
      nodes: clock.nodes,
      slices: kernel.lastReport?.slices ?? 0,
      reads: clock.reads,
      loud,
    });
    if (plan === null) return { staged, traces, standings, horizon, ...stats() };

    const w = board.width + 2;
    const h = board.height + 2;
    for (const [unitId, cand] of plan) {
      const unit = sub.unitOf(unitId);
      if (unit === undefined) continue;
      staged.set(unit.wireId, cand.to);
      const bank = scores
        ? new BoundBank({ sub, gen, evaluate, asTeam, basis: [], budget: FOREVER })
        : null;
      const offer = gen.candidatesFor(sub, unitId).candidates;
      const offered = new Set(offer.map((c) => c.to));
      const seed = offer.length > 0 ? (offer[0] as Candidate).to : -1;
      traces.push(
        traceFor(sub, evaluate, bank, plan, asTeam, unitId, cand, w, h, offered, seed)
      );
      // --- THE CONTEST-STANDING INSTRUMENT (contest-gap.md §2.3) -----------
      // After the plan is fixed, on the unmetered evaluator, and only with the
      // flag. It reads the same offered set the trace above does.
      if (CONTEST_DIAG) {
        const read = contestStandingRead(sub, evaluate, plan, asTeam, unitId, offer);
        if (read !== null) standings.push(read);
      }
      // --- end contest-standing instrument ---------------------------------
    }
    return { staged, traces, standings, horizon, ...stats() };
  } finally {
    sub.release();
  }
}

/** Score every option this unit had, with the rest of the plan fixed. That is
 * exactly the comparison the evaluator makes when the sweep re-optimises this
 * unit, so a trace row shows what the bot BELIEVED about the move it took. */
const FOREVER = {
  remainingMs: () => 1e9,
  elapsedMs: () => 0,
  shouldStop: () => false,
  // A counter, not a clock. Trace pricing happens after the plan is chosen and
  // cannot affect it, but a wall-clock read here would still be a wall-clock
  // read inside the runner, and the deterministic mode is easier to trust when
  // there are none left to argue about.
  now: (() => {
    let t = 0;
    return () => ++t;
  })(),
};

function traceFor(
  sub: EngineSubstrate,
  evaluate: Evaluator,
  bank: BoundBank | null,
  plan: JointPlan,
  asTeam: number,
  unitId: UnitId,
  chosen: Candidate,
  w: number,
  h: number,
  offered: ReadonlySet<number>,
  seed: number
): UnitTrace {
  const unit = sub.unitOf(unitId);
  const from = (unit?.cells[0] ?? 0) as number;
  const scored: Array<CandidateTrace & { to_: number }> = [];
  for (const option of bank === null ? [] : sub.actionsOf(unitId).slice(0, 24)) {
    const trial = new Map(plan);
    trial.set(unitId, option);
    let bound;
    let floor = Number.NaN;
    let basis = '';
    try {
      bound = evaluate.scorePlan(sub, trial, asTeam);
      const priced = (bank as BoundBank).price(withMove(plan, option));
      floor = priced.bounds.worst;
      basis = basisKeyOf(priced.bounds.assumptions);
    } catch {
      continue;
    }
    scored.push({
      to: toApiCoord(option.to, w, h),
      est: bound.est,
      lo: bound.lo,
      floor,
      basis,
      pruned: !offered.has(option.to),
      to_: option.to,
    });
  }
  // The SEARCH's own order: the proved floor first, `est` only among floor
  // ties. Reading a trace sorted by `est` is what makes an evaluator look
  // ignored when it is merely outranked.
  scored.sort((a, b) => b.floor - a.floor || b.est - a.est);
  return {
    wireId: unit?.wireId ?? '?',
    letter: unit?.wireId.split('-')[1] ?? '?',
    kind: String(unit?.type ?? 'snake'),
    health: unit?.energy ?? 0,
    from: toApiCoord(from, w, h),
    to: toApiCoord(chosen.to, w, h),
    top: scored.slice(0, 3),
    seeded: chosen.to === seed,
    reversed: false,
  };
}

// ---------------------------------------------------------------------------
// One turn of the real rules
// ---------------------------------------------------------------------------

export interface TurnOutcome {
  readonly board: Board;
  /** Every unit the turn removed, with the tier it was ADJUDICATED at. */
  readonly deaths: ReadonlyArray<{ id: string; cause: string; tier: number }>;
  readonly ate: ReadonlyArray<string>;
  /**
   * Units the turn's meal GREW, which under fill-to-grow is the subset of
   * `ate` whose meal reached the kind's maximum energy (`resolveTurn`'s food
   * phase: "it grows the eater by one weight/length only when it brings the
   * unit TO that max"). At the shipped `foodEnergy = DEFAULT_FOOD_ENERGY` the
   * two lists are equal, which is what makes the split free on every board
   * that does not set it.
   */
  readonly grown: ReadonlyArray<string>;
  /** Potions collected this turn, as the difference in the module's own list. */
  readonly potionsTaken: number;
  /** Units whose tier ROSE over the turn — an ally of a collector, mostly. */
  readonly tierUps: ReadonlyArray<string>;
  /** Units whose tier FELL — the collector itself, and every lapsing buff. */
  readonly tierDowns: ReadonlyArray<string>;
  /**
   * WHO COLLECTED, not just how many. Read the way settlement reads it — a
   * surviving unit whose head finished the turn on a cell that held a potion
   * when the turn opened — so the runner never re-derives the collection rule.
   */
  readonly collectors: ReadonlyArray<string>;
  /**
   * Every unit named in a CONTEST-shaped clash this turn, survivors included.
   * `Clash.playerIDs` is the engine's own participant list, so this is the
   * rules' answer to "was this unit in a fight", not a reconstruction of it.
   * `sever` is in the set because a strictly-higher tier is exactly what cuts a
   * body, which is a tier window paying for itself as surely as a kill is.
   */
  readonly contestants: ReadonlyArray<string>;
}

/** Clash kinds a tier decides. `bodyBlock`, `wall`, `self` and the two
 * exhaustions are terrain and geometry: no tier changes their outcome. */
const TIER_DECIDED: ReadonlySet<string> = new Set(['contest', 'edge', 'sever']);

export function stepGame(
  board: Board,
  turn: number,
  staged: ReadonlyMap<string, number>,
  rng: () => number,
  foodTarget: number,
  potions: { target: number; everyTurns: number } = { target: 0, everyTurns: 0 }
): TurnOutcome {
  const marshalled = marshalBoard(board, turn);
  // The wire stages a DESTINATION and the server's own movement grammar turns
  // it into a path — which is the only way a pawn's rotation, a slider's ray
  // and an illegal-move fallback stay the RULES' business and not the bot's.
  const units: ResolveUnit[] = marshalled.units.map((u) => {
    const to = staged.get(u.id);
    return to === undefined ? { ...u, path: [] } : { ...u, stagedMove: to };
  });
  const before = new Map(marshalled.units.map((u) => [u.id, u.occupancy.length]));
  const tierBefore = new Map(marshalled.units.map((u) => [u.id, u.tier]));

  // SETTLEMENT, NOT RESOLUTION. `resolveTurn` answers "where is everything and
  // what died" and stops there; `settleTurn` is that plus the end-of-turn
  // bookkeeping the server does above it — potion collection, the ally-buff
  // cancel, effect expiry — and it hands back `tiers`, `effects` and `potions`
  // as the NEXT turn starts from them. This runner is the SERVER's stand-in,
  // and the server calls settlement, so calling `resolveTurn` here meant every
  // potion on the board was scenery and every tier window was frozen at its
  // observed value for the whole game. Nothing below recomputes any of the
  // three: a caller that charges its own pickup has written the second
  // encoding of the rules that engine-vendor/VENDOR.md exists to prevent.
  //
  // Every unit is staged, so there is no frozen half and this is settlement
  // proper — `resolvePartialTurn` (turn-oracle.ts) is the BOT's entry point,
  // with the partial-time-advance contract that comes with predicting a turn
  // nobody has told you about, and it would be the wrong shape here.
  const result = settleTurn({
    ...marshalled.config,
    units,
    turn: marshalled.arrivalTurn,
    teamOf: Object.fromEntries(marshalled.teamOf),
    effects: marshalled.effects,
    potions: marshalled.potions,
    potionsEnabled: marshalled.potionsEnabled,
    potionWindowTurns: marshalled.potionWindowTurns,
    pawnPromotionWeight: marshalled.pawnPromotionWeight,
    maxTurns: marshalled.maxTurns,
  }, NO_SPAWN);

  const w = marshalled.fullWidth;
  const h = marshalled.fullHeight;
  const hadSchedule = board.activeEffects !== undefined;
  const snakes: Snake[] = [];
  const ate: string[] = [];
  const grown: string[] = [];
  const tierUps: string[] = [];
  const tierDowns: string[] = [];
  for (const snake of board.snakes ?? []) {
    const settled = result.board[snake.id];
    if (!settled) continue;
    const cells = settled.occupancy.map((c) => toApiCoord(c, w, h));
    const piece = snake.unitType !== undefined && snake.unitType !== 'snake';
    // A MEAL AND A GROWTH ARE TWO EVENTS, and at the shipped `foodEnergy` they
    // coincide. `ate` is settlement's own collection test, read exactly as
    // `collectors` reads a potion — a survivor whose head finished on a cell
    // the turn OPENED with food on — so it counts a meal that only fuels.
    // `grown` is the occupancy the meal bought, which under fill-to-grow is
    // the meal that topped the tank off and nothing else. Reading growth alone
    // (what this counted before `foodEnergy` was reachable from a scenario)
    // would report a lean board as a board where nothing eats.
    if (marshalled.config.food.includes(settled.occupancy[0] as number)) ate.push(snake.id);
    if (settled.occupancy.length > (before.get(snake.id) ?? 0)) grown.push(snake.id);
    const tier = result.tiers[snake.id] ?? 0;
    const was = tierBefore.get(snake.id) ?? 0;
    if (tier > was) tierUps.push(snake.id);
    if (tier < was) tierDowns.push(snake.id);
    const next: Snake = {
      ...snake,
      body: piece ? [cells[0] as Coord] : cells,
      head: { ...(cells[0] as Coord) },
      length: settled.occupancy.length,
      health: settled.energy,
      customizations: { ...snake.customizations },
      // Facing and KIND are settlement outputs: the engine rewrites
      // orientation and promotes pawns itself, so the runner reads both back.
      orientation: result.orientation[snake.id]
        ? { ...result.orientation[snake.id] }
        : { ...snake.orientation },
      // A unit that declared no kind is a snake by the bot's convention; keep
      // that shape and read the settled kind back only where one was declared.
      unitType: snake.unitType === undefined ? undefined : (result.unitTypes[snake.id] ?? snake.unitType),
      invulnerabilityLevel: tier,
    };
    if (result.promoted.includes(snake.id)) {
      next.maxHealth = board.maxHealthPerUnit?.queen ?? 100;
    }
    // How long that level is safe to bank on: the earliest expiry among the
    // effects settlement left this unit holding. A board carrying no schedule
    // can say nothing new, so its stated expiry rides across untouched — which
    // for the potion-free scenarios means the field stays absent, exactly as
    // it was before settlement was called at all.
    const expiry = aggregateExpiryTurn(result.effects, snake.id);
    if (hadSchedule && expiry !== null) next.invulnerabilityExpiryTurn = expiry;
    snakes.push(next);
  }

  const deaths = Object.entries(result.deaths).map(([id, d]) => ({
    id,
    cause: String((d as { cause?: string }).cause ?? 'unknown'),
    // The tier the turn was ADJUDICATED at, which is the one that decided
    // whether this unit survived the clash — not the settled one, which the
    // dead do not have.
    tier: tierBefore.get(id) ?? 0,
  }));

  const food = result.food.map((c) => toApiCoord(c, w, h));
  const standing = result.potions.map((c) => toApiCoord(c, w, h));
  const occupied = new Set<number>();
  for (const s of snakes) for (const c of s.body) occupied.add(apiCoordToIndex(c, w, h));
  for (const f of food) occupied.add(apiCoordToIndex(f, w, h));
  for (const p of standing) occupied.add(apiCoordToIndex(p, w, h));
  const free = (): Coord | null => {
    for (let guard = 0; guard < 200; guard++) {
      const x = Math.floor(rng() * board.width);
      const y = Math.floor(rng() * board.height);
      const idx = apiCoordToIndex({ x, y }, w, h);
      if (occupied.has(idx)) continue;
      occupied.add(idx);
      return { x, y };
    }
    return null;
  };
  while (food.length < foodTarget) {
    const cell = free();
    if (cell === null) break;
    food.push(cell);
  }
  // SPAWNING IS THE CALLER'S, and it is a die roll: `settleTurn` collects a
  // potion and deliberately does not place one (VENDOR.md, "What is
  // deliberately NOT in the module"). The schedule is the seeded rng and a
  // fixed cadence, so it is reproducible like everything else — and it draws
  // NOTHING from the rng on a board with no potions configured, which is what
  // keeps the potion-free scenarios' food stream identical.
  if (potions.target > 0 && potions.everyTurns > 0 && turn % potions.everyTurns === 0) {
    while (standing.length < potions.target) {
      const cell = free();
      if (cell === null) break;
      standing.push(cell);
    }
  }

  const next: Board = { ...board, snakes, food };
  if (board.invulnerabilityPotions !== undefined) next.invulnerabilityPotions = standing;
  if (hadSchedule || result.effects.length > 0) next.activeEffects = result.effects;

  // WHO took a potion: settlement's own test, asked of the settled board — a
  // survivor whose head rests on a cell the turn opened with a potion on.
  const collectors: string[] = [];
  if (marshalled.potionsEnabled) {
    for (const [id, settled] of Object.entries(result.board)) {
      if (marshalled.potions.includes(settled.occupancy[0] as number)) collectors.push(id);
    }
  }
  const contestants: string[] = [];
  for (const clash of result.clashes) {
    if (!TIER_DECIDED.has(clash.kind)) continue;
    for (const id of clash.playerIDs) if (!contestants.includes(id)) contestants.push(id);
  }

  return {
    board: next,
    deaths,
    ate,
    grown,
    potionsTaken: marshalled.potions.length - result.potions.length,
    tierUps,
    tierDowns,
    collectors,
    contestants,
  };
}

// ---------------------------------------------------------------------------
// THE PICKUP INSTRUMENT — what the collector walked into, read over the WINDOW
// ---------------------------------------------------------------------------

/**
 * WHAT ONE PICKUP LOOKED LIKE AT THE MOMENT IT HAPPENED.
 *
 * The first potion member was deleted because the counter that judged it could
 * not tell the pickups apart (`docs/design/potions.md`, "The instrument has
 * almost no power"): `profitablePickups` waits for an ally to be in a clash,
 * which is a fact about the next three turns rather than about the decision,
 * and it fires on 27-29% of pickups whatever the bot does. This reading is the
 * fix that post-mortem asks for — the enemy tier RECORDED AT THE PICKUP, and
 * the collector's own exposure while it is debuffed, both asked of the rules
 * rather than reconstructed.
 *
 * THE GROUND IS THE ENGINE'S OWN DILATION. A `Claim` over a span of `k` turns
 * is exactly "where could this unit be, and how strong could it be, after that
 * many turns of unknown movement" — `everPossible` is the cell set and
 * `tierAtArrival`/`weightMax` the strength — so both sides are `computeClaims`'
 * answer and neither is a second encoding of the movement grammar. Every unit
 * is held, which makes the reading a pure function of the settled board.
 *
 * ── WHY `exposed` IS THE WINDOW'S FIRST TURN AND NOT ITS WHOLE SPAN ────────
 *
 * The post-mortem's first repair was "read the peril over the WINDOW's
 * dilation, not one turn". Done literally — a claim at span 3 for the collector
 * against claims at span 3 for the enemies — it was measured on `potions`,
 * seeds 1-5, and it is VACUOUS: 41 pickups out of 41 came back exposed. The
 * per-horizon counts say why. On seed 1, the beaten share of the collector's
 * own ground reads
 *
 *     k=1  1/6   2/6   2/5   4/5   1/9   0/5   0/9   1/5   0/1
 *     k=2  13/13 10/13 12/13 13/13 9/16  13/13 10/16 13/13 0/3
 *     k=3  24/25 24/25 20/24 24/25 25/27 25/25 25/26 23/25 1/7
 *
 * — by the second turn of the window every unit on an 11x11 board can meet
 * every other, so "could an enemy that outranks me share my ground inside the
 * window" is true of every pickup ever made and discriminates nothing. A
 * debuffed unit loses to EVERYTHING (tier is read before weight), so the
 * saturation is total rather than a matter of degree.
 *
 * What the span does carry is WHEN. So the verdict is the earliest horizon at
 * which a beating enemy can share the collector's ground, and `exposed` is that
 * horizon being the very first turn of the window — the turn the collector has
 * had no chance to walk away from yet. Danger that only arrives as the window
 * lapses is not the danger the brief is about, and the claim at k=3 over-states
 * it anyway, because it grants the enemy three free turns and the collector
 * none.
 */
interface PickupReading {
  /** The collector's energy as the pickup turn closed. */
  readonly energy: number;
  /** The highest tier any enemy sharing its window ground could bring. */
  readonly enemyTier: number;
  /** The first turn of the window at which a beating enemy can share its
   *  ground, or 0 for "not inside the window at all". */
  readonly catchTurn: number;
  /** `catchTurn === 1`: caught on the window's first turn. */
  readonly exposed: boolean;
  /**
   * THE ARRIVAL-CELL READING — the hypothesis the third attempt tests, measured
   * before any rule ships (`docs/design/potions.md`, "P3").
   *
   * `exposed` above is a fact about the collector's whole GROUND: some enemy
   * that beats it can stand somewhere it can stand. `arrivalBeaten` is a fact
   * about the ONE CELL the plan actually left it on — the potion cell it is
   * standing on as this turn closes — and it is the only half of the reading
   * that can differ between two plans by the same collector, because the ground
   * is read from the turn-start cell and is therefore common to all of them.
   *
   * Same frame as `exposed` (horizon 1 off the settled board), same
   * conservatism (our lightest against their heaviest, at the tier the pickup
   * left each of them on), so the two are directly comparable and the gap
   * between them is exactly what a per-plan rule has left to work with.
   */
  readonly arrivalBeaten: boolean;
  /** How many of the collector's horizon-1 ground cells a beating enemy holds,
   *  and how many there are — the share `perilOf` charges today, printed so the
   *  boolean above can be read against it. */
  readonly groundBeaten1: number;
  readonly groundCells1: number;
}

/**
 * Read one pickup off the board it left behind.
 *
 * `board` is the SETTLED board — the collector already carries its -1 and its
 * allies their +1 — and `turn` is the turn that produced it, so the next turn
 * adjudicated is `turn + 1` and the window runs `window` turns from there.
 */
function readPickup(
  board: Board,
  turn: number,
  collectorId: string,
  window: number
): PickupReading | null {
  const m = marshalBoard(board, turn);
  if (m.units.length === 0) return null;
  const span = Math.max(1, window);
  const record = m.units.find((u) => u.id === collectorId);
  // The cell the plan left the collector on: the potion cell it rests on as
  // this turn closes. Collection is destination-only, so this IS the arrival
  // cell the decision chose.
  const arrivalCell = record?.occupancy[0] ?? -1;
  let enemyTier = 0;
  let catchTurn = 0;
  let arrivalBeaten = false;
  let groundBeaten1 = 0;
  let groundCells1 = 0;
  for (let k = 1; k <= span; k++) {
    const claims = claimsAfter(m, k);
    const mine = claims.find((c) => c.id === collectorId);
    if (mine === undefined) return null;
    const ground = new Set(mine.everPossible);
    // Horizon 1 only: the per-cell reading. `beaters` is every cell some enemy
    // that BEATS the debuffed collector could stand on next turn, so the
    // arrival cell's verdict and the ground's share come off the one pass.
    const beaters = k === 1 ? new Set<number>() : null;
    for (const claim of claims) {
      if (claim.teamID === mine.teamID) continue;
      const beatsUs = !winsContest(
        mine.tierAtArrival,
        mine.weightMin,
        claim.tierAtArrival,
        claim.weightMax
      );
      if (beaters !== null && beatsUs) for (const cell of claim.everPossible) beaters.add(cell);
      let meets = false;
      for (const cell of claim.everPossible) {
        if (ground.has(cell)) {
          meets = true;
          break;
        }
      }
      if (!meets) continue;
      if (claim.tierAtArrival > enemyTier) enemyTier = claim.tierAtArrival;
      // CONSERVATIVE, both ends: our lightest against their heaviest, at the
      // tier the pickup left each of them on. `winsContest` is
      // `strictMaximum`'s own tier-then-weight order, not a paraphrase.
      if (catchTurn === 0 && beatsUs) {
        catchTurn = k;
      }
    }
    if (beaters !== null) {
      arrivalBeaten = arrivalCell >= 0 && beaters.has(arrivalCell);
      groundCells1 = ground.size;
      for (const cell of ground) if (beaters.has(cell)) groundBeaten1++;
    }
  }
  return {
    energy: record?.energy ?? 0,
    enemyTier,
    catchTurn,
    exposed: catchTurn === 1,
    arrivalBeaten,
    groundBeaten1,
    groundCells1,
  };
}


// ---------------------------------------------------------------------------
// THE ENTRAPMENT INSTRUMENT — docs/design/entrapment.md §7.2
// ---------------------------------------------------------------------------

/**
 * WHAT A UNIT CAN KEEP, read off the concrete board the turn LEFT.
 *
 * This is the barred flood of `docs/design/entrapment.md` §3, run with nothing
 * uncertain: every unit is held at `observedTurn = arrivalTurn − t` for
 * `t = 1 … k`, so `computeClaims` — the rules' own dilation — answers where
 * each unit's head could be by each turn of the horizon, and the schedule
 * clause reads the occupancies standing in front of it. It is the COLLAPSED
 * reading, `lo === hi`, which is what a concrete board admits.
 *
 * It follows `bounds/loud.ts`'s rule for what an instrument may do: it counts.
 * It settles nothing, evaluates nothing, reads no clock and makes no evaluator
 * call, so under the runner's node clock (`nodes × NODE_COST + reads ×
 * READ_COST`) it cannot move a counter — which is what lets it be merged on a
 * gate that says "byte-identical" and means it.
 *
 * THE THREE BARRIER CLASSES, and the middle one is the whole finding:
 *
 *  (a) TERRAIN. `walls`, at every `t`. A trail unit may legally STAGE the
 *      perimeter (`moveGrammar.planUnitAction`), so the step relation offers
 *      it and this is what refuses it.
 *  (b/c) EVERY TRAIL UNIT'S BODY, ON ITS OWN VACATING SCHEDULE — its own
 *      included. `O^v[i]` is barred at `t` iff `i ≤ L_v − 1 − t`: the neck
 *      argument (`claims.ts`'s `certainIfAlive`) generalised from one turn to
 *      `t`. At `t = 1` that is exactly `occupancy[0 .. len-2]`; at `t = L_v` it
 *      is empty. A SNAKE CANNOT TRAP ITSELF: its own coil opens behind it one
 *      cell per turn, so a region bounded by its own trail is always at least
 *      its own length. A static own-body barrier says the opposite and is a
 *      false alarm generator (§3.2, §7.1).
 *  (d) GROUND SOMEBODY ELSE CAN HOLD FIRST. `c` is barred at `t` iff some
 *      OTHER unit's head can be on `c` at or before `t` — the claim cloud,
 *      unbarred and over-approximating, which is the only direction a claim
 *      may be wrong in. `at or before`, not `strictly before`: a tie kills
 *      both, so a cell we tie for is not a cell we keep.
 *
 * A PIECE has no trail and no schedule and contributes only through (d), whose
 * `t = 0` seed already holds its own cell. Nothing branches on a kind name;
 * `leavesTrail` decides, exactly as it decides which plane of the territory
 * partition a unit is on.
 */
export interface EntrapmentReading {
  readonly id: string;
  /** Cells the unit can keep over its own horizon, capped at `need`. */
  readonly kept: number;
  /** `max(4, L + 2)`: a region of exactly `L` is survivable only if it admits
   *  a Hamiltonian cycle; `+1` buys a meal's growth, `+2` one cell lost to a
   *  crowder. It is also the horizon — a horizon shorter than the body cannot
   *  see the tail stop feeding the head (§3.1). */
  readonly need: number;
}

/** `need(u)`, and therefore `k_u`. One place, read by the runner and the tests. */
export const entrapmentNeed = (length: number): number => Math.max(4, length + 2);

export function entrappedAt(board: Board, turn: number): EntrapmentReading[] {
  const m = marshalBoard(board, turn);
  const trails = m.units.filter((u) => leavesTrail(u.type));
  if (trails.length === 0) return [];
  let kMax = 0;
  for (const u of trails) kMax = Math.max(kMax, entrapmentNeed(u.occupancy.length));

  // (d) — the cumulative head cloud per unit, per horizon turn. `t = 0` is the
  // cell it stands on, which is why a piece needs no other clause at all.
  const cloud = new Map<string, Set<number>[]>();
  for (const u of m.units) cloud.set(u.id, [new Set<number>([u.occupancy[0] as number])]);
  for (let t = 1; t <= kMax; t++) {
    // Asked of the rules rather than reconstructed, exactly as `readPickup`
    // asks them.
    const claims = claimsAfter(m, t);
    const seen = new Set<string>();
    for (const claim of claims) {
      const per = cloud.get(claim.id);
      if (per === undefined) continue;
      seen.add(claim.id);
      const next = new Set<number>(per[t - 1] as Set<number>);
      for (const c of claim.headPossible[claim.headPossible.length - 1] ?? []) next.add(c);
      per.push(next);
    }
    // A unit the claim pass dropped keeps the cloud it had: never smaller, so
    // never an under-count of what somebody else can hold.
    for (const [id, per] of cloud) {
      if (!seen.has(id)) per.push(per[t - 1] as Set<number>);
    }
  }

  // (b)/(c) — one barrier board per horizon turn, shared by every unit, because
  // the schedule is a property of the body being vacated and not of who is
  // looking at it.
  const bodyBarred: Set<number>[] = [];
  for (let t = 0; t <= kMax; t++) {
    const barred = new Set<number>();
    for (const v of trails) {
      const last = v.occupancy.length - 1 - t;
      for (let i = 0; i <= last; i++) barred.add(v.occupancy[i] as number);
    }
    bodyBarred.push(barred);
  }

  const walls = new Set<number>(m.config.walls);
  const shape: BoardShape = {
    boardWidth: m.config.boardWidth,
    boardHeight: m.config.boardHeight,
    walls: m.config.walls,
    hazards: m.config.hazards,
    occupancy: m.units.map((u) => ({ id: u.id, cells: u.occupancy })),
    food: m.config.food,
  };
  // The engine's own step relation, memoised per (kind, cell) for the handful
  // of cells a capped flood ever visits. Nothing here decides what a unit may
  // do — `legalTargets` does, and this only iterates it.
  const steps = new Map<string, number[]>();
  const stepOf = (type: UnitType, cell: number): number[] => {
    const key = `${type}|${cell}`;
    const hit = steps.get(key);
    if (hit !== undefined) return hit;
    const made = legalTargets(
      { type, occupancy: [cell], orientation: ORTHOGONALS[0] as Orientation },
      shape
    );
    steps.set(key, made);
    return made;
  };

  const out: EntrapmentReading[] = [];
  for (const u of trails) {
    const need = entrapmentNeed(u.occupancy.length);
    const region = new Set<number>([u.occupancy[0] as number]);
    for (let t = 1; t <= need && region.size < need; t++) {
      const add: number[] = [];
      const barred = bodyBarred[Math.min(t, kMax)] as Set<number>;
      for (const from of region) {
        for (const to of stepOf(u.type, from)) {
          if (region.has(to) || walls.has(to) || barred.has(to)) continue;
          let taken = false;
          for (const [id, per] of cloud) {
            if (id === u.id) continue;
            if ((per[Math.min(t, per.length - 1)] as Set<number>).has(to)) {
              taken = true;
              break;
            }
          }
          if (!taken) add.push(to);
        }
      }
      // THE LOITER CARRY, AND WHERE IT STOPS. `R_t = R_{t-1} ∪ …` is what lets
      // the region grow through a cell that only opens later — the head can
      // wait while its own body clears — and it is suppressed at a SINGLETON:
      // a unit with one cell and no unbarred step has nowhere to wait, it must
      // move, and every move it has is barred. Carrying there would credit it
      // with an escape it cannot walk to (§3.3).
      if (add.length === 0) {
        if (region.size === 1) break;
        continue;
      }
      for (const c of add) region.add(c);
    }
    out.push({ id: u.id, kept: Math.min(region.size, need), need });
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE IMMOBILITY INSTRUMENT — docs/design/BEHAVIOUR-AUDIT-2.md P1
// ---------------------------------------------------------------------------

/**
 * EVERY LIVING UNIT ON THIS BOARD WITH NO LEGAL `move` — the wire ids of the
 * units whose entire option set leaves them standing on the cell they are on.
 *
 * P1's counter, and it goes in before the rule it judges. `moveGrammar` gives
 * a pawn on the perimeter facing outward three legal actions — the two side
 * squares, which are `rotate`, and its own square, which is `stay` — and the
 * forward step it does not have, because a perimeter cell is not interior. All
 * three leave the pawn where it is, so the pawn cannot get off a contested
 * cell however it is scored, and no counter in this file said so.
 *
 * ASKED OF THE GRAMMAR, not reconstructed from geometry: `legalActions` is the
 * same call `queries.ts` answers every other reach question with, so it is
 * masked by the perimeter, by the board's occupancy and by the pawn-target set
 * exactly as the engine masks them, and a grammar change moves the instrument
 * with the thing it measures. Read on the board a turn LEFT, after settlement,
 * so it makes no evaluator call and cannot reach the decision it counts.
 *
 * A trail unit is never in this set: its one orthogonal step is legal wherever
 * it stands, walls included (staging the perimeter is a legal move and a fatal
 * one), which is why `snakes`, `sparse` and `sparse-lean` read zero.
 */
export function immobileAt(board: Board, turn: number): Set<string> {
  const m = marshalBoard(board, turn);
  const shape: BoardShape = {
    boardWidth: m.config.boardWidth,
    boardHeight: m.config.boardHeight,
    walls: m.config.walls,
    hazards: m.config.hazards,
    occupancy: m.units.map((u) => ({ id: u.id, cells: u.occupancy })),
    food: m.config.food,
  };
  const out = new Set<string>();
  for (const u of m.units) {
    const moves = legalActions(
      { type: u.type, occupancy: u.occupancy, orientation: u.orientation },
      shape
    ).some((entry) => entry.action.kind === 'move');
    if (!moves) out.add(u.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE ENEMY-OCCUPIED ENTRY INSTRUMENT — docs/design/BEHAVIOUR-AUDIT.md D1
// ---------------------------------------------------------------------------

/**
 * HOW OFTEN DOES A UNIT STAGE THE CELL AN ENEMY IS STANDING ON, AND HOW OFTEN
 * DOES IT LOSE THERE?
 *
 * D1's counter, and it goes in before the rule it judges. The audit's three
 * `edge` deaths are all one shape: our unit staged the square an adjacent
 * enemy head occupied at the START of the turn, `turnEngine.ts` c1 adjudicated
 * the head-on exchange over that edge, and we lost it. So the thing to count
 * is exactly that — a staged destination equal to an enemy's turn-start head
 * cell — split by whether `winsContest` says we survive it.
 *
 * It follows `bounds/loud.ts:19-34`'s rule for what an instrument may do: it
 * counts. It reads the board the decision was taken on and the destinations
 * that decision staged, settles nothing, evaluates nothing, reads no clock and
 * makes no evaluator call, so under the runner's node clock it cannot move a
 * counter. `winsContest` is `strictMaximum`'s own tier-then-weight order,
 * imported rather than paraphrased, and a piece's weight is its occupancy
 * repeat exactly as `substrate.ts` reads it.
 *
 * BOTH HALVES ARE REPORTED. `entries` is the opportunity — how often the bot
 * walks at an occupied square at all, which a fix must not simply drive to
 * zero, since taking a square off a lighter enemy is a capture and not a
 * blunder — and `lost` is the blunder.
 */
export interface EnemyOccupiedEntry {
  /** Ours, the one that staged it. */
  readonly id: string;
  /** Theirs, the one standing on the cell when the turn opened. */
  readonly enemy: string;
  /** `winsContest` says we do not survive the meeting. */
  readonly lost: boolean;
}

export function enemyOccupiedEntriesAt(
  board: Board,
  turn: number,
  staged: ReadonlyMap<string, number>
): EnemyOccupiedEntry[] {
  const m = marshalBoard(board, turn);
  const occupant = new Map<number, ResolveUnit>();
  for (const u of m.units) {
    const head = u.occupancy[0];
    if (head !== undefined) occupant.set(head, u);
  }
  const out: EnemyOccupiedEntry[] = [];
  for (const u of m.units) {
    const to = staged.get(u.id);
    if (to === undefined) continue;
    const them = occupant.get(to);
    // A unit staging its own cell is a hold, and an ally's cell is not a
    // contest the rules adjudicate between two teams.
    if (them === undefined || them.id === u.id || them.teamID === u.teamID) continue;
    out.push({
      id: u.id,
      enemy: them.id,
      lost: !winsContest(u.tier, u.occupancy.length, them.tier, them.occupancy.length),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The game loop, and the counters a gate reads
// ---------------------------------------------------------------------------

export interface GameMetrics {
  turns: number;
  unitTurns: number;
  foodEaten: number;
  /**
   * MEALS THAT GREW THE EATER. Under the shipped `foodEnergy` every meal fills
   * and every meal grows, so this equals `foodEaten` on every board that does
   * not set one; on a lean board `grownMeals / foodEaten` is the division of
   * labour the fill-to-grow rule creates and the audit's open gap.
   */
  grownMeals: number;
  /** Moves that put a unit's head back on the cell it left last turn. */
  reversals: number;
  /**
   * Reversals WITH NO SCORING REASON: the unit went back where it came from and
   * that move was not even the best one on the board by the bank's own proved
   * floor. This is the number gate (b) is really about — a reversal the search
   * can justify is a retreat, and a bot that cannot retreat is worse, not
   * better. Only counted when the runner is scoring options (`scores: true`).
   */
  unjustifiedReversals: number;
  /**
   * THE TRUE PARKED SHARE — a unit whose head cell is the same at the start of
   * two consecutive turns.
   *
   * D6 (`docs/design/BEHAVIOUR-AUDIT.md`): this used to compare `from` against
   * the STAGED `to`, and a pawn's rotation stages a side square it never
   * enters (`moveGrammar.planUnitAction`, the `rotate` branch), so nineteen
   * parked turns registered as fifteen moves. A rotation is a rotation: the
   * cell HELD is what says whether the unit went anywhere, and the staged cell
   * is kept only for the dither signature below. The reading is therefore one
   * turn behind — it is a fact about the turn that has already resolved — and
   * a unit's first turn is neither parked nor moved.
   */
  stationary: number;
  /** The longest run of consecutive parked turns any one unit had. */
  longestPark: number;
  /**
   * THE DITHER SIGNATURE. The unit did not move, and the destination it staged
   * is not the one it staged last turn: a pawn rotating left, then right, then
   * left again is exactly this and nothing else.
   */
  dithers: number;
  /** Unit-turns that actually changed the unit's cell. */
  movesWithChoice: number;
  /** Unit-turns where the chosen move was just the generator's first option. */
  seedKept: number;
  starvationDeaths: number;
  otherDeaths: number;
  deathsByCause: Record<string, number>;
  /** Potions collected — settlement's own before/after count, not a re-derived rule. */
  potionPickups: number;
  /**
   * PICKUPS THAT PAID FOR THEMSELVES. A pickup is profitable when, inside the
   * window it opens, an ALLY of the collector (never the collector, whose own
   * tier went DOWN) was named in a tier-decided clash — a contest, an edge
   * exchange or a sever. That is the only thing an invulnerability tier does
   * under these rules (`strictMaximum` takes tier first), so it is the whole of
   * "the pickup bought the team something", counted once per pickup.
   *
   * The window is the engine's own: settlement stamps `expiryTurn = turn +
   * potionWindowTurns` and expires at the END of a turn, so the buff decides
   * every clash from the turn after the pickup up to and including that turn.
   */
  profitablePickups: number;
  /**
   * THE BRIEF'S TWO VERDICTS, taken at the moment of the pickup rather than
   * three turns later. See `readPickup`.
   *
   * `reckless` — the collector walked onto the potion with an enemy able, over
   * the window it just opened, to stand where it can stand and beat it there at
   * the tier the pickup left it on.
   *
   * `profitableSafe` — the pickup bought an ally a tier-decided clash inside
   * its window AND the collector was not exposed. It is the conjunction the
   * owner's intent names: profitable for the team, and the collector not in
   * great danger. `profitablePickups` (above) is the older, weaker half of it
   * and is kept unchanged so the numbers in `docs/design/potions.md` stay
   * comparable.
   */
  recklessPickups: number;
  profitableSafePickups: number;
  /**
   * THE PER-PLAN HALF OF THE SAME QUESTION (`readPickup.arrivalBeaten`).
   * `arrivalBeatenPickups` counts the pickups whose OWN CELL a beating enemy
   * can hold on the next turn; `recklessArrivalBeaten` is the cross-tab against
   * `recklessPickups`. The two counters together say how much of the ground
   * reading a per-plan rule could ever recover, and they are what the third
   * attempt's hypothesis is scored on before any rule ships.
   */
  arrivalBeatenPickups: number;
  recklessArrivalBeaten: number;
  /** Summed horizon-1 beaten cells and ground cells, one term per pickup: the
   *  share `perilOf` charges, as a corpus mean rather than a per-seed anecdote. */
  pickupGroundBeaten1Sum: number;
  pickupGroundCells1Sum: number;
  /** Summed best enemy tier over the window, one term per pickup — the counter
   *  the deleted member's post-mortem asked for. */
  pickupEnemyTierSum: number;
  /** Summed collector energy at pickup, one term per pickup. */
  pickupEnergySum: number;
  /** Unit-turns that ended on a HIGHER tier: an ally of a collector, mostly. */
  potionTierUps: number;
  /** Unit-turns that ended on a lower tier: the collector, and lapsing buffs. */
  potionTierDowns: number;
  /** Deaths of a unit adjudicated at a NEGATIVE tier — it paid for its potion. */
  deathsWhileDebuffed: number;
  /** Deaths of a unit adjudicated at a positive tier — invulnerability is not immunity. */
  deathsWhileBuffed: number;
  // --- THE ENEMY-OCCUPIED ENTRY INSTRUMENT (BEHAVIOUR-AUDIT.md D1) --------
  /** Unit-turns staging the cell an enemy head occupied at the turn's start. */
  enemyOccupiedEntries: number;
  /** Those of them `winsContest` says we do not survive — D1's counter. */
  enemyOccupiedEntriesLost: number;
  // --- end enemy-occupied entry instrument --------------------------------
  // --- THE CONTEST-STANDING INSTRUMENT (docs/design/contest-gap.md §2.3) --
  // Four mutually exclusive buckets over decider unit-turns, and the contest
  // deaths that fell in each. Zero without `CENTAUR_CONTEST_DIAG=1`.
  /** Origin outside every enemy fan. */
  contestOutsideTurns: number;
  /** Origin safe, but some offered option is beaten. */
  contestExposedTurns: number;
  /** ORIGIN BEATEN AND `contest` EXACTLY CONSTANT — the flat bucket. */
  contestFlatTurns: number;
  /** Origin beaten and `contest` still graded across the options. */
  contestGradedTurns: number;
  /** Flat-bucket unit-turns where the STANDING charge would discriminate. */
  contestFlatStandingVaries: number;
  /** The flat bucket read over every LEGAL action rather than the offered set
   *  — `contest-gap.md` §2.3's own reading. See `ContestStandingRead.flatAll`. */
  contestFlatAllTurns: number;
  contestOutsideDeaths: number;
  contestExposedDeaths: number;
  contestFlatDeaths: number;
  contestGradedDeaths: number;
  /** Contest deaths classified at the ENTRY turn (contest-gap.md §1): the last
   *  turn the unit's own cell was not beaten. */
  contestClassA: number;
  contestClassB: number;
  contestClassC: number;
  contestClassE: number;
  contestClassOther: number;
  /** No entry turn was ever recorded for the unit — it was already in a fan. */
  contestClassUnknown: number;
  // --- end contest-standing instrument -------------------------------------
  // --- THE ENTRAPMENT INSTRUMENT (docs/design/entrapment.md §7.2) ----------
  // Five counters, computed post hoc on the concrete board the turn left. They
  // read the rules; they never touch the decision, so they cannot move any
  // counter above them.
  /** Living trail unit-turns reading `kept < need`. */
  entrappedUnitTurns: number;
  /** Transitions free → entrapped: a unit stuck for five turns counts once. */
  entrapmentEpisodes: number;
  /** Episodes ending in that unit's death, while entrapped or on the next turn. */
  fatalEntrapments: number;
  /** Episodes ending with the unit free again. */
  escapedEntrapments: number;
  /** Σ over fatal episodes of (death turn − first entrapped turn). The mean
   *  warning in turns is `entrapmentLeadSum / fatalEntrapments`, and it is the
   *  number that decides whether any member can act on the horizon at all. */
  entrapmentLeadSum: number;
  // --- end entrapment instrument -----------------------------------------
  // --- THE IMMOBILITY INSTRUMENT (docs/design/BEHAVIOUR-AUDIT-2.md P1) -----
  // Two counters, computed post hoc on the concrete board each turn left, by
  // asking the grammar the same question the fold's `mobility` addend asks.
  // They read the rules; they never touch the decision.
  /**
   * UNIT-TURNS WHOSE CHOSEN ACTION LEFT THE UNIT WITH NOWHERE TO GO — every
   * living unit on the board a turn produced whose whole legal option set is
   * `stay` and `rotate`, summed over turns.
   *
   * P1: a pawn on the perimeter facing outward has exactly three legal
   * actions and all three leave it on the same cell, so it is boxed by its own
   * orientation and nothing in the fold could see it. Zero on a board with no
   * piece: a trail unit's one orthogonal step is always legal somewhere,
   * walls included.
   */
  immobileUnitTurns: number;
  /**
   * Deaths of a unit that entered the turn it died on with no legal `move` —
   * P1's mortality half, and reproduction B exactly (`red-B` parked at (0,8)
   * and taken there by a contest it could not step off).
   */
  deathsWhileImmobile: number;
  // --- end immobility instrument -------------------------------------------
  /** Health of every living unit at the end. */
  endHealth: number[];
  /** Wall time of the slowest single team decision, ms. NOT reproducible. */
  worstDecisionMs: number;
  /** Evaluator calls charged over the whole game — the work the run bought. */
  nodes: number;
  /** Kernel refinement slices over the whole game. */
  slices: number;
  /** Clock reads over the whole game — inner search-loop iterations. */
  reads: number;
  /** The most work any single team decision spent, in nodes. */
  worstDecisionNodes: number;
  /** Team decisions taken. `nodes / decisions` is the per-decision mean. */
  decisions: number;
  /** The loud product over every B3 preamble of the game (08 §5 step 1). */
  loud: LoudHistogram;
  crashed: string | null;
}

export interface GameResult {
  readonly metrics: GameMetrics;
  readonly log: string[];
  readonly finalBoard: Board;
}

/**
 * ONE OPPONENT: a name from the bot-binding catalog, and the evaluator that
 * name resolved to. `name` rides along so the JSON summary can carry it
 * (`RunSummary.opponent`) without re-deriving it from an `Evaluator`, which
 * exposes nothing to derive a name from.
 */
export interface Opponent {
  readonly name: string;
  readonly evaluate: Evaluator;
}

/**
 * `--opponent=<profile>` → an `Opponent`, resolved and validated through the
 * SAME seam production binds a bot with. `parseBotSpec` against
 * `BUILTIN_BOTS` is exactly what `BotRegistry` runs a stored `bot.*` binding
 * through before a live game plays it — a catalog member by name is the
 * string-literal branch of that function — so a name this accepts is a name
 * production would too, and the refusal message is the one that already
 * lists what exists. There is no second catalog and no second check: an
 * unknown name (a `greedy-food` or a `cautious` nobody has built) is refused
 * here exactly as it would be as a stored binding, naming the catalog that
 * DOES exist rather than inventing an entry for one that doesn't.
 */
export function resolveOpponent(name: string): Opponent {
  const parsed = parseBotSpec(name, BUILTIN_BOTS);
  if ('error' in parsed) {
    throw new Error(`--opponent=${name}: ${parsed.error}`);
  }
  return { name, evaluate: new BoundEvaluator(parsed.spec.profile) };
}

export async function runGame(
  spec: GameSpec,
  opts: {
    evaluate?: Evaluator;
    scores?: boolean;
    onTurn?: (line: string) => void;
    /** Asked once per (turn, team). Returning undefined leaves
     *  `KernelInput.lens` unset, which is the unwatched decision the cost gate
     *  compares against. */
    lensFor?: (turn: number, teamId: string) => { sink: LensSink; attach?: (sub: EngineSubstrate) => void } | undefined;
    /**
     * STRATEGY DIVERSITY, NOT ANOTHER MIRROR. Absent (the default, and the
     * state the byte-identity gate measures): every team plays
     * `opts.evaluate ?? defaultEvaluator`, exactly as before this option
     * existed — mirror self-play, unchanged bit for bit. Present: TEAM 0 —
     * `spec.teams[0]?.id`, the deciding team by the scenario's OWN roster
     * order, not the alphabetical order the turn loop iterates in — keeps
     * that same default profile, and every other team plays `opponent`'s
     * instead. The bot itself is never touched; only which profile each
     * team's copy of the shipped evaluator folds against.
     */
    opponent?: Opponent;
  } = {}
): Promise<GameResult> {
  const rng = mulberry32(spec.seed ?? 1);
  const budget: DecisionBudget =
    spec.nodeBudget === undefined
      ? { kind: 'ms', ms: spec.budgetMs ?? 150 }
      : { kind: 'nodes', nodes: spec.nodeBudget };
  const maxTurns = spec.maxTurns ?? 100;
  const foodTarget = spec.foodTarget ?? spec.food.length;
  const potionSchedule = {
    target: spec.potions === undefined ? 0 : (spec.potionTarget ?? spec.potions.length),
    everyTurns: spec.potionRespawnTurns ?? 1,
  };
  let board = buildBoard(spec);
  const log: string[] = [];
  const emit = (line: string): void => {
    log.push(line);
    opts.onTurn?.(line);
  };

  const metrics: GameMetrics = {
    turns: 0,
    unitTurns: 0,
    foodEaten: 0,
    grownMeals: 0,
    reversals: 0,
    unjustifiedReversals: 0,
    stationary: 0,
    longestPark: 0,
    dithers: 0,
    movesWithChoice: 0,
    seedKept: 0,
    starvationDeaths: 0,
    otherDeaths: 0,
    deathsByCause: {},
    potionPickups: 0,
    profitablePickups: 0,
    recklessPickups: 0,
    profitableSafePickups: 0,
    arrivalBeatenPickups: 0,
    recklessArrivalBeaten: 0,
    pickupGroundBeaten1Sum: 0,
    pickupGroundCells1Sum: 0,
    pickupEnemyTierSum: 0,
    pickupEnergySum: 0,
    potionTierUps: 0,
    potionTierDowns: 0,
    deathsWhileDebuffed: 0,
    deathsWhileBuffed: 0,
    enemyOccupiedEntries: 0,
    enemyOccupiedEntriesLost: 0,
    // --- contest-standing instrument (contest-gap.md §2.3) ------------------
    contestOutsideTurns: 0,
    contestExposedTurns: 0,
    contestFlatTurns: 0,
    contestGradedTurns: 0,
    contestFlatStandingVaries: 0,
    contestFlatAllTurns: 0,
    contestOutsideDeaths: 0,
    contestExposedDeaths: 0,
    contestFlatDeaths: 0,
    contestGradedDeaths: 0,
    contestClassA: 0,
    contestClassB: 0,
    contestClassC: 0,
    contestClassE: 0,
    contestClassOther: 0,
    contestClassUnknown: 0,
    // --- end contest-standing instrument ------------------------------------
    // --- entrapment instrument ---------------------------------------------
    entrappedUnitTurns: 0,
    entrapmentEpisodes: 0,
    fatalEntrapments: 0,
    escapedEntrapments: 0,
    entrapmentLeadSum: 0,
    // --- end entrapment instrument -----------------------------------------
    // --- immobility instrument (BEHAVIOUR-AUDIT-2.md P1) --------------------
    immobileUnitTurns: 0,
    deathsWhileImmobile: 0,
    // --- end immobility instrument -----------------------------------------
    endHealth: [],
    worstDecisionMs: 0,
    nodes: 0,
    slices: 0,
    reads: 0,
    worstDecisionNodes: 0,
    decisions: 0,
    loud: emptyLoudHistogram(),
    crashed: null,
  };
  /**
   * OPEN POTION WINDOWS, one per pickup, retired when the buff lapses. The
   * counter is a claim about what a pickup BOUGHT, so it cannot be settled on
   * the turn of the pickup: the buff opens the turn after and runs to
   * `endsTurn`, and the window is scored the first turn an ally is in a
   * tier-decided clash inside it.
   */
  const windows: {
    collector: string;
    team: string;
    endsTurn: number;
    paid: boolean;
    /** The pickup's own reading, taken when the window opened. */
    exposed: boolean;
  }[] = [];
  const potionWindow = spec.potionWindowTurns ?? DEFAULT_POTION_WINDOW_TURNS;
  // wireId -> the cell it HELD at the start of the previous turn. Compared
  // against the cell it holds now, that is the parked reading (D6); compared
  // against the cell it stages now, it is the reversal reading.
  const previousCell = new Map<string, string>();
  /** wireId -> the destination it staged last turn, for the dither signature. */
  const previousStage = new Map<string, string>();
  /** wireId -> consecutive parked turns so far, for `longestPark`. */
  const parkRun = new Map<string, number>();
  // --- entrapment instrument: one open episode per unit, keyed by wireId ----
  const entrapmentOpen = new Map<string, number>();
  // --- end entrapment instrument -------------------------------------------
  // --- immobility instrument (P1): the wire ids the PREVIOUS turn left with
  // no legal `move`, which is exactly the set that enters this turn unable to
  // step off whatever it is standing on.
  let immobile = new Set<string>();
  // --- end immobility instrument -------------------------------------------
  // --- contest-standing instrument (contest-gap.md §1, §2.3) ---------------
  // `lastStanding` is this turn's read, which is the state the unit took its
  // fatal decision in; `entryStanding` is the read at the ENTRY TURN — the
  // last turn the unit's own cell was NOT beaten — which is where the
  // diagnosis classifies a contest death. Both are keyed by wire id.
  const lastStanding = new Map<string, ContestStandingRead>();
  const entryStanding = new Map<string, ContestStandingRead>();
  // --- end contest-standing instrument --------------------------------------
  const key = (c: Coord): string => `${c.x},${c.y}`;
  // TEAM 0, per the scenario's OWN roster (`spec.teams[0]`) — a fact about the
  // board, fixed for the whole game, and independent of the alphabetical
  // order the turn loop below iterates teams in. This is "the deciding team"
  // `opts.opponent` never touches.
  const deciderTeamId = spec.teams[0]?.id;

  for (let turn = 1; turn <= maxTurns; turn++) {
    const teams = new Set(
      (board.snakes ?? []).filter((s) => s.health > 0).map((s) => s.teamID as string)
    );
    if (teams.size <= 1) break;
    const staged = new Map<string, number>();
    const rows: string[] = [];
    try {
      for (const teamId of [...teams].sort()) {
        const t0 = monotonic();
        // `opts.opponent` absent: every team gets the same evaluator it
        // always did. Present: only team 0 does — every other team plays the
        // opponent's evaluator instead, so the mirror is broken deliberately
        // rather than by accident.
        const evaluateForTeam =
          opts.opponent !== undefined && teamId !== deciderTeamId
            ? opts.opponent.evaluate
            : (opts.evaluate ?? defaultEvaluator);
        const decision = await decideTeam(
          board,
          turn,
          teamId,
          budget,
          evaluateForTeam,
          opts.scores ?? true,
          opts.lensFor?.(turn, teamId)
        );
        metrics.worstDecisionMs = Math.max(metrics.worstDecisionMs, monotonic() - t0);
        metrics.nodes += decision.nodes;
        metrics.slices += decision.slices;
        metrics.reads += decision.reads;
        metrics.worstDecisionNodes = Math.max(metrics.worstDecisionNodes, decision.nodes);
        metrics.decisions++;
        addLoud(metrics.loud, decision.loud);
        // --- THE CONTEST-STANDING INSTRUMENT (contest-gap.md §2.3) ---------
        // Empty without `CENTAUR_CONTEST_DIAG=1`, so this loop does not run.
        for (const read of decision.standings) {
          lastStanding.set(read.wireId, read);
          if (!read.originBeaten) {
            entryStanding.set(read.wireId, read);
            if (read.arrivalVaries || read.allBeaten) metrics.contestExposedTurns++;
            else metrics.contestOutsideTurns++;
          } else {
            if (read.flatAll) metrics.contestFlatAllTurns++;
            if (read.flat) {
              metrics.contestFlatTurns++;
              if (read.standingVaries) metrics.contestFlatStandingVaries++;
            } else {
              metrics.contestGradedTurns++;
            }
          }
        }
        // --- end contest-standing instrument --------------------------------
        for (const [id, to] of decision.staged) staged.set(id, to);
        for (const tr of decision.traces) {
          const prev = previousCell.get(tr.wireId);
          const lastStage = previousStage.get(tr.wireId);
          // THE CELL HELD, not the cell staged (D6). A pawn's rotation stages a
          // side square it never enters, so `from !== to` counts a rotation as
          // a move and hides a park; `from` against the same unit's `from` last
          // turn is where the unit actually IS, two turns running.
          const parked = prev !== undefined && prev === key(tr.from);
          if (prev === undefined) {
            // A unit's first turn has no previous cell to compare and is
            // neither parked nor moved. Counting it either way would price an
            // arrival that never happened.
          } else if (parked) {
            metrics.stationary++;
            const run = (parkRun.get(tr.wireId) ?? 0) + 1;
            parkRun.set(tr.wireId, run);
            metrics.longestPark = Math.max(metrics.longestPark, run);
            if (lastStage !== undefined && lastStage !== key(tr.to)) metrics.dithers++;
          } else {
            metrics.movesWithChoice++;
            parkRun.set(tr.wireId, 0);
          }
          // THE REVERSAL READING IS UNCHANGED and stays a fact about the
          // STAGED cell: staging the square this unit held a turn ago is the
          // undo, whatever the rotation grammar does with the side squares.
          if (key(tr.from) !== key(tr.to) && prev !== undefined && prev === key(tr.to)) {
            metrics.reversals++;
            const best = tr.top[0];
            if (best !== undefined && key(best.to) !== key(tr.to)) {
              metrics.unjustifiedReversals++;
            }
          }
          previousStage.set(tr.wireId, key(tr.to));
          if (tr.seeded) metrics.seedKept++;
          metrics.unitTurns++;
          const opts3 = tr.top
            .map(
              (c) =>
                `(${c.to.x},${c.to.y})${c.pruned ? '!' : ''}=` +
                `${c.floor.toFixed(2)}|${c.est.toFixed(2)}` +
                `${c.basis === '' ? '' : `{${c.basis.length}}`}`
            )
            .join(' ');
          rows.push(
            `  T${String(turn).padStart(3)} ${tr.wireId.padEnd(10)} ${tr.kind.padEnd(6)} ` +
              `hp${String(tr.health).padStart(3)} (${tr.from.x},${tr.from.y})->(${tr.to.x},${tr.to.y})` +
              `${prev === key(tr.to) && key(tr.from) !== key(tr.to) ? ' REVERSAL' : ''}` +
              `${parked ? ' PARKED' : ''}` +
              `${parked && lastStage !== undefined && lastStage !== key(tr.to) ? ' DITHER' : ''}` +
              `${tr.seeded ? ' [seed]' : ''}  top3: ${opts3}`
          );
          previousCell.set(tr.wireId, key(tr.from));
        }
      }
    } catch (err) {
      metrics.crashed = `turn ${turn}: ${(err as Error).message}`;
      break;
    }

    const bodies = new Map<string, string>();
    const teamOf = new Map<string, string>();
    for (const s of board.snakes ?? []) {
      bodies.set(s.id, s.body.map((c) => `(${c.x},${c.y})`).join(''));
      teamOf.set(s.id, s.teamID as string);
    }
    // --- THE ENEMY-OCCUPIED ENTRY INSTRUMENT (BEHAVIOUR-AUDIT.md D1) -------
    // Read off the board the decision was taken on, with that decision's own
    // staged destinations, BEFORE settlement moves anything. It counts; it
    // cannot reach the decision it is counting.
    for (const e of enemyOccupiedEntriesAt(board, turn, staged)) {
      metrics.enemyOccupiedEntries++;
      if (e.lost) metrics.enemyOccupiedEntriesLost++;
      rows.push(
        `  ENEMY-CELL ${e.id} -> ${e.enemy}'s square  ${e.lost ? 'LOST' : 'won'}`
      );
    }
    // --- end enemy-occupied entry instrument -------------------------------
    const outcome = stepGame(board, turn, staged, rng, foodTarget, potionSchedule);
    metrics.foodEaten += outcome.ate.length;
    metrics.grownMeals += outcome.grown.length;
    metrics.potionPickups += outcome.potionsTaken;
    // Score the windows already open BEFORE opening this turn's: a buff is
    // stamped at the end of the turn it is collected on and decides nothing
    // during it, so a clash on the pickup turn is not the pickup's doing.
    for (const w of windows) {
      if (w.paid || turn > w.endsTurn) continue;
      for (const id of outcome.contestants) {
        if (id === w.collector) continue;
        if (teamOf.get(id) !== w.team) continue;
        w.paid = true;
        metrics.profitablePickups++;
        // THE CONJUNCTION: the team got its clash AND the collector was not
        // walking into one it loses. Either half alone is not the intent.
        if (!w.exposed) metrics.profitableSafePickups++;
        break;
      }
    }
    for (let i = windows.length - 1; i >= 0; i--) {
      if (turn >= (windows[i] as { endsTurn: number }).endsTurn) windows.splice(i, 1);
    }
    const readings: string[] = [];
    for (const id of outcome.collectors) {
      const team = teamOf.get(id);
      if (team === undefined) continue;
      // The reading is taken off the board the pickup LEFT — the collector is
      // already carrying its −1 there, which is the tier its exposure is about.
      const reading = readPickup(outcome.board, turn, id, potionWindow);
      const exposed = reading?.exposed ?? false;
      if (reading !== null) {
        metrics.pickupEnemyTierSum += reading.enemyTier;
        metrics.pickupEnergySum += reading.energy;
        if (reading.exposed) metrics.recklessPickups++;
        if (reading.arrivalBeaten) {
          metrics.arrivalBeatenPickups++;
          if (reading.exposed) metrics.recklessArrivalBeaten++;
        }
        metrics.pickupGroundBeaten1Sum += reading.groundBeaten1;
        metrics.pickupGroundCells1Sum += reading.groundCells1;
        readings.push(
          `${id} hp${reading.energy} enemyTier${reading.enemyTier >= 0 ? '+' : ''}` +
            `${reading.enemyTier} caught@${reading.catchTurn === 0 ? 'never' : reading.catchTurn}` +
            ` ${reading.exposed ? 'EXPOSED' : 'clear'}` +
            ` arrival=${reading.arrivalBeaten ? 'BEATEN' : 'safe'}` +
            ` ground1=${reading.groundBeaten1}/${reading.groundCells1}`
        );
      }
      windows.push({ collector: id, team, endsTurn: turn + potionWindow, paid: false, exposed });
    }
    metrics.potionTierUps += outcome.tierUps.length;
    metrics.potionTierDowns += outcome.tierDowns.length;
    for (const d of outcome.deaths) {
      metrics.deathsByCause[d.cause] = (metrics.deathsByCause[d.cause] ?? 0) + 1;
      if (d.cause === 'exhaustion' || d.cause === 'hazard') metrics.starvationDeaths++;
      else metrics.otherDeaths++;
      if (d.tier < 0) metrics.deathsWhileDebuffed++;
      if (d.tier > 0) metrics.deathsWhileBuffed++;
      // P1: read against the immobility the PREVIOUS turn left, because that
      // is the state this unit took its last decision in.
      if (immobile.has(d.id)) metrics.deathsWhileImmobile++;
      // --- THE CONTEST-STANDING INSTRUMENT (contest-gap.md §1, §2.3) -------
      // The bucket is read at the DEATH turn and the class at the ENTRY turn,
      // which is exactly how the diagnosis splits the same 28 deaths.
      if (CONTEST_DIAG && d.cause === 'contest') {
        const here = lastStanding.get(d.id);
        if (here !== undefined) {
          if (!here.originBeaten) {
            if (here.arrivalVaries || here.allBeaten) metrics.contestExposedDeaths++;
            else metrics.contestOutsideDeaths++;
          } else if (here.flat) metrics.contestFlatDeaths++;
          else metrics.contestGradedDeaths++;
        }
        const entry = entryStanding.get(d.id);
        if (entry === undefined) metrics.contestClassUnknown++;
        else if (entry.options <= 1) metrics.contestClassC++;
        else if (entry.fieldSilent) metrics.contestClassA++;
        else if (entry.allBeaten && entry.flat) metrics.contestClassB++;
        else if (entry.tied) metrics.contestClassE++;
        else metrics.contestClassOther++;
      }
      // --- end contest-standing instrument ---------------------------------
    }
    board = outcome.board;
    metrics.turns = turn;
    const food = board.food.map((f) => `(${f.x},${f.y})`).join(' ');
    emit(`turn ${turn}  food: ${food || '(none)'}`);
    for (const r of rows) emit(r);
    for (const d of outcome.deaths) {
      const before = bodies.get(d.id);
      emit(
        `  DEATH ${d.id} (${d.cause})${d.tier === 0 ? '' : ` tier${d.tier > 0 ? '+' : ''}${d.tier}`}` +
          `  body was ${before ?? '?'}`
      );
    }
    if (outcome.ate.length > 0) {
      // The growth half is named only where it differs — on a board at the
      // shipped `foodEnergy` every meal grows and the note would be noise.
      const same =
        outcome.grown.length === outcome.ate.length &&
        outcome.grown.every((id) => outcome.ate.includes(id));
      emit(
        `  ATE ${outcome.ate.join(', ')}` +
          (same ? '' : `  GREW ${outcome.grown.join(', ') || '(none)'}`)
      );
    }
    if (outcome.potionsTaken > 0) {
      emit(
        `  POTION x${outcome.potionsTaken}  tier up: ${outcome.tierUps.join(', ') || '(none)'}` +
          `  tier down: ${outcome.tierDowns.join(', ') || '(none)'}` +
          (readings.length === 0 ? '' : `  [${readings.join('; ')}]`)
      );
    }

    // --- THE IMMOBILITY INSTRUMENT (BEHAVIOUR-AUDIT-2.md P1) ---------------
    // The board this turn LEFT, so the reading is about what the chosen
    // actions bought: a unit in this set has no move next turn whatever it is
    // offered. Counted per turn, so the total is unit-turns and divides by
    // `unitTurns` the way every other share here does.
    immobile = immobileAt(board, turn);
    metrics.immobileUnitTurns += immobile.size;
    // --- end immobility instrument -----------------------------------------

    // --- THE ENTRAPMENT INSTRUMENT (docs/design/entrapment.md §7.2) ---------
    //
    // Read off the board the turn LEFT, after the deaths this turn produced are
    // in hand. A death CLOSES an open episode as fatal — "while entrapped or on
    // the next turn" is exactly "an episode was open when the turn that killed
    // it began" — and the lead is how many turns of warning the shortfall gave.
    // Nothing here can reach the decision: it runs after `stepGame` and makes no
    // evaluator call.
    for (const d of outcome.deaths) {
      const opened = entrapmentOpen.get(d.id);
      if (opened === undefined) continue;
      metrics.fatalEntrapments++;
      metrics.entrapmentLeadSum += turn - opened;
      entrapmentOpen.delete(d.id);
    }
    const readingsNow = entrappedAt(board, turn);
    const shortfall = new Set<string>();
    for (const r of readingsNow) {
      if (r.kept >= r.need) continue;
      shortfall.add(r.id);
      metrics.entrappedUnitTurns++;
      if (entrapmentOpen.has(r.id)) continue;
      entrapmentOpen.set(r.id, turn);
      metrics.entrapmentEpisodes++;
      emit(`  ENTRAPPED ${r.id} kept=${r.kept}/${r.need}`);
    }
    const standing = new Set(readingsNow.map((r) => r.id));
    for (const [id, opened] of [...entrapmentOpen]) {
      if (shortfall.has(id)) continue;
      // Still on the board and no longer short: it walked out of the pocket.
      // Gone without a death entry closes nothing — it is neither escape nor
      // fatality, and inventing one would flatter whichever counter got it.
      if (standing.has(id)) metrics.escapedEntrapments++;
      void opened;
      entrapmentOpen.delete(id);
    }
    // --- end entrapment instrument -----------------------------------------

    clearGeometryCache();
  }

  metrics.endHealth = (board.snakes ?? []).map((s) => s.health);
  return { metrics, log, finalBoard: board };
}

// ---------------------------------------------------------------------------
// Scenarios and CLI
// ---------------------------------------------------------------------------

/** A food-adequate snake board: three teams of two snakes, six meals standing. */
export const SNAKE_SCENARIO: GameSpec = {
  width: 11,
  height: 11,
  teams: [
    { id: 'red', units: [{ kind: 'snake', x: 1, y: 1 }, { kind: 'snake', x: 1, y: 9 }] },
    { id: 'blue', units: [{ kind: 'snake', x: 9, y: 1 }, { kind: 'snake', x: 9, y: 9 }] },
    { id: 'green', units: [{ kind: 'snake', x: 5, y: 0 }, { kind: 'snake', x: 5, y: 10 }] },
  ],
  food: [
    { x: 3, y: 3 },
    { x: 7, y: 3 },
    { x: 3, y: 7 },
    { x: 7, y: 7 },
    { x: 5, y: 5 },
    { x: 0, y: 5 },
  ],
  foodTarget: 6,
  maxTurns: 100,
};

/** The mixed roster the owner watched: snakes, a pawn, a knight, a queen. */
export const MIXED_SCENARIO: GameSpec = {
  width: 11,
  height: 11,
  teams: [
    {
      id: 'red',
      units: [
        { kind: 'snake', x: 1, y: 2 },
        { kind: 'pawn', x: 2, y: 1 },
        { kind: 'knight', x: 0, y: 0 },
      ],
    },
    {
      id: 'blue',
      units: [
        { kind: 'snake', x: 9, y: 8 },
        { kind: 'queen', x: 8, y: 9 },
        { kind: 'pawn', x: 10, y: 10 },
      ],
    },
    {
      id: 'green',
      units: [
        { kind: 'snake', x: 5, y: 0 },
        { kind: 'knight', x: 5, y: 10 },
      ],
    },
  ],
  food: [
    { x: 3, y: 3 },
    { x: 7, y: 7 },
    { x: 5, y: 5 },
    { x: 2, y: 8 },
    { x: 8, y: 2 },
  ],
  foodTarget: 5,
  maxTurns: 100,
};

/**
 * THE STARVATION BOARD. Two meals on a 13x13 and nothing else to do: a bot with
 * no food gradient wanders, its health counts down one per cell entered, and
 * every snake on it is dead by turn 100. A bot that walks to the food is not.
 */
export const SPARSE_SCENARIO: GameSpec = {
  width: 13,
  height: 13,
  teams: [
    { id: 'red', units: [{ kind: 'snake', x: 1, y: 1 }, { kind: 'snake', x: 1, y: 11 }] },
    { id: 'blue', units: [{ kind: 'snake', x: 11, y: 1 }, { kind: 'snake', x: 11, y: 11 }] },
  ],
  food: [
    { x: 6, y: 6 },
    { x: 3, y: 9 },
  ],
  foodTarget: 2,
  maxTurns: 100,
};

/**
 * THE POTION BOARD — the mixed roster with the invulnerability rules live.
 *
 * A potion is not a pickup that makes you stronger. Collecting one takes the
 * COLLECTOR down a tier and gives each of its living allies one, for a window
 * of turns; a unit that was vulnerable when it collided drags its whole team's
 * borrowed tiers down with it; and every level given is given back when the
 * window lapses. So the board asks a question none of the other three do — is
 * the bot willing to pay a tier to arm its team, and does it survive the turns
 * it spends debuffed — and it is the only board on which `settleTurn`'s
 * `tiers`, `effects` and `potions` outputs do anything at all.
 *
 * The roster is `mixed`'s, deliberately: the potion counters are then readable
 * against that board's own numbers rather than against a board that differs in
 * two ways at once. Four potions standing, replaced on a fixed cadence from the
 * seeded rng, so the schedule is reproducible like everything else here.
 */
export const POTION_SCENARIO: GameSpec = {
  ...MIXED_SCENARIO,
  potions: [
    { x: 5, y: 2 },
    { x: 2, y: 5 },
    { x: 8, y: 5 },
    { x: 5, y: 8 },
  ],
  potionTarget: 4,
  // Every third turn, which is the default window: a board that refilled every
  // turn would keep a potion under every unit's nose and never let a window
  // lapse, and one that refilled every twentieth would spend the game empty.
  potionRespawnTurns: 3,
  potionWindowTurns: DEFAULT_POTION_WINDOW_TURNS,
};

/**
 * THE FILL-TO-GROW BOARD — `sparse` with a meal worth half a tank.
 *
 * `docs/design/BEHAVIOUR-AUDIT.md`, "the gap the corpus cannot close": none of
 * the four scenarios sets `foodEnergy`, so `resolveTurn` uses
 * `DEFAULT_FOOD_ENERGY = 100`, which equals `defaultMaxEnergy` — every meal
 * fills and every meal grows, which is the OLD rule. The fold's pieces are
 * pinned at the level of one evaluation (`evaluate.test.ts`, "material prices
 * the meal that FILLS") and the behaviour over sixty turns has never been
 * watched.
 *
 * `grownMeals / foodEaten` is then the division of labour between `food`'s
 * hunger pull (weight 4, hardest on the emptiest unit — the one whose meal will
 * NOT top it off) and `material`'s growth credit (weight 10, paid to the unit
 * whose meal will). `sparse` is the base because it is the board with no deaths
 * and no potions: a change in the meal counters there is the food rule and
 * nothing else.
 *
 * TWENTY, AND THE AUDIT'S FIFTY IS WHY. The value was swept over seeds 1-3 at
 * 60 turns on this board (`--food-energy=N`, the same runs the flag exists for):
 *
 *     foodEnergy   100    50     40     25     20     15     10
 *     meals         52    52     52     51     45     46     61
 *     grown/meals 1.00  1.00   0.98   0.92   0.84   0.70   0.36
 *
 * At the audit's suggested 50 the arm is byte-identical to `sparse` itself —
 * a unit on this board is almost never more than fifty short when it eats, so
 * every meal still fills and still grows, and the board exercises nothing. The
 * rule only starts to bite at 20, where one meal in six is fuel and no length,
 * and the board keeps the property that made it the base: zero deaths, zero
 * starvation. Below that it is a different game — at 10 the bot eats a fifth
 * more often for a third of the growth, and `grownMeals / foodEaten` falls
 * under the audit's pre-registered 0.5.
 */
export const SPARSE_LEAN_SCENARIO: GameSpec = {
  ...SPARSE_SCENARIO,
  foodEnergy: 20,
};

export const SCENARIOS: Record<string, GameSpec> = {
  snakes: SNAKE_SCENARIO,
  mixed: MIXED_SCENARIO,
  sparse: SPARSE_SCENARIO,
  potions: POTION_SCENARIO,
  'sparse-lean': SPARSE_LEAN_SCENARIO,
};

// ---------------------------------------------------------------------------
// THE JSON SUMMARY — one object per run, for a machine to diff
// ---------------------------------------------------------------------------

/**
 * ONE RUN, as a fact a script can subtract.
 *
 * Two builds cannot coexist in one process, so there is no `ab` subcommand:
 * the paired A/B is two BUILDS each writing one of these per (scenario, seed),
 * and `scripts/ab-compare.js` doing the subtraction. Everything here is a
 * function of (build, scenario, seed, budget) and nothing else — which is only
 * true in the deterministic mode, and is why that mode exists.
 *
 * `wall` is the one field that is not, so it is a field of its own and it is
 * ABSENT in the deterministic mode: a summary carrying a wall-clock reading
 * could not be compared byte for byte, and byte-for-byte is the whole claim.
 */
export interface RunSummary {
  readonly schema: 1;
  readonly runner: 'local-game';
  /** Names the arm. Two builds' files are told apart by this and nothing else. */
  readonly label: string;
  /** THE BOARD CLASS. Counters are never pooled across it — see ab-compare. */
  readonly scenario: string;
  readonly seed: number;
  /**
   * The profile every team but team 0 played, by catalog name — absent for a
   * mirror run (the default, and what the byte-identity gate measures).
   * `ab-compare.js` pairs on this alongside (scenario, seed): a `mixed` run
   * against `material-only` and a `mixed` mirror run are not the same
   * experiment and are never subtracted against each other.
   */
  readonly opponent?: string;
  /**
   * WHAT A MEAL WAS WORTH, when the board said. Absent means the engine's
   * `DEFAULT_FOOD_ENERGY`, which is what every scenario but `sparse-lean` runs,
   * so a summary from before this field existed is byte-identical to one taken
   * now — and `ab-compare.js` pairs on it, because a lean board and a full one
   * are two experiments over the same geometry.
   */
  readonly foodEnergy?: number;
  readonly mode: 'ms' | 'nodes';
  /** Milliseconds in `ms` mode, work units in `nodes` mode. */
  readonly budget: number;
  readonly turnsRequested: number;
  readonly counters: {
    readonly turns: number;
    readonly unitTurns: number;
    readonly meals: number;
    /** Meals that reached the eater's maximum and grew it — see `grownMeals`. */
    readonly grownMeals: number;
    readonly reversals: number;
    readonly unjustifiedReversals: number;
    readonly stationary: number;
    readonly longestPark: number;
    readonly dithers: number;
    readonly movesWithChoice: number;
    readonly seedKept: number;
    readonly starvationDeaths: number;
    readonly otherDeaths: number;
    readonly potionPickups: number;
    readonly profitablePickups: number;
    readonly recklessPickups: number;
    readonly profitableSafePickups: number;
    readonly arrivalBeatenPickups: number;
    readonly recklessArrivalBeaten: number;
    readonly pickupGroundBeaten1Sum: number;
    readonly pickupGroundCells1Sum: number;
    readonly pickupEnemyTierSum: number;
    readonly pickupEnergySum: number;
    readonly potionTierUps: number;
    readonly potionTierDowns: number;
    readonly deathsWhileDebuffed: number;
    readonly deathsWhileBuffed: number;
    // --- enemy-occupied entry instrument (BEHAVIOUR-AUDIT.md D1) -----------
    readonly enemyOccupiedEntries: number;
    readonly enemyOccupiedEntriesLost: number;
    // --- contest-standing instrument (contest-gap.md §2.3) -------------------
    readonly contestOutsideTurns: number;
    readonly contestExposedTurns: number;
    readonly contestFlatTurns: number;
    readonly contestGradedTurns: number;
    readonly contestFlatStandingVaries: number;
    readonly contestFlatAllTurns: number;
    readonly contestOutsideDeaths: number;
    readonly contestExposedDeaths: number;
    readonly contestFlatDeaths: number;
    readonly contestGradedDeaths: number;
    readonly contestClassA: number;
    readonly contestClassB: number;
    readonly contestClassC: number;
    readonly contestClassE: number;
    readonly contestClassOther: number;
    readonly contestClassUnknown: number;
    // --- entrapment instrument (docs/design/entrapment.md §7.2) ------------
    readonly entrappedUnitTurns: number;
    readonly entrapmentEpisodes: number;
    readonly fatalEntrapments: number;
    readonly escapedEntrapments: number;
    readonly entrapmentLeadSum: number;
    // --- end entrapment instrument -----------------------------------------
    // --- immobility instrument (BEHAVIOUR-AUDIT-2.md P1) --------------------
    readonly immobileUnitTurns: number;
    readonly deathsWhileImmobile: number;
    // --- end immobility instrument -----------------------------------------
    readonly survivors: number;
    readonly healthTotal: number;
  };
  /** Everything above per 100 unit-turns — the only comparable form. */
  readonly rates: Record<string, number>;
  readonly deathsByCause: Record<string, number>;
  readonly work: {
    readonly decisions: number;
    readonly nodes: number;
    readonly slices: number;
    readonly reads: number;
    readonly worstDecisionNodes: number;
  };
  /**
   * THE LOUD PRODUCT'S DISTRIBUTION (08 §5 step 1) — the instrument, beside
   * the work it did not cost. It is a function of (build, scenario, seed,
   * budget) like everything else here, so two arms' files still subtract.
   */
  readonly loud: LoudHistogram;
  /** Wall clock. `ms` mode only: it is not reproducible and never compared. */
  readonly wall?: { readonly worstDecisionMs: number };
  readonly crashed: string | null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function summaryOf(
  metrics: GameMetrics,
  where: {
    label: string;
    scenario: string;
    seed: number;
    turnsRequested: number;
    /** The opponent's catalog name, or absent for a mirror run — see
     *  `RunSummary.opponent`. Threaded through rather than re-derived: an
     *  `Evaluator` exposes nothing a name could be read back off. */
    opponent?: string;
    /** The spec's `foodEnergy`, or absent where it stated none. */
    foodEnergy?: number;
  },
  budget: DecisionBudget
): RunSummary {
  const ut = metrics.unitTurns;
  const per = (n: number): number => (ut === 0 ? 0 : round4((100 * n) / ut));
  const summary: RunSummary = {
    schema: 1,
    runner: 'local-game',
    label: where.label,
    scenario: where.scenario,
    seed: where.seed,
    // Absent when `where.opponent` is: `JSON.stringify` drops an
    // `undefined`-valued property exactly as it would drop a key that was
    // never set, which is what keeps a mirror run's JSON byte-identical to a
    // build that never heard of `--opponent`.
    opponent: where.opponent,
    // Absent when the spec states none, exactly as `opponent` is.
    foodEnergy: where.foodEnergy,
    mode: budget.kind,
    budget: budget.kind === 'ms' ? budget.ms : budget.nodes,
    turnsRequested: where.turnsRequested,
    counters: {
      turns: metrics.turns,
      unitTurns: ut,
      meals: metrics.foodEaten,
      grownMeals: metrics.grownMeals,
      reversals: metrics.reversals,
      unjustifiedReversals: metrics.unjustifiedReversals,
      stationary: metrics.stationary,
      longestPark: metrics.longestPark,
      dithers: metrics.dithers,
      movesWithChoice: metrics.movesWithChoice,
      seedKept: metrics.seedKept,
      starvationDeaths: metrics.starvationDeaths,
      otherDeaths: metrics.otherDeaths,
      potionPickups: metrics.potionPickups,
      profitablePickups: metrics.profitablePickups,
      recklessPickups: metrics.recklessPickups,
      profitableSafePickups: metrics.profitableSafePickups,
      arrivalBeatenPickups: metrics.arrivalBeatenPickups,
      recklessArrivalBeaten: metrics.recklessArrivalBeaten,
      pickupGroundBeaten1Sum: metrics.pickupGroundBeaten1Sum,
      pickupGroundCells1Sum: metrics.pickupGroundCells1Sum,
      pickupEnemyTierSum: metrics.pickupEnemyTierSum,
      pickupEnergySum: metrics.pickupEnergySum,
      potionTierUps: metrics.potionTierUps,
      potionTierDowns: metrics.potionTierDowns,
      deathsWhileDebuffed: metrics.deathsWhileDebuffed,
      deathsWhileBuffed: metrics.deathsWhileBuffed,
      // --- enemy-occupied entry instrument -----------------------------------
      enemyOccupiedEntries: metrics.enemyOccupiedEntries,
      enemyOccupiedEntriesLost: metrics.enemyOccupiedEntriesLost,
      // --- contest-standing instrument (contest-gap.md §2.3) ---------------
      contestOutsideTurns: metrics.contestOutsideTurns,
      contestExposedTurns: metrics.contestExposedTurns,
      contestFlatTurns: metrics.contestFlatTurns,
      contestGradedTurns: metrics.contestGradedTurns,
      contestFlatStandingVaries: metrics.contestFlatStandingVaries,
      contestFlatAllTurns: metrics.contestFlatAllTurns,
      contestOutsideDeaths: metrics.contestOutsideDeaths,
      contestExposedDeaths: metrics.contestExposedDeaths,
      contestFlatDeaths: metrics.contestFlatDeaths,
      contestGradedDeaths: metrics.contestGradedDeaths,
      contestClassA: metrics.contestClassA,
      contestClassB: metrics.contestClassB,
      contestClassC: metrics.contestClassC,
      contestClassE: metrics.contestClassE,
      contestClassOther: metrics.contestClassOther,
      contestClassUnknown: metrics.contestClassUnknown,
      // --- entrapment instrument ---------------------------------------------
      entrappedUnitTurns: metrics.entrappedUnitTurns,
      entrapmentEpisodes: metrics.entrapmentEpisodes,
      fatalEntrapments: metrics.fatalEntrapments,
      escapedEntrapments: metrics.escapedEntrapments,
      entrapmentLeadSum: metrics.entrapmentLeadSum,
      // --- end entrapment instrument -----------------------------------------
      // --- immobility instrument (BEHAVIOUR-AUDIT-2.md P1) --------------------
      immobileUnitTurns: metrics.immobileUnitTurns,
      deathsWhileImmobile: metrics.deathsWhileImmobile,
      // --- end immobility instrument -----------------------------------------
      survivors: metrics.endHealth.length,
      healthTotal: metrics.endHealth.reduce((a, b) => a + b, 0),
    },
    rates: {
      mealsPer100: per(metrics.foodEaten),
      grownMealsPer100: per(metrics.grownMeals),
      reversalsPer100: per(metrics.reversals),
      unjustifiedReversalsPer100: per(metrics.unjustifiedReversals),
      stationaryPer100: per(metrics.stationary),
      dithersPer100: per(metrics.dithers),
      seedKeptPer100: per(metrics.seedKept),
      deathsPer100: per(metrics.starvationDeaths + metrics.otherDeaths),
      potionPickupsPer100: per(metrics.potionPickups),
      profitablePickupsPer100: per(metrics.profitablePickups),
      recklessPickupsPer100: per(metrics.recklessPickups),
      profitableSafePickupsPer100: per(metrics.profitableSafePickups),
      potionTierUpsPer100: per(metrics.potionTierUps),
      // --- enemy-occupied entry instrument -----------------------------------
      enemyOccupiedEntriesPer100: per(metrics.enemyOccupiedEntries),
      enemyOccupiedEntriesLostPer100: per(metrics.enemyOccupiedEntriesLost),
      // --- entrapment instrument ---------------------------------------------
      entrappedUnitTurnsPer100: per(metrics.entrappedUnitTurns),
      entrapmentEpisodesPer100: per(metrics.entrapmentEpisodes),
      // --- immobility instrument (BEHAVIOUR-AUDIT-2.md P1) --------------------
      immobileUnitTurnsPer100: per(metrics.immobileUnitTurns),
      // --- end immobility instrument -----------------------------------------
    },
    deathsByCause: Object.fromEntries(
      Object.entries(metrics.deathsByCause).sort(([a], [b]) => (a < b ? -1 : 1))
    ),
    work: {
      decisions: metrics.decisions,
      nodes: metrics.nodes,
      slices: metrics.slices,
      reads: metrics.reads,
      worstDecisionNodes: metrics.worstDecisionNodes,
    },
    loud: { ...metrics.loud },
    crashed: metrics.crashed,
  };
  // The wall reading rides only where it means something. In the deterministic
  // mode its absence is the point: the object is then byte-identical run to run.
  return budget.kind === 'ms'
    ? { ...summary, wall: { worstDecisionMs: Math.round(metrics.worstDecisionMs) } }
    : summary;
}

/** Aggregate several seeds of one scenario — the counters, not the traces. */
async function summarise(
  scenario: string,
  spec: GameSpec,
  turns: number,
  seeds: number,
  budget: DecisionBudget,
  out: {
    label: string;
    json: ((line: string) => void) | null;
    say: (line: string) => void;
    /** Absent: every team mirrors the default profile, as always. */
    opponent?: Opponent;
  }
): Promise<void> {
  const totals: Record<string, number> = {
    unitTurns: 0,
    foodEaten: 0,
    grownMeals: 0,
    reversals: 0,
    unjustifiedReversals: 0,
    stationary: 0,
    dithers: 0,
    seedKept: 0,
    starvationDeaths: 0,
    otherDeaths: 0,
    potionPickups: 0,
    profitablePickups: 0,
    recklessPickups: 0,
    profitableSafePickups: 0,
    arrivalBeatenPickups: 0,
    recklessArrivalBeaten: 0,
    pickupGroundBeaten1Sum: 0,
    pickupGroundCells1Sum: 0,
    potionTierUps: 0,
    deathsWhileDebuffed: 0,
    deathsWhileBuffed: 0,
    enemyOccupiedEntries: 0,
    enemyOccupiedEntriesLost: 0,
    // --- contest-standing instrument (contest-gap.md §2.3) ------------------
    contestOutsideTurns: 0,
    contestExposedTurns: 0,
    contestFlatTurns: 0,
    contestGradedTurns: 0,
    contestFlatStandingVaries: 0,
    contestFlatAllTurns: 0,
    contestOutsideDeaths: 0,
    contestExposedDeaths: 0,
    contestFlatDeaths: 0,
    contestGradedDeaths: 0,
    contestClassA: 0,
    contestClassB: 0,
    contestClassC: 0,
    contestClassE: 0,
    contestClassOther: 0,
    contestClassUnknown: 0,
    // --- end contest-standing instrument ------------------------------------
    // --- entrapment instrument ---------------------------------------------
    entrappedUnitTurns: 0,
    entrapmentEpisodes: 0,
    fatalEntrapments: 0,
    escapedEntrapments: 0,
    entrapmentLeadSum: 0,
    // --- end entrapment instrument -----------------------------------------
    // --- immobility instrument (BEHAVIOUR-AUDIT-2.md P1) ---------------------
    immobileUnitTurns: 0,
    deathsWhileImmobile: 0,
    // --- end immobility instrument -------------------------------------------
  };
  const causes: Record<string, number> = {};
  const loud = emptyLoudHistogram();
  let worst = 0;
  let nodes = 0;
  // A MAXIMUM, NOT A SUM — the longest park any one unit had on any seed. It
  // is kept out of `totals` because everything in there is added up.
  let longestPark = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = await runGame(
      {
        ...spec,
        maxTurns: turns,
        seed,
        ...(budget.kind === 'ms' ? { budgetMs: budget.ms } : { nodeBudget: budget.nodes }),
      },
      { scores: false, opponent: out.opponent }
    );
    for (const k of Object.keys(totals)) {
      totals[k] = (totals[k] as number) + ((r.metrics as unknown as Record<string, number>)[k] ?? 0);
    }
    for (const [c, n] of Object.entries(r.metrics.deathsByCause)) causes[c] = (causes[c] ?? 0) + n;
    worst = Math.max(worst, r.metrics.worstDecisionMs);
    longestPark = Math.max(longestPark, r.metrics.longestPark);
    nodes += r.metrics.nodes;
    addLoud(loud, r.metrics.loud);
    out.json?.(
      JSON.stringify(
        summaryOf(
          r.metrics,
          {
            label: out.label,
            scenario,
            seed,
            turnsRequested: turns,
            opponent: out.opponent?.name,
            foodEnergy: spec.foodEnergy,
          },
          budget
        )
      )
    );
    if (r.metrics.crashed !== null) out.say(`seed ${seed} CRASHED: ${r.metrics.crashed}`);
  }
  const ut = totals.unitTurns as number;
  const per = (n: number): string => (ut === 0 ? '0.00' : ((100 * n) / ut).toFixed(2));
  out.say(
    `${scenario}${out.opponent ? ` opponent=${out.opponent.name}` : ''} seeds=${seeds} ` +
      `unitTurns=${ut} food/100=${per(totals.foodEaten as number)} ` +
      `reversal%=${per(totals.reversals as number)} dither%=${per(totals.dithers as number)} ` +
      `stationary%=${per(totals.stationary as number)} longestPark=${longestPark} ` +
      `seedKept%=${per(totals.seedKept as number)} ` +
      `starvation=${totals.starvationDeaths} otherDeaths=${totals.otherDeaths} ` +
      `causes=${JSON.stringify(causes)} ` +
      ((totals.potionPickups as number) > 0
        ? `potions=${totals.potionPickups} profitable=${totals.profitablePickups} ` +
          `profitableSafe=${totals.profitableSafePickups} reckless=${totals.recklessPickups} ` +
          `arrivalBeaten=${totals.arrivalBeatenPickups} ` +
          `recklessArrivalBeaten=${totals.recklessArrivalBeaten} ` +
          `ground1=${totals.pickupGroundBeaten1Sum}/${totals.pickupGroundCells1Sum} ` +
          `tierUps=${totals.potionTierUps} ` +
          `deadDebuffed=${totals.deathsWhileDebuffed} deadBuffed=${totals.deathsWhileBuffed} `
        : '') +
      `nodes=${nodes} ` +
      (budget.kind === 'ms' ? `worstMs=${worst.toFixed(0)}` : 'deterministic')
  );
  // --- THE ENEMY-OCCUPIED ENTRY INSTRUMENT, on its own line (D1). `meals` and
  // `grown` ride here too: on a lean board they differ, and `grown/meals` is
  // the fill-to-grow division of labour the audit's gap is about.
  out.say(
    `${scenario} D1: enemyOccupiedEntries=${totals.enemyOccupiedEntries} ` +
      `lost=${totals.enemyOccupiedEntriesLost} ` +
      `entries/100=${per(totals.enemyOccupiedEntries as number)} ` +
      `lost/100=${per(totals.enemyOccupiedEntriesLost as number)} ` +
      `meals=${totals.foodEaten} grown=${totals.grownMeals} ` +
      `grown/meals=${
        (totals.foodEaten as number) === 0
          ? 'n/a'
          : ((totals.grownMeals as number) / (totals.foodEaten as number)).toFixed(2)
      }`
  );
  // --- THE CONTEST-STANDING INSTRUMENT, on its own line (contest-gap.md
  // §2.3). Silent without `CENTAUR_CONTEST_DIAG=1`: with the flag absent every
  // counter on it is zero and the line would only be noise.
  if ((totals.contestFlatTurns as number) + (totals.contestGradedTurns as number) > 0) {
    out.say(
      `${scenario} CG: outside=${totals.contestOutsideTurns}/${totals.contestOutsideDeaths} ` +
        `exposed=${totals.contestExposedTurns}/${totals.contestExposedDeaths} ` +
        `FLAT=${totals.contestFlatTurns}/${totals.contestFlatDeaths} ` +
        `graded=${totals.contestGradedTurns}/${totals.contestGradedDeaths} ` +
        `flatStandingVaries=${totals.contestFlatStandingVaries} ` +
        `flatAll=${totals.contestFlatAllTurns} ` +
        `classes A=${totals.contestClassA} B=${totals.contestClassB} ` +
        `C=${totals.contestClassC} E=${totals.contestClassE} ` +
        `other=${totals.contestClassOther} unknown=${totals.contestClassUnknown}`
    );
  }
  // --- end contest-standing instrument ---------------------------------------
  // --- THE ENTRAPMENT INSTRUMENT, on its own line (docs/design/entrapment.md
  // §7.2). `lead` is the mean warning in turns over the fatal episodes, which
  // is the number P-1 is read off.
  const fatal = totals.fatalEntrapments as number;
  out.say(
    `${scenario} E: entrappedUnitTurns=${totals.entrappedUnitTurns} ` +
      `episodes=${totals.entrapmentEpisodes} fatal=${fatal} ` +
      `escaped=${totals.escapedEntrapments} ` +
      `leadSum=${totals.entrapmentLeadSum} ` +
      `lead=${fatal === 0 ? 'n/a' : ((totals.entrapmentLeadSum as number) / fatal).toFixed(2)} ` +
      `entrapped/100=${per(totals.entrappedUnitTurns as number)} ` +
      `episodes/100=${per(totals.entrapmentEpisodes as number)}`
  );
  // --- end entrapment instrument -------------------------------------------
  // --- THE IMMOBILITY INSTRUMENT, on its own line (BEHAVIOUR-AUDIT-2.md P1).
  out.say(
    `${scenario} P1: immobileUnitTurns=${totals.immobileUnitTurns} ` +
      `immobile/100=${per(totals.immobileUnitTurns as number)} ` +
      `deathsWhileImmobile=${totals.deathsWhileImmobile}`
  );
  // --- end immobility instrument -------------------------------------------
  // THE LOUD PRODUCT, on its own line and only where there was one to measure.
  // `open` is the subset that matters: B3 declined there, so the bracket is
  // open and a ceiling ply would have something to remove.
  if (loud.occasions > 0) {
    const pct = (n: number): string => `${((100 * n) / loud.occasions).toFixed(1)}%`;
    out.say(
      `${scenario} Q: occasions=${loud.occasions} b3Fired=${loud.b3Fired} gateCoveredHeld=${loud.covered} ` +
        `| Q=0 ${loud.quiet} (${pct(loud.quiet)}) Q1-6 ${loud.q1to6} (${pct(loud.q1to6)}) ` +
        `Q7-12 ${loud.q7to12} (${pct(loud.q7to12)}) Q13-24 ${loud.q13to24} (${pct(loud.q13to24)}) ` +
        `Q25-512 ${loud.q25to512} (${pct(loud.q25to512)}) Q>512 ${loud.qOver512} (${pct(loud.qOver512)}) ` +
        `| P<=24 ${loud.pTo24} P<=512 ${loud.pTo512} P<=4096 ${loud.pTo4096} P>4096 ${loud.pOver4096} ` +
        `| Q<=12 where P>512: ${loud.qUnder12WhereOpen}/${loud.pOver512} ` +
        `| meanQ=${(loud.qTotal / loud.occasions).toFixed(2)} meanP=${(loud.pTotal / loud.occasions).toFixed(1)}`
    );
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `local-game — watch the bot play, or count what it did.

  node dist/tests/local-game.js <scenario> [turns] [seed] [budgetMs] [flags]
      One game, one line per unit per turn, then the metrics.

  node dist/tests/local-game.js sum <scenarios> [turns] [seeds] [budgetMs] [flags]
      Counters only, over seeds 1..N. <scenarios> is one name, a comma-separated
      list, or "all".

Scenarios: ${Object.keys(SCENARIOS).join(', ')}.

Flags
  --nodes[=N]    THE DETERMINISTIC MODE. Budget each decision by N work units of
                 kernel search instead of by a wall-clock deadline (default
                 ${DEFAULT_NODE_BUDGET}, which is what 150 ms buys on the machine
                 this was calibrated on). Same build + seed + spec then gives
                 byte-identical counters and traces, every run. The positional
                 budgetMs is ignored. Without this flag the ms mode is exactly as
                 it was, and is NOT reproducible.
  --json[=FILE]  One JSON summary object per run: JSON Lines to stdout, or to
                 FILE. Two builds' files are what scripts/ab-compare.js diffs.
                 Human output moves to stderr when this writes to stdout.
  --label=NAME   Names the arm inside the JSON (default: "local").
  --opponent=NAME  STRATEGY DIVERSITY. Team 0 — the first team in the
                 scenario's own roster — keeps the default profile; every
                 other team plays NAME instead of mirroring it. NAME is a
                 member of the bot-binding catalog (src/config/bot-binding.ts,
                 BUILTIN_BOTS): ${Object.keys(BUILTIN_BOTS).sort().join(', ')}.
                 No others exist yet — a "greedy-food" or "cautious" profile
                 is not one of them, and this flag refuses anything not in
                 that list by name rather than inventing a second catalog.
                 Absent: every team mirrors the default profile, exactly as
                 before this flag existed. The JSON summary then carries
                 \`opponent\` with NAME; a mirror run carries no such field.
  --food-energy=N  WHAT ONE MEAL IS WORTH (\`GameSetup.foodEnergy\`). Absent: the
                 scenario's own value, which for every scenario but
                 \`sparse-lean\` is nothing at all, so the engine reads
                 \`DEFAULT_FOOD_ENERGY\` = 100 = the default max energy and every
                 meal both fills and grows the eater. Below a kind's max, a unit
                 needs several meals to fill and grows only on the one that tops
                 it off — the fill-to-grow rule, which no scenario exercised
                 before \`sparse-lean\`. Watch \`grownMeals\` beside \`meals\`.

Examples
  node dist/tests/local-game.js mixed 30 1 150
  node dist/tests/local-game.js sum all 60 3 --nodes --json=before.jsonl
  node dist/tests/local-game.js sum mixed 30 3 --nodes --opponent=material-only --json=vs-material.jsonl
  node scripts/ab-compare.js before.jsonl after.jsonl
`;

interface Flags {
  readonly nodes: number | null;
  readonly json: string | boolean;
  readonly label: string;
  readonly opponent: string | null;
  /** `--food-energy=N`, or null for "whatever the scenario says", which for
   *  every scenario but `sparse-lean` is nothing at all and therefore the
   *  engine's own `DEFAULT_FOOD_ENERGY`. */
  readonly foodEnergy: number | null;
  readonly positional: string[];
}

function parseFlags(argv: readonly string[]): Flags {
  const positional: string[] = [];
  let nodes: number | null = null;
  let json: string | boolean = false;
  let label = 'local';
  let opponent: string | null = null;
  let foodEnergy: number | null = null;
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? null : arg.slice(eq + 1);
    switch (name) {
      case 'nodes':
        nodes = value === null ? DEFAULT_NODE_BUDGET : Number(value);
        break;
      case 'json':
        json = value === null ? true : value;
        break;
      case 'label':
        label = value ?? 'local';
        break;
      case 'opponent':
        if (value === null || value === '') {
          throw new Error('--opponent requires a name, e.g. --opponent=material-only');
        }
        opponent = value;
        break;
      case 'food-energy': {
        const n = value === null ? Number.NaN : Number(value);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error('--food-energy requires a positive number, e.g. --food-energy=50');
        }
        foodEnergy = n;
        break;
      }
      case 'help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag ${arg}`);
    }
  }
  return { nodes, json, label, opponent, foodEnergy, positional };
}

/**
 * THE OVERRIDE, in one place. `--food-energy` states what a meal is worth for
 * this invocation; absent, the scenario's own field rides through, and where
 * the scenario states nothing the board carries no `foodEnergy` at all and the
 * engine reads `DEFAULT_FOOD_ENERGY` exactly as it always has.
 */
const withFoodEnergy = (spec: GameSpec, foodEnergy: number | null): GameSpec =>
  foodEnergy === null ? spec : { ...spec, foodEnergy };

function scenariosNamed(which: string, foodEnergy: number | null = null): Array<[string, GameSpec]> {
  const names = which === 'all' ? Object.keys(SCENARIOS) : which.split(',');
  return names.map((name): [string, GameSpec] => {
    const spec = SCENARIOS[name];
    if (spec === undefined) throw new Error(`unknown scenario ${name}`);
    return [name, withFoodEnergy(spec, foodEnergy)];
  });
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const argv = flags.positional;
  const lines: string[] = [];
  const jsonToFile = typeof flags.json === 'string';
  const emitJson =
    flags.json === false
      ? null
      : (line: string): void => {
          if (jsonToFile) lines.push(line);
          else process.stdout.write(`${line}\n`);
        };
  // stdout belongs to the JSON when the JSON is going there.
  const say = (line: string): void => {
    if (emitJson !== null && !jsonToFile) process.stderr.write(`${line}\n`);
    else console.log(line);
  };
  const finish = (): void => {
    if (jsonToFile) writeFileSync(flags.json as string, `${lines.join('\n')}\n`);
  };
  // Resolved once, through the bot-binding catalog seam, and reused for
  // every scenario/seed this invocation plays. Absent when `--opponent` is,
  // which is the state the byte-identity gate measures.
  const opponent = flags.opponent === null ? undefined : resolveOpponent(flags.opponent);

  if (argv[0] === 'sum') {
    const turns = Number(argv[2] ?? 60);
    const seeds = Number(argv[3] ?? 5);
    const budget: DecisionBudget =
      flags.nodes === null
        ? { kind: 'ms', ms: Number(argv[4] ?? 100) }
        : { kind: 'nodes', nodes: flags.nodes };
    for (const [name, spec] of scenariosNamed(argv[1] ?? 'snakes', flags.foodEnergy)) {
      await summarise(name, spec, turns, seeds, budget, {
        label: flags.label,
        json: emitJson,
        say,
        opponent,
      });
    }
    finish();
    return;
  }

  const which = argv[0] ?? 'snakes';
  const turns = Number(argv[1] ?? 30);
  const seed = Number(argv[2] ?? 1);
  const budget: DecisionBudget =
    flags.nodes === null
      ? { kind: 'ms', ms: Number(argv[3] ?? 150) }
      : { kind: 'nodes', nodes: flags.nodes };
  const named = SCENARIOS[which];
  if (named === undefined) throw new Error(`unknown scenario ${which}`);
  const spec = withFoodEnergy(named, flags.foodEnergy);
  const result = await runGame(
    {
      ...spec,
      maxTurns: turns,
      seed,
      ...(budget.kind === 'ms' ? { budgetMs: budget.ms } : { nodeBudget: budget.nodes }),
    },
    { onTurn: say, opponent }
  );
  emitJson?.(
    JSON.stringify(
      summaryOf(
        result.metrics,
        {
          label: flags.label,
          scenario: which,
          seed,
          turnsRequested: turns,
          opponent: opponent?.name,
          foodEnergy: spec.foodEnergy,
        },
        budget
      )
    )
  );
  if (opponent !== undefined) {
    say(`opponent: ${opponent.name} (team 0, "${spec.teams[0]?.id}", keeps the default profile)`);
  }
  say('--- metrics ---');
  say(JSON.stringify(result.metrics, null, 2));
  const perHundred =
    result.metrics.unitTurns === 0
      ? 0
      : (100 * result.metrics.foodEaten) / result.metrics.unitTurns;
  say(`food per 100 unit-turns: ${perHundred.toFixed(2)}`);
  const pct = (n: number, d: number): string => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));
  say(`reversal rate: ${pct(result.metrics.reversals, result.metrics.unitTurns)}%`);
  say(`  unjustified: ${pct(result.metrics.unjustifiedReversals, result.metrics.unitTurns)}%`);
  say(`dither rate:   ${pct(result.metrics.dithers, result.metrics.unitTurns)}%`);
  say(`stationary:    ${pct(result.metrics.stationary, result.metrics.unitTurns)}%`);
  say(`longest park:  ${result.metrics.longestPark} turns`);
  say(
    `immobile:      ${pct(result.metrics.immobileUnitTurns, result.metrics.unitTurns)}% ` +
      `(${result.metrics.immobileUnitTurns} unit-turns, ` +
      `${result.metrics.deathsWhileImmobile} died there)`
  );
  say(
    `enemy-cell entries: ${result.metrics.enemyOccupiedEntries} ` +
      `(lost ${result.metrics.enemyOccupiedEntriesLost})`
  );
  finish();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
