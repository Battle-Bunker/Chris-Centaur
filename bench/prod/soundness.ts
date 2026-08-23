/**
 * BANK-VS-TRUTH on real boards.
 *
 * The lane suites checked the bracket against exhaustive truth on generated
 * fixtures. This checks it on the boards a MATCH actually reaches — which
 * differ from fixtures in one structural way that turns out to matter: a snake
 * that has eaten carries a REPEATED tail cell, so its occupancy length exceeds
 * its footprint.
 *
 * For every joint plan our team could stage (from the engine's own enumerator,
 * capped), it prices the plan with the bound bank and compares the bracket
 * against `truthOf` — the min and max of the determinate value over every
 * completion of the units we do not command. A sound bracket satisfies
 * worst <= min(truth) and best >= max(truth). Anything else is reported with
 * the plan that produced it.
 *
 *   node .bench-dist/bench/prod/soundness.js --scenario tiny2 --seeds 1,2,3 \
 *        --turns 6 --planCap 64
 */

import * as fs from 'fs';
import type { Board } from '../../src/types/battlesnake';
import type { Candidate, JointPlan, UnitId } from '../../src/lobster/contracts';
import { TeamDetector } from '../../src/logic/team-detector';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator, defaultEvaluator } from '../../src/lobster/evaluate';
import { BoundBank, DEFAULT_BANK_CONFIG, type BankConfig } from '../../src/lobster/bounds/bank';
import { checkSoundness } from '../../src/lobster/evaluate';
import { SCENARIOS, TEAM_IDS, generateBoard } from './boards';
import { neutralMoves } from './neutral';
import { resolveFullTurn, teamAlive } from './sim';
import { truthOf } from './truth';

const budget = {
  shouldStop: (): boolean => false,
  remainingMs: (): number => 1e9,
  elapsedMs: (): number => 0,
  now: (): number => Date.now(),
};

export interface Violation {
  readonly board: Board;
  readonly turn: number;
  readonly team: string;
  readonly orders: Record<string, number>;
  readonly worst: number;
  readonly best: number;
  readonly truthLo: number;
  readonly truthHi: number;
  readonly kind: 'floor-above-truth' | 'ceiling-below-truth' | 'inverted' | 'threw';
  readonly note: string;
  readonly members: unknown;
  readonly config: string;
}

export interface ScanStats {
  plans: number;
  priced: number;
  threw: number;
  floorAbove: number;
  /** Floor above a FINITE truth minimum — never explainable by a sentinel. */
  floorAboveFinite: number;
  ceilingBelow: number;
  /** Ceiling below a FINITE truth maximum — never the WIN sentinel. */
  ceilingBelowFinite: number;
  /** Ceiling below truth only because some world WINS (+Infinity). */
  ceilingBelowWin: number;
  inverted: number;
  worldsTruncated: number;
  /** The repo's own R1 harness (checkSoundness) on the same case. */
  r1Cases: number;
  r1Violations: number;
}

function planOf(
  sub: ReturnType<typeof makeSubstrate>,
  orders: ReadonlyMap<string, number>
): JointPlan {
  const plan = new Map<UnitId, Candidate>();
  for (const [wireId, to] of orders) {
    const unit = sub.unitOfWireId(wireId);
    if (unit === undefined) continue;
    const cand: Candidate = {
      unitId: unit.unitId,
      from: unit.cells[0] as number,
      to,
      path: sub.pathFor(unit.unitId, to) ?? [],
    };
    plan.set(unit.unitId, cand);
  }
  return plan;
}

