/**
 * THE PICKUP — what a potion is worth to the TEAM, and what it costs the unit
 * that takes it.
 *
 * ── THE RULE, AND THE DECISION IT LEAVES OPEN ──────────────────────────────
 *
 * Collection is INVERTED (`settleTurn.ts` phase 2): the collector takes −1,
 * every LIVING ally takes +1, and both lapse `potionWindowTurns` later. A tier
 * does exactly one thing — `strictMaximum` reads the highest frozen tier before
 * it looks at weight — so the whole trade is "how many contests does the +1
 * flip for the rest of us, against how much of the board can now beat the one
 * who paid". The owner's intent is that phrase and nothing more: take a potion
 * when it is profitable for the team AND the collector is not in great danger,
 * and err conservative.
 *
 * ── WHY `tier` DOES NOT ALREADY SAY THIS ───────────────────────────────────
 *
 * `evaluate/tier.ts` prices the window a unit HOLDS, at the one cell that unit
 * stands on, against the cells an enemy could reach THIS TURN. That covers the
 * pickup's arithmetic and misses both halves of its geometry, which is exactly
 * what `docs/design/potions.md` recorded when the first attempt at this member
 * was deleted:
 *
 *   1. the debuff runs for a WINDOW and the enemy reach it is read against is
 *      one turn wide;
 *   2. the collector's cost is read at its landing square only, so a unit that
 *      walks onto a potion with three enemies a step away pays the same as one
 *      that takes it alone in a corner — the landing square is not where the
 *      next three turns happen.
 *
 * This term is those two repairs and nothing else. The profit half is the
 * ally's own plan cell against the enemy reach at each turn of the window; the
 * peril half is the collector's OWN GROUND — every cell it could be standing on
 * — against the same, at the tier the pickup leaves it on.
 *
 * ── THE GROUND IS THE ENGINE'S, AT EVERY HORIZON ───────────────────────────
 *
 * A `Claim` over a span of k turns is the rules' own answer to "where could
 * this unit be, and how strong could it be, after k turns of unknown movement".
 * So the window is read by asking `computeClaims` once per horizon k = 1..W,
 * with EVERY unit held and no narrowing applied, and both halves read off the
 * same answer: the enemy claims stamp a best-arrival field per cell, and our
 * collector's own claim is its ground. Nothing here walks the movement grammar
 * a second time, which is what `engine-vendor/VENDOR.md` exists to prevent.
 *
 * NO NARROWING, deliberately. A narrowing is a refinement of the held set, and
 * a field that shrank when the search refined would make the term's ceiling
 * RISE — R2 violated, the bound unsound. `contestField` reads the roster and
 * the grammar for the same reason; this reads the roster and the claims.
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 *
 * `winsContest` is asked twice per reading, exactly as `tier.ts` asks it, and
 * the only difference is what the two askings differ IN.
 *
 * PROFIT, per ally, at the cell the plan puts it, averaged over the window:
 *
 *     flip_k = wins(afterTier, w, F_k) − wins(noPickupTier_k, w, F_k)
 *     profit = mean over k of flip_k                        ∈ [0, 1]
 *
 * The counterfactual is the ally's OWN tier at that turn, lapsed on its own
 * schedule — not zero. An ally already holding a buff that outranks everything
 * near it gains nothing from a second level, and this is the reading that says
 * so. `wins` is monotone in tier and the pickup only ever raises an ally, so
 * `flip_k` is never negative.
 *
 * PERIL, for the collector, over its own ground, at the DEBUFFED tier:
 *
 *     beaten_k = share of its ground at horizon k where some enemy arrival
 *                beats it                                   ∈ [0, 1]
 *     peril    = Σ_k (W − k + 1)·beaten_k / Σ_k (W − k + 1)  ∈ [0, 1]
 *
 * ABSOLUTE, not marginal, and that is the post-mortem's other finding: a unit
 * already at −1 loses every contested cell to a tier-0 enemy ALREADY, so the
 * marginal step to −2 flips nothing and the deepest hole on the board is the
 * one a marginal reading prices free. Absolute exposure refuses exactly the
 * unit that is already in a fight.
 *
 * THE HORIZON WEIGHTS ARE NOT A TASTE. Measured on `potions`, seeds 1–5, an
 * unweighted window reading is vacuous: by the second turn every unit on an
 * 11x11 board can meet every other, and a debuffed unit loses to all of them on
 * tier alone, so 41 of 41 pickups came back fully exposed (`local-game.ts`,
 * `readPickup`, carries the per-horizon counts). The first turn is where the
 * geometry still says something, and it is also the turn the collector has had
 * no chance to walk away from — a claim at k grants the enemy k free turns and
 * the collector none. So the window is read whole and the near turns carry it.
 *
 * PERIL DOMINATES, at `PERIL_WEIGHT = 2`: one ally's flipped contest does not
 * buy a collector that can be beaten anywhere it goes. That is "err
 * conservative" written as a number.
 *
 * ── WHAT IT COSTS, AND WHERE IT IS FREE ────────────────────────────────────
 *
 * `W` claim passes per DECISION, memoised on the marshalled board and taken
 * only where a potion is standing and live — a board with potions off, or with
 * none left, takes the gate below and touches none of it. Per node the term is
 * one array read per ally plus one already-summed number for the collector, and
 * `tiersAfterPickupBy` is the substrate's own memo. Identically zero, by
 * construction and not by calibration, on every board the other scenarios use.
 *
 * ── WHY IT SITS WHERE IT SITS ──────────────────────────────────────────────
 *
 * Last in `FEATURES`, under `tier`: `tier` says what a window is worth to whoever
 * holds it, and this says whether acquiring one is a trade the team should make.
 * See `DEFAULT_WEIGHTS`.
 */

