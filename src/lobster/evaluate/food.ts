/**
 * THE FOOD GRADIENT — the term the objective did not have.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * Until this file the only food signal in the whole decision was
 * `AssessedCandidate.foodGain`: a 0/1 flag on whether a move's landing cell
 * holds a meal, read by the candidate ORDERING and by nothing that scores. A
 * meal one square away was therefore worth a tie-break, and a meal two squares
 * away was worth exactly nothing. The recorded consequence, from
 * `src/tests/local-game.ts` on the `sparse` board:
 *
 *     turn 8  food: (6,6) (8,0)
 *       T  8 red-A snake hp 93 (5,4)->(5,5)  top3: (5,3)=41.41 (6,4)=41.40 (5,5)=41.40
 *
 * — two cells from a meal, three options spanning 0.01 of score, and the
 * best-ranked of them walking away from it. Four snakes on that board ate three
 * meals in 361 unit-turns and one of them starved.
 *
 * The territory profile's own docstring says food was measured "worthless at
 * the sound floor", and that measurement is not wrong: a FLOOR concedes every
 * cell an optimistic enemy could beat us to, and a contested meal is precisely
 * such a cell, so a floor-side food term really does collapse. The mistake was
 * concluding that food therefore needs no term. What it needs is a term that is
 * not about who WINS the race — the search's material fold already prices
 * winning it — but about whether a unit is CLOSING on a meal at all. That is a
 * property of our own unit's position, it survives a pessimistic floor, and it
 * is the thing a horizon-1 search structurally cannot discover for itself.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 *
 * One multi-source breadth-first flood from every meal on the board, over open
 * terrain, computed ONCE per substrate and cached against it. `pull(u)` is
 * `1 - d/D` at the unit's post-move cell, with `D` the board's Manhattan
 * diameter — 1 standing on a meal, falling to 0 at the far corner.
 *
 * LINEAR, and that was a correction. The first shape tried was `1/(1+d)`, which
 * is what "steep near the food" suggests; it is also nearly FLAT far from it
 * (0.014 of signal per step at eight cells out), and the terms it competes with
 * — `reach`, `room` — move by ten times that across a snake's own options. A
 * gradient that only exists once you are already next to the meal is not a
 * gradient. A constant slope of `1/D` per cell is worth the same signal
 * wherever the unit stands, which is the property that actually walks it there.
 *
 * HUNGER-SCALED, because a full unit chasing food across the board is the
 * opposite failure. The scale runs from `HUNGER_FLOOR` at full health to 1 at
 * empty, so a healthy unit still prefers the meal among equals and a starving
 * one prefers it over almost anything this feature can outweigh.
 *
 * ── WHY THE FLOOD IGNORES BODIES ───────────────────────────────────────────
 *
 * It floods over TERRAIN only — walls stop it, units do not. A unit's body is
 * where it is for one turn; a wall is where it is forever. Flooding around
 * bodies would make the gradient jump every time anything moved, which is
 * exactly the instability the momentum term exists to remove. A body between a
 * unit and its meal is priced by the terms that price bodies (`room`, `reach`,
 * and the survival cliff inside `material`), not by this one.
 *
 * ── SCALE AND THE CLIFF ────────────────────────────────────────────────────
 *
 * `pull` is in [0, 1] and the sum is divided by the number of our units on the
 * board, so the feature's whole observable range is [0, 1] on every board shape
 * — which is what lets one weight sit safely under the cliff inequality
 * (`w x range < 10 x lightest unit weight`) whatever the roster size.
 */

import { bbTest } from '../bits';
import type { EngineSubstrate } from '../substrate';
import { type Feature, envelope, point } from './bound';
import type { EvalContext, Standing } from './features';
import { perBoard } from './memo';

/** No path from this cell to any meal. */
const UNREACHABLE = -1;

