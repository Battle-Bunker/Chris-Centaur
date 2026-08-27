#!/usr/bin/env bash
#
# BUILD ANY BRANCH INTO A SELF-CONTAINED BOT BUNDLE.
#
#   tools/simworker/build-bot.sh <git-ref> <bundle-dir> [options]
#
# A BUNDLE is one immutable, fully-built copy of the bot at one commit, with
# this harness compiled against it, runnable with nothing but `node`. It is the
# unit an ARM is defined over: an arm is a (bundle, env, spec) triple, and two
# arms that share a spec and differ in bundle are the paired experiment this
# whole kit exists to run.
#
# WHY A BUNDLE PER BRANCH, AND NOT ONE HARNESS WITH A FLAG
#
# Two contenders that live on different branches are different COMPILED CODE.
# There is no way to seat both in one game: a node process holds one copy of
# `src/lobster/*`, and whichever one it loaded is the one every seat plays. So
# cross-branch comparison is necessarily cross-PROCESS, which means the two arms
# must be built separately, run simultaneously, and paired afterwards by gameId.
# Everything downstream — run-pair.js, the manifest schema, the null cells —
# follows from that one fact. See context/METHODOLOGY.md §1.
#
#   <git-ref>      a branch, tag or SHA. Recorded resolved in bundle.json.
#   <bundle-dir>   created; must not already exist unless --force.
#
# Options:
#   --repo <path>   the Chris-Centaur clone to build from.
#                   Default: the repository this script is committed in.
#   --fetch         `git fetch --all` in the repo first. Do this when you are
#                   building a branch tip rather than a pinned SHA.
#   --force         delete <bundle-dir> if it exists and rebuild.
#   --no-share      give this bundle its own node_modules instead of sharing an
#                   install with every other bundle on the same lockfile.
#
# Requires: git, node, npm. Nothing else.
set -euo pipefail

die() { printf '\n[build-bot] FATAL: %s\n' "$*" >&2; exit 1; }
say() { printf '[build-bot] %s\n' "$*"; }

KIT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

REF=""; BUNDLE=""; REPO=""; DO_FETCH=0; FORCE=0; SHARE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)     REPO="$2"; shift 2 ;;
    --fetch)    DO_FETCH=1; shift ;;
    --force)    FORCE=1; shift ;;
    --no-share) SHARE=0; shift ;;
    -h|--help)  sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*)         die "unknown option $1" ;;
    *)          if [ -z "$REF" ]; then REF="$1"; elif [ -z "$BUNDLE" ]; then BUNDLE="$1"; else die "unexpected argument $1"; fi; shift ;;
  esac
done
[ -n "$REF" ]    || die "usage: build-bot.sh <git-ref> <bundle-dir> [--repo <path>] [--fetch] [--force]"
[ -n "$BUNDLE" ] || die "usage: build-bot.sh <git-ref> <bundle-dir> [--repo <path>] [--fetch] [--force]"

command -v git  >/dev/null || die "git not on PATH"
command -v node >/dev/null || die "node not on PATH"
command -v npm  >/dev/null || die "npm not on PATH"

# The repo defaults to the one this script is committed in — so a plain
# `git clone && tools/simworker/build-bot.sh <ref> <dir>` works with no flags.
if [ -z "$REPO" ]; then
  REPO=$(git -C "$KIT_DIR" rev-parse --show-toplevel 2>/dev/null) \
    || die "no --repo given and $KIT_DIR is not inside a git repository"
fi
REPO=$(cd "$REPO" && pwd)
[ -d "$REPO/.git" ] || [ -f "$REPO/.git" ] || die "$REPO is not a git repository"
[ -f "$REPO/package.json" ] || die "$REPO has no package.json — is that really the Chris-Centaur clone?"