/** Scan one board/team under one bank configuration. */
export function scanBoard(
  board: Board,
  turn: number,
  team: string,
  cfg: Partial<BankConfig>,
  cfgName: string,
  evaluator: typeof materialEvaluator,
  planCap: number,
  worldCap: number,
  stats: ScanStats,
  out: Violation[]
): void {
  const ourIds = (board.snakes ?? [])
    .filter((s) => TeamDetector.getTeamKey(s) === team && s.health > 0 && s.body.length > 0)
    .map((s) => s.id);
  if (ourIds.length === 0) return;
  const sub = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds });
  try {
    const asTeam = sub.teamNumber(team);
    let ours: Array<Map<string, number>> = [new Map()];
    for (const wireId of ourIds) {
      const unit = sub.unitOfWireId(wireId);
      if (unit === undefined) continue;
      const actions = sub.actionsOf(unit.unitId);
      const next: Array<Map<string, number>> = [];
      let full = false;
      for (const partial of ours) {
        for (const a of actions) {
          if (next.length >= planCap) {
            full = true;
            break;
          }
          const m = new Map(partial);
          m.set(wireId, a.to);
          next.push(m);
        }
        if (full) break;
      }
      ours = next;
    }

    // The repo's OWN R1 harness on the first plan of this board/team: if the
    // shipped law harness agrees, the finding is not an artefact of this file.
    const first = ours[0];
    if (first !== undefined) {
      const r1 = checkSoundness(evaluator, {
        name: 'scan',
        board,
        turn,
        asTeam: team,
        stages: [...first.keys()],
        orders: first,
      }, worldCap);
      stats.r1Cases++;
      stats.r1Violations += r1.violations.length;
      if (r1.violations.length > 0 && out.length < 400) {
        out.push({
          board,
          turn,
          team,
          orders: Object.fromEntries(first),
          worst: NaN,
          best: NaN,
          truthLo: NaN,
          truthHi: NaN,
          kind: 'threw',
          note: `checkSoundness(R1): ${r1.violations.slice(0, 3).join(' ; ')}`,
          members: null,
          config: `${cfgName}/R1`,
        });
      }
    }

    for (const orders of ours) {
      stats.plans++;
      const plan = planOf(sub, orders);
      const truth = truthOf(board, turn, team, orders, evaluator, worldCap);
      if (truth.truncated) stats.worldsTruncated++;
      const bank = new BoundBank({
        sub,
        gen: new GrammarCandidateGenerator(),
        evaluate: evaluator,
        asTeam,
        budget,
        basis: [],
        config: { ...DEFAULT_BANK_CONFIG, ...cfg },
      });
      try {
        const priced = bank.price(plan);
        stats.priced++;
        const worst = priced.bounds.worst;
        const best = priced.bounds.best;
        const rec = {
          board,
          turn,
          team,
          orders: Object.fromEntries(orders),
          worst,
          best,
          truthLo: truth.lo,
          truthHi: truth.hi,
          members: priced.members,
          config: cfgName,
        };
        if (worst > truth.lo + 1e-6) {
          stats.floorAbove++;
          if (Number.isFinite(truth.lo)) stats.floorAboveFinite++;
          out.push({ ...rec, kind: 'floor-above-truth', note: `floor ${worst} > truth min ${truth.lo}` });
        }
        if (best < truth.hi - 1e-6) {
          stats.ceilingBelow++;
          if (Number.isFinite(truth.hi)) stats.ceilingBelowFinite++;
          else stats.ceilingBelowWin++;
          out.push({ ...rec, kind: 'ceiling-below-truth', note: `ceiling ${best} < truth max ${truth.hi}` });
        }
      } catch (err) {
        const e = err as { message?: string; code?: string };
        stats.threw++;
        if (e.code === 'bounds_inversion') stats.inverted++;
        out.push({
          board,
          turn,
          team,
          orders: Object.fromEntries(orders),
          worst: NaN,
          best: NaN,
          truthLo: truth.lo,
          truthHi: truth.hi,
          kind: e.code === 'bounds_inversion' ? 'inverted' : 'threw',
          note: `${e.message}`,
          members: null,
          config: cfgName,
        });
      } finally {
        bank.release();
      }
    }
  } finally {
    sub.release();
  }
}

interface Args {
  scenarios: string[];
  seeds: number[];
  turns: number;
  planCap: number;
  worldCap: number;
  out: string | null;
  evaluator: 'material' | 'reach';
  failures: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, dflt: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] as string) : dflt;
  };
  return {
    scenarios: get('scenario', 'tiny2').split(','),
    seeds: get('seeds', '1,2,3,4,5').split(',').map(Number),
    turns: Number(get('turns', '8')),
    planCap: Number(get('planCap', '48')),
    worldCap: Number(get('worldCap', '512')),
    out: get('out', '') || null,
    evaluator: get('evaluator', 'material') as 'material' | 'reach',
    failures: get('failures', '') || null,
  };
}

