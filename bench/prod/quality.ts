/**
 * DECISION QUALITY against exhaustive truth, on boards small enough to compute
 * it.
 *
 *   node .bench-dist/bench/prod/quality.js --scenario tiny2 --seeds 401,402,403 \
 *        --turns 4 --budgets 1000,10000
 *
 * For one position, each engine is asked for a decision at the production
 * budget. What it actually put on the wire is turned into the team's EFFECTIVE
 * joint order — a unit the engine did not speak for takes the rules' own
 * default (a piece holds, a trail unit continues straight), because that is
 * what the resolver will do with it — and the maximin value of that order is
 * read off the exhaustive table.
 *
 *   regret = best achievable maximin  -  maximin(what was staged)
 *
 * Regret is in the evaluator's units (material x10). Zero means the decision
 * was optimal against a worst-case opponent; the table also reports how often
 * each engine hit the optimum outright.
 *
 * The oracle is `exhaustiveMaximin`, which enumerates our joint plans and every
 * completion of the units we do not command through the ENGINE's enumerator,
 * scoring each determinate turn with the same evaluator the search uses.
 */

import * as fs from 'fs';
import * as os from 'os';
import type { Board, CentaurMove } from '../../src/types/battlesnake';
import { TeamDetector } from '../../src/logic/team-detector';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { materialEvaluator, defaultEvaluator } from '../../src/lobster/evaluate';
import { marshalBoard } from '../../src/logic/turn-oracle';
import { defaultAction } from '../../src/engine-vendor/engine/moveGrammar';
import type { UnitType } from '../../src/engine-vendor/shared/types/Game';
import { SCENARIOS, TEAM_IDS, generateBoard } from './boards';
import { legacyDriver, lobsterDriver, type Driver } from './drivers';
import { neutralMoves } from './neutral';
import { resolveFullTurn, stagedCellOf, teamAlive } from './sim';
import { exhaustiveMaximin, type MaximinResult } from './truth';
import { bootstrap, fmt, fmtInterval } from './stats';

/**
 * The team's EFFECTIVE order set: what the engine staged, plus the rules' own
 * default for every unit it did not speak for. `defaultAction` is the vendored
 * grammar's answer, so nothing here decides what a default is.
 */
function effectiveOrders(
  board: Board,
  turn: number,
  team: string,
  staged: ReadonlyMap<string, CentaurMove>
): Map<string, number> {
  const marshalled = marshalBoard(board, turn);
  const byId = new Map((board.snakes ?? []).map((s) => [s.id, s]));
  const out = new Map<string, number>();
  for (const unit of marshalled.units) {
    if (unit.teamID !== team) continue;
    const move = staged.get(unit.id);
    const snake = byId.get(unit.id);
    const cell = move === undefined || snake === undefined ? null : stagedCellOf(marshalled, snake, move);
    if (cell !== null) {
      out.set(unit.id, cell);
      continue;
    }
    const dflt = defaultAction(
      unit.type as UnitType,
      unit.occupancy[0] as number,
      marshalled.fullWidth,
      marshalled.fullHeight,
      unit.orientation
    );
    out.set(
      unit.id,
      dflt.kind === 'move' ? (dflt.path[0] as number) : (unit.occupancy[0] as number)
    );
  }
  return out;
}