BUNDLE_PARENT=$(cd "$(dirname "$BUNDLE")" && pwd) || die "parent of $BUNDLE does not exist"
BUNDLE="$BUNDLE_PARENT/$(basename "$BUNDLE")"
if [ -e "$BUNDLE" ]; then
  [ "$FORCE" = 1 ] || die "$BUNDLE already exists (pass --force to rebuild it)"
  say "removing existing $BUNDLE"
  git -C "$REPO" worktree remove --force "$BUNDLE/repo" 2>/dev/null || true
  rm -rf "$BUNDLE"
fi

if [ "$DO_FETCH" = 1 ]; then
  say "fetching in $REPO"
  git -C "$REPO" fetch --all --prune --tags || die "fetch failed"
fi

# Resolve the ref NOW and build the resolved SHA, not the name. A branch tip
# moves; a findings table that quotes a branch name and not a SHA is a claim
# nobody can reproduce. METHODOLOGY.md §7.
SHA=$(git -C "$REPO" rev-parse --verify "${REF}^{commit}" 2>/dev/null) \
  || die "cannot resolve ref '$REF' in $REPO. If it is a remote branch you have not fetched, rerun with --fetch. If it is a branch that only ever existed on someone else's machine, it is not buildable here — say so in findings.md rather than substituting a different branch."
SUBJECT=$(git -C "$REPO" log -1 --format=%s "$SHA")
COMMITTED=$(git -C "$REPO" log -1 --format=%cI "$SHA")

say "ref      $REF"
say "sha      $SHA"
say "subject  $SUBJECT"
say "bundle   $BUNDLE"

mkdir -p "$BUNDLE"

# ---------------------------------------------------------------- 1. worktree
# A detached worktree, not a clone: git shares the object store, so the tenth
# bundle costs a checkout rather than a tenth copy of history.
say "checking out worktree"
git -C "$REPO" worktree add --detach "$BUNDLE/repo" "$SHA" >/dev/null 2>&1 \
  || die "git worktree add failed. If a stale worktree is registered at this path, run: git -C $REPO worktree prune"

# ------------------------------------------------------------ 2. node_modules
# Installs are shared BY LOCKFILE HASH. Branches that share a package-lock.json
# — most of them — share one install, so `npm ci` runs once per distinct
# lockfile instead of once per bundle. The share is a symlink to a directory
# nothing writes to after it is built, and `--no-share` opts out.
LOCK_HASH=$(node -e 'const c=require("crypto"),f=require("fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex").slice(0,16))' "$BUNDLE/repo/package-lock.json")
SHARED_ROOT="$BUNDLE_PARENT/.simworker-npm/$LOCK_HASH"

if [ "$SHARE" = 1 ]; then
  if [ -d "$SHARED_ROOT/node_modules" ] && [ -f "$SHARED_ROOT/.complete" ]; then
    say "reusing shared install for lockfile $LOCK_HASH"
  else
    say "npm ci into shared install $LOCK_HASH (this is the slow step; once per lockfile)"
    rm -rf "$SHARED_ROOT"
    mkdir -p "$SHARED_ROOT"
    cp "$BUNDLE/repo/package.json" "$BUNDLE/repo/package-lock.json" "$SHARED_ROOT/"
    ( cd "$SHARED_ROOT" && npm ci --no-audit --no-fund ) || die "npm ci failed in $SHARED_ROOT — see the npm output above. Do NOT patch package.json to work around it; record the failure in findings.md."
    touch "$SHARED_ROOT/.complete"
  fi
  ln -s "$SHARED_ROOT/node_modules" "$BUNDLE/repo/node_modules"
else
  say "npm ci into $BUNDLE/repo (unshared)"
  ( cd "$BUNDLE/repo" && npm ci --no-audit --no-fund ) || die "npm ci failed in $BUNDLE/repo"
fi

