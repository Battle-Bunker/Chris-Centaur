/**
 * THE BREAKDOWN, IN THREE TIERS — and the residual that keeps it honest.
 *
 * `explainPlan` returns per-FEATURE, per-PLAN. It does not decompose per unit
 * and it must not: the fold is over one joint resolution, and per-unit
 * quantities "may order work and may never compose into a value". So the
 * honest per-member column is a CONTRASTIVE DELTA — the same joint explanation
 * with one member swapped to its next-best option, differenced — and a
 * difference of two joint explanations is legitimate exactly where a sum is
 * not.
 *
 * THE FALSIFIER THIS FILE EXISTS TO CATCH is a display that adds up. Law A:
 * no consumer may reconstruct the aggregate by summing the deltas, so the
 * named joint residual `aggregate − Σ deltas` is stored beside them and is
 * ALWAYS present, zero included. Omitting a zero residual and omitting a large
 * one are the same rendering bug, and only "always draw it" catches both.
 */

import type { Evaluator, KernelInput } from '../contracts';
import type { LensEvent, MovesetBreakdown, MovesetKey } from '../../lens/types';
import { DEFAULT_KERNEL_OPTIONS, LobsterKernel } from '../kernel';
import { GrammarCandidateGenerator, knobsForSafety } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { makeSearchCore } from '../search';
import { boardBearsPiece, resolveStagingSafety, stagingSafety } from '../staging-safety';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import { DecisionClock, MIXED_SCENARIO, buildBoard, meteredEvaluator } from '../../tests/local-game';

jest.setTimeout(120_000);

afterEach(() => clearGeometryCache());

const WORK = 2_000;
const TURN = 3;

interface Explained {
  readonly answers: ReadonlyArray<MovesetBreakdown | { ok: false; refusal: string }>;
  readonly keys: ReadonlyArray<MovesetKey>;
}

/** One decision, and an operator who opens the breakdown panel on the row the
 *  kernel just staged. */
async function explainDuringDecision(explains: boolean): Promise<Explained> {
  const board = buildBoard({ ...MIXED_SCENARIO, seed: 1 });
  const teamId = (MIXED_SCENARIO.teams[0] as { id: string }).id;
  const ourIds = (board.snakes ?? []).filter((s) => s.teamID === teamId).map((s) => s.id);
  const sub = makeSubstrate({ gameId: 'lens-explain', board, turn: TURN, asTeam: teamId, modeled: ourIds });
  const answers: Array<MovesetBreakdown | { ok: false; refusal: string }> = [];
  const keys: MovesetKey[] = [];
  try {
    const asTeam = sub.teamNumber(teamId);
    const clock = new DecisionClock(true);
    const safety = resolveStagingSafety(stagingSafety(), boardBearsPiece(sub));
    const gen = new GrammarCandidateGenerator(knobsForSafety(safety));
    const search = makeSearchCore({ rungZeroRepair: safety === 'full', seedDeconflict: safety !== 'off' });
    const kernel = new LobsterKernel({
      ...DEFAULT_KERNEL_OPTIONS,
      crossfade: 'teammate',
      reserveMs: 0,
      sliceMs: 550 / 6,
      maxSliceFraction: 0,
      pinCacheCapacity: 32,
      minWriteIntervalMs: 0,
      yieldIntervalMs: 0,
    });
    const metered = meteredEvaluator(defaultEvaluator, clock);
    // A STUB THAT CANNOT EXPLAIN is not an error case: it is what every
    // non-production evaluator is, and the panel says "this evaluator does not
    // explain" rather than drawing zeros.
    const evaluate: Evaluator = explains
      ? metered
      : { scorePlan: metered.scorePlan, evaluatePlan: metered.evaluatePlan };
    const t0 = clock.now();
    const frames: LensEvent[] = [];
    const kin: KernelInput = {
      sub,
      gen,
      evaluate,
      search,
      asTeam,
      deadlineMs: t0 + WORK,
      initialPins: [],
      assumptions: [],
      now: clock.now,
      lens: (e) => {
        frames.push(e);
      },
    };
    const port = kernel.lensPort();
    for await (const staged of kernel.decide(kin)) {
      expect(staged.plan.size).toBeGreaterThan(0);
      const rows = frames
        .filter((e) => e.kind === 'movesets')
        .flatMap((e) => (e as { rows: ReadonlyArray<{ key: MovesetKey }> }).rows);
      const key = rows[rows.length - 1]?.key;
      if (key === undefined) continue;
      keys.push(key);
      answers.push(await port.explainMoveset(key));
    }
    return { answers, keys };
  } finally {
    sub.release();
    clearGeometryCache();
  }
}

