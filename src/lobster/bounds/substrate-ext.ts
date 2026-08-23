/**
 * The one capability the bound bank needs that `contracts.ts` does not yet
 * name, expressed as an OPTIONAL extension rather than a silent divergence.
 *
 * `Substrate` as pinned exposes `resolveBoundedFor(plan, asTeam)` over one
 * fixed hold configuration. Every rung of the bank above B0 has to change WHO
 * is held: B1 makes one enemy live and enumerates its complete option list,
 * B2 prices a plan against a concrete opponent joint, B3 makes the whole gated
 * set live at once. None of that is expressible against the pinned surface,
 * because `resolveBounded` refuses a partial assignment and a held unit is not
 * addressable by an order at all — naming a frozen unit in the plan is a
 * no-op, not a modelling decision.
 *
 * Proposed amendment (see the build report): add `withModelled` to `Substrate`.
 * Until the integrator lands it, the bank feature-DETECTS the method:
 *
 *   present → B1 / B2 / B3 are available;
 *   absent  → the bank runs B0 only, reports `modelling: false`, and every
 *             floor it produces is still sound, only looser.
 *
 * Degrading is safe in exactly one direction and this is it: holding a unit
 * is a sound relaxation of enumerating it (the held lemma), so a
 * bank with no modelling under-promises. The reverse — pretending an
 * un-modelled unit was enumerated — is the fatal bug class.
 */

import type { Substrate, UnitId } from "../contracts";

export interface ModellingSubstrate extends Substrate {
  /**
   * A sibling substrate over the SAME position in which every unit in
   * `modelled` is LIVE (so a plan must name it, and may name it with an
   * explicit action) and every other uncontrolled unit stays held.
   *
   * The sibling owns its own engine state: `release()` it independently, and
   * releasing it must not disturb the parent.
   */
  withModelled(modelled: ReadonlyArray<UnitId>): Substrate;
}

export function isModelling(sub: Substrate): sub is ModellingSubstrate {
  return typeof (sub as Partial<ModellingSubstrate>).withModelled === "function";
}

/**
 * A view with `modelled` live, plus the release the caller owes it. When the
 * substrate cannot model, the parent is returned with `modelling: false` and a
 * no-op release — the caller then knows its enumeration is not available and
 * must not claim a floor it did not compute.
 */
export interface ModelledView {
  readonly sub: Substrate;
  readonly modelling: boolean;
  release(): void;
}

/**
 * The second gap, smaller and with a cheaper workaround: the search cannot ask
 * a `Substrate` which units it commands. It needs the roster to build a plan
 * from nothing — the very first plan of a decision, before any incumbent
 * exists.
 *
 * Proposed amendment: add `commandable(asTeam)` to `Substrate`. Until then the
 * search derives the roster from the incumbent it was handed, and refuses with
 * an actionable error when it has neither. Refusing beats guessing: a plan
 * that silently omits a live unit is not a narrower plan, it is a crash inside
 * `resolveBounded`, which refuses partial assignments by design.
 */
export interface RosterSubstrate extends Substrate {
  /** Live units on `asTeam` that this decision is entitled to move. */
  commandable(asTeam: number): ReadonlyArray<UnitId>;
}

export function hasRoster(sub: Substrate): sub is RosterSubstrate {
  return typeof (sub as Partial<RosterSubstrate>).commandable === "function";
}

export function modelledView(sub: Substrate, modelled: ReadonlyArray<UnitId>): ModelledView {
  if (modelled.length === 0) return { sub, modelling: isModelling(sub), release: () => undefined };
  if (!isModelling(sub)) return { sub, modelling: false, release: () => undefined };
  const child = sub.withModelled(modelled);
  return { sub: child, modelling: true, release: () => child.release() };
}
