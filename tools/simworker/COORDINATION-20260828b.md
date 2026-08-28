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
