/**
 * JointPlan plumbing shared by the bank and the search.
 *
 * A `JointPlan` is a complete legal assignment for every unit this decision
 * stages. Two rules ride on it everywhere below:
 *
 *  - PATH IDENTITY. Two candidates with the same destination are NOT the same
 *    move: a rook that stops short because a capture halted it took a
 *    different path, and the prefix is what the resolver adjudicates. So the
 *    canonical key of a plan is over paths, never over destinations.
 *  - COMPLETENESS. `resolveBounded` refuses a partial assignment, so a plan
 *    that omits a live unit is a crash, not a default. Every construction here
 *    returns a plan that is complete with respect to the plan it derived from.
 */

import type { Candidate, CellIndex, JointPlan, SubStep, UnitId } from "../contracts";

/**
 * A canonical, order-free key for a plan. Path-sensitive (see PATH IDENTITY);
 * cheap enough to be a memo key on the hot path.
 */
export function planKey(plan: JointPlan): string {
  const parts: string[] = [];
  for (const [unitId, candidate] of plan) {
    parts.push(`${unitId}>${candidate.to}#${candidate.path.join(".")}`);
  }
  parts.sort();
  return parts.join("|");
}

export function candidateKey(c: Candidate): string {
  return `${c.unitId}>${c.to}#${c.path.join(".")}`;
}

export function sameCandidate(a: Candidate, b: Candidate): boolean {
  return candidateKey(a) === candidateKey(b);
}

/** A plan with one unit re-assigned. The original is untouched. */
export function withMove(plan: JointPlan, candidate: Candidate): JointPlan {
  const next = new Map(plan);
  next.set(candidate.unitId, candidate);
  return next;
}

/** A plan with several units re-assigned at once — the pair/polish path. */
export function withMoves(plan: JointPlan, candidates: ReadonlyArray<Candidate>): JointPlan {
  const next = new Map(plan);
  for (const c of candidates) next.set(c.unitId, c);
  return next;
}

/**
 * The cells a plan touches, with the sub-step each is entered at. This is what
 * `Substrate.entangled` is asked about, and the sub-step precision is what
 * stops a long ray from being condemned for cells nothing can reach in time.
 *
 * `Candidate.path` is the cells ENTERED, in order, origin excluded — the
 * engine's own `UnitAction.path` shape. Sub-step `i + 1` for `path[i]`.
 */
export function footprintOf(plan: JointPlan): ReadonlyArray<{ cell: CellIndex; subStep: SubStep }> {
  const out: { cell: CellIndex; subStep: SubStep }[] = [];
  for (const candidate of plan.values()) {
    // A path-less candidate (a stay, a rotate) contributes NOTHING here, and
    // deliberately. `Candidate.to` is the staged ORDER, not a cell the unit
    // stands on — for a rotate it is whichever destination encodes the turn —
    // so treating it as occupancy would gate on a cell nobody is at. The unit
    // still gets covered: the B0 resolution's entanglement ledger names every
    // held unit that could have changed the outcome, standing units included,
    // and the gate unions the two.
    candidate.path.forEach((cell, i) => out.push({ cell, subStep: (i + 1) as SubStep }));
  }
  return out;
}

/** Every cell any unit in the plan stands on or crosses. */
export function cellsOf(plan: JointPlan): ReadonlySet<CellIndex> {
  const out = new Set<CellIndex>();
  for (const candidate of plan.values()) {
    for (const cell of candidate.path) out.add(cell);
    out.add(candidate.to);
  }
  return out;
}

export function unitsOf(plan: JointPlan): ReadonlyArray<UnitId> {
  return [...plan.keys()].sort((a, b) => a - b);
}
