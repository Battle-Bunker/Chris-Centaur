/**
 * THE BOUND BANK — one floor, a family of independently sound lower bounds.
 *
 * For a fixed joint action `a` the bank maintains
 *
 *     floor(a)   = max over the members that QUALIFY
 *     ceiling(a) = min over every branch it actually evaluated
 *
 * and the two are computed separately, from different members, because each
 * bound is its own game.
 *
 * ── the members ───────────────────────────────────────────────────────────
 *
 * B0  HOLD EVERYTHING. One resolution with every uncontrolled unit held. Its
 *     pessimistic endpoint is a floor on the security value (holding is a
 *     sound relaxation of the enemy's min); its optimistic endpoint is a
 *     ceiling (it rounds every unknown our way, over the whole cloud). Cost 1.
 *     Always on: it is the floor of last resort, and without it the bank has
 *     no ceiling either.
 *
 * B1  PER-ENEMY COMPLETE ENUMERATION, ADDITIVE. For an enemy `e` whose option
 *     set is enumerated COMPLETELY,
 *
 *         min over o in options(e) of  B0-with-e-modelled(a, e := o)   ≤  SV(a)
 *
 *     because the enemy's real choice `o*` contributes a term that is itself a
 *     lower bound on the value at `o*`, and the min ranges over a set
 *     containing it. Doing this for e1 and separately for e2 gives two floors
 *     and costs a SUM of resolutions, not a product.
 *
 *     WHICH-TRUNCATION IS FORBIDDEN. Look at a SUBSET of one enemy's replies
 *     and the min over that subset is an over-estimate of the min over all of
 *     them — not a floor. So a sweep that the clock cut short, or an option
 *     list the generator pruned, may LOWER THE CEILING and may never RAISE THE
 *     FLOOR. Capping WHO gets enumerated is free (an un-enumerated unit simply
 *     stays held at a sound bound); capping WHICH replies of a modelled unit
 *     is an assumption, and the only way to let one move the floor is
 *     `declareTruncatedFloor`, which names it on the bounds.
 *
 * B2  WITNESS MATRIX. A witness is a concrete opponent joint reply. Its value
 *     is an UPPER bound certificate on SV(a) — SV is a min over all replies,
 *     and a witness is one of them. It is NOT a floor: `lo` at a witness
 *     bounds the value AT THAT REPLY from below, which says nothing about the
 *     reply the enemy actually picks. Witnesses accumulate across the whole
 *     decision and survive restarts, which is what makes them the double
 *     oracle's memory rather than a per-call detail.
 *
 * B3  FULL PRODUCT. Every gated unit live at once, the whole cross-product
 *     enumerated, within a DECLARED cap. The only rung that can report `exact`
 *     — and only when the residue also empties, i.e. nothing is left held for
 *     the ledger to name.
 *
 * ── entanglement gating ───────────────────────────────────────────────────
 *
 * Gating decides WHO gets enumerated: only units whose claims intersect the
 * staged paths in sub-step time can change the answer, and everything outside
 * the gate stays held at a bound that is tight rather than merely sound. This
 * is what makes the worst case affordable enough to be the default.
 */

import type {
  Assumption,
  Bound,
  Candidate,
  CandidateGenerator,
  Evaluator,
  JointPlan,
  LedgerEntry,
  PlanScore,
  ScoreBounds,
  Substrate,
  UnitId,
  Witness,
} from "../contracts";
import type { BudgetHandle } from "../contracts";
import type { PartialSettlement } from "../../engine-vendor/engine/settlePartial";
import { evaluatorResidueEntry, residueOf } from "./ledger";
import { footprintOf, planKey, withMove, withMoves } from "./plan";
import { loudReadingOf, type LoudReading } from "./loud";
import { memoizeSubstrate, type MemoizedSubstrate } from "./memo";
import { EvaluationMemo, evalNamespace, type EvalMemoStats } from "./evalmemo";
import { modelledView, isModelling } from "./substrate-ext";
import {
  BOUND_EPSILON,
  backupMin,
  basisKeyOf,
  makeScoreBounds,
  unionAssumptions,
  unionLedgers,
  withNarrowing,
} from "./score";

export type Rung = "B0" | "B1" | "B2" | "B3";

