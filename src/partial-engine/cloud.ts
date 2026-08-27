/*
 * VENDORED from Cyphid-Academy/snek-centaur-platform — do not edit.
 * Source: packages/engine/src/partial/cloud.ts
 * This is a byte-for-byte copy of the possibility-cloud engine.
 * Edits here are overwritten and fail the vendor drift test: change the
 * engine upstream, then run `npm run sync-partial-engine`.
 * END VENDORED HEADER
 */

// Possible presence: what a time-frozen unit's projection claims about the board.
//
// A frozen unit is one nobody modelled. No default move may be assumed for it,
// so what stands on the board in its place is a CLAIM about where it might be —
// over-approximating, always, because the only error a searcher cannot recover
// from is one that hides a unit that was really there.
//
// A cloud is a pure function of (the unit's record, static terrain, the item
// set at the freeze, turns held, narrowing). Nothing a sibling state does
// narrows it. That is a deliberate precision trade and it is what buys the
// whole structural-sharing story: a cloud timeline is computed once and shared
// by pointer across every node of a search tree, so forking the frozen half of
// a state costs nothing at all.
//
// (Substrate harvested from cand-i. Added per the deliberation delta:
// item-set-derived tier endpoints (§2), the pawn's pose-exact fronts and
// kindSet promotion fork (§2, cand-d), first-move narrowing with prefix
// closure (§2/cand-g/cand-h), and the per-unit arrival/cost grids — absolute-
// turn earliest arrival plus a minCost grid with two-phase food relaxation
// (cand-e / cand-b / L2) — which SURVIVE SATURATION: ordering and catch-up
// targeting read gradient values, never membership.)

import type { Board, Grid } from "./bitgrid.js";
import {
  bbAnd,
  bbChebyshevBall,
  bbCopy,
  bbForEach,
  bbIntersects,
  bbIsEmpty,
  bbOr,
  bbPopcount,
  bbSet,
  bbSubset,
  bbTest,
} from "./bitgrid.js";
import type { DilateScratch, OrientationIndex, Terrain, UnitKind } from "./grammar.js";
import {
  UnitKind as Kind,
  dilate,
  dilateOriented,
  makeScratch,
  pathFor,
  profileOf,
  standableFor,
} from "./grammar.js";

/**
 * THE TWO LEVELS ONE INVULNERABILITY POTION CAN PUT ON A UNIT.
 *
 * A collection grants exactly one effect per family, replacing any it had, so
 * the level a contest reads is a trit and not a running total: `+1` to every
 * other living member of the collector's team, `−1` to the collector itself,
 * `0` to anyone holding neither (game-engine/team-potion-effects,
 * game-engine/collisions-and-severing). Named here because the two places that
 * price a potion — this file's tier FLOOR and `field.ts`'s tier CEILING — are
 * the two ends of one rule and must not drift apart.
 */
export const BUFF_LEVEL = 1;
export const DEBUFF_LEVEL = -1;

/** The crystallized record of a unit at the moment it was frozen. Never mutated. */
export interface FrozenRecord {
  readonly unitId: number;
  readonly kind: UnitKind;
  readonly team: number;
  /** Occupancy at the freeze turn; index 0 is the head for a trail unit. */
  readonly occupancy: ReadonlyArray<number>;
  /** The turn it was frozen at. */
  readonly heldAtTurn: number;
  readonly health: number;
  /** Invulnerability tier, frozen for a turn's whole adjudication. */
  readonly tier: number;
  /**
   * The turn the tier effect expires (reverts toward 0), when known. Contests
   * read tier at the ARRIVAL turn, so the claim's tier ceiling drops at the
   * expiry — an observable a consumer cannot reconstruct from `tier` alone.
   */
  readonly tierExpiresAtTurn?: number | null;
  /** Weight = stack height / trail length. */
  readonly weight: number;
  /** Direction index into ORTHOGONALS; trail defaults and pawn legality read it. */
  readonly orientation: OrientationIndex;
  /**
   * The unit's first held move, narrowed to these staged destinations — or
   * null for a complete (unnarrowed) claim. A narrowing is an ASSUMPTION the
   * caller owns; every claim derived from a narrowed record carries
   * `basis: "narrowed"` so it can never be mistaken for a proof. Options are
   * prefix-closed at dilation (a declared candidate is an intent, not a
   * landing: capture-stops, edge losses and exhaustion strand units mid-ray).
   */
  readonly narrowedTo: ReadonlyArray<number> | null;
}

/** Strength is an interval for anything nobody modelled. */
export interface StrengthBounds {
  readonly tierMin: number;
  readonly tierMax: number;
  readonly weightMin: number;
  readonly weightMax: number;
}

/** Whether a claim rests on the whole legal set or on a caller's assumption. */
export type ClaimBasis = "complete" | "narrowed";

