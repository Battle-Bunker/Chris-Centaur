/**
 * THE RAY-CROSSING PRIMITIVE — what a unit's movement rays actually meet.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `commandFeature` (./features.ts) reads a piece's next-turn front as a
 * bitboard and counts exactly two things: contested ground and food. It has no
 * enemy-body term, so a queen aligned along a twelve-cell enemy snake body
 * scores identically to a queen aligned along empty space. That is a fact about
 * shipped code, not a hypothesis, and this module is the missing read.
 *
 * A bitboard AND cannot supply it. A sever's value depends on WHERE along a
 * body the cut lands — the engine cuts at the arriving cell's occupancy index
 * and removes everything beyond it (`turnEngine.ts:556-565`) — and a popcount
 * over an unordered intersection has thrown that away. So the primitive is an
 * ORDERED WALK: one pass per ray, from the origin outward, stopping at the
 * first thing that stops a mover.
 *
 * ── THE CURRENCY, AND WHY IT NEEDS NO FITTING ──────────────────────────────
 *
 * Output is denominated directly in WEIGHT UNITS, by rule and not by
 * conversion. A trail unit's weight IS its occupancy length
 * (`turn-oracle.ts:startWeight`, `marshalBoard`), and a sever "costs its owner
 * the cells the engine actually cut" (`turn-oracle.ts:492-499`). So cutting a
 * body at occupancy index `i` removes exactly `occupancy.length - i` weight
 * from its owner. There is no fitted coefficient anywhere in this file.
 *
 * ── THE RULES THIS MIRRORS, WITH CITATIONS ─────────────────────────────────
 *
 * Every verdict below is the vendored engine's own, read off
 * `src/engine-vendor/engine/turnEngine.ts`:
 *
 *  - A mover advances one cell per sub-step along its path, and every cell it
 *    enters is adjudicated before the next (`:316-320`).
 *  - HEAD-CLASS CONTEST (`c4`, `:396-443`): arriving where a unit is standing
 *    contests it. `strictMaximum` (`:182-188`) ranks TIER strictly first, then
 *    weight, and a non-unique maximum is a tie in which nobody survives. The
 *    survivor capture-stops.
 *  - BODY CROSSING (`c5`, `:445-489`): arriving on a trail unit's body cell
 *    (occupancy index ≥ 1) kills the mover when its tier is EQUAL OR LOWER than
 *    the highest owner's, and SEVERS when it is strictly higher. A sever is not
 *    a death for the owner; the mover capture-stops.
 *  - Several cuts on one owner collapse to the lowest index (`:556-565`) — the
 *    deepest bite wins.
 *  - Movement costs `costPerCell` health per cell ENTERED (`:514-528`); a unit
 *    that reaches zero stops moving and dies at end of turn unless it eats.
 *  - A piece may not enter the perimeter wall (`piece-moves.ts:isInterior`).
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 *
 * Nothing here predicts. The walk is over the board AS GIVEN — a static read at
 * one instant. Every statement about what a target will do next turn belongs to
 * the consumer (`./slider-attack-vector.ts`), which is where the two-world
 * pessimistic/optimistic split lives. Keeping the prediction out of the
 * primitive is what makes the primitive exactly testable: walk a ray, check
 * what it says is on it.
 *
 * DETERMINISM. Ray order is the kind profile's own `rays` order; occupants at a
 * cell are reported in the caller's unit order. No clock, no randomness, no
 * allocation-order dependence.
 */

import { profileOf } from '../../partial-engine/index';
import type { KindProfile, UnitKind } from '../../partial-engine/index';

/** A ray direction, in full-board cell steps. */
export type RayDirection = KindProfile['rays'][number];

/**
 * One unit as the walk reads it. This is deliberately a PLAIN VALUE rather than
 * an engine handle: the primitive is meant to be exercised from hand-built
 * boards in a test and from a replay row in a miner, neither of which should
 * have to stand a `PartialEngine` up.
 */