export interface BankConfig {
  /** Per-enemy complete enumeration. */
  readonly b1: boolean;
  /** Witness matrix. */
  readonly b2: boolean;
  /** Full product within the declared cap. */
  readonly b3: boolean;
  /**
   * WHO cap: how many uncontrolled units B1 may enumerate. Capping WHO needs
   * no declaration — the rest stay held at a sound bound.
   */
  readonly enemyCap: number;
  /** Cap on the B3 branch product. Exceeded, B3 declines and B1 carries on. */
  readonly productCap: number;
  /**
   * Let an INCOMPLETE enemy sweep move the floor, as a declared narrowing.
   * OFF by default — this is the `finished`-sweep rule, and turning it on
   * makes every bound it touches conditional and non-comparable with an
   * unconditional one.
   */
  readonly declareTruncatedFloor: boolean;
  /** Restrict B1/B3 to units the staged paths are actually entangled with. */
  readonly gateOnEntanglement: boolean;
  /** PartialSettlements cached per decision context. */
  readonly memoCapacity: number;
  /**
   * EVALUATIONS cached per decision context — a different budget from the one
   * above and deliberately larger, because an entry here is three numbers and
   * holds no arena slab (see evalmemo.ts). Zero turns the memo off.
   */
  readonly evalMemoCapacity: number;
}

export const DEFAULT_BANK_CONFIG: BankConfig = {
  b1: true,
  b2: true,
  b3: true,
  enemyCap: 3,
  productCap: 512,
  declareTruncatedFloor: false,
  gateOnEntanglement: true,
  memoCapacity: 4096,
  evalMemoCapacity: 8192,
};

/** B0 alone: the cheap end of the ladder, one resolution per plan. */
export const B0_ONLY: BankConfig = {
  ...DEFAULT_BANK_CONFIG,
  b1: false,
  b2: false,
  b3: false,
};

export interface MemberReport {
  readonly rung: Rung;
  /** The enemy this member enumerated, when it enumerated exactly one. */
  readonly unitId: UnitId | null;
  readonly branches: number;
  /** WHICH-complete AND the clock did not cut the sweep short. */
  readonly complete: boolean;
  /** The floor it contributed, or null when it was not allowed to move one. */
  readonly floor: number | null;
  readonly ceiling: number;
}

export interface BankResult extends PlanScore {
  readonly members: ReadonlyArray<MemberReport>;
  /** Real engine resolutions spent on this plan. */
  readonly resolutions: number;
  /** False when the clock cut any sweep short — the ceiling still stands. */
  readonly finished: boolean;
  /** The rung that justified the reported floor. */
  readonly floorFrom: Rung;
  /**
   * Whether the member that justified the FLOOR was a complete cover. False
   * means the reported floor rests on a declared narrowing, so it is a
   * statement about a restricted game and refuses comparison with an
   * unconditional one.
   */
  readonly floorComplete: boolean;
  /** The rung that justified the reported ceiling. */
  readonly ceilingFrom: Rung;
  /**
   * The resolution of the branch that justified the FLOOR — the world the
   * search must repair, because it is the one the promise is made against.
   */
  readonly worstResolution: PartialSettlement;
  /** The est channel — ordering only, never adjudication. */
  readonly est: number;
  /**
   * Narrowings the bank had to DECLARE while pricing — today, an adversary
   * option list whose completeness the substrate could not corroborate. They
   * are not part of the basis (a narrowing discovered on one plan and not on
   * another would make the two incomparable and freeze the ascent); they are
   * the honest record that a member was not allowed to move the floor, and
   * why.
   */
  readonly narrowings: ReadonlyArray<Assumption>;
  /**
   * THE LOUD PRODUCT, measured beside the reply product and never acted on
   * (`08-DEPTH-VERDICT` §5 step 1). Null when the B3 preamble did not run —
   * nothing is modelled, or the gate is empty — which is itself an occasion
   * class: there is no held enemy to reply, so there is nothing to enumerate.
   */
  readonly loud: LoudReading | null;
}

