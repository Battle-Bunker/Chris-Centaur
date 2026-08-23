/**
 * Where a decision's time actually goes.
 *
 *   node --cpu-prof --cpu-prof-dir=<dir> .bench-dist/bench/prod/profile-bank.js \
 *        --scenario mid11 --seed 302 --plans 40
 *
 * Prices plans through the real bound bank on a real board, so the resulting
 * .cpuprofile is of the production decision path and not of a micro-benchmark.
 * `read-cpuprofile.js` turns the profile into a self-time table with file:line.
 *
 * It also reports the same split arithmetically, which is enough on its own to
 * say whether the bank's per-resolution overhead is in the engine or above it:
 *
 *   raw resolve            one engine resolution, nothing else
 *   evaluator scorePlan    the same resolution plus the feature fold
 *   candidatesFor(adversary)  the enumeration the bank does per held unit
 *   bank price()           the whole ladder
 */

import * as os from 'os';
import type { JointPlan, UnitId, Candidate } from '../../src/lobster/contracts';
import { clearGeometryCache, makeSubstrate } from '../../src/lobster/substrate';
import { GrammarCandidateGenerator } from '../../src/lobster/candidates';
import { materialEvaluator } from '../../src/lobster/evaluate';
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

const get = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? (process.argv[i + 1] as string) : d;
};

function main(): void {
  const name = get('scenario', 'mid11');
  const seed = Number(get('seed', '302'));
  const turn = Number(get('turn', '6'));
  const nPlans = Number(get('plans', '40'));
  const scenario = SCENARIOS[name];
  if (scenario === undefined) throw new Error(`unknown scenario ${name}`);

  let board = generateBoard(scenario, seed).board;
  for (let t = 1; t < turn; t++) {
    const staged = new Map<string, number | string>();
    for (const team of TEAM_IDS.slice(0, scenario.teams)) {
      if (!teamAlive(board, team)) continue;
      for (const [id, mv] of neutralMoves(board, t, team, seed)) staged.set(id, mv);
    }
    const next = resolveFullTurn(board, t, staged as Map<string, never>).board;
    if (!TEAM_IDS.slice(0, scenario.teams).every((tm) => teamAlive(next, tm))) break;
    board = next;
  }
  clearGeometryCache();

  const team = TEAM_IDS[0] as string;
  const ourIds = (board.snakes ?? []).filter((s) => s.teamID === team && s.health > 0).map((s) => s.id);
  const sub = makeSubstrate({ board, turn, asTeam: team, modeled: ourIds });
  const asTeam = sub.teamNumber(team);
  const gen = new GrammarCandidateGenerator();

  const lists = ourIds
    .map((w) => sub.unitOfWireId(w))
    .filter((u): u is NonNullable<typeof u> => u !== undefined)
    .map((u) => ({ unitId: u.unitId, from: u.cells[0] as number, options: sub.actionsOf(u.unitId) }));
  const plans: JointPlan[] = [];
  for (let i = 0; i < nPlans; i++) {
    const plan = new Map<UnitId, Candidate>();
    let k = i;
    for (const l of lists) {
      if (l.options.length === 0) continue;
      const o = l.options[k % l.options.length] as Candidate;
      k = Math.floor(k / Math.max(1, l.options.length)) + 1;
      plan.set(l.unitId, { unitId: l.unitId, from: l.from, to: o.to, path: o.path });
    }
    plans.push(plan);
  }

  const ns = (): bigint => process.hrtime.bigint();
  let t0 = ns();
  for (const p of plans) {
    const r = sub.resolveBoundedFor(p, asTeam);
    sub.releaseResolution(r.resolution);
  }
  const rawUs = Number(ns() - t0) / 1000 / plans.length;

  t0 = ns();
  for (const p of plans) materialEvaluator.scorePlan(sub, p, asTeam);
  const evalUs = Number(ns() - t0) / 1000 / plans.length;

  const held = sub.roster().filter((u) => !ourIds.includes(u.wireId));
  t0 = ns();
  let enumerated = 0;
  for (let i = 0; i < 20; i++) {
    for (const u of held) {
      enumerated += gen.candidatesFor(sub, u.unitId, 'adversary').candidates.length;
    }
  }
  const enumUs = Number(ns() - t0) / 1000 / (20 * Math.max(1, held.length));

  let priceUs = 0;
  let priceRes = 0;
  {
    const bank = new BoundBank({
      sub,
      gen,
      evaluate: materialEvaluator,
      asTeam,
      budget,
      basis: [],
      config: DEFAULT_BANK_CONFIG,
    });
    try {
      t0 = ns();
      for (const p of plans) {
        try {
          priceRes += bank.price(p).resolutions;
        } catch {
          /* an inverted bracket still costs what it costs */
        }
      }
      priceUs = Number(ns() - t0) / 1000 / plans.length;
    } finally {
      bank.release();
    }
  }

  console.log(`# PROFILE ${name} seed=${seed} turn=${turn} units=${sub.roster().length} ours=${ourIds.length} held=${held.length}`);
  console.log(`# loadavg ${os.loadavg().map((l) => l.toFixed(2)).join(' ')}`);
  console.log(`  raw resolveBoundedFor        ${fmt(rawUs, 2)} us`);
  console.log(`  evaluator scorePlan          ${fmt(evalUs, 2)} us   (fold adds ${fmt(evalUs - rawUs, 2)} us)`);
  console.log(`  candidatesFor(adversary)     ${fmt(enumUs, 2)} us per held unit  (${enumerated / 20 / Math.max(1, held.length)} options each)`);
  console.log(`  bank price()                 ${fmt(priceUs, 1)} us for ${fmt(priceRes / plans.length, 1)} resolutions`);
  console.log(
    `  => per-resolution INSIDE the bank ${fmt(priceUs / Math.max(1, priceRes / plans.length), 1)} us ` +
      `vs ${fmt(rawUs, 2)} us raw  (${fmt(priceUs / Math.max(1, priceRes / plans.length) / rawUs, 1)}x)`
  );

  sub.release();
  clearGeometryCache();
}

main();
