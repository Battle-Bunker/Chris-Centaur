/**
 * HEAD-TO-HEAD: the LOBSTER team engine against the legacy per-snake path,
 * paired seeds, sides swapped, real clocks, production budgets.
 *
 *   node dist-bench/bench/prod/h2h.js --scenario mid11 --budget 1000 \
 *        --seeds 101,102,103 --maxTurns 40 --out /path/to/h2h-1s.json
 *
 * Every seed is played TWICE — once with LOBSTER on team `red`, once with it
 * on team `blue` — from a bit-identical starting board. The per-seed statistic
 * is the SUM of the two outcomes, which is zero for any advantage the board's
 * geometry gives one side. That is the whole reason for the swap, and it is
 * why the bootstrap resamples seeds rather than matches.
 */

import * as fs from 'fs';
import * as os from 'os';
import { SCENARIOS, TEAM_IDS, generateBoard, unitCount } from './boards';
import { legacyDriver, lobsterDriver } from './drivers';
import { runMatch, type MatchResult } from './match';
import { bootstrap, fmt, fmtInterval, mean, quantile } from './stats';
import { clearGeometryCache } from '../../src/lobster/substrate';
import { defaultEvaluator } from '../../src/lobster/evaluate';
import type { Evaluator } from '../../src/lobster/contracts';

interface Args {
  scenarios: string[];
  budget: number;
  seeds: number[];
  maxTurns: number;
  out: string | null;
  evaluator: 'material' | 'reach';
  /** `lobster-vs-legacy` (the flag-flip question) or `reach-vs-material`
   * (the evaluator question, both sides the team engine). */
  mode: 'lobster-vs-legacy' | 'reach-vs-material';
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, dflt: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] as string) : dflt;
  };
  return {
    scenarios: get('scenario', 'mid11').split(','),
    budget: Number(get('budget', '1000')),
    seeds: get('seeds', '101,102,103').split(',').map(Number),
    maxTurns: Number(get('maxTurns', '40')),
    out: get('out', '') || null,
    evaluator: get('evaluator', 'material') as 'material' | 'reach',
    mode: get('mode', 'lobster-vs-legacy') as Args['mode'],
  };
}

export interface H2HRow {
  readonly scenario: string;
  readonly budgetMs: number;
  readonly matches: MatchResult[];
  /** Per-seed paired score for lobster: outcome(armA) + outcome(armB), in [-2,2]. */
  readonly pairedScore: number[];
  readonly pairedMargin: number[];
}