export interface BankInput {
  readonly sub: Substrate;
  readonly gen: CandidateGenerator;
  readonly evaluate: Evaluator;
  readonly asTeam: number;
  /**
   * The budget the bank consults AT CONSTRUCTION TIME. A bank that outlives
   * one slice must be handed the next slice's handle through `adoptBudget` —
   * see the field's own note. Budget SEMANTICS stay the caller's: the bank
   * asks `shouldStop()` and never decides what a slice is worth.
   */
  readonly budget: BudgetHandle;
  /**
   * Assumptions every member inherits: operator pins, the posture, and the
   * reference actions of teammates that are not ours to command. This is the
   * decision's BASIS, and it is identical across plans, which is what keeps
   * plan-to-plan comparison legal.
   */
  readonly basis: ReadonlyArray<Assumption>;
  /**
   * Units not ours to command, FIXED to a declared action rather than held.
   * Holding your own side is strictly looser AND strictly more expensive than
   * fixing it, so the fix is the default — declared, so it rides the basis.
   */
  readonly referenceActions?: ReadonlyMap<UnitId, Candidate>;
  readonly config?: Partial<BankConfig>;
}

interface Branch {
  readonly bounds: ScoreBounds;
  readonly est: number;
  readonly rung: Rung;
  /** The enemy reply this branch fixed, when it fixed one. */
  readonly replies: ReadonlyMap<UnitId, Candidate> | null;
  /** The world this branch actually resolved — what the search reads to find
   *  its own casualties and to order the next sweep. */
  readonly resolution: PartialSettlement;
}

/**
 * One hold configuration, and the NAME of it. The name is part of an
 * evaluation's cache key: the same plan under two different modelled sets
 * resolves into two different worlds and scores differently, so a view that
 * cannot be named cannot be cached against.
 */
interface View {
  readonly sub: Substrate;
  readonly key: string;
}

const isFinite_ = (n: number): boolean => Number.isFinite(n);

/** The best item by `better`'s strict order. `items` must be non-empty. */
function pickBy<T>(items: ReadonlyArray<T>, better: (candidate: T, incumbent: T) => boolean): T {
  let pick = items[0] as T;
  for (const item of items) {
    if (better(item, pick)) pick = item;
  }
  return pick;
}

export class BoundBank {
  private readonly cfg: BankConfig;
  private readonly memo: MemoizedSubstrate;
  private readonly referenceActions: ReadonlyMap<UnitId, Candidate>;
  private readonly referenceIds: ReadonlyArray<UnitId>;
  /** The double oracle's memory: witnesses live for the whole decision. */
  private readonly witnessKeys = new Set<string>();
  private witnessList: Witness[] = [];
  private readonly optionCache = new Map<UnitId, { options: ReadonlyArray<Candidate>; complete: boolean }>();
  /** Narrowings this bank had to declare — see `declare`. */
  private readonly narrowingKeys = new Set<string>();
  private readonly narrowingList: Assumption[] = [];
  private readonly views = new Map<string, { sub: Substrate; release(): void }>();
  private readonly canModel: boolean;
  /** Evaluations cached for this decision context — see evalmemo.ts. */
  private readonly evalMemo: EvaluationMemo;
  /** The canonical key of this bank's basis; half of the eval memo namespace. */
  private readonly basisKey: string;

  /**
   * THE LIVE CLOCK.
   *
   * This is a HANDLE THE CALLER OWNS, re-pointed per slice, and it is a field
   * rather than `input.budget` because of a measured defect:
   * `SearchCore.open()` built the bank with the FIRST slice's `BudgetHandle`
   * and then cached the session across slices, so from slice two on the bank
   * held a handle whose `shouldStop()` was permanently true. Every B1/B2/B3
   * sweep aborted at its first check and every price silently degraded to B0 —
   * all 1 724 prices of a one-second decision, zero rung admissions, zero
   * witnesses, for the whole life of the session. The ladder was, in effect,
   * off in production while reading as on.
   *
   * A captured clock is the bug. The bank does not own time policy — the
   * kernel builds the slice budget and the search hands it down — so what the
   * bank keeps is a POINTER to the current one, and `adoptBudget` is how a
   * caller that outlives a slice keeps it honest. `SearchCore.sessionFor` does
   * it on every path, next to `adoptWitnesses`, for the same reason: some
   * caller state must cross every boundary.
   */
  private budget: BudgetHandle;

