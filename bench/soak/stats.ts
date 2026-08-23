/**
 * Summary statistics for a soak run — including the one number a flat heap
 * curve can still hide: monotone LATENCY drift. A least-squares slope over
 * per-turn latency, reported in ms per 100 turns with the residual spread, is
 * the leak detector the mandate asks for.
 */

import type { TurnMetrics } from './driver';

export interface Fit {
  readonly slopePer100: number;
  readonly intercept: number;
  readonly sigma: number;
  /** |slope over the whole run| as a multiple of the residual sigma. */
  readonly signal: number;
}

export function fit(ys: ReadonlyArray<number>): Fit {
  const n = ys.length;
  if (n < 3) return { slopePer100: 0, intercept: ys[0] ?? 0, sigma: 0, signal: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += ys[i] as number;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * ((ys[i] as number) - my);
    den += (i - mx) * (i - mx);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const e = (ys[i] as number) - (intercept + slope * i);
    ss += e * e;
  }
  const sigma = Math.sqrt(ss / Math.max(1, n - 2));
  return {
    slopePer100: slope * 100,
    intercept,
    sigma,
    signal: sigma === 0 ? 0 : Math.abs(slope * n) / sigma,
  };
}

export const quantile = (xs: ReadonlyArray<number>, q: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[i] as number;
};

const MB = (b: number): string => `${(b / 1048576).toFixed(1)}MB`;

export function summarise(ms: ReadonlyArray<TurnMetrics>, violations: ReadonlyArray<string>): string {
  const warm = ms.slice(Math.min(20, Math.floor(ms.length / 5)));
  const heap = warm.map((m) => m.heapUsed);
  const lat = warm.map((m) => m.latencyMs);
  const first = warm.map((m) => m.firstEmitMs);
  const arena = ms.map((m) => m.arenaCapacity);
  const retained = warm.map((m) => m.retainedHeap).filter((v) => v >= 0);
  const retFit = fit(retained);
  // Retained heap is sampled every Nth turn, so the fit's slope is per SAMPLE.
  const retStride = retained.length > 1 ? (warm.length - 1) / (retained.length - 1) : 1;
  const retPer100Turns = retFit.slopePer100 / retStride;
  const heapFit = fit(heap);
  const latFit = fit(lat);
  const firstFit = fit(first);
  const engines = new Set(ms.map((m) => m.engineIdentity)).size;
  const out: string[] = [];
  out.push(`turns=${ms.length}  warm-up dropped=${ms.length - warm.length}`);
  out.push(
    `heapUsed  p50=${MB(quantile(heap, 0.5))} p95=${MB(quantile(heap, 0.95))} max=${MB(
      Math.max(...heap)
    )} slope=${(heapFit.slopePer100 / 1048576).toFixed(3)}MB/100turns signal=${heapFit.signal.toFixed(
      2
    )}σ`
  );
  out.push(
    retained.length === 0
      ? 'retained  (no --expose-gc: not sampled)'
      : `retained  p50=${MB(quantile(retained, 0.5))} first=${MB(retained[0] as number)} last=${MB(
          retained[retained.length - 1] as number
        )} max=${MB(Math.max(...retained))} slope=${(retPer100Turns / 1048576).toFixed(
          3
        )}MB/100turns signal=${retFit.signal.toFixed(2)}σ`
  );
  out.push(
    `arrayBufs p50=${MB(quantile(warm.map((m) => m.arrayBuffers), 0.5))} max=${MB(
      Math.max(...warm.map((m) => m.arrayBuffers))
    )}  external max=${MB(Math.max(...warm.map((m) => m.external)))}`
  );
  out.push(
    `rss       p50=${MB(quantile(warm.map((m) => m.rss), 0.5))} max=${MB(
      Math.max(...warm.map((m) => m.rss))
    )}`
  );
  out.push(
    `latency   p50=${quantile(lat, 0.5).toFixed(1)}ms p95=${quantile(lat, 0.95).toFixed(
      1
    )}ms max=${Math.max(...lat)}ms slope=${latFit.slopePer100.toFixed(
      2
    )}ms/100turns sigma=${latFit.sigma.toFixed(2)} signal=${latFit.signal.toFixed(2)}σ`
  );
  out.push(
    `firstEmit p50=${quantile(first, 0.5).toFixed(1)}ms p95=${quantile(first, 0.95).toFixed(
      1
    )}ms slope=${firstFit.slopePer100.toFixed(2)}ms/100turns signal=${firstFit.signal.toFixed(2)}σ`
  );
  out.push(
    `arena     min=${Math.min(...arena)} max=${Math.max(...arena)} final=${
      arena[arena.length - 1]
    }  distinct engines=${engines}`
  );
  out.push(
    `memo      resolutions p50=${quantile(ms.map((m) => m.memoResolutions), 0.5)} max=${Math.max(
      ...ms.map((m) => m.memoResolutions)
    )}  outstanding min/first/max=${Math.min(...ms.map((m) => m.minOutstanding))}/${quantile(
      ms.map((m) => m.firstOutstanding),
      0.5
    )}/${Math.max(...ms.map((m) => m.maxOutstanding))}  afterRelease max=${Math.max(
      ...ms.map((m) => m.outstandingAfterRelease)
    )}`
  );
  out.push(
    `kernel    slices p50=${quantile(ms.map((m) => m.slices), 0.5)} emits p50=${quantile(
      ms.map((m) => m.emits),
      0.5
    )} conformCalls p50=${quantile(ms.map((m) => m.conformCalls), 0.5)} improveCalls p50=${quantile(
      ms.map((m) => m.improveCalls),
      0.5
    )} overshoot max=${Math.max(...ms.map((m) => m.overshootMs)).toFixed(1)}ms`
  );
  out.push(
    `cache     contexts max=${Math.max(...ms.map((m) => m.contexts))} evictions total=${ms.reduce(
      (a, m) => a + m.cacheEvictions,
      0
    )} invalidations total=${ms.reduce((a, m) => a + m.cacheInvalidations, 0)} resumes n/a`
  );
  out.push(
    `wire      writes total=${ms.reduce((a, m) => a + m.writes, 0)} docs total=${ms.reduce(
      (a, m) => a + m.docs,
      0
    )} maxChunk=${Math.max(...ms.map((m) => m.chunksMax))}`
  );
  out.push(
    `crossfade blocked=${ms.reduce((a, m) => a + m.xfBlocked, 0)} certified=${ms.reduce(
      (a, m) => a + m.xfCertified,
      0
    )} uncertified=${ms.reduce((a, m) => a + m.xfUncertified, 0)} independent=${ms.reduce(
      (a, m) => a + m.xfIndependent,
      0
    )}`
  );
  out.push(
    `refusals  crossfade=${ms.reduce((a, m) => a + m.refCrossfade, 0)} rate=${ms.reduce(
      (a, m) => a + m.refRate,
      0
    )} worth=${ms.reduce((a, m) => a + m.refWorth, 0)} nonconforming=${ms.reduce(
      (a, m) => a + m.refNonconforming,
      0
    )} pin-unreachable=${ms.reduce((a, m) => a + m.refPinUnreachable, 0)}`
  );
  out.push(
    `stagedNothing turns=${ms.filter((m) => m.stagedNothing === 1).length}  boundViolations=${ms.reduce(
      (a, m) => a + m.boundViolations,
      0
    )}`
  );
  out.push(`INVARIANT VIOLATIONS: ${violations.length}`);
  for (const v of violations.slice(0, 20)) out.push(`  ! ${v}`);
  return out.join('\n');
}