const CONFIGS: Array<{ name: string; cfg: Partial<BankConfig> }> = [
  { name: 'shipped-default', cfg: {} },
  { name: 'B0-only', cfg: { b1: false, b2: false, b3: false } },
];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const evaluator = args.evaluator === 'reach' ? defaultEvaluator : materialEvaluator;
  const violations: Violation[] = [];
  const stats: Record<string, ScanStats> = {};
  for (const c of CONFIGS) {
    stats[c.name] = {
      plans: 0,
      priced: 0,
      threw: 0,
      floorAbove: 0,
      floorAboveFinite: 0,
      ceilingBelow: 0,
      ceilingBelowFinite: 0,
      ceilingBelowWin: 0,
      inverted: 0,
      worldsTruncated: 0,
      r1Cases: 0,
      r1Violations: 0,
    };
  }

  console.log(`# BANK vs EXHAUSTIVE TRUTH  evaluator=${args.evaluator} planCap=${args.planCap} worldCap=${args.worldCap}`);
  if (args.failures !== null) {
    const caps = JSON.parse(fs.readFileSync(args.failures, 'utf8')) as Array<{
      turn: number;
      board: Board;
    }>;
    for (const cap of caps) {
      for (const team of [
        ...new Set((cap.board.snakes ?? []).map((sn) => TeamDetector.getTeamKey(sn))),
      ].sort()) {
        for (const c of CONFIGS) {
          scanBoard(cap.board, cap.turn, team, c.cfg, c.name, evaluator, args.planCap, args.worldCap, stats[c.name] as ScanStats, violations);
        }
      }
      clearGeometryCache();
    }
    console.log('## SUMMARY (captured failure boards)');
    for (const c of CONFIGS) {
      const s = stats[c.name] as ScanStats;
      console.log(
        `  ${c.name}: plans=${s.plans} priced=${s.priced} threw=${s.threw} inverted=${s.inverted} ` +
          `floorAboveTruth=${s.floorAbove}(fin ${s.floorAboveFinite}) ceilingBelowTruth=${s.ceilingBelow}(fin ${s.ceilingBelowFinite}, WIN ${s.ceilingBelowWin}) R1viol=${s.r1Violations}/${s.r1Cases}`
      );
    }
    const inv = violations.filter((v) => v.kind === 'inverted');
    for (const v of inv.slice(0, 6)) {
      console.log(`  INVERTED [${v.config}] turn ${v.turn} ${v.team} orders=${JSON.stringify(v.orders)}: ${v.note} ; truth=[${v.truthLo}, ${v.truthHi}]`);
    }
    if (args.out !== null) {
      fs.writeFileSync(args.out, JSON.stringify({ args, stats, violations: violations.slice(0, 200) }, null, 1));
      console.log(`# wrote ${args.out}`);
    }
    return;
  }
  for (const name of args.scenarios) {
    const scenario = SCENARIOS[name];
    if (scenario === undefined) throw new Error(`unknown scenario ${name}`);
    for (const seed of args.seeds) {
      // Walk a board forward with the SCRIPTED neutral policy on every team, so
      // the positions scanned are ones a real game reaches (grown snakes, dead
      // units, moved kings) without either engine under test choosing them.
      let board = generateBoard(scenario, seed).board;
      for (let turn = 1; turn <= args.turns; turn++) {
        for (const team of TEAM_IDS.slice(0, scenario.teams)) {
          if (!teamAlive(board, team)) continue;
          for (const c of CONFIGS) {
            scanBoard(
              board,
              turn,
              team,
              c.cfg,
              c.name,
              evaluator,
              args.planCap,
              args.worldCap,
              stats[c.name] as ScanStats,
              violations
            );
          }
        }
        const staged = new Map<string, number | string>();
        for (const team of TEAM_IDS.slice(0, scenario.teams)) {
          if (!teamAlive(board, team)) continue;
          for (const [id, mv] of neutralMoves(board, turn, team, seed)) staged.set(id, mv);
        }
        board = resolveFullTurn(board, turn, staged as Map<string, never>).board;
        clearGeometryCache();
      }
      const s = stats['shipped-default'] as ScanStats;
      console.log(
        `  ${name} seed=${seed}: plans=${s.plans} threw=${s.threw} (inverted=${s.inverted}) ` +
          `floorAboveTruth=${s.floorAbove}/${s.floorAboveFinite}fin ceilingBelowTruth=${s.ceilingBelow}/${s.ceilingBelowFinite}fin R1viol=${s.r1Violations}`
      );
    }
  }

  console.log('');
  console.log('## SUMMARY');
  for (const c of CONFIGS) {
    const s = stats[c.name] as ScanStats;
    console.log(
      `  ${c.name}: plans=${s.plans} priced=${s.priced} threw=${s.threw} inverted=${s.inverted}\n` +
        `      floorAboveTruth=${s.floorAbove} (finite-truth ${s.floorAboveFinite})\n` +
        `      ceilingBelowTruth=${s.ceilingBelow} (finite-truth ${s.ceilingBelowFinite}, WIN-sentinel ${s.ceilingBelowWin})\n` +
        `      R1 harness (checkSoundness): ${s.r1Violations} violations over ${s.r1Cases} cases\n` +
        `      worldsTruncated=${s.worldsTruncated}`
    );
  }
  const byKind = new Map<string, number>();
  for (const v of violations) byKind.set(`${v.config}/${v.kind}`, (byKind.get(`${v.config}/${v.kind}`) ?? 0) + 1);
  for (const [k, n] of [...byKind.entries()].sort()) console.log(`  ${k}: ${n}`);
  if (args.out !== null) {
    fs.writeFileSync(args.out, JSON.stringify({ args, stats, violations: violations.slice(0, 200) }, null, 1));
    console.log(`# wrote ${args.out} (first 200 violations)`);
  }
}

main();
