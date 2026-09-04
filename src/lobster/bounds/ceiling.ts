/**
 * THE CEILING PLY'S SECOND LAYER — one settlement of turn `t+1`, everything held.
 *
 * `08-DEPTH-VERDICT` §4.2 splits the ceiling ply in two. Ply 1 is a MIN over a
 * subset of the enemy's replies, and it lives in `bank.ts` because it is an
 * enumeration over option lists the B3 preamble already built. Ply 2 is this
 * file, and it is the half the verdict calls free:
 *
 *   > From each leaf's board, settle turn `t+1` with EVERY unit held — ours
 *   > included. The claim covers every continuation we could play and every
 *   > reply they could make, so the settlement's `best` endpoint is an upper
 *   > bound on `max_{K'} min_{b'} V`. One settlement per leaf, zero
 *   > enumeration, zero truncation.
 *
 * That is `06` Q-L3's mirror rung — "a rung that refuses to let an incomplete
 * continuation set move the ceiling" — and it needs no building, because
 * HOLDING IS THE COMPLETE COVER. Omitting a unit from a plan is what makes it
 * held (`substrate.ts`, rule 2), and a held unit's claim brackets every action
 * its grammar admits. A plan that names nobody therefore claims every world
 * the next turn could reach, and `perilOf()` already argues this exact
 * over-approximation in place for a board WE ARE NOT ON.
 *
 * ── WHAT THIS FILE IS ALLOWED TO DO ────────────────────────────────────────
 *
 * Re-marshal, and nothing else. `advanceBoard` takes a settlement the engine
 * produced and writes down the board it left, in the engine's own coordinates:
 * survivors at their settled occupancy and energy, the tiers settlement
 * handed back, the food and potions it did not consume, the effect schedule it
 * left standing. It charges no pickup, expires no effect, promotes nothing and
 * kills nothing — every one of those is a rule, the rules have one encoding,
 * and re-deciding any of them here would be the second encoding
 * `engine-vendor/VENDOR.md` exists to prevent. The runner does the same job in
 * api coordinates (`local-game.ts`, "SETTLEMENT, NOT RESOLUTION"); this is
 * that read-back with no translation in it, because the board never leaves
 * engine cells.
 *
 * ── WHY IT REFUSES A BOARD THAT IS NOT CONCRETE ────────────────────────────
 *
 * `advanceBoard` may only be handed a settlement of a plan that named EVERY
 * unit on the roster. A partial settlement settles the turn with the held
 * units absent from the board (`settlePartial.ts:33`), so its timeline is not
 * a board any world reaches and the position it leaves is nobody's — that is
 * Refusal 1, and Finding D-2 says it is the same fact as exactness. The caller
 * proves concreteness by construction (a B4 leaf names the whole roster); this
 * file asserts it rather than trusting it, because the failure mode of getting
 * it wrong is a sound-looking bound over a board that never existed.
 */

import type { ActiveEffect } from "../../engine-vendor/shared/types/Game";
import type { ResolveUnit } from "../../engine-vendor/engine/resolveTurn";
import type { PartialSettlement } from "../../engine-vendor/engine/settlePartial";
import type { MarshalledBoard } from "../../logic/turn-oracle";
import { EngineSubstrate } from "../substrate";
import type { Evaluator, JointPlan } from "../contracts";

/** The plan that names nobody: every unit held, which is the complete cover. */
const HOLD_EVERYTHING: JointPlan = new Map();

/**
 * The earliest expiry among the effects a unit still holds, in the ENGINE's
 * exclusive convention.
 *
 * `translate.ts::aggregateExpiryTurn` computes the same earliest over the wire
 * shape and `marshalBoard` converts it with `+ 1`; the two conventions differ
 * by one because the server expires effects AFTER the collision phase, so an
 * effect due at turn E still decides every contest at E. Written out here
 * rather than imported because the wire module it lives in pulls the whole
 * firebase seam behind it, and this is five lines of arithmetic with its
 * citation attached.
 */
function tierExpiryOf(effects: ReadonlyArray<ActiveEffect>, unitId: string): number | null {
  let earliest: number | null = null;
  for (const e of effects) {
    if (e.playerID !== unitId) continue;
    if (earliest === null || e.expiryTurn < earliest) earliest = e.expiryTurn;
  }
  return earliest === null ? null : earliest + 1;
}

/**
 * The board one turn on, as the settlement left it.
 *
 * Returns null when the settlement is not a board a next turn starts from:
 * the game ended on it, or nobody survived. Both are honest declines rather
 * than boards — a terminal position's value is the terminal member's business
 * (`evaluate/terminal.ts`), and inventing a continuation for a finished game
 * would be exactly the laundering the ceiling ply exists without.
 */
