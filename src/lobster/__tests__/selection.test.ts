/**
 * THE SEEDED WEIGHTED LOTTERY — the owner's ruling R-A, and the gates it owes.
 *
 * Five parts:
 *
 *   PRNG        path-addressed, replayable, no clock, no `Math.random`; the
 *               same seed and node give the same draw whatever else happened.
 *   LAWS        rule 18 (a probability returns a PERMUTATION, never a subset),
 *               rule 26 (every sampling weight is finite, and its regime is
 *               stamped), rule 20's lint, rule 17's placement grep, and the
 *               S=0 ablation that must collapse selection to pure prior order.
 *   SCHEDULE    owner Q1's default — always on, cooling sharply as the clock
 *               runs down — as a table, checked term by term.
 *   DETERMINISM same seed ⇒ byte-identical decision; a longer budget's decision
 *               sequence is a PREFIX of a shorter one's; the worker dispatch
 *               order is the sampled order, decided before any worker runs.
 *   THE PROBE   what the lottery actually buys: candidate diversity, measured
 *               as distinct options entered and as the FAR-OPTION ENTRY RATE —
 *               options beyond the deterministic prefix, which is the door i2's
 *               falsifier needs — against a no-regression gate on fatal
 *               stagings and teammate kills, on CL1/CL3's own generators and at
 *               CL3's own budgets.
 *
 * No live games. Every board is generated from a fixed seed, every budget is a
 * counting budget rather than a clock, and every verdict comes from the real
 * resolver via `withResolution`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Board, Coord, Snake } from '../../types/battlesnake';
import { clearGeometryCache, makeSubstrate } from '../substrate';
import { GrammarCandidateGenerator } from '../candidates';
import { defaultEvaluator } from '../evaluate';
import { makeSearchCore } from '../search';
import { BoundBank, candidateKey, planKey } from '../bounds';
import { countingBudget } from '../bounds/testkit';
import { planBatchPartition, sweepFrontier } from '../parallel';
import type { Frontier } from '../parallel';
import {
  ABLATED_SAMPLING,
  DEFAULT_SAMPLING,
  DEFAULT_WIDEN,
  NODE_SWEEP_CANDIDATES,
  NODE_SWEEP_UNITS,
  SAMPLED_CAP_ENV,
  SelectionSampler,
  candidateWeights,
  clipCeilings,
  decisionSeed,
  gumbel,
  mix,
  proposalWeights,
  rankLogit,
  sampledCapFrom,
  temperatureAt,
  uniform,
  unitCeiling,
  unitWeights,
  widenInert,
  widenTo,
} from '../selection';
import type { SamplingTuning } from '../selection';
import type { AdjudicationReport, JointPlan, SearchContext, UnitId } from '../contracts';

const TURN = 30;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function makeSnake(id: string, body: Coord[], extra: Partial<Snake> = {}): Snake {
  return {
    id,
    name: id,
    latency: '0',
    health: 100,
    body,
    head: body[0],
    length: body.length,
    shout: '',
    squad: '',
    customizations: { color: '#ffffff', head: 'default', tail: 'default' },
    orientation: { dx: 0, dy: -1 },
    ...extra,
  } as Snake;
}

afterEach(() => clearGeometryCache());

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// 1. The PRNG
// ---------------------------------------------------------------------------

describe('the path-addressed PRNG', () => {
  test('every uniform lands strictly inside (0, 1)', () => {
    let lo = 1;
    let hi = 0;
    for (let node = 0; node < 64; node++) {
      for (let arm = 0; arm < 64; arm++) {
        for (let draw = 0; draw < 8; draw++) {
          const u = uniform(0x1234, node, arm, draw);
          expect(u).toBeGreaterThan(0);
          expect(u).toBeLessThan(1);
          if (u < lo) lo = u;
          if (u > hi) hi = u;
        }
      }
    }
    // OPEN AT BOTH ENDS IS NOT COSMETIC: `gumbel` takes log(-log(u)), so a 0 or
    // a 1 anywhere in 32k draws would be a ±Infinity key — an unconditional
    // selection, which is the same hole rule 26 closes on the weight side.
    expect(Number.isFinite(gumbel(0x1234, 0, 0, 0))).toBe(true);
    expect(lo).toBeLessThan(0.01);
    expect(hi).toBeGreaterThan(0.99);
  });

  test('a draw is a pure function of its ADDRESS, not of call order', () => {
    // The whole point of addressing rather than dealing: reading the same
    // address in a different order gives the same value, which is what makes a
    // bigger budget an extension of a smaller one rather than a different run.
    const forward: number[] = [];
    for (let d = 0; d < 32; d++) forward.push(uniform(7, 11, 13, d));
    const backward: number[] = [];
    for (let d = 31; d >= 0; d--) backward.unshift(uniform(7, 11, 13, d));
    expect(backward).toEqual(forward);
  });

  test('the private match seed changes the whole stream', () => {
    const a = decisionSeed(0, 0xabcd, 3);
    const b = decisionSeed(1, 0xabcd, 3);
    expect(a).not.toBe(b);
    let differed = 0;
    for (let i = 0; i < 256; i++) {
      if (uniform(a, 1, i, 0) !== uniform(b, 1, i, 0)) differed++;
    }
    expect(differed).toBe(256);
  });

  test('the board fingerprint and the decision index separate streams too', () => {
    const seeds = new Set<number>();
    for (let board = 0; board < 16; board++) {
      for (let idx = 0; idx < 16; idx++) seeds.add(decisionSeed(0, board, idx));
    }
    expect(seeds.size).toBe(256);
  });

  test('draws are uniform enough to be a lottery', () => {
    // Not a statistics course — a coarse guard that the mixer is not degenerate
    // in a way that would silently collapse the draw onto one arm.
    const buckets = new Array<number>(10).fill(0);
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = uniform(0x5eed, 3, i, 0);
      buckets[Math.min(9, Math.floor(u * 10))]++;
    }
    for (const b of buckets) {
      expect(b).toBeGreaterThan(n / 10 - 5 * Math.sqrt(n / 10));
      expect(b).toBeLessThan(n / 10 + 5 * Math.sqrt(n / 10));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The laws
// ---------------------------------------------------------------------------

describe('contract rule 18 — a probability ORDERS; only a proof shrinks', () => {
  test('every permutation is a permutation, over adversarial weights and 200 seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const sampler = new SelectionSampler(decisionSeed(seed, seed * 31, 0), DEFAULT_SAMPLING);
      sampler.beginRound(1);
      const n = 1 + (seed % 17);
      const items = Array.from({ length: n }, (_v, i) => `a${i}`);
      // Adversarial: huge spread, exact ties, negatives, zeros.
      const weights = items.map((_v, i) =>
        i % 4 === 0 ? 0 : i % 4 === 1 ? -1000 : i % 4 === 2 ? 1000 : 1e-9,
      );
      const out = sampler.permute(items, 42, weights);
      expect(out.length).toBe(n);
      expect([...out].sort()).toEqual([...items].sort());
    }
  });

  test('a non-finite weight is refused, loudly, rather than silently selected', () => {
    const sampler = new SelectionSampler(1, DEFAULT_SAMPLING);
    sampler.beginRound(1);
    expect(() => sampler.permute(['a', 'b'], 1, [Number.POSITIVE_INFINITY, 0])).toThrow(
      /rule 26/,
    );
    expect(() => sampler.permute(['a', 'b'], 1, [0, Number.NaN])).toThrow(/rule 26/);
  });

  test('the sampler never touches a list of one, and never allocates for it', () => {
    const sampler = new SelectionSampler(1, DEFAULT_SAMPLING);
    sampler.beginRound(1);
    const one = ['solo'];
    expect(sampler.permute(one, 1, [0])).toBe(one);
    expect(sampler.report().draws).toBe(0);
  });
});

describe('contract rule 26 — weights are finite and their regime is recorded', () => {
  test('a WIN ceiling enters at one lattice step above the best finite arm', () => {
    const { values, regime } = clipCeilings([3, Number.POSITIVE_INFINITY, 7, 1]);
    expect(regime).toBe('win-clipped');
    expect(values.every(Number.isFinite)).toBe(true);
    // Top of scale, and FINITE — so Gumbel still explores around it and it
    // cannot capture the scheduler unconditionally, which is R-B1 §9's hole.
    expect(values[1]).toBe(7 + 10);
    expect(values[0]).toBe(3);
    expect(values[2]).toBe(7);
  });

  test('an all-WIN pool clips equal and lets the prior decide', () => {
    const inf = Number.POSITIVE_INFINITY;
    const { values, regime } = clipCeilings([inf, inf, inf]);
    expect(regime).toBe('win-clipped');
    expect(new Set(values).size).toBe(1);
    expect(values.every(Number.isFinite)).toBe(true);
  });

  test('a VACUOUS pool routes to the prior-only channel', () => {
    const { values, regime } = clipCeilings([
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]);
    expect(regime).toBe('vacuous');
    expect(values).toEqual([0, 0]);
    // And the caller drops the material half entirely, so the ranks decide.
    const { weights } = unitWeights(
      [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
      DEFAULT_SAMPLING.lambdaRank,
      DEFAULT_SAMPLING.wMaterial,
    );
    expect(weights[0]).toBeGreaterThan(weights[1] as number);
  });

  test('a SEALED unit sorts last and stays in the permutation — it is not excluded', () => {
    // rule 18 again, at the bottom end: a -Infinity weight is a
    // probability-zero arm, and a probability-zero arm has been removed from
    // the closure set by a policy rather than by a proof.
    const ceilings = [unitCeiling(3, false), unitCeiling(2, true), unitCeiling(1, false)];
    const { values, regime } = clipCeilings(ceilings);
    expect(regime).toBe('normal');
    expect(values.every(Number.isFinite)).toBe(true);
    expect(values[1]).toBe(1 - 10);
    expect(Math.min(...values)).toBe(values[1]);
  });

  test('every weight vector the search builds is finite, over 500 random pools', () => {
    const r = rng(99);
    for (let t = 0; t < 500; t++) {
      const n = 1 + Math.floor(r() * 12);
      const ceilings = Array.from({ length: n }, () => {
        const roll = r();
        return roll < 0.15
          ? Number.POSITIVE_INFINITY
          : roll < 0.3
            ? Number.NEGATIVE_INFINITY
            : Math.round(r() * 40) - 10;
      });
      const u = unitWeights(ceilings, DEFAULT_SAMPLING.lambdaRank, DEFAULT_SAMPLING.wMaterial);
      expect(u.weights.every(Number.isFinite)).toBe(true);
      const p = proposalWeights(
        ceilings.map((c) => (Number.isFinite(c) ? c : null)),
        DEFAULT_SAMPLING.lambdaRank,
        DEFAULT_SAMPLING.wSurrogate,
      );
      expect(p.weights.every(Number.isFinite)).toBe(true);
      expect(candidateWeights(n, DEFAULT_SAMPLING.lambdaRank).every(Number.isFinite)).toBe(true);
    }
  });

  test('the S=0 ablation collapses selection to pure prior order', () => {
    // rule 26's one-optimism tripwire: zero the temperature and the prior, and
    // there must be no second exploration constant left anywhere.
    const sampler = new SelectionSampler(0xdead, ABLATED_SAMPLING);
    sampler.beginRound(1);
    expect(sampler.temperature).toBe(0);
    const items = Array.from({ length: 12 }, (_v, i) => i);
    const flat = candidateWeights(items.length, ABLATED_SAMPLING.lambdaRank);
    expect(new Set(flat).size).toBe(1);
    // Candidate channel: the identity, i.e. exactly `topCandidates`.
    expect(sampler.permute(items, NODE_SWEEP_CANDIDATES, flat)).toEqual(items);
    // Unit channel: pure ceiling order, descending.
    const ceilings = [1, 5, 3, 5, 2];
    const { weights } = unitWeights(
      ceilings,
      ABLATED_SAMPLING.lambdaRank,
      ABLATED_SAMPLING.wMaterial,
    );
    const order = sampler.permute([0, 1, 2, 3, 4], NODE_SWEEP_UNITS, weights);
    expect(order).toEqual([1, 3, 2, 4, 0]);
    expect(sampler.report().draws).toBe(0);
  });
});

describe('contract rule 17 — placement', () => {
  const read = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8');
  const files = ['selection/rng.ts', 'selection/prior.ts', 'selection/sample.ts', 'selection/widen.ts'];

  test('selection/** imports NOTHING from the lobster tree', () => {
    for (const f of files) {
      const src = read(f);
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
      for (const spec of imports) {
        expect(spec.startsWith('./')).toBe(true);
      }
    }
  });

  test('selection/** names no bound, no ledger and no assumption', () => {
    for (const f of files) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src).not.toMatch(/\bScoreBounds\b/);
      expect(src).not.toMatch(/\bprunedLedger\b/);
      expect(src).not.toMatch(/\bAssumption\b/);
      expect(src).not.toMatch(/\bwithNarrowing\b/);
      expect(src).not.toMatch(/\bdeclareTruncatedFloor\b/);
    }
  });

  test('the bounds layer imports nothing from selection (law L3)', () => {
    for (const f of ['bounds/score.ts', 'bounds/bank.ts', 'bounds/plan.ts']) {
      expect(read(f)).not.toMatch(/selection/);
    }
  });

  test('better() reads no sampler — the comparator is bound-derived only', () => {
    // CODE ONLY. The comparator's own docstring MENTIONS the lottery (it has
    // to: the O-P1 slot's whole story is that CL4 must not make it busier), so
    // a grep that read the comments would be asserting a spelling rule instead
    // of a placement law.
    const code = read('search/core.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const start = code.indexOf('const better = (trial: BankResult');
    expect(start).toBeGreaterThan(0);
    const body = code.slice(start, code.indexOf('\n  };', start));
    expect(body).toContain('compareFloors');
    for (const forbidden of ['sampler', 'permute', 'temperature', 'gumbel', 'Math.random']) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('the sampled path never widens a cap', () => {
    // A max-side restriction needs no declaration; a max-side WIDENING would be
    // a different search wearing an ordering's clothes.
    for (let ceiling = 1; ceiling <= 16; ceiling++) {
      for (const spent of [0, 1, 4, 25, 400, 10000]) {
        const k = widenTo(DEFAULT_WIDEN, spent, ceiling);
        expect(k).toBeGreaterThanOrEqual(1);
        expect(k).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  test('the shipped widening schedule is INERT at the shipped cap', () => {
    // Deliberate: the stage's gate is equal-strength at equal work, and a
    // schedule that started narrow would make every number a budget change.
    expect(widenInert(DEFAULT_WIDEN, 8)).toBe(true);
    for (const spent of [0, 3, 40, 900]) expect(widenTo(DEFAULT_WIDEN, spent, 8)).toBe(8);
    // It is one knob away from live, and it grows sub-linearly when it is.
    const narrow = { k0: 2, c: 2, alpha: 0.5 };
    expect(widenTo(narrow, 0, 16)).toBe(2);
    expect(widenTo(narrow, 4, 16)).toBe(6);
    expect(widenTo(narrow, 100, 16)).toBe(16);
  });
});

describe('the flag', () => {
  test('is off unless it is on', () => {
    expect(sampledCapFrom({})).toBe(false);
    expect(sampledCapFrom({ [SAMPLED_CAP_ENV]: '0' })).toBe(false);
    expect(sampledCapFrom({ [SAMPLED_CAP_ENV]: 'off' })).toBe(false);
    for (const on of ['1', 'on', 'true']) {
      expect(sampledCapFrom({ [SAMPLED_CAP_ENV]: on })).toBe(true);
    }
  });

  test('a core that was not asked for it reports no selection at all', () => {
    const core = makeSearchCore({ sampledCap: false });
    expect(core.selectionReport?.() ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. The temperature schedule (owner Q1)
// ---------------------------------------------------------------------------

describe('the temperature schedule — owner Q1, as data', () => {
  test('the shipped table', () => {
    const t = DEFAULT_SAMPLING;
    const rows = [1, 0.75, 0.5, 0.3, 0.2, 0.1, 0].map((f) => [f, temperatureAt(t, f)] as const);
    process.stdout.write(
      `  T(f) = max(${t.tMin}, ${t.t0}·f^${t.gamma}): ` +
        rows.map(([f, T]) => `${f}→${T.toFixed(4)}`).join('  ') +
        '\n',
    );
    expect(temperatureAt(t, 1)).toBeCloseTo(0.25, 10);
    expect(temperatureAt(t, 0.5)).toBeCloseTo(0.0625, 10);
    expect(temperatureAt(t, 0.3)).toBeCloseTo(0.0225, 10);
    // COOLING SHARPLY: half the clock left is a QUARTER of the temperature.
    expect(temperatureAt(t, 0.5)).toBeCloseTo(temperatureAt(t, 1) / 4, 10);
  });

  test('ALWAYS ON: the floor is above zero, at every clock', () => {
    for (const f of [0.2, 0.1, 0.01, 0, -1]) {
      expect(temperatureAt(DEFAULT_SAMPLING, f)).toBe(DEFAULT_SAMPLING.tMin);
      expect(temperatureAt(DEFAULT_SAMPLING, f)).toBeGreaterThan(0);
    }
  });

  test('monotone: more clock is never colder', () => {
    let prev = -1;
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const t = temperatureAt(DEFAULT_SAMPLING, f);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  test('at full clock the lottery is exactly ZIPF over the generator order', () => {
    // λ_rank = t0 makes softmax(λ·(−log(r+1)) / t0) come out as ∝ 1/(r+1),
    // which is the one statement about this lottery a reader can check by hand.
    expect(DEFAULT_SAMPLING.lambdaRank).toBe(DEFAULT_SAMPLING.t0);
    const n = 20;
    const weights = candidateWeights(n, DEFAULT_SAMPLING.lambdaRank);
    const T = temperatureAt(DEFAULT_SAMPLING, 1);
    const p = weights.map((w) => Math.exp(w / T));
    const total = p.reduce((a, b) => a + b, 0);
    for (let r = 0; r < n; r++) {
      expect((p[r] as number) / total).toBeCloseTo(1 / (r + 1) / harmonic(n), 10);
    }
    // Empirically, over 4000 seeds: the top-1 frequency matches.
    const counts = new Array<number>(n).fill(0);
    for (let seed = 0; seed < 4000; seed++) {
      const sampler = new SelectionSampler(decisionSeed(seed, 1, 0), DEFAULT_SAMPLING);
      sampler.beginRound(1);
      const out = sampler.permute(
        Array.from({ length: n }, (_v, i) => i),
        5,
        weights,
      );
      counts[out[0] as number]++;
    }
    for (const r of [0, 1, 2, 5]) {
      const expected = (4000 / (r + 1) / harmonic(n));
      expect(counts[r] as number).toBeGreaterThan(expected - 5 * Math.sqrt(expected));
      expect(counts[r] as number).toBeLessThan(expected + 5 * Math.sqrt(expected));
    }
    process.stdout.write(
      `  Gumbel-top-1 over 20 ranks, 4000 seeds, hot: ` +
        counts.slice(0, 6).map((c, r) => `r${r}=${c}(${(4000 / (r + 1) / harmonic(20)).toFixed(0)})`).join(' ') +
        '\n',
    );
  });

  test('the clock collapses the lottery onto the prefix — Q1, measured', () => {
    // "May the lottery go effectively cold when there's only time to examine a
    // handful of branches, warming back up whenever there's surplus time?"
    // Default: yes, sharply. Here is what "sharply" is worth, as two numbers a
    // reader can argue with: how often the generator's own first choice is
    // still tried FIRST, and how much of the deterministic top-8 SET survives.
    //
    // The set, not the order within it: the cap is a MEMBERSHIP question — which
    // eight options get priced — and their sequence inside the prefix costs
    // nothing, because all eight are priced either way.
    const n = 24;
    const cap = 8;
    const trials = 2000;
    const weights = candidateWeights(n, DEFAULT_SAMPLING.lambdaRank);
    const measure = (fraction: number): { first: number; kept: number } => {
      let first = 0;
      let kept = 0;
      for (let seed = 0; seed < trials; seed++) {
        const sampler = new SelectionSampler(decisionSeed(seed, 2, 0), DEFAULT_SAMPLING);
        sampler.beginRound(fraction);
        const out = sampler.permute(
          Array.from({ length: n }, (_v, i) => i),
          5,
          weights,
        );
        if (out[0] === 0) first++;
        kept += out.slice(0, cap).filter((v) => v < cap).length;
      }
      return { first: first / trials, kept: kept / trials };
    };
    const hot = measure(1);
    const mid = measure(0.5);
    const cold = measure(0);
    for (const [label, m] of [
      ['hot   (f=1.00, T=0.2500)', hot],
      ['warm  (f=0.50, T=0.0625)', mid],
      ['cold  (f≤0.20, T=0.0200)', cold],
    ] as const) {
      process.stdout.write(
        `  ${label}: rank-0 tried first ${(m.first * 100).toFixed(1)}% | ` +
          `${m.kept.toFixed(2)} of 8 prefix options kept\n`,
      );
    }
    // COLD: the generator's own answer is what gets tried, essentially always,
    // and essentially the whole prefix survives. Effectively cold — and still
    // not exactly cold, which is the "always on" half of the default.
    expect(cold.first).toBeGreaterThan(0.99);
    expect(cold.kept).toBeGreaterThan(7);
    // STILL NOT EXACTLY COLD, and this is where that shows. At T = 0.02 the
    // Zipf exponent is 12.5, so rank 0 loses about once in 5,000 draws — a
    // 2,000-trial sample sees 100.0% and says nothing. The prefix membership
    // does show it: a quarter of an option per draw still comes from beyond the
    // cap, which is the "always on" half of Q1's default surviving all the way
    // to the floor. The floor being above zero is the property; this is its
    // observable consequence.
    expect(cold.kept).toBeLessThan(8);
    // HOT: a genuine lottery. Zipf over 24 ranks puts rank 0 first about
    // 1/H(24) ≈ 26% of the time, and a quarter of the prefix is replaced by
    // options the deterministic search would never have looked at.
    expect(hot.first).toBeLessThan(0.35);
    expect(hot.kept).toBeLessThan(7);
    // MONOTONE IN THE CLOCK, which is the whole shape Q1 asked about.
    expect(mid.first).toBeGreaterThan(hot.first);
    expect(cold.first).toBeGreaterThan(mid.first);
    expect(mid.kept).toBeGreaterThan(hot.kept);
    expect(cold.kept).toBeGreaterThan(mid.kept);
  });
});

const harmonic = (n: number): number => {
  let h = 0;
  for (let i = 1; i <= n; i++) h += 1 / i;
  return h;
};

// ---------------------------------------------------------------------------
// 4. Determinism
// ---------------------------------------------------------------------------

interface Run {
  readonly plan: JointPlan;
  readonly key: string;
  readonly floor: number;
  readonly seed: number | null;
  readonly far: number;
  readonly admitted: number;
  readonly adjudication: AdjudicationReport;
  readonly priced: ReadonlyArray<string>;
  /** Distinct (unit, option rank) pairs the search put UNDER TEST. */
  readonly tested: number;
  /** Distinct pairs that merely APPEARED in a priced plan — mostly incumbent
   * churn, kept beside `tested` so the report can say which is which. */
  readonly appeared: number;
  /** Of those, options at or beyond the deterministic prefix's own width. */
  readonly farPriced: number;
}

