/**
 * MINIMAL REPRO: a snake that has just eaten breaks the bound bank's floor.
 *
 * The vendored resolver represents growth by DUPLICATING the last occupancy
 * cell (`resolveTurn.ts:215`), so a snake that ate last turn arrives with an
 * occupancy one longer than its footprint. That is not an exotic board — it is
 * what every fed snake looks like, and the api `Board` carries it verbatim
 * (`Simulator`/this harness both map `settled.occupancy` straight across).
 *
 * Two boards, identical apart from that one cell:
 *
 *   FED   blue snake occupancy [ (2,2) (2,3) (1,3) (1,3) ]  weight 4, 3 cells
 *   GROWN blue snake occupancy [ (2,2) (2,3) (1,3) (0,3) ]  weight 4, 4 cells
 *
 * For every joint plan blue could stage, the bank's bracket is compared with
 * the exhaustive truth (`worldsOf` + the shipped evaluator). Run:
 *
 *   node .bench-dist/bench/prod/repeated-tail.js
 */

import type { Board, Coord, Snake } from '../../src/types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
import { BoundBank, DEFAULT_BANK_CONFIG, type BankConfig } from '../../src/lobster/bounds/bank';
import { truthOf, planOf } from './truth';
import { marshalBoard } from '../../src/logic/turn-oracle';
import { planUnitAction } from '../../src/engine-vendor/engine/moveGrammar';
import type { UnitType } from '../../src/engine-vendor/shared/types/Game';
import { resolveFullTurn, standings } from './sim';

const budget = {
  shouldStop: (): boolean => false,
  remainingMs: (): number => 1e9,
  elapsedMs: (): number => 0,
  now: (): number => Date.now(),
};

const cell = (x: number, y: number): Coord => ({ x, y });

function snake(id: string, team: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  const head = body[0] as Coord;
  const mid = body[1] ?? head;
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: { ...head },
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#fff', head: 'default', tail: 'default' },
    teamID: team,
    orientation: { dx: head.x - mid.x, dy: -(head.y - mid.y) },
    ...extra,
  } as Snake;
}

function boardWith(blueTail: Coord): Board {
  return {
    width: 7,
    height: 7,
    food: [cell(5, 4)],
    hazards: [],
    snakes: [
      snake('r0', 'red', [cell(4, 2)], { unitType: 'king', length: 1, orientation: { dx: 0, dy: -1 } }),
      snake('r1', 'red', [cell(2, 0), cell(2, 1), cell(3, 1)]),
      snake('b0', 'blue', [cell(0, 6)], { unitType: 'king', length: 1, orientation: { dx: 0, dy: 1 } }),
      snake('b1', 'blue', [cell(2, 2), cell(2, 3), cell(1, 3), blueTail]),
    ],
  } as Board;
}

interface Row {
  plans: number;
  threw: number;
  floorAboveTruth: number;
  worstFloorExcess: number;
  ceilingBelowFiniteTruth: number;
  ceilingBelowWin: number;
  example: string | null;
}

function scan(board: Board, turn: number, team: string, cfg: Partial<BankConfig>): Row {
  const ourIds = (board.snakes ?? []).filter((s) => s.teamID === team).map((s) => s.id);
  const sub = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds });
  const row: Row = {
    plans: 0,
    threw: 0,
    floorAboveTruth: 0,
    worstFloorExcess: 0,
    ceilingBelowFiniteTruth: 0,
    ceilingBelowWin: 0,
    example: null,
  };
  try {
    const asTeam = sub.teamNumber(team);
    let ours: Array<Map<string, number>> = [new Map()];
    for (const wireId of ourIds) {
      const unit = sub.unitOfWireId(wireId);
      if (unit === undefined) continue;
      const next: Array<Map<string, number>> = [];
      for (const partial of ours) {
        for (const a of sub.actionsOf(unit.unitId)) {
          const m = new Map(partial);
          m.set(wireId, a.to);
          next.push(m);
        }
      }
      ours = next;
    }
    for (const orders of ours) {
      row.plans++;
      const truth = truthOf(board, turn, team, orders, materialEvaluator, 4000);
      const bank = new BoundBank({
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: materialEvaluator,
        asTeam,
        budget,
        basis: [],
        config: { ...DEFAULT_BANK_CONFIG, ...cfg },
      });
      try {
        const priced = bank.price(planOf(sub, orders));
        if (priced.bounds.worst > truth.lo + 1e-6) {
          row.floorAboveTruth++;
          row.worstFloorExcess = Math.max(row.worstFloorExcess, priced.bounds.worst - truth.lo);
          if (row.example === null) {
            row.example = `orders=${JSON.stringify(Object.fromEntries(orders))} bracket=[${priced.bounds.worst}, ${priced.bounds.best}] truth=[${truth.lo}, ${truth.hi}] members=${JSON.stringify(priced.members)}`;
          }
        }
        if (priced.bounds.best < truth.hi - 1e-6) {
          if (Number.isFinite(truth.hi)) row.ceilingBelowFiniteTruth++;
          else row.ceilingBelowWin++;
        }
      } catch (err) {
        row.threw++;
        if (row.example === null) {
          const e = err as { message?: string };
          row.example = `orders=${JSON.stringify(Object.fromEntries(orders))} THREW ${e.message} truth=[${truth.lo}, ${truth.hi}]`;
        }
      } finally {
        bank.release();
      }
    }
  } finally {
    sub.release();
    clearGeometryCache();
  }
  return row;
}

