/**
 * THROUGHPUT PROFILE — resolutions per second, and where the time goes.
 *
 *   node .bench-dist/bench/prod/throughput.js --scenario mid11,big13 --seeds 301,302
 *
 * Four measurements, each on the same boards:
 *
 *  1. RAW SUBSTRATE — `resolveBoundedFor` + release in a loop. This is the
 *     integration's equivalent of the engine's own resolver bench, and it is
 *     the number to compare with the bot workstream's single-pipeline figure
 *     (~40,600 resolutions in a 1000 ms budget on 11x11, i.e. ~25 us each).
 *  2. THROUGH THE MEMO — the same loop behind `memoizeSubstrate`, with cache
 *     hits counted, since production always resolves through the memo.
 *  3. THROUGH THE EVALUATOR — `scorePlan`, which is one resolution plus the
 *     feature fold. The delta over (1) is the fold's cost.
 *  4. BANK price() — one call, with and without B3, reporting the wall cost
 *     AND the engine resolutions it spent, so "how much of a decision is the
 *     bank" has a number rather than an intuition.
 *
 * Also measured because it is on the production path and is easy to miss: the
 * cost of BUILDING a substrate for a turn (`makeSubstrate` — marshalling plus,
 * on a geometry-cache miss, a whole new `PartialEngine` arena). The cache is
 * keyed on the food layout among other things, so a match that eats misses it.
 */

import * as os from 'os';
import * as fs from 'fs';
import type { Board } from '../../src/types/battlesnake';
import type { Candidate, JointPlan, UnitId } from '../../src/lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { memoizeSubstrate } from '../../src/lobster/bounds/memo';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator, defaultEvaluator } from '../../src/lobster/evaluate';
import { BoundBank, DEFAULT_BANK_CONFIG } from '../../src/lobster/bounds/bank';
import { SCENARIOS, TEAM_IDS, generateBoard } from './boards';
import { neutralMoves } from './neutral';
import { resolveFullTurn, teamAlive } from './sim';
import { fmt } from './stats';

const budget = {
  shouldStop: (): boolean => false,
  remainingMs: (): number => 1e9,
  elapsedMs: (): number => 0,
  now: (): number => Date.now(),
};

const nowNs = (): bigint => process.hrtime.bigint();

function advance(scenario: string, seed: number, turns: number): Board {
  const s = SCENARIOS[scenario];
  if (s === undefined) throw new Error(`unknown scenario ${scenario}`);
  let board = generateBoard(s, seed).board;
  for (let t = 1; t < turns; t++) {
    const staged = new Map<string, number | string>();
    for (const team of TEAM_IDS.slice(0, s.teams)) {
      if (!teamAlive(board, team)) continue;
      for (const [id, mv] of neutralMoves(board, t, team, seed)) staged.set(id, mv);
    }
    const next = resolveFullTurn(board, t, staged as Map<string, never>).board;
    // Stop advancing the moment a team would be wiped: the position under
    // measurement must be one a real match is still being played from.
    const allStanding = TEAM_IDS.slice(0, s.teams).every((tm) => teamAlive(next, tm));
    if (!allStanding) break;
    board = next;
  }
  clearGeometryCache();
  return board;
}

/** A stream of distinct joint plans for our team, cycling the option lists. */
function planStream(
  sub: ReturnType<typeof makeSubstrate>,
  ourIds: ReadonlyArray<string>,
  count: number
): JointPlan[] {
  const lists = ourIds
    .map((w) => sub.unitOfWireId(w))
    .filter((u): u is NonNullable<typeof u> => u !== undefined)
    .map((u) => ({ unitId: u.unitId, from: u.cells[0] as number, options: sub.actionsOf(u.unitId) }));
  const out: JointPlan[] = [];
  for (let i = 0; i < count; i++) {
    const plan = new Map<UnitId, Candidate>();
    let k = i;
    for (const l of lists) {
      if (l.options.length === 0) continue;
      const opt = l.options[k % l.options.length] as Candidate;
      k = Math.floor(k / Math.max(1, l.options.length)) + 1;
      plan.set(l.unitId, { unitId: l.unitId, from: l.from, to: opt.to, path: opt.path });
    }
    out.push(plan);
  }
  return out;
}

interface Line {
  scenario: string;
  seed: number;
  units: number;
  ours: number;
  substrateBuildUsCold: number;
  substrateBuildUsWarm: number;
  rawResolveUs: number;
  rawResolvesPerSec: number;
  memoResolveUs: number;
  memoHitRate: number;
  evalMaterialUs: number;
  evalReachUs: number;
  bankFullUs: number;
  bankFullResolutions: number;
  bankNoB3Us: number;
  bankNoB3Resolutions: number;
  bankB0Us: number;
  bankB0Resolutions: number;
}