/**
 * How much a unit at FULL health still cares. Not zero: a full snake that eats
 * grows, and growth is how a snake wins a board. Not one either — a unit at
 * full health has no urgency and its other terms should decide.
 *
 * CALIBRATED BY WATCHING, over four seeds x 60 turns of the `snakes` and
 * `mixed` scenarios (src/tests/local-game.ts). The number trades meals against
 * the deaths that chasing them costs, and the curve is not flat:
 *
 *   floor  snakes food/100  snake deaths   mixed food/100  mixed deaths
 *   0.35        20.3          15 (7 self)      23.6            21
 *   0.25        18.3          15 (6 self)      20.4            19
 *   0.15        15.6          13 (2 self)      19.8            13
 *
 * A full-health snake that hunts anyway coils itself into a spiral and dies in
 * it — every one of those `self` deaths is a snake with no legal square left,
 * several turns after the move that trapped it. Fifteen meals per hundred
 * unit-turns with two self-kills is a better bot than twenty with seven.
 */
export const HUNGER_FLOOR = 0.15;

const DISTANCE = new WeakMap<EngineSubstrate, Int32Array>();

/**
 * Steps from every cell to the nearest meal, over open terrain. `UNREACHABLE`
 * where no meal is reachable, which on a board with no food at all is every
 * cell — and the feature then returns a constant, as it must.
 *
 * Cached per substrate: one flood per decision, not one per evaluation.
 */
export function foodDistance(sub: EngineSubstrate): Int32Array {
  return perBoard(DISTANCE, sub, () => computeFoodDistance(sub));
}

function computeFoodDistance(sub: EngineSubstrate): Int32Array {
  const grid = sub.grid;
  const width = grid.width;
  const dist = new Int32Array(grid.cells).fill(UNREACHABLE);
  const queue = new Int32Array(grid.cells);
  let head = 0;
  let tail = 0;
  for (const cell of sub.marshalled.config.food) {
    if (cell < 0 || cell >= grid.cells) continue;
    if (dist[cell] !== UNREACHABLE) continue;
    dist[cell] = 0;
    queue[tail++] = cell;
  }
  const steps = [-width, width, -1, 1];
  while (head < tail) {
    const cell = queue[head++] as number;
    const d = (dist[cell] as number) + 1;
    const x = cell % width;
    for (let i = 0; i < 4; i++) {
      // Left and right may not wrap a row; up and down cannot wrap at all
      // because the perimeter ring is wall and the flood never enters it.
      if (i === 2 && x === 0) continue;
      if (i === 3 && x === width - 1) continue;
      const next = cell + (steps[i] as number);
      if (next < 0 || next >= grid.cells) continue;
      if (dist[next] !== UNREACHABLE) continue;
      if (!bbTest(sub.terrain.open, next)) continue;
      dist[next] = d;
      queue[tail++] = next;
    }
  }
  return dist;
}

/**
 * HOW CLOSE ONE CELL IS TO A MEAL. `1 - d/D`, and exactly 0 where no meal is
 * reachable at all — which on a board with no food is every cell.
 */
function nearOf(ctx: EvalContext, dist: Int32Array, cell: number): number {
  const d = dist[cell];
  if (d === undefined || d === UNREACHABLE) return 0;
  const diameter = Math.max(1, ctx.sub.grid.width + ctx.sub.grid.height);
  return Math.max(0, 1 - d / diameter);
}

/**
 * HOW MUCH THIS UNIT CARES, wherever it ends up.
 *
 * The hunger scale reads the unit's energy at the START of the turn, not the
 * energy the settlement left it with, and that is not a detail: eating refills
 * a unit toward its kind's maximum, so a settled reading prices the very move
 * that fed it as the move of a unit with no appetite — the two effects cancel
 * and the meal stops being worth anything. Reading turn-start energy makes the
 * scale a per-unit CONSTANT within one decision, so this feature is purely
 * positional and the value of the meal itself is left where it belongs, in
 * `material`.
 */
function appetiteOf(ctx: EvalContext, s: Standing): number {
  const cap = Math.max(1, ctx.sub.maxEnergyOf(s.kind));
  const energy = ctx.sub.unitOf(s.unitId)?.energy ?? s.energy;
  const hunger = Math.min(1, Math.max(0, 1 - energy / cap));
  return HUNGER_FLOOR + (1 - HUNGER_FLOOR) * hunger;
}