export interface RayUnit {
  readonly unitId: string;
  readonly team: number;
  readonly kind: UnitKind;
  /**
   * Occupancy, HEAD FIRST, in full-board cell indices. A piece supplies exactly
   * one cell and carries its stack in `weight` — the engine's own convention
   * (`engine.ts:UnitSpec.cells`), and the one place a hand-rolled board goes
   * wrong silently.
   */
  readonly occupancy: ReadonlyArray<number>;
  /** Weight in cells. For a trail unit this is `occupancy.length`. */
  readonly weight: number;
  /** Invulnerability tier AT ARRIVAL — the number a contest actually reads. */
  readonly tier: number;
  /**
   * The last turn at which this unit's tier still governs a contest, INCLUSIVE
   * (`turn-oracle.ts:MarshalledBoard.tierExpiry` — the server expires effects
   * after the collision phase, so an effect with expiry E decides every contest
   * resolved during turn E). Null or absent means "no schedule on the wire".
   */
  readonly tierExpiresAtTurn?: number | null;
  readonly health: number;
}

/** The board as the walk reads it: geometry plus everyone standing on it. */
export interface RayBoard {
  /** FULL board width, perimeter wall included. */
  readonly width: number;
  /** FULL board height, perimeter wall included. */
  readonly height: number;
  readonly units: ReadonlyArray<RayUnit>;
  /** The absolute turn this board is the start of. Read only for tier timing. */
  readonly turn?: number;
}

/**
 * The tier a unit will actually carry into a contest resolved at `turn`. The
 * expiry on the wire is INCLUSIVE, so the effect survives its own expiry turn
 * and is gone the turn after — the one place a threat priced a turn ahead
 * differs from the same threat priced now.
 */
export function tierAt(unit: RayUnit, turn: number): number {
  const expiry = unit.tierExpiresAtTurn;
  if (expiry === undefined || expiry === null) return unit.tier;
  return turn <= expiry ? unit.tier : 0;
}

/** What ends a ray. `open` is reported only for the ray's own end-of-board. */
export type Verdict =
  /** We cut one or more trail units here and capture-stop. */
  | 'sever'
  /** We are the unique strict maximum of a head-class contest here. */
  | 'kill'
  /** We die here: outranked in a contest, or a body of equal-or-higher tier. */
  | 'die'
  /** Nobody is the strict maximum: every participant dies, us included. */
  | 'tie'
  /** The ray ran off the interior with nothing on it. */
  | 'wall';

export interface RayOccupant {
  readonly unitId: string;
  readonly team: number;
  /** Index into the occupant's occupancy: 0 is the head, ≥ 1 is body. */
  readonly occIndex: number;
  readonly tier: number;
  readonly weight: number;
}

export interface RayCrossing {
  readonly dx: number;
  readonly dy: number;
  /** Cells travelled from the origin to reach this one, 1-based. */
  readonly step: number;
  /** Full-board cell index of the crossing, or of the wall cell for `wall`. */
  readonly cell: number;
  readonly verdict: Verdict;
  /**
   * ENEMY weight this crossing removes, in weight units: severed body cells by
   * rule, or the whole weight of a unit we outright kill.
   */
  readonly enemyWeightRemoved: number;
  /** The same, for units on OUR OWN team. Friendly fire is real under these rules. */
  readonly allyWeightRemoved: number;
  /** Our own weight, when the verdict kills us; zero otherwise. */
  readonly ownWeightRisked: number;
  readonly occupants: ReadonlyArray<RayOccupant>;
  /**
   * False when the mover's health cannot pay for entering this cell and
   * surviving the turn. A crossing outside the health budget is still reported
   * — it is a real fact about the ray — and the consumer decides what to do
   * with a cut it cannot afford to take this turn.
   */
  readonly withinHealth: boolean;
}

export interface RayWalk {
  readonly dx: number;
  readonly dy: number;
  /** Cells in order from the origin, up to and including the terminating cell. */
  readonly cells: ReadonlyArray<number>;
  /** The crossing that ended the ray. Never null: a clear ray ends at a wall. */
  readonly terminal: RayCrossing;
  /** Empty interior cells before the terminal — the destinations this ray offers. */
  readonly freeSteps: number;
}

export interface RayCrossingOptions {
  /**
   * Walk from here instead of the unit's own head. This is what makes the
   * primitive answer "what would this unit's rays cross FROM that square",
   * which is the counterfactual three of the four portfolio candidates need.
   */
  readonly origin?: number;
  /** Cap the walk. Defaults to the whole board. */
  readonly maxSteps?: number;
  /**
   * Health available for the walk, when it is not the unit's own — the
   * counterfactual again (a unit valued from a destination has already spent
   * some). Defaults to `unit.health`.
   */
  readonly health?: number;
  /**
   * Tier to judge contests at, when it is not the unit's own. This is the
   * potion window's counterfactual: "what would this unit's rays be worth at
   * +1". Defaults to `unit.tier`.
   */
  readonly tier?: number;
}

