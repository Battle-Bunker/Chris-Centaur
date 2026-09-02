/**
 * Orderings, and the salt.
 *
 * Nothing here can change which plan is better — every function is either a
 * sweep order (which unit gets re-optimised first) or a tie-break among plans
 * the searcher is provably indifferent between. That separation is the point:
 * ordering is where all the cheap cleverness goes, and adjudication reads only
 * the proved floor.
 */

import type { Candidate, JointPlan, UnitId } from "../contracts";
import type { Resolution } from "../../partial-engine/index";
import { candidateKey } from "../bounds";

/**
 * A deterministic scramble, for INDIFFERENT tie-breaks only.
 *
 * Exact ties in (floor, est, ceiling) are positions the searcher genuinely
 * cannot tell apart, and it used to break them on cell index. Two identical
 * bots facing each other then break every tie the same way and walk into the
 * same square — and in this game a tie leaves nobody standing, so a mirror
 * match ends in mutual annihilation. Salting the tie key with the
 * per-decision seed desymmetrises them without touching a single decision the
 * searcher is not indifferent about.
 */
export function tieKey(key: string, salt: number): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ((h ^ Math.imul(salt + 1, 40503)) >>> 0) % 1000003;
}

/**
 * The plan's tie key: a SUM of its candidates' own keys, not a hash of the
 * whole joint string.
 *
 * The difference is the entire anti-dither fix. A hash of the joined plan is a
 * key in which every unit's contribution depends on every other unit's choice,
 * so a teammate moving one square re-rolls the tie-break for every unit whose
 * own options are tied — and a unit whose options are tied every turn (a piece,
 * before the command term was seated) then gets a fresh answer every turn. The
 * recorded signature is a pawn rotating left, right, left, right for six turns
 * without gaining a square (docs/BASIC-INTELLIGENCE.md).
 *
 * A sum DECOMPOSES. Two plans that differ only in unit A's candidate differ by
 * exactly the difference of A's two keys, whatever the rest of the plan is
 * doing — so the ordering among A's tied options is a property of A alone and
 * is the same this turn as it was last turn. It desymmetrises mirror matches
 * exactly as well as the hash did, because the per-candidate keys are still
 * salted, and it is still a total order over plans up to genuine collisions.
 */
export function planTieKey(plan: JointPlan, salt: number): number {
  let total = 0;
  for (const c of plan.values()) total += tieKey(candidateKey(c), salt);
  return total;
}

/** Every unit the resolution recorded as removed this turn. */
export function deadIn(resolution: Resolution): ReadonlySet<UnitId> {
  const out = new Set<UnitId>();
  for (const d of resolution.deaths) out.add(d.unitId);
  return out;
}

/** Units the resolution named in any collision — dead or merely involved. */
export function involvedIn(resolution: Resolution): ReadonlySet<UnitId> {
  const out = new Set<UnitId>();
  for (const clash of resolution.clashes) for (const id of clash.playerIDs) out.add(id);
  return out;
}

/**
 * DANGER ORDER: the unit whose situation is worst goes first, because that is
 * where a move change is worth the most. Deaths in the floor-justifying world
 * first, then anything the resolver named at all, then unit id so a sweep is
 * reproducible.
 *
 * Pinned units are not in the list at all: they are constraints, and a sweep
 * that tries to re-optimise one is a sweep that will eventually spend its
 * budget failing.
 */
export function dangerOrder(
  units: ReadonlyArray<UnitId>,
  resolution: Resolution | null,
  frozen: ReadonlySet<UnitId>,
): ReadonlyArray<UnitId> {
  const dead = resolution === null ? new Set<UnitId>() : deadIn(resolution);
  const involved = resolution === null ? new Set<UnitId>() : involvedIn(resolution);
  return [...units]
    .filter((id) => !frozen.has(id))
    .sort((a, b) => {
      const ra = dead.has(a) ? 0 : involved.has(a) ? 1 : 2;
      const rb = dead.has(b) ? 0 : involved.has(b) ? 1 : 2;
      return ra - rb || a - b;
    });
}

/**
 * The units a decision is most CONTESTED over — the joint-polish selection.
 * A unit the resolver keeps naming is one whose move is entangled with a
 * teammate's, and those are exactly the local optima a unit-at-a-time ascent
 * cannot leave.
 */
export function contestedUnits(
  units: ReadonlyArray<UnitId>,
  resolution: Resolution | null,
  frozen: ReadonlySet<UnitId>,
  limit: number,
): ReadonlyArray<UnitId> {
  if (resolution === null) return [];
  const weight = new Map<UnitId, number>();
  for (const clash of resolution.clashes) {
    for (const id of clash.playerIDs) weight.set(id, (weight.get(id) ?? 0) + 1);
    for (const id of clash.victimIDs) weight.set(id, (weight.get(id) ?? 0) + 3);
  }
  for (const entry of resolution.ledger) {
    weight.set(entry.liveId, (weight.get(entry.liveId) ?? 0) + 1);
  }
  return units
    .filter((id) => !frozen.has(id) && (weight.get(id) ?? 0) > 0)
    .sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0) || a - b)
    .slice(0, limit);
}

/**
 * SELF-INFLICTED PAIRS: pairs of OUR units where the resolver says one killed
 * the other. Coordinate ascent gets stuck on exactly these, because moving
 * either unit alone is no improvement while moving both is — so the 2-opt runs
 * over precisely the accidents the resolution names, and its cost is bounded
 * by the number of accidents rather than by the roster.
 */
export function selfInflictedPairs(
  resolution: Resolution,
  ours: ReadonlySet<UnitId>,
  plan: JointPlan,
): ReadonlyArray<readonly [UnitId, UnitId]> {
  const out: Array<readonly [UnitId, UnitId]> = [];
  const seen = new Set<string>();
  const push = (a: UnitId, b: UnitId): void => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push([a, b] as const);
  };

  for (const clash of resolution.clashes) {
    const involved = clash.playerIDs.filter((id) => ours.has(id));
    if (involved.length < 2) continue;
    const victims = clash.victimIDs.filter((id) => ours.has(id));
    if (victims.length === 0) continue;
    for (const victim of victims) for (const other of involved) push(victim, other);
  }
  if (out.length > 0) return out;

  // Fallback for a resolution that reports deaths without naming a clash: one
  // of ours died on a cell another of ours was heading for. This MISSES mutual
  // annihilations, where nobody is left standing — a real loss of coverage,
  // not a free substitution.
  for (const death of resolution.deaths) {
    if (!ours.has(death.unitId)) continue;
    for (const [unitId, candidate] of plan) {
      if (unitId === death.unitId || !ours.has(unitId)) continue;
      if (candidate.to === death.cell || candidate.path.includes(death.cell)) {
        push(death.unitId, unitId);
      }
    }
  }
  return out;
}

/**
 * Candidate order within a unit: the generator already returns them best-first
 * and the anytime path must never filter them, so this only takes a PREFIX.
 * Capping how many of OUR options we try is a max-side restriction — it can
 * only lower an achievable floor, so it needs no declaration.
 */
export function topCandidates(
  candidates: ReadonlyArray<Candidate>,
  cap: number,
): ReadonlyArray<Candidate> {
  return cap >= candidates.length ? candidates : candidates.slice(0, cap);
}
