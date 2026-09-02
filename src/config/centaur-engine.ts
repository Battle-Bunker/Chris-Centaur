/**
 * The CENTAUR_ENGINE flag: which decision engine drives the FULL pass.
 *
 *   lobster  (default) the team decision engine: one joint decision per TEAM
 *            per turn through the LOBSTER kernel, staged through the same
 *            per-unit manager surface (precedence and the fatal-consent gate
 *            run untouched) and batched by the team submitter.
 *   legacy   the per-snake VoronoiStrategy fan-out that used to be the default.
 *            Still complete, still tested, and one environment variable away.
 *
 * The fast-pass reflex (quickSafeMove / piece intake) runs identically under
 * BOTH values: the flag routes only the full strategy pass.
 *
 * ── THE FLIP, AND WHAT PAID FOR IT ─────────────────────────────────────────
 *
 * The default was 'legacy' on a measured verdict, not a preference. The gate of
 * 2026-08-23 (raw output in `scratchpad/fg-out/`) found the SNAKE-ONLY boards
 * behind — the only shape where the legacy path speaks for every unit it owns,
 * so the only rows that measure SEARCH rather than "legacy has no piece bot":
 *
 *     snake-only pooled, 32 seeds / 64 matches, 1 s, paired + side-swapped
 *       pairedScore   -0.59 [-0.97, -0.22]   seed-level W/L/D 3/15/14
 *
 * That verdict named its own cause and its own exit: the deficit was in the
 * OBJECTIVE, not the search. The shipped evaluator carried reach at weight 0
 * where legacy's carries territory terms, and a material-only maximin plays
 * positionally passive over thirty turns. The stated condition to flip was an
 * evaluator carrying territory terms bringing that interval back to containing
 * zero at n >= 32 seeds with staged-nothing still 0.
 *
 * RUN OF 2026-08-26, same harness, same seeds, same budget, quiet machine
 * (load 0.3-2.8 per match, recorded per match in the raw output). The evaluator
 * is now the TERRITORY profile: a two-plane partition — trail units divide the
 * board, pieces displace at the decisive turn — plus a per-unit room term, both
 * read off the engine's dilation shells:
 *
 *     snake-only pooled, 32 seeds / 64 matches
 *       pairedScore   +0.81 [+0.44, +1.19]   seed-level W/L/D 19/4/9
 *       pairedMargin  +3.03 [+1.56, +4.53]
 *       paired per-seed delta vs the 2026-08-23 arm
 *                     +1.41 [+0.91, +1.88]   26 better / 4 worse / 2 equal
 *     and the two scenarios agree on their own:
 *       snakes11 n=20  -0.55 -> +0.45 [+0.05, +0.90]   delta +1.00 [+0.35, +1.60]
 *       snakes13 n=12  -0.67 -> +1.42 [+0.92, +1.83]   delta +2.08 [+1.58, +2.58]
 *
 * The condition asked for an interval containing zero; the interval is clear of
 * zero on the POSITIVE side. Conduct over 2352 team decisions across every
 * scenario in that run: 0 illegal staged cells, 0 staged-nothing, 0 decisions
 * that threw, 0 unstaged units, 0 deadline overruns (the only overruns in the
 * run were the legacy arm's: 7, worst 143 ms). `firstStage` p50 1 ms on the
 * snake boards, 6-15 ms on the piece boards.
 *
 * ── WHAT IT COSTS, STATED ──────────────────────────────────────────────────
 *
 * Territory is not free: 45-56% of the plans a material-only decision would
 * have evaluated, on snake-only rosters at a one-second budget, and 49-73% on
 * mixed ones. Per node evaluation, 32-109 us against material's 18-56 on
 * snake-only rosters at 6/12/26 units. It buys more than it costs on every row
 * measured except one.
 *
 * ── THE ONE ROW THAT IS NOT CLEAN ──────────────────────────────────────────
 *
 * Piece boards, both arms of the team engine, paired on seeds:
 *
 *     mid11 (12 units) n=10   territory +1.20 [+0.60, +1.80]
 *                             material  +1.10 [+0.20, +1.80]
 *                             delta     +0.10 [-0.70, +0.90]   3 / 2 / 5
 *     big13 (26 units) n= 8   territory -0.75 [-1.75, +0.50]
 *                             material  +0.25 [-0.75, +1.25]
 *                             delta     -1.00 [-2.50, +0.50]   2 / 4 / 2
 *
 * mid11 is unchanged. big13 is DOWN on the point estimate, by an amount the
 * interval cannot separate from zero at eight seeds, on a board where both arms
 * sit near even against legacy anyway. It is the shape where the depth cost is
 * largest (26 units is the worst cell of the throughput table) and where the
 * territory floor is weakest, because a held slider's one-move cloud covers the
 * board and a sound floor has to concede it. Two facts keep this from blocking
 * the flip: it was never part of the recorded condition and has no baseline in
 * the 2026-08-23 gate, and the snake row it WAS blocked on moved by +1.41.
 *
 * It is, though, the number to watch. If it firms up as a real regression the
 * knob is the EVALUATOR and not this flag: `materialEvaluator` is still an
 * exported profile, and `TeamDecisionOptions.evaluate` takes it by name.
 */

export type CentaurEngineKind = 'legacy' | 'lobster';

export const CENTAUR_ENGINE_ENV = 'CENTAUR_ENGINE';

/** The value an absent, empty or unrecognised flag resolves to. */
export const CENTAUR_ENGINE_DEFAULT: CentaurEngineKind = 'lobster';

/** Parse the flag from an environment. Unrecognised values keep the default
 * and say so — a typo must never silently reroute production decisions. */
export function centaurEngineFrom(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void = (m) => console.warn(m)
): CentaurEngineKind {
  const raw = env[CENTAUR_ENGINE_ENV];
  if (raw === undefined || raw === '') return CENTAUR_ENGINE_DEFAULT;
  if (raw === 'legacy') return 'legacy';
  if (raw === 'lobster') return 'lobster';
  log(
    `[centaur-engine] Ignoring ${CENTAUR_ENGINE_ENV}="${raw}" — expected "legacy" or "lobster"; ` +
      `keeping ${CENTAUR_ENGINE_DEFAULT}`
  );
  return CENTAUR_ENGINE_DEFAULT;
}

/** The live flag. Read at each routing decision (not cached at import time)
 * so a test can flip it per case; production sets it once at process start. */
export function centaurEngine(): CentaurEngineKind {
  return centaurEngineFrom(process.env);
}
