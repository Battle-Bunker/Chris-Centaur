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
 * INTERNED CANDIDATE KEYS.
 *
 * A `Candidate` is an immutable value the generator produces once per unit per
 * decision and the search then puts into thousands of plans; its key is a pure
 * function of it, and building that key means a `path.join` plus a three-part
 * template. `planKey` was measured at 3.9% of a one-second decision's self
 * time, essentially all of it here, re-deriving the same eight strings.
 *
 * Keyed on the candidate OBJECT, so nothing about a plan's mutability is
 * assumed: a plan is a `ReadonlyMap` by contract, but plans are BUILT by
 * mutation (`new Map(); ...set()`), and a cache on the plan would serve a
 * half-built answer to anyone who asked for a key mid-build. A candidate has no
 * such phase — the generator returns it finished.
 */
const CANDIDATE_KEYS = new WeakMap<object, string>();

function keyOfCandidate(c: Candidate): string {
  const hit = CANDIDATE_KEYS.get(c as unknown as object);
  if (hit !== undefined) return hit;
  const made = `${c.unitId}>${c.to}#${c.path.join(".")}`;
  CANDIDATE_KEYS.set(c as unknown as object, made);
  return made;
}

/** Scratch for `planKey`'s parts. The function calls nothing that can re-enter
 * it, so one array serves every call; the sort and the join are what remain. */
const partScratch: string[] = [];

/**
 * A canonical, order-free key for a plan. Path-sensitive (see PATH IDENTITY);
 * cheap enough to be a memo key on the hot path.
 */
export function planKey(plan: JointPlan): string {
  const parts = partScratch;
  parts.length = 0;
  for (const [unitId, candidate] of plan) {
    // The map key is the identity the plan is INDEXED by; `candidate.unitId` is
    // what the candidate says about itself. They agree everywhere in this
    // repository, and where they would not, the interned key would be a lie —
    // so that case builds its own string.
    parts.push(
      unitId === candidate.unitId
        ? keyOfCandidate(candidate)
        : `${unitId}>${candidate.to}#${candidate.path.join(".")}`,
    );
  }
  parts.sort();
  return parts.join("|");
}

export function candidateKey(c: Candidate): string {
  return keyOfCandidate(c);
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
 * The cells a plan touches, with the sub-step WINDOW each is occupied over.
 * This is what `Substrate.entangled` is asked about, and the sub-step
 * precision is what stops a long ray from being condemned for cells nothing
 * can reach in time.
 *
 * `Candidate.path` is the cells ENTERED, in order, origin excluded — the
 * engine's own `UnitAction.path` shape. A cell passed through occupies
 * `[i + 1, i + 1]`; the LAST path cell is where the move comes to rest, so its
 * window stays open to the end of the turn (`Number.MAX_SAFE_INTEGER` — the
 * conservative reading the entanglement contract requires; a capture-stop
 * that halts the move short only ever rests EARLIER on the same path, which
 * this window covers).
 *
 * A path-less candidate (a stay, a rotate) is gated on `from` — the one cell
 * such a candidate actually stands on (`to` is the staged ORDER; for a rotate
 * it is whichever destination encodes the turn). When a hand-built candidate
 * carries no usable `from` (NO_ORDER_MOVE), it contributes nothing here and
 * the unit is still covered: the B0 resolution's entanglement ledger names
 * every held unit that could have changed the outcome, standing units
 * included, and the gate unions the two.
 */
export function footprintOf(
  plan: JointPlan,
): ReadonlyArray<{ cell: CellIndex; fromSubStep: SubStep; toSubStep: SubStep }> {
  const out: { cell: CellIndex; fromSubStep: SubStep; toSubStep: SubStep }[] = [];
  for (const candidate of plan.values()) {
    if (candidate.path.length === 0) {
      if (candidate.from >= 0) {
        out.push({ cell: candidate.from, fromSubStep: 0, toSubStep: Number.MAX_SAFE_INTEGER });
      }
      continue;
    }
    const last = candidate.path.length - 1;
    candidate.path.forEach((cell, i) =>
      out.push({
        cell,
        fromSubStep: (i + 1) as SubStep,
        toSubStep: i === last ? Number.MAX_SAFE_INTEGER : ((i + 1) as SubStep),
      }),
    );
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