/** The bank's `price` calls, recorded, so a probe can see what the search TRIED
 * rather than only what it staged. The determinism gate does the same thing for
 * the same reason. */
let traced: JointPlan[] | null = null;
const realPrice = BoundBank.prototype.price;
beforeAll(() => {
  BoundBank.prototype.price = function patched(
    this: BoundBank,
    plan: Parameters<typeof realPrice>[0],
  ) {
    traced?.push(plan);
    return realPrice.call(this, plan);
  };
});
afterAll(() => {
  BoundBank.prototype.price = realPrice;
});

function improveRun(
  board: Board,
  arm: {
    sampledCap: boolean;
    matchSeed?: number;
    clusterSeed?: boolean;
    clusterEnum?: boolean;
    channels?: SamplingTuning['channels'];
  },
  questions: number,
  cap = 8,
): Run {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  const asTeam = sub.teamNumber('red');
  const gen = new GrammarCandidateGenerator({});
  // The same generator the core will use, so a candidate's RANK here is its
  // rank there. `candidatesFor` is a pure function of (substrate, unit).
  const ranks = new Map<UnitId, Map<string, number>>();
  for (const unitId of sub.commandable(asTeam)) {
    const table = new Map<string, number>();
    gen.candidatesFor(sub, unitId).candidates.forEach((c, i) => table.set(candidateKey(c), i));
    ranks.set(unitId, table);
  }
  const core = makeSearchCore({
    sampledCap: arm.sampledCap,
    candidateCap: cap,
    clusterSeed: arm.clusterSeed ?? false,
    clusterEnum: arm.clusterEnum ?? false,
    seedDeconflict: !(arm.clusterSeed ?? false),
    rungZeroRepair: false,
    samplingTuning: {
      ...(arm.matchSeed === undefined ? {} : { matchSeed: arm.matchSeed }),
      ...(arm.channels === undefined ? {} : { channels: arm.channels }),
    },
  });
  const ctx: SearchContext = {
    sub,
    gen,
    evaluate: defaultEvaluator,
    asTeam,
    pins: [],
    assumptions: [],
    incumbent: null,
    witnesses: [],
    budget: countingBudget(questions),
  };
  const calls: JointPlan[] = [];
  traced = calls;
  const scored = core.improve(ctx);
  traced = null;
  const report = core.selectionReport?.() ?? null;
  const adjudication = core.adjudicationReport?.() ?? {
    floorDecided: 0,
    estDecided: 0,
    ceilingDecided: 0,
    tieKeyDecided: 0,
    vetoed: 0,
    refused: 0,
  };
  // WHAT THE SEARCH PUT UNDER TEST, which is not the same as what appeared in
  // a priced plan.
  //
  // Every price names EVERY unit, so counting (unit, option rank) over whole
  // plans mostly counts INCUMBENT CHURN — the five units that did not move.
  // What this stage moves is the option actually being tried, and `sweep`
  // prices `withMove(best.plan, candidate)` repeatedly from one incumbent, so
  // consecutive priced plans differ in exactly the unit under test. That diff
  // is the instrument; the whole-plan count is kept beside it, and the report
  // says plainly which one carries the claim.
  const tested = new Set<string>();
  const appeared = new Set<string>();
  let farPriced = 0;
  const rankOf = (unitId: UnitId, key: string): number | undefined =>
    ranks.get(unitId)?.get(key);
  let previous: Map<UnitId, string> | null = null;
  for (const plan of calls) {
    const keys = new Map<UnitId, string>();
    for (const [unitId, candidate] of plan) keys.set(unitId, candidateKey(candidate));
    for (const [unitId, key] of keys) {
      const rank = rankOf(unitId, key);
      if (rank === undefined) continue;
      appeared.add(`${unitId}#${rank}`);
      if (previous !== null && previous.get(unitId) === key) continue;
      const id = `${unitId}#${rank}`;
      if (tested.has(id)) continue;
      tested.add(id);
      if (rank >= cap) farPriced++;
    }
    previous = keys;
  }
  const out: Run = {
    plan: scored.plan,
    key: planKey(scored.plan),
    floor: scored.bounds.worst,
    seed: report?.seed ?? null,
    far: report?.farAdmitted ?? 0,
    admitted: report?.admitted ?? 0,
    adjudication,
    priced: calls.map((p) => planKey(p)),
    tested: tested.size,
    appeared: appeared.size,
    farPriced,
  };
  core.release?.();
  sub.release();
  return out;
}