  constructor(private readonly input: BankInput) {
    this.cfg = { ...DEFAULT_BANK_CONFIG, ...(input.config ?? {}) };
    this.memo = memoizeSubstrate(input.sub, this.cfg.memoCapacity);
    this.referenceActions = input.referenceActions ?? new Map();
    this.referenceIds = [...this.referenceActions.keys()].sort((a, b) => a - b);
    this.canModel = isModelling(this.memo);
    this.evalMemo = new EvaluationMemo(this.cfg.evalMemoCapacity);
    this.basisKey = basisKeyOf(input.basis);
    this.budget = input.budget;
  }

  /**
   * Point the bank at the budget of the slice that is running NOW.
   *
   * Idempotent, and cheap enough to call unconditionally. A bank that is not
   * re-pointed keeps whatever handle it was built with — which is correct for
   * a bank that lives inside one slice and fatal for one that does not.
   */
  adoptBudget(budget: BudgetHandle): void {
    this.budget = budget;
  }

  /** Evaluation-memo counters, for the soak and the regression tests. */
  get evalMemoStats(): EvalMemoStats {
    return this.evalMemo.stats;
  }

  /** True when the substrate can change WHO is held — B1/B2/B3 need it. */
  get modelling(): boolean {
    return this.canModel;
  }

  get witnesses(): ReadonlyArray<Witness> {
    return this.witnessList;
  }

  /** Everything this bank could not prove and had to say so about. */
  get narrowings(): ReadonlyArray<Assumption> {
    return this.narrowingList;
  }

  /** Seed the set from a previous context (restarts inherit witnesses). */
  adoptWitnesses(witnesses: ReadonlyArray<Witness>): void {
    for (const w of witnesses) this.addWitness(w);
  }

  private addWitness(w: Witness): boolean {
    const key = [...w.replies.values()]
      .map((c) => `${c.unitId}>${c.to}#${c.path.join(".")}`)
      .sort()
      .join("|");
    if (key.length === 0 || this.witnessKeys.has(key)) return false;
    this.witnessKeys.add(key);
    this.witnessList.push(w);
    return true;
  }

  /** Release every modelled sibling this bank created, and every resolution
   * slab the memo still caches. Never the input substrate itself. */
  release(): void {
    for (const v of this.views.values()) v.release();
    this.views.clear();
    this.memo.release();
    // Per-decision lifetime, exactly like the resolution memo's. The eval memo
    // holds no slabs, so this moves no arena counter — it is here so a cache
    // on a per-decision quantity cannot outlive the decision.
    this.evalMemo.clear();
  }

  /**
   * The units this decision does not control and has not fixed by reference —
   * the held set under the plan-domain rule, asked of the SUBSTRATE rather
   * than of an engine field (the substrate's base state keeps every unit live
   * and holds per-resolve, so its field carries no slots to read).
   */
  private uncontrolledCache: ReadonlyArray<UnitId> | null = null;

  private uncontrolled(): ReadonlyArray<UnitId> {
    // Constant for the life of a bank — the roster, the frame and the
    // reference actions are all fixed at construction — and `price` asks for
    // it on every call. Computed once.
    if (this.uncontrolledCache !== null) return this.uncontrolledCache;
    const ours = new Set(this.memo.commandable(this.input.asTeam));
    this.uncontrolledCache = this.memo
      .unitIds()
      .filter((id) => !ours.has(id) && !this.referenceActions.has(id));
    return this.uncontrolledCache;
  }

  // ------------------------------------------------------------------ views

  private viewFor(modelled: ReadonlyArray<UnitId>): View {
    const ids = [...new Set([...this.referenceIds, ...modelled])].sort((a, b) => a - b);
    const key = ids.join(",");
    const hit = this.views.get(key);
    if (hit) return { sub: hit.sub, key };
    const view = modelledView(this.memo, ids);
    this.views.set(key, view);
    return { sub: view.sub, key };
  }

  /** The plan every branch starts from: ours, plus the declared reference actions. */
  private withReferences(plan: JointPlan): JointPlan {
    if (this.referenceActions.size === 0) return plan;
    return withMoves(plan, [...this.referenceActions.values()]);
  }

