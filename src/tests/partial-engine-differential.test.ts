/**
 * THE DIFFERENTIAL, IN SITU: the possibility-cloud engine against THIS REPO's
 * vendored resolver, on random boards, over every coordinate a resolution
 * reports — who lived, where, with what health and weight, who died where and
 * of what, every typed clash, and every severed cell.
 *
 * This is the integration proof for the vendoring, not just a ported test.
 * Upstream runs the same 2000 boards against its own copy of the rules; the
 * question that copy cannot answer is whether the engine agrees with the rules
 * AS THIS REPO HAS THEM — same TypeScript source the bot adjudicates with,
 * same wire adapter the bot will translate through, same toolchain compiling
 * both. Every one of those is a place a vendored engine can be subtly wrong
 * while remaining perfectly correct upstream.
 *
 * The survivor half is the standing check. The attribution half — clashes and
 * severedCells — is what makes a consumer able to PRICE a turn rather than
 * just replay it: sever damage is invisible in a survivor list, and a mutual
 * annihilation is invisible to any pair-repair that matches deaths up by cell.
 *
 * `npx jest src/tests/partial-engine-differential.test.ts` is the one-command
 * check.
 *
 * Ported from packages/engine/src/partial-differential.test.ts.
 */

import { makeGrid, makeTerrain, newBoard, PartialEngine } from '../partial-engine/index';
import type { OracleCase } from './partial-engine-oracle';
import { engineOutcome, oracleOutcome, outcomeDiff, perimeter } from './partial-engine-oracle';

const W = 9;
const GRID = makeGrid(W, W);
const KINDS = [0, 1, 2, 3, 4, 5, 6];
const ORTHO = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
const HAZARD_DAMAGE = 100;
const MAX_HEALTH = 100;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A crowded 9x9: short trails, mixed pieces, a fifth of them a tier up, and
 * staged destinations that are only sometimes legal — because falling back to
 * the kind's own default identically is part of the agreement too.
 */
function buildCase(seed: number): OracleCase {
  const rnd = mulberry32(seed);
  const interior: number[] = [];
  for (let y = 1; y < W - 1; y++) for (let x = 1; x < W - 1; x++) interior.push(y * W + x);
  const used = new Set<number>();
  const take = (): number => {
    for (let i = 0; i < 300; i++) {
      const c = interior[(rnd() * interior.length) | 0] as number;
      if (!used.has(c)) {
        used.add(c);
        return c;
      }
    }
    return -1;
  };

  const units: OracleCase['units'] = [];
  const n = 2 + ((rnd() * 4) | 0);
  for (let i = 0; i < n; i++) {
    // Half trail units on purpose: a SEVER needs a strictly-higher-tier unit
    // to arrive on somebody's body, and a uniform kind draw almost never
    // produces one — 800 boards of it produced none at all.
    const kind = rnd() < 0.5 ? 0 : (KINDS[(rnd() * KINDS.length) | 0] as number);
    const head = take();
    if (head < 0) continue;
    const cells = [head];
    if (kind === 0) {
      const len = 2 + ((rnd() * 3) | 0);
      for (let j = 1; j < len; j++) {
        const prev = cells[j - 1] as number;
        const px = prev % W;
        const py = (prev / W) | 0;
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt++) {
          const d = ORTHO[(rnd() * 4) | 0] as readonly [number, number];
          const nx = px + d[0];
          const ny = py + d[1];
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= W - 1) continue;
          const c = ny * W + nx;
          if (used.has(c) || cells.includes(c)) continue;
          used.add(c);
          cells.push(c);
          placed = true;
        }
        if (!placed) break;
      }
    }
    const weight = kind === 0 ? cells.length : 1 + ((rnd() * 3) | 0);
    let orientation = (rnd() * 4) | 0;
    if (kind === 0 && cells.length >= 2) {
      // For a trail unit orientation IS head-minus-neck, physically.
      const hx = (cells[0] as number) % W;
      const hy = ((cells[0] as number) / W) | 0;
      const nx = (cells[1] as number) % W;
      const ny = ((cells[1] as number) / W) | 0;
      const dx = Math.sign(hx - nx);
      const dy = Math.sign(hy - ny);
      const found = ORTHO.findIndex((o) => o[0] === dx && o[1] === dy);
      orientation = found < 0 ? 0 : found;
    }
    units.push({
      unitId: i,
      kind,
      team: i % 2,
      cells,
      weight,
      health: 20 + ((rnd() * 80) | 0),
      tier: rnd() < 0.3 ? 1 : 0,
      orientation,
    });
  }

  const food: number[] = [];
  for (let i = 0; i < 2; i++) {
    if (rnd() < 0.6) {
      const c = take();
      if (c >= 0) food.push(c);
    }
  }
  const hazards: number[] = [];
  for (let i = 0; i < 2; i++) {
    if (rnd() < 0.3) {
      const c = take();
      if (c >= 0) hazards.push(c);
    }
  }

  const orders = new Map<number, number>();
  const pick = mulberry32(seed * 7919 + 3);
  for (const u of units) {
    if (pick() < 0.2) continue; // nothing staged: the kind's own default
    const cx = ((u.cells[0] as number) % W) + ((pick() * 5) | 0) - 2;
    const cy = (((u.cells[0] as number) / W) | 0) + ((pick() * 5) | 0) - 2;
    if (cx < 0 || cy < 0 || cx >= W || cy >= W) continue;
    orders.set(u.unitId, cy * W + cx);
  }
  return {
    width: W,
    height: W,
    units,
    food,
    hazards,
    hazardDamage: HAZARD_DAMAGE,
    maxHealth: MAX_HEALTH,
    orders,
  };
}

