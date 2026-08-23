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
 * The sweep order is bot-a's danger order, the repair is bot-b's 2-opt over
 * exactly the pairs the resolution names as self-inflicted casualties, the
 * polish is the cross-product of the top-2 candidates of the ≤3 most contested
 * units, and restarts inherit the witness set.
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
import type { Resolution } from "../../partial-engine/index";
import {
  BoundBank,
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
  planTieKey,
  selfInflictedPairs,
  topCandidates,
} from "./order";
import { basisOf, referenceActionsOf } from "./basis";

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
  readonly ctx: SearchContext;
  readonly bank: BoundBank;
  readonly ours: ReadonlyArray<UnitId>;
  readonly ourSet: ReadonlySet<UnitId>;
  readonly pinned: ReadonlySet<UnitId>;
  readonly sets: ReadonlyMap<UnitId, CandidateSet>;
  readonly pins: ReadonlyMap<UnitId, Candidate>;
}

export function makeSearchCore(tuning: Partial<SearchTuning> = {}): SearchCore {
  const cfg: SearchTuning = { ...DEFAULT_TUNING, ...tuning };

  // ------------------------------------------------------------------ setup

  const rosterOf = (ctx: SearchContext): ReadonlyArray<UnitId> => {
    if (hasRoster(ctx.sub)) return [...ctx.sub.commandable(ctx.asTeam)].sort((a, b) => a - b);
    if (ctx.incumbent !== null) return [...ctx.incumbent.plan.keys()].sort((a, b) => a - b);
    throw new NoRosterError();
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
      config: cfg.bank,
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
      ctx,
      bank,
      ours,
      ourSet: new Set(ours),
      pinned: new Set(pins.keys()),
      sets,
      pins,
    };
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

  const seedPlan = (s: Session, from: JointPlan | null): JointPlan => {
    const plan = new Map<UnitId, Candidate>();
    for (const unitId of s.ours) {
      const pinned = s.pins.get(unitId);
      if (pinned !== undefined) {
        plan.set(unitId, pinned);
        continue;
      }
      const existing = from?.get(unitId);
      const set = s.sets.get(unitId) as CandidateSet;
      if (existing !== undefined && isStillOffered(set, existing)) {
        plan.set(unitId, existing);
        continue;
      }
      const first = set.candidates[0] ?? set.prunedLedger[0]?.candidate;
      if (first === undefined) {
        throw new Error(
          `no candidate at all for unit ${unitId}: a hard filter emptied the option set, ` +
            "which the completeness invariant forbids",
        );
      }
      plan.set(unitId, first);
    }
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

  const sweep = (s: Session, start: BankResult): BankResult => {
    let best = start;
    for (const unitId of dangerOrder(s.ours, best.worstResolution, s.pinned)) {
      if (s.ctx.budget.shouldStop()) break;
      const set = s.sets.get(unitId) as CandidateSet;
      const current = best.plan.get(unitId) as Candidate;
      for (const candidate of topCandidates(set.candidates, cfg.candidateCap)) {
        if (s.ctx.budget.shouldStop()) break;
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
  const pairRepair = (s: Session, start: BankResult): BankResult => {
    let best = start;
    const pairs = selfInflictedPairs(best.worstResolution, s.ourSet, best.plan);
    for (const [a, b] of pairs) {
      if (s.ctx.budget.shouldStop()) break;
      if (s.pinned.has(a) && s.pinned.has(b)) continue;
      const optionsA = s.pinned.has(a)
        ? [best.plan.get(a) as Candidate]
        : topCandidates((s.sets.get(a) as CandidateSet).candidates, cfg.pairRepairPerUnit);
      const optionsB = s.pinned.has(b)
        ? [best.plan.get(b) as Candidate]
        : topCandidates((s.sets.get(b) as CandidateSet).candidates, cfg.pairRepairPerUnit);
      for (const ca of optionsA) {
        if (s.ctx.budget.shouldStop()) break;
        for (const cb of optionsB) {
          if (s.ctx.budget.shouldStop()) break;
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
  const jointPolish = (s: Session, start: BankResult): BankResult => {
    let best = start;
    const units = contestedUnits(s.ours, best.worstResolution, s.pinned, cfg.polishUnits);
    if (units.length === 0) return best;
    const lists = units.map((id) =>
      topCandidates((s.sets.get(id) as CandidateSet).candidates, cfg.polishPerUnit),
    );
    const walk = (i: number, acc: Candidate[]): void => {
      if (s.ctx.budget.shouldStop()) return;
      const list = lists[i];
      if (list === undefined) {
        const trial = s.bank.price(withMoves(best.plan, acc));
        if (better(trial, best)) best = trial;
        return;
      }
      for (const candidate of list) {
        walk(i + 1, [...acc, candidate]);
        if (s.ctx.budget.shouldStop()) return;
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
    const s = open(ctx);
    try {
      let best = s.bank.price(seedPlan(s, ctx.incumbent?.plan ?? null));
      for (let n = 0; n < cfg.maxSweeps; n++) {
        if (ctx.budget.shouldStop()) break;
        const before = best;
        best = sweep(s, best);
        best = pairRepair(s, best);
        if (best === before) {
          // Converged unit-wise. Polish first — it is cheap and it is the
          // escape a sweep cannot make — then spend what is left on perturbed
          // restarts, which inherit the whole witness set by construction
          // because the bank outlives them.
          const polished = jointPolish(s, best);
          if (polished !== best) {
            best = polished;
            continue;
          }
          let restarted = false;
          for (let r = 0; r < cfg.restarts && !ctx.budget.shouldStop(); r++) {
            const seed = perturb(s, best.plan, r);
            if (seed === null) break;
            let local = s.bank.price(seed);
            local = sweep(s, local);
            local = pairRepair(s, local);
            if (better(local, best)) {
              best = local;
              restarted = true;
              break;
            }
          }
          if (!restarted) break;
        }
      }
      return { plan: best.plan, bounds: best.bounds, witnesses: s.bank.witnesses };
    } finally {
      s.bank.release();
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
   */
  const conform = (ctx: SearchContext, incumbent: JointPlan): JointPlan => {
    const s = open(ctx);
    try {
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
        plan = pairRepair(s, s.bank.price(plan)).plan;
      }
      return plan;
    } finally {
      s.bank.release();
    }
  };

  /**
   * Units whose plan the splice disturbed: the ones whose incumbent candidate
   * is gone, plus the ones that share a cell with a newly-pinned unit's path.
   * Pinned units are never in the list — they are the constraint, not the
   * repair.
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

  return { improve, conform };
}

/** Exposed so the kernel and the tests can read a plan's world back. */
export function worldOf(result: BankResult): Resolution {
  return result.worstResolution;
}