export interface Cloud {
  readonly record: FrozenRecord;
  /**
   * Turns elapsed since the freeze. 0 is the freeze turn itself.
   *
   * THE STALENESS CONVENTION, stated once because there are two plausible
   * ones and mixing them silently DOUBLES a head-start compensation:
   *
   *   turnsHeld            = fieldTurn − record.heldAtTurn
   *   consumer staleness   = currentTurn − observedTurn
   *
   * and the two differ by one, because the field a resolution adjudicates
   * against is the POST-ADVANCE one: `resolve` queries `advanceTo(turn + 1)`,
   * so the cloud in play already includes THIS turn's unmade choice. A unit
   * observed on the turn now being resolved has consumer staleness 0 and is
   * read at `turnsHeld` 1. Do not add a turn of your own on top: ask the field
   * for the turn you want (`CloudField.advanceTo`) and let `turnsHeld` follow
   * from `heldAtTurn`, which `PartialEngine.hold` takes as an override for
   * exactly this reason.
   */
  readonly turnsHeld: number;
  /** Cells ANY part of the unit might occupy. Superset of the truth, always. */
  readonly possible: Board;
  /**
   * Cells its ARRIVING front might occupy — its head, or a piece's whole stack.
   * Tighter than `possible` for a trail unit, and the right set for the
   * questions that are about arrival: edge exchange, and "who could reach here".
   * For a trail unit this is parity-exact: a snake must step every turn, so its
   * head at turn N is on the opposite colour to its head at turn N-1.
   */
  readonly headPossible: Board;
  /**
   * Cells a BODY SEGMENT might hold at this turn — the tight index
   * arithmetic (Bot B's demand): body index j at turn n was the head of turn
   * n−j for j ≤ n, so the set is the last L−1 head fronts plus the record's
   * kept suffix. NOT the whole `possible`: tagging every cloud cell
   * head-and-body is sound but ruinous — it converts every contest a heavy
   * unit could win into an impassable wall. Empty for stacks.
   */
  readonly bodyPossible: Board;
  /**
   * The PREVIOUS turn's arriving front — a shared pointer, kept so the
   * sub-step arrival lower bound (`headSubStepLBOf`) can be derived lazily.
   * Null at the seed turn.
   */
  readonly prevHeadFront: Board | null;
  /** Sliders derive a per-cell sub-step arrival bound; others arrive at 1. */
  readonly subStepBoundsApply: boolean;
  /** Union of `possible` over every turn ≤ this one. Corpses persist. */
  readonly everPossible: Board;
  /**
   * Cells occupied in every SURVIVING continuation — the neck argument. A trail
   * unit vacates a cell only by putting its own next segment there, so its body
   * behind the drag front stands whatever it chose. Empty for a piece from the
   * first held turn, because staying is legal for every piece.
   *
   * CERTAIN-CONDITIONAL-ON-ALIVE: while `deathPossible` is true no verdict
   * layer may read a certain cell as presence "yes" — the risk layer's alive
   * trit gates it (deliberation delta §2).
   */
  readonly certain: Board;
  readonly bounds: StrengthBounds;
  /**
   * Every kind this unit might be by now, as a bitmask over UnitKind indices.
   * A pawn held past the promotion food-count horizon FORKS to queen grammar
   * mid-dilation; the possibility field is the union over the kindSet.
   */
  readonly kindSet: number;
  /** Some continuation kills it before this turn, which makes `certain` soft. */
  readonly deathPossible: boolean;
  /**
   * Some continuation has this unit collecting an invulnerability potion at a
   * step whose EFFECT IS IN FORCE at this turn — a potion cell inside its
   * cumulative reach, and at least two turns held.
   *
   * The lag is the rule, not a margin. Collection is destination-only and the
   * effect is applied at COMMIT, after the collision phase, so a potion taken
   * on the move resolved at turn U first governs a contest at U+1; a claim that
   * has made n moves has resolved turns heldAtTurn..heldAtTurn+n−1, so nothing
   * it could have picked up can be in force before n = 2. At the risk layer's
   * n = 1 the potion board moves NO tier on the board, this unit's or anyone
   * else's.
   *
   * It is published rather than folded into this cloud's own `bounds` because
   * of WHOSE tier it moves. The rules give the collector the DEBUFF and every
   * other living member of its team the BUFF (game-engine/team-potion-effects;
   * game-engine/collisions-and-severing derives the level as +1 buff / −1
   * debuff / 0), so a unit's own reachable potions can only ever LOWER its own
   * tier — the raising is a fact about its TEAM-MATES, and teams meet at the
   * field, not inside a per-unit cloud. `CloudField` reads this flag across
   * team-mates and widens the ceiling there; the floor it implies for the
   * collector itself is applied here, off the same boolean.
   */
  readonly couldCollectPotion: boolean;
  /** No continuation leaves it alive (it was walled in, or ran out of health). */
  readonly certainlyGone: boolean;
  /** `possible` covers every cell this kind could stand on — queries short-circuit. */
  readonly saturated: boolean;
  readonly possibleCount: number;
  /** "complete" when derived from the whole legal set; "narrowed" otherwise. */
  readonly basis: ClaimBasis;
}

/** Everything a cloud is computed against, beyond the record itself. */
export interface CloudPremise {
  readonly terrain: Terrain;
  /**
   * Food at the freeze turn. Item spawning is gated off while anything is
   * frozen, so food can only be REMOVED during a hold — which makes the
   * freeze-turn mask an upper bound, and therefore sound.
   */
  readonly food: Board;
  readonly potions: Board;
  /** Weight at which a pawn promotes (docs/chess-pieces.md; default 10). */
  readonly promotionWeight: number;
  /** Hazard dose per hazard cell entered — prices the minCost recurrence. */
  readonly hazardDamage: number;
  /** Health a meal restores to — the two-phase relaxation's second budget. */
  readonly maxHealth: number;
  /**
   * PER-KIND maximum health, indexed by `UnitKind`, for the games that
   * configure one (the wire's `maxHealthPerUnit`; the vendored resolver's
   * `input.maxHealth[type]`). Absent or undefined at an index falls back to
   * `maxHealth`, so the flat configuration is unchanged bit for bit.
   *
   * Flattening a per-kind table to its maximum is SOUND for anything the
   * claims over-approximate — a bigger refuel budget only widens a cloud —
   * and UNSOUND the moment a consumer reads the arrival/cost grid as its own
   * unit's reach inside a floor. So the table is carried rather than
   * collapsed.
   */
  readonly maxHealthPerKind?: ReadonlyArray<number> | null;
}

export const DEFAULT_PREMISE_RULES = {
  promotionWeight: 10,
  hazardDamage: 15,
  maxHealth: 100,
} as const;

/**
 * The health a meal restores THIS kind to. One lookup, in one place, so the
 * resolver's food phase and the claim's refuel budget can never disagree about
 * what a kind's maximum is.
 */
export function maxHealthFor(
  maxHealth: number,
  perKind: ReadonlyArray<number> | null | undefined,
  kind: UnitKind,
): number {
  return perKind?.[kind] ?? maxHealth;
}

const growBoard = (grid: Grid): Board => new Uint32Array(grid.words);

const SUB_STEP_LB_CACHE = new WeakMap<object, Int32Array>();

/**
 * SUB-STEP arrival lower bound per cell of a cloud's arriving front (Bot A's
 * demand): the fewest cells the unit must ENTER this turn to stand at the
 * cell — 1 for steppers and jumps, the along-ray distance from the previous
 * front for sliders (lower-bounded by the Chebyshev transform, exact when
 * the nearest front cell is the ray source). HOLDS stay turn-granular; this
 * is the risk layer's within-turn crossing resolution: a rook passing a cell
 * at sub-step 2 cannot be hit by a unit that cannot arrive before sub-step
 * 3, and without it every long ray is condemned for every cell it crosses.
 * 0 outside the front. Built lazily, once per cloud, cached by identity.
 */
export function headSubStepLBOf(cloud: Cloud, grid: Grid): Int32Array {
  const cached = SUB_STEP_LB_CACHE.get(cloud);
  if (cached !== undefined) return cached;
  const lb = new Int32Array(grid.cells);
  if (cloud.subStepBoundsApply && cloud.prevHeadFront !== null) {
    chebyshevFrom(grid, cloud.prevHeadFront, lb);
    for (let c = 0; c < grid.cells; c++) {
      if (!bbTest(cloud.headPossible, c)) lb[c] = 0;
      else if ((lb[c] as number) < 1 || (lb[c] as number) >= NEVER) lb[c] = 1;
    }
  } else {
    for (let c = 0; c < grid.cells; c++) {
      lb[c] = bbTest(cloud.headPossible, c) ? 1 : 0;
    }
  }
  SUB_STEP_LB_CACHE.set(cloud, lb);
  return lb;
}

