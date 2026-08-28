# Applying the sim-worker tooling changes to Battle-Bunker/Chris-Centaur

Four commits, all under `tools/simworker/` — **no bot source is touched**
(the mandate forbids it; verify with `git diff --stat` that nothing outside
`tools/` changes). They apply onto branch `sim/worker-kit` (base commit
`77049f9`).

## Apply

    git fetch origin
    git checkout -b sim-results/local-20260827 origin/sim/worker-kit
    git am patch-0001-*.patch patch-0002-*.patch patch-0003-*.patch patch-0004-*.patch

(The patch files in this Drive folder are named `patch-000N-....patch.txt` —
rename to `.patch` or pass as-is; git am does not care about the extension.
If whitespace was mangled in Drive transit and git am rejects one, use
`git am --3way`, or reconstruct from the per-hunk descriptions in the
cross-session messages already sent to you.)

Then add the results data per HANDOFF-SUMMARY.md §2 and open a **draft PR
titled `Sim results: 20260827-overnight` with base `sim/worker-kit`** (that
exact title is how the cloud coordinator finds it).

## What each patch is

1. **run-pair per-arm `spec=` override** — P3's slider arm seats a different
   subject bot; bots resolve only from the spec, so the pair needs a same-
   sweepId spec variant per arm. Includes the generated variant spec.
2. **budget-probe.js** — re-runs recorded positions at two budgets vs a
   same-budget A/A control (METHODOLOGY §6 pattern).
3. **Timestamped emission trail** (the instrumentation the owner asked for) —
   `DecisionTelemetry.emissionTrail: [{ms, unit, move}]` recorded in the
   harness's `setBotRecommendation` / legacy `forward` callbacks; rides into
   every replay turn row via the existing telemetry spread. After this patch,
   "which move-set was standing at ANY ms mark" is a log query.
4. **Two fixes** — aggregate.js crashed on sweeps its `--base` arm never ran,
   and needed a loud skip for base-less sweeps; budget-probe v1 reused one
   engine across games (engines carry per-game ledger state), invalidating
   its first result.

## Provenance note for the PR description

Sweeps P1/N0/P2/P3/P6/P7 ran on bundles with the pre-trail harness
(`a8d73b7` and earlier); P4/P5 ran on `-t2` bundles: **same bot SHAs**
(`66904d2` integrated, `8059b86` perf-substrate, `724d83f` arch/s2), harness
`59e94de`. The trail is telemetry-only; it does not alter decisions.