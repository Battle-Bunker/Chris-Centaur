/**
 * ENERGY — the price of a move, in the only currency the rules charge.
 *
 * ── THE PATHOLOGY ──────────────────────────────────────────────────────────
 *
 * From the owner, watching a game: "pieces are often stupid about wasting
 * health pointlessly when there is no food or valuable target within reach.
 * Health is really ENERGY in terms of its mechanics. If the marginal value of a
 * move is low, its health/energy cost should not outweigh the hold move."
 *
 *     T  2 blue-B queen hp100 (8,2)->(2,8)   top3: (5,5)=-21.76|20.89
 *                                                  (2,8)=-22.14|20.54 ...
 *
 * Six cells of diagonal, the turn after it ate, taking nothing and reaching
 * nothing, for 0.35 of score. Under the rules that move cost six health, and
 * nothing in the fold noticed.
 *
 * ── WHAT THE RULES CHARGE ──────────────────────────────────────────────────
 *
 * `turnEngine.ts` sub-step (e), mirrored by `PartialEngine.healthPhase`: ONE
 * HEALTH PER CELL ENTERED, per sub-step, at the kind's `costPerCell` — which is
 * 1 for every kind in the catalog. A stepper pays one a turn; a slider pays the
 * length of its ray. A HOLD ENTERS NOTHING AND PAYS NOTHING (the sole exception
 * is the stationary hazard dose, which `restVerdict` already prices in the
 * candidate layer). A trail unit has no hold in its grammar — staging its own
 * square is not a move — so only a kind that may HOLD has an energy decision to
 * make at all, and this term is identically zero for everything else.
 *
 * Food is the only heal, it restores to the eater's own kind's maximum, and it
 * is applied at end of turn AFTER the movement charge. So a move that eats is
 * FREE: whatever it spent getting there comes back inside the same turn. That
 * falls out of the arithmetic here rather than being special-cased, because the
 * spend is read as the difference the resolution actually produced.
 *
 * ── WHY AN EVALUATOR TERM ──────────────────────────────────────────────────
 *
 * The candidate layer already knows the price exactly — `healthSpent` is an
 * interval per candidate and `exhaustionFatal` a trit — and it can only ORDER
 * with it. Ordering never licenses a move, and `DEFAULT_SWITCH_MARGIN` is 0.01,
 * so any positive scoring difference restages away from the cheap seed. The
 * fold, meanwhile, has no per-cell price at all: `energyEconomy`'s
 * `budgetShare` is a flat 1 for a piece above the reserve, so above
 * half health a nine-cell slide and a hold score the same, and `momentum`
 * charges the HOLD half a reversal while charging motion nothing. The bot is
 * biased toward motion by construction. See `docs/design/energy.md`.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 *
 * Per unit of ours, read at the START of the turn except for the spend:
 *
 *     runway  h = health, which IS a count of cells it can still buy
 *     trip    d = steps to the nearest reachable meal (`foodDistance`, the
 *                 flood `food.ts` already caches), or the board diameter D when
 *                 no meal is reachable — the honest bound on the next one
 *     spend   s = max(0, h − health after the resolution): the rules' own
 *                 charge, hazard doses included, and zero for a meal
 *
 *     share     = min(1, s / h)        the runway this move burns
 *     slack     = clamp01(1 − d / h)   the runway NOT already owed to the trip
 *     scarcity  = clamp01(d / D)       how dear a refill is
 *
 *     cost(u)   = share × slack × scarcity                 ∈ [0, 1]
 *     energy    = − Σ ours cost(u) / |ours|                ∈ [−1, 0]
 *
 * `d`, `h`, `slack` and `scarcity` are per-unit CONSTANTS within one decision,
 * so this term expresses no preference between two destinations — it is a price
 * on spending and never a pull. That is `food.ts`'s own argument for reading
 * turn-start health, and it is what keeps the two terms from cancelling.
 *
 * THE TWO FACTORS ARE THE MARGINAL VALUE, and they are what the owner's
 * sentence asks for. `scarcity` says energy is cheap where it is cheap to
 * replace: standing on a meal it is zero, so a piece beside food behaves
 * exactly as it does today. `slack` says energy is worthless to a unit that
 * cannot afford the trip it must already make: it reaches zero when `d ≥ h`, so
 * a starving unit is charged NOTHING and `food` keeps sole authority over it.
 * This term cannot starve a unit, by construction and not by weight. The price
 * peaks at `h = 2d` — far enough from a meal to be worth conserving for, close
 * enough to still afford it.
 *
 * ── SCALE, AND THE DEDUCTIBLE ──────────────────────────────────────────────
 *
 * `cost` is in [0,1] and the sum is divided by our unit count, so the range is
 * [−1, 0] on every board and every roster — the construction `food`,
 * `momentum` and `contest` use, and the reason one weight is safe everywhere.
 * The cliff inequality `w × range < 10 × lightest weight` then reads `w < 10`.
 *
 * The weight is fixed by `momentum`, not by taste. A hold pays
 * `w_momentum × IDLE_COST = 0.5` and both terms divide by the same `|ours|`, so
 * the division cancels and a hold beats a move exactly when
 * `w_energy × cost > 0.5`, whatever the roster. The idleness charge is
 * therefore a DEDUCTIBLE and not a veto: at weight 8 it is cleared by
 * `cost > 1/16`, which is a slider burning a sixteenth of its runway at full
 * price. It is deliberately NOT suppressed when this term wants a hold — if
 * energy makes the hold the argmax it has already out-paid the 0.5, and what
 * the deductible buys is the floor that keeps a piece acting when the price is
 * small, which is the property `basic-intelligence.test.ts` gates on.
 */