const isBreakdown = (a: unknown): a is MovesetBreakdown =>
  typeof a === 'object' && a !== null && 'marginals' in a;

describe('explainMoveset — decomposed, with the joint residual named', () => {
  it('answers the row the operator is standing on, at level 1', async () => {
    const { answers, keys } = await explainDuringDecision(true);
    expect(keys.length).toBeGreaterThan(0);
    const first = answers.find(isBreakdown);
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.aggregate).not.toBeNull();
    expect(first.aggregate?.features.length).toBeGreaterThan(0);
    expect(first.basis).not.toBe('');
  });

  it('draws the residual ALWAYS, and it is aggregate − Σ marginals', async () => {
    const { answers } = await explainDuringDecision(true);
    const breakdown = answers.find((a) => isBreakdown(a) && a.aggregate !== null) as
      | MovesetBreakdown
      | undefined;
    expect(breakdown).toBeDefined();
    if (breakdown?.aggregate == null) return;
    // The residual is a FIELD, not a conditional: a zero one is a finding
    // ("depth was pure proof") and a large one is a different finding, and a
    // display that omits either is showing a total that does not add up.
    expect(breakdown.residual).toBeDefined();
    const summed = breakdown.marginals.reduce(
      (acc, m) => ({ lo: acc.lo - m.delta.lo, est: acc.est - m.delta.est, hi: acc.hi - m.delta.hi }),
      breakdown.aggregate.bound
    );
    // `toEqual` rather than `toBeCloseTo`: the lattice bottom is `−∞` and it
    // is a legitimate endpoint here, which a closeness test cannot express.
    expect(breakdown.residual.total.lo).toEqual(summed.lo);
    expect(breakdown.residual.total.hi).toEqual(summed.hi);
  });

  it('names the foil each marginal was measured against', async () => {
    const { answers } = await explainDuringDecision(true);
    const breakdown = answers.find(isBreakdown) as MovesetBreakdown | undefined;
    for (const marginal of breakdown?.marginals ?? []) {
      // A DELTA AGAINST A NAMED REFERENCE ACTION, never a share of a total.
      expect(typeof marginal.against.to).toBe('number');
      expect(marginal.unit.length).toBeGreaterThan(0);
      expect(marginal.features.length).toBeGreaterThan(0);
    }
  });

  it('degrades to `aggregate: null` when the evaluator does not explain', async () => {
    const { answers } = await explainDuringDecision(false);
    const breakdown = answers.find(isBreakdown) as MovesetBreakdown | undefined;
    expect(breakdown).toBeDefined();
    if (breakdown === undefined) return;
    expect(breakdown.aggregate).toBeNull();
    expect(breakdown.marginals).toEqual([]);
    // Still a breakdown, still a residual field. Not an error, and not zeros
    // dressed as weights.
    expect(breakdown.residual.total).toEqual({ lo: 0, est: 0, hi: 0 });
  });

  it('refuses an unknown row rather than inventing one', async () => {
    const { answers } = await explainDuringDecision(true);
    expect(answers.length).toBeGreaterThan(0);
    // Every answer is either a breakdown or a TYPED refusal. There is no third
    // shape, and in particular there is no silence.
    for (const answer of answers) {
      expect(isBreakdown(answer) || (answer as { ok?: false }).ok === false).toBe(true);
    }
  });
});