const isWall = (cell: number, width: number, height: number): boolean => {
  const x = cell % width;
  const y = (cell / width) | 0;
  return x === 0 || y === 0 || x === width - 1 || y === height - 1;
};

/**
 * Cell → everyone standing on it, with their occupancy index. Built once per
 * board and shared across every ray and every unit; a caller walking many units
 * over one board should build it once with `indexOccupancy` and pass it in.
 */
export type OccupancyIndex = ReadonlyMap<number, ReadonlyArray<RayOccupant>>;

export function indexOccupancy(board: RayBoard, atTurn?: number): OccupancyIndex {
  const out = new Map<number, RayOccupant[]>();
  for (const u of board.units) {
    const tier = atTurn === undefined ? u.tier : tierAt(u, atTurn);
    for (let i = 0; i < u.occupancy.length; i++) {
      const cell = u.occupancy[i] as number;
      const at = out.get(cell);
      const row: RayOccupant = {
        unitId: u.unitId,
        team: u.team,
        occIndex: i,
        tier,
        weight: u.weight,
      };
      if (at === undefined) out.set(cell, [row]);
      else at.push(row);
    }
  }
  return out;
}

/**
 * One row per unit at a cell, at its LOWEST occupancy index there.
 *
 * A unit can occupy one cell twice — a trail unit that just ate carries a
 * doubled tail — and the engine reads exactly one index for it: `occupancy[0]`
 * for the head class and `indexOf(cell, 1)` for the body, both of which are the
 * lowest matching index. Counting the cell twice would price one sever as two.
 */
function collapseOccupants(
  occupants: ReadonlyArray<RayOccupant>,
  moverId: string
): RayOccupant[] {
  const best = new Map<string, RayOccupant>();
  for (const o of occupants) {
    if (o.unitId === moverId) continue;
    const seen = best.get(o.unitId);
    if (seen === undefined || o.occIndex < seen.occIndex) best.set(o.unitId, o);
  }
  return [...best.values()];
}

/**
 * Adjudicate ONE cell for a mover, exactly as the engine's collision phase
 * would. Head-class participants are settled first (`c4` runs before `c5`), and
 * a cell holding only trail body is a sever-or-die.
 */
function adjudicate(
  moverTeam: number,
  moverTier: number,
  moverWeight: number,
  occupants: ReadonlyArray<RayOccupant>,
  moverId: string
): {
  verdict: Verdict;
  enemyWeightRemoved: number;
  allyWeightRemoved: number;
  ownWeightRisked: number;
} | null {
  const others = collapseOccupants(occupants, moverId);
  if (others.length === 0) return null;

  const heads = others.filter((o) => o.occIndex === 0);
  if (heads.length > 0) {
    // c4: strictMaximum over the mover plus every head-class incumbent —
    // tier strictly first, then weight, and a non-unique maximum kills all.
    const field = [
      { tier: moverTier, weight: moverWeight, mover: true, row: null as RayOccupant | null },
      ...heads.map((o) => ({ tier: o.tier, weight: o.weight, mover: false, row: o })),
    ];
    const maxTier = Math.max(...field.map((f) => f.tier));
    const top = field.filter((f) => f.tier === maxTier);
    const maxWeight = Math.max(...top.map((f) => f.weight));
    const heaviest = top.filter((f) => f.weight === maxWeight);
    if (heaviest.length !== 1) {
      return {
        verdict: 'tie',
        enemyWeightRemoved: 0,
        allyWeightRemoved: 0,
        ownWeightRisked: moverWeight,
      };
    }
    const winner = heaviest[0] as (typeof field)[number];
    if (!winner.mover) {
      return {
        verdict: 'die',
        enemyWeightRemoved: 0,
        allyWeightRemoved: 0,
        ownWeightRisked: moverWeight,
      };
    }
    let enemy = 0;
    let ally = 0;
    for (const h of heads) {
      if (h.team === moverTeam) ally += h.weight;
      else enemy += h.weight;
    }
    return { verdict: 'kill', enemyWeightRemoved: enemy, allyWeightRemoved: ally, ownWeightRisked: 0 };
  }

  // c5: body only. One tier comparison against the HIGHEST owner present
  // decides the whole cell, and a sever cuts every owner at it.
  const maxOwnerTier = Math.max(...others.map((o) => o.tier));
  if (moverTier <= maxOwnerTier) {
    return {
      verdict: 'die',
      enemyWeightRemoved: 0,
      allyWeightRemoved: 0,
      ownWeightRisked: moverWeight,
    };
  }
  let enemy = 0;
  let ally = 0;
  for (const o of others) {
    // The cut removes the owner's occupancy from this index outward. `weight`
    // is the owner's occupancy length for a trail unit, which is the only kind
    // that can be here at an index ≥ 1.
    const cut = Math.max(0, o.weight - o.occIndex);
    if (o.team === moverTeam) ally += cut;
    else enemy += cut;
  }
  return { verdict: 'sever', enemyWeightRemoved: enemy, allyWeightRemoved: ally, ownWeightRisked: 0 };
}

