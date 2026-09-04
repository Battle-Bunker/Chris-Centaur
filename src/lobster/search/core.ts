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
  CandidateView,
  JointPlan,
  Lever,
  LeverView,
  PlanScore,
  ScoreBounds,
  SearchContext,
  SearchCore,
  TrialSink,
  UnitId,
} from "../contracts";
import type { MovesetRung, Verdict } from "../../lens/types";
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
import { DEFAULT_DEAD_BELOW, detectVacuity } from "../postures";
// The KERNEL's plan key, not the bank's. The two spell a plan differently
// (`to#path` against `to:path`) and the view's rows are handed to the kernel,
// which compares them against `run.plans`; a key that is nearly the same is
// worse than one that is obviously different.
import { planKey as viewPlanKey } from "../voc";

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
   * THE RIVAL SET THE LEVER VIEW IS ABOUT — the handful of priced plans that
   * define this decision, kept across slices because the session is.
   *
   * Not every trial: a decision prices tens of thousands and the view needs
   * the ones that could still be the answer. What is remembered is what the
   * search itself KEEPS — the seed, each phase's winner, each restart's local
   * optimum — which is exactly the set whose ceilings bound how open the
   * decision still is.
   */
  readonly rivals: Map<string, Rival>;
  /** Views built for this session. `LeverView.round` — the orchestrator's own
   * sense of how long it has been looking at this decision. */
  round: number;
}

/** One priced plan, as the lever view shows it. */
interface Rival {
  readonly key: string;
  readonly plan: JointPlan;
  bounds: ScoreBounds;
  est: number;
  /** The horizon THIS plan's reading was proved at (06 F-2). */
  horizon: number;
}

/**
 * Rivals kept per session. Small on purpose: the view exists to name the
 * leader and the un-refuted rival with the highest ceiling, and a longer list
 * buys the orchestrator nothing while costing every slice a walk.
 */
const LEVER_ROWS = 8;

/**
 * WHAT THE ACCEPTANCE LADDER READS. `Rival` is one of these; so is a priced
 * trial, minus the witnesses and the reason.
 */
export interface RankedRow {
  readonly bounds: ScoreBounds;
  readonly est: number;
  /** The horizon THIS row's reading was proved at (06 F-2). */
  readonly horizon: number;
  readonly plan: JointPlan;
}

/**
 * THE ACCEPTANCE ORDER OVER TWO PRICED ROWS: does `a` displace `b`?
 *
 * Floor first, under basis comparability, then `est`, then the ceiling, then
 * the salted tie — the ladder `better()` climbs, restricted to what a row
 * carries. A basis mismatch is a REFUSAL, not a tie: two plans priced under
 * different assumption sets are not two answers to one question, so `b` keeps
 * its place.
 *
 * BOTH MIDDLE RUNGS ARE HORIZON-LOCAL, and this function is where that is
 * said once for the two callers that must not disagree about a plan — the
 * search's incumbent and the lever view's leader.
 *
 * `est` (06 F-4) is the evaluator's advisory scalar taken from B0 alone, with
 * no basis, no ledger and no soundness claim: two ests at two horizons are two
 * evaluations of two different boards with no declared discount between them,
 * and comparing them is Law H's forbidden fold. It is the same coordinate
 * `RatchetBasis.horizon` carries for exactly this reason — a basis ENDS where
 * its horizon changes, because the quantity being ratcheted stopped being the
 * same quantity.
 *
 * `hi` (08 F-10) does cross a horizon AS A BOUND, but this rung does not use
 * it as one — it uses it as a ranking key preferring the LARGER, and a deeper
 * reading has a lower ceiling, so an unguarded rung refuses a plan for having
 * been measured, at an equal floor, where no rung above it is watching.
 *
 * Across horizons the salted tie decides: an indifferent order, reproducibly,
 * which is the honest answer when two readings disagree about depth and no
 * rung that can speak separated them.
 */
export function ranksAbove(a: RankedRow, b: RankedRow, seed: number): boolean {
  const cmp = compareFloors(a.bounds, b.bounds);
  if (!cmp.comparable) return false;
  if (cmp.order !== 0) return cmp.order > 0;
  const acrossHorizons = a.horizon !== b.horizon;
  if (!acrossHorizons && a.est !== b.est) return a.est > b.est;
  if (!acrossHorizons && a.bounds.best !== b.bounds.best) return a.bounds.best > b.bounds.best;
  return planTieKey(a.plan, seed) > planTieKey(b.plan, seed);
}

