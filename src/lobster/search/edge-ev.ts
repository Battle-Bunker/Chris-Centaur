/**
 * THE EDGE-EV STORE — rung 1 and rung 2, and ORDERING ONLY.
 *
 * An "edge EV" is not a free-floating heuristic. It is a term of the Möbius
 * (interaction / ANOVA) decomposition of the true joint value around the
 * INCUMBENT reference:
 *
 *     φ_u(a)     = V(u:a ; r) − V(r)                       the first difference
 *     φ_uv(a,b)  = V(u:a, v:b ; r) − V(u:a ; r)
 *                                   − V(v:b ; r) + V(r)    the second difference
 *     Ṽ          = φ_0 + Σ φ_u + Σ φ_uv                    the order-2 truncation
 *
 * So "unary" and "pairwise" are the first two orders of an exact expansion, and
 * composing them is literally addition — one currency, no translation.
 *
 * ── THE CURRENCY ───────────────────────────────────────────────────────────
 *
 * Every number in this file is denominated in LAT.
 *
 *     1 lat  ≡  10 score units  ≡  one lightest-unit material step
 *
 * That is not a chosen scale: unit weights are integers, `materialBounds` sums
 * them, and `material` carries `CLIFF_MATERIAL_WEIGHT = 10`, so every finite
 * material floor in the corpus (241,584 of them) is a multiple of 10. A unit of
 * weight `w` dying is exactly `−w` lat. Six of the coefficients below are
 * DERIVED from the shipped weight table by dividing by ten, which makes them
 * recalibration-safe: change `DEFAULT_WEIGHTS` and they move with it.
 *
 * ── THE PLACEMENT LAW, WHICH IS NOT NEGOTIABLE ─────────────────────────────
 *
 * Edge EVs are a THIRD CHANNEL. They live outside the interval vocabulary
 * entirely: keyed by `EdgeKey`, never by a plan key; owned by `search/`; never
 * on a `Bound`, a `ScoreBounds`, a `PlanScore`, an `EmitRecord`, or an
 * `Assumption`. Folding one into `est` breaks four things independently — `est`
 * adjudicates under FOGGED-VACUOUS, the bank clamps it, the ratchet reads it,
 * and round-fusion's constant cancellation assumes it. There are zero new
 * `Assumption` kinds here and there never will be.
 *
 * And the one-line version of the rest: **a probability may choose the ORDER of
 * anything; never the SET a floor closes over.** Nothing in this file removes a
 * candidate, writes a `prunedLedger` entry, or returns a set. The consumer in
 * `candidates.ts` is a comparator slot; the consumers still to come
 * (CL3's surrogate, CL4's sampler) read the tables and spend prices, and the
 * proved floor decides in every one of them.
 *
 * ── WHAT IS BUILT HERE, AND WHAT READS IT ──────────────────────────────────
 *
 * UNARY  φ_u(u, a), consumed today by `orderKey` / `gainOrderKey`:
 *   · φ_fatal   survivor-count prior × the mover's own weight        (rank 7)
 *   · φ_meal    meal refund MAGNITUDE, per-kind, horizon-gated       (rank 9)
 *   · φ_race    the food race, as a penalty that vanishes            (rank 10)
 *   · φ_potion  the collector's own −1, plus the wasted-pickup guard (rank 15)
 *   · φ_health  health-as-plan-currency, per-kind normalised         (rank 9's E10)
 *
 * PAIRWISE  φ_uv(u:a, v:b), built on demand and consumed by NOBODY in this
 * stage — exactly the standing CL1 gave `survivorsAfter`:
 *   · sharedPrize   two of ours claiming one food; inclusion-exclusion
 *   · potionWindow  the free window, as a WITHDRAWAL of the collector's cost
 *
 * Storing an unconsumed table is deliberate. The selection layer that spends
 * these is CL4, it cannot recompute them after the fact, and promoting an
 * ordering key is a measured change that belongs to the rung that measures it.
 *
 * ── POLARITY (contract rule 21), WHICH SHAPED TWO OF THE FIVE ──────────────
 *
 * NO OPPONENT-DERIVED SIGNAL MAY MAKE ONE OF OUR MOVES MORE ATTRACTIVE. Enemy
 * geometry has exactly one legitimate polarity in an ordering, and it is down:
 * the sanctioned form is "do not penalise entering the line", never "prefer
 * entering the line".
 *
 * Two terms here read the enemy, and both are written as penalties that
 * VANISH rather than bonuses that appear:
 *
 *   · φ_race reads `dist(theirs)`. A meal we own by two turns costs zero; a
 *     meal we are two turns late for costs the full weight. Same
 *     discrimination, legal polarity — and it disarms the passivity attractor
 *     E8 names as its own failure mode, since a term that cannot attract
 *     cannot attract us into empty space either.
 *   · `potionWindow` reads enemy weights. It gives back at most the
 *     collector's own measured `EPS_POTION_COST` and never a lat more.
 *
 * Everything else — the survivor count, the refund, the health currency, the
 * wasted-pickup guard — is computed without looking at an enemy at all, which
 * is the cheapest way to satisfy the rule and the reason the fatal term
 * deliberately inherits CL1's enemy-blind occupancy reading rather than a
 * better-informed one.
 *
 * ── WHY THE POTION TERMS CAN SHIP HERE AND NOWHERE ELSE ────────────────────
 *
 * The potion-board widening is HELD upstream: it caused an 858-inversion storm
 * (B0 floor above B1 ceiling) and waits on an engine fix to `tierMax`, which is
 * wrong by one turn AND by polarity. None of that reaches an ordering key.
 * `candidates.ts` documents its own order as carrying "no soundness weight
 * whatsoever", so the potion board can be read HERE today, at zero soundness
 * risk, with the cloud left exactly as blind as it is.
 */

