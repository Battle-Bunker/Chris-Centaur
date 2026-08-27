/**
 * WHERE OUTPUT GOES — the one thing the ported harness had to stop hard-coding.
 *
 * The sweep harness this is descended from wrote every replay to a single
 * absolute path inside one container's scratchpad. A kit that a stranger clones
 * onto their own machine cannot do that, and a kit that runs PAIRED ARMS cannot
 * write both arms to one directory even if it could: the two arms of a pair
 * share a sweepId by design (that shared id is what pairs them, game for game),
 * so they must be told apart by their output root, not by their name.
 *
 * Resolution order, first hit wins:
 *   1. `--out <dir>` on the command line   — what run-pair.js passes each arm
 *   2. `SIMWORKER_OUT` in the environment  — for a shell that sets it once
 *   3. `./replays` under the current directory
 *
 * Always resolved to an absolute path, because the runner forks workers whose
 * cwd is not guaranteed to be the operator's.
 */

import * as path from 'path';

export function resolveOutRoot(argv: ReadonlyArray<string> = process.argv): string {
  const i = argv.indexOf('--out');
  const fromArg = i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  const chosen = fromArg ?? process.env.SIMWORKER_OUT ?? path.join(process.cwd(), 'replays');
  return path.resolve(chosen);
}
