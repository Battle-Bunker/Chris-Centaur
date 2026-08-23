/**
 * The CENTAUR_ENGINE flag: which decision engine drives the FULL pass.
 *
 *   legacy   (default) the per-snake VoronoiStrategy fan-out that has always
 *            run. With the flag absent, empty, or unrecognised, NOTHING
 *            observable changes anywhere — pinned by test.
 *   lobster  the team decision engine: one joint decision per TEAM per turn
 *            through the LOBSTER kernel, staged through the same per-unit
 *            manager surface (precedence and the fatal-consent gate run
 *            untouched) and batched by the team submitter.
 *
 * The fast-pass reflex (quickSafeMove / piece intake) runs identically under
 * BOTH values: the flag routes only the full strategy pass.
 *
 * THE DEFAULT STAYS 'legacy' — measured, not assumed. Final-gate run of
 * 2026-08-23 against this tip, after the fix round; raw head-to-head outputs
 * in `scratchpad/fg-out/`. The contract's flag-flip gate asks for
 * legacy-parity-or-better, and the SNAKE-ONLY boards fail it. Those are the
 * only shape where the legacy path speaks for every unit it owns, so they are
 * the only rows that measure SEARCH rather than measuring "legacy has no piece
 * bot"; paired, side-swapped, 1 s budget, bootstrapped over seeds:
 *
 *     snake-only pooled, 32 seeds / 64 matches
 *       pairedScore   -0.59 [-0.97, -0.22]   seed-level W/L/D 3/15/14
 *       pairedMargin  -2.94 [-4.44, -1.38]
 *     and the two scenarios agree on their own:
 *       snakes11 n=20  -0.55 [-1.05,  0.00]
 *       snakes13 n=12  -0.67 [-1.17, -0.17]
 *
 * Both 95% intervals are clear of zero on the negative side. (At V2's original
 * n=5 this row read -0.20 [-0.80, +0.40] and looked like parity; the sample
 * size was the illusion, and the seed count above is where it stops moving.)
 *
 * IT IS NOT A CONDUCT PROBLEM, and not a regression from the fix round. Over
 * 2079 team decisions in that run: 0 illegal staged cells, 0 staged-nothing
 * (V2's BoundsInversionError blocker is extinct — that gate is now MET), 0
 * decisions that threw, 0 unstaged units, 1 deadline overrun of 45 ms. On the
 * piece boards production actually plays, the engine wins decisively (mid11,
 * 1 s, 5 seeds: pairedScore +1.60 [+0.80, +2.00]) — but much of that margin is
 * structural, because the legacy path has no bot for pieces at all and its
 * king and rooks simply never move. The piece row does not offset the snake
 * row; the two measure different things.
 *
 * WHAT WOULD CHANGE THIS DECISION. The deficit is in the OBJECTIVE, not the
 * search: LOBSTER's one-ply maximin choices were optimal on 46/46 exhaustively
 * scored positions, while the shipped `materialEvaluator` carries reach: 0,
 * healthEconomy: 0 and kingMargin: 0 where legacy's BoardEvaluator carries
 * Voronoi/territory terms — a material-only maximin plays positionally passive
 * over thirty turns. Flip when an evaluator carrying territory terms brings
 * the snake-only pooled pairedScore interval back to containing zero at n >= 32
 * seeds with staged-nothing still 0; re-run `bench/prod/h2h.js` over snakes11
 * and snakes13 exactly as that run did. Nothing in the wire, the deadline
 * conduct or the bounds machinery is blocking the flip.
 */

export type CentaurEngineKind = 'legacy' | 'lobster';

export const CENTAUR_ENGINE_ENV = 'CENTAUR_ENGINE';

/** Parse the flag from an environment. Unrecognised values keep the default
 * and say so — a typo must never silently reroute production decisions. */
export function centaurEngineFrom(
  env: NodeJS.ProcessEnv,
  log: (message: string) => void = (m) => console.warn(m)
): CentaurEngineKind {
  const raw = env[CENTAUR_ENGINE_ENV];
  if (raw === undefined || raw === '' || raw === 'legacy') return 'legacy';
  if (raw === 'lobster') return 'lobster';
  log(
    `[centaur-engine] Ignoring ${CENTAUR_ENGINE_ENV}="${raw}" — expected "legacy" or "lobster"; ` +
      'keeping legacy'
  );
  return 'legacy';
}

/** The live flag. Read at each routing decision (not cached at import time)
 * so a test can flip it per case; production sets it once at process start. */
export function centaurEngine(): CentaurEngineKind {
  return centaurEngineFrom(process.env);
}
