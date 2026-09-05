/**
 * THE TIER WINDOW — the two members that price a tier over the turns it runs
 * for. `tier` says what holding one is worth; `potion` says whether acquiring
 * one is a trade the team should make. One file, because they are one reading:
 * the same arrival field, the same window arithmetic, the same fold.
 *
 * (`../tier-window.ts` is a different thing with a similar name: the candidate
 * generator's ORDERING seed. Nothing here is a seed — these two reach the move
 * that is actually staged.)
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
 * Both clauses are one number, and it is the ONE arithmetic both members do:
 * against the best enemy arrival at a cell, ask the rule twice — once at the
 * tier in question, once at the tier that would hold instead — and take the
 * difference. That is `edgeAt` below. `tier` asks it against ZERO, which is
 * "what our own tier is worth here"; `potion` asks it against the ally's own
 * lapsing tier, which is "what one more level would buy an ally that already
 * holds something". `winsContest` is monotone in tier, so the edge is monotone
 * too — which is what lets a tier INTERVAL be read at its two ends.
 *
 * ── OVER THE WINDOW, NOT AT THE ARRIVAL TURN ───────────────────────────────
 *
 * A tier is a window, not a state, and its value is the number of turns it
 * still runs for. `tier` reads it as two segments over a horizon of
 * `potionWindowTurns` turns starting at the arrival turn:
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
 * ── THE PICKUP, AND WHY `tier` DOES NOT ALREADY SAY IT ──────────────────────
 *
 * Collection is INVERTED (`settleTurn.ts` phase 2): the collector takes −1,
 * every LIVING ally takes +1, and both lapse `potionWindowTurns` later. So the
 * whole trade is "how many contests does the +1 flip for the rest of us,
 * against how much of the board can now beat the one who paid". The owner's
 * intent is that phrase and nothing more: take a potion when it is profitable
 * for the team AND the collector is not in great danger, and err conservative.
 *
 * `tier` above prices the window a unit HOLDS, at the one cell that unit stands
 * on, against the cells an enemy could reach THIS TURN. That covers the
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
 * `potion` is those two repairs and nothing else. The profit half is the ally's
 * own plan cell against the enemy reach at each turn of the window; the peril
 * half is the collector's OWN GROUND — every cell it could be standing on —
 * against the same, at the tier the pickup leaves it on.
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
 * ── THE PICKUP'S ARITHMETIC ────────────────────────────────────────────────
 *
 * PROFIT, per ally, at the cell the plan puts it, averaged over the window:
 *
 *     flip_k = edge at F_k between the pickup's tier and the ally's own
 *     profit = mean over k of flip_k                        ∈ [0, 1]
 *
 * The counterfactual is the ally's OWN tier at that turn, lapsed on its own
 * schedule — not zero. An ally already holding a buff that outranks everything
 * near it gains nothing from a second level, and this is the reading that says
 * so. The pickup only ever raises an ally, so `flip_k` is never negative.
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
 * THE WEIGHTS ARE ARITHMETIC AND THAT IS A MEASURED CHOICE, NOT AN UNEXAMINED
 * ONE. The audit's defect class D4 (`docs/design/BEHAVIOUR-AUDIT.md`) reads the
 * saturation above and objects, correctly, that `3, 2, 1` spends half the
 * reading on a constant: with `beaten_2 = beaten_3 = 1` this is
 * `0.5·beaten_1 + 0.5`, so `peril` runs over `[0.5, 1]` and the one horizon
 * that discriminates is halved before it meets `PERIL_WEIGHT`. Geometric
 * weights `w_k = λ^(k−1)` at `λ = 1/4` — horizon 1 at 76% — were built,
 * measured over `potions` seeds 1–8 at 60 turns, and REVERTED: they moved both
 * of the audit's own counters the wrong way, because renormalising a saturated
 * tail lowers the price of EVERY pickup and the marginal pickup that buys is an
 * exposed one. `docs/design/potions.md`, "D4", carries the numbers and the
 * mechanism; nothing here should be re-derived without reading it.
 *
 * PERIL DOMINATES, at `PERIL_WEIGHT = 2`: one ally's flipped contest does not
 * buy a collector that can be beaten anywhere it goes. That is "err
 * conservative" written as a number.
 *
 * ── ONE FOLD, TWO PARAMETERISATIONS ────────────────────────────────────────
 *
 * Both members are `ourUnitTerm` (`bound.ts`) — a mean over our live, non-held
 * units of a per-unit signed reading, under the alive-set polarity rule stated
 * once there and nowhere else. They differ in three arguments and in nothing
 * else:
 *
 *   `tier`   values a unit's own window; gated on `tierIsLive`.
 *   `potion` values the collector's cost and each ally's credit, under an
 *            alive-pair CONDITIONED on the collector — settlement pays neither
 *            half to a collector that does not survive the turn — and is
 *            bracketed over every unit that could be the collector.
 *
 * ── WHAT THEY COST, AND WHERE THEY ARE FREE ────────────────────────────────
 *
 * `tier`: ONE ARRAY READ PER UNIT PER NODE. The enemy reach field is
 * `contest`'s own (`contestField`, cached per marshalled board per subject
 * team), so this adds no second enumeration, and the read is built on first use
 * so a board the gate refuses never touches it.
 *
 * `potion`: `W` claim passes per DECISION, memoised on the marshalled board and
 * taken only where a potion is standing and live. Per node the term is one
 * array read per ally plus one already-summed number for the collector, and
 * `tiersAfterPickupBy` is the substrate's own memo.
 *
 * Both are identically zero, by construction and not by calibration, on a board
 * with no live effect and no potion: `tierIsLive` and `collectorsOf` are the
 * two gates, and every counter measured on such a board is untouched.
 *
 * ── WHERE THEY SIT ─────────────────────────────────────────────────────────
 *
 * `contest` says "this destination is a contest we lose"; `tier` says "and tier
 * is why", plus how long that stays true; `potion`, last in `FEATURES`, says
 * whether acquiring one is a trade the team should make. The overlaps are on
 * purpose and the ordering between them is the calibration: at a weight above
 * `contest` a unit would take a lost square to hold a buff, which inverts the
 * whole reason either term exists. See `DEFAULT_WEIGHTS`.
 */

