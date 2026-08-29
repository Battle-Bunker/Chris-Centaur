/**
 * THE JOINT SEARCH CORE — coordinate ascent, pair repair, joint polish, and
 * the epoch-change conformance path.
 *
 * Four invariants hold at every instant, and every one of them is a test:
 *
 *  1. A COMPLETE LEGAL JointPlan EXISTS AT ALL TIMES. The search never holds a
 *     partial assignment, not even between a trial and its acceptance: a trial
 *     is a whole plan, and the incumbent is a whole plan. This is how "a valid
 *     staged set at every instant" is met by construction rather than by a
 *     fallback that has to be remembered.
 *
 *  2. PER-UNIT VALUES ARE NEVER COMPOSED INTO A TEAM SCORE. Every trial is
 *     evaluated as a JOINT plan through the real resolver, against the current
 *     teammates. Summed per-unit regret does not cover joint regret — a team
 *     floor can FALL while every unit's own floor rises — so there is no code
 *     path here that adds two unit numbers together.
 *
 *  3. PINS ARE HONORED EXACTLY. A pinned unit is not in any sweep, any repair
 *     pair, or any polish set. The bot never unpins; pins are constraints, and
 *     the only thing the search does about a pin is pay for it.
 *
 *  4. ACCEPTANCE IS ON THE PROVED FLOOR. `(floor, est, ceiling, salted tie
 *     key)`, strictly, in that order, and a basis mismatch is a refusal rather
 *     than an acceptance. `est` orders among floor ties and never adjudicates.
 *
 * The sweep runs in danger order; the repair is a 2-opt over exactly the pairs
 * the resolution names as self-inflicted casualties; the polish is the
 * cross-product of the top-2 candidates of the ≤3 most contested units; and
 * restarts inherit the witness set.
 */

import type {
  AdjudicationReport,
  Candidate,
  CandidateSet,
  ClusterReport,
  JointPlan,
  Posture,
  PlanScore,
  SearchContext,
  SearchCore,
  UnitId,
} from "../contracts";
import {
  BoundBank,
  DEFAULT_BANK_CONFIG,
  compareFloors,
  hasRoster,
  refutedAt,
  withMove,
  withMoves,
  type BankConfig,
  type BankResult,
} from "../bounds";
import {
  contestedUnits,
  dangerOrder,
  deadIn,
  planTieKey,
  selfInflictedPairs,
  topCandidates,
} from "./order";
import { basisOf, referenceActionsOf } from "./basis";
import { resolveStagingSafety, stagingSafety } from "../staging-safety";
import {
  catalogueDigest,
  clusterPlanPartition,
  planBatchPartition,
  type EvaluationPool,
  type EvaluatorSpec,
  type Frontier,
  type SampledOrder,
  type WorkPartition,
} from "../parallel";
import type { CandidateKnobs } from "../candidates";
import { EngineSubstrate } from "../substrate";
import { SeedWorkspace, clusterSeedEnabled, greedySeed } from "./cluster-seed";
import {
  DEFAULT_MULTISTART,
  crowdedUnits,
  multiStartSeed,
  multistartSeedEnabled,
  type MultiStartReport,
  type MultiStartTuning,
} from "./multistart-seed";
import { clusterEnumEnabled, partitionOf, type Partition } from "./cluster-partition";
import { setRefineScope, territoryRefineEnabled } from "../evaluate/refine";
import {
  DEFAULT_CLUSTER_TUNING,
  enumerateProposals,
  type ClusterStats,
  type ClusterTuning,
} from "./cluster-enum";
import { SweepDirty, type DirtyStats } from "./sweep-dirty";
import { Scout, scoutMode } from "./scout";
import type { ScoutMode, ScoutReport, ScoutTuning } from "./scout";
import {
  DEFAULT_SAMPLING,
  NODE_PAIR_REPAIR,
  NODE_POLISH,
  NODE_PROPOSALS,
  NODE_SWEEP_CANDIDATES,
  NODE_SWEEP_UNITS,
  SelectionSampler,
  candidateWeights,
  decisionSeed,
  mix,
  proposalWeights,
  sampledCapEnabled,
  unitCeiling,
  unitWeights,
  widenTo,
  type SamplingTuning,
  type SelectionReport,
} from "../selection";

export interface SearchTuning {
  readonly bank: Partial<BankConfig>;
  /** Our own options tried per unit per sweep. A max-side cap: no declaration. */
  readonly candidateCap: number;
  readonly maxSweeps: number;
  /** Candidates per side of a repaired pair. */
  readonly pairRepairPerUnit: number;
  /** How many contested units the joint polish exhausts. */
  readonly polishUnits: number;
  /** Candidates per unit in the polish cross-product. */
  readonly polishPerUnit: number;
  /** Perturbed restarts after convergence. They inherit the witness set. */
  readonly restarts: number;
  /** Desymmetrises exact ties only. */
  readonly seed: number;
  /** Candidates re-picked per unit during `conform`'s legality repair. */
  readonly conformRepairPerUnit: number;
  /**
   * How many BASES keep a live session (candidate sets + bound bank + memo)
   * between calls. One committed context and its speculative companions is
   * the shape the kernel alternates over; a session dropped between slices
   * throws away the memo and re-prices the seed on every single one.
   */
  readonly sessionCacheSize: number;
  /**
   * How many of our OWN casualties rung 0's self-harm repair will try to move.
   * A cap, not a policy: the repair is already bounded by how many units the
   * resolution names, and this stops a pathological turn (every unit staged
   * into its own neck) from spending the whole pre-emission budget.
   */
  readonly rungZeroRepairVictims: number;
  /**
   * Whether rung 0 reads the verdict of the price it already pays. Left
   * undefined it follows `CENTAUR_STAGING_SAFETY`; named by a caller it is that
   * caller's answer, so one seat can carry the repair while the seat across the
   * board does not.
   */
  readonly rungZeroRepair: boolean | undefined;
  /**
   * Whether the seed reserves the cells it has already spent, so two of our
   * units do not both start on the same square. Undefined follows
   * `CENTAUR_STAGING_SAFETY`; named by a caller it is that caller's answer.
   */
  readonly seedDeconflict: boolean | undefined;
  /**
   * THE INDEX-DRIVEN GREEDY PAIRWISE SEED, in place of the reserve-a-cell
   * de-confliction pass. Undefined follows `CENTAUR_CLUSTER_SEED`; named by a
   * caller it is that caller's answer, so one seat can carry it while the seat
   * across the board does not — a process-wide flag moves every seat at once
   * and a paired experiment on it measures nothing.
   *
   * DEFAULT OFF pending its empirical gate. See `./cluster-seed.ts`.
   */
  readonly clusterSeed: boolean | undefined;
  /**
   * THE MULTI-START SEED — a random safe baseline, then sampled multi-start
   * hill climbing, then a weighted-random selection among what was found.
   *
   * This is the owner's redesign of search seeding, and it REPLACES the
   * rejected `clusterSeed` rather than composing with it: where both resolve
   * on, the multi-start runs and the greedy pairwise seed does not, because two
   * seeds cannot both be the plan the ascent starts from.
   *
   * Stage 0 is a LITERALLY RANDOM selection of maximally safe moves — a uniform
   * draw over each unit's fatality-safe options, with the risky cells
   * coordinated so at most one unit takes each. Stage 1 samples hundreds to
   * thousands of random joint combos per cluster inside a configurable slice of
   * the decision budget (a tenth of it by default), hill-climbs a few
   * coordinate-ascent steps from each, and picks among what it found by
   * softmax. Nothing is pruned, no bound moves, and `better()` still
   * adjudicates on the proved floor.
   *
   * Undefined follows `CENTAUR_MULTISTART_SEED`; named by a caller it is that
   * caller's answer, so one seat can carry it while the seat across the board
   * does not. DEFAULT OFF: no options are classified, no draw is taken, no
   * clock is read, and the seed is byte-for-byte the one that shipped.
   */
  readonly multistartSeed: boolean | undefined;
  /** Budget share, sample sizing, climb depth and temperature. Only read when
   * `multistartSeed` resolves on. See `./multistart-seed.ts`. */
  readonly multistartTuning: Partial<MultiStartTuning>;
  /**
   * CLUSTER-FACTORED EXACT ENUMERATION — the owner's core intervention.
   *
   * The board is partitioned into components of the non-slider interaction
   * graph, every live slider of ours joins every component by fiat, each
   * component's joint move is enumerated EXACTLY on a µs-cost surrogate
   * conditional on the slider assignment, and the composed k-best joints are
   * offered to this search as PROPOSALS — priced through the unconditional bank
   * and accepted only by `better()`, exactly like every other trial.
   *
   * Two further behaviours ride the same flag, because neither is separately
   * measurable and both are the same idea:
   *
   *  · the WORKER CUT becomes the proposal tail rather than the sweep frontier
   *    (`parallel/partition.ts`'s `clusterPlanPartition`);
   *  · the SWEEP DIRTY SET skips re-pricing a unit whose interaction
   *    neighbourhood has not moved (`./sweep-dirty.ts`).
   *
   * Undefined follows `CENTAUR_CLUSTER_ENUM`; named by a caller it is that
   * caller's answer, so one seat can carry it while the seat across the board
   * does not. DEFAULT OFF: nothing is partitioned, nothing is enumerated, and
   * the search is byte-for-byte the one that shipped.
   */
  readonly clusterEnum: boolean | undefined;
  /** Budgets for the enumeration. Only read when `clusterEnum` resolves on. */
  readonly clusterTuning: Partial<ClusterTuning>;
  /**
   * DOOR C — THE CONTESTED REACH/ROOM REFINER (CL5), per engine.
   *
   * With it on, the evaluator gets a SECOND sound reading of the territory
   * partition in which a HELD unit's arrival flood is stopped at our own
   * enumerated units' living bodies, and publishes the MEET of the two: the
   * floor can only rise and the ceiling can only fall. Zero new semantics — it
   * is a better computation of a term the one-ply frame already contains.
   *
   * It runs only over units this decision's cluster enumeration already paid
   * for, so `clusterEnum` must also resolve on; a caller that asks for the
   * refiner without the enumeration gets no scope and no refinement, and the
   * cluster report says so. Undefined follows `CENTAUR_TERRITORY_REFINE`.
   * DEFAULT OFF, and off it registers no scope, so `makeContext` reads `null`
   * and the evaluator is byte-for-byte the one that shipped.
   */
  readonly territoryRefine: boolean | undefined;
  /**
   * THE SEEDED WEIGHTED LOTTERY — the owner's ruling R-A, made mechanical.
   *
   * Verbatim: *"I don't intuitively trust a strategy of deterministically
   * exploring ordered by cheaply computed priors because this will tend to
   * produce biases in the behaviour considered under resource scarcity that
   * could be exploited by adversaries at the least... stick to weighted random
   * selection in branch exploration decisions, weighted by the integrated prior
   * scores of cheaper heuristics."*
   *
   * With it ON, four deterministic prefixes become seeded Gumbel-top-k draws
   * over the same lists: the sweep's per-unit candidate cap, the pair repair's,
   * the polish's, and the order units are swept in — plus CL3's composed joint
   * offers. Nothing is removed from any set (contract rule 18: a probability
   * returns a PERMUTATION; the cap then takes a prefix exactly as it always
   * did), no bound moves, and `better()` still adjudicates on the proved floor
   * alone (contract rule 17).
   *
   * Undefined follows `CENTAUR_SAMPLED_CAP`; named by a caller it is that
   * caller's answer, so one seat can carry the lottery while the seat across
   * the board does not. DEFAULT OFF: no sampler is constructed, no draw is
   * taken, no clock is read, and the search is byte-for-byte the one that
   * shipped.
   */
  readonly sampledCap: boolean | undefined;
  /** Temperature schedule, weights and the private match seed. Only read when
   * `sampledCap` resolves on. See `lobster/selection/sample.ts`. */
  readonly samplingTuning: Partial<SamplingTuning>;
  /**
   * DOOR A — THE SCOUT (CL6), advisory depth, per engine.
   *
   * Cluster threads simulate one to three plies past this turn over the door
   * (`search/scout/door.ts`) and report what they find. The findings steer
   * everything it is LEGAL to steer and nothing else: candidate ordering
   * through CL3's own `UnaryLookup` seam, and telemetry. No route reaches
   * `lo`, `hi` or staging, and `search/scout/index.ts` states the import law
   * that makes that structural rather than habitual.
   *
   * THREE POSITIONS, and the middle one is what makes the gate mean anything:
   *   · `off`      — shipped default. No thread, no door, no clock read, and
   *                  the search is byte-for-byte the one that shipped.
   *   · `observe`  — every thread runs and every counter is emitted, and NO
   *                  ordering channel is touched. Its staged plan equals
   *                  flag-off's on the replay corpus, and the test that says so
   *                  is an assertion about the whole layer.
   *   · `advise`   — the ordering sink is live. The enumeration runs twice: once
   *                  to give the threads their seeds, once with the findings
   *                  supplied as φ_u. Determinism is asserted separately.
   *
   * Undefined follows `CENTAUR_SCOUT`; named by a caller it is that caller's
   * answer, so one seat can carry the scout while the seat across the board
   * does not.
   */
  readonly scout: ScoutMode | undefined;
  /** Tithe, depth ceiling, park hysteresis. Only read when `scout` is on. */
  readonly scoutTuning: Partial<ScoutTuning>;
  /**
   * Composed joints offered per sweep round.
   *
   * ONE, and the one is measured. The enumeration's MAP is its claim and it
   * competes before any sweep; its alternates are diversity, and draining the
   * whole list up front spends a starved decision generating instead of
   * searching. On the scattered family — where 82.7% of components are
   * singletons and there is little joint to find — draining cost a mean 0.769
   * of final floor at the production budget.
   */
  readonly clusterOffersPerRound: number;
  /**
   * Composed joints the coordinator prices per SLICE, or 0 for no cap.
   *
   * A cap exists so a TAIL SURVIVES INTO THE NEXT SLICE. A parcel fired at the
   * end of slice N lands at the start of slice N+1 (a slice is synchronous
   * JavaScript; no message is delivered inside one), so a proposal the
   * coordinator has already walked past is a proposal no worker can ever be
   * useful about. With the list drained in slice 1 the pool imports entries the
   * coordinator will never ask for again, which is `entriesUsed = 0` by
   * construction rather than by contention.
   */
  readonly clusterOffersPerSlice: number;
  /**
   * WORKER PARALLELISM, or `null` for the single-threaded path.
   *
   * Null is the default and is bit-for-bit the search that shipped: no fold, no
   * dispatch, no extra allocation, no extra branch inside a hot loop. Present,
   * it is everything this core needs to describe its own session to a worker —
   * the pool, the board the pool is holding, the RESOLVED candidate knobs (the
   * core only ever sees an opaque `CandidateGenerator`, so the knobs have to
   * arrive from whoever built it) and how the evaluator is to be rebuilt.
   *
   * `TeamDecisionEngine` fills this in; nothing else does.
   */
  readonly parallel: ParallelTuning | null;
}

