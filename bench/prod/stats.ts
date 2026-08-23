/**
 * The paired bootstrap, and nothing fancier.
 *
 * Every comparison in these benches is PAIRED: one seed produces one board,
 * played twice with the sides swapped. The unit of resampling is therefore the
 * SEED, not the match — resampling matches would treat a pair's two halves as
 * independent when they share a board, and would narrow the interval by a
 * factor it has not earned.
 *
 * n is small on purpose (real clocks, 1-10 s per decision). The intervals say
 * so: a 95% percentile interval on 6 seeds is wide, and reporting it wide is
 * the honest thing to do.
 */

import { makeRng } from './rng';

export interface Interval {
  readonly mean: number;
  readonly lo: number;
  readonly hi: number;
  readonly n: number;
}

/** Percentile bootstrap over the per-seed values. */
export function bootstrap(values: ReadonlyArray<number>, iters = 20_000, seed = 12345): Interval {
  const n = values.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { mean, lo: mean, hi: mean, n };
  const rng = makeRng(seed);
  const means: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += values[rng.int(n)] as number;
    means[i] = s / n;
  }
  means.sort((a, b) => a - b);
  const at = (p: number): number => means[Math.min(iters - 1, Math.max(0, Math.floor(p * iters)))] as number;
  return { mean, lo: at(0.025), hi: at(0.975), n };
}

export const fmt = (x: number, d = 2): string =>
  Number.isFinite(x) ? x.toFixed(d) : String(x);

export function fmtInterval(i: Interval, d = 2): string {
  return `${fmt(i.mean, d)} [${fmt(i.lo, d)}, ${fmt(i.hi, d)}]`;
}

export function mean(xs: ReadonlyArray<number>): number {
  return xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function quantile(xs: ReadonlyArray<number>, p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)));
  return s[i] as number;
}
