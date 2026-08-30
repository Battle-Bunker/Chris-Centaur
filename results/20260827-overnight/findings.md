# Findings — batch 20260827-overnight (P0-P7 + A/A null)

Local sim-worker session, DESKTOP-6DUTJPI (WSL2, 24 cores, 31 GB, Node
v22.23.2). All pairs `--workers 10` (P7: 4 arms x 5 = same 20 concurrent
games); loadavg 21-25 throughout every sweep (traces in `pairs/*.json`).
Every number below is read against §1's null. Placement resolution at 16
blocks is ~±0.10; smaller deltas are null results by design.

## 1. THE NULL, FIRST

`verify-null.txt`: **VERDICT: nullA vs nullB is a valid A/A null.**
16 blocks, treatment-sized, same night, same box, same workers.
Floor (score, 95% t over block means): **±0.097** on `headline-mix-king`,
**±0.032** on `null-snake6`. Illegal moves and decision errors: **0** in
every arm of every sweep.

## 2. Verdict lines

- **P1 (integrated vs perf-substrate): NULL on strength.** Every cell inside
  the floor (headline −0.010 [−0.129,+0.109]; queen 0.000 [−0.112,+0.112];
  snake6 exactly 0). At 2000 ms the perf substrate is a speed play, not a
  strength play. (`analysis-p1p2.md`)
- **P2 (lobster vs legacy, 2000 ms): NULL.** Headline −0.063 [−0.164,+0.039]
  (favoring lobster, includes 0); knight +0.031 [−0.056,+0.118]. The first
  honest budget for legacy produced no claimable placement gap at this n.
- **P3 (slider profile): WIN on the queen cell.** Score **+0.115
  [+0.014,+0.216]** ✱, win +0.208 [−0.006,+0.422] — CI excludes zero and the
  point estimate clears the mix-king floor (±0.097) — narrowly; treat as a
  confirmed-direction, modest-size effect. Provably-inert `null-snake6`:
  **exactly 0**, as construction demands. Pawn and mix-king cells null.
  Budget gradient I2 started now has three points on the queen family:
  150 ms ~0, 1000 ms +0.31, 2000 ms +0.115 — the repair pays most near
  1000 ms on current evidence. (`analysis-p3.md`)
- **P4 (tier-truth full vs expiry, potion cells): NULL everywhere** (potion
  mix-king −0.063 [−0.218,+0.093]; potion-queen 0.000; no-potion null cell
  +0.031). This was the never-run re-measure: no evidence to flip the
  default off `expiry`. (`analysis-p4.md`)