describe('determinism', () => {
  test('THE SAME SEED IS THE SAME DECISION, bit for bit', () => {
    for (let s = 0; s < 8; s++) {
      const board = snakesBoard(s);
      const a = improveRun(board, { sampledCap: true, matchSeed: 0xc0ffee }, 32);
      const b = improveRun(board, { sampledCap: true, matchSeed: 0xc0ffee }, 32);
      expect(b.seed).toBe(a.seed);
      expect(b.key).toBe(a.key);
      expect(b.floor).toBe(a.floor);
      // Not just the answer — the whole SEQUENCE of prices that produced it.
      expect(b.priced).toEqual(a.priced);
    }
  });

  test('a different seed may decide differently — and every gate still holds', () => {
    // PIECE boards, and that is not incidental. Under "exact where complete"
    // the lottery takes no draw at all for a unit whose whole option list fits
    // inside the cap, so on the trail families it is provably inert and two
    // seeds are the SAME decision — which is the right behaviour and the wrong
    // fixture for this test.
    let differed = 0;
    for (let s = 0; s < 20; s++) {
      const board = pieceBoard(s);
      const a = improveRun(board, { sampledCap: true, matchSeed: 1 }, 32);
      const b = improveRun(board, { sampledCap: true, matchSeed: 2 }, 32);
      if (a.key !== b.key) differed++;
      // Whatever the seed: a complete legal plan, over the whole roster, with a
      // real floor. Sampling chose where the prices went, not what was staged.
      expect(b.plan.size).toBe(a.plan.size);
      expect(Number.isNaN(b.floor)).toBe(false);
    }
    process.stdout.write(`  two private seeds decide differently on ${differed}/20 boards\n`);
    // NON-VACUITY: a lottery that never changes anything is not a lottery.
    expect(differed).toBeGreaterThan(0);
  });

  test('PREFIX DETERMINISM: a bigger budget EXTENDS a smaller one', () => {
    // The replay contract, and a strictly stronger gate than byte-identity:
    // "for budgets B < B', the sequence of decisions at B is a PREFIX of the
    // sequence at B'". Per-node draw counters are what buy it — a budget that
    // reaches a node twice takes that node's first two draws whatever happened
    // elsewhere.
    for (let s = 0; s < 10; s++) {
      const board = snakesBoard(s);
      const short = improveRun(board, { sampledCap: true, matchSeed: 5 }, 12);
      const long = improveRun(board, { sampledCap: true, matchSeed: 5 }, 64);
      expect(long.priced.length).toBeGreaterThanOrEqual(short.priced.length);
      expect(long.priced.slice(0, short.priced.length)).toEqual(short.priced);
    }
  });

  test('the flag-off path never constructs a sampler and never reads the clock', () => {
    const board = snakesBoard(3);
    const off = improveRun(board, { sampledCap: false }, 32);
    expect(off.seed).toBeNull();
    expect(off.admitted).toBe(0);
    // And it decides what it always decided: two flag-off runs agree.
    const again = improveRun(board, { sampledCap: false }, 32);
    expect(again.priced).toEqual(off.priced);
    expect(again.key).toBe(off.key);
  });

  test('THE DISPATCH SEQUENCE IS THE SAMPLED SEQUENCE, decided before any worker runs', () => {
    // §3.0 note 3 / contract rule 20. `Frontier.order` is a PEEK at the draw the
    // next slice will take, so the plans the workers price are the plans the
    // coordinator is about to ask for — in the order it will ask for them.
    const sampler = new SelectionSampler(decisionSeed(0, 7, 0), DEFAULT_SAMPLING);
    sampler.beginRound(1);
    const units = [3, 1, 2] as UnitId[];
    const { weights } = unitWeights([2, 1, 3], DEFAULT_SAMPLING.lambdaRank, DEFAULT_SAMPLING.wMaterial);
    const peeked = sampler.peek(units, NODE_SWEEP_UNITS, weights);
    // Peeking twice gives the same answer and takes no draw...
    expect(sampler.peek(units, NODE_SWEEP_UNITS, weights)).toEqual(peeked);
    expect(sampler.report().draws).toBe(0);
    // ...and the real draw, when it comes, IS the peeked one.
    expect(sampler.permute(units, NODE_SWEEP_UNITS, weights)).toEqual(peeked);
    expect(sampler.report().draws).toBe(3);
    // The NEXT visit is a different permutation address, and peeking now
    // predicts THAT one.
    const nextPeek = sampler.peek(units, NODE_SWEEP_UNITS, weights);
    expect(sampler.permute(units, NODE_SWEEP_UNITS, weights)).toEqual(nextPeek);
  });

  test('the frontier the worker cut sees is the order it was handed', () => {
    const board = snakesBoard(1);
    const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
    const asTeam = sub.teamNumber('red');
    const gen = new GrammarCandidateGenerator({});
    const roster = sub.commandable(asTeam);
    const sets = new Map(roster.map((id) => [id, gen.candidatesFor(sub, id)]));
    const core = makeSearchCore({ rungZeroRepair: false, seedDeconflict: true });
    const scored = core.improve({
      sub,
      gen,
      evaluate: defaultEvaluator,
      asTeam,
      pins: [],
      assumptions: [],
      incumbent: null,
      witnesses: [],
      budget: countingBudget(24),
    });
    // A hand-built frontier is the only way to see the seam in isolation.
    const incumbent = {
      plan: scored.plan,
      bounds: scored.bounds,
      worstResolution: null,
    } as unknown as Frontier['incumbent'];
    const base: Frontier = { roster, sets, pinned: new Set(), incumbent, candidateCap: 4 };
    const reversed = [...roster].reverse();
    const withOrder: Frontier = {
      ...base,
      order: {
        units: reversed,
        candidatesFor: (unitId: UnitId) =>
          [...(sets.get(unitId)?.candidates ?? [])].slice(0, 2).reverse(),
      },
    };
    const plain = sweepFrontier(base);
    const ordered = sweepFrontier(withOrder);
    // Different order in, different order out — the partition does not
    // re-derive a sequence of its own.
    expect(ordered.length).toBeGreaterThan(0);
    expect(ordered.map((p) => [...p].join(','))).not.toEqual(plain.map((p) => [...p].join(',')));
    // And an ABSENT order is byte-for-byte the shipped cut.
    expect(planBatchPartition(0, 8).partition(base, 1)).toEqual(
      planBatchPartition(0, 8).partition({ ...base }, 1),
    );
    core.release?.();
    sub.release();
  });
});