export interface ParallelTuning {
  readonly pool: EvaluationPool;
  /** The epoch `pool.pushBoard` returned for THIS decision's board. */
  readonly boardEpoch: number;
  readonly knobs: CandidateKnobs;
  readonly evaluator: EvaluatorSpec;
  /**
   * How many plans of the frontier to leave to the main thread before
   * speculation starts.
   *
   * A slice is synchronous, so no worker result can land inside one: the plans
   * this slice is about to price itself are plans no worker can beat it to, and
   * speculating on them is speculating on a race that is already lost. The
   * headroom is what the main thread expects to get through; the workers take
   * the tail, and slice N+1 finds it already evaluated.
   */
  readonly headroom: number;
  /**
   * How long a worker may spend on one parcel, as a MULTIPLE OF THIS SLICE.
   *
   * A parcel is speculation for the next slice, so it has to outlive this one —
   * but not by much: a worker still pricing when the turn resolves is burning a
   * core the coordinator needs, and the shared live-epoch table can only stop it
   * at a plan boundary. The main thread owns this number, as it owns every other
   * budget in the system; the slice it is a multiple of is the one the kernel
   * handed down.
   */
  readonly parcelSlices: number;
  /** Ceiling on the wall time in the line above, for the first slice of a
   * decision (whose length nobody has measured yet) and for a pathological one. */
  readonly parcelBudgetMs: number;
  /** Plans in one parcel. A cap, and a latency one: see `planBatchPartition`. */
  readonly maxPlansPerParcel: number;
  /** How the frontier is cut. Defaults to `planBatchPartition`; the
   * cluster-lookahead program replaces exactly this. */
  readonly partition?: WorkPartition;
}

export const DEFAULT_TUNING: SearchTuning = {
  bank: {},
  candidateCap: 8,
  maxSweeps: 6,
  pairRepairPerUnit: 4,
  polishUnits: 3,
  polishPerUnit: 2,
  restarts: 2,
  seed: 0x5eed,
  conformRepairPerUnit: 4,
  sessionCacheSize: 2,
  rungZeroRepairVictims: 4,
  rungZeroRepair: undefined,
  seedDeconflict: undefined,
  clusterSeed: undefined,
  multistartSeed: undefined,
  multistartTuning: {},
  clusterEnum: undefined,
  clusterTuning: {},
  territoryRefine: undefined,
  sampledCap: undefined,
  samplingTuning: {},
  scout: undefined,
  scoutTuning: {},
  clusterOffersPerRound: 1,
  clusterOffersPerSlice: 2,
  parallel: null,
};

/** The search could not determine which units it commands. */
export class NoRosterError extends Error {
  readonly code = "no_roster" as const;
  constructor() {
    super(
      "SearchCore needs a roster: pass an incumbent PlanScore, or a Substrate that " +
        "implements commandable(asTeam). A plan that omits a live unit is refused by " +
        "resolveBounded, so guessing one is not an option.",
    );
    this.name = "NoRosterError";
  }
}

interface Session {
  /** The substrate this session's candidate sets and memo were built against.
   * A session is only ever reused on the same one. */
  readonly sub: SearchContext["sub"];
  readonly bank: BoundBank;
  readonly ours: ReadonlyArray<UnitId>;
  readonly ourSet: ReadonlySet<UnitId>;
  readonly pinned: ReadonlySet<UnitId>;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  readonly pins: ReadonlyMap<UnitId, Candidate>;
  /** Units not ours to command, FIXED to their declared actions. They ride in
   * EVERY plan this core holds or returns — the plan's domain IS the modelled
   * set, so a consumer evaluating a returned plan gets the same held
   * configuration the search priced (a held-capacity overflow fixed by
   * reference must stay fixed on the emission path too). Never swept,
   * repaired, polished or perturbed. */
  readonly references: ReadonlyMap<UnitId, Candidate>;
  /**
   * This session's identity to the worker pool, or null when there is none.
   * `seq` is the parcel counter the fold orders on, and it is mutable because
   * a session outlives every parcel it fires.
   */
  readonly parallel: { readonly sessionId: number; seq: number } | null;
  /**
   * The cluster seed's reusable buffers: the conflict index and the freed-tail
   * map, both generation-stamped, so a rebuild per sweep step is an integer
   * increment rather than a clear. Null when the seed is off — an unused
   * workspace is an allocation nobody asked for.
   */
  readonly seedWorkspace: SeedWorkspace | null;
  /**
   * The multi-start seed's per-session state, or null when the flag is off.
   *
   * PER SESSION and never per slice, for the two reasons every other seeded
   * layer here is: the decision seed must be stable across the slices of one
   * decision or two slices replay each other's draws, and the partition is a
   * function of per-decision facts (influence footprints over frozen option
   * sets) that no slice changes.
   */
  readonly multistart: {
    readonly seed: number;
    readonly partition: Partition;
    readonly tuning: MultiStartTuning;
  } | null;
  /**
   * CL4's lottery, or null when the flag is off.
   *
   * PER SESSION and never per call: the draw ledger's per-node visit counters
   * are what make a bigger budget's decision sequence an EXTENSION of a smaller
   * one's (the two-budget prefix probe), and a sampler rebuilt every slice
   * would restart every counter and destroy exactly that property. It shares
   * the session's lifetime with the bank and the candidate sets, which is the
   * same lifetime the seed is derived over.
   */
  readonly sampler: SelectionSampler | null;
  /**
   * Each unit's MATERIAL CEILING for the lottery's level term, frozen for the
   * session — the unit's own material weight, or `−∞` where CL1's rung-0
   * classifier `sealed` it (a unit that dies in every world it was offered has
   * no world in which its material survives). Built once because both inputs
   * are per-decision facts; `null` when the sampler is off, and then the map is
   * never allocated. `prior.ts::clipCeilings` is what turns the `−∞` into a
   * finite last-place weight rather than an exclusion (contract rules 18, 26).
   */
  readonly ceilings: ReadonlyMap<UnitId, number> | null;
  /**
   * CL3's cluster state, or null when the flag is off.
   *
   * The proposals are a per-SESSION quantity, not a per-slice one: the
   * surrogate reads only per-decision static facts (strengths, bodies, tails,
   * terrain), so the same partition and the same k-best joints come out on
   * every slice. Enumerating once and walking a cursor through the list is what
   * turns "offer the same eight plans every slice" into "price eight plans,
   * once, in whatever order the budget allows".
   */
  cluster: {
    readonly partition: Partition;
    readonly proposals: ReadonlyArray<JointPlan>;
    /** Ṽ of an arbitrary plan — the offer gate's own currency. */
    readonly score: ((plan: JointPlan) => number) | null;
    readonly stats: ClusterStats;
    readonly dirty: SweepDirty;
    readonly tuning: ClusterTuning;
    /** How far down `proposals` the coordinator has walked. */
    cursor: number;
    /** Proposals the one-move filter declined to pay for. Telemetry. */
    skippedNear: number;
    /** Proposals the surrogate gate declined to pay for. Telemetry. */
    skippedFlat: number;
    /** Proposals priced in the slice now running. See `clusterOffersPerSlice`. */
    offeredThisSlice: number;
    /** Wall time the enumeration itself cost, in ms. Telemetry. */
    readonly enumMs: number;
  } | null;
  /**
   * CL6's scout, or null when the flag is off.
   *
   * PER SESSION, like the sampler and for the same reason: the thread ledger's
   * per-thread ply counters are what make a bigger budget's thread set an
   * EXTENSION of a smaller one's, and a scout rebuilt every slice would
   * restart every one of them.
   *
   * It runs ONCE, at session open, alongside the enumeration whose proposals
   * are its seeds. It is not re-run per slice: a thread's whole economy rests
   * on its ply-1 plan being FIXED for the thread's life (the premise key, and
   * therefore the timeline cache, is keyed on the non-cluster assignment), and
   * a per-slice re-seed would rebuild every timeline it was trying to share.
   */
  readonly scout: Scout | null;
}

