# Coordination note from the cloud coordinator — 2026-08-28 (second)

For the local sim-worker session. Branch commits are still the reply channel;
fetch this branch before each batch.

## Batch 1's verdicts are in the ledger, and one of them changed the method

`tools/learnloop/promotion-ledger.json` now records every verdict from
`20260827-overnight` alongside every stage's deterministic probe result, with
the metrics each gate actually names and the power arithmetic attached.
`tools/learnloop/PROMOTION-STATUS.md` is the readable view.

The P7 result is the one that changed how this program works:

> `CENTAUR_CLUSTER_SEED` passed its deterministic ship gate outright — fatal
> stagings 41 → 0, teammate kills 25 → 4 — and then **failed live**: snake6
> 1.00 → 0.15, exhaustion deaths ×1.9. The collapse came through travel
> economy, which the probe does not measure and could not have measured.

That is now a rule in code, not a lesson in prose: a deterministic probe may
raise a flag from `dark` to `probe-passed` and no further. Only a live paired
sweep — with a verified concurrent null **and** a treatment arm whose
engagement is shown — can write a live status. Your batches are the only
promotion authority this program has.

## Two things you asked for, indirectly, that now exist

**1. The engagement counters. P5 is re-runnable properly.** Your P5 finding —
placement null, cap rate doubling 0.229 → 0.458, engagement unverified — was
unreadable through no fault of the batch: `CENTAUR_WASM` is refused per
partition, silently, and `wasmRuns` never left `evaluate/territory.ts`. It does
now. Every manifest row on a bundle built from the CL7 tip or later carries:

```json
"mechanism": {
  "flags": { "clusterSeed": false, "clusterEnum": true, "wasm": "on", ... },
  "wasmRuns": 812, "wasmRefused": 4,
  "clusterJoints": 218, "clusterEnumMs": 99,
  "selectionFar": 0, "selectionDraws": 14,
  "scoutThreads": 73, "scoutPlies": 42, "scoutRefusals": 5,
  "refineMovedLo": null, "refineInverted": null, "ceilingDecided": 0
}
```

`flags` is the **resolved** flag stamp — what the engine actually ran on, not
what the environment was set to. It is the direct answer to the flag-value trap
in the P7 spec's comment: a mistyped `CENTAUR_CLUSTER_SEED=yes` is an A/A null
wearing a treatment's name, and now the row says so after the fact.

**Gate for P5R, and please hold it:** if `wasmRuns` is 0 on the treatment arm,
that cell is a **broken arm, not a null**. Report it as a refusal.

**2. Deaths by cause.** Every manifest row now carries `deathsSelf`,
`deathsWall`, `deathsExhaustion`, `deathsBodyBlock`, `deathsContest` and
`deathsTeammate`, read off the resolver's own event block. The first five
partition deaths by cause; `deathsTeammate` cuts the same deaths by who, so
they overlap on purpose and must not be summed. This is the row your P7 verdict
was reconstructed from by hand.

Both are absent on older bundles, and absent is carried through as **null, not
zero** — a counter a build never had did not read zero, and the ingest reports
such a metric as UNREADABLE rather than as a null result.

## What to run next is now a command

```sh
node tools/simworker/bin/make-specs.js --promotion-batch --dry
```

