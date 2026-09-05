/**
 * THE MACHINE-CHECKED ADMISSION HARNESS.
 *
 * This is what "take the bound story seriously" means operationally: the fold,
 * and every feature in it, is checked against the three laws BY BRUTE FORCE
 * over the actual world set — not by inspection of the code, and not by
 * reasoning about the code in a comment.
 *
 *   R1 SOUNDNESS     enumerate every completion of the held units through their
 *                    OWN grammar, put each one on the board as a real mover,
 *                    resolve the now-determinate turn, and assert
 *                    lo ≤ v ≤ hi.
 *   R2 MONOTONICITY  narrow a held unit to a subset of its own options and
 *                    assert the interval only shrinks.
 *   R3 COLLAPSE      with nothing held, lo === est === hi.
 *
 * R1 is the expensive one and it is the one that finds real bugs, because a
 * world here is not a model of a world: it is the same `resolveBounded` call
 * the evaluator itself makes, with the held unit named instead of claimed. The
 * enumeration and the thing being tested share no arithmetic at all — the only
 * thing they share is the resolver, which is the ground truth for both.
 *
 * Worlds come from the engine's ONE enumerator, so a world is by construction
 * an action the resolver would accept, and a grammar change moves the test and
 * the subject together.
 */

import type { Board as ApiBoard } from '../../types/battlesnake';
import type { Candidate, JointPlan, UnitId } from '../contracts';
import { EngineSubstrate, makeSubstrate } from '../substrate';
import type { BoundEvaluator } from './index';

export interface LawCase {
  readonly name: string;
  readonly board: ApiBoard;
  readonly turn: number;
  /** The wire team id this decision is for. */
  readonly asTeam: string;
  /** Wire ids of the units this decision stages. Everything else is a claim. */
  readonly stages: ReadonlyArray<string>;
  /** The staged destination for each of them, as a full-board cell index. */
  readonly orders: ReadonlyMap<string, number>;
  /** wire id → the turn it was last observed. Absent means "this turn". */
  readonly observedTurns?: ReadonlyMap<string, number>;
}

export interface LawResult {
  /** How many worlds (R1) or refinements (R2) were actually examined. */
  readonly checked: number;
  /** True when the world product was capped and the result proves less. */
  readonly truncated: boolean;
  /** Tightest slack seen on each side; large numbers mean a loose bound. */
  readonly worstSlackLo: number;
  readonly worstSlackHi: number;
  readonly violations: string[];
}

const EPS = 1e-6;

/** `a − b`, reading two equal lattice ends as zero slack rather than as NaN. */
function gap(a: number, b: number): number {
  if (a === b) return 0;
  const d = a - b;
  return Number.isNaN(d) ? 0 : d;
}

function substrateFor(c: LawCase, narrowings?: ReadonlyMap<string, ReadonlyArray<number>>) {
  return makeSubstrate({
    board: c.board,
    turn: c.turn,
    asTeam: c.asTeam,
    modeled: c.stages,
    observedTurns: c.observedTurns,
    narrowings,
  });
}

function planFor(sub: EngineSubstrate, c: LawCase): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const wireId of c.stages) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error(`law case ${c.name}: no unit ${wireId}`);
    const to = c.orders.get(wireId);
    if (to === undefined) throw new Error(`law case ${c.name}: no order for ${wireId}`);
    plan.set(unit.unitId, { unitId: unit.unitId, from: -1, to, path: sub.pathFor(unit.unitId, to) ?? [] });
  }
  return plan;
}

/** The units a case leaves as claims: everything it does not stage. */
export function heldOf(sub: EngineSubstrate, c: LawCase): UnitId[] {
  const staged = new Set(c.stages);
  return sub
    .roster()
    .filter((u) => !staged.has(u.wireId))
    .map((u) => u.unitId);
}

/**
 * Every completion world, as a full plan. One entry per held unit per
 * enumerated action, taken as a product and capped.
 */
export function* worldsOf(
  sub: EngineSubstrate,
  c: LawCase,
  cap = 400
): Generator<{ plan: JointPlan; truncated: boolean }> {
  const base = planFor(sub, c);
  const held = heldOf(sub, c);
  if (held.length === 0) {
    yield { plan: base, truncated: false };
    return;
  }
  let rosters: Array<Map<UnitId, Candidate>> = [new Map(base)];
  let truncated = false;
  for (const unitId of held) {
    const actions = sub.actionsOf(unitId);
    const next: Array<Map<UnitId, Candidate>> = [];
    for (const roster of rosters) {
      for (const action of actions) {
        if (next.length >= cap) {
          truncated = true;
          break;
        }
        const extended = new Map(roster);
        extended.set(unitId, action);
        next.push(extended);
      }
      if (truncated) break;
    }
    rosters = next;
  }
  for (const plan of rosters) yield { plan, truncated };
}

/**
 * R1 — for every world consistent with the claims, the determinate value lies
 * inside the interval.
 *
 * A world is also asserted to be a POINT: a plan naming every unit leaves
 * nothing held, so a non-collapsed interval there is an R3 failure that would
 * otherwise hide inside R1's comparison.
 */
