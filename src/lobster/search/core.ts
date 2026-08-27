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
  Candidate,
  CandidateSet,
  JointPlan,
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
  planBatchPartition,
  type EvaluationPool,
  type EvaluatorSpec,
  type Frontier,
  type WorkPartition,
} from "../parallel";
import type { CandidateKnobs } from "../candidates";

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
}

export function makeSearchCore(tuning: Partial<SearchTuning> = {}): SearchCore {
  const cfg: SearchTuning = { ...DEFAULT_TUNING, ...tuning };
  /** Bounds inversions this core absorbed rather than letting them end a
   * decision. Drained by the kernel, which owns the refusal counters. */
  let absorbedInversions = 0;

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
  const release = (): void => {
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
    return {
      sub: ctx.sub,
      bank,
      ours,
      ourSet: new Set(ours),
      pinned: new Set(pins.keys()),
      sets,
      pins,
      references,
      parallel: openParallelSession(ctx, ours, sets),
    };
  };

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
    };
    const partition =
      par.partition ?? planBatchPartition(par.headroom, par.maxPlansPerParcel);
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
  const seedPlan = (s: Session, from: JointPlan | null): JointPlan => {
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
    if (refutedAt(trial.bounds.best, incumbent.bounds.worst)) return false;
    const cmp = compareFloors(trial.bounds, incumbent.bounds);
    if (!cmp.comparable) return false;
    if (cmp.order !== 0) return cmp.order > 0;
    if (trial.est !== incumbent.est) return trial.est > incumbent.est;
    if (trial.bounds.best !== incumbent.bounds.best) return trial.bounds.best > incumbent.bounds.best;
    return planTieKey(trial.plan, cfg.seed) > planTieKey(incumbent.plan, cfg.seed);
  };

  // ------------------------------------------------------------------ moves

  const sweep = (s: Session, budget: SearchContext["budget"], start: BankResult): BankResult => {
    let best = start;
    for (const unitId of dangerOrder(s.ours, best.worstResolution, s.pinned)) {
      if (budget.shouldStop()) break;
      const set = s.sets.get(unitId) as CandidateSet;
      const current = best.plan.get(unitId) as Candidate;
      for (const candidate of topCandidates(set.candidates, cfg.candidateCap)) {
        if (budget.shouldStop()) break;
        if (candidate.to === current.to && samePath(candidate, current)) continue;
        const trial = s.bank.price(withMove(best.plan, candidate));
        if (better(trial, best)) best = trial;
      }
    }
    return best;
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
        : topCandidates((s.sets.get(a) as CandidateSet).candidates, cfg.pairRepairPerUnit);
      const optionsB = s.pinned.has(b)
        ? [best.plan.get(b) as Candidate]
        : topCandidates((s.sets.get(b) as CandidateSet).candidates, cfg.pairRepairPerUnit);
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
    const units = contestedUnits(s.ours, best.worstResolution, s.pinned, cfg.polishUnits);
    if (units.length === 0) return best;
    const lists = units.map((id) =>
      topCandidates((s.sets.get(id) as CandidateSet).candidates, cfg.polishPerUnit),
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
      // honest basis for "how long may a worker spend on the NEXT one".
      const sliceMs = ctx.budget.remainingMs();
      let best = s.bank.price(seedPlan(s, ctx.incumbent?.plan ?? null));
      for (let n = 0; n < cfg.maxSweeps; n++) {
        if (ctx.budget.shouldStop()) break;
        const before = best;
        best = sweep(s, ctx.budget, best);
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
        const seed = seedPlan(s, null);
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
          absorbedInversions++;
        }
        const repairing =
          cfg.rungZeroRepair ?? resolveStagingSafety(stagingSafety(), false) === "full";
        if (scored === null || !repairing) return seed;
        return repairSelfHarm(s, ctx, scored).plan;
      }

      // 1. splice: pins first, then whatever of the incumbent still stands.
      let plan = seedPlan(s, incumbent);

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

  return { improve, conform, drainRefusals, release };
}