import type { Claim } from '../../engine-vendor/engine/claims';
import { claimsAfter } from '../../logic/turn-oracle';
import type { CellIndex, UnitId } from '../contracts';
import type { EngineSubstrate } from '../substrate';
import { type Bound, type Feature, envelope, ourUnitTerm, point } from './bound';
import {
  type Arrival,
  type ArrivalField,
  arrivalField,
  beatenAt,
  contestField,
  frozenTier,
  winsContest,
} from './contest';
import type { EvalContext, Standing } from './features';
import { perBoard, perBoardPerTeam } from './memo';

/**
 * How much heavier the collector's peril reads than the team's profit. Two:
 * one ally's flipped contest is not worth a collector that can be beaten
 * wherever it goes, and the brief's instruction is to err conservative.
 */
export const PERIL_WEIGHT = 2;

// ---------------------------------------------------------------------------
// The window, the edge, and who collects
// ---------------------------------------------------------------------------

/**
 * The two numbers every reading here is indexed by: how many turns a pickup's
 * effect runs for, and the turn an arrival is adjudicated on.
 */
function windowOf(sub: EngineSubstrate): { readonly window: number; readonly arrival: number } {
  return { window: Math.max(1, sub.marshalled.potionWindowTurns), arrival: sub.turn + 1 };
}

/**
 * THE EDGE: what carrying `tier` rather than `against` is worth at one cell.
 * `+1` where it flips a contest that would otherwise be lost or tied, `−1`
 * where it flips one that would otherwise be won, `0` everywhere else — and
 * identically `0` at a cell no arrival reaches, which is what makes both
 * members free on a board with nothing to contest.
 */
function edgeAt(
  field: ArrivalField,
  cell: number,
  weight: number,
  tier: number,
  against: number
): number {
  if (field.reached[cell] !== 1) return 0;
  const theirTier = field.tier[cell] as number;
  const theirWeight = field.weight[cell] as number;
  const withTier = winsContest(tier, weight, theirTier, theirWeight) ? 1 : 0;
  const bare = winsContest(against, weight, theirTier, theirWeight) ? 1 : 0;
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
  field: ArrivalField,
  cell: number
): number {
  const held = Math.min(hold, window);
  if (later === null) {
    // Nothing this turn changes the tier, so it simply runs out its own hold.
    return (edgeAt(field, cell, weight, tier, 0) * held) / window;
  }
  const first = edgeAt(field, cell, weight, tier, 0) * Math.min(held, 1);
  const rest = edgeAt(field, cell, weight, later, 0) * (window - 1);
  return (first + rest) / window;
}

/**
 * Every one of our units whose destination collects a potion this turn, in
 * roster order — empty where the rules are off or nothing is standing, which
 * is both members' whole-decision gate.
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
 * reading. `potion` brackets over the list; `tier` prices the first of them,
 * which is the one settlement's own tier map is asked about.
 */