import { bbTest, profileOf } from '../../partial-engine/index';
import type { Candidate, CellIndex, UnitId } from '../contracts';
import type { EngineSubstrate, SubstrateUnit } from '../substrate';
import { StampedInt32 } from '../scratch';

/*
 * `CENTAUR_EDGE_EV` IS DELETED — TODO(teardown-search) row retired here.
 *
 * The rung-1/2 EV pass is now a CONFIGURATION of the search surface
 * (`SearchTuning.edgeEv`, `CandidateKnobs.edgeEv`) and not an environment
 * switch: one seat carries the terms while the seat across the board does not,
 * and neither answer is a property of the process. Default off, by stated
 * default rather than by a variable nobody can see — the pass is probe-passed
 * and has not been judged on a live race.
 */

// ---------------------------------------------------------------------------
// The currency, and the coefficients derived from it
// ---------------------------------------------------------------------------

/** One lat, in score units. Derived from the shipped weight table, never chosen. */
export const LAT = 10;

/**
 * WHAT A MEAL IS WORTH IN MATERIAL, EXACTLY.
 *
 * A meal is +1 weight for every kind (F4), and weight IS the material lattice,
 * so a meal's material half is exactly one lat. This is the only coefficient in
 * the file that is a rules fact rather than a division.
 */
const W_MEAL_MATERIAL = 1;

/**
 * WHAT ONE FULL UNIT OF HEALTH SHARE IS WORTH.
 *
 * `healthEconomy` carries weight 0.5 and is `health / maxHealth` per unit, so
 * one whole health share is 0.5 score = 0.05 lat. DERIVED, not chosen: it moves
 * automatically if the weight table is recalibrated. And correctly tiny — the
 * measured across-candidate span of the whole feature is 0.47–2.56 score.
 */
const W_HEALTH = 0.05;

/**
 * THE RACE MARGIN'S WEIGHT — AND ITS POLARITY, WHICH IS THE WHOLE DESIGN.
 *
 * An uncontested eat is worth +0.120 placement against +0.076 for a contested
 * one; 57.1% of all food is never eaten by anybody, and lobster-territory
 * leaves 4.36 free foods standing per game. That is the largest single quantity
 * in the economy lens and it wants a term.
 *
 * But the margin is `dist(theirs) − dist(ours)`, and `dist(theirs)` is ENEMY
 * GEOMETRY. Contract rule 21: no opponent-derived signal may make one of our
 * moves MORE attractive; enemy geometry has exactly one legitimate polarity in
 * an ordering, which is DOWN. The sanctioned form is "do not penalise entering
 * the line", never "prefer entering the line".
 *
 * So this term is written as a PENALTY THAT VANISHES, not a bonus that appears:
 * a meal we own by two turns costs nothing, a meal we are two turns late for
 * costs the full weight, and the discrimination between them is identical
 * either way. It cannot attract, which also disarms the passivity attractor
 * E8 names as its own second failure mode — the program has confirmed four
 * separate times that rewarding "go where nobody contests you" structurally
 * selects passive play.
 *
 * ── THE SIZE, WHICH IS A RELATION AND NOT A NUMBER ─────────────────────────
 *
 * HALF the refund's maximum span, so that THE RACE BREAKS THE REFUND'S TIES
 * AND NEVER OVERRULES THEM. The refund is the derived, better-evidenced term —
 * `w_he` divided by ten, and the highest-confidence item in the economy
 * catalogue — while the race's own conversion into lat is not measured
 * anywhere. Ordering the two by evidence rather than by taste is the whole
 * calibration, and it is the same shape as CL1's follow bonus, which is worth
 * one ordering place and never two.
 *
 * MEASURED, and the relation is what the measurement picked out. At 0.04 —
 * large enough to overrule a refund — the probe read 84 resolver-verified eats
 * to 82, buying 3 uncontested ones. At 0.025 and below — too small to overrule
 * one — it read 84 to 83 and bought the same 3. Same benefit, half the cost,
 * and the boundary sits exactly where the relation says it should.
 */
const W_RACE = W_HEALTH * 0.5;

/** Where the margin saturates. Two turns clear is clear; ten is not clearer. */
const RACE_SATURATION = 2;

/**
 * WHAT COLLECTING A POTION COSTS THE COLLECTOR, ALWAYS.
 *
 * The pickup is INVERTED (F7): the collector takes the −1 and its `n−1` living
 * allies take the +1. `strictMaximum` is absolute, so a debuffed unit cannot
 * win a contest at all — 0 kills in 3,549 debuffed unit-turns, corpus-wide —
 * and the collector died inside its own debuff on 7.9% [6.7, 9.4] of 1,565
 * pickups. That is an OWN-SIDE cost, measured, and it is charged to every
 * collector without looking at the enemy at all.
 *
 * Charging it is also what makes the pair edge legal (see `EPS_POTION_WINDOW`):
 * a penalty can be withdrawn by enemy geometry, and a bonus cannot be granted
 * by it.
 */
const EPS_POTION_COST = W_HEALTH * 0.5;

/**
 * THE ALREADY-BUFFED COLLECTOR'S EXTRA DEMOTION.
 *
 * 21.9% of 1,565 corpus pickups were made by a unit that was ALREADY buffed —
 * burning a team-mate's −1 for nothing, since the benefit lands on the allies
 * who did not collect and this collector already had the tier. Own-side, sign
 * unambiguous, magnitude unmeasured, so it gets the smallest number that can
 * move an order.
 */
const EPS_POTION_WASTE = W_HEALTH * 0.1;

/**
 * THE CONTESTED-PROMOTION DEMOTION — E4, as an EV and never as a refusal.
 *
 * Promotion resets weight to 1, so the team score drops by `threshold − 1` on
 * the promoting meal, and the turn after a promotion is the most dangerous turn
 * in that unit's life: it hands the opponent a weight-1 unit under a rule where
 * a tie kills everyone. But charging the raw score drop would REFUSE the only
 * meal a starving pawn can reach, which is the failure the shipped
 * `refusePromotion` knob already concedes and is why it defaults off.
 *
 * So this is the memo's own "practical shape" and nothing more: never refuse,
 * demote when the landing is contested. Sub-lat, correct sign, and no free
 * magnitude parameter to fit — a promotion at a quiet cell costs nothing here.
 */