/** Two-pass chamfer Chebyshev distance from a seed set, into `dst`. */
function chebyshevFrom(grid: Grid, seeds: Board, dst: Int32Array): void {
  const { width, height, cells } = grid;
  const FAR = 0x3ffffff;
  for (let c = 0; c < cells; c++) dst[c] = bbTest(seeds, c) ? 0 : FAR;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      let best = dst[c] as number;
      if (y > 0) {
        if (x > 0) best = Math.min(best, (dst[c - width - 1] as number) + 1);
        best = Math.min(best, (dst[c - width] as number) + 1);
        if (x < width - 1) best = Math.min(best, (dst[c - width + 1] as number) + 1);
      }
      if (x > 0) best = Math.min(best, (dst[c - 1] as number) + 1);
      dst[c] = best;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const c = y * width + x;
      let best = dst[c] as number;
      if (y < height - 1) {
        if (x < width - 1) best = Math.min(best, (dst[c + width + 1] as number) + 1);
        best = Math.min(best, (dst[c + width] as number) + 1);
        if (x > 0) best = Math.min(best, (dst[c + width - 1] as number) + 1);
      }
      if (x < width - 1) best = Math.min(best, (dst[c + 1] as number) + 1);
      dst[c] = best;
    }
  }
}

// ---------------------------------------------------------------------------
// Arrival / cost grids — the gradient that SURVIVES saturation
// ---------------------------------------------------------------------------

/** Sentinel for "not reachable within the computed horizon / budget". */
export const NEVER = 0x7fffffff;

/**
 * The per-unit arrival/cost grid. `earliest[c]` is the soonest ABSOLUTE TURN
 * the unit's arriving front could stand at `c` (a lower bound; absolute turns,
 * so a held unit's bot-framework head start is a lookup, not offset
 * arithmetic). `minCost[c]` is the least health any achieving path spends
 * since its last refuel to STAND at `c`, hazards priced into the same
 * recurrence, with two-phase food relaxation over the known item set.
 *
 * Ordering, entanglement ranking and catch-up targeting read these VALUES,
 * never membership — which is what keeps the mechanism useful exactly where
 * raw clouds go blind (saturation).
 */
export interface ArrivalGrid {
  readonly heldAtTurn: number;
  /** Absolute turn up to which `earliest` has been computed. */
  readonly horizon: number;
  /** Absolute turn of earliest possible arrival, or NEVER. */
  readonly earliest: Int32Array;
  /** Health lower bound to stand at the cell (turn-unbounded), or NEVER. */
  readonly minCost: Int32Array;
  /** Cells with `minCost` within budget — the cost-feasible support. */
  readonly costFeasible: Board;
}

/**
 * THE CHEAP MEETING-TIME QUERY: the earliest turn two arrival grids could
 * contest a cell — `min over c of max(a.earliest[c], b.earliest[c])` — and a
 * cell attaining it. Entanglement is a MEETING TIME, not a distance: a knight
 * two cells away on the wrong parity is further off than a rook eight cells
 * away on the same file, and this is the number that says so. Null when the
 * grids never meet within their computed horizons.
 */
export function meetingTime(
  a: Pick<ArrivalGrid, "earliest">,
  b: Pick<ArrivalGrid, "earliest">,
): { turn: number; cell: number } | null {
  let bestTurn = NEVER;
  let bestCell = -1;
  const n = Math.min(a.earliest.length, b.earliest.length);
  for (let c = 0; c < n; c++) {
    const ea = a.earliest[c] as number;
    if (ea === NEVER) continue;
    const eb = b.earliest[c] as number;
    if (eb === NEVER) continue;
    const t = ea > eb ? ea : eb;
    if (t < bestTurn) {
      bestTurn = t;
      bestCell = c;
    }
  }
  return bestCell < 0 ? null : { turn: bestTurn, cell: bestCell };
}

/**
 * The clouds of one frozen unit, one per turn since the freeze, computed lazily
 * and cached forever. Shared by pointer across every state in the search tree.
 */
export class CloudTimeline {
  readonly record: FrozenRecord;
  private readonly premise: CloudPremise;
  private readonly scratch: DilateScratch;
  private readonly clouds: Cloud[] = [];
  /**
   * Head positions reachable at exactly turn N — the parity-exact front. For
   * an oriented kind (pawn) this is the UNION over its four pose fronts, which
   * are tracked separately in `poseFronts`.
   */
  private readonly headFronts: Board[] = [];
  /** Per-pose fronts, oriented kinds only; length 4 per turn. */
  private readonly poseFronts: Board[][] = [];
  /** The promoted-grammar front (queen), once the promotion fork opens. */
  private readonly promotedFronts: (Board | null)[] = [];
  private readonly healthMask: Board;
  private healthMaskBinds: boolean;
  /** The same terrain with nothing masked off — where a trail unit may DIE. */
  private readonly unmaskedTerrain: Terrain;
  /**
   * The most a meal could restore this unit to — the max over every kind it
   * might BE, because a pawn past the promotion horizon refuels as a queen.
   * Over the kindSet rather than the whole table: flattening to the global
   * maximum is what made a low-max unit's reach a fiction.
   */
  private readonly refuelTo: number;
  /** Lazily built arrival/cost grid; extended in place as the horizon grows. */
  private arrivalGrid: ArrivalGrid | null = null;

  constructor(record: FrozenRecord, premise: CloudPremise, scratch?: DilateScratch) {
    this.record = record;
    this.premise = premise;
    this.scratch = scratch ?? makeScratch(premise.terrain.grid);

    const grid = premise.terrain.grid;
    // Hoisted: building this per turn would allocate an object holding five
    // board references on a path a search runs thousands of times.
    this.unmaskedTerrain = { ...premise.terrain, open: grid.full, pieceOpen: grid.full };
    // Movement costs `costPerCell` health per cell entered, so a unit can never
    // enter more cells than its health affords; every kind but the knight moves
    // at least one Chebyshev step per cell entered, and a knight at most two.
    const profile = profileOf(record.kind);
    const ownMax = maxHealthFor(premise.maxHealth, premise.maxHealthPerKind, record.kind);
    this.refuelTo =
      profile.promotesTo === null
        ? ownMax
        : Math.max(
            ownMax,
            maxHealthFor(premise.maxHealth, premise.maxHealthPerKind, profile.promotesTo),
          );
    const cells = Math.max(1, Math.floor(record.health / profile.costPerCell));
    const reach = cells * (record.kind === Kind.Knight ? 2 : 1);
    this.healthMask = growBoard(grid);
    this.healthMaskBinds = reach < Math.max(grid.width, grid.height);
    if (this.healthMaskBinds)
      bbChebyshevBall(grid, this.healthMask, record.occupancy[0] ?? 0, reach);

    this.clouds.push(this.seed());
  }