/**
 * ONE UNIT'S APPETITE FOR WHERE IT IS STANDING — AS AN INTERVAL OVER THE CELLS
 * ITS ARRIVAL COULD SETTLE ON.
 *
 * A GRADIENT MAY NOT READ A CONTINGENT CELL AS A POINT, and this term read one
 * for as long as it existed. `s.cell` for a mover is the cell the PARTIAL
 * settlement stopped it on, and what stops it short is a HELD unit's claim: a
 * slider staged four squares down a file is halted at one, two or three of them
 * depending on where the claim's cloud actually turns out to be. Every cell of
 * that path carries its own distance to the nearest meal, so a reading taken at
 * one of them is a reading of one world — measured as 63 worlds of
 * `law-sweep.test.ts` whose `food` value sat ABOVE the ceiling that claimed to
 * bound it, every one of them a rook, a queen or a bishop the engine's own
 * `fates` calls `contingent` (`docs/design/RATCHET-2.md` §4).
 *
 * So the ceiling pays the DEAREST cell of the set and the floor the cheapest,
 * and where the arrival is settled the set is a singleton and the two ends
 * coincide — which is every unit on a board with nothing held, so R3 is
 * untouched. A refinement can only shrink the set of cells a halted arrival
 * could settle on, so R2 is too.
 *
 * THE SET IS `contest.ts`'s `settlesOn`, STATED TWICE ON PURPOSE. It is the
 * same three sources — where the unit got to, where it set out from, and every
 * cell it entered on the way. Sharing one function would mean widening a closed
 * member's surface for a reason that is not about its behaviour, and the thing
 * that would actually catch a divergence is not a shared symbol anyway: both
 * classes are pinned at ZERO in `law-sweep.test.ts` over the same 240 boards,
 * so a copy that drifted from the rule would put its own member's class back
 * above zero on the next run.
 */
function pullOf(
  ctx: EvalContext,
  s: Standing,
  dist: Int32Array
): readonly [lo: number, hi: number] {
  const scale = appetiteOf(ctx, s);
  const settled = nearOf(ctx, dist, s.cell) * scale;
  const unit = ctx.sub.unitOf(s.unitId);
  if (unit === undefined || ctx.resolution.fates[unit.wireId] !== 'contingent') {
    return [settled, settled];
  }
  let low = settled;
  let high = settled;
  const consider = (cell: number): void => {
    const v = nearOf(ctx, dist, cell) * scale;
    if (v < low) low = v;
    if (v > high) high = v;
  };
  const origin = unit.cells[0];
  if (origin !== undefined) consider(origin);
  const walked = ctx.resolution.traversed[unit.wireId];
  if (walked !== undefined) for (const cell of walked) consider(cell);
  return [low, high];
}

/**
 * F7 — the food gradient.
 *
 * OURS ONLY, and deliberately. This is not a contested quantity like `reach`:
 * "am I closing on a meal" is a fact about our own unit's position that stays
 * true whatever the enemy does, and subtracting the enemy's version of it would
 * turn a stable self-regarding gradient into a term that moves when a held
 * unit's interval moves. The enemy's food race is priced where it belongs —
 * in the material fold, which sees the growth.
 *
 * The two readings differ in which of OUR contingent units are counted and, per
 * unit, in which of the cells a contingent ARRIVAL could settle on is read
 * (`pullOf`). `lo <= hi` holds by construction on both counts — our worst-world
 * alive set is a subset of our best-world one, and the floor reads the cheapest
 * cell of a set whose dearest the ceiling reads — and both collapse the moment
 * nothing is held.
 */
export const foodFeature: Feature<EvalContext> = {
  key: 'food',
  defaultWeight: 2,
  contract: {
    reads: [{ input: 'contingent-survival', monotone: 'down' }],
    cliff: false,
    dischargeable: true,
  },
  evaluate(ctx) {
    const dist = foodDistance(ctx.sub);
    let lo = 0;
    let hi = 0;
    let ours = 0;
    for (const s of ctx.standing) {
      if (s.team !== ctx.asTeam) continue;
      ours++;
      if (!s.worstAlive && !s.bestAlive) continue;
      const [vLo, vHi] = pullOf(ctx, s, dist);
      if (s.worstAlive) lo += vLo;
      if (s.bestAlive) hi += vHi;
    }
    if (ours === 0) return point(0);
    lo /= ours;
    hi /= ours;
    return envelope(lo, hi);
  },
};
