/**
 * ANYTIME PROFILE at production budgets.
 *
 *   node .bench-dist/bench/prod/anytime.js --scenario big13 --budgets 1000,5000,10000 \
 *        --seeds 201,202,203 --turn 12 --out anytime.json
 *
 * One real decision per (scenario, seed, budget) on a board walked forward by
 * the scripted neutral policy, so the position is a mid-game one rather than a
 * spawn. Everything reported comes off the kernel's own report — emissions,
 * the lo/est/hi trajectory of the journal, slice cost and its carried EWMA,
 * refusal channels, crossfade, posture flips and `leverOrderBinding`.
 *
 * THE SLACK QUESTION. `EmitRecord.slack` is the VOC's currency. With no lever
 * surface on the search core (`leverOrderBinding === false`) the kernel can
 * only fill it with the bound gap, so `slack === hi - lo` identically and the
 * orchestrator's "which lever buys the most" question is unanswerable. This
 * measures the identity rather than asserting it: `slackEqualsGap` counts the
 * records where the two agree exactly.
 */

import * as fs from 'fs';
import * as os from 'os';
import { SCENARIOS, TEAM_IDS, generateBoard } from './boards';
import { lobsterDriver } from './drivers';
import { neutralMoves } from './neutral';
import { resolveFullTurn, teamAlive } from './sim';
import { clearGeometryCache } from '../../src/lobster/substrate';
import { defaultEvaluator } from '../../src/lobster/evaluate';
import { fmt, mean, quantile } from './stats';
import type { KernelReport } from '../../src/lobster/kernel';
import type { EmitRecord } from '../../src/lobster/contracts';

interface Args {
  scenarios: string[];
  budgets: number[];
  seeds: number[];
  turn: number;
  evaluator: 'material' | 'reach';
  /** Kernel refinement-slice length. The team engine ships 25 ms. */
  sliceMs: number | null;
  /** Wire write throttle. The team engine ships the StageThrottle policy (1000 ms). */
  minWriteMs: number | null;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const get = (n: string, d: string): string => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && i + 1 < argv.length ? (argv[i + 1] as string) : d;
  };
  return {
    scenarios: get('scenario', 'big13').split(','),
    budgets: get('budgets', '1000,5000,10000').split(',').map(Number),
    seeds: get('seeds', '201,202,203').split(',').map(Number),
    turn: Number(get('turn', '10')),
    evaluator: get('evaluator', 'material') as 'material' | 'reach',
    sliceMs: get('sliceMs', '') === '' ? null : Number(get('sliceMs', '')),
    minWriteMs: get('minWriteMs', '') === '' ? null : Number(get('minWriteMs', '')),
    out: get('out', '') || null,
  };
}

interface Row {
  scenario: string;
  seed: number;
  budgetMs: number;
  units: number;
  ourUnits: number;
  emissions: number;
  wallMs: number;
  overrunMs: number;
  firstStageMs: number | null;
  report: {
    elapsedMs: number;
    budgetMs: number;
    overshootMs: number;
    slices: number;
    improveCalls: number;
    refineCalls: number;
    conformCalls: number;
    evaluateCalls: number;
    emits: number;
    probes: number;
    meanSliceCostMs: number;
    finalStepCostMs: number;
    epochs: number;
    stagedNothing: boolean;
    leverOrderBinding: boolean;
    boundViolations: number;
    refusals: Record<string, number>;
    crossfade: { independent: number; certified: number; uncertified: number; blocked: number };
    postureFlips: number;
    contexts: number;
    levers: number;
  } | null;
  /** The lo/est/hi/slack trajectory, one row per emitted record. */
  journal: Array<{ lo: number; est: number; hi: number; slack: number; gap: number; horizon: number; epoch: number; posture: string }>;
  slackEqualsGap: number;
  error: string | null;
}

