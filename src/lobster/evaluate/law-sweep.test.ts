/**
 * R1, PER FEATURE, OVER BOARDS NOBODY CHOSE.
 *
 * `bounds/soundness.test.ts` sweeps the BANK over generated boards, and it
 * does so with the material-only evaluator: the ground truth there is an
 * exhaustive resolution, and an exhaustive resolution can only be compared
 * with a value the resolver itself produces. That arm is blind to every defect
 * that lives in a FEATURE, because the feature is not in the evaluator it
 * runs.
 *
 * The hand-picked law cases in that file are the other half — `checkSoundness`
 * with the SHIPPED evaluator on one board each — and every one of them was
 * written after a defect had already been found somewhere else. This file is
 * the arm that finds them: many random boards, the shipped fold, and R1
 * checked TERM BY TERM rather than only on the total.
 *
 * ── WHY PER TERM, AND WHY THAT IS THE DEFECT CLASS ────────────────────────
 *
 * The fold is a non-negatively weighted sum of per-feature intervals, so
 * per-feature R1 implies R1 on the total and is strictly stronger: a term
 * whose `lo` sits above its own value in some world is a broken bound even
 * when another term happens to be loose enough to hide it. The converse
 * failure — a total that is sound only by cancellation — is a floor waiting
 * for the cancelling term to move.
 *
 * So a violation here NAMES THE TERM. That name is the defect class the repair
 * is reported against: `material`, `room`, `reach`, `command`, `kingMargin`,
 * `tier`, `potion`, and the rest of `FEATURES`. Nothing is bucketed by hand.
 *
 * ── THE BOARDS ─────────────────────────────────────────────────────────────
 *
 * Everything the hand-picked cases needed and the bank's own sweep does not
 * generate: snakes AND pieces from the same kind table, one to three units a
 * side so the held set is a set rather than a singleton, FOOD (the one thing
 * that moves a held unit's weight while it is frozen) and POTIONS (the one
 * thing that moves its tier). Our whole side is staged; everything else is a
 * claim, and the worlds are the engine's own enumeration of it.
 */

import type { Board, Coord, Snake } from '../../types/battlesnake';
import { marshalBoard } from '../../logic/turn-oracle';
import { makeSubstrate, clearGeometryCache } from '../substrate';
import type { EngineSubstrate } from '../substrate';
import { defaultEvaluator } from './index';
import { heldOf, worldsOf, type LawCase } from './laws';
import type { Candidate, JointPlan, UnitId } from '../contracts';

const EPS = 1e-6;
const TURN = 40;
const OURS = 'red';
const THEIRS = 'blue';

// --------------------------------------------------------------- the boards

/** One deterministic stream per board, so a failing seed replays exactly. */
function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function unitOf(
  id: string,
  body: ReadonlyArray<Coord>,
  teamID: string,
  extra: Record<string, unknown> = {},
): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 90,
    body: [...body],
    head: body[0] as Coord,
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    teamID,
    ...extra,
  } as unknown as Snake;
}

const PIECES = ['queen', 'rook', 'bishop', 'knight', 'pawn'] as const;

/**
 * One board. Units are placed on distinct cells with room for a body, so the
 * generator never has to reject a whole board for an overlap it could have
 * avoided; food and potions go on cells nothing stands on.
 */
