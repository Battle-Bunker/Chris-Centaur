/**
 * MOMENTUM — the cheapest thing that stops a unit undoing itself.
 *
 * ── THE PATHOLOGY ──────────────────────────────────────────────────────────
 *
 * Nothing in this objective had any preference between "carry on" and "go
 * back". Where two options tie on every term — which, before the slider repair
 * was seated, was EVERY option a piece had, every turn — the winner is settled
 * by `SearchCore.better`'s last resort, a hash of the whole joint plan. That
 * hash changes whenever any teammate's candidate changes, so a unit with tied
 * options gets a fresh answer each turn. Recorded, from `local-game` on the
 * `mixed` board:
 *
 *     T  1 red-B pawn (2,1)->(1,1)   rotate left
 *     T  3 red-B pawn (2,1)->(1,2)   rotate the other way
 *     T  4 red-B pawn (2,1)->(1,1)   and back
 *     T  6 red-B pawn (2,1)->(2,2)   and away again — six turns, no square gained
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────
 *
 * The board already remembers last turn's move, in the one place the rules put
 * it: `orientation`. Every unit's orientation is the direction it last MOVED
 * (`Turn.orientation`, and `translate.ts` carries it verbatim), so the cell a
 * unit came from is `cell - orientation`, exactly. No history, no state carried
 * between decisions, nothing to get out of step with the board.
 *
 * It is read off the MARSHALLED board and not off `SubstrateUnit.orientation`,
 * and that is not incidental. The substrate's orientation is an
 * `OrientationIndex` — one of four orthogonals, projected through
 * `orientationOf` — which is all the movement grammar needs and is exactly
 * wrong here: a knight's orientation is its L-offset, and projected onto the
 * nearest orthogonal it names a cell the knight has never stood on. The wire
 * carries the true vector; this reads the wire's.
 *
 * Two terms, both small, both negative:
 *
 *   REVERSAL   the move lands on the cell the unit came from. Undoing last
 *              turn's move is not forbidden — a unit that must retreat must be
 *              able to — it is merely made to cost something, so it happens for
 *              a reason and not because a hash changed.
 *
 *   IDLENESS   a unit that CAN move ends the turn on the square it started on.
 *              For a trail unit this never fires (they cannot stay). For a
 *              piece it is the hold, and for a pawn it is the rotation — the
 *              two shapes the trace above is made of. It is charged at half a
 *              reversal, because standing still is sometimes right and going
 *              backwards almost never is.
 *
 * ── AND WHAT IDLENESS COSTS IS SCALED BY THE TANK ──────────────────────────
 *
 * The idleness charge prices one fact: that standing still gains nothing. For
 * a unit with a full tank that is true — every square it can reach it can
 * still reach next turn, so declining to act buys it nothing at all. For a
 * unit nearly out of health it is false: standing still buys the only thing it
 * has left, because energy is a movement budget that a piece may
 * decline to spend (`./energy.ts`, and `budgetShare`'s own argument in
 * `./features.ts`). Charging a full anti-dither penalty there prices the same
 * fact twice and in opposite directions: `energy` charges the move for the
 * budget it burns, and this would charge the alternative for not burning it.
 *
 * So the charge is scaled by the tank — `health / max`, read at the START of
 * the turn like every other per-unit constant in this fold. FULL at full
 * health, which is where the dither trace above was recorded and where the
 * regression fence pins it; sliding to nothing as the tank empties. The
 * REVERSAL charge is untouched: going backwards is wrong whatever the tank
 * says.
 *
 * ── WHY THIS IS AN EVALUATOR TERM AND NOT A FILTER ─────────────────────────
 *
 * It is weighted, and it is small: one whole unit reversing costs
 * `w / |ours|` of a scale on which the lightest unit alive is worth 10. It can
 * therefore break a tie and it can never outrank anything real — not a capture,
 * not a meal, and above all not the survival cliff, which lives inside
 * `material` at a magnitude this term cannot reach. A unit backing out of a
 * trap still backs out of the trap. That is the whole design constraint: the
 * safety floor is not negotiable, and hysteresis is not allowed to negotiate
 * with it.
 */

import { isPieceType } from '../../engine-vendor/engine/moveGrammar';
import type { EngineSubstrate } from '../substrate';
import type { UnitId } from '../contracts';
import { type Feature, ourUnitTerm } from './bound';
import type { EvalContext, Standing } from './features';
import { perBoard } from './memo';

/** Per substrate: the cell each unit occupied BEFORE its last move. */
const CAME_FROM = new WeakMap<EngineSubstrate, ReadonlyMap<UnitId, number>>();

function cameFrom(sub: EngineSubstrate): ReadonlyMap<UnitId, number> {
  return perBoard(CAME_FROM, sub, () => {
    const out = new Map<UnitId, number>();
    const width = sub.grid.width;
    for (const marshalled of sub.marshalled.units) {
      const unit = sub.unitOfWireId(marshalled.id);
      if (unit === undefined) continue;
      const { dx, dy } = marshalled.orientation;
      if (dx === 0 && dy === 0) continue;
      out.set(unit.unitId, (unit.cells[0] as number) - (dy * width + dx));
    }
    return out;
  });
}

/** Cost of landing back where you came from. */
export const REVERSAL_COST = 1;
/** Cost of a unit that could have acted ending the turn where it began. */
export const IDLE_COST = 0.5;

function costOf(ctx: EvalContext, s: Standing): number {
  const unit = ctx.sub.unitOf(s.unitId);
  if (unit === undefined) return 0;
  const from = unit.cells[0] as number;
  if (s.cell === from) {
    // A trail unit has no stay in its grammar, so an unchanged cell for one of
    // those is not idleness — it is a reading of a unit that never moved
    // because it was never asked to. Only a kind that CAN decline is charged.
    if (!isPieceType(unit.type)) return 0;
    const cap = Math.max(1, ctx.sub.maxEnergyOf(unit.type));
    return IDLE_COST * Math.min(1, Math.max(0, unit.energy / cap));
  }
  const came = cameFrom(ctx.sub).get(s.unitId);
  return came !== undefined && s.cell === came ? REVERSAL_COST : 0;
}

/**
 * F8 — momentum.
 *
 * OURS ONLY: it is a statement about the moves this decision is choosing, and
 * an enemy's momentum is not ours to price. The two readings differ only in
 * which of our contingent units are counted; a dead unit costs nothing, which
 * is the one direction that could invert the bound, so the WORST reading counts
 * the SUPERSET (best-world alive) and the best reading the subset — the
 * opposite way round from a positive term, because this one is negative.
 */
export const momentumFeature: Feature<EvalContext> = {
  key: 'momentum',
  defaultWeight: 1,
  contract: {
    reads: [{ input: 'contingent-survival', monotone: 'up' }],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    // Charged where the unit is ALIVE to have made the move. Our best world
    // keeps more units standing, so it carries at least as much cost — hence
    // it is the LO endpoint of a term that is never positive.
    return ourUnitTerm(ctx, (s) => {
      const c = costOf(ctx, s);
      return [-c, -c];
    });
  },
};