import { computeClaims } from '../../engine-vendor/engine/claims';
import type { Claim } from '../../engine-vendor/engine/claims';
import type { CellIndex, UnitId } from '../contracts';
import type { EngineSubstrate } from '../substrate';
import { type Feature, envelope, point } from './bound';
import { type Arrival, type ArrivalField, arrivalField, beatenAt, winsContest } from './contest';
import type { EvalContext, Standing } from './features';

/**
 * How much heavier the collector's peril reads than the team's profit. Two:
 * one ally's flipped contest is not worth a collector that can be beaten
 * wherever it goes, and the brief's instruction is to err conservative.
 */
export const PERIL_WEIGHT = 2;

/**
 * The best enemy arrival at every cell, at one horizon of the window — the
 * same triple `contestField` builds for the one-turn field, under `contest.ts`'s
 * name for it.
 */
type Horizon = ArrivalField;

/** Everything one board's window reading needs, per subject team. */
interface WindowRead {
  /** Index k − 1 is the enemy field k turns into the window. */
  readonly horizons: ReadonlyArray<Horizon>;
  /** Our own units' ground, per horizon: `Claim.everPossible`. */
  readonly ground: ReadonlyMap<UnitId, ReadonlyArray<ReadonlyArray<CellIndex>>>;
}

/**
 * Keyed on the MARSHALLED BOARD, exactly as `contestField` is and for the same
 * reason: a modelled sibling is a `Proxy` over its parent, and the marshalled
 * board is the one object it hands straight through. The reading is a function
 * of the roster, the grammar and the turn — of nothing a view or a narrowing
 * does — so parent and siblings correctly share it.
 */
const READS = new WeakMap<object, Map<number, WindowRead>>();

/** One frozen empty row, so a missing horizon is not an allocation. */
const EMPTY_GROUND: ReadonlyArray<CellIndex> = Object.freeze([]);

/** The claims at every horizon of the window, computed once per board. */
const CLAIMS = new WeakMap<object, ReadonlyArray<ReadonlyArray<Claim>>>();

function claimsPerHorizon(sub: EngineSubstrate, window: number): ReadonlyArray<ReadonlyArray<Claim>> {
  const hit = CLAIMS.get(sub.marshalled);
  if (hit !== undefined) return hit;
  const m = sub.marshalled;
  const base = {
    ...m.config,
    units: m.units,
    turn: m.arrivalTurn,
    teamOf: Object.fromEntries(m.teamOf),
    effects: m.effects,
    potions: m.potions,
    potionsEnabled: m.potionsEnabled,
    potionWindowTurns: m.potionWindowTurns,
    pawnPromotionWeight: m.pawnPromotionWeight,
    maxTurns: m.maxTurns,
  };
  const out: Array<ReadonlyArray<Claim>> = [];
  for (let k = 1; k <= window; k++) {
    // `input.turn − observedTurn` IS the span a claim dilates over, so this is
    // the board k turns on with nothing else assumed. No `options`: see the
    // narrowing note in the header.
    out.push(
      computeClaims({ ...base, held: m.units.map((u) => ({ id: u.id, observedTurn: m.arrivalTurn - k })) })
    );
  }
  const frozen: ReadonlyArray<ReadonlyArray<Claim>> = out;
  CLAIMS.set(sub.marshalled, frozen);
  return frozen;
}