/**
 * Walk every ray this unit's kind may slide along and report what each one
 * crosses, in order.
 *
 * A stepper (snake, knight, king, pawn) has no rays and gets an empty array —
 * which is the gate `sliderAttackVector` reads for free, and the reason a
 * snake-only board never pays anything for this primitive.
 *
 * COST. One ordered walk per ray, bounded by the board dimension: eight rays on
 * a 25×25 board is ≤ 8 × 24 ≈ 200 cell reads, the per-unit-action class the
 * portfolio names.
 */
export function rayCrossings(
  board: RayBoard,
  unit: RayUnit,
  options: RayCrossingOptions = {},
  index?: OccupancyIndex
): ReadonlyArray<RayWalk> {
  const profile = profileOf(unit.kind);
  if (profile.rays.length === 0) return [];

  const occ = index ?? indexOccupancy(board);
  const origin = options.origin ?? (unit.occupancy[0] as number);
  const width = board.width;
  const height = board.height;
  const maxSteps = options.maxSteps ?? Math.max(width, height);
  const health = options.health ?? unit.health;
  const tier = options.tier ?? unit.tier;
  // Health is spent per cell ENTERED and a unit at zero stops and dies unless
  // it eats; the honest budget is therefore "steps that leave us alive".
  const affordable = Math.floor((health - 1) / Math.max(1, profile.costPerCell));

  const ox = origin % width;
  const oy = (origin / width) | 0;
  const out: RayWalk[] = [];

  for (const [dx, dy] of profile.rays) {
    const cells: number[] = [];
    let terminal: RayCrossing | null = null;
    let freeSteps = 0;
    for (let step = 1; step <= maxSteps; step++) {
      const x = ox + dx * step;
      const y = oy + dy * step;
      if (x < 0 || y < 0 || x >= width || y >= height) break;
      const cell = y * width + x;
      cells.push(cell);
      if (isWall(cell, width, height)) {
        terminal = {
          dx,
          dy,
          step,
          cell,
          verdict: 'wall',
          enemyWeightRemoved: 0,
          allyWeightRemoved: 0,
          ownWeightRisked: 0,
          occupants: [],
          withinHealth: step <= affordable,
        };
        break;
      }
      const here = occ.get(cell);
      const call =
        here === undefined
          ? null
          : adjudicate(unit.team, tier, unit.weight, here, unit.unitId);
      if (call === null) {
        freeSteps = step;
        continue;
      }
      terminal = {
        dx,
        dy,
        step,
        cell,
        verdict: call.verdict,
        enemyWeightRemoved: call.enemyWeightRemoved,
        allyWeightRemoved: call.allyWeightRemoved,
        ownWeightRisked: call.ownWeightRisked,
        occupants: collapseOccupants(here as ReadonlyArray<RayOccupant>, unit.unitId),
        withinHealth: step <= affordable,
      };
      break;
    }
    if (terminal === null) {
      // The ray ran out of board without meeting the perimeter — only possible
      // when `maxSteps` cut it short. Report the last cell as an open end.
      const step = cells.length;
      if (step === 0) continue;
      terminal = {
        dx,
        dy,
        step,
        cell: cells[step - 1] as number,
        verdict: 'wall',
        enemyWeightRemoved: 0,
        allyWeightRemoved: 0,
        ownWeightRisked: 0,
        occupants: [],
        withinHealth: step <= affordable,
      };
    }
    out.push({ dx, dy, cells, terminal, freeSteps });
  }
  return out;
}

/**
 * The gate, and it is one test rather than a walk: is there any trail unit on
 * the board at all whose body a sever could cut? On a piece-only board the
 * whole sever channel is provably empty and no ray need be walked.
 */
export function anyBodyOnBoard(board: RayBoard): boolean {
  for (const u of board.units) if (u.occupancy.length > 1) return true;
  return false;
}