  // --------------------------------------------------------------- branches

  /**
   * Price ONE branch: one resolution, one evaluation, one contract-shaped
   * ledger. The memo makes the evaluator's internal resolve a cache hit on the
   * entry this call filled, so a branch costs one engine resolution — and the
   * eval memo makes a REPEATED branch cost neither (see evalmemo.ts).
   *
   * `evalNs` is the namespace `price` computed for this call: evaluator
   * identity, basis, frame. It is a parameter rather than a field so there is
   * no captured-identity twin of the captured-clock defect above.
   *
   * `planKey` is computed ONCE here and used twice — as the memo key and as
   * the bound's provenance note. It used to be computed twice per branch, at
   * 1.19 µs each on an eight-unit roster, on the hottest path in the system.
   */
  private priceBranch(
    view: View,
    plan: JointPlan,
    rung: Rung,
    replies: ReadonlyMap<UnitId, Candidate> | null,
    evalNs: string,
  ): Branch {
    const pk = planKey(plan);
    const bounded = view.sub.resolveBoundedFor(plan, this.input.asTeam);
    const resolution = bounded.resolution;
    const bound: Bound = this.evalMemo.score(`${evalNs}|${view.key}|${pk}`, () =>
      this.input.evaluate.scorePlan(view.sub, plan, this.input.asTeam),
    );
    let ledger: ReadonlyArray<LedgerEntry> = bounded.ledger;
    if (ledger.length === 0 && bound.hi - bound.lo > BOUND_EPSILON) {
      // The engine proved nothing held could have changed this outcome, and
      // the evaluator still reports a gap. Something narrowed that is not an
      // entanglement — name it rather than letting an empty ledger claim a
      // discharge it has not earned.
      ledger = [
        evaluatorResidueEntry(
          `evaluator gap ${bound.lo}..${bound.hi} with an empty entanglement ledger`,
        ),
      ];
    }
    return {
      bounds: makeScoreBounds({
        worst: bound.lo,
        best: bound.hi,
        ledger,
        assumptions: this.input.basis,
        note: `${rung} branch ${pk}`,
      }),
      est: bound.est,
      rung,
      replies,
      resolution,
    };
  }

  private optionsFor(
    view: View,
    unitId: UnitId,
  ): { options: ReadonlyArray<Candidate>; complete: boolean } {
    const hit = this.optionCache.get(unitId);
    if (hit) return hit;
    // ADVERSARY purpose: the complete legal option list, by contract. The
    // generator's own-side prunes — exact ones included — would read as
    // incompleteness here, and an enemy's pruning rationale is ours, not its.
    const set = this.input.gen.candidatesFor(view.sub, unitId, "adversary");

    // COMPLETENESS IS CHECKED, NOT ACCEPTED (V4 S2).
    //
    // `complete` is what lets a group RAISE THE FLOOR: a min over a subset of
    // an enemy's replies is an over-estimate of the min over all of them, so a
    // member that reports completeness it does not have publishes an unsound
    // floor with no declared narrowing. Testing `candidates.length >=
    // set.legalCount` against a `legalCount` the same generator computed as
    // `candidates.length` is a tautology — the generator self-certifies the
    // one property the bank exists to check. The count is taken from the
    // SUBSTRATE's own enumerator instead, which is the engine's, and the
    // generator's self-report has to agree with it.
    //
    // A substrate that cannot enumerate (a stub, a foreign implementation)
    // cannot corroborate anything: the sweep is then treated as incomplete —
    // it contributes its ceiling and never a floor — and the narrowing is
    // declared. Unverified is not the same as verified, and the safe reading
    // of "I could not check" is the one that cannot publish a wrong floor.
    let enumerated: number | null = null;
    try {
      enumerated = view.sub.actionsOf(unitId).length;
    } catch {
      enumerated = null;
    }
    const agrees = enumerated !== null && set.legalCount === enumerated;
    const covers = enumerated !== null && set.candidates.length >= enumerated;
    const complete = agrees && covers && set.prunedLedger.length === 0;
    if (!complete && set.prunedLedger.length === 0) {
      // Not an ordinary prune: either the substrate could not corroborate the
      // list, or the generator's own count disagrees with the engine's.
      this.declare({
        kind: "narrowing",
        unitId,
        note:
          enumerated === null
            ? `adversary completeness unverifiable for unit ${unitId}: the substrate does not enumerate`
            : `adversary option list unproved for unit ${unitId}: generator reports ${set.legalCount} ` +
              `over ${set.candidates.length} candidates, the engine enumerates ${enumerated}`,
      });
    }
    const value = { options: set.candidates, complete };
    this.optionCache.set(unitId, value);
    return value;
  }