# --------------------------------------------------------------- 3. overlay
# The harness is COPIED in beside a symlink to the branch's own src. This is
# what makes an arbitrary branch buildable: the branch does not need to contain
# the harness, and the harness never needs a copy per branch.
say "overlaying harness"
mkdir -p "$BUNDLE/harness"
cp -R "$KIT_DIR/harness/lib" "$KIT_DIR/harness/bin" "$KIT_DIR/harness/tsconfig.json" "$BUNDLE/harness/"
ln -s "$BUNDLE/repo/src" "$BUNDLE/harness/src"
ln -s "$BUNDLE/repo/node_modules" "$BUNDLE/harness/node_modules"

# --------------------------------------------------------------- 4. compile
#
# `|| true`, and then a hard check on the artifacts. The Chris-Centaur tree
# carries pre-existing drizzle type errors in `src/logic/decision-logger.ts` and
# `src/routes/activity.ts` — neither file is on any path this harness touches,
# `noEmitOnError` is off, and tsc emits anyway. Failing the build on tsc's exit
# code would refuse every branch over two errors in dead code; failing it on a
# MISSING ARTIFACT catches every real breakage instead.
say "compiling (tsc; some pre-existing type errors in drizzle route files are expected)"
TSC_LOG="$BUNDLE/tsc.log"
( cd "$BUNDLE/harness" && npx --no-install tsc -p tsconfig.json ) >"$TSC_LOG" 2>&1 || true

REQUIRED="build/bin/run-sweep.js build/bin/match-worker.js build/lib/bots.js build/lib/replay.js build/src/lobster/team-decision-engine.js build/src/logic/decision-engine.js"
MISSING=""
for f in $REQUIRED; do
  [ -f "$BUNDLE/harness/$f" ] || MISSING="$MISSING $f"
done
if [ -n "$MISSING" ]; then
  say "tsc output (last 40 lines):"; tail -40 "$TSC_LOG" >&2
  die "compile produced no$MISSING — this is a REAL build failure, not the expected drizzle noise. Full log: $TSC_LOG"
fi

# The legacy path's worker pool only spawns real threads when
# `decision-worker.js` sits next to `decision-worker-pool.js`. Without it the
# pool silently falls back to inline single-thread evaluation, which would hand
# every lobster arm a three-thread handicap production never gives it — a
# silent, systematic, one-directional bias in every legacy comparison. Check it.
[ -f "$BUNDLE/harness/build/src/logic/decision-worker.js" ] \
  || die "build/src/logic/decision-worker.js is missing — the legacy bot would run single-threaded and every legacy arm would be invalid. Full log: $TSC_LOG"

# `src/shared/idle-policy.ts` requires `../../src/web/idle-policy.js`, a path
# written against the BUILT layout rather than the source layout. Reproduce that
# resolution without touching the branch's source tree.
mkdir -p "$BUNDLE/harness/build/src"
[ -e "$BUNDLE/harness/build/src/web" ] || ln -s "$BUNDLE/repo/src/web" "$BUNDLE/harness/build/src/web"

# --------------------------------------------------------------- 5. stamp
TSC_ERRORS=$(grep -c 'error TS' "$TSC_LOG" 2>/dev/null || echo 0)
KIT_SHA=$(git -C "$KIT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)
node -e '
const fs = require("fs");
const [out, ref, sha, subject, committed, repo, tscErrors, kitSha, lockHash] = process.argv.slice(1);
fs.writeFileSync(out, JSON.stringify({
  ref, sha, subject, committedAt: committed, repo,
  builtAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform, arch: process.arch,
  harnessCommit: kitSha,
  lockfileHash: lockHash,
  tscErrors: Number(tscErrors),
}, null, 1) + "\n");
' "$BUNDLE/bundle.json" "$REF" "$SHA" "$SUBJECT" "$COMMITTED" "$REPO" "$TSC_ERRORS" "$KIT_SHA" "$LOCK_HASH"

say "tsc reported $TSC_ERRORS type errors; all required artifacts present"
say "OK -> $BUNDLE"
say ""
say "  smoke:  node $BUNDLE/harness/build/bin/run-sweep.js --spec <spec.json> --out <dir> --workers 1"