- **P5 (WASM on vs off): placement NULL** on all cells. CAVEAT (per the
  spec's own warning): engagement was not directly instrumented, so
  "engaged and did not help" vs "never engaged" is unresolved — do not
  treat this as the flip-gate verdict yet. FLAGGED ANOMALY: cap-terminal
  rate on headline doubled under wasm-on (0.458 vs 0.229); untested, in
  the replays for mining. (`analysis-p5.md`)
- **P6 (cohort governor on vs off): NULL everywhere** (headline +0.010
  [−0.095,+0.115]; hazard +0.021 [−0.134,+0.176]; snake6 −0.021
  [−0.065,+0.024]). First-ever measurement of this flag — the standing
  record said the branch did not exist; see §4. (`analysis-p6.md`)
- **P7 (CL1 gates): CENTAUR_CLUSTER_SEED FAILS its promotion gate.**
  On `null-snake6`, cl-seed vs cl-off: score **−0.594 [−0.666,−0.521]** ✱,
  win **−0.854 [−0.945,−0.763]** ✱ (win rate 1.00 → 0.15). cl-both nearly
  identical (−0.573 ✱ / −0.771 ✱); cl-fatality alone NULL everywhere.
  Mechanism (deaths-p7.json): snake exhaustion deaths on snake6 nearly
  double under the seed — cl-off 39, cl-seed 75, cl-both 72, cl-fatality 33
  per 48 games. The index-driven seed starves snakes on piece-free boards.
  Piece cells (headline, knight): all three treatments null. Verdict: do
  not promote CENTAUR_CLUSTER_SEED as-is; CENTAUR_UNIT_FATALITY carries no
  placement cost here. (`analysis-p7.md`)

## 3. Budget sensitivity (owner's question: what does 2000 ms buy over 1000 ms?)

Two independent instruments, one coherent answer:

- **Emission trails** (new harness telemetry, P4+P5, 102,646 decisions):
  the engine stages an incumbent in <250 ms (99.9%), then either never
  revises or revises in a wave landing at **1000-1500 ms** — 35.0% of P4
  decisions and 60.1% of P5 decisions differ at the 1000 ms mark vs final.
  Almost no revisions occur between 250-1000 ms.
  (`trail-analysis-p4.json`, `trail-analysis-p5.json`)
- **budget-probe v2** (60 recorded positions, idle box, fresh engine per
  position, A/A control): a TRUE 1000 ms budget reproduces the 2000 ms
  decision 91.7% of the time — flip 8.3% ±7.0 vs same-budget floor 1.7%
  ±3.2, excess ≈ **6.7 points**. (`budget-probe.txt`)

Reading: the engine is deadline-aware — under a 1 s budget it reschedules
the deep pass rather than losing it; the revision wave sits at 1.0-1.5 s
only because 2 s makes that comfortable. Net decision-level effect of the
second second: **~7% of decisions change** (wide CI at n=60). Whether those
7% are better decisions is unmeasured. Proposed follow-up (owner-aware):
budget-ladder batch {500,1000,2000} for integrated vs perf-substrate,
~1.75x one cell's cost.

**budget-probe v1 is RETRACTED** (`budget-probe.json` in earlier interim
zip): it reused one engine across games; engines carry per-game ledger
state; results were degenerate (0/60 in 26 s). Fixed in tooling commit
65aa973.

## 4. Corrections to the standing record

- **arch/s2 exists on origin** (`724d83f`) and builds clean; HANDOFF.md's
  "UNBUILDABLE — skip P6" was stale (branch appeared after the kit was
  cut; verified by fresh ls-remote both here and by the peer session,
  which retracted its "P6 impossible" finding).

## 5. What went wrong, honestly

- **First launch discarded.** 20:55 launch killed ~21:07; a peer session's
  probe overlapped the first ~5 min (timestamped pause 21:00:37). Batch dir
  wiped (~31 games), clean relaunch 21:09. No foreign load thereafter.
- **P4/P5 ran in the morning** (post-08:35) vs the rest overnight — same
  box, same workers, each pair internally load-symmetric.
- **Harness split.** P1/N0/P2/P3/P6/P7 on pre-trail harness; P4/P5 on `-t2`
  bundles (same bot SHAs 66904d2 / 8059b86 / 724d83f, harness 59e94de,
  telemetry-only change). `arm.json` per arm records it.
- **aggregate.js bugs found and fixed** (commit 65aa973): crashed on sweeps
  its --base never ran; and a global --subject-map poisoned other sweeps'
  seat checks, silently dropping P1/P2 from the first analysis.md — recut
  as explicit per-experiment passes (`analysis-p1p2.md`, `analysis-p3.md`,
  `analysis-p4/5/6/7.md`). Integrity-problem lists in each file are
  dominated by *other experiments'* sweeps being skipped — expected.
- **P0 pilot + workers calibration** may have overlapped peer activity;
  used for sizing only, never for claims.

## 6. Tooling delivered on this branch

`7a3b13f` run-pair per-arm spec= override (P3's subject seam) ·
`a8d73b7` budget-probe ·
`59e94de` timestamped emission trail (owner-requested; makes any budget
threshold a log query) ·
`65aa973` aggregate base-skip + probe fresh-engine fixes.