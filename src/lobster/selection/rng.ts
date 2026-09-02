/**
 * THE PATH-ADDRESSED PRNG — the one source of randomness in the search, and
 * the reason a lottery can be replayed bit-for-bit.
 *
 * ── WHY THERE IS RANDOMNESS AT ALL ─────────────────────────────────────────
 *
 * The owner's ruling, verbatim: *"I don't intuitively trust a strategy of
 * deterministically exploring ordered by cheaply computed priors because this
 * will tend to produce biases in the behaviour considered under resource
 * scarcity that could be exploited by adversaries at the least."* Under a
 * starved clock the set of branches we look at is a deterministic function of
 * cheap, public-ish heuristics — so the set we DO NOT look at is a fixed blind
 * spot, and an opponent who knows the heuristics can craft positions whose best
 * line lives in it. No soundness law protects against that: the laws protect
 * what we STAGE, and this is a failure to have looked.
 *
 * ── WHY IT IS A PATH AND NOT A STREAM ──────────────────────────────────────
 *
 * A global RNG stream makes the k-th draw depend on how many draws happened
 * before it, which makes the whole decision sequence a function of the budget.
 * Then a 40 ms decision is not a prefix of a 120 ms one, the two-budget probe
 * fails, and no measurement on this search can be attributed to a code change
 * again. So every draw is addressed rather than dealt: it is a pure function of
 *
 *     (decision seed, NODE, ARM, draw index at that node)
 *
 * and nothing else — not the clock, not the call count, not the worker
 * schedule. A budget that reaches a node twice draws that node's first two
 * values whatever happened elsewhere, which is prefix determinism by
 * construction rather than by discipline.
 *
 * ── WHY THE SEED IS PRIVATE ────────────────────────────────────────────────
 *
 * The ruling's whole point is unpredictability to an ADVERSARY and
 * replayability for US. A seed derived only from the board gives the second and
 * not the first: anyone who can see the board can compute our draws. So the
 * decision seed mixes a PRIVATE per-match seed with the board fingerprint and
 * the decision index. The private half never reaches the wire — see
 * `EmitRecord.selection`, which is an operator-side audit field that
 * `TeamDecisionEngine.forwardPlan` does not forward and Firebase never sees.
 *
 * NOTHING IN THIS DIRECTORY MAY READ A CLOCK. `Math.random`, `Date.now` and
 * `performance.now` are lint-banned under `selection/**` (eslint.config.js).
 * The only clock the selection layer ever sees is a REMAINING-BUDGET FRACTION
 * handed down by the search from `BudgetHandle`, and it reaches exactly one
 * quantity: the temperature (`sample.ts`). That is legal — a temperature is
 * scheduler state, never board-belief state — and it is why the schedule is a
 * pure function of a number the caller computed rather than of a clock this
 * module read.
 */

/**
 * FNV-1a over a string, the `search/order.ts:26` idiom.
 *
 * Used ONCE per decision to fingerprint the board, never per draw: a draw is
 * addressed by integers, because building a string per candidate is how a
 * 10 µs budget becomes a 200 µs one.
 */
export function hashString(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Avalanche one 32-bit word. Three rounds of the murmur3 finaliser's shape. */
export function scramble(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Fold a second word into a hash. Order matters; this is not commutative. */
export function mix(h: number, x: number): number {
  return scramble(((h >>> 0) ^ Math.imul(x >>> 0, 0x9e3779b1)) >>> 0);
}

/**
 * THE DECISION SEED.
 *
 * `matchSeed` is the private half and is the only input an adversary cannot
 * compute. `boardFingerprint` and `decisionIndex` are public and exist so two
 * decisions of one match, and two matches on one seed, do not share a stream.
 *
 * With `matchSeed = 0` — the default, and what every test and every replay in
 * this tree runs — the stream is a pure function of the board, so the lottery
 * is REPLAYABLE but not UNPREDICTABLE. That is deliberate: a deployment that
 * wants the anti-exploitability property supplies a private seed
 * (`TeamDecisionOptions.matchSeed`) and the audit field records which one was
 * used. See the report's §"what the seed buys and when".
 */
export function decisionSeed(
  matchSeed: number,
  boardFingerprint: number,
  decisionIndex: number,
): number {
  return mix(mix(mix(0x5eed_0c14, matchSeed | 0), boardFingerprint | 0), decisionIndex | 0);
}

/**
 * One uniform in the OPEN interval (0, 1).
 *
 * Open at both ends on purpose: the Gumbel transform takes `log(-log(u))`, so a
 * `u` of exactly 0 or exactly 1 is an infinity, and an infinity in a sampling
 * key is a silent unconditional selection — the same hole contract rule 26
 * closes on the weight side. 24 bits of mantissa, offset by a half-step, so
 * neither endpoint is representable.
 */
export function uniform(seed: number, node: number, arm: number, draw: number): number {
  const h = mix(mix(mix(seed, node), arm), draw);
  return ((h >>> 8) + 0.5) / 16777216;
}

/**
 * A standard Gumbel(0,1) variate.
 *
 * `−log(−log u)` with `u ∈ (0,1)` — the transform that makes
 * `argmax(logit + Gumbel)` an exact categorical draw, and `top-k of
 * (logit + Gumbel)` an exact k-subset WITHOUT REPLACEMENT drawn ∝ softmax
 * (Vieira's Gumbel-top-k trick; Kool et al. 2019). Two logs per arm, and the
 * one-log algebraic twin (`log(u)·exp(−logit)`, sorted descending) is EXACTLY
 * order-equivalent but overflows to ±Infinity at the cold end of the
 * temperature schedule, where `logit/T` reaches the thousands. Measured cost of
 * the honest form is in the µs budget test; the fast form's failure is not
 * worth the nanoseconds.
 */
export function gumbel(seed: number, node: number, arm: number, draw: number): number {
  return -Math.log(-Math.log(uniform(seed, node, arm, draw)));
}