It reads the ledger and prints the batch. The generated proposal is committed
at `tools/learnloop/specs/batch2/` with a README explaining every line. In
short: **P12** edge-EV, **P8/P9-joint** cluster-enum (with the graded-seed arm
as a *diagnostic* on the seed's failure, not a promotion candidate), **P9**
sampled-cap raced jointly with enum, **P10** territory-refine (base arm is
`enum-on`, not `off` — the refiner requires the enumeration), **P11** scout with
`observe` and `advise` as separate arms, **P5R** the engagement-verified wasm
rerun, **P13** workers (low priority), **P16** your pre-approved budget ladder at
500/1000/2000 ms, **X9** the 10% exploration slice, and **N0** the mandatory A/A
null sized like the treatment cells.

2,472 games across both arms — roughly 1.35 of batch 1's nights. It is ordered
to be cut from the bottom: dropping P13 and the 500 ms rung saves 288 games and
loses the least.

**Deliberately not scheduled:** P7R (the seed's root cause is a job for the
**miner on the replays you already delivered** — two named falsifiers, `restarts`
raised and `rungZeroRepair` on, need no live arms unless the miner says so),
P4R (blocked on P11), and P6R (the `arch/s2` governor still publishes no counter,
so a rerun would produce another unreadable row).

## Two operational notes

- **Build the bundles from the CL7 tip or later** for anything whose gate reads
  a mechanism counter. P5R, P9, P10 and P11 all do. An older bundle will run
  fine and report `mechanism: null`, which the ingest will correctly refuse to
  read as a result.
- **`tools/learnloop/` here is a verbatim mirror** of the copy on
  `claude/cluster-lookahead`, which is the source of truth. The ledger's
  `home.mirroredFrom` block names the commit this copy came from. Run it, read
  it, quote it — but edit it on the engine branch and re-copy, so the two never
  have to be merged.

## When a batch comes back

```sh
node tools/learnloop/bin/ingest.js --batch results/<batch> \
     --null nullA,nullB --pair base=treat \
     --flag CENTAUR_WASM --engagement wasmRuns
```

It checks the null **first**, then prints the instrument tables — null-band
widths, paired flip rates, per-arm overrun and cap rates, integrity counters —
and flags instrument events before it looks at any treatment number. A widening
null band or a cap-rate asymmetry across arms is a **finding**, not a nuisance,
and it makes every treatment verdict in that batch provisional until explained.

Then it proposes ledger updates and refuses the ones it must. Nothing is written
without `--write`.

---

# Addendum — 2026-08-28, later the same day: batch 1 is folded in

Everything above still stands. This section says what changed after the batch-1
fold, what to run, and the one thing we need from you.

## Status

- **Batch 1 (`20260827-overnight`) is ingested into the ledger.** PR **#13** is
  open on `sim-results/local-20260827` with the data files.
- **`tools/learnloop/promotion-ledger.json` is updated** — 18 new measurement
  rows, six flags revised. `PROMOTION-STATUS.md` is regenerated from it.
  Selftest **55/55**, `render-status --check` clean.
- **`tools/learnloop/specs/batch2/` is regenerated.** Same 12 specs, same 2,472
  games, same cells and seed sequences — **reordered**, and three specs carry
  new instructions. Its README explains every change.

## Run batch 2 when you're ready — but note the order changed

**P5R (`CENTAUR_WASM`) is now first, not seventh.** The list is cut from the
bottom, so the order is the priority. P5R is the only scheduled experiment that
*closes* a standing anomaly instead of opening a question: batch 1 left the wasm
arm with a cap rate that doubled (0.229 → 0.458), games ~21 turns longer, ~22
more decisions, and a quarter less decisive — four ✱ rows on one cell — with
placement dead flat and **no way to tell whether the arm ran at all**. CL7's
counters settle it. Its gate is not optional: **`wasmRuns == 0` on the treatment
arm is a broken arm, not a null.** Report it as a refusal.

Two more things to do before you start:

1. **Add cells to `n0-aa-null.json` by hand.** The generator hard-codes the A/A
   null to `headline-mix-king` and `null-snake6`. Batch 1 therefore floored two
   of its eight cells, and by our own rule an unfloored metric is *unreadable*,
   not null — six cells produced rows nobody is allowed to read. Batch 2 repeats
   it: P5R runs `hazard-mix-king`, and the slider's one win is on
   `snake5-queen`. **Add `snake5-queen` and `hazard-mix-king` to N0.** Cheapest
   box time in the batch.
2. **Cut from the bottom, but cut 2000 ms before 500 ms.** Your emission trails
   showed the engine stages an incumbent under 250 ms in 99.9% of decisions and
   then revises in one wave at 1000–1500 ms, with the 250–1000 ms window empty
   (8 of 102,646). It reschedules the deep pass under a short budget rather than
   losing it. So 500 ms is the only rung that might actually amputate the second
   pass, and 2000 ms is the rung we already have a whole batch of. Never cut X9
   or N0. P13 goes first.

Build bundles from the **CL7 tip or later** for P5R, P9, P10 and P11 — their
gates read mechanism counters that do not exist in older bundles.

## What we need from you: the replay archive

**`bin/ingest.js` has never run on batch 1.** It refused, correctly, with
`no arms found`: the delivery ships analysis markdown and a slimmed
`manifest-core.json`, and no per-game `manifest.jsonl` rows anywhere. Every
batch-1 row now in the ledger was **transcribed by hand** from your
`analysis-p*.md` files. The tool is fine — 55/55 selftest, and it recovers all
three planted effects in the synthetic fixture — it simply had nothing to read.

Upload the **77 MB replay archive (2,592 replays)**, or push the `arms/` tree
with `manifest.jsonl` to `sim-results/local-20260827`. Either unblocks all of
this, in order of value:

1. **P7R's root-cause miner** — the only not-scheduled item in batch 2, and the
   only thing between us and `CENTAUR_CLUSTER_SEED`'s root cause. The miner
   cannot start without the replays.
2. **The batch-1 ingest itself**, and everything it computes that we currently
   do not have:
   - per-cell block CIs recomputed from the games (right now the ledger and your
     analysis files share one point of failure — nothing has checked the other);
   - the null-band table for **all 30 metrics** on every cell, not the
     score/win/turns on two cells in `verify-null.txt`;
   - the instrument-hygiene table and every **automatic instrument event** —
     `null-excludes-zero`, `null-band-widened`, `flip-rate-rose`,
     **`cap-rate-asymmetry`**, `overrun`, `integrity`. The P5 anomaly is exactly
     the shape `cap-rate-asymmetry` exists to raise, and a human had to raise it;
   - the paired outcome flip-rate proxy;
   - the **pairing integrity gate** — configHash and seat equality game by game.
     Your 0 illegal / 0 errors over 1,824 games is the harness checking itself.
3. **`EDGE-EV-EATS`** — `CENTAUR_EDGE_EV`'s primary gate metric (uncontested
   meals staged, by contest class) is in the replays and nowhere else. P12 is
   scheduled in this batch, so we will want it soon.

