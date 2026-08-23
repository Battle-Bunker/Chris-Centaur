/**
 * THE PRODUCTION REGIME — 8 / 12 / 26 units at 1 s, 5 s and 10 s budgets.
 *
 * The number the soak lane cares about is TIME TO FIRST STAGED SET: rung 0 is
 * `conform(ctx, ∅)`, contractually "cheap, never searches", and everything the
 * anytime story promises (a plan on the wire early, refined until the
 * deadline) rests on it. Reported alongside the slice count the remaining
 * budget actually buys.
 */

import { SoakGame } from '../driver';
import { argOf, writeCsv } from '../main';
import { quantile } from '../stats';

interface Row {
  units: number;
  budgetMs: number;
  turns: number;
  firstEmitP50: number;
  firstEmitMax: number;
  firstEmitPctOfBudget: number;
  slicesP50: number;
  improveP50: number;
  emitsP50: number;
  memoResolutionsP50: number;
  maxOutstanding: number;
  arenaMax: number;
  latencyP50: number;
  overshootMax: number;
  docsPerTurn: number;
  xfBlocked: number;
  xfCertified: number;
  xfIndependent: number;
  stagedNothing: number;
}

export async function main(): Promise<void> {
  const turns = argOf('turns', 4);
  const rows: Row[] = [];
  for (const units of [8, 12, 26]) {
    for (const budgetMs of [1000, 5000, 10000]) {
      const game = new SoakGame({
        gameId: `p${units}-${budgetMs}`,
        size: units >= 26 ? 14 : 12,
        ours: units,
        theirs: units,
        budgetMs,
        seed: 8080 + units,
        minWriteIntervalMs: 1000,
        retainEvery: 1e9,
      });
      for (let t = 0; t < turns; t++) await game.step(t);
      game.dispose();
      const m = game.metrics;
      const q = (f: (x: (typeof m)[number]) => number, p = 0.5): number => quantile(m.map(f), p);
      rows.push({
        units,
        budgetMs,
        turns,
        firstEmitP50: Math.round(q((x) => x.firstEmitMs)),
        firstEmitMax: Math.max(...m.map((x) => x.firstEmitMs)),
        firstEmitPctOfBudget: Math.round((100 * q((x) => x.firstEmitMs)) / budgetMs),
        slicesP50: q((x) => x.slices),
        improveP50: q((x) => x.improveCalls),
        emitsP50: q((x) => x.emits),
        memoResolutionsP50: q((x) => x.memoResolutions),
        maxOutstanding: Math.max(...m.map((x) => x.maxOutstanding)),
        arenaMax: Math.max(...m.map((x) => x.arenaCapacity)),
        latencyP50: Math.round(q((x) => x.latencyMs)),
        overshootMax: Math.round(Math.max(...m.map((x) => x.latencyMs - x.budgetMs))),
        docsPerTurn: Math.round(m.reduce((a, x) => a + x.docs, 0) / m.length),
        xfBlocked: m.reduce((a, x) => a + x.xfBlocked, 0),
        xfCertified: m.reduce((a, x) => a + x.xfCertified, 0),
        xfIndependent: m.reduce((a, x) => a + x.xfIndependent, 0),
        stagedNothing: m.reduce((a, x) => a + x.stagedNothing, 0),
      });
      console.log(
        `units=${String(units).padStart(2)} budget=${String(budgetMs).padStart(5)}ms  ` +
          `firstEmit p50=${String(rows[rows.length - 1]?.firstEmitP50).padStart(5)}ms (${String(
            rows[rows.length - 1]?.firstEmitPctOfBudget
          ).padStart(3)}% of budget) max=${String(rows[rows.length - 1]?.firstEmitMax).padStart(5)}ms  ` +
          `slices p50=${String(rows[rows.length - 1]?.slicesP50).padStart(4)}  emits p50=${
            rows[rows.length - 1]?.emitsP50
          }  memoRes p50=${String(rows[rows.length - 1]?.memoResolutionsP50).padStart(5)}  ` +
          `maxOutstanding=${String(rows[rows.length - 1]?.maxOutstanding).padStart(5)} arena=${
            rows[rows.length - 1]?.arenaMax
          }  overshoot=${rows[rows.length - 1]?.overshootMax}ms  docs/turn=${
            rows[rows.length - 1]?.docsPerTurn
          }  xf b/c/i=${rows[rows.length - 1]?.xfBlocked}/${rows[rows.length - 1]?.xfCertified}/${
            rows[rows.length - 1]?.xfIndependent
          }  stagedNothing=${rows[rows.length - 1]?.stagedNothing}`
      );
    }
  }
  writeCsv('profile', rows);
}