function boardAt(seed: number, size: number, perSide: number, food: number, potions: number): Board | null {
  const r = rng(seed);
  const taken = new Set<number>();
  const free = (): Coord | null => {
    for (let tries = 0; tries < 60; tries++) {
      const x = 1 + Math.floor(r() * (size - 2));
      const y = 1 + Math.floor(r() * (size - 2));
      const c = y * size + x;
      if (taken.has(c)) continue;
      taken.add(c);
      return { x, y } as Coord;
    }
    return null;
  };
  const snakes: Snake[] = [];
  for (const team of [OURS, THEIRS]) {
    for (let i = 0; i < perSide; i++) {
      const head = free();
      if (head === null) return null;
      // A snake on half the draws, a piece on the other half: the two carry
      // different bounds (a trail unit can be SEVERED, a piece cannot) and a
      // sweep of one kind proves nothing about the other.
      if (r() < 0.5) {
        const len = 2 + Math.floor(r() * 3);
        const body: Coord[] = [head];
        let ok = true;
        for (let k = 1; k < len; k++) {
          const prev = body[k - 1] as Coord;
          const next = { x: prev.x, y: prev.y - 1 } as Coord;
          const c = next.y * size + next.x;
          if (next.y < 0 || taken.has(c)) { ok = false; break; }
          taken.add(c);
          body.push(next);
        }
        if (!ok || body.length < 2) return null;
        snakes.push(unitOf(`${team}${i}`, body, team));
      } else {
        const kind = PIECES[Math.floor(r() * PIECES.length)] as string;
        const weight = 1 + Math.floor(r() * 3);
        snakes.push(unitOf(`${team}${i}`, [head], team, { unitType: kind, length: weight }));
      }
    }
  }
  const foodAt: Coord[] = [];
  for (let i = 0; i < food; i++) {
    const c = free();
    if (c !== null) foodAt.push(c);
  }
  const potionAt: Coord[] = [];
  for (let i = 0; i < potions; i++) {
    const c = free();
    if (c !== null) potionAt.push(c);
  }
  return {
    width: size,
    height: size,
    food: foodAt,
    hazards: [],
    snakes,
    ...(potionAt.length > 0
      ? { invulnerabilityPotions: potionAt, invulnerabilityPotionsEnabled: true }
      : {}),
  } as Board;
}

/** Our whole side staged, each unit on one of its own enumerated options. */
function caseFor(board: Board, seed: number): LawCase | null {
  const stages = board.snakes.filter((s) => (s as { teamID: string }).teamID === OURS).map((s) => s.id);
  if (stages.length === 0) return null;
  const sub = makeSubstrate({ board, turn: TURN, asTeam: OURS, modeled: stages });
  const r = rng(seed + 7919);
  const orders = new Map<string, number>();
  try {
    for (const wireId of stages) {
      const unit = sub.unitOfWireId(wireId);
      if (unit === undefined) return null;
      const options = sub.actionsOf(unit.unitId);
      if (options.length === 0) return null;
      orders.set(wireId, (options[Math.floor(r() * options.length)] as Candidate).to);
    }
  } finally {
    sub.release();
  }
  return { name: `board ${seed}`, board, turn: TURN, asTeam: OURS, stages, orders };
}

// ------------------------------------------------------------- the sweep

interface Counts {
  boards: number;
  worlds: number;
  /** feature key + side → how many worlds it was wrong on. */
  classes: Record<string, number>;
  totalLo: number;
  totalHi: number;
}

function planFor(sub: EngineSubstrate, c: LawCase): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const wireId of c.stages) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) throw new Error(`no unit ${wireId}`);
    const to = c.orders.get(wireId) as number;
    plan.set(unit.unitId, {
      unitId: unit.unitId,
      from: -1,
      to,
      path: sub.pathFor(unit.unitId, to) ?? [],
    });
  }
  return plan;
}

/**
 * ONE BOARD. The partial reading once, every world once, and the per-feature
 * comparison in both directions.
 *
 * A world is a POINT by construction — nothing is held in it — so its `lo` and
 * `hi` are the same number and the two comparisons are the two halves of "the
 * interval covers this world".
 */