/**
 * The same question asked of the VENDORED resolver instead of the partial
 * engine: enumerate every completion of the units we do not command through
 * the server's own grammar, resolve the determinate turn with `resolveTurn`,
 * and read the material margin off the settled board. If this agrees with
 * `truthOf`, the finding is about the bound, not about the partial engine's
 * fidelity — the differential suite already covers the latter.
 */
function vendorTruth(
  board: Board,
  turn: number,
  team: string,
  orders: ReadonlyMap<string, number>
): { lo: number; hi: number; worlds: number; worst: string } {
  const marshalled = marshalBoard(board, turn);
  const pawnTargets = new Set<number>(marshalled.config.food);
  for (const u of marshalled.units) for (const c of u.occupancy) pawnTargets.add(c);
  const W = marshalled.fullWidth;
  const H = marshalled.fullHeight;
  const others = marshalled.units.filter((u) => !orders.has(u.id));
  let combos: Array<Map<string, number>> = [new Map(orders)];
  for (const u of others) {
    const origin = u.occupancy[0] as number;
    const opts: number[] = [];
    for (let c = 0; c < W * H; c++) {
      const a = planUnitAction(u.type as UnitType, origin, c, W, H, u.orientation, pawnTargets);
      if (a !== null) opts.push(c);
    }
    const next: Array<Map<string, number>> = [];
    for (const partial of combos) {
      for (const c of opts) {
        const m = new Map(partial);
        m.set(u.id, c);
        next.push(m);
      }
    }
    combos = next;
  }
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  let worst = '';
  for (const staged of combos) {
    const out = resolveFullTurn(board, turn, staged as Map<string, number>);
    const rows = standings(out.board);
    const ours = rows.find((r) => r.teamID === team)?.material ?? 0;
    const theirs = rows.filter((r) => r.teamID !== team).reduce((n, r) => n + r.material, 0);
    // Material weight is 10 in the shipped profile, so one unit of material is
    // 10 points — the same scale the bank prints.
    const v = ours === 0 ? Number.NEGATIVE_INFINITY : theirs === 0 ? Number.POSITIVE_INFINITY : (ours - theirs) * 10;
    if (v < lo) {
      const cells = (id: string): string => {
        const c = staged.get(id);
        if (c === undefined) return 'default';
        const a = marshalled.toCell(c);
        return `(${a.x},${a.y})`;
      };
      worst =
        [...staged.keys()].map((id) => `${id}->${cells(id)}`).join(' ') +
        `  => survivors ${out.board.snakes.map((sn) => `${sn.id}:${sn.length}`).join(' ')}` +
        `  dead ${[...out.dead].join(',') || 'none'}` +
        `  clashes ${out.clashes}`;
    }
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return { lo, hi, worlds: combos.length, worst };
}

function main(): void {
  const cases: Array<{ name: string; board: Board }> = [
    { name: 'FED   (repeated tail cell — a snake that just ate)', board: boardWith(cell(1, 3)) },
    { name: 'GROWN (four distinct cells, same weight)', board: boardWith(cell(0, 3)) },
  ];
  const configs: Array<{ name: string; cfg: Partial<BankConfig> }> = [
    { name: 'shipped-default', cfg: {} },
    { name: 'B0-only', cfg: { b1: false, b2: false, b3: false } },
  ];
  console.log('# REPEATED-TAIL REPRO — bank bracket vs exhaustive truth, 7x7, turn 3, team blue');
  for (const c of cases) {
    console.log(`\n## ${c.name}`);
    for (const cfg of configs) {
      const r = scan(c.board, 3, 'blue', cfg.cfg);
      console.log(
        `  ${cfg.name.padEnd(16)} plans=${r.plans} threw=${r.threw} ` +
          `floorAboveTruth=${r.floorAboveTruth} (worst excess ${r.worstFloorExcess}) ` +
          `ceilingBelowFiniteTruth=${r.ceilingBelowFiniteTruth} ceilingBelowWIN=${r.ceilingBelowWin}`
      );
      if (r.example !== null) console.log(`      first: ${r.example}`);
    }
    // Cross-check the offending plan against the VENDORED resolver.
    const orders = new Map<string, number>([
      ['b0', 10],
      ['b1', 57],
    ]);
    const vt = vendorTruth(c.board, 3, 'blue', orders);
    console.log(
      `  vendored-resolver truth for orders={"b0":10,"b1":57}: [${vt.lo}, ${vt.hi}] over ${vt.worlds} worlds`
    );
    console.log(`      argmin world: ${vt.worst}`);
  }
}

main();
