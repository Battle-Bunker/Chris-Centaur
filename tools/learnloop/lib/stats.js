'use strict';
/*
 * BLOCK STATISTICS — the same arithmetic `tools/simworker/bin/aggregate.js`
 * does, in a module the learning loop can call.
 *
 * ── THE STATISTICAL UNIT IS THE BLOCK ──────────────────────────────────────
 *
 * A BLOCK is one seed played through every cyclic seat rotation. Board geometry
 * is not symmetric — on a three-team board two seats share a column, two share
 * a row, one pair sits on the long diagonal — so seat advantage cancels INSIDE
 * a block and not inside a single game. Treating games as independent divides
 * the standard error by roughly sqrt(rotations) for free and manufactures
 * significance out of seat geometry.
 *
 * Every interval this module produces is therefore over BLOCK MEANS, and `n` is
 * the number of seeds. A duplicate of aggregate.js's constants and formulas on
 * purpose: the two tools must agree to the digit, and `bin/selftest.js` asserts
 * they do on the shared fixture rather than trusting that they will.
 */

/** Two-sided 95% t multipliers, df = n-1. Beyond 30, 1.96 is close enough. */
const T95 = {
  2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306,
  10: 2.262, 11: 2.228, 12: 2.201, 13: 2.179, 14: 2.160, 15: 2.145, 16: 2.131,
  17: 2.120, 18: 2.110, 19: 2.101, 20: 2.093, 21: 2.086, 22: 2.080, 23: 2.074,
  24: 2.069, 25: 2.064, 26: 2.060, 27: 2.056, 28: 2.052, 29: 2.048, 30: 2.045,
};

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

const round = (x, d = 4) =>
  x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(d));

/**
 * Mean of block means with a t-based 95% interval.
 *
 * A single block returns a NULL interval, never a zero-width one. An interval
 * that cannot be computed is not an interval of width zero, and rendering it as
 * `[x, x]` is how a one-seed pilot ends up quoted as a result.
 */
function blockCI(blockMeans) {
  const n = blockMeans.length;
  if (n === 0) return { mean: null, lo: null, hi: null, n: 0, sd: null };
  const m = mean(blockMeans);
  if (n === 1) return { mean: round(m), lo: null, hi: null, n: 1, sd: null };
  const varr = blockMeans.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(varr);
  const t = T95[Math.min(n, 30)] ?? 1.96;
  const half = (t * sd) / Math.sqrt(n);
  return { mean: round(m), lo: round(m - half), hi: round(m + half), n, sd: round(sd) };
}

/** Does the interval exclude zero? Null (uncomputable) is never significant. */
function excludesZero(ci) {
  return ci.lo !== null && ci.hi !== null && (ci.lo > 0 || ci.hi < 0);
}

/**
 * BLOCKS NEEDED FOR 80% POWER AT alpha=0.05, given an observed block sd and a
 * target minimum detectable effect. The A3 memo's table (§4.1) is this formula
 * evaluated at the corpus's measured dispersions; recomputing it per cell is
 * what turns "we are underpowered" from an assertion into a number.
 *
 *   n >= 2 * ((z_{1-a/2} + z_{1-b}) * sd / mde)^2   (paired => the 2 drops out;
 *   the paired form is n >= ((1.96 + 0.8416) * sd / mde)^2)
 *
 * Paired, because every cell in this program is paired game-for-game.
 */
function blocksForPower(sd, mde) {
  if (!Number.isFinite(sd) || !Number.isFinite(mde) || mde <= 0 || sd <= 0) return null;
  return Math.ceil(((1.959964 + 0.841621) * sd / mde) ** 2);
}

/**
 * The MDE a given block count can resolve, which is the inverse and the more
 * useful direction: a cell reports what it HAD, and this says what that buys.
 */
function mdeAtBlocks(sd, blocks) {
  if (!Number.isFinite(sd) || !Number.isFinite(blocks) || blocks < 2 || sd <= 0) return null;
  return round((1.959964 + 0.841621) * sd / Math.sqrt(blocks), 4);
}

module.exports = { T95, mean, round, blockCI, excludesZero, blocksForPower, mdeAtBlocks };
