/**
 * Witnesses — the double oracle's column generation, and the one law that
 * makes them safe.
 *
 * A witness is a CONCRETE opponent joint reply that was found to punish some
 * plan. Because the security value is a minimum over every reply, a witness's
 * value is an UPPER bound certificate: `SV(a) ≤ V(a, w)` for every witness
 * `w`, whatever plan `a` is. That is why a witness found while examining one
 * plan is still meaningful against another, why the set survives restarts and
 * pin-context switches, and why it is the cheapest possible memory a search
 * can carry between corners.
 *
 * THE LAW: the ascent may not choose a plan a witness refutes without the
 * witness being RE-PRICED against that plan. Refutation is not a property of
 * the witness — it is a property of the (plan, witness) pair, and reusing a
 * verdict computed against a different plan is how a double oracle silently
 * turns into a restricted game it has forgotten it restricted. `BoundBank`
 * enforces this structurally: every banked witness is evaluated against every
 * plan it prices, so a plan's ceiling always accounts for the whole set.
 */

import type { Candidate, UnitId, Witness } from "../contracts";

/** A canonical identity for a witness, path-sensitive like every plan key. */
export function witnessKey(w: Witness): string {
  return [...w.replies.values()]
    .map((c) => `${c.unitId}>${c.to}#${c.path.join(".")}`)
    .sort()
    .join("|");
}

export function sameWitness(a: Witness, b: Witness): boolean {
  return witnessKey(a) === witnessKey(b);
}

export function witnessOf(replies: ReadonlyArray<Candidate>, note: string): Witness {
  return { replies: new Map(replies.map((c) => [c.unitId, c])), note };
}

export function witnessUnits(w: Witness): ReadonlyArray<UnitId> {
  return [...w.replies.keys()].sort((a, b) => a - b);
}

/**
 * A plan is REFUTED at `floor` when some reply the search has already seen
 * holds it below that floor. Read with the plan's OWN re-priced ceiling, this
 * is the veto the ascent obeys: a plan whose ceiling has fallen below the
 * incumbent's proved floor cannot be an improvement, however good its own
 * floor looks under a looser member.
 */
export function refutedAt(ceiling: number, floor: number): boolean {
  return ceiling < floor;
}

/**
 * De-duplicating accumulator. Kept separate from the bank so a caller can
 * carry one set across restarts, pin epochs and whole decisions.
 */
export class WitnessSet {
  private readonly keys = new Set<string>();
  private readonly list: Witness[] = [];

  constructor(seed: ReadonlyArray<Witness> = []) {
    for (const w of seed) this.add(w);
  }

  add(w: Witness): boolean {
    const key = witnessKey(w);
    if (key.length === 0 || this.keys.has(key)) return false;
    this.keys.add(key);
    this.list.push(w);
    return true;
  }

  get all(): ReadonlyArray<Witness> {
    return this.list;
  }

  get size(): number {
    return this.list.length;
  }
}