export function checkSoundness(evaluator: BoundEvaluator, c: LawCase, cap = 400): LawResult {
  const sub = substrateFor(c);
  const violations: string[] = [];
  let checked = 0;
  let truncated = false;
  let slackLo = Number.POSITIVE_INFINITY;
  let slackHi = Number.POSITIVE_INFINITY;
  try {
    const partial = evaluator.evaluatePlan(sub, planFor(sub, c), sub.teamNumber(c.asTeam));
    for (const world of worldsOf(sub, c, cap)) {
      truncated = truncated || world.truncated;
      const v = evaluator.evaluatePlan(sub, world.plan, sub.teamNumber(c.asTeam));
      checked++;
      if (v.bound.lo !== v.bound.hi) {
        violations.push(
          `${c.name}: a determinate world produced an interval ${JSON.stringify(v.bound)}`
        );
      }
      if (v.bound.lo < partial.bound.lo - EPS) {
        violations.push(
          `${c.name}: R1 lo — world ${v.bound.lo} < lo ${partial.bound.lo}`
        );
      }
      if (v.bound.hi > partial.bound.hi + EPS) {
        violations.push(
          `${c.name}: R1 hi — world ${v.bound.hi} > hi ${partial.bound.hi}`
        );
      }
      // Two lattice ends subtract to NaN; that is agreement, not slack.
      slackLo = Math.min(slackLo, gap(v.bound.lo, partial.bound.lo));
      slackHi = Math.min(slackHi, gap(partial.bound.hi, v.bound.hi));
    }
  } finally {
    sub.release();
  }
  return { checked, truncated, worstSlackLo: slackLo, worstSlackHi: slackHi, violations };
}

/**
 * R2 — narrowing a held unit to a subset of its own options may only shrink the
 * interval.
 *
 * A narrowing is an ASSUMPTION the caller owns, and the value it produces
 * carries a different basis; comparing across bases is exactly what basis
 * identity forbids everywhere else. It is legitimate HERE and only here,
 * because the narrowed world set is a subset of the free one, which is what the
 * law is about.
 */
export function checkMonotone(evaluator: BoundEvaluator, c: LawCase): LawResult {
  const violations: string[] = [];
  let checked = 0;
  const free = substrateFor(c);
  let before: { lo: number; hi: number };
  let held: UnitId[];
  try {
    before = evaluator.evaluatePlan(free, planFor(free, c), free.teamNumber(c.asTeam)).bound;
    held = heldOf(free, c);
    for (const unitId of held) {
      const wireId = free.unitOf(unitId)?.wireId as string;
      const actions = free.actionsOf(unitId);
      if (actions.length < 2) continue;
      for (const size of [1, Math.max(1, Math.floor(actions.length / 2))]) {
        const subset = actions.slice(0, size).map((a) => a.to);
        const narrowed = substrateFor(c, new Map([[wireId, subset]]));
        try {
          const after = evaluator.evaluatePlan(
            narrowed,
            planFor(narrowed, c),
            narrowed.teamNumber(c.asTeam)
          ).bound;
          checked++;
          if (after.lo < before.lo - EPS) {
            violations.push(
              `${c.name}: R2 lo fell on refinement of ${wireId} — ${before.lo} -> ${after.lo}`
            );
          }
          if (after.hi > before.hi + EPS) {
            violations.push(
              `${c.name}: R2 hi rose on refinement of ${wireId} — ${before.hi} -> ${after.hi}`
            );
          }
        } finally {
          narrowed.release();
        }
      }
    }
  } finally {
    free.release();
  }
  return {
    checked,
    truncated: false,
    worstSlackLo: 0,
    worstSlackHi: 0,
    violations,
  };
}

/** R3 — nothing held means a point, visibly rather than by assertion. */
export function checkCollapse(evaluator: BoundEvaluator, c: LawCase): LawResult {
  const sub = substrateFor({ ...c, stages: allWireIds(c) });
  const violations: string[] = [];
  try {
    const all = new Map<UnitId, Candidate>();
    for (const unit of sub.roster()) {
      const to = c.orders.get(unit.wireId);
      const dest = to ?? (sub.actionsOf(unit.unitId)[0]?.to as number);
      all.set(unit.unitId, {
        unitId: unit.unitId,
        from: -1,
        to: dest,
        path: sub.pathFor(unit.unitId, dest) ?? [],
      });
    }
    const v = evaluator.evaluatePlan(sub, all, sub.teamNumber(c.asTeam));
    if (!(v.bound.lo === v.bound.hi && v.bound.est === v.bound.lo)) {
      violations.push(
        `${c.name}: R3 — a determinate position produced ${JSON.stringify(v.bound)}`
      );
    }
    if (!v.exact) {
      violations.push(`${c.name}: R3 — a determinate position was not reported exact`);
    }
    return { checked: 1, truncated: false, worstSlackLo: 0, worstSlackHi: 0, violations };
  } finally {
    sub.release();
  }
}

/** Every unit on the case's board, by wire id. R3 stages all of them. */
function allWireIds(c: LawCase): string[] {
  return (c.board.snakes ?? []).map((s) => s.id);
}