// ---------------------------------------------------------------------------
// 5. The probe
// ---------------------------------------------------------------------------

/**
 * CONFRONTED — CL1's ship-criterion generator, byte for byte, so this stage's
 * numbers sit beside CL1's and CL3's.
 */
function snakesBoard(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  const anchors: Array<[number, number, string]> = [];
  const rx = 2 + Math.floor(r() * 3);
  const ry = 2 + Math.floor(r() * 6);
  anchors.push([rx, ry, 'red'], [rx + 2, ry, 'red'], [rx + 1, ry + 1, 'red']);
  const bx = 6 + Math.floor(r() * 2);
  const by = 2 + Math.floor(r() * 6);
  anchors.push([bx, by, 'blue'], [bx + 2, by, 'blue'], [bx + 1, by + 1, 'blue']);
  for (let i = 0; i < anchors.length; i++) {
    const [hx, hy, team] = anchors[i] as [number, number, string];
    const body: Coord[] = [];
    if (!take(hx, hy)) continue;
    body.push({ x: hx, y: hy });
    const len = 3 + Math.floor(r() * 3);
    let d = Math.floor(r() * 4);
    for (let j = 1; j < len; j++) {
      if (r() < 0.4) d = (d + (r() < 0.5 ? 1 : 3)) % 4;
      const prev = body[body.length - 1] as Coord;
      let stepped = false;
      for (let k = 0; k < 4 && !stepped; k++) {
        const dd = DIRS[(d + k) % 4] as readonly [number, number];
        if (take(prev.x + dd[0], prev.y + dd[1])) {
          body.push({ x: prev.x + dd[0], y: prev.y + dd[1] });
          d = (d + k) % 4;
          stepped = true;
        }
      }
      if (!stepped) break;
    }
    if (body.length < 2) continue;
    snakes.push(makeSnake(`u${i}`, body, { teamID: team, health: 40 + Math.floor(r() * 50) }));
  }
  return { width: size, height: size, food: [], hazards: [], snakes } as Board;
}

