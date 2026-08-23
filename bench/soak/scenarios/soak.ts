/**
 * LANE 1a — one long scripted game, 200 turns, production heap cap.
 *
 * Pass criterion (mandate): bounded memory (flat after warm-up), zero
 * invariant violations, no latency drift beyond noise.
 */

import { SoakGame } from '../driver';
import { argOf, flagOf, writeCsv } from '../main';
import { summarise } from '../stats';

export async function main(): Promise<void> {
  const turns = argOf('turns', 200);
  const game = new SoakGame({
    gameId: 'soak1',
    size: argOf('size', 12),
    ours: argOf('ours', 8),
    theirs: argOf('theirs', 8),
    budgetMs: argOf('budget', 300),
    seed: argOf('seed', 20260823),
    pinRate: argOf('pinRate', 0.15),
    churnFood: flagOf('churnFood'),
    minWriteIntervalMs: argOf('wireMs', 1000),
    retainEvery: argOf('retainEvery', 5),
  });
  for (let t = 0; t < turns; t++) {
    await game.step(t);
  }
  game.dispose();
  const file = writeCsv(flagOf('churnFood') ? 'soak-churn' : 'soak-single', game.metrics);
  console.log(summarise(game.metrics, game.violations));
  console.log(`csv: ${file}`);
}