  /** Record a narrowing this bank had to make. Declared, deduplicated, and
   * carried on every result — never silently folded into a bound. */
  private declare(assumption: Assumption): void {
    const key = JSON.stringify(assumption);
    if (this.narrowingKeys.has(key)) return;
    this.narrowingKeys.add(key);
    this.narrowingList.push(assumption);
  }

  // ------------------------------------------------------------------ price

  price(plan: JointPlan): BankResult {
    const before = this.memo.stats.resolutions;
    const base = this.withReferences(plan);
    // THE EVALUATION MEMO'S NAMESPACE, rebuilt every call. Everything that
    // makes two evaluations of the same world different answers rather than
    // the same one: which evaluator (and therefore which criterion profile,
    // weights and reach horizon), which BASIS, and which frame the value is
    // denominated in. Recomputed rather than captured — see evalmemo.ts.
    const evalNs = this.evalMemo.namespaceToken(
      evalNamespace(this.input.evaluate, this.basisKey, this.input.asTeam),
    );
    const floorMembers: Array<{ bounds: ScoreBounds; report: MemberReport; resolution: PartialSettlement }> = [];
    const ceilingBranches: Branch[] = [];
    const members: MemberReport[] = [];
    let finished = true;

    // ---- B0 -------------------------------------------------------------
    const b0View = this.viewFor([]);
    const b0 = this.priceBranch(b0View, base, "B0", null, evalNs);
    const b0Report: MemberReport = {
      rung: "B0",
      unitId: null,
      branches: 1,
      complete: true,
      floor: b0.bounds.worst,
      ceiling: b0.bounds.best,
    };
    floorMembers.push({ bounds: b0.bounds, report: b0Report, resolution: b0.resolution });
    ceilingBranches.push(b0);
    members.push(b0Report);

    let est = b0.est;
    let loud: LoudReading | null = null;

    if (this.canModel) {
      const gated = this.gate(plan, b0.bounds.ledger);

      // ---- B3: the whole gate at once, when the product fits -------------
      let b3Covered = false;
      if (this.cfg.b3 && gated.length > 0) {
        const held = this.uncontrolled();
        const coversEverything = held.every((id) => gated.includes(id));
        const view = this.viewFor(gated);
        const lists = gated.map((id) => ({ id, ...this.optionsFor(view, id) }));
        const product = lists.reduce((n, l) => n * l.options.length, 1);
        // NAMED so the instrument can carry it: `b3` on the reading is the
        // Finding D-1 axis — whether ply 1 already closed this bracket.
        const eligible =
          coversEverything &&
          lists.every((l) => l.complete && l.options.length > 0) &&
          product <= this.cfg.productCap;
        loud = loudReadingOf(plan, lists, product, eligible, coversEverything);
        if (eligible) {
          const leaves: Branch[] = [];
          let swept = true;
          const walk = (i: number, acc: Candidate[]): void => {
            if (!swept) return;
            if (this.budget.shouldStop()) {
              swept = false;
              return;
            }
            const list = lists[i];
            if (list === undefined) {
              const replies = new Map(acc.map((c) => [c.unitId, c]));
              leaves.push(this.priceBranch(view, withMoves(base, acc), "B3", replies, evalNs));
              return;
            }
            for (const option of list.options) {
              walk(i + 1, [...acc, option]);
              if (!swept) return;
            }
          };
          walk(0, []);
          for (const leaf of leaves) ceilingBranches.push(leaf);
          if (leaves.length > 0) {
            members.push(this.closeGroup("B3", null, leaves, swept, true, floorMembers));
          }
          if (!swept) finished = false;
          b3Covered = swept && leaves.length > 0;
        }
      }

      // ---- B1: one enemy at a time, additive -----------------------------
      if (this.cfg.b1 && !b3Covered) {
        for (const enemy of gated.slice(0, this.cfg.enemyCap)) {
          if (this.budget.shouldStop()) {
            finished = false;
            break;
          }
          const view = this.viewFor([enemy]);
          const { options, complete } = this.optionsFor(view, enemy);
          if (options.length === 0) continue;
          const leaves: Branch[] = [];
          let swept = true;
          for (const option of options) {
            if (this.budget.shouldStop()) {
              swept = false;
              break;
            }
            const replies = new Map([[enemy, option]]);
            leaves.push(this.priceBranch(view, withMove(base, option), "B1", replies, evalNs));
          }
          for (const leaf of leaves) ceilingBranches.push(leaf);
          if (leaves.length === 0) continue;
          members.push(this.closeGroup("B1", enemy, leaves, swept, complete, floorMembers));
          if (!swept) {
            finished = false;
            break;
          }
        }
      }

      // ---- B2: the witness matrix ----------------------------------------
      if (this.cfg.b2 && this.witnessList.length > 0) {
        for (const witness of this.witnessList) {
          if (this.budget.shouldStop()) {
            finished = false;
            break;
          }
          const ids = [...witness.replies.keys()];
          if (ids.length === 0) continue;
          const view = this.viewFor(ids);
          const branch = this.priceBranch(
            view,
            withMoves(base, [...witness.replies.values()]),
            "B2",
            witness.replies,
            evalNs,
          );
          ceilingBranches.push(branch);
          members.push({
            rung: "B2",
            unitId: ids.length === 1 ? (ids[0] as UnitId) : null,
            branches: 1,
            // A witness is a certificate, never a cover: it may not move a floor.
            complete: false,
            floor: null,
            ceiling: branch.bounds.best,
          });
        }
      }
    }

    // ---- assemble --------------------------------------------------------
    //
    // Each bound its own game: the floor is a max over independent lower
    // bounds and the ceiling a min over independent upper bounds, and the two
    // are allowed to come from different members. Only the WINNER's basis
    // conditions the result — a losing conditional member asserted something
    // the answer does not use.
    const floorPick = pickBy(
      floorMembers,
      (m, incumbent) =>
        m.bounds.worst > incumbent.bounds.worst ||
        (m.bounds.worst === incumbent.bounds.worst &&
          m.bounds.ledger.length < incumbent.bounds.ledger.length)
    );
    const ceilPick = pickBy(
      ceilingBranches,
      (b, incumbent) =>
        b.bounds.best < incumbent.bounds.best ||
        (b.bounds.best === incumbent.bounds.best &&
          b.bounds.ledger.length < incumbent.bounds.ledger.length)
    );

    // A CONDITIONAL floor and an UNCONDITIONAL ceiling are statements about
    // two different games, and the conditional one may legitimately sit above
    // the other: that is what "the true worst may live in a discarded reply"
    // means. So when the floor rests on an incomplete cover, its own member's
    // ceiling — the ceiling of the SAME restricted game — is what pairs with
    // it. Each bound its own game, applied to the basis as well as the value.
    //
    // This is NOT a clamp for an unconditional floor. An unconditional floor
    // above a sound ceiling is the fatal bug class, and it still throws.
    let best = ceilPick.bounds.best;
    let widened = false;
    if (best < floorPick.bounds.worst && !floorPick.report.complete) {
      best = floorPick.bounds.best;
      widened = true;
    }
    const bounds = makeScoreBounds({
      worst: floorPick.bounds.worst,
      best,
      ledger: unionLedgers(
        floorPick.bounds.ledger,
        widened ? floorPick.bounds.ledger : ceilPick.bounds.ledger,
      ),
      assumptions: unionAssumptions(floorPick.bounds.assumptions, ceilPick.bounds.assumptions),
      note: `bank floor=${floorPick.report.rung} ceiling=${widened ? floorPick.report.rung : ceilPick.rung}`,
    });

    // `est` orders among floor ties and never adjudicates. Clamp it into the
    // bracket so a stale estimate can never be read as a promise.
    if (!isFinite_(est)) est = bounds.worst;
    est = Math.min(Math.max(est, bounds.worst), bounds.best);

    return {
      plan,
      bounds,
      witnesses: this.witnessList,
      members,
      resolutions: this.memo.stats.resolutions - before,
      finished,
      floorFrom: floorPick.report.rung,
      floorComplete: floorPick.report.complete,
      ceilingFrom: widened ? floorPick.report.rung : ceilPick.rung,
      worstResolution: floorPick.resolution,
      est,
      narrowings: this.narrowingList,
      loud,
    };
  }