/** The two shapes `better()` returns, allocated once: a comparison in the
 *  hottest function in the search must not allocate to say "no". */
const ACCEPT: Verdict = { accept: true };
const REFUSED = {
  witness: { accept: false, because: "witness" },
  basis: { accept: false, because: "basis" },
  floor: { accept: false, because: "floor" },
  est: { accept: false, because: "est" },
  hi: { accept: false, because: "hi" },
  tie: { accept: false, because: "tie" },
} as const satisfies Readonly<Record<string, Verdict>>;

export function makeSearchCore(tuning: Partial<SearchTuning> = {}): SearchCore {
  const cfg: SearchTuning = { ...DEFAULT_TUNING, ...tuning };
  /** Bounds inversions this core absorbed rather than letting them end a
   * decision. Drained by the kernel, which owns the refusal counters. */
  let absorbedInversions = 0;

  /**
   * THE HORIZON OF ONE PLAN'S READING, keyed on the plan itself (06 F-2).
   *
   * A depth is a property of a proof about a particular joint assignment, so it
   * is stored against that assignment and nothing else — not against the slice,
   * not against the session, not against the leader. One ply unless something
   * deepened it, and the only thing that ever does is `refine`. Weak, because a
   * plan the search dropped takes its reading with it, and O(1), because it is
   * read on the retention path once per observed trial.
   */
  const deepHorizon = new WeakMap<object, number>();
  const horizonOfPlan = (plan: JointPlan): number => deepHorizon.get(plan as object) ?? 1;

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
      rivals: new Map<string, Rival>(),
      round: 0,
    };
  };

  /**
   * Keep a priced plan as a rival. Idempotent on the key, so a plan re-priced
   * at a deeper horizon UPDATES its reading rather than arriving twice.
   *
   * Eviction drops the lowest ceiling, ties by key — deterministic, and the
   * right endpoint to drop on: a rival is interesting because its optimism has
   * not been confronted yet, and the least optimistic one is the one whose
   * confrontation would tell us least.
   */
  const remember = (s: Session, result: BankResult): void => {
    const horizon = horizonOfPlan(result.plan);
    const key = viewPlanKey(result.plan);
    const hit = s.rivals.get(key);
    if (hit !== undefined) {
      hit.bounds = result.bounds;
      hit.est = result.est;
      hit.horizon = Math.max(hit.horizon, horizon);
      return;
    }
    s.rivals.set(key, { key, plan: result.plan, bounds: result.bounds, est: result.est, horizon });
    if (s.rivals.size <= LEVER_ROWS) return;
    let worst: Rival | null = null;
    for (const r of s.rivals.values()) {
      if (
        worst === null ||
        r.bounds.best < worst.bounds.best ||
        (r.bounds.best === worst.bounds.best && r.key > worst.key)
      ) {
        worst = r;
      }
    }
    if (worst !== null) s.rivals.delete(worst.key);
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
  /**
   * THE RETENTION SEAM (03 §2.2).
   *
   * `better()` is the collapse point: it takes two priced results and returns
   * a boolean, and the loser is dropped on the floor. Everything the lens
   * shows about a decision is a trial that reached here. So the trials are
   * OFFERED, at the one call site that already sees every priced one, and the
   * cost when nobody is watching is the null check on the next line.
   *
   * The rung is ambient rather than a parameter because `better` is called
   * from five places and the rung is a property of WHERE the search is, not
   * of the comparison. It is set on entry to each move and restored after,
   * which is the only discipline a single-threaded recursion needs.
   */
  let trials: TrialSink | null = null;
  let rung: MovesetRung = "seed";
  const observe = (trial: BankResult, incumbent: BankResult, verdict: Verdict): void => {
    if (trials === null) return;
    trials({
      plan: trial.plan,
      incumbentPlan: incumbent.plan,
      bounds: trial.bounds,
      est: trial.est,
      tie: planTieKey(trial.plan, cfg.seed),
      rung,
      accepted: verdict.accept,
      because: verdict.accept ? null : verdict.because,
      // THE READING'S HORIZON, on the reading (06 F-2). The lens's depth column
      // is sourced from here and never from `EmitRecord.horizon`.
      horizon: horizonOfPlan(trial.plan),
      // THE CERTIFICATE, or nothing. `refutedAt` is a numeric test — this
      // plan's ceiling sits below the incumbent's proved floor — and the
      // concrete reply that put it there is in the bank's own witness set. A
      // trial with no witness banked yet is still refuted, but it is refuted
      // by ARITHMETIC, and the reservoir says `dominated` rather than
      // fabricating a certificate nobody holds.
      witness: trial.witnesses[0] ?? null,
      // THE INSTRUMENT RIDES ALONG (08 §5 step 1). `Q` is measured in the
      // bank's own B3 preamble; this is the seam it travels to the lens on,
      // and no comparison below reads it.
      loud: trial.loud,
    });
  };

  /**
   * [CHANGE 1] — THE COMPARISON RETURNS ITS REASON.
   *
   * The refusal branch is the whole content of the set-valued reduction: every
   * one of these six lines already knows WHY it refused, and until now none of
   * it reached anything. `{accept}` is the same boolean it always was — every
   * caller reads `.accept` and nothing else — and the reason rides beside it
   * for the reservoir to turn into a `DominanceCondition` at the barrier.
   *
   * THIS MUST CHANGE NO DECISION. The reason is derived from comparisons this
   * function already performs, in the order it already performs them, and the
   * order is the invariant: `(floor, est, ceiling, salted tie key)`, strictly,
   * with a basis mismatch a refusal. It is a refactor of the hottest function
   * in the search, which is exactly where an accidental reordering hides — so
   * it is gated on G2 (`lens-determinism.test.ts`), which was green two
   * commits before this one and has to stay green after it.
   */
  const better = (trial: BankResult, incumbent: BankResult): Verdict => {
    // The witness veto, stated explicitly even though the floor comparison
    // already implies it: a plan some banked reply holds below the incumbent's
    // PROVED floor cannot be an improvement, however good its own floor looks.
    if (refutedAt(trial.bounds.best, incumbent.bounds.worst)) return REFUSED.witness;
    const cmp = compareFloors(trial.bounds, incumbent.bounds);
    if (!cmp.comparable) return REFUSED.basis;
    if (cmp.order !== 0) return cmp.order > 0 ? ACCEPT : REFUSED.floor;
    // RUNG 4 IS HORIZON-LOCAL (06 F-4, Q-L7).
    //
    // `lo` and `hi` cross a horizon boundary because they are claims about a
    // horizon-INDEPENDENT quantity, proved to different depths. `est` does not:
    // it is the evaluator's advisory scalar taken from B0 alone, with no basis,
    // no ledger and no soundness claim, and two ests at two horizons are two
    // evaluations of two different boards with no declared discount between
    // them. Comparing them is Law H's forbidden fold, and the shape of the trap
    // is on record — an arena depth layer that published a proved floor into a
    // mean slot composed a downward bias with an upward one and nobody could
    // see it. So the rung is skipped where it cannot speak, and the ceiling,
    // which is a bound, decides instead. One line, and it is why depth needs no
    // fourth fiber coordinate.
    const acrossHorizons = horizonOfPlan(trial.plan) !== horizonOfPlan(incumbent.plan);
    if (!acrossHorizons && trial.est !== incumbent.est) {
      return trial.est > incumbent.est ? ACCEPT : REFUSED.est;
    }
    // RUNG 5 IS HORIZON-LOCAL TOO (08 F-10), and for the mirror of F-4's
    // reason rather than the same one.
    //
    // `hi` genuinely crosses a horizon boundary AS A BOUND: it is an upper
    // bound on one horizon-independent quantity, proved to different depths,
    // and the comment above is right that this is what lets a deep reading be
    // compared with a shallow one at all. What it does not notice is that this
    // rung does not use `hi` as a bound — it uses it AS A RANKING KEY
    // PREFERRING THE LARGER. A deeper reading has a LOWER ceiling (that is the
    // only thing depth can afford to move here), so a plan that was measured
    // loses this rung to one that was not, purely for having been measured.
    // That is a bias against evidence, and it would be invisible: the rung
    // fires at an equal floor, where nothing else is watching.
    //
    // The guard DECLINES TO COMPARE rather than inventing an exchange rate,
    // exactly as F-4's did. Across horizons the salted tie decides — an
    // indifferent order, reproducibly — which is the honest answer when the
    // two readings disagree about depth and no rung above them separated them.
    // Byte-identical on this build, where every horizon is 1 and the guard is
    // inert; installed now, while its installation can be proved harmless.
    if (!acrossHorizons && trial.bounds.best !== incumbent.bounds.best) {
      return trial.bounds.best > incumbent.bounds.best ? ACCEPT : REFUSED.hi;
    }
    return planTieKey(trial.plan, cfg.seed) > planTieKey(incumbent.plan, cfg.seed)
      ? ACCEPT
      : REFUSED.tie;
  };

  // ------------------------------------------------------------------ moves

  /** Price one proposal against the incumbent and take it iff `better()` says so.
   *  ACCEPTANCE IS `better()` AND NOTHING ELSE — every rung inherits it here. */
  const consider = (s: Session, best: BankResult, moves: ReadonlyArray<Candidate>): BankResult => {
    const trial = s.bank.price(withMoves(best.plan, moves));
    const verdict = better(trial, best);
    observe(trial, best, verdict);
    return verdict.accept ? trial : best;
  };

  /**
   * ONE COORDINATE-ASCENT PASS — for each unit in `units`, price its top
   * `perUnit` candidates against the incumbent, judge each with `better()`,
   * observe it, take it if it wins. `sweep`, `conform`'s legality repair and
   * `repairSelfHarm` are this loop at three different unit lists and caps;
   * `skipIncumbent` is `sweep`'s only real difference — it skips the trial
   * that would just be `withMove(plan, plan's own candidate)`.
   */
  const climb = (
    s: Session,
    budget: SearchContext["budget"],
    start: BankResult,
    units: Iterable<UnitId>,
    perUnit: number,
    skipIncumbent: boolean,
  ): BankResult => {
    let best = start;
    for (const unitId of units) {
      if (budget.shouldStop()) break;
      const set = s.sets.get(unitId);
      if (set === undefined) continue;
      const current = skipIncumbent ? (best.plan.get(unitId) as Candidate) : undefined;
      for (const candidate of topCandidates(set.candidates, perUnit)) {
        if (budget.shouldStop()) break;
        if (current !== undefined && candidate.to === current.to && samePath(candidate, current)) continue;
        best = consider(s, best, [candidate]);
      }
    }
    return best;
  };

  /** Price a plan, count it as an ACCEPTed observation, and enter it in the witness set. */
  const seat = (s: Session, plan: JointPlan): BankResult => {
    const scored = s.bank.price(plan);
    observe(scored, scored, ACCEPT);
    remember(s, scored);
    return scored;
  };

  const sweep = (s: Session, budget: SearchContext["budget"], start: BankResult): BankResult => {
    rung = "sweep";
    return climb(
      s,
      budget,
      start,
      dangerOrder(s.sub, s.ours, start.worstResolution, s.pinned),
      cfg.candidateCap,
      true,
    );
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
    rung = "pair";
    let best = start;
    const pairs = selfInflictedPairs(s.sub, best.worstResolution, s.ourSet, best.plan);
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
          best = consider(s, best, [ca, cb]);
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
    rung = "polish";
    let best = start;
    const units = contestedUnits(s.sub, s.ours, best.worstResolution, s.pinned, cfg.polishUnits);
    if (units.length === 0) return best;
    const lists = units.map((id) =>
      topCandidates((s.sets.get(id) as CandidateSet).candidates, cfg.polishPerUnit),
    );
    const walk = (i: number, acc: Candidate[]): void => {
      if (budget.shouldStop()) return;
      const list = lists[i];
      if (list === undefined) {
        best = consider(s, best, acc);
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
    trials = ctx.trials ?? null;
    try {
      rung = "seed";
      const seeded = seedPlan(s, ctx.incumbent?.plan ?? null);
      // A DEEP READING SURVIVES THE SLICE BOUNDARY. The kernel resumes a
      // decision by handing back the incumbent it emitted, so a horizon proved
      // in an earlier slice has to arrive with it or every slice would start
      // over at one ply — and `better()`'s rung-4 guard would then never see
      // the boundary it exists to refuse to cross. Two plan keys per call, and
      // only when the incumbent claims a depth at all.
      const carried = ctx.incumbent;
      if (
        carried !== null &&
        carried.horizon !== undefined &&
        carried.horizon > 1 &&
        viewPlanKey(seeded) === viewPlanKey(carried.plan)
      ) {
        deepHorizon.set(seeded as object, carried.horizon);
      }
      // THE SEED IS A TRIAL TOO. Without it a cluster whose assignment the
      // whole slice never touched would have no row at all, and the operator
      // would read an empty table for the units the search is happiest about.
      let best = seat(s, seeded);
      for (let n = 0; n < cfg.maxSweeps; n++) {
        if (ctx.budget.shouldStop()) break;
        const before = best;
        best = sweep(s, ctx.budget, best);
        best = pairRepair(s, ctx.budget, best);
        remember(s, best);
        if (best === before) {
          // Converged unit-wise. Polish first — it is cheap and it is the
          // escape a sweep cannot make — then spend what is left on perturbed
          // restarts, which inherit the whole witness set by construction
          // because the bank outlives them.
          const polished = jointPolish(s, ctx.budget, best);
          if (polished !== best) {
            best = polished;
            remember(s, best);
            continue;
          }
          let restarted = false;
          for (let r = 0; r < cfg.restarts && !ctx.budget.shouldStop(); r++) {
            const seed = perturb(s, best.plan, r);
            if (seed === null) break;
            let local = s.bank.price(seed);
            local = sweep(s, ctx.budget, local);
            local = pairRepair(s, ctx.budget, local);
            // A LOSING RESTART IS STILL A RIVAL. Its ceiling is what root slack
            // is a maximum over, so throwing it away is throwing away the one
            // number that says the decision is still open.
            remember(s, local);
            rung = "restart";
            const verdict = better(local, best);
            observe(local, best, verdict);
            if (verdict.accept) {
              best = local;
              restarted = true;
              break;
            }
          }
          if (!restarted) break;
        }
      }
      return {
        plan: best.plan,
        bounds: best.bounds,
        witnesses: s.bank.witnesses,
        // THE READING'S OWN HORIZON (06 F-2), so the kernel stamps the plan's
        // depth on the plan rather than the slice's depth on everything.
        horizon: horizonOfPlan(best.plan),
      };
    } finally {
      trials = null;
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
    trials = ctx.trials ?? null;
    rung = "conform";
    try {
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
        observe(scored, scored, ACCEPT);
        remember(s, scored);
        return repairSelfHarm(s, ctx, scored).plan;
      }

      // 1. splice: pins first, then whatever of the incumbent still stands.
      let plan = seedPlan(s, incumbent);

      // 2. repair legality — only the units the splice actually disturbed.
      const disturbed = disturbedBy(s, plan, incumbent);
      if (disturbed.length > 0) {
        const scored = climb(s, ctx.budget, seat(s, plan), disturbed, cfg.conformRepairPerUnit, false);
        plan = scored.plan;
      }

      // 3. one pair-repair pass.
      if (!ctx.budget.shouldStop()) {
        plan = pairRepair(s, ctx.budget, seat(s, plan)).plan;
      }
      return plan;
    } finally {
      trials = null;
      rung = "seed";
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
    rung = "conform";
    const victims = ourCasualties(s, seed);
    if (victims.length === 0) return seed;
    let best = climb(
      s,
      ctx.budget,
      seed,
      victims.slice(0, Math.max(0, cfg.rungZeroRepairVictims)),
      cfg.conformRepairPerUnit,
      false,
    );
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
    const dead = deadIn(s.sub, resolution);
    const idOf = (wireId: string): UnitId | undefined => s.sub.unitIdOf(wireId);
    const out: UnitId[] = [];
    const seen = new Set<UnitId>();
    const push = (id: UnitId): void => {
      if (seen.has(id) || s.pinned.has(id) || !s.ourSet.has(id)) return;
      seen.add(id);
      out.push(id);
    };
    for (const clash of resolution.clashes) {
      const victims = clash.victimIDs.map(idOf);
      if (!victims.some((id) => id !== undefined && s.ourSet.has(id))) continue;
      for (const wireId of clash.playerIDs) {
        const id = idOf(wireId);
        if (id !== undefined) push(id);
      }
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

  // ------------------------------------------------------- the lever surface

  /**
   * THE REFINER SEAM GETS A PRODUCER (06 F-1).
   *
   * `asRefiner` narrows a core that implements BOTH `refinementView` and
   * `refine`, and this one implemented neither — so `run.lastView` was never
   * assigned, `absorb` stamped `run.lastView?.horizon ?? 1` onto every plan, and
   * `EmitRecord.horizon` read 1 on all 125 956 decisions ever measured. A
   * constant column that looks like a measurement is worse than an absent one,
   * because three of this program's instrument artifacts came from reading one.
   *
   * WHAT THE VIEW CLAIMS. Real rivals (the plans the search kept), a real
   * leader on the same ladder `better()` uses, a real root slack, and a
   * per-plan horizon that is the plan's own.
   *
   * WHAT IT DOES NOT. Three of the orchestrator's four levers — `catchup`,
   * `narrow`, `advance` — refine a HELD unit's claim, and this build has a
   * producer for none of them: a narrowing is a marshalling-time input to the
   * substrate, staleness is a fact about an observation a decision cannot go
   * back and take, and `advanced` is decided by the bank's own entanglement
   * gating rather than by a caller asking. So `units` is EMPTY, deliberately.
   * Reporting units no lever can move would make `leverOrderBinding: true` a
   * claim about an order that does not bind, which is the same defect as the
   * constant horizon column wearing a different hat.
   */
  const leaderOf = (rows: ReadonlyArray<Rival>): number => {
    let best = 0;
    for (let i = 1; i < rows.length; i++) {
      if (ranksAbove(rows[i] as Rival, rows[best] as Rival, cfg.seed)) best = i;
    }
    return best;
  };

  const refinementView = (ctx: SearchContext): LeverView => {
    const s = sessionFor(ctx);
    s.round++;
    // Sorted by key: the view is read by an orchestrator whose choices must
    // replay identically, and a Map's insertion order is a function of which
    // trials happened to win.
    const rows = [...s.rivals.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    if (rows.length === 0) {
      return {
        candidates: [],
        leaderIdx: -1,
        slack: 0,
        horizon: 1,
        depthMax: 1,
        units: [],
        interiorCells: 0,
        epsilon: 0,
        round: s.round,
      };
    }
    const leaderIdx = leaderOf(rows);
    const leader = rows[leaderIdx] as Rival;
    let slack = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i === leaderIdx) continue;
      slack = Math.max(slack, (rows[i] as Rival).bounds.best - leader.bounds.worst);
    }
    const candidates: CandidateView[] = rows.map((r, i) => {
      const loCite = new Set<UnitId>();
      const hiCite = new Set<UnitId>();
      for (const e of r.bounds.ledger) {
        (e.polarity === "if_present" ? loCite : hiCite).add(e.unitId);
      }
      return {
        key: r.key,
        plan: r.plan,
        lo: r.bounds.worst,
        est: r.est,
        hi: r.bounds.best,
        horizon: r.horizon,
        vacuity: detectVacuity(r.bounds, DEFAULT_DEAD_BELOW).cause,
        loCite,
        hiCite,
        // The witness veto, as a certificate rather than as an opinion: this
        // plan's SOUND ceiling sits at or below the leader's PROVED floor.
        refuted: i !== leaderIdx && refutedAt(r.bounds.best, leader.bounds.worst),
      };
    });
    return {
      candidates,
      leaderIdx,
      slack,
      horizon: leader.horizon,
      // HOW DEEP THIS CORE CAN GO. One ply: there is no continuation layer,
      // so the orchestrator's depth ration finds every target already at its
      // maximum, falls through, and returns `stop` — which is the kernel's
      // plain `improve()` slice. The seam is real and the answer through it is
      // an honest no.
      depthMax: 1,
      units: [],
      interiorCells: 0,
      epsilon: 0,
      round: s.round,
    };
  };

  /**
   * Apply one lever.
   *
   * The only lever with a producer here is depth, and `refinementView` offers
   * it only where it can be paid for — so anything that arrives is a lever this
   * core has no way to pull, and the honest response is the work the slice
   * would have done anyway rather than a no-op that burns it.
   */
  const refine = (ctx: SearchContext, lever: Lever): PlanScore => {
    void lever;
    return improve(ctx);
  };

  return { improve, conform, refinementView, refine, drainRefusals, release };
}
