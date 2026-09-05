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
 *  existed — with this exact runner, these exact scenarios, seed 1, 6 turns.
 *
 *  THE `mixed` PAIR WAS RE-TAKEN once, and the reason is not the lens. The
 *  bound-soundness repair to `evaluate/features.ts` (`room`'s maximised side)
 *  and to `bounds/material.ts` (a mover the optimistic timeline killed is not
 *  certainly dead) changes what a plan on a board with HELD units is worth, so
 *  the search visits different plans and the counters move with them — on the
 *  `mixed` board only; `snake` is byte-identical to the original recording,
 *  which is the evidence that the lens itself still costs nothing. The
 *  re-recording is the same measurement on the same commit's runner with the
 *  sink absent, and it is what a later lens change is now compared against.
 *
 *  AND BOTH PAIRS WERE RE-TAKEN AGAIN, for the same class of reason and not for
 *  the lens: `docs/design/entrapment.md`'s repair changes what `room` measures —
 *  from the ground a unit wins the race to, to the ground it can KEEP — so the
 *  fold returns different numbers, the search visits different plans, and the
 *  counters move with them on BOTH boards this time. What the gate still says
 *  is what it always said: these are the counters with the sink ABSENT, taken
 *  on this build, and a lens change that touched the hot loop would move them.
 *  The claim that the lens does not move the PLAY is a different test and lives
 *  in `src/tests/lens-inspection-cost.test.ts`.
 *
 *  AND THE `mixed` PAIR AGAIN, once more for a reason that is not the lens: the
 *  substrate's `perilOf` memo used to live only on the family, so a modelled
 *  sibling read its PARENT's peril set. Peril is the one view-dependent input
 *  three caches witness on (`resolveBoundedFor`, `claimSurvivals`, the
 *  evaluator's own per-resolution memo), so a sibling was reusing the parent's
 *  material fold and the parent's evaluation as well. Giving the sibling its
 *  own slot changes what a plan on a board with HELD units is worth, the search
 *  visits different plans, and the counters move with them. `snake` is
 *  byte-identical again — no held enemy, no sibling, nothing to answer
 *  differently — which is exactly the evidence this file exists to keep. */
const RECORDED = {
  snake: {
    550: { nodes: 6932, reads: 297514, slices: 6430, decisions: 18 },
    1100: { nodes: 13639, reads: 615890, slices: 13137, decisions: 18 },
  },
  mixed: {
    550: { nodes: 7101, reads: 247886, slices: 1479, decisions: 18 },
    1100: { nodes: 11396, reads: 769166, slices: 3201, decisions: 18 },
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