  /**
   * Close one enumerated group: a MIN node over its branches. The group may
   * raise the floor only when the sweep was WHICH-complete and the clock did
   * not cut it short; otherwise it contributes its ceiling and nothing else —
   * unless the caller has explicitly asked for a declared conditional floor.
   *
   * The branch that achieved the minimum is a real opponent reply, so it is
   * banked as a witness: this is where the double oracle's column generation
   * actually happens.
   */
  private closeGroup(
    rung: Rung,
    unitId: UnitId | null,
    leaves: ReadonlyArray<Branch>,
    swept: boolean,
    complete: boolean,
    floorMembers: Array<{ bounds: ScoreBounds; report: MemberReport; resolution: PartialSettlement }>,
  ): MemberReport {
    const group = backupMin(
      leaves.map((l) => l.bounds),
      `${rung} group`,
    );
    let worstLeaf = leaves[0] as Branch;
    for (const leaf of leaves) if (leaf.bounds.worst < worstLeaf.bounds.worst) worstLeaf = leaf;
    if (worstLeaf.replies !== null) {
      this.addWitness({
        replies: worstLeaf.replies,
        note: `${rung} minimiser${unitId === null ? "" : ` for unit ${unitId}`}`,
      });
    }

    const usable = complete && swept;
    let floor: number | null = null;
    if (usable) {
      floorMembers.push({
        bounds: group,
        report: { rung, unitId, branches: leaves.length, complete: true, floor: group.worst, ceiling: group.best },
        resolution: worstLeaf.resolution,
      });
      floor = group.worst;
    } else if (this.cfg.declareTruncatedFloor) {
      const declared = withNarrowing(group, {
        kind: "narrowing",
        unitId: unitId ?? -1,
        note: swept
          ? `${rung}: option list pruned — the true worst may live in a discarded reply`
          : `${rung}: sweep cut short by the clock after ${leaves.length} replies`,
      });
      floorMembers.push({
        bounds: declared,
        report: { rung, unitId, branches: leaves.length, complete: false, floor: declared.worst, ceiling: declared.best },
        resolution: worstLeaf.resolution,
      });
      floor = declared.worst;
    }
    return { rung, unitId, branches: leaves.length, complete: usable, floor, ceiling: group.best };
  }

