/**
 * THE ONE TRANSLATION POINT (04 §2.2).
 *
 * `UnitId` is the SUBSTRATE number — private to one decision, meaningless one
 * turn later. `UnitKey` is the WIRE id — stored, wired, displayed. Everything
 * the lens EMITS carries `UnitKey`, so the translation happens here, at the
 * kernel boundary, and nowhere else.
 *
 * The substrate the kernel holds is the `Substrate` CONTRACT, which carries
 * `unitIdOf(wireId)` and not its inverse: the contract needs one direction and
 * has never needed the other. Both implementations that exist — `EngineSubstrate`
 * and the bounds testkit's `TestSubstrate`, which extends it — carry `unitOf`,
 * so the inverse is read structurally rather than by widening a contract four
 * other modules implement. A substrate that cannot answer yields `#<id>`,
 * which is visibly not a wire id: a made-up key must never be mistakable for a
 * real one.
 */

import type { Substrate, UnitId } from '../../lobster/contracts';
import type { UnitKey } from '../types';

interface KeyedSubstrate {
  unitOf(unitId: UnitId): { readonly wireId: string } | undefined;
}

function keyed(sub: Substrate): KeyedSubstrate | null {
  const candidate = sub as unknown as Partial<KeyedSubstrate>;
  return typeof candidate.unitOf === 'function' ? (candidate as KeyedSubstrate) : null;
}

/** The wire id of a substrate unit. `#<id>` when the substrate cannot say. */
export function unitKeyOf(sub: Substrate, unitId: UnitId): UnitKey {
  return keyed(sub)?.unitOf(unitId)?.wireId ?? `#${unitId}`;
}

/** The substrate number of a wire id, or `undefined` when it names nothing. */
export function unitIdOf(sub: Substrate, key: UnitKey): UnitId | undefined {
  return sub.unitIdOf(key);
}
