/**
 * TIER VALUE — what holding a buff, or suffering a debuff, is worth over the
 * window it lasts.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 *
 * The forward step reads tier, effects and potions off the rules' own
 * settlement now (`turn-oracle.ts::resolvePartialTurn`,
 * `substrate.ts::tiersAfterPickupBy`), so a pickup's consequences are a real
 * state rather than a guess. The FOLD could not see any of it. `material` does
 * not price a tier, `contest` prices only this turn's arrival verdict, and the
 * one place tier reached a decision at all was the candidate generator's
 * ordering (`candidates.ts::tierRisk`) — a SEED, which orders the moves the
 * search looks at first and never the move it stages. So the search had
 * nothing to steer toward: no depth of lookahead can find a line that acquires
 * a buff if no term in the objective is worth more after the buff than before.
 *
 * ── WHAT A TIER IS WORTH, READ OFF THE CONTEST RULE ─────────────────────────
 *
 * `strictMaximum` (`turnEngine.ts:182`) takes the highest frozen TIER first
 * and the heaviest frozen WEIGHT only among that top tier, and a survivor only
 * where that maximum is UNIQUE. So a tier is worth exactly the contests it
 * flips, and nothing anywhere else:
 *
 *   A BUFF matters only where an enemy could reach us and would otherwise win
 *   or tie — a +1 over a cell nobody contests, or a cell we already out-weigh
 *   everything at, buys nothing at all.
 *
 *   A DEBUFF matters only where an enemy who could NOT win now can — a −1 in
 *   open space, or against something that already out-weighs us, costs
 *   nothing.
 *
 * Both clauses are one number. Against the best enemy arrival at our
 * destination, ask the rule twice — once at the tier we will hold, once with
 * our own tier zeroed — and take the difference:
 *
 *   edge = [wins(ourTier, w, theirTier, theirW)] − [wins(0, w, theirTier, theirW)]
 *
 * which is +1 where our tier turned a loss or a tie into a win, −1 where it
 * turned a win into a loss, and 0 everywhere else. It is identically zero when
 * our tier is zero, which is what makes the whole term free on a board with no
 * live effects and no potions. The counterfactual zeroes OUR tier and leaves
 * the enemy's alone, deliberately: an enemy buff we cannot answer is a fact
 * about the cell, and `contest` already prices losing it. This term prices the
 * tier WE hold, which is the only half a decision can act on.
 *
 * ── OVER THE WINDOW, NOT AT THE ARRIVAL TURN ───────────────────────────────
 *
 * A tier is a window, not a state, and its value is the number of turns it
 * still runs for. Two segments, over a horizon of `potionWindowTurns` turns
 * starting at the arrival turn:
 *
 *   the arrival turn itself, at the tier the unit carries into it — the turn
 *   the contest field is exactly about;
 *
 *   the rest of the window, at the tier the unit will hold from the next turn
 *   on: the SETTLED figure when this plan collects a potion, and otherwise the
 *   arrival tier lapsing at its own expiry.
 *
 * Both segments are priced with the same edge and averaged by their lengths,
 * so the term stays in [−1, +1] per unit whatever the window length is. The
 * geometry is not re-derived per turn — the enemy reach field is a fact about
 * the arrival turn and is used as the stand-in for "the enemies that can
 * contest this unit" across the window, which is the same one-turn dilation
 * every reading at this altitude is built on.
 *
 * One inexactness is worth naming rather than hiding: on a pickup line the
 * settled next-turn tier is held for the rest of the window, so a PRE-EXISTING
 * effect that lapses inside that window is not netted off. The pickup's own
 * half is exact (settlement opens it at `arrivalTurn + potionWindowTurns`,
 * i.e. for the whole remainder), the term stays bounded either way, and it
 * orders moves rather than refusing them.
 *
 * ── WHAT IT COSTS ──────────────────────────────────────────────────────────
 *
 * ONE ARRAY READ PER UNIT PER NODE. The enemy reach field is `contest`'s own
 * (`contestField`, cached per marshalled board per subject team), so this adds
 * no second enumeration; what a pickup does is `settleTurn`'s answer, asked
 * once per collector per DECISION and memoised on the substrate. Everything
 * else is integer arithmetic on numbers already in hand. And a board with no
 * live tier and no collectable potion takes the whole-decision gate below and
 * never touches any of it.
 *
 * ── WHY IT SITS UNDER `contest` ────────────────────────────────────────────
 *
 * `contest` says "this destination is a contest we lose"; this says "and tier
 * is why", plus how long that stays true, plus what a pickup would do to it.
 * The two overlap on purpose and the ordering between them is the calibration:
 * at a weight above `contest` a unit would take a lost square to hold a buff,
 * which inverts the term's whole reason for existing. See `DEFAULT_WEIGHTS`.
 */

