/**
 * Seeded PRNG for the sweep harness.
 *
 * Adapted verbatim from `bench/prod/rng.ts` so a sweep board and a bench board
 * built from the same seed are bit-identical. Every stochastic decision in a
 * game — placement, food spawn, potion spawn, fertile noise offsets — draws
 * from a STREAM derived from the game seed, never from `Math.random()`. The
 * upstream server uses `Math.random()` for these (TeamSnekProcessor); replacing
 * it with a seeded stream is the one deliberate deviation, and it is what makes
 * a replay replayable.
 */

export interface Rng {
  next(): number;
  int(n: number): number;
  pick<T>(xs: ReadonlyArray<T>): T;
  shuffle<T>(xs: T[]): T[];
}

export function makeRng(seed: number): Rng {
  let a = (seed >>> 0) || 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number): number => Math.floor(next() * n);
  return {
    next,
    int,
    pick: <T,>(xs: ReadonlyArray<T>): T => xs[int(xs.length)] as T,
    shuffle: <T,>(xs: T[]): T[] => {
      for (let i = xs.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = xs[i] as T;
        xs[i] = xs[j] as T;
        xs[j] = tmp;
      }
      return xs;
    },
  };
}

/** A stable 32-bit hash of a string — deterministic tie-breaks without a clock. */
export function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * A named substream of a game seed. Placement, food and potions each draw from
 * their own stream so that changing (say) the food cadence does not shift the
 * placement draw and silently change the board under a comparison.
 */
export function streamRng(seed: number, name: string): Rng {
  return makeRng((seed ^ hash32(name)) >>> 0);
}