  /** The cloud `turnsHeld` turns after the freeze. Memoized; extends on demand. */
  at(turnsHeld: number): Cloud {
    if (turnsHeld < 0) throw new Error(`negative hold: ${turnsHeld}`);
    while (this.clouds.length <= turnsHeld) this.clouds.push(this.step(this.clouds.length));
    return this.clouds[turnsHeld] as Cloud;
  }

  /** How far the timeline has actually been computed — a benchmark/inspection hook. */
  get computedTurns(): number {
    return this.clouds.length - 1;
  }

  /**
   * The arrival/cost grid, computed to at least `horizonTurn` (absolute).
   * Built once and extended in place; `minCost` is turn-unbounded and is
   * computed in full on first use.
   */
  arrival(horizonTurn: number): ArrivalGrid {
    const grid = this.premise.terrain.grid;
    if (this.arrivalGrid === null) {
      const earliest = new Int32Array(grid.cells).fill(NEVER);
      const { minCost, costFeasible } = this.buildMinCost();
      this.arrivalGrid = {
        heldAtTurn: this.record.heldAtTurn,
        horizon: this.record.heldAtTurn - 1,
        earliest,
        minCost,
        costFeasible,
      };
    }
    let g = this.arrivalGrid;
    while (g.horizon < horizonTurn) {
      const n = g.horizon + 1 - this.record.heldAtTurn;
      const front = this.at(Math.max(0, n)).headPossible;
      const stamp = g.horizon + 1;
      const earliest = g.earliest;
      bbForEach(front, grid.words, (c) => {
        if ((earliest[c] as number) > stamp) earliest[c] = stamp;
      });
      g = { ...g, horizon: stamp };
      this.arrivalGrid = g;
    }
    return g;
  }

  private seed(): Cloud {
    const { terrain } = this.premise;
    const grid = terrain.grid;
    const r = this.record;
    const profile = profileOf(r.kind);
    const possible = growBoard(grid);
    for (const c of r.occupancy) bbSet(possible, c);
    const head = growBoard(grid);
    if (r.occupancy.length > 0) bbSet(head, r.occupancy[0] as number);
    const ever = growBoard(grid);
    bbCopy(ever, possible, grid.words);
    const certain = growBoard(grid);
    bbCopy(certain, possible, grid.words);
    const bodyPossible = growBoard(grid);
    for (let i = 1; i < r.occupancy.length; i++) bbSet(bodyPossible, r.occupancy[i] as number);
    this.headFronts.push(head);
    if (profile.oriented) {
      const poses = [growBoard(grid), growBoard(grid), growBoard(grid), growBoard(grid)];
      if (r.occupancy.length > 0)
        bbSet(poses[r.orientation & 3] as Board, r.occupancy[0] as number);
      this.poseFronts.push(poses);
    }
    this.promotedFronts.push(null);
    return {
      record: r,
      turnsHeld: 0,
      possible,
      headPossible: head,
      bodyPossible,
      prevHeadFront: null,
      subStepBoundsApply: false,
      everPossible: ever,
      certain,
      bounds: { tierMin: r.tier, tierMax: r.tier, weightMin: r.weight, weightMax: r.weight },
      kindSet: 1 << r.kind,
      deathPossible: false,
      couldCollectPotion: false,
      certainlyGone: false,
      saturated: false,
      possibleCount: bbPopcount(possible, grid.words),
      basis: r.narrowedTo === null ? "complete" : "narrowed",
    };
  }