const EPS_PROMOTION_CONTESTED = W_HEALTH * 0.5;

/**
 * THE PAIR TERMS' COEFFICIENTS.
 *
 * `sharedPrize` is inclusion-exclusion and therefore EXACT in its own currency:
 * two of our units landing on one food collect one meal between them, so the
 * joint value double-counts by exactly `min(gain_a, gain_b)` and the second
 * difference is that number negated. Nothing is fitted, and no enemy is read.
 *
 * `potionWindow` is a WITHDRAWAL and never a grant, which is the only shape
 * rule 21 permits for a term that reads enemy weights. It gives back at most
 * the collector's own `EPS_POTION_COST`, so the potion channel's total over
 * (unary + pair) is bounded above by ZERO in every branch enemy geometry
 * touches — the same standing CL1 established for the sacrifice gate, and the
 * suite asserts it the same way.
 *
 * It is also the honest sizing. The free-window geometry is present on 8.0% of
 * team-turns, but the corpus contains no evidence of a single deliberately
 * taken window, so there is nothing to fit a magnitude AGAINST. Withdrawing a
 * measured cost needs no fitted number; granting an unmeasured bonus would.
 */
const EPS_POTION_WINDOW = EPS_POTION_COST;

// ---------------------------------------------------------------------------
// The third-channel key
// ---------------------------------------------------------------------------

/**
 * THE EDGE KEY — never a plan key, and the type is the enforcement.
 *
 * A plan key names a joint assignment the bank may price and the bound layer
 * may close over. An edge key names a (unit, action) or a (unit, action) pair
 * and is addressable ONLY by this channel. Keeping them different types is what
 * stops an edge EV being handed to something that takes bounds — the mistake
 * would otherwise typecheck.
 */
export type EdgeKey = string & { readonly __edgeKey: unique symbol };

export function unaryKey(unitId: UnitId, to: CellIndex): EdgeKey {
  return `u${unitId}:${to}` as EdgeKey;
}

export function pairKey(
  a: UnitId,
  aTo: CellIndex,
  b: UnitId,
  bTo: CellIndex,
): EdgeKey {
  // Canonical order, so `(u,v)` and `(v,u)` are one edge and the store cannot
  // hold two rows that disagree.
  return (a < b || (a === b && aTo <= bTo)
    ? `p${a}:${aTo}|${b}:${bTo}`
    : `p${b}:${bTo}|${a}:${aTo}`) as EdgeKey;
}

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

export interface EdgeEvTuning {
  /**
   * THE TURN CAP, OR ITS ABSENCE — and the absence is the default on purpose.
   *
   * Food further than `turnCap − turn` grammar turns away cannot be collected
   * and its EV is exactly zero. That is free and exactly correct WHEN THERE IS
   * A CAP. But `maxTurns` is a HARNESS field: production's clock is
   * `maxTurnTime`, a wall clock, and production may carry no turn cap at all.
   * Reading a cap that does not exist would zero real food, so an absent cap
   * means NO CAP and the gate does not fire.
   *
   * 127 of 192 corpus games ended at the cap, where adjudication is on survival
   * and material — so where a cap exists, late-game meal EV genuinely should
   * rise against positional terms.
   */
  readonly turnCap?: number | null;
  /**
   * E7's SUPPLY-PRESSURE SCALAR, on the refund and race weights.
   *
   * Scarce boards convert food better than abundant ones (P(eaten) 0.55 against
   * 0.40), so how scarce the FUTURE supply is should condition how hard a unit
   * races for food NOW. 1 is neutral and is the default.
   *
   * NOT WIRED TO A SOURCE IN THIS STAGE, and the reason is worth stating rather
   * than hiding behind the default. The only trustworthy source is the OBSERVED
   * spawn count over the last k turns — never `foodSpawnRate`, which silently
   * means /100 above 5 and has no rules validation, and never
   * `fertileGroundDensity`, whose zero value means food spawns EVERYWHERE and
   * whose shipped guard reads it exactly backwards. Observed spawns need a
   * cross-turn ledger, and a substrate is a single-turn snapshot: the seam is
   * `TeamDecisionEngine`'s per-game state, which is a wider change than an
   * ordering term earns. The hook is here so the term is one assignment away.
   */
  readonly supplyPressure?: number;
  /** How far the race BFS floods. Two turns clear is clear; four is slack. */
  readonly raceHorizon?: number;
}

export const DEFAULT_EDGE_EV_TUNING: Required<EdgeEvTuning> = {
  turnCap: null,
  supplyPressure: 1,
  raceHorizon: 4,
};

/** Pressure, clamped. An unclamped multiplier on a starving board is a bomb. */
const MAX_PRESSURE = 2;

// ---------------------------------------------------------------------------
// The per-decision economy: two BFS fronts, and nothing else that costs
// ---------------------------------------------------------------------------

