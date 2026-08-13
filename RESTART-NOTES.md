# Session restart notes — 2026-08-13 (remove this file before merging the PR)

State captured after stopping the "wave 2" refactor agent at a clean boundary.
Both repos: branch `claude/codebase-refactor-opportunities-qin5z9`, all work committed, trees clean.

## Where things stand

**Chris-Centaur** (PR #9, draft; PRs #7/#8 merged into this branch and closed):
green at `tsc` / `jest` 24 suites 235 tests / `lint 0-0` after wave-2 steps 1-4:
- `47b62cb` heuristic registry (single HEURISTICS table drives types/defaults/loops; legacy wire aliases preserved)
- `a32b78b` /config page renders from served UI metadata (configKeys + range chain deleted)
- `233776c` parseTurn single doc parser (per-site endTime fallbacks preserved)
- `b916943` decide() delegates to shared enumerate/evaluate pipeline (parity tests unchanged)
- `33c1da2` fillNeighbors4 single neighbor helper + hoisted/memoized projection inputs (no perf regression)

Earlier on the branch: engine-aligned physics + stale-race fix; PR 7/8 merges + 7 defect fixes;
ActivityController keepalive system (owner rule: awake iff human action <60s OR robustly-progressing
game AND human action <10min; liveness heartbeat ALWAYS on; terminology liveness/socket-keepalive/
activity-heartbeat; enforcement lints ban bare timers + ownership imports).

**TacticToes** (PR #19, draft): complete and pushed (25 commits): processor collapse,
turn-deadline single writer, useFirestoreSubscription + GameStateContext rewrite +
connectivity fix, display dedup, GameSetup decomposition, H2H at-most-one-survivor fix,
wire trim (allowedMoves/scoringUnit gone; walls on game doc), stacked-spawn default-move
engine fix, e2e scaffold in `scripts/e2e-local/` (emulator-validated engine-only, incl.
post-fix run with no turn-0 workaround).

## Remaining work, in order

1. **Chris-Centaur wave-2 steps 5-6** (relaunch a single mutation agent; specs verbatim from
   the original brief):
   - STEP 5: winner-capture verification post-PR7 (games table winnerSnakeId/winnerName/endReason
     for elimination AND multi-survivor finishes; recordGameEnd unit test with canonical fixture).
   - STEP 6: web dedup — dom-utils.js UMD (one null-safe escapeHtml replacing 6 divergent copies,
     fmtTime/fmtDur, openGame; jest via require like activity-periods), ws-client.js factory
     (play.html + play-game.html connect/status/reconnect/idle-close blocks; parameterize deltas),
     chrome.css (shared reset/header/nav/game-card for play/history/activity), purge stale
     Battlesnake branding strings in web pages. Verify with board-input-harness if runnable.
   - Also from review backlog: VoronoiStrategy golden-master tests (still zero direct coverage);
     update replit.md/README prose still describing the old presence-only suspension.
2. **Full two-centaur 5v5 emulator e2e** using TacticToes `scripts/e2e-local/run-all.sh`
   (CENTAUR_DIR=/home/user/Chris-Centaur). Gotchas in its README (proxy sentinel inside
   run-emulators.sh; rebuild functions/lib before boot; global playwright
   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers; keep /play pages open through the window;
   self-safe pkill). Owner directive: dev Firebase project ONLY after this passes.
3. **Adversarial review sweep** (read-only agents, both repos, all branch commits vs main),
   fix findings via single mutation agent per repo.
4. Push both repos; update PR #9 and #19 bodies to cover the full final content; delete this file.

## Standing owner directives
- No backwards compatibility anywhere (historic data will be discarded).
- Zero-new-bugs is the top priority; behavior changes only where owner approved (H2H rule,
  engine default-move fix, idle rule, connectivity fix, potion honesty, wire trim).
- Deferred BY DESIGN (do not do without asking): staged-move state-machine rewrite,
  shared Game.ts vendoring, worker-pool board-broadcast serialization change.
- One mutation agent per repo at a time; orchestrator stays high-altitude; no Workflow tool.
- Emulator first; `FIREBASE_DEV_PROJECT`/`FIREBASE_SA_KEY_B64` exist in env for the later stage.
