/**
 * HISTORICAL SEAM, kept as a compatibility shim.
 *
 * `withModelled` and `commandable` began life here as feature-detected
 * OPTIONAL extensions while the pinned `Substrate` lacked them; the unified
 * contract adopted both (B2 amendments A1/A3), so every substrate now carries
 * them and the extension types collapse into `Substrate` itself. The
 * predicates and `modelledView` remain because the bank still speaks through
 * them — and because feature detection is the honest posture toward a
 * substrate object that arrived over a seam this module does not control:
 * absent capability still degrades to B0-only, never to a wrong floor.
 *
 * Degrading is safe in exactly one direction and this is it: holding a unit
 * is a sound relaxation of enumerating it (the held lemma), so a bank with no
 * modelling under-promises. The reverse — pretending an un-modelled unit was
 * enumerated — is the fatal bug class.
 */

import type { Substrate, UnitId } from "../contracts";

export type ModellingSubstrate = Substrate;
export type RosterSubstrate = Substrate;

export function isModelling(sub: Substrate): sub is ModellingSubstrate {
  return typeof (sub as Partial<Substrate>).withModelled === "function";
}

export function hasRoster(sub: Substrate): sub is RosterSubstrate {
  return typeof (sub as Partial<Substrate>).commandable === "function";
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

export function modelledView(sub: Substrate, modelled: ReadonlyArray<UnitId>): ModelledView {
  if (modelled.length === 0) return { sub, modelling: isModelling(sub), release: () => undefined };
  if (!isModelling(sub)) return { sub, modelling: false, release: () => undefined };
  const child = sub.withModelled(modelled);
  return { sub: child, modelling: true, release: () => child.release() };
}