import type { EngineSubstrate } from '../substrate';
import { type Feature, bound, point } from './bound';
import { type ContestField, contestField, winsContest } from './contest';
import type { EvalContext, Standing } from './features';

/**
 * Is there any tier to price on this board at all?
 *
 * Two ways there can be: a unit already carries a nonzero tier into the
 * arrival turn, or a potion is on the board and live, so a tier can be created
 * this turn. Neither, and every edge below is zero by construction — so the
 * feature returns a point at zero without reading the contest field, which is
 * what keeps every existing counter on a potion-free board bit-for-bit
 * unchanged.
 *
 * Cached on the MARSHALLED board rather than on the substrate, for the reason
 * `contestField` is: a modelled sibling is a `Proxy` over its parent and the
 * marshalled board is the one object it hands straight through.
 */
const LIVE = new WeakMap<object, boolean>();

export function tierIsLive(sub: EngineSubstrate): boolean {
  const hit = LIVE.get(sub.marshalled);
  if (hit !== undefined) return hit;
  let live = sub.potionsEnabled() && sub.marshalled.potions.length > 0;
  if (!live) {
    for (const unit of sub.roster()) {
      if (unit.tier !== 0) {
        live = true;
        break;
      }
    }
  }
  LIVE.set(sub.marshalled, live);
  return live;
}

/**
 * The tier a unit still holds at an absolute turn, given the tier it carries
 * into the arrival turn. `tierExpiresAtTurn` is EXCLUSIVE — the first turn at
 * which the tier no longer governs — and the conversion from the wire's
 * inclusive figure happens once, in `marshalBoard`.
 */
function heldAt(tier: number, expiresAtTurn: number | null, turn: number): number {
  return expiresAtTurn !== null && turn >= expiresAtTurn ? 0 : tier;
}

/**
 * How much our own tier is worth at this cell: +1 where it flips a contest we
 * would otherwise lose or tie, −1 where it flips one we would otherwise win.
 *
 * `winsContest` is monotone in our tier — below theirs we lose, level with
 * theirs it is weight, above theirs we win — so this is monotone in `tier`
 * too, which is what lets a tier INTERVAL be read at its two ends below.
 */
function edgeAt(tier: number, weight: number, field: ContestField, cell: number): number {
  if (field.reached[cell] !== 1) return 0;
  const theirTier = field.tier[cell] as number;
  const theirWeight = field.weight[cell] as number;
  const withTier = winsContest(tier, weight, theirTier, theirWeight) ? 1 : 0;
  const bare = winsContest(0, weight, theirTier, theirWeight) ? 1 : 0;
  return withTier - bare;
}

/**
 * The window value of one unit's tier: the arrival turn at `tier`, then the
 * rest of the window at `later`, averaged over the window's length.
 *
 * `hold` is how many of the window's turns the ARRIVAL tier survives for on a
 * line that collects nothing — a buff with one turn left is worth a third of
 * one with three, which is the whole "over the remaining window" clause. On a
 * pickup line `later` is settlement's own figure and runs the whole remainder,
 * because that is exactly the window settlement opens.
 */
function windowValue(
  tier: number,
  /** The tier from the turn after this one, or null for "no pickup: lapse". */
  later: number | null,
  hold: number,
  window: number,
  weight: number,
  field: ContestField,
  cell: number
): number {
  const held = Math.min(hold, window);
  if (later === null) {
    // Nothing this turn changes the tier, so it simply runs out its own hold.
    return (edgeAt(tier, weight, field, cell) * held) / window;
  }
  const first = edgeAt(tier, weight, field, cell) * Math.min(held, 1);
  const rest = edgeAt(later, weight, field, cell) * (window - 1);
  return (first + rest) / window;
}

