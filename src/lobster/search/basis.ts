/**
 * The decision's BASIS — every assumption the search's scores ride on.
 *
 * The basis is derived from the CONTEXT, never from the plan, which is the
 * whole reason plan-to-plan comparison is legal inside one `improve` call:
 * two plans priced in the same context share a basis by construction, so
 * `compareFloors` never has to refuse and the ascent never has to guess.
 *
 * Three kinds enter here:
 *
 *  - OPERATOR PINS. A pinned decision is a different game from an unpinned
 *    one, so its scores are not comparable with the unpinned ones. The pin is
 *    not unsound — restricting our OWN options only lowers an achievable floor
 *    — it is INCOMPARABLE, which is what the assumption records.
 *  - REFERENCE ACTIONS. A teammate that is not ours to command is fixed to its
 *    declared intent rather than held: holding your own side is strictly
 *    looser AND strictly more expensive than fixing it. Fixing is an
 *    assumption about an agent, so it is declared and rides every score.
 *  - THE POSTURE. Carried through from whatever the governor decided, because
 *    a floor proved under one posture's channel weighting is not the same
 *    statement as one proved under another's.
 *
 * Tentative pins are deliberately absent: they are searched speculatively and
 * are never binding, so they must not condition a score the kernel might stage.
 */

import type {
  Assumption,
  Candidate,
  CandidateSet,
  SearchContext,
  UnitId,
} from "../contracts";
import { normalizeAssumptions } from "../bounds";

export function basisOf(ctx: SearchContext): ReadonlyArray<Assumption> {
  const out: Assumption[] = [];
  for (const pin of ctx.pins) {
    if (pin.tentative) continue;
    out.push({ kind: "operator-pin", unitId: pin.unitId, to: pin.to });
  }
  for (const assumption of ctx.incumbent?.bounds.assumptions ?? []) {
    if (assumption.kind === "reference-action" || assumption.kind === "posture") {
      out.push(assumption);
    }
  }
  return normalizeAssumptions(out);
}

/**
 * The concrete actions behind the `reference-action` assumptions: units that
 * are on our side but not ours to move, held to the action somebody else
 * declared for them.
 *
 * A reference action we cannot turn into a legal candidate is DROPPED rather
 * than approximated, and the unit then falls back to being held — looser, and
 * sound, which is the only direction this is allowed to fail in.
 */
export function referenceActionsOf(
  ctx: SearchContext,
  ourSets: ReadonlyMap<UnitId, CandidateSet>,
): ReadonlyMap<UnitId, Candidate> {
  const out = new Map<UnitId, Candidate>();
  for (const assumption of ctx.incumbent?.bounds.assumptions ?? []) {
    if (assumption.kind !== "reference-action") continue;
    if (ourSets.has(assumption.unitId)) continue; // ours to command: not a reference
    let set: CandidateSet;
    try {
      set = ctx.gen.candidatesFor(ctx.sub, assumption.unitId);
    } catch {
      continue;
    }
    const match =
      set.candidates.find((c) => c.to === assumption.to) ??
      set.prunedLedger.find((e) => e.candidate.to === assumption.to)?.candidate;
    if (match !== undefined) out.set(assumption.unitId, match);
  }
  return out;
}
