/**
 * LANE 1b — THREE CONCURRENT GAMES, INTERLEAVED, 200 turns each.
 *
 * Every game gets its own board, its own submitter and its own fake Firestore,
 * exactly as a server multiplexing three matches would. Each round starts all
 * three decisions together, so their kernels share the loop.
 */

import { SoakGame } from '../driver';
import { argOf, writeCsv } from '../main';
import { fit, quantile, summarise } from '../stats';

export async function main(): Promise<void> {
  const turns = argOf('turns', 200);
  const budget = argOf('budget', 300);
  const games = [0, 1, 2].map(
    (i) =>
      new SoakGame({
        gameId: `g${i}`,
        size: 12,
        ours: argOf('ours', 8),
        theirs: argOf('theirs', 8),
        budgetMs: budget,
        seed: 1000 + i * 97,
        pinRate: 0.15,
        minWriteIntervalMs: 1000,
        retainEvery: 5,
      })
  );
  const rounds: Array<{ round: number; wallMs: number; retainedHeap: number; rss: number }> = [];
  for (let t = 0; t < turns; t++) {
    const t0 = Date.now();
    await Promise.all(games.map((g) => g.step(t)));
    const mem = process.memoryUsage();
    let retained = -1;
    if (typeof globalThis.gc === 'function' && t % 5 === 0) {
      globalThis.gc();
      globalThis.gc();
      retained = process.memoryUsage().heapUsed;
    }
    rounds.push({ round: t, wallMs: Date.now() - t0, retainedHeap: retained, rss: mem.rss });
  }
  for (const g of games) g.dispose();

  const all = games.flatMap((g) => g.metrics);
  writeCsv('soak-three', all);
  writeCsv('soak-three-rounds', rounds);
  const violations = games.flatMap((g) => g.violations);
  console.log(`THREE CONCURRENT GAMES — ${turns} rounds x 3 decisions, budget ${budget}ms each`);
  console.log(summarise(all, violations));
  const warm = rounds.slice(20);
  const ret = warm.map((r) => r.retainedHeap).filter((v) => v >= 0);
  const rf = fit(ret);
  const wall = warm.map((r) => r.wallMs);
  console.log(
    `\nround wall p50=${quantile(wall, 0.5).toFixed(0)}ms p95=${quantile(wall, 0.95).toFixed(
      0
    )}ms max=${Math.max(...wall)}ms (3 x ${budget}ms budgets)\n` +
      `process retained first=${((ret[0] ?? 0) / 1048576).toFixed(1)}MB last=${(
        (ret[ret.length - 1] ?? 0) / 1048576
      ).toFixed(1)}MB slope=${(rf.slopePer100 / 5 / 1048576).toFixed(3)}MB/100rounds signal=${rf.signal.toFixed(
        2
      )}σ  rssMax=${(Math.max(...warm.map((r) => r.rss)) / 1048576).toFixed(1)}MB`
  );
  const perGame = games.map(
    (g) =>
      `${g.opts.gameId}: latency p50=${quantile(g.metrics.map((m) => m.latencyMs), 0.5).toFixed(
        0
      )}ms p95=${quantile(g.metrics.map((m) => m.latencyMs), 0.95).toFixed(0)}ms overshootMax=${Math.max(
        ...g.metrics.map((m) => m.latencyMs - m.budgetMs)
      )}ms emits=${g.metrics.reduce((a, m) => a + m.emits, 0)} slices=${g.metrics.reduce(
        (a, m) => a + m.slices,
        0
      )}`
  );
  console.log(perGame.join('\n'));
}