  private step(n: number): Cloud {
    const prev = this.clouds[n - 1] as Cloud;
    const { terrain, food } = this.premise;
    const grid = terrain.grid;
    const w = grid.words;
    const r = this.record;
    const profile = profileOf(r.kind);
    const standable = standableFor(terrain, r.kind);
    const basis: ClaimBasis = r.narrowedTo === null ? "complete" : "narrowed";

    // SATURATION SHORT-CIRCUIT. Once a piece's claim covers every cell it could
    // stand on, dilating it again cannot add anything: the claim is a fixed
    // point, so every later turn REUSES the same boards rather than recomputing
    // them. A queen held five turns therefore costs two dilations, not five, and
    // its per-cell queries answer off exactly the same arrays. (The arrival
    // grid keeps its values — the gradient survives where membership goes
    // blind.) A trail unit is excluded on purpose: its arriving front is
    // parity-exact and so is never saturated, even when its body claim is.
    // An oriented kind is excluded too, because its pose fronts may still be
    // converging even when their union covers the board.
    if (prev.saturated && !profile.leavesTrail && !profile.oriented) {
      // The cumulative reach is the same board, so the potion count is the same
      // number — but the tier FLOOR is not a function of the count alone (a
      // self-debuff needs a turn to land), so it is re-derived rather than
      // carried across with the rest of the fixed point.
      const stillCollecting =
        n >= 2 && !bbIsEmpty(this.andCount(prev.everPossible, this.premise.potions), w);
      const fixed: Cloud = {
        ...prev,
        turnsHeld: n,
        certain: prev.certain,
        bounds: this.boundsAt(n, prev.everPossible, prev.kindSet, stillCollecting),
        couldCollectPotion: stillCollecting,
        kindSet: prev.kindSet,
        deathPossible:
          prev.deathPossible || r.health <= n || bbIntersects(prev.everPossible, terrain.hazard, w),
        basis,
      };
      this.headFronts.push(prev.headPossible);
      this.promotedFronts.push(this.promotedFronts[n - 1] ?? null);
      return fixed;
    }

    // Once food is inside the cumulative claim the unit could have eaten, so
    // the FROZEN health stops binding — but its kind's maximum still does. A
    // meal restores to that maximum and no further, and the food phase runs at
    // END of turn, so within this turn the unit entered at most
    // maxHealth/costPerCell cells however many meals it has had. Reading the
    // whole board span here (which is what a flat 100 always yielded) is an
    // over-approximation the claims can afford and a consumer's own-unit reach
    // cannot.
    const fedPossible = bbIntersects(prev.everPossible, food, w);
    const rayCap = fedPossible
      ? Math.min(
          Math.max(grid.width, grid.height),
          Math.max(1, Math.floor(this.refuelTo / profile.costPerCell)),
        )
      : Math.max(1, Math.floor(r.health / profile.costPerCell));

    const headPossible = growBoard(grid);
    const possible = growBoard(grid);
    const bodyPossible = growBoard(grid);
    const certain = growBoard(grid);
    const everPossible = growBoard(grid);

    // ---- The arriving front: one turn of the kind's own grammar ----
    if (n === 1 && r.narrowedTo !== null) {
      // FIRST-MOVE NARROWING, prefix-closed: the caller declared the unit's
      // held move as one of these staged destinations. A declared candidate is
      // an intent, not a landing — capture-stops, edge losses and exhaustion
      // strand units mid-ray — so every cell of every declared path is in the
      // front, plus the origin for a stay-legal kind (halting at range zero is
      // an edge squash away). Monotone: a subset of the free dilation.
      const scratchPath: number[] = [];
      const origin = r.occupancy[0] ?? 0;
      for (const dest of r.narrowedTo) {
        const len = pathFor(terrain, r.kind, origin, dest, scratchPath, r.orientation, null);
        if (len === null) continue;
        if (len === 0) bbSet(headPossible, origin);
        for (let i = 0; i < len; i++) bbSet(headPossible, scratchPath[i] as number);
      }
      if (profile.stayLegal) bbSet(headPossible, origin);
      bbAnd(headPossible, standable, w);
      if (profile.oriented) {
        // Narrowed pawn: pose after one narrowed move — over-approximate as
        // any pose reachable in one action from the frozen one (rotations are
        // actions too, and a narrowing names destinations, not poses).
        const poses = [growBoard(grid), growBoard(grid), growBoard(grid), growBoard(grid)];
        for (const o of [r.orientation & 3, (r.orientation + 1) & 3, (r.orientation + 3) & 3]) {
          bbCopy(poses[o] as Board, headPossible, w);
        }
        this.poseFronts.push(poses);
      }
    } else if (profile.oriented) {
      const prevPoses = this.poseFronts[this.poseFronts.length - 1] as Board[];
      const poses = [growBoard(grid), growBoard(grid), growBoard(grid), growBoard(grid)];
      dilateOriented(terrain, r.kind, poses, prevPoses, this.scratch);
      if (this.healthMaskBinds && !fedPossible) {
        for (const p of poses) bbAnd(p, this.healthMask, w);
      }
      for (const p of poses) bbOr(headPossible, p, w);
      this.poseFronts.push(poses);
    } else {
      dilate(terrain, r.kind, headPossible, prev.headPossible, rayCap, this.scratch);
      if (this.healthMaskBinds && !fedPossible) bbAnd(headPossible, this.healthMask, w);
    }

    // ---- kindSet promotion fork (delta §2, cand-d) ----
    // A pawn held past the promotion food-count horizon might already be a
    // queen: once its weight ceiling reaches the threshold, the promoted
    // grammar's front joins the union — MID-DILATION, not as a new hold.
    const eatsSoFar = Math.min(n, bbPopcount(this.andCount(prev.everPossible, food), w));
    const promotionPossible =
      profile.promotesTo !== null && r.weight + eatsSoFar >= this.premise.promotionWeight;
    let promotedFront: Board | null = this.promotedFronts[n - 1] ?? null;
    if (profile.promotesTo !== null && (promotionPossible || promotedFront !== null)) {
      const next = growBoard(grid);
      if (promotedFront !== null) {
        dilate(terrain, profile.promotesTo, next, promotedFront, rayCap, this.scratch);
      }
      if (promotionPossible) {
        // Promotion happens at end of a turn on whatever cell the pawn then
        // stands; the promoted grammar dilates from the pawn's whole prior
        // front. Dedicated temporaries — the shared scratch's boards are the
        // dilation's own working set, and aliasing them clobbers the source
        // mid-fill (found by the king test's pawn-promotion walk).
        const promoted = growBoard(grid);
        const tmpScratch = { a: growBoard(grid), b: growBoard(grid), c: growBoard(grid) };
        dilate(terrain, profile.promotesTo, promoted, prev.headPossible, rayCap, tmpScratch);
        bbOr(next, promoted, w);
        bbOr(next, prev.headPossible, w);
      }
      if (this.healthMaskBinds && !fedPossible) bbAnd(next, this.healthMask, w);
      promotedFront = next;
      bbOr(headPossible, next, w);
    }
    this.promotedFronts.push(promotedFront);
    const kindSet =
      prev.kindSet |
      (profile.promotesTo !== null && promotedFront !== null ? 1 << profile.promotesTo : 0);

    // Could it have died before now? Movement cost alone, a hazard dose, or —
    // for a trail unit alone — stepping into the perimeter, which is legal.
    let couldHitWall = false;
    let wallDeaths: Board | null = null;
    if (profile.mayEnterWall) {
      // Re-dilate WITHOUT the standable mask: anything outside it is a wall the
      // unit was free to walk into. Walking into the perimeter is a legal, fatal
      // move, so those cells are where a CORPSE could be — never where a live
      // unit could stand.
      dilate(this.unmaskedTerrain, r.kind, this.scratch.c, prev.headPossible, rayCap, this.scratch);
      bbAnd(this.scratch.c, terrain.wall, w);
      couldHitWall = !bbIsEmpty(this.scratch.c, w);
      if (couldHitWall) {
        wallDeaths = growBoard(grid);
        bbCopy(wallDeaths, this.scratch.c, w);
      }
    }
    // SELF-COLLISION IS A CONTINUATION TOO. A trail unit long enough to have a
    // body cell that is not its own departing tail can always step onto it —
    // the neck of a length-3-or-longer trail is adjacent to the head by
    // construction — and the tail pop does not save it: occupancy becomes
    // [neck, head, neck] and the head is standing on its own body. That is a
    // legal, fatal move, so the neck argument's `certain` cells are SOFT for
    // every such unit: it may not be standing anywhere at all.
    //
    // (At length 2 the neck IS the tail and vacates in the same sub-step, so
    // there is no self-collision to have; the claim only softens once growth
    // could have taken it to three.)
    const couldHitSelf = profile.leavesTrail && r.occupancy.length + eatsSoFar >= 3;
    const deathPossible =
      prev.deathPossible ||
      couldHitWall ||
      couldHitSelf ||
      r.health <= n * profile.costPerCell ||
      bbIntersects(prev.everPossible, terrain.hazard, w);

    const k = r.occupancy.length;
    const eats = eatsSoFar;

    if (profile.leavesTrail) {
      // A trail unit at turn n stands at body indices 0..L-1, where L is its
      // length (k, plus at most one per eat). Body index i is the head front of
      // turn n-i while i ≤ n, and the frozen record's cell b[i-n] beyond that.
      // So the claim is the last L fronts, plus the head end of the record —
      // the TAIL is what drags out of existence first.
      const length = k + eats;
      // Body index j ∈ [1, L−1] at turn n was the head of turn n−j (for
      // j ≤ n), and the record's cell b[j−n] beyond that — the TIGHT body
      // set, kept separate from the arriving front so role tags carry the
      // index arithmetic rather than a maximal blur.
      for (let j = Math.max(0, n - length + 1); j < this.headFronts.length && j < n; j++) {
        bbOr(bodyPossible, this.headFronts[j] as Board, w);
      }
      for (let i = 0; i <= Math.min(k - 1, length - 1 - n); i++) {
        bbSet(bodyPossible, r.occupancy[i] as number);
      }
      bbAnd(bodyPossible, standable, w);
      bbCopy(possible, bodyPossible, w);
      bbOr(possible, headPossible, w);
      bbAnd(possible, standable, w);
      // Certain needs the length it is guaranteed at least: k, since growth only
      // adds. Body index i + n ≤ k - 1 is occupied whatever it chose.
      for (let i = 0; i <= k - 1 - n; i++) bbSet(certain, r.occupancy[i] as number);
    } else {
      // A stack is one cell, so its possible presence IS its arriving front, and
      // nothing is certain: staying is legal for every piece.
      bbCopy(possible, headPossible, w);
    }

    // `possible` is LIVE presence, so it never names a wall. `everPossible` is
    // the cumulative claim the persistent-collision-object rule reads, and a
    // corpse on the perimeter is still somewhere the unit HAS BEEN — so the
    // cumulative claim covers it, and containment holds with no caveat.
    bbCopy(everPossible, prev.everPossible, w);
    bbOr(everPossible, possible, w);
    if (wallDeaths !== null) bbOr(everPossible, wallDeaths, w);

    // A trail unit must step every turn, so it spends health every turn; a piece
    // may hold for free and never starves.
    const starved = profile.leavesTrail && !fedPossible && r.health <= n * profile.costPerCell;
    const certainlyGone = bbIsEmpty(headPossible, w) || starved;
    this.headFronts.push(headPossible);

    // The sub-step arrival lower bound is DERIVED LAZILY (headSubStepLBOf):
    // building a board-sized Int32Array here would put a >64-byte allocation
    // on the hold path, which the cost model forbids. The cloud carries only
    // the previous front's pointer.
    const isSlider = profile.rays.length > 0 && !profile.oriented;

    // One AND over the potion board, read twice: it prices this unit's own tier
    // FLOOR (a collector takes the debuff) and, at the field, its team-mates'
    // tier CEILING (everyone else on the team takes the buff). The scratch
    // board `andCount` returns is reused by the food count below, so the answer
    // is taken here and the board is not held. See `Cloud.couldCollectPotion`
    // for the n >= 2, which is the commit-time lag and not a margin.
    const couldCollectPotion =
      n >= 2 && !bbIsEmpty(this.andCount(everPossible, this.premise.potions), w);

    return {
      record: r,
      turnsHeld: n,
      possible,
      headPossible,
      bodyPossible,
      prevHeadFront: prev.headPossible,
      subStepBoundsApply: isSlider,
      everPossible,
      certain: certainlyGone ? growBoard(grid) : certain,
      bounds: this.boundsAt(n, everPossible, kindSet, couldCollectPotion),
      kindSet,
      deathPossible,
      couldCollectPotion,
      certainlyGone,
      saturated: bbSubset(standable, possible, w),
      possibleCount: bbPopcount(possible, w),
      basis,
    };
  }