/**
 * THE RACE MARGIN, AS TWO MULTI-SOURCE FLOODS.
 *
 *     margin(f) = dist(nearest OTHER team, f) − dist(nearest OWN team unit, f)
 *
 * Two fronts: one seeded at every unit of ours, one at every unit of everyone
 * else. Positive means we get there first; the σ below saturates it at two.
 *
 * ── THE APPROXIMATION, STATED PLAINLY ──────────────────────────────────────
 *
 * This is a STEP-LATTICE flood, not the grammar's own dilation. Depth 0 is the
 * seeds; depth 1 additionally carries each SLIDER's full ray reach from its own
 * head; every later depth expands by the union of the team's single-cell step
 * offsets over non-wall terrain. So it is exact for steppers, exact for a
 * slider's first turn, and optimistic for a slider's second and later turns
 * (which is where a slider's reach is already board-wide and the extra
 * precision buys nothing).
 *
 * The alternative — one `CloudSource` dilation per unit — is the grammar-exact
 * answer and costs ~24 µs per COLD unit. Every unit is cold every decision,
 * because a record's key is its occupancy and the occupancy changed. At 24
 * units that is 576 µs against a whole-pass budget of 50, so the exact form is
 * not available at this rung at any price. It is available at rung 3, where a
 * cluster already pays for dilations, and the honest place to sharpen this is
 * there.
 *
 * That is a legitimate trade EXACTLY BECAUSE this is the third channel: an
 * optimistic reach here can order two candidates wrongly and can never make a
 * floor unsound. The same approximation inside a bound would be a defect.
 */
export class RaceFronts {
  /** depth from our own units, per cell. */
  private ours: StampedInt32;
  /** depth from every other team's units, per cell. */
  private theirs: StampedInt32;
  private queue: Int32Array;
  /** The cells the floods are FOR — see `build`. Reused across decisions. */
  private targets: Int32Array;
  private targetCount = 0;
  private cells = 0;
  /** Step offsets, unpacked. Rebuilt per side per decision, allocated once. */
  private dx = new Int32Array(16);
  private dy = new Int32Array(16);
  /** True once a decision's floods have run and have something to say. */
  private live = false;

  constructor() {
    this.ours = new StampedInt32(0);
    this.theirs = new StampedInt32(0);
    this.queue = new Int32Array(0);
    this.targets = new Int32Array(0);
  }

  private ensure(cells: number): void {
    if (this.cells >= cells) return;
    this.ours = new StampedInt32(cells);
    this.theirs = new StampedInt32(cells);
    this.queue = new Int32Array(cells);
    this.targets = new Int32Array(cells);
    this.cells = cells;
  }

  /**
   * FLOOD BOTH SIDES, TOWARD THE CELLS THAT ASKED.
   *
   * The floods exist to answer one question — who wins the race to each FOOD —
   * so they are seeded at the units and terminated at the food, not run to the
   * horizon for its own sake. Three consequences, and each is worth more than
   * the code it costs:
   *
   *   · A board with no food does not flood AT ALL. The term is read only at
   *     food cells, so on a foodless board the whole per-decision cost of this
   *     class is one bitboard sweep. That is the same discipline that keeps
   *     the conflict index out of a decision nothing consumes it in.
   *   · A flood stops the moment every food cell is settled. BFS settles in
   *     nondecreasing depth, so an early stop cannot change an answer it
   *     already gave — and on a real board the nearest food is a few steps
   *     away, which is where the whole cost went before.
   *   · Depths at NON-food cells are therefore best-effort and generally
   *     absent. That is the contract, not a defect: `marginAt` reads absent as
   *     "nobody is racing for this", which costs nothing, which is the only
   *     answer a down-only term may give when it does not know.
   *
   * Stamped, so a rebuild is two integer increments and no clear.
   */
  build(sub: EngineSubstrate, ourTeam: number, horizon: number): void {
    const cells = sub.grid.cells;
    this.ensure(cells);
    this.live = false;
    this.targetCount = 0;
    for (let c = 0; c < cells; c++) {
      if (sub.foodAt(c as CellIndex)) this.targets[this.targetCount++] = c;
    }
    if (this.targetCount === 0) return;
    this.ours.begin();
    this.theirs.begin();
    this.live = true;
    const roster = sub.roster();
    this.flood(sub, roster, ourTeam, true, horizon, this.ours);
    this.flood(sub, roster, ourTeam, false, horizon, this.theirs);
  }

  private flood(
    sub: EngineSubstrate,
    roster: ReadonlyArray<SubstrateUnit>,
    ourTeam: number,
    own: boolean,
    horizon: number,
    depth: StampedInt32,
  ): void {
    const grid = sub.grid;
    const wall = sub.terrain.wall;
    const width = grid.width;
    const height = grid.height;
    const queue = this.queue;
    let head = 0;
    let tail = 0;

    // The union of step offsets this side can take, as dx/dy and not packed:
    // an integer division per neighbour was the single most expensive
    // instruction in this loop.
    const dx = this.dx;
    const dy = this.dy;
    let dirs = 0;
    const pushStep = (sx: number, sy: number): void => {
      if (sx === 0 && sy === 0) return;
      for (let i = 0; i < dirs; i++) if (dx[i] === sx && dy[i] === sy) return;
      if (dirs >= dx.length) return;
      dx[dirs] = sx;
      dy[dirs] = sy;
      dirs++;
    };

    for (const unit of roster) {
      if ((unit.team === ourTeam) !== own) continue;
      const profile = profileOf(unit.kind);
      for (const [sx, sy] of profile.steps) pushStep(sx, sy);
      // A ray direction is also a single step — a slider may stop after one.
      for (const [sx, sy] of profile.rays) pushStep(sx, sy);
      const head0 = unit.cells[0] as number;
      if (depth.setMin(head0, 0)) queue[tail++] = head0;
    }
    if (tail === 0) return;

    // Depth 1 for sliders: the whole ray, from the head, stopping at wall.
    // Sweeping only from the SOURCES bounds this at (units × dirs × maxRay)
    // rather than at (cells × dirs × maxRay), which is the difference between
    // a few thousand reads and a hundred thousand.
    for (const unit of roster) {
      if ((unit.team === ourTeam) !== own) continue;
      const profile = profileOf(unit.kind);
      if (profile.rays.length === 0) continue;
      const from = unit.cells[0] as number;
      const fx = from % width;
      const fy = (from - fx) / width;
      for (const [rx, ry] of profile.rays) {
        let x = fx + rx;
        let y = fy + ry;
        while (x >= 0 && x < width && y >= 0 && y < height) {
          const cell = y * width + x;
          if (bbTest(wall, cell)) break;
          if (depth.setMin(cell, 1)) queue[tail++] = cell;
          x += rx;
          y += ry;
        }
      }
    }

    // How many of the cells this flood is FOR are still unsettled. Zero ends
    // it: BFS settles in nondecreasing depth, so nothing later could lower a
    // depth already written.
    let remaining = 0;
    for (let i = 0; i < this.targetCount; i++) {
      if (!depth.has(this.targets[i] as number)) remaining++;
    }

    while (head < tail && remaining > 0) {
      const cell = queue[head++] as number;
      const d = depth.get(cell, 0);
      if (d >= horizon) continue;
      const cx = cell % width;
      const cy = (cell - cx) / width;
      for (let i = 0; i < dirs; i++) {
        const nx = cx + (dx[i] as number);
        const ny = cy + (dy[i] as number);
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (bbTest(wall, next)) continue;
        if (!depth.setMin(next, d + 1)) continue;
        queue[tail++] = next;
        if (sub.foodAt(next as CellIndex)) remaining--;
      }
    }
  }