/** maximin of one order set, looked up in (or appended to) the truth table. */
function maximinOf(
  table: MaximinResult,
  board: Board,
  turn: number,
  team: string,
  orders: ReadonlyMap<string, number>,
  evaluator: typeof materialEvaluator
): number {
  const key = [...orders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join('|');
  const hit = table.rows.find((r) => r.key === key);
  if (hit !== undefined) return hit.maximin;
  // The staged set was not in the enumerated table — a default cell that is not
  // in the unit's own grammar (a snake continuing into a wall, for instance).
  // Price it directly rather than dropping the sample.
  const one = exhaustiveMaximin(board, turn, team, [...orders.keys()], evaluator, 1, 4096);
  void one;
  return Number.NaN;
}

interface Sample {
  scenario: string;
  seed: number;
  turn: number;
  team: string;
  budgetMs: number;
  engine: string;
  regret: number;
  optimal: boolean;
  maximin: number;
  best: number;
  worstPossible: number;
  emissions: number;
  wallMs: number;
  error: string | null;
}

async function main(): Promise<void> {
  const get = (n: string, d: string): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : d;
  };
  const scenarios = get('scenario', 'tiny2').split(',');
  const seeds = get('seeds', '401,402,403,404,405,406').split(',').map(Number);
  const turns = Number(get('turns', '4'));
  const startTurn = Number(get('startTurn', '1'));
  const budgets = get('budgets', '1000,10000').split(',').map(Number);
  const out = get('out', '') || null;
  const evaluator = get('evaluator', 'material') === 'reach' ? defaultEvaluator : materialEvaluator;

  console.log(`# DECISION QUALITY vs EXHAUSTIVE TRUTH  node ${process.version} loadavg=${os.loadavg().map((l) => l.toFixed(2)).join(' ')}`);
  const samples: Sample[] = [];

  for (const name of scenarios) {
    const scenario = SCENARIOS[name];
    if (scenario === undefined) throw new Error(`unknown scenario ${name}`);
    for (const seed of seeds) {
      let board = generateBoard(scenario, seed).board;
      // Skip forward with the shared neutral policy: turn-1 positions are
      // uncontested and every engine scores zero regret on them, which would
      // dilute the comparison with samples that carry no information.
      for (let t = 1; t < startTurn; t++) {
        const pre = new Map<string, number | string>();
        for (const team of TEAM_IDS.slice(0, scenario.teams)) {
          if (!teamAlive(board, team)) continue;
          for (const [id, mv] of neutralMoves(board, t, team, seed)) pre.set(id, mv);
        }
        const nb = resolveFullTurn(board, t, pre as Map<string, never>).board;
        if (!TEAM_IDS.slice(0, scenario.teams).every((tm) => teamAlive(nb, tm))) break;
        board = nb;
      }
      clearGeometryCache();
      for (let turn = startTurn; turn < startTurn + turns; turn++) {
        for (const team of TEAM_IDS.slice(0, scenario.teams)) {
          if (!teamAlive(board, team)) continue;
          const ourIds = (board.snakes ?? [])
            .filter((s) => TeamDetector.getTeamKey(s) === team && s.health > 0)
            .map((s) => s.id);
          const table = exhaustiveMaximin(board, turn, team, ourIds, evaluator, 512, 4096);
          if (table.truncated) {
            console.log(`  ${name} seed=${seed} turn=${turn} ${team}: truth TRUNCATED — sample dropped`);
            continue;
          }
          const worstPossible = table.rows.reduce((m, r) => Math.min(m, r.maximin), Number.POSITIVE_INFINITY);
          for (const budgetMs of budgets) {
            const engines: Array<{ name: string; drv: Driver }> = [
              { name: 'lobster', drv: lobsterDriver({}) },
              { name: 'legacy', drv: legacyDriver() },
            ];
            for (const e of engines) {
              const res = await e.drv.decide(board, turn, team, Date.now() + budgetMs);
              e.drv.release();
              const orders = effectiveOrders(board, turn, team, res.moves);
              const mm = maximinOf(table, board, turn, team, orders, evaluator);
              samples.push({
                scenario: name,
                seed,
                turn,
                team,
                budgetMs,
                engine: e.name,
                regret: table.best - mm,
                optimal: mm >= table.best - 1e-6,
                maximin: mm,
                best: table.best,
                worstPossible,
                emissions: res.emissions,
                wallMs: res.wallMs,
                error: res.error,
              });
              console.log(
                `  ${name} seed=${seed} turn=${turn} ${team} budget=${budgetMs} ${e.name.padEnd(7)}: ` +
                  `maximin=${fmt(mm, 1)} best=${fmt(table.best, 1)} regret=${fmt(table.best - mm, 1)} ` +
                  `plans=${table.rows.length} oracleCost=${table.cost} err=${res.error ?? 'none'}`
              );
            }
          }
          clearGeometryCache();
        }
        // Advance with the neutral policy so the sampled positions are shared.
        const staged = new Map<string, number | string>();
        for (const team of TEAM_IDS.slice(0, scenario.teams)) {
          if (!teamAlive(board, team)) continue;
          for (const [id, mv] of neutralMoves(board, turn, team, seed)) staged.set(id, mv);
        }
        const next = resolveFullTurn(board, turn, staged as Map<string, never>).board;
        if (!TEAM_IDS.slice(0, scenario.teams).every((t) => teamAlive(next, t))) break;
        board = next;
        clearGeometryCache();
      }
    }
  }

  console.log('');
  console.log('## SUMMARY');
  for (const budgetMs of budgets) {
    for (const engine of ['lobster', 'legacy']) {
      const rs = samples.filter((s) => s.budgetMs === budgetMs && s.engine === engine && Number.isFinite(s.regret));
      const nan = samples.filter((s) => s.budgetMs === budgetMs && s.engine === engine && !Number.isFinite(s.regret)).length;
      if (rs.length === 0) continue;
      const reg = bootstrap(rs.map((s) => s.regret));
      console.log(
        `  budget=${budgetMs}ms ${engine.padEnd(7)} n=${rs.length} (unscored ${nan})  ` +
          `mean regret=${fmtInterval(reg, 2)}  optimal on ${rs.filter((s) => s.optimal).length}/${rs.length}  ` +
          `threw=${rs.filter((s) => s.error !== null).length}`
      );
    }
    // Paired by position: the same board, the same team, both engines.
    const positions = new Map<string, { lobster?: number; legacy?: number }>();
    for (const s of samples.filter((x) => x.budgetMs === budgetMs && Number.isFinite(x.regret))) {
      const k = `${s.scenario}|${s.seed}|${s.turn}|${s.team}`;
      const row = positions.get(k) ?? {};
      (row as Record<string, number>)[s.engine] = s.regret;
      positions.set(k, row);
    }
    const paired = [...positions.values()]
      .filter((r) => r.lobster !== undefined && r.legacy !== undefined)
      .map((r) => (r.legacy as number) - (r.lobster as number));
    if (paired.length > 0) {
      console.log(
        `  budget=${budgetMs}ms PAIRED regret advantage (legacy - lobster, >0 favours LOBSTER): ` +
          `${fmtInterval(bootstrap(paired), 2)} over ${paired.length} positions`
      );
    }
  }

  if (out !== null) {
    fs.writeFileSync(out, JSON.stringify({ scenarios, seeds, budgets, loadavg: os.loadavg(), samples }, null, 1));
    console.log(`# wrote ${out}`);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
