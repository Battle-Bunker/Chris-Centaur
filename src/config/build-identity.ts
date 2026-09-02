/**
 * WHICH BUILD IS PLAYING — the `behaviourId` half of a bot's stamp.
 *
 * A `botId` addresses the CONFIGURATION and says nothing about the code that
 * read it. Two arms of an experiment run weeks apart on the same manifest are
 * the same botId and can be different software; a row that carries only the
 * config id cannot tell them apart, and the difference is exactly what a
 * regression looks like.
 *
 * THREE READINGS, IN DESCENDING ORDER OF WHAT THEY PROVE:
 *
 *   1. `git:<sha>` — the commit the running code was built from, supplied by
 *      the build or the platform through the environment. This is the only
 *      reading that addresses SOURCE, and it is the one to arrange in any
 *      deployment that cares: set `CENTAUR_BUILD_COMMIT` at build time.
 *
 *   2. `pkg:<version>+dist:<digest>` — no commit was published, so the running
 *      JavaScript is hashed instead. Weaker than a commit (it cannot name the
 *      source, and it moves when the compiler moves) but strictly sound for
 *      the question that matters: two processes with the same digest are
 *      running byte-identical code.
 *
 *   3. `pkg:<version>+dist:none` — there is no build to hash, because the
 *      process is running from TypeScript source (ts-node, jest). Honest about
 *      being weak rather than silently claiming an identity it does not have.
 *
 * DERIVED ONCE. The dist walk reads every compiled file, so it is memoised for
 * the life of the process. That is not merely an optimisation: the identity
 * stamped on turn 1 and the identity stamped on turn 900 must agree even if
 * someone rebuilt underneath a running container.
 */

import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

/**
 * Environment variables consulted for a build commit, in order. The first
 * non-empty one wins.
 *
 * `CENTAUR_BUILD_COMMIT` is OURS and is the one to set deliberately; the rest
 * are what common hosts inject on their own, so a deployment that already
 * publishes its commit gets a real build address with no configuration.
 */
export const BUILD_COMMIT_ENV_VARS: ReadonlyArray<string> = [
  'CENTAUR_BUILD_COMMIT',
  'GIT_COMMIT',
  'SOURCE_VERSION',
  'RAILWAY_GIT_COMMIT_SHA',
  'VERCEL_GIT_COMMIT_SHA',
];

/** How much of a commit sha rides in the id. Twelve hex digits is what every
 * git tool abbreviates to and is unambiguous well past this repository's
 * lifetime. */
const COMMIT_CHARS = 12;
const DIST_DIGEST_CHARS = 12;

/** The three readings, injected so the derivation is testable without a build
 * on disk or an environment to mutate. */
export interface BuildIdentitySources {
  readonly env: NodeJS.ProcessEnv;
  /** The package's declared version, or null when it cannot be read. */
  readonly packageVersion: () => string | null;
  /** A content digest of the compiled output, or null when there is none. */
  readonly distDigest: () => string | null;
}

/**
 * Derive the build address. Total: every failure path has a named reading, and
 * `unknown` is itself a statement ("this process cannot say what it is") rather
 * than an absent field a reader would have to interpret.
 */
export function behaviourIdFrom(sources: BuildIdentitySources): string {
  for (const name of BUILD_COMMIT_ENV_VARS) {
    const raw = sources.env[name];
    if (raw !== undefined && raw.trim() !== '') {
      return `git:${raw.trim().toLowerCase().slice(0, COMMIT_CHARS)}`;
    }
  }
  const version = sources.packageVersion();
  const digest = sources.distDigest();
  if (version === null && digest === null) return 'unknown';
  return `pkg:${version ?? 'unknown'}+dist:${digest ?? 'none'}`;
}

/** The repository root as seen from this module: `<root>/dist/config` when
 * compiled, `<root>/src/config` under ts-node or jest. Both are two levels
 * down, so one expression serves both. */
function projectRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

/** `package.json`'s `version`, or null if it cannot be read or is not a
 * string. Never throws: a build stamp must not be able to fail a boot. */
export function packageVersion(): string | null {
  try {
    const raw = readFileSync(path.join(projectRoot(), 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const version = (parsed as { version?: unknown }).version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * A content digest of the compiled output, or null when this process is not
 * running from one.
 *
 * NOT A DIRECTORY LISTING. Every `.js` file under `dist/` is read and hashed
 * with its own relative path, in sorted order, so the digest changes when a
 * file's CONTENT changes, when a file is added or removed, and when a file is
 * renamed — and does not change when the filesystem returns entries in a
 * different order.
 *
 * `.tsbuildinfo` and source maps are skipped deliberately: they are compiler
 * bookkeeping, they carry absolute paths, and hashing them would make the
 * identity depend on where the build ran rather than on what it produced.
 */
export function distDigest(): string | null {
  const dir = path.resolve(__dirname, '..');
  if (path.basename(dir) !== 'dist') return null; // running from source
  const files: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    )) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  };
  try {
    walk(dir);
    if (files.length === 0) return null;
    const hash = createHash('sha256');
    for (const file of files.sort()) {
      hash.update(path.relative(dir, file));
      hash.update('\0');
      hash.update(readFileSync(file));
      hash.update('\0');
    }
    return hash.digest('hex').slice(0, DIST_DIGEST_CHARS);
  } catch {
    return null;
  }
}

let memoised: string | null = null;

/**
 * The running process's build address, derived once.
 *
 * Memoised deliberately — see the file header: an identity that changed mid-game
 * because someone rebuilt underneath the container would split one game's rows
 * across two behaviours and lie about both.
 */
export function behaviourId(): string {
  if (memoised === null) {
    memoised = behaviourIdFrom({ env: process.env, packageVersion, distDigest });
  }
  return memoised;
}