  /**
   * `margin(cell)`, saturated at ±`RACE_SATURATION`.
   *
   * Neither side reaching within the horizon reads as `RACE_SATURATION` — fully
   * clear — and not as 0. That is the conservative answer for a term whose only
   * polarity is down: "nobody is racing for this" must cost nothing, and a cell
   * the flood could not reach is a cell nobody is racing for as far as this
   * flood knows. Unreached on ONE side means clear by more than the horizon,
   * which saturates in that side's favour.
   */
  marginAt(cell: CellIndex): number {
    if (!this.live) return RACE_SATURATION;
    const OUT = 1 << 20;
    const a = this.ours.get(cell as number, OUT);
    const b = this.theirs.get(cell as number, OUT);
    if (a >= OUT && b >= OUT) return RACE_SATURATION;
    const raw = b - a;
    return raw > RACE_SATURATION
      ? RACE_SATURATION
      : raw < -RACE_SATURATION
        ? -RACE_SATURATION
        : raw;
  }

  /**
   * How much of the race weight a cell FORFEITS: 0 where we are clear by the
   * saturation, 1 where they are. The term that reads this is negated, so this
   * is a loss fraction and never a gain one.
   */
  lossFractionAt(cell: CellIndex): number {
    const margin = this.marginAt(cell);
    const raw = (RACE_SATURATION - margin) / (2 * RACE_SATURATION);
    return raw < 0 ? 0 : raw > 1 ? 1 : raw;
  }

  /** Our own arrival depth at a cell, or −1 when the horizon does not reach it. */
  ourDepthAt(cell: CellIndex): number {
    if (!this.live) return -1;
    return this.ours.get(cell as number, -1);
  }
}

/**
 * THE FROZEN PER-DECISION FACTS every unary term reads.
 *
 * Built once per (substrate, team) and shared by every unit of it — the same
 * shape and the same lifetime as the rung-0 occupancy reading, and for the same
 * reason: these are facts about the board and the clock, not about the mover.
 */
export class DecisionEconomy {
  readonly fronts = new RaceFronts();
  readonly tuning: Required<EdgeEvTuning>;
  /** `turnCap − turn`, or `Infinity` when the configuration carries no cap. */
  readonly turnsRemaining: number;
  /** Clamped E7 scalar on the refund and race weights. */
  readonly pressure: number;
  private readonly sub: EngineSubstrate;

  constructor(sub: EngineSubstrate, ourTeam: number, tuning: EdgeEvTuning = {}) {
    this.sub = sub;
    this.tuning = { ...DEFAULT_EDGE_EV_TUNING, ...tuning };
    const cap = this.tuning.turnCap;
    this.turnsRemaining =
      cap === null || cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, cap - sub.turn);
    this.pressure = Math.min(MAX_PRESSURE, Math.max(0, this.tuning.supplyPressure));
    this.fronts.build(sub, ourTeam, this.tuning.raceHorizon);
  }

  /**
   * The mover's kind's OWN maximum health — never the flat ceiling.
   *
   * `maxHealthPerUnit` is per-kind on the wire and the food phase restores to
   * the EATER'S kind's maximum, but `substrate` computes a flat `maxHealth` as
   * a MAXIMUM over the table and `healthEconomyFeature` normalises by that. On
   * a flat configuration the two agree; on any per-kind board the shipped
   * feature is mis-normalised and this term is not.
   */
  maxHealthOf(kind: number): number {
    return this.sub.engine.maxHealthOf(kind);
  }

  /** Is a meal at this cell inside the clock? Exactly zero EV when it is not. */
  withinHorizon(cell: CellIndex): boolean {
    if (this.turnsRemaining === Number.POSITIVE_INFINITY) return true;
    const depth = this.fronts.ourDepthAt(cell);
    // Unreached within the flood horizon says nothing about the turn cap; only
    // a KNOWN depth past the clock is a proof of worthlessness.
    return depth < 0 || depth <= this.turnsRemaining;
  }
}

// ---------------------------------------------------------------------------
// The unary potential
// ---------------------------------------------------------------------------

/** What a unary φ is made of. Retained for calibration; inference reads `ev`. */
export interface UnaryParts {
  readonly fatal: number;
  readonly meal: number;
  readonly race: number;
  readonly potion: number;
  readonly health: number;
}

export const ZERO_PARTS: UnaryParts = { fatal: 0, meal: 0, race: 0, potion: 0, health: 0 };