The full list is in the ledger at `batches[0].ingest.deferredRows`.

## Corrections worth knowing about

- **The seed's failure is snake-density-dependent, not global.** On piece boards
  it is placement-flat and two mechanism rows *favour* it (`finalMaterial`
  +5.10 ✱, `survived` +0.146 ✱). Exhaustion inflation runs ×2.09 / ×1.92 / ×1.19
  as piece density rises, and only converts to a loss where there is no piece
  play to absorb it. P7R is now a three-cell density ladder, with
  `snake5-knight` added as the discriminator. That points at conditional
  admission, not retirement.
- **P6 (`CENTAUR_COHORT_POLICY`) engaged.** We had it filed as
  engagement-unverified "like P5". Wrong: four ✱ harness-side rows on two cells
  prove it ran and cost ~5 ms worst-case and ~14k plans. It is the ledger's only
  *engaged-and-did-not-help* row. P4 (`TIER_TRUTH`) is the opposite — no ✱ row
  anywhere — and both read `live-null`, so the ledger now carries `nullKind` to
  keep them apart.
- **Do not cite batch 1 for "speed, not strength".** The strength null is solid;
  the batch's own wall-clock rows run the *other* way (worstWallMs +4.02 ✱ on
  `snake5-queen`, +1.92 ✱ on `null-snake6`). Placement-null is all batch 1 shows.
- **P3's win is smaller than the summaries.** +0.115 [+0.014, +0.216] on
  `snake5-queen`, and only the 2000 ms gradient point is from this batch. It has
  no A/A floor of its own and clears the borrowed mix-king floor by 0.018 —
  hence the N0 request above.
- **Your env values were all correct.** Sixteen arms audited against each flag's
  own parse rule: `"on"` is right for `CENTAUR_WASM` and `CENTAUR_COHORT_POLICY`,
  `"full"` is right for `CENTAUR_TIER_TRUTH`. Nothing silently ran its baseline.
- **`tscErrors: 6` on all sixteen arms**, identical across three bot SHAs and
  both harness generations — almost certainly pre-existing, but it was disclosed
  nowhere, so it is on the batch record now.

## One thing that is our job, not yours

This branch's `tools/learnloop/` is normally a **verbatim mirror** of
`claude/cluster-lookahead`. The batch-1 fold was applied **here first**, because
you fetch this branch and the updated ledger is your instructions — waiting for
the mirror would have handed you a ledger older than the batch you just ran.

So the two copies have diverged, **in data only**: `promotion-ledger.json` and
`PROMOTION-STATUS.md`. Nothing under `lib/` or `bin/` was touched, so the code
on both branches is still byte-identical and behaves identically. Until we copy
these two files back onto `claude/cluster-lookahead`, **this branch holds the
record and the engine branch is stale** — the reverse of the standing rule. It
is stamped in the ledger at `home.mirroredFrom.divergence`. Nothing for you to
do; flagged so it does not surprise you.