  /**
   * Strength intervals, derived from the ITEM SET rather than config
   * constants (delta §2).
   *
   * THE TIER INTERVAL, DERIVED FROM THE POTION RULES RATHER THAN FROM
   * ARITHMETIC. Three facts about invulnerability decide the whole shape, and
   * an earlier reading of this function contradicted all three:
   *
   *   1. WHO GETS WHAT. A collection grants the COLLECTOR `(invulnerability,
   *      debuff)` and every OTHER living member of its team `(invulnerability,
   *      buff)` (game-engine/team-potion-effects). The level a contest reads is
   *      +1 for the buff, −1 for the debuff, 0 for neither
   *      (game-engine/collisions-and-severing). So a unit's own reachable
   *      potions can only ever push its own tier DOWN. Adding them to its own
   *      ceiling had the polarity backwards: the raising is a fact about its
   *      TEAM-MATES' reach, and these are PER-UNIT MARGINALS — no consumer may
   *      combine tier intervals across team-mates, and this function may not
   *      either. `couldCollectPotion` publishes the team-mate half; `field.ts`
   *      is where the teams meet and where the ceiling is widened.
   *
   *   2. WHEN IT LANDS. Collection is destination-only (the rule fires on a
   *      surviving head standing on the item) and the effect is applied at
   *      COMMIT, after the collision phase — so a potion taken on the move
   *      resolved at turn U first governs a contest at turn U+1. A claim that
   *      has made n moves has resolved turns heldAtTurn..heldAtTurn+n−1, so a
   *      potion it could have taken is in force at the field's turn only from
   *      n ≥ 2. At the risk layer's n = 1 the potion board cannot move ANY
   *      tier on the board — this unit's or its team-mates'. That single
   *      boolean is `couldCollectPotion`, computed once and read at both ends
   *      of the rule. (The set behind it is read off the cumulative reach at n
   *      rather than at n−1, which over-counts by one step in the SOUND
   *      direction: a floor may be lower than the truth, never higher, and a
   *      ceiling higher, never lower.)
   *
   *   3. HOW FAR IT GOES. At most one effect per family is held at a time
   *      (replace semantics), so collecting three potions is collecting one:
   *      the level is a trit, not a running total. `+ |potion cells|` could
   *      hand a held claim a tier no unit in the game can have, which is not
   *      a loose ceiling but a wrong one — every mover reads it as unbeatable.
   *
   * What is left after those three is: the interval moves toward zero on
   * expiry, admits −1 once a self-collection could have landed, and otherwise
   * is the frozen level.
   *
   * Weight rises by at most one per turn, by eating; it falls only through a
   * sever (field-level widening, where the other clouds are known) — or
   * through PROMOTION, which resets a pawn to weight 1: past the promotion
   * horizon the floor is 1 (delta §2).
   */
  private boundsAt(
    n: number,
    everPossible: Board,
    kindSet: number,
    couldCollectPotion: boolean,
  ): StrengthBounds {
    const { food } = this.premise;
    const w = this.premise.terrain.grid.words;
    const r = this.record;
    const profile = profileOf(r.kind);
    const reachableFood = bbPopcount(this.andCount(everPossible, food), w);
    const promoted = profile.promotesTo !== null && (kindSet & (1 << profile.promotesTo)) !== 0;
    // Tier expiry, when declared, is a fact about the TURN, not the unit's
    // choice — past it the frozen effect reverts to base 0, and only fresh
    // potion effects can move the interval again.
    const expiry = r.tierExpiresAtTurn ?? null;
    const expired = expiry !== null && r.heldAtTurn + n >= expiry;
    const baseCeil = expired ? 0 : Math.max(0, r.tier);
    const baseFloor = expired ? 0 : Math.min(0, r.tier);
    return {
      tierMin: couldCollectPotion ? Math.min(baseFloor, DEBUFF_LEVEL) : baseFloor,
      tierMax: baseCeil,
      weightMin: promoted ? 1 : r.weight,
      weightMax: r.weight + Math.min(n, reachableFood),
    };
  }