/** What the unary term needs to know about a candidate, without importing it. */
export interface UnaryInput {
  readonly candidate: Candidate;
  /** Cells the move could come to REST on. */
  readonly landing: ReadonlyArray<CellIndex>;
  /** Health the move spends, at its interval endpoints. */
  readonly healthSpent: { readonly lo: number; readonly hi: number };
  /** The risk layer's tier for this move. */
  readonly tier: 'safe' | 'atRisk' | 'doomed';
  /** Does the move take something? */
  readonly capture: 'yes' | 'maybe' | 'no';
  /** The calibrated survival prior from the rung-0 classifier, or 1 for unknown. */
  readonly survivalPrior: number;
}

/**
 * φ_u(a), IN LAT, AS A SUM OF NAMED PARTS.
 *
 * Read the parts, not just the total: the calibration regression and the
 * EV-CLIFF law both need the split, and a total that cannot be attributed is a
 * total nobody can falsify.
 */
export function unaryParts(
  economy: DecisionEconomy,
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  input: UnaryInput,
): UnaryParts {
  const maxHealth = Math.max(1, economy.maxHealthOf(unit.kind));
  const pressure = economy.pressure;

  // ── φ_fatal ──────────────────────────────────────────────────────────────
  // Expected material lost, and therefore already in lat with no conversion:
  // the survivor-count prior is P(survive one turn) and the mover's weight IS
  // the material at stake.
  //
  // IDENTICALLY zero — the literal +0, and not the −0 the arithmetic produces
  // on its own — when the rung-0 classifier did not run. That is what lets this
  // flag compose with `unitFatality` instead of being a paired experiment with
  // it, and the distinction is worth a branch: a −0 compares equal to 0
  // everywhere the comparator looks and is a different value everywhere a
  // reader looks.
  const fatal = input.survivalPrior >= 1 ? 0 : -(1 - input.survivalPrior) * unit.weight;

  // ── φ_meal, φ_race, φ_potion ─────────────────────────────────────────────
  let meal = 0;
  let race = 0;
  let potion = 0;
  let eats = false;
  // A CERTAIN landing is one the mover has no choice about: `landing` is the
  // set of cells the move could come to REST on, so a singleton is a move whose
  // stop the rules already settled. See `MAGNITUDE ONLY WHERE THE MEAL IS REAL`
  // below for why this branch exists at all — it is not a micro-optimisation,
  // it is the difference between sharpening a meal and betting on one.
  const certain = input.landing.length === 1;
  for (const cell of input.landing) {
    if (sub.foodAt(cell) && economy.withinHorizon(cell)) {
      eats = true;
      // ── MAGNITUDE ONLY WHERE THE MEAL IS REAL ──────────────────────────
      //
      // The shipped `foodGain` is deliberately optimistic — "a world exists in
      // which the mover eats" — and as a BINARY key that is right: it separates
      // the eats from the non-eats and the search decides whether that world is
      // worth anything.
      //
      // As a MAGNITUDE the same optimism inverts. A ray whose only food is at a
      // contingent truncation point would be credited exactly as much as a step
      // that certainly lands on food, and since the magnitude reorders WITHIN
      // the eat block, crediting them equally means the speculative meal wins
      // whenever its arithmetic happens to come out ahead. Measured: the
      // unguarded form took resolver-verified eats from 84 to 77 over sixty
      // piece boards while the staged-eat count barely moved — the layer was
      // trading meals it would have got for meals it might get.
      //
      // So the material half stays exactly as optimistic as `foodGain` (it IS
      // `foodGain`, in lat), and the sharpening half speaks only about a meal
      // the rules have already settled.
      const one = W_MEAL_MATERIAL + (certain ? W_HEALTH * mealDeficit(unit, input, maxHealth) * pressure : 0);
      if (one > meal) meal = one;
      // THE RACE, AND ONLY AT FOOD WE WILL ACTUALLY REACH. E8 is a term about
      // food races, so it is read at food cells and nowhere else — a general
      // "prefer cells the enemy is far from" field would be a repulsion map,
      // which is both a rule-21 problem and the passivity attractor in its
      // purest form. Negated: a meal we own costs nothing, a meal we are late
      // for costs the weight, and enemy geometry only ever subtracts. Gated on
      // the same certainty as the refund, because a race for a meal that may
      // not happen is not a race.
      if (certain) {
        const loss = -W_RACE * pressure * economy.fronts.lossFractionAt(cell);
        if (loss < race) race = loss;
      }
    }
    if (sub.potionAt(cell)) {
      // F7, own-side and absolute: the collector takes the −1 and cannot win a
      // contest while it lasts. Charged to every collector.
      potion -= EPS_POTION_COST;
      // E3d: and charged AGAIN when the collector already had the tier, which
      // is a team-mate's −1 burned for nothing.
      if (unit.tier > 0) potion -= EPS_POTION_WASTE;
    }
  }

  if (eats && promotesOn(sub, unit, input.landing)) {
    // E4: never refuse, demote when contested. The score drop is real and is
    // NOT charged — charging it would starve the pawn that has one meal.
    if (input.capture !== 'no' || input.tier !== 'safe') meal -= EPS_PROMOTION_CONTESTED;
  }

  // ── φ_health ─────────────────────────────────────────────────────────────
  // E10: a slider's affordable option set is bounded by health, not by turns,
  // and "cells of travel remaining" is the one quantity measured to have real
  // spread over a piece's own options (47–195× against reach and room). Zero
  // when the move eats, because the eater's health is restored on arrival and
  // charging it is simply wrong about the rules — the same correction I3 made
  // to `gainOrderKey`, kept here so the two channels cannot disagree.
  //
  // ORDERING-INERT AT THE COMPARATOR SLOT, AND THAT IS NOT A BUG. Within one
  // unit `maxHealth` is a constant, so this term is a strictly decreasing
  // function of `healthSpent.hi` — which is exactly the key sitting one slot
  // BELOW it. It therefore induces the identical order and can never move a
  // comparison the shipped key would not have moved. Measured: over the 41
  // unit-decisions of the acceptance fixture the composed EV is nonzero on all
  // 41 and the order moves on none.
  //
  // It is carried anyway, and for a reason that is about the STORE rather than
  // the comparator: CL3's surrogate and CL4's sampler compare ACROSS units,
  // where per-kind normalisation is the whole point — `healthEconomyFeature`
  // normalises by the flat `maxHealth` ceiling, a maximum over the per-kind
  // table, and on any per-kind board that is the wrong denominator. This term
  // reads `engine.maxHealthOf(kind)`. A number that is redundant here and
  // correct there belongs here, unread, rather than being re-derived there
  // from the wrong table.
  const health = eats ? 0 : -W_HEALTH * (input.healthSpent.hi / maxHealth);

  return { fatal, meal, race, potion, health };
}

