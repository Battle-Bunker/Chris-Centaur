/**
 * THE PRIVATE PER-MATCH SEED — the one operational step the owner's
 * weighted-lottery ruling (R-A) owes, and the half CL4 shipped without.
 *
 * ── WHAT WAS MISSING, AND WHY IT MATTERED ──────────────────────────────────
 *
 * CL4 built the lottery on `decisionSeed(matchSeed, boardFingerprint,
 * decisionIndex)` and left `matchSeed` at its default of **zero**. With zero
 * the stream is a pure function of the BOARD: every gate and every probe in
 * this tree re-runs bit for bit, which is exactly what a measurement needs —
 * and an opponent holding this source can compute the whole stream from a
 * position it can see. The ruling bought two things and only one of them was
 * delivered. Replayability was; unpredictability was not.
 *
 * ── WHAT THIS MODULE IS, AND WHERE IT IS NOT ───────────────────────────────
 *
 * One function, minting one 32-bit word from the platform CSPRNG. It lives
 * HERE and not in `selection/**` on purpose: that directory's whole guarantee
 * is that nothing in it reads a clock or a random source (contract rule 20,
 * lint-enforced), because the sampler must be a pure function of its address.
 * The randomness belongs at the CONSTRUCTION SITE — one draw per match, at the
 * boundary, handed in as data — and never inside the sampler.
 *
 * ── THE THREE PROPERTIES A MINTED SEED MUST HAVE ───────────────────────────
 *
 *  · **NONZERO.** Zero is the sentinel that means "the board is the whole
 *    stream". A minted seed that came back zero would silently reinstate the
 *    predictable regime, so the draw is retried into a nonzero word rather
 *    than trusted. (One retry is enough at p = 2^-32; the loop is there so the
 *    property is a fact and not a probability.)
 *  · **UNPREDICTABLE.** `randomBytes`, never `Math.random`: the whole point is
 *    that an adversary who holds this source and the board cannot compute the
 *    stream, and a seeded PRNG whose state is derivable from process start
 *    time gives that away.
 *  · **RECORDED.** The seed is minted once per MATCH, logged at the point of
 *    minting, and stamped onto every decision's `SelectionReport.matchSeed` —
 *    which the kernel puts on `EmitRecord.selection`, an operator-side field
 *    that never reaches the wire. That is what keeps a live match replayable:
 *    hand the recorded seed back as `TeamDecisionOptions.matchSeed` and the
 *    run reproduces byte for byte.
 */

import { randomBytes } from 'node:crypto';

/**
 * A fresh private match seed: 32 unpredictable bits, never zero.
 *
 * Returns an unsigned 32-bit integer, which is what `decisionSeed` mixes and
 * what `SelectionReport.matchSeed` records.
 */
export function mintMatchSeed(draw: () => number = cryptoWord): number {
  for (let attempt = 0; attempt < 8; attempt++) {
    const word = draw() >>> 0;
    if (word !== 0) return word;
  }
  // Eight consecutive zeros from a CSPRNG is not a draw, it is a broken source.
  // Failing loudly beats silently running the predictable stream and calling it
  // the unpredictable one.
  throw new Error('mintMatchSeed: the random source returned zero eight times');
}

function cryptoWord(): number {
  return randomBytes(4).readUInt32BE(0) >>> 0;
}
