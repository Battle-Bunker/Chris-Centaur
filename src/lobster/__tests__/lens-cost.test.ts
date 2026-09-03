/**
 * 05-BUILD-ORDER §(d) GATE 7 — WHAT THE LENS COSTS, made falsifiable.
 *
 * 03 §0's headline claim is that the lens adds no evaluation to the hot loop.
 * It is a claim about a hot loop, so it is measured on the hot loop, with the
 * runner the rest of the project measures on (`local-game --nodes`), and the
 * numbers below are a RECORDING taken on the commit before the sink existed.
 * They are hard-coded on purpose: "byte-identical to before" needs a before,
 * and a test that recomputed its own expectation would pass whatever the lens
 * did to the search.
 *
 *   (ii) THE SINK IS FREE WHEN ABSENT. With `KernelInput.lens` undefined, the
 *        decision's evaluator-call count and node count are byte-identical to
 *        the pre-lens recording. Everything the lens does is behind one null
 *        check, INCLUDING the clock reads: under `--nodes` a read is work, so
 *        a lens that stamped its own rows with a fresh `now()` would change
 *        the decision it was watching, and this is the test that would say so.
 *
 * (i) and (iii) arrive with L3, which is where the inspection reserve is
 * carved and where there is an inspector to charge to it.
 */

import { MIXED_SCENARIO, SNAKE_SCENARIO, runGame, type GameSpec } from '../../tests/local-game';
import { clearGeometryCache } from '../substrate';

jest.setTimeout(180_000);

const TURNS = 6;
const SEED = 1;

/** THE PRE-LENS RECORDING. Taken on `1266ae8` — L1, before `KernelInput.lens`
 *  existed — with this exact runner, these exact scenarios, seed 1, 6 turns. */
const RECORDED = {
  snake: {
    550: { nodes: 6946, reads: 296183, slices: 6444, decisions: 18 },
    1100: { nodes: 13668, reads: 613032, slices: 13166, decisions: 18 },
  },
  mixed: {
    550: { nodes: 7274, reads: 219712, slices: 1364, decisions: 18 },
    1100: { nodes: 11592, reads: 748958, slices: 3191, decisions: 18 },
  },
} as const;

async function counters(spec: GameSpec, nodes: number) {
  const result = await runGame({ ...spec, maxTurns: TURNS, seed: SEED, nodeBudget: nodes }, { scores: false });
  clearGeometryCache();
  return {
    nodes: result.metrics.nodes,
    reads: result.metrics.reads,
    slices: result.metrics.slices,
    decisions: result.metrics.decisions,
  };
}

afterEach(() => clearGeometryCache());

describe('gate 7(ii) — with no sink attached, the lens costs exactly nothing', () => {
  it('snake: evaluator calls, clock reads and slices are the pre-lens numbers', async () => {
    expect(await counters(SNAKE_SCENARIO, 550)).toEqual(RECORDED.snake[550]);
    expect(await counters(SNAKE_SCENARIO, 1100)).toEqual(RECORDED.snake[1100]);
  });

  it('mixed: the same, on the board with pieces on it', async () => {
    expect(await counters(MIXED_SCENARIO, 550)).toEqual(RECORDED.mixed[550]);
    expect(await counters(MIXED_SCENARIO, 1100)).toEqual(RECORDED.mixed[1100]);
  });

  it('is not vacuous: the runner really did spend the budget it was given', async () => {
    const spent = await counters(MIXED_SCENARIO, 550);
    expect(spent.nodes).toBeGreaterThan(RECORDED.mixed[550].decisions * 100);
    expect(spent.slices).toBeGreaterThan(RECORDED.mixed[550].decisions);
  });
});