export function unaryEv(parts: UnaryParts): number {
  return parts.fatal + parts.meal + parts.race + parts.potion + parts.health;
}

/**
 * How much of its kind's maximum the eater is missing when it arrives.
 *
 * The refund a meal actually pays: `resolveTurn` sets an eater's health to its
 * KIND'S maximum, so what the meal is worth is what the mover was short. A
 * longer approach therefore refunds MORE — not a bug: the health it spent
 * getting there is exactly what the arrival gives back.
 */
function mealDeficit(
  unit: SubstrateUnit,
  input: UnaryInput,
  maxHealth: number,
): number {
  const after = Math.max(0, unit.health - input.healthSpent.hi);
  return (maxHealth - Math.min(maxHealth, after)) / maxHealth;
}

/**
 * Would this meal promote the mover? The threshold is the engine's configured
 * `pawnPromotionWeight` and whether the kind promotes at all is `promotesTo` —
 * never a name comparison, and never a second predicate: this is the same test
 * `candidates.ts` already runs behind `refusePromotion`.
 */
function promotesOn(
  sub: EngineSubstrate,
  unit: SubstrateUnit,
  landing: ReadonlyArray<CellIndex>,
): boolean {
  if (profileOf(unit.kind).promotesTo === null) return false;
  if (unit.weight + 1 < sub.engine.config.pawnPromotionWeight) return false;
  return landing.some((cell) => sub.foodAt(cell));
}

// ---------------------------------------------------------------------------
// The pairwise potential
// ---------------------------------------------------------------------------

export type PairFamily = 'sharedPrize' | 'potionWindow';

/** One nonzero cell of a sparse pairwise table. */
export interface PairCell {
  /** Index into `a`'s candidate list. */
  readonly ia: number;
  /** Index into `b`'s candidate list. */
  readonly ib: number;
  /** φ_ab in lat. */
  readonly ev: number;
  readonly family: PairFamily;
}

/**
 * A pairwise table, SPARSE — most `(a,b)` cells are zero, because two units
 * interact on a handful of their ≤64 combinations, not on all of them. At the
 * measured edge count that is a couple of hundred numbers, not a couple of
 * thousand.
 */
export interface PairTable {
  readonly a: UnitId;
  readonly b: UnitId;
  readonly cells: ReadonlyArray<PairCell>;
  /** max |ev| over `cells` — the edge's mass, for thresholding and repair order. */
  readonly mass: number;
}

/** What the pair builder needs about one unit's option set. */
export interface PairInput {
  readonly unitId: UnitId;
  readonly unit: SubstrateUnit;
  readonly options: ReadonlyArray<{
    readonly landing: ReadonlyArray<CellIndex>;
    readonly mealEv: number;
  }>;
}

/**
 * φ_uv FOR THE TWO ECONOMY FAMILIES, AS INCLUSION-EXCLUSION.
 *
 * Almost every real pairwise term in this game is a DOUBLE-COUNT CORRECTION:
 * the unaries priced each unit as if it acted alone, and the pair shares
 * something. That reading is what makes the class enumerable instead of
 * open-ended, and both families here are instances of it.
 *
 *   sharedPrize   `a` and `b` land on the same food. One meal exists; two were
 *                 credited. φ = −min(gain_a, gain_b), which is EXACT — nothing
 *                 is fitted, and the term vanishes the moment either unit picks
 *                 a different cell.
 *
 *   potionWindow  `a` collects a potion and `b` attacks inside the window it
 *                 opens. Neither singleton is worth anything and the pair is
 *                 worth the contest, which is a pair edge in the strict sense.
 *                 GATED ON THE OFF-BY-ONE: pickup is POST-resolution, so a
 *                 potion taken on turn N first prices contests on N+1 — the
 *                 attack half is a NEXT-turn quantity and this stage prices
 *                 only the standing geometry that makes one possible. And it
 *                 carries the collector's own cost: a debuffed unit cannot win
 *                 a contest at all (0 kills in 3,549 debuffed unit-turns) and
 *                 died inside its own debuff on 7.9% of pickups, so a window
 *                 edge without `−risk_debuff` is a suicide generator.
 *
 * NOTHING READS THIS IN CL2. It is built because the layer that spends it
 * cannot recompute it after the fact — the same standing the rung-0 survivor
 * count was given, for the same reason.
 */