function sweep(c: LawCase, counts: Counts, cap: number): void {
  const sub = makeSubstrate({ board: c.board, turn: c.turn, asTeam: c.asTeam, modeled: c.stages });
  try {
    if (heldOf(sub, c).length === 0) return;
    const asTeam = sub.teamNumber(c.asTeam);
    const partial = defaultEvaluator.evaluatePlan(sub, planFor(sub, c), asTeam);
    counts.boards++;
    for (const world of worldsOf(sub, c, cap)) {
      const v = defaultEvaluator.evaluatePlan(sub, world.plan, asTeam);
      counts.worlds++;
      if (v.bound.lo < partial.bound.lo - EPS) counts.totalLo++;
      if (v.bound.hi > partial.bound.hi + EPS) counts.totalHi++;
      for (const key of Object.keys(partial.parts)) {
        const held = partial.parts[key];
        const real = v.parts[key];
        if (held === undefined || real === undefined) continue;
        // A LATTICE END IS NOT A NUMBER. `DEAD === DEAD` subtracts to NaN, and
        // a comparison against one is agreement rather than slack.
        if (real.lo === held.lo || real.hi === held.hi) continue;
        if (real.lo < held.lo - EPS) {
          counts.classes[`${key}.lo`] = (counts.classes[`${key}.lo`] ?? 0) + 1;
        }
        if (real.hi > held.hi + EPS) {
          counts.classes[`${key}.hi`] = (counts.classes[`${key}.hi`] ?? 0) + 1;
        }
      }
    }
  } finally {
    sub.release();
  }
}

const SHAPES: ReadonlyArray<{ perSide: number; size: number; food: number; potions: number }> = [
  { perSide: 1, size: 7, food: 1, potions: 0 },
  { perSide: 2, size: 7, food: 2, potions: 0 },
  { perSide: 2, size: 7, food: 1, potions: 2 },
  { perSide: 3, size: 8, food: 2, potions: 0 },
  { perSide: 3, size: 8, food: 2, potions: 2 },
  { perSide: 1, size: 6, food: 1, potions: 1 },
];

/** The sweep, as a function so a script can run it at a different width. */
export function lawSweep(boards: number, cap = 96): Counts {
  const counts: Counts = { boards: 0, worlds: 0, classes: {}, totalLo: 0, totalHi: 0 };
  for (let seed = 1; counts.boards < boards && seed <= boards * 6; seed++) {
    const shape = SHAPES[seed % SHAPES.length] as (typeof SHAPES)[number];
    const board = boardAt(seed, shape.size, shape.perSide, shape.food, shape.potions);
    if (board === null) continue;
    let c: LawCase | null = null;
    try {
      c = caseFor(board, seed);
    } catch {
      c = null;
    }
    if (c === null) continue;
    try {
      sweep(c, counts, cap);
    } catch {
      // A board the marshaller or the engine refuses is not a bound defect.
      continue;
    }
  }
  return counts;
}

/**
 * THE CLASSES THIS SWEEP CARRIES TODAY, AND WHY THAT IS A NUMBER AND NOT ZERO.
 *
 * Nine per-feature classes are open on 240 boards at the head this file lands
 * on, and closing them is nine repairs in nine terms. Asserting zero would
 * make the file red on arrival and therefore useless; asserting nothing would
 * let the next change add a tenth silently. So it is a RATCHET: each class is
 * pinned at what it measures on THIS head — unrepaired — a class may only go
 * DOWN, and a class not in this table may not appear at all.
 *
 * TWO OF THE NINE ARE NOW CLOSED AND PINNED AT ZERO — `contest.lo` (D1) and
 * `food.hi` (`docs/design/RATCHET-2.md` §4) — and both closed the SAME defect
 * in two different members: a contingent settle cell read as a point. Two of
 * the remaining seven are classified and REFUSED rather than open by neglect:
 * `reach.hi` and `reach.lo` are plane 2 paying out on plane 1's cover, and the
 * only single-sweep bound on that is the saturating one (§2 of the same doc).
 *
 * ── AND A NUMBER GOING DOWN IS NOT BY ITSELF A REASON TO SHIP ──────────────
 *
 * `b1-sound` closed two of these (`command.hi` 600 → 199, `reach.lo` 128 →
 * 106) and the repairs were DECLINED. The exact-reply oracle beside this file
 * settles 44 859 582 concrete worlds across the sixteen gate arms and finds
 * the whole-plan bracket already exact on every one of them, so the classes
 * below are latent — a term whose slack another term is currently paying for
 * — and the narrower readings bought nothing the oracle could find in a real
 * game while costing deaths on three of four board classes
 * (`docs/design/ab/2026-09-04-b1-sound-vs-57fd2da.md`). A correct-and-looser
 * floor that fixes nothing measurable and loses more games is not a repair.
 *
 * So the bar a future repair has to clear is BOTH: lower a number here, and
 * bring an A/B that is neutral or better per board class, never pooled.
 * `totalLo` is 0 and stays 0 — the FOLD's floor is under every world on every
 * board here, which is the property `bounds/soundness.test.ts` and the
 * exact-reply oracle both check directly.
 */
