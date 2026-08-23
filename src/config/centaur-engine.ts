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
 * BOTH values: the flag routes only the full strategy pass. The default stays
 * 'legacy' until the verification wave flips it with evidence — see the build
 * contract's flag-flip gate.
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
