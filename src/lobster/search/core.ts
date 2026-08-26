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
  planKey,
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
  /**
   * How many BASES keep a live session (candidate sets + bound bank + memo)
   * between calls. One committed context and its speculative companions is
   * the shape the kernel alternates over; a session dropped between slices
   * throws away the memo and re-prices the seed on every single one.
   */
  readonly sessionCacheSize: number;
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
   * THE STRICT SHADOW. In a per-team decision the ascent runs in the DECLARED
   * relaxed world, so `best` is a statement about that world. This tracks the
   * leader the UNCONDITIONAL channel would have picked over exactly the same
   * priced plans, so the two worlds' disagreement is a measured number rather
   * than an assumption. It is never compared with `best` — the two live in
   * different games — it is only reported. Reset per `improve` call.
   */
  shadow: { best: BankResult | null };
}

export function makeSearchCore(tuning: Partial<SearchTuning> = {}): SearchCore {
  const cfg: SearchTuning = { ...DEFAULT_TUNING, ...tuning };
  /** Bounds inversions this core absorbed rather than letting them end a
   * decision. Drained by the kernel, which owns the refusal counters. */
  let absorbedInversions = 0;
  /**
   * WORLD ARBITRATION ACCOUNTING (per-team adversary, C5). Drained by the
   * kernel with the refusals, because a world choice is exactly as much of an
   * explicit decision as a refusal is and neither may be silent.
   */
  const worldCounters = { decisions: 0, relaxed: 0, disagreements: 0, vetoes: 0 };

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
  const memoShare = Math.max(
    64,
    Math.floor((cfg.bank.memoCapacity ?? DEFAULT_BANK_CONFIG.memoCapacity) / Math.max(1, cfg.sessionCacheSize)),
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

  /** A session for this basis, reused when one is already live. */
  const sessionFor = (ctx: SearchContext): Session => {
    const key = sessionKey(ctx);
    const hit = sessions.get(key);
    if (hit !== undefined && hit.sub === ctx.sub) {
      // Keep the LRU order, and take whatever witnesses the caller has learned
      // since — the double oracle's memory is the one thing that must cross
      // every boundary.
      sessions.delete(key);
      sessions.set(key, hit);
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
      config: { ...cfg.bank, memoCapacity: memoShare },
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
      shadow: { best: null },
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

  // --------------------------------------------------------- world shadow

  /**
   * Price a plan and keep the UNCONDITIONAL channel's own leader up to date.
   *
   * Both readings come out of one `price()` — the bank computes the strict
   * bound whether or not it also computes a relaxed one — so the shadow costs
   * a comparison, not a resolution.
   */
  /** Start a fresh shadow for one `improve` call. A function rather than an
   * inline assignment so the narrowing of `s.shadow.best` belongs to this
   * scope and not to the caller's control flow. */
  const resetShadow = (s: Session): void => {
    s.shadow.best = null;
  };

  const priced = (s: Session, plan: JointPlan): BankResult => {
    const trial = s.bank.price(plan);
    const cur = s.shadow.best;
    if (cur === null) {
      s.shadow.best = trial;
      return trial;
    }
    const cmp = compareFloors(trial.strictBounds, cur.strictBounds);
    if (!cmp.comparable) return trial;
    if (cmp.order > 0 || (cmp.order === 0 && trial.strictBounds.best > cur.strictBounds.best)) {
      s.shadow.best = trial;
    }
    return trial;
  };

  /**
   * THE SAFETY VETO — the ONE thing the strict world is allowed to say about a
   * plan the relaxed world likes, and it is a PREDICATE on the strict bound
   * alone, never a comparison between the two games.
   *
   * `strictBounds.best === DEAD` means: in the full, un-relaxed game there is
   * no reply under which this plan survives — dead in the OPTIMISTIC reading,
   * `material-dead` in the posture governor's vocabulary, a verdict rather
   * than a fear. A declared world may break ties among plans whose floors are
   * merely cloud-contingent-dead. It may never stage a plan the unconditional
   * game has already convicted, because no assumption about how two rivals
   * coordinate can bring such a plan back to life.
   *
   * It applies only to ACCEPTING AN IMPROVEMENT. Rung 0's seed is never
   * vetoed: a decision that stages nothing is worse than any of this.
   */
  const strictlyConvicted = (r: BankResult): boolean =>
    r.strictBounds.best === Number.NEGATIVE_INFINITY;

  // ------------------------------------------------------------- acceptance

  /**
   * Strict improvement on (floor, est, ceiling, salted tie key).
   *
   * A BASIS MISMATCH IS A REFUSAL. Two plans priced under different assumption
   * sets are not two answers to the same question, and taking the larger
   * number is exactly the laundering the whole bounds layer exists to prevent.
   * The incumbent keeps its place.
   */
  const better = (s: Session, trial: BankResult, incumbent: BankResult): boolean => {
    // The world arbitration's veto, before anything else is read.
    if (trial.speaks === "per-team" && strictlyConvicted(trial) && !strictlyConvicted(incumbent)) {
      worldCounters.vetoes++;
      return false;
    }
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
        const trial = priced(s, withMove(best.plan, candidate));
        if (better(s, trial, best)) best = trial;
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
          const trial = priced(s, withMoves(best.plan, [ca, cb]));
          if (better(s, trial, best)) best = trial;
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
        const trial = priced(s, withMoves(best.plan, acc));
        if (better(s, trial, best)) best = trial;
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
      resetShadow(s);
      let best = priced(s, seedPlan(s, ctx.incumbent?.plan ?? null));
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
            let local = priced(s, seed);
            local = sweep(s, ctx.budget, local);
            local = pairRepair(s, ctx.budget, local);
            if (better(s, local, best)) {
              best = local;
              restarted = true;
              break;
            }
          }
          if (!restarted) break;
        }
      }
      // WORLD ARBITRATION, RECORDED. The relaxed world is what the ascent
      // maximised and what the kernel will stage — its narrowing rides
      // `best.bounds.assumptions` all the way onto the EmitRecord — so the one
      // thing left to do is say, in a counter the kernel drains, whether the
      // unconditional channel would have chosen differently. Never resolved
      // here: two worlds do not vote, one of them was chosen before the search
      // started and the other one is a witness to the price of that choice.
      worldCounters.decisions++;
      if (best.speaks === "per-team") {
        worldCounters.relaxed++;
        const shadow: BankResult | null = s.shadow.best;
        if (shadow !== null && planKey(shadow.plan) !== planKey(best.plan)) {
          worldCounters.disagreements++;
        }
      }
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
        try {
          priced(s, seed);
        } catch (err) {
          if ((err as { code?: string }).code !== "bounds_inversion") throw err;
          absorbedInversions++;
        }
        return seed;
      }

      // 1. splice: pins first, then whatever of the incumbent still stands.
      let plan = seedPlan(s, incumbent);

      // 2. repair legality — only the units the splice actually disturbed.
      const disturbed = disturbedBy(s, plan, incumbent);
      if (disturbed.length > 0) {
        let scored = priced(s, plan);
        for (const unitId of disturbed) {
          if (ctx.budget.shouldStop()) break;
          const set = s.sets.get(unitId) as CandidateSet;
          for (const candidate of topCandidates(set.candidates, cfg.conformRepairPerUnit)) {
            if (ctx.budget.shouldStop()) break;
            const trial = priced(s, withMove(scored.plan, candidate));
            if (better(s, trial, scored)) scored = trial;
          }
        }
        plan = scored.plan;
      }

      // 3. one pair-repair pass.
      if (!ctx.budget.shouldStop()) {
        plan = pairRepair(s, ctx.budget, priced(s, plan)).plan;
      }
      return plan;
    }
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

  const drainRefusals = (): {
    boundsInversions: number
    world: { decisions: number; relaxed: number; disagreements: number; vetoes: number }
  } => {
    const out = {
      boundsInversions: absorbedInversions,
      world: { ...worldCounters },
    };
    absorbedInversions = 0;
    worldCounters.decisions = 0;
    worldCounters.relaxed = 0;
    worldCounters.disagreements = 0;
    worldCounters.vetoes = 0;
    return out;
  };

  return { improve, conform, drainRefusals, release };
}
