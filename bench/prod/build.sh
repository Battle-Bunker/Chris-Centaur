#!/bin/sh
# Build the benches to real JavaScript and run them on plain node.
#
# WHY COMPILED, NOT ts-node. The legacy path's worker pool spawns threads only
# when `decision-worker.js` exists next to it (`decision-worker-pool.ts:63-68`);
# under ts-node/ts-jest it silently falls back to INLINE single-thread
# evaluation. Benchmarking the legacy path without its worker pool would hand
# LOBSTER a three-thread handicap that production never gives it. Compiling
# both paths is the only way the comparison is about the engines.
#
# The one piece of plumbing: `src/shared/idle-policy.ts` requires
# `../../src/web/idle-policy.js` — a path written against the BUILT layout
# (dist/shared -> <root>/src/web). This out-tree is one level deeper, so the
# symlink below reproduces that resolution without touching the source tree.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
cd "$root"
npx tsc -p bench/prod/tsconfig.json
mkdir -p "$root/.bench-dist/src"
if [ ! -e "$root/.bench-dist/src/web" ]; then
  ln -s "$root/src/web" "$root/.bench-dist/src/web"
fi
echo "built -> $root/.bench-dist/bench/prod/"