/** SCATTERED — six trail units anywhere; the dominant hazard is a unit's own body. */
function scatteredBoard(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x >= size - 1 || y >= size - 1 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  for (let i = 0; i < 6 && snakes.length < 6; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 40 && !placed; attempt++) {
      const x = 1 + Math.floor(r() * (size - 2));
      const y = 1 + Math.floor(r() * (size - 2));
      if (used.has(`${x},${y}`)) continue;
      const body: Coord[] = [];
      const claimed: string[] = [];
      const push = (cx: number, cy: number): boolean => {
        if (!take(cx, cy)) return false;
        body.push({ x: cx, y: cy });
        claimed.push(`${cx},${cy}`);
        return true;
      };
      if (!push(x, y)) continue;
      const len = 3 + Math.floor(r() * 3);
      let d = Math.floor(r() * 4);
      for (let j = 1; j < len; j++) {
        if (r() < 0.4) d = (d + (r() < 0.5 ? 1 : 3)) % 4;
        const prev = body[body.length - 1] as Coord;
        const step = DIRS[d] as readonly [number, number];
        if (!push(prev.x + step[0], prev.y + step[1])) break;
      }
      if (body.length < 3) {
        for (const key of claimed) used.delete(key);
        continue;
      }
      snakes.push(
        makeSnake(`u${i}`, body, {
          teamID: i % 2 === 0 ? 'red' : 'blue',
          health: 30 + Math.floor(r() * 60),
        }),
      );
      placed = true;
    }
  }
  return { width: size, height: size, food: [], hazards: [], snakes } as Board;
}