export function pairTable(
  sub: EngineSubstrate,
  a: PairInput,
  b: PairInput,
): PairTable | null {
  if (a.unitId === b.unitId) return null;
  const cells: PairCell[] = [];
  let mass = 0;
  const push = (ia: number, ib: number, ev: number, family: PairFamily): void => {
    if (ev === 0) return;
    cells.push({ ia, ib, ev, family });
    const m = Math.abs(ev);
    if (m > mass) mass = m;
  };

  for (let ia = 0; ia < a.options.length; ia++) {
    const oa = a.options[ia] as PairInput['options'][number];
    for (let ib = 0; ib < b.options.length; ib++) {
      const ob = b.options[ib] as PairInput['options'][number];
      if (oa.mealEv > 0 && ob.mealEv > 0 && sharesFood(sub, oa.landing, ob.landing)) {
        push(ia, ib, -Math.min(oa.mealEv, ob.mealEv), 'sharedPrize');
      }
    }
  }

  // THE FREE WINDOW, AS A WITHDRAWAL.
  //
  // A safe non-king collector takes a potion; an ally has, inside the window it
  // opens, an enemy it does not already beat on weight. Neither singleton is
  // worth anything and the pair is worth the contest.
  //
  // What this may NOT do is make the pickup attractive: `outweighedByAnyEnemy`
  // reads enemy weights, and rule 21 gives enemy geometry exactly one polarity.
  // So the edge gives back at most the collector's own `EPS_POTION_COST` and
  // never a lat more — the unary charged the cost, this withdraws it, and the
  // channel's total stays bounded above by zero.
  //
  // The collector must not already be buffed (E3d: the pair cannot rescue a
  // wasted pickup) and must not be a king (a king inside its own debuff is the
  // one unit whose loss is not recoverable).
  if (!a.unit.isKing && a.unit.tier === 0 && outweighedByAnyEnemy(sub, b.unit)) {
    for (let ia = 0; ia < a.options.length; ia++) {
      const oa = a.options[ia] as PairInput['options'][number];
      if (!oa.landing.some((cell) => sub.potionAt(cell))) continue;
      for (let ib = 0; ib < b.options.length; ib++) {
        push(ia, ib, EPS_POTION_WINDOW, 'potionWindow');
      }
    }
  }

  if (cells.length === 0) return null;
  return { a: a.unitId, b: b.unitId, cells, mass };
}

function sharesFood(
  sub: EngineSubstrate,
  left: ReadonlyArray<CellIndex>,
  right: ReadonlyArray<CellIndex>,
): boolean {
  for (const cell of left) {
    if (!sub.foodAt(cell)) continue;
    for (const other of right) if (other === cell) return true;
  }
  return false;
}

/**
 * Is there an enemy this unit does NOT already beat on weight?
 *
 * The whole value of a buff is turning a contest this unit currently loses. A
 * unit that already outweighs everything gains nothing from a tier it did not
 * need, so the pair edge must not fire for it — that is the difference between
 * the geometry being present (54.7% of team-turns) and the window being FREE
 * (8.0%).
 */
function outweighedByAnyEnemy(sub: EngineSubstrate, unit: SubstrateUnit): boolean {
  for (const other of sub.roster()) {
    if (other.team === unit.team) continue;
    if (other.weight >= unit.weight) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * THE STORE — φ_u and φ_uv for one decision, keyed by `EdgeKey`.
 *
 * A map and not a fold: the ordering consumer wants one unary by key, the
 * surrogate wants a component's whole table, and the sampler wants edge mass in
 * descending order. All three are reads of the same rows, and no consumer of
 * any of them may put a row into a bound.
 */
export class EdgeEvStore {
  private readonly unary = new Map<EdgeKey, UnaryParts>();
  private readonly pairs = new Map<EdgeKey, PairTable>();

  setUnary(unitId: UnitId, to: CellIndex, parts: UnaryParts): void {
    this.unary.set(unaryKey(unitId, to), parts);
  }

  unaryAt(unitId: UnitId, to: CellIndex): UnaryParts {
    return this.unary.get(unaryKey(unitId, to)) ?? ZERO_PARTS;
  }

  setPair(table: PairTable): void {
    // The key names the EDGE, not a cell of it: a pair table is one object per
    // unordered unit pair, and the cells live inside it.
    this.pairs.set(pairKey(table.a, 0 as CellIndex, table.b, 0 as CellIndex), table);
  }

  pairOf(a: UnitId, b: UnitId): PairTable | undefined {
    return this.pairs.get(pairKey(a, 0 as CellIndex, b, 0 as CellIndex));
  }

  /** Every pair edge, heaviest first — the repair and sampling order. */
  edgesByMass(): ReadonlyArray<PairTable> {
    return [...this.pairs.values()].sort((x, y) => y.mass - x.mass || x.a - y.a || x.b - y.b);
  }

  get unaryCount(): number {
    return this.unary.size;
  }

  get pairCount(): number {
    return this.pairs.size;
  }

  clear(): void {
    this.unary.clear();
    this.pairs.clear();
  }
}

// ---------------------------------------------------------------------------
// The law this file owes
// ---------------------------------------------------------------------------

/**
 * EV-CLIFF, over one position's actual roster.
 *
 * The shipped invariant is `w_feature × (range across candidates) < 10 ×
 * (lightest unit weight)` — a feature may not outbid one unit's life. Its edge
 * analogue is the same statement one level down:
 *
 *     Σ over NON-MATERIAL families of span_across_candidates(φ)  <  1 lat
 *
 * `fatal` and the material half of `meal` are excluded BY NAME and not by
 * oversight: both are denominated in the material lattice itself — expected
 * material lost, and the +1 weight a meal pays — so they are not in the
 * ordering channel the cliff bounds, they ARE the quantity it is measured
 * against. Charging them against their own bound would be circular.
 *
 * Measured across candidates and not in the abstract, because comparisons are
 * always between plans of the same position: only the across-candidate span can
 * move a comparison, and a fixture's roster is not the position's.
 */
export function nonMaterialSpan(parts: ReadonlyArray<UnaryParts>): number {
  if (parts.length === 0) return 0;
  const families: ReadonlyArray<(p: UnaryParts) => number> = [
    (p) => p.race,
    (p) => p.potion,
    (p) => p.health,
    // The meal's SUB-LAT half only: the refund magnitude is an ordering
    // quantity, the +1 weight underneath it is not.
    (p) => (p.meal === 0 ? 0 : p.meal - W_MEAL_MATERIAL),
  ];
  let total = 0;
  for (const read of families) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const p of parts) {
      const v = read(p);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    total += hi - lo;
  }
  return total;
}

/** Exported for the law test: what the cliff's excluded material half is worth. */
export const MEAL_MATERIAL_LAT = W_MEAL_MATERIAL;