  /**
   * minCost via two-phase food relaxation. Phase 1: least health spent from
   * the frozen head, hazards priced `costPerCell + hazardDamage` in the same
   * recurrence. Phase 2: any food cell whose phase-1 cost is within the frozen
   * health budget re-seeds the relaxation at cost 0 with the restored budget
   * (`maxHealth`) — eating restores in full, and an exhausted unit that halts
   * ON food recovers, so the gate is ≤ budget, not < budget. The published
   * `minCost[c]` is the least health spent SINCE THE LAST REFUEL to stand at
   * `c`; `costFeasible` is its budget-gated support.
   */
  private buildMinCost(): { minCost: Int32Array; costFeasible: Board } {
    const { terrain, food } = this.premise;
    const grid = terrain.grid;
    const r = this.record;
    const profile = profileOf(r.kind);
    const standable = standableFor(terrain, r.kind);
    const cost = new Int32Array(grid.cells).fill(NEVER);
    const feasible = growBoard(grid);
    const origin = r.occupancy[0] ?? 0;

    const enterCost = (c: number): number =>
      profile.costPerCell + (bbTest(terrain.hazard, c) ? this.premise.hazardDamage : 0);

    // Small binary heap over (cost, cell). Cold path, memoized per timeline.
    const heap: number[] = []; // packed cost * 65536 + cell (cost < 32768 guaranteed by budgets)
    const push = (c: number, k: number): void => {
      heap.push(k * 65536 + c);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if ((heap[p] as number) <= (heap[i] as number)) break;
        const t = heap[p] as number;
        heap[p] = heap[i] as number;
        heap[i] = t;
        i = p;
      }
    };
    const pop = (): number => {
      const top = heap[0] as number;
      const last = heap.pop() as number;
      if (heap.length > 0) {
        heap[0] = last;
        const i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const rr = l + 1;
          let m = i;
          if (l < heap.length && (heap[l] as number) < (heap[m] as number)) m = l;
          if (rr < heap.length && (heap[rr] as number) < (heap[m] as number)) m = rr;
          if (m === i) break;
          const t = heap[m] as number;
          heap[m] = heap[i] as number;
          heap[i] = t;
        }
      }
      return top;
    };

    const relaxFrom = (seeds: ReadonlyArray<number>, budget: number): void => {
      heap.length = 0;
      for (const s of seeds) {
        if (0 < (cost[s] as number)) {
          // A seed is a standing point at zero spent-since-refuel.
          if ((cost[s] as number) > 0) cost[s] = Math.min(cost[s] as number, 0);
          push(s, 0);
        } else {
          push(s, Math.max(0, cost[s] as number));
        }
      }
      const width = grid.width;
      const height = grid.height;
      while (heap.length > 0) {
        const packed = pop();
        const k = (packed / 65536) | 0;
        const c = packed % 65536;
        if (k > (cost[c] as number)) continue;
        // A unit may ENTER a cell that takes it to or below zero — it halts
        // there, exhausted, and the food phase may still rescue it — but it
        // cannot MOVE ON from one. So expansion requires k < budget; entry
        // itself is unbounded.
        if (k >= budget) continue;
        const x = c % width;
        const y = (c / width) | 0;
        const tryEnter = (nx: number, ny: number): void => {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
          const nc = ny * width + nx;
          if (!bbTest(standable, nc)) return;
          const nk = k + enterCost(nc);
          if (nk < (cost[nc] as number)) {
            cost[nc] = nk;
            push(nc, nk);
          }
        };
        if (profile.oriented) {
          // Pose-blind cost bound: any of the 8 neighbours (union over poses).
          for (const [dx, dy] of [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
            [1, -1],
            [1, 1],
            [-1, 1],
            [-1, -1],
          ]) {
            tryEnter(x + (dx as number), y + (dy as number));
          }
        } else {
          for (const [dx, dy] of profile.steps) tryEnter(x + dx, y + dy);
          for (const [dx, dy] of profile.rays) tryEnter(x + dx, y + dy);
        }
      }
    };

    // Phase 1: from the frozen head with the frozen health budget.
    if (bbTest(standable, origin) || profile.mayEnterWall) cost[origin] = 0;
    else cost[origin] = 0;
    relaxFrom([origin], Math.max(0, r.health));

    // Phase 2: refuel. A food cell reached within the budget resets the spend;
    // an exhausted unit halting ON food recovers, so the gate is ≤ budget.
    const refuels: number[] = [];
    bbForEach(food, grid.words, (c) => {
      if ((cost[c] as number) !== NEVER) refuels.push(c);
    });
    if (refuels.length > 0) {
      for (const c of refuels) cost[c] = 0;
      relaxFrom(refuels, Math.max(0, this.refuelTo));
    }

    for (let c = 0; c < grid.cells; c++) {
      if ((cost[c] as number) !== NEVER) bbSet(feasible, c);
    }
    return { minCost: cost, costFeasible: feasible };
  }

  /** `scratch.a := a ∩ b`, returned for popcount. Never allocates. */
  private andCount(a: Board, b: Board): Board {
    const w = this.premise.terrain.grid.words;
    bbCopy(this.scratch.a, a, w);
    bbAnd(this.scratch.a, b, w);
    return this.scratch.a;
  }
}

// ---------------------------------------------------------------------------
// Interning — two levels, and neither of them a leak
// ---------------------------------------------------------------------------

/**
 * EXHAUSTIVENESS GUARD for the structural key. A cloud is a pure function of
 * the record and the premise, so the key must name EVERY field of the record:
 * a missed field is not a slow shared timeline, it is a silently WRONG one.
 * Adding a field to `FrozenRecord` makes this object literal incomplete and
 * fails the build, which is the moment to extend `frozenRecordKey` — and
 * `partial-memory.test.ts` drives its perturbation test off these very keys,
 * so a field added here but forgotten in the key string fails a test too.
 */
export const FROZEN_RECORD_KEY_FIELDS: { readonly [K in keyof FrozenRecord]-?: true } = {
  unitId: true,
  kind: true,
  team: true,
  occupancy: true,
  heldAtTurn: true,
  health: true,
  tier: true,
  tierExpiresAtTurn: true,
  weight: true,
  orientation: true,
  narrowedTo: true,
};