export function makeSearchCore(tuning: Partial<SearchTuning> = {}): SearchCore {
  const cfg: SearchTuning = { ...DEFAULT_TUNING, ...tuning };
  /** Bounds inversions this core absorbed rather than letting them end a
   * decision. Drained by the kernel, which owns the refusal counters. */
  let absorbedInversions = 0;
  /**
   * WHICH SLOT OF `better()` DECIDED — the O-P1 instrument (law L17).
   *
   * Telemetry, never behaviour: five counters and one increment per comparison,
   * on a path that already ran a bounds comparison and is about to run an 18 ms
   * price. It exists because "optimism never promotes" is a claim about how
   * often the CEILING slot fires, and until Stage 3a's tier ladder lands that
   * claim is unmeasured on this branch. Present flag-on and flag-off, so the
   * lottery's effect on it is a subtraction rather than an assertion.
   */
  const adjudication = {
    floorDecided: 0,
    estDecided: 0,
    ceilingDecided: 0,
    tieKeyDecided: 0,
    vetoed: 0,
    refused: 0,
  };
  /** Sessions opened over this core's life — the lottery's decision index, so
   * the committed and the speculative context of one turn, and two successive
   * turns, never replay each other's draws. Monotone; never reset. */
  let decisions = 0;

  /**
   * LIVE SESSIONS, KEYED BY BASIS.
   *
   * A session is the expensive half of a search call: every unit's candidate
   * set, the bound bank, and the bank's resolution memo. Building one per
   * `improve()` meant every slice re-generated the grammar, started from a
   * COLD memo, and spent its first `price()` re-pricing the seed it had priced
   * on the previous slice — at 26 units, where one price is ~18 ms against a
   * 25 ms slice, that is the entire slice. 370 slices over ten seconds then
   * produced the identical bracket to 18 slices over one.
   *
   * A session is valid for a BASIS: the pins and assumptions the bank was
   * constructed with. The kernel alternates between the committed context and
   * a speculative one, so a one-entry cache would thrash; the cache is small
   * and LRU, and each session's memo gets a share of the slab budget so the
   * total ceiling is unchanged.
   */
  const sessions = new Map<string, Session>();
  const share = (total: number, floor: number): number =>
    Math.max(floor, Math.floor(total / Math.max(1, cfg.sessionCacheSize)));
  const memoShare = share(cfg.bank.memoCapacity ?? DEFAULT_BANK_CONFIG.memoCapacity, 64);
  // The EVALUATION memo gets its own share of its own budget, for the same
  // reason and by the same arithmetic: a live session per basis must not
  // multiply the decision's ceiling. Its entries hold no slabs, so its total
  // is set independently of the resolution memo's (see bounds/evalmemo.ts).
  const evalMemoShare = share(
    cfg.bank.evalMemoCapacity ?? DEFAULT_BANK_CONFIG.evalMemoCapacity,
    0,
  );

  const sessionKey = (ctx: SearchContext): string =>
    JSON.stringify(basisOf(ctx)) + `#${ctx.asTeam}`;

  // ------------------------------------------------------------------ setup

  const rosterOf = (ctx: SearchContext): ReadonlyArray<UnitId> => {
    // A unit fixed by reference is never ours to sweep, whichever way the
    // roster was learned — an incumbent plan CARRIES the references.
    const referenced = new Set(
      ctx.assumptions.filter((a) => a.kind === "reference-action").map((a) => a.unitId),
    );
    const sift = (ids: Iterable<UnitId>): UnitId[] =>
      [...ids].filter((id) => !referenced.has(id)).sort((a, b) => a - b);
    if (hasRoster(ctx.sub)) return sift(ctx.sub.commandable(ctx.asTeam));
    if (ctx.incumbent !== null) return sift(ctx.incumbent.plan.keys());
    throw new NoRosterError();
  };

  /**
   * A session for this basis, reused when one is already live.
   *
   * TWO THINGS CROSS THE BOUNDARY, and a cached session is wrong without
   * either of them:
   *
   *  - THE WITNESSES the caller has learned since. The double oracle's memory.
   *  - THE BUDGET OF THE SLICE THAT IS RUNNING NOW. The kernel builds a fresh
   *    `SliceBudget` per slice; the bank was built with the FIRST one and kept
   *    it, so from slice two its `shouldStop()` was permanently true and every
   *    price degraded to B0 — measured at 1 724 of 1 724 prices in a
   *    one-second decision, with zero B1/B2/B3 admissions and zero witnesses
   *    banked. See the note on `BoundBank.budget`. Handing the live handle
   *    over here, on every path, is the whole fix: budget semantics stay the
   *    kernel's, and the bank consults the clock it was given for THIS slice.
   */
  const sessionFor = (ctx: SearchContext): Session => {
    const key = sessionKey(ctx);
    const hit = sessions.get(key);
    if (hit !== undefined && hit.sub === ctx.sub) {
      // Keep the LRU order.
      sessions.delete(key);
      sessions.set(key, hit);
      hit.bank.adoptBudget(ctx.budget);
      hit.bank.adoptWitnesses(ctx.witnesses);
      return hit;
    }
    if (hit !== undefined) closeSession(key);
    const made = open(ctx);
    sessions.set(key, made);
    while (sessions.size > Math.max(1, cfg.sessionCacheSize)) {
      const oldest = sessions.keys().next();
      if (oldest.done) break;
      closeSession(oldest.value);
    }
    return made;
  };

  const closeSession = (key: string): void => {
    const s = sessions.get(key);
    if (s === undefined) return;
    sessions.delete(key);
    // Hand the memo's counters to the pool BEFORE the bank clears them: how
    // many speculative evaluations were taken, and how many were ever read, is
    // the only honest measure of whether the workers paid for themselves, and
    // after `release()` there is nobody left to ask.
    if (cfg.parallel !== null && s.parallel !== null) {
      cfg.parallel.pool.noteSession(s.bank.evalMemoStats);
    }
    s.bank.release();
  };

  /** Drop every live session and return every slab they cached. */
  /**
   * CL7 — THE LAST DECISION'S TELEMETRY, KEPT ACROSS `release()`.
   *
   * The three session-derived reports below are summed over LIVE sessions, and
   * the kernel calls `release()` when a decision ends — so by the time anything
   * outside the kernel could ask, every one of them answered `null`. A layer's
   * whole promotion case then reads as "the layer never ran", which is exactly
   * the reading the reports exist to prevent.
   *
   * So `release()` snapshots them first, and each accessor falls back to the
   * snapshot when no session is live. Telemetry only: no bound, no plan and no
   * schedule reads any of it, and a live session always wins, so nothing that
   * runs during a decision sees a stale number.
   */
  let lastCluster: ClusterReport | null = null;
  let lastSelection: SelectionReport | null = null;
  let lastScout: ScoutReport | null = null;
  let lastMultiStart: MultiStartReport | null = null;

  const release = (): void => {
    lastCluster = clusterReport();
    lastSelection = selectionReport();
    lastScout = scoutReport();
    for (const key of [...sessions.keys()]) closeSession(key);
  };

  const open = (ctx: SearchContext): Session => {
    const ours = rosterOf(ctx);
    const sets = new Map<UnitId, CandidateSet>();
    for (const unitId of ours) sets.set(unitId, ctx.gen.candidatesFor(ctx.sub, unitId));
    const references = referenceActionsOf(ctx, sets);
    const bank = new BoundBank({
      sub: ctx.sub,
      gen: ctx.gen,
      evaluate: ctx.evaluate,
      asTeam: ctx.asTeam,
      budget: ctx.budget,
      basis: basisOf(ctx),
      referenceActions: references,
      config: { ...cfg.bank, memoCapacity: memoShare, evalMemoCapacity: evalMemoShare },
    });
    bank.adoptWitnesses(ctx.witnesses);
    // A pin is a constraint on a unit we command; a pin naming a unit we do
    // not command is not ours to honor and is left to the module that owns it.
    const pins = new Map<UnitId, Candidate>();
    for (const pin of ctx.pins) {
      if (pin.tentative || !sets.has(pin.unitId)) continue;
      const match = matchPin(sets.get(pin.unitId) as CandidateSet, pin.to);
      if (match !== null) pins.set(pin.unitId, match);
    }
    // ONE DECISION INDEX PER SESSION, shared by every seeded layer.
    //
    // Both consumers below mix it into their own decision seed, and if each
    // took its own the LOTTERY's stream would shift whenever the MULTI-START
    // flag moved — which would make a paired experiment on one flag a paired
    // experiment on both. One index, handed to both, keeps each layer's stream
    // a function of its own seed and the board and nothing else.
    const decisionIndex = decisions++;
    const session: Session = {
      sub: ctx.sub,
      bank,
      ours,
      ourSet: new Set(ours),
      pinned: new Set(pins.keys()),
      sets,
      pins,
      references,
      parallel: openParallelSession(ctx, ours, sets),
      // Allocated only for a session that will use it, and then kept for the
      // session's whole life: the buffers are what make a rebuild O(1).
      seedWorkspace: clusterSeeding() ? new SeedWorkspace() : null,
      multistart: openMultiStart(ctx, ours, sets, pins, references, decisionIndex),
      sampler: openSampler(ctx, ours, sets, decisionIndex),
      ceilings: sampling() ? unitCeilings(ctx, ours, sets) : null,
      cluster: null,
      scout: scouting() === "off" ? null : new Scout(scouting(), cfg.scoutTuning),
    };
    session.cluster = openCluster(ctx, session, pins);
    return session;
  };

  /**
   * THE SAMPLER, AND THE SEED IT RUNS ON.
   *
   * The decision seed mixes three things and one of them is private:
   *
   *   · `matchSeed` — the operator's, never on the wire, and the only input an
   *     adversary cannot compute. Zero by default (see `selection/rng.ts`);
   *   · the BOARD FINGERPRINT — a hash over the roster's frozen facts, so two
   *     different positions never share a stream. Built from quantities that
   *     are already computed and already in hand: the roster order, each unit's
   *     origin cell, and how many legal actions the engine counted for it. It
   *     costs one pass over the roster, no substrate query, and it changes
   *     every turn because `from` does;
   *   · the DECISION INDEX — this core's session counter, so the two contexts
   *     the kernel alternates over (committed and speculative) and successive
   *     turns on one core do not replay each other's draws.
   *
   * Null when the flag is off, and then nothing below it is ever constructed.
   */
  const openSampler = (
    ctx: SearchContext,
    ours: ReadonlyArray<UnitId>,
    sets: ReadonlyMap<UnitId, CandidateSet>,
    decisionIndex: number,
  ): SelectionSampler | null => {
    if (!sampling()) return null;
    const tuning: SamplingTuning = { ...DEFAULT_SAMPLING, ...cfg.samplingTuning };
    return new SelectionSampler(
      decisionSeed(tuning.matchSeed, boardFingerprint(ctx, ours, sets), decisionIndex),
      tuning,
    );
  };

  /**
   * A hash over the roster's frozen facts — the PUBLIC half of a decision seed.
   *
   * Built from quantities already computed and already in hand: the team, the
   * roster order, each unit's origin cell, and how many legal actions the
   * engine counted for it. It costs one pass over the roster, no substrate
   * query, and it changes every turn because `from` does.
   */
  const boardFingerprint = (
    ctx: SearchContext,
    ours: ReadonlyArray<UnitId>,
    sets: ReadonlyMap<UnitId, CandidateSet>,
  ): number => {
    let fingerprint = mix(0x10b57e12, ctx.asTeam | 0);
    for (const unitId of ours) {
      const set = sets.get(unitId);
      fingerprint = mix(fingerprint, unitId | 0);
      fingerprint = mix(fingerprint, set?.candidates[0]?.from ?? -1);
      fingerprint = mix(fingerprint, set?.legalCount ?? 0);
    }
    return fingerprint;
  };

  /**
   * THE MULTI-START SEED'S SESSION STATE — the decision seed and the partition.
   *
   * Null, never a throw and never a silent degradation, when the layer cannot
   * run: the flag is off, or the substrate is not the engine's (which is what
   * happens in the bounds harness and under the memo proxies). The seed is then
   * exactly what it was.
   *
   * The partition is taken over the units this decision could vary — pins and
   * reference actions held out, exactly as `openCluster` holds them out. Which
   * of the remainder are actually free changes per slice as the incumbent fixes
   * them, and `groupsOf` in the seed module filters to that; the graph itself
   * does not move.
   */
  const openMultiStart = (
    ctx: SearchContext,
    ours: ReadonlyArray<UnitId>,
    sets: ReadonlyMap<UnitId, CandidateSet>,
    pins: ReadonlyMap<UnitId, Candidate>,
    references: ReadonlyMap<UnitId, Candidate>,
    decisionIndex: number,
  ): Session["multistart"] => {
    if (!multistarting() || !(ctx.sub instanceof EngineSubstrate)) return null;
    const tuning: MultiStartTuning = { ...DEFAULT_MULTISTART, ...cfg.multistartTuning };
    const fixedIds = new Set<UnitId>([...pins.keys(), ...references.keys()]);
    const partition = partitionOf({ sub: ctx.sub, roster: ours, fixed: fixedIds });
    return {
      seed: decisionSeed(
        // The MULTI-START's own tag folded in, so the two layers never share a
        // stream even at the same decision index: `multistartTuning.matchSeed`
        // and `samplingTuning.matchSeed` are one number by construction.
        mix(tuning.matchSeed, 0x4d_53_00_01),
        boardFingerprint(ctx, ours, sets),
        decisionIndex,
      ),
      partition,
      tuning,
    };
  };

  /**
   * The level term of the unit lottery, frozen once per session.
   *
   * A substrate that cannot name a unit's material weight — the bounds harness,
   * the memo proxies — yields a ZERO for every unit rather than a guess, which
   * makes the material half a constant and leaves the danger ranks deciding.
   * That is the same degradation `clusterSeed` takes on the same substrates,
   * and it degrades an ORDERING, which is the only thing here there is to
   * degrade.
   */
  const unitCeilings = (
    ctx: SearchContext,
    ours: ReadonlyArray<UnitId>,
    sets: ReadonlyMap<UnitId, CandidateSet>,
  ): ReadonlyMap<UnitId, number> => {
    const out = new Map<UnitId, number>();
    const engine = ctx.sub instanceof EngineSubstrate ? ctx.sub : null;
    for (const unitId of ours) {
      const weight = engine?.unitOf(unitId)?.weight ?? 0;
      out.set(unitId, unitCeiling(weight, sets.get(unitId)?.marks?.sealed === true));
    }
    return out;
  };

  /**
   * THE PARTITION, THE ENUMERATION, AND THE DIRTY SET — once per session.
   *
   * Returns null, never throws and never silently degrades, when the layer
   * cannot run: the flag is off, or the substrate is not the engine's (which is
   * what happens in the bounds harness and under the memo proxies), or the
   * roster has nothing to vary. The search is then exactly what it was.
   */
  const openCluster = (
    ctx: SearchContext,
    s: Session,
    pins: ReadonlyMap<UnitId, Candidate>,
  ): Session["cluster"] => {
    // Door C's scope is REBUILT, never inherited: a session that no longer
    // enumerates must not leave the previous one's members standing on the
    // substrate, or the evaluator would keep refining against a partition
    // nothing recomputed.
    if (s.sub instanceof EngineSubstrate) setRefineScope(s.sub, null);
    if (!clusterEnumerating() || !(s.sub instanceof EngineSubstrate)) return null;
    if (s.ours.length === 0) return null;
    const started = Date.now();
    // Pins and reference actions are CONSTRAINTS, not variables: they ride
    // every proposal at their declared move and are never enumerated over.
    const fixedIds = new Set<UnitId>([...pins.keys(), ...s.references.keys()]);
    const partition = partitionOf({ sub: s.sub, roster: s.ours, fixed: fixedIds });
    const fixed = new Map<UnitId, Candidate>();
    for (const [unitId, candidate] of pins) fixed.set(unitId, candidate);
    for (const [unitId, candidate] of s.references) fixed.set(unitId, candidate);
    // E4's input, straight off the classifier, exactly as the seed reads it.
    const doomed = new Set<UnitId>();
    for (const [unitId, set] of s.sets) if (set.marks?.sealed === true) doomed.add(unitId);
    const tuning: ClusterTuning = { ...DEFAULT_CLUSTER_TUNING, ...cfg.clusterTuning };
    const request = {
      sub: s.sub,
      partition,
      roster: s.ours,
      sets: s.sets,
      fixed,
      doomed,
      asTeam: ctx.asTeam,
      tuning,
      salt: cfg.seed,
    };
    let { plans, stats, score } = enumerateProposals(request);

    // ---- CL6, DOOR A: the scout, and its ONE ordering channel ------------
    //
    // The threads' seeds are the enumeration's own proposals, so the scout
    // cannot run before the enumeration. Its advice, though, is consumed AT
    // enumeration time — `Surrogate.unary` is the seam CL3 built for exactly
    // this and left unsupplied. So in `advise` the enumeration runs twice:
    // once to hand the threads their roots, once with φ_u supplied.
    //
    // That second pass is the whole cost of the ordering sink, it is paid only
    // when the threads actually found something, and it is the honest way to
    // spend a finding: re-deriving the k-best list under the new potential is
    // what "ordering advice" MEANS. Re-ranking the existing list instead would
    // be re-scoring a set that was already truncated under the old potential,
    // which is advice arriving after the decision it was for.
    //
    // In `observe` none of this happens: the scout runs, the report is
    // written, and `plans` is the object the flag-off path produced. That is
    // what makes the byte-identity claim structural.
    if (s.scout !== null) {
      // ONE CLOCK READ, and it is the only one this layer takes.
      //
      // It matters more than it looks. The replay gate drives a `StepClock`
      // whose every read costs a tick, so a second read would be a second
      // perturbation of the very quantity the gate measures. What moves under
      // `observe` is then exactly the clock-derived report fields
      // (`stepCostMs`, `postureFlips[].at`) and nothing an emission carries —
      // which is the honest shape of the claim: the scout spends budget, and
      // spending budget is a value trade, not a soundness one.
      const decisionMs = ctx.budget.remainingMs();
      s.scout.beginDecision(decisionMs);
      s.scout.run({
        sub: s.sub,
        asTeam: ctx.asTeam,
        gen: ctx.gen,
        partition,
        sets: s.sets,
        seeds: plans,
        // THE SESSION IS ALREADY KEYED BY BASIS (`sessionKey` is
        // `JSON.stringify(basisOf(ctx))`), so an epoch change or a posture flip
        // gives a NEW session and therefore a new scout: at this tranche the
        // ledger's epoch invalidation is free and structural. `ThreadLedger`
        // carries the explicit `onEpochChange`/`onPostureFlip` methods anyway,
        // because CL6b moves the ledger to kernel ownership where it outlives
        // the session and the invalidation has to be called by hand.
        epoch: 0,
        posture: postureOf(ctx),
        decisionMs,
        kingUnits: kingUnitsOf(s),
      });
      const unary = s.scout.unaryAdvice();
      if (unary !== undefined) {
        ({ plans, stats, score } = enumerateProposals({ ...request, unary }));
      }
    }
    // DOOR C'S SCOPE — the units this decision has already paid an exact joint
    // solve for, and the only ones the territory refiner may spend on.
    //
    // Registered only when EVERY cluster stayed in the exact regime. A decision
    // that fell to the fallback ladder has conceded the exact claim, and the
    // budget rule this stage was given is "run only where the enumeration
    // already paid" — a thresholded or ICM'd cluster did not pay that price, so
    // it buys the refiner nothing to spend. Members, not `variables`: a slider
    // is an outer coordinate shared by every cluster, not a solved component.
    if (territoryRefining() && stats.rungThreshold === 0 && stats.rungIcm === 0) {
      const members = new Set<UnitId>();
      for (const cluster of partition.clusters) for (const id of cluster.members) members.add(id);
      setRefineScope(s.sub, { members });
    }
    return {
      partition,
      proposals: offerOrder(s, plans, score),
      score,
      stats,
      dirty: new SweepDirty(partition, s.ours.filter((id) => !s.pinned.has(id))),
      tuning,
      cursor: 0,
      skippedNear: 0,
      skippedFlat: 0,
      offeredThisSlice: 0,
      enumMs: Date.now() - started,
    };
  };

  /** The posture off the context's own basis. A floor proved under one
   *  posture's channel weighting is not the same statement as one proved under
   *  another's, so a thread records which it ran under. */
  const postureOf = (ctx: SearchContext): Posture => {
    for (const a of ctx.assumptions) if (a.kind === "posture") return a.posture;
    return "SIGHTED";
  };

  /** Ours that are kings — the scout's priority floor (F-12). A cluster that
   *  contains one is never STARVED; it is not exempt from the barrier. */
  const kingUnitsOf = (s: Session): ReadonlySet<UnitId> => {
    const out = new Set<UnitId>();
    if (!(s.sub instanceof EngineSubstrate)) return out;
    for (const unitId of s.ours) if (s.sub.unitOf(unitId)?.isKing === true) out.add(unitId);
    return out;
  };

  /**
   * WHICH COMPOSED JOINTS GET PRICED, WHEN MORE EXIST THAN BUDGET.
   *
   * Permuted ONCE, at enumeration time, and never again — which is what makes
   * §3.0 note 3 true by construction rather than by discipline: *"the dispatch
   * sequence is decided by the seeded sampler on the coordinator BEFORE any
   * worker runs, and is a pure function of (seed, board, epoch, slice), never
   * of worker timing."* The cursor still walks the list monotonically, the tail
   * still survives into the next slice, and `speculate` still ships
   * `proposals.slice(cursor)` — so the workers price the plans the coordinator
   * sampled, in the order it sampled them, and nothing about the fold changes.
   *
   * The weights are CL3's k-best rank plus the SURROGATE LEVEL — `Ṽ(p) − Ṽ` of
   * the enumeration's own MAP. Rank and level agree on the ORDER (the k-best
   * list is sorted by Ṽ), so the level's whole contribution is the thing rank
   * throws away: the SIZE of the gaps. Five near-tied joints get spread across;
   * a MAP that dominates by a lattice step stays first with ~98% probability at
   * the opening temperature. That is R-B1's finding applied where it is true —
   * *the frame apparatus supplies level, not order* — rather than assumed away.
   */
  const offerOrder = (
    s: Session,
    plans: ReadonlyArray<JointPlan>,
    score: ((plan: JointPlan) => number) | null,
  ): ReadonlyArray<JointPlan> => {
    const sampler = s.sampler;
    if (sampler === null || !sampler.tuning.channels.proposals || plans.length <= 1) return plans;
    const map = plans[0] as JointPlan;
    const base = score === null ? null : score(map);
    const gains = plans.map((p) =>
      score === null || base === null ? null : score(p) - base,
    );
    const { weights, regime } = proposalWeights(
      gains,
      sampler.tuning.lambdaRank,
      sampler.tuning.wSurrogate,
    );
    sampler.noteRegime(regime);
    return sampler.permute(plans, NODE_PROPOSALS, weights);
  };

  /**
   * Is the cluster seed on for THIS core? Resolved once per call rather than
   * cached, so a test that flips the environment between decisions sees the
   * flip — and never consulted at all when the caller named its own answer.
   */
  const clusterSeeding = (): boolean => cfg.clusterSeed ?? clusterSeedEnabled();

  /** Is the multi-start seed on for THIS core? Same discipline, same reason. */
  const multistarting = (): boolean => cfg.multistartSeed ?? multistartSeedEnabled();

  /** Is the cluster enumeration on for THIS core? Same discipline, same reason. */
  const clusterEnumerating = (): boolean => cfg.clusterEnum ?? clusterEnumEnabled();

  /** Is Door C's territory refiner on for THIS core? Same discipline again. */
  const territoryRefining = (): boolean => cfg.territoryRefine ?? territoryRefineEnabled();

  /** Is the seeded lottery on for THIS core? Same discipline, same reason. */
  const sampling = (): boolean => cfg.sampledCap ?? sampledCapEnabled();

  /** Which position the scout is in for THIS core. Same discipline again. */
  const scouting = (): ScoutMode => cfg.scout ?? scoutMode();

  // -------------------------------------------------------------- parallel
  //
  // Three functions, none of which the single-threaded path executes: with
  // `cfg.parallel === null` the first returns null and the other two return
  // immediately on a null session handle.

  /**
   * Tell the pool about this basis, and get back the id its parcels ride on.
   *
   * The CATALOGUE DIGEST goes with it. A worker builds its own candidate lists
   * and compares; a mismatch means the two sides would decode the same index to
   * different moves, every entry the worker returns would be under a planKey
   * this thread never asks for, and the honest thing is to stop dispatching
   * rather than to keep paying for inert answers. It is a performance guard,
   * not a soundness one — see `parallel/protocol.ts`.
   */
  const openParallelSession = (
    ctx: SearchContext,
    ours: ReadonlyArray<UnitId>,
    sets: ReadonlyMap<UnitId, CandidateSet>,
  ): Session["parallel"] => {
    const par = cfg.parallel;
    if (par === null || !par.pool.live || ours.length === 0) return null;
    const sessionId = par.pool.nextSessionId();
    par.pool.openSession({
      sessionId,
      boardEpoch: par.boardEpoch,
      asTeam: ctx.asTeam,
      knobs: par.knobs,
      evaluator: par.evaluator,
      basis: basisOf(ctx),
      bankConfig: { ...cfg.bank, memoCapacity: memoShare, evalMemoCapacity: evalMemoShare },
      roster: [...ours],
      catalogueDigest: catalogueDigest(ours, sets),
    });
    return { sessionId, seq: 0 };
  };

  /**
   * Take whatever the workers have finished, as CACHED EVALUATIONS.
   *
   * Called once at the top of a call and never inside one, because that is the
   * only place a result can be: a slice is synchronous JavaScript and no
   * message is delivered while one runs. So "fold what arrived in time,
   * otherwise carry it to the next slice" is not a policy this code implements
   * — it is what the event loop does, and the memo is what makes it safe.
   */
  const foldParallel = (s: Session): void => {
    const par = cfg.parallel;
    if (par === null || s.parallel === null) return;
    const entries = par.pool.drain(s.parallel.sessionId);
    if (entries.length > 0) s.bank.importEvaluations(entries);
  };

  /**
   * Fire one parcel per free worker over the frontier of the NEXT slice.
   *
   * WHY THIS RUNS AT THE END OF A SLICE AND NOT AT THE START — measured, and it
   * is the difference between the workers earning their keep and not. A slice
   * is synchronous JavaScript, so a parcel fired at the START of one is racing
   * the very sweep that is about to price the same plans, and it loses every
   * time: the coordinator gets through the whole frontier before any message
   * can be delivered, and the answers arrive for work already done. Measured on
   * the bench board at a one-second budget: 423 entries imported, ZERO ever
   * read.
   *
   * Fired at the END, from the incumbent the slice actually settled on, the
   * parcel names the plans slice N+1 will try FIRST — `sweep` starts from this
   * plan, and the plans one move away from it are exactly what it perturbs.
   * Those have not been priced (the sweep priced variations of the intermediate
   * plans it passed through, not of the one it stopped on), and the workers have
   * a whole slice boundary of head start.
   *
   * AFFORDABILITY IS THE MAIN THREAD'S CALL, made here and nowhere else. There
   * is no wait, no join and no synchronisation point: a parcel that comes back
   * late lands in a later slice's memo, or in none, and either way it is a
   * cached evaluation and cannot change an answer. What this costs the
   * coordinator is one frontier encode — arithmetic over the roster, no
   * pricing — which is why it can run after the slice clock has expired.
   */
  const speculate = (s: Session, incumbent: BankResult, sliceMs: number): void => {
    const par = cfg.parallel;
    if (par === null || s.parallel === null || !par.pool.live) return;
    const slots = par.pool.freeSlots;
    if (slots <= 0) return;
    const frontier: Frontier = {
      roster: s.ours,
      sets: s.sets,
      pinned: s.pinned,
      incumbent,
      candidateCap: cfg.candidateCap,
      // THE DISPATCH SEQUENCE IS THE SAMPLED SEQUENCE (contract rule 20, §3.0
      // note 3). Peeked, not drawn: the next slice's sweep will take the real
      // draw at the same node and the same index and get the identical
      // permutation, so what the workers price is exactly what the coordinator
      // is about to ask for. Absent when the lottery is off, and then the
      // partition re-derives the frontier as it always did.
      ...(s.sampler === null ? {} : { order: nextSweepOrder(s, incumbent) }),
      // THE TAIL THE COORDINATOR HAS NOT REACHED. Proposals already priced are
      // dropped here and not in the partition, because the cursor is session
      // state and a partition is a pure function of a frontier.
      ...(s.cluster === null ? {} : { proposals: s.cluster.proposals.slice(s.cluster.cursor) }),
    };
    const shipped = planBatchPartition(par.headroom, par.maxPlansPerParcel);
    const partition =
      par.partition ??
      (s.cluster === null
        ? shipped
        : clusterPlanPartition(
            par.headroom,
            par.maxPlansPerParcel,
            shipped,
            s.cluster.tuning.minHamming,
          ));
    const budgetMs = Math.min(
      par.parcelBudgetMs,
      Math.max(1, sliceMs) * Math.max(1, par.parcelSlices),
    );
    // THE WITNESS SET GOES DOWN WITH THE PARCEL, and it is what makes the
    // parcel worth sending. A witness admitted this slice makes a fresh B2
    // branch of every plan priced after it, and on the measured boards that is
    // where nearly all the remaining fresh evaluator work lives. A worker
    // without them prices a different B2 set and answers a question nobody
    // asked. Nothing comes back the other way — see `WitnessWire`.
    const witnesses = s.bank.witnesses.map((w) => ({
      note: w.note,
      replies: [...w.replies.values()],
    }));
    const chunks = partition.partition(frontier, slots);
    for (const chunk of chunks) {
      if (chunk.count === 0) continue;
      const seq = s.parallel.seq++;
      const sent = par.pool.dispatch({
        kind: "plan-batch",
        sessionId: s.parallel.sessionId,
        boardEpoch: par.boardEpoch,
        seq,
        budgetMs,
        count: chunk.count,
        codes: chunk.codes,
        witnesses,
      });
      if (!sent) break;
    }
  };

  /**
   * The pinned candidate: the operator named a DESTINATION, and the search has
   * to find the move that reaches it. Prefer the generator's own first match,
   * because its ordering already encodes which path is the sane one when a
   * kind can reach a cell more than one way.
   */
  const matchPin = (set: CandidateSet, to: number): Candidate | null => {
    for (const c of set.candidates) if (c.to === to) return c;
    for (const entry of set.prunedLedger) if (entry.candidate.to === to) return entry.candidate;
    return null;
  };

  /**
   * THE SEED — one candidate per unit, pins first, the incumbent's choice where
   * it still stands, and otherwise the generator's ordered-first option.
   *
   * WHY IT DE-CONFLICTS (and why that is not a search). The candidate layer is
   * PER UNIT: it cannot see a team-mate, so two of our units whose best options
   * name the same cell both get it, and the seed walks them into each other. In
   * the queen cell that showed up as 20 `contest` deaths on an empty cell and 9
   * same-team edge swaps per twelve games — the exact residue left after the
   * rules-certain classes were refused.
   *
   * So the seed reserves what it has already spent: a unit takes its first
   * option whose PATH claims no cell an earlier unit's path already claims, and
   * falls back to its ordered-first option when every option collides. It costs
   * one pass and NO resolution — this is still the O(1)-price rung 0 — and it
   * cannot change what is legal, only which complete legal plan the search
   * starts from. Pins are seeded first and their cells are reserved before any
   * free unit picks, so an operator's cell is never the one taken away.
   */
  const seedPlan = (
    s: Session,
    from: JointPlan | null,
    budget: SearchContext["budget"] | null,
  ): JointPlan => {
    // THE MULTI-START COMES FIRST, and where it runs the greedy pairwise seed
    // does not: two seeds cannot both be the plan the ascent starts from, and
    // the multi-start is the owner's replacement for the greedy one rather than
    // a layer on top of it.
    const sampled = multiStart(s, from, budget);
    if (sampled !== null) return sampled;
    const clustered = clusterSeed(s, from);
    if (clustered !== null) return clustered;
    const plan = new Map<UnitId, Candidate>();
    // `auto` is board-conditional and this core may have been built without a
    // board, so an unresolved level resolves OFF here. `TeamDecisionEngine`
    // resolves the level against the board and passes `cfg.seedDeconflict`
    // explicitly, so the shipped path does not reach this fallback.
    const deconflict =
      cfg.seedDeconflict ?? resolveStagingSafety(stagingSafety(), false) !== "off";
    const taken = new Set<number>();
    const claim = (c: Candidate): void => {
      taken.add(c.to);
      for (const cell of c.path) taken.add(cell);
    };
    const clear = (c: Candidate): boolean => {
      if (taken.has(c.to)) return false;
      for (const cell of c.path) if (taken.has(cell)) return false;
      return true;
    };

    // Pins first, and their cells reserved, so a constraint is never the thing
    // a free unit's de-confliction takes away.
    for (const unitId of s.ours) {
      const pinned = s.pins.get(unitId);
      if (pinned === undefined) continue;
      plan.set(unitId, pinned);
      claim(pinned);
    }
    for (const unitId of s.ours) {
      if (plan.has(unitId)) continue;
      const existing = from?.get(unitId);
      const set = s.sets.get(unitId) as CandidateSet;
      if (existing !== undefined && isStillOffered(set, existing)) {
        plan.set(unitId, existing);
        claim(existing);
        continue;
      }
      const first = set.candidates[0] ?? set.prunedLedger[0]?.candidate;
      if (first === undefined) {
        throw new Error(
          `no candidate at all for unit ${unitId}: a hard filter emptied the option set, ` +
            "which the completeness invariant forbids",
        );
      }
      let pick = first;
      if (deconflict && taken.size > 0) {
        for (const candidate of set.candidates) {
          if (clear(candidate)) {
            pick = candidate;
            break;
          }
        }
      }
      plan.set(unitId, pick);
      claim(pick);
    }
    // The declared reference actions ride every plan (see Session.references).
    for (const [unitId, candidate] of s.references) plan.set(unitId, candidate);
    return plan;
  };

  /**
   * THE CLUSTER SEED, or `null` for the shipped path.
   *
   * The same three things go in as the de-confliction seed's: pins first, then
   * whatever of the incumbent still stands, then the declared reference
   * actions. What changes is how the REMAINING units choose — an argmax over
   * the generator's own ordering plus the pair potentials, instead of the
   * first option that touches no reserved cell.
   *
   * On a later slice the incumbent has already fixed every free unit, so the
   * greedy pass has nothing to place and the two paths agree by construction.
   * The seed is load-bearing at rung 0, which is where it runs from a null
   * incumbent, and that is the case this branch exists for.
   *
   * Returns `null` — never throws, never silently degrades — when the seed
   * cannot run: the flag is off, or the substrate is not the engine's, which
   * happens in the bounds harness and under the memo proxies. The shipped seed
   * is then exactly what it was.
   */
  const clusterSeed = (s: Session, from: JointPlan | null): JointPlan | null => {
    const workspace = s.seedWorkspace;
    if (workspace === null || !(s.sub instanceof EngineSubstrate)) return null;
    const fixed = new Map<UnitId, Candidate>();
    for (const [unitId, candidate] of s.pins) fixed.set(unitId, candidate);
    for (const unitId of s.ours) {
      if (fixed.has(unitId)) continue;
      const existing = from?.get(unitId);
      const set = s.sets.get(unitId);
      if (existing === undefined || set === undefined) continue;
      if (isStillOffered(set, existing)) fixed.set(unitId, existing);
    }
    // E4's input, straight off the classifier: a unit that dies in every world
    // is one no potential may contort a healthy unit into rescuing. Absent
    // when the fatality knob is off, and then the clause is simply inert.
    const doomed = new Set<UnitId>();
    for (const [unitId, set] of s.sets) if (set.marks?.sealed === true) doomed.add(unitId);
    const plan = greedySeed({
      sub: s.sub,
      workspace,
      roster: s.ours,
      // Danger order, with the pinned units out of it — they are constraints,
      // and they are already in `fixed` with their cells claimed before any
      // free unit picks.
      order: dangerOrder(s.ours, null, s.pinned),
      sets: s.sets,
      fixed,
      doomed,
      cap: cfg.candidateCap,
      salt: cfg.seed,
    });
    const out = new Map<UnitId, Candidate>(plan);
    // The declared reference actions ride every plan (see Session.references).
    for (const [unitId, candidate] of s.references) out.set(unitId, candidate);
    return out;
  };

  /**
   * THE MULTI-START SEED, or `null` for whichever seed would otherwise run.
   *
   * The same three things go in as every other seed's: pins first, then
   * whatever of the incumbent still stands, then the declared reference
   * actions. What changes is how the REMAINING units choose — a uniform draw
   * over their fatality-safe options (stage 0), then sampled joint combos per
   * cluster with a short coordinate ascent from each and a softmax over what
   * was found (stage 1).
   *
   * On a later slice the incumbent has already fixed every free unit, so there
   * is nothing left to vary, no sample is drawn and no budget is spent. The
   * seed is load-bearing at rung 0, which is where it runs from a null
   * incumbent, and that is the case this branch exists for.
   *
   * THE BUDGET SLICE. The sampler takes `budgetFraction` of what the handle
   * says is left and no more, so it can never starve the ascent it is seeding;
   * with no handle at all (the `conform` fast path's `null`) it takes stage 0
   * and stops, which is the negligible-compute baseline doing exactly its job.
   */
  const multiStart = (
    s: Session,
    from: JointPlan | null,
    budget: SearchContext["budget"] | null,
  ): JointPlan | null => {
    const state = s.multistart;
    if (state === null || !(s.sub instanceof EngineSubstrate)) return null;
    const fixed = new Map<UnitId, Candidate>();
    for (const [unitId, candidate] of s.pins) fixed.set(unitId, candidate);
    for (const unitId of s.ours) {
      if (fixed.has(unitId)) continue;
      const existing = from?.get(unitId);
      const set = s.sets.get(unitId);
      if (existing === undefined || set === undefined) continue;
      if (isStillOffered(set, existing)) fixed.set(unitId, existing);
    }
    // The clusters, as a partition of the VARIABLES: each component, then one
    // group holding the sliders. See `MultiStartRequest.clusters` for why the
    // sliders are one group here rather than a member of every one.
    const clusters: Array<ReadonlyArray<UnitId>> = state.partition.clusters.map((c) => c.members);
    if (state.partition.sliders.length > 0) clusters.push(state.partition.sliders);
    const result = multiStartSeed({
      sub: s.sub,
      roster: s.ours,
      order: dangerOrder(s.ours, null, s.pinned),
      sets: s.sets,
      fixed,
      clusters,
      tuning: state.tuning,
      seed: state.seed,
      cap: cfg.candidateCap,
      budgetMs:
        budget === null
          ? 0
          : Math.min(
              budget.remainingMs() * state.tuning.budgetFraction,
              state.tuning.maxBudgetMs,
            ),
      remainingFraction: budget?.decisionFraction?.() ?? 1,
      now: () => (budget === null ? 0 : budget.now()),
      // THE PRIORS, in weight units, straight off the rung-1/2 edge-EV pass
      // where it ran. Absent — the pass is off, or the generator did not price
      // this set — every option weighs the same and the selection is uniform
      // over the safety terms alone, which is the honest reading when nothing
      // cheap has an opinion.
      priorOf: (unitId, optionIndex) => s.sets.get(unitId)?.edgeEv?.[optionIndex] ?? 0,
    });
    lastMultiStart = result.report;
    const out = new Map<UnitId, Candidate>(result.plan);
    // The declared reference actions ride every plan (see Session.references).
    for (const [unitId, candidate] of s.references) out.set(unitId, candidate);
    return out;
  };

  const isStillOffered = (set: CandidateSet, candidate: Candidate): boolean => {
    for (const c of set.candidates) if (c.to === candidate.to && samePath(c, candidate)) return true;
    for (const e of set.prunedLedger) {
      if (e.candidate.to === candidate.to && samePath(e.candidate, candidate)) return true;
    }
    return false;
  };

  const samePath = (a: Candidate, b: Candidate): boolean =>
    a.path.length === b.path.length && a.path.every((cell, i) => cell === b.path[i]);

  // ------------------------------------------------------------- acceptance

  /**
   * Strict improvement on (floor, est, ceiling, salted tie key).
   *
   * A BASIS MISMATCH IS A REFUSAL. Two plans priced under different assumption
   * sets are not two answers to the same question, and taking the larger
   * number is exactly the laundering the whole bounds layer exists to prevent.
   * The incumbent keeps its place.
   */
  const better = (trial: BankResult, incumbent: BankResult): boolean => {
    // The witness veto, stated explicitly even though the floor comparison
    // already implies it: a plan some banked reply holds below the incumbent's
    // PROVED floor cannot be an improvement, however good its own floor looks.
    if (refutedAt(trial.bounds.best, incumbent.bounds.worst)) {
      adjudication.vetoed++;
      return false;
    }
    const cmp = compareFloors(trial.bounds, incumbent.bounds);
    if (!cmp.comparable) {
      adjudication.refused++;
      return false;
    }
    if (cmp.order !== 0) {
      adjudication.floorDecided++;
      return cmp.order > 0;
    }
    if (trial.est !== incumbent.est) {
      adjudication.estDecided++;
      return trial.est > incumbent.est;
    }
    if (trial.bounds.best !== incumbent.bounds.best) {
      // THE O-P1 SLOT. The one place in this comparator where an unproved
      // CEILING decides — the "optimism under ignorance" the round-fusion
      // programme's Stage 3a replaces with the T0/T1/T2 tier ladder (hi may
      // eliminate and schedule at any tier and promote only at T2, on the
      // record). That ladder is NOT on this branch and CL4 does not build it:
      // one comparator, one implementation, and whichever programme lands it
      // owns the code. What CL4 owes is that the LOTTERY did not make this slot
      // busier — a sampler that fed the comparator more ceiling-decided ties
      // would be quietly widening exactly the hole O-P1 is about to close. The
      // counter is the instrument (L17's "hi read count"), and the probe
      // compares it flag-off against flag-on.
      adjudication.ceilingDecided++;
      return trial.bounds.best > incumbent.bounds.best;
    }
    adjudication.tieKeyDecided++;
    return planTieKey(trial.plan, cfg.seed) > planTieKey(incumbent.plan, cfg.seed);
  };

  // -------------------------------------------------------------- selection
  //
  // Two functions, and with the flag off each returns exactly what the shipped
  // search returned: `dangerOrder(...)` and `topCandidates(set, cap)`. That is
  // the whole of the CL4 seam in the search — everything else it does is inside
  // `lobster/selection/**`.

  /**
   * THE ORDER UNITS ARE SWEPT IN — the exploration-order half of the ruling.
   *
   * `dangerOrder` is still what ranks them (dead in the floor-justifying world
   * first, then anything the resolver named, then unit id); the lottery
   * RE-ORDERS that ranking, weighted by it plus the material level, and returns
   * a permutation of the same list. No unit is added, dropped or skipped —
   * which is the difference between choosing where to spend attention and
   * choosing what to stage.
   */
  const sweepOrder = (
    s: Session,
    resolution: BankResult["worstResolution"] | null,
  ): ReadonlyArray<UnitId> => {
    const ranked = dangerOrder(s.ours, resolution, s.pinned);
    const sampler = s.sampler;
    if (sampler === null || !sampler.tuning.channels.units || ranked.length <= 1) return ranked;
    const ceilings = s.ceilings;
    const { weights, regime } = unitWeights(
      ranked.map((id) => ceilings?.get(id) ?? 0),
      sampler.tuning.lambdaRank,
      sampler.tuning.wMaterial,
    );
    sampler.noteRegime(regime);
    return sampler.permute(ranked, NODE_SWEEP_UNITS, weights);
  };

  /**
   * THE CAP, AS A SAMPLE — CL2's finding made mechanical.
   *
   * CL2 §7.1: *"i2's own diagnosis names the real instrument: 'the search only
   * ever walks the eight shortest moves per sweep', and the fix that does not
   * raise the cap is 'make the 8 a SAMPLE from softmax(EV/τ) rather than a
   * prefix'. That is CL4, not CL2."* This is that line.
   *
   * With the flag off it is `topCandidates(set.candidates, cap)`, unchanged and
   * uncalled-into. With it on, the whole option list is permuted by
   * Gumbel-top-k over the rank prior and the SAME prefix is taken — so the
   * search prices the same NUMBER of options and a different SET of them. An
   * option at rank 12 of a slider's 30 can now enter a top-8 draw, which is the
   * only door through which i2's far options were ever going to arrive.
   *
   * The width may narrow under the progressive-widening schedule and may never
   * exceed the caller's cap (`widen.ts` says why).
   */
  const optionsOf = (
    s: Session,
    unitId: UnitId,
    candidates: ReadonlyArray<Candidate>,
    channel: number,
    cap: number,
  ): ReadonlyArray<Candidate> => {
    const sampler = s.sampler;
    if (sampler === null || !sampler.tuning.channels.candidates) {
      return topCandidates(candidates, cap);
    }
    const node = mix(channel, unitId | 0);
    const width = widenTo(sampler.tuning.widen, sampler.visitsOf(node), cap);
    // EXACT WHERE COMPLETE, SAMPLED WHERE TRUNCATED — §1b.4's own law, and the
    // probe is what made it load-bearing rather than decorative.
    //
    // When the cap does not bind, the search will try EVERY option this unit
    // has, so there is no membership question and no blind spot: the set the
    // lottery would choose and the set the prefix chooses are the same set. All
    // a draw can do there is reorder a list that gets exhausted anyway — free
    // when the budget arrives, and a straight loss when it does not, because a
    // clock-truncated sweep then tries a worse option first. Measured on the
    // trail-unit families, where no unit has more than four options and the cap
    // is eight: sampling every unit's order cost 17→22 fatal stagings at q=8
    // and bought exactly zero far options, because there were none to buy.
    //
    // So the draw happens where truncation happens, and nowhere else.
    if (candidates.length <= width) return topCandidates(candidates, width);
    const permuted = sampler.permute(
      candidates,
      node,
      candidateWeights(candidates.length, sampler.tuning.lambdaRank),
    );
    sampler.noteAdmitted(width);
    return topCandidates(permuted, width);
  };

  /**
   * WHAT THE NEXT SLICE WILL SWEEP, computed at the end of this one.
   *
   * Every draw here is a PEEK — the node's current visit counter is the index
   * the next slice's real draw will use, so this reproduces that permutation
   * without consuming it. Nothing about the search's own sequence changes; the
   * only consumer is the worker cut.
   */
  const nextSweepOrder = (s: Session, incumbent: BankResult): SampledOrder => {
    const sampler = s.sampler as SelectionSampler;
    const ranked = dangerOrder(s.ours, incumbent.worstResolution, s.pinned);
    const ceilings = s.ceilings;
    const { weights } = unitWeights(
      ranked.map((id) => ceilings?.get(id) ?? 0),
      sampler.tuning.lambdaRank,
      sampler.tuning.wMaterial,
    );
    const units = sampler.tuning.channels.units
      ? sampler.peek(ranked, NODE_SWEEP_UNITS, weights)
      : ranked;
    return {
      units,
      candidatesFor: (unitId: UnitId): ReadonlyArray<Candidate> => {
        const set = s.sets.get(unitId);
        if (set === undefined) return [];
        const node = mix(NODE_SWEEP_CANDIDATES, unitId | 0);
        const width = widenTo(sampler.tuning.widen, sampler.visitsOf(node), cfg.candidateCap);
        // The same two gates the sweep itself applies, or the workers would
        // price a different set from the one the coordinator is about to ask
        // for — which is `entriesUsed = 0` by construction.
        if (!sampler.tuning.channels.candidates || set.candidates.length <= width) {
          return topCandidates(set.candidates, width);
        }
        const permuted = sampler.peek(
          set.candidates,
          node,
          candidateWeights(set.candidates.length, sampler.tuning.lambdaRank),
        );
        return topCandidates(permuted, width);
      },
    };
  };

  // ------------------------------------------------------------------ moves

  const sweep = (s: Session, budget: SearchContext["budget"], start: BankResult): BankResult => {
    let best = start;
    const dirty = s.cluster?.dirty ?? null;
    for (const unitId of sweepOrder(s, best.worstResolution)) {
      if (budget.shouldStop()) break;
      // THE DIRTY-SET SKIP. A unit whose whole alternative list was priced and
      // refused, against a neighbourhood that has not moved since and a witness
      // set that has not grown, has no answer left to give. See
      // `./sweep-dirty.ts` for what makes the two invalidations sufficient.
      if (dirty !== null && !dirty.isDirty(unitId, best.plan)) {
        dirty.countSkipped();
        continue;
      }
      const set = s.sets.get(unitId) as CandidateSet;
      const current = best.plan.get(unitId) as Candidate;
      let complete = true;
      for (const candidate of optionsOf(
        s,
        unitId,
        set.candidates,
        NODE_SWEEP_CANDIDATES,
        cfg.candidateCap,
      )) {
        if (budget.shouldStop()) {
          complete = false;
          break;
        }
        if (candidate.to === current.to && samePath(candidate, current)) continue;
        const trial = s.bank.price(withMove(best.plan, candidate));
        if (better(trial, best)) best = trial;
      }
      if (dirty !== null) {
        dirty.countSwept();
        // ONLY a loop that ran to completion is marked. A truncated pass did
        // not price the unit's alternatives, and recording an answer nobody
        // computed is how a cache becomes a bug.
        //
        // CL4: AND ONLY WHEN THE LOTTERY IS OFF. The dirty set's claim is *"a
        // unit whose WHOLE alternative list was priced and refused, against a
        // neighbourhood that has not moved, has no answer left to give"* — and
        // with the sampler on, a completed pass priced a SAMPLED SUBSET of that
        // list, so the next round would draw a different subset and the claim
        // is simply false. Never marking is the conservative direction (the
        // unit is swept again, which costs prices and cannot cost soundness);
        // the alternative — marking on a subset — is a cache that answers a
        // question nobody asked, which is the bug class this comment's first
        // paragraph already exists to prevent.
        if (complete && s.sampler === null) dirty.markClean(unitId, best.plan);
      }
    }
    return best;
  };

  /**
   * OFFER THE COMPOSED CLUSTER JOINTS — priced, adjudicated, and nothing else.
   *
   * Every proposal goes through `s.bank.price()` and is accepted only by
   * `better()` on the proved floor. That is the soundness lens's law and it is
   * the whole reason a surrogate this cheap is allowed to exist: cluster
   * results are PROPOSALS, staging is always adjudicated by the unconditional
   * price, and nothing is removed from any set.
   *
   * The cursor advances across slices. The proposals are a per-session
   * quantity, so a slice that prices three of eight leaves five for the next
   * slice — and the five it leaves are exactly what went down to the workers,
   * which is what makes a worker's answer something the coordinator will
   * actually read.
   *
   * ── THE ONE-MOVE FILTER, AND WHY IT IS NOT AN OPTIMISATION ────────────────
   *
   * A proposal within ONE unit of the incumbent is a plan the sweep is about to
   * try anyway, at the same price, in the same slice. Offering it back is
   * offering the coordinator work it has already scheduled — and paying for it
   * FIRST, out of the same budget the sweep needs. Measured: without this
   * filter, scattered boards (where 82.7% of components are singletons, so the
   * composed joint IS the per-unit argmax) spent their whole 32-question budget
   * on 77 proposals and finished a mean 0.769 BELOW the arm without them. The
   * filter is W1's own condition for a speculation to be worth anything,
   * applied to the coordinator's own budget: *"whatever a cluster partition
   * speculates on has to be work the coordinator has not already done."*
   *
   * The threshold is `minHamming`, the same knob and the same meaning as the
   * per-cluster diversity floor.
   */
  const offerClusterJoints = (
    s: Session,
    budget: SearchContext["budget"],
    start: BankResult,
    limit: number,
  ): BankResult => {
    const cluster = s.cluster;
    if (cluster === null || limit <= 0) return start;
    const perSlice = cfg.clusterOffersPerSlice;
    if (perSlice > 0 && cluster.offeredThisSlice >= perSlice) return start;
    const floor = Math.max(1, cluster.tuning.minHamming);
    let best = start;
    let paid = 0;
    while (cluster.cursor < cluster.proposals.length && paid < limit) {
      if (perSlice > 0 && cluster.offeredThisSlice >= perSlice) break;
      if (budget.shouldStop()) break;
      const plan = cluster.proposals[cluster.cursor++] as JointPlan;
      if (planDistance(plan, best.plan, floor) < floor) {
        cluster.skippedNear++;
        continue;
      }
      // THE SURROGATE GATE. A proposal that does not beat the plan the search
      // is holding, on the µs surrogate, has no claim worth an 18 ms price.
      // Computed against the CURRENT incumbent, so a proposal refused this
      // round is not refused for ever — the sweep moves the incumbent and the
      // comparison is made again.
      if (cluster.tuning.requireSurrogateGain && cluster.score !== null) {
        if (!(cluster.score(plan) > cluster.score(best.plan))) {
          cluster.skippedFlat++;
          continue;
        }
      }
      paid++;
      cluster.offeredThisSlice++;
      const trial = s.bank.price(plan);
      if (better(trial, best)) best = trial;
    }
    return best;
  };

  /** How many units two plans disagree on, stopping once `enough` is reached. */
  const planDistance = (a: JointPlan, b: JointPlan, enough: number): number => {
    let n = 0;
    for (const [unitId, candidate] of a) {
      const other = b.get(unitId);
      if (other === candidate) continue;
      if (other !== undefined && other.to === candidate.to && samePath(other, candidate)) continue;
      if (++n >= enough) return n;
    }
    return n;
  };

  /**
   * PAIR REPAIR — 2-opt over exactly the pairs the resolution names as
   * self-inflicted casualties. Coordinate ascent is structurally stuck on
   * these: moving either unit alone is no improvement while moving both is.
   * Only the named pairs are exhausted, so the cost is bounded by the number
   * of accidents rather than by the roster.
   */
  const pairRepair = (
    s: Session,
    budget: SearchContext["budget"],
    start: BankResult,
  ): BankResult => {
    let best = start;
    const pairs = selfInflictedPairs(best.worstResolution, s.ourSet, best.plan);
    for (const [a, b] of pairs) {
      if (budget.shouldStop()) break;
      if (s.pinned.has(a) && s.pinned.has(b)) continue;
      const optionsA = s.pinned.has(a)
        ? [best.plan.get(a) as Candidate]
        : optionsOf(
            s,
            a,
            (s.sets.get(a) as CandidateSet).candidates,
            NODE_PAIR_REPAIR,
            cfg.pairRepairPerUnit,
          );
      const optionsB = s.pinned.has(b)
        ? [best.plan.get(b) as Candidate]
        : optionsOf(
            s,
            b,
            (s.sets.get(b) as CandidateSet).candidates,
            NODE_PAIR_REPAIR,
            cfg.pairRepairPerUnit,
          );
      for (const ca of optionsA) {
        if (budget.shouldStop()) break;
        for (const cb of optionsB) {
          if (budget.shouldStop()) break;
          const trial = s.bank.price(withMoves(best.plan, [ca, cb]));
          if (better(trial, best)) best = trial;
        }
      }
    }
    return best;
  };

  /**
   * JOINT POLISH — the cross-product of the top-2 candidates of the ≤3 most
   * contested units. The one thing a unit-at-a-time ascent structurally cannot
   * do: escape a local optimum that needs two units to move together for a
   * reason the resolver did not report as an accident.
   */
  const jointPolish = (
    s: Session,
    budget: SearchContext["budget"],
    start: BankResult,
  ): BankResult => {
    let best = start;
    const units = polishUnits(s, best);
    if (units.length === 0) return best;
    const lists = units.map((id) =>
      optionsOf(s, id, (s.sets.get(id) as CandidateSet).candidates, NODE_POLISH, cfg.polishPerUnit),
    );
    const walk = (i: number, acc: Candidate[]): void => {
      if (budget.shouldStop()) return;
      const list = lists[i];
      if (list === undefined) {
        const trial = s.bank.price(withMoves(best.plan, acc));
        if (better(trial, best)) best = trial;
        return;
      }
      for (const candidate of list) {
        walk(i + 1, [...acc, candidate]);
        if (budget.shouldStop()) return;
      }
    };
    walk(0, []);
    return best;
  };

  /**
   * WHICH UNITS THE POLISH MOVES TOGETHER — the accident report, and under the
   * multi-start the room/dispersion gate beside it.
   *
   * `contestedUnits` is the shipped gate and is unchanged: it weights units off
   * `resolution.clashes` and `resolution.ledger`, i.e. it fires when the
   * resolver says something went wrong. That is exactly the right gate for a
   * plan with accidents in it, and it is empty on a plan with none — which is
   * how the rejected seed disarmed the only multi-unit escape the search owns
   * while the team walked into a corner with nothing going wrong for thirty
   * turns.
   *
   * So when the multi-start is on, the polish ALSO takes the units a
   * room/dispersion signal names (`crowdedUnits`) — geometry, off the staged
   * plan, needing no resolution. Union, never replacement: an accident is still
   * a reason, this adds a second one. With the flag off nothing here is
   * reached, `polishUnits` is `contestedUnits`, and the search is byte-for-byte
   * the one that shipped.
   */
  const polishUnits = (s: Session, best: BankResult): ReadonlyArray<UnitId> => {
    const contested = contestedUnits(s.ours, best.worstResolution, s.pinned, cfg.polishUnits);
    if (s.multistart === null || !(s.sub instanceof EngineSubstrate)) return contested;
    if (contested.length >= cfg.polishUnits) return contested;
    const seen = new Set<UnitId>(contested);
    const out = [...contested];
    for (const unitId of crowdedUnits(
      s.sub,
      s.ours,
      best.plan,
      s.pinned,
      cfg.polishUnits,
      s.multistart.tuning.crowdingRadius,
    )) {
      if (seen.has(unitId)) continue;
      out.push(unitId);
      if (out.length >= cfg.polishUnits) break;
    }
    return out;
  };

  /** A deterministic perturbation: one unpinned unit onto a different option. */
  const perturb = (s: Session, plan: JointPlan, step: number): JointPlan | null => {
    const pool = s.ours.filter(
      (id) => !s.pinned.has(id) && (s.sets.get(id) as CandidateSet).candidates.length > 1,
    );
    if (pool.length === 0) return null;
    const unitId = pool[step % pool.length] as UnitId;
    const set = s.sets.get(unitId) as CandidateSet;
    const current = plan.get(unitId) as Candidate;
    const options = set.candidates.filter((c) => !(c.to === current.to && samePath(c, current)));
    if (options.length === 0) return null;
    return withMove(plan, options[(step * 7 + 1) % options.length] as Candidate);
  };

  // ---------------------------------------------------------------- improve

  const improve = (ctx: SearchContext): PlanScore => {
    const s = sessionFor(ctx);
    {
      // The two parallel seams BRACKET THE SLICE. The fold comes first, because
      // an entry that arrives after the price it would have served is an entry
      // wasted; the speculation comes last, from the incumbent this slice
      // settled on, because that is the plan the NEXT slice sweeps from. See
      // `speculate` for what happens when it is fired at the start instead.
      foldParallel(s);
      // The slice's own length, read before any of it is spent — the only
      // honest basis for "how long may a worker spend on the NEXT one". Not
      // even a clock read on the single-threaded path: `parallel: null` is the
      // search that shipped, and it should cost exactly what it cost.
      const sliceMs = cfg.parallel === null ? 0 : ctx.budget.remainingMs();
      // THE ROUND'S TEMPERATURE, read once, here, and nowhere else.
      //
      // Owner Q1's default — "always on, but cooling sharply as the clock runs
      // down" — needs a TURN-scale clock, and `remainingMs()` is the SLICE's
      // and resets every slice. `decisionFraction()` is the turn-scale one and
      // is optional: a harness budget does not model a turn, and then the
      // schedule holds its opening temperature, which is what keeps every
      // deterministic probe in this stage a property of the search rather than
      // of the box. One read per slice, so the step-clock replay stays a
      // function of the slice count and not of how much sampling happened
      // inside a slice (arch-s1 correction 7, in its selection-layer form).
      s.sampler?.beginRound(ctx.budget.decisionFraction?.() ?? 1);
      let best = s.bank.price(seedPlan(s, ctx.incumbent?.plan ?? null, ctx.budget));
      // A witness admitted since the last slice makes a fresh B2 branch of
      // every plan priced after it, so every clean mark is stale. Once per
      // call, before anything is skipped.
      s.cluster?.dirty.noteWitnesses(ctx.witnesses.length);
      // THE CLUSTER JOINTS GO FIRST, and before any sweep. They are the plans
      // this stage exists to produce; a sweep that ran first would spend the
      // slice on one-move neighbours of a seed the enumeration is trying to
      // replace, and on a starved turn there would be nothing left.
      if (s.cluster !== null) s.cluster.offeredThisSlice = 0;
      best = offerClusterJoints(s, ctx.budget, best, cfg.clusterOffersPerRound);
      for (let n = 0; n < cfg.maxSweeps; n++) {
        if (ctx.budget.shouldStop()) break;
        const before = best;
        best = sweep(s, ctx.budget, best);
        // The ALTERNATES, one per round and against a swept incumbent. The MAP
        // above is the enumeration's claim; positions 2..k are its diversity,
        // and diversity is worth paying for only once the cheap moves are made
        // — otherwise a generator spends a starved decision generating. See
        // `offerClusterJoints` for the measurement that set this shape.
        best = offerClusterJoints(s, ctx.budget, best, cfg.clusterOffersPerRound);
        best = pairRepair(s, ctx.budget, best);
        if (best === before) {
          // Converged unit-wise. Polish first — it is cheap and it is the
          // escape a sweep cannot make — then spend what is left on perturbed
          // restarts, which inherit the whole witness set by construction
          // because the bank outlives them.
          const polished = jointPolish(s, ctx.budget, best);
          if (polished !== best) {
            best = polished;
            continue;
          }
          let restarted = false;
          for (let r = 0; r < cfg.restarts && !ctx.budget.shouldStop(); r++) {
            const seed = perturb(s, best.plan, r);
            if (seed === null) break;
            let local = s.bank.price(seed);
            local = sweep(s, ctx.budget, local);
            local = pairRepair(s, ctx.budget, local);
            if (better(local, best)) {
              best = local;
              restarted = true;
              break;
            }
          }
          if (!restarted) break;
        }
      }
      speculate(s, best, sliceMs);
      return { plan: best.plan, bounds: best.bounds, witnesses: s.bank.witnesses };
    }
  };

  // ---------------------------------------------------------------- conform

  /**
   * THE EPOCH-CHANGE FAST PATH. Splice the pins in, repair the legality they
   * broke, run ONE pair-repair pass, stop. No sweep, no polish, no restarts —
   * this runs while an operator is waiting to see their pin honored, and its
   * cost must be a function of how much the pin disturbed, not of the roster.
   *
   * A pinned move can invalidate a teammate's plan in two ways: the teammate's
   * chosen candidate may no longer be offered at all (the generator's option
   * set is computed against the current position), or the teammate may now die
   * in a collision with the pinned unit. Both are repaired by re-picking from
   * that unit's own CandidateSet, and only for the units actually affected.
   *
   * RUNG 0 IS NOT A REPAIR (V4 B2). With an EMPTY incumbent nothing has been
   * disturbed, because there was nothing there to disturb: every unit is
   * "changed" only in the trivial sense that it had no previous entry. Running
   * the repair loop over that set costs `1 + |ours| × conformRepairPerUnit`
   * full `price()` calls — linear in the roster, which is exactly the
   * guarantee the kernel is built on being false, and it runs BEFORE the first
   * staged set on the whole remaining budget. The seed is already a complete
   * legal plan by construction (the candidate layer's ordered-first option for
   * every unit, pins spliced in), so rung 0 takes it, pays ONE B0-shaped
   * `price()` to prove it resolves and to warm the bank's witness set, and
   * stops: O(1) price calls plus generation, whatever the roster.
   *
   * The refinement slices that follow are what turn that seed into a good
   * plan; conform's job is only that a legal joint set is on the wire first.
   */
  const conform = (ctx: SearchContext, incumbent: JointPlan): JointPlan => {
    const s = sessionFor(ctx);
    {
      // Fold, but never speculate. `conform` runs while an operator is waiting
      // to see their pin honoured and its cost must track the disturbance, not
      // the roster; building a frontier and cutting it is roster-shaped work.
      // Taking free answers that are already here is not.
      foldParallel(s);
      if (incumbent.size === 0) {
        const seed = seedPlan(s, null, ctx.budget);
        // One resolution set — and the SEED IS RETURNED WHATEVER IT SAYS.
        //
        // The price warms the bank's witness set and proves the plan resolves,
        // but it is not what makes the plan legal: the candidate layer's own
        // ordered-first option for every unit already is, by construction. So
        // a bank that proves one of its own members unsound while pricing it
        // must not take the turn down with it. Letting a BoundsInversionError
        // escape rung 0 aborted the whole decision and left every unit
        // unstaged — measured at 5 of 300 decisions on an 11-snake board,
        // against a contract gate that requires zero. A legal conforming plan
        // on the wire beats nothing; the loud signal is the counter the kernel
        // keeps, not a dead turn.
        let scored: BankResult | null = null;
        try {
          scored = s.bank.price(seed);
        } catch (err) {
          if ((err as { code?: string }).code !== "bounds_inversion") throw err;
          // THE SEAM MUST FIRE WHERE THE INVERSION HAPPENS. The kernel keeps
          // the identical env-gated print beside its own slice-level catch
          // (`kernel.ts`'s `bounds-inversion` refusal), but a rung-0 absorb
          // never reaches that catch: it is swallowed here and only the COUNT
          // survives, folded in through `drainRefusals`. That asymmetry cost a
          // whole re-measure — the counter climbed on the shipped default and
          // the seam stayed silent, so the class (`bank floor=… ceiling=…`,
          // which is the only thing that identifies the unsound member) had to
          // be recovered by patching a scratch worktree. Same gate, same
          // format, so one `CENTAUR_DEBUG_INVERSION=1` covers both channels —
          // and each names its own, because the counter does not.
          if (process.env.CENTAUR_DEBUG_INVERSION) {
            process.stderr.write(`INVERSION rung-0: ${(err as Error).message}\n`);
          }
          absorbedInversions++;
        }
        const repairing =
          cfg.rungZeroRepair ?? resolveStagingSafety(stagingSafety(), false) === "full";
        if (scored === null || !repairing) return seed;
        return repairSelfHarm(s, ctx, scored).plan;
      }

      // 1. splice: pins first, then whatever of the incumbent still stands.
      // NO SAMPLING BUDGET ON THE SPLICE PATH, deliberately: `conform` with a
      // standing incumbent runs while an operator waits and its cost must track
      // the disturbance, not the roster. A null handle takes the multi-start's
      // stage-0 baseline for whatever the splice left free and stops there.
      let plan = seedPlan(s, incumbent, null);

      // 2. repair legality — only the units the splice actually disturbed.
      const disturbed = disturbedBy(s, plan, incumbent);
      if (disturbed.length > 0) {
        let scored = s.bank.price(plan);
        for (const unitId of disturbed) {
          if (ctx.budget.shouldStop()) break;
          const set = s.sets.get(unitId) as CandidateSet;
          for (const candidate of topCandidates(set.candidates, cfg.conformRepairPerUnit)) {
            if (ctx.budget.shouldStop()) break;
            const trial = s.bank.price(withMove(scored.plan, candidate));
            if (better(trial, scored)) scored = trial;
          }
        }
        plan = scored.plan;
      }

      // 3. one pair-repair pass.
      if (!ctx.budget.shouldStop()) {
        plan = pairRepair(s, ctx.budget, s.bank.price(plan)).plan;
      }
      return plan;
    }
  };

  /**
   * RUNG 0'S LAST LINE — the self-harm repair.
   *
   * Rung 0 already pays for one full `price()`, and until now it threw the
   * answer away: the seed was returned WHATEVER the resolution said, including
   * on the 58 decisions in the measured corpus whose chosen plan came back
   * `lo = est = hi = DEAD` and whose team was wiped that same turn, 58 times out
   * of 58. The bot had computed its own warning and did not read it.
   *
   * So it reads it, and the reading costs nothing when there is nothing to say:
   *
   *   · NO CASUALTIES OF OURS -> return immediately. This is the overwhelmingly
   *     common case and the O(1)-price guarantee rung 0 is built on is intact.
   *   · CASUALTIES -> re-pick each victim from its OWN candidate set, then run
   *     ONE pair-repair pass over exactly the pairs the resolution names as
   *     self-inflicted. Cost tracks the number of accidents, never the roster,
   *     and both loops watch the clock.
   *
   * Acceptance is `better()` and nothing else, so this cannot lower the floor:
   * a repair that does not strictly improve on the proved floor is refused and
   * the seed stands. Pinned units are never moved — a pin is a constraint, and
   * an operator who pinned a unit into a fatal cell has said so on purpose.
   */
  const repairSelfHarm = (s: Session, ctx: SearchContext, seed: BankResult): BankResult => {
    const victims = ourCasualties(s, seed);
    if (victims.length === 0) return seed;
    let best = seed;
    for (const unitId of victims.slice(0, Math.max(0, cfg.rungZeroRepairVictims))) {
      if (ctx.budget.shouldStop()) break;
      const set = s.sets.get(unitId);
      if (set === undefined) continue;
      for (const candidate of topCandidates(set.candidates, cfg.conformRepairPerUnit)) {
        if (ctx.budget.shouldStop()) break;
        const trial = s.bank.price(withMove(best.plan, candidate));
        if (better(trial, best)) best = trial;
      }
    }
    // The 2-opt the coordinate step above structurally cannot make: a pair
    // where moving either unit alone is no improvement while moving both is.
    // Skipped when the single-unit pass already cleared the board.
    if (!ctx.budget.shouldStop() && ourCasualties(s, best).length > 0) {
      best = pairRepair(s, ctx.budget, best);
    }
    return best;
  };

  /**
   * Our own units the floor-justifying resolution removed, in danger order and
   * without the pinned ones. Both the VICTIM and whichever team-mate the
   * resolver named alongside it are worth moving — when a queen steps on its
   * own king the king is the casualty and the queen is the unit with somewhere
   * else to be — so a clash contributes every one of our participants.
   */
  const ourCasualties = (s: Session, result: BankResult): ReadonlyArray<UnitId> => {
    const resolution = result.worstResolution;
    const dead = deadIn(resolution);
    const out: UnitId[] = [];
    const seen = new Set<UnitId>();
    const push = (id: UnitId): void => {
      if (seen.has(id) || s.pinned.has(id) || !s.ourSet.has(id)) return;
      seen.add(id);
      out.push(id);
    };
    for (const clash of resolution.clashes) {
      if (!clash.victimIDs.some((id) => s.ourSet.has(id))) continue;
      for (const id of clash.playerIDs) push(id);
    }
    for (const id of dead) push(id);
    return out;
  };

  /**
   * Units whose plan the splice disturbed: the ones whose incumbent candidate
   * is gone, plus the ones that share a cell with a newly-pinned unit's path.
   * Pinned units are never in the list — they are the constraint, not the
   * repair.
   *
   * Only ever called with a NON-EMPTY incumbent (see `conform`): with an empty
   * one every unit lands in `previous === undefined` and the "cost tracks the
   * disturbance" guarantee becomes "cost tracks the roster".
   */
  const disturbedBy = (s: Session, plan: JointPlan, incumbent: JointPlan): ReadonlyArray<UnitId> => {
    const pinnedCells = new Set<number>();
    for (const unitId of s.pinned) {
      const candidate = plan.get(unitId) as Candidate;
      for (const cell of candidate.path) pinnedCells.add(cell);
      pinnedCells.add(candidate.to);
    }
    const out: UnitId[] = [];
    for (const unitId of s.ours) {
      if (s.pinned.has(unitId)) continue;
      const chosen = plan.get(unitId) as Candidate;
      const previous = incumbent.get(unitId);
      if (previous === undefined || !isStillOffered(s.sets.get(unitId) as CandidateSet, previous)) {
        out.push(unitId);
        continue;
      }
      if (chosen.path.some((cell) => pinnedCells.has(cell)) || pinnedCells.has(chosen.to)) {
        out.push(unitId);
      }
    }
    return out;
  };

  const drainRefusals = (): { boundsInversions: number } => {
    const out = { boundsInversions: absorbedInversions };
    absorbedInversions = 0;
    return out;
  };

  /**
   * The cluster accounting, summed over live sessions. Null when the layer
   * never ran, which is the shipped default and is how a reader tells "off"
   * from "on and found nothing".
   */
  const clusterReport = (): ClusterReport | null => {
    let seen = false;
    let out: DirtyStats & Omit<ClusterReport, "sweepsSkipped" | "sweepsRun"> = {
      clusters: 0,
      sliders: 0,
      maxComponent: 0,
      jointsEnumerated: 0,
      jointsBeforeShrink: 0,
      rungThreshold: 0,
      rungIcm: 0,
      merged: false,
      proposals: 0,
      proposalsPriced: 0,
      proposalsNear: 0,
      proposalsFlat: 0,
      noExactGain: 0,
      enumMs: 0,
      skipped: 0,
      swept: 0,
    };
    for (const session of sessions.values()) {
      const cluster = session.cluster;
      if (cluster === null) continue;
      seen = true;
      const dirty = cluster.dirty.stats;
      out = {
        clusters: Math.max(out.clusters, cluster.stats.clusters),
        sliders: Math.max(out.sliders, cluster.stats.sliders),
        maxComponent: Math.max(out.maxComponent, cluster.stats.maxComponent),
        jointsEnumerated: out.jointsEnumerated + cluster.stats.jointsEnumerated,
        jointsBeforeShrink: out.jointsBeforeShrink + cluster.stats.jointsBeforeShrink,
        rungThreshold: out.rungThreshold + cluster.stats.rungThreshold,
        rungIcm: out.rungIcm + cluster.stats.rungIcm,
        merged: out.merged || cluster.stats.merged,
        proposals: out.proposals + cluster.stats.proposals,
        proposalsPriced:
          out.proposalsPriced + (cluster.cursor - cluster.skippedNear - cluster.skippedFlat),
        proposalsNear: out.proposalsNear + cluster.skippedNear,
        proposalsFlat: out.proposalsFlat + cluster.skippedFlat,
        noExactGain: out.noExactGain + cluster.stats.noExactGain,
        enumMs: out.enumMs + cluster.enumMs,
        skipped: out.skipped + dirty.skipped,
        swept: out.swept + dirty.swept,
      };
    }
    // No live session: the decision has ended and `release()` took its
    // snapshot. Falling back to it is what makes this report readable from
    // outside the kernel loop at all.
    if (!seen) return lastCluster;
    const { skipped, swept, ...rest } = out;
    return { ...rest, sweepsSkipped: skipped, sweepsRun: swept };
  };

  /**
   * The lottery's ledger, over the live sessions. Null when it never ran —
   * which is the shipped default, and is how a reader tells "off" from "on and
   * drew nothing".
   *
   * The SEED is the field that matters: with it and the same board, the harness
   * reproduces the decision bit-for-bit. It is an operator-side number and
   * never reaches the wire (see `SearchCore.selectionReport` in contracts.ts).
   * Reported for the LAST session opened, because that is the one the emission
   * being stamped came from; the counters are summed over all of them.
   */
  const selectionReport = (): SelectionReport | null => {
    let last: SelectionReport | null = null;
    let permutations = 0;
    let arms = 0;
    let draws = 0;
    let admitted = 0;
    let farAdmitted = 0;
    for (const session of sessions.values()) {
      if (session.sampler === null) continue;
      const r = session.sampler.report();
      last = r;
      permutations += r.permutations;
      arms += r.arms;
      draws += r.draws;
      admitted += r.admitted;
      farAdmitted += r.farAdmitted;
    }
    if (last === null) return lastSelection;
    return { ...last, permutations, arms, draws, admitted, farAdmitted };
  };

  /** Which slot of `better()` decided, over this core's whole life. */
  const adjudicationReport = (): AdjudicationReport => ({ ...adjudication });

  /**
   * CL6's thread accounting, over the live sessions. Null when the layer never
   * ran, which is the shipped default and is how a reader tells "off" from "on
   * and found nothing" — the same convention `clusterReport` uses.
   *
   * Reported for the LAST session opened, because that is the one the emission
   * being stamped came from. It is TELEMETRY: nothing here reaches the wire
   * (`forwardPlan` sends a `CentaurMove` and nothing else), and nothing here
   * is read by any comparison.
   */
  const scoutReport = (): ScoutReport | null => {
    let last: ScoutReport | null = null;
    for (const session of sessions.values()) {
      if (session.scout === null) continue;
      last = session.scout.report();
    }
    return last ?? lastScout;
  };

  /**
   * WHAT THE MULTI-START SEED DID, on the last slice that ran one. Null when
   * the layer never ran, which is the shipped default and is how a reader tells
   * "off" from "on and sampled nothing".
   *
   * Not summed over sessions like the three above, and the difference is real:
   * the multi-start is a per-SLICE act, not a per-session one, so the honest
   * quantity is the last seeding rather than a total over a decision's slices.
   * It carries the decision seed, which is what makes the selection auditable —
   * hand the same `matchSeed` back on the same board and the run reproduces.
   * TELEMETRY: nothing in the decision path reads it and none of it reaches the
   * wire.
   */
  const multistartReport = (): MultiStartReport | null => lastMultiStart;

  return {
    improve,
    conform,
    drainRefusals,
    release,
    clusterReport,
    selectionReport,
    adjudicationReport,
    scoutReport,
    multistartReport,
  };
}
