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
 * THE TWO KEY CACHES — pure memoisation, no key or ordering change.
 *
 * `planKey` is the hottest string in the system: a priced branch asks for it
 * once itself, the resolution memo asks for it again on the bank's door and a
 * third time on the evaluator's, and the substrate's settlement cache asks a
 * fourth. Measured on `mixed 20 1 --nodes`: 376 484 calls, 2.1% of total self
 * time, all of it rebuilding strings that are a function of nothing but the
 * plan object handed in.
 *
 * Both caches are `WeakMap`s keyed on the object, so they add no lifetime to
 * anything and hold nothing past a decision. Both are sound because a
 * `Candidate` is an immutable value object and a `JointPlan` is a
 * `ReadonlyMap` that every construction site here (and in the search, the
 * bank and the telemetry) fills COMPLETELY before anyone keys it — `withMove`
 * and `withMoves` copy rather than mutate, which is the invariant that makes
 * a plan's key a property of the object.
 */
const keyScratch: string[] = [];
const candidateTails = new WeakMap<Candidate, string>();
const candidateKeys = new WeakMap<Candidate, string>();
const planKeys = new WeakMap<object, string>();

/**
 * THE PLAN THAT CARRIES ITS OWN KEY.
 *
 * `planKey` is asked 1 257 491 times over 612 421 distinct plan objects on
 * `mixed 20 1 --nodes`, and the `WeakMap` above served every one of them: a
 * hashed lookup on the hit and a hashed lookup plus an insert on the miss,
 * about four million ephemeron operations a run, on the frame measured at 9.1%
 * of the kernel's own decision time.
 *
 * Almost every one of those plans is made HERE — `withMove` and `withMoves`
 * are what the search, the bank's reply sweep and the polish pass all build
 * with — so those two hand back a `Map` subclass with one extra field and the
 * lookup becomes a monomorphic property load. Nothing else changes: the field
 * holds exactly the string the `WeakMap` held, computed by exactly the same
 * `buildKey` below, and a plan built any other way (a literal `new Map`, a
 * test fixture, `exact-reply`'s copy) still goes through the `WeakMap`. The
 * key's VALUE, its ordering and every cache keyed on it are untouched.
 *
 * It is sound for the same reason the `WeakMap` was: a plan is filled
 * completely before anyone keys it, and `withMove`/`withMoves` copy rather
 * than mutate, so the key is a property of the object. The field is written
 * once, lazily, and never invalidated because nothing can change the plan it
 * describes.
 */
class KeyedPlan extends Map<UnitId, Candidate> {
  /** `planKey`'s answer for THIS object; `undefined` until first asked. */
  cachedKey: string | undefined = undefined;
}

/** The sortedness watch `pushPart` keeps for the call it is inside. */
let keyOrdered = true;
let keyPrevious = "";

/**
 * One plan entry's part, appended to the scratch. A plan keys a candidate
 * under its OWN unit id in every construction in this repo, and the part is
 * then the candidate's own key — cached on the candidate, which a decision
 * reuses across hundreds of plans. The general case is still built, so the
 * string is what it always was either way.
 */
const pushPart = (candidate: Candidate, unitId: UnitId): void => {
  const part =
    unitId === candidate.unitId ? candidateKey(candidate) : `${unitId}>${tailOf(candidate)}`;
  if (part < keyPrevious) keyOrdered = false;
  keyPrevious = part;
  keyScratch.push(part);
};

/** `to#path` — the half of a candidate key that does not name the unit. */
function tailOf(c: Candidate): string {
  const hit = candidateTails.get(c);
  if (hit !== undefined) return hit;
  const made = `${c.to}#${c.path.join(".")}`;
  candidateTails.set(c, made);
  return made;
}

/**
 * A canonical, order-free key for a plan. Path-sensitive (see PATH IDENTITY);
 * cheap enough to be a memo key on the hot path.
 */
export function planKey(plan: JointPlan): string {
  if (plan instanceof KeyedPlan) {
    const own = plan.cachedKey;
    if (own !== undefined) return own;
    const made = buildKey(plan);
    plan.cachedKey = made;
    return made;
  }
  const hit = planKeys.get(plan as object);
  if (hit !== undefined) return hit;
  const made = buildKey(plan);
  planKeys.set(plan as object, made);
  return made;
}

/** The key itself, unchanged: the sorted join of one part per entry. */
function buildKey(plan: JointPlan): string {
  // ONE scratch array for the whole process: `planKey` neither recurses nor
  // yields, and the array's contents are consumed before it returns.
  const parts = keyScratch;
  parts.length = 0;
  // The sort is what makes the key order-free, and a plan derived from another
  // by `withMove` almost always arrives already in it — a `Map` keeps a
  // re-`set` key in place. Checking costs one comparison per part and skips a
  // sort that would produce the same array; the ORDER is unchanged either way.
  // `forEach` RATHER THAN `for…of`: destructuring a `Map` entry allocates the
  // [key, value] pair on every step, and this loop runs seven times on each of
  // the 153 000 plans a 20-turn `mixed` decision sweep sees — a million arrays
  // of pure garbage on the hottest path in the system. The callback is a
  // module constant (`planKey` neither recurses nor yields, so the scratch it
  // writes cannot be re-entered), so it costs no allocation of its own.
  keyOrdered = true;
  keyPrevious = "";
  plan.forEach(pushPart);
  if (!keyOrdered) parts.sort();
  return parts.join("|");
}

export function candidateKey(c: Candidate): string {
  const hit = candidateKeys.get(c);
  if (hit !== undefined) return hit;
  const made = `${c.unitId}>${tailOf(c)}`;
  candidateKeys.set(c, made);
  return made;
}

export function sameCandidate(a: Candidate, b: Candidate): boolean {
  return candidateKey(a) === candidateKey(b);
}

/** A plan with one unit re-assigned. The original is untouched. */
export function withMove(plan: JointPlan, candidate: Candidate): JointPlan {
  const next = new KeyedPlan(plan);
  next.set(candidate.unitId, candidate);
  return next;
}

/** A plan with several units re-assigned at once — the pair/polish path. */
export function withMoves(plan: JointPlan, candidates: ReadonlyArray<Candidate>): JointPlan {
  const next = new KeyedPlan(plan);
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