  /**
   * WHO to enumerate. Entanglement first (only a unit whose claim meets a
   * staged path in sub-step time can change the answer), ranked by how much
   * the B0 ledger already blames it. Capping this list needs no declaration:
   * a unit left out simply stays held at a sound bound.
   */
  private gate(plan: JointPlan, ledger: ReadonlyArray<LedgerEntry>): ReadonlyArray<UnitId> {
    const held = new Set(this.uncontrolled());
    if (held.size === 0) return [];
    let pool: UnitId[];
    if (this.cfg.gateOnEntanglement) {
      // TWO gates, unioned. The geometric one asks which claims meet a staged
      // path in sub-step time; the ledger asks which held units the resolver
      // actually blamed. Neither subsumes the other — a standing unit has no
      // path for the first to test, and the second only sees what one branch
      // happened to touch — and missing a unit here only loosens a floor, so
      // the union is the cheap side to err on.
      pool = [
        ...this.memo.entangled(footprintOf(plan)).filter((id) => held.has(id)),
        ...residueOf(ledger).filter((id) => held.has(id)),
      ];
    } else {
      pool = [...held];
    }
    const blame = new Map<UnitId, number>();
    for (const e of ledger) blame.set(e.unitId, (blame.get(e.unitId) ?? 0) + 1);
    return [...new Set(pool)].sort((a, b) => (blame.get(b) ?? 0) - (blame.get(a) ?? 0) || a - b);
  }
}