/**
 * PIECES — i2's exemplar class, and the ONLY family where this stage's
 * mechanism can be seen at all.
 *
 * i2's diagnosis is *"the search only ever walks the eight shortest moves per
 * sweep"*, and that sentence is only true where a unit HAS more than eight
 * moves. A trail unit has three or four; a queen on an open board has twenty
 * or more. So the far-option entry rate — the number this stage exists to move
 * — is identically zero on a snake board by construction, and CL2 §7.5 said the
 * same thing about the acceptance fixture: *"the promotion evidence has to come
 * from piece boards — b16-class, exactly what i2's falsifier prescribes."*
 */
function pieceBoard(seed: number): Board {
  const r = rng(seed);
  const size = 11;
  const used = new Set<string>();
  const snakes: Snake[] = [];
  const take = (x: number, y: number): boolean => {
    if (x < 2 || y < 2 || x >= size - 2 || y >= size - 2 || used.has(`${x},${y}`)) return false;
    used.add(`${x},${y}`);
    return true;
  };
  const kinds = ['queen', 'rook', 'bishop', 'knight'];
  for (let i = 0; i < 6; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = 2 + Math.floor(r() * (size - 4));
      const y = 2 + Math.floor(r() * (size - 4));
      if (!take(x, y)) continue;
      snakes.push(
        makeSnake(`p${i}`, [{ x, y }], {
          teamID: i % 2 === 0 ? 'red' : 'blue',
          unitType: kinds[i % kinds.length] as string,
          length: 2 + Math.floor(r() * 3),
          health: 15 + Math.floor(r() * 70),
        }),
      );
      break;
    }
  }
  const food: Coord[] = [];
  for (let i = 0; i < 10; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = 1 + Math.floor(r() * (size - 2));
      const y = 1 + Math.floor(r() * (size - 2));
      if (used.has(`${x},${y}`)) continue;
      used.add(`${x},${y}`);
      food.push({ x, y });
      break;
    }
  }
  return { width: size, height: size, food, hazards: [], snakes } as unknown as Board;
}

interface Tally {
  dead: number;
  mates: number;
  differed: number;
  tested: number;
  appeared: number;
  far: number;
  ceilingDecided: number;
  floor: number;
  finite: number;
}

const zero = (): Tally => ({
  dead: 0,
  mates: 0,
  differed: 0,
  tested: 0,
  appeared: 0,
  far: 0,
  ceilingDecided: 0,
  floor: 0,
  finite: 0,
});

/** The resolver's verdict on one staged plan: our dead, and how many of them a
 * team-mate killed. CL3's probe counts exactly this, exactly this way. */
function verdictOf(board: Board, plan: JointPlan): { dead: number; mates: number } {
  const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
  try {
    const asTeam = sub.teamNumber('red');
    const ours = new Set<UnitId>(sub.commandable(asTeam));
    return sub.withResolution(plan, asTeam, ({ resolution }) => {
      const died = resolution.deaths.filter((d) => ours.has(d.unitId as UnitId));
      let killed = 0;
      for (const d of died) {
        for (const clash of resolution.clashes) {
          if (!clash.victimIDs.includes(d.unitId)) continue;
          if (clash.playerIDs.some((id) => id !== d.unitId && ours.has(id as UnitId))) killed++;
          break;
        }
      }
      return { dead: died.length, mates: killed };
    });
  } finally {
    sub.release();
  }
}

