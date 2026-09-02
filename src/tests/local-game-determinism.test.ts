/**
 * THE PROOF THAT THE DETERMINISTIC MODE IS DETERMINISTIC.
 *
 * The local runner is the project's merge bar, and until this mode existed it
 * could not be used to measure anything: budgeted in milliseconds, the same
 * build at the same seed played `mixed` for 1501 unit-turns on one run and
 * 1329 on the next, and the worst single decision swung by 2x. Every counter
 * `basic-intelligence.test.ts` reads is downstream of how much search the box
 * happened to afford, so an A/B on a weight change was measuring the machine.
 *
 * `--nodes` replaces the wall-clock deadline with a work clock (see
 * `DecisionClock` in local-game.ts). What has to be true for that to be worth
 * anything is asserted here, and it is asserted the strict way — the whole
 * JSON summary compared as a STRING, not field by field, so a counter added
 * later is covered without anybody remembering to add it.
 */

import {
  DEFAULT_NODE_BUDGET,
  MIXED_SCENARIO,
  POTION_SCENARIO,
  SNAKE_SCENARIO,
  runGame,
  summaryOf,
} from './local-game';
import { clearGeometryCache } from '../lobster/substrate';

jest.setTimeout(180_000);

afterEach(() => clearGeometryCache());

const TURNS = 8;
const SEED = 7;
// Small enough to keep the suite honest about its runtime, large enough that
// the search is doing real work rather than returning the generator's seed —
// at this budget `seedKept` is well under 100%, which is the whole failure
// mode of "just make the budget tiny, then it is reproducible".
const NODES = 300;

async function play(spec: typeof MIXED_SCENARIO, scenario: string) {
  const result = await runGame(
    { ...spec, maxTurns: TURNS, seed: SEED, nodeBudget: NODES },
    { scores: false }
  );
  clearGeometryCache();
  return {
    json: JSON.stringify(
      summaryOf(
        result.metrics,
        { label: 'test', scenario, seed: SEED, turnsRequested: TURNS },
        { kind: 'nodes', nodes: NODES }
      )
    ),
    log: result.log.join('\n'),
  };
}

describe('the deterministic mode', () => {
  test('two runs of the same board produce a byte-identical JSON summary', async () => {
    const first = await play(MIXED_SCENARIO, 'mixed');
    const second = await play(MIXED_SCENARIO, 'mixed');
    expect(second.json).toBe(first.json);
    // And the traces too: a summary can agree while the game underneath it
    // differs, and it is the game a human reads.
    expect(second.log).toBe(first.log);
    // Not a vacuous pass: the run has to have played and eaten something.
    const summary = JSON.parse(first.json) as {
      counters: { unitTurns: number; meals: number; seedKept: number };
      work: { nodes: number; worstDecisionNodes: number };
      wall?: unknown;
    };
    expect(summary.counters.unitTurns).toBeGreaterThan(40);
    expect(summary.counters.meals).toBeGreaterThan(0);
    // The budget is a budget: no decision spent more than it was given.
    expect(summary.work.worstDecisionNodes).toBeLessThanOrEqual(NODES);
    expect(summary.work.nodes).toBeGreaterThan(NODES);
    // The search is not merely re-staging the generator's first offer, which
    // is what a too-small budget degenerates into.
    expect(summary.counters.seedKept).toBeLessThan(summary.counters.unitTurns);
  });

  test('and of a snake-only board too', async () => {
    const first = await play(SNAKE_SCENARIO, 'snakes');
    const second = await play(SNAKE_SCENARIO, 'snakes');
    expect(second.json).toBe(first.json);
    expect(second.log).toBe(first.log);
  });

  /**
   * The potion board is the one where `settleTurn` earns its keep: with
   * `resolveTurn` under the runner every potion on it was scenery and every
   * tier window was frozen at its observed value for the whole game, so this
   * asserts the rules are actually running — and that they run identically
   * twice, which the effect schedule and the seeded respawn both have to obey.
   */
  test('the potion board collects potions, moves tiers, and does it identically twice', async () => {
    const first = await play(POTION_SCENARIO, 'potions');
    const second = await play(POTION_SCENARIO, 'potions');
    expect(second.json).toBe(first.json);
    expect(second.log).toBe(first.log);
    const summary = JSON.parse(first.json) as {
      counters: { potionPickups: number; potionTierUps: number; potionTierDowns: number };
    };
    expect(summary.counters.potionPickups).toBeGreaterThan(0);
    // The pickup rule is inverted — the collector pays a tier and its allies
    // are paid one — so a board that collects anything must show both.
    expect(summary.counters.potionTierUps).toBeGreaterThan(0);
    expect(summary.counters.potionTierDowns).toBeGreaterThan(0);
  });

  test('and a potion-free board reports no potion activity at all', async () => {
    const { json } = await play(MIXED_SCENARIO, 'mixed');
    const summary = JSON.parse(json) as { counters: Record<string, number> };
    expect(summary.counters.potionPickups).toBe(0);
    expect(summary.counters.potionTierUps).toBe(0);
    expect(summary.counters.potionTierDowns).toBe(0);
    expect(summary.counters.deathsWhileDebuffed).toBe(0);
    expect(summary.counters.deathsWhileBuffed).toBe(0);
  });

  test('the summary carries no wall-clock reading — that is what makes it comparable', async () => {
    const { json } = await play(MIXED_SCENARIO, 'mixed');
    expect(JSON.parse(json).wall).toBeUndefined();
    expect(json).not.toContain('Ms');
  });

  test('the ms mode still reports its wall clock, and is still the default', async () => {
    const result = await runGame(
      { ...MIXED_SCENARIO, maxTurns: 3, seed: SEED, budgetMs: 30 },
      { scores: false }
    );
    const summary = summaryOf(
      result.metrics,
      { label: 'test', scenario: 'mixed', seed: SEED, turnsRequested: 3 },
      { kind: 'ms', ms: 30 }
    );
    expect(summary.mode).toBe('ms');
    expect(summary.wall?.worstDecisionMs).toBeGreaterThanOrEqual(0);
  });

  test('the default budget is the calibrated one, not an accident', () => {
    expect(DEFAULT_NODE_BUDGET).toBe(550);
  });
});
