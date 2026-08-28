# Batch 2 — the proposed P-list

**Generated** by `node tools/learnloop/bin/make-promotion-batch.js` from
`tools/learnloop/promotion-ledger.json`. Regenerate rather than hand-edit; the
`_comment` block in each spec carries the question, the arms, the metrics it
reads out, and the design note that says why the arms are shaped that way.

`P-LIST.json` is the machine-readable form of the table below.

## The list

| id | flag | blocks | games/arm | why now |
|---|---|---|---|---|
| **P12** | `CENTAUR_EDGE_EV` | 16 | 144 | Never raced. The probe found staged meals up (5→8) and meals *eaten* down (84→81) on piece boards — a tension only a live arm can adjudicate. |
| **P8/P9-joint** | `CENTAUR_CLUSTER_ENUM` | 16 | 144 | The strongest deterministic case on the branch (fatal stagings fall at every point of the q-curve, mean Δfloor +1.03 at the census's own regime) and never raced. Includes the graded-seed joint arm as a **diagnostic** on the seed's failure, not as a promotion candidate. |
| **P9** | `CENTAUR_SAMPLED_CAP` | 16 | 144 | Far-priced options 0→22 at q=32 with zero fatal stagings. Raced **jointly with enum**: CL3's dirty set cannot mark clean under a sampled cap, so the singles arm does not describe the shipped combination. |
| **P10** | `CENTAUR_TERRITORY_REFINE` | 16 | 144 | Sound by brute force, zero argmax flips offline, +22 µs/**evaluation**. The question is purely economic and purely live. Base arm is `enum-on`, not `off` — the refiner requires the enumeration. |
| **P11** | `CENTAUR_SCOUT` | 16 | 144 | The scout exists and costs 16.8 ms/decision. `observe` and `advise` are **separate arms**: observe−off isolates the tithe, advise−observe isolates the advice. One arm carrying both would report their sum. |
| **P5R** | `CENTAUR_WASM` | 16 | 144 | The rerun with engagement on the record. **Gated: refuse the cell if `wasmRuns` is 0 on the treatment arm** — that is a broken arm, not a null, and reporting it as a null is the error this rerun exists to correct. Requires a bundle built at or after the CL7 telemetry closure. |
| **P13** | `CENTAUR_WORKERS` | 16 | 96 | Low priority. P1 already bounds the whole substrate's strength effect at null; this only sharpens attribution to the pool. |
| **P16 @ 500 / 1000 / 2000** | budget ladder | 8 each | 48 each | The owner's pre-approved follow-up, and its condition is **met**: budget-probe v2 confirmed a true 1000 ms run reproduces the 2000 ms decision 91.7% of the time (flip 8.3 ± 7.0 against an A/A floor of 1.7 ± 3.2). One trail-instrumented cell — the 35% revision wave was measured pre-CL3, and cluster enumeration front-loads coordination, so the wave's own shape may have moved. |
| **X9** | the exploration slice | 4 | 36 | `TERRITORY_SLIDER_PROFILE`, `CENTAUR_STAGING_SAFETY` and `gainOrdering` each run their **opposite** branch. The ratchet guard: today's policy selects tomorrow's corpus. Mechanism-first; do not read placement off these cells. |
| **N0** | the A/A null | 16 | 96 | Mandatory, and sized like the treatment cells. Batch 20260827 measured ±0.097 (mix-king) and ±0.032 (snake6) with 0 illegal and 0 errors. A wider band this time is an **instrument event**, not a nuisance. |

**12 specs, 2,472 games across both arms of every pair.** Batch 1 was 1,824
games in one overnight on the 24-core box, so this is roughly 1.35 nights at the
same throughput. It is ordered to be cut from the bottom: dropping P13 and the
budget ladder's 500 ms rung saves 288 games and loses the least.

## Not scheduled, and why

**P7R — `CENTAUR_CLUSTER_SEED`'s root cause.** The flag is `live-failed` and the
next step is the **root-cause miner on the already-delivered 20260827 replays**,
not new games. Two named falsifiers exist and neither needs a live arm: raise
`restarts`, and turn `rungZeroRepair` on. If the shortfall is basin choice it
should vanish under either. Schedule live support cells only if the miner comes
back needing them — and the ledger's `nextExperiment` for P7R is already written
so that scheduling it is one edit, not a new design.

**P4R — `CENTAUR_TIER_TRUTH=full` at ply 2.** Blocked on P11. There is no point
measuring the ply-2 prerequisite before the ply-2 consumer has been raced. This
flag will be promoted for a *soundness* reason and not a placement one; the
ledger says so, so a future reader does not go looking for a placement win that
will never arrive.

**P6R — `CENTAUR_COHORT_POLICY`.** Deferred. The `arch/s2` governor publishes no
counter the mechanism report can fold, so its null is engagement-unverified by
construction and a rerun would produce another unreadable row. Its target boards
are the crowded ones — more claimants than budget is where a governor can act at
all — and that cell is worth running the day the counters exist.

## Running it

Every arm is one seat against unchanged opponents, per the standing rule. The
off arm is set by **omitting** the variable: every CL flag parses only `1`, `on`
or `true`, with no warning on anything else, so a mistyped value is an A/A null
wearing a treatment's name.

Since the CL7 telemetry closure the per-game rows also carry the **resolved flag
stamp** — what the engine actually ran on, as opposed to what the environment
was set to. Read that. It is the only thing that distinguishes a treatment arm
from an arm that thought it was one.