describe('the probe: what the lottery buys, and what it must not cost', () => {
  const BOARDS = 40;
  const BUDGETS = [8, 32, 120] as const;

  const families: ReadonlyArray<{ name: string; make: (seed: number) => Board }> = [
    { name: 'pieces', make: pieceBoard },
    { name: 'confronted', make: snakesBoard },
    { name: 'scattered', make: scatteredBoard },
  ];

  for (const family of families) {
    test(
      `${family.name}: diversity rises, fatal stagings do not`,
      () => {
        let totalOffMates = 0;
        let totalOnMates = 0;
        for (const questions of BUDGETS) {
          const off = zero();
          const on = zero();
          for (let seed = 0; seed < BOARDS; seed++) {
            const board = family.make(seed);
            const a = improveRun(board, { sampledCap: false }, questions);
            const b = improveRun(board, { sampledCap: true, matchSeed: 0x51_4c_54 }, questions);
            for (const [tally, run] of [
              [off, a],
              [on, b],
            ] as const) {
              const v = verdictOf(board, run.plan);
              tally.dead += v.dead;
              tally.mates += v.mates;
              tally.tested += run.tested;
              tally.appeared += run.appeared;
              tally.far += run.farPriced;
              tally.ceilingDecided += run.adjudication.ceilingDecided;
              if (Number.isFinite(run.floor)) {
                tally.floor += run.floor;
                tally.finite++;
              }
            }
            if (a.key !== b.key) on.differed++;
          }
          process.stdout.write(
            `  ${family.name} q=${questions} x${BOARDS}: ` +
              `fatal ${off.dead}->${on.dead} | teammate-caused ${off.mates}->${on.mates} | ` +
              `plans differ ${on.differed}/${BOARDS} | ` +
              `options under test ${off.tested}->${on.tested} ` +
              `(appearing ${off.appeared}->${on.appeared}) | ` +
              `FAR options ${off.far}->${on.far} | ` +
              `hi-decided ${off.ceilingDecided}->${on.ceilingDecided} | ` +
              `mean floor ${(off.floor / Math.max(1, off.finite)).toFixed(3)}->` +
              `${(on.floor / Math.max(1, on.finite)).toFixed(3)}\n`,
          );
          // GATE 1 — fatal stagings may not rise, at any point of the curve.
          // Same shape and same reason as CL3's: this is a generator, and a
          // generator's value is largest where the verifier has least budget,
          // so one point would hide the mechanism.
          expect(on.dead).toBeLessThanOrEqual(off.dead);
          // GATE 2 — THE LOTTERY REACHES PAST THE PREFIX AND THE TWIN DOES NOT.
          //
          // Less an assertion about the lottery than about the arm it is
          // measured against. The deterministic search has exactly ONE
          // unbounded reach into a unit's option list — `perturb`, which
          // indexes `options[(step·7+1) mod options.length]` over the FULL list
          // rather than a capped one, and which fires only after convergence,
          // at the deep end of the budget. Measured: ONE far option across 120
          // board-runs of the pieces family, against 72 for the lottery at the
          // same budget. The twin's far count is not zero; it is a rounding
          // error, and that is the honest form of the claim.
          expect(on.far).toBeGreaterThanOrEqual(off.far);
          // GATE 3 — OPTIMISM DID NOT GET BUSIER (law L17). The comparator's
          // ceiling slot is O-P1's open hole and Stage 3a's to close; a sampler
          // that fed it more work would be widening it. Aggregate over the
          // curve, because a single starved point is noise.
          totalOffMates += off.mates;
          totalOnMates += on.mates;
        }
        // GATE 4 — teammate kills, in AGGREGATE over the curve. The asymmetry
        // is CL3's and the reason is CL3's: `better()` adjudicates on the
        // PROVED FLOOR while a teammate kill is counted in the NOMINAL
        // resolution, so a plan with a strictly better guaranteed floor can
        // carry a worse nominal outcome, and refusing that trade would be
        // refusing the floor.
        process.stdout.write(
          `  ${family.name} TOTAL teammate-caused ${totalOffMates} -> ${totalOnMates}\n`,
        );
        expect(totalOnMates).toBeLessThanOrEqual(totalOffMates);
      },
      300000,
    );
  }

  test(
    'CHANNEL ATTRIBUTION: which half of the lottery costs, and which pays',
    () => {
      // The measurement that set `DEFAULT_SAMPLING.channels`. Three arms at the
      // starved budget, on all three families: the deterministic twin, the
      // candidate channel alone (shipped), and both channels. Reported rather
      // than asserted, except for the one inequality that decided the default.
      const arms = [
        ['candidates only (shipped)', { candidates: true, units: false, proposals: true }],
        ['candidates + units', { candidates: true, units: true, proposals: true }],
        ['units only', { candidates: false, units: true, proposals: true }],
      ] as const;
      for (const family of families) {
        const off = zero();
        const on = arms.map(() => zero());
        for (let seed = 0; seed < BOARDS; seed++) {
          const board = family.make(seed);
          const base = improveRun(board, { sampledCap: false }, 8);
          const v = verdictOf(board, base.plan);
          off.dead += v.dead;
          off.far += base.farPriced;
          if (Number.isFinite(base.floor)) {
            off.floor += base.floor;
            off.finite++;
          }
          arms.forEach(([, channels], i) => {
            const run = improveRun(
              board,
              { sampledCap: true, matchSeed: 0x51_4c_54, channels },
              8,
            );
            const w = verdictOf(board, run.plan);
            const t = on[i] as Tally;
            t.dead += w.dead;
            t.far += run.farPriced;
            if (Number.isFinite(run.floor)) {
              t.floor += run.floor;
              t.finite++;
            }
          });
        }
        process.stdout.write(
          `  ${family.name} q=8: deterministic fatal ${off.dead} floor ` +
            `${(off.floor / Math.max(1, off.finite)).toFixed(2)} far ${off.far}\n`,
        );
        arms.forEach(([label], i) => {
          const t = on[i] as Tally;
          process.stdout.write(
            `      ${label.padEnd(26)} fatal ${t.dead} floor ` +
              `${(t.floor / Math.max(1, t.finite)).toFixed(2)} far ${t.far}\n`,
          );
        });
        // THE DECISION: the unit channel may not be the shipped default while
        // it stages more of our own units dead than the twin does. It is one
        // knob, it is measured, and this is the assertion that keeps it off
        // until somebody moves the number.
        const shipped = on[0] as Tally;
        expect(shipped.dead).toBeLessThanOrEqual(off.dead);
      }
    },
    300000,
  );

  test(
    'THE MECHANISM: far options enter, and only where a unit HAS far options',
    () => {
      // i2's falsifier instrument, stated as the two numbers that matter: how
      // many options beyond the deterministic prefix the search priced, and on
      // how many boards at least one arrived.
      for (const family of families) {
        let far = 0;
        let boardsWithFar = 0;
        let wide = 0;
        for (let seed = 0; seed < BOARDS; seed++) {
          const board = family.make(seed);
          const run = improveRun(board, { sampledCap: true, matchSeed: 0x51_4c_54 }, 32);
          far += run.farPriced;
          if (run.farPriced > 0) boardsWithFar++;
          const sub = makeSubstrate({ board, turn: TURN, asTeam: 'red' });
          const gen = new GrammarCandidateGenerator({});
          for (const id of sub.commandable(sub.teamNumber('red'))) {
            if (gen.candidatesFor(sub, id).candidates.length > 8) wide++;
          }
          sub.release();
        }
        process.stdout.write(
          `  ${family.name}: units with >8 options ${wide}; far options priced ${far}; ` +
            `boards with ≥1 far option ${boardsWithFar}/${BOARDS}\n`,
        );
        // Where a unit has more options than the cap, the lottery must reach
        // past it. Where it does not, there is nothing past the cap to reach
        // and a nonzero count would be a bug in the instrument.
        if (wide > 0) expect(far).toBeGreaterThan(0);
        else expect(far).toBe(0);
      }
    },
    300000,
  );
});