/**
 * The record's VALUE, as a string. Two records with the same key describe the
 * same unit observed the same way, so they may share one computed timeline —
 * which is what lets a record rebuilt from a wire payload, or reconstructed by
 * a catch-up, land on the dilation a sibling already paid for.
 *
 * `unitId` and `team` are in the key even though no dilation reads them,
 * because `Cloud.record` is handed back to consumers: sharing across a
 * differing id would answer a question about the wrong unit.
 */
export function frozenRecordKey(r: FrozenRecord): string {
  return `${r.unitId}|${r.kind}|${r.team}|${r.occupancy.join(",")}|${r.heldAtTurn}|${r.health}|${r.tier}|${r.tierExpiresAtTurn ?? "-"}|${r.weight}|${r.orientation}|${r.narrowedTo === null ? "-" : r.narrowedTo.join(",")}`;
}

export interface CloudSourceOptions {
  /**
   * How many timelines this source keeps by VALUE. The bound is the whole
   * point: this map is the only strong retention in the interning path, so its
   * capacity is the source's memory ceiling. 0 disables value interning and
   * leaves identity interning alone.
   */
  readonly cacheSize?: number;
  /**
   * Claim versions, supplied so several sources can share one counter. A
   * version is documented as monotonically increasing per unit id, and a
   * source that can be evicted must not be able to reset one.
   */
  readonly versions?: Map<number, number>;
}

/** Timelines a source keeps by value before the least-recently-used one goes. */
export const DEFAULT_TIMELINE_CACHE = 128;

/**
 * Memoizes cloud timelines per frozen record, so every state in a search tree
 * that holds the same unit shares the same computed clouds. Also the home of
 * CLAIM VERSIONS: refining a unit (narrowing, catch-up) bumps its version, and
 * every branch sharing the interned claim sees the bump — O(1), not
 * O(branches) (delta §5).
 *
 * TWO LEVELS, BECAUSE THE TWO DEMANDS ON THIS MAP PULL APART.
 *
 *   · IDENTITY, in a WeakMap. Within one decision the field holds the record
 *     objects, so `timelineFor` is called with the same object again and again
 *     and the answer must be the same pointer — that is the whole structural-
 *     sharing story. A record is also the natural GC root for its own clouds:
 *     when the consumer drops the record, nothing about it is worth keeping.
 *     A strong Map here LEAKS, and leaks in the normal case rather than an
 *     exotic one: records carry per-turn observation data, so a long-lived
 *     process rebuilds them every turn and the old ones are garbage the map
 *     pins forever (measured: +33 MB per 100 turns, linear, in a 512 MB cap).
 *
 *   · VALUE, in a bounded LRU. Identity interning is free but blind: two code
 *     paths that rebuild an EQUAL record from the same observation shared
 *     nothing, and paid for two dilations (backlog item 2). Keying by value
 *     fixes that, and — unlike a WeakMap — its keys are not tied to any live
 *     object's lifetime, so it MUST be bounded or it is the same leak wearing
 *     a different hat. The bound is a cap on wasted work, never on
 *     correctness: an eviction costs a re-dilation and nothing else.
 *
 * So identity feeds value and value feeds identity: a value hit re-registers
 * the new record object in the WeakMap, and every future call through that
 * object skips the key derivation entirely.
 */
export class CloudSource {
  private readonly premise: CloudPremise;
  private readonly scratch: DilateScratch;
  /** Identity interning. WEAK on purpose — see the class comment. */
  private readonly byIdentity = new WeakMap<FrozenRecord, CloudTimeline>();
  /** Value interning, LRU by insertion order. The only strong retention here. */
  private readonly byValue = new Map<string, CloudTimeline>();
  private readonly versions: Map<number, number>;
  /** How many timelines `byValue` may hold. */
  readonly cacheSize: number;
  /** Instrumentation for the benchmarks: how often sharing actually hit. */
  hits = 0;
  misses = 0;
  /** Split of `hits`, so a bench can tell which level is doing the work. */
  identityHits = 0;
  valueHits = 0;
  evictions = 0;

  constructor(premise: CloudPremise, options: CloudSourceOptions = {}) {
    this.premise = premise;
    this.scratch = makeScratch(premise.terrain.grid);
    this.cacheSize = Math.max(0, options.cacheSize ?? DEFAULT_TIMELINE_CACHE);
    this.versions = options.versions ?? new Map<number, number>();
  }

  timelineFor(record: FrozenRecord): CloudTimeline {
    const byIdentity = this.byIdentity.get(record);
    if (byIdentity !== undefined) {
      this.hits++;
      this.identityHits++;
      return byIdentity;
    }
    if (this.cacheSize === 0) {
      this.misses++;
      const made = new CloudTimeline(record, this.premise, this.scratch);
      this.byIdentity.set(record, made);
      return made;
    }
    const key = frozenRecordKey(record);
    const byValue = this.byValue.get(key);
    if (byValue !== undefined) {
      this.hits++;
      this.valueHits++;
      // Touch: most-recently-used goes to the end of the insertion order.
      this.byValue.delete(key);
      this.byValue.set(key, byValue);
      this.byIdentity.set(record, byValue);
      return byValue;
    }
    this.misses++;
    const made = new CloudTimeline(record, this.premise, this.scratch);
    this.byIdentity.set(record, made);
    this.byValue.set(key, made);
    if (this.byValue.size > this.cacheSize) {
      const oldest = this.byValue.keys().next();
      if (!oldest.done) {
        this.byValue.delete(oldest.value);
        this.evictions++;
      }
    }
    return made;
  }

  /**
   * How many timelines this source is retaining — the number a memory test
   * asserts a bound on, and the number a profile should look at first.
   * The WeakMap contributes nothing: what it holds is alive because the
   * CONSUMER is still holding the record, and dies with it.
   */
  get retainedTimelines(): number {
    return this.byValue.size;
  }

  /**
   * Drop every retained timeline. The explicit half of the lifecycle: a
   * consumer that has finished a decision, or that knows its records have all
   * been rebuilt, can say so instead of waiting for the LRU to notice. Claim
   * versions SURVIVE — they are a fact about refinements that happened, not a
   * cache.
   */
  clear(): void {
    this.byValue.clear();
  }

  /** Monotonically increasing per unit id; bumped by any refinement of it. */
  claimVersion(unitId: number): number {
    return this.versions.get(unitId) ?? 0;
  }

  bumpClaimVersion(unitId: number): number {
    const next = (this.versions.get(unitId) ?? 0) + 1;
    this.versions.set(unitId, next);
    return next;
  }
}
