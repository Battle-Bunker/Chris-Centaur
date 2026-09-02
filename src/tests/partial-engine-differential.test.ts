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
 * ── AND THE ORACLE IS NOW SETTLEMENT ──────────────────────────────────────
 *
 * The oracle used to be `resolveTurn`, which stops at the board half. Four
 * rules live past it — potion collection, effect expiry, the ally-buff cancel
 * and tier settlement — and this repo's consumer reads all of them off
 * `settleTurn` on every candidate move it prices, so leaving them out of the
 * differential left the only rules a client is REQUIRED not to re-derive
 * (VENDOR.md) as the only rules nothing executed.
 *
 * Two seeded sets now run:
 *
 *   · seeds 1..2000, the standing set, board-for-board identical to what it
 *     always was (the counters below are the proof), now settled rather than
 *     merely resolved — so settlement is shown INERT on a board that gives it
 *     nothing to do, which is the control the potion set is read against;
 *   · seeds 1..1200 of `buildPotionCase`, a separately-seeded stream that adds
 *     potions, a turn number, a pickup window and opening buffs and debuffs
 *     whose levels sum to each unit's tier.
 *
 * `npx jest src/tests/partial-engine-differential.test.ts` is the one-command
 * check.
 *
 * Ported from packages/engine/src/partial-differential.test.ts.
 */

import { resolveTurn } from '../engine-vendor/engine/resolveTurn';
import { makeGrid, makeTerrain, newBoard, PartialEngine } from '../partial-engine/index';
import { HAZARD_DAMAGE, MAX_HEALTH, W, buildCase, buildPotionCase } from './partial-engine-boards';
import type { OracleCase } from './partial-engine-oracle';
import {
  engineOutcome,
  oracleInput,
  oracleOutcome,
  oracleSettlement,
  outcomeDiff,
  perimeter,
  settlementDiff,
} from './partial-engine-oracle';

const GRID = makeGrid(W, W);

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

      const { outcome: truth, settlement } = oracleSettlement(tc);
      const mine = engineOutcome(boardEngine, tc);
      compared++;

      const where = `seed ${seed}`;
      expect([where, outcomeDiff(truth, mine).join('; ')]).toEqual([where, '']);
      // Settlement on a board that gives it nothing to do: the CONTROL for the
      // potion set below. Every tier must come out as it went in and the
      // schedule must be untouched — law 5 in partial-engine-oracle.ts.
      expect([where, settlementDiff(tc, settlement, mine).join('; ')]).toEqual([where, '']);
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

// ---------------------------------------------------------------------------
// The settlement set: potions, windows, and opening effects
// ---------------------------------------------------------------------------

const POTION_SEEDS = 1200;

