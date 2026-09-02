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
import { marshalBoard } from '../logic/turn-oracle';
import { settleTurn, DEFAULT_POTION_WINDOW_TURNS } from '../engine-vendor/engine/settleTurn';
import { NO_SPAWN } from '../engine-vendor/engine/spawn';
import type { ResolveUnit } from '../engine-vendor/engine/resolveTurn';
import { aggregateExpiryTurn } from '../firebase/translate';
import { EngineSubstrate, makeSubstrate, clearGeometryCache } from '../lobster/substrate';
import { GrammarCandidateGenerator, knobsForSafety } from '../lobster/candidates';
import { defaultEvaluator } from '../lobster/evaluate';
import type { Evaluator, JointPlan, Candidate, UnitId, KernelInput } from '../lobster/contracts';
import { makeSearchCore } from '../lobster/search';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../lobster/kernel';
import { boardBearsPiece, resolveStagingSafety, stagingSafety } from '../lobster/staging-safety';
import { BoundBank, basisKeyOf, withMove } from '../lobster/bounds';
import { DEFAULT_PAWN_PROMOTION_WEIGHT } from '../logic/piece-moves';

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
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

export interface TeamDecision {
  /** wireId -> the DESTINATION cell staged, exactly what the wire carries. */
  readonly staged: Map<string, number>;
  readonly traces: UnitTrace[];
  readonly horizon: number;
  /** Evaluator calls that reached the evaluator — the work clock's coarse unit. */
  readonly nodes: number;
  /** Kernel refinement slices this decision completed. */
  readonly slices: number;
  /** Clock reads: one per `shouldStop`, i.e. per inner search-loop iteration. */
  readonly reads: number;
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
  scores = true
): Promise<TeamDecision> {
  const ourIds = (board.snakes ?? [])
    .filter((s) => s.teamID === teamId && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  const staged = new Map<string, number>();
  const traces: UnitTrace[] = [];
  const clock = new DecisionClock(budget.kind === 'nodes');
  if (ourIds.length === 0) {
    return { staged, traces, horizon: 0, nodes: 0, slices: 0, reads: 0 };
  }

  const sub = makeSubstrate({ gameId: 'local', board, turn, asTeam: teamId, modeled: ourIds });
  try {
    const asTeam = sub.teamNumber(teamId);
    const safety = resolveStagingSafety(stagingSafety(), boardBearsPiece(sub));
    const gen = new GrammarCandidateGenerator(knobsForSafety(safety));
    const search = makeSearchCore({
      rungZeroRepair: safety === 'full',
      seedDeconflict: safety !== 'off',
    });
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
    };
    let plan: JointPlan | null = null;
    let horizon = 0;
    for await (const rec of kernel.decide(kin)) {
      plan = rec.plan;
      horizon = rec.horizon;
    }
    const stats = (): { nodes: number; slices: number; reads: number } => ({
      nodes: clock.nodes,
      slices: kernel.lastReport?.slices ?? 0,
      reads: clock.reads,
    });
    if (plan === null) return { staged, traces, horizon, ...stats() };

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
    }
    return { staged, traces, horizon, ...stats() };
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
  /** Potions collected this turn, as the difference in the module's own list. */
  readonly potionsTaken: number;
  /** Units whose tier ROSE over the turn — an ally of a collector, mostly. */
  readonly tierUps: ReadonlyArray<string>;
  /** Units whose tier FELL — the collector itself, and every lapsing buff. */
  readonly tierDowns: ReadonlyArray<string>;
}

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
  const tierUps: string[] = [];
  const tierDowns: string[] = [];
  for (const snake of board.snakes ?? []) {
    const settled = result.board[snake.id];
    if (!settled) continue;
    const cells = settled.occupancy.map((c) => toApiCoord(c, w, h));
    const piece = snake.unitType !== undefined && snake.unitType !== 'snake';
    if (settled.occupancy.length > (before.get(snake.id) ?? 0)) ate.push(snake.id);
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

  return {
    board: next,
    deaths,
    ate,
    potionsTaken: marshalled.potions.length - result.potions.length,
    tierUps,
    tierDowns,
  };
}