export function advanceBoard(
  parent: MarshalledBoard,
  settlement: PartialSettlement,
): MarshalledBoard | null {
  if (settlement.outcome !== null) return null;
  if (settlement.claims.length > 0) {
    throw new Error(
      "ceiling: a partial settlement is not a board — the optimistic timeline settles " +
        "the turn with the held units absent, so no world reaches the position it leaves",
    );
  }
  const nextArrival = parent.arrivalTurn + 1;
  const alive = new Set(Object.keys(settlement.board));
  if (alive.size === 0) return null;

  const effects: ActiveEffect[] = settlement.effects
    .filter((e) => e.expiryTurn >= nextArrival && alive.has(e.playerID))
    .map((e) => ({ ...e }));

  const units: ResolveUnit[] = [];
  const tierExpiry: (number | null)[] = [];
  const startWeight = new Map<string, number>();
  const startHealth = new Map<string, number>();
  const teamOf = new Map<string, string>();
  const regicideTeamIDs = new Set<string>();
  // Board order is the parent's order, minus the dead: a roster whose order
  // depended on a settlement's key iteration would give two identical boards
  // two different unit numberings and two different tie keys.
  for (const before of parent.units) {
    const settled = settlement.board[before.id];
    if (settled === undefined) continue;
    const unit: ResolveUnit = {
      id: before.id,
      // KIND IS A SETTLEMENT OUTPUT: promotion is the one kind change in the
      // game, and a caller that carried the kind it sent in would move a
      // promoted pawn by a pawn's grammar for the rest of the game.
      type: settlement.unitTypes[before.id] ?? before.type,
      teamID: before.teamID,
      tier: settlement.tiers[before.id] ?? 0,
      energy: settled.energy,
      occupancy: [...settled.occupancy],
      orientation: settlement.orientation[before.id] ?? before.orientation,
    };
    if (before.isKing !== undefined) unit.isKing = before.isKing;
    units.push(unit);
    tierExpiry.push(tierExpiryOf(effects, before.id));
    startWeight.set(before.id, unit.occupancy.length);
    startHealth.set(before.id, unit.energy);
    teamOf.set(before.id, before.teamID);
    // `marshalBoard`'s own rule, unchanged: a team plays under regicide
    // exactly when it has a living king.
    if (unit.isKing === true) regicideTeamIDs.add(before.teamID);
  }

  return {
    fullWidth: parent.fullWidth,
    fullHeight: parent.fullHeight,
    units,
    config: {
      ...parent.config,
      food: [...settlement.food],
      regicideTeamIDs: [...regicideTeamIDs],
    },
    potions: [...settlement.potions],
    arrivalTurn: nextArrival,
    effects,
    potionsEnabled: parent.potionsEnabled,
    potionWindowTurns: parent.potionWindowTurns,
    pawnPromotionWeight: parent.pawnPromotionWeight,
    maxTurns: parent.maxTurns,
    tierExpiry,
    startWeight,
    startHealth,
    teamOf,
    toIndex: parent.toIndex,
    toCell: parent.toCell,
  };
}

/**
 * THE PLY-2 CEILING of one concrete leaf: settle `t+1` with everything held
 * and read the optimistic endpoint.
 *
 * `ourTeam` is a WIRE team id, not a number, because the numbering is private
 * to a substrate and the roster changes across a turn — a team that lost its
 * last unit is not in the child's map at all. `EngineSubstrate` seats the
 * declared team at 0 whether or not it still has units, which is why the
 * frame the evaluator is asked for is a constant here and not a lookup.
 *
 * Returns null where there is no next board (see `advanceBoard`) or the board
 * cannot be stood up at all. A null is the member declining ONE leaf, and the
 * caller falls back to that leaf's own h1 ceiling, which is a bound on the
 * same quantity — never to nothing.
 *
 * `-Infinity` is returned as itself rather than as a decline: DEAD is the
 * lattice bottom, not an error, and whether a ceiling that low may be
 * admitted against the plan's proved floor is the CALLER's rule to apply and
 * to count. Swallowing it here would hide exactly the disagreement §4.3's
 * fourth claim is asserting will not happen.
 */
export function ceilingAtNextTurn(
  parent: MarshalledBoard,
  settlement: PartialSettlement,
  ourTeam: string,
  evaluate: Evaluator,
): number | null {
  const next = advanceBoard(parent, settlement);
  if (next === null) return null;
  // The turn the board describes; its arrival turn is one further on. Nothing
  // is stale: every unit's position was just settled, so `observedTurns` is
  // absent and every claim dilates from this turn rather than from an older
  // one.
  let sub: EngineSubstrate;
  try {
    sub = new EngineSubstrate({ marshalled: next, turn: parent.arrivalTurn, asTeam: ourTeam });
  } catch {
    // A board the substrate refuses (overlapping occupancy, an unreadable
    // roster) is one this member has nothing to say about. Declining is the
    // only sound answer: the alternative is a bound over a board the rules
    // could not have produced.
    return null;
  }
  try {
    const bound = evaluate.scorePlan(sub, HOLD_EVERYTHING, 0);
    return Number.isNaN(bound.hi) ? null : bound.hi;
  } catch {
    return null;
  } finally {
    sub.release();
  }
}