import { isPieceType } from '../../engine-vendor/engine/moveGrammar';
import { type Feature, ourUnitTerm } from './bound';
import { foodDistance } from './food';
import type { EvalContext, Standing } from './features';

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Steps to the nearest reachable meal, or the board diameter when there is
 * none. `foodDistance` reports −1 for "no meal reachable from here", and a
 * board with no food at all reports it everywhere; the diameter is the largest
 * trip the board can pose, so it is the honest stand-in and it makes
 * `scarcity` exactly 1 — energy is at its dearest when nothing will refill it.
 */
export function tripOf(dist: Int32Array, cell: number, diameter: number): number {
  const d = dist[cell];
  return d === undefined || d < 0 ? diameter : d;
}

/**
 * What this unit's move cost it, priced. Zero for anything that is not
 * a PIECE — a kind with no hold in its grammar is not choosing to spend —
 * and zero for a hold, a rotation and a meal, all three of which spend nothing.
 */
export function energyCostOf(
  ctx: EvalContext,
  s: Standing,
  dist: Int32Array,
  diameter: number
): number {
  if (!isPieceType(s.kind)) return 0;
  const unit = ctx.sub.unitOf(s.unitId);
  if (unit === undefined) return 0;
  // Turn-start energy. Read off the substrate and not off the settlement, for
  // the same reason `food.ts` reads it there: it must be a per-unit constant
  // within the decision, or the term acquires an opinion about destinations.
  const runway = unit.energy;
  if (runway <= 0) return 0;
  const spend = Math.min(runway, Math.max(0, runway - s.energy));
  if (spend === 0) return 0;
  const d = tripOf(dist, unit.cells[0] as number, diameter);
  const slack = clamp01(1 - d / runway);
  if (slack === 0) return 0;
  return (spend / runway) * slack * clamp01(d / diameter);
}

/**
 * F10 — the energy price.
 *
 * OURS ONLY, exactly as `momentum` and `contest` are: it is a statement about
 * what THIS decision is choosing to spend, and an enemy's housekeeping is not
 * ours to price — pricing it would also make the term move whenever a claim
 * interval moved.
 *
 * The two readings differ only in which of our contingent units are counted. A
 * dead unit spends nothing, which is the one direction that could invert the
 * bound, so the WORST reading counts the SUPERSET (best-world alive) and the
 * best reading the subset — the opposite way round from a positive term,
 * because this one is never positive.
 */
export const energyFeature: Feature<EvalContext> = {
  key: 'energy',
  defaultWeight: 8,
  contract: {
    reads: [{ input: 'contingent-survival', monotone: 'up' }],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    // A board on which we command nothing that may decline to spend — every
    // snake-only board — is an EXACT zero here, so its fold is bit-for-bit the
    // fold it was before this member existed, and the food flood is not even
    // asked for.
    let dist: Int32Array | undefined;
    let diameter = 0;
    return ourUnitTerm(
      ctx,
      (s) => {
        if (dist === undefined) {
          dist = foodDistance(ctx.sub);
          diameter = Math.max(1, ctx.sub.grid.width + ctx.sub.grid.height);
        }
        const c = energyCostOf(ctx, s, dist, diameter);
        return [-c, -c];
      },
      (_ctx, ours) => ours.some((s) => isPieceType(s.kind))
    );
  },
};