/** Walk the board forward with the neutral policy to reach a mid-game shape. */
function advanceTo(scenario: string, seed: number, turn: number): { board: ReturnType<typeof generateBoard>['board']; turn: number } {
  const s = SCENARIOS[scenario];
  if (s === undefined) throw new Error(`unknown scenario ${scenario}`);
  let board = generateBoard(s, seed).board;
  for (let t = 1; t < turn; t++) {
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
  return { board, turn };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows: Row[] = [];
  console.log(`# ANYTIME PROFILE  evaluator=${args.evaluator}  sliceMs=${args.sliceMs ?? 'default 25'} minWriteMs=${args.minWriteMs ?? 'default 1000 (StageThrottle policy)'}  node ${process.version}  cpus=${os.cpus().length}`);
  console.log(`# loadavg at start ${os.loadavg().map((l) => l.toFixed(2)).join(' ')}`);

  for (const scenario of args.scenarios) {
    for (const seed of args.seeds) {
      const { board, turn } = advanceTo(scenario, seed, args.turn);
      const team = TEAM_IDS[0] as string;
      for (const budgetMs of args.budgets) {
        const drv = lobsterDriver({
          ...(args.evaluator === 'reach' ? { evaluate: defaultEvaluator } : {}),
          kernel: {
            ...(args.sliceMs === null ? {} : { sliceMs: args.sliceMs }),
            ...(args.minWriteMs === null ? {} : { minWriteIntervalMs: args.minWriteMs }),
          },
        });
        const out = await drv.decide(board, turn, team, Date.now() + budgetMs);
        drv.release();
        clearGeometryCache();
        const r = out.report as KernelReport | null;
        const journal = (r?.journal ?? []).map((j: EmitRecord) => ({
          lo: j.lo,
          est: j.est,
          hi: j.hi,
          slack: j.slack,
          gap: j.hi - j.lo,
          horizon: j.horizon,
          epoch: j.epoch,
          posture: String(j.posture),
        }));
        const slackEqualsGap = journal.filter(
          (j) => j.slack === j.gap || (!Number.isFinite(j.slack) && !Number.isFinite(j.gap))
        ).length;
        const ourUnits = (board.snakes ?? []).filter((s) => s.teamID === team && s.health > 0).length;
        rows.push({
          scenario,
          seed,
          budgetMs,
          units: (board.snakes ?? []).filter((s) => s.health > 0).length,
          ourUnits,
          emissions: out.emissions,
          wallMs: out.wallMs,
          overrunMs: out.overrunMs,
          firstStageMs: out.firstStageMs,
          report:
            r === null
              ? null
              : {
                  elapsedMs: r.elapsedMs,
                  budgetMs: r.budgetMs,
                  overshootMs: r.overshootMs,
                  slices: r.slices,
                  improveCalls: r.improveCalls,
                  refineCalls: r.refineCalls,
                  conformCalls: r.conformCalls,
                  evaluateCalls: r.evaluateCalls,
                  emits: r.emits,
                  probes: r.probes,
                  meanSliceCostMs: r.meanSliceCostMs,
                  finalStepCostMs: r.finalStepCostMs,
                  epochs: r.epochs,
                  stagedNothing: r.stagedNothing,
                  leverOrderBinding: r.leverOrderBinding,
                  boundViolations: r.boundViolations,
                  refusals: { ...r.refusals } as unknown as Record<string, number>,
                  crossfade: { ...r.crossfade },
                  postureFlips: r.postureFlips.length,
                  contexts: r.contexts.length,
                  levers: r.levers.length,
                },
          journal,
          slackEqualsGap,
          error: out.error,
        });
        const last = rows[rows.length - 1] as Row;
        console.log(
          `  ${scenario} seed=${seed} budget=${budgetMs}ms units=${last.units} ours=${ourUnits}: ` +
            `emissions=${out.emissions} wall=${out.wallMs}ms overrun=${out.overrunMs}ms ` +
            `firstStage=${out.firstStageMs ?? 'never'}ms slices=${r?.slices ?? 0} ` +
            `improve=${r?.improveCalls ?? 0} evals=${r?.evaluateCalls ?? 0} ` +
            `meanSlice=${fmt(r?.meanSliceCostMs ?? NaN, 2)}ms step=${fmt(r?.finalStepCostMs ?? NaN, 2)}ms ` +
            `leverBinding=${r?.leverOrderBinding} stagedNothing=${r?.stagedNothing} ` +
            `error=${out.error ?? 'none'} load=${os.loadavg()[0]?.toFixed(2)}`
        );
        if (journal.length > 0) {
          console.log(
            `      lo trajectory: ${journal.map((j) => `${fmt(j.lo, 1)}`).join(' -> ')}`
          );
          console.log(
            `      hi trajectory: ${journal.map((j) => `${fmt(j.hi, 1)}`).join(' -> ')}   slack==gap on ${slackEqualsGap}/${journal.length}`
          );
        }
        if (r !== null) {
          const refused = Object.entries(r.refusals).filter(([, n]) => n > 0);
          if (refused.length > 0) {
            console.log(`      refusals: ${refused.map(([k, n]) => `${k}=${n}`).join(' ')}`);
          }
        }
      }
    }
  }

  console.log('');
  console.log('## SUMMARY (per budget, across seeds and scenarios)');
  for (const budgetMs of args.budgets) {
    const rs = rows.filter((r) => r.budgetMs === budgetMs && r.report !== null);
    if (rs.length === 0) continue;
    const j = rs.flatMap((r) => r.journal);
    const climbed = rs.filter((r) => r.journal.length > 1 && (r.journal[r.journal.length - 1] as { lo: number }).lo > (r.journal[0] as { lo: number }).lo).length;
    const gapShrank = rs.filter(
      (r) => r.journal.length > 1 && (r.journal[r.journal.length - 1] as { gap: number }).gap < (r.journal[0] as { gap: number }).gap
    ).length;
    console.log(
      [
        `budget=${budgetMs}ms  n=${rs.length}`,
        `emissions/decision mean=${fmt(mean(rs.map((r) => r.emissions)))} p50=${fmt(quantile(rs.map((r) => r.emissions), 0.5), 0)}`,
        `firstStage p50=${fmt(quantile(rs.map((r) => r.firstStageMs ?? NaN).filter(Number.isFinite), 0.5), 1)}ms`,
        `slices mean=${fmt(mean(rs.map((r) => r.report?.slices ?? 0)), 1)}`,
        `improveCalls mean=${fmt(mean(rs.map((r) => r.report?.improveCalls ?? 0)), 1)}`,
        `evaluateCalls mean=${fmt(mean(rs.map((r) => r.report?.evaluateCalls ?? 0)), 0)}`,
        `meanSliceCostMs=${fmt(mean(rs.map((r) => r.report?.meanSliceCostMs ?? NaN)))}`,
        `finalStepCostMs=${fmt(mean(rs.map((r) => r.report?.finalStepCostMs ?? NaN)))}`,
        `overshootMs mean=${fmt(mean(rs.map((r) => r.report?.overshootMs ?? 0)))} max=${fmt(Math.max(...rs.map((r) => r.report?.overshootMs ?? 0)))}`,
        `wall overrun vs deadline: mean=${fmt(mean(rs.map((r) => r.overrunMs)))} max=${fmt(Math.max(...rs.map((r) => r.overrunMs)))}`,
        `stagedNothing=${rs.filter((r) => r.report?.stagedNothing === true).length}`,
        `threw=${rs.filter((r) => r.error !== null).length}`,
        `leverOrderBinding true on ${rs.filter((r) => r.report?.leverOrderBinding === true).length}/${rs.length}`,
        `slack===gap on ${j.filter((x) => x.slack === x.gap).length}/${j.length} emitted records`,
        `lo climbed on ${climbed}/${rs.length}; bound gap shrank on ${gapShrank}/${rs.length}`,
        `crossfade blocked=${rs.reduce((n, r) => n + (r.report?.crossfade.blocked ?? 0), 0)} uncertified=${rs.reduce((n, r) => n + (r.report?.crossfade.uncertified ?? 0), 0)} certified=${rs.reduce((n, r) => n + (r.report?.crossfade.certified ?? 0), 0)}`,
      ].join('\n    ')
    );
    console.log('');
  }

  if (args.out !== null) {
    fs.writeFileSync(args.out, JSON.stringify({ args, loadavg: os.loadavg(), rows }, null, 1));
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
