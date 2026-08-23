/**
 * EXHAUSTIVE GROUND TRUTH over the REAL substrate.
 *
 * The idiom is `src/lobster/bounds/testkit.ts`'s `trueWorstCase` — enumerate
 * every uncontrolled unit's COMPLETE option list, resolve with nothing held,
 * take the minimum — but re-expressed against `EngineSubstrate` /
 * `GrammarCandidateGenerator` rather than the testkit's own `TestSubstrate`,
 * because the operator lane must measure the components the wire actually
 * runs. The testkit is not modified and not imported: its board vocabulary is
 * `BoardSpec`, and the boards here are the repository's api-coordinate
 * `Board`s that the team decision engine is handed.
 *
 * Two rules carried over verbatim from the testkit:
 *   - the ground truth is computed by the SAME resolver the bounds are, with
 *     nothing held, so a second encoding of the rules is never introduced;
 *   - every live unit is named on every resolve, because `resolveBounded`
 *     refuses a partial assignment by design.
 */

import type { Board as ApiBoard } from '../../src/types/battlesnake';
import type { Candidate, JointPlan, UnitId } from '../../src/lobster/contracts';
import { makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';

export interface TruthOptions {
  readonly board: ApiBoard;
  readonly turn: number;
  readonly ourTeam: string;
  /** Hard stop on the enumeration, so a mis-sized board fails loudly. */
  readonly maxPlans?: number;
  readonly maxReplies?: number;
}

export interface PlanTruth {
  readonly plan: JointPlan;
  readonly key: string;
  /** min over every complete enemy reply of the exact resolved value. */
  readonly value: number;
  readonly worstReply: ReadonlyMap<UnitId, Candidate>;
}

export interface TruthTable {
  readonly plans: ReadonlyArray<PlanTruth>;
  readonly ourIds: ReadonlyArray<UnitId>;
  readonly enemyIds: ReadonlyArray<UnitId>;
  readonly optionsOf: ReadonlyMap<UnitId, ReadonlyArray<Candidate>>;
  readonly replySpace: number;
  readonly resolutions: number;
  /** unit wire id → substrate unit id. */
  readonly idOf: ReadonlyMap<string, UnitId>;
}

const keyOf = (plan: JointPlan, ids: ReadonlyArray<UnitId>): string =>
  ids.map((id) => `${id}>${plan.get(id)?.to}`).join(',');

/**
 * Every joint plan of ours, each priced at its TRUE worst case by exhaustive
 * enumeration of every enemy reply. Nothing is held anywhere in here.
 */
export function groundTruth(options: TruthOptions): TruthTable {
  const sub = makeSubstrate({
    board: options.board,
    turn: options.turn,
    asTeam: options.ourTeam,
    // Everything modelled: the claim view must not colour the ground truth.
    modeled: (options.board.snakes ?? []).map((s) => s.id),
  });
  try {
    const gen = new GrammarCandidateGenerator();
    const asTeam = sub.teamNumber(options.ourTeam);
    const ourIds = [...sub.commandable(asTeam)].sort((a, b) => a - b);
    const enemyIds = sub
      .roster()
      .filter((u) => u.team !== asTeam)
      .map((u) => u.unitId)
      .sort((a, b) => a - b);

    const optionsOf = new Map<UnitId, ReadonlyArray<Candidate>>();
    for (const id of ourIds) optionsOf.set(id, gen.candidatesFor(sub, id).candidates);
    for (const id of enemyIds) {
      optionsOf.set(id, gen.candidatesFor(sub, id, 'adversary').candidates);
    }

    const planSpace = ourIds.reduce((n, id) => n * (optionsOf.get(id) as Candidate[]).length, 1);
    const replySpace = enemyIds.reduce((n, id) => n * (optionsOf.get(id) as Candidate[]).length, 1);
    if (planSpace > (options.maxPlans ?? 400)) {
      throw new Error(`ground truth refused: ${planSpace} plans exceeds the cap`);
    }
    if (replySpace > (options.maxReplies ?? 200)) {
      throw new Error(`ground truth refused: ${replySpace} replies exceeds the cap`);
    }

    // Every complete enemy reply, once.
    const replies: Array<ReadonlyMap<UnitId, Candidate>> = [];
    const walkReplies = (i: number, acc: Candidate[]): void => {
      const id = enemyIds[i];
      if (id === undefined) {
        replies.push(new Map(acc.map((c) => [c.unitId, c])));
        return;
      }
      for (const c of optionsOf.get(id) as Candidate[]) walkReplies(i + 1, [...acc, c]);
    };
    walkReplies(0, []);

    let resolutions = 0;
    const plans: PlanTruth[] = [];
    const walkPlans = (i: number, acc: Candidate[]): void => {
      const id = ourIds[i];
      if (id === undefined) {
        const plan: JointPlan = new Map(acc.map((c) => [c.unitId, c]));
        let value = Number.POSITIVE_INFINITY;
        let worstReply: ReadonlyMap<UnitId, Candidate> = new Map();
        for (const reply of replies) {
          const full = new Map(plan);
          for (const [unitId, c] of reply) full.set(unitId, c);
          resolutions++;
          // Nothing held: the bracket is a point, so this IS the value.
          const bound = materialEvaluator.scorePlan(sub, full, asTeam);
          if (bound.lo < value) {
            value = bound.lo;
            worstReply = reply;
          }
        }
        plans.push({ plan, key: keyOf(plan, ourIds), value, worstReply });
        return;
      }
      for (const c of optionsOf.get(id) as Candidate[]) walkPlans(i + 1, [...acc, c]);
    };
    walkPlans(0, []);

    const idOf = new Map<string, UnitId>();
    for (const u of sub.roster()) idOf.set(u.wireId, u.unitId);

    return { plans, ourIds, enemyIds, optionsOf, replySpace, resolutions, idOf };
  } finally {
    sub.release();
  }
}

/** The true best achievable worst-case value, optionally under a constraint. */
export function bestUnder(
  table: TruthTable,
  constraint?: { readonly unitId: UnitId; readonly to: number }
): { value: number; plan: PlanTruth | null } {
  let best = Number.NEGATIVE_INFINITY;
  let plan: PlanTruth | null = null;
  for (const p of table.plans) {
    if (constraint !== undefined && p.plan.get(constraint.unitId)?.to !== constraint.to) continue;
    if (p.value > best) {
      best = p.value;
      plan = p;
    }
  }
  return { value: best, plan };
}