// ---------------------------------------------------------------------------
// The game loop, and the counters a gate reads
// ---------------------------------------------------------------------------

export interface GameMetrics {
  turns: number;
  unitTurns: number;
  foodEaten: number;
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
  /** Unit-turns that ended where they began — a hold, or a pawn's rotation. */
  stationary: number;
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
  /** Unit-turns that ended on a HIGHER tier: an ally of a collector, mostly. */
  potionTierUps: number;
  /** Unit-turns that ended on a lower tier: the collector, and lapsing buffs. */
  potionTierDowns: number;
  /** Deaths of a unit adjudicated at a NEGATIVE tier — it paid for its potion. */
  deathsWhileDebuffed: number;
  /** Deaths of a unit adjudicated at a positive tier — invulnerability is not immunity. */
  deathsWhileBuffed: number;
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
  crashed: string | null;
}

export interface GameResult {
  readonly metrics: GameMetrics;
  readonly log: string[];
  readonly finalBoard: Board;
}

export async function runGame(
  spec: GameSpec,
  opts: { evaluate?: Evaluator; scores?: boolean; onTurn?: (line: string) => void } = {}
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
    reversals: 0,
    unjustifiedReversals: 0,
    stationary: 0,
    dithers: 0,
    movesWithChoice: 0,
    seedKept: 0,
    starvationDeaths: 0,
    otherDeaths: 0,
    deathsByCause: {},
    potionPickups: 0,
    potionTierUps: 0,
    potionTierDowns: 0,
    deathsWhileDebuffed: 0,
    deathsWhileBuffed: 0,
    endHealth: [],
    worstDecisionMs: 0,
    nodes: 0,
    slices: 0,
    reads: 0,
    worstDecisionNodes: 0,
    decisions: 0,
    crashed: null,
  };
  // wireId -> the cell it stood on BEFORE its last move.
  const previousCell = new Map<string, string>();
  /** wireId -> the destination it staged last turn, for the dither signature. */
  const previousStage = new Map<string, string>();
  const key = (c: Coord): string => `${c.x},${c.y}`;

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
        const decision = await decideTeam(
          board,
          turn,
          teamId,
          budget,
          opts.evaluate ?? defaultEvaluator,
          opts.scores ?? true
        );
        metrics.worstDecisionMs = Math.max(metrics.worstDecisionMs, monotonic() - t0);
        metrics.nodes += decision.nodes;
        metrics.slices += decision.slices;
        metrics.reads += decision.reads;
        metrics.worstDecisionNodes = Math.max(metrics.worstDecisionNodes, decision.nodes);
        metrics.decisions++;
        for (const [id, to] of decision.staged) staged.set(id, to);
        for (const tr of decision.traces) {
          const prev = previousCell.get(tr.wireId);
          const moved = key(tr.from) !== key(tr.to);
          const lastStage = previousStage.get(tr.wireId);
          if (moved) metrics.movesWithChoice++;
          else {
            metrics.stationary++;
            if (lastStage !== undefined && lastStage !== key(tr.to)) metrics.dithers++;
          }
          if (moved && prev !== undefined && prev === key(tr.to)) {
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
              `${prev === key(tr.to) && moved ? ' REVERSAL' : ''}` +
              `${!moved && lastStage !== undefined && lastStage !== key(tr.to) ? ' DITHER' : ''}` +
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
    for (const s of board.snakes ?? []) {
      bodies.set(s.id, s.body.map((c) => `(${c.x},${c.y})`).join(''));
    }
    const outcome = stepGame(board, turn, staged, rng, foodTarget, potionSchedule);
    metrics.foodEaten += outcome.ate.length;
    metrics.potionPickups += outcome.potionsTaken;
    metrics.potionTierUps += outcome.tierUps.length;
    metrics.potionTierDowns += outcome.tierDowns.length;
    for (const d of outcome.deaths) {
      metrics.deathsByCause[d.cause] = (metrics.deathsByCause[d.cause] ?? 0) + 1;
      if (d.cause === 'exhaustion' || d.cause === 'hazard') metrics.starvationDeaths++;
      else metrics.otherDeaths++;
      if (d.tier < 0) metrics.deathsWhileDebuffed++;
      if (d.tier > 0) metrics.deathsWhileBuffed++;
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
    if (outcome.ate.length > 0) emit(`  ATE ${outcome.ate.join(', ')}`);
    if (outcome.potionsTaken > 0) {
      emit(
        `  POTION x${outcome.potionsTaken}  tier up: ${outcome.tierUps.join(', ') || '(none)'}` +
          `  tier down: ${outcome.tierDowns.join(', ') || '(none)'}`
      );
    }
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

export const SCENARIOS: Record<string, GameSpec> = {
  snakes: SNAKE_SCENARIO,
  mixed: MIXED_SCENARIO,
  sparse: SPARSE_SCENARIO,
  potions: POTION_SCENARIO,
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
  readonly mode: 'ms' | 'nodes';
  /** Milliseconds in `ms` mode, work units in `nodes` mode. */
  readonly budget: number;
  readonly turnsRequested: number;
  readonly counters: {
    readonly turns: number;
    readonly unitTurns: number;
    readonly meals: number;
    readonly reversals: number;
    readonly unjustifiedReversals: number;
    readonly stationary: number;
    readonly dithers: number;
    readonly movesWithChoice: number;
    readonly seedKept: number;
    readonly starvationDeaths: number;
    readonly otherDeaths: number;
    readonly potionPickups: number;
    readonly potionTierUps: number;
    readonly potionTierDowns: number;
    readonly deathsWhileDebuffed: number;
    readonly deathsWhileBuffed: number;
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
  /** Wall clock. `ms` mode only: it is not reproducible and never compared. */
  readonly wall?: { readonly worstDecisionMs: number };
  readonly crashed: string | null;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

export function summaryOf(
  metrics: GameMetrics,
  where: { label: string; scenario: string; seed: number; turnsRequested: number },
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
    mode: budget.kind,
    budget: budget.kind === 'ms' ? budget.ms : budget.nodes,
    turnsRequested: where.turnsRequested,
    counters: {
      turns: metrics.turns,
      unitTurns: ut,
      meals: metrics.foodEaten,
      reversals: metrics.reversals,
      unjustifiedReversals: metrics.unjustifiedReversals,
      stationary: metrics.stationary,
      dithers: metrics.dithers,
      movesWithChoice: metrics.movesWithChoice,
      seedKept: metrics.seedKept,
      starvationDeaths: metrics.starvationDeaths,
      otherDeaths: metrics.otherDeaths,
      potionPickups: metrics.potionPickups,
      potionTierUps: metrics.potionTierUps,
      potionTierDowns: metrics.potionTierDowns,
      deathsWhileDebuffed: metrics.deathsWhileDebuffed,
      deathsWhileBuffed: metrics.deathsWhileBuffed,
      survivors: metrics.endHealth.length,
      healthTotal: metrics.endHealth.reduce((a, b) => a + b, 0),
    },
    rates: {
      mealsPer100: per(metrics.foodEaten),
      reversalsPer100: per(metrics.reversals),
      unjustifiedReversalsPer100: per(metrics.unjustifiedReversals),
      stationaryPer100: per(metrics.stationary),
      dithersPer100: per(metrics.dithers),
      seedKeptPer100: per(metrics.seedKept),
      deathsPer100: per(metrics.starvationDeaths + metrics.otherDeaths),
      potionPickupsPer100: per(metrics.potionPickups),
      potionTierUpsPer100: per(metrics.potionTierUps),
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
  out: { label: string; json: ((line: string) => void) | null; say: (line: string) => void }
): Promise<void> {
  const totals: Record<string, number> = {
    unitTurns: 0,
    foodEaten: 0,
    reversals: 0,
    unjustifiedReversals: 0,
    stationary: 0,
    dithers: 0,
    seedKept: 0,
    starvationDeaths: 0,
    otherDeaths: 0,
    potionPickups: 0,
    potionTierUps: 0,
    deathsWhileDebuffed: 0,
    deathsWhileBuffed: 0,
  };
  const causes: Record<string, number> = {};
  let worst = 0;
  let nodes = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = await runGame(
      {
        ...spec,
        maxTurns: turns,
        seed,
        ...(budget.kind === 'ms' ? { budgetMs: budget.ms } : { nodeBudget: budget.nodes }),
      },
      { scores: false }
    );
    for (const k of Object.keys(totals)) {
      totals[k] = (totals[k] as number) + ((r.metrics as unknown as Record<string, number>)[k] ?? 0);
    }
    for (const [c, n] of Object.entries(r.metrics.deathsByCause)) causes[c] = (causes[c] ?? 0) + n;
    worst = Math.max(worst, r.metrics.worstDecisionMs);
    nodes += r.metrics.nodes;
    out.json?.(
      JSON.stringify(
        summaryOf(r.metrics, { label: out.label, scenario, seed, turnsRequested: turns }, budget)
      )
    );
    if (r.metrics.crashed !== null) out.say(`seed ${seed} CRASHED: ${r.metrics.crashed}`);
  }
  const ut = totals.unitTurns as number;
  const per = (n: number): string => (ut === 0 ? '0.00' : ((100 * n) / ut).toFixed(2));
  out.say(
    `${scenario} seeds=${seeds} unitTurns=${ut} food/100=${per(totals.foodEaten as number)} ` +
      `reversal%=${per(totals.reversals as number)} dither%=${per(totals.dithers as number)} ` +
      `stationary%=${per(totals.stationary as number)} seedKept%=${per(totals.seedKept as number)} ` +
      `starvation=${totals.starvationDeaths} otherDeaths=${totals.otherDeaths} ` +
      `causes=${JSON.stringify(causes)} ` +
      ((totals.potionPickups as number) > 0
        ? `potions=${totals.potionPickups} tierUps=${totals.potionTierUps} ` +
          `deadDebuffed=${totals.deathsWhileDebuffed} deadBuffed=${totals.deathsWhileBuffed} `
        : '') +
      `nodes=${nodes} ` +
      (budget.kind === 'ms' ? `worstMs=${worst.toFixed(0)}` : 'deterministic')
  );
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

Examples
  node dist/tests/local-game.js mixed 30 1 150
  node dist/tests/local-game.js sum all 60 3 --nodes --json=before.jsonl
  node scripts/ab-compare.js before.jsonl after.jsonl
`;

interface Flags {
  readonly nodes: number | null;
  readonly json: string | boolean;
  readonly label: string;
  readonly positional: string[];
}

function parseFlags(argv: readonly string[]): Flags {
  const positional: string[] = [];
  let nodes: number | null = null;
  let json: string | boolean = false;
  let label = 'local';
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
      case 'help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag ${arg}`);
    }
  }
  return { nodes, json, label, positional };
}

function scenariosNamed(which: string): Array<[string, GameSpec]> {
  const names = which === 'all' ? Object.keys(SCENARIOS) : which.split(',');
  return names.map((name): [string, GameSpec] => {
    const spec = SCENARIOS[name];
    if (spec === undefined) throw new Error(`unknown scenario ${name}`);
    return [name, spec];
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

  if (argv[0] === 'sum') {
    const turns = Number(argv[2] ?? 60);
    const seeds = Number(argv[3] ?? 5);
    const budget: DecisionBudget =
      flags.nodes === null
        ? { kind: 'ms', ms: Number(argv[4] ?? 100) }
        : { kind: 'nodes', nodes: flags.nodes };
    for (const [name, spec] of scenariosNamed(argv[1] ?? 'snakes')) {
      await summarise(name, spec, turns, seeds, budget, {
        label: flags.label,
        json: emitJson,
        say,
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
  const spec = SCENARIOS[which];
  if (spec === undefined) throw new Error(`unknown scenario ${which}`);
  const result = await runGame(
    {
      ...spec,
      maxTurns: turns,
      seed,
      ...(budget.kind === 'ms' ? { budgetMs: budget.ms } : { nodeBudget: budget.nodes }),
    },
    { onTurn: say }
  );
  emitJson?.(
    JSON.stringify(
      summaryOf(
        result.metrics,
        { label: flags.label, scenario: which, seed, turnsRequested: turns },
        budget
      )
    )
  );
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
  finish();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