const SEEDS = 2000;

describe('the possibility-cloud engine agrees with this repo\'s vendored resolver', () => {
  test(`survivors, health, weight, deaths, clashes and severedCells over ${SEEDS} boards`, () => {
    const engine = new PartialEngine(
      makeTerrain(GRID, perimeter(W, W), []),
      { food: newBoard(GRID), potions: newBoard(GRID) },
      { maxUnits: 8, maxTrail: 16, hazardDamage: HAZARD_DAMAGE, maxHealth: MAX_HEALTH }
    );
    let compared = 0;
    let withDeaths = 0;
    let withSevers = 0;
    let withMutual = 0;
    let clashCount = 0;
    let withGrownPiece = 0;

    for (let seed = 1; seed <= SEEDS; seed++) {
      const tc = buildCase(seed);
      if (tc.units.length < 2) continue;
      // Hazards vary per board, so the terrain does; one engine per board would
      // be honest but slow, and hazards only ever cost health.
      const boardEngine = tc.hazards.length
        ? new PartialEngine(
            makeTerrain(GRID, perimeter(W, W), tc.hazards),
            { food: newBoard(GRID), potions: newBoard(GRID) },
            { maxUnits: 8, maxTrail: 16, hazardDamage: HAZARD_DAMAGE, maxHealth: MAX_HEALTH }
          )
        : engine;

      const truth = oracleOutcome(tc);
      const mine = engineOutcome(boardEngine, tc);
      compared++;

      const where = `seed ${seed}`;
      expect([where, outcomeDiff(truth, mine).join('; ')]).toEqual([where, '']);
      expect([where, [...mine.deaths.entries()].sort()]).toEqual([
        where,
        [...truth.deaths.entries()].sort(),
      ]);
      expect([where, mine.clashes]).toEqual([where, truth.clashes]);
      expect([where, [...mine.severedCells.entries()].sort()]).toEqual([
        where,
        [...truth.severedCells.entries()].sort(),
      ]);

      if (truth.deaths.size > 0) withDeaths++;
      if (truth.severedCells.size > 0) withSevers++;
      clashCount += truth.clashes.length;
      // A piece carrying weight > 1 is the board that separates a correct
      // weight-stack translation from one that silently drops it. Weight-1
      // pieces translate identically under both branches of the adapter.
      if (tc.units.some((u) => u.kind !== 0 && u.weight > 1)) withGrownPiece++;
      // A clash that killed two or more and left nobody standing: the mutual
      // annihilation a by-cell pair-repair cannot see.
      if (truth.clashes.some((c) => c.victimIDs.length >= 2 && c.survivorID === null)) {
        withMutual++;
      }
    }

    // Anti-vacuity: every coordinate this test claims to check must actually
    // have been exercised, or the agreement is about nothing.
    console.log(
      `differential: ${compared} boards, ${withDeaths} with a death, ${withSevers} with a sever, ` +
        `${withMutual} with a mutual annihilation, ${withGrownPiece} with a weight-stacked piece, ` +
        `${clashCount} typed events`
    );
    expect(compared).toBeGreaterThan(1800);
    expect(withDeaths).toBeGreaterThan(400);
    expect(withSevers).toBeGreaterThan(5);
    expect(withMutual).toBeGreaterThan(0);
    expect(withGrownPiece).toBeGreaterThan(400);
    expect(clashCount).toBeGreaterThan(500);
  });

  test('a mutual annihilation is reported as one, on both sides', () => {
    // Equal tier, equal weight, one cell: nobody is the unique strict maximum,
    // so both die and the record withdraws its survivor. A consumer repairing
    // a pair by matching one death against a survivor at the same cell finds
    // no survivor to match — which is exactly the fact it needs.
    const tc: OracleCase = {
      width: W,
      height: W,
      units: [
        {
          unitId: 0,
          kind: 2,
          team: 0,
          cells: [4 * W + 3],
          weight: 2,
          health: 40,
          tier: 0,
          orientation: 1,
        },
        {
          unitId: 1,
          kind: 2,
          team: 1,
          cells: [4 * W + 5],
          weight: 2,
          health: 40,
          tier: 0,
          orientation: 3,
        },
      ],
      food: [],
      hazards: [],
      hazardDamage: HAZARD_DAMAGE,
      maxHealth: MAX_HEALTH,
      orders: new Map([
        [0, 4 * W + 4],
        [1, 4 * W + 4],
      ]),
    };
    const engine = new PartialEngine(
      makeTerrain(GRID, perimeter(W, W), []),
      { food: newBoard(GRID), potions: newBoard(GRID) },
      { maxUnits: 8, maxTrail: 16, hazardDamage: HAZARD_DAMAGE, maxHealth: MAX_HEALTH }
    );
    const truth = oracleOutcome(tc);
    const mine = engineOutcome(engine, tc);

    expect(truth.survivors.size).toBe(0);
    expect(mine.clashes).toEqual(truth.clashes);
    const contest = mine.clashes.find((c) => c.kind === 'contest');
    expect(contest?.victimIDs).toEqual([0, 1]);
    expect(contest?.survivorID).toBeNull();
    expect(contest?.reason).toBe('Deadlock: no unique survivor');
    expect([...mine.deaths.keys()].sort()).toEqual([0, 1]);
  });

  test('a sever reports the cells it actually cut, and the owner lives', () => {
    const tc: OracleCase = {
      width: W,
      height: W,
      units: [
        {
          unitId: 0,
          kind: 0,
          team: 0,
          cells: [2 * W + 2, 3 * W + 2, 4 * W + 2, 5 * W + 2],
          weight: 4,
          health: 40,
          tier: 0,
          orientation: 0,
        },
        {
          unitId: 1,
          kind: 3,
          team: 1,
          cells: [4 * W + 7],
          weight: 1,
          health: 40,
          tier: 1,
          orientation: 3,
        },
      ],
      food: [],
      hazards: [],
      hazardDamage: HAZARD_DAMAGE,
      maxHealth: MAX_HEALTH,
      orders: new Map([[1, 4 * W + 2]]),
    };
    const engine = new PartialEngine(
      makeTerrain(GRID, perimeter(W, W), []),
      { food: newBoard(GRID), potions: newBoard(GRID) },
      { maxUnits: 8, maxTrail: 16, hazardDamage: HAZARD_DAMAGE, maxHealth: MAX_HEALTH }
    );
    const truth = oracleOutcome(tc);
    const mine = engineOutcome(engine, tc);
    expect(outcomeDiff(truth, mine).join('; ')).toBe('');
    expect([...mine.severedCells.entries()]).toEqual([...truth.severedCells.entries()]);
    expect(mine.severedCells.get(0)?.length).toBeGreaterThan(0);
    expect(mine.clashes.some((c) => c.kind === 'sever' && c.victimIDs.length === 0)).toBe(true);
    // Non-fatal: the owner is short a segment, not dead.
    expect(mine.survivors.has(0)).toBe(true);
  });
});