function windowRead(sub: EngineSubstrate, asTeam: number, window: number): WindowRead {
  let perTeam = READS.get(sub.marshalled);
  if (perTeam === undefined) {
    perTeam = new Map<number, WindowRead>();
    READS.set(sub.marshalled, perTeam);
  }
  const hit = perTeam.get(asTeam);
  if (hit !== undefined) return hit;

  const cells = sub.grid.cells;
  const perHorizon = claimsPerHorizon(sub, window);
  const horizons: Horizon[] = [];
  const ground = new Map<UnitId, ReadonlyArray<CellIndex>[]>();
  for (let k = 0; k < perHorizon.length; k++) {
    const claims = perHorizon[k] as ReadonlyArray<Claim>;
    for (const claim of claims) {
      const unit = sub.unitOfClaim(claim);
      if (unit === undefined || unit.team !== asTeam) continue;
      let rows = ground.get(unit.unitId);
      if (rows === undefined) {
        // Indexed BY HORIZON, never appended: a unit missing a claim at one
        // horizon would otherwise shift every later row by one.
        rows = new Array<ReadonlyArray<CellIndex>>(perHorizon.length).fill(EMPTY_GROUND);
        ground.set(unit.unitId, rows);
      }
      rows[k] = claim.everPossible as ReadonlyArray<CellIndex>;
    }
    horizons.push(arrivalField(cells, enemyClaims(sub, claims, asTeam)));
  }
  const read: WindowRead = { horizons, ground };
  perTeam.set(asTeam, read);
  return read;
}

/**
 * Every claim in `claims` not belonging to `asTeam`, as one arrival apiece —
 * THE BEST ARRIVAL, exactly as `contestField` builds it: the highest tier any
 * enemy could bring, and the heaviest weight among the enemies at that tier.
 * `strictMaximum` needs no more than that pair.
 */
function* enemyClaims(sub: EngineSubstrate, claims: ReadonlyArray<Claim>, asTeam: number): Iterable<Arrival> {
  for (const claim of claims) {
    const unit = sub.unitOfClaim(claim);
    if (unit === undefined || unit.team === asTeam) continue;
    yield { cells: claim.everPossible, tier: claim.tierAtArrival, weight: claim.weightMax };
  }
}

/** The tier a unit still holds at an absolute turn. `tierExpiresAtTurn` is
 *  EXCLUSIVE — the first turn at which the tier no longer governs. */
function heldAt(tier: number, expiresAtTurn: number | null, turn: number): number {
  return expiresAtTurn !== null && turn >= expiresAtTurn ? 0 : tier;
}

/**
 * Every one of our units whose destination collects a potion this turn, in
 * roster order.
 *
 * Collection is DESTINATION-ONLY: settlement reads a surviving head's resting
 * cell, so a slider crossing a potion does not take it.
 *
 * A LIST AND NOT THE FIRST ONE, and that is a soundness fix rather than a
 * generalisation. Two of our units can rest on two potions in the one turn, and
 * a unit that might die might not collect at all — so "which unit is the
 * collector" is itself world-dependent, and a term that named one of them and
 * priced only that one had a floor that a world with a different collector
 * could fall straight through. The bank caught exactly that: 26 `ScoreBounds`
 * inversions on `potions` seed 5, floor above ceiling, from a first-match
 * reading. The bracket over the list is below.
 */
function collectorsOf(ctx: EvalContext): Standing[] {
  const sub = ctx.sub;
  const out: Standing[] = [];
  for (const s of ctx.standing) {
    if (s.team !== ctx.asTeam || s.held || !s.bestAlive) continue;
    if (sub.potionAt(s.cell)) out.push(s);
  }
  return out;
}

/**
 * F12 — the pickup trade.
 *
 * OURS ONLY, and CONTINGENT ON THE COLLECTOR: settlement pays neither half to a
 * collector that does not survive the turn, so where the collector is
 * contingent both readings are admitted and the term's interval spans them.
 * Costs over the SUPERSET and credits over the subset in the worst reading, the
 * other way round in the best — the same per-sign application of the alive-set
 * polarity `tier` and `ourUnitTerm` use, which brackets every world between and
 * cannot invert.
 */