describe('settlement: potion collection, expiry, the ally cancel and tiers', () => {
  test(`the board half and all three settlement coordinates over ${POTION_SEEDS} boards`, () => {
    let compared = 0;
    let withPotions = 0;
    let withCollection = 0;
    let withAllyBuff = 0;
    let withCancel = 0;
    let withCancelFired = 0;
    let withExpiry = 0;
    let withNegativeTier = 0;
    let withDeaths = 0;

    for (let seed = 1; seed <= POTION_SEEDS; seed++) {
      const tc = buildPotionCase(seed);
      if (tc.units.length < 2) continue;
      const boardEngine = new PartialEngine(
        makeTerrain(GRID, perimeter(W, W), tc.hazards),
        { food: newBoard(GRID), potions: newBoard(GRID) },
        { maxUnits: 8, maxTrail: 16, hazardDamage: HAZARD_DAMAGE, maxHealth: MAX_HEALTH }
      );
      const { outcome: truth, settlement } = oracleSettlement(tc);
      const mine = engineOutcome(boardEngine, tc);
      compared++;

      const where = `potion seed ${seed}`;
      // The board half still agrees, coordinate for coordinate, on a board
      // carrying potions and non-zero tiers — which is where a tier the two
      // encodings disagree about would show up first, since the contest is
      // ordered on tier before anything else (turnEngine.ts strictMaximum).
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
      // And the settlement coordinates, against the laws that do not restate
      // the pickup arithmetic.
      expect([where, settlementDiff(tc, settlement, mine).join('; ')]).toEqual([where, '']);

      const potions = tc.potions ?? [];
      if (potions.length > 0) withPotions++;
      if (potions.length > (settlement.potions.length as number)) withCollection++;
      if (settlement.effects.some((e) => e.kind === 'buff' && e.sourceId !== e.unitId)) {
        withAllyBuff++;
      }
      if (settlement.vulnerableCollided.length > 0) withCancel++;
      // The ally-buff cancel ACTUALLY FIRING: a teammate's buff that was on
      // the board when the turn opened and is gone now, on a team where
      // somebody collided vulnerable. Counted rather than asserted per board,
      // because whether the rule fires is settlement's answer, not ours.
      const bereaved = new Set(
        settlement.vulnerableCollided.map((id) => tc.units.find((u) => u.unitId === id)?.team)
      );
      const survived = new Set(
        settlement.effects.map((e) => `${e.unitId}:${e.kind}:${e.level}:${e.expiryTurn}`)
      );
      const cancelled = (tc.effects ?? []).some((e) => {
        if (e.type !== 'invulnerability_buff') return false;
        const owner = Number.parseInt(e.playerID.slice(1), 10);
        if (settlement.vulnerableCollided.includes(owner)) return false;
        const team = tc.units.find((u) => u.unitId === owner)?.team;
        if (!bereaved.has(team)) return false;
        return (
          truth.survivors.has(owner) &&
          !survived.has(`${owner}:buff:${e.level}:${e.expiryTurn}`)
        );
      });
      if (cancelled) withCancelFired++;
      if ((tc.effects ?? []).some((e) => e.expiryTurn <= (tc.turn ?? 0))) withExpiry++;
      if (tc.units.some((u) => u.tier < 0)) withNegativeTier++;
      if (truth.deaths.size > 0) withDeaths++;
    }

    console.log(
      `settlement: ${compared} boards, ${withPotions} with a potion, ${withCollection} with a ` +
        `collection, ${withAllyBuff} with an ally buff issued, ${withCancel} with a vulnerable ` +
        `collision (${withCancelFired} cancelling an ally buff), ${withExpiry} with an effect due this turn, ${withNegativeTier} with a ` +
        `negative tier, ${withDeaths} with a death`
    );
    // Anti-vacuity: a settlement suite whose boards never collect a potion or
    // expire an effect is a suite about nothing at all.
    expect(compared).toBeGreaterThan(1000);
    expect(withCollection).toBeGreaterThan(20);
    expect(withAllyBuff).toBeGreaterThan(5);
    expect(withExpiry).toBeGreaterThan(200);
    expect(withNegativeTier).toBeGreaterThan(200);
    expect(withCancel).toBeGreaterThan(0);
    expect(withCancelFired).toBeGreaterThan(0);
    expect(withDeaths).toBeGreaterThan(200);
  });

  test('settlement never moves the board half', () => {
    // The substitution this whole change rests on: `settleTurn` is
    // `resolveTurn` plus bookkeeping, so switching the oracle cannot silently
    // have moved a survivor. Checked on the boards where it has the most to do.
    let compared = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const tc = buildPotionCase(seed);
      if (tc.units.length < 2) continue;
      const input = oracleInput(tc);
      const board = resolveTurn(input);
      const { settled } = oracleSettlement(tc);
      compared++;
      const where = `potion seed ${seed}`;
      expect([where, settled.board]).toEqual([where, board.board]);
      expect([where, settled.deaths]).toEqual([where, board.deaths]);
      expect([where, settled.clashes]).toEqual([where, board.clashes]);
      expect([where, settled.severedCells]).toEqual([where, board.severedCells]);
      expect([where, settled.food]).toEqual([where, board.food]);
    }
    expect(compared).toBeGreaterThan(350);
  });
});