// ---------------------------------------------------------------------------
// 6. The budget
// ---------------------------------------------------------------------------

describe('the µs budget', () => {
  test('what a real decision actually draws', () => {
    // The synthetic pass below is a WORST CASE — every unit wide, every round,
    // every channel. What a shipped decision draws is bounded by two gates that
    // the synthetic workload switches off: the unit channel is off by default,
    // and "exact where complete" takes no draw at all for a unit whose option
    // list fits inside the cap. So the honest cost figure is arms × ns/arm with
    // the arms counted on real boards.
    for (const [label, make] of [
      ['pieces', pieceBoard],
      ['confronted', snakesBoard],
    ] as const) {
      let arms = 0;
      let draws = 0;
      const boards = 20;
      for (let seed = 0; seed < boards; seed++) {
        const sub = makeSubstrate({ board: make(seed), turn: TURN, asTeam: 'red' });
        const asTeam = sub.teamNumber('red');
        const core = makeSearchCore({
          sampledCap: true,
          rungZeroRepair: false,
          seedDeconflict: true,
          samplingTuning: { matchSeed: 0x51_4c_54 },
        });
        core.improve({
          sub,
          gen: new GrammarCandidateGenerator({}),
          evaluate: defaultEvaluator,
          asTeam,
          pins: [],
          assumptions: [],
          incumbent: null,
          witnesses: [],
          budget: countingBudget(120),
        });
        const r = core.selectionReport?.() ?? null;
        arms += r?.arms ?? 0;
        draws += r?.draws ?? 0;
        core.release?.();
        sub.release();
        clearGeometryCache();
      }
      process.stdout.write(
        `  ${label}: ${(arms / boards).toFixed(1)} arms and ${(draws / boards).toFixed(1)} ` +
          `draws per decision at q=120\n`,
      );
    }
  });

  test('a decision-sized sampling pass, measured', () => {
    // A DECISION'S WORTH: six sweep rounds, each ordering six units and then
    // each unit's eight options — 6 × (6 + 6×8) = 324 arms. Two logs per arm is
    // the whole cost; there is no allocation per draw and no string built.
    const sampler = new SelectionSampler(decisionSeed(1, 2, 3), DEFAULT_SAMPLING);
    const units = Array.from({ length: 6 }, (_v, i) => i as UnitId);
    const options = Array.from({ length: 8 }, (_v, i) => i);
    const unitW = unitWeights([3, 1, 2, 2, 1, 3], DEFAULT_SAMPLING.lambdaRank, DEFAULT_SAMPLING.wMaterial).weights;
    const optW = candidateWeights(8, DEFAULT_SAMPLING.lambdaRank);
    const decision = (): void => {
      sampler.beginRound(0.6);
      for (let round = 0; round < 6; round++) {
        sampler.permute(units, NODE_SWEEP_UNITS, unitW);
        for (const u of units) sampler.permute(options, mix(NODE_SWEEP_CANDIDATES, u), optW);
      }
    };
    for (let i = 0; i < 2000; i++) decision(); // warm
    const reps = 2000;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < reps; i++) decision();
    const us = Number(process.hrtime.bigint() - t0) / 1000 / reps;
    const arms = 6 * (6 + 6 * 8);
    const nsPerArm = (us * 1000) / arms;
    process.stdout.write(
      `  worst-case pass: ${us.toFixed(2)} µs over ${arms} arms ` +
        `(${nsPerArm.toFixed(1)} ns/arm, in-harness) — at 57 arms, ` +
        `${((nsPerArm * 57) / 1000).toFixed(2)} µs/decision\n`,
    );
    // THE BUDGET IS PER ARM, NOT PER SYNTHETIC DECISION.
    //
    // The 10 µs/decision target came with the reasoning "Gumbel keys are one
    // log per candidate" — a cost stated per CANDIDATE, and the number of
    // candidates is what the two gates above decide. Measured on real boards:
    // 57.3 drawn arms per decision on the piece family and 0.2 on the trail
    // families, so the target is a per-arm budget of 175 ns. The honest Gumbel
    // key is TWO logs (`−log(−log u)`); the one-log algebraic twin is exactly
    // order-equivalent but overflows at the cold end of the schedule, where
    // `w/T` reaches the thousands, and 9 ns is not worth an infinity.
    //
    // IN-HARNESS IS NOT THE FIGURE. Under ts-jest every cross-module call goes
    // through the module registry and the measured per-arm cost is ~30× the
    // compiled one on this box (2.3 µs against 72 ns). So this assertion is a
    // BLOWUP GUARD — it catches an accidental O(n²) or an allocation in the
    // draw — and the number the report carries is the compiled one, from
    // `scratchpad/cl4bench/us.js`, exactly as CL2 and CL3 reported theirs.
    expect(nsPerArm).toBeLessThan(20000);
  });

  test('the ablation costs nothing at all — no draw is taken', () => {
    const sampler = new SelectionSampler(1, ABLATED_SAMPLING);
    sampler.beginRound(1);
    const items = Array.from({ length: 8 }, (_v, i) => i);
    for (let i = 0; i < 100; i++) sampler.permute(items, 1, candidateWeights(8, 0));
    expect(sampler.report().draws).toBe(0);
  });

  test('rankLogit is the documented function and nothing else', () => {
    expect(rankLogit(0)).toBeCloseTo(0, 12);
    expect(rankLogit(1)).toBeCloseTo(-Math.log(2), 12);
    expect(rankLogit(7)).toBeCloseTo(-Math.log(8), 12);
  });
});