function collectorsOf(ctx: EvalContext): Standing[] {
  const sub = ctx.sub;
  const out: Standing[] = [];
  if (!sub.potionsEnabled() || sub.marshalled.potions.length === 0) return out;
  for (const s of ctx.standing) {
    if (s.team !== ctx.asTeam || s.held || !s.bestAlive) continue;
    if (sub.potionAt(s.cell)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// F10 — tier value
// ---------------------------------------------------------------------------

/**
 * Is there any tier to price on this board at all?
 *
 * Two ways there can be: a unit already carries a nonzero tier into the
 * arrival turn, or a potion is on the board and live, so a tier can be created
 * this turn. Neither, and every edge above is zero by construction — so the
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
  return perBoard(LIVE, sub.marshalled, () => {
    let live = sub.potionsEnabled() && sub.marshalled.potions.length > 0;
    if (!live) {
      for (const unit of sub.roster()) {
        if (unit.tier !== 0) {
          live = true;
          break;
        }
      }
    }
    return live;
  });
}

/** Everything `tier`'s per-unit reading needs that does not depend on the unit. */
interface TierRead {
  readonly field: ArrivalField;
  readonly window: number;
  readonly arrival: number;
  /** What settlement would leave our tiers at if the collector takes it. */
  readonly after: ReadonlyMap<UnitId, number> | null;
  /** A pickup by a unit that might not survive the turn might not happen. */
  readonly pickupCertain: boolean;
}

function tierRead(ctx: EvalContext): TierRead {
  const sub = ctx.sub;
  const collector = collectorsOf(ctx)[0];
  return {
    field: contestField(sub, ctx.asTeam),
    ...windowOf(sub),
    after: collector === undefined ? null : sub.tiersAfterPickupBy(collector.unitId),
    pickupCertain: collector !== undefined && collector.worstAlive,
  };
}

/** One unit's window, read at both ends of its tier interval. */
function tierValueOf(ctx: EvalContext, read: TierRead, s: Standing): readonly [number, number] {
  const unit = ctx.sub.unitOf(s.unitId);
  if (unit === undefined) return [0, 0];
  const weight = unit.weight;
  const { field, window, arrival } = read;

  // How many of the window's turns the arrival tier survives, if nothing this
  // turn changes it. Null expiry is a tier with no known horizon, which holds
  // for the whole window.
  const expiry = s.tierExpiresAtTurn;
  const hold = expiry === null ? window : Math.max(0, Math.min(window, expiry - arrival));

  // The tier interval, read at both ends. The edge is monotone in our tier, so
  // the ends of the interval are the ends of the value.
  const tLo = frozenTier(s.tierMin, expiry, arrival);
  const tHi = frozenTier(s.tierMax, expiry, arrival);
  const settled = read.after === null ? null : read.after.get(s.unitId);

  const noPickupLo = windowValue(tLo, null, hold, window, weight, field, s.cell);
  const noPickupHi = windowValue(tHi, null, hold, window, weight, field, s.cell);
  if (settled === undefined || settled === null) return [noPickupLo, noPickupHi];
  const pickLo = windowValue(tLo, settled, hold, window, weight, field, s.cell);
  const pickHi = windowValue(tHi, settled, hold, window, weight, field, s.cell);
  // A CONTINGENT COLLECTOR is bracketed the same way anything contingent is:
  // both the pickup and the no-pickup reading are admitted and the unit's value
  // spans them.
  return read.pickupCertain
    ? [pickLo, pickHi]
    : [Math.min(noPickupLo, pickLo), Math.max(noPickupHi, pickHi)];
}

/**
 * F10 — tier value.
 *
 * OURS ONLY, like `momentum` and `contest`, and for the same reason: it is a
 * statement about the tier state THIS decision is choosing to be in. An
 * enemy's own window is not ours to price, and pricing it would make the term
 * move whenever a claim interval moved.
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
    // The read is loop-invariant and built on first use: the gate below refuses
    // a board with no tier to price before any of it is paid for.
    let read: TierRead | null = null;
    return ourUnitTerm(
      ctx,
      (s) => tierValueOf(ctx, (read ??= tierRead(ctx)), s),
      () => tierIsLive(ctx.sub)
    );
  },
};

// ---------------------------------------------------------------------------
// F12 — the pickup trade
// ---------------------------------------------------------------------------

/** Everything one board's window reading needs, per subject team. */
interface WindowRead {
  /** Index k − 1 is the enemy field k turns into the window. */
  readonly horizons: ReadonlyArray<ArrivalField>;
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
  return perBoard(CLAIMS, sub.marshalled, () => {
    const m = sub.marshalled;
    const out: Array<ReadonlyArray<Claim>> = [];
    // No `options`: see the narrowing note in the header.
    for (let k = 1; k <= window; k++) out.push(claimsAfter(m, k));
    return out;
  });
}

function windowRead(sub: EngineSubstrate, asTeam: number, window: number): WindowRead {
  return perBoardPerTeam(READS, sub.marshalled, asTeam, () => {
    const cells = sub.grid.cells;
    const perHorizon = claimsPerHorizon(sub, window);
    const horizons: ArrivalField[] = [];
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
    return { horizons, ground };
  });
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

/**
 * The share of the collector's own ground, over the whole window, on which some
 * enemy arrival beats it at the tier the pickup leaves it on. The near turns
 * carry the reading: a claim at horizon k grants the enemy k free turns and the
 * collector none, and the measurement says the far horizons saturate. What the
 * saturated tail costs the reading is D4 in the audit, and the geometric
 * alternative to `W − k + 1` is measured and reverted in `potions.md`.
 */
function perilOf(
  ctx: EvalContext,
  read: WindowRead,
  collector: Standing,
  after: ReadonlyMap<UnitId, number>,
  window: number
): number {
  // The ground is read from where the collector stands as the turn OPENS, not
  // from the potion cell the plan sends it to. That is an over-approximation in
  // the safe direction — a superset of where it can be from the potion — and it
  // is what keeps the whole peril half memoisable per collector, not per plan.
  const unit = ctx.sub.unitOf(collector.unitId);
  if (unit === undefined) return 0;
  const debuffed = after.get(collector.unitId) ?? collector.tierAtArrival;
  const rows = read.ground.get(collector.unitId);
  let num = 0;
  let den = 0;
  for (let k = 1; k <= read.horizons.length; k++) {
    const cells = rows?.[k - 1];
    const h = read.horizons[k - 1] as ArrivalField;
    if (cells === undefined || cells.length === 0) continue;
    let beaten = 0;
    for (const cell of cells) {
      if (beatenAt(h, debuffed, unit.weight, cell)) beaten++;
    }
    const w = window - k + 1;
    num += (w * beaten) / cells.length;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

/**
 * The trade one named collector makes: its own exposure, and the windows the
 * pickup opens for everyone else, as one `ourUnitTerm` over our units.
 *
 * THE CONDITIONED ALIVE-PAIR is the whole difference from `tier`'s
 * parameterisation. Settlement pays neither half to a collector that does not
 * survive the turn, so every unit's reading here — the collector's cost and
 * each ally's credit alike — is paid only in the worlds where the collector
 * lives, and the polarity fold conditions on that pair rather than on the
 * unit's own survival alone.
 */
function tradeFor(ctx: EvalContext, read: WindowRead, collector: Standing, window: number): Bound {
  const sub = ctx.sub;
  const after = sub.tiersAfterPickupBy(collector.unitId);
  const { arrival } = windowOf(sub);
  const cost = PERIL_WEIGHT * perilOf(ctx, read, collector, after, window);

  return ourUnitTerm(
    ctx,
    (s): readonly [number, number] => {
      if (s.unitId === collector.unitId) return [-cost, -cost];
      const gained = after.get(s.unitId);
      if (gained === undefined) return [0, 0];
      const unit = sub.unitOf(s.unitId);
      if (unit === undefined) return [0, 0];
      let flips = 0;
      for (let k = 1; k <= read.horizons.length; k++) {
        const h = read.horizons[k - 1] as ArrivalField;
        // The counterfactual is this ally's OWN tier at that turn, lapsed on
        // its own schedule — a level it already holds buys nothing twice.
        const bare = frozenTier(s.tierAtArrival, s.tierExpiresAtTurn, arrival + k - 1);
        if (gained <= bare) continue;
        flips += edgeAt(h, s.cell, unit.weight, gained, bare);
      }
      if (flips === 0) return [0, 0];
      const value = flips / read.horizons.length;
      return [value, value];
    },
    undefined,
    (s) => [s.bestAlive && collector.bestAlive, s.worstAlive && collector.worstAlive]
  );
}

/**
 * F12 — the pickup trade.
 *
 * OURS ONLY, and CONTINGENT ON THE COLLECTOR: see `tradeFor`.
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
    // THE WHOLE-DECISION GATE. No live potion rules, none standing, or none of
    // ours resting on one, and every number below is zero by construction — so
    // a potion-free board never reaches a claim pass.
    const collectors = collectorsOf(ctx);
    if (collectors.length === 0) return point(0);

    const sub = ctx.sub;
    const { window } = windowOf(sub);
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
      const trade = tradeFor(ctx, read, collector, window);
      lo = Math.min(lo, trade.lo);
      hi = Math.max(hi, trade.hi);
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