const RATCHET: Readonly<Record<string, number>> = {
  'reach.hi': 220,
  'command.hi': 600,
  'room.lo': 73,
  'reach.lo': 128,
  'material.hi': 8,
  'energy.hi': 10,
  'momentum.lo': 27,
  // CLOSED, and pinned at zero so it stays closed: `contest` used to charge
  // each of our units at the one cell the OPTIMISTIC timeline settled it on,
  // and a world that halts a mover short of it settles it somewhere else. The
  // term now brackets over the cells its arrival could settle on (`contest.ts`,
  // `settlesOn`) and the class goes 30 -> 0. See D1 of
  // `docs/design/BEHAVIOUR-AUDIT.md`.
  'contest.lo': 0,
  // CLOSED, and pinned at zero for the same reason and by the same rule:
  // `food` read `pull` at the cell the PARTIAL settlement stopped a mover on,
  // and a held claim halts a SLIDER somewhere along its path rather than
  // killing it. All 63 worlds were a rook, a queen or a bishop the engine's
  // own `fates` calls `contingent`, and the world's settle cell was inside
  // `settlesOn`'s set every time. `food.ts` now brackets over that set — the
  // ceiling at the dearest cell, the floor at the cheapest — and the class
  // goes 63 -> 0. See §4 of `docs/design/RATCHET-2.md`.
  'food.hi': 0,
};
/** R1 on the TOTAL, which is the property the bank's floor rests on. */
const TOTAL_LO_RATCHET = 0;
const TOTAL_HI_RATCHET = 9;

afterEach(() => clearGeometryCache());

describe('R1 holds TERM BY TERM over boards nobody chose', () => {
  test('no feature reads further outside its own worlds than it did', () => {
    const counts = lawSweep(240);
    console.log(
      `  [law-sweep] boards=${counts.boards} worlds=${counts.worlds} ` +
        `totalLo=${counts.totalLo} totalHi=${counts.totalHi} ` +
        `classes=${JSON.stringify(counts.classes)}`,
    );
    // Anti-vacuity: the sweep has to have built the boards it claims and the
    // worlds have to be a product rather than a singleton.
    expect(counts.boards).toBeGreaterThanOrEqual(200);
    expect(counts.worlds).toBeGreaterThan(counts.boards * 2);
    // No class this table has never seen, and no class above its own pin.
    const over = Object.entries(counts.classes)
      .filter(([key, n]) => n > (RATCHET[key] ?? 0))
      .map(([key, n]) => `${key}=${n} > ${RATCHET[key] ?? 0}`);
    expect(over).toEqual([]);
    expect(counts.totalLo).toBeLessThanOrEqual(TOTAL_LO_RATCHET);
    expect(counts.totalHi).toBeLessThanOrEqual(TOTAL_HI_RATCHET);
  }, 900_000);
});

/** Kept so the import of `marshalBoard` is not dead when a case needs a cell. */
export const cellOf = (board: Board, x: number, y: number): number =>
  marshalBoard(board, TURN).toIndex({ x, y } as Coord);