export const potionFeature: Feature<EvalContext> = {
  key: 'potion',
  defaultWeight: 2,
  contract: {
    reads: [{ input: 'contingent-survival', monotone: 'extremized' }],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    const sub = ctx.sub;
    // THE WHOLE-DECISION GATE. No live potion rules, or none standing, and
    // every number below is zero by construction — so a potion-free board never
    // reaches a claim pass, and every counter measured on one is untouched.
    if (!sub.potionsEnabled() || sub.marshalled.potions.length === 0) return point(0);

    const collectors = collectorsOf(ctx);
    if (collectors.length === 0) return point(0);

    let ours = 0;
    for (const s of ctx.standing) if (s.team === ctx.asTeam && !s.held) ours++;
    if (ours === 0) return point(0);

    const window = Math.max(1, sub.marshalled.potionWindowTurns);
    const read = windowRead(sub, ctx.asTeam, window);

    // THE BRACKET OVER WHICH UNIT COLLECTS. Settlement pays the pickup to a
    // surviving head resting on a potion, and the first of ours in roster order
    // is the one this term prices — so the interval has to span every unit that
    // could BE that one. Walking in roster order, a candidate that is alive in
    // every world (`worstAlive`) is the collector in every world and closes the
    // walk; a contingent one might be, so its reading is admitted and the walk
    // goes on. Running off the end means every candidate might be gone, and the
    // world in which none of them collects — value zero — is admitted too.
    //
    // Under refinement a candidate can only leave the list or become certain,
    // and both shrink the union: R2 holds, and with nothing held the first
    // candidate is certain and the interval is a point.
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let certain = false;
    for (const collector of collectors) {
      const [worst, best] = tradeFor(ctx, read, collector, ours, window);
      lo = Math.min(lo, worst);
      hi = Math.max(hi, best);
      if (collector.worstAlive) {
        certain = true;
        break;
      }
    }
    if (!certain) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    return envelope(lo, hi);
  },
};

/**
 * The trade one named collector makes: the team's windows against its own
 * exposure, as a [worst, best] pair already divided by our unit count.
 */
function tradeFor(
  ctx: EvalContext,
  read: WindowRead,
  collector: Standing,
  ours: number,
  window: number
): [number, number] {
  const sub = ctx.sub;
  const after = sub.tiersAfterPickupBy(collector.unitId);
  const arrival = sub.turn + 1;

  // ── THE COLLECTOR'S PERIL ────────────────────────────────────────────────
  // Its ground is read from where it stands as the turn OPENS, not from the
  // potion cell the plan sends it to. That is an over-approximation in the safe
  // direction — a superset of where it can be from the potion — and it is what
  // keeps the whole peril half memoisable per collector rather than per plan.
  const collectorUnit = sub.unitOf(collector.unitId);
  const debuffed = after.get(collector.unitId) ?? collector.tierAtArrival;
  let peril = 0;
  if (collectorUnit !== undefined) {
    const rows = read.ground.get(collector.unitId);
    let num = 0;
    let den = 0;
    for (let k = 1; k <= read.horizons.length; k++) {
      const cells = rows?.[k - 1];
      const h = read.horizons[k - 1] as Horizon;
      if (cells === undefined || cells.length === 0) continue;
      let beaten = 0;
      for (const cell of cells) {
        if (beatenAt(h, debuffed, collectorUnit.weight, cell)) beaten++;
      }
      // The near turns carry the reading: see the header. A claim at horizon k
      // grants the enemy k free turns and the collector none, and the
      // measurement says the far horizons saturate.
      const w = window - k + 1;
      num += (w * beaten) / cells.length;
      den += w;
    }
    if (den > 0) peril = num / den;
  }
  const cost = PERIL_WEIGHT * peril;

  // ── THE TEAM'S PROFIT ────────────────────────────────────────────────────
  let worst = 0;
  let best = 0;
  // A pickup by a unit that might not survive the turn might not happen, and a
  // cost we might not pay is not a cost the floor may assume away: the WORST
  // reading pays it whenever the collector could be alive at all.
  if (collector.bestAlive) worst -= cost;
  if (collector.worstAlive) best -= cost;

  for (const s of ctx.standing) {
    if (s.team !== ctx.asTeam || s.held) continue;
    if (s.unitId === collector.unitId) continue;
    if (!s.bestAlive && !s.worstAlive) continue;
    const gained = after.get(s.unitId);
    if (gained === undefined) continue;
    const unit = sub.unitOf(s.unitId);
    if (unit === undefined) continue;
    const weight = unit.weight;
    let flips = 0;
    for (let k = 1; k <= read.horizons.length; k++) {
      const h = read.horizons[k - 1] as Horizon;
      if (h.reached[s.cell] !== 1) continue;
      // The counterfactual is this ally's OWN tier at that turn, lapsed on its
      // own schedule — a level it already holds buys nothing twice.
      const bare = heldAt(s.tierAtArrival, s.tierExpiresAtTurn, arrival + k - 1);
      if (gained <= bare) continue;
      const eT = h.tier[s.cell] as number;
      const eW = h.weight[s.cell] as number;
      if (winsContest(gained, weight, eT, eW) && !winsContest(bare, weight, eT, eW)) flips++;
    }
    if (flips === 0) continue;
    const value = flips / read.horizons.length;
    // Credits are paid only where BOTH the ally and the collector live: the
    // rule gives the +1 to a living ally of a surviving collector.
    if (s.worstAlive && collector.worstAlive) worst += value;
    if (s.bestAlive && collector.bestAlive) best += value;
  }

  return [worst / ours, best / ours];
}