/** `material` = the shipped default; `reach` = the calibrated reach/king profile. */
export function evaluatorFor(kind: 'material' | 'reach'): { evaluate?: Evaluator } {
  return kind === 'material' ? {} : { evaluate: defaultEvaluator };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows: H2HRow[] = [];
  const evalOpts = evaluatorFor(args.evaluator);

  console.log(`# H2H  mode=${args.mode}  budget=${args.budget}ms  seeds=${args.seeds.join(',')}  maxTurns=${args.maxTurns}`);
  if (args.mode === 'reach-vs-material') {
    console.log('# side A = team engine with the CALIBRATED reach/king profile; side B = team engine with materialEvaluator');
    console.log('# (the columns labelled "lobster" are side A, "legacy" are side B)');
  }
  console.log(`# node ${process.version}  cpus=${os.cpus().length}  loadavg=${os.loadavg().map((l) => l.toFixed(2)).join(' ')}`);

  for (const name of args.scenarios) {
    const scenario = SCENARIOS[name];
    if (scenario === undefined) throw new Error(`unknown scenario ${name}`);
    const matches: MatchResult[] = [];
    const pairedScore: number[] = [];
    const pairedMargin: number[] = [];

    for (const seed of args.seeds) {
      let seedScore = 0;
      let seedMargin = 0;
      for (const swap of [0, 1] as const) {
        const gen = generateBoard(scenario, seed);
        const lobsterTeam = TEAM_IDS[swap] as string;
        const legacyTeam = TEAM_IDS[1 - swap] as string;
        const neutralTeams = scenario.teams > 2 ? [TEAM_IDS[2] as string] : [];
        const lob = lobsterDriver(args.mode === 'reach-vs-material' ? evaluatorFor('reach') : evalOpts);
        const leg =
          args.mode === 'reach-vs-material'
            ? lobsterDriver(evaluatorFor('material'))
            : legacyDriver();
        const started = Date.now();
        const res = await runMatch({
          board: gen.board,
          seed,
          scenario: name,
          budgetMs: args.budget,
          maxTurns: args.maxTurns,
          lobster: lob,
          legacy: leg,
          lobsterTeam,
          legacyTeam,
          neutralTeams,
          legacySpeaksForSnakesOnly: args.mode !== 'reach-vs-material',
        });
        lob.release();
        leg.release();
        clearGeometryCache();
        matches.push(res);
        seedScore += res.outcome;
        seedMargin += res.materialMargin;
        console.log(
          `  ${name} seed=${seed} swap=${swap} lobster=${lobsterTeam} -> ${
            res.outcome > 0 ? 'LOBSTER' : res.outcome < 0 ? 'legacy' : 'draw'
          } (${res.reason}) turns=${res.turns} margin=${res.materialMargin} ` +
            `illegal L/l=${res.lobster.illegal}/${res.legacy.illegal} ` +
            `stagedNothing=${res.lobster.stagedNothing}/${res.legacy.stagedNothing} ` +
            `overruns=${res.lobster.overruns}/${res.legacy.overruns} ` +
            `errors=${res.lobster.errors.length}/${res.legacy.errors.length} ` +
            `wall=${((Date.now() - started) / 1000).toFixed(1)}s load=${os.loadavg()[0]?.toFixed(2)}`
        );
      }
      pairedScore.push(seedScore);
      pairedMargin.push(seedMargin);
    }
    rows.push({ scenario: name, budgetMs: args.budget, matches, pairedScore, pairedMargin });
  }

  console.log('');
  console.log('## SUMMARY');
  for (const row of rows) {
    const s = SCENARIOS[row.scenario];
    const wins = row.matches.filter((m) => m.outcome > 0).length;
    const losses = row.matches.filter((m) => m.outcome < 0).length;
    const draws = row.matches.filter((m) => m.outcome === 0).length;
    const score = bootstrap(row.pairedScore);
    const margin = bootstrap(row.pairedMargin);
    const lobIll = row.matches.reduce((n, m) => n + m.lobster.illegal, 0);
    const legIll = row.matches.reduce((n, m) => n + m.legacy.illegal, 0);
    const lobNothing = row.matches.reduce((n, m) => n + m.lobster.stagedNothing, 0);
    const legNothing = row.matches.reduce((n, m) => n + m.legacy.stagedNothing, 0);
    const lobUnstaged = row.matches.reduce((n, m) => n + m.lobster.unstaged, 0);
    const legUnstaged = row.matches.reduce((n, m) => n + m.legacy.unstaged, 0);
    const lobDec = row.matches.reduce((n, m) => n + m.lobster.decisions, 0);
    const legDec = row.matches.reduce((n, m) => n + m.legacy.decisions, 0);
    const lobOver = row.matches.reduce((n, m) => n + m.lobster.overruns, 0);
    const legOver = row.matches.reduce((n, m) => n + m.legacy.overruns, 0);
    const lobWorst = Math.max(0, ...row.matches.map((m) => m.lobster.worstOverrunMs));
    const legWorst = Math.max(0, ...row.matches.map((m) => m.legacy.worstOverrunMs));
    const lobEmit = row.matches.reduce((n, m) => n + m.lobster.emissions, 0);
    const legEmit = row.matches.reduce((n, m) => n + m.legacy.emissions, 0);
    const lobErr = row.matches.reduce((n, m) => n + m.lobster.errors.length, 0);
    const legErr = row.matches.reduce((n, m) => n + m.legacy.errors.length, 0);
    const lobFirst = row.matches.flatMap((m) => m.lobster.firstStageMs);
    const legFirst = row.matches.flatMap((m) => m.legacy.firstStageMs);
    console.log(
      [
        `scenario=${row.scenario} (${s?.size}x${s?.size}, ${s?.teams} teams, ${unitCount(s!)} units)`,
        `budget=${row.budgetMs}ms`,
        `matches=${row.matches.length} W/L/D=${wins}/${losses}/${draws}`,
        `pairedScore=${fmtInterval(score)}`,
        `pairedMargin=${fmtInterval(margin)}`,
        `illegal lob/leg=${lobIll}/${legIll}`,
        `stagedNothing lob/leg=${lobNothing}/${legNothing} of ${lobDec}/${legDec} decisions`,
        `THREW lob/leg=${lobErr}/${legErr}`,
        `unstaged lob/leg=${lobUnstaged}/${legUnstaged}`,
        `overruns lob/leg=${lobOver}/${legOver} (worst ${lobWorst}/${legWorst} ms)`,
        `emissions/decision lob/leg=${fmt(lobEmit / Math.max(1, lobDec))}/${fmt(legEmit / Math.max(1, legDec))}`,
        `firstStage p50 lob/leg=${fmt(quantile(lobFirst, 0.5), 1)}/${fmt(quantile(legFirst, 0.5), 1)} ms`,
        `meanTurns=${fmt(mean(row.matches.map((m) => m.turns)), 1)}`,
      ].join('\n    ')
    );
    console.log('');
  }

  const failures = rows.flatMap((r) => r.matches.flatMap((m) => m.failures));
  if (failures.length > 0) {
    console.log(`## ${failures.length} DECISION FAILURES — boards captured for repro`);
    const seen = new Set<string>();
    for (const f of failures) {
      if (seen.has(f.error)) continue;
      seen.add(f.error);
      console.log(`  ${f.side} turn ${f.turn}: ${f.error}`);
    }
    if (args.out !== null) {
      const path = args.out.replace(/\.json$/, '') + '.failures.json';
      fs.writeFileSync(path, JSON.stringify(failures, null, 1));
      console.log(`  wrote ${path}`);
    }
    console.log('');
  }

  if (args.out !== null) {
    fs.writeFileSync(args.out, JSON.stringify({ args, node: process.version, loadavg: os.loadavg(), rows }, null, 1));
    console.log(`# wrote ${args.out}`);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
