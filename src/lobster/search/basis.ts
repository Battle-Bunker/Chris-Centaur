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
 *  - REFERENCE ACTIONS AND NARROWINGS, from `ctx.assumptions` — the standing
 *    basis the kernel threads through every context of a decision (contract
 *    A6). A teammate that is not ours to command is fixed to its declared
 *    intent rather than held; a unit modelled at its default because the held
 *    set overflowed MAX_FROZEN arrives the same way, with `to: NO_ORDER_MOVE`.
 *  - THE POSTURE, carried on `ctx.assumptions` too, because a floor proved
 *    under one posture's channel weighting is not the same statement as one
 *    proved under another's.
 *
 * Tentative pins are deliberately absent: they are searched speculatively and
 * are never binding, so they must not condition a score the kernel might stage.
 */

import { NO_ORDER_MOVE } from "../contracts";
import type {
  Assumption,
  Candidate,
  CandidateGenerator,
  CandidateSet,
  SearchContext,
  Substrate,
  UnitId,
} from "../contracts";
import { normalizeAssumptions } from "../bounds";

export function basisOf(ctx: SearchContext): ReadonlyArray<Assumption> {
  const out: Assumption[] = [];
  for (const pin of ctx.pins) {
    if (pin.tentative) continue;
    out.push({ kind: "operator-pin", unitId: pin.unitId, to: pin.to });
  }
  out.push(...ctx.assumptions);
  return normalizeAssumptions(out);
}

/**
 * The concrete actions behind the `reference-action` assumptions: units that
 * are not ours to move, held to the action somebody else declared for them.
 *
 * A reference with `to: NO_ORDER_MOVE` is the KIND's own default action and is
 * always constructible — the engine accepts the sentinel for any live unit.
 * Any other reference must resolve to an offered candidate; one we cannot
 * turn into a legal candidate is DROPPED rather than approximated, and the
 * unit then falls back to being held — looser, and sound, which is the only
 * direction this is allowed to fail in.
 */
export function referenceActionsOf(
  ctx: SearchContext,
  ourSets: ReadonlyMap<UnitId, CandidateSet>,
): ReadonlyMap<UnitId, Candidate> {
  return referenceActionsFrom(ctx.sub, ctx.gen, ctx.assumptions, ourSets);
}

/**
 * The same derivation from the PARTS rather than from a `SearchContext`.
 *
 * An evaluation worker (`lobster/parallel`) has to build the identical
 * reference map for its own bank and has no context to build it from — it is
 * handed a substrate, a generator and a basis. Splitting the function this way
 * is what keeps the two sides from growing two derivations: there is one, and
 * `referenceActionsOf` is the context-shaped door onto it.
 */
export function referenceActionsFrom(
  sub: Substrate,
  gen: CandidateGenerator,
  assumptions: ReadonlyArray<Assumption>,
  ourSets: ReadonlyMap<UnitId, CandidateSet>,
): ReadonlyMap<UnitId, Candidate> {
  const out = new Map<UnitId, Candidate>();
  for (const assumption of assumptions) {
    if (assumption.kind !== "reference-action") continue;
    if (ourSets.has(assumption.unitId)) continue; // ours to command: not a reference
    if (assumption.to === NO_ORDER_MOVE) {
      out.set(assumption.unitId, {
        unitId: assumption.unitId,
        from: NO_ORDER_MOVE,
        to: NO_ORDER_MOVE,
        path: [],
      });
      continue;
    }
    // The unit is HELD on the decision's own substrate — its options are only
    // enumerable on a modelled sibling, whose release must not disturb the
    // parent (the sibling contract).
    let set: CandidateSet;
    const view = sub.withModelled([assumption.unitId]);
    try {
      set = gen.candidatesFor(view, assumption.unitId, "adversary");
    } catch {
      continue;
    } finally {
      view.release();
    }
    const match =
      set.candidates.find((c) => c.to === assumption.to) ??
      set.prunedLedger.find((e) => e.candidate.to === assumption.to)?.candidate;
    if (match !== undefined) out.set(assumption.unitId, match);
  }
  return out;
}