/** Our unit whose destination collects a potion this turn, if any. */
function collectorOf(ctx: EvalContext): Standing | null {
  const sub = ctx.sub;
  if (!sub.potionsEnabled() || sub.marshalled.potions.length === 0) return null;
  for (const s of ctx.standing) {
    if (s.team !== ctx.asTeam || s.held || !s.bestAlive) continue;
    // Collection is DESTINATION-ONLY: settlement reads a surviving head's
    // resting cell, so a slider crossing a potion does not take it.
    if (sub.potionAt(s.cell)) return s;
  }
  return null;
}

/**
 * F10 — tier value.
 *
 * OURS ONLY, like `momentum` and `contest`, and for the same reason: it is a
 * statement about the tier state THIS decision is choosing to be in. An
 * enemy's own window is not ours to price, and pricing it would make the term
 * move whenever a claim interval moved.
 *
 * THE TWO READINGS. This term is the first in the fold that can be positive
 * OR negative per unit, so the alive-set polarity cannot be applied wholesale
 * the way a pure penalty applies it. It is applied per SIGN instead, which is
 * the same argument done term by term: our best world keeps a superset of the
 * units our worst world keeps, so the WORST reading takes each unit's costs
 * over the superset and its credits over the subset, and the best reading the
 * other way round. That brackets every world in between and cannot invert.
 *
 * A CONTINGENT COLLECTOR is bracketed the same way: settlement pays the ally
 * half only to a collector that survives the turn, so where the collector is
 * contingent both the pickup and the no-pickup reading are admitted and the
 * unit's value spans them.
 */
export const tierFeature: Feature<EvalContext> = {
  key: 'tier',
  defaultWeight: 2,
  contract: {
    reads: [{ input: 'contingent-survival', monotone: 'extremized' }],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    if (!tierIsLive(ctx.sub)) return point(0);

    let ours = 0;
    for (const s of ctx.standing) if (s.team === ctx.asTeam && !s.held) ours++;
    if (ours === 0) return point(0);

    const sub = ctx.sub;
    const field = contestField(sub, ctx.asTeam);
    const arrival = sub.turn + 1;
    const window = Math.max(1, sub.marshalled.potionWindowTurns);

    const collector = collectorOf(ctx);
    const after = collector === null ? null : sub.tiersAfterPickupBy(collector.unitId);
    // A pickup by a unit that might not survive the turn might not happen.
    const pickupCertain = collector !== null && collector.worstAlive;

    let worst = 0;
    let best = 0;
    for (const s of ctx.standing) {
      if (s.team !== ctx.asTeam || s.held) continue;
      if (!s.bestAlive && !s.worstAlive) continue;
      const unit = sub.unitOf(s.unitId);
      if (unit === undefined) continue;
      const weight = unit.weight;

      // How many of the window's turns the arrival tier survives, if nothing
      // this turn changes it. Null expiry is a tier with no known horizon,
      // which holds for the whole window.
      const expiry = s.tierExpiresAtTurn;
      const hold = expiry === null ? window : Math.max(0, Math.min(window, expiry - arrival));

      // The tier interval, read at both ends. `winsContest` is monotone in our
      // tier, so the ends of the interval are the ends of the value.
      const tLo = heldAt(s.tierMin, expiry, arrival);
      const tHi = heldAt(s.tierMax, expiry, arrival);
      const settled = after === null ? null : after.get(s.unitId);

      const noPickupLo = windowValue(tLo, null, hold, window, weight, field, s.cell);
      const noPickupHi = windowValue(tHi, null, hold, window, weight, field, s.cell);
      let vLo: number;
      let vHi: number;
      if (settled === undefined) {
        vLo = noPickupLo;
        vHi = noPickupHi;
      } else {
        const pickLo = windowValue(tLo, settled, hold, window, weight, field, s.cell);
        const pickHi = windowValue(tHi, settled, hold, window, weight, field, s.cell);
        vLo = pickupCertain ? pickLo : Math.min(noPickupLo, pickLo);
        vHi = pickupCertain ? pickHi : Math.max(noPickupHi, pickHi);
      }

      // Costs over the SUPERSET, credits over the subset, in the worst
      // reading; the other way round in the best.
      if (vLo < 0 && s.bestAlive) worst += vLo;
      if (vLo > 0 && s.worstAlive) worst += vLo;
      if (vHi > 0 && s.bestAlive) best += vHi;
      if (vHi < 0 && s.worstAlive) best += vHi;
    }

    const lo = worst / ours;
    const hi = best / ours;
    return bound(Math.min(lo, hi), (lo + hi) / 2, Math.max(lo, hi));
  },
};
