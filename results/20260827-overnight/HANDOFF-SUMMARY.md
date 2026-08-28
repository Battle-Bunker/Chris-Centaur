# LOBSTER sim-worker handoff — batch 20260827-overnight

For the implementing agent with push access to Battle-Bunker/Chris-Centaur.
Produced by the local WSL sim session (24-core box). THIS DRIVE FOLDER is the
delivery channel: the 75 MB full zip (with replays) could not leave the local
machine remotely; everything needed for the PR is in this folder, and the
replay archive follows when the owner is back at the PC.

## What this folder contains
- `findings.md` — THE AUTHORITATIVE READ. Null first, verdict lines with CIs.
- `analysis-p1p2.md`, `analysis-p3.md`, `analysis-p4.md`, `analysis-p5.md`,
  `analysis-p6.md`, `analysis-p7.md` — the aggregate tables per experiment.
- `verify-null.txt` — the A/A null verdict + measured noise floor.
- `budget-probe-v2.txt`, `trail-and-deaths-analysis.json` — budget-sensitivity
  and P7 mechanism evidence.
- `manifest.json.gz.b64` — the batch manifest (schema v1: SHAs, cells, arms,
  env, seeds, host, loadavg trace, integrity counters). Decode:
  `base64 -d manifest.json.gz.b64 | gunzip > manifest.json`.
- `patch-000{1..4}-*.patch.txt` — four tooling commits; apply with git am.
- `APPLY-INSTRUMENTATION.md` — how to apply + provenance notes.

## 1. Provenance
- Bundles: `integrated` = `claude/mid-turn-collision-logic-mkxurg` @ `66904d2`;
  `perf-substrate` = `claude/cluster-lookahead` @ `8059b86`; `admission` =
  `arch/s2` @ `724d83f`. Node v22.23.2.
- P1/N0/P2/P3/P6/P7: pre-trail harness. P4/P5: `-t2` bundles, same bot SHAs,
  harness `59e94de` (trail telemetry only).
- Host: DESKTOP-6DUTJPI WSL2, 24 cores, 31 GB. All pairs `--workers 10`
  (P7: 4 arms x 5), load ~21-25 throughout. 1,824 games; 0 illegal, 0 errors.

## 2. What to do
1. `git fetch origin && git checkout -b sim-results/local-20260827 origin/sim/worker-kit`
2. `git am` the four patches (order 0001→0004). Verify `git diff --stat
   origin/sim/worker-kit` touches only `tools/`.
3. Add a `results/20260827-overnight/` tree containing this folder's data
   files (findings.md, analysis-*.md, verify-null.txt, budget-probe-v2.txt,
   trail-and-deaths-analysis.json, decoded manifest.json) and commit with
   title `Sim results: 20260827-overnight`. Note in the commit body that
   replays + per-game manifests follow in a supplementary commit when the
   owner uploads the archive (local commit 485b52a holds the full tree).
4. Push; open a DRAFT PR, base `sim/worker-kit`, title exactly
   `Sim results: 20260827-overnight`.
5. NEVER modify anything under `src/`. Never push outside `sim-results/*`.

## 3. Headline verdicts (details + CIs in findings.md)
- Null VALID: floors ±0.097 (mix-king) / ±0.032 (snake6), 16 blocks.
- P1 substrate vs integrated: NULL — speed, not strength, at 2000ms.
- P2 lobster vs legacy @2000ms: NULL at this n.
- P3 slider: +0.115* score on snake5-queen; inert snake6 exactly 0;
  gradient 150ms~0 / 1000ms+0.31 / 2000ms+0.115.
- P4 tier-truth full: NULL — keep default `expiry`.
- P5 WASM: placement NULL; engagement UNVERIFIED (not the flip-gate verdict);
  anomaly: headline cap-rate 0.458 on vs 0.229 off.
- P6 cohort governor: NULL everywhere (first measurement; arch/s2 exists —
  the "UNBUILDABLE" note in HANDOFF.md is stale).
- P7: CENTAUR_CLUSTER_SEED FAILS its gate — snake6 win 1.00→0.15 (−0.854*),
  exhaustion deaths x1.9. CENTAUR_UNIT_FATALITY alone: no placement cost.
- Budget: deadline-aware engine; 35-60% of decisions revise after the 1s
  mark within a 2s search, but a true 1s budget matches the 2s decision
  91.7% of the time (probe v2; v1 retracted). Net: ~7% of decisions change.

## 4. Known caveats
- First launch discarded (peer-session load overlap, first ~5 min); clean
  relaunch 21:09. P4/P5 ran morning vs others overnight. aggregate.js had
  two bugs (fixed, patch 4); first-pass analysis.md dropped P1/P2 silently
  and was recut per-experiment. Full disclosure in findings.md §5.