function measure(scenario: string, seed: number, turn: number, iters: number): Line {
  const board = advance(scenario, seed, turn);
  const team = TEAM_IDS[0] as string;
  const ourIds = (board.snakes ?? [])
    .filter((s) => s.teamID === team && s.health > 0)
    .map((s) => s.id);
  if (ourIds.length === 0) {
    throw new Error(
      `${scenario} seed=${seed}: team ${team} has no live unit at turn ${turn} — ` +
        'the advancement policy wiped it; lower --turn or fix the policy'
    );
  }

  // --- substrate build cost, cold and warm ---------------------------------
  clearGeometryCache();
  let t0 = nowNs();
  const cold = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds });
  const coldUs = Number(nowNs() - t0) / 1000;
  cold.release();
  t0 = nowNs();
  const warmRuns = 20;
  for (let i = 0; i < warmRuns; i++) {
    const s = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds });
    s.release();
  }
  const warmUs = Number(nowNs() - t0) / 1000 / warmRuns;

  const sub = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds });
  const asTeam = sub.teamNumber(team);
  const plans = planStream(sub, ourIds, iters);

  // --- raw resolutions -----------------------------------------------------
  // warmup
  for (let i = 0; i < Math.min(50, plans.length); i++) {
    const r = sub.resolveBoundedFor(plans[i] as JointPlan, asTeam);
    sub.releaseResolution(r.resolution);
  }
  t0 = nowNs();
  for (const p of plans) {
    const r = sub.resolveBoundedFor(p, asTeam);
    sub.releaseResolution(r.resolution);
  }
  const rawUs = Number(nowNs() - t0) / 1000 / plans.length;

  // --- through the memo ----------------------------------------------------
  const memo = memoizeSubstrate(sub, 4096);
  t0 = nowNs();
  for (const p of plans) memo.resolveBoundedFor(p, asTeam);
  const memoUs = Number(nowNs() - t0) / 1000 / plans.length;
  const hitRate = memo.stats.hits / Math.max(1, memo.stats.hits + memo.stats.resolutions);
  memo.release();

  // --- through the evaluator ----------------------------------------------
  const evalIters = Math.min(plans.length, 400);
  t0 = nowNs();
  for (let i = 0; i < evalIters; i++) materialEvaluator.scorePlan(sub, plans[i] as JointPlan, asTeam);
  const evalMatUs = Number(nowNs() - t0) / 1000 / evalIters;
  const reachIters = Math.min(plans.length, 120);
  t0 = nowNs();
  for (let i = 0; i < reachIters; i++) defaultEvaluator.scorePlan(sub, plans[i] as JointPlan, asTeam);
  const evalReachUs = Number(nowNs() - t0) / 1000 / reachIters;

  // --- bank price() --------------------------------------------------------
  const priceOnce = (cfg: Partial<typeof DEFAULT_BANK_CONFIG>): { us: number; res: number } => {
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
      const n = Math.min(plans.length, 24);
      let res = 0;
      const start = nowNs();
      for (let i = 0; i < n; i++) {
        try {
          res += bank.price(plans[i] as JointPlan).resolutions;
        } catch {
          /* inversion: still counts as a priced attempt for cost purposes */
        }
      }
      return { us: Number(nowNs() - start) / 1000 / n, res: res / n };
    } finally {
      bank.release();
    }
  };
  const full = priceOnce({});
  const noB3 = priceOnce({ b3: false });
  const b0 = priceOnce({ b1: false, b2: false, b3: false });

  sub.release();
  clearGeometryCache();

  return {
    scenario,
    seed,
    units: (board.snakes ?? []).filter((s) => s.health > 0).length,
    ours: ourIds.length,
    substrateBuildUsCold: coldUs,
    substrateBuildUsWarm: warmUs,
    rawResolveUs: rawUs,
    rawResolvesPerSec: 1e6 / rawUs,
    memoResolveUs: memoUs,
    memoHitRate: hitRate,
    evalMaterialUs: evalMatUs,
    evalReachUs: evalReachUs,
    bankFullUs: full.us,
    bankFullResolutions: full.res,
    bankNoB3Us: noB3.us,
    bankNoB3Resolutions: noB3.res,
    bankB0Us: b0.us,
    bankB0Resolutions: b0.res,
  };
}

function main(): void {
  const get = (n: string, d: string): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : d;
  };
  const scenarios = get('scenario', 'tiny2,duel11,mid11,big13,three15').split(',');
  const seeds = get('seeds', '301,302').split(',').map(Number);
  const turn = Number(get('turn', '8'));
  const iters = Number(get('iters', '800'));
  const out = get('out', '') || null;

  console.log(`# THROUGHPUT  node ${process.version} cpus=${os.cpus().length} loadavg=${os.loadavg().map((l) => l.toFixed(2)).join(' ')}`);
  console.log(`# iters=${iters} per raw/memo measurement; bank priced over 24 plans`);
  console.log('');
  const lines: Line[] = [];
  for (const s of scenarios) {
    for (const seed of seeds) {
      const l = measure(s, seed, turn, iters);
      lines.push(l);
      console.log(
        `${l.scenario} seed=${seed} units=${l.units} ours=${l.ours}\n` +
          `    substrate build  cold=${fmt(l.substrateBuildUsCold, 1)}us  warm(geometry cached)=${fmt(l.substrateBuildUsWarm, 1)}us\n` +
          `    raw resolve      ${fmt(l.rawResolveUs, 2)}us  =>  ${fmt(l.rawResolvesPerSec, 0)} resolutions/s\n` +
          `    via memo         ${fmt(l.memoResolveUs, 2)}us (hit rate ${fmt(l.memoHitRate * 100, 1)}%)\n` +
          `    evaluator        material=${fmt(l.evalMaterialUs, 2)}us  reach/king=${fmt(l.evalReachUs, 2)}us  (ratio ${fmt(l.evalReachUs / l.evalMaterialUs, 1)}x)\n` +
          `    bank price()     full=${fmt(l.bankFullUs, 1)}us/${fmt(l.bankFullResolutions, 1)}res   noB3=${fmt(l.bankNoB3Us, 1)}us/${fmt(l.bankNoB3Resolutions, 1)}res   B0only=${fmt(l.bankB0Us, 1)}us/${fmt(l.bankB0Resolutions, 1)}res`
      );
      console.log('');
    }
  }
  if (out !== null) {
    fs.writeFileSync(out, JSON.stringify({ scenarios, seeds, turn, iters, loadavg: os.loadavg(), lines }, null, 1));
    console.log(`# wrote ${out}`);
  }
}

main();
